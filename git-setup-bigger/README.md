# Git Setup pour VibeCode Studio

Ce zip contient le .gitignore et le script PowerShell pour initialiser Git dans le projet VibeCode Studio.

## Procédure

1. Dézippe ce fichier dans le dossier racine du projet (volaco-core/)
2. Lance PowerShell dans ce dossier
3. Exécute : .\git-setup-bigger\setup-git.ps1

Le script va :
- Copier le .gitignore
- Initialiser Git (git init)
- Configurer user.email et user.name
- Vérifier que .env est ignoré (clé Mistral sécurisée)
- Faire le premier commit

## Important

Le .gitignore utilise l'encodage ASCII (pas UTF-8) pour éviter le problème de BOM
qui faisait planter process.loadEnvFile() de Node.js.
