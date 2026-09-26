# ADR-002 : API HTTP Native & ObservabilitÃ© de Bout en Bout

- **Statut** : AcceptÃ©
- **Date** : 2026-09-04
- **DÃ©cideur** : Direction Technique & Architecture VibeCode
- **Contexte** : Cahier des Charges V7.0 â€” Phase 1 (FND-002)

## 1. Contexte et ProblÃ©matique
Le bloc FND-002 doit exposer le premier point de contact HTTP (API) entre le client Studio et le Core.
Il est impÃ©ratif d'assurer :
1. Une traÃ§abilitÃ© de bout en bout (chaque requÃªte doit avoir un identifiant unique).
2. Un serveur lÃ©ger, fiable, sans vulnÃ©rabilitÃ©s de dÃ©pendances superflues.
3. Une isolation stricte : l'interface utilisateur ne doit jamais appeler la couche de donnÃ©es sans passer par l'API.

## 2. DÃ©cision
1. **Moteur HTTP** : Utilisation du module natif standard `node:http`.
2. **Correlation / Request ID** : Tout appel entrant reÃ§oit un en-tÃªte `X-Request-Id` (gÃ©nÃ©rÃ© ou propagÃ©). Cet identifiant est inclus dans les logs JSON structurÃ©s et dans le corps de rÃ©ponse.
3. **Format d'erreur unifiÃ©** : Format `{ "error": { "code", "message", "statusCode", "requestId" } }`.
4. **Healthcheck standardisÃ©** : Route `/health` exposant Ã©tat, version, horodatage et uptime.

## 3. ConsÃ©quences
- ZÃ©ro dÃ©pendance tierce Ã  maintenir pour le serveur HTTP de base.
- TraÃ§abilitÃ© immÃ©diate lors des diagnostics et des audits.
- PrÃ©paration propre pour l'intÃ©gration de la couche d'identitÃ© (FND-003).
