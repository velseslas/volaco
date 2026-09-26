# LOT 06 — AGENT RUNTIME & AI ORCHESTRATOR CORE
## RAPPORT D'AUDIT ARCHITECTURAL PRÉ-IMPLÉMENTATION (PHASE 1)

---

### 1. RÉSUMÉ EXÉCUTIF ET CONTEXTE

Conformément à la règle absolue du CDC V7/V8.1 :
> **PHASE 1 — AUDIT UNIQUEMENT :**
> Avant toute modification de code : inspecter l'architecture existante, identifier le code réel déjà présent, identifier les agents, les providers IA, l'AI Gateway, l'Agent Runtime, l'Orchestrator, les tools/actions, les contrats TypeScript, les routes API, les stores/repositories, les mécanismes de persistance, de sécurité, de quota, et les tests existants. **Ne rien modifier pendant cette phase.**

Le **LOT 06** a pour objectif de construire le **premier véritable moteur d'exécution des agents IA de Volaco**.
Il transforme l'architecture statique/déterministe actuelle :
```text
USER → STUDIO → CONVERSATION INTELLIGENCE → PLAN → APPLICATION MODEL
```
en un runtime d'exécution d'ingénierie complet, sécurisé et traçable :
```text
USER
  ↓
CONVERSATION
  ↓
PLAN / PLAN TASK
  ↓
AI ORCHESTRATOR
  ↓
AGENT RUNTIME
  ↓
AGENT
  ↓
TOOL EXECUTION
  ↓
RESULT
  ↓
VALIDATION
  ↓
APPLICATION MODEL / PROJECT STATE
```

---

### 2. ÉTAT DES LIEUX DU CODE RÉEL EXISTANT DANS LE DÉPÔT

L'inspection méthodique du dépôt révèle que des briques logiques avancées ont été amorcées dans plusieurs modules distincts du tiers `packages/core/src/ai-native` et `packages/core/src/ai`. Cependant, ces briques sont aujourd'hui **hétérogènes, partiellement redondantes et non unifiées** dans un flux d'exécution séquentiel direct :

| Sous-système existant | Emplacement réel | Rôle actuel | Limites / Écarts constatés |
| :--- | :--- | :--- | :--- |
| **Agent Runtime** (AINT-007) | `packages/core/src/ai-native/agent-runtime/` | Runtime d'agent autonome avec `PlanExecutor`, `AgentRegistry`, `ToolRegistry`, `AgentStateMachine` | Axé sur des `AgentRun` libres, découplé du plan de conversation du LOT 05, provider mock par défaut, pas de persistance durable |
| **AI Orchestrator** (AINT-010) | `packages/core/src/ai-native/ai-orchestrator/` | Orchestration multi-agents (`UiAgent`, `BackendAgent`, etc.), décomposition de plan en DAG de tâches, `ValidationGate`, `ConflictDetector` | Exécute directement les agents spécialisés sans passer par un `AgentRuntime` standardisé d'exécution de tools, pas d'API REST exposée |
| **Mutation Orchestrator** (AINT-006) | `packages/core/src/ai-native/mutation-orchestrator/` | Moteur de transaction atomique sur fichiers (`FileStoreAdapter`), snapshots et rollback | Fonctionne isolément, non branché comme outil standard dans l'Agent Runtime |
| **AI Providers & Router** | `packages/core/src/ai/providers/` | Catalogue de providers (`gemini-adapter.ts`, `mistral-adapter.ts`, `registry.ts`, `reasoning-orchestrator.ts`) | Fonctionnel et durci contre le SSRF (SEC-009), mais utilisé uniquement par la conversation et les agents spécialisés sans session d'exécution unifiée |
| **AI Gateway & Proxy** | `apps/api/src/routes/ai.ts` | Proxy HTTP vers Mistral/Codestral avec assainissement prompt injection (SEC-010, P6-VULN-01/02) | Simple relais HTTP pour complétions sans notion d'agent, de tâche ni de tool call |
| **Comptabilité Quotas & Usage** | `packages/core/src/ai/usage.ts` | Enregistrement des tokens (input/output) et calcul des coûts USD via `aiUsageTracker` | Déjà branché sur l'AI Gateway, mais pas encore alimenté systématiquement par chaque exécution de tool/agent |

