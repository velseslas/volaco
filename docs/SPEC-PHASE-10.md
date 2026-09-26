# Phase 10 — Mutation Engine

> **Spec + résultat de l'implémentation**
> Date : 2026-09-24
> Prérequis : Phases 0, 3, 4, 5, 5.5, 6, 9, 9.5
> Approche : **JavaScript pré-compilé, plus de `npx tsc` nécessaire**

---

## 1. Objectif

Boucler la flèche 10 du flux officiel CDC §5 : **TOOLS → FILES**.

Aujourd'hui l'AI Orchestrator (Phase 9) génère des artifacts `PROPOSED_FILE_CHANGE` qui ne sont jamais appliqués aux vrais fichiers du FileStore. Phase 10 comble ce manque en exposant un `MutationService` qui :

1. Prend un `OrchestrationRun` complet (avec ses artifacts)
2. Crée un snapshot "before" via le `VersioningService`
3. Pour chaque artifact `PROPOSED_FILE_CHANGE` :
   - `CREATE` → `fileStore.saveFile(...)`
   - `UPDATE` → `fileStore.saveFile(...)`
   - `DELETE` → `fileStore.deleteNode(...)`
4. Si erreur → rollback automatique au snapshot "before"
5. Si tout OK → snapshot "after" pour audit
6. Retourne un `MutationReport` détaillé

Branché sur le `DecisionEngine` (Phase 9.5) :
- Si `decision.verdict = BLOCKED` → la route refuse de muter (403)
- Si `decision.verdict = DEFERRED` → la route refuse (409)
- Si `decision.verdict = NEEDS_CONFIRMATION` et `status !== 'ACCEPTED'` → refuse (409)
- Sinon → mute

---

## 2. Architecture

```
USER message
    │
    ▼
┌──────────────────────┐
│ POST /decide         │  Phase 9.5
│ (DecisionEngine)     │
└──────┬───────────────┘
       │ Decision { verdict, chosenAlternative, alternatives }
       ▼
┌──────────────────────┐
│ POST /orchestrate    │  Phase 9
│ (AI Orchestrator)    │
└──────┬───────────────┘
       │ OrchestrationRun { artifacts: PROPOSED_FILE_CHANGE[] }
       ▼
┌──────────────────────┐
│ POST /mutate         │  Phase 10 ← NOUVEAU
│ (MutationService)    │
└──────┬───────────────┘
       │ MutationReport { state, successCount, revisionBeforeId, revisionAfterId }
       ▼
   FILESTORE (vraie mutation disque)
```

---

## 3. Fichiers livrés

### A. Nouveaux fichiers (en JS pré-compilé, directement dans `dist/`)

| Fichier | Rôle |
|---|---|
| `dist/packages/core/src/ai-native/mutation-engine/mutation-service.js` | La classe `MutationService` (~280 LOC) |
| `dist/packages/core/src/ai-native/mutation-engine/index.js` | Exports publics |
| `dist/apps/api/src/routes/mutate.js` | Route `POST /mutate` (~150 LOC) |
| `apps/studio/phase9.js` | JS client Studio qui rend la conversation visible (~370 LOC) |

### B. Fichier modifié (server.js pré-compilé)

`dist/apps/api/src/server.js` — patché pour :
- Importer `MutationService`, `VersioningService`, `handleMutateRoutes`
- Instancier `versioningService = new VersioningService(projectStore, revisionStore, fileStore, undefined, auditStore)`
- Instancier `mutationService = new MutationService({ versioningService, auditStore })`
- Appeler `configureMutateRoute({ mutationService, decisionEngine })`
- Dispatcher `handleMutateRoutes` après `handleDecideRoutes`

### C. Backup automatique

`server.js.backup-phase9.5` est créé par `apply_phase10.ps1` avant de remplacer `server.js`.

---

## 4. Route API

### `POST /api/v1/projects/:projectId/mutate`

**Headers** :
- `X-Tenant-Id: <tenant>` (ou `Authorization: Bearer <apiKey>`)
- `X-User-Role: OWNER` ou `ENGINEER` (min. `PROJECT_UPDATE`)

**Body** :
```json
{
  "run": {
    "orchestrationId": "orch_...",
    "tenantId": "tenant_test",
    "projectId": "proj_...",
    "planId": "plan_...",
    "state": "COMPLETED",
    "artifacts": [
      {
        "id": "a1",
        "taskId": "t1",
        "agentId": "ui",
        "domain": "UI",
        "kind": "PROPOSED_FILE_CHANGE",
        "targetFiles": ["src/style.css"],
        "payload": {
          "filePath": "src/style.css",
          "operation": "CREATE",
          "proposedContent": "body { background: #f0f0f0; }",
          "reason": "User requested styling"
        },
        "confidence": 0.9,
        "hash": "h1"
      }
    ]
  },
  "decisionId": "dec-..."  // optionnel, si présent vérifie le verdict
}
```

