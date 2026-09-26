# RAPPORT DE REMÉDIATION — P5-REMEDIATION-001

## 1. IDENTIFICATION DU PROBLÈME

- **Finding ID :** P5-CRIT-01
- **Titre :** Cross-Tenant Denial of Service via Unverified JWT Payload Decoding in Rate Limiter
- **CWE :** CWE-347 (Improper Verification of Cryptographic Signature), CWE-400 (Uncontrolled Resource Consumption)
- **Gravité Initiale :** CRITICAL / HIGH (CVSS 8.6 - CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:N/I:N/A:H)
- **Statut :** **FIXED**
- **Date de Remédiation :** 2026-09-11
- **Fichier Modifié :** `apps/api/src/middleware/rate-limiter.ts`
- **Suite de Tests Créée :** `apps/api/tests/security/red-team-p5-remediation-001.test.ts`

---

## 2. MÉCANISME DE LA VULNÉRABILITÉ

Dans l'architecture de `volaco-core`, le middleware de limitation de débit (`RateLimiter`) est exécuté au tout début de la chaîne HTTP dans `apps/api/src/server.ts`, avant l'extraction et la validation cryptographique du contexte d'authentification (`extractRequestContext`).

Avant la correction, la méthode privée `getTenantId` de `RateLimiter` tentait d'attribuer la requête au quota du locataire en analysant l'en-tête `Authorization: Bearer <token>`. Elle découpait la chaîne JWT par le séparateur `.`, prenait le segment payload (`parts[1]`), et le décodait directement en Base64Url sans vérifier la signature HMAC-SHA256 :

```typescript
// CODE VULNÉRABLE INITIAL (apps/api/src/middleware/rate-limiter.ts) :
const parts = token.split('.');
if (parts.length === 3 && parts[1]) {
  let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const payloadStr = Buffer.from(base64, 'base64').toString('utf8');
  const payload = JSON.parse(payloadStr);
  if (payload && typeof payload.tenantId === 'string' && payload.tenantId.trim().length > 0) {
    return payload.tenantId.trim(); // VULNÉRABILITÉ : TenantId accepté sans validation cryptographique !
  }
}
```

### Conséquence Opérationnelle :
Le `RateLimiter` ajoutait immédiatement la clé de quota `tenant:<tenantId>:<tier>` au compartiment de suivi.
Un attaquant anonyme pouvait forger un JWT non signé ou signé avec une clé arbitraire contenant `{"tenantId": "victim-corp"}`. Lorsque le quota de 120 requêtes/minute était atteint pour cette clé, tout utilisateur légitime du locataire `victim-corp` voyait ses requêtes bloquées par une réponse HTTP 429 (`TOO_MANY_REQUESTS`), alors même que l'attaquant recevait HTTP 401.

---

## 3. ANALYSE D'IMPACT

1. **Déni de Service Distribué / Asymétrique :**
   Un attaquant sans informations d'identification valides pouvait cibler n'importe quel locataire (ou tous les locataires séquentiellement) et neutraliser complètement leur capacité à utiliser la plateforme.
2. **Impact Multi-Tenant Maximal :**
   Rupture directe de l'étanchéité inter-locataires au niveau de la couche réseau et admission de trafic.
3. **Coût pour l'Attaquant : Quasi-Nul :**
   Seules 120 requêtes HTTP légères (en-tête forgé sans calcul lourd) suffisaient à rendre inopérant un client légitime pendant une fenêtre de 60 secondes.

---

## 4. CONCEPTION TECHNIQUE DU CORRECTIF

Le correctif applique le principe de défense en profondeur et de vérification cryptographique obligatoire :

1. **Intégration du Vérificateur Officiel (`verifyAuthToken`) :**
   Au lieu de réimplémenter une vérification partielle ou dupliquée de signature, `RateLimiter` importe directement `verifyAuthToken` depuis `./auth.js`.
2. **Validation HMAC-SHA256 en Temps Constant :**
   `verifyAuthToken` calcule la signature attendue avec le secret cryptographique du serveur (`AUTH_SECRET` >= 32 caractères) et la compare à l'aide de `timingSafeEqual` pour empêcher toute attaque temporelle (timing attacks).