---

### 3. INVENTAIRE DU CODE RÉEL PAR COMPOSANT

#### 3.1. Agents Existants
Dans `packages/core/src/ai-native/agent-runtime/agent/` :
- **Classes & Fonctions :** `Agent` (`agent.ts:15`), `createAgentDefinition` (`agent.ts:38`), `AgentRegistry` (`registry.ts:10`).
- **Rôles déclarés :** `ARCHITECT_AGENT`, `CODE_AGENT`, `UI_AGENT`, `BACKEND_AGENT`, `DATABASE_AGENT`, `SECURITY_AGENT`, `TEST_AGENT`, `DEBUG_AGENT`, `REVIEW_AGENT`.
- **Mécanisme :** Définitions basées sur des capacités matricielles (`canReadFiles`, `canExecuteMutations`, etc.) et des opérations autorisées (`capabilities.ts`).

Dans `packages/core/src/ai-native/ai-orchestrator/agents/` :
- **Classes :** `BaseSpecializedAgent` (`base-agent.ts:18`), `UiAgent` (`ui-agent.ts:16`), `BackendAgent` (`backend-agent.ts:16`), `DataAgent` (`data-agent.ts:16`), `SecurityAgent` (`security-agent.ts:16`), `TestAgent` (`test-agent.ts:16`).
- **Mécanisme :** Agents autonomes appelant directement `AIProviderRegistry` pour générer des `AgentArtifact[]` typés (`PROPOSED_FILE_CHANGE`, `CODE_PATCH`, `SECURITY_FINDING`).

**Constat d'écart LOT 06 :**
La spécification du LOT 06 exige :
- **Un Agent Contract unique et standardisé :** `Agent` avec `id`, `version`, `canHandle(task)`, `execute(context): Promise<AgentResult>`.
- **Un Agent Registry unique centralisé.**
- **Les 2 agents minimum nécessaires et suffisants pour le LOT 06 :**
  1. `Analysis Agent` : diagnostic, lecture seule (Application Model, fichiers), zéro mutation.
  2. `Code Agent minimal` : modifications contrôlées via les permissions et le service de mutation (READ_FILE, CREATE_FILE, UPDATE_FILE, DELETE_FILE).

#### 3.2. Providers IA et AI Gateway
Dans `packages/core/src/ai/providers/` :
- `AIProviderAdapter` (`types.ts:83`) avec méthode `generate(request, credentials)`.
- `GeminiAdapter` (`gemini-adapter.ts:24`) avec protection SSRF et contrôle de clés.
- `MistralAdapter` (`mistral-adapter.ts:24`) avec repli intelligent Codestral.
- `AIProviderRegistry` (`registry.ts:13`) : enregistrement et résolution par capacité (`FAST`, `CODE_GENERATION`, `DEEP_REASONING`).
- `ReasoningOrchestrator` (`reasoning-orchestrator.ts:24`) : pont de raisonnement avec repli déterministe hors-ligne.

Dans `apps/api/src/routes/ai.ts` :
- Endpoint `POST /api/v1/ai/completions` avec limitation de concurrence par tenant (`MAX_CONCURRENT_AI_PER_TENANT = 5`), cap de tokens à 4096, et assainissement anti-prompt-injection `sanitizeAiMessages` (balisage XML `<user_input source="user_prompt">`, neutralisation de tags système).

**Constat d'écart LOT 06 :**
L'Agent Runtime ne doit **jamais** appeler les SDKs OpenAI/Gemini/Mistral en direct. Il doit impérativement réutiliser `AIProviderRegistry` / `AIProviderAdapter`.

