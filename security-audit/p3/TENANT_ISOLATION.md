# ISOLATION MULTI-TENANT & IDOR — MISSION P3
**Sous-système :** Stores et Routes API

---

## 1. Mécanisme d'Isolation
* Chaque projet, fichier et révision est partitionné par la clé composite `tenantId:projectId`.
* Le contexte `context.tenantId` est impérativement extrait du jeton Bearer JWT vérifié dans `extractRequestContext`.
* Toute tentative d'accès à un projet appartenant à un autre locataire renvoie formellement un **HTTP 404 (NotFoundError)**, évitant la divulgation d'existence de ressources (Zero Information Leakage).

## 2. Faille Identifiée : Routes d'Analyse Directe
* Dans `apps/api/src/routes/audit.ts` (l. 149), `routes/feedback.ts` (l. 238) et `routes/feature-intelligence.ts` (l. 242) :
```ts
const tenantId = payload.tenantId || context.tenantId;
```
* Cette syntaxe priorise le `tenantId` non vérifié issu du corps JSON de la requête sur le `context.tenantId` du jeton authentifié.
* **Recommandation :** Supprimer `payload.tenantId` et n'utiliser que `context.tenantId`.