3. **Vérification de l'Expiration (`exp`) :**
   Tout jeton expiré est rejeté (`verifyAuthToken` renvoie `null`).
4. **Repli Sécurisé par IP :**
   Si `verifyAuthToken(token)` renvoie `null` (signature invalide, jeton malformé, expiré ou alg: none), `getTenantId()` renvoie `null`.
   Le `RateLimiter` applique alors strictement le quota sur `ip:${clientIp}:${tier}`.
   Le trafic malveillant est imputé **exclusivement à l'adresse IP de l'attaquant**, protégeant à 100 % le locataire ciblé.
5. **Conservation du Rejet de `X-Tenant-Id` :**
   L'en-tête non authentifié `X-Tenant-Id` reste formellement ignoré pour l'attribution des quotas.

---

## 5. CODE DIFF

```diff
--- a/apps/api/src/middleware/rate-limiter.ts
+++ b/apps/api/src/middleware/rate-limiter.ts
@@ -6,6 +6,7 @@
 
 import type { IncomingMessage, ServerResponse } from 'node:http';
 import { logger } from '../../../../packages/core/src/logger.js';
+import { verifyAuthToken } from './auth.js';
 
 export type RateLimitTier = 'DEFAULT' | 'MUTATION' | 'AI';
 
@@ -215,19 +216,11 @@
     if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
       const token = authHeader.slice(7).trim();
       if (token) {
-        try {
-          const parts = token.split('.');
-          if (parts.length === 3 && parts[1]) {
-            let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
-            while (base64.length % 4) base64 += '=';
-            const payloadStr = Buffer.from(base64, 'base64').toString('utf8');
-            const payload = JSON.parse(payloadStr);
-            if (payload && typeof payload.tenantId === 'string' && payload.tenantId.trim().length > 0) {
-              return payload.tenantId.trim();
-            }
-          }
-        } catch {
-          // Token invalide ou non décodable : traiter comme non authentifié
-        }
+        // SEC-P5-REMEDIATION-001: Vérification cryptographique obligatoire de la signature HMAC du JWT.
+        // Un token falsifié ou avec une signature invalide ne doit JAMAIS imputer le quota d'un tiers (Cross-Tenant DoS).
+        const verified = verifyAuthToken(token);
+        if (verified && typeof verified.tenantId === 'string' && verified.tenantId.trim().length > 0) {
+          return verified.tenantId.trim();
+        }
       }
     }
     // Rejet formel du header non authentifié X-Tenant-Id pour éviter tout DoS inter-locataire (P3-001-C)
```

---

## 6. PREUVE DE RÉSISTANCE OFFENSIVE (RED TEAM)

Une suite de tests dédiée a été créée dans `apps/api/tests/security/red-team-p5-remediation-001.test.ts`.

### Résultats d'Exécution :
Commande : `node --test dist/apps/api/tests/security/red-team-p5-remediation-001.test.js`

```text
▶ RED TEAM P5-REMEDIATION-001 : Rate Limiter JWT Signature Verification & Cross-Tenant DoS Prevention
  ✔ Test 1: Valid JWT -> consumes tenant quota correctly (1.7904ms)
  ✔ Test 2: Forged JWT with wrong signature -> does NOT consume victim tenant quota (0.4357ms)
  ✔ Test 3: Forged JWT targeting arbitrary tenant names (admin, prod, internal) -> rejected from tenant quota (0.6981ms)
  ✔ Test 4: Expired JWT -> does not consume tenant quota (0.4155ms)
  ✔ Test 5: Alg "none" JWT -> does not consume tenant quota (0.4197ms)
  ✔ Test 6: Tampered signature bit -> does not consume tenant quota (0.36ms)
  ✔ Test 7: Tampered payload with valid original signature -> does not consume tenant quota (1.2785ms)
  ✔ Test 8: Missing Authorization header -> rate limited by IP only (1.1371ms)
  ✔ Test 9: Malformed Authorization header -> rate limited by IP only (0.3432ms)
  ✔ Test 10: X-Tenant-Id header without valid JWT -> does not consume tenant quota (0.2869ms)
  ✔ Test 11: Real HTTP reproduction scenario (120 forged requests by attacker, victim remains unaffected) (129.0805ms)
✔ RED TEAM P5-REMEDIATION-001 : Rate Limiter JWT Signature Verification & Cross-Tenant DoS Prevention (144.3138ms)
ℹ tests 11
ℹ suites 1
ℹ pass 11
ℹ fail 0
```