#### 3.3. Agent Runtime Existant
Dans `packages/core/src/ai-native/agent-runtime/` :
- `AgentRuntimeService` (`service.ts:85`) : orchestre un run avec `AgentPlanner`, `PlanExecutor`, `VerificationEngine`, `RepairEngine`, `AuditEventLog`.
- `AgentStateMachine` (`agent/state-machine.ts:16`) : machine à 12 états (`RECEIVED` -> `UNDERSTANDING` -> `PLANNING` -> `CONTEXT_BUILDING` -> `EXECUTING` -> `WAITING_GATE` -> `MUTATING` -> `VERIFYING` -> `REPAIRING` -> `COMPLETED` / `FAILED` / `CANCELLED`).
- `PlanExecutor` (`execution/executor.ts:28`) : exécute séquentiellement les étapes via `ToolRegistry`.

**Constat d'écart LOT 06 :**
Le Runtime existant modélise un run complet de raisonnement (`AgentRun`) incluant la planification. Pour le LOT 06, le rôle du Runtime doit être recentré sur la **responsabilité d'exécution technique d'une tâche issue d'un plan approuvé** :
- Machine d'état simplifiée et explicite de l'exécution :
  `QUEUED -> STARTING -> RUNNING -> WAITING_TOOL -> VALIDATING -> COMPLETED`
  États d'arrêt : `FAILED`, `CANCELLED`, `TIMEOUT`, `BLOCKED`.
  État d'escalade : `WAITING_HUMAN_CONFIRMATION`.
- Identifiant standardisé `executionId` (`exec-${randomUUID()}`).
- Gestion formelle de l'idempotence, des timeouts par couche (exécution, outil, provider), de l'annulation propre (`cancelExecution`) et des retries bornés.

#### 3.4. AI Orchestrator Existant
Dans `packages/core/src/ai-native/ai-orchestrator/` :
- `AIOrchestratorService` (`service.ts:52`) : point d'entrée avec `orchestratePlan`, `getOrchestration`, `cancelOrchestration`.
- `TaskDecomposer` (`engine/task-decomposer.ts:23`) : convertit un `EngineeringPlan` en `EngineeringTaskGraph` avec détection d'acyclicité DFS.
- `ContextOrchestrator` (`engine/context-orchestrator.ts:25`) : sélectionne les fichiers pertinents, applique le masquage des secrets et exclut `.env` et `.pem`.
- `ConflictDetector` (`engine/conflict-detector.ts:22`) : détecte les collisions de fichiers entre agents.
- `ValidationGate` (`engine/validation-gate.ts:22`) : barrière de pré-mutation.
- `MutationBridge` (`engine/mutation-bridge.ts:24`) : pont vers `MutationOrchestratorService`.
- `RepairOrchestrator` (`engine/repair-orchestrator.ts:23`) : gestion des cycles de réparation (circuit breaker à 3 cycles).

**Constat d'écart LOT 06 :**
`AIOrchestratorService` court-circuite `AgentRuntime` en appelant directement `BaseSpecializedAgent.executeTask`. Dans la cible LOT 06 :
L'Orchestrateur doit décomposer les tâches d'un Plan validé (LOT 05), sélectionner l'agent approprié, puis **déléguer l'exécution technique unitaire au Agent Runtime**, qui pilote l'agent et les outils avec un cycle de vie contrôlé.

#### 3.5. Tools & Tool Registry
Dans `packages/core/src/ai-native/agent-runtime/tools/` :
- `ToolRegistry` (`registry.ts:32`) :
  - Supporte l'enregistrement avec schéma, permissions RBAC et timeout.
  - Vérifie les `allowedTools` de l'agent (`AgentCapabilityError`).
  - Vérifie les permissions RBAC (`assertPermission`).
  - Exécute avec `Promise.race` pour timeout.
- `TOOL_DEFINITIONS` (`definitions.ts:24`) :
  12 outils existants en MAJUSCULES : `READ_PROJECT`, `READ_FILE`, `SEARCH_CODE`, `ANALYZE_CODE`, `GET_APPLICATION_DNA`, `GET_SEMANTIC_GRAPH`, `ANALYZE_IMPACT`, `BUILD_MUTATION_PLAN`, `PREVIEW_MUTATION`, `EXECUTE_MUTATION`, `VALIDATE_RESULT`, `RUN_TESTS`.

