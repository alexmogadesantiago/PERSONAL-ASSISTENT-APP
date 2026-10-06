<#
  lib.ps1 - utilidades compartidas del instalador (Windows).
  Detección de plataforma, logging sin secretos, estado reanudable,
  gestión de puertos y health checks.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Rutas ------------------------------------------------------------------
#
#   CODIGO  ->  el directorio de instalacion (Program Files\Personal Assistant).
#               Solo lectura para el usuario: NUNCA se escribe nada ahi.
#   DATOS   ->  %LOCALAPPDATA%\Personal Assistant. Todo lo que cambia.
#
#       %LOCALAPPDATA%\Personal Assistant\
#         .env          secretos y puertos (fuera de config\ a proposito: config\
#                       se monta dentro de n8n, que ejecuta codigo de usuario)
#         config\       modules.json + user_profile.json  -> montado en n8n y profile
#         data\         estado del instalador; ver data\README.txt
#         output\       borradores generados por los workflows
#         logs\         install.log, launcher.log, backend.log, n8n.log...
#         backups\      copias de seguridad con marca de tiempo
#
# La base de datos de Postgres y el volumen de n8n NO viven aqui: son volumenes
# con nombre de Docker (postgres_data, n8n_data). Postgres sobre un bind mount
# de Windows es un problema conocido de permisos y fsync, y un volumen con
# nombre sobrevive igual a desinstalar, actualizar y reiniciar. backups\ es la
# via para sacarlos a disco.
# %LOCALAPPDATA% NO siempre esta definido. El Programador de tareas arranca la
# tarea de inicio de sesion con un bloque de entorno que puede no traerla, y
# entonces `Join-Path $env:LOCALAPPDATA ...` lanza excepcion (StrictMode +
# ErrorActionPreference = 'Stop') ANTES de que exista un log donde contarlo: la
# tarea moria con codigo 1 y cero diagnostico, el stack no arrancaba por la via
# buena, y cualquier otro `docker compose up` lo levantaba sin credenciales.
# GetFolderPath lo resuelve del perfil del usuario, sin depender del entorno.
function Get-ApLocalAppData {
  if ($env:LOCALAPPDATA) { return $env:LOCALAPPDATA }
  $fromApi = [Environment]::GetFolderPath('LocalApplicationData')
  if ($fromApi) { return $fromApi }
  if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE 'AppData\Local') }
  throw 'No se pudo determinar %LOCALAPPDATA%: no hay donde guardar los datos.'
}
$script:AP_LOCAL_APPDATA = Get-ApLocalAppData

$script:AP_DATA_HOME = if ($env:PERSONAL_ASSISTANT_DATA) { $env:PERSONAL_ASSISTANT_DATA }
                       elseif ($env:AUTOMATION_PLATFORM_HOME) { $env:AUTOMATION_PLATFORM_HOME }  # compat 0.4.x
                       else { Join-Path $script:AP_LOCAL_APPDATA 'Personal Assistant' }
# Nombre historico del directorio de datos (v0.4.x). Se migra al nuevo si existe.
$script:AP_LEGACY_HOME = Join-Path $script:AP_LOCAL_APPDATA 'AutomationPlatform'

$script:AP_HOME    = $script:AP_DATA_HOME     # alias historico, mismo directorio
$script:AP_CONFIG  = Join-Path $script:AP_DATA_HOME 'config'
$script:AP_DATA    = Join-Path $script:AP_DATA_HOME 'data'
$script:AP_OUTPUT  = Join-Path $script:AP_DATA_HOME 'output'
$script:AP_LOGS    = Join-Path $script:AP_DATA_HOME 'logs'
$script:AP_BACKUPS = Join-Path $script:AP_DATA_HOME 'backups'
$script:AP_ENV     = Join-Path $script:AP_DATA_HOME '.env'
$script:AP_STATE   = Join-Path $script:AP_DATA 'state.json'
$script:AP_LOG     = Join-Path $script:AP_LOGS 'install.log'

function Get-ApDataHome { $script:AP_DATA_HOME }
function Get-ApConfigDir { $script:AP_CONFIG }
function Get-ApOutputDir { $script:AP_OUTPUT }

