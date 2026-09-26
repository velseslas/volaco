# Phase 11 — Application Model

> **Spec + résultat de l'implémentation**
> Date : 2026-09-24
> Prérequis : Phases 0, 3, 4, 5, 5.5, 6, 9, 9.5, 10
> Approche : **JavaScript pré-compilé, plus de `npx tsc` nécessaire**

---

## 1. Objectif

Boucler la flèche 11 du flux officiel CDC §5 : **FILES → APPLICATION MODEL**.

Le CDC §8 décrit l'Application Model comme le "centre de connaissance unique" — une représentation vivante du projet (stack, structure, conventions, dépendances) qui se met à jour automatiquement après chaque mutation.

Avant Phase 11 : aucune mémoire de l'app. Le `AIOrchestrator` prend des décisions "à l'aveugle", sans connaître le framework, le langage, ou les conventions du projet.

Après Phase 11 : l'`ApplicationModelService` maintient un modèle persistant, mis à jour automatiquement via le hook dans `MutationService` (Phase 10), et queryable via 5 routes HTTP.

---

## 2. Architecture

```
            USER message
                │
                ▼
        ┌──────────────────┐
        │  POST /decide     │  Phase 9.5
        │  DecisionEngine   │
        └────────┬──────────┘
                 │ Decision
                 ▼
        ┌──────────────────┐
        │  POST /orchestrate│  Phase 9
        │  AIOrchestrator  │
        └────────┬──────────┘
                 │ OrchestrationRun
                 ▼
        ┌──────────────────┐         ┌────────────────────────┐
        │  POST /mutate    │ ──────► │  ApplicationModel      │ Phase 11 ← NOUVEAU
        │  MutationService  │ hook   │  recordMutation()      │
        └────────┬──────────┘         │  ↓ refresh()           │
                 │                    │  - stack detection    │
                 ▼                    │  - structure (dirs)  │
           FILESTORE                  │  - conventions       │
         (vraie mutation)             │  - dependencies      │
                                      │  - history (50 max) │
                                      └────────┬───────────────┘
                                               │ queryable via
                                               ▼
                            ┌──────────────────────────────────┐
                            │ GET  /application-model          │
                            │ GET  /application-model/summary  │
                            │ POST /application-model/refresh  │
                            │ GET  /application-model/stack    │
                            │ GET  /application-model/conventions
                            │ GET  /application-model/dependencies?path=...
                            │ GET  /application-model/history  │
                            └──────────────────────────────────┘
```

---

## 3. Fichiers livrés (tous en JS pré-compilé)

### A. Nouveaux fichiers

| Fichier | Rôle | LOC |
|---|---|---|
| `dist/packages/core/src/ai-native/application-model/application-model-service.js` | La classe `ApplicationModelService` (~580 LOC) | 575 |
| `dist/packages/core/src/ai-native/application-model/index.js` | Exports publics | 5 |
| `dist/apps/api/src/routes/application-model.js` | Route HTTP (~150 LOC) | 145 |

### B. Fichiers modifiés

- `dist/apps/api/src/server.js` :
  - Import `ApplicationModelService` + `handleApplicationModelRoutes`
  - Instanciation : `const applicationModelService = new ApplicationModelService();`
  - Pass au `MutationService` : `{ versioningService, auditStore, applicationModelService }`
  - Dispatch `handleApplicationModelRoutes` après `handleMutateRoutes`
  - `configureApplicationModelRoute({ applicationModelService })`

- `dist/packages/core/src/ai-native/mutation-engine/mutation-service.js` :
  - Ajout `applicationModelService` dans le constructeur
  - Hook après mutation `COMPLETED` : appel `applicationModelService.recordMutation(...)`
  - Log spécifique : `MutationService: ApplicationModel refreshed after mutation`

---

## 4. Le model `ApplicationModel`

