# PHASE 0 — AUDIT DE RÉALITÉ (INDEPENDENT REALITY AUDIT)
## MONOREPO VOLACO-CORE — VÉRIFICATION FACTUELLE BOÎTE BLANCHE

**Date :** 11 Septembre 2026  
**Auditeur :** Équipe Indépendante Red Team & Production Hardening  
**Principe :** **NO EVIDENCE → NO CLAIM**  
**Règle Phase 0 :** Strictement en lecture seule sur le code applicatif. Aucune hypothèse non démontrée n'est acceptée.

---

### 1. Cartographie de l'Arborescence Réelle du Monorepo

```
volaco-core/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts              [JWT, Bearer, Body Parsing & Limits]
│   │   │   │   └── rate-limiter.ts      [Rate Limiter, LRU Map, Trusted Proxies]
│   │   │   ├── routes/                  [17 fichiers de routes HTTP]
│   │   │   └── server.ts                [Serveur HTTP, CORS, Fichiers Statiques, Routage]
│   │   └── tests/
│   │       ├── security/                [Tests offensifs, régression, supply-chain, etc.]
│   │       └── integration/
│   └── studio/
│       ├── index.html                   [Application Single Page Studio v2.5]
│       ├── client.js
│       ├── html2canvas.min.js           [Bibliothèque locale]
│       └── tailwindcss.min.js
├── packages/
│   └── core/
│       └── src/
│           ├── ai/                      [Adaptateurs Mistral/Gemini, usage tracker]
│           ├── ai-native/               [Agent Runtime, Mutation Orchestrator, Evolution]
│           ├── editor/                  [Service d'édition de code]
│           ├── file-explorer/           [Store virtuel en mémoire, types]
│           ├── identity/                [ProjectStore, permissions RBAC, types]
│           ├── model/                   [RevisionStore, calcul de hash SHA-256]
│           ├── observability/           [AuditStore avec chaînage SHA-256, MetricsCollector]
│           ├── security/                [Masquage secrets, URLs de bases de données]
│           └── terminal/                [TerminalService contrôlé avec whitelist stricte]
├── security-audit/                      [Rapports historiques, post-remediation, post-p1-001]
└── scripts/
    ├── run_gate1_tests.mjs              [Quality Gate 1 : 31 tests]
    └── run_gate2_tests.mjs              [Quality Gate 2 : 7 checks, 1161 tests, parité Studio]
```

---

### 2. Audit Contradictoire des Revendications P1-001

