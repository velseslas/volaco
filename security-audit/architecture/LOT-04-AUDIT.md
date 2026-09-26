# LOT 04 — AUDIT D'ARCHITECTURE : CONVERSATION INTELLIGENCE & CONVERSATION COMPASS API

> **Statut de l'Audit :** PHASE 1 — AUDIT UNIQUEMENT (AUCUNE MODIFICATION DE CODE)  
> **Référence CDC :** Spécification Unifiée CDC V7 / V8.1 — Module AINT-009 & LOT 04  
> **Date :** 2026-09-14T23:15:00+01:00  

---

## 1. CONTEXTE ET ÉTAT DES LIEUX DES ACQUIS

Les LOTs 01, 02 et 03 sont rigoureusement validés et opérationnels en production :
* **LOT 01 — Durable Persistence :** VALIDÉ (WAL, reprise sur crash, `.volaco_data/`).
* **LOT 02 — Canonical Application Model :** VALIDÉ (`ApplicationModelStore`, versioning strict, provenance, HTTP 409).
* **LOT 03 — Studio ↔ Canonical Application Model :** VALIDÉ (33/33 tests dédiés passants, parité binaire Studio 984 946 octets).
* **Quality Gates actuelles :**
  - Gate 1 : 31/31 PASS
  - Gate 2 : 1734/1734 PASS
  - P6 (Security Baseline) : 110/110 PASS
  - P7 (Penetration Testing) : 171/171 PASS
  - P8 (Multi-Tenant Isolation) : 37/37 PASS
  - TypeScript strict : 0 erreur
  - Production build : PASS
  - Parité binaire Studio : PASS (984 946 octets)

**Objectif du LOT 04 :**
Construire la fondation backend/API du **Human Conversation Engine** et du **Conversation Compass** :
- Permettre à Volaco d'appréhender une conversation utilisateur comme un **processus d'ingénierie logicielle structuré** (états, transitions formelles, intentions qualifiées, hypothèses explicites, décisions tracées, intégration de la version du modèle canonique).
- Préparer la transition vers le LOT 05 (Plan First) sans exécuter de mutations de code prématurées.

---

## 2. AUDIT DE L'ARCHITECTURE CONVERSATIONNELLE EXISTANTE

### 2.1. Codebase inspectée : `packages/core/src/ai-native/conversation-intelligence/`
L'inspection minutieuse du code réel révèle l'existence préalable d'une suite de briques d'ingénierie dans `packages/core/src/ai-native/conversation-intelligence/` :

```text
packages/core/src/ai-native/conversation-intelligence/
├── cache.ts                      # ConversationSessionLruCache (LRU en mémoire)
├── index.ts                      # Exports publics
├── service.ts                    # ConversationIntelligenceService (Façade)
├── types.ts                      # Contrats TypeScript
├── engine/
│   ├── assumption-engine.ts      # ConversationAssumptionEngine
│   ├── canonical.ts              # Fonctions canoniques (hachage, tri déterministe)
│   ├── clarification-engine.ts   # ClarificationEngine (SAFE_TO_ASSUME vs BLOCKING)
│   ├── contradiction-detector.ts # Détection de conflits avec décisions passées
│   ├── conversation-compass.ts   # Machine à états & transitions formelles
│   ├── conversation-engine.ts    # ConversationEngine (Orchestrateur de tour)
│   ├── execution-bridge.ts       # Pont d'exécution (vers AgentRuntime / Mutation)
│   ├── impact-bridge.ts          # Pont d'impact (vers ImpactIntelligence)
│   ├── intent-engine.ts          # ConversationIntentEngine (Classification lexicale)
│   ├── memory-manager.ts         # 3-Tier Memory (Turn, Project, Decision)
│   ├── plan-generator.ts         # Synthèse de plan d'ingénierie
│   └── understanding-bridge.ts   # Pont de compréhension sémantique
├── provider/
│   └── reasoning-provider.ts     # DefaultReasoningProvider & MockReasoningProvider
└── observability/
    └── conversation-trace.ts     # ConversationTraceCollector & métriques
```

### 2.2. Modèles et Contrats Existants (`types.ts`)
L'analyse de `types.ts` montre une architecture déjà typée :
1. **`ConversationState` :**
   `'EXPLORING' | 'UNDERSTANDING' | 'CLARIFYING' | 'WAITING_CONFIRMATION' | 'PLANNING' | 'EXECUTING' | 'REPAIRING' | 'VALIDATING' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK'`
   - Correspond fidèlement aux états canoniques exigés par le CDC V7/V8.1.
