<#
.SYNOPSIS
  Audita el contenido del instalador Windows antes de distribuirlo.

.DESCRIPTION
  Dos comprobaciones independientes:

  1. MANIFIESTO (siempre). Inno Setup escribe `dist\Setup-Manifest.txt` con
     TODOS los ficheros que entran en el .exe (`OutputManifestFile` en el
     .iss). Se comprueba contra una lista de prohibidos y una de obligatorios.

  2. EXTRACCION REAL (-Extract). Instala el .exe en un directorio temporal en
     modo silencioso, sin tareas (`/TASKS=""`, asi no arranca el bootstrap ni
     toca Docker), y vuelve a auditar el arbol de ficheros resultante. Es la
     prueba de que lo que el usuario recibe coincide con el manifiesto.
     Restaura la clave HKCU que el instalador escribe, para no dejar
     registrada una "instalacion previa" apuntando a %TEMP%.

  Motivo: hasta la v0.4.0 el .iss empaquetaba `{#RepoRoot}\*` con una lista de
  exclusiones incompleta. Una clave privada RSA en la raiz del repositorio
  (n8n-aws-instance-key.pem) habria viajado dentro de cada instalador, junto
  con .claude\ (13 worktrees completos) y ficheros ajenos al producto.

.PARAMETER Exe
  Ruta del instalador. Por defecto el ultimo *-Setup.exe de dist\.

.PARAMETER Manifest
  Ruta del manifiesto. Por defecto dist\Setup-Manifest.txt.

.PARAMETER Extract
  Ejecuta tambien la extraccion real (mas lenta, ~1 min).

.OUTPUTS
  Codigo 0 = limpio. 1 = fichero prohibido empaquetado. 2 = falta algo
  imprescindible. 3 = no se pudo auditar (falta el manifiesto o el .exe).
