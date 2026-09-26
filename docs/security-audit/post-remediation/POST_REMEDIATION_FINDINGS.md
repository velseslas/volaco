# REGISTRE OFFICIEL DES 16 FINDINGS RÉ-AUDITÉS
## POST-REMEDIATION SECURITY ASSESSMENT — VOLACO-CORE

**Périmètre :** Codebase réel `volaco-core`  
**Classification formelle :** `FIXED` | `PARTIALLY_FIXED` | `NOT_FIXED` | `REGRESSED` | `FALSE_POSITIVE`  

---

### SEC-001 — Clé secrète JWT par défaut codée en dur dans le code source
* **Classification :** **`FIXED`**
* **Composant :** Middleware d'authentification API (`apps/api/src/middleware/auth.ts:18-35` et `apps/api/src/server.ts:32`)
* **Preuve avant :**
  ```typescript
  export const AUTH_SECRET = process.env.AUTH_SECRET || 'volaco-auth-secret-key-2026-secure';
  ```
* **Preuve actuelle :**
  ```typescript
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
  ```
* **Mécanisme de protection :** `createApiServer()` invoque impérativement `validateAuthSecret()` avant toute écoute réseau. Si `AUTH_SECRET` est absent ou fait moins de 32 caractères, le processus Node.js s'arrête avec une exception fatale.
* **Bypass éventuel :** Aucun dans le runtime standard. Le calcul de signature HMAC-SHA256 utilise obligatoirement ce secret validé.
* **Test de régression :** `apps/api/tests/security/offensive-audit.test.ts` (Test 2) et `apps/api/tests/security-p0.test.ts`.
* **Niveau de risque résiduel :** Négligeable.

---

### SEC-002 — Contournement complet de l'authentification par en-têtes HTTP
* **Classification :** **`FIXED`** (avec observation architecturale sur `default-tenant`)
* **Composant :** Middleware d'authentification (`apps/api/src/middleware/auth.ts:111-132`)
* **Preuve avant :**
  ```typescript
  const isTestOrDev = process.env.NODE_ENV === 'test' || process.env.ALLOW_UNSIGNED_AUTH === 'true' || !process.env.NODE_ENV;
  if (isTestOrDev) {
    const tenantId = req.headers['x-tenant-id'] || 'tenant_default';
    const role = req.headers['x-user-role'] || 'ENGINEER';
    return { tenantId, role };
  }
  ```
* **Preuve actuelle :**
  ```typescript
  export function extractRequestContext(req: IncomingMessage, requestId?: string): RequestContext {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (!token) throw new UnauthorizedError('Token d authentification Bearer vide...', requestId);
      const verified = verifyAuthToken(token);
      if (!verified) throw new UnauthorizedError('Token d authentification Bearer invalide...', requestId);
      return { tenantId: verified.tenantId, role: verified.role };
    }
    throw new UnauthorizedError('Authentification requise : Jeton Bearer cryptographique obligatoire', requestId);
  }
  ```
* **Mécanisme de protection :** Les en-têtes non vérifiés `x-tenant-id` et `x-user-role` ne sont plus du tout consultés pour dériver l'identité. Seul un jeton Bearer signé valide est accepté.
* **Bypass éventuel :** Aucun bypass sur les routes sécurisées. Cependant, la route publique `POST /api/v1/auth/session` distribue un token `ENGINEER` pour `default-tenant` à toute personne en faisant la demande.
* **Test de régression :** `apps/api/tests/security/offensive-audit.test.ts` (Test 1).
* **Niveau de risque résiduel :** Faible (limité au périmètre de `default-tenant`).

---

### SEC-003 — Clé API Mistral de production exposée dans le code public
* **Classification :** **`FIXED`**
* **Composant :** Client Studio (`apps/studio/index.html`) & Proxy API (`apps/api/src/routes/ai.ts:74-203`)
* **Preuve avant :**
  ```html
  <input id="mistralApiKeyInput" type="password" value="zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg" onchange="saveMistralKey()">
  ```
