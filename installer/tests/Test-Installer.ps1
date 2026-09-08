<#
.SYNOPSIS
  Pruebas del instalador Windows. No necesitan Docker ni instalar nada.

.DESCRIPTION
  Cubren las reglas que, si se rompen, no fallan de forma visible sino que
  dejan la aplicacion escribiendo en Program Files o buscando el .env donde no
  esta:

    - el directorio de datos y su arbol (config, data, output, logs, backups);
    - la migracion desde el home de la v0.4.x (%LOCALAPPDATA%\AutomationPlatform);
    - la siembra de config sin pisar el perfil del usuario;
    - los argumentos comunes de `docker compose` (-f, --env-file,
      --project-directory), que son lo que permite separar codigo y datos;
    - que ningun script escriba datos dentro del directorio de instalacion.

  Los casos que dependen de %LOCALAPPDATA% se ejecutan en un proceso hijo con
  esa variable redirigida a un temporal, para no tocar los datos reales de la
  maquina que ejecuta las pruebas.

.PARAMETER Verbose
  Muestra tambien las comprobaciones que pasan.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LibPath  = Join-Path $RepoRoot 'installer\lib.ps1'

$script:Pass = 0
$script:Fail = 0

function Assert-True {
  param([Parameter(Mandatory)][bool] $Condition, [Parameter(Mandatory)][string] $Name, [string] $Detail)
  if ($Condition) {
    $script:Pass++
    Write-Host "  PASS  $Name" -ForegroundColor DarkGreen
  } else {
    $script:Fail++
    Write-Host "  FAIL  $Name" -ForegroundColor Red
    if ($Detail) { Write-Host "        $Detail" -ForegroundColor Red }
  }
}

function Assert-Equal {
  param($Expected, $Actual, [Parameter(Mandatory)][string] $Name)
  Assert-True -Condition ("$Expected" -eq "$Actual") -Name $Name -Detail "esperado '$Expected', obtenido '$Actual'"
}

function Assert-Contains {
  param([string] $Haystack, [string] $Needle, [Parameter(Mandatory)][string] $Name)
  Assert-True -Condition ($Haystack -like "*$Needle*") -Name $Name -Detail "'$Needle' no aparece en '$Haystack'"
}

function New-TempDir {
  $d = Join-Path ([IO.Path]::GetTempPath()) ('pa-test-' + [guid]::NewGuid().ToString('N').Substring(0, 10))
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  return $d
}

# Ejecuta un bloque en un PowerShell hijo con %LOCALAPPDATA% redirigido, para
# que AP_DATA_HOME y AP_LEGACY_HOME caigan dentro del temporal. Devuelve la
# ultima linea de la salida, que es lo que el bloque escribe con Write-Output.
function Invoke-InSandbox {
  param(
    [Parameter(Mandatory)][string] $LocalAppData,
    [Parameter(Mandatory)][string] $Body,
    [string] $DataHomeOverride
  )
  $prelude = @"
`$ErrorActionPreference = 'Stop'
`$env:LOCALAPPDATA = '$LocalAppData'
`$env:AUTOMATION_PLATFORM_HOME = ''
`$env:PERSONAL_ASSISTANT_DATA = '$DataHomeOverride'
. '$LibPath'
"@
  $script = Join-Path $LocalAppData 'case.ps1'
  ($prelude + "`n" + $Body) | Set-Content $script -Encoding utf8
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script 2>&1
  return ($out | Out-String).Trim()
}

Write-Host ''
Write-Host '=== Instalador: rutas y separacion codigo/datos ===' -ForegroundColor Cyan