# Ruta tal y como la quiere Docker Desktop en un bind mount: barras normales.
# "C:\Users\a\AppData\Local\Personal Assistant\config"
#   -> "C:/Users/a/AppData/Local/Personal Assistant/config"
# El espacio no es problema en la sintaxis larga de compose (source:), que no
# parte por ':'; la barra invertida si lo seria dentro de un .env.
function ConvertTo-ApDockerPath([string]$Path) { $Path -replace '\\', '/' }
function Get-ApEnvPath  { $script:AP_ENV }
function Get-ApLogDir   { $script:AP_LOGS }
function Get-ApBackupDir{ $script:AP_BACKUPS }

# Pasos de instalación, en orden. El estado guarda el último completado.
$script:AP_STEPS = @(
  'detecting', 'dependencies', 'directories', 'configuring',
  'ports', 'database', 'building', 'starting-services', 'importing-workflows',
  'health-check', 'ready'
)

# Contenedores del stack completo (Fase 1 + Personal Assistant).
$script:AP_CONTAINERS = @('pa-postgres','pa-n8n','pa-playwright','pa-profile','pa-backend','pa-frontend')

# IDs de los workflows del producto que deben existir siempre (no se duplican:
# import upsert por id). pa00errorhandler es el Error workflow de los otros
# cuatro (settings.errorWorkflow): sin el, un fallo no avisa a nadie.
$script:AP_WORKFLOW_IDS = @('pa00errorhandler','0ikHqQCWMke67aoI','pa01email000001','pa02laboral00001','pa04marcapersonal')

function Initialize-ApHome {
  # Barato e idempotente: lo llama Write-ApLog en cada linea.
  if (Test-Path $script:AP_LOGS) { return }

  $migrate = (-not (Test-Path $script:AP_DATA_HOME)) -and (Test-Path $script:AP_LEGACY_HOME) -and
             ($script:AP_DATA_HOME -ne $script:AP_LEGACY_HOME)
  $migrationLeftover = $false
  if ($migrate) {
    # v0.4.x guardaba estado, log y backups en %LOCALAPPDATA%\AutomationPlatform.
    # Se traslada entero para no perder las copias de seguridad del usuario.
    $moved = $false
    try {
      Move-Item $script:AP_LEGACY_HOME $script:AP_DATA_HOME -Force -ErrorAction Stop
      $moved = $true
    } catch {
      # Un Move-Item puede fallar a medias: los ficheros que escribio un
      # contenedor (los .tgz de los backups) a veces no se dejan mover. Se
      # copia lo que quede y solo se borra el origen si el destino tiene al
      # menos tantos ficheros: nunca se destruye lo unico que hay.
      New-Item -ItemType Directory -Force -Path $script:AP_DATA_HOME | Out-Null
      Copy-Item (Join-Path $script:AP_LEGACY_HOME '*') $script:AP_DATA_HOME -Recurse -Force -ErrorAction SilentlyContinue
      $src = @(Get-ChildItem $script:AP_LEGACY_HOME -Recurse -File -Force -ErrorAction SilentlyContinue).Count
      $dst = @(Get-ChildItem $script:AP_DATA_HOME  -Recurse -File -Force -ErrorAction SilentlyContinue).Count
      if ($dst -ge $src) {
        Remove-Item $script:AP_LEGACY_HOME -Recurse -Force -ErrorAction SilentlyContinue
      }
      $moved = ($dst -ge $src)
    }
    if (-not $moved -or (Test-Path $script:AP_LEGACY_HOME)) { $migrationLeftover = $true }
  }

  foreach ($d in @($script:AP_DATA_HOME, $script:AP_CONFIG, $script:AP_DATA, $script:AP_OUTPUT,
                   $script:AP_LOGS, $script:AP_BACKUPS, (Join-Path $script:AP_OUTPUT 'marca-personal'))) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  }

  # Colocacion del layout antiguo dentro del nuevo (state.json y install.log
  # estaban en la raiz del home; ahora viven en data\ y logs\).
  foreach ($mv in @(
      @{ from = (Join-Path $script:AP_DATA_HOME 'state.json');  to = $script:AP_STATE }
      @{ from = (Join-Path $script:AP_DATA_HOME 'install.log'); to = $script:AP_LOG })) {
    if ((Test-Path $mv.from) -and -not (Test-Path $mv.to)) {
      Move-Item $mv.from $mv.to -Force -ErrorAction SilentlyContinue
    }
  }

  # Si algo del directorio antiguo se resistio, se deja constancia en el log en
  # vez de borrarlo a la brava. Se escribe directo al fichero: Write-ApLog
  # llama a esta misma funcion.
  if ($migrationLeftover) {
    Add-Content -Path $script:AP_LOG -Encoding utf8 -Value (
      ('{0} [WARN ] installer    Quedan ficheros en el directorio de datos antiguo ' +
       '({1}). Ya estan copiados en el nuevo; puedes borrar el antiguo a mano.') -f
      (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $script:AP_LEGACY_HOME)
  }

  $readme = Join-Path $script:AP_DATA 'README.txt'
  if (-not (Test-Path $readme)) {
    @(
      'Personal Assistant - datos de la aplicacion'
      ''
      'Este directorio y sus hermanos (config, output, logs, backups) contienen'
      'TUS datos. Se conservan al actualizar y solo se borran si lo pides'
      'explicitamente al desinstalar.'
      ''
      'La base de datos de PostgreSQL y el volumen de n8n (credenciales'
      'cifradas, ejecuciones) NO estan aqui: son volumenes con nombre de Docker,'
      'llamados personal-assistant_postgres_data y personal-assistant_n8n_data.'
      'Postgres sobre un directorio de Windows da problemas de permisos y de'
      'fsync; un volumen con nombre es mas rapido y sobrevive igual a las'
      'actualizaciones. Para tener esos datos como ficheros, usa la copia de'
      'seguridad: crea un backup y lo encontraras en ..\backups\.'
    ) -join "`r`n" | Set-Content $readme -Encoding utf8
  }
}

