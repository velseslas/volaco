# EXECUTION TRANSPARENCY AUDIT — volaco-core

> Audit réalisé le 2026-09-26, phase 1 du CDC « AI Execution Transparency Engine + Conversation Execution Timeline ».
> Méthode : lecture du code réel comme source de vérité (3 balayages indépendants : backend, frontend, persistance). Aucun fichier modifié pendant cette phase.

---

## 1. ARCHITECTURE ACTUELLE

### 1.1 Le chemin réel d'une génération (production)

Le chemin réel n'est PAS le pipeline « canonique » (ConversationIntelligenceService → agent-runtime → MutationOrchestrator). Ces modules existent et sont câblés, mais la génération utilisateur passe par une **route SSE autonome** qui fait tout elle-même :

```
Studio (index.html:3090 runConversationEngineFlow)
  → POST /api/v1/projects/:id/conversation/sessions/:sid/stream   (conversation.ts:404)
      ├→ intention  : heuristique isModification = html > 200 chars        (:433)
      ├→ plan       : PlanGenerator.generatePlan (déterministe, 3 étapes)  (:443)
      ├→ 1 appel LLM streamant (Mistral/Gemini, temp 0.4, 8192 tok)        (:607)
      ├→ parse incrémental des <SECTION name mode after>                   (:625-711)
      ├→ merge regex par data-section (modification) ou concat (création)  (:736-806)
      ├→ buildStudioShell → doc complet                                    (:122-144, :814)
      ├→ fileStore.saveFile('index.html')                                  (:825)
      └→ revisionStore.createRevision (provenance AI_AGENT)                (:829-834)
```

Transport : SSE maison (`sendSSE`, `data: {json}\n\n`, conversation.ts:425-428) consommé côté client par `fetch` + `response.body.getReader()` (index.html:3464-3494) — pas d'EventSource, pas de WebSocket. Le champ `event:` n'est jamais utilisé ; seul `type` dans le JSON dispatch.

### 1.2 Vocabulaire d'événements SSE actuel (conversation.ts)

| Événement | Payload | Émis à |
|---|---|---|
| `start` | `{isModification}` | :435 **et une 2e fois :588 (doublon)** |
| `compass` | `{state: UNDERSTANDING\|WAITING_CONFIRMATION\|EXECUTING\|VALIDATING\|COMPLETED}` | :437, :453, :589, :645, :819, :843 |
| `plan` | `{plan: EngineeringPlan complet}` | :444 |
| `chat` | `{text}` — narration | :448, :450, :635, :730, :820 |
| `token` | `{token}` — chunk HTML brut | :706, :709 |
| `section_start` | `{name, mode, after, index}` | :646-652 |
| `section_end` | `{name, mode, after, index, text, html}` | :676-684 |
| `done` | 2 formes : `{awaitingConfirmation:true}` (:454) / `{updated, html, thinking}` (:859-864) | |
| `error` | `{error}` | :463, :873 |

**Aucun `executionId`, aucun numéro de séquence, aucun statut, aucune persistance.** Les frames sont fire-and-forget. Seule corrélation : `X-Request-Id` (server.ts:361-366), qui atterrit dans `revision.provenance.triggerRequestId`.

### 1.3 Ce que l'UI affiche aujourd'hui (index.html, 12 461 lignes)

- Cartes de trace `traceCard()` (:3118-3139) : Thought (cerveau, violet) / Write (fichier, émeraude) / Terminal (terminal, slate) — repliables (header click → toggle hidden + chevron).
- Boîte « Étapes de l'agent » (:3110) : lignes spinner→check pilotées par les événements (start→Réflexion, plan→Plan validé — N étapes, section_start→Construction de X, section_end→✓ Section X posée, compass VALIDATING→Vérification, done→Rendu validé + index.html sauvegardé).
- Narration machine à écrire (`pumpNarration`, :3328) + canvas live : tokens → parseur incrémental → injection iframe à 170 ms/élément (:3272-3282).
- Quality Gate : déclenché **côté client** après `done` (`runQualityGate` :5842) → PUT files/content + POST /visual/analyze → bannière score/findings + boutons Auto-réparer / Via le chat.

