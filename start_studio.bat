@echo off
title VibeCode Studio Core Server
cls
echo ==================================================
echo       LANCEMENT DE VIBECODE STUDIO CORE
echo ==================================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable dans le PATH de Windows.
  echo Installez Node.js depuis https://nodejs.org puis relancez ce script.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installation des dependances ^(premiere fois seulement, peut prendre plusieurs minutes^)...
  call npm install
  if errorlevel 1 (
    echo [ERREUR] npm install a echoue. Voir les messages ci-dessus.
    pause
    exit /b 1
  )
)

echo Compilation du projet...
call npm run build
if errorlevel 1 (
  echo [ERREUR] La compilation a echoue. Voir les messages ci-dessus.
  pause
  exit /b 1
)

echo Demarrage du serveur HTTP et du moteur Core...
rem On ouvre le navigateur seulement quand le serveur repond vraiment
rem (au lieu d'attendre un temps fixe qui peut etre trop court ou trop long).
start "" powershell -NoProfile -WindowStyle Hidden -Command ^
  "$ok=$false; for ($i=0; $i -lt 60; $i++) { try { Invoke-WebRequest -Uri 'http://127.0.0.1:3000/health' -UseBasicParsing -TimeoutSec 1 | Out-Null; $ok=$true; break } catch { Start-Sleep -Seconds 1 } }; if ($ok) { Start-Process 'http://127.0.0.1:3000/' }"

node dist/apps/api/src/server.js
echo.
echo [Le serveur s'est arrete. Regardez les messages ci-dessus pour savoir pourquoi.]
pause
