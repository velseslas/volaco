# Matrice de câblage V7 — état au 23/10/2026

Critère « branché » : service réellement instancié + utilisé par un flux produit
+ persistance/trace + test + preuve live. Une route qui n'est appelée par
personne est `PARTIEL`, pas `BRANCHÉ`.

## Lot V7-WIRE-1 livré (ce jour)

| Élément | Avant | Après |
|---|---|---|
| Impact Intelligence | service instancié, utilisé seulement par le chemin `processTurn`/agents, jamais par le stream SSE principal | analysé **avant chaque modification** du stream (`targetFiles: ['index.html']`), résultat réel émis en frame `on_impact_assessed`, persisté en événement `IMPACT_ASSESSED`, exposé dans `done.impact` |
| Application Model | recalculé uniquement sur `GET /application-model` ; panneau Studio alimenté par une heuristique DOM locale | réassemblé depuis les sources réelles **après chaque mutation persistée** (fichier + révision), upsert dans `applicationModelStore`, événement `APPLICATION_MODEL_REFRESHED` ; le panneau Studio lit le modèle serveur (repli local explicite si l'API est absente) |
| Mémoire projet | route `GET /conversation/memory` écrite mais inatteignable (parseur exigeait `/sessions`) → 404 générique, alors que la mémoire existait | routage corrigé (`/conversation/memory`), réponse 200 réelle ; test de non-régression |

Fichiers touchés : `apps/api/src/routes/conversation.ts`,
`apps/api/src/routes/application-model.ts`, `apps/api/src/server.ts`,
`packages/core/src/ai-native/execution/{types,activity}.ts`,
`apps/api/tests/v7-stream-wiring.test.ts`,
`apps/api/tests/conversation-question-planfirst.test.ts`.

## Lot V7-WIRE-2 livré (ce jour)

| Élément | Avant | Après |
|---|---|---|
| Mutation Orchestrator (AINT-006) sur le stream | le stream écrivait `index.html` en direct (`fileStore.saveFile`), sans snapshot ni vérification ; le service n'était utilisé que par `/agents/execute` | la persistance passe par un plan `CREATE_FILE`/`UPDATE_FILE` → validation → exécution atomique (snapshot, diff, vérification) → rollback automatique ; frames SSE `file_created`/`file_modified` + événements `FILE_CREATED`/`FILE_MODIFIED` avec `engine: AINT-006`, `planId`, `transactionId` |
| Repli | aucun (écriture directe implicite) | explicite et tracé : `MUTATION_FALLBACK` si le moteur est absent ou si le plan est refusé **avant** écriture ; `MUTATION_ROLLED_BACK` si l'écriture a été annulée — dans ce cas aucune reprise directe (le contenu rejeté ne fuit pas) |
| Registre de transactions | `Map` non bornée : une transaction par génération, fuite mémoire à terme | LRU borné (`transactionsMaxEntries`, défaut 100) ; les accès lecture/rollback rafraîchissent la position ; rollback d'une transaction évincée = `NotFoundError` honnête |

Fichiers touchés : `packages/core/src/ai-native/mutation-orchestrator/{types,service}.ts`,
`apps/api/src/routes/stream-mutation.ts` (nouveau), `apps/api/src/routes/conversation.ts`,
`apps/api/src/server.ts`, `packages/core/src/ai-native/execution/{types,activity}.ts`,
`packages/core/tests/ai-native/mutation-orchestrator/mutation-orchestrator.test.ts`,
`apps/api/tests/v7-mutation-wiring.test.ts`.

## Lot V7-WIRE-3 livré (ce jour)

| Élément | Avant | Après |
|---|---|---|
| Impact dans la carte d'exécution | événement persisté mais invisible pendant le flux | la frame `on_impact_assessed` porte la vue `activity` ; le Studio affiche le risque réel et le nombre de nœuds impactés avant la mutation |
| Validation Chain | route `/validation` écrite, jamais appelée par le stream | exécutée **après la persistance** (`runValidationChain`, 5 étapes) ; résultat consultatif persisté (`VALIDATION_STARTED`/`VALIDATION_COMPLETED`) et exposé dans `done.validation` ; le Quality Gate visuel reste le score de référence |
| Decision Engine (conseil) | `/decide` non appelé par le flux ; un appel par génération aurait pollué le ledger (`PROPOSED` listés par `GET /decisions`) | consulté **avant le plan** en mode `record: false` : verdict réel (contraintes + alternatives + contradictions), frame `on_decision_assessed`, événement `DECISION_ASSESSED`, `done.decision` ; **zéro écriture** dans le Decision Ledger ; verdict non bloquant dans ce lot |

Fichiers touchés : `apps/api/src/routes/conversation.ts`,
`apps/api/src/routes/decide.ts`, `apps/api/src/server.ts`,
`packages/core/src/ai-native/decision-engine/decision-engine.ts`,
`packages/core/src/ai-native/execution/{types,activity}.ts`,
`apps/studio/index.html`, `apps/api/tests/v7-stream-wiring.test.ts`,
`packages/core/tests/ai-native/decision-engine/decision-engine.test.ts`.

## Lot V7-WIRE-4 livré (ce jour)

| Élément | Avant | Après |
|---|---|---|
| Panneau Évolution (AINT-017) | le panneau « Opportunités » appelait directement `/features/analyze` (AINT-014) ; le moteur AINT-017 n'était atteignable que par API | le panneau appelle `POST /evolution/analyze` (`forceRecompute: true`), rend le readiness, la santé produit et les propositions réelles (priorité, preuves, urgence, quadrant, statut) ; export JSON du rapport AINT-017 ; erreurs de rafraîchissement explicites, dernier rapport conservé sans être présenté comme frais |
| Invariant preuves | — | chaque proposition affichée porte au moins une évidence ; projet vide → aucune proposition (NO EVIDENCE → NO CLAIM) |

Fichiers touchés : `apps/studio/index.html`,
`apps/api/tests/v7-evolution-wiring.test.ts`.

Nettoyage associé : suppression des générateurs legacy morts du Studio
(`generateInstantApp`, `generateEngineeringPlan`, `executePlanAction`,
`dismissPlanAction`, registre `activeEngineeringPlans`), soit ~16 Ko de JS
inline en moins ; le test `lot-polish` garde désormais leur absence.
Fichiers : `apps/studio/index.html`, `apps/api/tests/lot-polish.test.ts`.

## Lot V7-WIRE-5 livré (ce jour)

| Élément | Avant | Après |
|---|---|---|
| AI Orchestrator multi-agents (AINT-010) | service instancié et route `/orchestrate` accessible, mais **aucun appel produit** ; runs uniquement en cache LRU mémoire | action explicite **« Analyser avec les agents »** dans la carte de plan du Studio : le run réel (état, tâches, artefacts, conflits, traces, tokens/coût) est rendu, exportable en JSON ; aucune génération standard n'est alourdie (coût déclenché à la demande) |
| Lecture seule | `autoMutateIfLowRisk=false` forcé par la route, mais aucune preuve produit | la carte affiche « aucune mutation (lecture seule) » ; test live : hash de `index.html` identique avant/après, cible de test absente |
| Persistance | cache mémoire seulement ; redémarrage = run perdu | `OrchestrationRunStore` persistant (`orchestration-runs`, borne 50), `GET /projects/:id/orchestrations` (historique filtré tenant+projet) et `GET /projects/:id/orchestrate/:orchestrationId` (détail) ; le Studio consulte l'historique depuis la carte |
| Timeout de graphe | `setTimeout` de garde jamais annulé : 15 s × nb de tâches de handles après chaque run | timer annulé dans `finally` ; la suite passe de ~106 s à ~1,3 s sur la tranche |

Fichiers touchés : `packages/core/src/ai-native/ai-orchestrator/{run-store.ts,index.ts,service.ts}`,
`apps/api/src/routes/orchestrate.ts`, `apps/studio/index.html`,
`apps/api/tests/v7-orchestrator-wiring.test.ts`.

## Lot V7-HARDEN-1 livré (ce jour)

| Élément | Avant | Après |
|---|---|---|
| DecisionLedger | tableau JSON non borné ; croissance illimitée si `/decide` est appelé en masse | borne LRU configurable (défaut **500**, minimum 1) : `getById`, `accept`, `reject`, `supersede` rafraîchissent la récence ; les plus anciennes sont évincées ; élagage aussi au chargement, puis persistance |
| Preuve | — | test unitaire **18/18** (dont éviction + relecture) ; preuve live `maxEntries=5` : 6 décisions → 5, `dec-live-1` évincée, `dec-live-2` relue survit, relecture persistante = 5 ; campagne **693/693** |

Fichiers touchés : `packages/core/src/ai-native/decision-engine/decision-ledger.ts`,
`packages/core/tests/ai-native/decision-engine/decision-engine.test.ts`.

## Lot V7-UI-1 livré (ce jour)

| Élément | Avant | Après |
|---|---|---|
| Impact / Décision / Validation dans la carte | la ligne de statut était masquée par la ligne de progression (`vl-host` + `:has(.vl-card.vl-work)`), donc l’impact et la décision n’étaient pas visibles dans le flux par défaut | canal `.vl-advisory` rendu au-dessus de la progression : `Impact`, `Décision` et `Validation` restent visibles, avec tons `warn`/`danger` ; la ligne de statut historique reste utilisée quand la ligne de progression est désactivée |
| Preuve navigateur | — | capture Studio rejouant les charges utiles réelles de `proj_ktw3zaiyj` / `req_58b9bade42d64ae0` : 3 avis visibles (`Impact : LOW · 0 nœud impacté`, `Décision : READY · Approche incrémentale avec preview`, `Validation : Validation en chaîne : PASS (4/5 étapes PASS)`), puis la progression `3 étapes` ; `advisoryDisplay=flex`, `rowCount=3`, `statusDisplay=none` (ancien canal masqué) |

Fichiers touchés : `apps/studio/index.html`,
`apps/api/tests/v7-stream-wiring.test.ts`.

## Preuves du 22/10/2026

- Campagne dist lots 1–3 : **684/684 tests, 163 suites, 0 échec**.
- Campagne dist lot 4 : **687/687 tests, 164 suites, 0 échec**
  (499 + 188 en deux lots ; la limite de 120 s du shell a imposé la césure).
- Typecheck : 0 erreur.
- Live planFirst (`proj_ilamxm3di`, `req_8fafe045b5f646e0`) :
  `IMPACT_ASSESSED` = risque LOW, 0 nœud impacté (projet mono-fichier isolé),
  puis `WAITING_CONFIRMATION`. Aucune génération LLM.
- Live mutation réelle lot 1 (projet sonde `proj_db3uzhgeq`,
  `req_65c3bfbd57694f15`) : `done.updated=true`, gate **98/100**,
  événements `IMPACT_ASSESSED` (#4) puis `APPLICATION_MODEL_REFRESHED` (#9),
  HTML final contient « Bienvenue V7 », modèle : 1 révision / 1 plan mémoire,
  `GET /conversation/memory` = 200.
- Live mutation réelle lot 2 (projet sonde `proj_c6uludr9u`,
  `req_295d3167a04b46d0`) : `done.updated=true`, gate **98/100**, impact LOW,
  frame SSE `file_modified`, événement `FILE_MODIFIED` (#9) avec
  `engine=AINT-006`, `plan=plan-26773c07-…`, `tx=tx-7050b4fa-…`,
  +3/−1 lignes ; **aucun** `MUTATION_FALLBACK` ; HTML final contient
  « Bienvenue V7-WIRE-2 » ; modèle 1 révision / 1 plan mémoire.
- Panneau Studio « Modèle » : rendu réel `am:624794362d212851` (4 sources,
  30 révisions) vérifié dans le navigateur, `data-source="application-model"`,
  aucune erreur JS (script inline 946 Ko : `node --check` OK).
- Live mutation réelle lot 3 (projet sonde `proj_ktw3zaiyj`,
  `req_58b9bade42d64ae0`) : `done.updated=true`, gate **98/100**,
  impact LOW, validation **PASS**, décision **READY** (2 alternatives,
  2 viables, « Approche incrémentale avec preview », `recorded=false`) ;
  frame SSE `on_decision_assessed`, événement `DECISION_ASSESSED` (#3)
  avant le plan ; mutation AINT-006 `tx-49e06177-…` (#10) ;
  `GET /decisions` **0 → 0** (ledger non pollué) ; HTML final contient
  « Bienvenue V7-DECISION ».
- Live WIRE-4 (projet sonde `proj_kadualycs`) :
  `POST /evolution/analyze` = 200 en 65 ms, readiness **READY**, santé
  **80/100**, 2 évidences, 1 proposition `BUG_REMEDIATION` (priorité **62**,
  urgence NOW, quadrant QUICK WIN, 2 preuves). Panneau Studio vérifié dans
  le navigateur : `1 Proposition`, `62/100`, `80/100`, `READY`, carte
  `[BUG_REMEDIATION]` avec 2 preuves ; aucune erreur JS du panneau.
- Live WIRE-5 (projet sonde `proj_kadualycs`, `req_d313d02b5d394d78`) :
  `POST /orchestrate` = 200 en 46 ms, run `orch-901942aada1a`,
  état **WAITING_HUMAN_APPROVAL**, **2/2** tâches, **3 artefacts**
  (`PROPOSED_FILE_CHANGE`, `UI_SPEC`, `SECURITY_FINDING`), 1 conflit,
  5 traces, `mutationTransactionId=null` ; hash de `index.html` **identique**
  avant/après ; `GET /orchestrations` = 200 (1 run), détail = 200.
  Tokens/coût à 0 : le serveur de preuve n'a pas de clé provider, les
  artefacts sont donc les replis déterministes — champ affiché tel quel.
- Persistance après redémarrage : serveur relancé (PID 7084, health `ok`),
  `GET /orchestrate/orch-901942aada1a` = 200 avec le run complet
  (`plan-live-wire5-20261022`, `WAITING_HUMAN_APPROVAL`, artefact et trace) —
  le store survit au processus, pas seulement au cache mémoire.
- Preuve navigateur WIRE-5 : Studio rechargé, `runPlanOrchestration` exécuté
  sur un plan réel → carte `AINT-010 / orch-5043dd867e8e /
  REVUE HUMAINE REQUISE`, 1/1 tâche, 2 artefacts, 0 conflit,
  « aucune mutation (lecture seule) », boutons `Rapport JSON` et `Historique` ;
  l'historique persistant affiche 2 runs. Capture vérifiée, aucun élément
  de preuve laissé dans le DOM après nettoyage.
- Tranche WIRE-5 : **10/10 tests** (route + persistance + Studio),
  **251/251** tests orchestrateur/route, **59/59** tests V7 ciblés,
  typecheck 0 erreur ; timer de graphe corrigé (106 s → 1,3 s).
- Campagne curatée WIRE-5 + HARDEN-1 + UI-1 : **693/693 tests**, **165 suites**, 0 échec
  (687 de base + 5 tests WIRE-5 + 1 test LRU). La campagne élargie `dist/**`
  (2599 tests) laisse 12 échecs **hors périmètre officiel** : tests legacy
  `lot10` et `preview-integration` (assertions obsolètes),
  `mcp-publication-policy` (serveur enfant), `repair-api`/`bloc3-image-sanitizer`
  (environnement). Aucun échec dans les fichiers de la campagne officielle.
- HARDEN-1 (DecisionLedger) : test `decision-engine` **18/18** ; preuve live
  `maxEntries=5` : 6 enregistrements → 5, `dec-live-1` évincée,
  `dec-live-2` relue survit ; un nouveau ledger relit 5 décisions.
- UI-1 (visibilité Impact/Décision/Validation) : correctif `.vl-advisory` ;
  preuve navigateur dans le Studio avec les trois avis réels de
  `proj_ktw3zaiyj` / `req_58b9bade42d64ae0`, la progression et
  `statusDisplay=none` pour l’ancien canal ; tests ciblés `v7-stream-wiring`
  + `decision-engine` **32/32** ; campagne **693/693**.
- Témoins dist : 5/5 inchangés, 11 fichiers copiés avec SHA-256 vérifié,
  aucune dérive hors allowlist ; lot 4 : 3 fichiers de test copiés
  (SHA-256 vérifié), le Studio est servi directement depuis `apps/studio`.
- HARDEN-1 + UI-1 dist : 9 fichiers copiés (`decision-ledger` 3,
  `decision-engine.test` 3, `v7-stream-wiring.test` 3), SHA-256 vérifiés,
  `node --check` OK ; aucun build global, Studio servi directement.
- Nettoyage lot 4 : JS inline 951 093 → 934 974 octets, `node --check` OK ;
  plus aucun générateur legacy dans la page ; panneau Évolution revérifié
  dans le navigateur après suppression.

## V7-PREP-1 — préparation du moteur conversationnel dans le flux

- **But** : extraire une phase pure `prepareTurn` (compréhension, hypothèses,
  contradictions, plan, impact, Compass, contexte borné) et la brancher dans
  `/stream` derrière le flag `VOLACO_UNIFIED_PIPELINE=1`, sans remplacer la
  génération, la mutation atomique ni la persistance existantes.
- **Contrat** : `prepareTurn` ne fait aucun appel provider, aucune écriture de
  session, aucun audit, aucun `recordTurn`. `processTurn` l'utilise puis ajoute
  la génération et la persistance ; le flux SSE l'utilise puis conserve son
  propre chemin.
- **Repli** : toute erreur de préparation émet `on_preparation_fallback`, puis
  le flux reprend le plan local et l'analyse d'impact historique. Le flag off
  laisse le comportement strictement inchangé.
- **Impact et cibles** : le flux utilise les fichiers cibles du plan préparé
  (`resolveStreamImpactTargets`). Le plan reçoit une cible explicite
  `index.html` via `defaultTargetFiles` ; les étapes ANALYZE, MODIFY et VERIFY
  la portent. Hors flag, le plan local conserve son comportement historique.
- **Brief de génération** : `buildEngineeringBrief` / `withEngineeringBrief`
  composent un bloc `<engineering_context>` borné à 4 000 caractères avec
  objectif, modèle applicatif (compteurs + zones à risque), hypothèses, plan,
  évaluation heuristique, impact et mémoire bornée. Les balises sont
  neutralisées et le prompt historique est retourné inchangé sans préparation.
- **Décision et mémoire** : `produceAdvisoryDecision` reçoit la mémoire projet
  réelle (`preparedTurn.projectMemory`). `matchMemorySignals` relie par tokens
  significatifs les `knownRisks` / `knownConstraints` à l'intent ; un signal
  sur une action mutante produit `NEEDS_CONFIRMATION`, avec la raison dans
  `rationale`. Toujours `record:false` : le Decision Ledger reste inchangé.
- **Tests** : `conversation-prepare-turn` **4/4** ;
  `conversation-generation-brief` **4/4** ; `memory-signals` **3/3** ;
  `v7-stream-preparation` **3/3** ; `v7-stream-decision-memory` **1/1** ;
  `v7-stream-wiring` **14/14** ; campagne V7 finale **29/29** ; suite Decision
  Engine historique **18/18** ; suite conversation **76/76** ; typecheck
  **0 erreur**. Compilation de validation dans `.tmp-lot4-final` uniquement,
  pas de build global ni de réécriture `dist/`.
- **Preuve live** (instance isolée port 3100, base temporaire, flag on,
  `planFirst=true` sans provider) : `proj_9gwfgrhm8`,
  `req_9d996bdf3cda4f8b` → `on_preparation_completed` avec
  `assumptions=1`, `planRisk=LOW`, `contextChars=0`,
  `done.preparation.source="engine"` ; plan réel de 3 étapes.
- **Preuve live Lot 4** (instance isolée port 3102, base temporaire, flag on,
  `planFirst=true` sans provider) : contrainte mémorisée via `/turns`
  (`proj_tc0ge9zsl`, `sess-mvk4bxs3-7av7n`), puis `/stream`
  `req_50a1984a305f4c97` →
  `impactTargets=["index.html"]`, plan de 3 étapes avec
  `targetFiles=["index.html"]`, décision `NEEDS_CONFIRMATION` avec
  `memory.matchedConstraints` contenant la contrainte mémorisée,
  `memoryConstraints=1`, `recorded=false` ; `GET /decisions` = **0**
  (ledger inchangé).
- **Preuve de repli** : session inexistante → `on_preparation_fallback` avec
  raison explicite, puis `done.preparation.source="fallback"`, sans casser le
  flux ni la génération du plan.
- **Statut CDC** : **PARTIEL**. Le moteur pilote le plan, l'impact, les cibles
  réelles, le brief de contexte et la décision consultative avec mémoire
  projet derrière flag. La validation d'ingénierie réelle reste absente,
  l'effet du brief sur une génération LLM n'a pas encore été prouvé en live
  faute de clé provider, et le Decision Engine reste consultatif (aucun
  blocage de génération). Ne pas compter cette tranche comme une conformité
  complète du flux.
- **Tentative provider 2026-10-23** : le préflight réel Mistral via
  `/api/v1/ai/chat/completions` retourne **401 Invalid API Key** ; aucun
  projet n'est créé, aucun token consommé, aucune écriture. La clé présente
  dans `Y:\.env` est invalide. Le script de redémarrage
  `start-lot8-with-mistral.ps1` valide désormais la clé auprès de
  `/v1/models` avant d'arrêter le serveur et n'écrit jamais la clé sur disque.
  Le brief `<engineering_context>` reste donc **non prouvé en live** ; le
  serveur 3000 tourne sans cette clé invalide (`mistral keyPresent=false`,
  Gemini stocké actif).
- **Instrumentation brief** : `on_preparation_completed` et
  `done.preparation` exposent désormais `briefChars`, longueur réelle du bloc
  `<engineering_context>` construit par `buildEngineeringBrief(preparedTurn)`.
  Aucun changement du prompt ni du comportement ; le test
  `v7-stream-preparation` **3/3** et le stream wiring **14/14** passent
  (**17/17**). La mesure live avec un vrai provider reste à faire avec une clé
  Mistral valide.
- **Preuve locale du brief (2026-10-23)** : sans clé réelle, un faux adaptateur
  Mistral local remplace le provider dans le registre ; la route `/stream`
  réelle est exécutée avec `VOLACO_UNIFIED_PIPELINE=1`, sur un serveur en
  processus et une base temporaire. Résultat : HTTP **200**, frames
  `on_preparation_completed` et `done`, `briefChars=932` dans les deux,
  prompt système fournisseur contenant **exactement 932 caractères** de brief
  (`<engineering_context>` + consignes), prompt utilisateur **78 caractères**,
  aucun appel réseau provider, aucune erreur, validation PASS. Artefact :
  `proof-brief-result.json`. Ceci prouve le **branchement et la mesure** du
  brief, **pas** une génération Mistral réelle.

## V7-LOT5 — préflight d'ingénierie avant mutation

- **But** : refuser les défauts durs du document candidat **avant** toute
  écriture, au lieu de découvrir un HTML invalide après persistance.
- **Contrat** : `runEngineeringPreflight(content, path)` est déterministe,
  sans réseau, sans provider et sans score visuel. Il bloque uniquement les
  défauts durs (contenu absent/trop court, enveloppe `DOCTYPE`/`html`/`body`
  manquante, octet nul, taille > 5 Mio) ; les fermetures manquantes, scripts
  déséquilibrés et marqueurs internes restent des **WARN consultatifs**.
- **Branchement** : le préflight est exécuté sur `assembledHtml` juste avant
  `applyStreamFileMutationWithStreamEngine`. Le verdict part en frame
  `on_engineering_validated`, en événement `VALIDATION_COMPLETED` /
  `VALIDATION_FAILED` et dans `done.engineeringValidation`. Un FAIL positionne
  `persistenceError` et **interdit l'écriture**. L'avis `Préflight` est rendu
  dans le canal `.vl-advisory` du Studio.
- **Portée** : ce préflight n'est **pas** la ValidationChain et ne remplace
  pas le Quality Gate visuel. Il ne prouve ni l'exécution, ni le rendu, ni les
  tests fonctionnels.
- **Tests** : typecheck **0 erreur** ; 5 tests préflight core, 3 tests
  route/UI, 3 tests préparation, 14 tests WIRE, 12 tests ValidationChain →
  **37/37** ciblés. Campagne ciblée élargie : **804/804 tests**, **189 suites**,
  **0 échec**. Campagne complète : **2 635 tests**, **2 623 pass**, **12 échecs
  préexistants hors périmètre** (mêmes catégories que le 22/10 : `lot10`,
  `preview-integration`, `mcp-publication-policy`, `repair-api`,
  `bloc3-image-sanitizer`) ; aucun échec dans les suites V7, conversation,
  décision, validation ou préflight.
- **Preuve live** (instance isolée port **3103**, base temporaire, flag on,
  faux adaptateur Mistral **100 % en mémoire**, aucune clé réseau) : projet
  `proj_zqq99r2nj`, session `sess-mvkthyg5-jr9vr`.
  - Création `req_1622db59239a4f54` : `on_engineering_validated` **PASS**,
    hash `63af40870dbf526bb5293893c0dcc66576f6baab68664a03b34df516f504ac31`,
    1 836 octets ; `done.engineeringValidation` même verdict et même hash ;
    fichier écrit avec le **même hash** (1 821 caractères, 3 sections),
    révision `rev_03aca154615c4a5f`.
  - Modification invalide `req_6273ee9386204a0a` (octet nul injecté) :
    préflight **FAIL**, blocker « Absence d’octet nul », **aucun `done`**,
    erreur explicite, hash du fichier **inchangé**
    `63af40870dbf526bb5293893c0dcc66576f6baab68664a03b34df516f504ac31`
    (1 821 caractères) — **aucune écriture tentée**.
- **Statut CDC** : **PARTIEL**. Le préflight est branché et prouvé ; le
  sandbox d'exécution navigateur du Lot 7 et les tests fonctionnels générés du
  Lot 8 le complètent désormais. Il reste une analyse sémantique profonde et
  une isolation conteneurisée à brancher. Les WARN restent consultatifs et le
  Quality Gate visuel garde l'autorité du score.

## V7-LOT6 — orchestrateur exécutable : sandbox dry-run et application confirmée

- **But** : transformer un run AINT-010 en revue humaine en une exécution
  réellement contrôlée : d'abord un **sandbox dry-run** AINT-006 (diffs,
  préflight, transaction simulée, aucune écriture), puis, après confirmation
  explicite, une **application atomique** par le même single-writer.
- **Contrat HTTP** :
  - `POST /api/v1/projects/:projectId/orchestrate/:orchestrationId/preview`
    (PROJECT_READ) : revalide le run, les artefacts, le préflight HTML et
    exécute AINT-006 avec `dryRun: true` ; retourne validation, préflight,
    transaction, diffs et `appliedCount` ; ne modifie ni le fichier ni le run.
  - `POST /api/v1/projects/:projectId/orchestrate/:orchestrationId/apply`
    (PROJECT_MUTATE) : exige `{ confirm: true }`, puis `acceptRisk: true` si
    HIGH/CRITICAL/suppression et `acceptBreaking: true` si BREAKING ; réexécute
    les mêmes gardes avant l'écriture ; persiste le run `COMPLETED` (ou
    `FAILED` après rollback) avec `mutationTransactionId` et traces
    `MUTATING`/`COMPLETED`.
- **Gardes non négociables** : run en `WAITING_HUMAN_APPROVAL` ou
  `READY_FOR_MUTATION`, jamais déjà appliqué ; `degradedCount === 0` et aucun
  marqueur `[Mode Dégradé]` résiduel ; aucun conflit `BLOCKING` ; chemins
  relatifs sûrs (réutilise `assertSafeMutationPath`) ; artefacts
  `PROPOSED_FILE_CHANGE` valides ; ValidationGate valide ; préflight HTML
  PASS. Un HTML FAIL, un run dégradé, un conflit bloquant, un chemin interdit
  ou une confirmation absente sont refusés **avant** toute transaction.
- **Audit honnête** : le dry-run émet `MUTATION_STARTED` avec
  `metadata.dryRun=true` et **aucun** `MUTATION_COMMITTED` ; seul l'apply réel
  émet un commit. Le `MUTATION_COMMITTED` d'un dry-run était un faux positif
  corrigé dans AINT-006.
- **UI Studio** : un run exécutable affiche « Exécuter en sandbox » (au lieu
  du libellé lecture seule) ; le panneau rend le dry-run, le préflight, les
  diffs, le risque et le bouton « Appliquer les changements » avec
  confirmation navigateur. Après apply, la carte repasse en `TERMINÉ` avec le
  `transactionId` ; le libellé « aucune mutation (lecture seule) » reste pour
  les runs non exécutables (dégradés, bloqués, terminés).
- **Preuve live** (instance isolée en processus, port `50330`, base
  temporaire, faux adaptateur Mistral **100 % en mémoire**, aucune clé
  réseau) : projet `proj_3lies9rud`, run `orch-b08ec656eb4c`.
  - `/orchestrate` : 200, `WAITING_HUMAN_APPROVAL`, `degradedCount=0`,
    50 tokens, 2 artefacts, contenu provider identique au HTML attendu ;
    aucun fichier avant preview (404).
  - `/preview` : 200, `dryRun=true`, transaction
    `tx-b2c09435-72b3-48b3-a71b-717b9926ec48` `COMMITTED` simulée,
    préflight **PASS**, hash
    `07577951e1dbead3d387ab3418e2774ad901948ce4105cdd9a36de5d43780e24`,
    fichier toujours **404**, run toujours `WAITING_HUMAN_APPROVAL`,
    `MUTATION_STARTED` `dryRun=true`, **0** `MUTATION_COMMITTED`.
  - `/apply` confirmé : 200, run `COMPLETED`, transaction
    `tx-e327d610-ae56-483f-aaed-f032b859008c` `COMMITTED`, fichier 200,
    même hash SHA-256, 327 octets, **1** `MUTATION_COMMITTED`, run relu
    `COMPLETED` avec le même `transactionId` ; traces
    `... WAITING_HUMAN_APPROVAL → MUTATING → COMPLETED`.
  - Preuve navigateur (Chrome headless, Studio `http://127.0.0.1:3000/`) :
    carte `orch-lot6uiproof01`, bouton sandbox visible, panneau
    « Sandbox AINT-006 (dry-run) », préflight PASS, diff
    `sandbox/ui-proof.html +12/-0`, bouton apply ; après confirmation, carte
    `TERMINÉ` avec `transaction tx-lot6-apply-ui`, bouton sandbox retiré,
    aucune erreur page. Captures :
    `proof-lot6-ui-preview.png` et `proof-lot6-ui-applied.png`.
- **Tests** : typecheck **0 erreur** ; tests dédiés `run-execution`
  **11/11** et `v7-orchestrator-execution` **9/9** ; preuve provider
  `v7-orchestrator-provider-execution` **3/3** ; campagne ciblée élargie
  **241/241 tests**, **38 suites**, **0 échec** (orchestrateur historique,
  bridge, mutation, préflight, stream, routes) ; périmètre complet
  orchestrateur/agents/mutation **400/400 tests**, **60 suites**, **0 échec** ;
  autres suites V7 **7/7** ; Studio inline **965 677 octets**,
  `node --check` OK ; la preuve navigateur est verte.
- **Statut CDC** : le composant **sandbox dry-run + apply confirmé** est
  **BRANCHÉ** (service, routes, UI, persistance, tests, preuves). Les
  **Lots 6-8 restent PARTIELS** : le dry-run AINT-006 ne remplace ni le
  runtime navigateur (Lot 7) ni les tests fonctionnels (Lot 8), l'isolation
  reste un processus Chromium à réseau coupé (pas un conteneur durci) et
  l'analyse sémantique profonde reste absente. Le Quality Gate visuel reste
  l'autorité du rendu. Le flux `/stream` reste **PARTIEL**.

## V7-LOT7 — sandbox d'exécution navigateur

- **But** : le préflight Lot 5 contrôle la structure du HTML, mais n'exécute
  pas le code. Le Lot 7 exécute réellement le document candidat dans un
  **Chromium headless isolé** avant toute écriture, et bloque l'apply sur un
  échec dur.
- **Module** : `packages/core/src/ai-native/validation/browser-sandbox.ts`.
  - `ChromiumBrowserSandbox.run(html, options)` lance un navigateur neuf par
    document puis le ferme dans un `finally` ; aucun cookie, cache ou état ne
    survit entre deux exécutions.
  - Réseau coupé : contexte `offline: true`, toutes les requêtes HTTP(S)
    avortées (`route.abort('blockedbyclient')`), WebSockets fermés,
    service workers et téléchargements bloqués.
  - Timeout court (5 s par défaut, plafonné par le service), viewport
    1280×720, plafond de 2 sandbox simultanés.
  - Collecte : erreurs page, erreurs/avertissements console, requêtes
    échouées, métriques DOM (nœuds, éléments interactifs, texte visible,
    overflow horizontal) et capture JPEG (hash SHA-256 + data URL bornée).
  - Chemin Chromium : `VOLACO_SANDBOX_CHROMIUM_PATH` /
    `PLAYWRIGHT_CHROMIUM_PATH` / installation `playwright-core`. Un chemin
    explicitement configuré mais invalide est signalé, jamais remplacé
    silencieusement. `VOLACO_BROWSER_SANDBOX=0` désactive le sandbox.
- **Politique de verdict** :
  - `PASS` / `PASS_WITH_WARNINGS` : le document s'exécute ; les warnings
    (CDN bloqué, image distante, overflow, texte court) restent consultatifs.
  - `FAIL` : erreur JS auto-portée, `SyntaxError`, `TypeError`/`RangeError`,
    erreur console intrinsèque, timeout ou DOM non évaluable. `blocking=true`
    interdit l'apply.
  - Une `ReferenceError` / « X is not defined » est dégradée en WARN
    **uniquement** lorsqu'un script externe a été bloqué : le sandbox ne peut
    pas prouver qu'elle existerait avec le CDN réel. Cette limite est affichée.
  - `UNAVAILABLE` : Chromium absent/désactivé/saturé. Ce n'est pas un échec du
    document ; le rapport le dit, l'écriture n'est pas bloquée pour autant.
- **Branchement produit** : `previewRun` et `applyRun` exécutent le sandbox
  **après** le préflight et **avant** le bridge AINT-006, sur les 3 premiers
  documents HTML `CREATE`/`UPDATE`. Le nombre de documents non exécutés est
  exposé (`runtimeSkipped`) et affiché : la borne n'est jamais silencieuse.
  Le rapport `runtime` est exposé dans la réponse preview, la réponse apply et
  tous les refus. Un `FAIL` retourne `RUNTIME_FAILED` (HTTP 422) ; le bridge
  n'est jamais appelé et aucun fichier n'est écrit. Les warnings ne bloquent
  pas. Chaque vérification émet l'audit persistant
  `AI_ORCHESTRATION_RUNTIME_CHECKED` (verdict, blockers, warnings, hash de
  capture, `runtimeSkipped`) ; l'apply trace aussi les verdicts runtime.
- **UI Studio** : le panneau « Sandbox navigateur (exécution réelle) » rend le
  verdict, les métriques DOM, les blockers/warnings et la capture ; après un
  échec, le panneau devient « Sandbox bloquée » et le bouton apply est absent.
  Un refus d'apply conserve le rapport runtime dans le panneau.
- **Preuve live** (instance isolée en processus, port `50341`, base temporaire,
  aucun provider, aucun réseau) : projet `proj_ctf2vumfi`.
  - `/preview` run `orch-lot7liveok001` : 200, `dryRun=true`, préflight PASS,
    runtime **PASS** en **891 ms**, `runtimeSkipped=0`, titre réel,
    **13 nœuds DOM**, 1 élément interactif, **25 792 octets** de capture JPEG
    (SHA-256
    `9d5fb1fa42e128934263de0372a20c71db2c53411fbbf0f462a048ac09cb6d63`),
    fichier toujours **404**.
  - `/apply` confirmé : 200, run `COMPLETED`, transaction
    `tx-887f446d-6ff8-47a0-bf63-1f7d74547dc5` `COMMITTED`, fichier 200,
    **1 771 octets**, hash
    `35168d3a4031506ed51011a3539b57496a243795e216e67cf1e3b8b7ccead2a9`
    identique au hash attendu.
  - Run `orch-lot7livefail01` (script `throw new Error('lot7-live-boom')`) :
    preview **422** `RUNTIME_FAILED`, verdict **FAIL**, `blocking=true`,
    blocker « Erreur JavaScript : Error: lot7-live-boom » ; apply **422**
    `RUNTIME_FAILED` ; fichier **404 avant et après**.
  - Preuve navigateur du Studio (Chrome headless 1440×1100, API mockée) :
    panneau runtime PASS avec capture et bouton apply ; panneau
    « Sandbox bloquée » avec blocker et **sans** bouton apply ; après
    confirmation, carte `TERMINÉ` et transaction `tx-lot7-apply-ui` ; aucune
    erreur page. Captures : `proof-lot7-ui-preview.png`,
    `proof-lot7-ui-applied.png`, `proof-lot7-runtime.jpg`.
- **Tests** : typecheck **0 erreur** ; `browser-sandbox` **9/9** (PASS,
  pageerror, console.error, CDN coupé, SyntaxError, TypeError,
  ReferenceError, **aucune requête vers un serveur local**, indisponibilité) ;
  `run-execution` **14/14** (dont borne `runtimeSkipped`) ;
  `v7-orchestrator-execution` **10/10** ; preuve provider **3/3** ; périmètre
  orchestrateur + routes V7 **305/305 tests**, **39 suites** ; campagne
  complète **2 671 tests / 549 suites / 2 659 PASS / 12 FAIL**. Les 12 échecs
  se reproduisent **à l'identique en exécutant les mêmes fichiers depuis
  l'ancien `dist/`** (61 tests, 12 FAIL) :
  `bloc3-image-sanitizer`, `lot10-studio-plan-card-ui` (Compass),
  `mcp-publication-policy`, `repair-api` et le pont preview-builder. Aucun
  échec Lot 7 ; ils sont préexistants et hors du périmètre modifié.
- **Statut CDC** : le **sandbox d'exécution navigateur** est **BRANCHÉ**
  (module, service, routes, UI, audit, tests, preuves live et navigateur).
  Les **Lots 6-8 restent PARTIELS** : l'isolation est un processus Chromium
  durci (V7-HARDEN), pas un conteneur ; les tests fonctionnels générés
  sont branchés en slice déterministe (Lot 8) mais ne couvrent ni les parcours
  métier complets ni l'analyse sémantique profonde ; le Quality Gate visuel
  reste l'autorité du rendu et `VOLACO_UNIFIED_PIPELINE` reste désactivé par
  défaut.

## V7-HARDEN — durcissement du sandbox Chromium (2026-10-23)

- **But** : réduire la surface d'exécution du document candidat sans changer
  les verdicts ni le Quality Gate visuel.
- **Changements** :
  - arguments Chromium durcis : réseau d'arrière-plan, mises à jour de
    composants, sync, GPU, extensions, plugins, applications par défaut,
    breakpad, télémétrie de domaine, phishing, crash reporter et mise à jour
    Safe Browsing désactivés ; `--renderer-process-limit=1` ;
  - tas V8 borné à **256 Mo** par défaut, réglable par
    `VOLACO_SANDBOX_JS_HEAP_MB` entre **128 et 1024 Mo** ;
  - `--no-sandbox` reste **opt-in** via `VOLACO_CHROMIUM_NO_SANDBOX=1` ;
  - contexte : réseau coupé, requêtes HTTP(S) et `file://` avortées,
    WebSockets fermés, service workers/téléchargements/popups bloqués,
    dialogues dismissés, permissions refusées ;
  - le rapport expose `isolation` (`mode: PROCESS`, `containerized: false`,
    profil Playwright éphémère, limite de tas, etc.). Aucun conteneur.
- **Preuve live** (serveur en processus, port 50342, base temporaire, aucun
  provider, aucun réseau) : projet `proj_bs545vsrg`.
  - preview 200, préflight PASS, runtime **PASS** en **1 305 ms**, 13 nœuds
    DOM, 1 élément interactif, capture **25 845 octets** (SHA-256
    `1c4ba535f44ef8fc0046c0d7345062acc0cf585a088b0a40b80c27dcb131ece5`),
    `isolation` complet (`jsHeapLimitMb: 256`, `containerized: false`) ;
  - apply 200, run `COMPLETED`, transaction
    `tx-53f49f9b-cc4e-4ce2-8590-2503d29b6ced` `COMMITTED`, fichier 1 771
    octets, hash identique ;
  - document `lot7-live-boom` : preview/apply **422** `RUNTIME_FAILED`,
    verdict **FAIL**, fichier **404 avant/après** ;
  - UI Studio (réponses API mockées, serveur 3000) : la ligne
    `Isolation PROCESS · sans conteneur · tas 256 Mo` est visible dans le
    panneau runtime, le bouton apply reste présent après PASS, puis la carte
    passe à `TERMINÉ` après apply ; **0 erreur page**, `ok=true`. Captures :
    `proof-hardening-ui-preview.png`, `proof-hardening-ui-applied.png` ;
  - artefacts : `proof-hardening-result.json`, `proof-hardening-runtime.jpg`,
    `proof-hardening-ui-result.json`.
- **Tests** : typecheck 0 erreur ; `browser-sandbox` **15/15**,
  `browser-sandbox-hardening` **5/5**, `run-execution` **18/18**, API V7
  **11/11**, stream wiring **14/14** ; **63/63 tests ciblés**.
- **Statut CDC** : durcissement **BRANCHÉ** dans le sandbox ; l'isolation
  **conteneurisée et les limites OS (CPU/mémoire/cgroup)** restent
  **ABSENTES**. Le sandbox reste un processus Chromium à réseau coupé, avec
  un tas V8 borné. `VOLACO_UNIFIED_PIPELINE` reste désactivé par défaut.

## V7-LOT8 — tests fonctionnels générés à partir du DOM

- **But** : le Lot 7 prouve que le document se charge sans erreur, mais pas
  qu'un bouton réagit, qu'un formulaire requis est compris ou qu'un élément
  interactif possède un nom accessible. Le Lot 8 génère ces scénarios à partir
  du **DOM réel** du document candidat, dans le même Chromium isolé, avant
  toute écriture.
- **Module** : `packages/core/src/ai-native/validation/functional-tests.ts`.
  - **Génération déterministe, pas LLM** : le plan est extrait du DOM
    (`generatedFrom: 'DOM'`) ; aucun scénario métier n'est inventé. Limites
    explicites : **5 boutons** cliqués au maximum et **3 formulaires requis**
    couverts ; les éléments au-delà produisent un WARN, jamais un silence.
  - Scénarios : chargement/contenu (`LOAD`), noms accessibles (`A11Y`),
    clic sur boutons sûrs (`INTERACTION`), validation native de formulaires
    requis (`FORM`). Aucun clic sur un bouton submit de formulaire, aucune
    navigation suivie, réseau coupé.
  - **Bloquant** uniquement pour un défaut intrinsèque et reproductible :
    erreur JavaScript après clic, page devenue non réactive, champ requis
    totalement ignoré. Les noms accessibles manquants, les formulaires
    `novalidate`, les validations natives non satisfaites par les valeurs de
    test et les navigations déclenchées par un clic (non suivies) sont des
    **WARN non bloquants**.
  - Verdicts : `PASS`, `PASS_WITH_WARNINGS`, `FAIL`, `SKIPPED`, `UNAVAILABLE`.
    Seul `FAIL` bloque ; `SKIPPED`/`UNAVAILABLE` restent explicites.
  - Une `ReferenceError` après clic est dégradée en WARN si un script externe a
    été bloqué, comme pour le runtime Lot 7.
  - **Limites explicites** : couverture des `<button>` / `[role="button"]`
    (5 max), formulaires requis (3 max), pas d'`input[type="button"]` /
    `input[type="submit"]` hors formulaire, pas de parcours multi-pages, pas de
    soumission réelle, pas de contraste ni d'ARIA avancé. L'ordre des boutons
    est supposé stable entre le plan et les resets ; un DOM fortement dynamique
    n'est pas couvert. Ces éléments ne sont pas présentés comme testés.
- **Branchement produit** : `browser-sandbox.ts` exécute les tests après la
  capture et uniquement si le chargement n'a produit aucun blocker. Le rapport
  est porté par `BrowserSandboxReport.functionalTests`; l'orchestrateur
  l'agrège dans `functionalTests` (verdict, compteurs, durée, documents) et
  l'expose dans **preview**, **apply** et **tous les refus**. Un `FAIL` retourne
  `FUNCTIONAL_TESTS_FAILED` (HTTP **422**) : le bridge AINT-006 n'est jamais
  appelé et aucun fichier n'est écrit. Chaque vérification émet l'audit
  persistant `AI_ORCHESTRATION_FUNCTIONAL_TESTS_CHECKED`; l'apply trace aussi
  le verdict fonctionnel dans ses métadonnées.
- **UI Studio** : panneau « Tests fonctionnels générés (DOM) » avec verdict,
  compteurs (`PASS`, échecs, avertissements, ignorés), durée et détail des
  scénarios en échec/avertissement. Un échec affiche « Tests fonctionnels
  bloqués » (et non « Sandbox bloquée ») sans bouton apply ; le panneau runtime
  reste visible. Après apply, le résumé fonctionnel reste dans la carte
  `TERMINÉ`.
- **Preuve live** (serveur API compilé en processus, port éphémère, base
  temporaire, Chromium réel, aucun provider, aucun réseau) :
  projet `proj_pv9b0pwli`.
  - Page saine : `/preview` **200**, runtime **PASS**, fonctionnel **PASS**
    (`4` scénarios : `3 PASS`, `0 échec`, `1 SKIP`), clic « Action »
    **PASS**, capture **14 821 octets** SHA-256
    `959b641da6fb79bd765b4da1769857967cd797c72ca1b63c128459714d2ab402`,
    fichier **404 avant**.
  - `/apply` confirmé : **200**, run `COMPLETED`, transaction
    `tx-b53ce3b5-31e4-41cc-9d79-492be478e422` `COMMITTED`, fichier **455
    octets**, hash
    `4ef8fa4a00a4111b73247f60e3caf7967c7a3eb33a28f32b2c842edb3a058a36`
    identique au hash attendu, verdict fonctionnel **PASS**.
  - Page dont le bouton lève `functional-live-boom` : `/preview` **422**
    `FUNCTIONAL_TESTS_FAILED`, runtime **PASS** (le chargement reste sain),
    fonctionnel **FAIL** `blocking=true`, scénario « Clic sur Action » en
    échec ; `/apply` **422** `FUNCTIONAL_TESTS_FAILED` ; fichier **404 avant
    et après**. Audits : `SUCCESS`/`PASS` pour la page saine,
    `FAILURE`/`FAIL` pour l'échec.
- **Preuve navigateur** (Chrome headless 1440×1200, Studio produit sur le port
  `3000` servi par le build temporaire, réponses API mockées pour isoler le
  rendu) :
  panneau PASS avec compteurs, capture runtime et bouton apply ; panneau
  « Tests fonctionnels bloqués » avec le message `functional-ui-boom`, runtime
  **PASS** toujours visible et **aucun** bouton apply ; après confirmation,
  carte `TERMINÉ`, transaction `tx-lot8-apply-ui` et résumé fonctionnel ;
  **0 erreur page**, `ok=true`. Captures : `proof-lot8-ui-3000-preview.png`,
  `proof-lot8-ui-3000-applied.png`, `proof-lot8-runtime.jpg`.
- **Tests** : typecheck **0 erreur** ; `browser-sandbox` **15/15** (dont 5
  scénarios fonctionnels : PASS, FAIL, WARN a11y, formulaire requis,
  navigation non suivie, et le dialogue natif V7-HARDEN) ; `run-execution`
  **18/18** (dont gate, audit,
  absence d'écriture, WARN et UNAVAILABLE) ; `v7-orchestrator-execution`
  **11/11** (dont refus HTTP 422 sans écriture) ; périmètre orchestrateur +
  V7 **341/341 tests**, **42 suites**, **0 échec** (campagne Lot 8, avant
  V7-HARDEN). Campagne complète (avant V7-HARDEN) :
  **2 681 tests**, **549 suites**, **2 669 PASS**, **12 FAIL** préexistants
  (mêmes catégories que le Lot 7 : `lot10`, `preview-integration`,
  `mcp-publication-policy`, `repair-api`, `bloc3-image-sanitizer`) ; aucun
  échec dans les suites V7, sandbox ou fonctionnelles.
- **Build de validation** : compilation dans `.tmp-lot8-build` via
  `.tmp-lot8-tsconfig.json` ; **`dist/` n'a pas été réécrit** et aucun
  `npm run build` n'a été lancé. Le serveur produit 3000 (PID **8488**) est
  redémarré depuis ce build temporaire, pas depuis `dist/` ; la preuve live
  ci-dessus utilise un serveur éphémère en processus, pas le port 3000.
  Ce redémarrage ne charge pas la clé Mistral invalide de `Y:\.env` :
  `mistral keyPresent=false`, `gemini keyStored=true` et actif. La clé
  Mistral doit être fournie par le script de preuve (saisie masquée) ou une
  valeur valide dans `.env`.
  Limite : `npm start` reste branché sur `dist/` (intact) et ne servirait pas
  ce code tant qu'un build global n'est pas explicitement autorisé.
- **Statut CDC** : les **tests fonctionnels générés** sont **BRANCHÉS en
  slice déterministe** (module, sandbox, service, gate, audit, API, UI,
  tests, preuves live et navigateur). Ils ne constituent **pas** une
  génération de parcours métier complète, ni une preuve de soumission réelle,
  ni une isolation conteneurisée. Le runtime conteneurisé reste **ABSENT**,
  l'analyse sémantique profonde reste **ABSENTE**, le flux `/stream` reste
  **PARTIEL** et `VOLACO_UNIFIED_PIPELINE` reste désactivé par défaut.

## Matrice des moteurs

| Moteur | Service runtime | Route API | Flux produit réel | Persistance | Test | Statut |
|---|---|---|---|---|---|---|
| Conversation / Compass / Plan | oui | oui | stream SSE + planFirst | sessions durables, révisions | oui | BRANCHÉ |
| Mémoire projet | oui | oui (corrigée) | enregistrée à chaque tour | `conversation-sessions` | oui | BRANCHÉ |
| Impact Intelligence | oui | — (appel direct) | stream (avant mutation) + agents ; carte d'exécution Studio + avis `Impact` (lots 3/UI-1) | événement d'exécution | oui | BRANCHÉ (lots 1, 3 et UI-1) |
| Application Model | oui | oui | refresh après mutation + panneau Studio « Modèle » | `application-models` | oui | BRANCHÉ (lot 1) |
| DNA / Understanding | oui | oui | Studio `/dna`, modèle, impact | caches + modèle | oui | BRANCHÉ |
| Design Harmony / Visual | oui | oui | Studio (35 appels), gate | stores design | oui | BRANCHÉ |
| Quality Gate visuel | oui | via stream | gate bloquant + retry | événements | oui | BRANCHÉ |
| Agent Runtime / Mutation Orchestrator | oui | `/agents/execute` + stream | **stream SSE principal** (CREATE/UPDATE, validation, rollback) + agents | transactions LRU + révisions | oui | BRANCHÉ |
| AI Orchestrator multi-agents | oui | `/orchestrate` + `GET /orchestrations` + `GET /orchestrate/:id` + `POST /orchestrate/:id/preview` + `POST /orchestrate/:id/apply` | carte de plan Studio : analyse, sandbox dry-run, sandbox navigateur, tests fonctionnels, apply confirmé | `orchestration-runs` (borne 50) + audits runtime/fonctionnel ; transaction AINT-006 | oui | BRANCHÉ (lots 5-8, action explicite + exécution confirmée) |
| Exécution sandbox / apply AINT-010 → AINT-006 | oui | `POST /orchestrate/:id/preview` (dry-run) + `POST /orchestrate/:id/apply` (confirmé) | Studio : « Exécuter en sandbox » puis « Appliquer les changements » | run persisté + audit `MUTATION_STARTED`/`MUTATION_COMMITTED` | oui | BRANCHÉ (lots 6-8) |
| Sandbox d'exécution navigateur (V7-LOT7) | oui (`browser-sandbox.ts`, Chromium headless) | via `preview`/`apply` | exécution réelle du HTML avant écriture ; verdict + capture dans le Studio ; `RUNTIME_FAILED` 422 | audit `AI_ORCHESTRATION_RUNTIME_CHECKED` + trace d'apply (rapport complet non stocké) | oui | BRANCHÉ (lot 7 ; isolation processus, pas conteneur) |
| Tests fonctionnels générés (V7-LOT8) | oui (`functional-tests.ts`, scénarios DOM) | via `preview`/`apply` | boutons, noms accessibles et formulaires requis testés avant écriture ; panneau Studio ; `FUNCTIONAL_TESTS_FAILED` 422 | audit `AI_ORCHESTRATION_FUNCTIONAL_TESTS_CHECKED` + trace d'apply (rapport complet non stocké) | oui | BRANCHÉ en slice déterministe (lot 8 ; pas de parcours métier complet) |
| Runtime d'exécution isolé/conteneurisé | non | non | non | non | non | ABSENT (reste des Lots 6-8) |
| Analyse sémantique profonde du rendu | non | non | non | non | non | ABSENT (reste des Lots 6-8) |
| Decision Engine (conseil) | oui | `/decide` + stream (consultatif) | verdict avant plan, frame + événement + `done.decision` + avis `Décision` visible ; mémoire projet (V7-PREP-1) ; `record:false` | événement d'exécution ; ledger borné **500** (LRU) | oui | BRANCHÉ (lot 3 + UI-1 + mémoire, consultatif) |
| Validation Chain | oui | `/validation` + stream | après persistance, 5 étapes, résultat consultatif + avis `Validation` visible (PASS/score) | événements d'exécution + `done.validation` | oui | BRANCHÉ (lot 3 + UI-1, consultatif) |
| Préflight d'ingénierie (V7-LOT5) | oui (module déterministe) | via stream | avant mutation du stream ; un FAIL dur interdit l'écriture | événement `VALIDATION_*` + `done.engineeringValidation` | oui | BRANCHÉ (lot 5, déterministe) |
| Evolution Engine | oui | `/evolution` | panneau Studio « Évolution Produit » (AINT-017) : readiness, santé, propositions | rapport AINT-017 + audits | oui | BRANCHÉ (lot 4) |
| Générateurs legacy Studio (`generateInstantApp`, `generateEngineeringPlan`, `executePlanAction`) | — | — | supprimés (aucun appelant) | — | garde d'absence (`lot-polish` #12) | SUPPRIMÉS (lot 4) |

## Prochains lots (ordre de sûreté)

1. **Lots 6-8 — reste du sandbox exécutable** : les lots 6-8 fournissent le
   dry-run AINT-006, l'apply confirmé, l'exécution réelle du HTML dans un
   Chromium headless à réseau coupé et les tests fonctionnels générés en slice
   déterministe. Il reste à durcir l'isolation (conteneur/limites OS), à
   étendre les tests aux parcours métier et à une soumission contrôlée, et à
   brancher l'analyse sémantique profonde sans mutation non validée.
2. **Preuve LLM réelle** : injecter le brief `<engineering_context>` dans une
   génération provider réelle et mesurer son effet ; l'instance de preuve n'a
   pas de clé provider.
3. **Activation par défaut** de `VOLACO_UNIFIED_PIPELINE` : seulement après
   preuve navigateur **et** génération live, pas avant.
4. **Secondaire** : pêche des 10 thèmes réservoir et reprise des branchements
   UI partiels restants.

## Commandes de rejeu

```powershell
# typecheck
cd Y:\; npx tsc --noEmit
# campagne curatée (depuis Y:\ obligatoirement)
powershell -File C:\Users\FAYCAL\AppData\Local\Temp\opencode\campaign-v7-wiring5.ps1
# santé
curl.exe -s http://127.0.0.1:3000/api/v1/health
```
