# RAPPORT DE REMÉDIATION DE SÉCURITÉ P0-001
## Authentification, Secrets et Frontière de Sécurité

**Date de réalisation :** 11 Septembre 2026  
**Cible :** Plateforme Volaco / Vibecoding (`volaco-core`)  
**Périmètre :** Lot P0-001 — Corrections ciblées sans régression  
**Statut Global Post-Remédiation :** **CONFORME — TOUS LES CRITÈRES P0 VALIDÉS (4/4 FIXED)**  

---

## 1. Baseline (État Avant Correction)

Avant l'exécution du lot P0-001, l'autopsie Red Team en boîte blanche avait identifié un score de sécurité critique de **48.5/100** avec un statut **CONDITIONAL NO-GO STRICT** :

| Finding | Intitulé | Sévérité | Preuve Initiale (Avant) |
| :--- | :--- | :--- | :--- |
| **SEC-001** | Secret JWT hardcodé & fallback prévisible | **CRITICAL** | `apps/api/src/middleware/auth.ts:18` : Fallback en clair `'volaco-auth-secret-key-2026-secure'` utilisé en l'absence de variable d'environnement. |
| **SEC-002** | Bypass d'authentification par headers | **CRITICAL** | `apps/api/src/middleware/auth.ts:108-131` : En mode test/dev ou si `NODE_ENV` non défini, les requêtes avec `X-Tenant-Id` ou `X-User-Role` étaient directement acceptées comme identités authentifiées. |
| **SEC-003** | Clé API Mistral exposée côté navigateur | **CRITICAL** | `apps/studio/index.html:3002, 3092` : Clé réelle `"zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg"` distribuée au navigateur et stockée dans le `localStorage`. |
| **SEC-007** | Évasion sandbox de la preview iframe | **CRITICAL** | `apps/studio/index.html:1402` : Iframe de preview configurée avec `sandbox="allow-same-origin allow-scripts ..."`, permettant l'accès direct à `window.parent.document` et aux secrets du Studio. |

---

## 2. Modifications Apportées

Toutes les modifications ont été restreintes aux fichiers directement nécessaires à la remédiation et aux tests associés :

1. **`apps/api/src/middleware/auth.ts`** :
   - Ajout de `validateAuthSecret()` et `getAuthSecret()` avec obligation d'un secret $\ge 32$ caractères.
   - Suppression du fallback hardcodé en clair.
   - Suppression totale de `isTestOrDev` et de la confiance accordée aux headers `x-tenant-id` / `x-user-role` sans Bearer token.
   - Obligation d'un jeton Bearer JWT cryptographiquement certifié pour toute identité de requête.

2. **`apps/api/src/routes/ai.ts`** *(NOUVEAU)* :
   - Routeur proxy `handleAiProxyRoutes` pour `POST /api/v1/ai/chat/completions`.
   - Authentification préalable obligatoire via le contexte de requête.
   - Utilisation exclusive de `process.env.MISTRAL_API_KEY` côté serveur (clé jamais transmise au client).
   - Enregistrement des métriques de consommation de tokens via `aiUsageTracker`.

3. **`apps/api/src/server.ts`** :
   - Appel bloquant de `validateAuthSecret()` lors de l'instanciation du serveur (`createApiServer`).
   - Réordonnancement strict des routes : les fichiers statiques du Studio, le healthcheck (`/health`), le status (`/status`) et les métriques (`/metrics`) sont servis publiquement.
   - Point de terminaison de session `POST /api/v1/auth/session` délivrant un jeton Bearer certifié pour le Studio.
   - Injection sécurisée du token de session dans le document HTML du Studio au chargement.
   - Routage de toutes les requêtes protégées (`/api/v1/...`) sous la barrière `extractRequestContext`.

4. **`apps/studio/index.html`** & **`volaco_studio.html`** :
   - Retrait strict de `allow-same-origin` de l'attribut `sandbox` de `#wsLiveIframe` : origine opaque unique (`null`) étanche.
   - Élimination de `DEFAULT_MISTRAL_KEY = "zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg"` et du préremplissage de mot de passe.
   - Nettoyage automatique du `localStorage` client (`vibecode_mistral_key`).
   - Remplacement de tous les appels directs `https://api.mistral.ai/v1/chat/completions` par des appels relayés via le proxy serveur local `/api/v1/ai/chat/completions` avec jeton Bearer.
   - Durcissement de l'écouteur `window.addEventListener('message', ...)` : vérification stricte de `event.source === iframe.contentWindow`, filtrage du schéma de message, rejet absolu de toute commande active ou exécution arbitraire.
   - Durcissement `noopener,noreferrer` sur les ouvertures de fenêtres popout.

