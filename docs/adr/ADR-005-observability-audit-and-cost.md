# ADR-005 : ObservabilitÃ©, Journal d'Audit & Gouvernance des CoÃ»ts IA

- **Statut** : AcceptÃ©
- **Date** : 2026-09-04
- **DÃ©cideur** : Direction Technique & Finance VibeCode
- **Contexte** : Cahier des Charges V7.0 â€” Phase 1 (FND-005)

## 1. Contexte et ProblÃ©matique
Une plateforme de dÃ©veloppement assistÃ©e par IA manipule des opÃ©rations sensibles et engendre des coÃ»ts de calcul variables (tokens de modÃ¨les LLM).
Il est impÃ©ratif :
1. D'interdire formellement toute fuite de secrets ou de tokens d'authentification dans les logs.
2. D'enregistrer chaque action critique dans un journal d'audit infalsifiable et cloisonnÃ© par locataire.
3. De suivre au centime prÃ¨s la consommation des tokens d'entrÃ©e et de sortie pour chaque projet et organisation.

## 2. DÃ©cision
1. **Masquage Automatique des DonnÃ©es Sensibles** :
   - Un assainisseur rÃ©cursif censure automatiquement les valeurs associÃ©es aux clÃ©s `apiKey`, `password`, `token`, `secret`, `authorization`.
2. **Journal d'Audit Immuable ScrutÃ© par Tenant** :
   - Chaque opÃ©ration structurante (`PROJECT_CREATE`, `PROJECT_DELETE`, `ROLLBACK_TRIGGERED`) gÃ©nÃ¨re un `AuditEvent` horodatÃ© avec son `requestId`.
3. **Moteur de MÃ©triques SystÃ¨me & Latence** :
   - Mesure de la durÃ©e d'exÃ©cution de chaque appel HTTP en millisecondes et suivi des taux d'erreurs (4xx / 5xx).
4. **Calculateur Financier des ModÃ¨les IA** :
   - BarÃ¨me de coÃ»ts en dollars par million de tokens pour chaque modÃ¨le pris en charge (ex. Codestral, Mistral Large).

## 3. ConsÃ©quences
- Fin de la Phase 1 (Foundation) avec un socle sÃ©curisÃ©, observable, auditÃ© et mesurÃ© financiÃ¨rement.
- PrÃ©paration sereine pour le dÃ©marrage de la Phase 2 (Core Application).
