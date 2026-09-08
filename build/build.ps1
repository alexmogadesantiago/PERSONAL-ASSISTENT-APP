<#
.SYNOPSIS
  Genera los artefactos distribuibles de Personal Assistant.

.DESCRIPTION
  El "producto" es el stack docker-compose + los scripts de instalación, que
  son independientes de la arquitectura. El build empaqueta el repositorio
  (sin .git, sin .env, sin datos generados) en un archivo por plataforma con
  el instalador adecuado, calcula el checksum y escribe un manifiesto.

  .deb / .exe nativo firmado -> ver .github/workflows/release.yml (CI).

.PARAMETER Targets
  Lista de destinos. Por defecto todos los zip/tar.gz.
  Valores: windows-x64 windows-arm64 linux-x64 linux-arm64 raspberrypi-arm64
#>
[CmdletBinding()]
param(
  [string[]] $Targets = @('windows-x64','windows-arm64','linux-x64','linux-arm64','raspberrypi-arm64')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Version  = (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim()
$DistDir  = Join-Path $RepoRoot 'dist'
$Stage    = Join-Path $env:TEMP "ap-build-$([guid]::NewGuid().ToString('N').Substring(0,8))"

# ficheros/carpetas que NO van en el paquete
$Exclude = @('.git','.env','dist','node_modules','.pytest_cache')

Write-Host "==> Personal Assistant build v$Version" -ForegroundColor Cyan
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) { throw "'tar' no disponible (Windows 10+ lo trae)." }
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

function Copy-Payload([string]$Dest) {
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  Get-ChildItem $RepoRoot -Force | Where-Object { $Exclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item $_.FullName -Destination $Dest -Recurse -Force
  }
  # nunca empaquetar borradores generados ni un .env real
  Get-ChildItem (Join-Path $Dest 'output') -Recurse -Filter *.md -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $Dest '.env') -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $Dest 'config\user_profile.json') -Force -ErrorAction SilentlyContinue
}

$manifest = @()
foreach ($t in $Targets) {
  $os, $arch = switch -Regex ($t) {
    '^windows-(.+)$'      { 'windows', $Matches[1]; break }
    '^linux-(.+)$'        { 'linux',   $Matches[1]; break }
    '^raspberrypi-(.+)$'  { 'linux',   $Matches[1]; break }
    default { throw "target desconocido: $t" }
  }
  $pkgName = "automation-platform-$Version-$t"
  $stageDir = Join-Path $Stage $pkgName
  Write-Host "  · $t" -ForegroundColor Gray
  Copy-Payload $stageDir

  # marca de plataforma dentro del paquete
  @{ version=$Version; target=$t; os=$os; arch=$arch; builtAt=(Get-Date -Format o) } |
    ConvertTo-Json | Set-Content (Join-Path $stageDir 'release.json') -Encoding utf8

  if ($os -eq 'windows') {
    $out = Join-Path $DistDir "$pkgName.zip"
    if (Test-Path $out) { Remove-Item $out -Force }
    Push-Location $Stage
    try { tar -a -c -f $out $pkgName } finally { Pop-Location }
  } else {
    $out = Join-Path $DistDir "$pkgName.tar.gz"
    if (Test-Path $out) { Remove-Item $out -Force }
    Push-Location $Stage
    try { tar -c -z -f $out $pkgName } finally { Pop-Location }
  }
  $sha = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
  "$sha  $(Split-Path $out -Leaf)" | Set-Content "$out.sha256" -Encoding ascii
  $manifest += [ordered]@{
    file = Split-Path $out -Leaf; target = $t; os = $os; arch = $arch
    size = (Get-Item $out).Length; sha256 = $sha
  }
  Remove-Item $stageDir -Recurse -Force
}

$release = [ordered]@{
  product = 'automation-platform'; version = $Version
  generatedAt = (Get-Date -Format o); artifacts = $manifest
  notes = '.deb y .exe nativo firmado se generan en CI (.github/workflows/release.yml)'
}
$release | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $DistDir "release-$Version.json") -Encoding utf8
Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "==> Artefactos en $DistDir :" -ForegroundColor Green
Get-ChildItem $DistDir | Where-Object { $_.Name -like "*$Version*" } | ForEach-Object {
  Write-Host ("   {0,-48} {1,10:N0} B" -f $_.Name, $_.Length)
}