# Copia las plantillas del directorio de instalacion al de datos, sin pisar lo
# que el usuario ya tenga. Idempotente.
function Initialize-ApUserConfig {
  param([Parameter(Mandatory)][string] $AppRoot)
  Initialize-ApHome
  $src = Join-Path $AppRoot 'config'
  # modules.json es catalogo (lo actualiza cada version); user_profile.json es
  # del usuario (solo se siembra la primera vez).
  $modules = Join-Path $src 'modules.json'
  if (Test-Path $modules) { Copy-Item $modules (Join-Path $script:AP_CONFIG 'modules.json') -Force }
  $profileDst = Join-Path $script:AP_CONFIG 'user_profile.json'
  if (-not (Test-Path $profileDst)) {
    # Orden a proposito: primero el perfil REAL que la instalacion anterior
    # dejo junto al codigo (config\user_profile.json, que antes era el que se
    # montaba en n8n) y solo si no existe, la plantilla. Sembrar del ejemplo
    # teniendo uno real habria borrado en silencio las preferencias del usuario
    # al actualizar.
    $previous = Join-Path $src 'user_profile.json'
    $example  = Join-Path $src 'user_profile.example.json'
    if (Test-Path $previous)     { Copy-Item $previous $profileDst -Force }
    elseif (Test-Path $example)  { Copy-Item $example  $profileDst -Force }
  }

  # Lo mismo con los borradores que generaron los workflows: en el layout
  # anterior vivian en <codigo>\output y n8n los escribia ahi. Si el directorio
  # de datos aun no tiene ninguno, se traen; si ya hay, no se toca nada.
  $srcOut = Join-Path $AppRoot 'output'
  if (Test-Path $srcOut) {
    $already = @(Get-ChildItem $script:AP_OUTPUT -Recurse -File -ErrorAction SilentlyContinue).Count
    if ($already -eq 0) {
      Copy-Item (Join-Path $srcOut '*') $script:AP_OUTPUT -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

# --- Logging (nunca imprime secretos) -------------------------------------
$script:AP_SECRET_KEYS = @('PASSWORD','API_KEY','TOKEN','SECRET','ENCRYPTION_KEY','KEY')

function Protect-ApString([string]$Text) {
  if (-not $Text) { return $Text }
  # oculta valores tipo CLAVE=xxxx y los formatos de token conocidos
  $t = $Text
  $t = [regex]::Replace($t, '(?i)([A-Z0-9_]*(PASSWORD|API_KEY|TOKEN|SECRET|ENCRYPTION_KEY)[A-Z0-9_]*\s*[=:]\s*)\S+', '${1}***')
  $t = [regex]::Replace($t, '\b\d{8,10}:AA[\w-]{20,}\b', '***telegram-token***')
  $t = [regex]::Replace($t, '\bAQ\.[A-Za-z0-9_\-]{10,}\b', '***gemini-key***')
  $t = [regex]::Replace($t, '\bAIza[A-Za-z0-9_\-]{20,}\b', '***gemini-key***')
  $t = [regex]::Replace($t, '\bnvapi-[A-Za-z0-9_\-]{20,}\b', '***nvidia-nim-key***')
  $t = [regex]::Replace($t, '\bsk-or-[A-Za-z0-9_\-]{20,}\b', '***openrouter-key***')
  $t = [regex]::Replace($t, '\bacs_[A-Za-z0-9_\-]{20,}\b', '***service-token***')
  return $t
}

# Un fichero por componente dentro de logs\: install.log, launcher.log,
# backend.log, n8n.log, playwright.log... Asi "ver los logs" es abrir una
# carpeta, y un problema del launcher no se pierde entre 3.000 lineas de
# instalacion.
function Get-ApLogFile([string]$Component) {
  $safe = ("$Component" -replace '[^A-Za-z0-9_.-]', '-')
  if (-not $safe -or $safe -eq 'installer') { return $script:AP_LOG }
  return (Join-Path $script:AP_LOGS "$safe.log")
}

# Rotacion simple por tamano: el log de un servicio que falla en bucle puede
# crecer sin limite, y estos ficheros viven en el perfil del usuario.
$script:AP_LOG_MAX_BYTES = 5MB
function Limit-ApLogSize([string]$Path) {
  try {
    if ((Test-Path $Path) -and ((Get-Item $Path).Length -gt $script:AP_LOG_MAX_BYTES)) {
      $old = "$Path.1"
      if (Test-Path $old) { Remove-Item $old -Force -ErrorAction SilentlyContinue }
      Move-Item $Path $old -Force -ErrorAction SilentlyContinue
    }
  } catch { }
}

function Write-ApLog {
  param([string]$Message, [ValidateSet('INFO','WARN','ERROR','STEP','OK')] [string]$Level = 'INFO', [string]$Component = 'installer')
  Initialize-ApHome
  $safe = Protect-ApString $Message
  $line = ('{0} [{1,-5}] {2,-12} {3}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $Level, $Component, $safe)
  $file = Get-ApLogFile $Component
  Limit-ApLogSize $file
  Add-Content -Path $file -Value $line -Encoding utf8
  $color = @{ INFO='Gray'; WARN='Yellow'; ERROR='Red'; STEP='Cyan'; OK='Green' }[$Level]
  Write-Host $line -ForegroundColor $color
}

function Write-ApStep([string]$Message) { Write-ApLog -Level STEP -Message "==> $Message" }
function Write-ApOk([string]$Message)   { Write-ApLog -Level OK   -Message "   $Message" }
function Write-ApWarn([string]$Message) { Write-ApLog -Level WARN -Message "   $Message" }

# --- Estado reanudable ----------------------------------------------------
function Get-ApState {
  if (Test-Path $script:AP_STATE) {
    try { return Get-Content $script:AP_STATE -Raw | ConvertFrom-Json } catch { }
  }
  return [pscustomobject]@{ step = ''; version = ''; startedAt = ''; updatedAt = '' }
}

function Set-ApState([string]$Step) {
  Initialize-ApHome
  $s = Get-ApState
  if (-not $s.startedAt) { $s | Add-Member -NotePropertyName startedAt -NotePropertyValue (Get-Date -Format o) -Force }
  $s.step = $Step
  $s | Add-Member -NotePropertyName updatedAt -NotePropertyValue (Get-Date -Format o) -Force
  $s | ConvertTo-Json | Set-Content -Path $script:AP_STATE -Encoding utf8
}

function Test-ApStepDone([string]$Step, [string]$Current) {
  # true si $Step ya se completó (índice menor o igual al último completado)
  $done = $script:AP_STEPS.IndexOf($Current)
  $this = $script:AP_STEPS.IndexOf($Step)
  return ($done -ge 0 -and $this -ge 0 -and $this -le $done)
}

# --- Detección de plataforma -------------------------------------------
function Get-ApPlatform {
  $archRaw = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLower()
  $arch = switch ($archRaw) {
    'x64'   { 'x64' }
    'arm64' { 'arm64' }
    default { $archRaw }
  }
  $ram  = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
  $disk = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
  $isAdmin = (New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
  $net = $false
  try { $net = (Test-Connection -ComputerName '1.1.1.1' -Count 1 -Quiet -ErrorAction SilentlyContinue) } catch { }
  [pscustomobject]@{
    os           = 'windows'
    osVersion    = [Environment]::OSVersion.Version.ToString()
    arch         = $arch
    supported    = ($arch -in @('x64','arm64'))
    ramGB        = $ram
    diskFreeGB   = $disk
    admin        = $isAdmin
    online       = $net
    hostname     = $env:COMPUTERNAME
  }
}

# --- Ejecución de comandos nativos (Docker) --------------------------
# En PowerShell 5.1, `nativo 2>&1 |` envuelve stderr en ErrorRecords y rompe
# con $ErrorActionPreference='Stop'. Fusionamos los flujos a nivel de cmd.exe.
function Invoke-ApNative {
  param([Parameter(Mandatory)] [string] $CommandLine, [string] $Cwd)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($Cwd) { Push-Location $Cwd }
    & $env:ComSpec /c "$CommandLine 2>&1" | ForEach-Object { if ("$_".Trim()) { Write-ApLog "   $_" } }
    return $LASTEXITCODE
  } finally {
    if ($Cwd) { Pop-Location }
    $ErrorActionPreference = $prev
  }
}

# --- Docker -------------------------------------------------------------
function Find-DockerExe {
  $cmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
      (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
      (Join-Path $env:ProgramFiles  'Docker\Docker\resources\bin\docker.exe'))) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Get-DockerInfo {
  $exe = Find-DockerExe
  $res = [pscustomobject]@{ found = [bool]$exe; path = $exe; running = $false; serverVersion = ''; composeVersion = '' }
  if (-not $exe) { return $res }
  $dir = Split-Path $exe
  if ($env:Path -notlike "*$dir*") { $env:Path = "$dir;$env:Path" }
  try {
    $v = & $exe info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $v) { $res.running = $true; $res.serverVersion = "$v".Trim() }
  } catch { }
  try {
    $cv = & $exe compose version --short 2>$null
    if ($LASTEXITCODE -eq 0 -and $cv) { $res.composeVersion = "$cv".Trim() }
  } catch { }
  return $res
}

function Start-DockerDesktop {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
    (Join-Path $env:ProgramFiles  'Docker\Docker\Docker Desktop.exe'))
  $dd = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $dd) { return $false }
  Write-ApWarn 'El motor de Docker no responde. Abriendo Docker Desktop...'
  Start-Process $dd
  for ($i = 0; $i -lt 48; $i++) {
    Start-Sleep 5
    $info = Get-DockerInfo
    if ($info.running) { return $true }
    Write-ApLog "   ...esperando al motor de Docker ($($i*5)s)"
  }
  return $false
}

# --- Docker Compose: argumentos comunes -------------------------------
# El codigo vive en Program Files y los datos en %LOCALAPPDATA%, asi que
# `docker compose` ya no puede limitarse a heredar el directorio actual:
#
#   -f                  el compose que se instalo con la aplicacion
#   --env-file          el .env del usuario, que esta en otro sitio
#   --project-directory el ancla de las rutas relativas del compose
#                       (./workflows, ./scripts/db-init: ambos de solo lectura)
#
# El nombre del proyecto lo fija `name:` dentro del propio compose, asi que los
# contenedores y volumenes se llaman igual se invoque desde donde se invoque.
function Get-ApComposeArgs {
  param([Parameter(Mandatory)][string] $AppRoot)
  $compose = Join-Path $AppRoot 'docker-compose.yml'

  # --env-file va SIEMPRE. Antes se omitia si el fichero no existia, y eso es
  # justo lo que no se puede hacer: sin el, compose interpola cadenas vacias,
  # solo avisa con un warning y levanta el stack con TODAS las credenciales en
  # blanco (n8n arranca en bucle con "no PostgreSQL user name specified").
  # Pasandolo siempre, un .env que falte es un error inmediato y legible.
  #
  # En un clon del repositorio el .env vive junto al docker-compose; se usa ese
  # si el del directorio de datos todavia no existe.
  $envFile = $script:AP_ENV
  if (-not (Test-Path $envFile)) {
    $repoEnv = Join-Path $AppRoot '.env'
    if (Test-Path $repoEnv) { $envFile = $repoEnv }
  }

  # `$args` es una variable automatica de PowerShell: usamos otro nombre.
  $flags = @('-f', ('"' + $compose + '"'), '--project-directory', ('"' + $AppRoot + '"'),
             '--env-file', ('"' + $envFile + '"'))
  return ('compose ' + ($flags -join ' '))
}

# --- Logs de los servicios --------------------------------------------
# Docker guarda los logs de cada contenedor en su propio almacen, dentro de la
# maquina de WSL2: sin `docker logs` no hay forma de leerlos, y pedirle eso al
# usuario es justo lo que queremos evitar. Esto los vuelca a
# %LOCALAPPDATA%\Personal Assistant\logs\<servicio>.log, que es una carpeta que
# se abre con doble clic.
#
# Se pasan por Protect-ApString: los logs de un servicio pueden arrastrar una
# URL con token o una variable de entorno en un volcado de error.
$script:AP_LOG_SERVICES = @(
  @{ service = 'backend';    file = 'backend.log' }
  @{ service = 'n8n';        file = 'n8n.log' }
  @{ service = 'playwright'; file = 'playwright.log' }
  @{ service = 'postgres';   file = 'postgres.log' }
  @{ service = 'frontend';   file = 'frontend.log' }
  @{ service = 'profile';    file = 'profile.log' }
)

function Export-ApServiceLogs {
  param(
    [Parameter(Mandatory)][string] $DockerExe,
    [Parameter(Mandatory)][string] $AppRoot,
    [int] $Tail = 2000
  )
  Initialize-ApHome
  $dq = '"' + $DockerExe + '"'
  $dc = Get-ApComposeArgs $AppRoot
  $written = @()
  foreach ($svc in $script:AP_LOG_SERVICES) {
    $out = Join-Path $script:AP_LOGS $svc.file
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
      Push-Location $AppRoot
      $raw = & $env:ComSpec /c "$dq $dc logs --no-color --tail $Tail $($svc.service) 2>&1"
    } finally { Pop-Location; $ErrorActionPreference = $prev }

    $text = ($raw | Out-String)
    if (-not $text.Trim()) { continue }
    $header = "# $($svc.service) - volcado $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') - ultimas $Tail lineas"
    Set-Content -Path $out -Value ($header + "`r`n" + (Protect-ApString $text)) -Encoding utf8
    $written += $svc.file
  }
  return $written
}

