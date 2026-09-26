# LOT 02 — AUDIT D'ARCHITECTURE : CANONICAL APPLICATION MODEL & CONTRACT

**Date :** 14 Septembre 2026  
**Auteur :** Ingénieur Principal Volaco Core  
**Contexte :** CDC VOLACO — V7 + V8.1 UNIFIED FINAL  
**Statut :** AUDIT COMPLET — ZERO CODE MODIFICATION RÉALISÉE  

---

## 1. ARCHITECTURE ACTUELLE DU SYSTÈME

L'architecture actuelle de Volaco Core repose sur un pattern **Modular Monolith** organisé en couches strictes :

```text
Studio (SPA HTML5/Tailwind/Vanilla)
   │
   ▼ HTTP / REST (Bearer Auth JWT, RBAC 4 rôles, Rate Limiting, Audit Trail)
API Routes (apps/api/src/routes/)
   │
   ▼ Injection de Dépendances
Services Métier (packages/core/src/)
   │
   ▼
Stores / Repositories (ProjectStore, FileStore, RevisionStore, etc.)
   │
   ▼
Durable Persistence (DurableFileStorage / .volaco_data/)
```

### Caractéristiques fondamentales en place :
1. **Couche de persistance durable (validée au LOT 01) :**
   - `DurableFileStorage` (`packages/core/src/repository/index.ts`) assure la persistance sur disque avec écritures atomiques via fichiers temporaires et renommage sécurisé.
   - Isolation des processus de test parallèle via `worker_${process.pid}`.
   - Dépôts durables existants : `DurableProjectRepository` (`projects.json`), `DurableFileRepository` (`project_files.json`), `DurableRevisionRepository` (`revisions.json`), `DurableAuditRepository` (`audit.json`).
2. **Cloisonnement multi-tenant hermétique (SEC-006, P6/P7/P8) :**
   - Clé composite systématique : `${tenantId}:${projectId}`.
   - RBAC à 4 rôles : `OWNER`, `ADMIN`, `ENGINEER`, `VIEWER`.
   - Contrôle d'accès aux ressources au niveau middleware (`extractRequestContext`, `assertPermission`).
3. **Moteurs IA-Native (AINT-001 à AINT-017) :**
   - `ApplicationDNA` (AINT-002) : extraction heuristique statique (AST, pile technologique, couches, graphe de dépendances).
   - `ApplicationUnderstanding` (AINT-008) : inférence sémantique (domaines, fonctionnalités, flux de données, règles métier).
   - `SemanticGraph` (AINT-003) : graphe de symboles et relations entre fichiers.
   - `ImpactIntelligence` (AINT-005) : calcul de rayon d'impact et blast radius.
   - `MutationOrchestrator` (AINT-006) : mutations transactionnelles avec préconditions et rollback.
   - `ConversationIntelligence` (AINT-009) : gestion de dialogue technique et raisonnement IA.
   - `Strategy` (AINT-016) et `Evolution` (AINT-017) : optimisation stratégique, feuille de route, dette technique.

---

## 2. ÉVENTAIL DES MODÈLES EXISTANTS

L'audit approfondi du repository identifie les modèles suivants représentant tout ou partie de l'état applicatif :

### 2.1. `ApplicationRevision` (`packages/core/src/model/revision.ts`)
- **Rôle :** Représentation historique des versions de fichiers physiques.
- **Champs :**
  - `id` (ex: `rev_...`)
  - `tenantId`, `projectId`
  - `parentRevisionId` (chaînage séquentiel)
  - `revisionNumber` (entier incrémental 1, 2, ...)
  - `message`, `author`, `createdAt`
  - `files: Record<string, FileArtifact>` (chemin, contenu, taille, hash sha256, mimeType)
  - `decisions: TechnicalDecision[]` (id, title, rationale, timestamp, impact)
  - `provenance: ModificationProvenance` (source: 'USER'|'AI_AGENT'|'SYSTEM_REPAIR', prompt, triggerRequestId)
