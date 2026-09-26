# ANALYSE DE LA SURFACE D'ATTAQUE POST-P1-001
## VOLACO-CORE — CARTOGRAPHIE ET FRONTIÈRES DE SÉCURITÉ

### 1. Frontière Réseau & Contrôle d'Accès Périmétrique

```
Client Inconnu (Internet Public)
       │
       ├──► [RateLimiter : Quotas stricts + Filtrage XFF non approuvé]
       │       │ Rejet 429 si quota dépassé
       │
       ├──► [CORS Guard : Origines autorisées uniquement]
       │       │ Rejet 403 sur preflight inconnu
       │
       ├──► [Body Parser : Plafond mémoire 1 Mo / 256 Ko / 10 Mo]
       │       │ Rejet 413 si taille excédée
       │
       ├──► [Auth Guard : Vérification Bearer JWT HMAC-SHA256]
       │       │ Rejet 401 si token absent / invalide / expiré
       │
       ▼
   API Routes Protégées (RBAC + Isolation Multi-Tenant Hermétique)
```

### 2. Endpoints Publics (Sans Authentification)

Seuls 2 endpoints HTTP sont accessibles publiquement :
1. `GET /health` (ou `/api/v1/health`) : État de santé basique du service (uptime, timestamp). Ne divulgue aucune information sensible.
2. `GET /status` (ou `/api/v1/status`) : Version et architecture du serveur.
3. `GET /` (Studio HTML) : En production, ne contient aucun token de session pré-généré.

### 3. Endpoints Protégés par Contrôle Strict

- **`GET /metrics` & `GET /api/v1/metrics` :** Protégé par contrôle de socket loopback (`127.0.0.1` / `::1`) ou Bearer token de rôle `ADMIN`/`OWNER` ou `METRICS_TOKEN`.
- **`POST /api/v1/auth/session` :** Rejeté avec HTTP 403 Forbidden en production. Activable uniquement en développement local avec la variable `ENABLE_DEV_AUTH_SESSION=true`.
- **Distribution Statique (`apps/studio/*`) :** Filtrée par `path.resolve` canonique avec vérification stricte du préfixe de racine. Tout chemin contenant `..` ou tentant de sortir du dossier racine renvoie un code HTTP 403 Forbidden.

### 4. Sandbox Frontend & Isolation de l'Iframe Preview

- L'iframe de prévisualisation dans Studio est configurée avec `sandbox="allow-scripts"`. L'attribut critique `allow-same-origin` est **strictement absent**.
- Les communications inter-fenêtres utilisent `window.postMessage` avec vérification obligatoire de l'origine et de l'expéditeur (`event.source`).
- Aucun script tiers dynamique non haché n'est injecté dans le contexte du Studio.
