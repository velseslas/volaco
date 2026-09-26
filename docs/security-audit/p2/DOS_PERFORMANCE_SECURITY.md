# RÉSILIENCE ANTI-DOS ET PERFORMANCE SOUS CHARGE
## VOLACO-CORE — GESTION DE LA MÉMOIRE ET RÉSISTANCE AUX SPAMS

### 1. Protection Anti-Épuisement de Tas Mémoire (Heap DoS)
- La table interne des buckets dans `RateLimiter` est strictement bornée à `maxKeys = 10_000`.
- Lors d'une attaque par émission massive d'adresses IP variables, la politique d'éviction LRU supprime immédiatement la clé la plus ancienne.
- Le ramasse-miettes automatique `purgeExpired()` libère les buckets expirés toutes les 60 secondes.
- **Test de charge :** Injection de milliers d'IP artificielles sans aucune croissance non bornée du tas mémoire Node.js (Vecteurs 24 et 25 validés).

### 2. Concurrence et Réactivité de l'Event Loop
- Les opérations de hachage (HMAC-SHA256, SHA-256) utilisent les fonctions natives de `node:crypto` hautement optimisées.
- Aucune boucle bloquante ni calcul synchrone lourd ne s'exécute sur le fil d'exécution principal lors du traitement des requêtes HTTP.
