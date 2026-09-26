# MATRICE D'AUTORISATION COMPLÈTE (5 RÔLES / ENDPOINTS)
## VOLACO-CORE — CONTRÔLE D'ACCÈS RBAC & LIMITES DE RESSOURCES

| Route HTTP | Méthode | ANONYME | VIEWER | ENGINEER | ADMIN | OWNER | Limite Body | Tier Rate Limit |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `/health` | GET | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | — | DEFAULT |
| `/status` | GET | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | — | DEFAULT |
| `/metrics` (Distant) | GET | ❌ 403 | ❌ 403 | ❌ 403 | ✅ 200 | ✅ 200 | — | DEFAULT |
| `/metrics` (Localhost)| GET | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | — | DEFAULT |
| `/api/v1/auth/session`| POST| ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | 256 Ko | MUTATION |
| `/api/v1/projects` | GET | ❌ 401 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | — | DEFAULT |
| `/api/v1/projects` | POST| ❌ 401 | ❌ 403 | ✅ 201 | ✅ 201 | ✅ 201 | 1 Mo | MUTATION |
| `/api/v1/projects/:id`| GET | ❌ 401 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | — | DEFAULT |
| `/api/v1/projects/:id`| DELETE| ❌ 401 | ❌ 403 | ❌ 403 | ✅ 200 | ✅ 200 | — | MUTATION |
| `/api/v1/projects/:id/files` | GET | ❌ 401 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | — | DEFAULT |
| `/api/v1/projects/:id/files` | POST| ❌ 401 | ❌ 403 | ✅ 201 | ✅ 201 | ✅ 201 | 1 Mo | MUTATION |
| `/api/v1/projects/:id/files/content` | GET | ❌ 401 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | — | DEFAULT |
| `/api/v1/projects/:id/files/content` | PUT | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 | ✅ 200 | 10 Mo | MUTATION |
| `/api/v1/projects/:id/revisions` | GET | ❌ 401 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | — | DEFAULT |
| `/api/v1/projects/:id/revisions` | POST| ❌ 401 | ❌ 403 | ✅ 201 | ✅ 201 | ✅ 201 | 1 Mo | MUTATION |
| `/api/v1/projects/:id/revisions/:rId/rollback` | POST | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 | ✅ 200 | 256 Ko | MUTATION |
| `/api/v1/ai/chat/completions` | POST | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 | ✅ 200 | 1 Mo | AI |
| `/api/v1/audit` | GET | ❌ 401 | ❌ 403 | ❌ 403 | ❌ 403 | ✅ 200 | — | DEFAULT |
| `/api/v1/terminal/execute` | POST | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 | ✅ 200 | 256 Ko | MUTATION |
