# Lance le serveur VibeCode Studio.
#
# SÉCURITÉ : aucune clé API ne doit être écrite dans ce fichier — il est
# versionné dans git. La clé Mistral est chargée depuis le fichier .env
# (non versionné) par le serveur lui-même (process.loadEnvFile).

Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process -FilePath "node" -ArgumentList "dist\apps\api\src\server.js" -RedirectStandardOutput "server.log" -RedirectStandardError "server-err.log" -NoNewWindow
Start-Sleep -Seconds 3
Invoke-RestMethod -Uri "http://127.0.0.1:3000/health"
Write-Host "Serveur demarre (cle IA chargee depuis .env)" -ForegroundColor Green