# --- Puertos ----------------------------------------------------------
function Test-PortFree([int]$Port) {
  try {
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $l.Start(); $l.Stop(); return $true
  } catch { return $false }
}

function Get-FreePort([int]$Preferred, [int]$RangeStart = 0, [int]$RangeEnd = 0) {
  if (Test-PortFree $Preferred) { return $Preferred }
  if ($RangeStart -eq 0) { $RangeStart = $Preferred + 1 }
  if ($RangeEnd   -eq 0) { $RangeEnd   = $Preferred + 50 }
  for ($p = $RangeStart; $p -le $RangeEnd; $p++) {
    if (Test-PortFree $p) { return $p }
  }
  throw "No se encontró un puerto libre cerca de $Preferred"
}

# --- Estado de contenedores (sin NativeCommandError si no existe) ------
function Get-ApContainerState([string]$DockerExe, [string]$Name) {
  $q = '"' + $DockerExe + '" inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" ' + $Name + ' 2>nul'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $env:ComSpec /c $q } finally { $ErrorActionPreference = $prev }
  return ("$out".Trim())
}
function Test-ApContainerRunning([string]$DockerExe, [string]$Name) {
  (Get-ApContainerState $DockerExe $Name) -in @('running','healthy')
}

# --- Health checks reales -------------------------------------------
function Test-HttpHealthy([string]$Url, [int]$TimeoutSec = 5) {
  try {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
  } catch { return $false }
}

