# AUDIT DU SYSTÈME D'AUTORISATION ET RBAC (AUTHORIZATION_SECURITY)

## 1. Matrice des Rôles et Permissions

Le système applique le principe du moindre privilège selon une matrice stricte définie dans `packages/core/src/identity/permissions.ts` :

| Permission | OWNER | ADMIN | ENGINEER | VIEWER |
|---|:---:|:---:|:---:|:---:|
| `PROJECT_CREATE` | ✅ | ✅ | ✅ | ❌ |
| `PROJECT_READ` | ✅ | ✅ | ✅ | ✅ |
| `PROJECT_UPDATE` | ✅ | ✅ | ✅ | ❌ |
| `PROJECT_DELETE` | ✅ | ✅ | ❌ | ❌ |
| `TENANT_MANAGE` | ✅ | ❌ | ❌ | ❌ |
| `PROJECT_MUTATE` | ✅ | ✅ | ✅ | ❌ |

## 2. Points de Contrôle d'Accès

Chaque route d'API et chaque service métier intègre un appel à `assertPermission(context.role, REQUIRED_PERMISSION, requestId)`.

### Résultats des Vérifications Adversariales :
1. **Rôle VIEWER :**
   - Tentative de création de projet (`POST /api/v1/projects`) -> **403 Forbidden** (`P4-RBAC-01`).
   - Tentative de modification de fichier (`POST /api/v1/files/write`) -> **403 Forbidden**.
   - Tentative de rollback de révision -> **403 Forbidden**.
2. **Rôle ENGINEER :**
   - Tentative de suppression de projet (`DELETE /api/v1/projects/:id`) -> **403 Forbidden**.
   - Consultation du journal d'audit global du locataire (`GET /api/v1/audit`) -> **403 Forbidden**.
3. **Escalade Horizontale et Verticale :**
   - L'injection de paramètres `"role": "ADMIN"` ou `"permissions": ["*"]` dans le corps d'une requête est totalement inopérante : les privilèges sont déduits exclusivement du jeton signé côté serveur (`P4-RBAC-02`).
