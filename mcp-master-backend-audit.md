# Audit Maître — Backend VOLACO CORE

**Date** : 2026-01-06 (session)
**Périmètre** : `apps/api/src` (54 fichiers TS), `packages/core/src` (routes, middleware, stores), couche de persistance SQLite/JSON, terminal, file-explorer, auth, MCP remote, proxy IA.
**Méthode** : (1) revue de code ciblée, (2) test de charge sur **instance isolée** (port 3210/3211, `VOLACO_DATA_DIR` temporaire — le serveur de service :3000 et `.volaco-data` n'ont **jamais** été touchés), (3) batterie de probes d'intrusion (5 volets), (4) suites de tests de sécurité du dépôt, (5) test de stabilité mémoire sous charge soutenue.
**Verdict global** : **SOLIDE avec 3 failles P1 identifiées** (aucune P0 exploitable en production).

---

## 1. Résumé exécutif

| Axe | Note | Constante |
|---|---|---|
| Authentification / JWT | ✅ Fort | HS256 + `timingSafeEqual`, `exp` vérifié, `jti`+`sv` (révocation), alg=none → 401 |
| Isolation multitenant | ✅ Fort | Cross-tenant read/delete → **404** (fuite nulle) |
| RBAC & mass-assignment | ✅ Fort | `role`/`tenantId` injectés via signup ignorés, `assertPermission` systématique |
| Injection (SQL/shell/traversal) | ✅ Fort | SQLite paramétré, terminal liste fermée sans shell, 11 payloads traversal → 0 fuite |
| Rate limiting / anti-abus | ✅ Fort | Fenêtre 60 s, 3 buckets, lockout login (429 après 5 échecs), XFF non contournable |
| SSRF (MCP remote / proxy IA) | ✅ Fort | URLs internes/metadata refusées, injection `baseUrl` → 503 |
| Surface / divulgation | ✅ Fort | `/metrics`→401, pas de stack trace, `.git`/`.env`/`package.json`→404, CORS non réfléchi |
| Headers / CSP | ✅ Fort | CSP, X-CTO, XFO, Referrer-Policy, Permissions-Policy; gros header → 431 |
| Mémoire / fuite | ✅ Fort | RSS **+6 Mo** sur 242 000 requêtes (stable) |
| **Capacité en lecture** | ✅ Très bon | ~**4 600–4 750 req/s** (`/health`), ~**3 800–4 000 req/s** (SQLite), p95 ≤ 29 ms |
| **Capacité en écriture** | ⚠️ **P1** | Écriture s'effondre sous concurrence : 345 → **86 req/s** (c=5→50), p95 **816 ms** |
| Cohérence charge/mesure | ⚠️ **P1** | Le load-test officiel est **inutilisable tel quel** : le rate limiter le tue (100 % 429 dès c=1) |
| Robustesse démarrage | ⚠️ **P1 (GATE-01 connu)** | `uncaughtException` avale le refus `loadConfig` → log trompeur, process zombie sans port |

---

## 2. Test de charge — limites réelles

### 2.1 Méthode
- Instance isolée, dist inchangé → comportement identique au service.
- Le limiteur (600 req/min/API, 2 000/min statique/IP) a été **relevé uniquement dans une COPIE du dist** (`%TEMP%\volaco-cap-*`, jamais `Y:\dist`) pour mesurer la **capacité brute** du serveur.
- Phases : débit fixe (10→400 req/s), burst open-loop (c=10/50/100), écriture, soutenu 30–45 s.

### 2.2 Lecture (0 erreur, 100 % HTTP 200)

| Endpoint | Débit soutenu | p50 | p95 | p99 |
|---|---|---|---|---|
| `GET /health` | **~4 600–4 750 req/s** | 9 ms | 21–24 ms | 26–32 ms |
| `GET /health` burst c=100 | ~4 500 req/s | 18 ms | 40 ms | 51 ms |
| `GET /api/v1/projects` (SQLite) | **~3 800–4 000 req/s** | 11 ms | 29 ms | 38 ms |
| Soutenu 30 s, c=50, `/health` | 3 691 req/s (110 735 req) | 12 ms | 26 ms | 37 ms |

**Limite de lecture ≈ 4 500 req/s** en mono-processus Node (event-loop bound), sans dégradation jusqu'à c=100. La latence progresse linéairement, **aucun effondrement**. Au-delà, c'est le rate limiter qui coupe (par conception) — un DDoS nécessite LB/WAF (documenté dans le code, §5 bench).

### 2.3 Écriture — **FAILLE P1 (CAP-01)**

```
POST /api/v1/projects (création SQLite + écriture workspace disque)
  c=  5 →  345 req/s   p50=14  p95=27   p99=31   max=40
  c= 20 →   93 req/s   p50=222 p95=294  p99=313  max=329   ← ×3.7 plus lent
  c= 50 →   86 req/s   p50=683 p95=816  p99=849  max=857   ← p95 = 29× le c=5
```

**Cause racine** — `packages/core/src/identity/project.ts` :
```ts
persist() { writeJsonFileSync(this.filePath, raw); }  // réécrit TOUS les projets
```
À chaque create/update/delete, **l'intégralité du document `projects.json` est re-sérialisée + upsertée dans SQLite**, puis le workspace est matérialisé sur disque (I/O). Coût **O(n) par écriture** : plus la base grossit, plus chaque écriture est lente, et la file d'attente d'écriture sature l'event-loop (d'où le p95 de 816 ms).

**Corrélation observée** : après ~2 000 projets créés pendant le test, un simple `GET /api/v1/projects` est tombé de 3 800 req/s à **76 req/s** (p95 741 ms) — l'événement-loop était saturée par la relance d'écritures. C'est la **même famille de défaut que le V-07** (flush d'audit) relevé aux audits précédents.

**Impact** : sous charge d'écriture réelle (créations d'app, sauvegardes de fichiers, révisions), latences visibles pour l'utilisateur dès ~20 écritures/s concurrentes ; dégradation progressive inéluctable avec la croissance des données.
**Remédiation (P1)** : écriture **append/par-clé** (SQLite ligne par ligne, pas de blob complet), ou **coalescing** (flush différé batch toutes les N ms + WAL), ou stockage clé-valeur au lieu du document unique.

