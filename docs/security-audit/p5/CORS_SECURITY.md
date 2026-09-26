# AUDIT DE LA POLITIQUE CORS (CORS_SECURITY)

## 1. Évaluation des Origines Externes

En mode production (`NODE_ENV=production`), la politique CORS est stricte :
- Aucune origine arbitraire ne reçoit d'en-tête `Access-Control-Allow-Origin`.
- Les requêtes preflight `OPTIONS` provenant d'origines non autorisées (`http://evil.com`, `https://attacker.org`, `null`) sont rejetées avec un code **HTTP 403 Forbidden**.
- Aucune présence de `Access-Control-Allow-Origin: *` lorsque `Access-Control-Allow-Credentials: true` est activé.