```typescript
interface ApplicationModel {
  projectId: string;
  tenantId: string;
  version: number;              // incrémenté à chaque refresh
  lastUpdated: string;          // ISO timestamp
  
  snapshot: {
    filesCount: number;
    treeHash: string;           // hash de l'arbre des fichiers
    contentHash: string;        // hash des contenus concaténés
  };
  
  stack: {
    detected: string[];          // ['React', 'Vitest', 'TypeScript', ...]
    confidence: Record<string, number>;  // { React: 0.95, ... }
  };
  
  structure: {
    directories: string[];       // ['src', 'tests', 'docs']
    fileTypes: Record<string, number>;  // { '.ts': 12, '.js': 8 }
    namingConventions: {
      camelCase: number;
      kebabCase: number;
      PascalCase: number;
      snake_case: number;
    };
    avgFileSize: number;         // bytes
    largestFiles: Array<{ path: string; bytes: number }>;  // top 5
  };
  
  conventions: {
    hasTypeScript: boolean;
    hasReact: boolean;
    hasVue: boolean;
    hasTailwind: boolean;
    hasESLint: boolean;
    hasTests: boolean;
    hasPlaywright: boolean;
    primaryFramework: string | null;  // 'React', 'Vue', 'Next.js', ...
    primaryLanguage: string | null;   // 'TypeScript', 'JavaScript', ...
  };
  
  dependencies: {
    imports: Record<string, string[]>;     // file → imported paths
    importedBy: Record<string, string[]>;  // file → files that import it
  };
  
  history: Array<{                // last 50 entries
    timestamp: string;
    action: 'refresh' | 'mutation';
    trigger: string;              // 'manual' | 'lazy-init' | 'mutation:<id>'
    mutationId?: string;
    filesChanged?: number;
    version: number;
  }>;
}
```

---

## 5. Routes HTTP

### `GET /api/v1/projects/:projectId/application-model`
Retourne le model complet. Si absent, le construit à partir des fichiers actuels (lazy init).

### `GET /api/v1/projects/:projectId/application-model/summary`
Résumé compact : version, filesCount, stack (top 5), primaryFramework, history (last 5).

### `POST /api/v1/projects/:projectId/application-model/refresh`
Force la reconstruction complète du model. Retourne la nouvelle version.

### `GET /api/v1/projects/:projectId/application-model/stack`
Juste la stack détectée + confidence.

### `GET /api/v1/projects/:projectId/application-model/conventions`
Juste les conventions (hasTypeScript, primaryFramework, etc.).

### `GET /api/v1/projects/:projectId/application-model/dependencies?path=src/App.tsx`
Dépendances d'un fichier spécifique : `{ filePath, imports[], importedBy[] }`.

### `GET /api/v1/projects/:projectId/application-model/history`
Historique complet des refreshs/mutations.

---

## 6. Stack detection (16 patterns)

L'`ApplicationModelService` détecte automatiquement :

| Stack | Pattern | Confidence max |
|---|---|---|
| React | `from 'react'` | 0.95 |
| Vue | `from 'vue'` | 0.95 |
| Next.js | `from 'next/...'` | 0.95 |
| Nuxt | `from 'nuxt/...'` | 0.95 |
| Svelte | `from 'svelte...'` | 0.95 |
| Angular | `from '@angular/...'` | 0.95 |
| Express | `from 'express'` | 0.9 |
| Fastify | `from 'fastify'` | 0.9 |
| Tailwind | `className=...flex|grid|p-N` | 0.85 |
| Bootstrap | `className=...btn|container|row` | 0.85 |
| Zod | `from 'zod'` | 0.9 |
| Yup | `from 'yup'` | 0.9 |
| Playwright | `from '@playwright/...'` | 0.95 |
| Jest | `from '@jest/...'` | 0.9 |
| Vitest | `from 'vitest'` | 0.95 |
| Prisma | `from '@prisma/...'` | 0.95 |
| Drizzle | `from 'drizzle-...'` | 0.95 |

