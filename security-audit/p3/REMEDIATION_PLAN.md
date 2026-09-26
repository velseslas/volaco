# PLAN DE REMÉDIATION POST-AUDIT P3
**Priorités d'action pour rendre volaco-core éligible à la production Internet.**

---

### Phase 1 : Remédiations Critiques Immédiates (Bloquantes pour Internet)
1. **Verrouillage du Bind Réseau :**
   - Forcer `server.listen(config.port, '127.0.0.1')` ou imposer un reverse proxy TLS obligatoire (Nginx/Caddy) devant l'API.
2. **Suppression du Fallback de Secret en Production :**
   - Rendre le crash au démarrage obligatoire si `AUTH_SECRET` est absent, quelle que soit la valeur de `NODE_ENV`.
3. **Sécurisation du Rate Limiter Multi-Tenant :**
   - Ne plus utiliser l'en-tête `X-Tenant-Id` non authentifié pour le quota de requêtes. Le quota par tenant ne doit s'appliquer qu'aux requêtes authentifiées munies d'un JWT valide.

### Phase 2 : Remédiations Majeures d'Intégrité
4. **Persistance Durable de l'Audit et des Révisions :**
   - Sauvegarder les snapshots et les événements d'audit sur disque persistant (SQLite ou PostgreSQL).
5. **En-têtes de Sécurité HTTP :**
   - Injecter systématiquement :
     `X-Content-Type-Options: nosniff`
     `X-Frame-Options: SAMEORIGIN`
     `Referrer-Policy: strict-origin-when-cross-origin`
     `Strict-Transport-Security: max-age=31536000; includeSubDomains`
6. **Suppression de `payload.tenantId` :**
   - Dans `routes/audit.ts`, `routes/feedback.ts` et `routes/feature-intelligence.ts`, n'utiliser que `context.tenantId`.
7. **Verrouillage de Confirmation dans `ExecutionBridge` :**
   - Exiger `plan.status === 'APPROVED'` avant toute transmission à l'Agent Runtime.
