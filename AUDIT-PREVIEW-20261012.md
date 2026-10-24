# AUDIT DU PREVIEW — volaco-core (VibeCode Studio Core)

**Date :** 12 octobre 2026
**Périmètre :** Preview Builder (moteur `packages/core/src/preview-builder/**`, page hôte `apps/studio/preview-builder.html` + `preview-builder-app.js`), chaîne serveur du preview (`routes/{app-generator,app-edit,preview-builder,render,visual,repair}.ts`), build et service du bundle (`packages/core/src/app-pipeline.ts`, `routes/app-generator.ts`), VFS et versions (`file-explorer/store.ts`, `model/revision-store.ts`, `routes/revisions.ts`), rendu headless (`ai-native/visual-intelligence/real-renderer.ts`), intégration Studio (`apps/studio/index.html`).
**Méthode :** lecture directe du code (audit read-only) + deux explorations parallèles ciblées (moteur/client, chaîne serveur), dont les constats ont été revérifiés sur le code avant intégration.
**Constats :** **26** — **1 critique**, **8 élevés**, **11 moyens**, **6 faibles**.

**Marqueurs de vérification** — `[V]` vérifié par lecture directe lors de cet audit · `[R]` rapporté par l'exploration parallèle **et** revérifié · `[?]` rapporté, **non revérifié** (à confirmer).

---

## 0. Limites

- **Aucune commande n'a été exécutée** (exécution shell indisponible dans cette session) : ni `npm run typecheck`, ni les tests (`apps/api/tests` + `packages/core/tests/preview-builder`), ni un build, ni un lancement de navigateur. Les effets runtime (blocages, corruption, coût Chromium) sont **déduits du code**.
- Le compartiment « À confirmer » liste explicitement ce qui reste à démontrer par un test ou une exécution.
- Aucun fichier source n'a été modifié.

---

## 1. Verdict

Le Preview est **fonctionnellement riche et architecturalement propre côté moteur**, mais il présente **une faille de confinement à l'exécution** : le contenu généré peut s'exécuter sur l'origine du Studio (donc lire le jeton JWT et la clé IA du `localStorage`) dès qu'il est ouvert hors de l'iframe sandboxée. Autour de ce point, l'audit relève une chaîne d'accès React **sans contrôle de locataire**, un **doublon de listener qui déclenche deux générations** par commande du chat, et une série de fragilités de robustesse (SSE sans fin de flux, builds non atomiques, undo imparfait, erreurs silencieuses).

| Domaine | État | Commentaire |
|---|---|---|
| Isolation d'exécution du preview | 🔴 | Iframe du Builder saine (sans `allow-same-origin`) ; **contournée** par l'ouverture en onglet (bundle et repli `blob:`) — PV-01. |
| Contrôle d'accès du preview | 🔴 | Aucune vérification d'appartenance au locataire sur la chaîne React ; `/preview-bundle/*` hors garde-fou d'authentification — PV-02. |
| Moteur (états, rendu incrémental) | 🟠 | Moteur immuable, défensif, testé (35 fichiers) ; deux transitions non gardées — PV-10. |
| Client / pont Studio | 🟠 | Doublon de listener (double génération), arrêt non signalé au moteur, erreurs muettes — PV-03, PV-20, PV-12. |
| Build & service du bundle | 🟠 | Build dans le processus de l'API, sans verrou, `emptyOutDir` non atomique, repli SPA masquant — PV-06, PV-18, PV-19. |
| Rendu headless / diagnostics | 🟠 | Chromium `--no-sandbox` sur contenu IA, remontée de console au client, `/repair` hors cible pour React — PV-07, PV-16. |
| VFS & versions | 🟠 | Confinement de chemin correct ; plafonds absents, écritures globales synchrones, disque non resynchronisé sur `move` — PV-17. |
| Tests | 🟠 | Moteur bien couvert ; **page hôte, contrat SSE HTTP et accès inter-locataires non couverts** — §8. |

---

## 2. Cartographie réelle du preview

