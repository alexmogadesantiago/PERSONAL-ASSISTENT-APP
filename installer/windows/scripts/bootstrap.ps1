<#
.SYNOPSIS
  Orquestador de primer arranque de Personal Assistant (lo lanza el instalador .exe).

.DESCRIPTION
  DETECTA -> WSL2 -> DOCKER -> DESPLIEGA -> HEALTH CHECKS -> READY.

  - Idempotente y reanudable (installer/lib.ps1 guarda el estado).
  - Eleva a administrador SOLO los pasos que lo necesitan (WSL, instalar Docker).
  - Si Windows pide reiniciar, registra la continuación (RunOnce) y sale con 10.
  - El despliegue real lo hace installer/install.ps1 (misma ruta que el portable):
    NO se duplica lógica.

.PARAMETER Resumed        Se está reanudando tras un reinicio.
.PARAMETER Unattended     Se conserva por compatibilidad: la instalacion nunca
                          pregunta. Los secretos llegan por -ConfigFile o por
                          variables de entorno; el resto se configura despues
                          desde la aplicacion.
.PARAMETER ConfigFile     JSON con secretos para modo desatendido.
.PARAMETER SkipBrowser    No abrir el navegador al terminar.
.PARAMETER DetectOnly     Solo detección; no cambia nada.
.PARAMETER SkipEnvironmentPrep  Salta WSL/Docker (asume que ya están); útil en CI/tests.
#>
[CmdletBinding()]
param(
  [switch]$Resumed,
  [switch]$Unattended,
  [string]$ConfigFile,
  [switch]$SkipBrowser,
  [switch]$DetectOnly,
  [switch]$SkipEnvironmentPrep
)

. (Join-Path $PSScriptRoot 'common.ps1')
$RepoRoot = Get-RepoRoot
$Version  = (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim()

Initialize-ApHome
Write-Host ''
Write-ApLog -Level STEP -Message "Personal Assistant · primer arranque · v$Version $(if($Resumed){'(reanudado tras reinicio)'})"

# --- 1. Detección -----------------------------------------------------
$detect = Join-Path $PSScriptRoot 'detect.ps1'
& $detect
$detectCode = $LASTEXITCODE
$report = (& $detect -Json) | ConvertFrom-Json

if (-not $report.windows.supported)     { Write-ApLog -Level ERROR -Message 'BLOCKED BY: se requiere Windows 10 (2004+) o Windows 11.'; exit 2 }
if (-not $report.architecture.supported){ Write-ApLog -Level ERROR -Message "BLOCKED BY: arquitectura no soportada ($($report.architecture.value)). Solo x64 y ARM64."; exit 2 }
if ($report.disk_free_gb -lt 5)         { Write-ApLog -Level ERROR -Message "BLOCKED BY: espacio en disco insuficiente ($($report.disk_free_gb) GB; se necesitan >= 5)."; exit 2 }

if ($DetectOnly) { exit $detectCode }

# --- 2. WSL2 --------------------------------------------------------
if (-not $SkipEnvironmentPrep -and -not $report.wsl.ready) {
  Write-ApStep 'WSL2 no está listo — configurando (requiere administrador)'
  $code = Invoke-ElevatedScript 'install-wsl.ps1'
  if ($code -eq 10) {
    Register-ResumeAfterReboot -BootstrapArgs "-Unattended $(if($SkipBrowser){'-SkipBrowser'})"
    Write-ApLog -Level WARN -Message 'REINICIO NECESARIO: Windows debe reiniciarse para activar la virtualización.'
    Write-ApLog -Level WARN -Message 'Tras reiniciar e iniciar sesión, la instalación CONTINUARÁ SOLA (RunOnce).'
    exit 10
  }
  if ($code -ne 0) { Write-ApLog -Level ERROR -Message "BLOCKED BY: no se pudo configurar WSL2 (código $code). Revisa install.log."; exit 2 }
  $report = (& $detect -Json) | ConvertFrom-Json
}

# --- 3. Docker Desktop --------------------------------------------
if (-not $SkipEnvironmentPrep -and (-not $report.docker.installed -or -not $report.docker.engine_running -or -not $report.docker.compose_v2)) {
  Write-ApStep 'Docker Desktop no está listo — instalando/arrancando'
  # Si ya está instalado solo hace falta arrancarlo (sin elevación); si hay que
  # instalarlo, el script pide administrador él mismo.
  if ($report.docker.installed) {
    & (Join-Path $PSScriptRoot 'install-docker.ps1')
    $code = $LASTEXITCODE
  } else {
    $code = Invoke-ElevatedScript 'install-docker.ps1'
  }
  if ($code -eq 11) {
    Register-ResumeAfterReboot -BootstrapArgs "-Unattended $(if($SkipBrowser){'-SkipBrowser'})"
    Write-ApLog -Level WARN -Message 'Docker Desktop instalado. Cierra sesión y vuelve a entrar; la instalación continuará sola.'
    exit 10
  }
  if ($code -ne 0) { Write-ApLog -Level ERROR -Message "BLOCKED BY: Docker Desktop no quedó operativo (código $code)."; exit 2 }
}

# --- 4. Despliegue (reutiliza installer/install.ps1) -----------------
Write-ApStep 'Desplegando Personal Assistant'
# La ruta va ENTRECOMILLADA: el directorio de instalacion se llama
# "Personal Assistant" y Start-Process no entrecomilla los elementos del
# array que llevan espacios, asi que -File recibiria solo
# ...\Programs\Personal y PowerShell fallaria antes de arrancar nada.
$deployScript = Join-Path $RepoRoot 'installer\install.ps1'
$deployArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File', "`"$deployScript`"")
# Siempre desatendido: ni el instalador ni el bootstrap abren un dialogo de
# consola. Lo que falte se configura luego desde el launcher o el panel.
$deployArgs += '-Unattended'
if ($ConfigFile)  { $deployArgs += @('-ConfigFile', $ConfigFile) }
if ($SkipBrowser) { $deployArgs += '-SkipBrowser' }
$p = Start-Process -FilePath 'powershell.exe' -ArgumentList $deployArgs -Wait -PassThru -NoNewWindow
$deployCode = $p.ExitCode

if ($deployCode -ne 0) {
  Write-ApLog -Level ERROR -Message "FINAL STATUS: BLOCKED — el despliegue devolvió $deployCode. Revisa el log."
  exit $deployCode
}

Unregister-ResumeAfterReboot
Write-ApLog -Level OK -Message 'FINAL STATUS: READY — Personal Assistant instalado y sano.'
exit 0