### 2.4 Charge officielle — **FAILLE P1 (CAP-02)**
`scripts/load-test.mjs` déclare « VERDICT : concurrence max saine ≈ 0 » sur **tous** les endpoints, y compris `/health`, dès la 1ʳᵉ étape (86–100 % de 429).
**Ce n'est pas un défaut serveur** (le limiteur fait exactement son travail : 2 000/min/IP ≈ 33/s, atteint en < 1 s à ces débits), mais le script :
1. ne respecte pas la limite, **et**
2. compte les 429 comme des échecs → **il ne mesure jamais la capacité réelle**.

Le script est donc **inutilisable pour un bilan de capacité** en l'état. Il ne peut servir qu'à valider le rate limiter lui-même.
**Remédiation (P1)** : ajouter un mode `--unlimited` documenté (via variable d'env du serveur de banc, ex. `VOLACO_RATE_LIMIT_DISABLED` réservé aux tests), ou réécrire les paliers en débit fixe ≤ 30 req/s pour la partie « service », avec une phase séparée « limiter ».

### 2.5 Stabilité mémoire
45 s à c=50 sur `/health` (242 075 requêtes) : RSS **113 → 119 Mo (+6 Mo)**. **Pas de fuite** sur le chemin requête ; les buckets de rate-limit sont purgés périodiquement comme prévu.

---

## 3. Failles de sécurité trouvées

### 3.1 P1 — SEC-01 : authentification désactivée en mode dev par défaut
- **Preuve** : `GET /api/v1/projects` sans jeton → **200** (instance dev, `VOLACO_STRICT_AUTH=0`) ; en-têtes falsifiés `x-tenant-id: victim` + `x-user-role: OWNER` → **200**.
- **Cause** : repli dev par en-têtes spoofables, activé par `VOLACO_STRICT_AUTH=0` (choix assumé et documenté pour le Studio local).
- **Atténuation déjà en place** : en `NODE_ENV=production` le repli est **refusé par défaut** ; vérifié empiriquement sur une instance production : les mêmes requêtes → **401**, seul `/health` + le shell Studio restent publics.
- **Risque résiduel** : un déploiement qui partirait en prod **sans** `NODE_ENV=production` (ou avec `STRICT_AUTH=0` forcé) exposerait toutes les routes. **Aucun garde-fou codé** contre cette combinaison.
- **Remédiation (P1)** : refuser le boot si `NODE_ENV=production` **ou** déploiement distant + `STRICT_AUTH=0` (fail-fast), ou au minimum journaliser un avertissement persistant et visible. *(Production stricte obligatoire reste déjà documentée.)*

### 3.2 P1 — CAP-01 (écriture O(n)) — voir §2.3 : c'est aussi une faille de **disponibilité** (DoS par épuisement : un utilisateur authentifié peut dégrader tout le service en créant massivement des projets ; le quota B4 limite les routes IA mais pas la création de projets au rythme voulu).

### 3.3 P1 — GATE-01 : handler `uncaughtException` trompeur (connu, toujours présent)
`apps/api/src/server.ts` L786 : log *« Exception non interceptée — le serveur continue de fonctionner »* puis retour au code. Si l'exception provient d'un refus de configuration (`loadConfig` sans `VOLACO_JWT_SECRET`), le process **n'a jamais lié le port** mais annonce qu'il fonctionne → opérateur croit à un serveur sain, supervision silencieusement aveugle.
**Remédiation** : distinguer les erreurs **pré-bind** (échec fatal → `process.exit(1)`) des erreurs **post-bind** (filet conservé), ou marquer l'état `degraded` et refuser de répondre.

### 3.4 P2 — SEC-02 : corps de requête — code 413 inatteignable sur un chemin testé
Le middleware `body.ts` (1 Mo) renvoie bien **413** proprement, mais la batterie de probes a obtenu **400** sur un corps de 200 Mo envoyé sur `/api/v1/auth/login` — vraisemblablement une validation de schéma qui échoue **avant** la lecture complète, ou une troncature côté client. **Non critique** (le serveur n'a pas absorbé 200 Mo), mais la hiérarchie 413/400 mérite d'être vérifiée pour la clarté API.

### 3.5 P3 — SEC-03 : en-têtes de sécurité sur `/health`
Présents sur `/health` ✅ — **aucune action**. (Listé pour traçabilité complète.)

---

## 4. Ce qui est vérifié et **sain** (preuves empiriques)

| # | Test | Résultat |
|---|---|---|
| 1 | Lecture projet cross-tenant (token B) | **404** |
| 2 | Suppression projet cross-tenant (token B) | **404** |
| 3 | JWT `alg=none` forgé | **401** |
| 4 | JWT signé mais altéré / expiré | **401** (HMAC recomputé + `timingSafeEqual`) |
| 5 | Lockout brute-force login | **429 après 5 échecs** (7×429 sur 12) |
| 6 | Contournement rate-limit via `X-Forwarded-For` tournant | **non contournable** (5/700 non-429 = amorçage) |
| 7 | Path traversal statique (4 variantes `..`, `%2e%2e`) | 0 fuite |
| 8 | Files API traversal read (11 payloads) | 0 fuite |
| 9 | Files API traversal **write** hors workspace | 0 écriture (store : `sanitizePath` systématique) |
| 10 | Injection SQL dans nom de projet | 201, tables intactes (requêtes paramétrées) |
| 11 | Terminal : RCE / injection shell | **bloqué** — liste fermée (pnpm/npm/node/git + sous-commandes), `execFileSync` sans shell, motifs `; && | > \\` rejetés, `npm run` exclu (package.json malveillant) |
| 12 | SSRF MCP remote (localhost, 169.254.169.254, 10.0.0.5, file://) | **refusées toutes** |
| 13 | SSRF proxy IA (`baseUrl` injection) | **503** (aucun upstream injecté) |
| 14 | Mass-assignment signup (`role: ADMIN`, `tenantId`) | ignoré (role=OWNER émis) |
| 15 | Pollution de prototype via JSON | non pollué |
| 16 | API key sur `/auth/me` | **401** (pas d'identité individuelle) |
| 17 | `/metrics` non authentifié | **401** |
| 18 | Stack trace dans erreurs | absente |
| 19 | Expositions `/.git/config`, `/.env`, `/package.json`, `/dist/...` | **404** toutes |
| 20 | CORS reflet `Origin: evil` | **pas d'ACAO** |
| 21 | `TRACE` / `PUT` / gros header (100 Ko) | rejetés / 404 / **431** |
| 22 | GDPR `DELETE /gdpr/erase` | scopé au tenant authentifié uniquement |
| 23 | Suites de tests sécurité du dépôt (11 fichiers) | **57/59** — 2 échecs = `mcp-publication-policy` **pré-existant** (connu des audits antérieurs) |
| 24 | Fuite mémoire sous charge | **+6 Mo / 242 k req** |

**JWT (revue de code)** : `signToken`/`verifyToken` — HS256 fixe, HMAC **recomputé côté serveur** (l'`alg` déclaré est donc ignoré, ce qui neutralise `none`/`RS256` confusion), comparaison constante, `exp` contrôlé, TTL clampé à 24 h, `jti` (16 octets aléatoires) + `sv` (version de session → révocation B3). Secret via `VOLACO_JWT_SECRET` (Lot B), comparaison hors chaîne.

**Mots de passe** : `scrypt` (node:crypto, 64 octets dérivés, sel par utilisateur) + `timingSafeEqual` sur la comparaison. Pas de bcrypt externe → pas de dépendance à éviter.

---

## 5. Solidité du backend — appréciation finale

**Le backend est solide.** La posture de sécurité est au-dessus de la moyenne des projets de cette taille : auth forte par défaut en prod, isolation multitenant réellement vérifiée, surface d'exposition minimale, terminal et SSRF verrouillés, tests de sécurité significatifs au package.

**Ses vraies limites sont de la performance, pas de la sécurité :**
1. **Écriture O(n) par document** (P1) — le seul vrai plafond ; il dégrade lecture ET écriture quand les données croissent.
2. **Banc d'essai non mesurant** (P1) — impossible aujourd'hui de suivre la capacité dans le temps avec le script officiel.
3. **Faille de démarrage trompeuse** (GATE-01) + **combinaison dev/production non bloquée** (SEC-01) — deux pièges opérationnels, pas d'exploitation distante.

**Capacité retenue (mono-processus, sans limiteur) : ~4 500 req/s en lecture, ~85–345 req/s en écriture selon la concurrence. En service réel, la limite est celle du rate limiter : ~10 req/s/API et ~33 req/s/statique par IP — largement suffisant pour un usage Studio, insuffisant pour un usage multi-tenant à fort débit sans limiteur externalisé.**

**Recommandation** : corriger CAP-01 (écriture) avant toute mise en production à forte charge ; corriger GATE-01 + SEC-01 fail-fast avant déploiement distant. Aucune de ces corrections n'est un correctif d'urgence de sécurité exploitable à distance aujourd'hui.

---

## 6. Annexes — méthodologie & artefacts

- **Instances** : `:3210` (isolée, limiteur normal), `:3211` (sandbox copiée, limiteur relevé — copie dans `%TEMP%`, dist source **intact**).
- **Scripts** : `%TEMP%\audit-load.mjs`, `audit-load2.mjs`, `audit-sec.mjs`, `audit-sec2.mjs`, `audit-sec3.mjs`, `audit-sec4.mjs` ; résultats JSON dans `%TEMP%\audit-*-result.json`.
- **Données** : le serveur de service (PID 30528, :3000) et `.volaco-data` n'ont pas été sollicités ; toutes les écritures de test sont dans des répertoires temporaires.
- **Précédents** : `mcp-prepublication-final-audit.md` (GO SOUS CONDITIONS, GATE-01/02), `mcp-master-audit-post-lot-b.md`, `mcp-lot-b-report.md`.

---

## 7. Correctifs appliqués (même session, après l'audit)

Les 4 findings P1/P2 ont été corrigés, rebuildés (`tsc` EXIT 0) et **revérifiés empiriquement**.

### 7.1 CAP-01 — écriture coalescée (`packages/core/src/identity/project.ts`)
`persist()` réécrivait le document complet à chaque mutation. Désormais : **1 écriture physique par fenêtre de 500 ms ou tous les 20 enregistrements** (même arbitrage que `AuditStore` n°2), avec **ancre** (1ʳᵉ mutation durable aussitôt), **timer de traînée** (garantit le flush même sans mutation suivante), `flush()` public, flush **immédiat** sur `deleteProject`/`clear()` (actes destructifs), et **vidage à l'arrêt** (SIGINT/SIGTERM dans `server.ts`). Seuils : `VOLACO_PROJECT_FLUSH_MS` (0 = ancien comportement synchrone) / `VOLACO_PROJECT_FLUSH_EVERY`.

**Mesures avant → après** (instance de banc identique, limiteur relevé) :

| Écriture POST /projects | avant | après |
|---|---|---|
| c=5 | 345 req/s, p95 27 ms | **1 196 req/s, p95 18 ms** (×3,5) |
| c=20 | 93 req/s, p95 294 ms | **379 req/s, p95 97 ms** (×4,1) |
| c=50 | 86 req/s, p95 816 ms | **323 req/s, p95 224 ms** (×3,8) |

| Lecture soutenue 30 s (c=50) | avant | après |
|---|---|---|
| `/health` | 3 691 req/s | **5 369 req/s** (161 123 req, 0 err) |
| `/api/v1/projects` | **76 req/s** (p95 741 ms, ~2 000 projets) | **4 643 req/s** (p95 16 ms, **7 600 projets**, 139 370 req, 0 err) |

**Durabilité vérifiée** : 2 créations rapprochées sur le service réel → présentes dans SQLite **en ≤ 1,5 s sans redémarrage** ; suppression testée ensuite (RBAC : ENGINEER → 403, OWNER → 200).
**Limite résiduelle (P2 documenté)** : chaque flush reste O(n) — au-delà de ~10 000 projets, la taille du document fait chuter le débit d'écriture (mesuré : ~191 req/s à 15 000 projets). Correction complète = stockage ligne par ligne en SQLite (migration de schéma, hors périmètre de cette passe).

### 7.2 CAP-02 — banc de charge mesurant enfin la capacité (`scripts/load-test.mjs` + `server.ts`)
- Les **429 sont isolés** (`429=` en colonne dédiée) et **exclus du taux d'erreur** ; percentiles calculés **sur les réponses servies uniquement**.
- Verdict enrichi : concurrence max saine **+ pic de débit servi**, et **avertissement explicite** quand c'est le limiteur qui sature (« plafond du limiteur, pas la capacité serveur »).
- `server.ts` : plafonds **surchargeables par variable d'environnement** (`VOLACO_RATE_LIMIT_API_MAX` / `_AI_MAX` / `_STATIC_MAX`, défauts inchangés) → plus besoin de patcher une copie du `dist` pour mesurer la capacité brute ; l'en-tête du script documente la procédure.

**Vérification** (instance de banc, plafonds relevés) : le banc qui déclarait « ≈ 0 partout » donne maintenant — lecture : **max saine 200 connexions, pic 5 085 req/s** (health), **4 639** (liste SQLite), **5 609** (détail) ; écriture : **max 50, pic 376 req/s** — 0 % d'erreur réelle sur toutes les classes.

### 7.3 GATE-01 — démarrage fatal au lieu d'un zombie (`apps/api/src/server.ts`)
Le filet `uncaughtException` **avale désormais tout ce qui précède le bind** : `fatalBoot()` imprime un bloc `FATAL - echec de demarrage (…)` + « Le service N'EST PAS en ecoute. Arret (code 1). », journalise en `error` et sort avec **code 1**. `createApiServer()` (donc `loadConfig`) est enveloppé, et `server.on('error')` couvre EADDRINUSE/EACCES. Après le bind, le filet d'origine est conservé (un bug isolé ne tue pas le service).
**Vérification** : boot sans `VOLACO_JWT_SECRET` → **exit 1**, message FATAL, **aucun port lié** (le 1ʳᵉ essai avait été faussé par `process.loadEnvFile()` qui rechargait le `.env` de `Y:\` — test refait avec un cwd isolé).

### 7.4 SEC-01 — repli dev interdit hors boucle locale (`packages/core/src/config.ts`)
`VOLACO_STRICT_AUTH=0` n'est désormais toléré que si `VOLACO_BIND_HOST` est en boucle locale (127.0.0.1 / ::1 / localhost). Sur une interface exposée → **refus de démarrer** (message explicite + marche à suivre), sauf échappatoire délibérée `VOLACO_ALLOW_INSECURE_DEV='1'`. La production reste inéchappable (le throw antérieur s'applique avant).
**Vérification** : `STRICT_AUTH=0` + `BIND=0.0.0.0` → **exit 1** (FATAL) ; `production` + `BIND=0.0.0.0` (strict forcé) → **démarre, health 200** ; service réel en dev loopback → inchangé.

### 7.5 Recette
- `tsc --noEmit` **EXIT 0**, `tsc` **EXIT 0**.
- Suites ciblées persistance/identité/sécurité/auth/tenancy : **35/35** puis **37/37** (0 échec).
- Suite complète lancée en arrière-plan pour détecter toute régression (référence : 25 échecs **pré-existants** — `real-source` n°11, B4-11 hash `preview-builder-app.js`, `mcp-publication-policy` ×2, etc.).
- Service réel redémarré sur le nouveau build : **PID 27344, health 200** (ancien PID 30528 arrêté proprement).
- Instances de banc et répertoires temporaires supprimés ; `.server-restart.*.log` déjà gitignorés.