**Constat d'écart LOT 06 :**
La spécification du LOT 06 prescrit une liste canonique de tools normalisés en snake_case :
- `read_file`
- `write_file`
- `create_file`
- `delete_file`
- `list_files`
- `read_application_model`
- `read_project_state`
Ces tools doivent être dotés de gestionnaires effectifs reliés aux stores sous-jacents (`FileStore`, `ApplicationModelStore`, `ProjectStore`) via les contrôles d'autorisation stricts.

#### 3.6. Mutation Safety & Single Writer
Dans `packages/core/src/ai-native/mutation-orchestrator/` :
- `MutationOrchestratorService` (`service.ts:43`) :
  - Reçoit des mutations atomiques (`CREATE`, `UPDATE`, `DELETE`).
  - Crée un snapshot réversible de transaction (`createTransactionSnapshot`).
  - Applique sur `FileStore` via `FileStoreAdapter`.
  - Permet le rollback transactionnel (`rollbackTransaction`).

**Règle d'or LOT 06 :**
Un agent ne modifie **jamais** directement le système de fichiers ou la base de données.
Les outils de mutation (`create_file`, `write_file`, `delete_file`) doivent impérativement passer par le `Mutation Service`, générer un `ChangeSet` traçable, valider les contraintes sur le `Canonical Application Model` et produire une `Revision` durable.

#### 3.7. Persistance Durable des Exécutions
- LOT 01 a créé `DurableFileStorage` (`packages/core/src/repository/file-storage.ts`).
- LOT 02/03 ont créé `DurableApplicationModelRepository`.
- LOT 04/05 ont créé `DurableConversationRepository` et `DurablePlanRepository` écrivant dans `.volaco_data/`.
- **Actuellement dans `agent-runtime` et `ai-orchestrator` :**
  Les exécutions sont conservées en mémoire vive (`Map<string, ActiveRunSession>`, `AIOrchestratorLruCache`). Aucun repository durable n'est branché pour persister les `Execution` d'agents, leurs statuts, leurs logs et leur provenance après un redémarrage serveur.

**Requis LOT 06 :**
Créer un `DurableExecutionRepository` partitionné par `${tenantId}:${projectId}` écrivant dans `.volaco_data/executions.json` pour garantir que les exécutions survivent aux redémarrages.

#### 3.8. Routes API
- Actuellement, `apps/api/src/routes/` ne contient **aucune route** pour déclencher, suivre ou annuler des exécutions d'agents ou orchestrations.
- Les endpoints du LOT 06 devront être montés sous :
  `/api/v1/projects/:projectId/executions*` et/ou `/api/v1/projects/:projectId/orchestrator*`.

#### 3.9. Sécurité, Quotas et Traçabilité
- **Sécurité :** RBAC strict (`assertPermission`), isolation multi-tenant hermétique, protection path traversal (`sanitizePath`), interdiction aux rôles `VIEWER` d'exécuter des mutations.
- **SSRF :** Déjà couvert dans `packages/core/src/ai/providers/types.ts` (SEC-009).
- **Prompt Injection :** Déjà neutralisé dans `apps/api/src/routes/ai.ts` (SEC-010).
- **Accounting :** `aiUsageTracker` (`packages/core/src/ai/usage.ts`) et `auditStore` (`packages/core/src/observability/audit.ts`) prêts à être alimentés.

---

### 4. ANALYSE DES ÉCARTS (GAP ANALYSIS)

