# AUDIT BACKEND & SÉCURITÉ — volaco-core (VibeCode Studio Core)

**Date :** 12 octobre 2026
**Périmètre :** `apps/api` (34 fichiers de route + serveur HTTP), `packages/core` (identité, persistance, terminal, MCP, pipeline d'app, observabilité, providers IA), configuration (`.env`, `tsconfig.json`, `scripts/`, `.githooks/`, `RELEASE-POLICY.md`), surfaces d'interface du Studio (`apps/studio`) dans la mesure où elles interagissent avec le backend.
**Méthode :** revue statique du code lu intégralement pour chaque constat cité, plus trois explorations parallèles ciblées (injection/exécution/fichiers, secrets/configuration/dépendances, réseau/SSRF/clés IA). Chaque constat porte un **statut de vérification**.
**Nombre de constats :** 26 — **3 critiques**, **6 élevés**, **11 moyens**, **6 faibles**.

---

## 0. Limites de cet audit (à lire avant les conclusions)

- **Aucune commande n'a pu être exécutée dans cette session** (l'exécution shell ne fonctionne pas : pas de `git`, pas de `npm`, pas de `node`). Par conséquent :
  - `npm run typecheck`, `npm test` (≈60 fichiers de tests), `gate1:verify`, `gate2:verify`, `npm run security:check` **n'ont pas été exécutés** ;
  - `npm audit` et l'état des avis de sécurité des dépendances **n'ont pas été vérifiés** ;
  - l'état git (fichiers suivis, historique, présence de `.env` dans l'index) **n'a pas pu être vérifié** ;
  - les flux réellement exploitables (SSRF, blocage d'événements mesuré) sont **déduits de la lecture du code**, pas constatés à l'exécution.
- Les valeurs de secrets sont volontairement **tronquées ou non reproduites** dans ce rapport.
- Rien n'a été modifié dans le dépôt : audit en lecture seule.

---

## 1. Synthèse

| Domaine | État | Commentaire |
|---|---|---|
| Authentification | 🔴 | Le repli d'en-têtes non signés est **actif dans la configuration livrée** ; preuve d'appels API acceptés sans jeton dans les journaux. |
| Autorisation / RBAC | 🟠 | RBAC réellement appliqué dans les services, mais aucun contrôle d'origine (CSRF) et rôle client autorisé hors production. |
| Traversée de chemin / fichiers | 🔴 | `projectId` non validé dans la route MCP → lecture (`.env`) et écriture hors workspace. |
| SSRF / sorties réseau | 🔴 | Navigateur headless sans filtre d'hôte (`--no-sandbox`) + `Host` injecté dans le rendu. |
| Exécution de commandes | 🔴 | Liste blanche du terminal contournable par `npm test` (RCE documentée comme bloquée). |
| Secrets | 🟠 | Clé Mistral réelle en clair dans `.env` (récupérable via le constat ci-dessus) ; indice de clé renvoyé dans les erreurs ; scanner de secrets aveugle sur les fichiers non suivis. |
| Disponibilité / robustesse | 🟠 | Appels **synchrones** (`execFileSync`, `scryptSync`, écritures disque) sur la boucle d'événements ; corps non borné sur une route ; timeouts client. |
| Traçabilité | 🟠 | Journal d'audit sans identité utilisateur (`userId = rôle`). |
| Chaîne logicielle | 🟠 | `dist/` fait partie du runtime sans parité source (politique de release), aucune CI, dépendances en plages `^`. |
| Qualité d'architecture | 🟢🟠 | Séparation routes/services propre, TS strict, tests nombreux ; mais `server.ts` monolithique, validation ad hoc, singletons d'état global. |

**Verdict :** le socle est nettement plus mûr que ce que décrit l'audit du 26/09/2026 (authentification branchée, limite de corps, CORS fermé par défaut, RBAC dans les services, écoute sur la boucle locale). **Mais la configuration livrée laisse l'API sans authentification effective**, et trois chemins permettent aujourd'hui une lecture de fichiers arbitraire, une SSRF complète via navigateur et une exécution de code via `npm test`. Ces quatre points doivent être traités avant toute exposition, même locale, à un contenu non maîtrisé.

---

## 2. Constats CRITIQUES

### SEC-01 — Lecture/écriture de fichiers arbitraires : `projectId` non validé dans la route MCP
**Statut : Vérifié (code lu).**

- `apps/api/src/routes/mcp.ts:102` — `args.unshift(context.tenantId, String(body.projectId ?? 'default-project'));` : l'identifiant de projet **vient du corps de la requête** et devient un argument de processus.
- `apps/api/src/routes/mcp.ts:107` — cet argument est passé au serveur MCP `project-server` (`node <script> <tenantId> <projectId>`).
- `packages/core/src/app-pipeline.ts:48-49` — `workspaceDir(projectId) { return join(workspaceRoot, projectId); }` : aucune validation de forme, **aucun contrôle anti-traversée**.
- `packages/core/src/mcp/project-server.ts` — `fs_read` appelle `readAppFile(projectId, path)`, dont le confinement (`app-pipeline.ts:60-64`, `safeProjectPath`) est calculé **relativement au workspace choisi**, pas relativement à la racine du dépôt.

**Impact.** Avec `projectId = ".."` (ou `..\..\..`), le workspace de référence devient un dossier ancêtre ; `fs_read` lit alors n'importe quel fichier de cet arbre — au premier chef `.env`, qui contient `MISTRAL_API_KEY` (facturation IA, réputation) et sert aussi de source à `AUTH_SECRET` en production. `fs_write` écrit dans les chemins `src/`, `index.html`, `package.json`, `tsconfig.json` d'un répertoire choisi. Accès requis : permission `PROJECT_UPDATE` — c'est-à-dire, en configuration livrée, **aucun jeton** (voir SEC-04).

**Remédiation.**
1. Avant tout appel MCP : résoudre le projet par le registre — `projectStore.getProject(context.tenantId, body.projectId)` — et refuser si introuvable.
2. Valider la forme : `/^[A-Za-z0-9_-]{1,64}$/`.
3. Dans `workspaceDir` : `resolve()`, contrôle `startsWith(workspaceRoot + sep)`, puis `realpath` (protection liens symboliques).
4. Ne jamais faire d'un identifiant client un segment de chemin passé à un processus enfant.

---

### SEC-02 — SSRF complète et navigateur sans sandbox via le serveur MCP « navigateur »
**Statut : Vérifié (code lu).**

- `packages/core/src/mcp/browser-server.ts:54` — le seul filtre est le schéma : `/^(https?:\/\/|data:text\/html)/`.
- `packages/core/src/mcp/browser-server.ts:59` et `:71` — `page.goto(url, …)` puis `page.screenshot({ fullPage: true })` ; la capture revient en base64 au client.
- `packages/core/src/mcp/browser-server.ts:45` — Chromium est lancé avec `['--no-sandbox', '--disable-setuid-sandbox']`.
- Expositions : `apps/api/src/routes/mcp.ts:100-125` (`POST /api/v1/mcp/call`, permission `PROJECT_UPDATE`).

**Impact.** `http://127.0.0.1:<port>`, `http://169.254.169.254/…`, les services du réseau local et les interfaces d'administration sont atteignables, et **leur contenu est renvoyé en image** — un canal de lecture du réseau interne qui contourne toute restriction d'origine. `data:text/html` permet en outre de faire exécuter du HTML/JS arbitraire dans un Chromium **sans sandbox**.

**Remédiation.** Liste blanche d'hôtes (uniquement l'origine du Studio et le port du serveur), résolution DNS suivie du rejet des plages privées/loopback/link-local et des redirections vers celles-ci ; réactiver le sandbox Chromium (`--no-sandbox` ne doit pas être un défaut livré) ; supprimer `data:text/html` ou le confiner à un rendu sans réseau.

