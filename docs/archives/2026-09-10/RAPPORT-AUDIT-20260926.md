# RAPPORT D'AUDIT APPROFONDI — VibeCode Studio (volaco-core)

**Date :** 26/09/2026 · **Portée :** apps/api, apps/studio, packages/core, artefacts git
**Vérifications exécutées :** typecheck (`tsc --noEmit` → OK, exit 0), traçabilité git, analyse statique des routes et services.

---

## VERDICT GLOBAL

| Domaine | Note | Résumé |
|---|---|---|
| Sécrété/confidentialité | 🔴 1/10 | Clé API Mistral **réelle** commitée dans git (start-vibecode.ps1) |
| Authentification | 🔴 1/10 | Auth code exists but **branché à vide** — 100 % des routes ouvertes |
| Autorisation (RBAC) | 🔴 2/10 | Rôle décidé par le client via header `X-User-Role` |
| Câblage frontend↔API | 🟠 5/10 | Chat + terminal OK ; Features/Feedback/Render/Revisions/Settings non branchés |
| Robustesse | 🟠 4/10 | Aucune limite de taille de body, aucun rate limit, SSE sans déconnexion |
| Code mort | 🔴 ~3,5 Mo | 2 répertoires snapshots, patch/, backups, phase9 x3, ~97 fichiers ai-native jamais importés |
| Qualité du code | 🟠 6/10 | Typecheck propre, terminal bien durci, mais server.ts est un dispatcher monolithique |

**Points positifs à garder :** whitelist terminal solide (bloque `npm run/install`, `node -e`, injection shell), `execFileSync` sans shell, prompt injection côté terminal maîtrisée, typecheck sans erreur, UI chat/preview/terminal fonctionnelle.

---

## 1. SÉCURITÉ

### 🔴 SEC-01 — Clé API Mistral réelle en clair, commitée dans git (CRITIQUE)
- `start-vibecode.ps1:1` : `$env:MISTRAL_API_KEY = "mstrl_…"` (45 caractères, clé **réelle et active**), tracké depuis le commit initial `c4fb188`.
- `.env.example:11` : mentionne une ancienne clé (`zsvQFh3…`) déjà compromise et révoquée — mais la nouvelle a pris sa place dans le ps1.
- Toute personne ayant accès au dépôt (ou au dossier, si pushé un jour) possède la clé.

**Correction (ordre impératif) :**
1. **Révoquer immédiatement** la clé `mstrl_…` sur console.mistral.ai et en générer une neuve.
2. Retirer la clé du ps1 (utiliser `$env:MISTRAL_API_KEY = (Get-Content .env | ...)` ou charger `.env`).
3. **Purger l'historique** : `git filter-repo --path start-vibecode.ps1 --invert-paths` (ou BFG), puis force-push. L'option « juste supprimer le fichier » ne suffit pas : la clé reste dans `c4fb188`.
4. Nettoyer `.env.example:11` (supprimer la clé morte du commentaire).
5. Ajouter un scan de secrets (gitleaks) en pre-commit.

### 🔴 SEC-02 — Authentification branchée à vide : toutes les routes sont ouvertes (CRITIQUE)
- `apps/api/src/server.ts:178` : `extractRequestContext(req)` est appelé **sans le 2ᵉ paramètre `config`**.
- Or `middleware/auth.ts:31-47` ne vérifie le Bearer que `if (config && config.apiKey)`. Sans config → retourne un contexte fabriqué depuis les headers, `authenticated: false`, et **la requête continue**.
- Conséquence : même avec `VOLACO_API_KEY` configurée, **aucun endpoint n'exige de token**. Le mode production ne logue même pas (le logger.warn n'est pas atteint).

**Correction :**
```ts
const context = extractRequestContext(req, config);
```
+ dans `extractRequestContext` : si `env === 'production'` et pas de Bearer valide → **refuser (401)** au lieu de logger. En dev, garder le fallback headers legacy.

