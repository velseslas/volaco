# RAPPORT DE REMÉDIATION — P5-REMEDIATION-002

## 1. FINDING ORIGINAL
- **Finding ID :** P5-MED-01
- **Titre :** Global 500 Error Handler Information Disclosure (CWE-209)
- **Gravité Initiale :** MEDIUM (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N - 5.3)
- **Statut :** **FIXED**
- **Date de Remédiation :** 2026-09-12
- **Surface d'Attaque :** Gestionnaire d'erreurs global de `apps/api/src/server.ts`
- **Composant Cible :** Handler `catch (err: unknown)` dans `createApiServer`

---

## 2. ROOT CAUSE
Avant la correction, le bloc `catch (err: unknown)` à la fin de la boucle de traitement des requêtes HTTP dans `apps/api/src/server.ts` interceptait les exceptions non gérées et instanciat un objet `AppError` en injectant le message brut de l'erreur dans la propriété `context` :

```typescript
const message = err instanceof Error ? err.message : 'Erreur inconnue';
const errObj = new AppError('Erreur interne du serveur', 'INTERNAL_ERROR', 500, { original: message }, requestId);
res.statusCode = 500;
res.end(JSON.stringify(errObj.toJSON()));
```

Dans la méthode `AppError.toJSON()`, tout objet `context` non indéfini est sérialisé et inclus directement dans le corps de réponse JSON :

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Erreur interne du serveur",
    "statusCode": 500,
    "requestId": "req_...",
    "context": {
      "original": "ENOENT: no such file or directory, open C:\\Users\\FAYCAL\\secrets\\db.env"
    }
  }
}
```

Ce comportement divulguait à tout client distant (même anonyme) des informations système critiques : chemins d'accès au système de fichiers (`C:\Users\...`, `/var/...`), identifiants de bases de données, détails de connectivité PostgreSQL/Redis, traces de modules Node.js ou données confidentielles capturées dans un message d'exception.

---

## 3. FILES INSPECTED
- `apps/api/src/server.ts` (Handler global et dispatch des routes)
- `packages/core/src/errors.ts` (`AppError`, `ErrorDetails`, `toJSON()`)
- `packages/core/src/logger.ts` (`StructuredLogger`, `logger.error`)
- `packages/core/src/config.ts` (`loadConfig`, environnement `production` vs `development`/`test`)
- `apps/api/src/routes/ai.ts` (Gestion des erreurs de transport IA 502/503)
- `apps/api/src/routes/projects.ts`, `files.ts`, `revisions.ts`, `workspace.ts` (Gestionnaires d'erreurs locales et validation)
- `security-audit/p5/FINDINGS.md` & `security-audit/p5/API_ATTACKS.md` (Spécifications de la vulnérabilité découverte)

---

## 4. FILES MODIFIED
- `apps/api/src/server.ts`
  - Déclaration de `requestContext` pour contextualiser les logs serveur.
  - Suppression de `{ original: message }` dans la réponse HTTP 500.
  - Sanitization stricte des erreurs 500 applicatives (`AppError` avec `statusCode === 500`).
  - Garantie d'étanchéité absolue en environnement `production` même en cas de tentative d'activation de flags de débogage.
- `apps/api/tests/security/red-team-p5-remediation-002.test.ts` (Nouvelle suite de tests offensifs dédiés)

---

## 5. EXACT SECURITY CHANGE
Dans `apps/api/src/server.ts` :
1. **Suppression de `context.original` de la réponse client :** Le corps de réponse 500 renvoie désormais une structure épurée et strictement générique `{ error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur', statusCode: 500, requestId } }`.
2. **Conservation intégrale du diagnostic serveur :** Avant toute réponse, `logger.error` consigne le message d'erreur brut, la stack trace, la méthode HTTP, le chemin d'accès, le `tenantId` (si disponible) et le `requestId`.
3. **Protection contre les fuites via `AppError(500)` :** Si une instance d'`AppError` avec un code 500 est levée avec un `context` interne sensible, celui-ci est consigné côté serveur mais masqué au client en production.
4. **Verrouillage absolu en environnement de production :** La règle finale garantit qu'en `config.env === 'production'`, aucun détail interne ne peut fuiter même si `ENABLE_DEV_ERROR_DETAILS` est activé.

---

## 6. BEFORE/AFTER BEHAVIOR

### Avant (Vulnérable - Information Disclosure) :
```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json
X-Request-Id: req_c8e8f646f614409e

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Erreur interne du serveur",
    "statusCode": 500,
    "requestId": "req_c8e8f646f614409e",
    "context": {
      "original": "P5_REMEDIATION_002_SECRET: failed connection to postgresql://dbadmin:p5SuperSecretPass123@internal-db.corp:5432/production_volaco at C:\\Users\\FAYCAL\\secrets\\db.env"
    }
  }
}
```

### Après (Sécurisé - Production Ready) :
```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json
X-Request-Id: req_59952915465d4721

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Erreur interne du serveur",
    "statusCode": 500,
    "requestId": "req_59952915465d4721"
  }
}
```
*Et côté logs serveur (`stderr` / JSON structuré) :*
```json
{
  "timestamp": "2026-09-12T09:32:50.276Z",
  "level": "error",
  "message": "Erreur interne non gérée lors du traitement HTTP",
  "requestId": "req_59952915465d4721",
  "context": {
    "service": "volaco-core",
    "error": "P5_REMEDIATION_002_SECRET: failed connection to postgresql://dbadmin:p5SuperSecretPass123@internal-db.corp:5432/production_volaco at C:\\Users\\FAYCAL\\secrets\\db.env",
    "stack": "Error: P5_REMEDIATION_002_SECRET: ...\n    at ...",
    "method": "GET",
    "path": "/api/v1/projects",
    "tenantId": "tenant-blackbox"
  }
}
```

---

## 7. OFFENSIVE TEST MATRIX
Fichier de test : `apps/api/tests/security/red-team-p5-remediation-002.test.ts`  
Exécution : `node --test dist/apps/api/tests/security/red-team-p5-remediation-002.test.js`

| # | Scénario de Test Offensif | Donnée Injectée | Comportement Attendu | Résultat |
|---|---|---|---|:---:|
| 1 | **Generic 500** | Exception non gérée | Code `INTERNAL_ERROR`, message générique, pas de `context.original` | **PASS** |
| 2 | **Filesystem Disclosure** | `C:\Users\FAYCAL\secrets\vault.key` | Aucun chemin, nom d'utilisateur ou nom de fichier dans la réponse | **PASS** |
| 3 | **Database Disclosure** | `postgresql://postgres:SuperSecretP@ss...` | Protocole, hôte, identifiants et base absents de la réponse | **PASS** |
| 4 | **Stack Trace Disclosure** | Stack frames Node.js artificielles | `stack`, frames et lignes absents de la réponse et des en-têtes | **PASS** |
| 5 | **Secret Disclosure** | `SECRET_TEST_VALUE_ABC_999_XYZ` | Chaîne secrète absente de la réponse | **PASS** |
| 6 | **Request ID Preserved** | `X-Request-Id: req_custom_tracer_...` | ID de corrélation préservé dans le corps et l'en-tête | **PASS** |
| 7 | **Server-side Diagnostic** | Erreur avec métadonnées | Erreur originale et stack capturées dans les logs serveur sans fuite client | **PASS** |
| 8 | **Non-500 Behavior** | Erreurs 400, 401, 403, 404 | Les codes d'erreurs client nominaux continuent de fonctionner à l'identique | **PASS** |
| 9 | **Black-Box Reproduction** | Payload d'attaque découvert par P5 | Réponse HTTP 500 assainie, aucune donnée confidentielle présente | **PASS** |
| 10 | **AppError 500 Context Sanitization** | `AppError(500, { secretKey: ... })` | Contexte interne de l'AppError retiré de la réponse | **PASS** |
| 11 | **Production Environment Strictness** | Flag `ENABLE_DEV_ERROR_DETAILS=true` | Verrouillage absolu en mode production, détails non divulgués | **PASS** |

**Score : 11/11 tests PASS (100%)**

---

## 8. BLACK-BOX REPRODUCTION
Le scénario d'attaque identifié par l'audit P5 a été reproduit dans le Test 9 :
1. Une requête authentifiée a été envoyée vers `/api/v1/projects` alors que le service sous-jacent déclenche une exception interne contenant :
   `P5_REMEDIATION_002_SECRET: failed connection to postgresql://dbadmin:p5SuperSecretPass123@internal-db.corp:5432/production_volaco at C:\Users\FAYCAL\secrets\db.env`
2. **Vérification Black-Box :**
   - Statut HTTP reçu : `500 Internal Server Error`
   - Recherche textuelle exhaustive sur le corps de réponse :
     - `P5_REMEDIATION_002_SECRET` : **NON TROUVÉ**
     - `p5SuperSecretPass123` : **NON TROUVÉ**
     - `internal-db.corp` : **NON TROUVÉ**
     - `C:\Users\FAYCAL` : **NON TROUVÉ**
     - `original` : **NON TROUVÉ**
     - `stack` : **NON TROUVÉ**
   - Payload JSON reçu :
     `{"error":{"code":"INTERNAL_ERROR","message":"Erreur interne du serveur","statusCode":500,"requestId":"req_..."}}`
3. L'attaque par divulgation d'informations d'erreur est totalement neutralisée.

---

## 9. GLOBAL DISCLOSURE-PATTERN SCAN
Un audit statique à l'aide de `grep` sur l'ensemble du monorepo confirme :
- **`context.original` :** N'existe plus que dans la suite de tests `red-team-p5-remediation-002.test.ts` qui en vérifie l'absence.
- **`err.stack` / `error.stack` :** Uniquement acheminé vers `logger.error` côté serveur.
- **`JSON.stringify(err)` / `JSON.stringify(error)` :** Aucune sérialisation directe d'objet d'erreur brut dans les flux HTTP sortants.
- **`originalError` / `cause` :** Aucun pattern d'exposition présent dans le code de l'API.

---

## 10. REGRESSION RESULTS
Toutes les suites de tests unitaires, d'intégration et offensives existantes ont été exécutées avec succès :

| Suite de Tests | Commande | Statut | Résultat |
|---|---|:---:|:---:|
| **P5-REMEDIATION-002 Suite** | `node --test dist/apps/api/tests/security/red-team-p5-remediation-002.test.js` | **PASS** | 11/11 |
| **P5-REMEDIATION-001 Suite** | `node --test dist/apps/api/tests/security/red-team-p5-remediation-001.test.js` | **PASS** | 11/11 |
| **Rate Limit Tests** | `node --test dist/apps/api/tests/security/rate-limit.test.js` | **PASS** | 9/9 |
| **Offensive Audit Tests** | `node --test dist/apps/api/tests/security/offensive-audit.test.js` | **PASS** | 30/30 |
| **Red Team P2 Suite** | `node --test dist/apps/api/tests/security/red-team-p2.test.js` | **PASS** | 60/60 |
| **Red Team P3 Live Suite** | `node --test dist/apps/api/tests/security/red-team-p3-live.test.js` | **PASS** | 45/45 |
| **Red Team P4 Independent** | `node --test dist/apps/api/tests/security/red-team-p4-independent.test.js` | **PASS** | 23/23 |
| **Monorepo Global Test Suite** | `npm test` | **PASS** | **1365/1365** (331 suites) |

---

## 11. BUILD RESULTS
- Commande : `cmd /c "npm run build"`
- Compilateur : TypeScript `tsc` en mode strict (`tsconfig.json`)
- Résultat : **0 erreur, sortie code 0**.

---

## 12. GATE 1 RESULTS
- Commande : `node scripts/run_gate1_tests.mjs`
- Périmètre : Fondations (FND-001 à FND-005)
- Résultat : **31/31 PASS (100%)** — `QUALITY GATE 1 VALIDÉE AVEC SUCCÈS`.

---

## 13. GATE 2 RESULTS
- Commande : `node scripts/run_gate2_tests.mjs`
- Périmètre : Core Application (CAPP-001 à CAPP-007, Studio, Templates)
- Résultat : **7/7 vérifications validées (169/169 PASS)** — `QUALITY GATE 2 FRANCHIE AVEC SUCCÈS`.

---

## 14. REMAINING P5 FINDINGS
Conformément aux directives d'isolation stricte de la mission (*ONE MISSION = ONE VULNERABILITY*), les vulnérabilités suivantes restent ouvertes pour les prochaines missions :
- **P5-MED-02 :** Absence de Contrôle RBAC sur le Proxy IA (`POST /api/v1/ai/chat/completions`)
- **P5-MED-03 :** Absence de Condensats SRI sur les Templates du Studio
- **P5-LOW-01 :** Dérive des Quotas de Rate Limiting en Mode Multi-Instances
- **P5-LOW-02 :** Rejet HTTP en Production non activé par défaut sans variable explicite

---

## 15. FINAL VERDICT

> **VERDICT : FIXED**

La vulnérabilité **P5-MED-01** est entièrement corrigée. Les erreurs 500 ne divulguent plus aucune information système sensible au client, tandis que l'ensemble des diagnostics techniques nécessaires à l'exploitation reste parfaitement enregistré côté serveur. Zéro régression sur les 1365 tests du monorepo.
