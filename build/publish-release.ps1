<#
.SYNOPSIS
  Sube el instalador completo a GitHub Releases (como BORRADOR).

.DESCRIPTION
  Crea la Release `v<VERSION>` en modo borrador y le adjunta:
    - Personal-Assistant-Setup-Full.exe   (todo dentro, ~1,3 GB)
    - Personal-Assistant-Setup.exe        (instalador ligero)
    - los .sha256 de ambos
  Es un BORRADOR: no es público hasta que pulses "Publish release" en GitHub.
  El límite de GitHub por fichero de una Release es 2 GB; el Full pesa ~1,3 GB.

  Autenticación (una de las dos, nunca en la línea de comandos ni en un fichero):
    1. GitHub CLI:  gh auth login      (si `gh` está instalado, se usa)
    2. Variable de entorno GITHUB_TOKEN con un token (fine-grained, permiso
       "Contents: Read and write" solo sobre este repositorio).

  Crear la Release crea también el tag vX.Y.Z, y un tag vX.Y.Z dispara el
  workflow .github/workflows/release.yml (tests + artefactos). Es lo esperado;
  si no quieres ese CI, no publiques con tag: sube los ficheros a mano desde la web.

.PARAMETER Repo
  owner/nombre. Por defecto, el repositorio actual de GitHub.

.PARAMETER DryRun
  Comprueba ficheros, versión y sumas SHA-256 y muestra lo que haría. No toca la red.
