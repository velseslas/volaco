# LOT 07 — Mutation Orchestrator: Implementation Report Card

**Date:** 2026-09-15
**Status:** ✅ COMPLETE — READY FOR LOT 08
**Author:** Antigravity Autonomous Engineering Agent

---

## 1. Executive Summary

LOT 07 delivered the **Mutation Orchestrator** — a transactional, idempotent, durable engine for applying
structured ChangeSets to the CanonicalApplicationModel. The orchestrator provides:

- Atomic 12-step application pipeline with rollback
- SHA-256-keyed idempotency cache preventing duplicate execution
- Structured diff engine for file-level change tracking
- Dry-run preview mode (no side effects, no idempotency stamp)
- Durable persistence via `DurableMutationRepository`
- Full audit trail (`MUTATION_APPLIED`, `MUTATION_ROLLED_BACK`)
- Multi-tenant isolation enforced at the project boundary
- REST API surface: `POST /mutations`, `GET /mutations`, `POST /mutations/:id/preview`

All **65 dedicated tests pass** (0 failures). All upstream regression suites are clean.

---

## 2. Test Results

### LOT 07 Dedicated Suite

| Metric | Result |
|--------|--------|
| Tests | **65 / 65** |
| Failures | **0** |
| TypeScript strict errors | **0** |
| Build | **PASS** |

### Quality Gate 1 — Structural Checks

| Gate | Result |
|------|--------|
| Gate 1 checks | **31 / 31 PASS** |

### Quality Gate 2 — Full Regression

| Metric | Result |
|--------|--------|
| Total tests | **1 961** |
| Passed | **1 961** |
| Failed | **0** |

### LOT 05 Regression (Plan First Engine)

| Metric | Result |
|--------|--------|
| Tests | **56 / 56 PASS** |
| Failures | **0** |

### LOT 06 Regression (Agent Runtime)

| Metric | Result |
|--------|--------|
| Tests | **60 / 60 PASS** |
| Failures | **0** |

---

## 3. Architecture Overview

### 3.1 Mutation Orchestrator Pipeline (`applyChangeSet`)

The core method `MutationOrchestratorService.applyChangeSet()` executes a strict **12-step pipeline**:

```
Step 1   — Validate ChangeSet schema (ChangeSetValidator)
Step 2   — Idempotency check (MutationIdempotencyStore, SHA-256 key)
Step 2.5 — Tenant/project isolation check (projectStore.getProject)
Step 3   — Optimistic concurrency: verify applicationModelVersion
Step 4   — Resolve current CanonicalApplicationModel snapshot
Step 5   — Apply operations in order (CREATE / UPDATE / DELETE)
Step 6   — Compute structured diffs (DiffEngine.computeStructuredDiff)
           -> returns early with dryRunResult if dryRun: true
Step 7   — Validate resulting model (post-application integrity checks)
Step 8   — Persist mutations to DurableMutationRepository
Step 9   — Commit updated CanonicalApplicationModel (bump modelVersion)
Step 10  — Emit MUTATION_APPLIED audit event
Step 11  — Stamp idempotency store (prevents replay)
Step 12  — Return MutationResult with diffs and new modelVersion
```

**Rollback**: If any step 5–9 throws, the pipeline catches, rolls back in-flight operations,
emits `MUTATION_ROLLED_BACK` (unconditionally, with a synthetic rollback `requestId`), and re-throws.

**Dry-run**: `previewChangeSet()` delegates to `applyChangeSet({ dryRun: true })`. Pipeline
executes steps 1–6 without writing to any store. The idempotency cache is **not** stamped
during dry-run, ensuring previews are fully side-effect-free.

### 3.2 Component Map

```
packages/core/src/ai-native/mutation-orchestrator/
├── service.ts                    # MutationOrchestratorService (12-step pipeline)
├── engine/
│   └── diff.ts                   # DiffEngine — computeStructuredDiff (CREATE/UPDATE/DELETE)
├── idempotency.ts                # MutationIdempotencyStore (SHA-256 keyed, in-memory + durable)
├── repository.ts                 # DurableMutationRepository (file-system persistence)
├── validator.ts                  # ChangeSetValidator (schema + semantic checks)
└── types.ts                      # ChangeSet, MutationResult, StructuredDiff, etc.

apps/api/src/routes/
└── mutations.ts                  # REST handlers: POST /mutations, GET /mutations, POST /mutations/:id/preview

apps/api/tests/
└── lot07-mutation-orchestrator.test.ts   # 65 dedicated tests, 12 sections
```

### 3.3 Idempotency Key

```
key = SHA-256( tenantId | projectId | executionId | changeSetId )
```

The store rejects any attempt to apply a ChangeSet whose key already exists,
returning the cached `MutationResult` from the first successful execution.

### 3.4 Diff Engine

`computeStructuredDiff(op)` handles four cases:

| Case | `beforeContent` | `afterContent` | Outcome |
|------|----------------|----------------|---------|
| No-op | null | null | `{ addedLines: 0, removedLines: 0 }` |
| CREATE | null | string | `addedLines = lines(after)`, `removedLines = 0` |
| DELETE | string | null | `addedLines = 0`, `removedLines = lines(before)` |
| UPDATE | string | string | Set-diff algorithm, per-line add/remove counts |

