<#
.SYNOPSIS
  Compila el instalador nativo Personal-Assistant-Setup.exe con Inno Setup.

.DESCRIPTION
  Fuente única de versión: el fichero VERSION en la raíz. Se pasa a ISCC como
  /DAppVersion. Busca ISCC.exe en las rutas habituales o en PATH.
  Salida:  dist\Personal-Assistant-Setup.exe  +  dist\Personal-Assistant-Setup.exe.sha256

.PARAMETER Iscc
  Ruta a ISCC.exe (si no está en PATH ni en las rutas por defecto).

.PARAMETER Sign
  Firma el .exe si existe un certificado (variables WINDOWS_PFX_BASE64 /
  WINDOWS_PFX_PASSWORD). Sin certificado, avisa y sigue.
#>
[CmdletBinding()]
param([string]$Iscc, [switch]$Sign)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Version  = (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim()
$Iss      = Join-Path $RepoRoot 'installer\windows\PersonalAssistant.iss'
$DistDir  = Join-Path $RepoRoot 'dist'

if (-not $Iscc) {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
  )
  $Iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $Iscc) {
    $c = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($c) { $Iscc = $c.Source }
  }
}
if (-not $Iscc -or -not (Test-Path $Iscc)) {
  throw "ISCC.exe no encontrado. Instala Inno Setup 6: winget install JRSoftware.InnoSetup"
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
Write-Host "==> Compilando Personal-Assistant-Setup.exe  (v$Version)" -ForegroundColor Cyan
Write-Host "    ISCC: $Iscc"

& $Iscc "/DAppVersion=$Version" $Iss
if ($LASTEXITCODE -ne 0) { throw "ISCC devolvió $LASTEXITCODE" }

$exe = Join-Path $DistDir 'Personal-Assistant-Setup.exe'
if (-not (Test-Path $exe)) { throw "No se generó $exe" }

if ($Sign -and $env:WINDOWS_PFX_BASE64) {
  $pfx = Join-Path $env:TEMP 'ac-sign.pfx'
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_PFX_BASE64))
  $st = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($st) {
    & $st.FullName sign /f $pfx /p $env:WINDOWS_PFX_PASSWORD /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $exe
  } else { Write-Warning 'signtool.exe no encontrado; .exe sin firmar.' }
  Remove-Item $pfx -Force -ErrorAction SilentlyContinue
} elseif ($Sign) {
  Write-Warning 'Sin WINDOWS_PFX_BASE64: .exe SIN FIRMAR (BLOCKED BY: certificado de firma de código).'
}

$sha = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
"$sha  Personal-Assistant-Setup.exe" | Set-Content "$exe.sha256" -Encoding ascii

Write-Host ''
Write-Host "==> OK  $exe" -ForegroundColor Green
Write-Host ("    {0:N0} bytes   sha256={1}" -f (Get-Item $exe).Length, $sha)
