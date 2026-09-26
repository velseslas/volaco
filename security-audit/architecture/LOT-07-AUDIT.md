# LOT 07 — MUTATION ORCHESTRATOR, ATOMIC CHANGES & ROLLBACK
## RAPPORT D'AUDIT ARCHITECTURAL PRÉ-IMPLÉMENTATION

---

### A. CONTEXTE ET OBJECTIF DU LOT 07

À l'issue de la validation formelle des LOTS 01 à 06 :
* **LOT 01** : Persistance durable hermétique multi-tenant (`DurableFileStorage`, `RevisionStore`).
* **LOT 02** : Modèle applicatif canonique (`ApplicationModelStore`, verrouillage optimiste, snapshots d'état).
* **LOT 03** : Intégration Studio Shell ↔ Modèle Applicatif.
* **LOT 04** : Conversation Intelligence & Conversation Compass (FSM, classification d'intentions).
* **LOT 05** : Plan First Engine & Confirmation Humaine Runtime (DAG, validation acyclique, zéro mutation pré-confirmation).
* **LOT 06** : Agent Runtime & AI Orchestrator Core (Machine à états déterministe, 7 outils canoniques, `AnalysisAgent`, `CodeAgentMinimal`, persistance `executions.json`).

Le **LOT 07** a pour mission de verrouiller l'étape ultime de la chaîne :
```text
USER → CONVERSATION → PLAN FIRST → AI ORCHESTRATOR → AGENT RUNTIME → AGENT → TOOL → CHANGESET → MUTATION ORCHESTRATOR → PRE-VALIDATION → ATOMIC APPLY → APPLICATION MODEL + PROJECT FILES → REVISION → POST-VALIDATION → COMMIT
```

**RÈGLE ABSOLUE DU LOT 07 :**
Aucun agent, aucun outil, aucun composant ne doit modifier directement le système de fichiers, l'Application Model ou les révisions de manière non transactionnelle. Toutes les mutations doivent obligatoirement être soumises sous forme de **ChangeSet** au **Mutation Orchestrator**, qui applique les modifications de façon atomique (« tout ou rien »), met à jour le modèle applicatif, consigne la révision, et garantit un **rollback réel, vérifié et prouvé** en cas de défaillance.

---

### B. CARTOGRAPHIE DÉTAILLÉE DU CODE EXISTANT

| Composant / Fichier | Statut | Rôle Actuel |
| :--- | :--- | :--- |
| `packages/core/src/ai-native/mutation-orchestrator/service.ts` | **EXISTANT MAIS INCOMPLET** | Service de mutation AINT-006. Gère les `MutationPlan` avec `SingleMutation[]`, snapshot et rollback sur fichiers, mais n'intègre pas `AgentChangeSet`, `ApplicationModelStore`, ni `RevisionStore`. Persistance uniquement en mémoire. |
| `packages/core/src/ai-native/mutation-orchestrator/filesystem/adapter.ts` | **EXISTANT ET CORRECT** | Interface `IMutableFileSource` et adaptateurs `FileStoreAdapter` et `InMemoryMutableFileSource`. Pont propre vers `FileStore`. |
| `packages/core/src/ai-native/mutation-orchestrator/filesystem/snapshot.ts` | **EXISTANT ET CORRECT** | `createTransactionSnapshot` et `restoreTransactionSnapshot`. Capture l'état pré-mutation et vérifie l'intégrité de `treeHash` au rollback. |
| `packages/core/src/ai-native/mutation-orchestrator/engine/diff.ts` | **EXISTANT ET CORRECT** | Calcul de diff unifié structuré (`computeStructuredDiff`, `addedLines`, `removedLines`). |
| `packages/core/src/ai-native/mutation-orchestrator/engine/security.ts` | **EXISTANT ET CORRECT** | Détection et blocage de path traversal, chemins absolus, et fichiers sensibles (`.env`, `.git`, clés privées). |
| `packages/core/src/ai-native/mutation-orchestrator/engine/rollback.ts` | **EXISTANT ET CORRECT** | Restauration de snapshot et calcul de hash de restauration. |
| `packages/core/src/model/application-model/store.ts` | **EXISTANT ET CORRECT** | `ApplicationModelStore` : `applyChange` avec vérification optimiste (`expectedModelVersion`), validation de schéma, historique et `rollbackToVersion`. |
| `packages/core/src/model/revision-store.ts` | **EXISTANT ET CORRECT** | `RevisionStore` : création de révisions canoniques (`createRevision`), snapshots d'artefacts de fichiers, et `rollbackTo`. |
| `packages/core/src/ai-native/agent-runtime/tools/registry.ts` | **DANGEREUX** | Les handlers de `create_file`, `write_file`, `delete_file` écrivent directement dans `fileStore` pendant l'exécution d'un agent sans passer par une transaction atomique globale. Si une étape ultérieure échoue, les fichiers modifiés restent orphelins. |
| `packages/core/src/ai-native/ai-orchestrator/service.ts` | **EXISTANT MAIS INCOMPLET** | `executePlanWithAgents` exécute les tâches d'agent séquentiellement et incrémente `applicationModelStore` en fin de plan sans passer par le `MutationOrchestrator` et sans rollback transactionnel en cas d'erreur au milieu du plan. |
| `packages/core/src/ai-native/ai-orchestrator/engine/mutation-bridge.ts` | **DUPLIQUÉ / PARTIEL** | Pont traduisant `AgentArtifact` en `SingleMutation[]`, mais déconnecté du flux `AgentChangeSet` de LOT 06. |
| `apps/api/src/routes/mutations.ts` | **ABSENT** | Aucune route REST dédiée aux opérations du `MutationOrchestrator` (`/mutations/apply`, `/mutations/validate`, `/mutations/dry-run`, `/mutations/:id/rollback`). |
| `DurableMutationRepository` | **ABSENT** | Les transactions du `MutationOrchestrator` sont stockées dans une `Map` en mémoire, perdues au redémarrage du serveur. |
| Cache d'Idempotence Mutation | **ABSENT** | Aucune déduplication formelle sur clé composite `${tenantId}:${projectId}:${executionId}:${changesetId}`. |

---

### C. ANALYSE CRITIQUE DES ÉCARTS (GAP ANALYSIS)

#### 1. Rupture de la chaîne transactionnelle dans l'exécution d'agents
* **Constat :** Dans le LOT 06, `CodeAgentMinimal` effectue des appels directs aux outils `create_file` et `write_file` qui invoquent immédiatement `fileStore.saveFile()`.
* **Risque :** Si un plan comporte 3 étapes (Étape 1 : Créer A, Étape 2 : Créer B, Étape 3 : Compiler et vérifier C) et que l'Étape 3 échoue, les fichiers A et B ont déjà été physiquement écrits sur le disque et polluent le projet sans mécanisme de rollback automatique.
* **Cible LOT 07 :** Les outils de mutation ou l'orchestrateur doivent capturer un snapshot préalable et canaliser l'application finale à travers `MutationOrchestratorService`. Si l'une des étapes ou la post-validation échoue, le rollback atomique restaure l'état exact initial.

#### 2. Synchronisation du Triptyque : Fichiers + Modèle Applicatif + Révision
* **Constat :**
  - `MutationOrchestratorService` met à jour les fichiers via `IMutableFileSource`.
  - `ApplicationModelStore` incrémente le `modelVersion` via `applyChange`.
  - `RevisionStore` crée une révision via `createRevision`.
  - **Actuellement, ces trois opérations sont isolées et ne sont pas exécutées dans une même transaction atomique coordonnée.**
* **Cible LOT 07 :** `MutationOrchestratorService` doit être le chef d'orchestre unique :
  1. Pré-snapshot des fichiers + snapshot du modèle applicatif.
  2. Application atomique des modifications de fichiers.
  3. Mise à jour de l'Application Model (`v_{n+1}`).
  4. Création de l'enregistrement de Révision (`rev_{n+1}`).
  5. Post-validation.
  6. Si échec à l'une de ces étapes : rollback simultané des fichiers ET du modèle applicatif !

#### 3. Contrôle de Concurrence Optimiste (Optimistic Concurrency)
* **Constat :** Le `MutationOrchestratorService` vérifie `baseGraphHash`, mais ne vérifie pas `expectedModelVersion` ni `expectedRevisionNumber`.
* **Cible LOT 07 :** Refus strict (409 Conflict / Stale Mutation) si l'état courant (`modelVersion`, `revisionNumber`) ne correspond pas exactement à l'état de départ du ChangeSet.

#### 4. Traitement du Cas Critique : "Rollback Failure"
* **Constat :** Si `restoreTransactionSnapshot` échoue (par exemple, divergence de hash après restauration), une exception est levée mais la transaction ne transite pas vers un état explicite `ROLLBACK_FAILED` et aucun événement d'audit critique de niveau sécurité n'est consigné pour intervention humaine.
* **Cible LOT 07 :** État explicite `ROLLBACK_FAILED`, journalisation d'audit critique, et conservation hermétique des artefacts de diagnostic.

#### 5. Idempotence & Retries Réseau
* **Constat :** Aucune table de hachage d'idempotence n'enregistre les signatures `${tenantId}:${projectId}:${executionId}:${changesetId}`. Deux soumissions identiques provoqueraient deux applications physiques successives.
* **Cible LOT 07 :** Déduplication stricte. Un deuxième appel avec le même ChangeSet renvoie le résultat déjà validé sans refaire de mutations ni de bump de version.

---

### D. CLASSIFICATION FORMELLE DU PÉRIMÈTRE

```text
[EXISTANT ET CORRECT]
- FileStoreAdapter & InMemoryMutableFileSource
- createTransactionSnapshot & restoreTransactionSnapshot
- computeStructuredDiff (unified diff engine)
- computeTransactionHash, computePlanHash, deepFreeze
- validateMutationSecurity (anti-traversal & protected files)
- ApplicationModelStore (applyChange, optimistic lock, rollbackToVersion)
- RevisionStore (createRevision, listRevisions, rollbackTo)

[EXISTANT MAIS INCOMPLET]
- MutationOrchestratorService (manque support natif AgentChangeSet, coordination Application Model, création Révision, persistance durable)
- AIOrchestratorService.executePlanWithAgents (manque rollback transactionnel global en cas d'échec d'étape)
- AgentChangeSet (doit supporter le typage granulaire des opérations)

[DUPLIQUÉ]
- MutationBridge (à harmoniser avec le flux d'entrée canonique ChangeSet)

[DANGEREUX]
- Invocations directes de fileStore.saveFile / createNode dans les tools de ToolRegistry lors de l'exécution d'agents sans encadrement transactionnel

[ABSENT]
- DurableMutationRepository (.volaco_data/mutations.json)
- Routes API REST /api/v1/projects/:projectId/mutations*
- Gestionnaire d'Idempotence (Idempotency Store)
- Transition d'état formelle et audit critique de ROLLBACK_FAILED
- Suite de tests dédiée apps/api/tests/lot07-mutation-orchestrator.test.ts

[À RÉUTILISER]
- packages/core/src/ai-native/mutation-orchestrator/ (architecture modulaire AINT-006 existante)
- applicationModelStore (modèle canonique)
- revisionStore (révisions canoniques)
- auditStore (traçabilité immuable)
- DurableFileStorage (persistance fichier JSON)

[À REMPLACER / ÉTENDRE]
- MutationOrchestratorService : intégrer la méthode canonique applyChangeSet avec coordination complète (Files + Model + Revision + Rollback + Idempotency)
- executePlanWithAgents : relier l'exécution atomique au MutationOrchestrator canonique
```

---

### E. PLAN D'ACTION POUR LA PHASE 2

1. **Étendre `packages/core/src/ai-native/mutation-orchestrator/types.ts` :**
   - Étendre `TransactionStatus` : `'PLANNED' | 'EXECUTING' | 'COMMITTED' | 'ROLLED_BACK' | 'ROLLBACK_FAILED' | 'FAILED'`.
   - Modéliser `CanonicalChangeSet` & `ChangeSetOperation` avec types `CREATE | UPDATE | DELETE | RENAME | MOVE`, hashes et contenus.
   - Interfaces pour `ApplyChangeSetRequest`, `ApplyChangeSetResult`, `MutationSnapshot`.
2. **Implémenter `DurableMutationRepository` (`repository.ts`) :**
   - Sérialisation multi-tenant dans `.volaco_data/mutations.json` avec recherche globale `findById`.
3. **Solidifier `MutationOrchestratorService` (`service.ts`) :**
   - Méthode canonique `applyChangeSet` avec le triptyque :
     1. Vérification RBAC (`PROJECT_MUTATE`).
     2. Vérification d'idempotence (`idempotencyStore`).
     3. Contrôle optimiste de version (`expectedModelVersion`, `expectedRevisionNumber`).
     4. Snapshot pré-mutation (fichiers + modèle applicatif).
     5. Validation stricte de sécurité et de cohérence (anti-traversal, collisions, hashes).
     6. Mode DRY-RUN (aperçu complet sans mutation physique ni version bump).
     7. Application atomique (« tout ou rien »).
     8. Mise à jour de l'Application Model via `applicationModelStore.applyChange`.
     9. Création de la Révision via `revisionStore.createRevision`.
     10. Post-validation (syntaxe, invariants).
     11. Commit persistant et traçabilité d'audit.
     12. Rollback automatique vérifié en cas d'erreur (avec gestion explicite de `ROLLBACK_FAILED`).
4. **Intégrer le pipeline AI Orchestrator :**
   - Câbler `executePlanWithAgents` pour canaliser toutes les mutations via `MutationOrchestratorService.applyChangeSet`.
5. **Créer et Monter les Routes REST (`apps/api/src/routes/mutations.ts`) :**
   - `POST /api/v1/projects/:projectId/mutations/validate`
   - `POST /api/v1/projects/:projectId/mutations/dry-run`
   - `POST /api/v1/projects/:projectId/mutations/apply`
   - `GET  /api/v1/projects/:projectId/mutations`
   - `GET  /api/v1/projects/:projectId/mutations/:transactionId`
   - `POST /api/v1/projects/:projectId/mutations/:transactionId/rollback`
6. **Écrire la Suite de Tests Dédiée (`apps/api/tests/lot07-mutation-orchestrator.test.ts`) :**
   - Couverture exhaustive des 24 exigences (validation, sécurité, concurrence optimiste, atomicité multi-fichiers, 6 cas de rollback, idempotence, dry-run, post-validation, rollback-failure, multi-tenant, provenance, E2E complet).
7. **Exécuter les Portes de Qualité (Gate 1, Gate 2, LOT 03-06, P6-P8, Parité Studio).**

---

### F. CONCLUSION DE L'AUDIT

L'infrastructure de base construite en AINT-006 et dans les LOTS 01 à 06 est d'une grande qualité. Le LOT 07 va unifier ces briques pour établir le **Mutation Orchestrator comme unique frontière d'intégrité de Volaco**.

**AUDIT PRÉ-IMPLÉMENTATION TERMINÉ — PRÊT POUR LA PHASE 2 (IMPLÉMENTATION).**