# --- 1. Arbol del directorio de datos -------------------------------------
$sandbox = New-TempDir
try {
  $res = Invoke-InSandbox -LocalAppData $sandbox -Body @'
Initialize-ApHome
$dataHome = Get-ApDataHome
foreach ($d in @('config','data','output','logs','backups','output\marca-personal')) {
  if (-not (Test-Path (Join-Path $dataHome $d))) { Write-Output "FALTA:$d"; exit }
}
if (-not (Test-Path (Join-Path $dataHome 'data\README.txt'))) { Write-Output 'FALTA:data\README.txt'; exit }
Write-Output $dataHome
'@
  Assert-Equal -Expected (Join-Path $sandbox 'Personal Assistant') -Actual $res `
    -Name 'Initialize-ApHome crea el arbol completo en %LOCALAPPDATA%\Personal Assistant'
} finally { Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue }

# --- 2. Migracion desde el home de la v0.4.x ------------------------------
$sandbox = New-TempDir
try {
  $legacy = Join-Path $sandbox 'AutomationPlatform'
  New-Item -ItemType Directory -Force -Path (Join-Path $legacy 'backups\20250101-000000') | Out-Null
  'estado-antiguo' | Set-Content (Join-Path $legacy 'state.json')
  'log-antiguo'    | Set-Content (Join-Path $legacy 'install.log')

  $res = Invoke-InSandbox -LocalAppData $sandbox -Body @'
Initialize-ApHome
$dataHome = Get-ApDataHome
$ok = @()
$ok += if ((Get-Content (Join-Path $dataHome 'data\state.json') -Raw).Trim() -eq 'estado-antiguo') { 'state' } else { 'NO-state' }
$ok += if ((Get-Content (Join-Path $dataHome 'logs\install.log') -Raw).Trim() -eq 'log-antiguo') { 'log' } else { 'NO-log' }
$ok += if (Test-Path (Join-Path $dataHome 'backups\20250101-000000')) { 'backup' } else { 'NO-backup' }
Write-Output ($ok -join ',')
'@
  Assert-Equal -Expected 'state,log,backup' -Actual $res `
    -Name 'el home de la v0.4.x se migra con su estado, su log y sus backups'
  Assert-True -Condition (-not (Test-Path $legacy)) `
    -Name 'el home antiguo deja de existir tras migrarlo' -Detail "sigue ahi: $legacy"
} finally { Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue }

# --- 3. Siembra de config sin pisar el perfil del usuario -----------------
$sandbox = New-TempDir
try {
  $res = Invoke-InSandbox -LocalAppData $sandbox -Body @"
Initialize-ApUserConfig -AppRoot '$RepoRoot'
`$cfg = Get-ApConfigDir
`$seeded = (Test-Path (Join-Path `$cfg 'modules.json')) -and (Test-Path (Join-Path `$cfg 'user_profile.json'))
# El usuario edita su perfil; una segunda pasada no debe tocarlo.
'MI-PERFIL' | Set-Content (Join-Path `$cfg 'user_profile.json')
Initialize-ApUserConfig -AppRoot '$RepoRoot'
`$kept = (Get-Content (Join-Path `$cfg 'user_profile.json') -Raw).Trim() -eq 'MI-PERFIL'
Write-Output ("seeded=`$seeded kept=`$kept")
"@
  Assert-Equal -Expected 'seeded=True kept=True' -Actual $res `
    -Name 'Initialize-ApUserConfig siembra la config y respeta el perfil existente'
} finally { Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue }

# --- 4. Argumentos de docker compose --------------------------------------
$sandbox = New-TempDir
try {
  $res = Invoke-InSandbox -LocalAppData $sandbox -Body @"
Initialize-ApHome
'X=1' | Set-Content (Get-ApEnvPath)
Write-Output (Get-ApComposeArgs 'C:\Program Files\Personal Assistant')
"@
  Assert-Contains -Haystack $res -Needle 'compose -f "C:\Program Files\Personal Assistant\docker-compose.yml"' `
    -Name 'Get-ApComposeArgs apunta al compose instalado'
  Assert-Contains -Haystack $res -Needle '--project-directory "C:\Program Files\Personal Assistant"' `
    -Name 'Get-ApComposeArgs ancla las rutas relativas al directorio de instalacion'
  Assert-Contains -Haystack $res -Needle '--env-file' `
    -Name 'Get-ApComposeArgs usa el .env del directorio de datos'
} finally { Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue }

