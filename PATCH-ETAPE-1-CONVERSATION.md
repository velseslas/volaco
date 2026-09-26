# Volaco — Patch Étape 1 : branchement du chat Studio sur le moteur conversationnel

## Objectif
Faire passer les demandes normales du chat principal du Studio par l'API Conversation existante, sans modifier les commandes système `/audit`, `/features`, `/feedback`, `/strategy`, etc.

## Changements
- `apps/studio/index.html`
  - Le `handleWorkspacePromptSubmit()` utilise désormais `runConversationEngineFlow()` pour les demandes normales.
  - Le chemin legacy de génération locale reste présent mais devient inatteignable pour ces demandes; il n'est pas supprimé dans cette étape pour limiter le risque.
  - Le chat ne doit donc plus générer directement l'application depuis le navigateur pour une demande normale.
- `apps/api/src/server.ts`
  - Le `ConversationIntelligenceService` est maintenant injecté avec `ReasoningOrchestrator` lorsqu'un fournisseur réel est configuré.
  - Aucun fournisseur réel n'est simulé comme réel : sans clé, le comportement existant de fallback est conservé.
- `packages/core/src/ai/providers/reasoning-orchestrator.ts`
  - Le tenant et le projet de la requête sont utilisés au lieu de forcer systématiquement les identifiants par défaut.

## Validation locale effectuée
- 8 blocs JavaScript inline du Studio : syntaxe Node OK.
- Pas de build TypeScript/Gate2 exécuté dans cette archive car `node_modules` n'est pas présent.

## Test attendu
1. Démarrer l'API et le Studio.
2. Envoyer une demande normale, par exemple : `Ajoute un bouton Contact sur la page d'accueil`.
3. Vérifier que la requête passe par `/conversation/sessions/.../turns`.
4. Vérifier qu'un plan est retourné et affiché.
5. Ne pas poursuivre l'étape d'exécution si le plan n'est pas visible.
