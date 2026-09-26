# AUDIT APPROFONDI DE L'AUTHENTIFICATION — MISSION P3
**Sous-système :** `apps/api/src/middleware/auth.ts`

---

## 1. Mécanisme Cryptographique
* **Algorithme :** HMAC-SHA256 (symétrique).
* **Format :** `header.payload.signature` encodé en base64url standard.
* **Résistance aux attaques classiques :**
  - `alg: none` : Protégé. La fonction `verifyAuthToken` calcule systématiquement une signature HMAC avec la clé du serveur sans se fier au header.
  - Confusion RS256/HS256 : Protégé. L'algorithme attendu côté serveur est figé sur HMAC-SHA256.
  - Timing Attacks : Protégé. Comparaison via `crypto.timingSafeEqual`.
  - Expiration : Protégé. Le champ `exp` est vérifié en millisecondes et secondes.

## 2. Faiblesses et Risques Détectés
1. **Secret par défaut si `NODE_ENV !== 'production'` :**
   `server.ts` injecte `volaco-core-dev-session-secure-auth-secret-key-32chars`.
2. **Entropie minimale non vérifiée :**
   `validateAuthSecret` vérifie uniquement `secret.length >= 32`. Un secret composé de 32 caractères répétitifs est accepté.
3. **Absence de révocation / Blacklisting de jetons :**
   Les jetons émis sont valides jusqu'à expiration, sans possibilité de révocation granulaire en cas de vol.