# --- 5. Ruta para Docker ---------------------------------------------------
$sandbox = New-TempDir
try {
  $res = Invoke-InSandbox -LocalAppData $sandbox -Body @'
Write-Output (ConvertTo-ApDockerPath 'C:\Users\a\AppData\Local\Personal Assistant\config')
'@
  Assert-Equal -Expected 'C:/Users/a/AppData/Local/Personal Assistant/config' -Actual $res `
    -Name 'ConvertTo-ApDockerPath entrega la ruta como la espera Docker Desktop'
} finally { Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue }

# --- 6. Read-ApEnvMap prefiere el .env del directorio de datos ------------
$sandbox = New-TempDir
try {
  $fakeApp = Join-Path $sandbox 'app'
  New-Item -ItemType Directory -Force -Path $fakeApp | Out-Null
  'ORIGEN=directorio-de-instalacion' | Set-Content (Join-Path $fakeApp '.env')
  $res = Invoke-InSandbox -LocalAppData $sandbox -Body @"
Initialize-ApHome
'ORIGEN=directorio-de-datos' | Set-Content (Get-ApEnvPath)
Write-Output (Read-ApEnvMap '$fakeApp')['ORIGEN']
"@
  Assert-Equal -Expected 'directorio-de-datos' -Actual $res `
    -Name 'Read-ApEnvMap gana el .env de datos sobre uno viejo en el directorio de instalacion'
} finally { Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue }

# --- 7. Ningun script escribe datos dentro del directorio de instalacion --
Write-Host ''
Write-Host '=== Instalador: nada escribe en el directorio de instalacion ===' -ForegroundColor Cyan

# Patrones que significan "escribo datos junto al codigo". Las lecturas de
# plantillas ($RepoRoot\config\...example) y de workflows son legitimas.
$writeSmells = @(
  @{ Pattern = "Join-Path \`$RepoRoot '\.env'";        Why = "el .env va al directorio de datos" }
  @{ Pattern = "Join-Path \`$RepoRoot 'output";        Why = "output\ va al directorio de datos" }
  @{ Pattern = "Set-Content .*\`$RepoRoot";            Why = "no se escribe en el directorio de instalacion" }
)
# Hay una referencia legitima a $RepoRoot\.env: la migracion del layout
# antiguo, que MUEVE el fichero fuera del directorio de instalacion en lugar de
# escribir en el. Se reconoce por el Move-Item o por el nombre 'legacy'.
foreach ($file in @('installer\install.ps1', 'installer\uninstall.ps1',
                    'installer\windows\scripts\control.ps1',
                    'installer\windows\scripts\backup.ps1',
                    'installer\windows\scripts\restore.ps1',
                    'installer\windows\scripts\tray.ps1')) {
  $full = Join-Path $RepoRoot $file
  if (-not (Test-Path $full)) { Assert-True -Condition $false -Name "$file existe"; continue }
  $lines = Get-Content $full
  $hits = @()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    foreach ($smell in $writeSmells) {
      if ($lines[$i] -match $smell.Pattern) {
        if ($lines[$i] -match 'Move-Item|legacy') { continue }   # migracion: saca el fichero de ahi
        $hits += ("linea {0}: {1}  ({2})" -f ($i + 1), $lines[$i].Trim(), $smell.Why)
      }
    }
  }
  Assert-True -Condition ($hits.Count -eq 0) -Name "$file no escribe datos junto al codigo" `
    -Detail ($hits -join "`n        ")
}