### Preuve sur le Test 11 (Scénario d'Attaque Réel) :
- **Attaquant (IP: 198.51.100.99) :** Émission de 120 requêtes avec JWT forgé prétendant être `victim-corp`. Toutes les requêtes ont été rejetées (401/429 sur IP attaquante).
- **Victime Légitime (IP: 203.0.113.50) :** Émission d'une requête avec son JWT authentique. **Résultat : HTTP 200 OK**, quota intact, aucune perturbation.

---

## 7. MATRICE DE NON-RÉGRESSION

Toutes les suites de tests existantes ont été exécutées après compilation TypeScript (`tsc`) sans aucune altération de comportement sur les flux autorisés :

| Suite de Tests | Commande | Statut | Détails |
|---|---|:---:|---|
| **P5-REMEDIATION-001** | `node --test dist/apps/api/tests/security/red-team-p5-remediation-001.test.js` | **PASS** | 11/11 tests passés |
| **Rate Limit Tests** | `node --test dist/apps/api/tests/security/rate-limit.test.js` | **PASS** | 9/9 tests passés |
| **Offensive Audit Tests** | `node --test dist/apps/api/tests/security/offensive-audit.test.js` | **PASS** | 30/30 tests passés |
| **Red Team P2 Suite** | `node --test dist/apps/api/tests/security/red-team-p2.test.js` | **PASS** | 60/60 tests passés |
| **Red Team P3 Live** | `node --test dist/apps/api/tests/security/red-team-p3-live.test.js` | **PASS** | 45/45 tests passés |
| **Red Team P4 Independent** | `node --test dist/apps/api/tests/security/red-team-p4-independent.test.js` | **PASS** | 23/23 tests passés |
| **Monorepo Global Test Suite** | `npm test` | **PASS** | **1354/1354 tests passés** (330 suites) |
| **Quality Gate 1** | `node scripts/run_gate1_tests.mjs` | **PASS** | **31/31 tests passés** |
| **Quality Gate 2** | `node scripts/run_gate2_tests.mjs` | **PASS** | **7/7 vérifications validées** |
| **Compilation TypeScript** | `npm run build` | **PASS** | 0 erreur (`tsc` strict) |

---

## 8. SCAN DU REPOSITORY POUR OCCURRENCES SIMILAIRES

Un audit statique exhaustif a été effectué pour identifier toute autre occurrence de décodage non vérifié de jetons JWT (`split('.')`, `base64UrlDecode`, `Buffer.from(..., 'base64')`).

- **Dans `apps/api/src/` :**
  - Seule la fonction `verifyAuthToken()` dans `apps/api/src/middleware/auth.ts` effectue le décodage après validation stricte par `timingSafeEqual`.
  - Aucune autre fonction ni middleware ne décode de JWT sans vérification cryptographique préalable.
- **Dans `packages/` :**
  - Aucune manipulation brute de JWT.
- **Résultat du scan :** Aucune vulnérabilité similaire résiduelle dans le codebase.

---

## 9. CONCLUSION & VERDICT DE SÉCURITÉ

La vulnérabilité **P5-CRIT-01** est intégralement et définitivement corrigée :
- L'usurpation d'identité pour épuiser le quota d'un tiers est désormais impossible.
- Le rate limiting protège efficacement l'infrastructure sans compromettre l'étanchéité multi-tenant.
- Zéro régression sur les 1354 tests du monorepo.
- **Statut Final : FIXED (Production Hardened)**.
