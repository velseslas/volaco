# CARTOGRAPHIE DE LA SURFACE D'ATTAQUE POST-P2
## VOLACO-CORE — FRONTIÈRES PÉRIMÉTRIQUES ET POINTS DE CONTRÔLE

```
┌────────────────────────────────────────────────────────────────────────┐
│                        INTERNET PUBLIC / CLIENTS                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     NIVEAU 1 : CONTRÔLE RÉSEAU                         │
│  • Rate Limiter : filtrage trusted proxies, quota par tier, LRU 10k   │
│  • CORS Guard : whitelist stricte d'origines, rejet preflight 403      │
│  • Body Limits : 1 Mo (JSON), 256 Ko (Settings), 10 Mo (Files)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   NIVEAU 2 : AUTHENTIFICATION & ROLES                  │
│  • Endpoints publics : /health, /status, / (sans session injectée)    │
│  • Endpoint /metrics : Restreint loopback local ou ADMIN/OWNER        │
│  • Endpoint /auth/session : Désactivé en production (HTTP 403)         │
│  • Routes API : Bearer Token HMAC-SHA256 obligatoire (Secret >=32)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               NIVEAU 3 : ISOLATION MULTI-TENANT & RBAC                 │
│  • Contexte injecté immuable : context.tenantId + context.role         │
│  • ProjectStore, FileStore, RevisionStore cloisonnés hermétiquement    │
│  • Auteur de révision forcé depuis le JWT (payload.author ignoré)      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 NIVEAU 4 : SÉCURITÉ IA & RUNTIME AGENTIQUE             │
│  • Assainissement des invites : encadrement XML, balises neutralisées  │
│  • Plafonnement des coûts : cap 4096 tokens, concurrence max 5/tenant │
│  • MutationExecutor : deny-by-default (allowBreaking/HighRisk = false) │
│  • Confirmation humaine obligatoire pour toute mutation destructive    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 NIVEAU 5 : FRONTEND & SANDBOX IFRAME                   │
│  • Preview Iframe : sandbox="allow-scripts", sans allow-same-origin    │
│  • Bridge postMessage : validation event.source, rejet commandes actives│
│  • Liens popout : rel="noopener noreferrer" systématique               │
│  • Supply Chain : SRI SHA-512 sur CDN, exclusion Tailwind dynamique    │
└────────────────────────────────────────────────────────────────────────┘
```
