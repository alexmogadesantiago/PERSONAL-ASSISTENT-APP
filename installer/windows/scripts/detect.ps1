<#
.SYNOPSIS
  Detección de requisitos de Personal Assistant (Windows). Idempotente y sin efectos.

.DESCRIPTION
  Comprueba: Windows 10/11 soportado, arquitectura, privilegios, WSL2,
  Virtual Machine Platform, distribución Linux, Docker Desktop, motor Docker
  en marcha, Docker Compose v2, y puertos. No instala ni cambia nada.

.PARAMETER Json
  Emite el resultado como JSON (para consumo por bootstrap / control plane).
#>
[CmdletBinding()]
param([switch]$Json)

. (Join-Path $PSScriptRoot 'common.ps1')

$plat   = Get-ApPlatform
$wsl    = Get-WslInfo
$docker = Get-DockerInfo

$osVer  = [Environment]::OSVersion.Version
$winOk  = ($osVer.Major -gt 10) -or ($osVer.Major -eq 10 -and $osVer.Build -ge 19041)  # 2004+

$ports = @{}
foreach ($p in @(@{n='n8n';d=5678}, @{n='profile';d=7777}, @{n='backend';d=8080}, @{n='frontend';d=3000})) {
  $ports[$p.n] = @{ preferred = $p.d; free = (Test-PortFree $p.d) }
}

$report = [ordered]@{
  timestamp        = (Get-Date -Format o)
  windows          = @{ version = "$osVer"; build = $osVer.Build; supported = $winOk }
  architecture     = @{ value = $plat.arch; supported = $plat.supported }
  admin            = $plat.admin
  ram_gb           = $plat.ramGB
  disk_free_gb     = $plat.diskFreeGB
  online           = $plat.online
  pending_reboot   = (Test-PendingReboot)
  wsl = @{
    feature_enabled     = ($wsl.wslFeature -eq 'Enabled')
    vm_platform_enabled = ($wsl.vmPlatform -eq 'Enabled')
    wsl_exe             = $wsl.wslExe
    default_version     = $wsl.defaultVersion
    distros             = $wsl.distros
    ready               = $wsl.ok
  }
  docker = @{
    installed        = $docker.found
    path             = $docker.path
    engine_running   = $docker.running
    server_version   = $docker.serverVersion
    compose_version  = $docker.composeVersion
    compose_v2       = [bool]$docker.composeVersion
  }
  ports = $ports
}

# ¿qué falta?
$missing = @()
if (-not $winOk)                       { $missing += 'Windows 10 2004+ / Windows 11' }
if (-not $plat.supported)              { $missing += "arquitectura soportada (x64/ARM64); detectada: $($plat.arch)" }
if (-not $report.wsl.ready)            { $missing += 'WSL2 con una distribución Linux v2' }
if (-not $docker.found)                { $missing += 'Docker Desktop' }
elseif (-not $docker.running)          { $missing += 'motor de Docker en marcha' }
elseif (-not $docker.composeVersion)   { $missing += 'Docker Compose v2' }
$report.missing = $missing
$report.ready   = ($missing.Count -eq 0)

if ($Json) {
  ($report | ConvertTo-Json -Depth 6)
  return
}

Write-ApStep 'Detección de requisitos'
Write-ApLog ("   Windows {0} (build {1})  {2}" -f $osVer, $osVer.Build, $(if($winOk){'OK'}else{'NO SOPORTADO'}))
Write-ApLog ("   Arquitectura: {0}  {1}" -f $plat.arch, $(if($plat.supported){'OK'}else{'NO SOPORTADA'}))
Write-ApLog ("   Administrador: {0}   RAM: {1} GB   Disco libre: {2} GB   Online: {3}" -f $plat.admin, $plat.ramGB, $plat.diskFreeGB, $plat.online)
Write-ApLog ("   WSL feature: {0}   VirtualMachinePlatform: {1}   distros v2: {2}" -f $wsl.wslFeature, $wsl.vmPlatform, (($wsl.distros | Where-Object {$_.version -eq 2}).Count))
Write-ApLog ("   Docker: instalado={0}  motor={1}  compose={2}" -f $docker.found, $docker.running, $docker.composeVersion)
if ($report.ready) { Write-ApOk 'Todos los requisitos presentes.' }
else { foreach ($m in $missing) { Write-ApWarn "Falta: $m" } }

exit $(if ($report.ready) { 0 } else { 3 })