2. **`IntentCategory` :**
   `'QUESTION' | 'EXPLORATION' | 'CREATE' | 'MODIFY' | 'DELETE' | 'REFACTOR' | 'DEBUG' | 'ANALYZE' | 'EXPLAIN' | 'REVIEW' | 'OPTIMIZE' | 'TEST' | 'DEPLOYMENT' | 'NAVIGATION' | 'UNKNOWN'`
   - Découvre `DEBUG` (équivalent de `FIX`), `UNKNOWN` (équivalent de `OTHER`). Doit être harmonisé pour supporter explicitement les alias canoniques `FIX`, `CONFIGURE` et `OTHER`.
3. **`ConversationAssumption` :**
   Contient `id`, `statement`, `confidence`, `evidence`, `risk`, `reversible`, `requiresConfirmation`, `status: 'PROPOSED' | 'CONFIRMED' | 'REJECTED'`.
   - **Écart constaté :** Il manque les statuts `'ACTIVE'` et `'SUPERSEDED'`, ainsi que les champs de provenance (`sourceType`, `sourceMessageId`, `applicationModelVersion`, `createdAt`, `updatedAt`).
4. **`ArchitecturalDecisionRecord` :**
   Contient `decisionId`, `sessionId`, `projectId`, `statement`, `reason`, `evidence`, `confidence`, `alternatives`, `selectedAlternative`, `status: 'ACTIVE' | 'SUPERSEDED' | 'REJECTED' | 'REVERTED'`, `createdAt`.
   - **Écart constaté :** Il manque la provenance explicite (`sourceType: 'USER' | 'SYSTEM' | 'AI' | 'IMPORTED'`, `sourceMessageId`, `applicationModelVersion`).
5. **`ConversationSession` :**
   Contient `sessionId`, `conversationId`, `tenantId`, `projectId`, `currentState`, `turns`, `activeIntent`, `activePlan`, `activeAssumptions`, `activeDecisions`, `applicationSnapshot`, `turnMemory`, `projectMemory`.
   - **Écart constaté :** Ne stocke pas directement le champ `applicationModelVersion` du Canonical Application Model (LOT 02).

---

## 3. AUDIT DE LA PERSISTANCE (DURABLE PERSISTENCE GAP)

### 3.1. État Actuel : Cache Mémoire Volatile
Dans `packages/core/src/ai-native/conversation-intelligence/service.ts` :
```ts
this.cache = new ConversationSessionLruCache(this.config.cacheMaxEntries);
```
- Toutes les sessions sont stockées **uniquement dans une Map LRU en mémoire**.
- **Conséquence critique :** Tout redémarrage du serveur, tout rechargement ou crash entraîne la perte immédiate et définitive de toutes les conversations, messages, états du Compass, hypothèses et décisions !
- Cela enfreint directement l'exigence 18 du LOT 04 : *« La conversation doit survivre : refresh, restart serveur, nouvelle session. Ne pas utiliser une Map mémoire comme source de vérité. »*

### 3.2. Solution Volaco Établie : `DurableFileStorage`
Le LOT 01 et le LOT 02 ont standardisé la persistance durable via `DurableFileStorage` (`packages/core/src/repository/index.ts`) :
- Écriture atomique via fichier temporaire + renommage atomique (`writeJson`).
- Stockage résilient sous `.volaco_data/`.
- Support multi-processus/worker de test (`worker_${process.pid}`).
- Partitionnement strict par clé `${tenantId}:${projectId}`.

### 3.3. Décision d'Architecture pour la Persistance du LOT 04 :
Créer une implémentation `DurableConversationRepository` conforme à une interface `IConversationRepository` :
- Fichier de données : `.volaco_data/conversations.json`
- Stocke les sessions partitionnées par tenant et projet.
- Maintient l'index des sessions par `conversationId` et par `sessionId`.
- Sauvegarde synchrone ou immédiate à chaque tour de conversation, transition d'état, décision ou hypothèse.
- Sur redémarrage du serveur, les sessions existantes sont rechargées depuis le stockage durable sans perte d'état.

---

## 4. AUDIT DE L'API REST (`apps/api/`)

### 4.1. État Actuel des Routes
Inspection de `apps/api/src/routes/` :
- Aucun fichier de route conversationnelle n'existe actuellement.
- `apps/api/src/server.ts` dispatche vers `handleApplicationModelRoutes`, `handleProjectsRoutes`, etc., mais ne dispose d'aucun routeur pour `/api/v1/projects/:projectId/conversations*`.

### 4.2. Contrat REST à Implémenter (Section 13 du CDC) :
Créer `apps/api/src/routes/conversations.ts` avec les endpoints :
1. `POST /api/v1/projects/:projectId/conversations`
   - Crée une nouvelle conversation/session.
   - Enregistre la version actuelle du Canonical Application Model (`applicationModelVersion`).
   - Statut initial : `EXPLORING`.
