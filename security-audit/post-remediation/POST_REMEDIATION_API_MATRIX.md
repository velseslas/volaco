# MATRICE DE SÉCURITÉ DE L'API HTTP POST-REMÉDIATION
## VOLACO-CORE — AUDIT EXHAUSTIF DES 38+ ENDPOINTS ET CONTRÔLES APPLIQUÉS

**Périmètre :** Serveur API REST `apps/api/src/server.ts` et ensemble des routeurs (`apps/api/src/routes/*.ts`)  
**Date d'évaluation :** 11 Septembre 2026  

---

### Matrice Exhaustive des Endpoints HTTP

| # | Endpoint | Méthode | Auth Exigée | Permission RBAC | Isolation Tenant | Validation Entrées | Rate Limit Tier | Masquage Secrets | Risque Résiduel |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1** | `/`, `/index.html`, `/studio` | `GET` | Aucune (Public) | Aucune | `default-tenant` auto-injecté | Statique (Fichier local) | Exempt | N/A | Faible (Token default public) |
| **2** | `/:staticStudioFile` | `GET` | Aucune (Public) | Aucune | Global | Filtre `!includes('..')` | Exempt | N/A | Moyen (SEC-005) |
| **3** | `/health`, `/api/v1/health` | `GET` | Aucune (Public) | Aucune | Global | Aucune | Exempt | N/A | Négligeable |
| **4** | `/status`, `/api/v1/status` | `GET` | Aucune (Public) | Aucune | Global | Aucune | Exempt | N/A | Négligeable |
| **5** | `/metrics`, `/api/v1/metrics`| `GET` | Aucune (Public) | Aucune | Global (Statistiques inter-tenants) | Aucune | Exempt | N/A | Faible (SEC-015) |
| **6** | `/api/v1/auth/session` | `POST` | Aucune (Public) | Aucune | Émet token `default-tenant` | Aucune | MUTATION (60/m) | Jeton Bearer | Moyen (Délivrance anonyme) |
| **7** | `/api/v1/ai/chat/completions` | `POST` | Bearer JWT | Rôle valide | `context.tenantId` | Concurrence (max 5) & Tokens (max 4096) | AI (20/m) | Clé Mistral masquée | Faible |
| **8** | `/api/v1/audit` | `GET` | Bearer JWT | `TENANT_MANAGE` (OWNER) | `context.tenantId` | Query tenant | DEFAULT (120/m) | Secrets masqués | Négligeable |
| **9** | `/api/v1/ai/usage` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | Aucune | DEFAULT (120/m) | N/A | Négligeable |
| **10** | `/api/v1/dashboard` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | Aucune | DEFAULT (120/m) | N/A | Négligeable |
| **11** | `/api/v1/projects` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | Aucune | DEFAULT (120/m) | N/A | Négligeable |
| **12** | `/api/v1/projects` | `POST` | Bearer JWT | `PROJECT_CREATE` | `context.tenantId` | JSON parse + `name` requis | MUTATION (60/m) | N/A | Faible |
| **13** | `/api/v1/projects/:id` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | ID projet | DEFAULT (120/m) | N/A | Négligeable |
| **14** | `/api/v1/projects/:id` | `DELETE`| Bearer JWT | `PROJECT_DELETE` (ADMIN/OWNER) | `context.tenantId` | ID projet | MUTATION (60/m) | N/A | Négligeable |
| **15** | `.../workspace` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | ID projet | DEFAULT (120/m) | N/A | Négligeable |
| **16** | `.../workspace/close` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | ID projet | MUTATION (60/m) | N/A | Négligeable |
| **17** | `.../state` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | ID projet | DEFAULT (120/m) | N/A | Négligeable |
| **18** | `.../state/transition` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | JSON parse + transitions valides | MUTATION (60/m) | N/A | Faible |
| **19** | `.../state/validate` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | ID projet | MUTATION (60/m) | N/A | Faible |
| **20** | `.../shell` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | ID projet | DEFAULT (120/m) | N/A | Négligeable |
| **21** | `.../activity` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | ID projet | DEFAULT (120/m) | N/A | Négligeable |
| **22** | `.../activity` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | JSON parse + type validation | MUTATION (60/m) | N/A | Faible |
| **23** | `.../settings` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | ID projet | DEFAULT (120/m) | DSN & Clés masqués | Négligeable |
| **24** | `.../settings` | `PUT` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | JSON parse + taille 256KB | MUTATION (60/m) | DSN & Clés masqués | Faible |
| **25** | `.../files/content` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | `path` assaini anti-traversal | DEFAULT (120/m) | N/A | Négligeable |
| **26** | `.../files/content` | `PUT` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | JSON parse + path assaini | MUTATION (60/m) | N/A | Faible |
| **27** | `.../files` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | ID projet | DEFAULT (120/m) | N/A | Négligeable |
| **28** | `.../files` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | JSON parse + path assaini | MUTATION (60/m) | N/A | Faible |
| **29** | `.../files` | `DELETE`| Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | Query `path` assaini | MUTATION (60/m) | N/A | Faible |
| **30** | `.../files/rename` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | JSON parse + chemins | MUTATION (60/m) | N/A | Faible |
| **31** | `.../files/move` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | JSON parse + chemins | MUTATION (60/m) | N/A | Faible |
| **32** | `.../terminal/exec` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | Whitelist binaire stricte | MUTATION (60/m) | Secrets masqués | Faible |
| **33** | `.../revisions` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | ID projet | DEFAULT (120/m) | N/A | Négligeable |
| **34** | `.../revisions` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | JSON parse + `payload.author` | MUTATION (60/m) | N/A | Moyen (SEC-016) |
| **35** | `.../revisions/:id` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | ID révision | DEFAULT (120/m) | N/A | Négligeable |
| **36** | `.../revisions/:id/rollback`| `POST`| Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | ID révision | MUTATION (60/m) | N/A | Faible |
| **37** | `.../evolution/analyze` | `POST`/`GET`| Bearer JWT | `PROJECT_READ` | `context.tenantId` | JSON contextes optionnels | DEFAULT / MUTATION | N/A | Faible |
| **38** | `.../evolution/proposals` | `GET` | Bearer JWT | `PROJECT_READ` | `context.tenantId` | ID projet | DEFAULT (120/m) | N/A | Négligeable |
| **39** | `.../evolution/proposals/:id/decision` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | JSON décision (APPROVE/REJECT...) | MUTATION (60/m) | N/A | Faible |
| **40** | `.../evolution/proposals/:id/handoff` | `POST` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | Statut doit être APPROVED | MUTATION (60/m) | N/A | Faible |
| **41** | `.../evolution` | `DELETE` | Bearer JWT | `PROJECT_UPDATE` | `context.tenantId` | ID projet | MUTATION (60/m) | N/A | Faible |

---

### Synthèse des Vulnérabilités d'Endpoints

1. **Absence de liaison d'identité sur les révisions (#34) :**
   L'endpoint `POST /api/v1/projects/:projectId/revisions` accepte un champ `payload.author` libre sans vérifier sa cohérence avec l'identité de l'appelant dans le jeton Bearer (SEC-016).
2. **Fuite de métriques opérationnelles (#5) :**
   L'endpoint `/metrics` est public sans aucune restriction RBAC, divulguant la santé du système et les volumes d'appels à des tiers (SEC-015).
3. **Plafond de taille uniforme à 10 Mo :**
   Seul l'endpoint `/settings` applique `MAX_BODY_BYTES_SMALL` (256 Ko). Tous les autres endpoints acceptent jusqu'à 10 Mo en mémoire vive avant rejet.
