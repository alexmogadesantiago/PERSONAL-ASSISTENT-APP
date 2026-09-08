<#
  common.ps1 - helpers compartidos por los scripts del instalador Windows (.exe).

  Reutiliza installer/lib.ps1 (logging sin secretos, estado, Docker, puertos,
  health checks) y añade lo específico de Windows: elevación, features de
  Windows (WSL / Virtual Machine Platform), detección de WSL2 y reinicio.

  No duplica lógica de despliegue: el despliegue real lo hace
  installer/install.ps1 (mismo que la ruta portable).
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# .../installer/windows/scripts/common.ps1  ->  RepoRoot = .../
$script:WinScripts = $PSScriptRoot
$script:RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
. (Join-Path $script:RepoRoot 'installer\lib.ps1')

function Test-IsAdmin {
  (New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Ejecuta un script .ps1 de este directorio con elevación (UAC) y espera.
# Devuelve el código de salida del proceso elevado.
function Invoke-ElevatedScript {
  param([Parameter(Mandatory)][string]$Script, [string[]]$Arguments = @())
  $path = Join-Path $script:WinScripts $Script
  $argLine = @('-NoProfile','-ExecutionPolicy','Bypass','-File', "`"$path`"") + $Arguments
  Write-ApLog "   (solicitando permisos de administrador para $Script)"
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -Verb RunAs -Wait -PassThru
  return $p.ExitCode
}

# --- WSL2 / features de virtualización ---------------------------------
function Get-WindowsFeatureState([string]$Name) {
  # 'Enabled' | 'Disabled' | 'Unknown'
  try {
    $f = Get-WindowsOptionalFeature -Online -FeatureName $Name -ErrorAction Stop
    return "$($f.State)"
  } catch { return 'Unknown' }
}

function Get-WslInfo {
  $res = [pscustomobject]@{
    wslFeature      = Get-WindowsFeatureState 'Microsoft-Windows-Subsystem-Linux'
    vmPlatform      = Get-WindowsFeatureState 'VirtualMachinePlatform'
    wslExe          = [bool](Get-Command wsl.exe -ErrorAction SilentlyContinue)
    defaultVersion  = $null
    distros         = @()
    ok              = $false
  }
  if ($res.wslExe) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
      # wsl.exe emite UTF-16; normalizamos.
      $raw = & wsl.exe --list --verbose 2>$null | Out-String
      $raw = ($raw -replace "`0", '')
      foreach ($line in ($raw -split "`r?`n")) {
        if ($line -match '^\s*\*?\s*([A-Za-z0-9_.\-]+)\s+\w+\s+([12])\s*$') {
          $res.distros += [pscustomobject]@{ name = $Matches[1]; version = [int]$Matches[2] }
        }
      }
      $sv = & wsl.exe --status 2>$null | Out-String
      if (($sv -replace "`0",'') -match 'ault Version:\s*([12])') { $res.defaultVersion = [int]$Matches[1] }
    } catch { } finally { $ErrorActionPreference = $prev }
  }
  # WSL2 se considera listo si hay una distro v2 en marcha (WSL moderno del
  # Store no necesita las features opcionales legacy activadas) O si ambas
  # features están habilitadas (WSL clásico, aún sin distro).
  $hasV2 = (@($res.distros | Where-Object { $_.version -eq 2 }).Count) -ge 1
  $res.ok = $res.wslExe -and (
    $hasV2 -or ($res.wslFeature -eq 'Enabled' -and $res.vmPlatform -eq 'Enabled'))
  return $res
}

# --- Continuación tras reinicio ---------------------------------------
$script:AP_RESUME_RUNONCE = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
$script:AP_RESUME_NAME    = 'PersonalAssistantSetupResume'

function Register-ResumeAfterReboot {
  param([string]$BootstrapArgs = '')
  $bs = Join-Path $script:WinScripts 'bootstrap.ps1'
  $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$bs`" -Resumed $BootstrapArgs"
  New-ItemProperty -Path $script:AP_RESUME_RUNONCE -Name $script:AP_RESUME_NAME -Value $cmd -PropertyType String -Force | Out-Null
  Write-ApLog "   Continuación tras reinicio registrada (RunOnce)."
}

function Unregister-ResumeAfterReboot {
  Remove-ItemProperty -Path $script:AP_RESUME_RUNONCE -Name $script:AP_RESUME_NAME -ErrorAction SilentlyContinue
}

function Test-PendingReboot {
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
  )
  foreach ($k in $keys) { if (Test-Path $k) { return $true } }
  $pfro = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue)
  return [bool]$pfro
}

function Get-RepoRoot { $script:RepoRoot }