2. `GET /api/v1/projects/:projectId/conversations`
   - Liste les conversations du projet pour le tenant authentifié.
3. `GET /api/v1/projects/:projectId/conversations/:conversationId`
   - Récupère les métadonnées, l'état courant du Compass, les tours et les messages.
4. `POST /api/v1/projects/:projectId/conversations/:conversationId/messages`
   - Reçoit un message utilisateur.
   - Évalue l'intention (Intent Engine), les hypothèses (Assumption Engine), les contradictions et le Compass.
   - Persiste le message et le nouvel état dans le repository durable.
   - Retourne le résultat structuré (`state`, `intent`, `requiresClarification`, `requiresConfirmation`, etc.).
5. `GET /api/v1/projects/:projectId/conversations/:conversationId/context`
   - Retourne le contexte conversationnel minimal et contrôlé :
     - `projectId`, `tenantId`, `conversationId`
     - `currentState`
     - `currentIntent`
     - `activeAssumptions`
     - `recentDecisions`
     - `applicationModelVersion`
     - `lastMessage`
6. `POST /api/v1/projects/:projectId/conversations/:conversationId/decisions`
   - Permet d'enregistrer explicitement une décision d'architecture avec traçabilité de provenance.

### 4.3. Sécurité et Middleware :
Toutes les routes appliqueront systématiquement :
- `validateAuthSecret` & `extractRequestContext` (JWT / rôle).
- Isolation multi-tenant étanche : rejet 403/404 si la conversation appartient à un autre tenant ou un autre projet.
- `assertPermission(context.role, 'PROJECT_READ')` ou `'PROJECT_MUTATE'`.
- Parsing JSON sécurisé avec rejet 400 en cas de corps malformé.
- Audit trail via `auditStore.record`.
- En-tête de corrélation `requestId`.

---

## 5. AUDIT DE L'INTÉGRATION AVEC LE CANONICAL APPLICATION MODEL

### 5.1. État Actuel dans LOT 02
Dans LOT 02, l'`applicationModelStore` (`packages/core/src/model/application-model/store.ts`) fournit :
- `getModel(tenantId, projectId): ApplicationModel`
- `metadata.modelVersion: number` (entier incrémenté à chaque modification validée).
- Persistance dans `.volaco_data/application_models.json`.

### 5.2. Intégration dans le Conversation Engine
- À la création d'une session, le service interroge `applicationModelStore.getModel(tenantId, projectId)` et capture `applicationModelVersion = model.metadata.modelVersion`.
- À chaque tour de conversation, le modèle canonique est lu pour déterminer si le contexte conversationnel est aligné avec la version actuelle du modèle.
- Si une décision ou une hypothèse est forgée, elle enregistre `applicationModelVersion` dans sa provenance.
- **Règle absolue :** Aucune mutation du Canonical Application Model n'est déclenchée automatiquement dans ce LOT (réservé au LOT 05/Plan First).

---

## 6. AUDIT DU CONVERSATION COMPASS (STATE MACHINE)

### 6.1. États Canoniques Validés
```text
EXPLORING
   ↓
UNDERSTANDING
   ↓
CLARIFYING  ←→  UNDERSTANDING
   ↓
WAITING_CONFIRMATION
   ↓
PLANNING
   ↓
EXECUTING  ←→  REPAIRING
   ↓
VALIDATING
   ↓
COMPLETED
```
États de repli/terminaison : `FAILED`, `ROLLED_BACK`.

### 6.2. Table des Transitions Formelles (`VALID_CONVERSATION_TRANSITIONS`)
- Toute transition hors table lève une `ValidationError` avec explication précise.
- Chaque transition est consignée dans un `ConversationTrace` immuable avec :
  `stateBefore`, `stateAfter`, `intentCategory`, `confidence`, `durationMs`, `traceId`, `timestamp`.

---

## 7. AUDIT DE L'INTENT ENGINE & CLARIFICATION / CONFIRMATION

### 7.1. Catégories d'Intentions V0
L'Intent Engine (`intent-engine.ts`) classe les requêtes en :
- `CREATE` : création d'entités, pages, composants.
- `MODIFY` : modification, mise à jour, ajustement.
- `FIX` / `DEBUG` : correction de bug, crash, erreur.
- `EXPLAIN` : explication de fonctionnement, architecture.
- `ANALYZE` : audit, inspection de code, sécurité.
- `DELETE` : suppression d'éléments (action destructive).
- `REFACTOR` : restructuration sans changement fonctionnel.
- `CONFIGURE` : réglages, variables, configuration.
- `QUESTION` : interrogation informative.
- `OTHER` / `UNKNOWN` : requêtes non reconnues ou ambiguës.

