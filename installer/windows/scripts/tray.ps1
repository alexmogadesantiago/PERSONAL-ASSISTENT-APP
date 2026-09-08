<#
.SYNOPSIS
  Icono de bandeja de Personal Assistant.

.DESCRIPTION
  Menu:

      Abrir Personal Assistant   (el launcher: estado real + botones)
      Abrir el panel web
      Estado                     (abre el launcher, que es donde se ve)
      ---
      Iniciar / Reiniciar / Detener
      Ver logs
      Copia de seguridad
      ---
      Salir

  El doble clic abre el launcher, no el navegador: la aplicacion de escritorio
  es la ventana, y el panel es una de las cosas que se abren desde ella.

  Sondea cada 15 s /api/health y colorea el estado (Running / Stopped). Toda la
  logica real vive en launcher.ps1 y control.ps1: esto es solo un acceso rapido.

  Lo arranca un acceso directo en la carpeta Inicio, a traves de hidden.vbs,
  para que no parpadee ninguna consola.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptsDir = $PSScriptRoot
. (Join-Path $scriptsDir 'common.ps1')
$RepoRoot = Get-RepoRoot
$envMap = Read-ApEnvMap $RepoRoot
$fPort = if ($envMap.ContainsKey('FRONTEND_PORT') -and $envMap['FRONTEND_PORT']) { $envMap['FRONTEND_PORT'] } else { 3000 }
$bPort = if ($envMap.ContainsKey('BACKEND_PORT')  -and $envMap['BACKEND_PORT'])  { $envMap['BACKEND_PORT']  } else { 8080 }

function Start-Ctl([string]$Action) {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass',
    '-File',(Join-Path $scriptsDir 'control.ps1'),$Action)
}

# El launcher se abre por el mismo camino que el acceso directo del menu
# Inicio: wscript + hidden.vbs, sin consola.
function Open-Launcher {
  $vbs = Join-Path $scriptsDir 'hidden.vbs'
  $ps  = Join-Path $scriptsDir 'launcher.ps1'
  if (Test-Path $vbs) {
    Start-Process 'wscript.exe' -ArgumentList @("`"$vbs`"", "`"$ps`"")
  } else {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
      '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$ps)
  }
}

$icoPath = Join-Path $scriptsDir '..\assets\personal-assistant.ico'
$icon = if (Test-Path $icoPath) { New-Object System.Drawing.Icon $icoPath } else { [System.Drawing.SystemIcons]::Application }

$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $icon
$ni.Visible = $true
$ni.Text = 'Personal Assistant'

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add('* comprobando...'); $statusItem.Enabled = $false
$menu.Items.Add('-') | Out-Null
$openItem = $menu.Items.Add('Abrir Personal Assistant', $null, { Open-Launcher })
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
$menu.Items.Add('Abrir el panel web', $null, { Start-Process "http://127.0.0.1:$fPort" }) | Out-Null
# "Estado" abre el launcher: es donde se ve el estado de verdad, servicio a
# servicio, sin abrir una consola.
$menu.Items.Add('Estado',        $null, { Open-Launcher }) | Out-Null
$menu.Items.Add('-') | Out-Null
$menu.Items.Add('Iniciar',       $null, { Start-Ctl 'start' })   | Out-Null
$menu.Items.Add('Reiniciar',     $null, { Start-Ctl 'restart' }) | Out-Null
$menu.Items.Add('Detener',       $null, { Start-Ctl 'stop' })    | Out-Null
$menu.Items.Add('Ver logs',      $null, {
  # control.ps1 logs vuelca los logs de los contenedores a la carpeta y la abre.
  Start-Ctl 'logs' }) | Out-Null
$menu.Items.Add('Copia de seguridad', $null, {
  Start-Process powershell.exe -ArgumentList @('-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $scriptsDir 'backup.ps1')) }) | Out-Null
$menu.Items.Add('-') | Out-Null
$menu.Items.Add('Salir',         $null, { $ni.Visible = $false; [System.Windows.Forms.Application]::Exit() }) | Out-Null
$ni.ContextMenuStrip = $menu
$ni.add_MouseDoubleClick({ Open-Launcher })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000
$timer.add_Tick({
  $up = $false
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$bPort/api/health" -TimeoutSec 3 -UseBasicParsing
    $up = ($r.StatusCode -eq 200)
  } catch { }
  $statusItem.Text = if ($up) { '* Running' } else { '* Stopped' }
  $statusItem.ForeColor = if ($up) { [System.Drawing.Color]::Green } else { [System.Drawing.Color]::Firebrick }
  $ni.Text = if ($up) { 'Personal Assistant - Running' } else { 'Personal Assistant - Stopped' }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$ni.Dispose()
