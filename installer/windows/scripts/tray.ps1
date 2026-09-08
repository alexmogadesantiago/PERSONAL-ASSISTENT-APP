<#
.SYNOPSIS
  Icono de bandeja de Personal Assistant.

.DESCRIPTION
  Menú:  Abrir panel · Estado · Iniciar · Parar · Reiniciar · Ver logs · Backup · Salir
  Sondea cada 15 s el backend y colorea el estado (● Running / ● Stopped).
  Toda la lógica real está en control.ps1 / backup.ps1: esto es solo la UI.
  Se lanza desde un acceso directo en la carpeta Inicio (sin ventana).
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
    '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $scriptsDir 'control.ps1'),$Action)
}

$icoPath = Join-Path $scriptsDir '..\assets\personal-assistant.ico'
$icon = if (Test-Path $icoPath) { New-Object System.Drawing.Icon $icoPath } else { [System.Drawing.SystemIcons]::Application }

$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $icon
$ni.Visible = $true
$ni.Text = 'Personal Assistant'

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add('● comprobando...'); $statusItem.Enabled = $false
$menu.Items.Add('-') | Out-Null
$menu.Items.Add('Abrir panel',   $null, { Start-Process "http://localhost:$fPort" }) | Out-Null
$menu.Items.Add('Estado',        $null, { Start-Process powershell.exe -ArgumentList @('-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $scriptsDir 'control.ps1'),'status') }) | Out-Null
$menu.Items.Add('Iniciar',       $null, { Start-Ctl 'start' }) | Out-Null
$menu.Items.Add('Parar',         $null, { Start-Ctl 'stop' }) | Out-Null
$menu.Items.Add('Reiniciar',     $null, { Start-Ctl 'restart' }) | Out-Null
$menu.Items.Add('Ver logs',      $null, { Start-Ctl 'logs' }) | Out-Null
$menu.Items.Add('Backup ahora',  $null, { Start-Process powershell.exe -ArgumentList @('-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $scriptsDir 'backup.ps1')) }) | Out-Null
$menu.Items.Add('-') | Out-Null
$menu.Items.Add('Salir',         $null, { $ni.Visible = $false; [System.Windows.Forms.Application]::Exit() }) | Out-Null
$ni.ContextMenuStrip = $menu
$ni.add_MouseDoubleClick({ Start-Process "http://localhost:$fPort" })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000
$timer.add_Tick({
  $up = $false
  try {
    $r = Invoke-WebRequest "http://localhost:$bPort/api/health" -TimeoutSec 3 -UseBasicParsing
    $up = ($r.StatusCode -eq 200)
  } catch { }
  $statusItem.Text = if ($up) { '● Running' } else { '● Stopped' }
  $statusItem.ForeColor = if ($up) { [System.Drawing.Color]::Green } else { [System.Drawing.Color]::Firebrick }
  $ni.Text = if ($up) { 'Personal Assistant — Running' } else { 'Personal Assistant — Stopped' }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$ni.Dispose()