* **Preuve actuelle :** La chaîne `zsvQFh3...` est absente du code distribué. `apps/studio/index.html:9714` effectue un appel authentifié vers `/api/v1/ai/chat/completions`. Côté serveur, la clé est lue exclusivement depuis `process.env.MISTRAL_API_KEY`.
* **Mécanisme de protection :** Masquage total de la clé vis-à-vis du navigateur ; délégation des appels via un proxy d'API avec authentification et suivi de consommation par tenant.
* **Bypass éventuel :** Aucun.
* **Test de régression :** `apps/api/tests/security-p0.test.ts` (assertion d'absence de la clé dans le fichier servi).
* **Niveau de risque résiduel :** Négligeable.

---

### SEC-004 — Configuration CORS permissive avec repli sur Wildcard (`*`)
* **Classification :** **`FIXED`**
* **Composant :** Serveur API HTTP (`apps/api/src/server.ts:47-78`)
* **Preuve avant :**
  ```typescript
  if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  ```
* **Preuve actuelle :**
  ```typescript
  const origin = req.headers.origin;
  const isDevOrTest = config.env !== 'production';
  const isLocalhostOrigin = origin ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) : false;
  const isExplicitlyAllowed = origin ? (config.allowedOrigins || []).includes(origin) : false;

  if (origin) {
    if (isExplicitlyAllowed || (isDevOrTest && isLocalhostOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
  }
  ```
* **Mécanisme de protection :** Suppression du wildcard `*`. Whitelist stricte via `ALLOWED_ORIGINS`. Rejet systématique avec code 403 des requêtes pré-vol `OPTIONS` avec origine non approuvée.
* **Bypass éventuel :** Aucun.
* **Test de régression :** `apps/api/tests/security/cors.test.ts` et `offensive-audit.test.ts` (Test 18).
* **Niveau de risque résiduel :** Négligeable.

---

### SEC-005 — Validation sommaire de path traversal dans la distribution statique
* **Classification :** **`NOT_FIXED`**
* **Composant :** Serveur de fichiers statiques (`apps/api/src/server.ts:113-138`)
* **Preuve avant :**
  ```typescript
  const staticStudioFile = pathname.replace(/^\//, '');
  if (staticStudioFile && !staticStudioFile.includes('..') && !pathname.startsWith('/api')) {
    const candidateAssetPaths = [
      join('C:/Users/FAYCAL/.../apps/studio', staticStudioFile),
      join(process.cwd(), 'apps/studio', staticStudioFile)
    ];
  ```
* **Preuve actuelle :** Le code est strictement identique à la preuve initiale. Aucune vérification canonique basée sur `path.resolve()` et comparaison de préfixe racine n'a été implémentée.
* **Mécanisme de protection :** Simple filtre textuel `!staticStudioFile.includes('..')`.
* **Bypass éventuel :** Sur système d'exploitation Windows, l'utilisation de séparateurs alternatifs ou de contournements de résolution de chemins pourrait permettre l'accès à des fichiers situés en dehors du répertoire désigné si le serveur n'utilise pas une validation canonique.
* **Test de régression :** Absent.
* **Niveau de risque résiduel :** Moyen.

---

### SEC-006 — Volatilité totale des stores de données en mémoire vive
* **Classification :** **`NOT_FIXED`** (Dette d'architecture)
* **Composant :** Moteurs de persistance (`FileStore`, `ProjectStore`, `RevisionStore`, `AuditStore`)
* **Preuve avant :** Maps en mémoire vive non sauvegardées sur disque.
* **Preuve actuelle :** Toutes les structures de données (`projectStore.projects`, `fileStore.projectFiles`, `revisionStore.revisions`, `auditStore.events`) restent de simples Maps en RAM.
* **Mécanisme de protection :** Aucun.
* **Impact :** Tout crash du processus ou redémarrage entraîne la perte intégrale des données et de l'historique médico-légal des locataires.
* **Niveau de risque résiduel :** Moyen.

---

### SEC-007 — Évasion de Sandbox Iframe via `allow-same-origin`
* **Classification :** **`FIXED`**
* **Composant :** Bac à sable Studio (`apps/studio/index.html:1402`)
* **Preuve avant :**
  ```html
  sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups allow-downloads"
  ```
* **Preuve actuelle :**
  ```html
  sandbox="allow-scripts allow-modals allow-forms allow-popups allow-downloads"
  ```
* **Mécanisme de protection :** La suppression de `allow-same-origin` confère à l'iframe une origine opaque (`null`). Elle ne peut en aucun cas interroger `window.parent` ni accéder aux cookies ou au `localStorage` du Studio hôte.
* **Bypass éventuel :** Aucun bypass de restriction DOM navigateur direct n'est possible sans `allow-same-origin`.
* **Test de régression :** `apps/api/tests/security/supply-chain.test.ts` et `offensive-audit.test.ts` (Test 15).
* **Niveau de risque résiduel :** Négligeable.

---

### SEC-008 — Popout Preview Blob URL ouvert sans `noopener noreferrer`
* **Classification :** **`FIXED`**
* **Composant :** Prévisualisation externe (`apps/studio/index.html:4804`)
* **Preuve avant :** `window.open(url, '_blank');`
* **Preuve actuelle :**
  ```javascript
  window.open(url, '_blank', 'noopener,noreferrer');
  ```
* **Mécanisme de protection :** Les attributs `noopener` et `noreferrer` détruisent la liaison `window.opener`, interdisant à la nouvelle fenêtre d'accéder au contexte de la fenêtre parent.
* **Bypass éventuel :** Aucun.
* **Test de régression :** `apps/api/tests/security/supply-chain.test.ts` (Test 4).
* **Niveau de risque résiduel :** Négligeable.

---

### SEC-009 — Forçage autonome des mutations destructives (`allowBreaking` & `allowHighRisk`)
* **Classification :** **`PARTIALLY_FIXED`**
* **Composant :** Exécuteur d'agent autonome (`packages/core/src/ai-native/agent-runtime/execution/executor.ts:103-118`)
* **Preuve avant :**
  ```typescript
  const mutResult = await this.mutationService.executePlan(
    planPayload,
    { dryRun: false, allowBreaking: true, allowHighRisk: true },
    context.userRole,
    context.requestId
  );
  ```
* **Preuve actuelle :**
  ```typescript
  const canMutate = hasPermission(context.userRole, 'PROJECT_MUTATE');
  const stepParams = (step.parameters || {}) as Record<string, unknown>;
  const ctxAny = context as unknown as Record<string, unknown>;
  const allowBreaking = canMutate && (stepParams.allowBreaking !== undefined ? Boolean(stepParams.allowBreaking) : (ctxAny.allowBreaking !== undefined ? Boolean(ctxAny.allowBreaking) : true));
  const allowHighRisk = canMutate && (stepParams.allowHighRisk !== undefined ? Boolean(stepParams.allowHighRisk) : (ctxAny.allowHighRisk !== undefined ? Boolean(ctxAny.allowHighRisk) : true));
  ```
* **Analyse critique :** Le rôle `VIEWER` est désormais bloqué (`canMutate === false`). Cependant, pour tout utilisateur ayant le droit de mutation (`ENGINEER`), si les paramètres ne précisent rien, `allowBreaking` et `allowHighRisk` valent **systématiquement `true` par défaut**.
* **Bypass éventuel :** Un agent d'IA ou une étape de plan autonome exécutée sous une session `ENGINEER` appliquera des changements destructifs majeurs sans solliciter d'approbation humaine préalable ni de confirmation `ADMIN`.
* **Niveau de risque résiduel :** Moyen.

---

### SEC-010 — Concaténation non assainie du prompt utilisateur vers le LLM
* **Classification :** **`PARTIALLY_FIXED`**
* **Composants :** Route serveur AI proxy (`apps/api/src/routes/ai.ts:28-64`) et client Studio (`apps/studio/index.html:9708`)
* **Preuve côté API (Corrigé) :** Tous les messages utilisateurs relayés par le proxy sont entourés de balises étanches `<user_input source="user_prompt">` et les balises internes sensibles sont neutralisées en `[neutralized-tag:...]`.
* **Preuve côté Studio (Non corrigé) :** Dans `apps/studio/index.html:9708`, la concaténation de chaînes est toujours présente (`const uPrompt = "Conçois l'application web complète suivante : " + text;`). De plus, le HTML retourné par l'IA est injecté directement dans l'éditeur et l'iframe sans assainissement syntaxique préalable.
* **Bypass éventuel :** Le modèle de langage peut toujours produire du code malveillant dans sa réponse, qui sera exécuté au sein de l'iframe de prévisualisation (bien que l'iframe soit isolée, cela peut affecter l'utilisateur dans son espace de test).
* **Niveau de risque résiduel :** Moyen.

---

### SEC-011 — Dépendances CDN externes chargées sans hash Subresource Integrity (SRI)
* **Classification :** **`PARTIALLY_FIXED`**
* **Composant :** En-tête du Studio (`apps/studio/index.html:8-33`)
* **Preuve actuelle :**
  - `html2canvas 1.4.1` : `integrity="sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA=="` (Présent)
  - `jszip 3.10.1` : `integrity="sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg=="` (Présent)
  - `FontAwesome 6.4.0` : `integrity="sha512-iecdLmaskl7CVkqkXNQ/ZH/XLlvWZOJyj7Yy7tcenmpD1ypASozpmT/E0iPtmFIB46ZmdtAc9eNBvH0H/ZpiBw=="` (Présent)
  - **Exception non couverte :** Le repli vers le CDN dynamique Tailwind (`https://cdn.tailwindcss.com` à la ligne 11) ne possède pas de hash SRI en raison de sa nature JIT non figée.
* **Niveau de risque résiduel :** Faible.

---

### SEC-012 — Omission du masquage des mots de passe dans les variables `DATABASE_URL`
* **Classification :** **`FIXED`**
* **Composant :** Service des paramètres (`packages/core/src/settings/service.ts:71-86`) et utilitaire de masquage (`packages/core/src/security/secrets.ts:11-17`)
* **Preuve actuelle :** `maskConnectionString()` est appliquée sur toute chaîne contenant un protocole SGBD (`postgres`, `mysql`, `mongodb`, `redis`, `amqp`, `mssql`) et `SENSITIVE_KEY_PATTERN` a été étendu à `DATABASE_URL`, `DB_URI`, `DSN`, etc.
* **Mécanisme de protection :** Remplacement systématique du mot de passe par `***` lors de la lecture des paramètres via l'API ou le frontend.
* **Bypass éventuel :** Aucun identifié pour les formats standards supportés.
* **Test de régression :** `apps/api/tests/security/secrets-settings.test.ts` (3/3 PASS).
* **Niveau de risque résiduel :** Négligeable.

---

### SEC-013 — Absence de Rate Limiting et vulnérabilité d'épuisement de tas RAM (Heap DoS)
* **Classification :** **`PARTIALLY_FIXED`**
* **Composant :** Middleware de limitation de débit (`apps/api/src/middleware/rate-limiter.ts`) & Gestion du corps (`apps/api/src/middleware/auth.ts:134-182`)
* **Ce qui est corrigé :**
  - Middleware `RateLimiter` actif avec quotas distincts : 120 (défaut), 60 (mutations), 20 (IA).
  - Émission des en-têtes `X-RateLimit-*` et `Retry-After`.
  - Rejet précoce HTTP 413 sur analyse du `Content-Length`.
* **Ce qui reste vulnérable (Failles critiques de conception) :**
  1. **Confiance aveugle dans `X-Forwarded-For` :** L'adresse IP est extraite de `req.headers['x-forwarded-for']` sans vérification du caractère de confiance du proxy. N'importe quel client peut contourner le quota en modifiant cet en-tête à chaque requête.
  2. **Fuite mémoire (Map Unbounded Growth) :** Les clés de suivi dans `this.buckets` ne sont jamais purgées de la mémoire. Un script émettant des requêtes avec des IP variables peut saturer le tas mémoire du processus Node.js.
  3. **Adoption incomplète des limites granulaires :** Bien que `MAX_BODY_BYTES_DEFAULT` (1 Mo) ait été défini, la quasi-totalité des routes appelle `readBody(req)` sans paramètre, ce qui applique par défaut le plafond permissif de 10 Mo.
* **Niveau de risque résiduel :** Élevé (vulnérabilité DoS réelle persistante).

---

### SEC-014 — Absence de signature cryptographique et de non-répudiation sur l'AuditStore
* **Classification :** **`NOT_FIXED`**
* **Composant :** Journalisation d'audit (`packages/core/src/observability/audit.ts`)
* **Preuve actuelle :** Les événements d'audit sont stockés dans un tableau volatile `this.events: AuditEvent[]`. Aucun chaînage par hachage (Merkle / HMAC) n'est implémenté.
* **Niveau de risque résiduel :** Faible à Moyen.

---

### SEC-015 — Exposition publique de statistiques globales inter-tenants sur `/metrics`
* **Classification :** **`NOT_FIXED`**
* **Composant :** Serveur API (`apps/api/src/server.ts:164-170`)
* **Preuve actuelle :**
  ```typescript
  if (req.method === 'GET' && (pathname === '/metrics' || pathname === `${config.apiPrefix}/metrics`)) {
    const metrics = metricsCollector.getMetricsSummary();
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ metrics, requestId }));
    return;
  }
  ```
* **Analyse :** La route est positionnée avant `extractRequestContext(req)`. Aucun token ni permission n'est requis. N'importe quel utilisateur ou observateur non authentifié peut surveiller le trafic global et le volume de requêtes de tous les locataires.
* **Niveau de risque résiduel :** Faible.

---

### SEC-016 — Usurpation de l'auteur d'une révision via le champ client `payload.author`
* **Classification :** **`NOT_FIXED`**
* **Composant :** Contrôleur de versions (`apps/api/src/routes/revisions.ts:58`)
* **Preuve actuelle :**
  ```typescript
  const revision = revisionStore.createRevision(context.tenantId, projectId, {
    message: payload.message,
    author: payload.author || 'engineer',
    files: payload.files,
  ```
* **Analyse :** Le serveur accepte la chaîne arbitraire transmise par le client sans la confronter avec le rôle ou l'identifiant du jeton Bearer authentifié.
* **Niveau de risque résiduel :** Moyen.
