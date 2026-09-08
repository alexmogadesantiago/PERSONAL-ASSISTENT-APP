<#
.SYNOPSIS
  Copia de seguridad de Automation Center. NO destructivo.

.DESCRIPTION
  Guarda en %LOCALAPPDATA%\AutomationPlatform\backups\<timestamp>\ :
    - automation_center.dump   (pg_dump -Fc de la BD del backend)
    - n8n.dump                 (pg_dump -Fc de la BD de n8n; se preserva siempre)
    - n8n_data.tgz             (volumen de n8n: credenciales cifradas, settings)
    - env                      (.env - contiene secretos; permisos restringidos)
    - config/                  (perfil de usuario y catálogo)
    - workflows/               (los 4 workflows en JSON)
    - manifest.json            (versión, fechas, checksums, conteos)
  El stack puede estar en marcha: los dumps son consistentes.

.PARAMETER OutDir   Carpeta destino alternativa.
.PARAMETER Label    Sufijo legible para la carpeta (p.ej. "pre-upgrade").
#>
[CmdletBinding()]
param([string]$OutDir, [string]$Label)

. (Join-Path $PSScriptRoot 'common.ps1')
$RepoRoot = Get-RepoRoot

$docker = Get-DockerInfo
if (-not $docker.found -or -not $docker.running) {
  Write-ApLog -Level ERROR -Message 'Docker Desktop no está en marcha. Arráncalo y reintenta.'
  exit 2
}
if (-not (Test-ApContainerRunning $docker.path 'pa-postgres')) {
  Write-ApLog -Level ERROR -Message 'El contenedor pa-postgres no está en marcha; no se puede hacer backup de las BD.'
  exit 2
}

$envMap = Read-ApEnvMap $RepoRoot
$pgUser = if ($envMap.ContainsKey('POSTGRES_USER')) { $envMap['POSTGRES_USER'] } else { 'assistant' }
$pgPass = if ($envMap.ContainsKey('POSTGRES_PASSWORD')) { $envMap['POSTGRES_PASSWORD'] } else { '' }
$n8nDb  = if ($envMap.ContainsKey('POSTGRES_DB')) { $envMap['POSTGRES_DB'] } else { 'assistant' }
$Version = (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim()

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ($Label) { $stamp = "$stamp-$($Label -replace '[^A-Za-z0-9_.-]','_')" }
$dir = if ($OutDir) { Join-Path $OutDir $stamp } else { Join-Path (Get-ApBackupDir) $stamp }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$dq = '"' + $docker.path + '"'
$dc = Get-ApComposeArgs $RepoRoot

Write-ApStep "Backup -> $dir"

function Invoke-PgDump([string]$Db, [string]$File) {
  # Volcamos a un fichero DENTRO del contenedor y lo copiamos con `docker cp`
  # (evita corromper binario al pasarlo por una tubería de cmd.exe).
  $tmp = "/tmp/ac-backup-$Db.dump"
  $dump = "$dq $dc exec -T postgres sh -c ""PGPASSWORD='$pgPass' pg_dump -U $pgUser -Fc -d $Db -f $tmp"""
  if ((Invoke-ApNative $dump $RepoRoot) -ne 0) { throw "pg_dump de '$Db' falló." }
  if ((Invoke-ApNative "$dq $dc cp postgres:$tmp ""$File""" $RepoRoot) -ne 0) { throw "docker cp del dump de '$Db' falló." }
  Invoke-ApNative "$dq $dc exec -T postgres rm -f $tmp" $RepoRoot | Out-Null
  if (-not (Test-Path $File) -or (Get-Item $File).Length -lt 100) { throw "El dump de '$Db' quedó vacío." }
}

# automation_center (puede no existir aún en instalaciones muy antiguas)
$acExists = (Invoke-ApPsql -DockerExe $docker.path -Cwd $RepoRoot -Database 'postgres' `
  -Sql "SELECT 1 FROM pg_database WHERE datname='automation_center'").out -match '1'
if ($acExists) {
  Invoke-PgDump 'automation_center' (Join-Path $dir 'automation_center.dump')
  Write-ApOk 'automation_center.dump'
} else {
  Write-ApWarn 'automation_center no existe todavía; se omite su dump.'
}

Invoke-PgDump $n8nDb (Join-Path $dir 'n8n.dump')
Write-ApOk 'n8n.dump (BD de n8n preservada)'

# Volumen de n8n (credenciales cifradas + settings). --volumes-from evita
# depender del nombre exacto del volumen.
if (Test-ApContainerRunning $docker.path 'pa-n8n') {
  $q = "$dq run --rm --volumes-from pa-n8n -v ""$dir"":/backup alpine tar czf /backup/n8n_data.tgz -C /home/node/.n8n ."
  Invoke-ApNative $q $RepoRoot | Out-Null
  if (Test-Path (Join-Path $dir 'n8n_data.tgz')) { Write-ApOk 'n8n_data.tgz' }
} else {
  Write-ApWarn 'pa-n8n no está en marcha; se omite el volumen n8n_data.'
}

# Ficheros locales
# Los ficheros del usuario ya no estan junto al codigo, sino en el
# directorio de datos (%LOCALAPPDATA%\Personal Assistant).
Copy-Item (Get-ApEnvPath) (Join-Path $dir 'env') -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $dir 'env')) {
  # restringe el ACL: solo el usuario actual
  icacls (Join-Path $dir 'env') /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
}
Copy-Item (Get-ApConfigDir)                (Join-Path $dir 'config')    -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $RepoRoot 'workflows') (Join-Path $dir 'workflows') -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem (Join-Path $dir 'config') -Filter '*.example.json' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

$wf = Get-N8nWorkflowCount -DockerExe $docker.path -Cwd $RepoRoot
$manifest = [ordered]@{
  product        = 'automation-center'
  version        = $Version
  createdAt      = (Get-Date -Format o)
  n8nDatabase    = $n8nDb
  workflowCount  = $wf
  files          = @()
}
Get-ChildItem $dir -File | ForEach-Object {
  $manifest.files += [ordered]@{
    name = $_.Name; size = $_.Length
    sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
  }
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $dir 'manifest.json') -Encoding utf8

Write-Host ''
Write-ApLog -Level OK -Message "Backup completo: $dir"
if ($wf -ne 4) { Write-ApWarn "Aviso: workflow_entity = $wf (esperado 4)." }
Write-Output $dir
exit 0