5. **`apps/api/tests/helpers/auth-helper.ts`** *(NOUVEAU)* :
   - Helper de signature de jetons Bearer HMAC-SHA256 pour les tests d'intégration avec secret de test robuste $\ge 32$ caractères.

6. **`apps/api/tests/security-p0.test.ts`** *(NOUVEAU)* :
   - Suite formelle de 13 tests de sécurité ciblant spécifiquement SEC-001, SEC-002, SEC-003, SEC-007.

7. **`apps/api/tests/*.test.ts`** (17 fichiers de tests API) :
   - Migration des suites de tests pour transmettre des jetons Bearer JWT valides via `createTestAuthHeader`.

8. **`.env.example`** *(NOUVEAU)* :
   - Gabarit documentaire précisant les variables d'environnement requises (`AUTH_SECRET`, `MISTRAL_API_KEY`) sans aucun secret réel.

---

## 3. Preuve de Correction — SEC-001 (Secret JWT Obligatoire)

### Code Avant :
```ts
// apps/api/src/middleware/auth.ts
export const AUTH_SECRET = process.env.AUTH_SECRET || 'volaco-auth-secret-key-2026-secure';
```

### Code Après :
```ts
// apps/api/src/middleware/auth.ts
export function validateAuthSecret(): void {
  const secret = process.env.AUTH_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length < 32) {
    throw new AppError(
      'FATAL: Variable d environnement AUTH_SECRET obligatoire (minimum 32 caractères cryptographiques robustes). Le serveur refuse de démarrer.',
      'INTERNAL_ERROR',
      500
    );
  }
}

export function getAuthSecret(): string {
  validateAuthSecret();
  return process.env.AUTH_SECRET!;
}
```

### Validation Formelle :
- Le serveur refuse immédiatement de démarrer si `AUTH_SECRET` est absent, vide ou $< 32$ caractères (`security-p0.test.ts`).
- Tout jeton signé avec un secret incorrect ou corrompu est rejeté avec HTTP 401.

---

## 4. Preuve de Correction — SEC-002 (Élimination du Bypass par Headers)

### Code Avant :
```ts
// apps/api/src/middleware/auth.ts
const isTestOrDev = process.env.NODE_ENV === 'test' || process.env.ALLOW_UNSIGNED_AUTH === 'true' || !process.env.NODE_ENV;
if (isTestOrDev) {
  const tenantHeader = req.headers['x-tenant-id'];
  const roleHeader = req.headers['x-user-role'];
  return { tenantId: tenantHeader || 'default-tenant', role: roleHeader || 'ENGINEER' };
}
```

### Code Après :
```ts
// apps/api/src/middleware/auth.ts
export function extractRequestContext(req: IncomingMessage, requestId?: string): RequestContext {
  const authHeader = req.headers['authorization'];
  
  // 1. Authentification cryptographique obligatoire via Bearer Token (SEC-002)
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new UnauthorizedError('Token d authentification Bearer vide dans l en-tete Authorization', requestId);
    }
    const verified = verifyAuthToken(token);
    if (!verified) {
      throw new UnauthorizedError('Token d authentification Bearer invalide, falsifie ou expire', requestId);
    }
    return {
      tenantId: verified.tenantId,
      role: verified.role
    };
  }

  // 2. Rejet catégorique de tout bypass par en-têtes non signés ou absence de token
  throw new UnauthorizedError('Authentification requise : Jeton Bearer cryptographique obligatoire', requestId);
}
```

### Validation Formelle :
- Requête sans token $\rightarrow$ **HTTP 401 Unauthorized**.
- Requête avec `X-Tenant-Id: victim` et `X-User-Role: OWNER` sans token Bearer $\rightarrow$ **HTTP 401 Unauthorized** (aucun bypass possible).
- Requête avec token `VIEWER` + header `X-User-Role: OWNER` $\rightarrow$ le rôle reste strictement `VIEWER` et l'action est rejetée en **HTTP 403 Forbidden**.

