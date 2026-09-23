# Downloads the pinned LGPL libmpv build and places libmpv-2.dll in
# src-tauri/resources/, which tauri.conf.json lists under bundle.resources.
# The DLL is git-ignored (100 MB), so every fresh checkout — CI included —
# runs this before `cargo build` / `tauri build`, or the build script fails
# with "resource path `resources\libmpv-2.dll` doesn't exist".
#
# Usage: powershell -File scripts/fetch-libmpv.ps1 [-Force]
# Bump both the URL and the hash together when updating mpv.
param([switch]$Force)

$ErrorActionPreference = 'Stop'

$Url  = 'https://github.com/zhongfly/mpv-winbuild/releases/download/2026-09-22-c646756799/mpv-dev-lgpl-x86_64-20260922-git-c646756799.7z'
$Sha256 = '55d86bb42c981e48188b7239b17928ae4b7cebe7f5a571a5c28d7903488f922c'

$root = Split-Path -Parent $PSScriptRoot
$resources = Join-Path $root 'resources'
$dll = Join-Path $resources 'libmpv-2.dll'

if ((Test-Path $dll) -and -not $Force) {
  Write-Host "libmpv-2.dll already present at $dll"
  exit 0
}

New-Item -ItemType Directory -Force $resources | Out-Null
$archive = Join-Path ([System.IO.Path]::GetTempPath()) 'metadea-libmpv.7z'
Write-Host "Downloading $Url"
Invoke-WebRequest -Uri $Url -OutFile $archive

$actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
if ($actual -ne $Sha256) {
  Remove-Item $archive -Force
  throw "libmpv archive hash mismatch: expected $Sha256, got $actual"
}

$sevenZip = Get-Command 7z -ErrorAction SilentlyContinue
if (-not $sevenZip) {
  $candidate = 'C:\Program Files\7-Zip\7z.exe'
  if (Test-Path $candidate) { $sevenZip = Get-Command $candidate } else { throw '7-Zip (7z) is required to extract the libmpv archive' }
}

& $sevenZip.Source e -y "-o$resources" $archive 'libmpv-2.dll' | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dll)) { throw 'Extracting libmpv-2.dll failed' }
Remove-Item $archive -Force
Write-Host "libmpv-2.dll ready at $dll"
