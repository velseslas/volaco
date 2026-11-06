# Preview Volaco — comparatif cible/existant et registre des problèmes à corriger

**Date :** 12 octobre 2026 · **Base :** lecture du code du dépôt `volaco-core` (aucune commande exécutée — l'exécution shell est indisponible dans cette session).
**Sources :** `AUDIT-PREVIEW-20261012.md` (constats PV-xx) et `AUDIT-BACKEND-SECURITE-20261012.md` (constats SEC-xx).

**Légende des états :** ✅ présent · 🟡 partiel (existe mais incomplet) · ❌ absent
**Légende des sévérités :** 🔴 critique · 🟠 élevé · 🟡 moyen · ⚪ faible
**Effort :** S = moins d'une journée · M = 1 à 3 jours · L = chantier (plus de 3 jours)

---

# TABLEAU 1 — Ce que vous avez vs ce que décrit l'architecture cible

## 1.1 Les 7 couches de l'architecture cible

| Couche cible | État | Ce que vous avez déjà (preuve) | Ce qui manque |
|---|---|---|---|
| **1. Conversation + Orchestrateur multi-agents** (création, modification, validation, supervision) | 🟡 | Orchestrateur réel et exécution d'agents (`packages/core/src/ai-native/ai-orchestrator/**`, routes `orchestrate.ts`, `agent-execution.ts`), pont conversation → agent dans le bootstrap (`server.ts`), traces d'exécution (`ai-native/execution/store.ts`), décisions/ADR (`decisions.ts`) | Les agents ne **pilotent pas** le preview : pas de boucle agent → runtime → vérification → correctif pilotée de bout en bout ; pas de contrat de « supervision » unifié du preview ; pas de checkpoints d'état d'exécution |
| **2. Virtual File System + Patch Engine** (fichiers, diffs, versions, snapshots) | ✅ | VFS complet (`file-explorer/store.ts` : arborescence, hash, matérialisation disque), versions multi-fichiers + rollback (`model/revision-store.ts`, `routes/revisions.ts`), moteur transactionnel (`mutation-orchestrator/` : `engine/diff.ts`, `preconditions.ts`, `rollback.ts`, `filesystem/snapshot.ts` → `snap-<uuid>`) | Les patchs ne sont **pas appliqués à chaud** au preview (le bundle est reconstruit et l'iframe rechargée) ; undo du Builder imparfait (PV-14) ; plafonds et resynchronisation disque à revoir (PV-17) |
| **3. Runtime navigateur** (React, Vite, TS, Tailwind, HTML/CSS/JS) | 🟡 | Compilation et exécution **réelles** : `app-pipeline.ts` (`vite.build()`, alias `react`/`react-dom` vers le serveur, assemblage single-file), bundle servi par `/preview-bundle/:id/`, canvas progressif du Builder (`preview-builder/engine.ts`), rendu headless serveur (`real-renderer.ts`) | **Dev server : aucun.** **HMR : aucun** (aucune occurrence dans le dépôt) ; chaque édition = build complet + rechargement d'iframe (`?v=<buildId>`) ; pas de serveur d'assets par projet en développement |
| **4. WebContainers ou runtime compatible** | ❌ | — | Tout : aucune occurrence de `webcontainer`, `sandpack` ni équivalent dans le dépôt |
| **5. Runtime cloud isolé** (Next.js, Node, Python, APIs, conteneur durci / MicroVM) | ❌ | — | Tout : aucun conteneur, aucune configuration MicroVM/Docker, aucun runtime serveur pour l'app générée ; seul le serveur du Studio existe |
| **6. Preview Gateway + iframe isolée** (origine dédiée, CSP, réseau contrôlé, authentification) | 🟡 | Iframe du bundle **correctement sandboxée** sans `allow-same-origin` (`preview-builder-app.js:1338-1341`) ; CSP sur la page du Builder (`preview-builder.html:9`) ; serveur statique temporaire lié à `127.0.0.1` pour le rendu (`real-renderer.ts:104-106`) | **Origine dédiée : absente** (bundle servi par la même origine que l'API et le Studio) ; **CSP sur le bundle : absente** ; **authentification du bundle : absente** (chemins hors `/api`) ; **réseau non contrôlé** ; contournement par ouverture en onglet (PV-01) |
| **7. Diagnostics + Tests + Auto-Debug** (logs, erreurs, HMR, corrections contrôlées, checkpoints) | 🟡 | Réparation bornée sur erreurs de **build** (`app-generator.ts:330-352`, `app-edit.ts` tours de réparation), boucle DIAGNOSIS → PATCH → TEST → VALIDATE Pareto-safe pour le HTML (`repair.ts`, 3 itérations max), capture console/erreurs par le rendu headless, traces et métriques | **Logs d'exécution du bundle React non remontés** (origine opaque, pas de canal) ; HMR absent ; pas de checkpoint/restauration d'état d'exécution ; pas de tests automatisés de la page hôte ni du contrat SSE |

## 1.2 Le tableau de capacités de votre message, ligne par ligne

| Capacité demandée | Architecture recommandée (votre message) | État réel | Détail |
|---|---|---|---|
| React / JSX / TSX | Compilation + runtime interactif | ✅ | Compilé par Vite, exécuté dans le navigateur de l'utilisateur (interactif) ; pas de runtime serveur |
| Vite / Tailwind | Dev server et HMR | ❌ | `vite.build()` uniquement ; Tailwind via plugin Vite pour le bundle et via CDN Play dans le Builder |
| Next.js / Node.js | Runtime compatible, navigateur si supporté, sinon cloud | ❌ | Rien |
| Python / FastAPI | Sandbox cloud isolé | ❌ | Rien |
| API REST | Proxy contrôlé et mocks | ❌ | Aucun proxy ni mock d'API pour l'app prévisualisée ; les « mocks » du Builder (`preview-builder/mocks.ts`) sont des données de démonstration d'interface |
| Base de données | PGlite/SQLite de simulation | ❌ | Le SQLite du dépôt est la persistance **du Studio**, pas celle de l'app générée |
| Applications multi-fichiers | VFS, patches atomiques, snapshots | 🟡 | VFS + snapshots transactionnels présents côté **fichiers** ; pas de patch atomique vers le runtime, ni de swap atomique du bundle (PV-06) |
| Auto-correction IA | Logs → diagnostic → patch → tests | 🟡 | Erreurs de build → patch LLM ✅ ; diagnostic visuel + patch Pareto-safe pour le HTML ✅ ; **logs d'exécution React** ❌ ; pas de tests d'exécution |
| Préservation de l'état | HMR si compatible, snapshots et restauration | ❌ / 🟡 | État **d'exécution** : rien (aucun HMR, aucune sérialisation d'état). État **de fichiers** : révisions + rollback ✅ |
| Sécurité | Isolation, permissions, limites CPU/RAM/temps et réseau | 🟡 / 🔴 | Isolation par iframe ✅ mais **contournable** (PV-01) ; permissions ✅ sauf chaîne React (PV-02) ; **aucune limite CPU/RAM/temps** ; Chromium serveur **sans sandbox** ; build dans le processus de l'API |

## 1.3 Votre plan de construction — où vous en êtes

| Étape de votre plan | État | Commentaire |
|---|---|---|
| 1. Audit read-only du Preview, runtimes, fichiers virtuels, sécurité | ✅ | Réalisé : `AUDIT-PREVIEW-20261012.md` + `AUDIT-BACKEND-SECURITE-20261012.md` (le présent document en est la synthèse décisionnelle) |
| 2. Contrat universel `PreviewRuntime` | 🟡 | Le socle existe **déjà** sous forme générique : `PreviewBuildEvent` + `BuildEventSource` (`preview-builder/adapter.ts`) sont indépendants de React, Vite et du transport. À généraliser (`build`/`update`/`logs`/`snapshot`/`dispose`), pas à réécrire |
| 3. Runtime React/Vite réel (compilation, interactions, HMR) | 🟡 | Compilation et interactions ✅ ; HMR ❌ — c'est **le seul écart qui se voit immédiatement à l'usage** |
| 4. Runtime cloud full-stack isolé | ❌ | À décider par un spike borné (WebContainers vs Sandpack vs MicroVM) **après** la gateway |
| 5. Preview Gateway, mocks et bases de développement | ❌ | Prérequis indépendant du choix de runtime : origine dédiée + CSP + contrôle réseau |
| 6. Auto-debug, snapshots, diagnostics, intégration conversationnelle | 🟡 | Amorcée (réparation bornée, traces) ; dépend de la remontée des logs d'exécution |

---

# TABLEAU 2 — Problèmes à corriger et fragilités

## 2.A Bloquants (à traiter avant toute exposition)

| Réf | Problème / fragilité | Sév. | Preuve | Correctif | Effort |
|---|---|---|---|---|---|
| PV-01 | Le bundle généré est ouvert **sur l'origine du Studio** (`window.open` du bundle et repli `blob:`) → lecture du jeton JWT et de la clé Mistral du `localStorage`, appels API au nom de l'utilisateur | 🔴 | `index.html:6517`, `:6525-6528` ; bundle sans CSP + `ACAO: *` en `app-generator.ts:379-382` ; secrets `index.html:2916`, `:2958` | Origine dédiée pour le bundle, ou supprimer l'ouverture en onglet et n'exposer le contenu que dans l'iframe sandboxée ; sortir la clé IA du navigateur | M |
| SEC-04 | Le repli d'authentification par en-têtes non signés (`x-user-role`, `x-tenant-id`) est **actif dans la configuration livrée** → accès complet sans jeton | 🟠 | `middleware/auth.ts:78-103`, `server.ts:455-459`, `.env` (dev, sans `VOLACO_STRICT_AUTH`), preuve d'appels sans Bearer dans `server-err.log:17` | `VOLACO_STRICT_AUTH=1` par défaut, refus 401 sur tout `/api` hors `/auth` et `/health` | S |
| SEC-03 | Liste blanche du terminal contournable : `npm test`, `npm build`, `npm lint` exécutent les scripts du `package.json` du projet (RCE documentée comme bloquée pour `npm run`) | 🔴 | `terminal/whitelist.ts:62-63` vs commentaire `:30-38` et `:75-76` ; exécution réelle `terminal/service.ts:119-125` | Retirer `test`/`build`/`lint`, ou exécuter les scripts dans un environnement isolé | S |
| SEC-01 | Traversée de chemin via `projectId` MCP : lecture de tout fichier du disque (dont `.env`) et écriture hors workspace | 🔴 | `routes/mcp.ts:102`, `app-pipeline.ts:48-49`, `mcp/project-server.ts` (`fs_read`) | Valider le projet par le registre + forme stricte + `realpath` confiné | S |
| PV-02 | **Aucun contrôle d'appartenance au locataire** sur la chaîne React (`/app/*`, `/preview-bundle`) ; ces chemins sont en outre **hors du garde-fou d'authentification** (pas de préfixe `/api`) | 🟠 | `app-generator.ts:357-364`, `app-edit.ts:194/249/386` (aucun `projectStore.getProject`, contrairement à 14 autres routes) ; `app-pipeline.ts:44-49` (workspace global) ; `server.ts:455-459` | Vérifier le projet par le registre, indexer le workspace par locataire, étendre le garde-fou | M |
| PV-03 | Un ordre du chat déclenche **deux générations** : listener `message` enregistré deux fois → deux sessions, deux flux SSE, flux orphelin non arrêtable, coût IA doublé | 🟠 | `preview-builder-app.js:1004-1012` **et** `:1132-1140` ; `index.html:3233` (une seule émission) ; `app.js:1302` (stop de la référence courante seulement) | Supprimer le listener dupliqué + garde de non-réentrance | S |
| SEC-05 | Aucun contrôle d'origine (CSRF) : `Origin` n'est lu que pour l'en-tête CORS, et `readBody` ignore le `Content-Type` → requête « simple » cross-site acceptée | 🟠 | `server.ts:239` ; `middleware/body.ts` | Exiger `Content-Type: application/json` + vérifier `Origin`/`Referer` sur les méthodes mutantes | S |
| SEC-02 | SSRF via le navigateur headless MCP : filtre de schéma seulement → `127.0.0.1`, `169.254.169.254`, réseau local, capture renvoyée ; Chromium en `--no-sandbox` | 🔴 | `mcp/browser-server.ts:54`, `:59`, `:45` | Liste blanche d'hôtes, rejet des plages privées, sandbox réactivé | M |
| SEC-06 / PV-09 | SSRF via l'en-tête `Host` dans le rendu headless `/render/preview` | 🟠 | `routes/render.ts:57-58` | Construire l'URL depuis `127.0.0.1:${config.port}` | S |

## 2.B Robustesse, perte de données et expérience

| Réf | Problème / fragilité | Sév. | Preuve | Correctif | Effort |
|---|---|---|---|---|---|
| PV-05 | Fin de flux SSE **sans événement terminal** ni reconnexion → aperçu bloqué indéfiniment sur « Building… » | 🟠 | `preview-builder/adapter.ts:194-206` | Événement terminal garanti côté serveur + synthèse côté client à la fermeture | S |
| PV-06 | Build **non atomique** et **sans verrou par projet**, exécuté dans le processus de l'API : builds concurrents, `emptyOutDir` avant échec → preview en 404 alors qu'un bundle valide existait | 🟠 | `app-pipeline.ts:190-230` (`emptyOutDir: true`), appelé par `app-generator.ts` et `app-edit.ts:315` | Verrou par projet + build hors processus + bascule atomique `dist-<buildId>` | M |
| PV-04 | Appels d'édition IA **sans timeout ni abandon** → drapeaux `busy` bloqués, tous les boutons IA muets jusqu'au rechargement | 🟠 | `preview-builder/ai-edit.ts` (fetch sans `signal`) + `app.js` (`finally`) | `AbortController` + délai borné + libération garantie | S |
| PV-08 | Ciblage d'édition **incohérent** entre `inventoryEditableElements` et `locateElement` → l'édition peut viser un autre élément ; sections extraites tronquées ensuite **persistées** (corruption, réponse 200) | 🟠 | `preview-builder/editing.ts` (comptage des balises divergent), `section-parse.ts`, `app.js:693`, `:1498` | Un seul parcours partagé ; refuser la persistance si l'extraction n'est pas équilibrée | M |
| PV-13 | Pertes **silencieuses** à l'extraction de sections (nom > 40 caractères, intérieur vide, plafond 40) ; coupe au **dernier** `</div>` de l'intervalle → contenu absorbé ou perdu | 🟡 | `preview-builder/section-parse.ts:21-33` | Appariement de balises équilibré + signaler chaque perte | S |
| PV-14 | Undo : rejeu de tous les snapshots d'un lot dans l'ordre → l'annulation ne restaure pas l'état initial et **persiste** un HTML intermédiaire | 🟡 | `app.js:1203-1209`, `:1496-1506` | Rejeu en ordre inverse ou restauration du premier snapshot | S |
| PV-17 | VFS : aucun plafond de taille ; `persist()` réécrit **tous** les locataires en JSON **synchrone** à chaque écriture ; `moveNode` ne resynchronise pas le disque ; `getFile` crée un projet fantôme | 🟡 | `file-explorer/store.ts:99-113`, `:256-278`, `:133-142` | Plafonds, persistance différée par projet, resynchronisation disque, lecture sans effet de bord | M |
| PV-16 | `/repair` analyse `index.html` **du VFS** (placeholder semé « Hello VibeCode ») et non les sources React ni le bundle servi ; Chromium absent → score 100 et `repaired: true` sans analyse | 🟡 | `repair.ts:57`, `store.ts:133-142` | Cibler le format réel du projet ; exposer `renderAvailable: false` | M |
| PV-19 | `ensureWorkspace` copie le template pour **tout** `projectId` inconnu → effet de bord disque non borné, déclenchable sans jeton via `/preview-bundle/<id>/` | 🟡 | `app-pipeline.ts:53-60`, `app-generator.ts:364` | Ne matérialiser que pour un projet existant et autorisé | S |
| PV-18 | Repli SPA : toute ressource absente renvoie `200 + index.html` (masque les erreurs) ; bundle sans `nosniff`, sans cache/ETag, sans plafond | 🟡 | `app-generator.ts:366-382` | 404 sur ressource absente + en-têtes corrects | S |
| PV-15 | SSE sans backpressure (`res.write` non testé), sans heartbeat ni durée maximale ; boucle de réparation poursuivie après déconnexion du client | 🟡 | `app-edit.ts:174-179`, `:320-321` | Tester l'écriture, borner la durée, propager l'abandon | M |
| PV-10 | Moteur : `BUILD_FAILED`/`BUILD_CANCELLED` s'appliquent même après `BUILD_COMPLETED` (aperçu terminé rétrogradé) ; `BUILD_STARTED` vide le canvas sans message | 🟡 | `preview-builder/engine.ts:164-174`, `:265-276` | Garder les transitions terminales ; tracer les redémarrages | S |
| PV-20 | Le bouton d'arrêt stoppe le transport mais n'informe pas le moteur (aucun `BUILD_CANCELLED`) → statut figé | 🟡 | `app.js:1698-1701`, `:1723` | Émettre l'annulation dans le moteur | S |
| SEC-09 | Appels **synchrones bloquants** sur la boucle d'événements : `execFileSync` (timeout piloté par le client), `scryptSync` sur `/auth/*`, écritures disque + `fsync` par événement d'audit | 🟠 | `terminal/service.ts:81/119`, `identity/user-store.ts:42`, `observability/audit.ts:50` | Variantes asynchrones, timeouts bornés côté serveur, écritures différées | M |

## 2.C Sécurité et durcissement (moyens)

| Réf | Problème / fragilité | Sév. | Preuve | Correctif | Effort |
|---|---|---|---|---|---|
| PV-07 | Rendu headless : Chromium en `--no-sandbox` sur du contenu projet/IA, réseau libre, `consoleMessages` renvoyés au client (canal d'exfiltration) | 🟠 | `real-renderer.ts:192` (`--no-sandbox`), `:183-215` | Sandbox réactivé, réseau restreint, messages filtrés | M |
| SEC-07 | Indice de clé IA (4+4 caractères + longueur) injecté dans les messages d'erreur, renvoyé et **persisté** dans les traces d'exécution | 🟠 | `ai/providers/mistral-adapter.ts:144-145` ; propagation `conversation.ts`, `execution/store.ts:187` | Supprimer l'indice ; journaliser une empreinte non réversible | S |
| SEC-08 | Studio : `innerHTML` sur du contenu LLM, iframe de preview avec `allow-same-origin`, **aucune CSP** côté page Studio | 🟠 | `index.html:11519`, `:11522`, `:7449`, `:1447` | `textContent`/assainissement, retirer `allow-same-origin`, publier une CSP | M |
| PV-11 | HTML non échappé dans le canvas du Builder (`label`, `error`, HTML « réel » IA) ; CSP incomplète (pas de `default-src`, `frame-src`, `form-action`, `style-src`) | 🟡 | `app.js:132`, `:179` ; `preview-builder.html:9` | Échappement systématique + CSP complétée | S |
| PV-12 | Le script de capture d'erreurs en ligne est **bloqué par sa propre CSP** et `window.__errs` n'est jamais lu → pannes silencieuses | 🟡 | `preview-builder.html:474` + `:9` | Déplacer la capture dans un module `'self'` et l'afficher | S |
| SEC-10 | `GET /metrics` accessible **sans authentification** (chemin hors `/api`) | 🟡 | `routes/observability.ts:17` ; `server.ts:459` | Même niveau d'authentification ou retrait de l'alias | S |
| SEC-11 | Journal d'audit **sans identité utilisateur** (`userId: context.role`) → aucune imputabilité | 🟡 | `middleware/auth.ts:10-14`, `server.ts:321/337`, `render.ts:76` | Ajouter `userId` au contexte et le propager | S |
| SEC-12 | Corps de requête **non borné** sur `/api/v1/mcp/call` (accumulateur maison) | 🟡 | `routes/mcp.ts:81` | Utiliser `readBody` | S |
| SEC-13 | Arguments de commande **non validés** au-delà de la sous-commande (`git log --output=<chemin>`, `npm test --prefix=<dir>`) | 🟡 | `terminal/whitelist.ts:122` | Liste blanche d'options ou exécution isolée | M |
| PV-23 | Routes `/preview-builder*` servies sans permission ; politique d'extension incohérente (`validateAppPath` ancre `index\.html$`, `writeAppFile` non) | ⚪ | `routes/preview-builder.ts`, `app-pipeline.ts:85-95` | Uniformiser validation et politique d'accès | S |
| PV-24 | Serveur statique temporaire du rendu : garde `startsWith(rootDir)` **sans séparateur**, lecture complète en mémoire, erreur brute renvoyée | ⚪ | `real-renderer.ts:88-113` | Comparer avec séparateur, borner, assainir les erreurs | S |
| PV-25 | Validation d'URL d'image par `new Image()` : le navigateur de l'utilisateur charge des URL arbitraires proposées par le modèle | ⚪ | `app.js:507-518` | Contrôler le schéma et l'hôte avant chargement | S |
| PV-26 | Identifiants de projet prévisibles (`Math.random`), cache-buster `?v=resume` en reprise, `ignoredCount` jamais affiché | ⚪ | `identity/project.ts:50`, `app.js:1254`, `engine.ts:161` | `randomUUID`, buildId unique, afficher les événements ignorés | S |
| PV-22 | Code legacy « Stitch » neutralisé mais toujours présent (pont de logs, `stitch*`) ; `#builderChrome` masqué sans code de révélation | ⚪ | `index.html:6311-6447` | Retirer les chemins morts pour éviter une réactivation accidentelle | S |

## 2.D Dette transverse et gouvernance

| Réf | Problème | Sév. | Preuve | Correctif | Effort |
|---|---|---|---|---|---|
| SEC-15 | Scanner de secrets **aveugle** sur les fichiers non suivis par git et sur `dist/` | 🟡 | `scripts/check-secrets.mjs` (`git ls-files`, exemption `dist/`) | Scanner le système de fichiers, retirer l'exemption | S |
| SEC-14 | Secrets et **copies intégrales du code** dans l'arbre de travail (`_backup-*`, `patch/`, `*.zip`, `*.bak`), `.gitignore` incomplet | 🟡 | inventaire disque + `.gitignore` | Sortir sauvegardes/archives du dépôt, compléter `.gitignore` | S |
| SEC-16 | `dist/` fait partie du runtime **sans parité source** et le rebuild propre est interdit | 🟡 | `RELEASE-POLICY.md:5` | Rétablir la parité source ↔ binaire, puis builds reproductibles | L |
| SEC-17 | Messages d'erreur internes renvoyés au client | 🟡 | `server.ts:588`, `render.ts:127` | Réponse générique + `requestId`, détails dans les journaux | S |
| SEC-18 | Inscription ouverte accordant `OWNER` sur un nouveau locataire, sans vérification d'email ni invitation | 🟡 | `routes/auth.ts`, `identity/user-store.ts:69-70` | Invitation/allowlist, vérification d'email, quota | S |
| SEC-19 | Jetons : TTL 30 jours, pas de révocation ni de rotation | 🟡 | `identity/user-store.ts:120-140` | Jetons courts + refresh + liste de révocation | M |
| SEC-20 | Limites d'exploitation en mémoire mono-instance (rate limit, sémaphore IA, audit borné à 5 000 événements) | 🟡 | `server.ts:277`, `observability/audit.ts:18/50` | Compteurs partagés, audit append-only persistant | M |
| SEC-26 | **Aucune CI** (typecheck, tests, `npm audit`, scan de secrets, SAST) ; dépendances en plages `^` | 🟡 | absence de `.github/`, `package.json` | Pipeline bloquante + verrouillage | M |
| §8 preview | Tests manquants : **page hôte** (`preview-builder-app.js`), **contrat SSE HTTP**, **accès inter-locataires**, repli SPA, builds concurrents, `/repair` sur React | 🟡 | inventaire des tests (`apps/api/tests`, `packages/core/tests/preview-builder`) | Ajouter ces cas (jsdom ou Playwright pour la page hôte) | M |

---

# Ordre d'exécution recommandé

**Lot 0 — arrêter l'exposition (moins de 2 jours, tout en effort S) :** PV-01 (ouverture en onglet), PV-02 (contrôle de locataire + garde-fou), PV-03 (listener dupliqué), SEC-04 (mode strict par défaut), SEC-03 (`npm test`), SEC-01 (traversée MCP), SEC-05 (contrôle d'origine), SEC-06/PV-09 (URL de rendu).

**Lot 1 — fiabiliser le runtime existant (1 à 2 semaines) :** PV-05, PV-06, PV-04, PV-13, PV-14, PV-10, PV-20, PV-17, PV-19, PV-18, PV-15, SEC-09, PV-07.

**Lot 2 — viser l'architecture cible (par ordre de dépendance) :** Preview Gateway (origine dédiée + CSP + contrôle réseau) → contrat `PreviewRuntime` généralisé depuis `PreviewBuildEvent`/`BuildEventSource` → dev server + HMR pour le runtime navigateur → remontée des logs d'exécution vers la boucle d'auto-debug → spike borné pour le runtime cloud (WebContainers / Sandpack / MicroVM) → mocks et base de développement → checkpoints d'état.
