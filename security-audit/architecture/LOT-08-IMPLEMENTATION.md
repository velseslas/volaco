# LOT 08 — Documentation d'Implémentation Technique

## 1. Modifications Backend

### 1.1 Singleton AIOrchestratorService
- **Fichier** : `packages/core/src/ai-native/ai-orchestrator/index.ts`
- **Ajout** :
  ```ts
  import { AIOrchestratorService } from './service.js';
  export const aiOrchestratorService = new AIOrchestratorService();
  ```
  Respecte exactement le pattern singleton établi dans `packages/core/src/ai-native/agent-runtime/index.ts`.

### 1.2 Routeur AI Orchestrator
- **Fichier (NOUVEAU)** : `apps/api/src/routes/orchestrate.ts`
- **Endpoints exposés** :
  - `POST /api/v1/projects/:projectId/orchestrate` : Valide le projet (`projectStore`), vérifie la présence du plan (`EngineeringPlan`), puis appelle `aiOrchestratorService.orchestratePlan()`. Retourne HTTP 201 avec `{ success: true, data: { run }, requestId }`.
  - `GET /api/v1/projects/:projectId/orchestrate/:orchestrationId` : Récupère l'état d'un run avec isolation multi-tenant stricte (`getOrchestration`).
  - `POST /api/v1/projects/:projectId/orchestrate/:orchestrationId/cancel` : Annule un run en cours (`cancelOrchestration`).

### 1.3 Enregistrement dans le Serveur API
- **Fichier** : `apps/api/src/server.ts`
- **Import** : `import { handleOrchestrateRoutes } from './routes/orchestrate.js';`
- **Dispatch** : Ajout du bloc de routage 5f immédiatement après les mutations :
  ```ts
  // 5f. AI Orchestrator Routes (LOT 08)
  const handledOrch = await handleOrchestrateRoutes(req, res, pathname, context, requestId);
  if (handledOrch) {
    return;
  }
  ```

---

## 2. Modifications Frontend (Studio)

### 2.1 Élimination du Code Mort
- **Fichier** : `apps/studio/index.html`
- **Suppression** :
  - `function analyzeUserIntent()`
  - `function generateEngineeringPlan()`
  - `function executePlanAction()`
  - `function dismissPlanAction()`

### 2.2 Intégration du Moteur Volaco dans le Studio
- **Variables d'état** :
  - `volacoConversationId`
  - `volacoSessionId`
  - `volacoActivePlan`
  - `volacoActiveIntent`
- **Fonctions canoniques ajoutées** :
  - `getOrCreateVolacoSession(projectId)` : Initialise ou réutilise la session de conversation via `POST /api/v1/projects/:id/conversations`.
  - `renderVolacoPlanCard(plan, intent, conversationId)` : Rendu de la carte Plan First interactive avec badge d'intention réel, taux de confiance calculé, liste ordonnée des étapes, et boutons d'action.
  - `confirmAndExecuteVolacoPlan(planId)` :
    1. Confirme le plan via `POST .../plans/:planId/confirm`
    2. Déclenche l'orchestration via `POST .../orchestrate`
    3. Génère le code avec Codestral sous contrainte stricte du plan validé (Approche B)
    4. Met à jour l'iframe, l'éditeur de code, et les sauvegardes
    5. Fait passer le Conversation Compass à COMPLETED
    6. Affiche le message de succès Volaco
  - `dismissVolacoPlan(planId)` : Archive le plan et remet le Compass à READY.

### 2.3 Remplacement des Branches de Bypass (Branches 8 et 9)
- Dans `handleWorkspacePromptSubmit`, tout prompt soumis envoie le message à `POST /api/v1/projects/:id/conversations/:id/messages`.
- La réponse de turn met à jour le Conversation Compass avec son statut réel (`UNDERSTANDING`, `WAITING_CONFIRMATION`, etc.).
- Si une clarification est requise, l'agent pose la question à l'utilisateur.
- Le Plan d'Ingénierie est généré et présenté pour validation explicite.

### 2.4 Synchronisation des Miroirs de Fichiers
- Parité binaire stricte maintenue entre :
  - `apps/studio/index.html`
  - `apps/studio/volaco_studio.html`
  - `volaco_studio.html`
  - `C:/Users/FAYCAL/.gemini/antigravity/brain/8fa9edf0-0fd9-4b9a-aba5-b16114e16dd7/volaco_studio.html`

---

## 3. Tests et Vérification

- Suite de tests automatisés : `apps/api/tests/lot08-conversation-integration.test.ts` (10 tests, 100% PASS).
- Régression complète Phase 2 : Quality Gate 2 (1971 tests, 0 échec).
