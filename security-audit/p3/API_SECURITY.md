# SÉCURITÉ DE L'API REST — MISSION P3
**Sous-système :** `apps/api/src/server.ts`

---

## 1. Traitement des Requêtes et Codes HTTP
* 400 : Requête malformée ou validation échouée.
* 401 : Absence de jeton Bearer, jeton altéré ou expiré.
* 403 : Rôle insuffisant (RBAC) ou tentative de path traversal.
* 404 : Ressource introuvable ou locataire non propriétaire (IDOR).
* 413 : Payload trop volumineux (dépassement de `maxBytes`).
* 429 : Quota de requêtes dépassé (Rate Limiting).
* 502 : Défaillance de l'amont Mistral AI.

## 2. Robustesse face aux Données Malformées
* Corps JSON invalides interceptés avec retour 400 propre (pas de crash du processus).
* Arborescences JSON profondément imbriquées désérialisées sans dépassement de pile.
* Tailles de corps bornées : 1 Mo par défaut, 10 Mo pour les transferts de fichiers.
