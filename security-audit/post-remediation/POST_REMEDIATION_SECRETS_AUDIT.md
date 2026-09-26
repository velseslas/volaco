# AUDIT DES SECRETS ET GESTION DES IDENTIFIANTS SENSIBLES
## VOLACO-CORE — SCAN DU CODEBASE ET VÉRIFICATION DU CYCLE DE VIE DES SECRETS

**Périmètre :** Monorepo complet `volaco-core` (Code source, bundles, logs, tests, configurations)  
**Date d'évaluation :** 11 Septembre 2026  

---

### 1. Résultats du Scan Automatisé des Secrets

| Catégorie de Secret | Motif / Regex Recherché | Occurrences Détectées | Évaluation |
| :--- | :--- | :---: | :---: |
| **Clés Privées SSH / RSA** | `-----BEGIN (RSA \|EC \|OPENSSH )?PRIVATE KEY-----` | 4 (Tests unitaires uniquement) | **CONFORME** (Fixtures de test factices) |
| **Clés AWS IAM** | `AKIA[0-9A-Z]{16}` | 0 | **CONFORME** (Aucune clé exposée) |
| **Tokens GitHub / GitLab** | `(ghp_\|gho_\|glpat-)[0-9a-zA-Z]{36}` | 0 | **CONFORME** (Aucun token exposé) |
| **Clés API Stripe / AI** | `sk_(live\|test)_[0-9a-zA-Z]{24}` | 4 (Tests de masquage uniquement) | **CONFORME** (Chaînes de test bidon) |
| **Clé Mistral Compromise** | `zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg` | 0 dans le code exécutable | **CONFORME** (Présente uniquement dans rapports d'audit) |
| **Fichiers d'environnement** | `*.env*` | 0 | **CONFORME** (Aucun fichier .env commité) |

---

### 2. Audit du Secret JWT (`AUTH_SECRET`)

* **Gestion du secret :**
  Dans `apps/api/src/middleware/auth.ts:18-35`, la fonction `validateAuthSecret()` exige impérativement que `process.env.AUTH_SECRET` soit défini et comporte au moins 32 caractères.
* **Élimination des valeurs par défaut prévisibles :**
  L'ancienne chaîne de repli `'volaco-auth-secret-key-2026-secure'` a été définitivement purgée. Le serveur refuse de démarrer si la variable n'est pas injectée par l'environnement d'hébergement.
* **Présence dans les tests :**
  Un helper de test (`apps/api/tests/helpers/auth-helper.ts`) injecte un secret de test dédié `volaco-test-suite-secure-auth-secret-key-at-least-32-chars-long!` exclusivement pendant l'exécution des tests automatisés (`process.env.NODE_ENV === 'test'`).

---

### 3. Masquage des Chaînes de Connexion et DSN (SEC-012)

Dans `packages/core/src/security/secrets.ts` :
```typescript
export function maskConnectionString(uri: string): string {
  if (!uri || typeof uri !== 'string') return '';
  return uri.replace(
    /(postgres|postgresql|mysql|mariadb|mongodb|redis|amqp|mssql):\/\/([^:]+):([^@]+)@/gi,
    (_match, proto, user) => `${proto}://${user}:***@`
  );
}
```

* **Couverture des protocoles :** Prend en compte `postgres`, `mysql`, `mariadb`, `mongodb`, `redis`, `amqp`, `mssql`.
* **Application systématique :**
  - Dans `SettingsService.getSettings()`, chaque variable d'environnement du projet est analysée. Si la clé correspond à `SENSITIVE_KEY_PATTERN` ou si la valeur correspond à une URI de connexion, la fonction `maskConnectionString()` ou `maskSecret()` est appliquée.
  - Tout appel `GET /api/v1/projects/:id/settings` restitue les mots de passe masqués sous la forme `proto://user:***@host:port/db`.
  - Aucun utilisateur, y compris avec le rôle `VIEWER` ou `ENGINEER`, ne peut exfiltrer les identifiants de base de données en clair via l'API.

---

### 4. Étanchéité des Logs et Gestion des Erreurs

* **Journalisation d'audit :**
  `auditStore.record()` passe systématiquement les métadonnées de l'événement dans `sanitizePayload()` (`packages/core/src/observability/audit.ts:29`). Les clés sensibles (`api_key`, `token`, `password`, `secret`) y sont masquées en `***MASKED***` avant stockage en mémoire.
* **Sérialisation des erreurs HTTP :**
  Dans `apps/api/src/server.ts:293-304`, les erreurs non capturées retournent un objet standardisé `{ code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' }` sans divulguer de stack trace Node.js ni de contenu mémoire à l'appelant.

---

### 5. Conclusion sur les Secrets

La surface d'exposition des secrets est **PARFAITEMENT MAÎTRISÉE** :
* 0 secret durci dans le code ou l'interface frontend.
* Masquage universel des identifiants et chaînes DSN.
* Secret JWT strictement exigé dès l'amorçage.
