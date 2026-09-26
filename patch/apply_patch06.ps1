$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $root ("patch-backup-06-" + $stamp)
New-Item -ItemType Directory -Force -Path $backup | Out-Null
foreach ($rel in @("apps/api/src/server.ts","dist/apps/api/src/server.js")) {
  $dst=Join-Path $root $rel; if (-not (Test-Path $dst)) { throw "Missing target: $rel" }
  $bak=Join-Path $backup $rel; New-Item -ItemType Directory -Force -Path (Split-Path $bak) | Out-Null; Copy-Item $dst $bak -Force
  $src=Join-Path $PSScriptRoot $rel; Copy-Item $src $dst -Force
}
Write-Host "PATCH 06 applied. Backup: $backup"
Write-Host "DO NOT run npm run build. DO NOT delete dist."