| Exigence Spécifique LOT 06 | État Actuel | Action Requise Phase 2 |
| :--- | :--- | :--- |
| **Flux unifié Orchestrator -> Runtime -> Agent -> Tools** | Découplé : Orchestrateur et Runtime s'ignorent mutuellement | Aligner `AIOrchestrator` pour décomposer le plan et confier l'exécution de chaque tâche à l'`AgentRuntime` |
| **Machine d'état d'Exécution standardisée** | 12 états orientés "run" (`RECEIVED`, `MUTATING`, etc.) | Définir la machine d'état cible : `QUEUED`, `STARTING`, `RUNNING`, `WAITING_TOOL`, `VALIDATING`, `COMPLETED`, avec `FAILED`, `CANCELLED`, `TIMEOUT`, `BLOCKED` et `WAITING_HUMAN_CONFIRMATION` |
| **Identifiant d'Exécution unique** | `runId` hétérogène | Adopter le format canonique `executionId` (`exec-${randomUUID().slice(0,12)}`) |
| **Contrat d'Agent & Registre Unique** | 2 registres concurrents (`AgentRegistry` et map dans `AIOrchestrator`) | Consolider un `AgentRegistry` centralisé et un contrat `Agent` formel |
| **Agents Minimaux requis** | 5 agents de domaine dans `ai-orchestrator` | Formaliser : 1) `AnalysisAgent` (read-only), 2) `CodeAgent` (mutations contrôlées) |
| **Tools Canoniques (snake_case)** | 12 outils en MAJUSCULES (`READ_FILE`, etc.) | Enregistrer les 7 outils canoniques : `read_file`, `write_file`, `create_file`, `delete_file`, `list_files`, `read_application_model`, `read_project_state` |
| **Mode Dry-Run** | Partiellement présent dans `MutationBridge` | Supporter un mode `DRY_RUN` complet au niveau du Runtime (génération ChangeSet et validation sans écriture disque) |
| **Persistance Durable des Exécutions** | Uniquement en mémoire (`Map`) | Créer `DurableExecutionRepository` avec partition `${tenantId}:${projectId}` |
| **Gestion des Timeouts, Retries, Cancellation** | Partielle, dispersée | Contrôler les timeouts par couche, borner les retries sur erreurs temporaires, permettre la cancellation propre |
| **Idempotence & Concurrence Optimiste** | Immutabilité par deepFreeze | Verrouillage par `executionId` et rejet des conflits de modèle stale (`expectedModelVersion`) |
| **Routes API d'Exécution** | Inexistantes | Exposer `POST .../executions`, `GET .../executions/:id`, `POST .../executions/:id/cancel`, etc. |
| **Tests Dédiés LOT 06** | Tests isolés unitaires AINT-007 / AINT-010 | Créer `apps/api/tests/lot06-agent-runtime.test.ts` couvrant l'ensemble des 35 exigences |

---

### 5. DÉCISIONS ARCHITECTURALES ET RECOMMANDATIONS POUR LA PHASE 2

1. **Pas de réécriture disruptive : Consolidation et Unification**
   Ne pas jeter le travail existant dans `agent-runtime` et `ai-orchestrator`. Réutiliser les modules robustes existants (`TaskDecomposer`, `ContextOrchestrator`, `ConflictDetector`, `ValidationGate`, `ToolRegistry`, `aiProviderRegistry`, `aiUsageTracker`) en les agençant dans la chaîne d'exécution prescrite.
2. **Clarté des Responsabilités :**
   - **`AI Orchestrator` :** Réceptionne la tâche du Plan, sélectionne l'agent, assemble le contexte minimal nécessaire, vérifie les dépendances entre tâches, gère les conflits inter-agents et déclenche la validation finale.
   - **`Agent Runtime` :** Exécute techniquement la tâche via l'agent sélectionné, applique la machine d'état de l'exécution, pilote les appels de tools, applique les timeouts, retries et cancellations, et enregistre la consommation de tokens.
3. **Zéro Mutation Hors Contrôle :**
   Toute modification de code issue d'un tool d'écriture génère un `ChangeSet` qui transite obligatoirement par `ApplicationModelStore.applyChange` et `revisionStore.createRevision`.
4. **Non-régression Absolue :**
   Maintien strict de 100% de succès sur Gate 1 (31/31), Gate 2 (1836/1836), LOT 03 (33/33), LOT 04 (46/46), LOT 05 (56/56), P6, P7, P8 et parité Studio (984,946 octets).

---

### 6. CONCLUSION DE L'AUDIT PHASE 1

L'audit approfondi démontre que le socle de Volaco Core possède tous les fondamentaux algorithmiques requis, mais nécessite une **unification architecturale stricte, une standardisation des contrats et une persistance durable de l'exécution**.

Le périmètre de la Phase 2 est parfaitement balisé et sans ambiguïté.

**Statut Phase 1 : VALIDÉ ET PRÊT POUR APPROBATION UTILISATEUR**
