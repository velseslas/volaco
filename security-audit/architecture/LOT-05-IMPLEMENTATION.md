# LOT 05 — PLAN FIRST ENGINE & USER CONFIRMATION RUNTIME
## RAPPORT D'IMPLÉMENTATION ET VALIDATION FORMELLE

---

### A. RÉSUMÉ EXÉCUTIF

Le **LOT 05 — Plan First Engine & User Confirmation Runtime** a été intégralement implémenté, durci et validé conformément aux spécifications du CDC V7/V8.1 et aux exigences d'ingénierie formelle de Volaco Core.

La règle d'or fondamentale de Volaco a été matérialisée dans le runtime :
Comprendre -> Planifier -> Montrer -> Faire confirmer -> Exécuter

**Garantie absolue pré-confirmation :**
Avant l'obtention d'une confirmation explicite de l'utilisateur sur un `EngineeringPlan` structuré :
- **0 mutation de code**
- **0 écriture de fichier sur le système de fichiers**
- **0 migration de schéma de base de données**
- **0 exécution d'agent autonome**
- **0 déploiement**

---

### B. ARCHITECTURE AVANT ET APRÈS LOT 05

#### Architecture Avant LOT 05 :
```text
USER
  ↓
STUDIO
  ↓
CONVERSATION ENGINE
  ↓
INTENT
  ↓
CONVERSATION COMPASS
  ↓
CANONICAL APPLICATION MODEL
  ↓
SERVER
  ↓
DURABLE STATE
```

#### Architecture Après LOT 05 :
```text
USER
  ↓
STUDIO
  ↓
CONVERSATION ENGINE
  ↓
INTENT CLASSIFIER
  ↓
PLAN GENERATOR (DAG & Steps)
  ↓
PLAN VALIDATOR (Cycles, ADR, Stale Model, Risks)
  ↓
DURABLE PLAN REPOSITORY (.volaco_data/plans.json)
  ↓
WAITING_CONFIRMATION (User Gateway)
  ↓ [Explicit Approval / Rejection / Revision]
CANONICAL APPLICATION MODEL & MUTATION RUNTIME
```

---

### C. LIVRABLES CLÉS RÉALISÉS

1. **Modèle de Plan Enrichi (`types.ts`) :**
   - Types `PlanStatus` étendus : `'DRAFT' | 'VALIDATING' | 'READY' | 'REQUIRES_CLARIFICATION' | 'REQUIRES_CONFIRMATION' | 'CONFIRMED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED' | 'EXECUTING' | 'EXECUTED' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK' | 'ASSESSED'`.
   - Interfaces `PlanDependency`, `PlanRisk`, `PlanAssumption`, `PlanValidation`, `PlanConfirmation`, `PlanProvenance`, `PlanStepOperation`, `PlanStepStatus`.
   - `EngineeringPlan` enrichi avec isolation multi-tenant (`tenantId`, `projectId`), versionnement (`planVersion`, `applicationModelVersion`), traçabilité (`supersedesPlanId`, `provenance`).

2. **Générateur de Plan Déterministe (`engine/plan-generator.ts`) :**
   - Génération structurée et ordonnée d'étapes (ANALYZE, CREATE/MODIFY, VERIFY) avec dépendances DAG directes (`dependencies: string[]`).
   - Synthèse et liaison des hypothèses (`assumptions`) et décisions architecturales (`decisions`).
   - Fonction `revisePlan` : incrémente la version de plan (v_{n+1}), marque la version précédente `SUPERSEDED`, et injecte les instructions correctives de l'utilisateur.

