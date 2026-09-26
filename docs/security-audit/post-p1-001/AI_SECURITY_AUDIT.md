# AUDIT DE LA SÉCURITÉ DE L'INTELLIGENCE ARTIFICIELLE & RUNTIME AGENTIQUE
## VOLACO-CORE — PROTECTION CONTRE LES INJECTIONS ET CONTRÔLE DES MUTATIONS

### 1. Assainissement des Invites (Prompt Injection Defense)
- Fonction d'assainissement : `sanitizeAiMessages` dans `apps/api/src/routes/ai.ts`.
- Neutralisation active des balises de contrôle (`<system_instruction>`, `<admin_override>`, `[SYSTEM]`, etc.).
- Encapsulation systématique des messages utilisateurs dans les balises XML délimitées `<user_input source="user_prompt">`.
- Validation : Vecteur 9 de `offensive-audit.test.ts` (PASS).

### 2. Plafonnement des Coûts et Anti-Cost Bombing
- Plafond absolu de tokens générés fixé à 4 096 tokens par requête.
- Plafond de concurrence strict : 5 requêtes IA simultanées par locataire (`MAX_CONCURRENT_AI_PER_TENANT = 5`).
- Quota Rate Limiting dédié : 20 requêtes IA par minute par client.

### 3. Contrôle des Mutations Agentiques (SEC-009 Deny-by-Default)
- Dans `packages/core/src/ai-native/agent-runtime/execution/executor.ts`, les options `allowBreaking` et `allowHighRisk` sont fixées à `false` par défaut.
- Lors de l'exécution de plans générés par l'IA, toute mutation destructive nécessite l'approbation explicite de l'utilisateur (`confirmation = true`).
- La phase de prévisualisation (`previewPlan`) reste disponible en lecture seule pour permettre à l'utilisateur d'inspecter les diffs avant toute application réelle.
