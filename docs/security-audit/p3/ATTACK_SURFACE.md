# SURFACE D'ATTAQUE GLOBALE — MISSION P3
**Architecture :** Modular Monolith Node.js (TypeScript) + Vanilla Web Studio Shell

---

## 1. Cartographie des Points d'Entrée HTTP

| Point d'Entrée | Méthode | Auth Requise | Contrôle d'Accès | Risque Identifié |
| :--- | :--- | :--- | :--- | :--- |
| `/`, `/index.html`, `/volaco_studio.html` | GET | Non (Public) | Aucun | Injection de token de session si non-prod |
| `/health`, `/api/v1/health` | GET | Non (Public) | Aucun | Information Disclosure mineure |
| `/status`, `/api/v1/status` | GET | Non (Public) | Aucun | Divulgation de version |
| `/ai/status`, `/api/v1/ai/status` | GET | Non (Public) | Aucun | Détection de clé serveur |
| `/metrics`, `/api/v1/metrics` | GET | Restreint | Localhost ou ADMIN/OWNER | Spoofable si proxy non configuré |
| `/api/v1/auth/session` | POST | Non | Activé si hors production | Délivrance de token non restreinte |
| `/api/v1/projects` | GET, POST | Oui (Bearer) | PROJECT_READ, PROJECT_CREATE | Quota rate limit par tenant |
| `/api/v1/projects/:id` | GET, DELETE | Oui (Bearer) | PROJECT_READ, PROJECT_DELETE | Étanchéité vérifiée |
| `/api/v1/projects/:id/files` | GET, POST | Oui (Bearer) | PROJECT_READ, PROJECT_UPDATE | Virtualisé en mémoire |
| `/api/v1/projects/:id/files/content` | GET, PUT | Oui (Bearer) | PROJECT_READ, PROJECT_UPDATE | Path Traversal neutralisé |
| `/api/v1/projects/:id/terminal/execute` | POST | Oui (Bearer) | PROJECT_UPDATE | Émulateur déterministe (zéro spawn) |
| `/api/v1/projects/:id/revisions` | GET, POST | Oui (Bearer) | PROJECT_READ, PROJECT_UPDATE | In-memory snapshots |
| `/api/v1/projects/:id/revisions/:id/rollback` | POST | Oui (Bearer) | PROJECT_UPDATE | Rollback en mémoire |
| `/api/v1/ai/chat/completions` | POST | Oui (Bearer) | PROJECT_MUTATE | Proxy Mistral contrôlé |
| `/api/v1/audit` | POST | Oui (Bearer) | PROJECT_READ | `payload.tenantId` accepté |
| `/api/v1/feedback` | POST | Oui (Bearer) | PROJECT_READ | `payload.tenantId` accepté |
| `/api/v1/features` | POST | Oui (Bearer) | PROJECT_READ | `payload.tenantId` accepté |

## 2. Frontière Inter-Processus & Système Hôte
* **Processus Hôte :** Aucun processus fils n'est créé (`child_process` absent de `packages/core` et `apps/api`).
* **Système de fichiers :** Le `FileStore` est entièrement virtualisé dans un `Map` en mémoire. Seule la distribution de `apps/studio` lit le disque réel.
