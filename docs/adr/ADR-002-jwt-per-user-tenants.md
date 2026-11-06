# ADR-002 — Authentification : JWT par utilisateur, tenant dédié par compte

**Décision :** `POST /auth/signup` et `/auth/login` délivrent un JWT HMAC-SHA256
contenant tenantId + rôle. Le middleware déduit le contexte du
token SIGNÉ : le header X-User-Role du client n'est plus une autorité.

> **MISE À JOUR (LOT B, Phase 2 sécurité, 2026-11-05) — SECRET DÉDIÉ.**
> Le JWT n'est PLUS signé avec `AUTH_SECRET`. Il est signé avec un secret
> **dédié** `VOLACO_JWT_SECRET` (base64 canonique ≥ 32 octets), indépendant de
> `VOLACO_API_KEY` et de `AUTH_SECRET`. Le service **refuse de démarrer** si ce
> secret est absent ou invalide. Le jeton porte en outre `sv` (version de
> session) et `jti`, ce qui permet la révocation côté serveur (`POST
> /auth/logout`). Voir `.env.example` [SEC-001] et `mcp-lot-b-report.md`.

**Contexte :** une seule clé Bearer partagée (VOLACO_API_KEY) et un tenant
studio-local codé en dur rendaient la multi-tenancy théorique.

**Alternatives :** sessions cookies (rejeté : API publique prévue, tokens
portables) ; OAuth/SSO (reporté Phase 4 Enterprise).

**Conséquences :** isolation cross-tenant testée (utilisateur B -> 404 sur les
projets de A) ; la clé admin et le fallback headers dev sont conservés en
développement (zéro rupture locale) ; AUTH_SECRET requis en production.

**Statut :** ACTIVE