### 7.2. Politiques de Clarification et Confirmation
1. **Clarification :**
   - Si ambiguïté bloquante (`level: 'BLOCKING'`) ou confiance < seuil -> transition vers `CLARIFYING`.
   - Ne bloque JAMAIS pour des micro-décisions de styling (`level: 'SAFE_TO_ASSUME'`).
2. **Confirmation Humaine :**
   - Toute action destructive (`DELETE`) ou plan critique -> transition vers `WAITING_CONFIRMATION`.
   - Ne passe JAMAIS directement en exécution sans accord explicite.
3. **Politique de Repli (Failure Policy) :**
   - En cas d'échec d'analyse ou d'ambiguïté, le moteur ne doit JAMAIS prétendre avoir compris avec certitude. Repli sécurisé vers `UNDERSTANDING` ou `CLARIFYING`.

---

## 8. AUDIT DU FRONTEND STUDIO (`apps/studio/index.html`)

### 8.1. Composants Existants
- Le Studio dispose déjà d'un volet de chat complet :
  - `#chatPanel` (redimensionnable de 20% à 70%)
  - `#wsChatHistory` (historique des messages)
  - `#wsPromptInput` (textarea de saisie utilisateur)
  - `handleWorkspacePromptSubmit(event)` (gestionnaire de soumission)
- Le prompt utilisateur est actuellement envoyé directement au proxy IA ou traité localement.

### 8.2. Stratégie Frontend LOT 04 :
- Selon la Section 25 du CDC : *« Le LOT 04 n'a pas pour objectif de construire toute l'interface Conversation. Ajouter uniquement le minimum nécessaire pour prouver l'intégration si nécessaire. Ne pas refaire le Studio. »*
- Et selon la règle de préservation absolue :
  - **Parité binaire Studio :** `apps/studio/index.html` fait exactement **984 946 octets**.
  - Si un branchement est effectué, il doit conserver l'intégrité de la structure et des tests Studio, ou être encapsulé via l'API REST sans altérer inutilement le bundle Studio.

---

## 9. FICHIERS À CRÉER, MODIFIER ET PRÉSERVER

### 9.1. Fichiers à CRÉER
1. `security-audit/architecture/LOT-04-AUDIT.md` (présent document).
2. `packages/core/src/ai-native/conversation-intelligence/repository.ts` :
   - Interface `IConversationRepository` et implémentation `DurableConversationRepository` basée sur `DurableFileStorage` (`.volaco_data/conversations.json`).
3. `apps/api/src/routes/conversations.ts` :
   - Endpoints REST `/api/v1/projects/:projectId/conversations*`.
4. `apps/api/tests/lot04-conversation-intelligence.test.ts` :
   - Suite de test dédiée couvrant exhaustivement les ~40 cas d'usage exigés (Conversation, Compass, Intent, Clarification, Confirmation, Assumptions, Decisions, Application Model, Security, Concurrency, Regression).
5. `security-audit/architecture/LOT-04-IMPLEMENTATION.md` :
   - Rapport final de clôture du LOT 04.

### 9.2. Fichiers à MODIFIER (Ajustements ciblés & rétrocompatibles)
1. `packages/core/src/ai-native/conversation-intelligence/types.ts` :
   - Étendre `ConversationSession` avec `applicationModelVersion?: number`.
   - Étendre `ConversationAssumption` avec statuts `'ACTIVE'` et `'SUPERSEDED'`, et champs de provenance (`sourceType`, `sourceMessageId`, `applicationModelVersion`).
   - Étendre `ArchitecturalDecisionRecord` avec champs de provenance (`sourceType`, `sourceMessageId`, `applicationModelVersion`).
   - Ajouter les alias canoniques `IntentCategory` (`FIX`, `CONFIGURE`, `OTHER`).
2. `packages/core/src/ai-native/conversation-intelligence/service.ts` :
   - Injecter et synchroniser `DurableConversationRepository`.
   - Lier `applicationModelStore` pour capturer `applicationModelVersion`.
   - Ajouter les méthodes de listing de conversations et de récupération de contexte.
3. `packages/core/src/ai-native/conversation-intelligence/engine/intent-engine.ts` :
   - Supporter les mots-clés de configuration (`CONFIGURE`), de correction (`FIX`) et repli `OTHER`.
4. `packages/core/src/ai-native/conversation-intelligence/index.ts` :
   - Exporter le repository durable et les nouveaux types.