# --- 8. docker-compose parametriza los montajes con escritura -------------
$compose = Get-Content (Join-Path $RepoRoot 'docker-compose.yml') -Raw
Assert-Contains -Haystack $compose -Needle 'PA_CONFIG_DIR' -Name 'compose usa PA_CONFIG_DIR para config/'
Assert-Contains -Haystack $compose -Needle 'PA_OUTPUT_DIR' -Name 'compose usa PA_OUTPUT_DIR para output/'
Assert-True -Condition ($compose -notmatch '(?m)^\s*-\s*\./config:/config\s*$') `
  -Name 'compose ya no monta ./config con escritura desde el directorio de instalacion'
Assert-True -Condition ($compose -notmatch '(?m)^\s*-\s*\./output:/files/output\s*$') `
  -Name 'compose ya no monta ./output desde el directorio de instalacion'
# Los montajes de solo lectura si pueden seguir junto al codigo.
Assert-Contains -Haystack $compose -Needle './workflows:/files/workflows:ro' `
  -Name 'workflows/ sigue montado de solo lectura junto al codigo'

# --- 9. Identidad del producto --------------------------------------------
Write-Host ''
Write-Host '=== Producto: Personal Assistant ===' -ForegroundColor Cyan

$issPath = Join-Path $RepoRoot 'installer\windows\PersonalAssistant.iss'
Assert-True -Condition (Test-Path $issPath) -Name 'el .iss se llama PersonalAssistant.iss'
if (Test-Path $issPath) {
  $iss = Get-Content $issPath -Raw
  Assert-Contains -Haystack $iss -Needle 'OutputBaseFilename=Personal-Assistant-Setup' `
    -Name 'el instalador se llama Personal-Assistant-Setup.exe'
  Assert-Contains -Haystack $iss -Needle '#define AppName "Personal Assistant"' `
    -Name 'el producto se llama Personal Assistant'
  Assert-Contains -Haystack $iss -Needle 'DefaultDirName={autopf}\Personal Assistant' `
    -Name 'se instala en Program Files\Personal Assistant'
  # El AppId identifica el producto para Windows: si cambia, una actualizacion
  # deja de reconocer la instalacion anterior y aparecen dos entradas en
  # "Agregar o quitar programas".
  Assert-Contains -Haystack $iss -Needle 'AppId={{7F1C4E9A-3B2D-4A56-9E10-AC0DEC0DE001}' `
    -Name 'el AppId NO cambia con el renombrado'
  Assert-Contains -Haystack $iss -Needle "RegQueryStringValue(HKCU, 'Software\Automation Center', 'InstallDir'" `
    -Name 'una instalacion de la v0.4.x se sigue detectando como actualizacion'
  Assert-True -Condition ($iss -notmatch 'automation-center\.ico') `
    -Name 'no quedan referencias al icono con el nombre antiguo'
}

# El icono renombrado tiene que existir: Inno falla en compilacion si no.
Assert-True -Condition (Test-Path (Join-Path $RepoRoot 'installer\windows\assets\personal-assistant.ico')) `
  -Name 'el icono personal-assistant.ico existe'

# Nombres internos que NO deben cambiar: romperlos renombraria contenedores,
# volumenes, base de datos o variables de entorno de una instalacion existente.
$composeRaw = Get-Content (Join-Path $RepoRoot 'docker-compose.yml') -Raw
Assert-Contains -Haystack $composeRaw -Needle 'name: personal-assistant' `
  -Name 'el proyecto de compose conserva su nombre (contenedores y volumenes)'
Assert-Contains -Haystack $composeRaw -Needle 'container_name: pa-postgres' `
  -Name 'los contenedores conservan sus nombres pa-*'
Assert-Contains -Haystack $composeRaw -Needle '/automation_center' `
  -Name 'la base de datos sigue llamandose automation_center'

Write-Host ''
Write-Host ("RESULTADO: {0} pass, {1} fail" -f $script:Pass, $script:Fail) `
  -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
exit $(if ($script:Fail) { 1 } else { 0 })