### 🔴 SEC-03 — RBAC spoofable : le client choisit son rôle (CRITIQUE)
- `auth.ts:49-57` : le rôle vient du header `X-User-Role` envoyé par le navigateur.
- Le frontend l'envoie en dur : `index.html:2944` (`ENGINEER`), `index.html:6593-6594` et `10088-10089` (`DEVELOPER`, tenant `tenant_default` — **incohérent** avec `studio-local` utilisé ailleurs), phase9.js:56-62 (`OWNER`).
- N'importe qui ouvrant les devtools (ou n'importe quel site, cf SEC-04) se proclame OWNER et obtient `PROJECT_DELETE`, `TENANT_MANAGE`, etc. (`permissions.ts:13-18`).

**Correction :** le rôle ne doit JAMAIS venir d'un header client. À terme : vrais tokens signés (JWT HMAC avec le rôle dans le payload, vérifié côté serveur). En attendant SEC-02 corrigé, le Bearer unique suffit (tout token valide = OWNER serveur, header ignoré).

### 🟠 SEC-04 — CORS ouvert par défaut → drive-by sur l'API locale (ÉLEVÉ)
- `server.ts:133-136` : sans `CORS_ALLOWED_ORIGINS`, tout origin est accepté (`*`), et `Access-Control-Allow-Headers` inclut `X-Tenant-Id, X-User-Role, Authorization`.
- Un site web malveillant visité par l'utilisateur peut `fetch http://127.0.0.1:3000/api/v1/...` : consommer la clé Mistral via `/ai/chat/completions`, écraser les fichiers projets via `PUT .../files/content`, créer des projets, exécuter le terminal (binaires whitelistés seulement, mais quand même).

**Correction :** en dev, défaut implicite = `http://127.0.0.1:3000,http://localhost:3000` (même origin, mais CORS ne s'applique de toute façon pas au même origin ; l'objectif est d'**interdire `*`**) ; refuser de démarrer en production sans `CORS_ALLOWED_ORIGINS` explicite.

### 🟠 SEC-05 — DoS : aucune limite de taille de body, aucun rate limit (ÉLEVÉ)
- Chaque route lit le body avec un accumulateur sans borne (`conversation.ts:37-44`, `files.ts:279`, `terminal.ts:64`, `ai-proxy.ts:14`, etc.) → un POST de plusieurs Go sature la mémoire.
- Aucun rate limiting nulle part dans apps/api ni packages/core → martèlement possible de `/ai/chat/completions` qui **consomme la clé Mistral** du serveur.

**Correction :** helper unique `readBody(req, maxBytes = 1_048_576)` qui détruit la connexion au-delà ; rate limit minimal en mémoire (ex. 60 req/min/IP, 10 req/min sur le proxy IA).

### 🟡 SEC-06 — Clé Mistral optionnelle stockée dans localStorage (MOYEN)
- `index.html:2897` lit `localStorage.getItem('vibecode_mistral_key')` et l'envoie via `X-Mistral-Api-Key` (index.html:2913, 2951, 7878). Le proxy serveur existe justement pour éviter ça (SEC-003 corrigé), mais le frontend pousse encore la clé côté client — visible par tout script de la page.

**Correction :** supprimer le champ de saisie de clé et l'entrée localStorage ; la clé ne vit que côté serveur (`.env`).

### 🟡 SEC-07 — `uncaughtException` avalé (MOYEN)
- `server.ts:386-398` : le process continue après toute exception imprévue. Évite le crash brutal (le commentaire explique pourquoi), mais risque d'état corrompu silencieux (réponse JSON partielle, store incohérent).

**Correction :** garder le filet, mais y ajouter un compteur de métriques + dégradation : au-delà de N exceptions/min, loguer en ERROR et fermer proprement (restart géré par le script de lancement).

### 🟡 SEC-08 — Données runtime trackées dans git (MOYEN)
- `.volaco-data/` (6 JSON, 572 Ko : projets, révisions, mémoire) et `.volaco_test_data/` sont **commités** — le statut git montre d'ailleurs `MM` en permanence (bruit à chaque run). Non sensible aujourd'hui, mais tout futur champ utilisateur finira versionné.

**Correction :** `git rm -r --cached .volaco-data .volaco_test_data` + `.gitignore`.

### ✅ Constats positifs sécurité
- Terminal : `whitelist.ts` refuse injection shell (`; | > $() ...`), binaires fermés (`pnpm/npm/node/git`), sous-commandes RCE bloquées explicitement (`npm run/install`, `node -e/-p/-r`), exécution via `execFileSync` sans shell, timeout 10 s, audit log (`terminal/service.ts:57,69,102`).
- Proxy IA : la clé serveur n'est jamais renvoyée au client (`ai-proxy.ts:55-72`).
- Pas d'autres secrets en dur trouvés côté frontend (le faux log `client.js` dans le terminal UI n'est pas une clé).