**Line counting**: Content is normalized (trailing \n stripped) before `.split('\n')`
to avoid a phantom empty element from standard Unix line endings.

---

## 4. Fixes Applied During Implementation

### Fix 1 — T48: `clearCache()` must clear `transactions`

**Root cause**: `clearCache()` cleared `planCache` and `idempotencyStore` but not `this.transactions`.
Between test runs, stale transaction entries from prior change-sets leaked across tests.

**Fix** (`service.ts` ~L1129–1133):
```typescript
clearCache(): void {
  this.planCache.clear();
  this.idempotencyStore.clear();
  this.transactions.clear();   // added
}
```

---

### Fix 2 — T46: Tenant/project isolation enforcement

**Root cause**: The pipeline had no check that the `changeSet.tenantId` / `changeSet.projectId`
combination referenced an existing, accessible project. A cross-tenant ChangeSet could
reach step 4 and attempt to read from another tenant's model store.

**Fix** (`service.ts` step 2.5):
```typescript
// Step 2.5 — Tenant/project isolation
const project = projectStore.getProject(changeSet.tenantId, changeSet.projectId);
if (!project) {
  throw new NotFoundError(
    `Project ${changeSet.projectId} not found for tenant ${changeSet.tenantId}`
  );
}
```

Also added: `import { projectStore } from '../../identity/project.js'` at L9.

---

### Fix 3 — T50: `MUTATION_ROLLED_BACK` audit must be unconditional

**Root cause**: The rollback audit emission was guarded by `if (requestId)`, meaning
rollbacks triggered without a `requestId` in scope silently skipped audit logging — a security gap.

**Fix** (`service.ts` ~L1073–1085): Removed the `if (requestId)` guard:
```typescript
const rollbackReqId = requestId ?? `rollback-${Date.now()}`;
auditStore.record({
  requestId: rollbackReqId,
  event: 'MUTATION_ROLLED_BACK',
  // ...
});
```

---

### Fix 4 — T19: Hardcoded `applicationModelVersion: 2` in test

**Root cause**: Test T19 hardcoded `applicationModelVersion: 2`. After prior LOT runs
that bumped the model version, this literal was stale and caused the test to pass
for the wrong reason (or fail when version drifted past 2).

**Fix** (`lot07-mutation-orchestrator.test.ts` L551):
```typescript
// Before
applicationModelVersion: 2,

// After
applicationModelVersion: applicationModelStore
  .getModel(tenantA, projectIdA).metadata.modelVersion,
```

---

### Fix 5 — T40: `addedLines` miscounted for CREATE/DELETE cases

**Root cause**: `'line1\nline2\n'.split('\n')` → `['line1', 'line2', '']` = **3 elements**.
Standard Unix files end with `\n`, so every content string had one extra phantom element,
causing `addedLines` to be reported as `N+1` instead of `N`.

**Fix** (`engine/diff.ts` lines 28–50):
```typescript
// Normalize trailing newline before counting
const normalized = content.endsWith('\n') ? content.slice(0, -1) : content;
const lineCount = normalized.split('\n').length;
```
Applied in both the CREATE and DELETE branches.

---

## 5. Studio Parity

| Feature | Studio Spec | Implementation |
|---------|-------------|----------------|
| Atomic application | Required | ✅ 12-step pipeline with rollback |
| Idempotency | SHA-256 key | ✅ `MutationIdempotencyStore` |
| Dry-run preview | Side-effect free | ✅ returns at step 6, no store writes |
| Structured diffs | Per-operation | ✅ `DiffEngine.computeStructuredDiff` |
| Durable persistence | File-system | ✅ `DurableMutationRepository` |
| Audit trail | Always | ✅ `MUTATION_APPLIED` + `MUTATION_ROLLED_BACK` |
| Tenant isolation | Strict | ✅ Step 2.5 project check |
| REST API | OpenAPI compliant | ✅ `mutations.ts` routes |

**Studio parity: 100%**

---

## 6. TypeScript Strict Compliance

```
TypeScript strict errors: 0
```

Build command: `cmd /c "npm run build"`
Compiler flags: `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`

---

## 7. Cumulative Regression Summary (LOT 03 → LOT 07)

| LOT | Suite | Tests | Result |
|-----|-------|-------|--------|
| LOT 03 | Identity & Auth | — | ✅ Included in Gate 2 |
| LOT 04 | Application Model | — | ✅ Included in Gate 2 |
| LOT 05 | Plan First Engine | 56 / 56 | ✅ PASS |
| LOT 06 | Agent Runtime | 60 / 60 | ✅ PASS |
| LOT 07 | Mutation Orchestrator | 65 / 65 | ✅ PASS |
| **Gate 2** | **Full regression** | **1 961 / 1 961** | **✅ PASS** |

---

## 8. Verdict

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   LOT 07 — Mutation Orchestrator                           │
│                                                             │
│   Dedicated tests  : 65 / 65      ✅                       │
│   Gate 1           : 31 / 31      ✅                       │
│   Gate 2           : 1961 / 1961  ✅                       │
│   LOT 05 regression: 56 / 56      ✅                       │
│   LOT 06 regression: 60 / 60      ✅                       │
│   TypeScript strict: 0 errors     ✅                       │
│   Studio parity    : 100%         ✅                       │
│                                                             │
│   STATUS: ✅  READY FOR LOT 08                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

No blockers. No known regressions. Implementation complete.
