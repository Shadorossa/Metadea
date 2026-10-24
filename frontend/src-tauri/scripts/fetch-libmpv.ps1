# Downloads the pinned LGPL libmpv build and places libmpv-2.dll in
# src-tauri/resources/, which tauri.conf.json lists under bundle.resources.
# The DLL is git-ignored (100 MB), so every fresh checkout — CI included —
# runs this before `cargo build` / `tauri build`, or the build script fails
# with "resource path `resources\libmpv-2.dll` doesn't exist".
#
# Usage: powershell -File scripts/fetch-libmpv.ps1 [-Force]
# Bump both the URL and the hash together when updating mpv. zhongfly prunes
# releases after a few weeks, so a 404 here means the pin needs bumping to a
# current mpv-dev-lgpl-x86_64 build from
# https://github.com/zhongfly/mpv-winbuild/releases.
param([switch]$Force)

$ErrorActionPreference = 'Stop'

$Url  = 'https://github.com/zhongfly/mpv-winbuild/releases/download/2026-10-24-703e59b0ec/mpv-dev-lgpl-x86_64-20261024-git-703e59b0ec.7z'
$Sha256 = '3d38ea53f3f53d51d5b6090926ce27b1148ca7a32e95593e05859f92f4093668'

$root = Split-Path -Parent $PSScriptRoot
$resources = Join-Path $root 'resources'
$dll = Join-Path $resources 'libmpv-2.dll'

if ((Test-Path $dll) -and -not $Force) {
  Write-Host "libmpv-2.dll already present at $dll"
  exit 0
}

New-Item -ItemType Directory -Force $resources | Out-Null
$archive = Join-Path ([System.IO.Path]::GetTempPath()) 'metadea-libmpv.7z'
# GitHub's release CDN occasionally drops long downloads mid-transfer ("The
# connection was closed unexpectedly"), so retry with backoff. curl.exe (on
# every Windows 10+ box and CI runner) is preferred over Invoke-WebRequest,
# which is slow in Windows PowerShell 5.1 and has no retry of its own.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
$attempts = 5
for ($i = 1; ; $i++) {
  Write-Host "Downloading $Url (attempt $i/$attempts)"
  try {
    if (Test-Path $archive) { Remove-Item $archive -Force }
    if ($curl) {
      & $curl.Source -fsSL --connect-timeout 30 -o $archive $Url
      if ($LASTEXITCODE -ne 0) { throw "curl exited with code $LASTEXITCODE" }
    } else {
      Invoke-WebRequest -Uri $Url -OutFile $archive -UseBasicParsing
    }
    break
  } catch {
    if ($i -ge $attempts) { throw }
    $delay = [math]::Pow(2, $i)
    Write-Warning "Download failed: $($_.Exception.Message); retrying in ${delay}s"
    Start-Sleep -Seconds $delay
  }
}

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
