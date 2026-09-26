# AUDIT DE RÉSILIENCE CONTRE LE DÉNI DE SERVICE (DOS_SECURITY)

## 1. Architecture du Limiteur de Débit (Rate Limiter)

Le middleware de limitation de débit (`apps/api/src/middleware/rate-limiter.ts`) fournit une protection à double détente :
1. **Périmètre Anonyme :** Chaque adresse IP cliente dispose d'une fenêtre glissante indépendante (par défaut 100 requêtes/minute).
2. **Périmètre Authentifié :** Chaque locataire identifié par son jeton JWT vérifié dispose de son propre quota métier (par exemple 1000 requêtes/minute).

## 2. Protection Anti-Épuisement de Quota Frauduleux

- L'en-tête `X-Tenant-Id` ne peut en aucun cas être exploité par un attaquant anonyme pour consommer le quota d'un client légitime : le limiteur ignore purement et simplement cet en-tête s'il n'est pas appuyé par un jeton Bearer cryptographiquement valide (`P4-DOS-01`).
- L'en-tête `X-Forwarded-For` n'est interprété que si la socket distante provient d'un reverse-proxy préalablement déclaré dans la liste blanche `trustedProxies` (`P4-DOS-02`).

## 3. Gestion Bémolisée de la Mémoire Vive (Heap DoS)

- Les caches en mémoire (`MemoryRateLimitStore`, `ConversationSessionLruCache`, etc.) intègrent une politique d'éviction LRU (Least Recently Used) et un nettoyage périodique automatique des clés expirées.
- Le risque de saturation mémoire par génération artificielle d'adresses IP uniques est ainsi borné par une capacité maximale de stockage.
