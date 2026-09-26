# AUDIT DU CONTRÔLE D'ACCÈS ET RBAC (SEC-002, SEC-016, ARCH-01)
## VOLACO-CORE — MATRICE DES DROITS ET AUTHENTIFICATION JWT

### 1. Cycle de Vie des Jetons et Signature Cryptographique
- Les jetons d'authentification sont des Bearer tokens signés par HMAC-SHA256 (`apps/api/src/middleware/auth.ts`).
- Au démarrage, `validateAuthSecret()` vérifie impérativement que la clé secrète `AUTH_SECRET` est configurée, mesure au moins 32 caractères et ne correspond à aucune chaîne par défaut connue.

### 2. Matrice RBAC à 4 Rôles

| Opération | VIEWER | ENGINEER | ADMIN | OWNER |
| :--- | :---: | :---: | :---: | :---: |
| Lecture projets, fichiers, révisions | ✅ | ✅ | ✅ | ✅ |
| Création / modification projets | ❌ | ✅ | ✅ | ✅ |
| Exécution des mutations de code | ❌ | ✅ | ✅ | ✅ |
| Rollback de révision | ❌ | ✅ | ✅ | ✅ |
| Suppression de projet | ❌ | ❌ | ✅ | ✅ |
| Consultation de l'audit trail | ❌ | ❌ | ❌ | ✅ |
| Consultation des métriques système | ❌ | ❌ | ✅ | ✅ |

### 3. Durcissement P1-001 de l'Attribution des Rôles
- **Neutralisation d'usurpation d'auteur :** Dans `apps/api/src/routes/revisions.ts`, `createRevision` et `rollbackTo` affectent `context.role` à la révision créée, ignorant toute tentative de falsification via le corps de la requête.
- **Confinement de la session anonyme :** `POST /api/v1/auth/session` est désactivé hors développement local (`ENABLE_DEV_AUTH_SESSION=true`). En production, aucun utilisateur ne peut obtenir un jeton sans authentification préalable.
