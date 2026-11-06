# VOLACO CORE — AUDIT MAÎTRE GLOBAL POST-LOT B

> **Type :** audit **exclusivement read-only**. Aucun fichier modifié, aucun build, aucun redémarrage, aucune donnée touchée.
> **Date :** 2026-11-05
> **Périmètre :** plateforme complète — état après Lot A (C3.6 MCP intégré) et Lot B (Phase 2 sécurité).
> **Méthode :** lecture de sources, lecture des artefacts `dist`, lecture Git, sondes HTTP **GET/POST sans effet de bord** sur l'instance active, micro-mesures en mémoire sur répertoire temporaire isolé, exécution des suites de tests compilées sur `VOLACO_DATA_DIR` temporaire.

---

## 1. RÉSUMÉ EXÉCUTIF

L'audit établit **trois faits majeurs** :

1. **Les garanties Lot B sont correctement implémentées dans les sources ET dans `dist`** — secret JWT dédié, auth stricte, révocation, audit durable, quotas MCP. Compilation cohérente, tests dédiés verts (11/11 Lot B, ré-exécutés indépendamment).

2. **MAIS Lot B est DORMANT dans le runtime actif.** Le serveur en service sur `:3000` (pid 7908, démarré le **2026-11-04 21:40**) a été lancé avec `--env-file=.env` **avant** le rebuild de `dist` (**2026-11-05 01:30**) et **avant** toute écriture Lot B. Preuves directes :
   - `POST /api/v1/auth/logout` → **404** sur l'instance active (route Lot B absente du processus).
   - `GET /api/v1/projects` avec en-têtes falsifiables `x-tenant-id`/`x-user-role` → **200** (le mode strict « par défaut » de B1 n'est **pas** actif).
   - Le `.env` réel **ne contient ni `VOLACO_JWT_SECRET`, ni `VOLACO_API_KEY`, ni `VOLACO_STRICT_AUTH`**.

3. **Une régression Lot B réelle, non rapportée :** 3 suites de tests **imbriquées** de `packages/core/tests/preview-builder/` (`preview-final`, `preview-integration`, `real-source`) échouent au démarrage du serveur avec `Secret JWT VOLACO_JWT_SECRET absent ou invalide` (conséquence directe de B3-1). Le rapport Lot B annonçait « core : 176/176 » — mesure invalide car obtenue sur le glob **top-level uniquement** (23 fichiers), excluant les 110 suites imbriquées.

**Vérité consolidée des tests (glob officiel `dist/**/*.test.js`, 266 fichiers) :**
`3032 tests — 3000 passent, 28 échouent, 4 annulés` (dont **3 fichiers = régression Lot B**, **1 = environnemental**, **le reste = pré-existant**).

**Verdict de transition :** la plateforme **ne peut pas** passer en production dans l'état actuel tant que (a) le runtime n'exécute pas le code Lot B, et (b) le `.env` ne fournit pas `VOLACO_JWT_SECRET`. Ces deux points sont bloquants mais **facilement résolubles** (déploiement + configuration), sans refonte.

---

## 2. ÉTAT DE RÉFÉRENCE

| Élément | Valeur | Preuve |
|---|---|---|
| Dépôt audité | `C:/Users/FAYCAL/Desktop/volcanoo/volaco-core` | `(Get-Item Y:\).Target` |
| Chemin d'accès | `Y:\` → jonction vers le dépôt ci-dessus | idem |
| Branche | `master` | `git rev-parse --abbrev-ref HEAD` |
| Commit HEAD | `ea987c582b6a609ab419786d81633bfabbc5f18b` (2026-10-26 01:27) | `git show -s` |
| Worktree | **132 modifiés, 50 non suivis** (Lot A + Lot B + travail pré-existant) | `git status --porcelain` |
| Node / npm | v24.22.0 / 11.19.1 | `node --version` |
| Version projet | `0.1.0` | `package.json` |
| Artefact `dist` | à jour : `dist/packages/core/src/config.js` mtime **2026-11-05 01:30:05** ≥ source la plus récente (`_lot-b-secret-env.ts`, 01:22:45) | comparaison mtime |
| Manifestes | `package.json`, `.env.example` ; empreintes SHA-256 disponibles via `Get-FileHash` | — |
| Rapports | `mcp-lot-b-report.md` (05/11 01:29). **Aucun fichier de rapport « Lot A » ni « C3.6 »** — les labels C3.6/Lot A existent uniquement en commentaires de code (`permissions.ts`, `mcp.ts`, `mcp-remote.ts`) | `git grep`, listing docs |
| Processus | **:3000** pid 7908 `node --env-file=.env dist/apps/api/src/server.js` ; **:8080** pid 23696 (`tsx src/server.ts`, **autre workspace zCode**, hors dépôt) | `Get-CimInstance Win32_Process` |

### Continuité des rapports (§3 / §4 du prompt)
- Le rapport **Lot B** existe et est cohérent avec les sources (les empreintes qu'il publie correspondent aux fichiers actuels — vérifié §10).
- **Aucun rapport Lot A / C3.6 n'est un fichier** : la continuité documentaire Lot A→Lot B n'est **pas** traçable par pièce écrite ; elle repose sur des commentaires de code (traçables) et l'état du worktree. → **Limite documentée.**

### Distinction fichiers modifiés vs présents
- **Modifiés suivis (non commités) :** 132 (dont `server.ts`, `auth.ts`, `middleware/auth.ts`, `config.ts`, `user-store.ts`, `observability/audit.ts`, `ai-proxy.ts`, `app-generator.ts`, `conversation.ts`, `images.ts`, `mcp.ts`, `preview-standalone.ts`, `revisions.ts`, `provider-catalog.ts`, `permissions.ts`, `agent-runtime/service.ts`, …).
- **Non suivis (nouveaux) :** 50, dont Lot B (`identity/session-store.ts`, `mcp/remote/rate-limit.ts`, `routes/mcp-remote.ts`, `routes/ai-agent-keys.ts`, `routes/agent-generation-pipeline.ts`, helpers de test `_lot-b-*`).

---

## 3. CONTINUITÉ LOT A (C3.6 MCP intégré)

Vérifié : la gouvernance MCP **intégrée** (serveurs `project`/`browser` in-process) suit le même modèle que le distant.

- `apps/api/src/routes/mcp.ts` :
  - `requireTrustedUserId()` (L175-181) : identité individuelle **exigée**, issue exclusivement du JWT signé.
  - `assertPermission(context.role, 'MCP_BUILTIN_INVOKE')` sur prepare (L284) et call (L407).
  - Confirmation atomique `getBuiltinConfirmationStore().issue()` (L347) avec `schemaSha256`/`argsSha256`/`expiresAt`.
- `packages/core/src/identity/permissions.ts:25` : `MCP_BUILTIN_INVOKE` accordée à **OWNER + ADMIN** seulement (ENGINEER/VIEWER exclus).
- **Aucun `spawn`/`child_process`** dans `packages/core/src/mcp/**` → les serveurs MCP sont **in-process**, pas de transport STDIO à sous-processus (items §11-13 du prompt **non applicables**).

**Garanties Lot A toujours valides : OUI** (RBAC + identité fiable + confirmation). **Cependant** : la suite de non-régression Studio `mcp-remote-studio-b4.test.js` « B4-11 » **échoue** aujourd'hui (§13) car un fichier Studio (`preview-builder-app.js`) a été modifié par du travail pré-existant, invalidant l'empreinte figée — angle mort de gouvernance documentaire.

---

## 4. CONTINUITÉ LOT B

Le code Lot B est présent, cohérent et testé, **mais dormant au runtime** (§5). Détail par décision dans §6-§9.

---

## 5. VÉRIFICATION P0 — SECRET JWT ET AUTORITÉ D'AUTHENTIFICATION

### 5.1 Implémentation (sources + dist concordants)
- `config.ts:45-64` : `envJwtSecretBytes()` + `isJwtSecretConfigured()` — base64 **canonique**, **≥ 32 octets**, non nul, **≠ clé API** (base64 ET utf8).
- `config.ts:95-106` : `loadConfig()` **lève** si secret absent/invalide → refus de démarrage.
- `user-store.ts:137-174` : `getJwtSecretBytes()` — **unique** source de signature ; **aucun** fallback vers `VOLACO_API_KEY`/`AUTH_SECRET`; **aucun** secret éphémère.
- `user-store.ts:207-225` : `signToken` HS256 (HMAC-SHA256), `alg` figé ; `hmacSign` (L223) appelle `getJwtSecretBytes()`.
- `user-store.ts:227-243` : `verifyToken` — HMAC **timing-safe** (`timingSafeEqual`, L234), vérifie `sub`, `tenantId`, `exp` (L237-238). `alg:none` inopérant (MAC requis).
- **TTL** : `JWT_DEFAULT_TTL_SECONDS = 12h` (L194), plafond `24h` (L195), `clampTtlSeconds` (L197-200).
- **Claims** : `sub, tenantId, role, email, jti, sv, iat, exp` (L209-218).

### 5.2 Chemins alternatifs (recherche d'un contournement)
- **Un seul** appelant de `verifyToken` : `middleware/auth.ts:61`. **Un seul** appelant de `extractRequestContext` : `server.ts:636`. Pas de second point d'entrée d'auth.
- `AUTH_SECRET` : **plus utilisé** pour signer un JWT (vérifié `git grep` : uniquement dérivation de clé API `config.ts:92` + interdiction de réemploi dans le keyring MCP `crypto.ts`).
- **Clé API** : `verifyAuthToken` (L29-48) renvoie `authenticated:true` mais **`userId` ABSENT** (identité partagée). Elle ne peut pas fabriquer d'identité individuelle.

### 5.3 Scénario P0 — « un détenteur de `VOLACO_API_KEY` ne peut pas forger un JWT OWNER »
- **Démonstration (test existant, ré-exécuté) :** `lot-b-auth-revocation.test.js` « 1. la clé API partagée ne donne AUCUNE identité individuelle » → `GET /auth/me` avec `Bearer <VOLACO_API_KEY>` → **401** ; JWT forgé (signature aléatoire) → **401**. **Vérifié.**
- **Réserve importante :** la clé API **ouvre toujours l'accès** aux routes `/api` avec `role=OWNER` (par design, `verifyAuthToken` L41-47). La garantie est donc « pas d'*identité individuelle* forgée », **pas** « pas d'accès ». Les opérations exigeant une identité (MCP prepare/call) refusent la clé API via `requireTrustedUserId` (§7). À ne pas surinterpréter.

### 5.4 Rotation / invalidation
- Rotation via changement de `VOLACO_JWT_SECRET` → tous les jetons deviennent invalides (signature). Procédure documentée dans `mcp-lot-b-report.md` §9. **Non testée automatiquement** → **NON DÉMONTRÉE**. **Réserve :** `.env.example` ne documente pas `VOLACO_JWT_SECRET` (§15, V-04).

---

## 6. VÉRIFICATION B1 — AUTHENTIFICATION STRICTE

- `config.ts:66-73` `resolveStrictAuth()` : **production → `true`** (L70) ; dev/test → `true` sauf `VOLACO_STRICT_AUTH='0'` explicite (L72).
- `config.ts:107-109` : `!strictAuth && production` → **erreur de démarrage**.
- `middleware/auth.ts:104-159` : point de lecture **unifié** (`config.strictAuth`, L150) ; surface publique minimale (L93-102) ; repli en-têtes **uniquement si strict désactivé** (L151-159).
- `server.ts:638-650` : garde-fou `guardedMode = production || strictAuth` ; blocage `context.authenticated !== true` sur `/api` non public.

### Tests (ré-exécutés, verts)
- `auth-strict.test.js` (5), `auth-strict-mode.test.js` (4), `auth-enforcement.test.js` — **33/33** cumulés avec audit/observability/security-hardening.

### Divergences / limites
- **Distinction production vs dev** : l'instance active tourne en `NODE_ENV=development` → même avec le nouveau code, elle ne bénéficierait **que** du « strict par défaut » dev (contournable par `VOLACO_STRICT_AUTH='0'`), **pas** du verrou production. Recommandation : `NODE_ENV=production` pour un déploiement exposé.
- **Falsification d'en-têtes** : non exploitable en strict (test 2 de `auth-strict-mode` le prouve : 401 même avec en-têtes legacy). **Vérifié.**

---

## 7. VÉRIFICATION B3 — RÉVOCATION ET CYCLE DE VIE JWT

- `session-store.ts` : `versions[userId]` monotone (`revokeUser` L74), `revokedJti[]` borné `MAX_REVOKED_JTI=5000` (L30, L82-90), `isTokenStillValid` (L103-108) — **jeton sans `sv` REFUSÉ** (L104).
- `signToken(..., sessionVersion)` embarque `sv` (L215) ; signup/login passent `currentVersion(user.id)` (`auth.ts:171,205`).
- **Vérification serveur à chaque requête** : `middleware/auth.ts:63-72`.
- **Logout** : `POST /api/v1/auth/logout` (`auth.ts:210-232`) — global (incrément `sv`) ou ciblé (`{jti}`).
- **Démonstration « before=200 → logout=200 → after=401 »** : `lot-b-auth-revocation.test.js` t.2 **ré-exécuté → PASS**. Jeton révoqué refusé sur **toutes** les routes passant par le middleware (point unique).
- **Persistance** : document `jwt-sessions` (SQLite). **Isolation tenant** : `currentVersion` indexe par `userId` globalement unique (`usr_<rand>`), donc pas de collision cross-tenant.
- **Rejeu** : un JWT non révoqué et non expiré est réutilisable jusqu'à `exp` — comportement normal du JWT ; la révocation ferme la fenêtre sur logout.

### Réserves
- **Atomicité concurrence** : `revokeUser` fait `read-modify-write` **sans verrou** (L74-79) ; deux logouts concurrents pourraient produire une version égale au lieu de +2. Impact faible (les deux incréments finissent par invalider les anciens `sv`). **P3.**
- **Nettoyage des sessions** : `versions` n'est **jamais purgé** (croissance monotone par utilisateur à vie). **P3** (borne par `USERS_MAX=10 000`).
- **Désactivation utilisateur** : aucune route de désactivation que j'ai pu tracer qui appelle `revokeSessions` hors logout → **NON DÉMONTRÉE**.
- **Résistance au rejeu d'un jeton révoqué sur un chemin alternatif** : testé sur `/auth/me` ; le middleware étant unique, l'extrapolation est raisonnable mais **non testée exhaustivement route par route**.

---

## 8. VÉRIFICATION B2 — FIABILITÉ DU JOURNAL D'AUDIT

### Points forts
- Persistance `AuditStore({persist:true})` (`audit.ts:196`), chargement au boot (L106-112).
- **Actions CRITICAL → flush SYNCHRONE** (L166-169) ; **tout `status:'FAILURE'` → critique** (L166).
- **Erreurs d'écriture non silencieuses** : `try/catch` → `lastWriteError` + `console.error` (L122-128). `health()` (L132-139).
- Exposé : `health()` renvoie `{lastWriteError, lastFlushAt, pending, persistent}` — **vérifié** (micro-sonde : `{"lastWriteError":null,...,"pending":0,"persistent":true}`).
- Isolation tenant : `query(tenantId)` filtre strictement (L178-185).
- **Corrélation** : `requestId` sur chaque événement ; `id` unique `aud_<16hex>`.

### Constats
- **AUDIT-01 (P2) — `MCP_REMOTE_TOOL_PREPARED` n'est PAS dans `AUDIT_CRITICAL_ACTIONS`.** Un `prepare` réussi est seulement **coalescé** (perte possible ≤ 1 fenêtre en cas de crash), alors que le `call` (critique) est durable. La chaîne `prepare → confirmation → call` exigée par le prompt n'est donc **pas intégralement durable**. Fichier : `observability/audit.ts:26-44`. Preuve : grep du set (`MCP_REMOTE_TOOL_PREPARED` absent ; `..._CALLED` présent L39).
- **AUDIT-02 (P2) — incohérence d'identité dans `userId`.** `mcp-remote.ts:301,328` et `mcp.ts:126,147` utilisent `context.userId || context.role` → quand il n'y a pas de JWT, le champ `userId` contient le **rôle** (`OWNER`/`ADMIN`), contrairement à la décision « jamais le rôle ». `server.ts:477` (`?? 'anonymous'`) et `enforceMcpQuota` (`|| 'anonymous'`) sont, eux, corrects. **Incohérence intra-lot.**
- **AUDIT-03 (P3) — capacité/rétention :** cap `AUDIT_MAX_EVENTS=5000`, FIFO (les plus anciens tombent). Pas d'archivage, pas de rotation externe. Sous forte activité, un acte critique ancien peut être évincé par un plus récent → **la restitution « reconstruire la chaîne » est bornée par la fenêtre de 5000 événements**.
- **AUDIT-04 (P3) — « suppression silencieuse » :** `clear()` (L187-193) efface tout et persiste immédiatement ; aucun événement ne journalise le `clear` lui-même. Un appel programmatique à `clear()` (réservé aux tests, mais exporté) **n'est pas tracé**.
- **Comportement en cas d'indisponibilité du stockage :** `writeJsonFileSync` bascule sur le backend fichiers (JSON atomique) si SQLite échoue (`json-disk-cache.ts:98-103`), sinon signale l'erreur (L47-53). Donc l'audit **dégrade mais ne perd pas silencieusement** — sauf erreur totale où `lastWriteError` est renseigné (non silencieux). **Vérifié par lecture ; non provoqué sur instance réelle (interdit).**

---

## 9. VÉRIFICATION B4 — QUOTAS, CONCURRENCE ET ANTI-ABUS

- `mcp/remote/rate-limit.ts` : fenêtre fixe 60 s ; clés `(tenant,op)` et `(tenant,user,op)`.
- **Valeurs constatées == valeurs approuvées** (tableau prompt) :

| Opération | tenant/min | user/min |
|---|---:|---:|
| Discovery | 60 | 30 |
| Prepare | 120 | 60 |
| Call | 90 | 45 |
| Connecteurs | 30 | 15 |

(vérifié `rate-limit.ts:41-62` et dans `dist`).
- **Surcharge env** : `VOLACO_MCP_QUOTA_*` (`readQuota`, L35-39). **Vérifié.**
- **Refus 429 audité + loggé** : `enforceMcpQuota` (`mcp-remote.ts:876-909`), branché discovery/prepare/call/connecteurs (L943/1336/1511/1998).
- **Anti-abus signup** : `SIGNUP_MAX_PER_IP=10/min/IP` (`auth.ts:47-66`) ; `USERS_MAX=10000` avant tout `await` (`user-store.ts:87-89`).
- **Lockout login** : `LOGIN_MAX_FAILURES=5/min` (`auth.ts`).
- **Tests B4 (ré-exécutés)** : `lot-b-audit-quota.test.js` 6/6 (limite user plus restrictive, isolation inter-user, borne tenant).

### Constats
- **QUOTA-01 (P3) — fuite de compteur user sur refus tenant.** Dans `check()` (L131-139), le quota **user est consommé (L131) AVANT** le quota **tenant (L136)** ; si le tenant refuse ensuite, le compteur user a été incrémenté pour une requête finalement rejetée. Impact : léger sur-comptage user (déni de service marginal), **pas** un trou de sécurité.
- **QUOTA-02 (P2) — mono-instance.** Les compteurs sont **en mémoire par processus** (`Map`). En multi-instance / derrière un load-balancer, les quotas ne sont **pas** globaux (chaque instance a son propre compteur). Le prompt évoque « panne Redis » : **aucun Redis** n'est utilisé → pas de dépendance à tomber, mais **pas de quota distribué**. À documenter avant scale horizontal.
- **QUOTA-03 (P3) — borne max non plafonnée par env.** `readQuota` accepte toute valeur > 0 (y compris énorme) — un opérateur peut désactiver de facto la limite via env (`100000`). **Fail-open configurable** : à encadrer (valeur max plausible).
- **Burst** : pas de token-bucket ; fenêtre fixe → possibilité de **2× la limite** à cheval sur deux fenêtres. Acceptable mais à signaler.
- **Contournement par en-têtes** : les quotas utilisent `context.tenantId`/`context.userId` (issus du JWT/tenant authentifié), **pas** les en-têtes bruts → pas de contournement par `x-tenant-id`. **Vérifié.**

---

## 10. AUDIT GLOBAL MCP (C1 → C3.6, A, B)

| # | Domaine | État | Preuve |
|---|---|---|---|
| 1-2 | CRUD connecteurs + RBAC | ✅ | `mcp-remote.ts` (`TENANT_MANAGE` L620-823) |
| 3 | Isolation tenant | ✅ | PK composites `(tenant_id, connector_id…)` `store.ts:131,144,159` |
| 4 | Secrets | ✅ | AES-256-GCM, AAD `mcp-remote:v1:<tenant>:<connector>`, keyring distinct (`crypto.ts`) |
| 5-10 | Client HTTP/SSRF/DNS/redirect/limites/timeout | ✅ fort | `url-policy.ts` (loopback/RFC1918/CGNAT/link-local/métadonnées/ULA/mappées/NAT64), `client.ts` DNS **pinné** `verbatim` (L771), redirects revalidés ≤3 (L602-632), `maxResponseBytes` en-tête **et** flux (L1010-1024), timeout borné (L803-813, `req.destroy`), `agent:false` |
| 11-13 | STDIO/spawn/origine exécutables | **N/A** | aucun `spawn` : serveurs MCP in-process |
| 14-15 | Permissions/discovery | ✅ | `TENANT_MANAGE` ; découverte n'approuve rien |
| 16-18 | Prepare/confirmation/consommation | ✅ | `confirmation.ts` atomique `BEGIN IMMEDIATE` + UPDATE conditionnel (L9-12) |
| 19-20 | Rejeu/révocation | ✅ | `consume` → REPLAY ; invalidation contextuelle |
| 21-22 | Journalisation refus/exécution | ✅ (avec AUDIT-01/02) | `recordRefusal` (FAILURE→critique), `recordAudit` |
| 23-24 | Erreurs/concurrence | ✅ | codes fermés ; concurrence prouvée par `mcp-remote-b3` B3-15 |
| 25 | Rate limiting | ✅ (QUOTA-01/02/03) | §9 |
| 26 | Authentification | ✅ | `requireTrustedUserId` (D7) prepare/call |
| 27 | Isolation tenant | ✅ | requêtes filtrées par `tenant_id` |
| 28-30 | Compatibilité/alternatives/contournement | ⚠️ | **deux surfaces** MCP (`/api/v1/mcp` intégré, `/api/v1/mcp-remote` distant) partagent le **même** modèle de sécurité mais **deux implémentations parallèles** (dette d'unification) |

**Verdict MCP :** l'autorité de sécurité est **cohérente** entre les deux surfaces (RBAC + identité fiable + confirmation + journal), mais **dupliquée** (candidat ORCHESTRATE §18).

**Tests MCP ré-exécutés :** `mcp-remote-b1/b2/b3/c34/servers/servers-strict/real-handshake/builtin-governance/project-validation` = **122/122**. ✅

---

## 11. AUDIT DES AUTRES SURFACES

| Surface | Responsabilité | Contrôle sécurité | Constat |
|---|---|---|---|
| API globale | routage/try-catch | `extractRequestContext` (point unique) | ✅ |
| Auth | signup/login/logout/me | anti-bruteforce + JWT + révocation | ✅ (runtime dormant) |
| RBAC | 4 rôles | `ROLE_PERMISSIONS` (`permissions.ts:28`) | ✅ ; ENGINEER sans `TENANT_MANAGE`/`INVOKE` |
| Tenants/Projets | isolation | 1 tenant/utilisateur + `x-tenant-id` (fallback dev) | ✅ en strict |
| Persistance | SQLite WAL | mono-instance | ⚠️ voir PERF |
| Providers IA / catalogue | clés chiffrées at-rest | keyring `VOLACO_MCP_REMOTE_KEY` | ⚠️ **4 tests pré-existants en échec** sans keyring (§13) |
| Images | génération/politique | gates image | ⚠️ pré-existant (échoue aussi sur HEAD) |
| Studio | UI statique | CSP (`static-csp`) | ✅ ; `preview-builder-app.js` modifié (pré-existant) |
| Terminal | service | clamp timeout (`terminal-timeout-clamp`) | ✅ |
| Middleware | auth/CORS/limites | — | ✅ |
| Observabilité/audit | journal | §8 | ⚠️ AUDIT-01/02 |
| Limites d'utilisation | quotas | §9 | ⚠️ QUOTA-01/02/03 |

---

## 12. COHÉRENCE SOURCE / DIST / RUNTIME

**Sources ↔ `dist` : COHÉRENTS.** Le build (2026-11-05 01:30) est postérieur à la source la plus récente ; les modules Lot B sont présents dans `dist` (`session-store.js`, `rate-limit.js`, `audit.js` avec `AUDIT_CRITICAL_ACTIONS`, `config.js` avec le refus JWT, `auth.js` avec `auth/logout`).

**`dist` ↔ runtime actif : DIVERGENTS.** Le processus `:3000` (démarré 2026-11-04 21:40) exécute l'ancien code en mémoire.

| Fonctionnalité | Source TS | Dist | Runtime actif (:3000) | Statut |
|---|---|---|---|---|
| Lot A (MCP intégré C3.6) | Présent | Présent | **NON actif** (pré-lot) | **dormant** |
| Lot B (Phase 2) | Présent | Présent | **NON actif** | **dormant** |
| Auth JWT (secret dédié) | Présent | Présent | **NON actif** | dormant |
| Révocation (`sv`/`jti`, logout) | Présent | Présent | **NON actif** (logout → 404) | dormant |
| Audit durable (CRITICAL flush) | Présent | Présent | **NON actif** | dormant |
| Quotas MCP (`enforceMcpQuota`) | Présent | Présent | **NON actif** | dormant |

**Preuves runtime (sondes read-only) :** `POST /api/v1/auth/logout` → **404** ; `GET /api/v1/projects` (en-têtes legacy) → **200** ; `/status` → **200** (`phase: PHASE-2`, mais code de bootstrap ancien).

> **Règle appliquée :** je ne déclare **jamais** une correction « active en production » sur la seule présence dans `dist`. Ici la preuve runtime **contredit** l'activation.

---

## 13. TESTS ET FIABILITÉ DES PREUVES

### Commande et environnement
- Script officiel : `npm test` → `node scripts/run-tests.mjs` → `VOLACO_DATA_DIR` temporaire + `node --test --test-concurrency=1 dist/**/*.test.js` (266 fichiers).
- Mes exécutions : mêmes fichiers, `VOLACO_DATA_DIR` **temporaire** (aucune écriture `.volaco-data`).

### Résultats (glob complet, reproductibles)

| Périmètre | tests | pass | fail | annulés |
|---|---:|---:|---:|---:|
| Lot B dédié (3 fichiers) | 11 | **11** | 0 | 0 |
| MCP remote (9 fichiers) | 122 | **122** | 0 | 0 |
| Auth/audit/observability/security | 33 | **33** | 0 | 0 |
| **Total plateforme (266 fichiers)** | **3032** | **3000** | **28** | **4** |

> Le rapport Lot B annonçait « core : 176/176 ». **Cette mesure est partielle** : elle ne couvrait que les 23 suites **top-level** du core. Le glob réel en compte **133**. **Écart de méthode signalé.**

### Classement des 28 échecs (aucun n'est un P0 ; preuve de non-régression par bisect/worktree pour les pré-existants)

| Fichier | Nb | Cause racine | Classement |
|---|---:|---|---|
| `packages/core/tests/preview-builder/preview-final` | 1 | `Secret JWT … absent` (boot) | **RÉGRESSION Lot B (B3-1)** |
| `packages/core/tests/preview-builder/preview-integration` | 1 | idem | **RÉGRESSION Lot B** |
| `packages/core/tests/preview-builder/real-source` | 6 (dont 4 annulés) | idem (before hook) | **RÉGRESSION Lot B** |
| `packages/core/tests/app-image-terminal-gate` | 1 | `EPERM rename Y:\workspace\...` | **environnemental (Windows)** |
| `packages/core/tests/ai/providers-multimodel` | 4 | keyring `VOLACO_MCP_REMOTE_KEY` absent | pré-existant (Lot S4) |
| `apps/api/tests/ai-providers-routes` | 2 | keyring provider (S4) | pré-existant (prouvé par isolation) |
| `apps/api/tests/app-generator-gate` | 3 | bundle | pré-existant (échoue sur HEAD) |
| `apps/api/tests/app-image-policy` | 4 | politique image/bundle | pré-existant (HEAD) |
| `apps/api/tests/revisions` | 5 | rollback/bundle | pré-existant (HEAD) |
| `apps/api/tests/mcp-publication-policy` | 2 | build bundle MCP | pré-existant (HEAD) |
| `apps/api/tests/app-bundle` | 1 | isolation bundle | pré-existant (HEAD) |
| `apps/api/tests/v7-stream-preparation` | 1 | mémoire projet (conversation) | pré-existant (worktree) |
| `apps/api/tests/v8-completion` | 1 | bouton Studio (HTML) | pré-existant (worktree) |
| `packages/core/tests/studio/mcp-remote-studio-b4` (B4-11) | 1 | empreinte `preview-builder-app.js` invalidée | pré-existant (fichier modifié) |

**Preuves de non-régression des « pré-existants » :** bisect git sur `HEAD` (worktree détaché) — `app-generator-gate`/`app-image-policy`/`revisions`/`mcp-publication-policy`/`app-bundle` **échouent déjà** sur HEAD ; isolation de `provider-catalog.ts` (pré-existant non commité) sur HEAD reproduit les 2 échecs d'`ai-providers-routes` sans Lot B.

**Fiabilité des tests — points positifs :** aucun `.only` ; seulement **4 `t.skip`** conditionnels (`Chromium/playwright-core indisponible`, fichiers orchestrator/browser-sandbox) → couverture render/host **partielle** sur les machines sans Chromium. Fixtures/mocks : clients MCP **stubs** injectés (`setMcpRemoteRuntimeForTests`), horloge de confirmation injectable → tests de concurrence/expiration réels. Tests négatifs nombreux (RBAC, rejeu, SSRF, binding).

**Fiabilité — points négatifs :** la mesure « core » du rapport Lot B **exclut** les suites imbriquées (fiabilité de preuve insuffisante) → a masqué 3 régressions. Les suites dépendantes d'un keyring (`providers-*`) échouent si l'env n'est pas fourni (couplage environnemental).

---

## 14. PERFORMANCE

### Micro-mesures (in-memory, répertoire temporaire ; **aucune** charge sur le serveur actif)

| Opération | Coût | Méthode |
|---|---|---|
| `signToken` | **~9,15 µs/op** | 20 000 ops |
| `verifyToken` (HMAC + parse + timing-safe) | **~7,04 µs/op** | 20 000 ops |
| `isTokenStillValid` (révocation) | **~0,28 µs/op** | 20 000 ops |
| Coût auth total / requête | **~7,3 µs** | dérivé |

**Coût des écritures d'audit (chemin critique) :**

| Contexte | Coût / événement critique |
|---|---:|
| journal vide (0 evt) | **0,68 ms** |
| 1 000 événements | **5,16 ms** |
| 4 900 événements (≈ cap 5 000) | **12,63 ms** |
| non critique (coalescé) | ~0,13 ms |

### Analyse
- **PERF-01 (P1/P2) — Amplification d'audit sur le chemin critique.** `AuditStore.persist()` réécrit **tout** le document (jusqu'à ~5 000 evts / ~700 Ko, cf. commentaire `audit.ts:58-62`). Chaque action CRITICAL (et **chaque FAILURE**, donc **chaque refus de quota**) déclenche une écriture synchrone **bloquant l'event loop** ~**13 ms** près du cap. Sous rafale de refus MCP ou d'échecs de login, l'audit devient un **vecteur d'auto-DoS** (le remède B4 déclenche le coût coûteux de B2). Piste : journal append-only par ligne (SQLite `INSERT`), ou flush asynchrone borné pour les FAILURE non sensibles.
- **Auth/révocation : coût négligeable** (~7 µs/req) → **pas** de goulot.
- **Contention SQLite :** une seule connexion `DatabaseSync`, écritures **synchrones** → sérialisation naturelle en mono-processus ; risque = **blocage event loop** sur grosses écritures (audit, gros documents). `busy_timeout=5000`, WAL, `synchronous=NORMAL`.
- **Redis :** **absent** → pas de contention Redis, mais pas de compteurs distribués (QUOTA-02).
- **Sémaphore IA** (`server.ts:651-696`) : borne la concurrence lourde (VOLACO_MAX_CONCURRENT_AI=3) — bon garde-fou.
- **Limitation :** je **n'ai pas** exécuté `bench-backend.mjs`/`load-test.mjs` car ils **créent des données** (`@example.invalid`, tenant `loadtest`) → **modification d'état interdite**. **Mesures de saturation end-to-end NON DISPONIBLES** (§22).

---

## 15. VULNÉRABILITÉS

| ID | Sév. | Fichier:lignes | Constat | Scénario | Impact | Repro | Statut |
|---|---|---|---|---|---|---|---|
| **V-01** | **P0** | runtime (`:3000`), `.env` | **Lot B dormant + `.env` sans `VOLACO_JWT_SECRET`** | Le serveur actif exécute le code pré-Lot B : pas de révocation, pas de strict par défaut, clé API/JWT ancien mécanisme | Les garanties de sécurité annoncées **ne protègent pas** l'instance en service | `POST /auth/logout`→404 ; `GET /projects` en-têtes legacy→200 | **OUVERT (opérationnel)** |
| **V-02** | **P1** | `packages/core/tests/preview-builder/*` | **Régression Lot B** : 3 suites échouent (`Secret JWT absent`) | Ces suites bootent le serveur sans fournir `VOLACO_JWT_SECRET` | Couverture perdue (rendu/stream Preview Builder) ; dissimulée par une mesure « 176/176 » partielle | `node --test dist/packages/core/tests/preview-builder/*.test.js` | **OUVERT** |
| **V-03** | **P1** | `.env.example` / doc | `VOLACO_JWT_SECRET` **non documenté** ; `AUTH_SECRET` encore présenté comme secret JWT | Un opérateur suivant l'exemple n'a aucun secret JWT → **refus de démarrage** | Blocage de déploiement / confusion (croire que `AUTH_SECRET` suffit) | lire `.env.example` | **OUVERT** |
| **V-04** | **P2** | `observability/audit.ts:26-44` | `MCP_REMOTE_TOOL_PREPARED` non critique → non durable | Crash après prepare, avant call | Chaîne d'audit `prepare→call` incomplète | grep du set | **OUVERT** |
| **V-05** | **P2** | `mcp-remote.ts:301,328` ; `mcp.ts:126,147` | `userId = context.userId \|\| context.role` (le rôle usurpe le champ identité) | Appel sans JWT (clé API / legacy) | Journal d'identité **incohérent** (contredit B2) | lecture | **OUVERT** |
| **V-06** | **P2** | `mcp/remote/rate-limit.ts` | Quotas **mono-instance** (Map en mémoire) | Multi-instance / LB | Quota effectif ×N ; contournement par répartition | lecture | **OUVERT (scale)** |
| **V-07** | **P2** | `audit.ts:58-169` | Réécriture totale synchrone du journal sur CRITICAL/FAILURE | Rafale de refus/lockouts | Auto-DoS event-loop (~13 ms/échec) | micro-bench §14 | **OUVERT** |
| **V-08** | **P3** | `session-store.ts:74` | `revokeUser` read-modify-write sans verrou | 2 logouts concurrents | Version incrémentée d'1 au lieu de 2 (impact faible) | lecture | **OUVERT** |
| **V-09** | **P3** | `session-store.ts` | `versions` jamais purgé | Longue vie | Croissance mémoire/disque bornée par `USERS_MAX` | lecture | **OUVERT** |
| **V-10** | **P3** | `rate-limit.ts:131-139` | Quota user consommé avant refus tenant | Requêtes mixtes | Sur-comptage user (DoS marginal) | lecture | **OUVERT** |
| **V-11** | **P3** | `rate-limit.ts:35-39` | `readQuota` sans plafond supérieur | Env mal configurée | Désactivation de facto des quotas | lecture | **OUVERT** |
| **V-12** | **P3** | tests render/host | 4 `t.skip` Chromium | Machine sans Chromium | Couverture render/host réduite | lecture | **CONNU** |
| **V-13** | **P2** | `mcp-remote.ts`, `mcp.ts` | Deux implémentations MCP parallèles (dette de cohérence) | Évolution future | Divergence possible de l'autorité de sécurité | lecture | **OUVERT (dette)** |

> Aucune vulnérabilité **P0 de type « contournement crypto »** n'a été trouvée dans le **code** : la chaîne JWT/SSRF/confirmation est solide. Le seul P0 est **opérationnel** (V-01 : garanties non déployées sur l'instance active). Les P0/P1 « précédents » (clé API forgeant un JWT OWNER ; repli dev non strict) sont **fermés dans le code** mais **pas actifs au runtime**.

---

## 16. DETTE TECHNIQUE

| ID | Zone | Description | Sév. |
|---|---|---|---|
| D-01 | Rapports | Pas de fichier Lot A / C3.6 : continuité documentaire non traçable par pièce | P3 |
| D-02 | Tests | Mesure de couverture partielle (top-level vs imbriqué) — fiabilité des preuves | P2 |
| D-03 | MCP | Duplication des surfaces intégrée/distant (règles similaires, deux codes) | P2 |
| D-04 | Persistance | Mono-instance SQLite ; pas de PostgreSQL (assumé, CDC §38) | P2 (scale) |
| D-05 | Audit | Cap 5000 sans archivage/rotation | P3 |
| D-06 | Config | `.env` versionné d'exemple incohérent (`AUTH_SECRET`, pas de JWT, `NODE_ENV=production` ≠ réel `development`) | P2 |
| D-07 | Sécurité | `AUTH_SECRET` reste une variable « legacy » qui prête à confusion avec l'autorité JWT | P3 |

---

## 17. SCORES ARGUMENTÉS (sur 10)

| # | Domaine | Score | Justification (critères observables) |
|---|---|---:|---|
| 1 | Sécurité globale | **6,5** | Code solide (JWT dédié, SSRF fort, confirmation atomique, RBAC) **mais** P0 opérationnel V-01 (non déployé) + P1 V-02/V-03. Un P0 ouvert plafonne le score. |
| 2 | Auth & sessions | **7,5** | Implémentation complète et testée (11/11) ; réserve : non active au runtime, rotation non testée, purge sessions absente. |
| 3 | Isolation multi-tenant | **8,0** | PK composites, requêtes filtrées `tenant_id`, AAD crypto par tenant ; réserve : mono-instance. |
| 4 | Gouvernance MCP | **8,5** | Deux surfaces, mêmes garanties, tests 122/122, SSRF exemplaire ; retire du point pour duplication (D-03) + AUDIT-01. |
| 5 | Fiabilité de l'audit | **6,5** | Durabilité CRITICAL/FAILURE + `health()` (bien) ; retire pour AUDIT-01/02 et amplification (V-07). |
| 6 | Protection contre les abus | **7,0** | Quotas + anti-bruteforce + `USERS_MAX` ; retire pour mono-instance (V-06), fuite user (V-10), plafond env (V-11). |
| 7 | Qualité des tests | **6,0** | 3000/3032 verts, tests négatifs réels, pas de `.only` ; retire pour mesure partielle ayant masqué 3 régressions (V-02/D-02). |
| 8 | Architecture | **7,5** | Point d'auth unique, modular monolith cohérent ; retire pour duplication MCP et entrelacement worktree. |
| 9 | Performance | **6,0** | Auth négligeable ; retire pour amplification audit synchrone (V-07) et absence de mesure end-to-end (interdite). |
| 10 | Maturité production | **4,0** | **P0 V-01** : runtime n'exécute pas les garanties ; config `.env` incomplète ; pas de quotas distribués. |
| 11 | Cohérence source/dist | **7,0** | Sources↔dist concordants et testés (fort) ; runtime **divergent** (dormant). |
| 12 | Maintenabilité | **7,0** | Code commenté et structuré ; retire pour dette D-01→D-07 et worktree massivement modifié non commité. |

> Aucun 9/10 ou 10/10 attribué. Le score « Maturité production » reste bas **à cause du P0 V-01**, conformément à la consigne (un score élevé ne doit pas masquer un P0).

---

## 18. MATRICE KEEP / POLISH / REFACTOR / FIX / ORCHESTRATE / BUILD / REMOVE

| Action | Élément | Prio | Justification | Fichiers | Risque | Tests requis | Complexité |
|---|---|---|---|---|---|---|---|
| **KEEP** | Chaîne JWT (secret dédié, HS256, timing-safe) | — | Correcte et testée | `user-store.ts`, `config.ts` | — | — | — |
| **KEEP** | SSRF/DNS/redirect/limites client MCP | — | Exemplaire | `url-policy.ts`, `remote/client.ts` | — | — | — |
| **KEEP** | Confirmations atomiques anti-rejeu | — | `BEGIN IMMEDIATE` + binding | `remote/confirmation.ts`, `remote/store.ts` | — | — | — |
| **FIX** | Activer Lot B au runtime (déployer + config) | **P0** | V-01 | `.env`, redémarrage | faible | smoke: logout/404→200, strict, révocation | faible |
| **FIX** | Fournir secret aux 3 suites Preview Builder | **P1** | V-02 | `packages/core/tests/preview-builder/*` | faible | re-run suites | faible |
| **FIX** | Documenter `VOLACO_JWT_SECRET` (+ retirer ambiguïté `AUTH_SECRET`) | **P1** | V-03 | `.env.example`, doc | faible | — | faible |
| **FIX** | `MCP_REMOTE_TOOL_PREPARED` → CRITICAL (ou flush) | **P2** | V-04 | `observability/audit.ts` | faible | test audit prepare durable | faible |
| **FIX** | `userId = context.userId ?? 'anonymous'` partout | **P2** | V-05 | `mcp-remote.ts`, `mcp.ts` | faible | tests journal identité | faible |
| **FIX** | Plafonner `readQuota` (borne sup) | **P3** | V-11 | `rate-limit.ts` | faible | test env abuse | faible |
| **POLISH** | Quota user consommé après tenant | **P3** | V-10 | `rate-limit.ts` | faible | test ordre consommation | faible |
| **POLISH** | Verrou atomicité `revokeUser` | **P3** | V-08 | `session-store.ts` | faible | test concurrence logout | faible |
| **POLISH** | Purge/compaction `versions` | **P3** | V-09 | `session-store.ts` | moyen | test rétention | moyen |
| **REFACTOR** | Journal d'audit append-only (INSERT ligne) au lieu de réécriture | **P2** | V-07 | `observability/audit.ts`, `sqlite-backend.ts` | moyen | perf + durabilité + `health()` | moyen |
| **ORCHESTRATE** | Unifier surfaces MCP intégrée/distant (autorité unique) | **P2** | D-03 | `mcp.ts`, `mcp-remote.ts` | élevé | régression MCP complète | élevé |
| **ORCHESTRATE** | Compteurs de quota partagés (si scale horizontal) | **P2** | V-06 | `rate-limit.ts` | moyen | tests concurrence multi-instance | élevé |
| **BUILD** | Rotation de secret à chaud + test automatisé | **P2** | §5.4 | modules JWT | moyen | test rotation | moyen |
| **BUILD** | Désactivation utilisateur → `revokeSessions` | **P2** | §7 | `user-store.ts`, `auth.ts` | faible | test désactivation | faible |
| **BUILD** | Archivage/rotation du journal d'audit | **P3** | D-05 | `observability/audit.ts` | moyen | test rétention | moyen |
| **REMOVE** | — | — | Aucun fichier démontré inutilisé (pas de suppression proposée sans preuve) | — | — | — | — |

---

## 19. PLAN DE REMÉDIATION PRIORISÉ

1. **[P0 — bloquant production] Déployer Lot B et le configurer.** Ajouter `VOLACO_JWT_SECRET` (base64 32 octets, ≠ clé API) au `.env` ; renseigner `VOLACO_API_KEY` et `VOLACO_STRICT_AUTH` ; redémarrer le service (hors mission). Vérifier par sonde : `/auth/logout` ≠ 404, strict actif, révocation effective. *Complexité : faible. Risque : faible.*
2. **[P1] Rétablir la couverture Preview Builder.** Fournir le secret JWT aux 3 suites (`preview-builder/*`) via helper d'env. *Faible.*
3. **[P1] Corriger la documentation.** `.env.example` : documenter `VOLACO_JWT_SECRET`, clarifier que `AUTH_SECRET` ne signe plus les JWT, aligner `NODE_ENV`. *Faible.*
4. **[P2] Dureté audit.** `MCP_REMOTE_TOOL_PREPARED` critique ; identité `anonymous` cohérente ; journal append-only. *Moyen.*
5. **[P2] Unifier/quota distribué** selon la cible de scale. *Élevé, à planifier.*
6. **[P3] Finitions** quota/ordre/plafond, verrou révocation, purge sessions.

**Dépendances :** (1) avant tout ; (2)-(3) indépendants ; (4) après (1) ; (5) après décision d'architecture scale.

---

## 20. RISQUES RÉSIDUELS

- **Faux sentiment de sécurité** : le code Lot B existe, les tests passent, mais **rien n'est actif** au runtime (V-01) — risque majeur de communication.
- **Divergence runtime/dist non détectée automatiquement** : aucun test ne vérifie que l'instance en service exécute bien `dist` courant.
- **Fausses clés/manifestes** : la mesure « 176/176 » du rapport Lot B est **partielle** ; ne pas s'y fier comme preuve de couverture complète.
- **Quotas non distribués** : à l'échelle horizontale, protections effectives amoindries.
- **Amplification d'audit** : vecteur d'auto-DoS sous rafale de refus (V-07).
- **Tests environnementaux fragiles** : `EPERM` Windows (`app-image-terminal-gate`), skips Chromium.

---

## 21. VERDICT GLOBAL

- **Les vulnérabilités P0 du précédent audit sont-elles fermées ?** **FERMÉES DANS LE CODE, NON ACTIVES AU RUNTIME.** Le forgage de JWT OWNER par la clé API est bloqué par le code (`VOLACO_JWT_SECRET` dédié) — **démontré par test** — mais l'instance en service exécute encore l'ancien code (**V-01, P0 opérationnel**).
- **Les P1 du précédent audit sont-ils fermés ?** **FERMÉS DANS LE CODE** (secret JWT dédié, strict par défaut, révocation, flush critique) ; **NON DÉPLOYÉS**.
- **Les garanties Lot A sont-elles toujours valides ?** **OUI dans le code** (RBAC + identité fiable + confirmation) ; **NON ACTIVES au runtime**.
- **Les garanties Lot B sont-elles démontrées ?** **OUI par tests** (11/11 + 122 MCP + 33 auth ré-exécutés) ; **NON ACTIVES au runtime** (§12). Corrigées/non-corrigées : voir §15.
- **Les corrections sont-elles réellement actives ou seulement présentes dans les sources ?** **Seulement présentes dans les sources ET `dist` — dormantes au runtime.**
- **Existe-t-il une régression ?** **OUI : V-02** (3 suites Preview Builder cassées par B3-1), **non rapportée**. Plus **V-05** (incohérence `userId`) et **V-04** (préparé non critique). Aucune régression sur le chemin MCP distant.
- **La plateforme peut-elle passer à la phase suivante ?** **PAS « telle quelle » pour la production.** Un **déploiement + configuration** (remédiation 1) est un prérequis.
- **Quelle est la prochaine phase la plus pertinente ?** **Phase de « mise en service sûre » (remédiations P0/P1)** : activer Lot B, rétablir la couverture de test, corriger la doc. Ensuite seulement, **Lot C** (durcissement/scale) avec unification MCP + quota distribué.
- **Quels risques empêchent une activation production ?** (a) runtime n'exécutant pas le code ; (b) `.env` sans secret JWT (refus de démarrage) ; (c) `NODE_ENV=development` (pas le verrou production) ; (d) quotas/audit non distribués ; (e) amplification d'audit.

### Indicateurs NON DÉMONTRÉS (absence de preuve ≠ preuve d'absence)
- Rotation de secret testée automatiquement → **NON DÉMONTRÉE**.
- Désactivation utilisateur → révocation → **NON DÉMONTRÉE**.
- Révocation vérifiée sur **chaque** route (au-delà de `/auth/me`) → **NON DÉMONTRÉE** (extrapolée du point d'auth unique).
- Comportement sous panne totale de stockage d'audit sur instance réelle → **NON DÉMONTRÉ** (interdit de provoquer).
- Saturation/charge end-to-end → **NON MESURÉE** (bench interdit car créateur de données).

---

## 22. LIMITES DE L'AUDIT

1. **Aucune écriture, aucun build, aucun redémarrage** : les hypothèses runtime reposent sur des **sondes read-only** et l'analyse temporelle (process start vs dist mtime), pas sur une inspection mémoire/intrusive.
2. **Bench non exécuté** (`bench-backend.mjs`, `load-test.mjs`) : ces scripts **créent des données** → interdits. Les performances reportées proviennent de **micro-mesures en mémoire** et des temps de tests, pas d'un test de charge.
3. **Instance `:3000` partagée/`--watch`?** Non : le processus actif n'est **pas** en `--watch` (`start`, pas `start:dev`) → il ne rechargera pas Lot B sans redémarrage.
4. **Entrelacement worktree** : le dépôt mêle Lot A, Lot B et travail pré-existant non commité ; l'attribution des 28 échecs s'appuie sur **bisect/worktree**, pas sur un état « base + Lot B seul » (non isolable car certaines sources pré-existantes **dépendent** de modules Lot B — ex. `conversation.ts` importe `agent-generation-pipeline.ts`).
5. **Rapports Lot A / C3.6 absents** en tant que fichiers → continuité documentaire **non vérifiable par pièce**.
6. **Portée des sondes runtime** : limitée à `GET /status`, `GET /health`, `POST /auth/logout`, `GET /projects`, `GET /ai/providers` — toutes sans effet de bord.

---

## ANNEXE A — Références exactes (fichiers:lignes)

- **P0 JWT** : `packages/core/src/config.ts:45-64,95-109` ; `packages/core/src/identity/user-store.ts:137-174,194-243`.
- **B1 strict** : `packages/core/src/config.ts:66-73,107-109` ; `apps/api/src/middleware/auth.ts:93-159` ; `apps/api/src/server.ts:638-650`.
- **B3 révocation** : `packages/core/src/identity/session-store.ts:30,74-108` ; `apps/api/src/routes/auth.ts:171,205,210-232` ; `apps/api/src/middleware/auth.ts:63-72`.
- **B2 audit** : `packages/core/src/observability/audit.ts:26-44,106-176,187-196` ; `apps/api/src/server.ts:477,483,499` ; `apps/api/src/routes/mcp-remote.ts:301,328` ; `apps/api/src/routes/mcp.ts:126,147`.
- **B4 quotas** : `packages/core/src/mcp/remote/rate-limit.ts:35-148` ; `apps/api/src/routes/mcp-remote.ts:876-909,943,1336,1511,1998` ; `apps/api/src/routes/auth.ts:47-66` ; `packages/core/src/identity/user-store.ts:38,84-89`.
- **RBAC** : `packages/core/src/identity/permissions.ts:28-33`.
- **MCP sécurité** : `packages/core/src/mcp/remote/url-policy.ts` ; `packages/core/src/mcp/remote/client.ts:771,803-813,602-632,1010-1024` ; `packages/core/src/mcp/remote/confirmation.ts:9-12,30` ; `packages/core/src/mcp/remote/crypto.ts:1-50` ; `packages/core/src/mcp/remote/store.ts:131,144,159`.

## ANNEXE B — Commandes de preuve

```powershell
# État de référence
[System.IO.Path]::GetFullPath("Y:\") ; (Get-Item "Y:\").Target
git rev-parse HEAD ; git status --porcelain
(Get-Process -Id 7908).StartTime ; (Get-Item "dist\packages\core\src\config.js").LastWriteTime

# Sondes runtime read-only
Invoke-WebRequest http://127.0.0.1:3000/status
Invoke-WebRequest http://127.0.0.1:3000/api/v1/auth/logout -Method POST -Body '{}' -ContentType application/json   # => 404
Invoke-WebRequest http://127.0.0.1:3000/api/v1/projects -Headers @{'x-tenant-id'='audit';'x-user-role'='OWNER'}  # => 200

# .env (noms de variables)
Get-Content .env | Where-Object {$_ -match '='} | % { ($_ -split '=',2)[0] }   # => PORT,NODE_ENV,AUTH_SECRET,MISTRAL_*,...

# Tests (glob complet, data dir temporaire)
$env:VOLACO_DATA_DIR = <temp> ; node --test --test-concurrency=1 dist/**/*.test.js   # => 3032/3000/28

# Micro-perf (in-memory)
node <probe>.mjs   # signToken ~9.15us ; verifyToken ~7.04us ; isTokenStillValid ~0.28us ; flush critique 0.68→12.6ms
```

---

**FIN DU RAPPORT D'AUDIT — READ-ONLY — AUCUNE CORRECTION APPORTÉE.**