### 1.4 Briques réutilisables déjà présentes

| Brique | Où | État |
|---|---|---|
| Store SQLite document (`documents(key, content)`) | persistence/sqlite-backend.ts | ✅ vivant, 1 plug pour tous les stores |
| Audit store **persistant**, plafonné 5 000, **sanitisé secrets** | observability/audit.ts | ✅ vivant (sessions, plans approuvés) |
| Revisions : contenu **complet + sha256** par fichier | model/revision-store.ts | ✅ vivant → diffs réels calculables |
| Vocabulaire typé d'activité (ActivityType, actor AI/SYSTEM) | activity/types.ts | ⚠️ store **en mémoire seulement** |
| ConversationTrace/Turn riches (events[], durationMs, confidence) | conversation-intelligence/types.ts:174-202 | ⚠️ **jamais alimenté par le chemin stream** |
| Agent-runtime event-log + run IDs | ai-native/agent-runtime | ⚠️ hors du chemin stream |
| requestId de bout en bout | server.ts + logger.ts | ✅ vivant |
| Route terminal whitelisting (git/test/build) | routes/terminal.ts | ✅ vivant (pour la visibilité « tests ») |
| Self-Repair borné (2-3 cycles, rollback Pareto) | routes/repair.ts | ✅ vivant mais **standalone** |

---

## 2. FLUX ACTUEL — RÉPONSE AUX 12 QUESTIONS DU CDC

1. **Début de requête** : POST `.../sessions/:sid/stream` (conversation.ts:404), session créée/validée par `ensureConversationSession` (index.html:2982).
2. **Intention** : heuristique `html > 200 chars ⇒ modification` (conversation.ts:433). Le vrai IntentEngine (LLM, temperature 0) n'existe que dans le chemin `/turns` **non streamé** — il est contourné en production.
3. **Plan** : `PlanGenerator.generatePlan` déterministe (plan-generator.ts:17-103), émis `plan` (:444). Plan First : stop après plan + `done {awaitingConfirmation}` (:452-457), reprise via `confirmedPlan:true`.
4. **Agents** : aucun agent nommé — un seul appel LLM streamant (conversation.ts:607). Le MultiAgentRuntime n'est pas dans la boucle.
5. **Tools** : merge regex inline (:736-806) + `applySectionToDoc` côté client (index.html:~3396) qui **ré-applique redundamment** les mêmes merges sur l'iframe.
6. **Lectures** : `fileStore.getFile(tenantId, projectId, 'index.html')` (:431). **Écritures** : `fileStore.saveFile` (:825, matérialisé disque `.volaco-data/`) + révision (:829).
7. **Tests** : Quality Gate = POST /visual/analyze (visual.ts:43-53) : rendu **réel** headless Chromium → CRITICAL/HIGH findings + analyse DOM déterministe + score `computeCriticScore`. Déclenché par le **client**, pas le serveur.
8. **Validations** : compass VALIDATING (:843) + diff-guard **côté client seulement** (>85% perte de section, index.html:3533-3538 et :3633-3643). **Le serveur n'a aucune garde** : il applique et sauvegarde aveuglément.
9. **Réparations** : POST /repair (repair.ts:75-203), borné, crée révision SYSTEM_REPAIR. **Jamais appelé dans le flux conversation** — uniquement via les boutons de la bannière Quality Gate.
10. **Retour UI** : frames SSE ci-dessus ; `done` final avec HTML complet (:859-864).
11. **Remontée d'événements** : SSE uniquement, en mémoire vive du navigateur, disparait avec la page.
12. **Persistance de la conversation** : les sessions SQLite existent (conversation-sessions) mais **le chemin stream n'y écrit jamais ses tours** — une génération streamée ne laisse aucune trace de messages, seulement le fichier + la révision + la coquille de session.

---

## 3. ÉVÉNEMENTS DÉJÀ DISPONIBLES vs MANQUANTS

**Disponibles** (et réels) : start, compass (4 phases ≈ UNDERSTAND/IMPLEMENT/VALIDATE/COMPLETE), plan, chat (narration), token, section_start/section_end (≈ FILE_CREATED/MODIFIED par section), done, error.

