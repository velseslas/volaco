# AUDIT TECHNIQUE DU RATE LIMITER (SEC-013 & P1-001)
## VOLACO-CORE — RÉSILIENCE, CONFIANCE PROXY ET IMMUNITÉ HEAP DOS

### 1. Spécifications et Architecture Implémentée

Le middleware `RateLimiter` situé dans `apps/api/src/middleware/rate-limiter.ts` assure un cloisonnement multicouche :

```typescript
export class RateLimiter {
  private buckets = new Map<string, WindowBucket>();
  private trustedProxies = new Set<string>();
  private maxKeys: number = 10_000;
  // ...
}
```

### 2. Validation des Proxies de Confiance (Anti-Spoofing)
- Par défaut, seules les adresses loopback (`127.0.0.1`, `::1`) sont considérées comme des proxies de confiance en local.
- La variable d'environnement `TRUSTED_PROXIES` permet d'énumérer les adresses des reverse-proxies approuvés (ex: Cloudflare, NGINX, AWS ALB).
- Si la connexion socket provient d'une adresse non listée, l'en-tête `X-Forwarded-For` est **systématiquement ignoré**, interdisant toute évasion par usurpation d'IP.

### 3. Protection Anti-Épuisement de Tas RAM (Heap DoS)
- **Capacité maximale bornée :** La table interne ne peut pas excéder `maxKeys` (10 000 buckets par défaut).
- **Éviction LRU :** Lorsque la limite est atteinte, l'entrée la plus ancienne est évincée immédiatement.
- **Ramasse-miettes périodique :** `purgeExpired()` s'exécute automatiquement toutes les 60 secondes pour nettoyer les buckets dont la fenêtre de temps est expirée.

### 4. Quotas par Tier

| Tier | Fenêtre | Quota Production | Quota Environnement Test |
| :--- | :---: | :---: | :---: |
| **DEFAULT** (GET, Lecture) | 60 s | **120 requêtes** | 100 000 |
| **MUTATION** (POST, PUT, DELETE) | 60 s | **60 requêtes** | 50 000 |
| **AI** (Mistral Proxy & Agent) | 60 s | **20 requêtes** | 10 000 |

### 5. Tests de Validation Associés
- `apps/api/tests/security/rate-limit.test.ts` : 9/9 PASS.
- Vecteur 8, 21, 22 dans `offensive-audit.test.ts` : 3/3 PASS.