function Wait-ContainerHealthy([string]$DockerExe, [string]$Name, [int]$TimeoutSec = 180) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ((Get-ApContainerState $DockerExe $Name) -in @('healthy','running')) { return $true }
    Start-Sleep 4
  }
  return $false
}

function Invoke-ApHealthChecks {
  param(
    [string]$DockerExe, [int]$N8nPort = 5678, [int]$ProfilePort = 7777,
    [int]$BackendPort = 8080, [int]$FrontendPort = 3000, [string]$Cwd
  )
  $results = [ordered]@{}
  foreach ($c in $script:AP_CONTAINERS) {
    $results["container:$c"] = ((Get-ApContainerState $DockerExe $c) -in @('healthy','running'))
  }
  $results['http:n8n']      = Test-HttpHealthy "http://localhost:$N8nPort/healthz"
  $results['http:profile']  = Test-HttpHealthy "http://localhost:$ProfilePort/health"
  $results['http:backend']  = Test-HttpHealthy "http://localhost:$BackendPort/api/health"
  $results['http:frontend'] = Test-HttpHealthy "http://localhost:$FrontendPort/"
  # Por id y no por total: el producto lleva 5 workflows (4 asistentes + el gestor
  # de errores) y el usuario puede tener los suyos.
  $missing = Get-ApMissingWorkflowIds -DockerExe $DockerExe -Cwd $Cwd
  $results['n8n:product workflows present'] = ($null -ne $missing -and @($missing).Count -eq 0)
  return $results
}

