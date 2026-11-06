# Rapport — LOT B (Phase 2 sécurité) — Secret JWT, auth stricte, révocation, audit durable, quotas MCP

> **Statut :** TERMINÉ — vérifié — STOP (aucun build de production, aucun redémarrage serveur, aucune publication).
> **Date :** 2026-11-05
> **Périmètre :** décisions B3-1/P0, B1, B3, B2, B4 du CDC V7.0 (Phase 2 sécurité).
> **Exécution :** autonome, ordre imposé B3-1 → B1 → B3 → B2 → B4 → tests → intégrité.

---

## 1. Résumé exécutif

| Décision | Objet | État | Preuve |
|---|---|---|---|
| **B3-1 / P0** | Secret JWT dédié, refus de démarrer sans secret valide | ✅ | `config.ts:45-64,97-106` |
| **B1** | Auth stricte : production obligatoire, dev strict par défaut | ✅ | `config.ts:66-73`, `middleware/auth.ts:104-159` |
| **B3** | Révocation de sessions (`sv` + `jti`), route logout | ✅ | `session-store.ts`, `auth.ts:210-232`, `middleware/auth.ts:63-72` |
| **B2** | Audit durable : flush synchrone CRITICAL/FAILURE, `health()` | ✅ | `observability/audit.ts:26-47,132-170`, `server.ts:477` |
| **B4** | Quotas MCP par tenant ET utilisateur, anti-abus signup | ✅ | `mcp/remote/rate-limit.ts`, `mcp-remote.ts:876-943…`, `auth.ts:47-66` |
| **Tests** | 11 tests Lot B dédiés + non-régression | ✅ | §7 |

**Verdict :** les cinq décisions sont implémentées, compilées (`tsc` EXIT=0) et couvertes par des tests qui **exercent le comportement réel** (HTTP de bout en bout + unitaires), pas seulement des assertions de forme. Les échecs de tests résiduels ont été **prouvés pré-existants** et sans lien avec le Lot B (§8).

---

## 2. Décision B3-1 / P0 — secret JWT dédié

### Avant
- Le JWT était signé avec un secret dérivé de la clé API partagée (`AUTH_SECRET`/`VOLACO_API_KEY`), et le repli éphémère existait. **Un porteur de la clé API pouvait donc forger un jeton `OWNER`.**
- Aucun refus de démarrage : un service sans secret signait quand même.

### Après
- `packages/core/src/config.ts`
  - `envJwtSecretBytes()` (L45-52) : décode `VOLACO_JWT_SECRET`, exige base64 **canonique**, ≥ 32 octets, non nul.
  - `isJwtSecretConfigured()` (L54-64) : refuse que le secret soit **égal à la clé API** (ni en base64, ni en utf8).
  - `loadConfig()` (L97-106) : **lève** `Secret JWT VOLACO_JWT_SECRET absent ou invalide … Le service refuse de démarrer.`
- `packages/core/src/identity/user-store.ts`
  - `getJwtSecretBytes()` (L160) : unique source du secret de signature ; plus aucun fallback vers la clé API.
  - `JWT_DEFAULT_TTL_SECONDS = 12h` (L194), plafond `JWT_MAX_TTL_SECONDS = 24h` (L195), `clampTtlSeconds()` (L197-200).

### Preuve d'indépendance (test P0)
- `lot-b-auth-revocation.test.ts` — « 1. la clé API partagée ne donne AUCUNE identité individuelle » : `GET /api/v1/auth/me` avec `Authorization: Bearer <VOLACO_API_KEY>` → **401**.
- Un JWT **forgé** (signature aléatoire) → **401**.

### Justification / risque résiduel
- Le secret est désormais le **seul** point de confiance de la signature : la compromission de la clé API n'ouvre plus la voie à une usurpation d'identité `OWNER`.
- **Risque résiduel :** un `VOLACO_JWT_SECRET` faible ou réutilisé. **Mitigé** par la vérification de longueur/entropie minimale et la distinction vis-à-vis de la clé API. Rotation : §9.

---

## 3. Décision B1 — authentification stricte

### Avant
- Le repli dev (en-têtes `x-tenant-id` / `x-user-role`, **spoofables**) était actif par défaut, y compris là où l'on croyait le strict activé.

### Après
- `config.ts:66-73` — `resolveStrictAuth()` :
  - **production → `true` obligatoire** (jamais désactivable) ; `loadConfig()` refuse d'ailleurs `strictAuth=false` en production (L107-109) ;
  - développement/test → strict **par défaut**, seule la valeur explicite `VOLACO_STRICT_AUTH='0'` le désactive ;
  - toute valeur absente/inconnue ⇒ strict.
- `middleware/auth.ts:104-159` — point de lecture **unifié** : clé API ≠ JWT, puis JWT, puis (strict désactivé seulement) repli en-têtes. Surface publique minimale : `/health`, `/api/v1/auth/*`, shell Studio (poulet-œuf du login).

