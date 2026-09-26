# PLAN DE REMÉDIATION POST-AUDIT (LOT P1-001)
## VOLACO-CORE — FEUILLE DE ROUTE VERS LE STATUT FINAL PRODUCTION-READY (GO)

**Date d'émission :** 11 Septembre 2026  
**Objectif :** Résoudre l'ensemble des vulnérabilités et faiblesses résiduelles identifiées lors de l'audit post-remédiation pour élever le score de sécurité de **81.5/100** à **> 98.0/100** et passer du statut **CONDITIONAL GO** au statut **🟢 GO PRODUCTION**.

---

### 1. Actions Prioritaires du Lot P1-001

#### Action 1 — Sécurisation du Rate Limiter & Élimination du Heap DoS (SEC-013)
* **Composant :** `apps/api/src/middleware/rate-limiter.ts`
* **Correctif à apporter :**
  1. **Confiance Proxy Conditionnelle :** N'extraire `X-Forwarded-For` que si l'IP de la socket distante appartient à une liste d'adresses de confiance (`TRUSTED_PROXIES` configurée via variable d'environnement). À défaut, utiliser exclusivement `req.socket.remoteAddress`.
  2. **Éviction LRU & Nettoyage Périodique :** Borner la taille de `this.buckets` (ex. maximum 10 000 entrées). Mettre en place un intervalle de nettoyage (`setInterval`) toutes les 60 secondes pour purger les buckets dont `now >= bucket.resetAt`.

#### Action 2 — Résolution Canonique des Chemins de Fichiers Statiques (SEC-005)
* **Composant :** `apps/api/src/server.ts:113-138`
* **Correctif à apporter :**
  Remplacer la vérification rudimentaire `!staticStudioFile.includes('..')` par une validation canonique étanche :
  ```typescript
  const studioRoot = resolve(process.cwd(), 'apps/studio');
  const targetPath = resolve(studioRoot, staticStudioFile);
  if (!targetPath.startsWith(studioRoot)) {
    res.statusCode = 403;
    res.end('Accès interdit : tentative de sortie de répertoire racine');
    return;
  }
  ```

#### Action 3 — Durcissement des Mutations Agentiques (SEC-009)
* **Composant :** `packages/core/src/ai-native/agent-runtime/execution/executor.ts:106-107`
* **Correctif à apporter :**
  Inverser la valeur par défaut pour interdire les suppressions et ruptures non approuvées :
  ```typescript
  const allowBreaking = canMutate && Boolean(stepParams.allowBreaking ?? false);
  const allowHighRisk = canMutate && Boolean(stepParams.allowHighRisk ?? false);
  ```
  Exiger un token de validation explicite signé par un rôle `ADMIN` ou `OWNER` pour toute mutation comportant `allowBreaking: true`.

#### Action 4 — Liaison de l'Auteur de Révision à l'Identité du Token (SEC-016)
* **Composant :** `apps/api/src/routes/revisions.ts:58`
* **Correctif à apporter :**
  Remplacer `author: payload.author || 'engineer'` par l'identité authentifiée du jeton :
  ```typescript
  author: context.role,
  ```
  Interdire à l'appelant de spécifier un auteur arbitraire dans le corps de la requête.

#### Action 5 — Confinement de l'Endpoint de Session (`POST /api/v1/auth/session`)
* **Composant :** `apps/api/src/server.ts:173-185`
* **Correctif à apporter :**
  Désactiver impérativement cet endpoint en environnement de production :
  ```typescript
  if (config.env === 'production') {
    throw new NotFoundError(pathname, requestId);
  }
  ```

#### Action 6 — Application Stricte des Limites Granulaires de Corps HTTP
* **Composants :** `apps/api/src/routes/projects.ts`, `terminal.ts`, `activity.ts`, `evolution.ts`
* **Correctif à apporter :**
  Remplacer les appels `readBody(req)` sans paramètre par `readBody(req, MAX_BODY_BYTES_DEFAULT, requestId)` (limite de 1 Mo pour le JSON) et réserver le plafond de 10 Mo (`MAX_BODY_BYTES_FILES`) exclusivement au transfert de contenu de fichiers dans `files.ts`.

#### Action 7 — Protection de l'Endpoint d'Observabilité `/metrics` (SEC-015)
* **Composant :** `apps/api/src/server.ts:164-170`
* **Correctif à apporter :**
  Déplacer l'accès à `/metrics` derrière la barrière d'authentification et exiger la permission `TENANT_MANAGE` ou réserver l'endpoint à une interface réseau locale d'administration (`127.0.0.1`).

---

### 2. Calendrier d'Exécution Recommandé

1. **Étape 1 (Immédiat) :** Poursuite du développement d'AINT-017 en environnement de développement local et tests continus.
2. **Étape 2 (Pré-Release Staging) :** Implémentation du lot **P1-001** (Actions 1 à 7 ci-dessus).
3. **Étape 3 (Contrôle Final) :** Ré-exécution de la suite offensive de 20 vecteurs et passage du verdict en **🟢 GO PRODUCTION**.
