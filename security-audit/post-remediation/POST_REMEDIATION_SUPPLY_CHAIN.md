# AUDIT DE LA CHAÎNE D'APPROVISIONNEMENT (SUPPLY CHAIN)
## VOLACO-CORE — DÉPENDANCES, SOUS-RESSOURCES CDN ET INTÉGRITÉ DE BUILD

**Périmètre :** Monorepo complet `volaco-core` (`package.json`, scripts, dépendances CDN, pipeline TypeScript)  
**Date d'évaluation :** 11 Septembre 2026  

---

### 1. Dépendances de Runtime Node.js

Dans `package.json` à la racine :
```json
{
  "name": "volaco-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "node --test dist/**/*.test.js",
    "gate1:verify": "node scripts/run_gate1_tests.mjs",
    "gate2:verify": "node scripts/run_gate2_tests.mjs",
    "start": "node dist/apps/api/src/server.js"
  },
  "devDependencies": {
    "@types/node": "^26.4.1",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

* **Dépendances de production (`dependencies`) :** **AUCUNE (0 dépendance npm).**
  L'intégralité du backend (`apps/api` et `packages/core`) repose exclusivement sur les modules natifs Node.js :
  - `node:http` (Serveur HTTP)
  - `node:crypto` (HMAC, CSPRNG, timingSafeEqual, hachages SHA-256)
  - `node:fs` et `node:path` (Lecture de fichiers statiques)
  - `node:test` (Moteur de tests unitaire standard)
* **Évaluation du risque npm :** **ZÉRO RISQUE D'INJECTION DE PACKAGE RUNTIME.**
  L'absence de dépendances tierces élimine intégralement les attaques de type *Dependency Confusion*, *Typosquatting* ou compromission de compte npm en production backend.

---

### 2. Dépendances Frontend et Sous-Ressources CDN (SEC-011)

Dans l'en-tête de `apps/studio/index.html:8-35` :

| Ressource Externe | Fournisseur | Type | Attribut Integrity (SRI) | Crossorigin | Évaluation |
| :--- | :--- | :---: | :--- | :---: | :---: |
| **html2canvas 1.4.1** | Cloudflare CDNJS | JS | `sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA=="` | `anonymous` | **SÉCURISÉ** |
| **JSZip 3.10.1** | Cloudflare CDNJS | JS | `sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg=="` | `anonymous` | **SÉCURISÉ** |
| **FontAwesome 6.4.0**| Cloudflare CDNJS | CSS | `sha512-iecdLmaskl7CVkqkXNQ/ZH/XLlvWZOJyj7Yy7tcenmpD1ypASozpmT/E0iPtmFIB46ZmdtAc9eNBvH0H/ZpiBw=="` | `anonymous` | **SÉCURISÉ** |
| **Tailwind CDN** | `cdn.tailwindcss.com` | JS | **ABSENT** | N/A | **RISQUE FAIBLE** |
| **Google Fonts** | `fonts.googleapis.com` | CSS/Font | Absent (Stylesheets dynamiques) | N/A | **ACCEPTABLE** |

* **Observation critique :**
  Le script dynamique `https://cdn.tailwindcss.com` est utilisé comme solution de secours en cas d'absence de la bibliothèque locale `tailwindcss.min.js`. Ce script étant généré à la volée par Tailwind Labs, aucun hash statique SRI ne peut lui être appliqué.
* **Recommandation :**
  Embarquer systématiquement une version pré-compilée statique de Tailwind CSS dans le répertoire des fichiers statiques locaux pour éliminer tout recours à `cdn.tailwindcss.com`.

---

### 3. Intégrité du Pipeline de Compilation

* **Compilateur TypeScript :** `tsc` officiel (v5.4.5) configuré en mode strict (`strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `exactOptionalPropertyTypes: true`).
* **Qualité du code compilé :** Aucune erreur de typage (`0 noEmit errors`), préservation des types et des vérifications strictes à l'exécution.
* **Source Maps :** Les source maps sont générées pour le débogage local (`"sourceMap": true`), mais ne contiennent aucune donnée confidentielle ni secret.
