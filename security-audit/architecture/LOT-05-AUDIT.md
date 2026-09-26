# LOT 05 — AUDIT D'ARCHITECTURE : PLAN FIRST ENGINE & USER CONFIRMATION RUNTIME

> **Statut de l'Audit :** PHASE 1 — AUDIT UNIQUEMENT (AUCUNE MODIFICATION DE CODE)  
> **Référence CDC :** Spécification Unifiée CDC V7 / V8.1 — Module AINT-009 & LOT 05  
> **Date :** 2026-09-14T23:55:00+01:00  

---

## 1. CONTEXTE ET ÉTAT DES LIEUX DES ACQUIS

Les LOTs 01, 02, 03 et 04 sont formellement validés, pérennes et opérationnels :
* **LOT 01 — Durable Persistence :** VALIDÉ (WAL, reprise sur crash, `.volaco_data/`).
* **LOT 02 — Canonical Application Model :** VALIDÉ (`ApplicationModelStore`, versioning strict `metadata.modelVersion`, provenance, HTTP 409).
* **LOT 03 — Studio ↔ Canonical Application Model :** VALIDÉ (33/33 tests dédiés passants, parité binaire Studio 984 946 octets).
* **LOT 04 — Conversation Intelligence & Conversation Compass API :** VALIDÉ (46/46 tests dédiés passants, persistance durable des sessions, classification des intentions, détection des ambiguïtés, traçabilité des hypothèses et décisions ADR).
* **Quality Gates actuelles :**
  - Gate 1 : 31/31 PASS (`scripts/run_gate1_tests.mjs`)
  - Gate 2 : 1780/1780 PASS (`scripts/run_gate2_tests.mjs`)
  - P6 (Security Baseline) : 110/110 PASS
  - P7 (Penetration Testing) : 171/171 PASS
  - P8 (Multi-Tenant Isolation) : 37/37 PASS
  - Dedicated LOT 03 : 33/33 PASS
  - Dedicated LOT 04 : 46/46 PASS
  - TypeScript strict : 0 erreur (`node node_modules/typescript/bin/tsc --noEmit`)
  - Production build : PASS (`node node_modules/typescript/bin/tsc`)
  - Parité binaire Studio : PASS (exact 984 946 octets entre `apps/studio/index.html` et `volaco_studio.html`)

### 1.1. Le Principe Fondamental du LOT 05 : PLAN FIRST
Dans l'architecture Volaco, lorsqu'une demande utilisateur requiert une modification logicielle, **aucune mutation directe de code, aucune écriture fichier, aucune migration de base de données, aucune invocation d'agent d'exécution et aucun déploiement ne sont autorisés avant validation et confirmation formelle d'un plan structuré par l'utilisateur**.

Le flux opérationnel inviolable est :
```text
USER REQUEST
      ↓
UNDERSTANDING (Comprendre)
      ↓
INTENT (Qualifier)
      ↓
CONTEXT (Assumptions, Decisions, Application Model)
      ↓
PLAN GENERATION (Planifier)
      ↓
PLAN VALIDATION (Valider : DAG, Risque, Modèle)
      ↓
USER CONFIRMATION (Montrer & Faire confirmer)
      ↓
READY FOR EXECUTION (LOT 06+)
```

---

## 2. AUDIT DE L'ARCHITECTURE EXISTANTE

### 2.1. Codebase inspectée
* `packages/core/src/ai-native/conversation-intelligence/` :
  - `types.ts` : Définit `PlanStep`, `EngineeringPlan`, `PlanAssessment`, `PlanStatus`, `ConversationState`, `ConversationSession`, `ProjectMemory`, `TurnMemory`.
  - `engine/plan-generator.ts` : `PlanGenerator` basique synthétisant 3 étapes (`ANALYZE`, `ACTION`, `VERIFY`) et évaluant complétude/cohérence.
  - `engine/canonical.ts` : Calcul de hachage déterministe `computeEngineeringPlanHash` via SHA-256 et sérialisation canonique.
  - `engine/execution-bridge.ts` : `ExecutionBridge` vérifiant `canExecute` sur les états conversationnels.
  - `engine/conversation-compass.ts` : Table `VALID_CONVERSATION_TRANSITIONS` supportant `PLANNING`, `WAITING_CONFIRMATION`, `EXECUTING`.
  - `engine/clarification-engine.ts` : Classification des ambiguïtés (`BLOCKING`, `SAFE_TO_ASSUME`, `NEEDS_CONFIRMATION`).
  - `engine/assumption-engine.ts` : Génération et cycle de vie des hypothèses conversationnelles.
  - `engine/contradiction-detector.ts` : Détection de contradictions vis-à-vis des décisions architecturales passées.
  - `service.ts` : Façade `ConversationIntelligenceService` avec `confirmPlan` et `executeApprovedPlan`.
  - `repository.ts` : `DurableConversationRepository` écrivant dans `.volaco_data/conversations.json`.