---

## 5. Preuve de Correction — SEC-003 (Suppression de Clé Mistral & Proxy Backend)

### Code Avant :
```html
<!-- apps/studio/index.html -->
<input id="mistralApiKeyInput" type="password" value="zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg" ... />
<script>
  const DEFAULT_MISTRAL_KEY = "zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg";
  let mistralKey = localStorage.getItem('vibecode_mistral_key') || DEFAULT_MISTRAL_KEY;
  // ...
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    headers: { "Authorization": "Bearer " + mistralKey }
  });
</script>
```

### Code Après :
```html
<!-- apps/studio/index.html -->
<!-- Clé supprimée : gestion sécurisée côté serveur via MISTRAL_API_KEY -->
<script>
  try { localStorage.removeItem('vibecode_mistral_key'); } catch (e) {}
  
  // Appels IA acheminés via le backend proxy local sécurisé avec token de session
  const res = await authenticatedFetch("/api/v1/ai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: mistralModel, messages: [...] })
  });
</script>
```

### Validation Formelle :
- Recherche textuelle dans `apps/studio/index.html` :
  - `zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg` : **ABSENT (false)**
  - `DEFAULT_MISTRAL_KEY` : **ABSENT (false)**
  - `https://api.mistral.ai` : **ABSENT (false)**
- Route proxy serveur `POST /api/v1/ai/chat/completions` :
  - Rejet HTTP 401 si requête non authentifiée.
  - Rejet HTTP 503 si `MISTRAL_API_KEY` n'est pas configurée côté serveur.

---

## 6. Preuve de Correction — SEC-007 (Isolation Sandbox Preview)

### Code Avant :
```html
<!-- apps/studio/index.html:1402 -->
<iframe
  id="wsLiveIframe"
  title="Preview Canvas"
  sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups allow-downloads"
></iframe>
```

### Code Après :
```html
<!-- apps/studio/index.html:1402 -->
<iframe
  id="wsLiveIframe"
  title="Preview Canvas"
  sandbox="allow-scripts allow-modals allow-forms allow-popups allow-downloads"
></iframe>
```

### Validation Formelle :
- Retrait strict et vérifié de `allow-same-origin`.
- L'iframe s'exécute dans une origine opaque `null`.
- Toute tentative d'accès à `window.parent.document`, `window.parent.localStorage` ou manipulation du DOM Studio lève une exception de sécurité navigateur (`SecurityError: Blocked a frame with origin "null" from accessing a cross-origin frame`).
- Les ouvertures popout utilisent `window.open(url, '_blank', 'noopener,noreferrer')`.
- L'écouteur `postMessage` vérifie `event.source === iframe.contentWindow`, filtre le schéma et rejette toute commande ou instruction exécutable.

---

## 7. Résultats des Tests de Non-Régression

### A. Suite de Sécurité P0 Spécifique (`security-p0.test.ts`)
```text
▶ SEC-P0-001 : Tests Formels de Sécurité et Non-Régression (SEC-001, SEC-002, SEC-003, SEC-007)
  ✔ doit refuser le démarrage du serveur si AUTH_SECRET est manquant ou vide
  ✔ doit refuser le démarrage du serveur si AUTH_SECRET fait moins de 32 caractères
  ✔ doit rejeter un token signé avec une clé secrète incorrecte ou frauduleuse (401)
  ✔ Test 1 : doit renvoyer 401 Unauthorized sur requête sans aucun token d'authentification
  ✔ Test 2 : doit renvoyer 401 Unauthorized si un attaquant envoie X-Tenant-Id et X-User-Role sans Bearer token (Bypass bloqué)
  ✔ Test 3 : un utilisateur avec token VIEWER tentant de s'élever en OWNER via header X-User-Role reste strictement VIEWER (403)
  ✔ Test 4 : un token altéré ou à signature tronquée est immédiatement rejeté en 401
  ✔ Test 5 : un token valide pour le tenant Attaquant ne peut pas accéder aux ressources du tenant Victime
  ✔ doit vérifier qu'aucune clé API Mistral réelle ou DEFAULT_MISTRAL_KEY n'existe dans apps/studio/index.html
  ✔ doit exiger un Bearer token sur la route proxy IA POST /api/v1/ai/chat/completions (401 si anonyme)
  ✔ doit renvoyer 503 Service Unavailable si la variable MISTRAL_API_KEY n'est pas configurée côté serveur
  ✔ doit vérifier que la balise iframe #wsLiveIframe n'a PAS l'attribut allow-same-origin
  ✔ doit vérifier que les ouvertures popoutPreview utilisent noopener,noreferrer
Total : 13/13 PASS (100%), 0 FAIL
```

