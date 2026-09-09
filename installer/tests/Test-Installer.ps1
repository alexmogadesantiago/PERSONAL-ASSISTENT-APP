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
  # Solo la ULTIMA linea no vacia: los casos escriben su resultado con
  # Write-Output al final, y algunas funciones de lib.ps1 (Write-ApLog) tambien
  # imprimen por consola, que no forma parte del resultado.
  $lines = @(($out | Out-String) -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($lines.Count -eq 0) { return '' }
  return $lines[-1]
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

# --- 9. La instalacion no abre consolas ni pregunta nada ------------------
Write-Host ''
Write-Host '=== Instalacion sin terminal ===' -ForegroundColor Cyan

$installRaw = Get-Content (Join-Path $RepoRoot 'installer\install.ps1') -Raw
Assert-True -Condition ($installRaw -notmatch 'Read-Host') `
  -Name 'install.ps1 no pregunta nada por consola' `
  -Detail 'queda un Read-Host en el flujo de instalacion'
# Los tokens de Telegram se configuran despues, no durante la instalacion.
Assert-True -Condition ($installRaw -notmatch '(?m)^\s*\$val = Read-Host') `
  -Name 'no se piden tokens de Telegram durante la instalacion'
Assert-Contains -Haystack $installRaw -Needle '-WindowStyle Hidden' `
  -Name 'el arranque automatico no muestra una consola al iniciar sesion'
Assert-Contains -Haystack $installRaw -Needle 'control.ps1' `
  -Name 'la tarea de arranque reutiliza control.ps1 en vez de duplicar el compose'

$bootstrapRaw = Get-Content (Join-Path $RepoRoot 'installer\windows\scripts\bootstrap.ps1') -Raw
Assert-Contains -Haystack $bootstrapRaw -Needle "`$deployArgs += '-Unattended'" `
  -Name 'bootstrap despliega siempre en modo desatendido'
Assert-True -Condition ($bootstrapRaw -match 'Register-ResumeAfterReboot -BootstrapArgs "-Unattended') `
  -Name 'la reanudacion tras el reinicio tambien es desatendida'

$commonRaw = Get-Content (Join-Path $RepoRoot 'installer\windows\scripts\common.ps1') -Raw
Assert-Contains -Haystack $commonRaw -Needle 'powershell.exe -NoProfile -WindowStyle Hidden' `
  -Name 'la continuacion tras reiniciar (RunOnce) no muestra ventana'

$issRunRaw = Get-Content (Join-Path $RepoRoot 'installer\windows\PersonalAssistant.iss') -Raw
Assert-Contains -Haystack $issRunRaw -Needle 'waituntilterminated runhidden' `
  -Name 'el instalador ejecuta el bootstrap con la ventana oculta'
Assert-Contains -Haystack $issRunRaw -Needle "Result := '-Unattended';" `
  -Name 'el .exe llama al bootstrap en modo desatendido siempre'
# El mecanismo de reanudacion tras reinicio de Windows debe seguir intacto.
Assert-Contains -Haystack $commonRaw -Needle 'RunOnce' `
  -Name 'se conserva la reanudacion automatica tras el reinicio (RunOnce)'

# --- 9b. Configuracion: nada expuesto fuera de este equipo ----------------
Write-Host ''
Write-Host '=== Configuracion production-local ===' -ForegroundColor Cyan

# Recorre el compose anotando, para cada servicio, las lineas de su bloque
# `ports:`. Un mapeo "5678:5678" pelado expondria n8n a toda la red local, y n8n
# ejecuta codigo arbitrario por diseno.
$composeLines = Get-Content (Join-Path $RepoRoot 'docker-compose.yml')
$portsByService = @{}
$currentService = ''
$inPorts = $false
foreach ($line in $composeLines) {
  if ($line -match '^  ([a-z0-9_-]+):\s*$') {
    $currentService = $Matches[1]
    $portsByService[$currentService] = @()
    $inPorts = $false
    continue
  }
  if ($line -match '^\s{4}([a-z_]+):\s*$') { $inPorts = ($Matches[1] -eq 'ports'); continue }
  if ($inPorts -and $line -match '^\s+-\s*"?([^"]+)"?\s*$' -and $currentService) {
    $portsByService[$currentService] += $Matches[1]
  }
}

$allPublished = @($portsByService.Values | ForEach-Object { $_ })
Assert-True -Condition ($allPublished.Count -gt 0) `
  -Name 'el compose publica algun puerto (control de la propia prueba)'
$badBinds = @($allPublished | Where-Object { $_ -notmatch '^127\.0\.0\.1:' })
Assert-True -Condition ($badBinds.Count -eq 0) `
  -Name 'todo puerto publicado esta atado a 127.0.0.1' `
  -Detail ($badBinds -join '; ')

# Postgres y Playwright no deben publicar NADA: se hablan por la red interna.
foreach ($svc in @('postgres', 'playwright')) {
  $p = if ($portsByService.ContainsKey($svc)) { $portsByService[$svc] } else { @() }
  Assert-True -Condition (@($p).Count -eq 0) `
    -Name "$svc no publica ningun puerto al host" -Detail (@($p) -join '; ')
}

Assert-Contains -Haystack $installRaw -Needle "PA_MODE       = 'production-local'" `
  -Name 'el instalador marca la instalacion como production-local'
$envExample = Get-Content (Join-Path $RepoRoot '.env.example') -Raw
Assert-Contains -Haystack $envExample -Needle 'PA_MODE' `
  -Name 'PA_MODE esta documentado en .env.example'
Assert-Contains -Haystack $envExample -Needle 'VITE_API_URL' `
  -Name 'VITE_API_URL sigue siendo configurable'
# El instalador reescribe VITE_API_URL/VITE_WS_URL si cambia el puerto.
Assert-Contains -Haystack $installRaw -Needle "VITE_API_URL" `
  -Name 'el instalador ajusta VITE_API_URL al puerto real del backend'

# --- 9c. Comprobaciones de Docker antes de desplegar ----------------------
$detectRaw = Get-Content (Join-Path $RepoRoot 'installer\windows\scripts\detect.ps1') -Raw
foreach ($check in @('wsl', 'docker', 'compose_v2', 'engine_running')) {
  Assert-Contains -Haystack $detectRaw -Needle $check -Name "la deteccion comprueba '$check'"
}
Assert-Contains -Haystack $bootstrapRaw -Needle 'install-wsl.ps1' `
  -Name 'el bootstrap prepara WSL2 si falta'
Assert-Contains -Haystack $bootstrapRaw -Needle 'install-docker.ps1' `
  -Name 'el bootstrap instala o arranca Docker Desktop si falta'
Assert-Contains -Haystack $bootstrapRaw -Needle 'exit 10' `
  -Name 'un reinicio necesario se comunica con un codigo propio, no como fallo'

# --- 9d. Rutas con espacios ("Personal Assistant") ------------------------
Write-Host ''
Write-Host '=== Rutas con espacios ===' -ForegroundColor Cyan

# El directorio de instalacion se llama "Personal Assistant" y el de datos
# tambien. Start-Process NO entrecomilla los elementos del array que pasa a
# -ArgumentList, asi que un `-File`, $ruta sin comillas llega partido por el
# espacio y PowerShell aborta con "el archivo no tiene la extension '.ps1'".
# Esto rompio el despliegue en la primera instalacion real.
$spaceOffenders = @()
# Se excluye este mismo fichero: contiene "-File" dentro de las expresiones
# regulares de la comprobacion.
$scanned = Get-ChildItem (Join-Path $RepoRoot 'installer') -Recurse -Filter *.ps1 |
           Where-Object { $_.FullName -notlike '*\tests\*' }
foreach ($f in $scanned) {
  $n = 0
  foreach ($line in (Get-Content $f.FullName)) {
    $n++
    if ($line -notmatch "'-File'") { continue }
    # Aceptable: el valor siguiente empieza por una comilla escapada (`") o es
    # una cadena entrecomillada.
    if ($line -match "'-File'\s*,\s*[`"]``[`"]") { continue }
    if ($line -match "'-File'\s*,\s*\`$\w+\s*\)" -and $line -match '``"') { continue }
    $spaceOffenders += ("{0}:{1}" -f $f.Name, $n)
  }
}
Assert-True -Condition ($spaceOffenders.Count -eq 0) `
  -Name 'toda ruta pasada a -File va entrecomillada (soporta espacios)' `
  -Detail ($spaceOffenders -join '; ')

# Los accesos directos del .iss tambien: alli las comillas se duplican ("").
$issRaw2 = Get-Content (Join-Path $RepoRoot 'installer\windows\PersonalAssistant.iss') -Raw
Assert-True -Condition ($issRaw2 -notmatch '-File \{#ScriptsDir\}') `
  -Name 'los accesos directos entrecomillan la ruta del script'

# --- 9d-bis. El .env no puede faltar en silencio --------------------------
Write-Host ''
Write-Host '=== Credenciales obligatorias ===' -ForegroundColor Cyan

# Un `docker compose up` sin --env-file interpola cadenas vacias, solo avisa con
# un warning y levanta el stack ENTERO con las credenciales en blanco: n8n entra
# en bucle con "no PostgreSQL user name specified in startup packet" mientras
# postgres se declara healthy (ignora POSTGRES_* si el volumen ya existe). Pasó
# de verdad. Dos defensas: compose exige las variables, y nuestros scripts pasan
# siempre --env-file.
$composeReq = Get-Content (Join-Path $RepoRoot 'docker-compose.yml') -Raw
foreach ($v in @('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'N8N_ENCRYPTION_KEY')) {
  Assert-True -Condition ($composeReq -match ('\$\{' + $v + ':\?')) `
    -Name "compose exige $v y se niega a arrancar sin ella"
  # Ni una sola interpolacion suelta de esa variable: bastaria una para que el
  # servicio arrancase con el valor vacio.
  Assert-True -Condition ($composeReq -notmatch ('\$\{' + $v + '\}')) `
    -Name "no queda ninguna interpolacion de $v sin proteger"
}

$libEnv = Get-Content $LibPath -Raw
Assert-True -Condition ($libEnv -notmatch 'if \(Test-Path \$envFile\) \{ \$flags') `
  -Name 'Get-ApComposeArgs ya no omite --env-file cuando el fichero falta'
Assert-Contains -Haystack $libEnv -Needle "'--env-file'" `
  -Name 'Get-ApComposeArgs pasa siempre --env-file'
# %LOCALAPPDATA% no esta definido en todos los contextos (el Programador de
# tareas es uno). Sin respaldo, lib.ps1 lanzaba excepcion al calcular el
# directorio de datos ANTES de existir un log donde contarlo.
Assert-Contains -Haystack $libEnv -Needle "GetFolderPath('LocalApplicationData')" `
  -Name 'el directorio de datos se resuelve aunque falte %LOCALAPPDATA%'

# --- 9e. Comandos nativos que "fallan" siendo normal ----------------------
Write-Host ''
Write-Host '=== Comandos nativos y $ErrorActionPreference ===' -ForegroundColor Cyan

# lib.ps1 fija $ErrorActionPreference = 'Stop'. En Windows PowerShell 5.1, el
# stderr de un ejecutable nativo se convierte entonces en NativeCommandError y
# aborta el script. schtasks escribe en stderr cuando la tarea a borrar no
# existe, que es el caso NORMAL: esto tumbo primero la instalacion (al registrar
# el arranque automatico) y luego la desinstalacion (antes de parar nada).
$nativeOffenders = @()
foreach ($f in $scanned) {
  $n = 0
  foreach ($line in (Get-Content $f.FullName)) {
    $n++
    if ($line -notmatch 'schtasks\.exe') { continue }
    if ($line -match '\$env:ComSpec') { continue }   # envuelto en cmd: seguro
    if ($line.TrimStart().StartsWith('#')) { continue }
    $nativeOffenders += ("{0}:{1}" -f $f.Name, $n)
  }
}
Assert-True -Condition ($nativeOffenders.Count -eq 0) `
  -Name 'schtasks se invoca a traves de cmd (su stderr no aborta el script)' `
  -Detail ($nativeOffenders -join '; ')

# --- 9f. Desinstalacion ---------------------------------------------------
Write-Host ''
Write-Host '=== Desinstalacion ===' -ForegroundColor Cyan

$issUn = Get-Content (Join-Path $RepoRoot 'installer\windows\PersonalAssistant.iss') -Raw
# [UninstallRun] no llegaba a ejecutarse; la pregunta vive en [Code].
Assert-Contains -Haystack $issUn -Needle 'procedure CurUninstallStepChanged' `
  -Name 'la desinstalacion ejecuta su script desde [Code] (usUninstall)'
Assert-True -Condition ($issUn -notmatch '(?m)^\[UninstallRun\]') `
  -Name 'no se depende de [UninstallRun], que no se ejecutaba'
Assert-Contains -Haystack $issUn -Needle "Mode := '-Mode Ask'" `
  -Name 'una desinstalacion interactiva PREGUNTA que hacer con los datos'
Assert-Contains -Haystack $issUn -Needle "Mode := '-Mode KeepData -Silent'" `
  -Name 'una desinstalacion silenciosa CONSERVA los datos'

$unRaw = Get-Content (Join-Path $RepoRoot 'installer\windows\scripts\uninstall.ps1') -Raw
Assert-Contains -Haystack $unRaw -Needle 'MessageBoxButtons]::YesNoCancel' `
  -Name 'el dialogo ofrece conservar, borrar o cancelar'
Assert-Contains -Haystack $unRaw -Needle "if (`$Silent) { `$Mode = 'KeepData' }" `
  -Name 'sin interfaz disponible, el modo por defecto es conservar'
# PurgeData solo debe llegar por eleccion explicita, nunca por omision.
Assert-True -Condition ($unRaw -notmatch "(?m)^\s*\`$Mode\s*=\s*'PurgeData'\s*$") `
  -Name 'nunca se selecciona PurgeData por defecto'

# El instalador no debe generar credenciales nuevas sobre una BD que ya existe.
Assert-Contains -Haystack $installRaw -Needle 'personal-assistant_postgres_data' `
  -Name 'el instalador detecta una base de datos de una instalacion anterior'
Assert-Contains -Haystack $installRaw -Needle 'BLOCKED BY: ya existe una base de datos' `
  -Name 'y lo dice antes de construir imagenes durante 20 minutos'

# --- 10. Logs --------------------------------------------------------------
Write-Host ''
Write-Host '=== Logs ===' -ForegroundColor Cyan

$sandbox = New-TempDir
try {
  # Un componente = un fichero. Y ningun secreto llega al disco.
  $res = Invoke-InSandbox -LocalAppData $sandbox -Body @'
Write-ApLog -Component 'launcher' -Message 'hola desde el launcher' | Out-Null
Write-ApLog -Component 'installer' -Message 'hola desde el instalador' | Out-Null
Write-ApLog -Component 'launcher' -Message 'TELEGRAM_TOKEN_EMAIL=123456789:AAG_esto_es_un_token_de_prueba_largo' | Out-Null
$logs = Get-ApLogDir
$launcher = Get-Content (Join-Path $logs 'launcher.log') -Raw
$install  = Get-Content (Join-Path $logs 'install.log')  -Raw
$out = @()
$out += if ($launcher -match 'hola desde el launcher') { 'launcher-ok' } else { 'NO-launcher' }
$out += if ($install  -match 'hola desde el instalador') { 'install-ok' } else { 'NO-install' }
$out += if ($install -notmatch 'hola desde el launcher') { 'separados' } else { 'NO-separados' }
$out += if ($launcher -notmatch 'AAG_esto_es_un_token') { 'redactado' } else { 'NO-redactado' }
Write-Output ($out -join ',')
'@
  Assert-Equal -Expected 'launcher-ok,install-ok,separados,redactado' -Actual $res `
    -Name 'cada componente escribe en su propio log y los secretos se redactan'
} finally { Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue }

$libRaw = Get-Content $LibPath -Raw
Assert-Contains -Haystack $libRaw -Needle 'function Export-ApServiceLogs' `
  -Name 'existe el volcado de los logs de los contenedores a fichero'
foreach ($svc in @('backend.log', 'n8n.log', 'playwright.log')) {
  Assert-Contains -Haystack $libRaw -Needle $svc -Name "se vuelca $svc"
}
# Los logs de un contenedor pueden arrastrar una URL con token en un error.
Assert-Contains -Haystack $libRaw -Needle 'Protect-ApString $text' `
  -Name 'los logs de los contenedores se redactan antes de escribirlos'
Assert-Contains -Haystack $libRaw -Needle 'function Limit-ApLogSize' `
  -Name 'los logs rotan por tamano y no crecen sin limite'

$controlRaw = Get-Content (Join-Path $RepoRoot 'installer\windows\scripts\control.ps1') -Raw
Assert-Contains -Haystack $controlRaw -Needle 'Export-ApServiceLogs' `
  -Name 'control.ps1 logs vuelca los logs de los servicios'
Assert-Contains -Haystack $controlRaw -Needle '$NoOpen' `
  -Name 'control.ps1 logs puede refrescar sin abrir el explorador'

# --- 11. Launcher de escritorio -------------------------------------------
Write-Host ''
Write-Host '=== Launcher ===' -ForegroundColor Cyan

$launcherPath = Join-Path $RepoRoot 'installer\windows\scripts\launcher.ps1'
Assert-True -Condition (Test-Path $launcherPath) -Name 'existe el launcher'
if (Test-Path $launcherPath) {
  $lr = Get-Content $launcherPath -Raw
  # El requisito es reutilizar la monitorizacion que ya existe, no reescribirla:
  # el estado sale de services_probe a traves de la API del backend.
  Assert-Contains -Haystack $lr -Needle '/api/system/status' `
    -Name 'el launcher lee el estado de services_probe (/api/system/status)'
  Assert-Contains -Haystack $lr -Needle '/api/health' `
    -Name 'el launcher usa el health check del backend'
  Assert-Contains -Haystack $lr -Needle 'control.ps1' `
    -Name 'las acciones del launcher delegan en control.ps1'
  # Sondas propias duplicadas = la ventana y el panel podrian discrepar.
  Assert-True -Condition ($lr -notmatch 'pg_isready|psql -|Invoke-ApPsql') `
    -Name 'el launcher no reimplementa las sondas de servicio'
  # Un secreto no puede acabar en el log ni en un control de la interfaz.
  Assert-True -Condition ($lr -notmatch '(?m)Write-ApLog.*\$Values\[') `
    -Name 'el launcher nunca registra el valor de una credencial'
  Assert-Contains -Haystack $lr -Needle 'UseSystemPasswordChar' `
    -Name 'los tokens se escriben enmascarados'
  # WinForms de .NET Framework (Windows PowerShell 5.1) no tiene PlaceholderText:
  # se busca el USO de la propiedad, no la palabra en un comentario.
  Assert-True -Condition ($lr -notmatch '\.PlaceholderText\s*=') `
    -Name 'no se usan propiedades de WinForms que no existen en PowerShell 5.1'
}

$trayPath = Join-Path $RepoRoot 'installer\windows\scripts\tray.ps1'
if (Test-Path $trayPath) {
  $tr = Get-Content $trayPath -Raw
  Assert-Contains -Haystack $tr -Needle 'Abrir Personal Assistant' `
    -Name 'la bandeja ofrece abrir Personal Assistant'
  Assert-Contains -Haystack $tr -Needle 'launcher.ps1' `
    -Name 'la bandeja abre el launcher, no solo el navegador'
  foreach ($item in @('Abrir el panel web', 'Estado', 'Reiniciar', 'Detener', 'Salir')) {
    Assert-Contains -Haystack $tr -Needle $item -Name "la bandeja tiene la entrada '$item'"
  }
  Assert-Contains -Haystack $tr -Needle 'add_MouseDoubleClick' `
    -Name 'el doble clic en la bandeja hace algo'
  # Ninguna entrada de la bandeja debe dejar una consola abierta salvo las que
  # el usuario pide explicitamente (backup, que es interactivo).
  Assert-True -Condition (([regex]::Matches($tr, '-NoExit')).Count -le 1) `
    -Name 'la bandeja no abre consolas salvo la copia de seguridad'
}

$vbsPath = Join-Path $RepoRoot 'installer\windows\scripts\hidden.vbs'
Assert-True -Condition (Test-Path $vbsPath) -Name 'existe el shim que evita el parpadeo de consola'

$issIcons = Get-Content (Join-Path $RepoRoot 'installer\windows\PersonalAssistant.iss') -Raw
Assert-Contains -Haystack $issIcons -Needle 'hidden.vbs"" ""{#ScriptsDir}\launcher.ps1' `
  -Name 'el acceso directo principal abre el launcher sin consola'
Assert-Contains -Haystack $issIcons -Needle 'scripts\*.vbs' `
  -Name 'el instalador empaqueta el shim .vbs'

# --- 12. Identidad del producto -------------------------------------------
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
