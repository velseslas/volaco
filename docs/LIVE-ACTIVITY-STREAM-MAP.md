# IMPLEMENTATION MAP — LIVE AGENT ACTIVITY STREAM (LOT A)

> Audit réalisé le 2026-09-29 conformément au protocole du spec (§0/§48) : lecture du code réel, AUCUNE modification de code.
> Ce document est la carte de départ validable avant le LOT B (modèle d'événement + normalisation).

---

## 1. ARCHITECTURE ACTUELLE (chemin réel, pas les noms de modules)

```
UTILISATEUR (Studio index.html)
  POST …/conversation/sessions/:sid/stream   (fetch + getReader, PAS EventSource)
      ↓
conversation.ts :404-1290 — route SSE autonome
      ├─ ExecutionRecorder.emit(frame, event?)   ← POINT UNIQUE store + SSE
      │     ├─ ExecutionEventStore.appendEvent   (SQLite doc « executions »)
      │     └─ res.write("data: {json}\n\n")     (champs additifs executionId/seq/phase/status)
      ├─ merge sections (regex, garde d'unicité, déduplication)
      ├─ gate serveur (analyzeProjectVisual)     — VALIDATION_* persistés
      └─ done { html, synthesis, gate }          — bilan + révision auto
      ↓
index.html :3936-4248 — handlers par event.type (chaîne if/else)
      ├─ 3 SURFACES de rendu concurrentes (voir §6)
      ├─ stitch module (preview vivant) — indépendant du stream UI
      └─ narration machine à écrire (chat frames)
```

## 2. ÉVÉNEMENTS EXISTANTS

**Frames SSE** (conversation.ts:566-1267) : `start{isModification}`, `compass{state}` (9 états), `plan{plan}`, `chat{text}`, `token{token}`, `section_start{name,mode,after,index}`, `section_end{…,text,html}`, `diff{section,mode,applied,added,removed}`, `cancelled`, `done{awaitingConfirmation}` / `done{updated,html,thinking,synthesis,gate}`, `error{error}` + heartbeat `: ping` (15 s).

**ExecutionEvent persistés** (types.ts:27-47, 19 types) : EXECUTION_STARTED, PHASE_CHANGED, PLAN_CREATED, PLAN_APPROVED, FILE_READ, FILE_CREATED, FILE_MODIFIED, FILE_DELETED, DIFF_GENERATED, VALIDATION_STARTED/COMPLETED/FAILED, REPAIR_STARTED/RETRY_STARTED/REPAIR_COMPLETED, EXECUTION_COMPLETED/FAILED/CANCELLED, SUMMARY_GENERATED.
Phases fixes : UNDERSTAND/PLAN/INSPECT/IMPLEMENT/VALIDATE/REPAIR/COMPLETE. Statuts : RUNNING/COMPLETED/FAILED/CANCELLED/WAITING_USER.

**Couverture vs les 18 actions du spec** : couverts = thinking/analysis (UNDERSTAND+narration), reading (FILE_READ), creating/modifying/deleting (FILE_*), validating, repairing, retrying (RETRY_STARTED), waiting (WAITING_USER), completed. **Manquants** : searching, moving, building, previewing, debugging, checking (granulaire) — le type enum est FERMÉ (violation du principe « extensible sans refonte »).

## 3. FLUX SSE

POST + ReadableStream (EventSource impossible : GET-only), frames `data:{json}\n\n`, dispatch sur `type`, heartbeat commentaire, clientGone + cancel endpoint + drapeau. Aucun `id:`/`Last-Event-ID` (le replay passe par le store, pas par le transport — choix assumé, à conserver).

## 4. STORE

`ExecutionEventStore` (packages/core/src/ai-native/execution/store.ts) : SQLite doc unique `executions`, Map mémoire + persist par mutation, seq monotone (anti-doublon + ordre fiable), plafonds 300 events / 20 exécutions par projet, ordre monotone `order` (anti-collision startedAt), garde post-clôture (REPAIR_*/VALIDATION_*/SUMMARY autorisés après fin — utilisé par l'auto-réparation).

## 5. REPLAY

`GET /executions/latest` + `GET /executions/:id` (isolation tenant) → `renderLastExecutionReplay` (index.html:10584) → **`buildReplayTimelineHtml` (10537) : un DEUXIÈME renderer, séparé du live** — violation directe du principe « UN SEUL RENDERER » (§19). À fusionner en LOT H.

## 6. RENDERER — LES 3 SURFACES CONCURRENTES (état actuel)

1. **traceCard** (3118) : cartes Thought / Write / Terminal — Thought encore affiché, Terminal déplié avec ligne `$` factice, Write duplique le total diff.
2. **Timeline par PHASES** (3707-3790) : `PHASE_ORDER` + `PHASE_META` codés en dur — structure PHASE-DRIVEN, exactement ce que le spec interdit (§2) ; items ajoutés via agentStepAdd/Close dans le détail de la phase courante.
3. **Replay timeline séparé** (10537) : reconstruit les phases depuis le store, en parallèle du live.
Plus : ligne de statut (`✓ N tokens · Xs` — tokens en surface principale, interdit §47), synthèse finale (compacte ✓ mais doublonnée avec la carte Write), bannière Quality Gate preview + score dans Terminal + row Vérification + synthèse (score ×3 dans la conversation).

## 7. COMPOSANTS ACTUELS (mappage EVENT→STORE→TRANSPORT→FRONTEND→RENDERER→UI)

| Événement réel | Store | Frame SSE | Handler client | Surface UI actuelle |
|---|---|---|---|---|
| Démarrage | EXECUTION_STARTED | start | :3936 | header + Thought card |
| Lecture fichier | FILE_READ | (aucune frame) | — | (replay seulement) |
| Plan | PLAN_CREATED/APPROVED | plan | :4176 | row « Plan validé » (dans la phase Analyse — mal placé) |
| Construction section | FILE_CREATED/MODIFIED (RUNNING→COMPLETED) | section_start/section_end | :3955/:3968 | rows phase Construction + diff rows |
| Diff | DIFF_GENERATED | diff | :4212 | badge +n−n (dupliqué ×3) |
| Validation | VALIDATION_* | compass VALIDATING + done.gate | :4180 | row ✓ score + Terminal + bannière |
| Réparation | REPAIR_* | (aucune frame dédiée) | — | (replay seulement) |
| Annulation | EXECUTION_CANCELLED | cancelled | :4228 | statut ⏹ |
| Échec | EXECUTION_FAILED | error | :4238 | statut rouge |
| Fin | EXECUTION_COMPLETED + SUMMARY_GENERATED | done | :4019 | synthèse + Write card + rows |

**Constat clé** : le STORE est déjà générique et complet ; c'est le RENDU qui est rigide (phases fixes, cartes en double, 2 renderers).

## 8. FICHIERS CONCERNÉS

- `packages/core/src/ai-native/execution/types.ts` (modèle — à étendre additivement)
- `packages/core/src/ai-native/execution/store.ts` + `recorder.ts` (réutilisables tels quels)
- `apps/api/src/routes/conversation.ts` (frames + merge + gate serveur)
- `apps/api/src/routes/visual.ts` (gate + findings structurels)
- `apps/api/src/routes/repair.ts` (événements REPAIR_* existants)
- `apps/studio/index.html` : handlers 3936-4248, traceCard 3118, timeline phases 3707-3790, replay 10537-10660, done 4019-4175
- Tests : `execution-events.test.ts` (11), `execution-e2e.test.ts` (5 scénarios réels avec adaptateur factice)

## 9. CODE RÉUTILISABLE (à conserver tel quel)

ExecutionRecorder (emit unique), ExecutionEventStore (persist + replay + seq), les 19 types de store, heartbeat, stitch/preview vivant (INDÉPENDANT du stream UI — ses canvas-states restent phase-based pour le preview, ce qui n'est pas couvert par l'interdit §2), narration typewriter, chaîne d'annulation ⏹, gate serveur, feature flag `VOLACO_EXECUTION_TIMELINE`, infra E2E (adaptateur factice, bloque/annule), contract frames additifs.

## 10. CODE À REMPLACER (LOT I — suppression réelle, pas CSS)

`PHASE_ORDER`/`PHASE_META`/`timelineEnterPhase`/`ensurePhaseRow`/`agentStepAdd`/`agentStepClose` (phase-driven), `traceCard` et ses 3 cartes, `buildReplayTimelineHtml` (fusionné dans le renderer unique), la ligne tokens, la synthèse dupliquée, le score répété ×3.

## 11. RISQUES

1. **Réécriture du renderer = toucher du code qui marche** → mitigation : le nouveau ActivityStream coexiste derrière un sous-flag (`VOLACO_ACTIVITY_STREAM=on`) le temps des LOT C/D, bascule, puis suppression (LOT I).
2. **Replay backward-compat** : les records persistés n'auront pas les nouveaux champs (action/source/startedAt…) → la normalisation doit mettre des défauts, jamais planter sur un ancien record.
3. **Confusion preview/stream** : l'interdit « phase-driven » vise le FLUX UI ; les canvas-states du preview restent phase-based (compass) — ne pas les casser en refactorant.
4. **Plan dynamique (LOT F)** : nécessite un NOUVEAU frame additif `plan_updated{steps[]}` + l'IA ne produit aujourd'hui qu'un plan fixe 3 étapes — le dynamisme réel dépendra des étapes émises au fil du stream (appends).
5. **Perf/groupement (LOT 27)** : 300 events max déjà plafonnés ; le grouping doit rester déterministe (par type+section consécutifs).

## 12. PLAN D'IMPLÉMENTATION (mapping LOT B-M du spec → nos lots)

| Lot spec | Notre lot | Contenu | Nature |
|---|---|---|---|
| LOT B | **B1** | ActivityEvent : extension additive d'ExecutionEvent (+action, +source, +parentId, +startedAt/completedAt, raw conservé) + `normalizeExecutionEvent()` (19 types → actions du spec, défauts pour records anciens) + enum ouvert (type générique + action libre) | Backend pur |
| LOT C | **B2** | Renderer `ActivityStream` générique (type/action/status/metadata), états ◉/✓/!/—/○/–, pulse subtil, aria-live, prefers-reduced-motion — coexiste derrière sous-flag | Frontend |
| LOT D | **B3** | Live : les frames SSE → normalize → ActivityStream (un seul point d'entrée) | Frontend |
| LOT E | **B4** | File activity légère + diff UNE fois (dans l'item) | Frontend |
| LOT F | **B5** | Plan dynamique optionnel : frame additive `plan_updated`, checklist ☐/◉/☑ vivante, absente si tâche triviale | Backend+Frontend |
| LOT G | **B6** | Erreur/réparation dans le flux + narration opérationnelle DANS le stream (fin des cartes) | Frontend |
| LOT H | **B7** | Replay = MÊME renderer (suppression de buildReplayTimelineHtml) + refresh complet | Frontend |
| LOT I | **B8** | Suppression des anciennes surfaces (liste §10) | Frontend |
| LOT J | **B9** | Design polish (léger, conversationnel) | Frontend |
| LOT K | **B10** | Tests unitaires (normalization, états, grouping, anti-doublon) | Tests |
| LOT L | **B11** | E2E scénarios A-I (l'infra existe — étendre) | Tests |
| LOT M | **B12** | Audit final UX + rapport qualité | Audit |

Ordre respecté : pas de polish avant que le flux event-driven soit vivant (B1→B8).

## 13. TESTS EXISTANTS

1102 verts. Pertinents pour ce spec : execution-events (11 — ordre, persistance, cap, rétention, garde post-clôture, routes), execution-e2e (5 — génération complète, REPAIR, annulation+heartbeat, refresh, déduplication, gate structurel), plan-first, conversation-shell, lot10 (UI statique). À étendre en LOT K/L (normalization, états, grouping, scénarios A-I du spec).

## 14. INCOMPATIBILITÉS

Aucune cassante : frames additifs, store additif, flag présent, contract SSE préservé (§33 respecté). Deux arbitrages à valider : (1) le gate bannière du PREVIEW reste (hors conversation — le « score ×1 » du spec s'applique au flux) ; (2) les phases restent un regroupement UX OPTIONNEL dans le renderer (autorisé §2) mais ne déterminent plus rien.

## CE QUI EXISTE DÉJÀ (ne pas refaire — rappel)

Progressive appearance réelle (événements horodatés), annulation ⏹ cohérente, pas de chain-of-thought (narration opérationnelle), feature flag, refresh, SSE compatible, vérité (store = source), seq fiable, REPAIR persisté, gate serveur réel.
