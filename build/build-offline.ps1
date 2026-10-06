<#
.SYNOPSIS
  Construye Personal-Assistant-Setup-Full.exe: UN solo instalador con TODO dentro
  (código, workflows y las imágenes de Docker ya construidas). Instala sin
  descargar ni compilar nada.

.DESCRIPTION
  1. Construye las imágenes del producto desde el código fuente.
  2. Se asegura de tener las imágenes de n8n y PostgreSQL fijadas en el compose.
  3. `docker save` + gzip  ->  dist\offline\images.tar.gz   (~1,3 GB)
  4. Compila el instalador con /DOffline=1: incluye ese fichero y el instalador,
     al ejecutarse, hace `docker load` en vez de `docker compose build`.

  Lo único que NO puede ir dentro es Docker Desktop (licencia y tamaño): sigue
  siendo el único requisito previo. Todo lo demás viaja en el .exe.

.PARAMETER SkipBuild
  Reutiliza las imágenes que ya existan en este equipo (no reconstruye).
#>
[CmdletBinding()]
param([switch]$SkipBuild, [string]$Iscc)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Version  = (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim()
$Dist     = Join-Path $RepoRoot 'dist'
$OffDir   = Join-Path $Dist 'offline'
$Tar      = Join-Path $OffDir 'images.tar'
$Gz       = Join-Path $OffDir 'images.tar.gz'
New-Item -ItemType Directory -Force -Path $OffDir | Out-Null

$images = @(
  'pa-automation-center-backend:local',
  'pa-automation-center-frontend:local',
  'pa-profile:local',
  'pa-playwright-scraper:local',
  'postgres:16-alpine',
  'n8nio/n8n:1.121.3'
)

# El compose es la fuente de verdad: si cambia una imagen, este script avisa.
$composeImages = (Get-Content (Join-Path $RepoRoot 'docker-compose.yml') | Select-String '^\s+image:\s*(\S+)' |
  ForEach-Object { $_.Matches[0].Groups[1].Value }) | Where-Object { $_ -notlike '*$*' } | Sort-Object -Unique
$missingFromList = $composeImages | Where-Object { $images -notcontains $_ }
if ($missingFromList) { throw "docker-compose.yml usa imágenes que build-offline.ps1 no empaqueta: $($missingFromList -join ', ')" }

if (-not $SkipBuild) {
  Write-Host '==> Construyendo imágenes desde el código fuente' -ForegroundColor Cyan
  $envFile = Join-Path $RepoRoot '.env.example'
  & docker compose --project-directory $RepoRoot -f (Join-Path $RepoRoot 'docker-compose.yml') --env-file $envFile build
  if ($LASTEXITCODE -ne 0) { throw 'docker compose build falló' }
}
foreach ($i in $images) {
  & docker image inspect $i *> $null
  if ($LASTEXITCODE -ne 0) {
    if ($i -like 'pa-*') { throw "Falta la imagen $i (ejecuta sin -SkipBuild)." }
    Write-Host "==> Descargando $i" -ForegroundColor Cyan
    & docker pull $i
    if ($LASTEXITCODE -ne 0) { throw "docker pull $i falló" }
  }
}

Write-Host '==> docker save (varios GB, tarda un par de minutos)' -ForegroundColor Cyan
Remove-Item $Tar, $Gz -ErrorAction SilentlyContinue
& docker save -o $Tar @images
if ($LASTEXITCODE -ne 0) { throw 'docker save falló' }

Write-Host '==> Comprimiendo (gzip)' -ForegroundColor Cyan
$in  = [IO.File]::OpenRead($Tar)
$out = [IO.File]::Create($Gz)
$zip = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Optimal)
try { $in.CopyTo($zip, 4MB) } finally { $zip.Dispose(); $out.Dispose(); $in.Dispose() }
Remove-Item $Tar -Force
"{0:N0} bytes  {1}" -f (Get-Item $Gz).Length, $Gz | Write-Host

if (-not $Iscc) {
  $Iscc = @((Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
            (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Iscc) { throw 'ISCC.exe no encontrado (winget install JRSoftware.InnoSetup).' }

Write-Host "==> Compilando Personal-Assistant-Setup-Full.exe  (v$Version)" -ForegroundColor Cyan
& $Iscc "/DAppVersion=$Version" '/DOffline=1' (Join-Path $RepoRoot 'installer\windows\PersonalAssistant.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC devolvió $LASTEXITCODE" }

$exe = Join-Path $Dist 'Personal-Assistant-Setup-Full.exe'
if (-not (Test-Path $exe)) { throw "No se generó $exe" }
$sha = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
"$sha  Personal-Assistant-Setup-Full.exe" | Set-Content "$exe.sha256" -Encoding ascii
Write-Host ''
Write-Host "==> OK  $exe" -ForegroundColor Green
Write-Host ("    {0:N0} bytes   sha256={1}" -f (Get-Item $exe).Length, $sha)