| Réf | CLAIM (Revendication) | CODE EVIDENCE (Preuve dans le code réel) | TEST EVIDENCE (Preuve de test) | STATUS | RESIDUAL RISK |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **CL-01** | **Score de sécurité 99.0/100 & GO PRODUCTION** | Formule mathématique dans `SECURITY_SCORE.md` avec déduction de 1.0 pt pour SEC-006. | 1161 tests unitaires/intégration + 30 vecteurs offensifs verts. | **À CHALLENGER** | Le score doit être recalculé après avoir soumis le système à des attaques composées et des vecteurs de confusion avancés. |
| **CL-02** | **1161 tests monorepo PASS (100%)** | Suites Node.js test runner dans `packages/core` et `apps/api`. | Exécution réelle `npm test` : `ℹ pass 1161, ℹ fail 0`. | **VÉRIFIÉ** | Négligeable (couverture large des contrats de service). |
| **CL-03** | **30/30 vecteurs offensifs PASS** | `apps/api/tests/security/offensive-audit.test.ts` implémente les tests 1 à 30. | `node --test dist/apps/api/tests/security/offensive-audit.test.js` : 30 pass, 0 fail. | **VÉRIFIÉ** | Faible (vecteurs unitaires validés). |
| **CL-04** | **Quality Gate 1 : 31/31 PASS** | `scripts/run_gate1_tests.mjs` exécute les 31 tests fondamentaux FND-001 à FND-005. | Exécution réelle : 31/31 PASS en 1032ms. | **VÉRIFIÉ** | Négligeable. |
| **CL-05** | **Quality Gate 2 : 7/7 CHECKS PASS** | `scripts/run_gate2_tests.mjs` vérifie compilation, 1161 tests, séquence CAPP-007, syntaxe Studio et parité binaire. | Exécution réelle : 7/7 CHECKS franchis avec succès. | **VÉRIFIÉ** | Négligeable. |
| **CL-06** | **TypeScript strict : 0 erreur** | `tsconfig.json` avec `"strict": true`, `"noEmitOnError": true`. | Exécution réelle `npm run build` (`tsc`) : 0 erreur. | **VÉRIFIÉ** | Négligeable. |
| **CL-07** | **Studio byte-for-byte synchronisé** | `apps/studio/index.html` et `volaco_studio.html` comparés par buffer binaire. | Check 7/7 de la Gate 2 : `Buffer.compare()` renvoie 0. | **VÉRIFIÉ** | Négligeable. |
| **SEC-001** | **Secret JWT obligatoire (>= 32 chars)** | `apps/api/src/middleware/auth.ts:18-27` : `validateAuthSecret()` lève une erreur fatale 500 si secret absent ou < 32 chars. | Vecteur offensif 2 : rejet 401 sur token mal signé. | **VÉRIFIÉ** | Négligeable. |
| **SEC-002** | **Bypass Auth par headers bloqué** | `apps/api/src/middleware/auth.ts:111-132` : Seul `Authorization: Bearer <token>` est accepté. | Vecteur 1 & 4 : rejet 401 sur absence ou corruption de token. | **VÉRIFIÉ** | Faible (gating JWT rigide). |
| **SEC-003** | **Clé Mistral jamais exposée au frontend** | `apps/api/src/routes/ai.ts:75-86` : `process.env.MISTRAL_API_KEY` utilisé exclusivement côté serveur. | Recherche greps : 0 clé dans `apps/studio`. | **VÉRIFIÉ** | Négligeable. |
| **SEC-004** | **CORS durci, wildcard révoqué** | `apps/api/src/server.ts:47-78` : Contrôle explicite sur `config.allowedOrigins` ou localhost en dev. Rejet 403 sur OPTIONS inconnu. | Vecteur 18 : rejet 403 sur preflight d'origine inconnue. | **VÉRIFIÉ** | Négligeable. |
| **SEC-005** | **Path Traversal distribution statique résolu** | `apps/api/src/server.ts:130-148` : `path.resolve(studioRoot, relativeFile)` + `normTarget.startsWith(rootPrefix)` + `relativeFile.includes('..')`. | Vecteur 23 : rejet 403/404 sur `..`, `%2e%2e`, `....//`. | **VÉRIFIÉ** | Faible (résolution canonique robuste). |
| **SEC-006** | **Volatilité des magasins en mémoire** | `packages/core/src/file-explorer/store.ts` et `project.ts` utilisent des `Map` mémoire sans persistance fichier ni WAL. | Documenté comme compromis architectural (dette technique). | **CONFIRMÉ RÉEL** | Moyen (perte de données en cas de crash/redémarrage). |
| **SEC-007** | **Iframe Preview sandbox sans allow-same-origin** | `apps/studio/index.html:9803` : `sandbox="allow-scripts"`. Aucune mention de `allow-same-origin`. | Vecteur 15 : vérification de l'absence de l'attribut. | **VÉRIFIÉ** | Négligeable. |
| **SEC-009** | **Agent Runtime Deny-by-Default** | `executor.ts:107-109` : `allowBreaking` et `allowHighRisk` fixés à `false` par défaut pour l'exécution réelle. | Vecteur 28 + AINT-007 (48/48 PASS). | **VÉRIFIÉ** | Faible (confirmation humaine obligatoire). |
| **SEC-010** | **Prompt Injection Sanitization** | `routes/ai.ts:28-65` : Neutralisation balises XML internes et encadrement `<user_input source="user_prompt">`. | Vecteur 9 : neutralisation des balises confirmée. | **VÉRIFIÉ** | Faible (modèle passif de prompt isolation). |
| **SEC-011** | **Supply Chain : Suppression Tailwind CDN dynamique** | `apps/studio/index.html:8-13` : Repli Tailwind CDN retiré du `<head>`, utilisation local + gstatic. | Vecteur 19 & 30 : absence de `cdn.tailwindcss.com` dans le head. | **VÉRIFIÉ** | Négligeable. |
| **SEC-012** | **Masquage Mots de Passe DATABASE_URL** | `packages/core/src/security/secrets.ts:11-17` : `maskConnectionString()` remplace le password par `***`. | Vecteur 17 + `secrets-settings.test.ts` (3/3 PASS). | **VÉRIFIÉ** | Négligeable. |
| **SEC-013** | **Rate Limiting Anti-Spoofing & Heap DoS** | `apps/api/src/middleware/rate-limiter.ts` : `setTrustedProxies`, LRU Map plafonnée à `maxKeys=10_000`, `purgeExpired()`. | Vecteurs 8, 21, 22 (PASS). | **VÉRIFIÉ** | Faible (table bornée et proxies filtrés). |
| **SEC-014** | **AuditStore Chaînage SHA-256** | `packages/core/src/observability/audit.ts` : Hash SHA-256 chaîné sur `previousHash` et `verifyIntegrity()`. | Vecteur 27 : détection immédiate de toute falsification. | **VÉRIFIÉ** | Faible (détecte l'altération sans persistance externe). |
| **SEC-015** | **Protection /metrics** | `apps/api/src/server.ts:194-231` : Restreint à loopback local ou token ADMIN/OWNER/METRICS_TOKEN. | Vecteur 25 : rejet 403 pour appel distant sans token. | **VÉRIFIÉ** | Négligeable. |
| **SEC-016** | **Auteur Révision Forcé depuis JWT** | `apps/api/src/routes/revisions.ts:59` : `author: context.role` (ignore `payload.author`). | Vecteur 26 : `author` forcé au rôle authentifié. | **VÉRIFIÉ** | Négligeable. |
| **ARCH-01** | **Gating Endpoint Dev /auth/session** | `apps/api/src/server.ts:234-258` : Rejet 403 si `config.env === 'production'` ou `ENABLE_DEV_AUTH_SESSION !== 'true'`. | Vecteur 24 : rejet 403 quand variable est désactivée. | **VÉRIFIÉ** | Faible. |
| **LIMITS** | **Limites Granulaires de Body** | `apps/api/src/middleware/auth.ts:135-138` : 1MB par défaut, 256KB small, 10MB fichiers. | Vecteur 29 : rejet 413 sur dépassement. | **VÉRIFIÉ** | Faible. |

---

### 3. Recherche de Chemins Morts, Fallbacks Dangereux et Anomalies Subtiles

L'audit approfondi du code source révèle les zones d'attention suivantes, à cibler prioritairement dans la suite d'attaque Red Team P2 :

1. **Validation JWT & Structure du Jeton (`apps/api/src/middleware/auth.ts`) :**
   - `verifyAuthToken()` vérifie la signature HMAC-SHA256 en utilisant le secret configuré. Si un attaquant envoie un en-tête `{"alg":"none"}` sans signature, la fonction tente de calculer le HMAC avec le secret et compare les longueurs de buffers. Un token non signé échoue car sa signature est vide.
   - **Absence de validation `nbf` (Not Before) :** Le payload JWT ne vérifie pas la claim `nbf`.
   - **Absence de validation stricte de l'algorithme dans l'en-tête décodé :** Bien que la signature soit calculée avec le secret système, le champ `header.alg` n'est pas explicitement restreint à `'HS256'`.
   - **Format de l'en-tête Authorization :** `authHeader.startsWith('Bearer ')` vérifie la présence de `Bearer `. Qu'en est-il de `bearer ` (minuscule), d'espaces multiples, ou d'en-têtes dupliqués ?

2. **Échange d'Identité et Étanchéité Multi-Tenant (`apps/api/src/routes/`) :**
   - Sur toutes les routes (`/projects`, `/files`, `/revisions`, `/workspace`, `/project-state`), le `tenantId` utilisé pour interroger les stores est extrait de `context.tenantId`.
   - Les paramètres `tenantId` passés dans le corps JSON ou les paramètres de requête sont ignorés au profit de `context.tenantId`. Il convient de tester des scénarios où un attaquant fournit des structures imbriquées complexes ou tente d'injecter des identifiants de projets d'autres tenants (`IDOR`).

3. **Rate Limiting & Détection de Variantes IP (`apps/api/src/middleware/rate-limiter.ts`) :**
   - `normalizeIp()` gère le préfixe IPv6 `::ffff:`. Qu'en est-il des adresses IPv6 compressées (`::1`), des adresses encodées, ou de formats inhabituels ?
   - Les clés sont construites sous la forme `${tenantId ?? clientIp}:${tier}`. Si un client authentifié possède un `tenantId`, le quota est comptabilisé par tenant, sinon par IP.

4. **Résistance du Parseur de Corps de Requête (`readBody`) :**
   - Que se passe-t-il en cas de slowloris (flux extrêmement lent qui ne termine jamais) ?
   - Que se passe-t-il avec des payloads contenant des JSON profonds (bombes récursives) ou des clés en double ?

5. **Magasins Mémoire & Concurrence :**
   - Tous les magasins (`ProjectStore`, `FileStore`, `RevisionStore`, `AuditStore`) reposent sur des `Map` JavaScript synchrones au sein du même processus Node.js. L'absence de verrouillage distribué n'est pas un problème pour un runtime mono-processus, mais la consommation mémoire doit être surveillée lors d'injections massives.

---

### 4. Conclusion de la Phase 0

L'audit de réalité confirme que :
- Les remédiations P1-001 ont été **effectivement intégrées dans le code source réel**.
- Aucun ancien code vulnérable n'est réutilisé en sous-main.
- Les tests unitaires et d'intégration couvrent bien les chemins nominaux et les régressions fondamentales.
- **Toutefois, la solidité face aux attaques composées, aux edge cases du protocole HTTP et aux vecteurs de confusion avancés n'a pas encore été éprouvée de manière indépendante.**

La Phase 1 (Red Team Offensive Avancée) peut débuter.
