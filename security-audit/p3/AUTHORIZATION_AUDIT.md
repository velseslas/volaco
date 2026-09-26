# MATRICE ET AUDIT D'AUTORISATION (RBAC) — MISSION P3
**Sous-système :** `packages/core/src/identity/permissions.ts`

---

## Matrice des Rôles et Permissions

| Action / Ressource | VIEWER | ENGINEER | ADMIN | OWNER |
| :--- | :---: | :---: | :---: | :---: |
| **PROJECT_READ** (Lecture projets, fichiers, révisions) | ✅ | ✅ | ✅ | ✅ |
| **PROJECT_CREATE** (Création de nouveaux projets) | ❌ | ✅ | ✅ | ✅ |
| **PROJECT_UPDATE** (Édition code, fichiers, snapshot) | ❌ | ✅ | ✅ | ✅ |
| **PROJECT_MUTATE** (Mutations IA, Agent Runtime, Plan) | ❌ | ✅ | ✅ | ✅ |
| **PROJECT_DELETE** (Suppression irréversible de projet) | ❌ | ❌ | ✅ | ✅ |
| **TENANT_MANAGE** (Gestion paramètres tenant, audit global)| ❌ | ❌ | ❌ | ✅ |

### Constats de Vérification Réelle
* **Rejet strict sur VIEWER :** Toutes les tentatives de création, modification ou suppression par un rôle VIEWER sont interceptées par `assertPermission` et renvoient HTTP 403.
* **Séparation ENGINEER / ADMIN :** Seuls ADMIN et OWNER peuvent supprimer un projet. Les ingénieurs ne disposent que des droits d'évolution et d'édition.
* **Cohérence :** 100% conforme à la spécification RBAC FND-003.
