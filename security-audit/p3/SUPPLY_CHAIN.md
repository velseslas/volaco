# AUDIT DE SUPPLY CHAIN & DÉPENDANCES — MISSION P3
**Composants :** `package.json`, CDN externes

---

## 1. Dépendances de Production (Runtime)
* `package.json` : **ZERO dépendance externe de production**.
* Seuls les modules natifs de Node.js (`node:http`, `node:crypto`, `node:fs`, `node:path`) sont utilisés pour le moteur d'exécution API.
* Excellente posture de sécurité vis-à-vis des risques de dependency confusion et d'empoisonnement de packages npm.

## 2. Dépendances Frontend (CDN)
* Le Studio charge des scripts et styles distants :
  - `cdn.tailwindcss.com`
  - `cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css`
  - `fonts.googleapis.com`
* Risque : Absence d'attributs `integrity` (Subresource Integrity - SRI). En cas de compromission d'un CDN, du code malveillant pourrait être injecté dans le Studio.
