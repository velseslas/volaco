# ADR-003 : ModÃ¨le Multi-Tenant HermÃ©tique & ContrÃ´le d'AccÃ¨s (RBAC)

- **Statut** : AcceptÃ©
- **Date** : 2026-09-04
- **DÃ©cideur** : Direction Produit & Architecture VibeCode
- **Contexte** : Cahier des Charges V7.0 â€” Phase 1 (FND-003)

## 1. Contexte et ProblÃ©matique
La plateforme doit permettre Ã  plusieurs organisations (Tenants) d'hÃ©berger leurs projets de maniÃ¨re totalement isolÃ©e.
Aucune fuite de donnÃ©es entre locataires ne doit Ãªtre tolÃ©rÃ©e.
De plus, les actions critiques (telle que la suppression d'un projet) doivent Ãªtre rÃ©servÃ©es aux rÃ´les habilitÃ©s.

## 2. DÃ©cision
1. **Isolation Multi-Tenant par Conception** :
   - Toute entitÃ© mÃ©tier (`Project`, `Revision`, `Asset`) contient obligatoirement un champ `tenantId`.
   - Les interfaces de persistence (Stores et futures requÃªtes SQL) exigent le `tenantId` en premier argument obligatoire.
2. **Matrice de ContrÃ´le RBAC** :
   - RÃ´les standardisÃ©s : `OWNER`, `ADMIN`, `ENGINEER`, `VIEWER`.
   - La suppression de projet nÃ©cessite au minimum le rÃ´le `ADMIN`.
   - La tentative d'accÃ¨s Ã  un projet d'un autre locataire renvoie une erreur 404 (pour ne pas rÃ©vÃ©ler l'existence de la ressource).
3. **Propagation du Contexte** :
   - Le middleware d'authentification valide le `tenantId` et le rÃ´le utilisateur, puis les injecte dans le contexte d'exÃ©cution de la requÃªte.

## 3. ConsÃ©quences
- SÃ©curitÃ© renforcÃ©e dÃ¨s le socle de base : impossibilitÃ© structurelle de requÃªter un projet sans spÃ©cifier son tenant.
- Audit et traÃ§abilitÃ© simplifiÃ©s.
