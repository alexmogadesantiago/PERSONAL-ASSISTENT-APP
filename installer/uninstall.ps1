<#
.SYNOPSIS
  Desinstalador de Personal Assistant (Windows).

.DESCRIPTION
  Para y elimina los contenedores, la tarea de arranque automático, el
  estado del instalador y (opcionalmente) los datos. NO toca recursos
  externos (tu Docker Desktop, tu cuenta de Google, etc.).

.PARAMETER PurgeData
  Elimina también los volúmenes de datos (Postgres, n8n) y los borradores
  generados en output/. IRREVERSIBLE.

.PARAMETER Yes
  No pide confirmación.
#>
[CmdletBinding()]
param([switch] $PurgeData, [switch] $Yes)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib.ps1')

Write-ApLog -Level STEP -Message 'Desinstalando Personal Assistant'

if (-not $Yes) {
  $msg = if ($PurgeData) { 'Esto PARARÁ los servicios y BORRARÁ TODOS LOS DATOS (Postgres, n8n, borradores).' }
         else            { 'Esto parará y eliminará los contenedores. Los datos en volúmenes se conservan.' }
  Write-Host $msg -ForegroundColor Yellow
  if ((Read-Host 'Escribe "si" para continuar') -ne 'si') { Write-ApLog 'Cancelado.'; exit 0 }
}

$docker = Get-DockerInfo
if ($docker.found -and $docker.running) {
  $DockerExe = $docker.path
  $dq = '"' + $DockerExe + '"'
  $dc = Get-ApComposeArgs $RepoRoot
  Write-ApStep 'Parando y eliminando contenedores'
  $down = "$dq $dc down --remove-orphans"
  # -v elimina los volúmenes con nombre (postgres_data -> BD de n8n Y de
  # automation_center; n8n_data -> credenciales). SOLO con -PurgeData.
  if ($PurgeData) { $down += ' -v' }
  Invoke-ApNative $down $RepoRoot | Out-Null
  foreach ($img in @('pa-playwright-scraper:local','pa-profile:local',
                     'pa-automation-center-backend:local','pa-automation-center-frontend:local')) {
    Invoke-ApNative "$dq image rm $img" | Out-Null
  }
  Write-ApOk 'Contenedores eliminados'
} else {
  Write-ApWarn 'Docker no está disponible; se omite la limpieza de contenedores.'
}

Write-ApStep 'Eliminando tarea de arranque automático'
try {
  # Tambien los nombres de versiones anteriores, para no dejar tareas huerfanas.
  $removed = $false
  foreach ($t in @('PersonalAssistant','AutomationPlatform','AutomationCenter')) {
    try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction Stop; $removed = $true } catch { }
  }
  if (-not $removed) { throw 'no habia tarea programada' }
  Write-ApOk 'Tarea programada eliminada'
} catch { Write-ApWarn 'No había tarea programada que eliminar' }

if ($PurgeData) {
  Write-ApStep 'Borrando datos locales'
  $out = Join-Path (Get-ApOutputDir) 'marca-personal'
  if (Test-Path $out) { Get-ChildItem $out -Filter *.md | Remove-Item -Force -ErrorAction SilentlyContinue }
  Write-ApOk 'Borradores eliminados'
}

Write-ApStep 'Eliminando estado del instalador'
if (Test-Path $script:AP_HOME) {
  # conserva el log si no es purga total
  if ($PurgeData) { Remove-Item $script:AP_HOME -Recurse -Force }
  else { Remove-Item $script:AP_STATE -Force -ErrorAction SilentlyContinue }
}
Write-ApOk 'Estado eliminado'

Write-Host ''
Write-ApLog -Level OK -Message 'Desinstalación completada.'
Write-ApLog "El repositorio y tu .env NO se han tocado. Bórralos a mano si quieres."
