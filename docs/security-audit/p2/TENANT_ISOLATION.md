# AUDIT DE L'ÉTANCHÉITÉ MULTI-TENANT (TENANT ISOLATION)
## VOLACO-CORE — HERMÉTICITÉ ET PRÉVENTION DES FUITES TRANSVERSES

### 1. Invariant d'Isolation Fondamental

Dans l'ensemble de la couche API et des services fondamentaux du monorepo `volaco-core`, le principe suivant est strictement garanti :
> **Le `tenantId` manipulé par les services internes est extrait exclusivement du jeton cryptographique vérifié (`context.tenantId`). Aucun paramètre fourni par le client (URL, query, body) ne peut remplacer cette identité.**

### 2. Validation par les Vecteurs Offensifs Dédiés

- **Projets :** Vecteur 13 (`GET /projects/:id` inter-tenant -> 404), Vecteur 14 (`DELETE /projects/:id` inter-tenant -> 404).
- **Fichiers :** Vecteur 15 (`GET /projects/:id/files/content` -> 404), Vecteur 16 (`PUT /projects/:id/files/content` -> 404).
- **Révisions :** Vecteur 17 (`GET /projects/:id/revisions` -> 404), Vecteur 18 (`POST /rollback` -> 404/403).
- **Audit :** Vecteur 19 (requête d'audit filtrée strictement par `tenantId`).
- **Body Tampering :** Vecteur 20 (fournir `"tenantId": "autre"` dans le corps JSON est totalement ignoré lors de la création).

### 3. État des Lieux des Magasins Virtuels
Tous les magasins en mémoire (`ProjectStore`, `FileStore`, `RevisionStore`, `AuditStore`) utilisent une clé composite `${tenantId}:${resourceId}`, assurant une séparation en mémoire étanche.