#>
[CmdletBinding()]
param([string]$Repo = 'alexmogadesantiago/PERSONAL-ASSISTENT-APP', [switch]$DryRun)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Version  = (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim()
$Tag      = "v$Version"
$Dist     = Join-Path $RepoRoot 'dist'
$Assets   = @('Personal-Assistant-Setup-Full.exe', 'Personal-Assistant-Setup.exe') | ForEach-Object {
  [pscustomobject]@{ Name = $_; Path = Join-Path $Dist $_ }
}

# --- 1. Los ficheros existen y su suma coincide con el .sha256 ----------------
foreach ($a in $Assets) {
  if (-not (Test-Path $a.Path)) { throw "Falta $($a.Path). Genera el instalador (build-exe.ps1 / build-offline.ps1)." }
  $expected = ((Get-Content "$($a.Path).sha256" -Raw) -split '\s+')[0].ToLower()
  $actual   = (Get-FileHash $a.Path -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw "$($a.Name): la suma SHA-256 no coincide con su .sha256. Reconstruye el instalador." }
  $a | Add-Member -NotePropertyName Size -NotePropertyValue (Get-Item $a.Path).Length
  $a | Add-Member -NotePropertyName Sha  -NotePropertyValue $actual
  if ($a.Size -gt 2GB) { throw "$($a.Name) supera los 2 GB que admite una Release de GitHub." }
  Write-Host ("OK  {0,-38} {1,14:N0} bytes  {2}" -f $a.Name, $a.Size, $a.Sha.Substring(0, 12))
}
$exeVersion = (Get-Item ($Assets[0].Path)).VersionInfo.ProductVersion
Write-Host "Versión del fichero VERSION: $Version   (producto del .exe: $exeVersion)"
if ($exeVersion -and $exeVersion -notlike "$Version*") { throw "El .exe es de la versión $exeVersion y VERSION dice $Version." }

$notes = @"
## Personal Assistant $Version

Un asistente personal con IA que corre **entero en tu PC** (Windows + Docker Desktop):
lee y prioriza tu correo y explica por qué, conoce tu día y tu calendario, propone
acciones que **tú confirmas**, te habla por Telegram y automatiza con n8n sin que
tengas que abrirlo.

### Cuál descargar
| Fichero | Para qué |
|---|---|
| **Personal-Assistant-Setup-Full.exe** (~1,3 GB) | **Todo dentro**: instala sin internet y sin compilar. Recomendado. |
| Personal-Assistant-Setup.exe (~2,6 MB) | Ligero: construye las imágenes en el primer arranque (necesita internet). |

Requisito: **Docker Desktop** instalado (no puede ir dentro). Actualiza una instalación
existente haciendo antes un backup ``pre-upgrade``; tus datos no se tocan.

### Verifica la descarga
``````
$(($Assets | ForEach-Object { "$($_.Sha)  $($_.Name)" }) -join "`n")
``````
``Get-FileHash .\Personal-Assistant-Setup-Full.exe -Algorithm SHA256``

### Honestidad
Probado con servicios simulados (574 tests de backend, 178 de frontend, 120 del instalador)
y en solo lectura contra n8n, la API de Telegram y PostgreSQL reales. **Gmail y Gemini
no se han probado con cuentas reales**; ``scripts/real-check.py`` hace esa validación
cuando conectas tus servicios. Detalle en docs/TESTING.md y docs/V3-AUDIT.md.

El instalador no está firmado: Windows SmartScreen puede avisar ("Más información" → "Ejecutar de todos modos").
"@

if ($DryRun) {
  Write-Host ''
  Write-Host "DRY RUN - no se contacta con GitHub. Haría:" -ForegroundColor Yellow
  Write-Host "  1. crear la Release BORRADOR $Tag en $Repo"
  foreach ($a in $Assets) { Write-Host "  2. subir $($a.Name) y $($a.Name).sha256" }
  Write-Host "  3. dejarla en borrador para que la revises y pulses Publish"
  Write-Host ''
  Write-Host '--- notas de la release ---'
  Write-Host $notes
  return
}

# --- 2. Crear el borrador y subir -------------------------------------------
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
  & gh auth status *> $null
  if ($LASTEXITCODE -ne 0) { throw 'gh no tiene sesión: ejecuta `gh auth login`.' }
  $files = $Assets | ForEach-Object { $_.Path; "$($_.Path).sha256" }
  $notesFile = Join-Path $env:TEMP "pa-release-notes-$Version.md"
  Set-Content $notesFile $notes -Encoding utf8
  & gh release create $Tag @files --repo $Repo --draft --title "Personal Assistant $Version" --notes-file $notesFile
  if ($LASTEXITCODE -ne 0) { throw 'gh release create falló' }
  Remove-Item $notesFile -ErrorAction SilentlyContinue
} else {
  if (-not $env:GITHUB_TOKEN) { throw 'No hay `gh` ni la variable GITHUB_TOKEN. Instala GitHub CLI (winget install GitHub.cli) y haz `gh auth login`, o define GITHUB_TOKEN.' }
  $hdr = @{ Authorization = "Bearer $($env:GITHUB_TOKEN)"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
  $body = @{ tag_name = $Tag; name = "Personal Assistant $Version"; body = $notes; draft = $true; prerelease = $false; target_commitish = 'main' } | ConvertTo-Json
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repo/releases" -Headers $hdr -Body $body -ContentType 'application/json'
  $upload = ($rel.upload_url -replace '\{.*$', '')
  foreach ($a in $Assets) {
    foreach ($f in @($a.Path, "$($a.Path).sha256")) {
      $name = [IO.Path]::GetFileName($f)
      Write-Host "Subiendo $name ..." -ForegroundColor Cyan
      # curl.exe (incluido en Windows 10+) sube en streaming; no carga 1,3 GB en memoria.
      & curl.exe -sS --fail -X POST -H "Authorization: Bearer $($env:GITHUB_TOKEN)" -H 'Content-Type: application/octet-stream' `
        --data-binary "@$f" "$upload`?name=$name" -o NUL
      if ($LASTEXITCODE -ne 0) { throw "La subida de $name falló" }
    }
  }
  Write-Host "Borrador creado: $($rel.html_url)"
}
Write-Host ''
Write-Host "==> Borrador $Tag listo. Revísalo en GitHub y pulsa 'Publish release'." -ForegroundColor Green
