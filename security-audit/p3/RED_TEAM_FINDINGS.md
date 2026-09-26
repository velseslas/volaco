# RED TEAM FINDINGS — MISSION P3
**Méthode :** Tests d'intrusion boîte blanche automatisés & analyse statique approfondie.

---

## FINDING P3-001 (CRITICAL) : Exposition Réseau Involontaire sur 0.0.0.0 sans Chiffrement TLS
* **Vecteur :** Écoute TCP sans liaison d'interface explicite.
* **Preuve :** `server.listen(config.port)` écoute sur `0.0.0.0:3000` et `[::]:3000`.
* **Impact :** Si la machine dispose d'une IP publique ou d'un réseau local partagé, l'API et le Studio sont accessibles directement en clair sans chiffrement TLS.

## FINDING P3-002 (HIGH) : Secret Cryptographique Faible et Injection de Session en Mode Hors-Production
* **Vecteur :** Fallback statique dans `server.ts` (`volaco-core-dev-session-secure-auth-secret-key-32chars`).
* **Preuve :** `dist/apps/api/src/server.js` l. 392 et `apps/api/src/server.ts` l. 423.
* **Impact :** Si `NODE_ENV` n'est pas défini, un attaquant peut forger n'importe quel jeton JWT ou appeler `POST /api/v1/auth/session` pour obtenir un jeton `ENGINEER`.

## FINDING P3-003 (HIGH) : Déni de Service de Quota Multi-Tenant par un Appelant Anonyme
* **Vecteur :** Évaluation de l'en-tête non authentifié `X-Tenant-Id` dans `RateLimiter.check()`.
* **Preuve :** `rate-limiter.ts` l. 210 (`req.headers['x-tenant-id']`) exécuté à la ligne 82 de `server.ts` avant `extractRequestContext` (l. 288).
* **Impact :** Un pirate sans jeton d'authentification valide peut envoyer 60 requêtes avec `X-Tenant-Id: victim-tenant` pour consommer le quota du tenant ciblé et lui renvoyer un HTTP 429.

## FINDING P3-004 (HIGH) : Évanescence de la Piste d'Audit et Perte d'Intégrité au Crash
* **Vecteur :** Absence de persistance sur disque ou base de données pour `AuditStore`.
* **Preuve :** `packages/core/src/observability/audit.ts` stocke les événements dans `private records: AuditRecord[] = []`.
* **Impact :** Un attaquant ayant effectué des actions non autorisées peut déclencher un crash ou attendre un redémarrage pour effacer l'intégralité des traces médico-légales.

## FINDING P3-005 (MEDIUM) : Usurpation de Contexte Locataire dans les Routes d'Analyse Directe
* **Vecteur :** Acceptation de `payload.tenantId` dans `POST /api/v1/audit`, `POST /api/v1/feedback`, `POST /api/v1/features`.
* **Preuve :** `routes/audit.ts` l. 149 (`const tenantId = payload.tenantId || context.tenantId;`).
* **Impact :** Un utilisateur de Tenant A peut générer des analyses associées à l'identifiant de Tenant B.

## FINDING P3-006 (MEDIUM) : Dérivation du Cycle de Confirmation de l'Agent Runtime
* **Vecteur :** `ExecutionBridge.canExecute` autorise l'état `PLANNING`.
* **Preuve :** `packages/core/src/ai-native/conversation-intelligence/engine/execution-bridge.ts` l. 29.
* **Impact :** Un plan proposé mais non approuvé par l'utilisateur peut être exécuté directement si `executeApprovedPlan` est appelé.