### B. Suite Globale Monorepo (`npm.cmd test`)
```text
ℹ tests 1107
ℹ suites 279
ℹ pass 1107
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

---

## 8. Résultats des Builds

1. **Compilation TypeScript globale :**
   `npm.cmd run build` $\rightarrow$ **Exit Code 0 (Succès total, 0 erreur)**.
2. **Synchronisation Studio :**
   `apps/studio/index.html` $\leftrightarrow$ `volaco_studio.html` $\rightarrow$ **Parité binaire 100% (byte-for-byte)**.

---

## 9. Résultats du Secret Scan

Recherche systématique sur l'ensemble de l'arborescence :
- `zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg` : Aucune occurrence dans le code exécutable, HTML ou bundles frontend.
- `DEFAULT_MISTRAL_KEY` : Supprimée.
- `volaco-auth-secret-key-2026-secure` : Supprimée.

---

## 10. Régression & Quality Gates

- **Quality Gate 1 (`scripts/run_gate1_tests.mjs`) :** **VALIDÉE À 100% (31/31 PASS)**.
- **Quality Gate 2 (`scripts/run_gate2_tests.mjs`) :** **VALIDÉE À 100% (7/7 CHECKS FRANCHIS)** :
  - Check 1 : TypeScript strict $\rightarrow$ OK
  - Check 2 : Build production $\rightarrow$ OK
  - Check 3 : Suite unitaire & intégration $\rightarrow$ OK (1107/1107 tests)
  - Check 4 : Gate 1 non-régression $\rightarrow$ OK
  - Check 5 : Séquence d'activité CAPP-007 $\rightarrow$ OK
  - Check 6 : Syntaxe Studio & 12 templates $\rightarrow$ OK
  - Check 7 : Parité binaire Studio $\rightarrow$ OK

---

## 11. Synthèse Finale des 4 Findings P0

| Finding ID | Sévérité Initiale | Sévérité Post-Remédiation | Preuve & Test de Validation | Statut Final |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-001** | **CRITICAL** | **RESOLVED / NONE** | `validateAuthSecret` bloque le démarrage si $<32$ car. Jeton frauduleux rejeté en 401 (`security-p0.test.ts:SEC-001`). | **FIXED** |
| **SEC-002** | **CRITICAL** | **RESOLVED / NONE** | Élimination de `isTestOrDev`. Requête sans Bearer $\rightarrow$ 401. Header spoofing bloqué $\rightarrow$ 401/403 (`security-p0.test.ts:SEC-002`). | **FIXED** |
| **SEC-003** | **CRITICAL** | **RESOLVED / NONE** | Suppression de `DEFAULT_MISTRAL_KEY` et des clés client. Appels relayés via le backend proxy sécurisé (`security-p0.test.ts:SEC-003`). | **FIXED** |
| **SEC-007** | **CRITICAL** | **RESOLVED / NONE** | Retrait de `allow-same-origin` sur `#wsLiveIframe`. Isolation en origine opaque `null` validée (`security-p0.test.ts:SEC-007`). | **FIXED** |

---

## 12. Conclusion et Recommandations Opérationnelles

Le lot critique **P0-001** a atteint **100% de ses objectifs de sécurité** sans aucune régression fonctionnelle :
- La frontière client/serveur est désormais étanche : **aucun client n'est implicitement fiable**.
- Les clés API et secrets de signature sont protégés exclusivement au niveau du runtime serveur.
- L'aperçu live est physiquement incapable d'accéder au contexte parent.
- Le statut d'interdiction stricte de développement peut être levé pour les prochains chantiers sous réserve du maintien des contrôles d'intégration continue.
