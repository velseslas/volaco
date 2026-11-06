# Volaco — Étape AI Planning

Cette étape corrige uniquement la génération du plan conversationnel.

## Objectif
Le plan affiché après une demande CREATE/MODIFY/REFACTOR/DEBUG/OPTIMIZE/DELETE doit provenir du fournisseur IA réel lorsqu'il est disponible, avec le contexte réel du projet. Le générateur déterministe reste uniquement un fallback pour les appels de test/offline qui n'injectent aucun ReasoningProvider.

## Flux
Studio → Conversation API → ConversationEngine → ReasoningOrchestrator → provider réel → JSON structuré → EngineeringPlan → validation → affichage du plan.

## Garanties
- pas de plan générique à 3 étapes lorsque le provider IA réel est utilisé ;
- le contexte Application Semantic Model est envoyé au modèle ;
- tenantId/projectId de la session sont propagés au provider ;
- le plan IA est hashé avec le mécanisme canonique existant ;
- si la réponse IA ne peut pas être convertie en plan, aucun plan déterministe n'est substitué silencieusement ;
- les modifications de fichiers ne sont pas exécutées par cette étape.

## Validation locale
Le dépôt fourni ne contient pas `node_modules`, donc Gate2/build complet ne peut pas être exécuté dans cet environnement. Le `tsc` global a uniquement remonté les dépendances/types Node absents du dépôt (problème préexistant d'environnement), sans erreur spécifique dans `reasoning-orchestrator.ts` ou `types.ts` au-delà de ces types manquants.
