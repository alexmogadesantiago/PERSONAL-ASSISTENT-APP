<#
.SYNOPSIS
  Control de Automation Center: start | stop | restart | status | open | logs.

.DESCRIPTION
  Envoltorio fino sobre `docker compose`. No borra datos nunca.
  Lo usan los accesos directos del menú Inicio y el icono de la bandeja.

.PARAMETER Action  start | stop | restart | status | open | logs
#>
[CmdletBinding()]
param(
  [Parameter(Position=0)]
  [ValidateSet('start','stop','restart','status','open','logs')]
  [string]$Action = 'status'
)

. (Join-Path $PSScriptRoot 'common.ps1')
$RepoRoot = Get-RepoRoot

$docker = Get-DockerInfo
if (-not $docker.found) { Write-ApLog -Level ERROR -Message 'Docker no está instalado.'; exit 2 }
if (-not $docker.running -and $Action -in @('start','restart','status','open')) {
  Write-ApLog 'Docker Desktop no responde; intentando arrancarlo...'
  if (-not (Start-DockerDesktop)) { Write-ApLog -Level ERROR -Message 'Docker Desktop no arrancó. Ábrelo y reintenta.'; exit 2 }
  $docker = Get-DockerInfo
}
$dq = '"' + $docker.path + '"'
$dc = Get-ApComposeArgs $RepoRoot
$envMap = Read-ApEnvMap $RepoRoot
$fPort = if ($envMap.ContainsKey('FRONTEND_PORT') -and $envMap['FRONTEND_PORT']) { $envMap['FRONTEND_PORT'] } else { 3000 }
$bPort = if ($envMap.ContainsKey('BACKEND_PORT')  -and $envMap['BACKEND_PORT'])  { $envMap['BACKEND_PORT']  } else { 8080 }
$nPort = if ($envMap.ContainsKey('N8N_PORT')      -and $envMap['N8N_PORT'])      { $envMap['N8N_PORT']      } else { 5678 }

switch ($Action) {
  'start' {
    Write-ApStep 'Arrancando Automation Center'
    if ((Invoke-ApNative "$dq $dc up -d" $RepoRoot) -ne 0) { exit 1 }
    foreach ($c in $script:AP_CONTAINERS) {
      if (Wait-ContainerHealthy $docker.path $c 180) { Write-ApOk "$c healthy" } else { Write-ApWarn "$c no healthy todavía" }
    }
    Write-ApOk "Panel: http://localhost:$fPort"
  }
  'stop' {
    Write-ApStep 'Parando Automation Center (los datos se conservan)'
    Invoke-ApNative "$dq $dc stop" $RepoRoot | Out-Null
    Write-ApOk 'Parado'
  }
  'restart' {
    Write-ApStep 'Reiniciando Automation Center'
    Invoke-ApNative "$dq $dc restart" $RepoRoot | Out-Null
    Write-ApOk 'Reiniciado'
  }
  'open' { Start-Process "http://localhost:$fPort" }
  'logs' {
    $log = $script:AP_LOG
    Write-Host "install.log: $log"
    Start-Process notepad.exe $log -ErrorAction SilentlyContinue
    & $env:ComSpec /c "$dq $dc logs --tail=120"
  }
  'status' {
    Write-ApStep 'Estado de Automation Center'
    & $env:ComSpec /c "$dq $dc ps"
    Write-Host ''
    $wf = Get-N8nWorkflowCount -DockerExe $docker.path -Cwd $RepoRoot
    Write-Host ("  n8n workflow_entity : {0}" -f $(if ($wf -lt 0) {'?'} else {$wf}))
    Write-Host ("  backend /api/health : {0}" -f $(if (Test-HttpHealthy "http://localhost:$bPort/api/health") {'OK'} else {'DOWN'}))
    Write-Host ("  frontend            : {0}" -f $(if (Test-HttpHealthy "http://localhost:$fPort/")          {'OK'} else {'DOWN'}))
    Write-Host ("  n8n /healthz         : {0}" -f $(if (Test-HttpHealthy "http://localhost:$nPort/healthz")   {'OK'} else {'DOWN'}))
  }
}
exit 0