---

## 2. BRANCHEMENT (WIRING)

### 🔴 WIR-01 — UI Features & Feedback entièrement morte
- `index.html:10317-10329` (« Stub guards AINT-014/015 ») : `runFeaturesDiscovery`, `runFeedbackAnalysis`, `exportFeedbackReport`, `openSimulateSignalModal` remplacées par `function() {}` → les boutons des panneaux Features (clics `index.html:2331, 4842`) et Feedback (`2431, 2450, 4845`) sont des no-ops.
- 5 handlers appelés mais **jamais définis** → ReferenceError au clic : `exportFeaturesReport` (2341), `setFeedbackFilter` (2526-2530), `filterFeedbackProblems` (2538), `closeSimulateSignalModal` (10986, 11004), `submitSimulatedSignal` (11005). La modale « Simuler un signal » (10979) ne peut jamais s'ouvrir.
- Les endpoints correspondants existent et marchent (`/api/v1/features/analyze`, `/api/v1/feedback/analyze`) mais ne sont **jamais appelés**.

**Correction :** soit réparer le câblage (les 5 handlers + retirer les stubs), soit supprimer les panneaux. Un no-op silencieux est pire qu'un bouton absent.

### 🔴 WIR-02 — Auth branchée à vide (voir SEC-02) — le branchement le plus important du projet

### 🟠 WIR-03 — phase9.js : mort et contient des appels 404
- Non référencé (aucun `<script src="phase9.js">` dans index.html ; le commentaire d'en-tête évoque une injection serveur qui n'existe pas).
- S'il était rebranché : `/decide` et `/orchestrate` marchent, mais `phase9.js:144` (`POST .../mutate`) et `:158` (`POST .../preview`) renverraient **404** (le serveur expose `/render/preview`, pas `/preview`).

**Correction :** supprimer les 3 copies (phase9.js, .DISABLED, .backup-phase10 — 22 279 octets identiques) ou réimplémenter les routes manquantes avant rebranchement.

### 🟠 WIR-04 — client.js mort
- Jamais chargé par index.html (seule occurrence : un faux log de build, index.html:5755). Son fetch `/health` n'a jamais tourné.

