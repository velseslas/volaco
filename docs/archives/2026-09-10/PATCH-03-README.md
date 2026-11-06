# PATCH-03 — correction chirurgicale

- Production: plus de fallback d’authentification via X-Tenant-ID/X-User-Role.
- Production: pas de clé API par défaut; `VOLACO_API_KEY` est obligatoire pour les routes protégées.
- Production: routes protégées sans Bearer valide => HTTP 401. `/health` et `/status` restent publics pour les probes.
- Retire X-Powered-By et X-XSS-Protection; ajoute Permissions-Policy.
- Corrige la double déclaration `handleAuditRoutes` dans le `dist` Phase 23.

IMPORTANT : ne pas lancer `npm run build`, ne pas supprimer/régénérer `dist`, ne pas remplacer le projet par un ZIP complet. Appliquer uniquement `apply_patch03.ps1`. Les phases 9.5–19 présentes uniquement dans `dist` ne sont pas touchées.