**Manquants** par rapport au CDC §5 :
- Identité : `executionId`, `sequence`, `status` (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED/WAITING_USER), `phase` explicite.
- FILE_READ, DIFF_GENERATED (diffs réels +n/−n), DIRECTORY_INSPECTED, DEPENDENCY/IMPACT analysis.
- TEST_*/VALIDATION_*/BUILD_*/SECURITY_* granulaires (le gate tourne mais n'émet pas d'événements).
- REPAIR_STARTED/RETRY/COMPLETED, RETRY_STARTED.
- PREVIEW_READY, EXECUTION_PAUSED/CANCELLED (aucun cancel n'existe), SUMMARY_GENERATED.

---

## 4. PROBLÈMES D'HONNÊTETÉ UI (CDC §31/§32 — source of truth)

| # | Constat | Preuve | Gravité |
|---|---|---|---|
| H1 | « Rendu validé par le Quality Gate » affiché **même quand le gate a échoué/renvoyé null** (réseau, HTML court) | index.html:3645 | 🔴 fausse affirmation de succès |
| H2 | Titre Terminal « vibe render index.html » et ligne `$ render index.html (Chromium headless)` en dur — le calcul est réel (Chromium tourne vraiment côté serveur) mais la mise en scène fait croire à un shell local | index.html:3656-3660 | 🟠 cosmétique trompeur |
| H3 | Nom de fichier « index.html » en dur dans la carte Write sans vérification du chemin réellement écrit | index.html:3648 | 🟡 |
| H4 | Événement `start` émis 2 fois par le serveur ET traité 2 fois par le client → ligne agent dupliquée | conversation.ts:588 + index.html:3490-3491 | 🟡 bug visible |
| H5 | Collapse du Thought ne marche pas : `traceCard` ne pose jamais `data-body` que le handler `done` cherche | index.html:3626-3632 vs 3118-3139 | 🟡 bug silencieux |
| H6 | Timeline non dérivée d'événements typés : libellés en dur dans le client, invérifiables | index.html:3485-3691 | 🟠 dette structurelle |

---

## 5. FIABILITÉ (CDC §17-§20)

- **Refresh** : une génération en cours **meurt** avec l'onglet (le fetch SSE meurt, `clientGone` coupe côté serveur, rien n'est sauvegardé si le flux n'était pas fini — conversation.ts:716-724). L'historique de chat est **effacé au rechargement** (`renderInitialChatGreeting` :9856). Rien ne se rejoue.
- **Reconnexion** : inexistante (pas de Last-Event-ID, pas de replay).
- **Annulation** : **aucun bouton Stop, aucun AbortController client, aucun endpoint cancel**. La seule « annulation » = fermer l'onglet.
- **Doublons** : aucune déduplication possible (pas d'ID d'événement).

---

## 6. DUPLICATIONS ET DETTE

- **D1** — Double application des merges : serveur (regex :736-806) + client (`applySectionToDoc`) font le même travail.
- **D2** — Deux systèmes d'historique parallèles : activity store (mémoire) et audit store (persistant) ; ConversationTrace/Turn riches mais morts sur le chemin stream.
- **D3** — Pipeline canonique (intent-engine, agent-runtime, MutationOrchestrator avec snapshots/rollback) contourné par la route stream = dette d'architecture assumée, mais ses capacités (rollback, événements) ne profitent pas à la génération.
- **D4** — ~300 fichiers `decisions-test-*.json` dans `.volaco-data/` (tests anciens non isolés) — nettoyage candidat.
- **D5** — Le client Quality Gate fait un PUT files/content **avant** analyze → le HTML analysé est celui du client, pas forcément celui sauvé par le serveur (source de vérité bifurquée).

---

## 7. RISQUES ACTUELS

1. **Perte silencieuse de travail** : refresh/disconnect pendant génération = tout perdu, utilisateur sans explication.
2. **Le serveur peut sauver une page dégradée** : pas de diff-guard serveur (le garde >85% est client ; si le client est absent — API directe — rien ne protège).
3. **Inspection impossible** : après coup, personne ne peut répondre « que s'est-il passé ? quels fichiers touchés ? quel score ? » — aucune trace.
4. **Réparation invisible** : le Repair Orchestrator fonctionne mais son cycle n'apparaît nulle part dans la conversation.

---

## 8. ARCHITECTURE CIBLE

Principe (CDC §16, §35, §60) : **réutiliser le SSE existant, ne pas créer de second transport**. Une seule source de vérité : **tout ce qui est envoyé en SSE est aussi enregistré** ; tout ce que l'UI affiche vient d'un événement enregistré.

```
conversation.ts (stream)
  └── ExecutionRecorder (NOUVEAU, packages/core)
        ├── emit(event)  →  1) append ExecutionEventStore (mémoire + persist différé)
        │                   2) sendSSE (format actuel étendu : + executionId, seq, phase, status)
        └── lifecycle  : EXECUTION_STARTED → phases → EXECUTION_COMPLETED/FAILED/CANCELLED
                         + SUMMARY_GENERATED (synthèse depuis events + révision)

UI (index.html)
  └── ExecutionTimeline (évolution de « Étapes de l'agent »)
        ├── mode normal : phases regroupées, statuts, durées réelles
        ├── mode détaillé : dépliage par phase (fichiers, +n/−n, findings)
        ├── Stop button → POST cancel → EXECUTION_CANCELLED
        └── replay : GET /executions/:executionId (refresh/reconnexion)
```

**Modèle d'événement** (CDC §4-§8, sous-ensemble honnête de ce qu'on produit réellement) :

