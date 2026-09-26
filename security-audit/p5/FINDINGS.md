# REGISTRE DÉTAILLÉ DES CONSTATATIONS D'AUDIT P5 (FINDINGS)

## Synthèse par Niveau de Gravité

| Sévérité | Nombre | Statut |
|---|:---:|:---:|
| **CRITICAL / HIGH** | 1 | **À CORRIGER AVANT PRODUCTION** |
| **MEDIUM** | 3 | **À CORRIGER (PRIORITÉ HAUTE)** |
| **LOW** | 2 | **À AMÉLIORER** |
| **INFO** | 1 | Recommandation |

---

### FINDING P5-CRIT-01 : Déni de Service Inter-Locataires par Falsification de Signature JWT
- **ID :** P5-CRIT-01
- **Severity :** HIGH / CRITICAL
- **Confidence :** VERIFIED (100% Reproductible)
- **Attack surface :** Toutes les routes protégées par rate limiting (`/api/v1/projects`, `/api/v1/files/*`, etc.)
- **Exact target :** `apps/api/src/middleware/rate-limiter.ts` (méthode `getTenantId`)
- **Evidence :** Script `test_ratelimit_jwt_vuln.cjs` bloquant le locataire légitime avec HTTP 429.
- **Reproduction :** Envoyer 120 requêtes avec un token forgé ayant le `tenantId` de la victime et une fausse signature.
- **Expected secure behavior :** Les jetons dont la signature est invalide ne doivent jamais consommer le quota d'un locataire.
- **Observed behavior :** Le quota est décrémenté sur simple décodage du base64url du payload.
- **Impact :** Déni de service complet sur n'importe quel locataire ciblé sans authentification valide.
- **Recommended remediation :** Remplacer le décodage non vérifié par un appel formel à `verifyAuthToken(token)`. Si le jeton est invalide, attribuer la requête au quota IP de l'attaquant et non au quota du locataire ciblé.
- **Status :** OPEN

### FINDING P5-MED-01 : Fuite d'Informations Système dans les Erreurs 500 (CWE-209)
- **ID :** P5-MED-01
- **Severity :** MEDIUM
- **Confidence :** VERIFIED
- **Attack surface :** Gestionnaire d'erreurs global de `apps/api/src/server.ts`
- **Exact target :** `server.ts` lignes 428-436
- **Evidence :** L'objet d'erreur envoyé au client contient `context.original` avec le message d'erreur brut.
- **Recommended remediation :** En environnement de production (`config.env === 'production'`), ne pas renvoyer `{ original: message }` dans le payload de réponse.
- **Status :** OPEN

### FINDING P5-MED-02 : Absence de Contrôle RBAC sur le Proxy IA
- **ID :** P5-MED-02
- **Severity :** MEDIUM
- **Confidence :** VERIFIED
- **Attack surface :** `POST /api/v1/ai/chat/completions`
- **Exact target :** `apps/api/src/routes/ai.ts`
- **Evidence :** Aucune vérification de permission `PROJECT_MUTATE` ou rôle minimum `ENGINEER`. Un simple `VIEWER` peut exécuter des requêtes IA.
- **Recommended remediation :** Exiger la permission `PROJECT_MUTATE` ou au minimum le rôle `ENGINEER` pour utiliser le proxy IA côté serveur.
- **Status :** OPEN

### FINDING P5-MED-03 : Absence de Condensats SRI sur les Templates du Studio
- **ID :** P5-MED-03
- **Severity :** MEDIUM
- **Confidence :** VERIFIED
- **Attack surface :** `apps/studio/index.html`
- **Exact target :** Balise gstatic et 12 templates intégrés
- **Evidence :** Présence d'appels à `https://cdn.tailwindcss.com` sans attribut `integrity`.
- **Recommended remediation :** Remplacer par des dépendances statiques locales ou fixer les condensats SHA-512.
- **Status :** OPEN

### FINDING P5-LOW-01 : Dérive des Quotas de Rate Limiting en Mode Multi-Instances
- **ID :** P5-LOW-01
- **Severity :** LOW
- **Confidence :** VERIFIED
- **Attack surface :** Déploiements cluster / multi-processus
- **Exact target :** `apps/api/src/middleware/rate-limiter.ts`
- **Evidence :** Script `test_multi_process.cjs` montrant des compteurs indépendants par processus.
- **Recommended remediation :** Implémenter un adaptateur Redis partagé pour les clusters de production.
- **Status :** OPEN

### FINDING P5-LOW-02 : Absence d'Imposition HTTPS Directe sans Variable Explicite
- **ID :** P5-LOW-02
- **Severity :** LOW
- **Confidence :** VERIFIED
- **Attack surface :** Configuration de déploiement
- **Exact target :** `server.ts` ligne 100
- **Evidence :** HTTP direct autorisé si `REQUIRE_HTTPS` n'est pas configuré.
- **Recommended remediation :** Forcer le rejet HTTP direct par défaut lorsque `NODE_ENV=production`.
- **Status :** OPEN