* `packages/core/src/model/application-model/store.ts` :
  - `ApplicationModelStore` gérant `metadata.modelVersion`, `proposeChange`, `applyChange`, détection des conflits HTTP 409 (`ConflictError`).
* `apps/api/src/routes/conversations.ts` :
  - Routes existantes : `POST /conversations`, `GET /conversations`, `GET /conversations/:id`, `POST /conversations/:id/messages`, `GET /conversations/:id/context`, `POST /conversations/:id/decisions`, `POST /conversations/:id/confirm`.

### 2.2. Analyse des structures actuelles
1. **`PlanStep` (`types.ts` L137-145) :**
   ```ts
   export interface PlanStep {
     readonly stepIndex: number;
     readonly title: string;
     readonly description: string;
     readonly targetDomain?: string | undefined;
     readonly targetFiles?: readonly string[] | undefined;
     readonly operation: 'ANALYZE' | 'CREATE' | 'MODIFY' | 'DELETE' | 'VERIFY';
     readonly requiresApproval: boolean;
   }
   ```
   *Points forts :* Découpage clair par opération et ciblage de fichiers.  
   *Manques :* Absence d'identifiant stable (`id`), d'ordre explicite (`order`), d'expression des dépendances inter-étapes (`dependencies`), d'impact qualifié (`impact`), de niveau de risque dédié (`risk`), et de statut unitaire (`status`).

2. **`EngineeringPlan` (`types.ts` L147-155) :**
   ```ts
   export interface EngineeringPlan {
     readonly planId: string;
     readonly title: string;
     readonly summary: string;
     readonly steps: readonly PlanStep[];
     readonly estimatedImpact?: string | undefined;
     readonly planHash: string;
     readonly status: PlanStatus;
   }
   ```
   *Points forts :* Empreinte cryptographique immuable (`planHash`), gel d'objet en profondeur (`deepFreeze`).  
   *Manques :* Absence d'ancrage multi-tenant direct (`tenantId`, `projectId`, `conversationId`), absence de version de plan (`planVersion`), absence de version du modèle applicatif de référence (`applicationModelVersion`), absence de liste de risques (`risks`), d'hypothèses liées (`assumptions`), de dépendances globales (`dependencies`), de rapport de validation (`validation`), d'historique de révision (`supersedesPlanId`), et de métadonnées de confirmation (`confirmation`).