# --- Postgres: consultas puntuales sin romper por NativeCommandError ------
function Read-ApEnvMap([string]$Cwd) {
  # Orden de busqueda: el .env del directorio de DATOS (instalacion real) y,
  # solo si no existe, el de la raiz del repositorio (desarrollo). El
  # directorio de instalacion nunca contiene un .env: no se escribe ahi.
  $m = @{}
  $envPath = $script:AP_ENV
  if (-not (Test-Path $envPath)) { $envPath = Join-Path $Cwd '.env' }
  if (-not (Test-Path $envPath)) { $envPath = Join-Path (Split-Path -Parent $Cwd) '.env' }
  if (Test-Path $envPath) {
    foreach ($l in Get-Content $envPath) {
      if ($l -match '^\s*#') { continue }
      if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $m[$Matches[1]] = $Matches[2] }
    }
  }
  return $m
}

function Invoke-ApPsql {
  param([string]$DockerExe, [string]$Cwd, [string]$Database = 'postgres', [Parameter(Mandatory)][string]$Sql)
  $envMap = Read-ApEnvMap $Cwd
  $user = if ($envMap.ContainsKey('POSTGRES_USER') -and $envMap['POSTGRES_USER']) { $envMap['POSTGRES_USER'] } else { 'assistant' }
  $pw   = if ($envMap.ContainsKey('POSTGRES_PASSWORD')) { $envMap['POSTGRES_PASSWORD'] } else { '' }
  $esc  = $Sql.Replace('"','\"')
  $q = '"' + $DockerExe + '" ' + (Get-ApComposeArgs $Cwd) + ' exec -T -e PGPASSWORD=' + $pw +
       ' postgres psql -v ON_ERROR_STOP=1 -U ' + $user + ' -d ' + $Database + ' -tAc "' + $esc + '"'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    if ($Cwd) { Push-Location $Cwd }
    # stdout y stderr por separado: las advertencias de compose ("variable not
    # set") van a stderr y no deben contaminar el valor devuelto por psql.
    $out = & $env:ComSpec /c "$q 2>NUL"
  } finally { if ($Cwd) { Pop-Location }; $ErrorActionPreference = $prev }
  # Nos quedamos con la última línea no vacía (el valor real de psql -tA).
  $lines = @("$out" -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
  return @{ code = $LASTEXITCODE; out = ($(if ($lines.Count) { $lines[-1] } else { '' })); raw = ("$out".Trim()) }
}

