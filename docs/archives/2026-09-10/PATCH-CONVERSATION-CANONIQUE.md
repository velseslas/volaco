# Patch Volaco — Conversation canonique

## Objectif
Le Studio ne doit plus traiter les demandes utilisateur par l'ancien chemin local (templates, `applyIncrementalModification`, appel direct Mistral/Codestral). Le chat principal passe désormais par l'API Conversation du backend.

## Modifications

### Studio — `apps/studio/index.html`
- Remplacement du `handleWorkspacePromptSubmit()` actif par un client du pipeline Conversation API.
- Création/réutilisation d'un projet serveur associé au projet Studio local.
- Synchronisation de `index.html` vers le projet serveur avant l'analyse conversationnelle.
- Création/réutilisation d'une session de conversation.
- Envoi des messages vers `/conversation/sessions/:sessionId/turns`.
- `autoConfirmLowRisk=false` afin que le plan soit présenté avant exécution.
- Affichage réel du plan et de ses étapes dans le chat.
- Boutons `Confirmer et exécuter` / `Refuser`.
- Confirmation puis exécution via les routes Conversation backend.
- Affichage des erreurs réelles sans fallback local silencieux.
- Après exécution, tentative de resynchronisation de `index.html` depuis le serveur vers le Studio.
- Suppression des anciennes fonctions de modification/génération conversationnelle devenues inutilisées : `applyIncrementalModification`, `generateInstantApp`, `hasInstantTemplate`.
- Les appels Mistral restants dans le fichier appartiennent à d'autres fonctions du Studio et ne sont plus utilisés par le chat principal.

### Backend — Conversation / Reasoning
- `ReasoningRequest` accepte maintenant `tenantId` et `projectId`.
- `ConversationEngine` transmet l'identité réelle du projet au provider de raisonnement.
- `ReasoningOrchestrator` utilise le tenant/projet de la requête au lieu de dépendre uniquement de valeurs par défaut.
- `server.ts` injecte `ReasoningOrchestrator` dans `ConversationIntelligenceService` lorsque qu'un provider réel est configuré.

## Validation effectuée ici
- Extraction et syntax-check des 8 blocs JavaScript inline de `apps/studio/index.html` : PASS.
- Recherche du chat principal : aucune référence active à `api.mistral.ai`, `applyIncrementalModification`, `generateInstantApp` ou `hasInstantTemplate` dans le nouveau handler.
- Le build TypeScript complet n'a pas pu être exécuté dans cet environnement car les dépendances Node (`node_modules`) ne sont pas présentes et `npm ci` a dépassé le délai disponible.

## Important
Ce patch corrige le chemin conversationnel du Studio. Il ne prétend pas rendre l'exécution d'agents entièrement réelle si les composants d'exécution sous-jacents ne le sont pas encore. Le test manuel suivant reste obligatoire :

Utilisateur → message → plan visible → confirmation → exécution → fichier serveur modifié → resynchronisation Studio.