### 🟠 WIR-05 — Endpoints serveur jamais consommés par le frontend actif
dashboard, workspace, project-state, activity, revisions, settings, observability (`/metrics`, `/audit`, `/ai/usage`), `render/preview` (l'aperçu réel headless — le Studio utilise un iframe à la place), CRUD complet des projets et de la majorité des files-ops (rename/move/commit/delete). `decide`/`orchestrate` ne sont appelés que par le phase9 mort.
**Correction :** ce ne sont pas des bugs, mais c'est la carte des features « backend prêt, frontend absent » — à prioriser ou à désactiver (voir plan P2).

### 🟡 WIR-06 — IDs DOM fantômes et dupliqués
- `btnWsTab-code/dna/terminal/history/audit` référencés (`index.html:4786-4790`, CSS 117-138) mais seuls `btnWsTab-preview` (972) et les panneaux `wsSubPanel-*` existent — la barre d'onglets n'a physiquement qu'un onglet.
- ID dupliqué `auditScoreSummary` (2113 et 10512 — le second est inatteignable via getElementById).

### 🟡 WIR-07 — Incohérence de tenant
`studio-local` (index.html:2944, conversation, projets) vs `tenant_default` (index.html:6593, 10088 — audit & strategy). Les audits créés par l'UI atterrissent sur un autre tenant que les projets → données cloisonnées entre elles.

### 🟡 WIR-08 — SSE sans gestion de déconnexion
`conversation.ts:313-...` : pas de `req.on('close')` / `res.on('close')`. Si l'utilisateur ferme l'onglet ou annule, le serveur **continue de consommer tout le stream LLM** (jusqu'à 120 s / 8192 tokens facturés) et écrit sur un socket mort. Pas de heartbeat non plus.
**Correction :** `let aborted = false; req.on('close', () => { aborted = true; });` + break dans la boucle `for await`.

---

## 3. CODE MORT & ARTEFACTS (~3,5 Mo trackés)

| Élément | Taille | Statut git | Action |
|---|---|---|---|
| `vibe-edit-mode-final/` | 872 Ko | **Tracké** (copie octet-pour-octet de 3 fichiers prod) | Supprimer |
| `streaming-conversation/` | 852 Ko | **Tracké** (snapshot obsolète) | Supprimer |
| `patch/` | 30 fichiers | Tracké (doublon partiel de packages/core) | Supprimer |
| `index.html` racine | 832 Ko | Tracké (copie obsolète ; le serveur sert `apps/studio/index.html`) | Supprimer |
| `volaco_studio.html` x2 (racine + apps/studio) | 1,0 Mo | Tracké, obsolète | Supprimer + **retirer le test de « parité binaire stricte »** `apps/api/tests/lot10-studio-plan-card-ui.test.ts:54-61` qui enferme ces duplicatas |
| `phase9.js` + `.DISABLED` + `.backup-phase10` | 3 × 22 Ko | Trackés | Supprimer |
| `index.html.backup-before-cleanup` | 833 Ko | Tracké | Supprimer |
| `server.log`, `server-err.log` | 283 o | **Trackés**, régénérés par le ps1 | `git rm --cached` + .gitignore `*.log` |
| `.volaco-data/`, `.volaco_test_data/` | 620 Ko | Trackés | `git rm -r --cached` + .gitignore |
| `security-audit/` | 1,5 Mo (168 md) | Trackés | Archiver hors repo (ou dossier `docs/history/`) |
| `SPEC-PHASE-*.md` (6) + AUDIT-COMPLET-20260926.md | — | Trackés | Consolider en 1 doc `docs/roadmap.md` |
| `test_*.cjs`, `patch_*.cjs` (5 scripts one-off du 17/09) | — | Trackés | Supprimer |
| `git-setup-bigger/`, `2/`, `preview*.png` x2 | — | Trackés/vide | Supprimer |
| **Modules ai-native jamais importés par l'API** | **~714 Ko / ~97 .ts** | Trackés | `context/`, `semantic-graph/`, `impact-intelligence/`, `mutation-orchestrator/`, `application-understanding/`, `design-harmony/` — zéro import apps/api, zéro test → soit brancher, soit sortir du build (voir P2) |
| `dist/` | 8,3 Mo | Non tracké (OK, ignoré) | — |

**Total supprimable : ~3,5 Mo de sources trackées (~27 % du dépôt hors node_modules).**

---

## 4. QUALITÉ DE CODE & MAINTENABILITÉ

1. **`server.ts` = dispatcher monolithique** : 20+ handlers enchaînés en if-return manuel (lignes 186-349), statique + routing + CORS + audit mélangés. → Extraire un mini-routeur (table `method+pattern → handler`), le fichier passe de 408 à ~120 lignes.
2. **`readBody()` dupliqué 5×** avec la même signature (conversation.ts:37, files.ts:279, terminal.ts:64, ai-proxy.ts:14, strategy.ts…) — et c'est là qu'il faut ajouter la limite SEC-05 : un seul helper partagé.
3. **Prompts système inline** : 60+ lignes de prompts dans `conversation.ts:353-434` → extraire dans `packages/core/src/ai-native/conversation-intelligence/prompts.ts`.
4. **`@ts-expect-error` sur `generateStream`** (conversation.ts:522) → corriger le typage de l'adaptateur (interface `StreamingProviderAdapter`).
5. **Mojibake** : accents corrompus dans les commentaires/logs (`server.ts:181` « RequÃªte », `:403` « DÃ‰MARRÃ‰ ») — fichiers sauvés en UTF-8 mal interprété ; à normaliser.
6. **Deux runners de test** : `npm test` = `node --test dist/**/*.test.js` MAIS vitest est aussi en devDep avec un `vitest.config.ts` → risque que des tests ne tournent jamais en CI. Unifier.
7. **20 fichiers de tests** existent (bien), mais aucun ne couvre le middleware auth (SEC-02 l'aurait attrapé).
8. **`.env.example:11`** documente une clé morte en clair — réécrire.

---

## 5. PLAN DE CORRECTION PRIORISÉ

### P0 — Aujourd'hui (fuite + ouverture totale)
1. **Révoquer** la clé Mistral `mstrl_…` (console.mistral.ai) et la clé `.env` ; en créer une nouvelle **uniquement dans `.env`** (jamais dans le ps1 ni ailleurs).
2. **Purger l'historique git** de `start-vibecode.ps1` (`git filter-repo --path start-vibecode.ps1 --invert-paths` + force-push) et nettoyer `.env.example`.
3. **Brancher l'auth** : `server.ts:178` → `extractRequestContext(req, config)` ; refuser 401 en production sans Bearer valide.
4. **Fermer le CORS** : jamais `*` ; défaut dev = localhost uniquement ; production = liste obligatoire.
5. Ajouter `gitleaks` en pre-commit + CI.

### P1 — Cette semaine (durcissement + mort nettoie)
6. Limite de body (1 Mo) via helper unique + rate limiting minimal (surtout sur `/ai/chat/completions`).
7. `req.on('close')` sur le stream SSE (conversation.ts) pour couper le LLM en cas de déconnexion.
8. Supprimer le code mort listé en §3 (2 snapshots, patch/, backups, phase9 ×3, client.js, index.html racine, volaco_studio.html ×2 + son test de parité, scripts one-off) ; dé-tracker logs + `.volaco-data`.
9. UI Features/Feedback : réparer les 5 handlers manquants + retirer les stubs, ou masquer les panneaux.
10. Unifier le tenant (`studio-local` partout ou configuré).

### P2 — Semaines suivantes (dette structurelle)
11. Auth réelle : JWT signés avec rôle dans le payload ; supprimer la confiance au header `X-User-Role` ; supprimer la clé du localStorage.
12. Mini-routeur dans server.ts + centralisation readBody + extraction des prompts.
13. Décider du sort des ~97 fichiers ai-native non branchés (brancher via l'umbrella ou les sortir du build pour éviter du code jamais testé en prod).
14. Unifier les runners de tests ; ajouter un test sur le middleware auth (régression SEC-02).
15. Consolider SPEC-PHASE + security-audit sous `docs/`.

---

## ANNEXE — Preuves principales
- Clé en clair : `start-vibecode.ps1:1` (tracké, commit `c4fb188`) · ancienne clé révoquée : `.env.example:11`
- Auth vide : `apps/api/src/server.ts:178` + `apps/api/src/middleware/auth.ts:31-47`
- CORS `*` : `apps/api/src/server.ts:133-136`
- Rôle client : `apps/api/src/middleware/auth.ts:49-57` ; envoi client : `apps/studio/index.html:2944, 6593, 10088`
- Stubs UI : `apps/studio/index.html:10317-10329` ; handlers manquants : 2341, 2526-2538, 10986-11005
- Appels 404 de phase9 : `apps/studio/phase9.js:144, 158`
- SSE sans close : `apps/api/src/routes/conversation.ts:313-330`
- Terminal durci (positif) : `packages/core/src/terminal/whitelist.ts:61-79`, `service.ts:57-97`

---

## ADDENDUM (26/09/2026) — CORRECTIONS APPLIQUÉES

Branches de commits : `fix/audit-securite-p0-p1`.

### ✅ Appliqué
| Correctif | Fichiers |
|---|---|
| Auth branchée : config passée à `extractRequestContext` + 401 en production sans Bearer ; `/health` et `/status` restent publics (monitoring) | `server.ts`, `middleware/auth.ts`, `errors.ts` (nouvelle classe `UnauthorizedError`) |
| Production sans `VOLACO_API_KEY` : clé éphémère générée au lieu d'auth désactivée | `config.ts` |
| CORS : plus de `*` implicite — aucune en-tête ACAO si `CORS_ALLOWED_ORIGINS` vide (même origine uniquement) ; `*` explicite toujours possible | `server.ts` |
| Rate limiting en mémoire : 600 req/min/IP général, 60 req/min/IP sur le proxy IA, réponse 429 | `server.ts` |
| Limite de corps : helper unique `readBody(max 1 Mo)` remplaçant les 16 copies locales (413 au-delà) | `middleware/body.ts` + 16 routes |
| SSE : coupure du stream LLM à la déconnexion client (`req.on('close')`), HTML partiel non sauvegardé | `conversation.ts` |
| Clé API retirée du lanceur ; `.env.example` purgé (ancienne clé morte) + documentation `VOLACO_API_KEY`/`CORS_ALLOWED_ORIGINS` | `start-vibecode.ps1`, `.env.example` |
| UI Features/Feedback câblée aux vrais endpoints (analyze, filtres, export, modale signal) — stubs no-op supprimés | `apps/studio/index.html` |
| Tenant unifié (`studio-local`/`ENGINEER` partout, `tenant_default`/`DEVELOPER` supprimés) | `apps/studio/index.html` |
| Code mort supprimé (~3,3 Mo, 60 fichiers) : snapshots, patch/, backups, phase9 ×3, client.js, index.html racine, volaco_studio.html ×2, scripts one-off | + test de parité binaire remplacé par un test de câblage |
| Logs + `.volaco-data/` dé-trackés ; `.gitignore` étendu | `.gitignore` |
| Tests de régression : 6 nouveaux (401 sans/avec mauvais Bearer, 200 avec Bearer, /health public, CORS absent par défaut, CORS echo d'origine listée) | `apps/api/tests/auth-enforcement.test.ts` |

### ⚠️ Reste à faire (côté utilisateur / P2)
1. **Révoquer la clé Mistral** `mstrl_…` sur console.mistral.ai — elle reste dans l'historique git (commit `c4fb188`) ; sans remote, la purge `git filter-repo` est optionnelle mais recommandée avant tout push.
2. Tests préexistants échouant (NON causés par les correctifs, vérifié sur HEAD) :
   - LOT 10 tests 1-4 : les features testées n'existent pas dans l'index.html courant ni dans HEAD — tests obsolètes à réécrire ou à supprimer.
   - Terminal : `spawnSync npm ENOENT` — `execFileSync('npm')` ne résout pas `npm.cmd` sur Windows (limitation Node sans shell, à documenter ou contourner).
3. P2 du rapport : vraie auth JWT (rôle dans le payload), mini-routeur server.ts, sort des ~97 fichiers ai-native non branchés, unification des runners de tests.