#>
[CmdletBinding()]
param(
  [string] $Exe,
  [string] $Manifest,
  [switch] $Extract
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DistDir  = Join-Path $RepoRoot 'dist'
if (-not $Manifest) { $Manifest = Join-Path $DistDir 'Setup-Manifest.txt' }
if (-not $Exe) {
  $Exe = (Get-ChildItem (Join-Path $DistDir '*-Setup.exe') -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime | Select-Object -Last 1 | ForEach-Object FullName)
}

# --- Reglas ---------------------------------------------------------------
# Cada regla es un patron -like aplicado a la ruta relativa del fichero, en
# minusculas y con '\' como separador. Un solo acierto invalida el paquete.
$Forbidden = @(
  @{ Pattern = '*.pem';            Why = 'clave privada / certificado' }
  @{ Pattern = '*.key';            Why = 'clave privada' }
  @{ Pattern = '*.p12';            Why = 'almacen de claves' }
  @{ Pattern = '*.pfx';            Why = 'almacen de claves' }
  @{ Pattern = 'id_rsa*';          Why = 'clave SSH' }
  @{ Pattern = '*\.env';           Why = 'secretos del despliegue' }
  @{ Pattern = '.env';             Why = 'secretos del despliegue' }
  @{ Pattern = '*.env.local';      Why = 'secretos locales' }
  @{ Pattern = '*.env.backup*';    Why = 'copia de los secretos' }
  @{ Pattern = '.claude\*';        Why = 'espacio de trabajo del agente' }
  @{ Pattern = '*\worktrees\*';    Why = 'copia completa del repositorio' }
  @{ Pattern = '*\.git\*';         Why = 'historial del repositorio' }
  @{ Pattern = '.git\*';           Why = 'historial del repositorio' }
  @{ Pattern = '*\.venv\*';        Why = 'entorno virtual de Python' }
  @{ Pattern = '*\node_modules\*'; Why = 'dependencias de Node (se instalan en la imagen)' }
  @{ Pattern = '*\__pycache__\*';  Why = 'cache de Python' }
  @{ Pattern = '*.pyc';            Why = 'cache de Python' }
  @{ Pattern = '*\.pytest_cache\*';Why = 'cache de pytest' }
  @{ Pattern = 'dist\*';           Why = 'artefactos de build' }
  @{ Pattern = 'web.py';           Why = 'landing de ILERPOTENT: no es parte de este producto' }
  @{ Pattern = '*\user_profile.json'; Why = 'perfil real del usuario, no una plantilla' }
  @{ Pattern = 'config\user_profile.json'; Why = 'perfil real del usuario, no una plantilla' }
  @{ Pattern = '*.log';            Why = 'log de una ejecucion anterior' }
  @{ Pattern = 'output\*';         Why = 'borradores generados por el usuario' }
)

# Sin estos el stack no arranca.
$Required = @(
  'docker-compose.yml'
  'version'
  '.dockerignore'
  'backend\dockerfile'
  'backend\entrypoint.sh'
  'backend\app\main.py'
  'backend\alembic.ini'
  'frontend\dockerfile'
  'frontend\package.json'
  'frontend\nginx.conf'
  'frontend\src\main.tsx'
  'playwright\dockerfile'
  'playwright\server.mjs'
  'profile\dockerfile'
  'profile\server.mjs'
  'config\modules.json'
  'config\user_profile.example.json'
  'workflows\01-email.json'
  'workflows\02-laboral.json'
  'workflows\03-news.json'
  'workflows\04-marca-personal.json'
  'scripts\db-init\001-assistant.sql'
  'scripts\db-init\002-automation-center.sql'
  'installer\lib.ps1'
  'installer\install.ps1'
  'installer\windows\scripts\bootstrap.ps1'
  'installer\windows\scripts\control.ps1'
)

function Test-FileList {
  param([AllowEmptyCollection()][string[]] $Paths, [Parameter(Mandatory)][string] $Source)

  if (-not $Paths -or $Paths.Count -eq 0) {
    Write-Host "== $Source : lista VACIA — no se ha podido auditar ==" -ForegroundColor Red
    return 3
  }

  $norm = $Paths | ForEach-Object { $_.Replace('/', '\').TrimStart('\').ToLowerInvariant() } |
          Where-Object { $_ } | Sort-Object -Unique

  Write-Host ''
  Write-Host "== $Source : $($norm.Count) ficheros ==" -ForegroundColor Cyan

  $violations = @()
  foreach ($rule in $Forbidden) {
    foreach ($f in $norm) {
      if ($f -like $rule.Pattern) {
        $violations += [pscustomobject]@{ File = $f; Rule = $rule.Pattern; Why = $rule.Why }
      }
    }
  }

  $missing = @($Required | Where-Object { $r = $_; -not ($norm | Where-Object { $_ -eq $r }) })

  if ($violations.Count) {
    Write-Host ''
    Write-Host "  PROHIBIDO ($($violations.Count)):" -ForegroundColor Red
    foreach ($v in ($violations | Sort-Object File -Unique)) {
      Write-Host ("    {0}   <- {1}" -f $v.File, $v.Why) -ForegroundColor Red
    }
  } else {
    Write-Host '  Sin ficheros prohibidos.' -ForegroundColor Green
  }

  if ($missing.Count) {
    Write-Host ''
    Write-Host "  FALTAN ($($missing.Count)):" -ForegroundColor Yellow
    foreach ($m in $missing) { Write-Host "    $m" -ForegroundColor Yellow }
  } else {
    Write-Host '  Estan todos los ficheros imprescindibles.' -ForegroundColor Green
  }

  if ($violations.Count) { return 1 }
  if ($missing.Count)    { return 2 }
  return 0
}

# --- 1. Manifiesto --------------------------------------------------------
if (-not (Test-Path $Manifest)) {
  Write-Host "No se encuentra el manifiesto: $Manifest" -ForegroundColor Red
  Write-Host 'Compila primero:  powershell -File build\build-exe.ps1' -ForegroundColor Red
  exit 3
}

# Formato del manifiesto de Inno: cabecera + una linea por fichero, campos
# separados por tabulador. El campo que interesa es SourceFilename (indice 1),
# la ruta ABSOLUTA del fichero de origen; llega sin normalizar, con el
# "installer\windows\..\..\" que introduce {#RepoRoot}. Se colapsa y se
# convierte en ruta relativa al repositorio, que en este .iss coincide siempre
# con la ruta de destino bajo {app}.
$manifestPaths = @()
$rootPrefix = ([IO.Path]::GetFullPath($RepoRoot)).TrimEnd('\') + '\'
foreach ($line in (Get-Content $Manifest)) {
  $fields = $line -split "`t"
  if ($fields.Count -lt 2) { continue }
  if ($fields[0] -eq 'Index') { continue }          # cabecera
  $src = $fields[1]
  if (-not $src) { continue }
  try { $full = [IO.Path]::GetFullPath($src) } catch { continue }
  if (-not $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    # Un fichero de fuera del repositorio en el paquete es en si mismo un fallo.
    Write-Host "  AVISO: origen fuera del repositorio -> $full" -ForegroundColor Yellow
    continue
  }
  $manifestPaths += $full.Substring($rootPrefix.Length)
}
$rc = Test-FileList -Paths $manifestPaths -Source "MANIFIESTO $(Split-Path -Leaf $Manifest)"

# --- 2. Extraccion real ---------------------------------------------------
if ($Extract) {
  if (-not $Exe -or -not (Test-Path $Exe)) {
    Write-Host "No se encuentra el instalador para extraer: $Exe" -ForegroundColor Red
    exit 3
  }
  $tmp    = Join-Path ([IO.Path]::GetTempPath()) ("pa-verify-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $regKey = 'HKCU:\Software\Personal Assistant'
  $hadKey = Test-Path $regKey
  $saved  = if ($hadKey) { Get-ItemProperty $regKey } else { $null }

  Write-Host ''
  Write-Host "==> Instalando en modo silencioso (sin tareas) en $tmp" -ForegroundColor Cyan
  try {
    # /NOICONS evita crear accesos del menu Inicio apuntando a %TEMP%.
    # /TASKS="" no selecciona ninguna tarea => `runsetup` queda sin marcar =>
    # bootstrap.ps1 NO se ejecuta => no se toca Docker, WSL ni el stack vivo.
    $p = Start-Process -FilePath $Exe -Wait -PassThru -ArgumentList @(
      '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', '/TASKS=""', "/DIR=$tmp")
    if ($p.ExitCode -ne 0) { throw "el instalador devolvio $($p.ExitCode)" }

    $files = Get-ChildItem $tmp -Recurse -File -Force |
             ForEach-Object { $_.FullName.Substring($tmp.Length).TrimStart('\') }
    # unins*.exe / unins*.dat los crea Inno, no vienen del repositorio.
    $files = $files | Where-Object { $_ -notlike 'unins*' }
    $rcExtract = Test-FileList -Paths $files -Source 'EXTRACCION REAL'
    if ($rcExtract -ne 0) { $rc = $rcExtract }
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    if ($hadKey -and $saved) {
      New-ItemProperty $regKey -Name 'InstallDir' -Value $saved.InstallDir -PropertyType String -Force | Out-Null
    } elseif (Test-Path $regKey) {
      Remove-Item $regKey -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host '  (directorio temporal y registro restaurados)' -ForegroundColor DarkGray
  }
}

Write-Host ''
switch ($rc) {
  0 { Write-Host 'PAQUETE LIMPIO.' -ForegroundColor Green }
  1 { Write-Host 'PAQUETE RECHAZADO: contiene ficheros que no deben distribuirse.' -ForegroundColor Red }
  2 { Write-Host 'PAQUETE INCOMPLETO: falta algo imprescindible para arrancar.' -ForegroundColor Yellow }
}
exit $rc
