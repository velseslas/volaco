# CARTOGRAPHIE DE LA SURFACE D'ATTAQUE EXTERNE (EXTERNAL_ATTACK_SURFACE)

## 1. Inventaire des Points d'Entrée Réseau

L'exposition réseau par défaut s'effectue sur le port TCP 3000 lié à l'interface `127.0.0.1` (ou configurable via `HOST` et `PORT`).

### Matrice Réelle des Routes Exposées :

| Endpoint | Méthode | Auth Requise | Cloisonnement Tenant | Risque Observé |
|---|:---:|:---:|:---:|---|
| `/`, `/index.html`, `/studio` | GET | Non | Aucun (Statique) | Faible (Distribution du Studio Shell) |
| `/health`, `/api/v1/health` | GET | Non | Aucun | Faible (Sondage d'état système) |
| `/status`, `/api/v1/status` | GET | Non | Aucun | Faible (Statut prêt) |
| `/ai/status`, `/api/v1/ai/status` | GET | Non | Aucun | Faible (Disponibilité Mistral) |
| `/metrics`, `/api/v1/metrics` | GET | Conditionnelle | Aucun | Moyen (Restreint à localhost ou ADMIN/OWNER) |
| `/api/v1/auth/session` | POST | Non | default-tenant | Bloqué en production (`HTTP 403`) |
| `/api/v1/projects` | GET / POST | Bearer JWT | Par Tenant JWT | **ÉLEVÉ : Rate Limiter DoS exploitable** |
| `/api/v1/projects/:id` | GET / PUT / DEL | Bearer JWT | Par Tenant JWT | Faible (IDOR hermétiquement bloqué) |
| `/api/v1/files/read`, `/write` | GET / POST | Bearer JWT | Par Tenant JWT | Faible (Traversée bloquée) |
| `/api/v1/terminal/execute` | POST | Bearer JWT | Par Tenant JWT | Faible (Whitelist stricte, pas de child_process) |
| `/api/v1/audit` | GET | Bearer JWT | Par Tenant JWT (OWNER) | Faible (Cloisonnement validé) |
| `/api/v1/ai/chat/completions` | POST | Bearer JWT | Tenant JWT | **MOYEN : Pas de contrôle RBAC (VIEWER autorisé)** |
