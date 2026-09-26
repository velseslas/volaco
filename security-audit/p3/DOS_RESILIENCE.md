# RÉSILIENCE FACE AU DÉNI DE SERVICE (DOS) — MISSION P3
**Composants :** `RateLimiter`, `readBody`

---

## 1. Protection Mémoire (Heap DoS)
* Le `RateLimiter` utilise une capacité maximale bornée (`maxKeys = 10 000`).
* Lorsque la limite est atteinte, une purge par expiration puis une éviction LRU (Least Recently Used) est effectuée.
* Testé en charge avec rotation massive de 500 clés : la mémoire reste strictement bornée sans fuite mémoire.

## 2. Faiblesse Détectée : Déni de Service par Épuisement de Quota Tenant
* `RateLimiter.check` évalue `req.headers['x-tenant-id']` avant que la requête ne soit authentifiée.
* Un attaquant anonyme peut envoyer 60 requêtes avec l'en-tête d'un locataire tiers pour bloquer toutes ses mutations.