5. `apps/api/src/server.ts` :
   - Monter `handleConversationRoutes` dans la chaîne de dispatch HTTP.

### 9.3. Fichiers à PRÉSERVER STRICTEMENT (AUCUNE RÉGRESSION)
- `packages/core/src/model/application-model/*` (LOT 02)
- `packages/core/src/repository/index.ts` (LOT 01)
- `apps/api/src/routes/application-model.ts` (LOT 02)
- Suites de sécurité P6, P7, P8
- Suites de non-régression Gate 1 (31 tests) et Gate 2 (1734 tests)
- Tests dédiés du LOT 03 (`apps/api/tests/lot03-studio-canonical.test.ts`)

---

## 10. PLAN DE TEST DÉTAILLÉ (~40 TESTS DÉDIÉS)

La suite `apps/api/tests/lot04-conversation-intelligence.test.ts` validera :
1. **Conversation & Lifecycle :**
   - Création de session conversationnelle via REST POST.
   - Récupération de conversation par ID via REST GET.
   - Persistance durable et survie au rechargement de stockage (survie au redémarrage).
   - Ajout et horodatage ordonné des messages utilisateur et assistant.
   - Liste des conversations par projet et filtrage tenant.
2. **Conversation Compass (State Machine) :**
   - État initial canonique (`EXPLORING`).
   - Transitions valides (`EXPLORING` -> `UNDERSTANDING` -> `PLANNING`).
   - Rejet immédiat avec HTTP 400 pour transition illégale (`EXPLORING` -> `EXECUTING`).
   - Traçabilité immuable de la transition (`traceId`, `stateBefore`, `stateAfter`).
3. **Intent Engine & Confiance :**
   - Détection `CREATE` pour création d'entités.
   - Détection `MODIFY` pour modification.
   - Détection `FIX` pour signalement d'erreur ou bug.
   - Détection `QUESTION` pour demande d'information.
   - Détection `OTHER` / `UNKNOWN` pour entrées atypiques avec confiance basse.
   - Préservation de la métrique de confiance sans surévaluation artificielle.
4. **Clarification Contract :**
   - Requête claire -> pas de clarification requise (`requiresClarification: false`).
   - Requête ambiguë -> clarification bloquante (`requiresClarification: true`, état `CLARIFYING`).
   - Détection de micro-décisions de style (SAFE_TO_ASSUME) sans blocage.
5. **Confirmation Humaine :**
   - Requête destructive (`DELETE`) -> passage immédiat à `WAITING_CONFIRMATION`.
   - Fourniture d'une raison explicite de confirmation (`confirmationReason`).
   - Interdiction d'exécution automatique sans accord utilisateur.
6. **Assumption Engine :**
   - Génération déterministe d'hypothèses d'ingénierie.
   - Cycle de vie : PROPOSED/ACTIVE, CONFIRMED, REJECTED, SUPERSEDED.
   - Provenance associée à l'hypothèse.
7. **Decision Memory :**
   - Enregistrement d'une décision d'architecture via API.
   - Remplacement et marquage `SUPERSEDED` des décisions antérieures conflictuelles.
   - Traçabilité de provenance (`sourceType`, `sourceMessageId`, `applicationModelVersion`).
8. **Canonical Application Model Integration :**
   - Le contexte de conversation référence exactement le `applicationModelVersion` du projet (ex: 1).
   - Détection d'un contexte périmé si le modèle applicatif évolue.
9. **Sécurité & Isolation Multi-Tenant :**
   - Rejet strict d'accès cross-tenant (Tenant A ne peut pas lire la conversation du Tenant B -> HTTP 404/403).
   - Rejet d'accès cross-project (Projet X ne peut pas accéder aux conversations du Projet Y).
   - Rejet de requêtes non authentifiées ou avec token invalide.
   - Rejet des payloads JSON malformés avec code d'erreur standardisé.
10. **Concurrence & Idempotence :**
   - Mutations concurrentes de conversation gérées de manière déterministe sans écrasement silencieux.
11. **Non-Régression Globale :**
   - Validations des suites P6, P7, P8, Gate 1 et Gate 2.

---

## 11. CRITÈRES DE SORTIE DE LA PHASE 1 (AUDIT)

La Phase 1 est achevée avec succès si et seulement si :
1. `LOT-04-AUDIT.md` est rédigé, exhaustif et fondé sur le code réel inspecté.
2. Aucun fichier de code n'a été modifié durant la Phase 1.
3. Les lacunes architecturales (persistance durable, routes REST, `applicationModelVersion`, provenance) sont précisément ciblées.
4. Le plan d'implémentation est soumis pour approbation avant tout passage en Phase 2.