---

### SEC-03 — Contournement de la liste blanche du terminal : `npm test` exécute le `package.json` du projet
**Statut : Vérifié (code lu).**

- `packages/core/src/terminal/whitelist.ts:30-38` documente explicitement le blocage de `npm run` / `pnpm run` **parce que** « un `package.json` malicieux peut définir `scripts.evil = "rm -rf /"`… C'est une RCE ».
- `packages/core/src/terminal/whitelist.ts:75-76` bloque donc `npm run`, `pnpm run`.
- **Mais** `packages/core/src/terminal/whitelist.ts:62-63` autorise : `pnpm: ['test','build','lint','--version','-v']` et `npm: ['test','build','lint','--version','-v']`.
- `packages/core/src/terminal/service.ts:119-125` exécute réellement la commande, avec `cwd` = le dossier matérialisé du projet.

**Impact.** `npm test` est l'alias de `npm run test` (avec les hooks `pretest`/`posttest`) : la protection documentée contre la RCE est donc contournable par une seule sous-commande autorisée. Le vecteur réaliste n'est pas l'attaquant distant mais **le contenu non maîtrisé** : projet cloné, archive importée, sortie de génération IA. L'exécution a lieu sous l'utilisateur du serveur.

**Remédiation.** Retirer `test`, `build`, `lint` des binaires `npm`/`pnpm` (ne conserver que `--version`) ou déplacer l'exécution de scripts de projet dans un environnement isolé (conteneur, utilisateur système dédié, système de fichiers en lecture seule hors workspace).