- **Persistance :** Durablement persisté dans `.volaco_data/revisions.json` via `DurableRevisionRepository`.

### 2.2. `ApplicationDNA` (`packages/core/src/ai-native/dna/types.ts`)
- **Rôle :** Empreinte structurelle et technologique extraite statiquement du code.
- **Champs :**
  - `schemaVersion: '1.0.0'`, `analyzerVersion`
  - `tenantId`, `projectId`, `treeHash`, `dnaHash`, `extractedAt`, `durationMs`
  - `stack: ApplicationStack` (language, framework, runtime, uiLibrary, stateManagement, databaseOrOrm, etc.)
  - `architecture: ApplicationArchitecture` (primaryPattern, entryPoints, layers, routesCount, componentsCount)
  - `components: ComponentProfile[]`
  - `modules: ModuleBoundary[]`
  - `graphMetrics: GraphMetrics` (nœuds, arêtes, dépendances directes/inverses, ordre topologique, cycles)
  - `summary: DNASummary` (totalFiles, analyzedFiles, diagnosticsCount, overallHealth, primaryLanguage, primaryFramework)
- **Persistance :** Cache mémoire LRU (`DnaCache`) uniquement. Non persisté sur disque.

### 2.3. `ApplicationSemanticModel` (`packages/core/src/ai-native/application-understanding/types.ts`)
- **Rôle :** Modèle sémantique inféré par raisonnement IA à partir du graphe de code et des fichiers.
- **Champs :**
  - `schemaVersion: '1.0.0'`, `understandingVersion`
  - `tenantId`, `projectId`, `treeHash`, `graphHash`, `understandingHash`, `createdAt`, `durationMs`
  - `summary: ApplicationSemanticSummary` (domaines, fonctionnalités, flux, règles, risque)
  - `capabilities: ApplicationCapabilities`
  - `domains: SemanticDomain[]`
  - `features: SemanticFeature[]`
  - `workflows: SemanticWorkflow[]`
  - `userJourneys: SemanticUserJourney[]`
  - `dataFlows: SemanticDataFlow[]`
  - `businessRules: SemanticBusinessRule[]`
  - `components: SemanticComponent[]`
  - `services: SemanticService[]`
  - `apis: SemanticApi[]`
  - `entryPoints: SemanticEntryPoint[]`
  - `boundaries: ArchitecturalBoundary[]`
  - `metrics: UnderstandingMetrics`
- **Persistance :** Cache mémoire LRU (`UnderstandingCache`) uniquement. Non persisté sur disque.

### 2.4. `ProjectStateSummary` (`packages/core/src/project-state/types.ts`)
- **Rôle :** Synthèse d'état opérationnel du projet pour le Studio et le Dashboard.
- **Champs :**
  - `tenantId`, `projectId`, `name`, `description`, `status`
  - `currentRevision: { id, revisionNumber, author, message, treeHash, createdAt }`
  - `workspace: { status, isDirty, activeFile, openFilesCount, lastSyncedAt }`
  - `validation: ValidationReport` (build, typecheck, lint, tests, security, errors, warnings)
  - `recentActivity: RecentActivityItem[]`
  - `updatedAt`
- **Persistance :** Calculé à la volée par `ProjectStateService`, état de workspace en mémoire.

### 2.5. Modèles de Décisions Fragmentés
- `TechnicalDecision` dans `model/revision.ts` (id, title, rationale, timestamp, impact).
- `ArchitecturalDecisionRecord` dans `conversation-intelligence/types.ts` (decisionId, sessionId, projectId, statement, reason, evidence, confidence, alternatives, selectedAlternative, status, createdAt).
- `DecisionRecord` dans `agent-runtime/types.ts`.
- `EvolutionDecision` dans `evolution/types.ts`.
- `RecommendationProvenanceTrace` dans `strategy/decision/decision-provenance-engine.ts`.

---

## 3. DOUBLONS, AMBIGUÏTÉS ET INCOHÉRENCES IDENTIFIÉS

