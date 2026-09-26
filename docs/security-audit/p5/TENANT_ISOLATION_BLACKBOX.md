# AUDIT DE L'ISOLATION MULTI-TENANT EN BOÎTE NOIRE (TENANT_ISOLATION_BLACKBOX)

## 1. Épreuves d'IDOR Réelles

Deux locataires étanches ont été provisionnés sur l'instance réelle (`tenant-a` et `tenant-b`).

### Résultats des Tentatives d'Exfiltration :
1. **Accès direct par identifiant de ressource :**
   - Requête : `GET /api/v1/projects/proj_31de7aea7bed` avec jeton de `tenant-b` (projet appartenant à `tenant-a`).
   - Résultat : **HTTP 404 Not Found**. L'application ne renvoie ni 403 (ce qui confirmerait l'existence du projet), ni métadonnées. L'existence est dissimulée.
2. **Recherche et Catalogage :**
   - Requête : `GET /api/v1/projects` avec jeton de `tenant-b`.
   - Résultat : Seuls les projets appartenant strictement à `tenant-b` sont retournés. Aucune fuite dans la pagination ou les tableaux.
3. **Usurpation par Corps JSON (`tenantId` Injection) :**
   - Requête : `POST /api/v1/projects` avec jeton de `tenant-a` et corps `{"name": "Spoof", "tenantId": "tenant-b"}`.
   - Résultat : Le projet est créé sous `tenant-a`. La valeur dans le JSON est totalement ignorée au profit du contexte cryptographique du jeton.
4. **Piste d'Audit :**
   - Requête : `GET /api/v1/audit` avec jeton OWNER de `tenant-b`.
   - Résultat : 0 événement d'audit appartenant à `tenant-a` n'est exposé.
