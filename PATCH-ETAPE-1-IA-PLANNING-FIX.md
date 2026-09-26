# Volaco — Étape 1 corrigée : vrai AI Planning

Cette version corrige le problème observé lors du test « crée un site de fromagerie ».

## Corrections

- Le chat principal du Studio ne passe plus par `hasInstantTemplate()` : les anciens templates ne peuvent plus court-circuiter la conversation.
- Le fichier courant n'est plus synchronisé avant approbation du plan.
- La synchronisation du snapshot local intervient uniquement après l'approbation explicite, juste avant l'exécution.
- Le serveur charge le `.env` local si les variables ne sont pas déjà présentes dans l'environnement du processus.
- Le `ReasoningOrchestrator` est utilisé avec `enableFallback: false` sur le chemin serveur réel : une panne du fournisseur ne devient pas silencieusement un plan déterministe.
- Le modèle `DEFAULT_LLM_MODEL` ou `MISTRAL_MODEL` peut être transmis à l'adaptateur.

## Flux attendu

`Studio → Conversation API → Intent → Application Model → ReasoningOrchestrator → vrai fournisseur IA → plan IA → affichage du plan`

Aucune exécution n'est déclenchée pendant cette étape.
