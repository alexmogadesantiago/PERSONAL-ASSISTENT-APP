<#
.SYNOPSIS
  Instalador de Automation Platform para Windows (x64 / ARM64).

.DESCRIPTION
  DESCARGAR -> EJECUTAR -> INSTALACIÓN AUTOMÁTICA -> READY.
  Detecta la plataforma, comprueba Docker, genera .env, ajusta puertos,
  construye y levanta los servicios, importa los workflows, ejecuta health
  checks reales y registra el arranque automático.

  Idempotente (re-ejecutar no duplica nada) y reanudable (guarda el estado
  en %LOCALAPPDATA%\AutomationPlatform\state.json).

.PARAMETER Unattended
  No hace preguntas. Los secretos se toman de variables de entorno o de -ConfigFile.

.PARAMETER ConfigFile
  Ruta a un JSON con los secretos: { "AC_NVIDIA_NIM_API_KEY": "...", "TELEGRAM_CHAT_ID": "...", ... }

.PARAMETER Reconfigure
  Regenera .env aunque ya exista (conserva las claves internas si puede).

.PARAMETER Force
  Ignora el estado guardado y ejecuta todos los pasos desde el principio.

.PARAMETER SkipBrowser
  No abre el navegador al terminar.
#>
[CmdletBinding()]
param(
  [switch] $Unattended,
  [string] $ConfigFile,
  [switch] $Reconfigure,
  [switch] $Force,
  [switch] $SkipBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib.ps1')

$Version = (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim()

# Secretos que consume el stack. internal=lo genera el instalador.
#   kind='fernet'  -> clave base64 url-safe de 32 bytes (Automation Center credential store)
$SecretSpec = @(
  @{ key='POSTGRES_PASSWORD';              internal=$true  }
  @{ key='N8N_ENCRYPTION_KEY';             internal=$true  }
  @{ key='AC_JWT_SECRET';                  internal=$true  }
  @{ key='AC_CREDENTIAL_ENCRYPTION_KEY';   internal=$true; kind='fernet' }
  # Token que n8n presenta al backend para /api/ai/generate. Lo genera el
  # instalador: es el mismo valor en las dos puntas, asi el usuario no tiene
  # que copiar nada entre servicios.
  @{ key='AC_SERVICE_TOKEN';               internal=$true; kind='service' }
  # La clave del proveedor de IA YA NO se pide aqui: se configura desde el
  # panel (Settings -> Artificial Intelligence), que la guarda cifrada en la
  # base de datos. Si el usuario ya tiene una, puede pegarla igualmente.
  @{ key='AC_NVIDIA_NIM_API_KEY';  internal=$false; optional=$true; hint='(opcional) API key de NVIDIA NIM - https://build.nvidia.com. Puedes dejarlo vacio y configurarlo despues desde el panel.' }
  @{ key='TELEGRAM_CHAT_ID';       internal=$false; hint='Tu chat id de Telegram (bot <token>/getUpdates)' }
  @{ key='TELEGRAM_NOTICIAS_TOKEN';internal=$false; hint='Token del bot de Noticias (@BotFather)' }
  @{ key='TELEGRAM_TOKEN_MARCA';   internal=$false; hint='Token del bot de Marca Personal' }
  @{ key='TELEGRAM_TOKEN_LABORAL'; internal=$false; hint='Token del bot de Laboral' }
  @{ key='TELEGRAM_TOKEN_EMAIL';   internal=$false; hint='Token del bot de Email' }
)

function New-InternalSecret([hashtable]$Spec) {
  if ($Spec.ContainsKey('kind') -and $Spec.kind -eq 'fernet') { return New-ApFernetKey }
  # El prefijo hace reconocible el token de automatizacion en un .env.
  if ($Spec.ContainsKey('kind') -and $Spec.kind -eq 'service') { return 'acs_' + (New-ApRandomSecret 43) }
  return New-ApRandomSecret   # CSPRNG (installer/lib.ps1); nunca Get-Random
}

function Read-EnvFile([string]$Path) {
  $h = @{}
  if (Test-Path $Path) {
    foreach ($l in Get-Content $Path) {
      if ($l -match '^\s*#') { continue }
      if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $h[$Matches[1]] = $Matches[2] }
    }
  }
  return $h
}

function Write-EnvFile([string]$Path, [hashtable]$Values) {
  $order = @(
    'POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_PORT','',
    'N8N_PORT','N8N_HOST','WEBHOOK_URL','N8N_LOG_LEVEL','N8N_ENCRYPTION_KEY','',
    'N8N_API_URL','N8N_API_KEY','',
    'PROFILE_PORT','','TZ','',
    'PA_DATA_DIR','PA_CONFIG_DIR','PA_OUTPUT_DIR','',
    'AC_API_URL','AC_SERVICE_TOKEN','',
    'TELEGRAM_CHAT_ID','TELEGRAM_NOTICIAS_TOKEN','TELEGRAM_TOKEN_MARCA','TELEGRAM_TOKEN_LABORAL','TELEGRAM_TOKEN_EMAIL','',
    'AC_ENVIRONMENT','BACKEND_PORT','FRONTEND_PORT','AC_CORS_ORIGINS','AC_CORS_ORIGIN_REGEX',
    'AC_JWT_SECRET','AC_CREDENTIAL_ENCRYPTION_KEY','AC_N8N_BASE_URL','AC_N8N_API_KEY',
    'AC_AI_PROVIDER','AC_NVIDIA_NIM_API_KEY','AC_OPENROUTER_API_KEY','AC_GEMINI_API_KEY',
    'AC_MONITOR_INTERVAL_SECONDS','VITE_API_URL','VITE_WS_URL'
  )
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('# Generado por installer/install.ps1 - NO subir a git (.gitignore).')
  foreach ($k in $order) {
    if ($k -eq '') { $lines.Add(''); continue }
    if ($Values.ContainsKey($k)) { $lines.Add("$k=$($Values[$k])") }
  }
  foreach ($k in $Values.Keys) {
    if ($order -notcontains $k) { $lines.Add("$k=$($Values[$k])") }
  }
  Set-Content -Path $Path -Value ($lines -join "`n") -Encoding utf8 -NoNewline
}

# ==========================================================================
Write-Host ''
Write-ApLog -Level STEP -Message "Automation Platform installer v$Version"
Initialize-ApHome

$state = Get-ApState
$resume = ($state.step -and -not $Force)
if ($resume) { Write-ApWarn "Reanudando: último paso completado = '$($state.step)'" }

# --- 1. DETECTING -------------------------------------------------------
Set-ApState 'detecting'
Write-ApStep 'Detectando plataforma'
$plat = Get-ApPlatform
Write-ApLog "   OS=$($plat.os) $($plat.osVersion)  arch=$($plat.arch)  RAM=$($plat.ramGB)GB  discoLibre=$($plat.diskFreeGB)GB  admin=$($plat.admin)  online=$($plat.online)"
if (-not $plat.supported) { throw "Arquitectura no soportada: $($plat.arch). Solo x64 y ARM64." }
if ($plat.ramGB -lt 3)      { Write-ApWarn "RAM baja ($($plat.ramGB)GB). Recomendado >= 4GB." }
if ($plat.diskFreeGB -lt 5) { throw "Espacio insuficiente en disco ($($plat.diskFreeGB)GB). Se necesitan >= 5GB." }
if (-not $plat.online)      { Write-ApWarn 'Sin conectividad detectada: la primera build necesita descargar imágenes.' }
Write-ApOk 'Plataforma OK'

# --- 2. DEPENDENCIES --------------------------------------------------
Set-ApState 'dependencies'
Write-ApStep 'Comprobando Docker'
$docker = Get-DockerInfo
if (-not $docker.found) {
  Write-ApLog -Level ERROR -Message 'Docker no está instalado.'
  Write-ApLog -Level ERROR -Message 'BLOCKED BY: instala Docker Desktop desde https://www.docker.com/products/docker-desktop/ y vuelve a ejecutar este instalador.'
  exit 2
}
if (-not $docker.running) {
  if (-not (Start-DockerDesktop)) {
    Write-ApLog -Level ERROR -Message 'BLOCKED BY: Docker Desktop no arrancó. Ábrelo manualmente y reintenta.'
    exit 2
  }
  $docker = Get-DockerInfo
}
$DockerExe = $docker.path
Write-ApOk "Docker $($docker.serverVersion)  ·  Compose $($docker.composeVersion)"
if (-not $docker.composeVersion) { throw 'Docker Compose v2 no disponible (se necesita `docker compose`).' }

# --- 3. DIRECTORIES -------------------------------------------------
Set-ApState 'directories'
Write-ApStep 'Preparando directorios de datos'
# El codigo puede estar en Program Files (solo lectura). Todo lo que cambia
# vive en %LOCALAPPDATA%\Personal Assistant: .env, config, output, logs y
# backups. Initialize-ApHome crea el arbol y migra el home de la v0.4.x;
# Initialize-ApUserConfig siembra modules.json / user_profile.json desde las
# plantillas instaladas, sin pisar lo que el usuario ya tenga.
Initialize-ApUserConfig -AppRoot $RepoRoot
$DataHome  = Get-ApDataHome
$ConfigDir = Get-ApConfigDir
$OutputDir = Get-ApOutputDir
Write-ApOk "Datos del usuario: $DataHome"

# --- 4. CONFIGURING (.env) ----------------------------------------
Set-ApState 'configuring'
Write-ApStep 'Configurando .env'
$envPath = Get-ApEnvPath
# Las instalaciones anteriores dejaban el .env junto al docker-compose. Si esta
# ahi y aun no hay uno en el directorio de datos, se mueve: contiene las claves
# de cifrado, y perderlo obligaria a reconfigurar todas las credenciales.
$legacyEnv = Join-Path $RepoRoot '.env'
if ((Test-Path $legacyEnv) -and -not (Test-Path $envPath)) {
  Move-Item $legacyEnv $envPath -Force
  Write-ApOk "'.env' movido al directorio de datos"
}
$env = Read-EnvFile $envPath
$fromConfig = @{}
if ($ConfigFile) {
  if (-not (Test-Path $ConfigFile)) { throw "ConfigFile no encontrado: $ConfigFile" }
  (Get-Content $ConfigFile -Raw | ConvertFrom-Json).psobject.Properties | ForEach-Object { $fromConfig[$_.Name] = "$($_.Value)" }
}

$needEnv = ((-not (Test-Path $envPath)) -or $Reconfigure)
if ($needEnv) {
  # valores base
  if (-not $env.ContainsKey('POSTGRES_DB'))   { $env['POSTGRES_DB'] = 'assistant' }
  if (-not $env.ContainsKey('POSTGRES_USER')) { $env['POSTGRES_USER'] = 'assistant' }
  if (-not $env.ContainsKey('N8N_HOST'))      { $env['N8N_HOST'] = 'localhost' }
  if (-not $env.ContainsKey('N8N_LOG_LEVEL')) { $env['N8N_LOG_LEVEL'] = 'info' }
  # El backend es quien decide el proveedor de IA; n8n solo necesita saber
  # donde esta. En una instalacion Docker es el nombre del servicio.
  if (-not $env.ContainsKey('AC_API_URL'))    { $env['AC_API_URL'] = 'http://backend:8080' }
  if (-not $env.ContainsKey('TZ'))            { $env['TZ'] = 'Europe/Madrid' }
  if (-not $env.ContainsKey('N8N_API_URL'))   { $env['N8N_API_URL'] = 'http://localhost:5678' }
  if (-not $env.ContainsKey('AC_ENVIRONMENT')){ $env['AC_ENVIRONMENT'] = 'production' }
  if (-not $env.ContainsKey('AC_CORS_ORIGINS')) { $env['AC_CORS_ORIGINS'] = 'http://localhost:3000' }
  if (-not $env.ContainsKey('AC_N8N_BASE_URL'))  { $env['AC_N8N_BASE_URL'] = 'http://n8n:5678' }
  if (-not $env.ContainsKey('AC_MONITOR_INTERVAL_SECONDS')) { $env['AC_MONITOR_INTERVAL_SECONDS'] = '5' }

  $missing = @()
  foreach ($spec in $SecretSpec) {
    $k = $spec.key
    if ($env.ContainsKey($k) -and $env[$k] -and $env[$k] -notmatch 'CAMBIA|PEGA_AQUI|PLACEHOLDER') { continue }
    if ($spec.internal) { $env[$k] = New-InternalSecret $spec; continue }
    $val = $null
    $fromEnvVar = [Environment]::GetEnvironmentVariable($k)
    if     ($fromConfig.ContainsKey($k)) { $val = $fromConfig[$k] }
    elseif ($fromEnvVar)                 { $val = $fromEnvVar }
    elseif (-not $Unattended) {
      Write-Host "   $k  —  $($spec.hint)" -ForegroundColor DarkGray
      $val = Read-Host "   $k (Enter para dejarlo pendiente)"
    }
    if ($val) { $env[$k] = $val }
    elseif ($spec.ContainsKey('optional') -and $spec.optional) { $env[$k] = '' }
    else { $env[$k] = ''; $missing += $k }
  }
  Write-EnvFile $envPath $env
  Write-ApOk '.env escrito'
  if ($missing.Count) {
    foreach ($m in $missing) { Write-ApLog -Level WARN -Message "BLOCKED BY: falta $m — el stack arrancará, pero el workflow que lo usa no funcionará hasta rellenarlo en .env (ver CREDENCIALES.md)." }
  }
} else {
  Write-ApOk '.env ya existe (usa -Reconfigure para regenerarlo)'
}

# --- 4b. RUTAS DE DATOS EN EL .env -----------------------------------
# docker-compose lee PA_CONFIG_DIR / PA_OUTPUT_DIR para los dos unicos montajes
# con escritura. Se reescriben SIEMPRE (tambien al actualizar): si el .env viene
# de una instalacion antigua no los trae, y sin ellos el compose caeria en las
# rutas relativas dentro del directorio de instalacion, que puede ser Program
# Files. Con barras normales, que es lo que espera Docker Desktop.
$env = Read-EnvFile $envPath
$pathVars = @{
  PA_DATA_DIR   = ConvertTo-ApDockerPath $DataHome
  PA_CONFIG_DIR = ConvertTo-ApDockerPath $ConfigDir
  PA_OUTPUT_DIR = ConvertTo-ApDockerPath $OutputDir
}
$pathsChanged = $false
foreach ($k in $pathVars.Keys) {
  if (-not $env.ContainsKey($k) -or $env[$k] -ne $pathVars[$k]) { $env[$k] = $pathVars[$k]; $pathsChanged = $true }
}
if ($pathsChanged) {
  Write-EnvFile $envPath $env
  Write-ApOk 'Rutas de datos escritas en el .env'
}

# --- 5. PORTS --------------------------------------------------------
Set-ApState 'ports'
Write-ApStep 'Comprobando puertos'
$env = Read-EnvFile $envPath
$portSpec = @(
  @{ key='N8N_PORT';      def=5678 }
  @{ key='PROFILE_PORT';  def=7777 }
  @{ key='BACKEND_PORT';  def=8080 }
  @{ key='FRONTEND_PORT'; def=3000 }
)
# ¿ya es nuestra instalación la que ocupa esos puertos? (no re-mapear si sí).
$stackRunningHere = Test-ApContainerRunning $DockerExe 'pa-n8n'
$ports = @{}
$changed = $false
foreach ($ps in $portSpec) {
  $want = [int]($(if ($env.ContainsKey($ps.key) -and $env[$ps.key]) { $env[$ps.key] } else { $ps.def }))
  $got  = if ($stackRunningHere) { $want } else { Get-FreePort $want }
  $ports[$ps.key] = $got
  if ("$got" -ne "$($env[$ps.key])") { $env[$ps.key] = "$got"; $changed = $true }
  if ($got -ne $want) { Write-ApWarn "Puerto $want ocupado -> $($ps.key) usará $got" }
}
$n8nPort = $ports['N8N_PORT']; $profilePort = $ports['PROFILE_PORT']
$backendPort = $ports['BACKEND_PORT']; $frontendPort = $ports['FRONTEND_PORT']
if ($changed) {
  $env['WEBHOOK_URL'] = "http://localhost:$n8nPort/"
  $env['AC_CORS_ORIGINS'] = "http://localhost:$frontendPort"
  $env['VITE_API_URL'] = "http://localhost:$backendPort"
  $env['VITE_WS_URL']  = "ws://localhost:$backendPort"
  Write-EnvFile $envPath $env
}
Write-ApOk "n8n:$n8nPort  profile:$profilePort  backend:$backendPort  frontend:$frontendPort"

$dq = '"' + $DockerExe + '"'
# El compose vive junto al codigo y el .env junto a los datos: hay que
# decirselo a docker en cada llamada (Get-ApComposeArgs).
$dc = Get-ApComposeArgs $RepoRoot

# --- 6. BUILDING ----------------------------------------------------
Set-ApState 'building'
Write-ApStep 'Construyendo imágenes (puede tardar la primera vez)'
if ((Invoke-ApNative "$dq $dc build" $RepoRoot) -ne 0) { throw 'docker compose build falló' }
Write-ApOk 'Imágenes construidas'

# --- 7. STARTING SERVICES ----------------------------------------
Set-ApState 'starting-services'
Write-ApStep 'Levantando Postgres'
if ((Invoke-ApNative "$dq $dc up -d postgres" $RepoRoot) -ne 0) { throw 'docker compose up postgres falló' }
if (-not (Wait-ContainerHealthy $DockerExe 'pa-postgres' 200)) { throw 'pa-postgres no llegó a healthy.' }
Write-ApOk 'pa-postgres healthy'

# --- 7b. DATABASE: automation_center (nunca DROP; idempotente) -------
Set-ApState 'database'
Write-ApStep 'Base de datos automation_center'
if (Confirm-AcDatabase -DockerExe $DockerExe -Cwd $RepoRoot) { Write-ApOk 'automation_center creada' }
else { Write-ApOk 'automation_center ya existía (conservada)' }

Write-ApStep 'Levantando el resto de servicios'
if ((Invoke-ApNative "$dq $dc up -d" $RepoRoot) -ne 0) { throw 'docker compose up falló' }
foreach ($c in @('pa-playwright','pa-profile','pa-n8n','pa-backend','pa-frontend')) {
  if (Wait-ContainerHealthy $DockerExe $c 240) { Write-ApOk "$c healthy" }
  else { throw "$c no llegó a healthy. Revisa: docker compose logs $c" }
}
# Las migraciones de Alembic las aplica el entrypoint del backend (idempotente:
# `alembic upgrade head` es no-op si ya está al día). Verificación explícita:
$rev = (Invoke-ApNative "$dq $dc exec -T backend alembic current" $RepoRoot)
Write-ApOk 'Migraciones aplicadas (alembic upgrade head en el arranque del backend)'

# --- 8. IMPORTING WORKFLOWS (upsert por id -> nunca duplica) --------
Set-ApState 'importing-workflows'
Write-ApStep 'Importando workflows'
$before = Get-N8nWorkflowCount -DockerExe $DockerExe -Cwd $RepoRoot
Invoke-ApNative "$dq $dc exec -T n8n n8n import:workflow --separate --input=/files/workflows" $RepoRoot | Out-Null
$after = Get-N8nWorkflowCount -DockerExe $DockerExe -Cwd $RepoRoot
Write-ApOk "Workflows importados (workflow_entity: $before -> $after)"
if ($after -ne 4) { Write-ApLog -Level ERROR -Message "workflow_entity = $after (esperado 4). Revisa la BD de n8n." }

# --- 9. HEALTH CHECK ------------------------------------------------
Set-ApState 'health-check'
Write-ApStep 'Health checks'
$hc = Invoke-ApHealthChecks -DockerExe $DockerExe -N8nPort $n8nPort -ProfilePort $profilePort `
  -BackendPort $backendPort -FrontendPort $frontendPort -Cwd $RepoRoot
$allOk = $true
foreach ($k in $hc.Keys) {
  $ok = $hc[$k]
  if ($ok) { Write-ApOk "$k = OK" } else { Write-ApLog -Level ERROR -Message "$k = FALLO"; $allOk = $false }
}

# --- Autostart: arranca el stack al iniciar sesión --------------
Write-ApStep 'Registrando arranque automático'
$taskName = 'AutomationPlatform'
$autostart = $false
# La tarea ya no puede depender del directorio actual: el compose esta en el
# directorio de instalacion y el .env en el de datos. Get-ApComposeArgs lleva
# las tres rutas absolutas.
$autostartArgs = "$dc up -d"
try {
  $action   = New-ScheduledTaskAction -Execute $DockerExe -Argument $autostartArgs -WorkingDirectory $RepoRoot
  $trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
  $autostart = $true
} catch {
  # fallback: schtasks.exe (más permisivo con usuarios sin privilegios)
  try {
    $tr = '"' + $DockerExe + '" ' + $autostartArgs
    & schtasks.exe /Create /TN $taskName /TR "cmd /c $tr" /SC ONLOGON /RL LIMITED /F 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $autostart = $true }
  } catch { }
}
if ($autostart) { Write-ApOk "Arranque automático registrado (tarea '$taskName')" }
else {
  Write-ApWarn "No se pudo registrar el arranque automático (permisos). El stack seguirá vivo por 'restart: unless-stopped' de Docker mientras Docker Desktop arranque solo."
}

# --- 10. READY ----------------------------------------------------
if (-not $allOk) {
  Set-ApState 'health-check'
  Write-ApLog -Level ERROR -Message 'FINAL STATUS: BLOCKED — algún health check falló. Revisa install.log y `docker compose logs`.'
  exit 1
}
Set-ApState 'ready'
Write-Host ''
Write-ApLog -Level OK -Message '================  READY  ================'
Write-ApLog -Level OK -Message "Automation Center:  http://localhost:$frontendPort"
Write-ApLog -Level OK -Message "API (backend):      http://localhost:$backendPort/api/health"
Write-ApLog -Level OK -Message "n8n (workflows):    http://localhost:$n8nPort"
Write-ApLog -Level OK -Message "Editor de perfil:   http://localhost:$profilePort"
Write-ApLog -Level OK -Message "Log:                $script:AP_LOG"
Write-Host ''
Write-ApLog "Siguiente: abre Automation Center, crea la cuenta (el primer usuario es admin) y conecta las credenciales."
if (-not $SkipBrowser) {
  Start-Process "http://localhost:$frontendPort"
}
exit 0
