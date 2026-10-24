# DÉPLOIEMENT RAPIDE — Cloudflare Tunnel (0 €, §33)

Plateforme exposée en HTTPS public depuis ta machine, sans serveur.

## 1. Installer cloudflared (une fois)
Télécharger : https://developers.cloudflare.com/cloudflare/one-page/tunnel/local-management/
(Windows amd64 .msi) puis vérifier : `cloudflared --version`

## 2. Redémarrer la plateforme en mode production (obligatoire pour l'exposition)
```bash
# arrêter l'instance actuelle (elle a 14h, elle n'a pas les routes d'aujourd'hui)
# puis, à la racine du dépôt :
set NODE_ENV=production && node dist/apps/api/src/server.js
```
⚠ En production, l'auth est fail-closed : créer un compte via le Studio
(écran de connexion) ou `POST /auth/signup` — les en-têtes dev (x-tenant-id)
sont ignorés.

## 3. Ouvrir le tunnel (compte Cloudflare gratuit requis, login navigateur)
```bash
cloudflared tunnel login
cloudflared tunnel create volaco
cloudflared tunnel run --url http://localhost:3000 volaco
```
→ Cloudflare affiche une URL `https://<id>.cfargotunnel.com` : c'est la
plateforme en public, HTTPS inclus.

## 4. Checklist de validation §33 (à cocher après ouverture)
- [ ] `https://<url>/health` répond `{"status":"ok"}` depuis un téléphone/autre réseau
- [ ] Login Studio fonctionne (JWT) depuis l'URL publique
- [ ] Génération d'un site de test complète (stream SSE + preview)
- [ ] Test de charge réel : `node scripts/load-test.mjs https://<url>`
- [ ] Latence mesurée depuis un réseau externe (p95 attendu < 300 ms)

## Limites connues (documentées)
- Machine hôte = ton PC (doit rester allumé) — pour de la prod continue : Fly.io
- Rate limiter par IP : les visiteurs partagent l'IP du tunnel → 600 req/min global
  (600 req/min/IP s'applique à l'IP cloudflared locale ; à ajuster si besoin)
- SQLite locale dans `.volaco-data/` — sauvegarde recommandée (copie du dossier)