3. **`PlanStatus` (`types.ts` L72-79) :**
   `'DRAFT' | 'ASSESSED' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'ROLLED_BACK'`
   *Manques :* Absence des statuts formels exigés par le CDC V7/V8.1 LOT 05 : `'VALIDATING'`, `'READY'`, `'REQUIRES_CLARIFICATION'`, `'REQUIRES_CONFIRMATION'`, `'CONFIRMED'` (synonyme canonique d'`APPROVED`), `'SUPERSEDED'`.

4. **`PlanGenerator` (`engine/plan-generator.ts`) :**
   Génère de manière heuristique un plan à 3 étapes. N'intègre pas les décisions confirmées pour orienter les technologies, ne calcule pas de graphe de dépendances (DAG), ne prend pas en compte la version courante de l'`ApplicationModel`.

5. **`PlanValidator` :**
   **Totalement absent.** Seule une méthode simpliste `assessPlan` existe dans `PlanGenerator`, qui n'effectue aucun contrôle structurel (unicité des IDs, DAG sans cycle, dépendances non orphelines, cohérence avec les ADRs, compatibilité de version du modèle, barrière multi-tenant).

6. **Endpoints REST Plans (`apps/api/src/routes/conversations.ts`) :**
   Seul l'endpoint de confirmation `POST /conversations/:conversationId/confirm` existe.  
   Il manque les endpoints de gestion du cycle de vie des plans :
   - `POST /conversations/:conversationId/plans` (générer explicitement un plan)
   - `GET /conversations/:conversationId/plans` (lister les plans de la conversation)
   - `GET /conversations/:conversationId/plans/:planId` (détail d'un plan)
   - `POST /conversations/:conversationId/plans/:planId/validate` (valider un plan)
   - `POST /conversations/:conversationId/plans/:planId/confirm` (confirmer un plan versionné)
   - `POST /conversations/:conversationId/plans/:planId/reject` (rejeter un plan)
   - `POST /conversations/:conversationId/plans/:planId/revise` (réviser un plan -> création de la version v(N+1))

7. **Garantie d'Absence d'Exécution Prématurée :**
   Bien que l'`ExecutionBridge` ne déclenche pas d'exécution sans confirmation, aucun test unitaire formel ne certifie l'invariance absolue des fichiers, des commits VCS, des migrations et des révisions de modèle applicatif pendant la phase de planification.

8. **Protection contre les Plans Obsolètes (Stale Plan Protection) :**
   Si l'`ApplicationModel` passe de la version `v1` à `v2` (par exemple via une modification externe ou concurrente dans le Studio) pendant qu'un plan était en attente de confirmation sur `v1`, le système autoriserait actuellement une confirmation sans détecter que le plan est désormais obsolète (`stale`).

---

## 3. ANALYSE DÉTAILLÉE DES ÉCARTS (GAP ANALYSIS)

| Périmètre | État Actuel (LOT 04) | Requis LOT 05 (CDC V7/V8.1) | Écart / Action Requise |
| :--- | :--- | :--- | :--- |
| **Modèle du Plan** | `EngineeringPlan` minimal (planId, title, summary, steps, planHash, status). | Modèle complet avec `tenantId`, `projectId`, `conversationId`, `planVersion`, `applicationModelVersion`, `goal`, `dependencies`, `risks`, `assumptions`, `validation`, `confirmation`, `provenance`. | **À Enrichir** dans `types.ts` avec rétrocompatibilité totale. |
| **Statuts du Plan** | 7 statuts historiques (`DRAFT`, `ASSESSED`, `APPROVED`, etc.). | Statuts canoniques complets (`DRAFT`, `VALIDATING`, `READY`, `REQUIRES_CLARIFICATION`, `REQUIRES_CONFIRMATION`, `CONFIRMED`, `REJECTED`, `SUPERSEDED`, `EXECUTING`, `COMPLETED`, `FAILED`). | **À Consolider** dans `PlanStatus`. |
| **Étape du Plan** | `PlanStep` (stepIndex, title, description, operation). | `PlanStep` (id, order, title, description, type, dependencies, impact, risk, status). | **À Étendre** avec alias rétrocompatibles (`stepIndex` <-> `order`, `operation` <-> `type`). |
| **Graphe Dépendances** | Aucun (séquence linéaire implicite 1, 2, 3). | `PlanDependency` formel avec détection de cycles et vérification d'existence. | **À Créer** : validation DAG topologique dans `PlanValidator`. |
| **Générateur de Plan** | 3 étapes fixes, impact générique. | Dérivation contextuelle (Intent, Assumptions, Decisions, ApplicationModel, domaines, version du modèle). | **À Enrichir** dans `engine/plan-generator.ts`. |
| **Validateur de Plan** | Inexistant (juste un `assessPlan` heuristique). | `PlanValidator` dédié (structure, cohérence, non-circularité, ADRs, compatibilité modèle, sécurité). | **À Créer** dans `engine/plan-validator.ts`. |
| **Stale Plan Protection** | Aucune vérification de version de modèle lors de la confirmation. | Rejet immédiat ou passage en `STALE` si `applicationModelVersion` a changé entre la génération et la confirmation. | **À Implémenter** dans `service.ts` et `PlanValidator`. |
| **Révision de Plan** | Aucune API de modification (`revisePlan`). | Modification utilisateur -> génération `v2` référençant `v1` (`supersedesPlanId`), invalidation de `v1`. | **À Implémenter** dans `service.ts` et endpoints d'API. |
| **Idempotence & Concurrence** | Confirmation simple sans verrouillage de version. | Confirmation idempotente liée à la version exacte `(planId, planVersion)`, rejet des confirmations concurrentes obsolètes. | **À Implémenter** dans `service.ts`. |
| **Persistance des Plans** | Seul `activePlan` est sérialisé dans `ConversationSession`. | Persistance dédiée et historique des plans (`plans.json` ou multi-plans indexés par conversation). | **À Intégrer** dans le repository durable. |
| **API REST Dédiée** | Seul `POST .../confirm`. | 7 endpoints REST canoniques sous `/plans*`. | **À Ajouter** dans `apps/api/src/routes/conversations.ts`. |
| **Garantie Non-Exécution** | Non formellement vérifiée sous test. | Batterie de tests certifiant 0 écriture fichier, 0 commit, 0 mutation de modèle avant confirmation. | **À Couvrir** dans `apps/api/tests/lot05-plan-first.test.ts`. |
| **Studio UX Parity** | Parité 984 946 octets préservée. | Représentation visuelle non bloquante / parité stricte préservée. | **À Préserver** rigoureusement. |

---

## 4. ARCHITECTURE CIBLE DU LOT 05

```text
                               ┌───────────────────────────┐
                               │       USER REQUEST        │
                               └─────────────┬─────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │  CONVERSATION INTELLIGENCE│
                               │   (Intent & Assumptions)  │
                               └─────────────┬─────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │   CONVERSATION COMPASS    │
                               │    (State: PLANNING)      │
                               └─────────────┬─────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │      PLAN GENERATOR       │
                               │  - Application Model vN   │
                               │  - Intent + ADRs          │
                               │  - Steps + Dependencies   │
                               │  - Risks + Assumptions    │
                               └─────────────┬─────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │      PLAN VALIDATOR       │
                               │  - Structure & DAG check  │
                               │  - Cycle Detection        │
                               │  - Decision Consistency   │
                               │  - Stale Model Check      │
                               │  - Security Isolation     │
                               └─────────────┬─────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │                                           │
         [Issues / Blocking Clarification]               [Plan Valid & Ready]
                       │                                           │
                       ▼                                           ▼
         ┌───────────────────────────┐               ┌───────────────────────────┐
         │         CLARIFYING        │               │   WAITING_CONFIRMATION    │
         │ (Ask questions, no plan)  │               │ (Present Plan vN to user) │
         └───────────────────────────┘               └─────────────┬─────────────┘
                                                                   │
                                        ┌──────────────────────────┼──────────────────────────┐
                                        │                          │                          │
                                        ▼                          ▼                          ▼
                                 [USER MODIFIES]             [USER REJECTS]            [USER CONFIRMS]
                                        │                          │                          │
                                        ▼                          ▼                          ▼
                                ┌───────────────┐          ┌───────────────┐          ┌───────────────┐
                                │    PLAN v2    │          │ PLAN REJECTED │          │     PLAN      │
                                │  (SUPERSEDED) │          │  (Historical) │          │   CONFIRMED   │
                                └───────────────┘          └───────────────┘          └───────┬───────┘
                                                                                              │
                                                                                              ▼
                                                                                   ┌────────────────────┐
                                                                                   │READY FOR EXECUTION │
                                                                                   │     (LOT 06+)      │
                                                                                   └────────────────────┘
```

---

## 5. INVENTAIRE DES FICHIERS

### 5.1. Fichiers à Préserver Strictement (Non-Régression)
* `packages/core/src/repository/index.ts` (DurableFileStorage)
* `packages/core/src/model/application-model/store.ts` (ApplicationModelStore)
* `packages/core/src/identity/project.ts` (ProjectStore & Multi-tenant)
* `packages/core/src/identity/permissions.ts` (RBAC & assertPermission)
* `apps/studio/index.html` et `volaco_studio.html` (Parité stricte 984 946 octets)
* Suites de tests existantes : `lot01-*.test.ts`, `lot02-*.test.ts`, `lot03-*.test.ts`, `lot04-*.test.ts`, tests de sécurité P6, P7, P8.

### 5.2. Fichiers à Créer
1. `packages/core/src/ai-native/conversation-intelligence/engine/plan-validator.ts` :
   - Moteur de validation structurelle, détection de cycles DAG, cohérence des hypothèses et décisions, vérification multi-tenant et stale detection.
2. `packages/core/src/ai-native/conversation-intelligence/plan-repository.ts` (ou extension directe dans `repository.ts`) :
   - Persistance dédiée et requêtable des plans versionnés sous `.volaco_data/plans.json` avec isolation multi-tenant.
3. `apps/api/tests/lot05-plan-first.test.ts` :
   - Suite de test dédiée de plus de 50 tests automatisés couvrant tous les cas limites de planification, validation, révision, rejet, idempotence, concurrence et non-exécution prématurée.
4. `security-audit/architecture/LOT-05-IMPLEMENTATION.md` :
   - Rapport de mise en œuvre final de la Phase 2 avec le verdict normé CDC.

### 5.3. Fichiers à Modifier (Évolution Maîtrisée)
1. `packages/core/src/ai-native/conversation-intelligence/types.ts` :
   - Extension de `PlanStatus`, `PlanStep`, `EngineeringPlan`, `PlanDependency`, `PlanRisk`, `PlanAssumption`, `PlanValidation`, `PlanConfirmation`, `PlanProvenance`.
2. `packages/core/src/ai-native/conversation-intelligence/engine/canonical.ts` :
   - Fonctions canoniques pour le hachage de plan enrichi, comparaison de dépendances et sérialisation stable.
3. `packages/core/src/ai-native/conversation-intelligence/engine/plan-generator.ts` :
   - Génération enrichie de plans multi-étapes, assignation de dépendances, dérivation de risques, intégration de la version du modèle applicatif et des décisions ADR.
4. `packages/core/src/ai-native/conversation-intelligence/service.ts` :
   - Ajout des méthodes : `generatePlanForConversation`, `getPlan`, `listPlans`, `validatePlan`, `confirmPlan` (enrichi avec versioning strict et stale detection), `rejectPlan`, `revisePlan`.
5. `packages/core/src/ai-native/conversation-intelligence/index.ts` :
   - Exportation des nouveaux contrats, types et du `PlanValidator`.
6. `apps/api/src/routes/conversations.ts` :
   - Exposition des 7 endpoints REST dédiés aux plans sous `/api/v1/projects/:projectId/conversations/:conversationId/plans*`.

---

## 6. STRATÉGIE D'IMPLÉMENTATION (PHASE 2)

L'implémentation sera exécutée selon un ordonnancement strict en 6 étapes :

### Étape 1 : Consolidation des Contrats & Types (`types.ts`, `canonical.ts`)
- Définir `PlanDependency` :
  ```ts
  export interface PlanDependency {
    readonly stepId: string;
    readonly dependsOnStepId: string;
    readonly type?: 'BLOCKING' | 'NON_BLOCKING' | undefined;
  }
  ```
- Enrichir `PlanStep` avec compatibilité ascendante :
  - `id: string`, `order: number`, `title: string`, `description: string`, `type: PlanStepOperation`, `dependencies: readonly string[]`, `impact: string`, `risk: RiskLevel`, `status: PlanStepStatus`.
  - Maintien des alias `stepIndex` (-> `order`) et `operation` (-> `type`).
- Enrichir `EngineeringPlan` :
  - `planId: string`, `tenantId: string`, `projectId: string`, `conversationId: string`, `planVersion: number`, `applicationModelVersion: number`, `title: string`, `summary: string`, `goal: string`, `steps: readonly PlanStep[]`, `dependencies: readonly PlanDependency[]`, `risks: readonly PlanRisk[]`, `assumptions: readonly PlanAssumption[]`, `validation: PlanValidation`, `confirmation?: PlanConfirmation | undefined`, `supersedesPlanId?: string | undefined`, `planHash: string`, `status: PlanStatus`, `createdAt: string`, `updatedAt: string`.
- Mettre à jour `computeEngineeringPlanHash` pour couvrir déterministement l'ensemble des champs signifiants (hors timestamps).

### Étape 2 : Moteur de Validation & Détection de Cycles (`PlanValidator`)
- Créer `packages/core/src/ai-native/conversation-intelligence/engine/plan-validator.ts`.
- Implémenter l'algorithme de détection de cycles DAG (Kahn's algorithm ou DFS avec marquage de visite White-Gray-Black).
- Vérifications obligatoires :
  1. *Structure :* Aucun ID d'étape en double, tous les IDs référencés dans `dependencies` existent réellement, aucune dépendance réflexive (`stepId !== dependsOnStepId`).
  2. *Cohérence :* Aucune étape contradictoire (ex: suppression puis modification de la même entité sans ordre logique), conformité avec les ADRs confirmés (rejet de technologies incompatibles).
  3. *Modèle Applicatif :* Présence de `applicationModelVersion`. Si `currentModelVersion > plan.applicationModelVersion`, marquer le plan comme `isStale = true` et `valid = false`.
  4. *Isolement Sécurité :* Vérification stricte que `tenantId` et `projectId` du plan correspondent à la session courante.
  5. *Calcul de Risque Global :* 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL' selon la nature des opérations (DELETE ou migration = HIGH/CRITICAL).

### Étape 3 : Moteur de Génération de Plan Enrichi (`PlanGenerator`)
- Prendre en compte le contexte applicatif réel (`ApplicationSemanticModel`, domaines, routes, composants existants).
- Lier les étapes en graphe cohérent (ex: Étape 1 ANALYZE -> Étape 2 CREATE Schema -> Étape 3 CREATE API -> Étape 4 CREATE UI -> Étape 5 VERIFY).
- Générer automatiquement les dépendances inter-étapes ordonnées.
- Attacher les hypothèses et décisions ADR actives.
- Calculer le hash déterministe et le gel d'objet immuable (`deepFreeze`).

### Étape 4 : Gestion de la Persistance Durable des Plans
- Stocker les plans durables dans `.volaco_data/plans.json` avec partitionnement multi-tenant `${tenantId}:${projectId}`.
- Permettre la recherche d'un plan par son `planId`, par `conversationId`, ou la liste des plans actifs d'un projet.
- Gérer l'archivage historique des plans rejetés ou obsolètes (`SUPERSEDED`).

### Étape 5 : Logique Métier de Confirmation & Protection Stale (`service.ts`)
- **`confirmPlan` durci :**
  - Exiger `planId` et optionnellement `expectedPlanVersion`.
  - Vérifier la version courante du modèle applicatif (`applicationModelStore.getModel(tenantId, projectId).metadata.modelVersion`).
  - Si `currentModelVersion !== plan.applicationModelVersion` : refuser la confirmation avec erreur `409 Conflict` ou `ValidationError("Plan obsolète (stale)")`.
  - Idempotence garantie : Si le plan est déjà `CONFIRMED` avec la même version, renvoyer un succès sans effet secondaire néfaste.
  - Transition formelle du Compass : passage à l'état `WAITING_CONFIRMATION` puis `PLAN_CONFIRMED` / préparé pour exécution.
- **`revisePlan` :**
  - Marque le plan actuel en `SUPERSEDED`.
  - Génère une nouvelle version `planVersion = v(N+1)` pointant vers `supersedesPlanId`.
  - Enregistre le nouveau plan comme `activePlan` dans la session.
- **`rejectPlan` :**
  - Marque le plan en `REJECTED`.
  - Transitionne l'état du Compass vers `PLANNING` ou `EXPLORING`.
  - Conserve le plan en mémoire de projet (`projectMemory.rejectedPlans`).

### Étape 6 : API Tier (`apps/api/src/routes/conversations.ts`)
- Monter les 7 routes REST standardisées :
  1. `POST .../conversations/:conversationId/plans` : Déclencher la génération d'un plan.
  2. `GET .../conversations/:conversationId/plans` : Lister les plans de la conversation.
  3. `GET .../conversations/:conversationId/plans/:planId` : Récupérer les détails d'un plan.
  4. `POST .../conversations/:conversationId/plans/:planId/validate` : Exécuter une re-validation explicite.
  5. `POST .../conversations/:conversationId/plans/:planId/confirm` : Confirmer formellement le plan.
  6. `POST .../conversations/:conversationId/plans/:planId/reject` : Rejeter le plan.
  7. `POST .../conversations/:conversationId/plans/:planId/revise` : Réviser le plan avec nouvelles directives.
- Respect strict de l'isolation multi-tenant : vérification `assertPermission` et concordance `context.tenantId`.

### Étape 7 : Vérification de Non-Régression & Parité Studio
- Vérifier que `apps/studio/index.html` et `volaco_studio.html` conservent leur parité stricte d'octets.
- Exécuter la suite complète de tests de sécurité et Quality Gates.

---

## 7. PLAN DE TEST DÉTAILLÉ (~50 TESTS DÉDIÉS)

La suite de tests dédiée sera créée dans `apps/api/tests/lot05-plan-first.test.ts`.  
Elle est structurée en 12 axes majeurs :

### Axe 1 : Création & Persistance des Plans (Tests 1 à 5)
* `Test 01` : Génération d'un plan structuré à partir d'une intention de modification.
* `Test 02` : Persistance durable du plan dans `.volaco_data/` et survie au redémarrage.
* `Test 03` : Récupération d'un plan par son `planId` via l'API REST.
* `Test 04` : Association bidirectionnelle stricte entre le plan et la session de conversation.
* `Test 05` : Enregistrement immuable de l'`applicationModelVersion` au sein du plan lors de sa création.

### Axe 2 : Structure du Plan & Graphe de Dépendances (DAG) (Tests 6 à 11)
* `Test 06` : Validation d'un plan linéaire valide (Analyze -> Create -> Verify).
* `Test 07` : Validation d'un plan avec étapes en arbre/parallèles valides.
* `Test 08` : Rejet immédiat d'un plan contenant des identifiants d'étapes dupliqués.
* `Test 09` : Rejet d'un plan référençant une dépendance inexistante (dépendance orpheline).
* `Test 10` : Rejet formel d'un plan comportant une dépendance circulaire directe (A -> B -> A).
* `Test 11` : Rejet d'une dépendance circulaire indirecte multi-niveaux (A -> B -> C -> A).

### Axe 3 : Intégration des Intentions (Tests 12 à 16)
* `Test 12` : Intention `CREATE` (nouvelle page/entité) -> Plan structuré généré en état `READY`.
* `Test 13` : Intention `MODIFY` (refactoring/mise à jour) -> Plan ciblant les fichiers d'impact.
* `Test 14` : Intention `DELETE` (action destructive) -> Plan tagué `HIGH/CRITICAL` risk avec étape d'approbation.
* `Test 15` : Intention `FIX` / `DEBUG` -> Plan généré avec étape de diagnostic et de non-régression.
* `Test 16` : Intention `QUESTION` / `EXPLORATION` -> Aucun plan superflu généré, réponse conversationnelle directe.

### Axe 4 : Clarification vs Confirmation (Tests 17 à 21)
* `Test 17` : Demande ambiguë (manque d'entité clé) -> Déclenchement de `CLARIFYING` sans génération de plan exécutable.
* `Test 18` : Réponse utilisateur résolvant l'ambiguïté -> Transition vers `PLANNING` et émission du plan.
* `Test 19` : Demande claire sans ambiguïté -> Transition directe vers `WAITING_CONFIRMATION` avec plan prêt.
* `Test 20` : Présence d'une ambiguïté bloquante -> `requiresClarification = true`, `requiresConfirmation = false`.
* `Test 21` : Plan complet prêt -> `requiresClarification = false`, `requiresConfirmation = true`.

### Axe 5 : Intégration des Hypothèses (Assumptions) (Tests 22 à 26)
* `Test 22` : Les hypothèses actives générées au tour conversationnel sont attachées au plan.
* `Test 23` : Une hypothèse critique non confirmée force `requiresClarification = true`.
* `Test 24` : Une hypothèse confirmée est marquée comme telle dans la provenance du plan.
* `Test 25` : Le rejet d'une hypothèse par l'utilisateur entraîne la révision du plan.
* `Test 26` : Traçabilité des hypothèses par rapport à la version du modèle canonique.

### Axe 6 : Intégration des Décisions Architecturales (ADRs) (Tests 27 à 30)
* `Test 27` : Un plan généré respecte obligatoirement les technologies confirmées par ADR (ex: PostgreSQL).
* `Test 28` : Détection de contradiction : tentative de plan proposant une technologie incompatible rejetée par le validateur.
* `Test 29` : Les ADRs existants sont consignés dans la provenance (`provenance.decisions`) du plan.
* `Test 30` : Résolution d'un conflit de décision menant à la mise à jour des hypothèses du plan.

### Axe 7 : Validation du Plan & Niveaux de Risque (Tests 31 à 35)
* `Test 31` : Calcul du niveau de risque `LOW` pour une modification cosmétique UI simple.
* `Test 32` : Calcul du niveau de risque `MEDIUM` pour l'ajout d'une nouvelle page avec API.
* `Test 33` : Calcul du niveau de risque `HIGH` pour une modification de schéma de base de données.
* `Test 34` : Calcul du niveau de risque `CRITICAL` pour une suppression massive ou modification sécuritaire sensible.
* `Test 35` : Rapport de validation structuré complet (`valid`, `errors`, `warnings`, `riskLevel`).

### Axe 8 : Runtime de Confirmation & Idempotence (Tests 36 à 41)
* `Test 36` : Confirmation réussie d'un plan valide par le propriétaire du projet -> État `CONFIRMED`.
* `Test 37` : Rejet explicite d'un plan par l'utilisateur -> État `REJECTED`, archivage dans `rejectedPlans`.
* `Test 38` : Idempotence de la confirmation : soumettre deux fois la même confirmation ne lève aucune erreur et reste stable.
* `Test 39` : Tentative de confirmation d'un plan déjà rejeté -> Rejet avec erreur `ValidationError`.
* `Test 40` : Tentative d'exécution d'un plan non confirmé -> Interdiction stricte avec erreur de validation.
* `Test 41` : Audit trail : Chaque confirmation et rejet consigne un événement immuable dans l'`AuditStore`.

### Axe 9 : Versioning du Plan & Révision (Tests 42 à 45)
* `Test 42` : Demande de modification d'un plan existant (ex: « Ajoute aussi une page d'inscription ») -> Création de la version `v2`.
* `Test 43` : Le plan `v1` passe automatiquement au statut `SUPERSEDED` lors de l'émission de `v2`.
* `Test 44` : Tentative de confirmation de la version `v1` après création de `v2` -> Rejet (version obsolète).
* `Test 45` : Conservation de l'historique complet de provenance entre `v1` et `v2` (`supersedesPlanId`).

### Axe 10 : Protection contre les Plans Obsolètes (Stale Plan Protection) (Tests 46 à 49)
* `Test 46` : Plan créé sur `ApplicationModel v1` ; modification concourante du modèle vers `v2` avant confirmation.
* `Test 47` : Tentative de confirmation du plan basé sur `v1` -> Rejet HTTP 409 / ValidationError (Plan Stale).
* `Test 48` : Ré-évaluation / Ré-génération du plan aligné sur `v2` -> Nouveau plan valide accepté.
* `Test 49` : Le validateur de plan signale explicitement l'obsolescence dans son rapport de validation.

### Axe 11 : Garantie Absolue de Non-Exécution Pré-Confirmation (Tests 50 à 52)
* `Test 50` : Aucune écriture de fichier sur le disque lors de la génération, révision ou rejet de plan.
* `Test 51` : Aucun appel à l'Agent Runtime ni exécution d'orchestration avant confirmation formelle.
* `Test 52` : Aucune mutation du `CanonicalApplicationModel` (`modelVersion` strictement inchangé) avant confirmation.

### Axe 12 : Sécurité Multi-Tenant & RBAC (Tests 53 à 56)
* `Test 53` : Tentative de consultation d'un plan du Tenant A par le Tenant B -> Réponse `404 Not Found`.
* `Test 54` : Tentative de confirmation d'un plan du Projet A depuis le Projet B -> Réponse `404 Not Found`.
* `Test 55` : Rôle `VIEWER` tentant de confirmer ou rejeter un plan -> Rejet `403 Forbidden` (`PROJECT_MUTATE` requis).
* `Test 56` : Résistance aux charges utiles JSON malveillantes (`null`, types invalides, injections).

---

## 8. CRITÈRES DE SORTIE DE LA PHASE 1

Pour clôturer la Phase 1 et autoriser l'entrée en Phase 2 (Implémentation) :
- [x] L'architecture conversationnelle et les structures de plan existantes ont été intégralement inspectées sur le code réel.
- [x] Les écarts par rapport au CDC V7/V8.1 ont été catalogués de manière exhaustive.
- [x] Le rapport d'audit architectural `security-audit/architecture/LOT-05-AUDIT.md` est rédigé et archivé.
- [x] L'`implementation_plan.md` est formalisé dans les artefacts avec `request_feedback: true`.
- [x] **Aucune ligne de code source d'implémentation n'a été modifiée pendant la Phase 1.**
- [ ] Approbation formelle de l'utilisateur reçue pour démarrer la Phase 2.