function Confirm-AcDatabase {
  # Crea la BD automation_center si no existe. NUNCA hace DROP. Idempotente.
  param([string]$DockerExe, [string]$Cwd)
  $chk = Invoke-ApPsql -DockerExe $DockerExe -Cwd $Cwd -Database 'postgres' `
    -Sql "SELECT 1 FROM pg_database WHERE datname='automation_center'"
  if ($chk.code -ne 0) { throw "No se pudo consultar Postgres: $($chk.raw)" }
  if ($chk.out -eq '1') { return $false }  # ya existía
  $crt = Invoke-ApPsql -DockerExe $DockerExe -Cwd $Cwd -Database 'postgres' `
    -Sql 'CREATE DATABASE automation_center'
  if ($crt.code -ne 0) { throw "No se pudo crear automation_center: $($crt.raw)" }
  return $true
}

function Get-N8nWorkflowCount {
  param([string]$DockerExe, [string]$Cwd)
  $envMap = Read-ApEnvMap $Cwd
  $db = if ($envMap.ContainsKey('POSTGRES_DB') -and $envMap['POSTGRES_DB']) { $envMap['POSTGRES_DB'] } else { 'assistant' }
  $r = Invoke-ApPsql -DockerExe $DockerExe -Cwd $Cwd -Database $db -Sql 'SELECT count(*) FROM workflow_entity'
  if ($r.code -ne 0 -or $r.out -notmatch '^\d+$') { return -1 }
  [int]$r.out
}

