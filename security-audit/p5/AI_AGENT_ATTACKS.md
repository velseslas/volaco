# ATTAQUES SUR LES AGENTS IA ET APPROBATION DE PLANS (AI_AGENT_ATTACKS)

## 1. Tentatives de Contournement d'Approbation de Plan

Une analyse exhaustive des chemins d'exécution des plans a été réalisée :
- **Appels directs internes :** `ExecutionBridge.canExecute()` applique un verrou strict rejetant tout plan au statut `REJECTED`, `FAILED` ou `DRAFT`.
- **Façade de Conversation :** `executeApprovedPlan()` refuse d'exécuter un plan tant que `session.activePlan.status !== 'APPROVED'`.
- **Actions Destructrices :** `ConfirmationPolicy` force le drapeau `confirmationRequired: true` dès qu'une opération de type `DELETE_FILE` ou qu'un risque élevé est détecté.
- **Résultat :** Aucun chemin alternatif n'a permis de faire exécuter un plan non approuvé à l'insu de l'utilisateur.

## 2. Assainissement des Injections de Prompt

Dans `apps/api/src/routes/ai.ts`, la fonction `sanitizeAiMessages` :
- Détecte les motifs d'évasion système (`ignore all previous instructions`, `you are now in developer mode`, etc.).
- Neutralise les balises XML internes pouvant simuler des délimiteurs système.
- Encapsule les invites utilisateur dans des balises `<user_input source="user_prompt">...</user_input>`.
