# AUDIT DE RÉALITÉ DÉNI DE SERVICE (DOS_REALITY)

## 1. Vulnérabilité Majeure : Déni de Service Inter-Locataires par Falsification JWT

### Description Technique de la Faille :
Dans `apps/api/src/middleware/rate-limiter.ts`, la méthode privée `getTenantId` extrait le `tenantId` pour appliquer le quota :
```typescript
const parts = token.split('.');
if (parts.length === 3 && parts[1]) {
  const payload = JSON.parse(base64UrlDecode(parts[1]));
  if (payload && payload.tenantId) {
    return payload.tenantId.trim();
  }
}
```
**Analyse de la cause première :** Le middleware décode la charge utile base64url du jeton SANS vérifier la signature HMAC-SHA256 via `verifyAuthToken()`.

### Démonstration de l'Exploitation :
1. L'attaquant externe forge un jeton avec `{"tenantId": "victime"}` et une fausse signature.
2. L'attaquant bombarde `POST /api/v1/projects` avec ce jeton.
3. Le rate limiter incrémente le bucket `tenant:victime:DEFAULT`.
4. La route rejette l'attaquant avec `401 Unauthorized` car la signature est invalide... MAIS LE BUCKET A DÉJÀ ÉTÉ INCRÉMENTÉ !
5. Au bout de 120 requêtes, le locataire légitime `victime` se connecte avec son jeton valide et reçoit **HTTP 429 Too Many Requests**.
- **Preuve observable :** Validé et prouvé à 100% dans `test_ratelimit_jwt_vuln.cjs`.
- **Classification :** **CRITICAL / HIGH**.

## 2. Protection Anti-DoS par Taille de Payload

- Limite par défaut : 1 Mo pour JSON standard, 10 Mo pour transferts de fichiers.
- Envoi d'un payload de 11 Mo : Le serveur détruit la socket immédiatement (`req.destroy()`), provoquant un `ECONNRESET` propre et préservant la mémoire vive du serveur.