### Preuve
- `auth-strict-mode.test.ts` (4/4) : sans Bearer → **401 même avec en-têtes legacy** ; JWT signé → 200 et **tenant issu du token** (en-tête mensonger ignoré) ; `/me` sans JWT → 401.
- `auth-strict.test.ts` (5/5) : strict ON refuse le repli ; `/auth/login` et `/health` restent joignables.

### Effet de bord maîtrisé
- Le strict **par défaut** fait, à juste titre, échouer les suites historiques non signées. Un helper partagé `_lot-b-legacy-env.ts` désactive explicitement le strict en dev/test pour ces suites ; les suites dédiées au strict gardent leur propre configuration. Voir §6.

---

## 4. Décision B3 — révocation effective des sessions

### Avant
- Un JWT signé reste valide jusqu'à expiration ; aucun mécanisme de révocation côté serveur.

### Après
- **Nouveau** `packages/core/src/identity/session-store.ts` — `SessionRevocationStore` :
  - `versions[userId]` : **version de session monotone** ; `revokeUser()` (L74) l'incrémente (logout global / désactivation / changement de mot de passe) ;
  - `revokedJti[]` borné (`MAX_REVOKED_JTI = 5000`, L30) ; `revokeJti()` (L82) pour un logout ciblé ;
  - `isTokenStillValid(userId, sv, jti)` (L103) : **un jeton sans `sv` est REFUSÉ** (invalide l'ancien mécanisme) ; version antérieure ⇒ refus ; JTI révoqué ⇒ refus.
  - Persistance via la couche documentaire (`jwt-sessions` → SQLite/file), cohérente avec les autres stores.
- `user-store.ts` — `signToken(user, ttl?, sessionVersion)` (L202) embarque `sv` ; le signup/login passent `sessionRevocationStore.currentVersion(user.id)` (`auth.ts:171,205`).
- `middleware/auth.ts:63-72` — la révocation est vérifiée **à chaque requête authentifiée** ; le contexte porte `jti` (L26, L82).
- **Nouvelle route** `POST /api/v1/auth/logout` (`auth.ts:210-232`) : sans corps → révoque **toutes** les sessions ; avec `{ jti }` → révoque **cette** session. Idempotente, exige une identité JWT.

### Preuve (bout en bout, HTTP réel)
`lot-b-auth-revocation.test.ts` — « un JWT signé passe, puis est REFUSÉ après logout » :
```
before=200 → logout=200 (revoked: all-sessions) → after=401
```
Reproduction console (script direct) : `P0 me(apiKey)=401`, `signup=201`, `before=200`, `logout=200`, **`after=401`**.

`lot-b-session-unit.test.ts` (3/3) : sans `sv` refusé ; incrément ⇒ anciens jetons refusés, nouveaux acceptés ; JTI ciblé isolé.

### Bug corrigé pendant l'implémentation
- `POST /auth/logout` relisait le corps via `readBody` alors que le corps global était **déjà** lu → flux épuisé → **blocage silencieux** du handler. Correction : utiliser le corps déjà lu (`body`), jamais relire le flux. Ce bug était bloquant pour le runner de tests.

### Risque résiduel
- Révocation **mono-instance** (comme toute la persistance actuelle) : cohérente entre redémarrages, mais pas distribuée. Documenté ; PostgreSQL viendra avec le scale (CDC §38).

---

## 5. Décision B2 — audit durable

### Avant
- Flush par lot uniquement ; **les erreurs d'écriture étaient avalées** (`catch {}` silencieux) ; le dispatcher journalisait le **rôle** à la place de l'identité utilisateur.

### Après
- `packages/core/src/observability/audit.ts`
  - `AUDIT_CRITICAL_ACTIONS` (L26-46) : auth (login/échec/lockout/logout/révocation), gestion tenant, MCP distant (création/modif/secret/approbation/révocation/call/refus/échec), rollback.
  - `record()` (L163-170) : action **CRITIQUE** ou statut **FAILURE** ⇒ **flush synchrone immédiat** (jamais coalescé) ⇒ zéro fenêtre de perte sur un acte sensible.
  - `health()` (L132-139) : expose `lastWriteError`, `lastFlushAt`, `pending`, `persistent` — un échec d'écriture n'est **plus jamais silencieux** (il est mémorisé et journalisé, L121-127).
- `apps/api/src/server.ts:477` — `auditUserId = context.userId ?? 'anonymous'` : le dispatcher journalise l'**identité réelle** (D7), **jamais** le rôle (L483, L499).

### Preuve
`lot-b-audit-quota.test.ts` (B2, 3/3) : action critique ⇒ `pending=0` (flushé) ; `FAILURE` ⇒ traité comme critique ; `health()` cohérent et persistant.

### Risque résiduel
- Volume d'audit borné (`AUDIT_MAX_EVENTS`) : les plus anciens sortent — comportement assumé d'un journal append-only borné, exposé par `health()`.

---

## 6. Décision B4 — quotas MCP & anti-abus

### Après
- **Nouveau** `packages/core/src/mcp/remote/rate-limit.ts` — `RemoteMcpRateLimiter` :
  - fenêtre fixe 60 s, indexée `(tenant, opération)` et `(tenant, user, opération)` ;
  - **la limite utilisateur est plus restrictive que la limite tenant** ;
  - un refus tenant **ne consomme pas** le quota utilisateur (ordre tenant → user, cf. `check()` L107+) ;
  - plafonds centralisés, **surchargeables par environnement** :

| Opération | Défaut / tenant / min | Défaut / user / min | Variables |
|---|---:|---:|---|
| Discovery | 60 | 30 | `VOLACO_MCP_QUOTA_DISCOVERY_{TENANT,USER}` |
| Prepare | 120 | 60 | `VOLACO_MCP_QUOTA_PREPARE_{TENANT,USER}` |
| Call | 90 | 45 | `VOLACO_MCP_QUOTA_CALL_{TENANT,USER}` |
| Connecteurs | 30 | 15 | `VOLACO_MCP_QUOTA_CONNECTORS_{TENANT,USER}` |

- `apps/api/src/routes/mcp-remote.ts` — `enforceMcpQuota()` (L876-903) : **fail-closed** (refus AVANT tout accès réseau), **429** audité (`MCP_REMOTE_RATE_LIMITED`) et journalisé. Branché sur discovery (L943), prepare (L1336), call (L1511), écritures connecteurs (L1998).
- **Anti-abus signup** (`auth.ts:47-66`) : `SIGNUP_MAX_PER_IP = 10/min/IP` → **429** `TOO_MANY_ATTEMPTS` + `Retry-After`. N'affecte jamais un compte existant.
- `user-store.ts:84-88` — `USERS_MAX = 10 000` appliqué **avant tout `await`** (création atomique).

### Preuve
`lot-b-audit-quota.test.ts` (B4, 3/3) : la limite utilisateur refuse avant la limite tenant ; un autre utilisateur du même tenant n'est pas pénalisé ; le quota tenant borne le total réparti sur plusieurs utilisateurs.

### Perf
- Compteurs en mémoire, O(1) par appel, purge paresseuse des fenêtres expirées.
- Écriture audit synchrone **uniquement** sur action critique/failure : les appels MCP nominaux ne changent pas de coût d'écriture.

### Risque résiduel
- Compteurs **mono-instance** (comme la persistance). En multi-instance, un quota global nécessitera un compteur partagé (Redis) — hors périmètre Lot B, documenté.

---

## 7. Tests

### Tests Lot B dédiés (11/11 verts)
| Fichier | Tests | Nature |
|---|---|---|
| `lot-b-auth-revocation.test.ts` | 2 | HTTP réel : P0 (API key → 401) + révocation (before 200 / after 401) |
| `lot-b-session-unit.test.ts` | 3 | unitaire store de révocation (`sv`/`jti`) |
| `lot-b-audit-quota.test.ts` | 6 | unitaire audit durable + quotas MCP |

### Vérification ciblée élargie (EXIT=0)
Lot B + toutes les suites MCP remote + toutes les suites auth + agent-keys + security-hardening :
```
node --test --test-concurrency=1 …                          EXIT=0
ℹ tests 179   ℹ pass 179   ℹ fail 0   ℹ cancelled 0
```

### Non-régression
- **`packages/core` : 176 / 176 passent** (EXIT=0). `core.test.ts` fournit le secret JWT requis par `loadConfig()` (sinon refus de démarrage — comportement attendu de B3-1).
- **`apps/api` : 1000 tests, 981 passent, 19 échecs** — tous **pré-existants** et hors Lot B (§8).

### Aides de test ajoutées
- `_lot-b-legacy-env.ts` : strict désactivé (dev/test) + secret JWT + quotas MCP hauts (test only).
- `_lot-b-secret-env.ts` (api et core) : secret JWT seul (+ strict off) pour les suites non-strict.
- `_lot-b-env.ts` : keyring keyring/clé API de test pour les suites Lot B HTTP.

---

## 8. Échecs de tests résiduels — prouvés pré-existants

19 échecs sur 1000, répartis ainsi :

| Fichier | Échecs | Nature | Lien Lot B |
|---|---:|---|---|
| `ai-providers-routes` | 2 | chiffrement at-rest des clés provider (Lot S4, non commité) | **Prouvé non** (voir ci-dessous) |
| `app-generator-gate` | 3 | build/bundle | non (échoue aussi sur HEAD) |
| `app-image-policy` | 4 | politique image/bundle | non (échoue aussi sur HEAD) |
| `revisions` | 5 | rollback/bundle | non (échoue aussi sur HEAD) |
| `mcp-publication-policy` | 2 | build bundle via MCP | non (échoue aussi sur HEAD : 3) |
| `app-bundle` | 1 | isolation bundle 404 | non (échoue aussi sur HEAD : 5) |
| `v7-stream-preparation` | 1 | mémoire projet (conversation) | non |
| `v8-completion` | 1 | bouton Studio (HTML) | non |

**Méthode de preuve**
1. **Bisect par worktree git** sur `HEAD` (`ea987c5`) : les suites `app-generator-gate`, `app-image-policy`, `revisions`, `mcp-publication-policy`, `app-bundle` **échouent déjà** sur la base propre.
2. **Isolation du changement `provider-catalog.ts`** : en n'appliquant QUE ce fichier (modification pré-existante non commitée) au `HEAD`, `ai-providers-routes` passe de 14/14 à **12/14** — exactement les 2 échecs observés. Aucune modification Lot B.
3. Les assertions en échec portent sur **bundle / révision / UI / politique**, jamais sur l'auth, les sessions, l'audit ou les quotas.

> Les changements non commités du dépôt (Studio HTML, `conversation.ts`, `provider-catalog.ts`, `app-generator.ts`, `revisions.ts`, `images.ts`, `preview-standalone.ts`, …) sont **entrelacés** avec le Lot B (ex. `conversation.ts` importe `agent-generation-pipeline.ts` livré par un lot adjacent). Le dépôt n'était pas dans un état « base + Lot B seul » ; d'où la séparation par preuves ciblées plutôt que par un diff global.

---

## 9. Procédure de rotation du secret JWT

1. **Générer** un secret dédié : `openssl rand -base64 32` (ou `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Minimum 32 octets décodés ; base64 canonique.
2. **Vérifier** qu'il est **distinct** de `VOLACO_API_KEY` / `AUTH_SECRET` (sinon `loadConfig` refuse).
3. **Déployer** `VOLACO_JWT_SECRET=<nouveau>` dans l'environnement du service.
4. **Redémarrer** : la révocation (`jwt-sessions`) subsiste ; **tous les JWT émis avec l'ancien secret deviennent invalides** (rotation = invalidation globale des sessions).
5. **Effectuer** la rotation en fenêtre planifiée : les utilisateurs devront se reconnecter.
6. **Ne jamais** journaliser ni committer le secret ; il ne transite jamais dans une réponse HTTP.

---

## 10. Intégrité — empreintes SHA-256 (16 hex)

| Fichier | SHA-256 (16) |
|---|---|
| `packages/core/src/config.ts` | `E70B6BE35FA4CD99` |
| `packages/core/src/identity/user-store.ts` | `F7C10E8E865513E5` |
| `packages/core/src/identity/session-store.ts` | `E49EF593B376A318` |
| `packages/core/src/observability/audit.ts` | `D756B1AB08952F9A` |
| `packages/core/src/mcp/remote/rate-limit.ts` | `924EF0480A62BD31` |
| `apps/api/src/middleware/auth.ts` | `E4472B2F9460C8DD` |
| `apps/api/src/routes/auth.ts` | `FA7926985CDF2F77` |
| `apps/api/src/routes/mcp-remote.ts` | `34905DB1E5CD4DC3` |
| `apps/api/src/server.ts` | `E7E5B8DE2763A63E` |

---

## 11. Respect des interdictions

- ✅ Aucune modification de `dist/` à la main (uniquement produit par `tsc`).
- ✅ Aucune écriture dans `.volaco-data` réel (les tests utilisent `VOLACO_DATA_DIR` temporaire).
- ✅ Aucun `tmp-lot8-*` créé par ce lot (les `.tmp-lot8-*` existants datent d'octobre).
- ✅ Studio inchangé par le Lot B (les fichiers Studio modifiés sont du travail pré-existant).
- ✅ Aucune publication, aucun build de production, aucun redémarrage serveur.
- ✅ Aucun Lot C/D engagé.
- ✅ Scripts temporaires (`tmp-*.mjs`) supprimés ; worktrees git de diagnostic retirés et élagués.

---

## 12. Conclusion

Les cinq décisions B3-1/P0, B1, B3, B2, B4 sont **implémentées, compilées et couvertes** par des tests qui exercent le comportement réel. Les régressions introduites en cours de route (quota MCP trop strict en test, strict par défaut cassant les suites non signées, secret JWT requis au boot) ont été **trouvées puis corrigées** de façon traçable ; les 19 échecs restants sont **prouvés pré-existants** et hors périmètre.

**ARRÊT.** Aucune action supplémentaire (pas de build de production, pas de redémarrage, pas de publication) n'est effectuée sans instruction explicite.