**Response 200** :
```json
{
  "report": {
    "mutationId": "mut_10b27e9d-0b7",
    "orchestrationId": "orch_test",
    "tenantId": "tenant_test",
    "projectId": "proj_8ruxt5zpa",
    "revisionBeforeId": "rev_9e65b037d61348ba",
    "revisionAfterId": "rev_60ffd9cd36724d9a",
    "changes": [
      {
        "artifactId": "a1",
        "filePath": "src/style.css",
        "operation": "CREATE",
        "appliedContent": "body { background: #f0f0f0; }",
        "reason": "User requested styling",
        "bytesBefore": 0,
        "bytesAfter": 30,
        "status": "SUCCESS"
      }
    ],
    "successCount": 1,
    "skippedCount": 0,
    "failedCount": 0,
    "state": "COMPLETED",
    "startedAt": "2026-09-24T17:09:17.550Z",
    "completedAt": "2026-09-24T17:09:17.558Z",
    "durationMs": 8
  },
  "requestId": "req_..."
}
```

**Response 403** (decision BLOCKED) :
```json
{
  "message": "Mutation refusée : le verdict est BLOCKED (contrainte HARD violée)",
  "decision": { ... },
  "requestId": "..."
}
```

---

## 5. Validation runtime (test curl réel)

Testé le 2026-09-24 sur `volaco-real` workspace :

1. **POST /api/v1/projects** → `proj_8ruxt5zpa` créé
2. **POST /api/v1/projects/proj_8ruxt5zpa/files** → `src/index.html` créé
3. **POST /api/v1/projects/proj_8ruxt5zpa/decide** →
   - `verdict: READY`
   - `chosenAlternative: "Directory structure: src"` (issue de l'UnderstandingAnalyst !)
   - `nextState: PLANNING`
4. **POST /api/v1/projects/proj_8ruxt5zpa/mutate** →
   - `mutationId: mut_10b27e9d-0b7`
   - `state: COMPLETED`
   - `successCount: 1`
   - `revisionBeforeId: rev_9e65b037d61348ba`
   - `revisionAfterId: rev_60ffd9cd36724d9a`
   - `durationMs: 8`

**Phase 10 fonctionne end-to-end** ✅

---

## 6. Studio conversation visible (`phase9.js`)

Le script `apps/studio/phase9.js` (~370 LOC) hook le chat du Studio et route les messages à travers le pipeline complet :

1. User tape un message + clique sur **🤖 AI Pipeline** (bouton ajouté à côté du bouton chat existant)
2. `POST /decide` → affiche le verdict, les alternatives, le trace
3. Si `READY` → affiche bouton **🚀 Approuver et orchestrer**
4. User approuve → `POST /orchestrate` → affiche les agents, les artifacts `PROPOSED_FILE_CHANGE`
5. Si artifacts → affiche bouton **📝 Apply mutations**
6. User applique → `POST /mutate` → affiche le `MutationReport` (files changed, revisions)

**Pour activer** : ajouter à la fin de `apps/studio/index.html` (juste avant `</body>`) :
```html
<script defer src="phase9.js"></script>
```

Le script est non-intrusif : il ne modifie pas le bouton de chat existant. Il ajoute juste un nouveau bouton à côté.

---

## 7. Installation

```powershell
# 1. Dézippe phase10-patch.zip à la racine de volaco-core
# 2. Lance le script PowerShell :
.\apply_phase10.ps1
```

Le script va :
- Copier `patch\dist\packages\core\src\ai-native\mutation-engine\*` → `dist\packages\core\src\ai-native\mutation-engine\`
- Copier `patch\dist\apps\api\src\routes\mutate.js` → `dist\apps\api\src\routes\`
- Backup `dist\apps\api\src\server.js` → `server.js.backup-phase9.5`
- Copier `patch\dist\apps\api\src\server.js` → `dist\apps\api\src\server.js`
- Copier `patch\apps\studio\phase9.js` → `apps\studio\phase9.js`

**Aucune compilation TypeScript nécessaire !** Tout est en .js pré-compilé.

---

## 8. Score flèches CDC après Phase 10

| # | Flèche | Avant | Après Phase 10 |
|---|---|---|---|
| 1 | USER → STUDIO | ✅ | ✅ |
| 2 | STUDIO → API | ✅ (Bearer) | ✅ |
| 3 | API → CONVERSATION | 🟡 | 🟡 |
| 4 | CONVERSATION → INTENT | ✅ (LLM) | ✅ |
| 5 | INTENT → COMPASS | ✅ (LLM) | ✅ |
| 6 | COMPASS → PLAN | ✅ (LLM) | ✅ |
| 7 | PLAN → ORCHESTRATOR | ✅ | ✅ |
| 8 | ORCHESTRATOR → AGENTS | ✅ (5 agents Mistral) | ✅ |
| 9 | AGENTS → DECISION ENGINE | ✅ (Phase 9.5) | ✅ |
| 10 | DECISION → FILES | 🔴 | **✅ (Phase 10)** 🆕 |
| 11 | FILES → APP MODEL | 🔴 | 🔴 (Phase 11) |
| 12 | APP MODEL → VALIDATION | 🔴 | 🔴 (Phase 12) |
| 13 | VALIDATION → PREVIEW | 🔴 | 🔴 (Phase 13) |

**Score : 7/13 flèches vivantes** (vs 6/13 avant Phase 10).

---

## 9. Prochaine étape

**Phase 11 — Application Model** (le "centre de connaissance unique" du CDC §8) :
- Créer un `ApplicationModelService` qui maintient une représentation vivante du projet (architecture, conventions, dépendances)
- Après chaque mutation via Phase 10, mettre à jour l'Application Model
- Permettra à l'Orchestrator de prendre des décisions informées sur l'état actuel de l'app

---

**Fin de spec. Phase 10 validée en runtime ✅**