3. **Validateur de Plan et Détection de Cycles (`engine/plan-validator.ts`) :**
   - Détection formelle des cycles DAG (cycles directs A -> B -> A et cycles transitifs à 3+ nœuds A -> B -> C -> A) via algorithme DFS à 3 états (`UNVISITED`, `VISITING`, `VISITED`).
   - Détection des dépendances orphelines et auto-dépendances.
   - Protection Stale Plan : vérification de l'adéquation avec la version actuelle du modèle applicatif (`currentModelVersion > planModelVersion` -> `isStale: true, valid: false`).
   - Vérification de la cohérence avec les ADRs enregistrées (ex: rejet d'une étape MySQL si PostgreSQL est confirmé).
   - Calcul rigoureux des niveaux de risque (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).

4. **Persistance Durable Hermétique (`repository.ts`) :**
   - Classe `DurablePlanRepository` partitionnée hermétiquement par `${tenantId}:${projectId}`.
   - Intégration transparente avec `DurableFileStorage` (`.volaco_data/plans.json`).
   - Survie garantie aux redémarrages serveur sans perte ni corruption de données.

5. **Couche Service et Contrôle de Concurrence (`service.ts`) :**
   - Méthodes `generatePlanForConversation`, `getPlan`, `listPlans`, `validatePlan`, `rejectPlan`, `revisePlan`.
   - Durcissement de `confirmPlan` : verrouillage optimiste de version (`expectedPlanVersion`), protection anti-stale model, idempotence stricte (double confirmation sans effet de bord), enregistrement d'audit immuable (`auditStore`).
   - Compatibilité rétroactive LOT 04 : support du statut `APPROVED` pour les appels d'API hérités.

6. **Routes API Dédiées (`apps/api/src/routes/conversations.ts`) :**
   - `POST /api/v1/projects/:projectId/conversations/:conversationId/plans` (201 Created)
   - `GET  /api/v1/projects/:projectId/conversations/:conversationId/plans` (200 OK)
   - `GET  /api/v1/projects/:projectId/conversations/:conversationId/plans/:planId` (200 OK)
   - `POST /api/v1/projects/:projectId/conversations/:conversationId/plans/:planId/validate` (200 OK)
   - `POST /api/v1/projects/:projectId/conversations/:conversationId/plans/:planId/confirm` (200 OK)
   - `POST /api/v1/projects/:projectId/conversations/:conversationId/plans/:planId/reject` (200 OK)
   - `POST /api/v1/projects/:projectId/conversations/:conversationId/plans/:planId/revise` (201 Created)
   - Contrôle d'accès RBAC : interdiction aux rôles `VIEWER` (403 Forbidden).

---

### D. RÉSULTATS DES TESTS ET GATES DE NON-RÉGRESSION

| Suite de Tests / Gate | Total Tests | Succès | Échecs | Statut |
| :--- | :---: | :---: | :---: | :---: |
| **LOT 05 Dedicated Tests** (`lot05-plan-first.test.ts`) | 56 | 56 | 0 | **100% PASS** |
| **Quality Gate 1** (`run_gate1_tests.mjs`) | 31 | 31 | 0 | **100% PASS** |
| **LOT 03 Dedicated Tests** (`lot03-studio-application-model.test.ts`) | 33 | 33 | 0 | **100% PASS** |
| **LOT 04 Dedicated Tests** (`lot04-conversation-intelligence.test.ts`) | 46 | 46 | 0 | **100% PASS** |
| **Quality Gate 2** (`run_gate2_tests.mjs`) | 1836 | 1836 | 0 | **100% PASS** |
| **TypeScript Compilation Stricte** (`tsc`) | - | 0 erreurs | 0 | **100% PASS** |
| **Studio Bit-for-Bit Parity** (984,946 octets) | - | Identique | 0 | **100% PASS** |

---

### E. VERDICT FINAL LOT 05

```text
==================================================
LOT 05 VERDICT
==================================================
PLAN FIRST RUNTIME:            PASS
PLAN MODEL & ENRICHMENT:       PASS
PLAN GENERATOR (DAG):          PASS
PLAN VALIDATOR (CYCLE/STALE):  PASS
DURABLE PERSISTENCE:           PASS
API ROUTES (7 ENDPOINTS):      PASS
USER CONFIRMATION / REJECT:    PASS
PLAN REVISION (v1 -> v2):      PASS
STALE MODEL PROTECTION:        PASS
PRE-CONFIRMATION ZERO-MUTATION:PASS
MULTI-TENANT ISOLATION:        PASS
RBAC ENFORCEMENT:              PASS
DEDICATED TESTS (56/56):       PASS
GATE 1 (31/31):                PASS
GATE 2 (1836/1836):            PASS
TYPESCRIPT STRICT:             PASS
STUDIO PARITY:                 PASS

FINAL STATUS:
READY FOR LOT 06
==================================================
```