Et 15 langages par extension (TypeScript, JavaScript, Python, Rust, Go, Java, C#, PHP, Ruby, HTML, CSS, SCSS, JSON, YAML, Markdown).

---

## 7. Validation runtime (test réel sur `volaco-real`)

Testé le 2026-09-24 :

1. **Créer projet `proj_n3d93p3v0`** + 3 fichiers (`src/App.tsx`, `src/components/Header.tsx`, `tests/App.test.ts`)

2. **GET /application-model** (lazy-init) :
   - `version: 1`
   - `filesCount: 4`
   - **`stack.detected: ['React', 'Vitest']`** ✅
   - **`primaryFramework: React`** ✅
   - **`primaryLanguage: TypeScript`** ✅
   - `hasTypeScript: True`, `hasReact: True`, `hasTests: True`
   - `fileTypes: { '.html': 1, '.tsx': 2, '.ts': 1 }`
   - `directories: ['src', 'tests']`

3. **POST /mutate** (crée `src/style.css`) :
   - `state: COMPLETED`, `successCount: 1`
   - **Hook automatique** : `ApplicationModelService.recordMutation` appelé
   - **Refresh automatique** : `version: 2, filesCount: 5`

4. **GET /application-model** après mutation :
   - `version: 2` ← incrémenté ✅
   - `filesCount: 5` ← +1 (le nouveau `src/style.css`) ✅
   - `history`:
     - `refresh v1 trigger=lazy-init`
     - `mutation v2 trigger=mutation:mut_pending`

**Phase 11 validée en runtime ✅**

---

## 8. Score flèches CDC après Phase 11

| # | Flèche | Avant | Après Phase 11 |
|---|---|---|---|
| 1 | USER → STUDIO | ✅ | ✅ |
| 2 | STUDIO → API | ✅ | ✅ |
| 3 | API → CONVERSATION | 🟡 | 🟡 |
| 4 | CONVERSATION → INTENT | ✅ | ✅ |
| 5 | INTENT → COMPASS | ✅ | ✅ |
| 6 | COMPASS → PLAN | ✅ | ✅ |
| 7 | PLAN → ORCHESTRATOR | ✅ | ✅ |
| 8 | ORCHESTRATOR → AGENTS | ✅ | ✅ |
| 9 | AGENTS → DECISION | ✅ (9.5) | ✅ |
| 10 | DECISION → FILES | ✅ (10) | ✅ |
| 11 | FILES → APP MODEL | 🔴 | **✅ (Phase 11)** 🆕 |
| 12 | APP MODEL → VALIDATION | 🔴 | 🔴 (Phase 12) |
| 13 | VALIDATION → PREVIEW | 🔴 | 🔴 (Phase 13) |

**Score : 8/13 flèches vivantes** (vs 7/13 avant Phase 11).

---

## 9. Installation

```powershell
# 1. Dézippe phase11-patch.zip à la racine de volaco-core
# 2. Lance le script PowerShell :
.\apply_phase11.ps1
```

Le script va :
- Copier `patch\dist\packages\core\src\ai-native\application-model\*` → `dist\packages\core\src\ai-native\application-model\`
- Copier `patch\dist\apps\api\src\routes\application-model.js` → `dist\apps\api\src\routes\`
- Backup `dist\apps\api\src\server.js` → `server.js.backup-phase10`
- Remplacer `dist\apps\api\src\server.js` par la version Phase 11
- Remplacer `dist\packages\core\src\ai-native\mutation-engine\mutation-service.js` par la version avec hook ApplicationModel

**Aucune compilation TypeScript nécessaire !** Tout est en .js pré-compilé.

---

## 10. Prochaine étape

**Phase 12 — Validation réelle** (CDC §38) :
- Après chaque mutation via Phase 10, valider que le projet compile toujours (TypeScript + tests)
- Exposer une route `POST /api/v1/projects/:id/validate` qui exécute `tsc --noEmit` et `node --test`
- Mettre à jour le `project-state` avec les vrais résultats (pas des `false` non calculés)

---

**Fin de spec. Phase 11 validée en runtime ✅**