---

## 3. Constats ÉLEVÉS

### SEC-04 — Le repli d'authentification non signé est actif dans la configuration livrée
**Statut : Vérifié (code lu + journaux).**

- `apps/api/src/middleware/auth.ts:78-103` — hors production et sans `VOLACO_STRICT_AUTH=1`, l'absence de jeton retombe sur un contexte fabriqué depuis `x-tenant-id` / `x-user-role` (rôle **choisi par le client**, jusqu'à `OWNER`), `authenticated: false`.
- `apps/api/src/server.ts:455-459` — le refus (`401`) n'est appliqué que si `NODE_ENV=production` **ou** `VOLACO_STRICT_AUTH=1`, et uniquement sur les chemins `/api…`.
- `.env` (lu) — contient `NODE_ENV=development` et **pas** de `VOLACO_STRICT_AUTH`.
- Preuve d'exploitation observée : `server-err.log:17-25` — des requêtes acceptées sans Bearer sur `/api/v1/projects`, `/api/v1/projects/<id>/files/content`, `/api/v1/projects/<id>/conversation/sessions/<sid>/stream` (« en-tetes legacy (mode dev) », 11/10/2026).

**Impact.** Toute personne ou tout processus pouvant joindre `127.0.0.1:3000` agit sans authentification, avec le rôle de son choix. Combiné à SEC-05 (pas de contrôle d'origine), un simple site web visité peut déclencher ces appels. L'écoute par défaut sur la boucle locale (`server.ts:637`) limite — mais ne supprime pas — l'exposition.

**Remédiation.** `VOLACO_STRICT_AUTH=1` par défaut (y compris en développement), et refus `401` pour toute route `/api` hors `/auth/*` et `/health` ; à terme, supprimer le repli d'en-têtes du code.

### SEC-05 — Aucun contrôle d'origine (CSRF) sur les routes mutantes
**Statut : Vérifié (code lu).**

- `apps/api/src/server.ts:239` — `const requestOrigin = req.headers['origin'];` n'est utilisé **que** pour décider de l'en-tête `Access-Control-Allow-Origin` ; aucune comparaison d'`Origin`/`Referer` n'existe dans `apps/api`.
- `apps/api/src/middleware/body.ts` — `readBody` ne vérifie pas le `Content-Type` : un corps JSON envoyé en `text/plain` est interprété normalement.

**Impact.** Une requête « simple » (donc **sans préflight CORS**) émise par un site tiers est envoyée puis traitée : terminal, écriture de fichiers, générations IA facturées, créations/suppressions de projets. Le CORS fermé par défaut empêche seulement la *lecture* de la réponse par le site attaquant, pas l'action. En configuration livrée (SEC-04), l'attaque réussit sans jeton.

**Remédiation.** Exiger `Content-Type: application/json` (sinon `415`) et vérifier `Origin`/`Referer` contre une liste blanche pour toute méthode `POST/PUT/DELETE`, ou exiger un jeton non-cookie du type `X-Requested-With`/CSRF.

### SEC-06 — SSRF via l'en-tête `Host` dans le rendu headless `/render/preview`
**Statut : Vérifié (code lu).**

- `apps/api/src/routes/render.ts:56-59` — `startUrl = \`http://${req.headers.host || '127.0.0.1:3000'}${parsed.url}\`` ; l'hôte provient de l'en-tête `Host` du client et est injecté tel quel dans la navigation Playwright (`real-renderer.ts`).
- La réponse renvoie `screenshotBase64`, `consoleMessages`, `pageErrors` (`render.ts:100-112`).

**Impact.** Le serveur peut être contraint de charger une URL interne et d'en renvoyer une capture. Le chemin imposé (`parsed.url` doit commencer par `/preview-bundle/`) réduit la portée, mais un service interne répondant sur ce préfixe ou une redirection suffit. Accès : `PROJECT_READ`.

**Remédiation.** Ne jamais dériver une URL d'un en-tête client : utiliser `http://127.0.0.1:${config.port}` côté serveur, et valider l'hôte de destination contre une liste blanche.

### SEC-07 — Indice de clé IA renvoyé dans les erreurs et persisté dans les traces
**Statut : Vérifié (code lu ; propagation vérifiée sur un chemin, à confirmer sur les autres).**

- `packages/core/src/ai/providers/mistral-adapter.ts:143-145` — en cas de `401`, le message d'erreur est enrichi : `` `${apiKey.slice(0,4)}...${apiKey.slice(-4)}` `` plus la longueur de la clé.
- Diffusion : `apps/api/src/routes/conversation.ts` (retour `{ updated: false, error: message }` dans le chemin de régénération), `packages/core/src/ai-native/execution/store.ts:187` (`record.summary.error = error.slice(0,300)`), traces relisables via `apps/api/src/routes/executions.ts`.

**Impact.** 8 caractères de la clé + sa longueur sortent du serveur (réponse HTTP, journal, disque). Cela réduit fortement l'espace de recherche d'une clé volée ailleurs et permet de confirmer la validité d'une clé testée.

**Remédiation.** Supprimer l'indice ; à défaut, ne journaliser qu'une empreinte non réversible (ex. `HMAC(secret_serveur, clé)` tronquée) ; filtrer tous les messages d'erreur fournisseur avant réponse et avant persistance.

### SEC-08 — Surface XSS du Studio : iframe `allow-scripts allow-same-origin`, secrets en `localStorage`, aucune CSP
**Statut : Vérifié (code lu).**

- `apps/studio/index.html:1447` — `sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups allow-downloads"` : la combinaison `allow-scripts` + `allow-same-origin` sur un `srcdoc` rend l'isolation inopérante (le document cadre hérite de l'origine du parent).
- `apps/studio/index.html:11519` / `:11522` — `div.innerHTML = content` pour les messages `system`/assistant ; `:7449` — `el.innerHTML = htmlContent` pour la sortie terminal.
- `apps/studio/index.html:2916` — clé Mistral de l'utilisateur en `localStorage` ; `:2958-2963` — jeton JWT en `localStorage`, envoyé en `Authorization`.
- `apps/api/src/server.ts` (`setSecurityHeaders`) — aucun en-tête CSP (exception documentée dans le code, liée à l'iframe `srcdoc`).

**Impact.** Du contenu non maîtrisé (réponse du LLM, message de commit relu par `git log`, fichier importé) s'exécute dans l'origine du Studio, lit `localStorage` (jeton + clé IA) et appelle l'API au nom de l'utilisateur (terminal, écriture de fichiers, suppression de projet). Le jeton étant porteur, aucun second facteur n'arrête la reprise de session.

**Remédiation.** Retirer `allow-same-origin` (et ne pas s'appuyer sur la combinaison avec `allow-scripts`) ; rendre les messages via `textContent` ou un rendu markdown assaini ; cesser de stocker la clé IA côté client (le proxy serveur existe déjà) ; introduire une CSP stricte servie par le serveur.

### SEC-09 — Appels synchrones bloquants et timeouts pilotés par le client (déni de service)
**Statut : Vérifié (code lu).**

- `packages/core/src/terminal/service.ts:81` et `:119` — `execFileSync(...)` avec `timeout: input.timeoutMs ?? 10_000` ; `input.timeoutMs` provient du corps de la requête (`apps/api/src/routes/terminal.ts:66-72`) et n'est **pas borné** en valeur haute.
- `packages/core/src/identity/user-store.ts:42` — `scryptSync` sur `POST /auth/signup` et `/auth/login` ; le verrouillage anti-force brute est indexé sur `IP + email` (`apps/api/src/routes/auth.ts:38-42`), donc **contournable en variant l'email**.
- `packages/core/src/observability/audit.ts:50` + `packages/core/src/persistence/json-disk-cache.ts` — écriture **complète et synchrone** (5 000 événements max) + `fsyncSync` à chaque événement journalisé.

**Impact.** Un seul client peut geler l'unique boucle d'événements du serveur (commande longue, hachage scrypt en rafale, écritures d'audit en rafale) : indisponibilité totale et perte des requêtes en cours.

**Remédiation.** Passer aux variantes asynchrones (`execFile`, `crypto.scrypt`, écritures batchées/différées) ; borner `timeoutMs` côté serveur (p. ex. 5–30 s) ; limiter et file-queue les hachages ; verrouillage anti-force brute également par IP seule.

---

## 4. Constats MOYENS

| ID | Constat | Preuve | Impact / Remédiation |
|---|---|---|---|
| SEC-10 | `/metrics` accessible **sans authentification** (le chemin n'est pas sous `/api`, donc hors du garde-fou global) | `apps/api/src/routes/observability.ts:17` (aucun `assertPermission`) ; `apps/api/src/server.ts:459` (garde limité à `pathname.startsWith('/api')`) | Volumétrie, mémoire, concurrence IA exposées. → Exiger le même niveau d'authentification, ou retirer l'alias `/metrics`. |
| SEC-11 | Journal d'audit **sans identité utilisateur** : `RequestContext` ne porte pas d'`userId` alors que le JWT contient `sub` | `apps/api/src/middleware/auth.ts:10-14` ; `userId: context.role` en `apps/api/src/server.ts:321,337`, `render.ts:76`, `audit.ts:107`, `terminal/service.ts:161` (`'user'`) | Aucune imputabilité : impossible de dire *qui* a exécuté une commande. → Ajouter `userId` au contexte et le propager ; l'exiger pour les actions sensibles. |
| SEC-12 | Corps de requête **non borné** sur `POST /api/v1/mcp/call` (accumulateur maison) | `apps/api/src/routes/mcp.ts:79-83` | DoS mémoire ; contourne la limite de 1 Mo de `middleware/body.ts`. → Utiliser `readBody(req)`. |
| SEC-13 | Arguments de commande **non validés** au-delà de la sous-commande | `packages/core/src/terminal/whitelist.ts:122` (`const args = tokens.slice(1)`) | Permet `git log --output=<chemin>` (écriture de fichier) ou `npm test --prefix=<dir>` (exécution hors projet) — **à confirmer par exécution**. → Liste blanche d'options, ou exécution isolée. |
| SEC-14 | Secrets et **copies intégrales du code** dans l'arbre de travail | `.env` (clé Mistral en clair, lu) ; `_backup-avant-fix-v2-20261012-*`, `_live-line-backup/`, `.memory-backup/`, `patch/`, `restaurer-archive8.zip`, `volaco-fix-*/` ; `.gitignore` (lu) ne couvre ni sauvegardes ni archives | Toute copie ancienne peut contenir des clés révoquées ; confusion sur la version de référence. → Sortir ces dossiers du dépôt, compléter `.gitignore`, et vérifier l'historique git (non vérifiable ici). |
| SEC-15 | Scanner de secrets **aveugle sur les fichiers non suivis** et sur `dist/` | `scripts/check-secrets.mjs` : `git ls-files` / `git diff --cached`, exemption explicite `'dist/'` | `.env`, sauvegardes, scripts non indexés ne sont jamais scannés → faux sentiment de sécurité. → Scanner le système de fichiers (hors `node_modules`) et retirer l'exemption `dist/`. |
| SEC-16 | `dist/` fait partie du **runtime** avec des phases absentes des sources, et le rebuild propre est interdit | `RELEASE-POLICY.md:5` (« contains installed AI phases that are not all represented in TypeScript source… Never run `rm -rf dist` / `npm run build` ») | Du code exécuté en production **n'est pas auditable** depuis les sources : risque de sécurité et de conformité majeur. → Rétablir la parité source↔binaire, puis reprendre des builds reproductibles. |
| SEC-17 | **Messages d'erreur internes renvoyés au client** | `apps/api/src/server.ts:588` (`context: { original: message }`, sérialisé par `errors.ts:toJSON`) ; `apps/api/src/routes/render.ts:127` (`message` brut du rendu) | Fuite de chemins disque, erreurs SQL/Vite/Playwright, détails d'implémentation. → Réponse générique + `requestId`, détails uniquement dans les journaux. |
| SEC-18 | **Inscription ouverte accordant `OWNER`** sur un nouveau tenant, sans vérification d'email ni invitation | `apps/api/src/routes/auth.ts` (signup) ; `packages/core/src/identity/user-store.ts:69-70` | Création de comptes en masse (10 000 max), chaque compte étant souverain sur son tenant ; anti-abus limité au rate limit global. → Invitation/allowlist, vérification d'email, quota par IP. |
| SEC-19 | **Cycle de vie des jetons absent** : TTL 30 jours, pas de révocation ni de rotation (pas de `nbf`/`aud`/`iss`) | `packages/core/src/identity/user-store.ts:120-140` (`signToken`, `verifyToken`) | Un jeton volé reste valide un mois, sans moyen de le révoquer. → Jetons courts + refresh, liste de révocation, `kid`. |
| SEC-20 | **Limites d'exploitation en mémoire mono-instance** : rate limit, sémaphore IA, stores, audit borné à 5 000 événements | `apps/api/src/server.ts:277` (`rateBuckets`), `audit.ts:18,50` | Aucune protection réelle en multi-processus ; perte des compteurs au redémarrage ; audit tronqué silencieusement (perte de preuve). → Compteurs partagés (Redis/DB), audit en append-only persistant. |

---

## 5. Constats FAIBLES

| ID | Constat | Preuve | Remédiation |
|---|---|---|---|
| SEC-21 | Comparaison **non constante** de la clé API (`token !== config.apiKey`), longueur minimale arbitraire (≥ 8) | `apps/api/src/middleware/auth.ts:23` | `crypto.timingSafeEqual` sur des empreintes de longueur fixe. |
| SEC-22 | Clé API de développement **connue** (`dev-key-change-me`) donnant `OWNER` | `packages/core/src/config.ts:43` | Générer une clé aléatoire au premier démarrage, l'écrire dans `.env`, refuser les valeurs de repli publiques. |
| SEC-23 | Identifiants de projet **prévisibles** (`Math.random`) | `packages/core/src/identity/project.ts:50` | `randomBytes`/`randomUUID` comme pour les utilisateurs. |
| SEC-24 | `decodeURIComponent` non protégé sur un segment d'URL → exception → 500 | `apps/api/src/routes/files.ts:100` | Valider la forme avant décodage, ou envelopper dans un `try` renvoyant 400. |
| SEC-25 | Métadonnées et indices techniques exposés (`/health` : version, env, uptime ; message d'installation Chromium) | `apps/api/src/routes/health.ts` ; `apps/api/src/routes/render.ts:126` | Réduire le détail hors développement ; réserver le diagnostic aux journaux. |
| SEC-26 | **Aucune CI** ni barrière automatique ; dépendances en plages `^` ; hook `pre-commit` limité aux lignes indexées | absence de `.github/` ; `package.json` ; `.githooks/pre-commit` | Pipeline : typecheck, tests, `npm audit`, scan de secrets complet, SAST ; verrouillage des versions. |

---

## 6. Audit backend (hors sécurité)

**Points solides vérifiés.**
- Séparation nette routes (`apps/api/src/routes/*.ts`) / métier (`packages/core/src/**`), avec le RBAC appliqué **dans les services** (`packages/core/src/workspace/service.ts:60,112,181`), ce qui limite les oublis au niveau des routes.
- Isolation de locataire réelle dans les stores (`packages/core/src/identity/project.ts:83-90` : un projet d'un autre tenant est introuvable) et contrôle de locataire systématique dans les services.
- TypeScript strict (`tsconfig.json` : `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — socle sain, à condition que `tsc` soit vert (non vérifié ici).
- Validation centralisée du corps de requête (`middleware/body.ts`, limite 1 Mo, drainage propre du socket) ; erreurs typées avec codes et `requestId`.
- Observabilité présente : métriques HTTP, instantané runtime, sémaphore IA (`tryAcquireAiSlot` / `releaseAiSlot`), `/health`.
- Politique de release et hooks documentés ; ~60 fichiers de tests et deux gates (`scripts/run_gate1_tests.mjs`, `run_gate2_tests.mjs`).

**Faiblesses structurelles.**
1. `apps/api/src/server.ts` (~650 lignes) concentre routage, service statique, CORS, en-têtes, rate limiting, sémaphore IA et **bootstrap de 15 services** : difficile à tester et à faire évoluer ; le service statique y côtoie la logique de sécurité.
2. **Validation ad hoc répétée** : chaque route refait `JSON.parse` puis des contrôles manuels ; aucun schéma partagé (aucune bibliothèque de validation déclarée dans `package.json`) → les oublis sont structurellement possibles (SEC-12 en est l'illustration).
3. **Parsing d'URL dupliqué** dans chaque route (`pathname.substring(...).split('/')`) au lieu d'un routeur à paramètres : source d'incohérences entre routes sœurs.
4. **Singletons de module** comme conteneurs d'injection (`export const terminalService = …`, `export const fileExplorerService = …`) : état global partagé, tests dépendants de l'ordre, impossible de substituer un store sans recharger le module.
5. **Persistance mono-instance** (SQLite/JSON) sans migrations versionnées, sans sauvegarde automatique, sans arrêt propre (aucun gestionnaire `SIGTERM`) et sans vérification d'état des dépendances au démarrage.
6. **Traitement lourd dans le processus HTTP** : `vite.build()` (`packages/core/src/app-pipeline.ts:190-230`) s'exécute dans le même processus que l'API — un build concurrence les requêtes et amplifie SEC-09.
7. **Journalisation mixte** : journal structuré (`logger`) mais aussi `console.log`/`console.warn` directs (démarrage, secrets) ; messages français/anglais mêlés ; aucune séparation des événements de sécurité.
8. **Arbre de travail encombré** : 3 copies du projet, archives, patchs et sauvegardes (SEC-14) — la « version de référence » n'est pas évidente pour un nouvel intervenant.

---

## 7. Points positifs de sécurité vérifiés

- Aucun `eval`, `new Function` ni `vm` dans le code backend ; seulement **deux** points de création de processus : `packages/core/src/mcp/client.ts:12` (`spawn`, sans `shell`) et `packages/core/src/terminal/service.ts:5` (`execFileSync`, sans `shell`).
- Métacaractères shell rejetés avant exécution (`whitelist.ts:12-24`) **et** absence de shell à l'exécution : pas d'injection de commandes par les arguments.
- Mots de passe : `scrypt` + `timingSafeEqual` (`user-store.ts:42,86`) ; JWT HMAC comparé en temps constant (`user-store.ts:154`) ; clé API dérivée de `AUTH_SECRET` en production (`config.ts:22-24`).
- En-têtes de sécurité génériques appliqués à toutes les réponses ; **CORS fermé par défaut** (aucun `Access-Control-Allow-Origin` sans `CORS_ALLOWED_ORIGINS` explicite) ; **écoute sur `127.0.0.1` par défaut** (`server.ts:637`) ; `X-Request-Id` propagé.
- Rate limiting par IP (600/min, 60/min sur le proxy IA) et sémaphore de concurrence IA avec `503 + Retry-After`.
- Aucune traversée par `..` encodé sur le service statique : l'URL est normalisée par `new URL` (le pourcentage n'est pas décodé) et le nom de fichier est refusé s'il contient `..`.
- Le pipeline d'applications confine les écritures (`safeProjectPath`, `validateAppPath`, `writeAppAsset` limité à `public/assets/`) — le défaut de SEC-01 vient de la **racine choisie**, pas de ces contrôles.
- Masquage des données sensibles avant journalisation (`packages/core/src/security/secrets.ts`) et à la lecture des réglages (`settings/service.ts:13,72-76`).
- `start-vibecode.ps1` ne contient plus de clé (le chargement passe par `.env`) — la régression décrite dans l'audit du 26/09 est corrigée dans l'arbre de travail.

---

## 8. Non vérifiable sans exécution

1. `npm run typecheck`, `npm test`, `gate1:verify`, `gate2:verify`, `npm run security:check` — **non exécutés**.
2. Avis de sécurité des dépendances (React 19, Vite 5, `playwright-core` 1.63, Tailwind 4, TypeScript 5.4) — non consultés.
3. État git : `.env` suivi ou non, clé Mistral présente dans l'historique, contenu des archives `restaurer-archive8.zip` / `volaco-fix-preview-v2.zip`.
4. Exploitabilité effective de SEC-13 (`git log --output=`), portée réelle de SEC-06, et mesure du gel d'événements de SEC-09.
5. Absence de parité `dist/` ↔ sources au-delà de la déclaration de `RELEASE-POLICY.md`.

---

## 9. Plan de remédiation priorisé

**Immédiat (0–24 h) — arrêter l'exposition**
1. `VOLACO_STRICT_AUTH=1` dans `.env` (et en faire le défaut du code), puis redémarrer et vérifier qu'un appel sans jeton reçoit bien `401`.
2. **Révoquer et régénérer la clé Mistral**, puis vérifier qu'aucune clé ne subsiste dans l'historique git et dans les sauvegardes.
3. SEC-01 : valider `projectId` par le registre avant tout appel MCP.
4. SEC-03 : retirer `test`/`build`/`lint` des sous-commandes `npm`/`pnpm`.
5. SEC-06 : construire l'URL de rendu depuis `127.0.0.1:${config.port}`, jamais depuis `Host`.

**Court terme (1–2 semaines)**
6. SEC-02 : liste blanche d'hôtes + rejet des plages privées + sandbox Chromium réactivé.
7. SEC-05 : exiger `Content-Type: application/json` et contrôler `Origin`/`Referer` sur les méthodes mutantes.
8. SEC-07 et SEC-17 : filtrer les messages d'erreur (aucun indice de clé, aucun détail interne).
9. SEC-09 : `execFile` asynchrone, `scrypt` asynchrone, écritures d'audit différées, bornage serveur des timeouts.
10. SEC-11 : ajouter `userId` au contexte d'authentification et le propager dans l'audit.
11. SEC-08 : retirer `allow-same-origin`, assainir les rendus de messages, sortir la clé IA du navigateur, publier une CSP.
12. SEC-12 / SEC-13 / SEC-15 / SEC-10 : corps borné partout, options de commandes validées, scan de secrets complet, `/metrics` authentifié.

**Fond (1–2 mois)**
13. Routeur déclaratif avec paramètres + validation par schéma partagé.
14. Persistance avec migrations versionnées, sauvegardes, arrêt propre, supervision des dépendances.
15. CI bloquante : typecheck, tests, `npm audit`, scan de secrets, SAST.
16. Rétablir la parité source↔binaire et sortir `dist/` du rôle de runtime.
17. Nettoyer sauvegardes/archives du dépôt et documenter la version de référence.
18. Séparer l'origine du Studio de l'API (ou CSP stricte + jetons courts) pour réduire la portée de SEC-08.

---

## 10. Annexe — fichiers examinés (lecture directe)

`apps/api/src/` : `server.ts`, `middleware/auth.ts`, `middleware/body.ts`, `routes/{auth,projects,projects\|files,terminal,ai-proxy,mcp,render,observability,settings,workspace,health,preview-builder}.ts` (+ inventaire et contrôle RBAC des 34 routes).
`packages/core/src/` : `config.ts`, `errors.ts`, `logger.ts`, `identity/{permissions,project,tenant,user-store}.ts`, `persistence/json-disk-cache.ts`, `observability/{audit}.ts`, `security/secrets.ts`, `terminal/{whitelist,service}.ts`, `mcp/{browser-server,project-server,client}.ts`, `app-pipeline.ts`, `ai/providers/mistral-adapter.ts`, `ai-native/execution/store.ts`, `workspace/service.ts`, `settings/service.ts`, `ai-native/agent-runtime/**` (inventaire).
Racine : `.env`, `.env.example`, `.gitignore`, `package.json`, `tsconfig.json`, `RELEASE-POLICY.md`, `RAPPORT-AUDIT-20260926.md`, `scripts/{run-tests,check-secrets}.mjs`, `.githooks/pre-commit`, `server-err.log`, `start-vibecode.ps1`.
`apps/studio/index.html` : iframe de prévisualisation, envoi des en-têtes d'identité, stockage local des secrets, rendu des messages et de la sortie terminal.
