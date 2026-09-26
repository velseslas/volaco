# MATRICE DE SÉCURITÉ DE L'API REST POST-P1-001
## VOLACO-CORE — INVENTAIRE COMPLET DES POINTS D'ACCÈS

| Méthode | Chemin | Auth Requise | Rôle RBAC Min. | Limite Body | Tier Rate Limit | Protection Clé |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `GET` | `/health` | Non | Public | — | DEFAULT | Aucune donnée sensible |
| `GET` | `/status` | Non | Public | — | DEFAULT | Métadonnées de version |
| `GET` | `/metrics` | Oui / Local | ADMIN / Local | — | DEFAULT | Restreint à localhost ou ADMIN |
| `GET` | `/api/v1/metrics` | Oui / Local | ADMIN / Local | — | DEFAULT | Restreint à localhost ou ADMIN |
| `POST` | `/api/v1/auth/session`| Non (Dev seul)| ENGINEER | 256 Ko | MUTATION | Rejet 403 en production |
| `GET` | `/api/v1/projects` | Oui | VIEWER | — | DEFAULT | Filtré par tenantId |
| `POST` | `/api/v1/projects` | Oui | ENGINEER | 1 Mo | MUTATION | Audit trail SHA-256 |
| `GET` | `/api/v1/projects/:id` | Oui | VIEWER | — | DEFAULT | Isolation hermétique |
| `DELETE`| `/api/v1/projects/:id` | Oui | ADMIN | — | MUTATION | Audit trail SHA-256 |
| `POST` | `/api/v1/ai/generate` | Oui | ENGINEER | 1 Mo | AI | Prompt sanitization + Cap 4096 |
| `GET` | `/api/v1/ai/usage` | Oui | VIEWER | — | DEFAULT | Métriques d'usage IA |
| `GET` | `/api/v1/projects/:id/files` | Oui | VIEWER | — | DEFAULT | Isolation hermétique |
| `POST` | `/api/v1/projects/:id/files` | Oui | ENGINEER | 10 Mo | MUTATION | Plafond 10 Mo exclusif fichiers |
| `POST` | `/api/v1/projects/:id/revisions` | Oui | ENGINEER | 1 Mo | MUTATION | Auteur forcé depuis JWT |
| `POST` | `/api/v1/projects/:id/revisions/:rId/rollback` | Oui | ENGINEER | 256 Ko | MUTATION | Auteur forcé depuis JWT |
| `GET` | `/api/v1/audit` | Oui | OWNER | — | DEFAULT | Réservé au rôle OWNER |
