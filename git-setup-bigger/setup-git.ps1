Write-Host "=== Initialisation Git pour VibeCode Studio ===" -ForegroundColor Cyan
if (-not (Test-Path "package.json")) {
    Write-Host "Erreur: lance ce script depuis le dossier volaco-core/" -ForegroundColor Red
    exit 1
}
Write-Host "Copie du .gitignore..." -ForegroundColor Yellow
Copy-Item -Path ".\git-setup-bigger\.gitignore" -Destination ".\.gitignore" -Force
Write-Host "git init..." -ForegroundColor Yellow
git init 2>$null | Out-Null
git config user.email "studio@volaco.local"
git config user.name "VibeCode Studio"
$envCheck = git check-ignore -v .env 2>&1
if ($envCheck) { Write-Host "OK: .env sera ignore" -ForegroundColor Green }
else { Write-Host "ATTENTION: .env n'est pas ignore" -ForegroundColor Red }
Write-Host "git add..." -ForegroundColor Yellow
git add -A
Write-Host "git commit..." -ForegroundColor Yellow
git commit -m "feat: initial commit - VibeCode Studio with streaming SSE, sections, Google Stitch effect"
Write-Host "=== Succes ! Git initialise ===" -ForegroundColor Green
git log --oneline | Select-Object -First 1
