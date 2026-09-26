# RAPPORT DE REMÉDIATION TECHNIQUE P1-001
## VOLACO-CORE — HISTORIQUE DÉTAILLÉ DES CORRECTIONS IMPLÉMENTÉES

### 1. Composants Modifiés

1. **`apps/api/src/middleware/rate-limiter.ts` (SEC-013) :**
   - Ajout de la gestion des proxies de confiance (`trustedProxies`, `setTrustedProxies`, `isTrustedProxy`).
   - Implémentation du bornage de la mémoire (`maxKeys = 10_000`) avec politique d'éviction LRU.
   - Ajout du ramasse-miettes périodique `purgeExpired()` toutes les 60 secondes.

2. **`apps/api/src/server.ts` (SEC-005, SEC-015, ARCH-01) :**
   - Remplacement de la vérification simpliste de fichier statique par `path.resolve` canonique avec vérification stricte du préfixe `studioRoot`.
   - Protection de l'endpoint `/metrics` (vérification IP loopback ou token d'autorisation ADMIN/OWNER).
   - Confinement de `POST /api/v1/auth/session` et de l'injection HTML de session dev au mode hors-production conditionné par `ENABLE_DEV_AUTH_SESSION=true`.

3. **`packages/core/src/ai-native/agent-runtime/execution/executor.ts` & `service.ts` (SEC-009) :**
   - Remplacement des valeurs par défaut permissives de `allowBreaking` et `allowHighRisk` par `false`.
   - Transmission et validation de la confirmation humaine explicite (`confirmation = true`).

4. **`apps/api/src/routes/revisions.ts` (SEC-016) :**
   - Dépréciation et exclusion formelle de `payload.author` au profit exclusif de `context.role` extrait du token JWT authentifié.

5. **`apps/api/src/middleware/auth.ts` & `apps/api/src/routes/files.ts` (Body Limits) :**
   - Définition de `MAX_BODY_BYTES_DEFAULT = 1_000_000` (1 Mo).
   - Définition de `MAX_BODY_BYTES_SMALL = 256_000` (256 Ko) pour les paramètres et rollbacks.
   - Application de `MAX_BODY_BYTES_FILES = 10_000_000` (10 Mo) réservé exclusivement aux fichiers.

6. **`packages/core/src/observability/audit.ts` (SEC-014) :**
   - Ajout du chaînage cryptographique SHA-256 (`previousHash`, `hash`) sur les événements d'audit.
   - Implémentation de la méthode `verifyIntegrity()` permettant la détection immédiate de toute falsification.

7. **`apps/studio/index.html` & `volaco_studio.html` (SEC-011) :**
   - Suppression du script dynamique tiers `cdn.tailwindcss.com` non haché.
   - Synchronisation binaire intégrale (parité 100% byte-for-byte maintenue).

8. **`apps/api/tests/security/offensive-audit.test.ts` :**
   - Extension de la suite offensive de 20 à 30 vecteurs d'attaque indépendants couvrant tous les axes durcis.
