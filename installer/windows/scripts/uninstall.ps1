<#
.SYNOPSIS
  Desinstalación de Personal Assistant (la invoca el desinstalador del .exe).

.DESCRIPTION
  Pregunta SIEMPRE qué hacer con los datos (salvo -Mode explícito):
    KeepData   -> para los contenedores, conserva volúmenes (Postgres, n8n).
    PurgeData  -> además elimina los volúmenes y los borradores. IRREVERSIBLE.
  Nunca borra datos en silencio. Quita accesos directos, bandeja, tarea de
  arranque y estado del instalador.

.PARAMETER Mode   KeepData | PurgeData | Ask   (por defecto Ask)
.PARAMETER Silent Para uso desde el desinstalador de Inno (no usa Read-Host).
#>
[CmdletBinding()]
param(
  [ValidateSet('KeepData','PurgeData','Ask')][string]$Mode = 'Ask',
  [switch]$Silent
)

. (Join-Path $PSScriptRoot 'common.ps1')
$RepoRoot = Get-RepoRoot

if ($Mode -eq 'Ask') {
  if ($Silent) { $Mode = 'KeepData' }
  else {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $r = [System.Windows.Forms.MessageBox]::Show(
      "¿Conservar tus datos de Personal Assistant?`n`n" +
      "SÍ  = conservar (workflows, perfiles, credenciales, usuarios, BD).`n" +
      "NO  = borrar TODO (irreversible).`n" +
      "Cancelar = no desinstalar ahora.",
      'Personal Assistant - Desinstalar',
      [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
      [System.Windows.Forms.MessageBoxIcon]::Warning)
    switch ($r) {
      'Yes'    { $Mode = 'KeepData' }
      'No'     { $Mode = 'PurgeData' }
      default  { Write-ApLog 'Desinstalación cancelada.'; exit 0 }
    }
  }
}

Write-ApLog -Level STEP -Message "Desinstalando Personal Assistant (modo: $Mode)"

# Bandeja: se cierra el proceso que esta ejecutando tray.ps1. Envuelto en
# try/catch porque consultar la linea de comandos de un proceso ajeno puede
# fallar por permisos, y eso no debe impedir desinstalar.
try {
  Get-Process powershell -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine -match 'tray\.ps1' } |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
} catch { }

# Arranque automático (tarea programada + RunOnce)
foreach ($t in @('PersonalAssistant','AutomationPlatform','AutomationCenter')) {
  # A traves de cmd. schtasks devuelve error cuando la tarea no existe y, con
  # $ErrorActionPreference = 'Stop' (lo fija lib.ps1), ese stderr se convierte
  # en NativeCommandError y aborta la desinstalacion antes de parar nada. De
  # los tres nombres, dos no existen casi nunca: es el caso normal.
  & $env:ComSpec /c "schtasks.exe /Delete /TN $t /F >nul 2>&1" | Out-Null
}
Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name 'PersonalAssistantSetupResume' -ErrorAction SilentlyContinue

# Contenedores / volúmenes (reutiliza el desinstalador base)
$uninstallScript = Join-Path $RepoRoot 'installer\uninstall.ps1'
$dArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File', "`"$uninstallScript`"", '-Yes')
if ($Mode -eq 'PurgeData') { $dArgs += '-PurgeData' }
$p = Start-Process powershell.exe -ArgumentList $dArgs -Wait -PassThru -NoNewWindow

# Accesos directos del menú Inicio (Inno borra los suyos; esto cubre el resto)
$sm = Join-Path ([Environment]::GetFolderPath('Programs')) 'Personal Assistant'
if (Test-Path $sm) { Remove-Item $sm -Recurse -Force -ErrorAction SilentlyContinue }
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Personal Assistant Tray.lnk'
Remove-Item $startup -Force -ErrorAction SilentlyContinue

Write-ApLog -Level OK -Message "Desinstalación completada (datos: $Mode)."
if ($Mode -eq 'KeepData') {
  Write-ApLog 'Tus volúmenes de Docker (personal-assistant_postgres_data, personal-assistant_n8n_data) se han conservado.'
}
exit 0