# Workflows del producto que faltan en n8n. Se comprueba por id y no por el
# total de workflow_entity: el usuario puede tener workflows propios y eso no
# es un fallo de la instalacion. $null = no se pudo consultar la BD.
function Get-ApMissingWorkflowIds {
  param([string]$DockerExe, [string]$Cwd)
  $envMap = Read-ApEnvMap $Cwd
  $db = if ($envMap.ContainsKey('POSTGRES_DB') -and $envMap['POSTGRES_DB']) { $envMap['POSTGRES_DB'] } else { 'assistant' }
  $ids = ($script:AP_WORKFLOW_IDS | ForEach-Object { "'$_'" }) -join ','
  $r = Invoke-ApPsql -DockerExe $DockerExe -Cwd $Cwd -Database $db -Sql "SELECT coalesce(string_agg(id, ','), '') FROM workflow_entity WHERE id IN ($ids)"
  if ($r.code -ne 0) { return $null }
  $present = @("$($r.out)" -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  return @($script:AP_WORKFLOW_IDS | Where-Object { $present -notcontains $_ })
}

# --- Generación de secretos ------------------------------------------
# CSPRNG. `Get-Random` (System.Random, time-seeded) NO sirve para secretos.
function New-ApRandomSecret([int]$Len = 48) {
  $alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'  # 62
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $out = New-Object char[] $Len
  $buf = New-Object byte[] 1
  for ($i = 0; $i -lt $Len; $i++) {
    do { $rng.GetBytes($buf) } while ($buf[0] -ge 248)  # 248 = 4*62: descarta el sesgo de módulo
    $out[$i] = $alphabet[$buf[0] % 62]
  }
  -join $out
}

function New-ApFernetKey {
  # 32 bytes aleatorios en base64 url-safe (formato de clave Fernet, 44 chars).
  $b = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  [Convert]::ToBase64String($b).Replace('+','-').Replace('/','_')
}
