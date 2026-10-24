# Preview Volaco — état des lieux face à l'architecture cible « Full-Stack Preview Engine »

**Date :** 12 octobre 2026 · **Portée :** Preview Builder, runtime React, service du bundle, rendu headless, VFS/versions, boucles de diagnostic.
**Méthode :** lecture directe du code (aucune commande exécutée — l'exécution shell est indisponible dans cette session). Toutes les affirmations ci-dessous sont adossées à un fichier et une ligne.

---

## 1. Réponse courte

**Non — le Preview actuel n'est pas encore l'architecture cible.** Il en couvre **deux couches sur sept**, partiellement : le *runtime navigateur* (React compilé et interactif, mais **sans dev server ni HMR**) et une partie du *Virtual File System + Patch Engine*. Les cinq autres couches (runtime cloud, gateway, mocks/BDD, auto-debug sur logs d'exécution, isolation ressource) **n'existent pas**.

Autrement dit : ce qui tourne aujourd'hui est un **preview de bundle statique** (build Vite one-shot → HTML autonome servi au navigateur dans une iframe d'origine opaque), et non un **environnement d'exécution d'applications complètes**.

---

## 2. Ce qui existe réellement aujourd'hui

### 2.1 Chaîne de prévisualisation (navigateur)
- Le Studio charge la page du Builder dans son iframe de preview : `apps/studio/index.html:6320-6322` (`frame.src = '/preview-builder.html?v2=1'`), iframe déclarée en `apps/studio/index.html:1444-1448`.
- La page du Builder porte une **CSP** : `apps/studio/preview-builder.html:9` — `script-src 'self' https://cdn.tailwindcss.com; img-src 'self' data: https:; object-src 'none'; base-uri 'none'`.
- En mode application (React), le Builder crée **sa propre iframe** pour le bundle, en **origine opaque** (pas d'`allow-same-origin`) : `apps/studio/preview-builder-app.js:1336-1341` — `sandbox='allow-scripts allow-modals allow-forms allow-popups'`, `src = '/preview-bundle/<projectId>/?v=<buildId>'`.
- Le bundle est servi **statiquement** depuis le disque : `apps/api/src/routes/app-generator.ts:357-380` (`workspace/<projectId>/dist/`, `ACAO: *`, repli SPA sur `index.html`).
- Le cache-buster `?v=<buildId>` implique un **rechargement complet** de l'iframe à chaque build — il n'y a pas de mise à jour à chaud.

### 2.2 Compilation et exécution du code généré
- Build **programmatique** Vite + React + Tailwind, puis assemblage en **un seul fichier HTML** (scripts et CSS inlinés) : `packages/core/src/app-pipeline.ts:190-230` et `inlineBundleIntoSingleFile` (`:175-190`).
- Alias `react`/`react-dom` vers les copies du serveur : **aucun `npm install` côté projet** (`app-pipeline.ts:24-28`, `:210-215`).
- Boucle de génération réelle en SSE, avec **outils** (fs, build) et **réparations bornées** : `apps/api/src/routes/app-generator.ts:330-352` (`build-error` → prompt de correction → rebuild, `maxIterations: 8` pour la boucle d'outils).

### 2.3 Virtual File System, versions, patchs, snapshots
- VFS : `packages/core/src/file-explorer/store.ts` (fichiers virtuels par tenant/projet, matérialisation disque pour l'exécution).
- Versions par révision multi-fichiers + rollback : `packages/core/src/model/revision-store.ts`, utilisé par `apps/api/src/routes/revisions.ts` et `files.ts` (édition de section → révision).
- Moteur transactionnel de mutation : `packages/core/src/ai-native/mutation-orchestrator/filesystem/snapshot.ts` (`createTransactionSnapshot`, `computeTreeHash`), avec `engine/{diff,preconditions,rollback,verification,security}.ts` — **le « Patch Engine » demandé existe déjà**, au niveau fichiers.

### 2.4 Diagnostics existants
- Rendu **headless réel** (Chromium) : `packages/core/src/ai-native/visual-intelligence/real-renderer.ts` → capture PNG + `consoleMessages` + `pageErrors` (`:183-215`), exposé par `apps/api/src/routes/render.ts`.
- Boucle d'auto-réparation **bornée** sur les erreurs runtime + qualité visuelle : `apps/api/src/routes/repair.ts:1-30` (`MAX_REPAIR_ITERATIONS = 3`, `REPAIR_TARGET_SCORE = 90`, patch conservé seulement si le score s'améliore, sinon rollback). Elle opère sur les fichiers du VFS (`fileStore`), donc sur les projets HTML.
- Traces d'exécution et métriques : `packages/core/src/ai-native/execution/store.ts`, `apps/api/src/routes/{executions,observability}.ts`.

### 2.5 Preview Builder (les capacités à conserver)
Modules isomorphes du moteur : `packages/core/src/preview-builder/{engine,renderer,layout,visuals,editing,ai-edit,section-parse,mocks,flags,adapter}.ts` — rendu incrémental par nœud, sélection/Inspector, édition (drag, resize, texte, image, lien), boucles d'édition IA, et **routage d'événements SSE normalisés** (`adapter.ts` : `normalizeGenerationEvent`, sources Mock **et** SSE réelles).

---

## 3. Correspondance avec les 7 couches cibles

| Couche cible | État | Preuve / écart |
|---|---|---|
| Conversation + Orchestrateur multi-agents | **Partiel** | Orchestrateur et exécution d'agents réels (`packages/core/src/ai-native/ai-orchestrator/**`, routes `orchestrate.ts`/`agent-execution.ts`), mais le preview n'est pas encore alimenté par les agents de bout en bout. |
| Virtual File System + Patch Engine | **Présent (fichiers)** | `file-explorer/store.ts`, `revision-store.ts`, `mutation-orchestrator/**` (diff, préconditions, rollback, snapshots transactionnels). |
| Runtime navigateur (React/Vite/TS/Tailwind) | **Partiel — sans dev server ni HMR** | `app-pipeline.ts:190-230` : `vite.build()` **one-shot** ; aucun `vite.createServer`, aucune occurrence de « HMR » dans le dépôt. |
| WebContainers ou runtime compatible | **Absent** | Aucune occurrence de `webcontainer`/`sandpack` dans le dépôt. |
| Runtime cloud isolé (Next/Node/Python/API) | **Absent** | Aucun conteneur, aucune configuration MicroVM/Docker, aucun runtime Python. |
| Preview Gateway (origine dédiée, CSP, réseau, auth) | **Absent** | Le bundle est servi par le **même serveur et la même origine** que l'API (`app-generator.ts:357-380`) ; l'isolation repose uniquement sur l'iframe sans `allow-same-origin`. |
| Diagnostics + Tests + Auto-Debug (logs → patch → tests) | **Partiel** | Erreurs de **build** → réparation (`app-generator.ts:330-352`) ; erreurs **runtime** → réparation pour les projets HTML (`repair.ts`) ; mais les logs d'exécution du **bundle React** ne remontent pas (iframe d'origine opaque : le parent ne peut pas lire sa console). |
| Mocks et base de données de développement | **Absent** | Aucun proxy REST mocké ni base pour l'application prévisualisée (le SQLite du dépôt est la persistance *du Studio*, pas celle de l'app). |
| Limites CPU/RAM/temps/réseau | **Absent côté preview** | Le preview tourne dans le navigateur de l'utilisateur, sans quota ; le Chromium serveur, lui, tourne **sans sandbox** (`packages/core/src/mcp/browser-server.ts:45`). |

---

## 4. Écarts précis à traiter (par ordre de dépendance)

1. **Pas de dev server / HMR.** La mise à jour du preview passe par `vite.build()` complet + rechargement d'iframe. Toute édition (IA ou utilisateur) repart d'un bundle neuf : React perd son état. C'est exactement la mise en garde de l'architecture cible (« le HMR ne garantit pas toujours la conservation de l'état React — prévoir des mécanismes de récupération ») : **aujourd'hui il n'y a ni HMR ni mécanisme de récupération d'état**, seulement des révisions de fichiers.
2. **Pas d'isolation d'exécution côté serveur.** Le code généré s'exécute dans le navigateur du client (bien) mais le rendu/jugement serveur utilise Chromium **sans sandbox**, et le build Vite tourne **dans le processus de l'API** (`app-pipeline.ts:190-230`) — un build long bloque l'API (voir SEC-09 de l'audit de sécurité).
3. **Pas de gateway.** Servir le bundle depuis la même origine que l'API interdit une CSP différenciée et rend toute faille du contenu généré directement exploitante contre l'API ; une origine dédiée (port ou sous-domaine séparé) est la première brique à poser, indépendamment du choix WebContainer/cloud.
4. **Aucune limite de ressources.** Ni temps d'exécution, ni quota mémoire, ni contrôle réseau du contenu prévisualisé.
5. **Aucune remontée de logs d'exécution vers la boucle IA.** Le pont de logs n'existe que pour le chemin HTML `srcdoc` historique ; pour le bundle, l'origine opaque l'interdit par construction → l'auto-debug React doit passer par un canal postMessage explicite ou par un rendu/jugement serveur.
6. **Pas de couche API/mocks/BDD** pour l'application prévisualisée : toute app générée qui appelle une API échoue aujourd'hui silencieusement.
7. **Pas de runtime serveur (Node/Next/Python).** Le dépôt ne contient aucun mécanisme d'exécution backend pour l'app générée ; le seul « backend » du preview est le service statique du bundle.

---

## 5. Conséquence sur l'ordre de construction proposé

- **Étape 1 (audit read-only du Preview)** : cet état des lieux la couvre pour la partie preview/runtime/VFS/sécurité. L'audit de sécurité du dépôt (`AUDIT-BACKEND-SECURITE-20261012.md`) en couvre la moitié « sécurité ».
- **Étape 2 (contrat universel `PreviewRuntime`)** : le socle existe déjà sous une forme exploitable — `PreviewBuildEvent` + `BuildEventSource` (`packages/core/src/preview-builder/adapter.ts`) sont déjà **indépendants de React, Vite et du transport**. C'est le point d'extension naturel d'un `PreviewRuntime` (méthodes `build`, `update`, `logs`, `snapshot`, `dispose`) : à généraliser plutôt qu'à réécrire.
- **Décision de runtime (WebContainers vs Sandpack vs MicroVM)** : à trancher par un **spike borné**, après avoir posé la gateway et le contrat. Ce que le code montre aujourd'hui, c'est que l'alternative « dev server + HMR » est le seul écart qui touche l'expérience utilisateur immédiate, et qu'elle ne dépend pas du choix cloud.

---

## 6. Non vérifiable sans exécution

- Comportement réel du bundle dans le navigateur (HMR absent — déduit de l'absence de dev server dans le code, non constaté à l'exécution) ;
- persistence de l'état React entre deux builds, temps de build mesuré, qualité du rendu des classes Tailwind ;
- fonctionnalité effective de `/repair` sur un projet React (le code cible les fichiers du VFS — `index.html` — donc les projets HTML).
