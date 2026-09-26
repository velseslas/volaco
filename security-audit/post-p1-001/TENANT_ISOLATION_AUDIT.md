# AUDIT DE L'ISOLATION MULTI-TENANT (SEC-003, FND-003)
## VOLACO-CORE — ÉTANCHÉITÉ HERMÉTIQUE DES DONNÉES ENTRE LOCATAIRES

### 1. Cloisonnement au Niveau des Magasins de Données
- Chaque ressource (projet, fichier, révision, événement d'audit) est rattachée de manière immuable à un `tenantId`.
- `ProjectStore` et `FileStore` rejettent toute tentative d'accès à une ressource si le `tenantId` de la requête ne correspond pas exactement au propriétaire de la ressource.

### 2. Protection contre les Attaques Transverses
- **Lecture croisée :** Tentative d'accès à un projet d'un autre tenant renvoie systématiquement un code HTTP 404 (pour masquer l'existence de la ressource) ou 403.
- **Rollback croisé :** L'exécution d'un rollback sur un snapshot appartenant à un autre locataire est strictement bloquée avec une erreur `ForbiddenError`.
- **Validation :** Vecteurs 3 et 14 de `offensive-audit.test.ts` (PASS).
