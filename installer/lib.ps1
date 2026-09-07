<#
  lib.ps1 - utilidades compartidas del instalador (Windows).
  Detección de plataforma, logging sin secretos, estado reanudable,
  gestión de puertos y health checks.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Rutas ------------------------------------------------------------------
$script:AP_HOME    = if ($env:AUTOMATION_PLATFORM_HOME) { $env:AUTOMATION_PLATFORM_HOME } else { Join-Path $env:LOCALAPPDATA 'AutomationPlatform' }
$script:AP_STATE   = Join-Path $script:AP_HOME 'state.json'
$script:AP_LOG     = Join-Path $script:AP_HOME 'install.log'

# Pasos de instalación, en orden. El estado guarda el último completado.
$script:AP_STEPS = @(
  'detecting', 'dependencies', 'directories', 'configuring',
  'ports', 'database', 'building', 'starting-services', 'importing-workflows',
  'health-check', 'ready'
)

# Contenedores del stack completo (Fase 1 + Automation Center).
$script:AP_CONTAINERS = @('pa-postgres','pa-n8n','pa-playwright','pa-profile','pa-backend','pa-frontend')

# IDs de los 4 workflows que deben existir siempre (no se duplican: import upsert por id).
$script:AP_WORKFLOW_IDS = @('0ikHqQCWMke67aoI','pa01email000001','pa02laboral00001','pa04marcapersonal')

function Initialize-ApHome {
  if (-not (Test-Path $script:AP_HOME)) { New-Item -ItemType Directory -Force -Path $script:AP_HOME | Out-Null }
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

function Write-ApLog {
  param([string]$Message, [ValidateSet('INFO','WARN','ERROR','STEP','OK')] [string]$Level = 'INFO', [string]$Component = 'installer')
  Initialize-ApHome
  $safe = Protect-ApString $Message
  $line = ('{0} [{1,-5}] {2,-12} {3}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $Level, $Component, $safe)
  Add-Content -Path $script:AP_LOG -Value $line -Encoding utf8
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
  $n = Get-N8nWorkflowCount -DockerExe $DockerExe -Cwd $Cwd
  $results['n8n:workflow_entity=4'] = ($n -eq 4)
  return $results
}

# --- Postgres: consultas puntuales sin romper por NativeCommandError ------
function Read-ApEnvMap([string]$Cwd) {
  $m = @{}
  $envPath = Join-Path $Cwd '.env'
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
  $q = '"' + $DockerExe + '" compose exec -T -e PGPASSWORD=' + $pw +
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