```
Studio (apps/studio/index.html)
├── wsLiveIframe  → /preview-builder.html?v2=1   (sandbox: allow-scripts … allow-same-origin)
│     └── Preview Builder (page hôte)
│           ├── mode HTML  : canvas progressif (PreviewBuildEvent → engine → renderer)
│           └── mode app   : #appBundleFrame → /preview-bundle/<id>/?v=<buildId>
│                             (sandbox SANS allow-same-origin → origine opaque)
├── pont postMessage  : 'start-builder-generation'  (index.html:3233)
└── popoutPreview()    : window.open(bundle) ou blob:  ← casse l'isolation   ⚠ PV-01
Serveur
├── POST /app/generate (SSE) → tool-loop → buildApp → dist → /preview-bundle/:id/
├── POST /app/edit (SSE, propositions) → /app/apply-edits (application) → build → révision
├── POST /…/render/preview → Chromium headless (capture + console + erreurs)
└── POST /…/repair (DIAGNOSIS → PATCH → TEST/VALIDATE, borné à 3)
```
**Chemins morts identifiés :** le moteur de rendu legacy « Stitch » est neutralisé par le mode Builder permanent (`index.html:6311-6316`, gardes `__builderModeActive()`), mais son code (pont de logs `postMessage`, `vibeFixImages`, `stitch*`) reste présent ; `#builderChrome` est masqué en dur `[?]`.

---

## 3. Constat CRITIQUE

### PV-01 — Le contenu généré s'exécute sur l'origine du Studio (vol de jeton et de clé IA) `[V][R]`
**Preuves.**
- `apps/studio/index.html:6517` — `window.open('/preview-bundle/' + encodeURIComponent(pid) + '/', '_blank')` : le bundle **React généré** est ouvert comme document de premier niveau, servi par **le même serveur et la même origine** que le Studio.
- `apps/studio/index.html:6525-6528` — repli HTML : `const blob = new Blob([html], …); const url = URL.createObjectURL(blob); window.open(url, '_blank');` — une URL `blob:` **hérite de l'origine du document créateur** : même conséquence.
- `apps/api/src/routes/app-generator.ts:379-382` — le bundle est servi avec `Access-Control-Allow-Origin: *`, **aucune CSP**, aucun `nosniff`.
- `apps/studio/index.html:2916` (clé Mistral en `localStorage`) et `:2958` (jeton JWT en `localStorage`), envoyé en `Authorization` (`:3026`).

**Impact.** Toute application générée — ou tout contenu ayant influencé le modèle (fichier importé, page collée, dépôt cloné) — exécute son JavaScript avec les privilèges de l'origine du Studio : lecture du `localStorage` (jeton + clé IA), puis appels API au nom de l'utilisateur (terminal, écriture de fichiers, suppression de projet). Le sandbox du Builder (`preview-builder-app.js:1338`, sans `allow-same-origin`) protège correctement le preview **intégré** ; c'est l'ouverture en onglet qui annule cette protection.

**Correctif.** Servir le bundle sur une **origine dédiée** (port distinct ou sous-domaine) avec sa propre CSP ; à défaut, retirer `popoutPreview` du chemin bundle+blob et n'ouvrir le contenu généré que dans l'iframe sandboxée (sans `allow-same-origin`) — et sortir la clé IA du navigateur.

---

## 4. Constats ÉLEVÉS

### PV-02 — Chaîne React sans contrôle de locataire ; routes du preview hors garde-fou d'authentification `[V]`
- `apps/api/src/routes/app-generator.ts:357-364` (bundle) et `apps/api/src/routes/app-edit.ts:194, 249, 386` (`/app/edit`, `/app/apply-edits`, `/app/status`) n'appellent **jamais** `projectStore.getProject(context.tenantId, …)` — vérifié par recherche : 14 autres routes le font (`render.ts:45`, `repair.ts:92`, `visual.ts:226`, `revisions.ts:31`, `conversation.ts:486`…), **aucune** de ces trois-là.
- `packages/core/src/app-pipeline.ts:44-49` — le workspace de build est **global** : `workspaceDir(projectId) = join(repoRoot, 'workspace', projectId)` (contrairement au VFS qui est `tenant/project`).
- `apps/api/src/server.ts:455-459` — le refus d'authentification ne s'applique qu'aux chemins commençant par `/api` : `/preview-bundle/*` et `/preview-builder/*` (routes `app-generator.ts`, `preview-builder.ts`) sont donc **atteignables sans jeton**, même en production.