```ts
ExecutionEvent {
  id: string              // evt-<seq>-<rand> — déduplication
  executionId: string     // = requestId de la génération
  projectId, tenantId
  seq: number             // ordre fiable
  ts: number
  phase: UNDERSTAND|PLAN|INSPECT|IMPLEMENT|VALIDATE|REPAIR|COMPLETE
  type: EXECUTION_STARTED | PLAN_CREATED | PLAN_APPROVED | FILE_READ
      | FILE_CREATED | FILE_MODIFIED | FILE_DELETED | DIFF_GENERATED
      | VALIDATION_STARTED | VALIDATION_COMPLETED | VALIDATION_FAILED
      | REPAIR_STARTED | REPAIR_COMPLETED | EXECUTION_CANCELLED
      | EXECUTION_FAILED | EXECUTION_COMPLETED | SUMMARY_GENERATED
  status: RUNNING|COMPLETED|FAILED|CANCELLED|WAITING_USER
  title: string           // libellé utilisateur (français, non technique)
  detail?: {...}          // fichiers, +lignes/−lignes, findings, score — pas de secrets
  durationMs?: number     // seulement quand mesuré
}
```

**Persistance** (CDC §18, minimal) : nouveau document SQLite `executions` — 1 enregistrement par exécution (events capped 300, synthèse, statut final), 20 dernières exécutions par projet. Append mémoire + persist différé aux frontières de sections et au `done` (pas d'écriture par micro-event, CDC §40).

**Diff réel** : calculé à la sauvegarde (les révisions portent déjà le contenu complet + sha256) → `+n −n` lignes par section, jamais de faux diff (CDC §11).

---

## 9. COMPOSANTS

**Backend (créer)** : `packages/core/src/ai-native/execution/` → `types.ts` (modèle ci-dessus), `store.ts` (ExecutionEventStore, plug json-disk-cache), `recorder.ts` (ExecutionRecorder = emit → store + SSE), `summary.ts` (synthèse finale).
**Backend (modifier)** : `routes/conversation.ts` (recorder branché sur chaque sendSSE ; cancel ; FILE_READ ; diffs ; validation serveur ; synthèse), `server.ts` (routes `GET /executions/:id`, `POST /executions/:id/cancel`).
**Frontend (modifier)** : `index.html` — ExecutionTimeline (évolution de la boîte Étapes de l'agent + cartes trace existantes, mêmes tokens CSS), Stop button, replay au chargement, correctifs H1/H4/H5, synthèse finale compacte.
**Feature flag** : `VOLACO_EXECUTION_TIMELINE=on|off` (CDC §61) — off = comportement actuel exact.

---

## 10. PLAN D'IMPLÉMENTATION PAR LOTS (chaque lot = suite verte + commit)

| Lot | Contenu | Pourquoi cet ordre |
|---|---|---|
| **T1 — Fondations d'événements** (backend pur, zéro UI) | Modèle + Store + Recorder branché sur le stream ; executionId/seq sur les frames (champs **ajoutés**, rien renommé) ; double `start` supprimé ; tests : ordre, persistance, dédoublonnage | On ne construit jamais sur du fragile : la source de vérité d'abord, sans toucher l'UI |
| **T2 — Honest UI + replay** | Correctifs H1 (plus de « validé » si gate null), H4, H5 ; GET /executions/:id ; au chargement projet : timeline de la dernière exécution rejouée depuis le store | L'UI doit cesser d'afficher ce qui n'est pas vrai AVANT d'afficher plus |
| **T3 — ExecutionTimeline v1** | Boîte Étapes de l'agent → timeline par phases (Analyse/Plan/Construction/Vérification/Terminé) avec statuts et durées réelles, dépliage par phase (CDC §13-§15) ; libellés **dérivés des events** | Le gros morceau UX, sur des fondations fiables |
| **T4 — File activity + diffs réels** | FILE_READ ; DIFF_GENERATED (+n/−n par section depuis les révisions) ; « Voir le diff » → compareModal existant | Le « qu'est-ce qui a changé » du CDC §58, avec de vrais chiffres |
| **T5 — Annulation** | POST /executions/:id/cancel (flag vérifié dans la boucle LLM comme clientGone) ; bouton Stop ; EXECUTION_CANCELLED honnête (⏹, pas ❌) | Un exécution engine sans cancel n'est pas sérieux ; nécessite T1 (statut persisté) |
| **T6 — Validation & réparation visibles** | Gate exécuté **côté serveur** avant `done` (VALIDATION_STARTED/COMPLETED/FAILED avec score+findings ; le client arrête son propre gate → vérité unique) ; cycle REPAIR_* émis quand Auto-réparer est déclenché | Remplit VALIDATE + REPAIR du lifecycle ; supprime la bifurcation D5 |
| **T7 — Synthèse finale + E2E** | SUMMARY_GENERATED : carte compacte « ce qui a changé / fichiers / validation / durée » ; tests E2E : stream→events→synthèse ; scénario échec→réparation ; test refresh/replay | Clôture les 5 questions du CDC §58 |

**Note de compatibilité avec tes derniers choix** : les chips, la carte « Ce que je vais faire » et la barre « C'était bien ça ? » **restent supprimés**. L'approbation de plan (CDC §21) reste portée par le mode Plan First existant (boutons Approuver/Rejeter déjà en place). La synthèse finale du T7 sera **une seule ligne compacte** dans l'esprit de ce que tu as gardé (Thought, Write, Terminal) — pas un retour du fouillis supprimé.

---

## 11. POINTS DE DÉCISION AVANT DE CODER

1. **Latence du gate serveur (T6)** : exécuter le Quality Gate côté serveur avant `done` ajoute ~2-6 s avant le « fini » (rendu Chromium réel). Avantage : vérité unique + validation visible + synthèse fiable. Alternative : garder le gate client et n'émettre que VALIDATION_STARTED côté serveur (moins honnête). **Recommandation : gate serveur.**
2. **Rejouage du chat (T2)** : v1 = rejouer la **timeline de la dernière exécution** seulement ; la reconstitution complète de l'historique de conversation (tous les tours) est un lot ultérieur. **Recommandation : v1 timeline.**
3. **Rétention** : 20 exécutions/projet, 300 events/exécution (plafond doc-store). OK ?

## 12. HORS PÉRIMÈTRE (inchangé)

WebSocket (SSE suffit), Redis/PotsgreSQL (SQLite document store actuel suffit au volume), virtualisation DOM (300 events max), tokens/coûts (peut s'brancher plus tard sur ai-usage si l'adaptateur Mistral les expose).
