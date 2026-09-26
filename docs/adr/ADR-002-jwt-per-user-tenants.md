# ADR-002 — Authentification : JWT par utilisateur, tenant dédié par compte

**Décision :** `POST /auth/signup` et `/auth/login` délivrent un JWT HMAC-SHA256
(AUTH_SECRET) contenant tenantId + rôle. Le middleware déduit le contexte du
token SIGNÉ : le header X-User-Role du client n'est plus une autorité.

**Contexte :** une seule clé Bearer partagée (VOLACO_API_KEY) et un tenant
studio-local codé en dur rendaient la multi-tenancy théorique.

**Alternatives :** sessions cookies (rejeté : API publique prévue, tokens
portables) ; OAuth/SSO (reporté Phase 4 Enterprise).

**Conséquences :** isolation cross-tenant testée (utilisateur B -> 404 sur les
projets de A) ; la clé admin et le fallback headers dev sont conservés en
développement (zéro rupture locale) ; AUTH_SECRET requis en production.

**Statut :** ACTIVE