**Impact.** Avec un `projectId` connu (URLs, journaux, audit), un appelant peut lire les sources React, les modifier via l'édition IA, déclencher un build, lire l'inventaire des fichiers et récupérer le bundle construit — y compris celui d'un autre locataire. Sans jeton, le bundle est lisible via un simple `GET`.

**Correctif.** Ajouter `projectStore.getProject(context.tenantId, projectId)` en tête des trois handlers et de la route du bundle ; indexer le workspace de build par locataire ; étendre le garde-fou d'authentification aux chemins `/preview-bundle` et `/preview-builder` (ou déplacer ces routes sous `/api`).

### PV-03 — Deux générations pour une seule commande du chat (listener enregistré deux fois) `[V][R]`
- `apps/studio/preview-builder-app.js:1004-1012` **et** `:1132-1140` : le **même** `window.addEventListener('message', …)` est posé deux fois ; chaque occurrence fait `promptInput.value = d.prompt; realBtn.click();`.
- `apps/studio/index.html:3233` : le Studio n'envoie la commande qu'**une** fois ⇒ deux `startRealGeneration()` concurrents.
- `apps/studio/preview-builder-app.js:1302` : `if (realSource) realSource.stop();` ne stoppe que la **référence courante** (encore `null` au premier passage) ; `:851-854` : `consume()` est partagé et écrit dans le **même** `state`.

**Impact.** Deux sessions de conversation créées, deux flux SSE, **deux fois le coût IA**, deux builds concurrents sur le même workspace, événements entrelacés dans un même état (sections dupliquées/réinitialisées) et **flux orphelin non arrêtable** sans recharger la page.