1. **Absence d'un `ApplicationModel` canonique unifié :**
   - Trois modèles partiels concurrents coexistent (`ApplicationRevision`, `ApplicationDNA`, `ApplicationSemanticModel`).
   - Chacun possède son propre hachage (`treeHash`, `dnaHash`, `graphHash`, `understandingHash`) sans conteneur racine consolidé.
2. **Fragmentation des composants et points d'entrée :**
   - `ComponentProfile` dans DNA (orienté AST/lignes) vs `SemanticComponent` dans Understanding (orienté domaine/criticité).
   - `EntryPoint` dans DNA vs `SemanticEntryPoint` dans Understanding.
3. **Multiplication désordonnée des formats de décision :**
   - Les décisions techniques prises lors d'une révision ne sont pas corrélées aux décisions architecturales de la conversation ni aux décisions d'évolution.
4. **Disparité de persistance :**
   - Seul `ApplicationRevision` est persisté de façon durable (Lot 01).
   - `ApplicationDNA` et `ApplicationSemanticModel` sont perdus à chaque redémarrage du serveur et doivent être recalculés, créant des latences et des ruptures d'idempotence.
5. **Absence de contrôle de concurrence optimiste (Optimistic Locking) :**
   - Aucun numéro de version incrémental global (`modelVersion`) n'est vérifié lors de propositions de mutation, ce qui expose à des écrasements silencieux en cas d'accès concurrents (deux agents ou un agent + l'utilisateur).
6. **Absence de séparation entre version de schéma et version de modèle :**
   - `schemaVersion` et `modelVersion` ne sont pas explicitement découplés.

---

## 4. CARTOGRAPHIE DES DÉPENDANCES

```text
                 ApplicationModel (Canonique Cible)
                       │
       ┌───────────────┼────────────────────────┐
       ▼               ▼                        ▼
Conversation      Impact Intelligence      Agent Runtime /
Intelligence           │                   AI Orchestrator
       │               │                        │
       └───────────────┼────────────────────────┘
                       ▼
             Application Validation
                       │
                       ▼
             Strategy & Evolution
```

- **Conversation Intelligence :** Utilise `UnderstandingBridge.fetchUnderstanding()` pour extraire l'intention et vérifier les contradictions.
- **Strategy Optimizer :** Utilise `StrategyApplicationUnderstandingBridge` pour synthétiser l'architecture depuis le DNA.
- **Mutation Orchestrator :** Lit le graphe sémantique et les fichiers pour calculer les préconditions de mutation.
- **Impact Intelligence :** Détermine le blast radius à partir du graphe sémantique et des composants.
- **Studio Shell :** Consomme `/api/v1/projects/:projectId/state` et effectue une analyse DOM locale pour afficher l'arbre applicatif.

---

## 5. PRODUCTEURS EXISTANTS

1. **`ApplicationDNAService.extractDNA(files)` :** Analyse statique par expressions régulières et heuristiques pour produire `ApplicationDNA`.
2. **`ApplicationUnderstandingService.buildUnderstanding(...)` :** Construit `ApplicationSemanticModel` en combinant le graphe sémantique et les règles métier.
3. **`RevisionStore.createRevision(...)` :** Produit `ApplicationRevision` lors de sauvegardes explicites de fichiers ou rollbacks.
4. **`ProjectStateService.getProjectState(...)` :** Agrège les données pour produire `ProjectStateSummary`.

---

## 6. CONSOMMATEURS EXISTANTS

1. `ConversationEngine` : lecture du modèle pour contextualiser les prompts et générer les plans d'ingénierie.
2. `ImpactBridge` : évaluation des impacts d'un plan.
3. `StrategyOptimizerService` : évaluation de la santé produit et génération de recommandations.
4. `EvolutionOptimizerService` : calcul du score de dette technique et de la feuille de route.
5. `AgentRuntimeService` : injection du contexte applicatif dans la mémoire des agents.
6. `Studio UI` : affichage des statistiques, fichiers, arborescence et état.

---

## 7. PERSISTANCE ACTUELLE

| Entité | Support de Persistance | Format | Durabilité |
| :--- | :--- | :--- | :--- |
| **Projets** | `DurableProjectRepository` | `.volaco_data/projects.json` | OUI (Lot 01) |
| **Fichiers** | `DurableFileRepository` | `.volaco_data/project_files.json` | OUI (Lot 01) |
| **Révisions** | `DurableRevisionRepository` | `.volaco_data/revisions.json` | OUI (Lot 01) |
| **Audit Logs** | `DurableAuditRepository` | `.volaco_data/audit.json` | OUI (Lot 01) |
| **Application DNA** | `DnaCache` (In-Memory LRU) | Mémoire RAM | NON (Perdu au reboot) |
| **Application Understanding** | `UnderstandingCache` (In-Memory LRU) | Mémoire RAM | NON (Perdu au reboot) |
| **Application Model** | N'EXISTE PAS ENCORE | - | - |

**Verdict Persistance :** Le nouveau `ApplicationModel` canonique doit être intégré dans `.volaco_data/application_models.json` via un `DurableApplicationModelRepository` réutilisant `DurableFileStorage`.

---

## 8. VERSIONING EXISTANT

- `ApplicationRevision` utilise un entier séquentiel `revisionNumber` (1, 2, 3...) avec pointeur de parent `parentRevisionId`.
- Les révisions sont immutables et supportent le rollback non destructif (`rollbackToRevision`).
- `ApplicationDNA` et `ApplicationSemanticModel` n'ont pas d'historique de versions ni de suivi de modifications incrémentales.
- **Besoin Cible :** Séparer strictement `schemaVersion` (ex: `"1.0"`) et `modelVersion` (ex: `1, 2, 3...`), avec snapshots d'historique `ApplicationModelVersion`, `ChangeSet` typé et `ModelProvenance`.

---

## 9. PROBLÈMES DE COHÉRENCE ET DE SÉCURITÉ

1. **Course critique (Race Condition) :** Deux agents IA concurrents peuvent générer des modifications basées sur la même version. Sans locking optimiste sur `modelVersion`, la dernière écriture écrase silencieusement la première.
2. **Fuite de secrets :** Le modèle applicatif ne doit jamais stocker de valeurs secrètes (clés API, mots de passe, tokens). Un validateur de sécurité doit inspecter tout modèle avant enregistrement.
3. **Invariants métier ignorés :** Aucune couche ne vérifie aujourd'hui les invariants déclaratifs (ex: toute route sensible exige une authentification, un composant doit respecter le design token primaire).
4. **Isolation multi-tenant :** Tout accès au modèle doit exiger `tenantId` et `projectId` et empêcher formellement toute collision ou fuite transversale.

---

## 10. PROPOSITION DE CONSOLIDATION (ARCHITECTURE RETENUE)

### 10.1. Schéma Canonique `ApplicationModel`

Localisation : `packages/core/src/model/application-model/`

```text
ApplicationModel
├── metadata           (id, projectId, tenantId, schemaVersion, modelVersion, createdAt, updatedAt, createdBy, updatedBy, sourceRevisionId)
├── identity           (name, description, category, targetAudience)
├── product            (features, valueProposition, targetPersonas)
├── stack              (language, framework, runtime, styling, database, stateManagement, testFramework, buildTool)
├── architecture       (primaryPattern, entryPoints, layers, boundaries)
├── structure          (directories, modules, fileCount)
├── pages              (pages déclarées, layouts, titres)
├── routes             (routes frontend et backend, méthodes HTTP, permissions requises)
├── components         (composants UI, props, hooks, complexité)
├── dataModel          (entités, attributs, relations, contraintes)
├── apis               (endpoints, méthodes, paramètres, sécurité)
├── businessRules      (règles métier, conditions, effets, criticité)
├── permissions        (rôles, matrice de droits, accès par ressource)
├── integrations       (services tiers autorisés, SDKs, webhooks)
├── designSystem       (tokens couleur, typographie, espacement, formes, élévations)
├── runtime            (configuration d'exécution, ports, variables d'environnement déclarées hors secrets)
├── tests              (suites de tests, couverture attendue)
├── dependencies       (dépendances déclarées avec contraintes de version)
├── constraints        (contraintes techniques, compatibilité navigateurs)
├── invariants         (invariants déclaratifs validables par machine)
├── technicalDebt      (items de dette technique qualifiés et priorisés)
└── dna                (couche conceptuelle de synthèse DNA : empreintes, métriques de graphe, santé)
```

### 10.2. Versioning & Concurrence Optimiste
- Structure `ApplicationModelVersion` enregistrant chaque transition d'état.
- `ChangeSet` catégorisant les éléments ajoutés, modifiés, supprimés et impactés.
- `ModelProvenance` traçant l'acteur, le requestId, le motif et la source.
- Rejet avec erreur `ConflictError` (HTTP 409) si `expectedModelVersion !== currentModelVersion`.

### 10.3. Moteur de Validation Dédié
- Validations structurelles (champs obligatoires, types, versions).
- Validations de cohérence (routes sans composant, pages orphelines, clés de permissions inexistantes).
- Validations de sécurité (détection de motifs de secrets, validation d'ownership tenant).
- Validations d'architecture (détection de cycles de dépendances).
- Validations de design tokens (conformité au design system).

### 10.4. Migration de Schéma Déterministe
- Fonctions de migration explicites `migrateSchema(model, targetSchemaVersion)`.
- Idempotence et préservation absolue des données inconnues ou personnalisées.

---

## 11. FICHIERS QUI DEVRONT ÊTRE CRÉÉS / MODIFIÉS

### Fichiers à créer :
1. `packages/core/src/model/application-model/types.ts` : Contrat TypeScript fortement typé.
2. `packages/core/src/model/application-model/validator.ts` : Validateur complet (structure, cohérence, sécurité, architecture, design).
3. `packages/core/src/model/application-model/migration.ts` : Moteur de migration de schéma versionné.
4. `packages/core/src/model/application-model/repository.ts` : Dépôt durable `DurableApplicationModelRepository`.
5. `packages/core/src/model/application-model/store.ts` : Store `ApplicationModelStore` avec locking optimiste et historique.
6. `packages/core/src/model/application-model/adapters.ts` : Adaptateurs vers/depuis `ApplicationRevision`, `ApplicationDNA`, `ApplicationSemanticModel`.
7. `packages/core/src/model/application-model/index.ts` : Barrel d'export.
8. `apps/api/src/routes/application-model.ts` : Endpoints REST sécurisés pour le modèle canonique.
9. `apps/api/tests/lot02-application-model.test.ts` : Suite de tests complète dédiée au Lot 02.

### Fichiers à modifier avec précaution minimale :
1. `packages/core/src/repository/index.ts` : Définition de l'interface `IApplicationModelRepository`.
2. `packages/core/src/index.ts` : Re-export des contrats et services du modèle d'application.
3. `apps/api/src/server.ts` : Enregistrement du routeur `handleApplicationModelRoutes`.

---

## 12. FICHIERS QUI NE DOIVENT PAS ÊTRE MODIFIÉS

- **Modules de sécurité P6/P7/P8 gelés :**
  - `packages/core/src/security/secrets.ts`
  - `packages/core/src/identity/permissions.ts`
  - `apps/api/src/middleware/auth.ts`
  - `apps/api/tests/security/*`
- **Modules de persistance Lot 01 déjà stabilisés :**
  - `packages/core/src/model/revision.ts`
  - `packages/core/src/model/revision-store.ts`
  - `packages/core/src/file-explorer/store.ts`
  - `packages/core/src/identity/project.ts`
- **Studio HTML :**
  - `apps/studio/index.html` et `volaco_studio.html` (règle stricte de parité byte-for-byte).

---

## 13. RISQUES DE MIGRATION

1. **Initialisation des projets existants :** Un projet existant dans `projects.json` peut ne pas encore avoir de fichier `application_models.json`. Le store doit initialiser automatiquement un `ApplicationModel` canonique v1.0 par défaut à la première requête.
2. **Conflit de persistance multi-processus :** En environnement de test parallèle (`node --test`), les dépôts doivent utiliser l'isolation PID déjà validée dans `DurableFileStorage`.
3. **Plafond mémoire :** Les snapshots historiques de modèles complets pourraient consommer de la mémoire s'ils n'étaient pas gérés proprement. Le stockage disque durable assure que la RAM ne sature pas.

---

## 14. STRATÉGIE DE COMPATIBILITÉ (KEEP / ADAPT / DEPRECATE / REMOVE)

| Module Existant | Décision | Justification |
| :--- | :--- | :--- |
| `ApplicationRevision` (FND-004) | **KEEP** | Reste le moteur canonique des snapshots de fichiers et rollbacks physiques. Référencé par `sourceRevisionId`. |
| `ApplicationDNA` (AINT-002) | **ADAPT** | Conservé pour l'extraction AST statique. Ses résultats alimentent la tranche `dna` et les sections `stack`/`architecture` du modèle canonique via l'adaptateur. |
| `ApplicationSemanticModel` (AINT-008) | **ADAPT** | Conservé pour l'inférence sémantique profonde. Alimente `components`, `apis`, `businessRules`, `workflows` du modèle canonique. |
| `ProjectStateSummary` (CAPP-004) | **KEEP** | Maintient la synthèse d'état du workspace et du dashboard, enrichi par référence au modèle canonique. |
| `TechnicalDecision` / `ADR` | **ADAPT** | Les décisions sont unifiées au niveau du modèle canonique avec traçabilité complète. |
| Aucun module existant | **REMOVE** | **ZÉRO SUPPRESSION BRUTALE.** Préservation absolue de la compatibilité ascendante. |

---

## 15. PLAN D'IMPLÉMENTATION SÉQUENTIEL (PHASE 2)

```text
Étape 1 : Contrats & Types Canoniques
  └── Définir ApplicationModel, ApplicationModelVersion, ChangeSet, ModelProvenance, Invariant, ValidationResult dans application-model/types.ts

Étape 2 : Moteur de Validation & Règles de Cohérence
  └── Implémenter ApplicationModelValidator avec vérifications structurelles, sémantiques, sécurité, architecture et design tokens

Étape 3 : Moteur de Migration de Schéma
  └── Implémenter migrateSchema(model, targetVersion) avec support déterministe et idempotent v1.0 -> v1.1

Étape 4 : Persistance Durable & Isolation Multi-Tenant
  └── Implémenter DurableApplicationModelRepository (application_models.json) sur DurableFileStorage

Étape 5 : Store d'Application Model & Concurrence Optimiste
  └── Implémenter ApplicationModelStore avec validation préalable, verrouillage de version optimiste et historique de versions

Étape 6 : Adaptateurs de Rétrocompatibilité
  └── Implémenter les ponts bidirectionnels ApplicationDNA / ApplicationSemanticModel / ApplicationRevision <-> ApplicationModel

Étape 7 : Endpoints REST API
  └── Développer apps/api/src/routes/application-model.ts avec vérification RBAC, validation de requêtes et audit trail

Étape 8 : Suite de Tests Dédiée
  └── Écrire apps/api/tests/lot02-application-model.test.ts couvrant les 7 axes obligatoires

Étape 9 : Validation des Portes de Qualité et Non-Régression
  └── Vérifier TypeScript strict, Production build, Gate 1 (31/31), Gate 2 (1679+/1679+), P6, P7, P8

Étape 10 : Rapport Final d'Implémentation
  └── Rédiger security-audit/architecture/LOT-02-IMPLEMENTATION.md avec le bloc de verdict final
```

---
**FIN DU RAPPORT D'AUDIT PHASE 1 — PRÊT POUR L'ENGAGEMENT DE LA PHASE 2**
