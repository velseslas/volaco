# ============================================================
# FIX-POPOUT - Application du correctif
# Bug: le bouton "Ouvrir dans un nouvel onglet" affichait une
# creation differente de celle du preview (double generation
# LLM + projet projects[0] au lieu du projet actif du Studio).
# ============================================================
# Usage :
#   powershell -ExecutionPolicy Bypass -File apply-fix-popout.ps1
#   ou avec chemin perso :
#   powershell -ExecutionPolicy Bypass -File apply-fix-popout.ps1 -TargetDir "C:\chemin\vers\volaco-core"
# ============================================================
param([string]$TargetDir = "")
$ErrorActionPreference = "Stop"

if (-not $TargetDir) {
  $TargetDir = Join-Path $env:USERPROFILE "Desktop\volcanoo"
}
if (-not (Test-Path $TargetDir)) {
  Write-Host "[ERREUR] Dossier cible introuvable : $TargetDir" -ForegroundColor Red
  Write-Host "Relancez avec -TargetDir ""C:\chemin\vers\volaco-core"""
  pause
  exit 1
}
Write-Host "Cible : $TargetDir" -ForegroundColor Cyan

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = Join-Path $TargetDir ("_backup-fix-popout-" + $stamp)
New-Item -ItemType Directory -Path $bak -Force | Out-Null

$files = @(
  "apps\studio\index.html",
  "apps\studio\preview-builder-app.js",
  "packages\core\tests\preview-builder\preview-final.test.ts",
  "packages\core\tests\preview-builder\preview-integration.test.ts"
)

foreach ($f in $files) {
  $src = Join-Path $PSScriptRoot $f
  $dst = Join-Path $TargetDir $f
  if (-not (Test-Path $src)) {
    Write-Host "[ERREUR] Fichier manquant dans le patch : $f" -ForegroundColor Red
    pause
    exit 1
  }
  if (Test-Path $dst) {
    $bakName = $f -replace '\\', '__'
    Copy-Item $dst (Join-Path $bak $bakName) -Force
  }
  $dstDir = Split-Path $dst -Parent
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
  Copy-Item $src $dst -Force
  Write-Host "[OK] $f remplace" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Correctif FIX-POPOUT applique ===" -ForegroundColor Green
Write-Host "Sauvegarde de l'ancien etat : $bak"
Write-Host ""
Write-Host "Etapes suivantes :"
Write-Host "  1. Redemarrez le serveur : .\start-vibecode.ps1 (ou start_studio.bat)"
Write-Host "  2. Dans le navigateur : Ctrl+F5 (vider le cache, le Studio est servi sans cache)"
Write-Host "  3. Verif : creez une app via le chat, puis 'Ouvrir dans un nouvel onglet'"
Write-Host "     -> l'onglet doit montrer LA MEME creation que le preview."
pause