**Correctif.** Supprimer le listener dupliqué, et rendre `startRealGeneration` non réentrant (garde d'exécution + `stop()` de toutes les sources actives).

### PV-04 — Aucun timeout ni abandon sur les appels d'édition IA `[?]` (rapporté P1-04)
`packages/core/src/preview-builder/ai-edit.ts` (appels `fetchImpl(options.url, { … })` sans `signal`) ; si le modèle ne répond jamais, les drapeaux `aiPageEditBusy`/`aiAppEditBusy` restent à `true` et **tous les boutons IA deviennent muets** jusqu'au rechargement. → Ajouter `AbortController` + délai borné + libération dans `finally`.

### PV-05 — Fin de flux SSE sans événement terminal ⇒ aperçu bloqué sur « Building… » `[V][R]`
`packages/core/src/preview-builder/adapter.ts:194-206` : à la fin du corps de la réponse (`if (done) break;`), **aucun** `BUILD_COMPLETED`/`BUILD_FAILED`/`BUILD_CANCELLED` n'est synthétisé ; pas de reconnexion (`Last-Event-ID`), pas de délai maximal. L'état moteur reste `building` et le pied de page affiche indéfiniment « Building … » (côté serveur, `startSSE` se contente d'écrire ; rien ne garantit un événement final).

**Correctif.** Émettre un événement terminal explicite côté serveur (y compris sur abandon) et, côté client, synthétiser `BUILD_FAILED`/`BUILD_CANCELLED` à la fermeture du flux.

### PV-06 — Build non atomique, sans verrou, dans le processus de l'API `[V]` + `[?]` (conséquences)
`packages/core/src/app-pipeline.ts:190-230` : `vite.build()` s'exécute **dans le processus qui sert l'API**, avec `build: { outDir: 'dist', emptyOutDir: true }` et **aucun verrou par projet** ; `buildApp` est appelé depuis `/app/generate` (`app-generator.ts`), `/app/apply-edits` et chaque tour de réparation (`app-edit.ts:315`), ainsi qu'après rollback (`revisions.ts`).
**Conséquences.** (a) deux éditions simultanées sur le même projet peuvent vider/corrompre `dist` et mélanger deux bundles (`[?]` à démontrer) ; (b) un build qui échoue après le vidage laisse le preview en 404 alors que le dernier bundle valide existait (`[?]`) ; (c) un build long bloque la boucle d'événements (déjà relevé dans l'audit de sécurité global).
**Correctif.** Build hors processus (worker/fil), verrou par projet, sortie dans un répertoire versionné (`dist-<buildId>`) puis bascule atomique du pointeur servi.

### PV-07 — Chromium headless sans sandbox sur du contenu projet/IA, console renvoyée au client `[V]`
`packages/core/src/ai-native/visual-intelligence/real-renderer.ts` (lancement : `args: ['--no-sandbox', '--disable-setuid-sandbox']`, `page.goto(startUrl, { waitUntil: 'networkidle' })`), `consoleMessages`/`pageErrors` collectés (`:183-215`) puis renvoyés au client (`routes/render.ts`). Aucune restriction réseau : une page rendue peut atteindre n'importe quelle destination, et ses messages de console reviennent à l'appelant (canal d'exfiltration indirect).
**Correctif.** Réactiver le sandbox Chromium, neutraliser le réseau (`route('**')` + liste blanche localhost), filtrer les messages renvoyés.

### PV-08 — Ciblage d'édition incohérent entre inventaire et localisation `[?]` (rapporté P1-02/P1-03)
`packages/core/src/preview-builder/editing.ts` : `locateElement` incrémente `childCount` pour **chaque** balise rencontrée (y compris `script`, `style`, `head`, `meta`, `link`, `title`, `noscript`, `textarea`, `template`), tandis que `inventoryEditableElements` saute ces balises sans incrémenter → les chemins produits par l'inventaire (transmis à l'IA, `app.js:1428`) peuvent désigner un **autre** élément. Second volet : `section-parse.ts` (voir PV-13) peut produire des sections tronquées qui sont ensuite **persistées** au serveur (`app.js:693`, `:1498`) — corruption de fichier avec réponse 200.
**Correctif.** Une seule fonction de parcours partagée (source de vérité unique des index), et refus de persister une section dont l'extraction n'est pas équilibrée.

### PV-09 — SSRF via l'en-tête `Host` dans `/render/preview` `[V]`
`apps/api/src/routes/render.ts:57-58` — `startUrl = http://${req.headers.host}${parsed.url}` injecté dans `page.goto`. (Déjà relevé dans l'audit de sécurité global — SEC-06 — et **inclus ici car il appartient au chemin preview**.) **Correctif :** construire l'URL depuis `127.0.0.1:${config.port}`, jamais depuis `Host`.

---

## 5. Constats MOYENS

| ID | Constat | Preuve | Correctif |
|---|---|---|---|
| PV-10 `[V]` | Transitions non gardées du moteur : `BUILD_FAILED`/`BUILD_CANCELLED` s'appliquent même après `BUILD_COMPLETED` (aperçu terminé rétrogradé en erreur) ; `BUILD_STARTED` vide `components`/`completedSections` sans message ; `stage` hérité si absent | `engine.ts:164-174`, `:265-276` | Garder les transitions terminales ; tracer les redémarrages |
| PV-11 `[V][?]` | HTML non échappé dans le canvas : `c.label` et `c.error` concaténés dans `innerHTML` (`[V]`), HTML « réel » IA (`visuals.ts:201-203`) (`[?]`) ; CSP sans `default-src`, `frame-src`, `form-action`, `style-src` → iframes/`srcdoc` même origine, formulaires et images distants autorisés | `app.js:132,179` ; `preview-builder.html:9` | Échapper systématiquement ; compléter la CSP (`default-src 'none'` + directives explicites) |
| PV-12 `[R]` | Le script d'erreurs en ligne est **bloqué par sa propre CSP** (pas d'`'unsafe-inline'`) et `window.__errs` n'est lu nulle part → pannes silencieuses | `preview-builder.html:474`, `:9` (aucune occurrence de `__errs` dans le JS — vérifié) | Déplacer la capture dans un module `'self'` et l'afficher |
| PV-13 `[V]` | Extraction de sections : pertes **silencieuses** (nom > 40 car., intérieur vide → `continue` ; plafond 40 sections) ; bloc coupé au **dernier** `</div>` de l'intervalle → contenu absorbé/perdu si un `</div>` interne est le dernier | `section-parse.ts:21-33` | Signalier chaque perte ; appariement de balises équilibré plutôt que `lastIndexOf` |
| PV-14 `[?]` | Undo : rejeu de **tous** les snapshots d'un lot dans l'ordre → pour une section éditée plusieurs fois, l'état initial n'est pas restauré et un HTML intermédiaire est persisté | `app.js:1203-1209`, `:1496-1506` | Rejouer en ordre inverse ou restaurer le premier snapshot du lot |
| PV-15 `[V]` | SSE sans backpressure (`res.write(...)` non testé), sans heartbeat ni durée maximale ; détection de déconnexion par `req.on('close')` ; la boucle de réparation continue après déconnexion du client (aucun `AbortSignal` transmis au modèle) | `app-edit.ts:174-179`, `:320-321` | Tester le retour d'écriture, borner la durée, propager l'abandon |
| PV-16 `[V][?]` | `/repair` cible `index.html` **du VFS** — placeholder semé automatiquement (« Hello VibeCode ») pour un projet neuf — et non les sources React `app/**` ni le bundle réellement servi ; Chromium indisponible ⇒ score 100 et `repaired:true` sans analyse (`[?]`) | `repair.ts:57`, `store.ts:133-142` (seed), `repair.ts` (catch) | Cibler le format réel du projet et exposer `renderAvailable:false` |
| PV-17 `[V]` | VFS : aucun plafond de taille de fichier/projet ; `persist()` réécrit **tous** les locataires en JSON **synchrone** à chaque écriture (O(taille totale) sur la boucle d'événements) ; `moveNode` n'écrit pas le fichier déplacé sur le disque et ne supprime pas l'ancien (VFS et workspace divergent) ; `getFile` sur un projet inconnu **crée** le projet | `store.ts:99-113`, `:256-278`, `:133-142` | Plafonds, persistance différée/par projet, resynchronisation disque sur `move`, lecture sans effet de bord |
| PV-18 `[V]` | Repli SPA : toute ressource absente renvoie `200 + index.html` (masque les erreurs, sert du HTML sous une extension JS/CSS) ; bundle sans `nosniff`, sans cache/ETag, sans plafond | `app-generator.ts:366-382` | 404 sur ressource absente, en-têtes corrects |
| PV-19 `[V]` | `ensureWorkspace` copie récursivement le template pour **tout** `projectId` inconnu ⇒ effet de bord disque non borné, déclenchable sans jeton via `/preview-bundle/<id>/` | `app-pipeline.ts:53-60`, `app-generator.ts:364` | Ne matérialiser que pour un projet existant et autorisé |
| PV-20 `[?]` | Le bouton d'arrêt stoppe le transport mais n'informe pas le moteur (aucun `BUILD_CANCELLED`) : statut figé sur `building`, timeline/inspector actifs | `app.js:1698-1701`, `:1723` | Émettre `BUILD_CANCELLED` côté client à l'arrêt |
| PV-21 `[?]` | Identifiants de section concaténés dans des sélecteurs sans `CSS.escape` (nom terminé par un antislash → `DOMException`) ; `canonicalize` n'échappe pas `&` (désynchronisation d'affichage dans l'inspecteur) | `app.js:81, 91, 96, 254, 270` ; `:300` | `CSS.escape` partout ; échapper `&` |

---

## 6. Constats FAIBLES

| ID | Constat | Preuve |
|---|---|---|
| PV-22 `[V]` | Chemin legacy « Stitch » neutralisé mais toujours présent (pont de logs, `vibeFixImages`, `stitch*`) ; `#builderChrome` masqué sans code de révélation `[?]` | `index.html:6311-6336`, `:6338-6447` |
| PV-23 `[V]` | Routes `/preview-builder*` servies sans contrôle de permission (page de démo publique) ; politique d'extension incohérente : `validateAppPath` ancre `index\.html$`, `writeAppFile` non (`index.html.bak` accepté) | `routes/preview-builder.ts`, `app-pipeline.ts:85-95` |
| PV-24 `[V]` | Serveur statique temporaire du rendu : garde `resolved.startsWith(rootDir)` **sans séparateur** (répertoire frère au préfixe commun possible) ; lecture complète en mémoire ; erreur brute renvoyée (`500 String(err)`) | `real-renderer.ts:88-113` |
| PV-25 `[V]` | La validation d'URL d'image pose `img.src = url` sans contrôle de schéma ⇒ le navigateur de l'utilisateur charge des URL arbitraires proposées par le modèle (oracle réseau) | `app.js:507-518` |
| PV-26 `[V]` | Identifiants de projet prévisibles (`'proj_' + Math.random()…`) ; bundle de reprise rechargé avec `?v=resume` (pas de cache-buster unique) ; `ignoredCount` du moteur jamais affiché | `identity/project.ts:50`, `app.js:1254`, `engine.ts:161` |

---

## 7. Points positifs vérifiés

- **Moteur** : état **immuable** (jamais muté en place), garde `status !== 'building'` sur les événements de composant, `COMPONENT_READY` sans `CREATED` ignoré, pas de double complétion, échec de composant **local** (n'interrompt pas le build) — `engine.ts:159-290`.
- **Adaptateur SSE** : normalisation **tolérante et non fatale** (entrée non fiable, JSON invalide signalé, types inconnus ignorés sans injection) — `adapter.ts:219-243`.
- **Isolation du bundle** : iframe sandboxée **sans** `allow-same-origin` (origine opaque), URL encodée, hors du pipeline de rendu (donc jamais détruite par un re-rendu) — `app.js:1325-1351`.
- **CSP du Builder** : `object-src 'none'`, `base-uri 'none'`, `script-src 'self' …` → les scripts et attributs d'événement en ligne du HTML IA sont **inertes**.
- **Éditions refusées explicitement** : schémas dangereux (`javascript:`, `data:`) rejetés côté commande pure avec message lisible — `app.js:723-728`.
- **Confinement d'écriture** : `safeProjectPath`, `validateAppPath`, `writeAppAsset` (assets limités à `public/assets/`) — `app-pipeline.ts:80-160` ; `sanitizePath` du VFS interdit `..`, les segments `.` et le caractère nul — `store.ts:65-91`.
- **Contrôle de locataire présent** dans `render.ts:45`, `visual.ts:226`, `repair.ts:92`, `revisions.ts:31` (le défaut PV-02 est bien une **exception**, pas la règle).
- **Édition IA en deux temps** (`/app/edit` propose, `/app/apply-edits` applique après confirmation) avec `apply-skip` honnête quand un `find` n'est pas unique — `app-edit.ts:140-172`, `:270-290`.
- **Réparation bornée et Pareto-safe** : 3 itérations maximum, patch conservé seulement si le score progresse, restauration sinon — `repair.ts:105+`.
- **Rollback honnête côté HTTP** : les fichiers `app/*` restaurés sont réécrits dans le workspace de build et le bundle est reconstruit — `routes/revisions.ts:96-120`.
- 35 fichiers de tests unitaires couvrent le moteur, le renderer, l'édition, les visuels, la mise en page et le parsing de sections (`packages/core/tests/preview-builder/`).

---

## 8. Couverture de tests (état réel)

**Couvert** — moteur/adaptateur/renderer/édition/layout/visuels/`section-parse` (`packages/core/tests/preview-builder/*` : 35 fichiers) ; côté HTTP : route du module `preview-builder/ai-edit.js`, `GET /preview-bundle/:id/` (HTML autonome), `/app/edit` (propositions différées), `/app/apply-edits` (dont `find` non unique), `/app/status` (`app-bundle.test.ts`, `app-generation-sse.test.ts`, `preview-builder-ai-edit.test.ts`).

**Non couvert** (et responsable de la survie des défauts ci-dessus) :
1. la **page hôte** `preview-builder-app.js` (doublon de listener, undo, arrêt, gestion d'erreurs) ;
2. le **contrat SSE** (fin de flux sans événement terminal, reconnexion, abandon client) ;
3. l'**accès inter-locataires** sur `/preview-bundle` et `/app/*`, l'ouverture du bundle hors iframe ;
4. le **repli SPA**, les builds concurrents et l'échec de build ;
5. `/repair` appliqué à un projet **React** (le cas d'usage réel).

⚠️ Correction d'une affirmation issue de l'exploration parallèle : il **existe** une couverture unitaire du moteur (35 fichiers) — le constat « aucune couverture » est **inexact** et a été écarté. Ce qui manque réellement est la couche client/HTTP listée ci-dessus.

---

## 9. Non vérifiable sans exécution

1. Effets réels du HTML injecté (scripts inertes, iframe chargée, `<style>` appliqué, requêtes `img`) et déclenchement effectif de la `DOMException` de sélecteur.
2. Corruption effective de `dist` sous builds concurrents et moment exact du vidage par Vite (`emptyOutDir`).
3. Coût et comportement de Chromium (lancement par rendu, jusqu'à ~5 par `/repair`), temps de build réel.
4. Comportement du pont SSE en cas de coupure réseau côté navigateur (PV-05/PV-15).
5. Volume des artefacts (bundles, template copié, `persist()` complet) et mesures de performance.
6. Cohérence `X-Frame-Options: SAMEORIGIN` (posé sur le bundle) avec l'iframe sandboxée — à valider à l'affichage.

---

## 10. Plan correctif priorisé

**P0 — avant toute exposition (aujourd'hui)**
1. **PV-01** : servir le bundle sur une origine dédiée (ou supprimer l'ouverture en onglet `bundle`/`blob:`) ; sortir la clé IA du `localStorage`.
2. **PV-02** : `projectStore.getProject(context.tenantId, projectId)` dans `app-generator.ts` (bundle) et `app-edit.ts` (3 handlers) ; workspace de build indexé par locataire ; couvrir `/preview-bundle` et `/preview-builder` par le garde-fou d'authentification.
3. **PV-03** : supprimer le listener dupliqué + garde de non-réentrance sur `startRealGeneration`.

**P1 — semaine**
4. **PV-05/PV-20** : événement terminal garanti (serveur) + synthèse côté client à la fermeture, `BUILD_CANCELLED` sur arrêt.
5. **PV-04/PV-15** : `AbortController` + délais bornés sur les appels modèle ; backpressure et durée maximale des flux.
6. **PV-06** : verrou par projet + bascule atomique `dist-<buildId>` (le preview ne tombe jamais sur un bundle vide).
7. **PV-07** : sandbox Chromium réactivé + réseau restreint + filtrage des messages renvoyés.
8. **PV-13/PV-08** : extraction de sections équilibrée, pertes signalées, index de parcours partagé pour l'édition.
9. **PV-10/PV-11/PV-12** : gardes de transition, échappement systématique, CSP complétée, capture d'erreurs réellement active.

**P2 — fond**
10. **PV-16** : `/repair` aligné sur le format réel du projet (React → sources `app/**` + bundle), avec `renderAvailable:false` explicite.
11. **PV-17/PV-18/PV-19** : plafonds du VFS, persistance différée par projet, resynchronisation disque, 404 au lieu du repli SPA, absence de matérialisation pour un projet inconnu.
12. **§8** : tests de la page hôte (jsdom ou Playwright), du contrat SSE et des accès inter-locataires.
13. Retirer le code legacy « Stitch » devenu inatteignable (PV-22), pour qu'il ne soit pas réactivé par accident.

---

## 11. Annexe — fichiers examinés

`packages/core/src/preview-builder/*` (engine, renderer, layout, visuals, editing, ai-edit, section-parse, adapter, mocks, flags) · `apps/studio/preview-builder.html`, `apps/studio/preview-builder-app.js`, `apps/studio/index.html` (preview, pont, popout, iframes) · `apps/api/src/routes/{app-generator, app-edit, preview-builder, render, repair, revisions}.ts` · `packages/core/src/app-pipeline.ts` · `packages/core/src/file-explorer/store.ts` · `packages/core/src/model/revision-store.ts` · `packages/core/src/ai-native/visual-intelligence/real-renderer.ts` · `packages/core/src/ai-native/execution/store.ts` · `packages/core/src/identity/project.ts` · tests `apps/api/tests/{app-bundle, app-generation-sse, preview-builder-ai-edit}.test.ts` et `packages/core/tests/preview-builder/*` (inventaire).
