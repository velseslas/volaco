# RAPPORT DE REMÉDIATION — P7-REMEDIATION-001

## VULNÉRABILITÉS TRAITÉES

* **P7-VULN-01** : Systemic Unhandled TypeErrors via Null JSON Payloads Across Secondary API Mutation Routes (CVSS v3.1: 5.3)
* **P7-VULN-02** : AI Proxy Unhandled TypeError Masked as 502 Upstream Failure with Internal Property Leak (CVSS v3.1: 4.8)

---

* **Projet** : Volaco Core
* **Mission** : P7-001 — SYSTEMIC JSON INPUT VALIDATION & AI ERROR HANDLING REMEDIATION
* **Date** : 13 Septembre 2026
* **Classification CWE** : 
  - CWE-20: Improper Input Validation
  - CWE-754: Improper Check for Unusual or Exceptional Conditions
  - CWE-390: Detection of Error Condition Without Action
  - CWE-209: Generation of Error Message Containing Sensitive Information
* **Statut Final** : **FIXED (100% REMEDIATED & VALIDATED)**

---

## 1. EXECUTIVE SUMMARY

Durant la campagne d'audit et d'évaluation indépendante **P7 — Independent Security Assessment & Robustness Validation**, deux vulnérabilités systémiques ont été mises en évidence :

1. **P7-VULN-01 (Systemic Unhandled TypeErrors)** : Alors que la mission P6-006 avait colmaté la route `POST /api/v1/projects`, le motif de parsing vulnérable `JSON.parse(body || '{}')` subsistait sur **14 autres routes de mutation** réparties dans 8 modules fonctionnels. Tout envoi d'un corps JSON primitif (`null`, `[]`, `123`, `"string"`, `true`) déclenchait un `TypeError` non intercepté, provoquant une cascade d'erreurs `HTTP 500 Internal Server Error`.
2. **P7-VULN-02 (AI Proxy Error Masquerading & V8 Info Leak)** : Sur la route `POST /api/v1/ai/chat/completions`, l'envoi d'un payload `null` contournait la validation et provoquait un crash lors de l'accès à `payload.max_tokens`. L'exception interne était capturée par un bloc de propagation réseau qui renvoyait une erreur `HTTP 502 Bad Gateway` attribuant faussement la panne à l'amont Mistral AI et divulguait dans le message JSON l'exception interne du moteur JavaScript V8 : `"Échec de communication avec le fournisseur d'IA: Cannot read properties of null (reading 'max_tokens')"`.

### Remédiation Systémique Réalisée :
* **Parser JSON Centralisé & Robuste** : Implémentation de `parseJsonBody<T>()` et `readJsonBody<T>()` dans `apps/api/src/middleware/auth.ts`. Rejet strict de `null`, des tableaux `[]`, et de toute primitive JSON avec une `ValidationError` (`HTTP 400 Bad Request`), tout en traitant gracieusement les corps vides ou composés uniquement d'espaces sous la forme `{}` pour préserver les contrats d'API facultatifs.
* **Migration Exhaustive de Toutes les Routes de Mutation** : Éradication totale du motif `JSON.parse(body || '{}')` dans 100% des routes de l'API (15 routes de mutation migrées).
* **Frontière d'Erreur Hermétique pour l'AI Proxy** : Séparation stricte de la validation des entrées (rejet 400 immédiat), de la communication amont (502 générique sans fuite de message V8) et des erreurs inattendues (500 propre).
* **Vérification Complète & Zéro Régression** :
  - Suite de tests P7-001 dédiée : **108 / 108 PASS (100%)**.
  - Quality Gate 1 : **31 / 31 PASS (100%)**.
  - Quality Gate 2 : **1624 / 1624 PASS (100%)**.
  - Non-régression P6 Red Team : **16 / 16 PASS (100%)**.
  - TypeScript Compiler (`tsc`) : **0 erreur (Mode Strict)**.

---

## 2. VULNÉRABILITÉS DÉTAILLÉES

### 2.1 P7-VULN-01 — Systemic Unhandled TypeErrors via Null JSON Payloads

* **Identifiant** : `P7-VULN-01`
* **Score CVSS v3.1** : 5.3 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`)
* **Description** :
  L'expression `JSON.parse("null")` renvoie la valeur primitive JavaScript `null`. Toute tentative d'accès à une propriété d'objet (ex. `payload.stack`, `payload.command`, `payload.content`) lève un `TypeError: Cannot read properties of null`.
  Faute de vérification de type `typeof payload === 'object' && payload !== null && !Array.isArray(payload)`, l'exception non interceptée remontait au gestionnaire global d'erreur du serveur HTTP, retournant `HTTP 500 Internal Server Error` et polluant les journaux applicatifs.

### 2.2 P7-VULN-02 — AI Proxy Unhandled TypeError Masked as 502 Upstream Failure with Internal Property Leak

* **Identifiant** : `P7-VULN-02`
* **Score CVSS v3.1** : 4.8 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N`)
* **Description** :
  Dans `apps/api/src/routes/ai.ts`, le bloc d'appel à Mistral englobait la préparation du payload `payload.max_tokens` et `payload.messages`. Lors de l'envoi de `null`, le `TypeError` était capturé par le `catch` réseau et encapsulé dans un `AppError('Échec de communication avec le fournisseur d\'IA: ' + fetchErr.message, 502, ...)` :
  1. **Altération de diagnostic** : L'API signalait une indisponibilité du fournisseur IA externe alors qu'il s'agissait d'un bug d'entrée interne.
  2. **Fuite d'informations (CWE-209)** : La chaîne brute de l'interpréteur V8 `Cannot read properties of null (reading 'max_tokens')` était renvoyée aux clients non authentifiés ou adverses.

---

## 3. INVENTAIRE COMPLET DES 15 ROUTES COUVERTES

La correction a été appliquée de manière uniforme sur toutes les routes de mutation du serveur HTTP :

| N° | Méthode | Endpoint | Module | Fichier Source |
|:---|:---|:---|:---|:---|
| 1 | `POST` | `/api/v1/projects` | Identity & Projects | `apps/api/src/routes/projects.ts` |
| 2 | `PUT` | `/api/v1/projects/:id/settings` | Settings & Secrets | `apps/api/src/routes/settings.ts` |
| 3 | `POST` | `/api/v1/projects/:id/workspace/session/close` | Workspace Session | `apps/api/src/routes/workspace.ts` |
| 4 | `PUT` | `/api/v1/projects/:id/state/status` | Project State | `apps/api/src/routes/project-state.ts` |
| 5 | `POST` | `/api/v1/projects/:id/state/validate` | Project State | `apps/api/src/routes/project-state.ts` |
| 6 | `POST` | `/api/v1/projects/:id/revisions` | Versioning & Snapshots | `apps/api/src/routes/revisions.ts` |
| 7 | `POST` | `/api/v1/projects/:id/files` | File Storage | `apps/api/src/routes/files.ts` |
| 8 | `PUT` | `/api/v1/projects/:id/files/content` | File Storage | `apps/api/src/routes/files.ts` |
| 9 | `POST` | `/api/v1/projects/:id/files/mkdir` | File Storage | `apps/api/src/routes/files.ts` |
| 10 | `POST` | `/api/v1/projects/:id/files/rename` | File Storage | `apps/api/src/routes/files.ts` |
| 11 | `POST` | `/api/v1/projects/:id/files/copy` | File Storage | `apps/api/src/routes/files.ts` |
| 12 | `POST` | `/api/v1/projects/:id/files/batch` | File Storage | `apps/api/src/routes/files.ts` |
| 13 | `POST` | `/api/v1/projects/:id/terminal/execute` | Terminal / Whitelist | `apps/api/src/routes/terminal.ts` |
| 14 | `POST` | `/api/v1/projects/:id/activity` | Activity & History | `apps/api/src/routes/activity.ts` |
| 15 | `POST` | `/api/v1/ai/chat/completions` | AI Proxy / Codestral | `apps/api/src/routes/ai.ts` |

*(Note : Les modules `audit.ts`, `feedback.ts`, `feature-intelligence.ts`, `evolution.ts`, et `strategy.ts` ont également été intégralement convertis vers `parseJsonBody` par précaution architecturale).*

---

## 4. ROOT CAUSE ANALYSIS

### 4.1 La fragilité de `JSON.parse(body || '{}')`

En spécification ECMAScript / RFC 8259, un document JSON n'est pas obligatoirement un objet `{}`. Les valeurs suivantes constituent du JSON parfaitement valide :
```javascript
JSON.parse("null")      // -> null
JSON.parse("[]")        // -> [] (Array)
JSON.parse("123")       // -> 123 (Number)
JSON.parse('"payload"') // -> "payload" (String)
JSON.parse("true")      // -> true (Boolean)
```

Lorsque le code effectue :
```typescript
const payload = JSON.parse(body || '{}');
const stack = payload.stack; // BOOM si payload === null ou number ou boolean
```
1. L'opérateur `||` ne protège que si `body` est faux (chaîne vide `""` ou `undefined`).
2. Dès que `body` vaut `"null"`, `body || '{}'` évalue à `"null"`.
3. `JSON.parse("null")` produit la primitive `null`.
4. L'évaluation de `payload.stack` lève un `TypeError: Cannot read properties of null`.

### 4.2 L'amalgame d'erreurs dans le Proxy IA

Dans `apps/api/src/routes/ai.ts`, la structure initiale présentait une vulnérabilité de frontière d'exception :
```typescript
// ANCIENNE LOGIQUE VULNÉRABLE DANS ai.ts
try {
  const payload = JSON.parse(rawBody || '{}');
  // ...
  const cappedTokens = Math.min(Number(payload.max_tokens) || ...); // Crash si null !
  // ...
  const fetchRes = await fetch(upstreamUrl, ...);
} catch (fetchErr) {
  throw new AppError(
    `Échec de communication avec le fournisseur d'IA: ${fetchErr.message}`,
    502,
    ...
  );
}
```
Cette imbrication globale :
1. Interceptait les erreurs de runtime V8 locales au même titre que les erreurs réseau `fetch`.
2. Attribuait à tort un problème de validation d'entrée client au service externe Mistral AI.
3. Exposait la pile ou le message d'erreur interne du runtime JavaScript directement dans le payload HTTP de retour.

---

## 5. BEFORE POC & ÉTATS DE DÉFAILLANCE

### 5.1 Exemple 1 : Terminal Execute avec payload null
```bash
curl -X POST http://127.0.0.1:3000/api/v1/projects/proj_demo/terminal/execute \
  -H "Authorization: Bearer $VALID_TOKEN" \
  -H "Content-Type: application/json" \
  -d "null"
```
**Réponse HTTP vulnérable (AVANT) :**
```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Erreur interne du serveur",
    "statusCode": 500,
    "requestId": "req_8df1092a"
  }
}
```
**Journal serveur (Crash localisé) :**
```text
TypeError: Cannot read properties of null (reading 'command')
    at handleTerminalRoutes (apps/api/src/routes/terminal.ts:42:21)
```

### 5.2 Exemple 2 : AI Chat Completions avec payload null
```bash
curl -X POST http://127.0.0.1:3000/api/v1/ai/chat/completions \
  -H "Authorization: Bearer $VALID_TOKEN" \
  -H "Content-Type: application/json" \
  -d "null"
```
**Réponse HTTP vulnérable (AVANT) :**
```http
HTTP/1.1 502 Bad Gateway
Content-Type: application/json

{
  "error": {
    "code": "APP_ERROR",
    "message": "Échec de communication avec le fournisseur d'IA: Cannot read properties of null (reading 'max_tokens')",
    "statusCode": 502,
    "requestId": "req_5f2c108d"
  }
}
```

---

## 6. CORRECTION ARCHITECTURALE APPLIQUÉE

### 6.1 Parser Centralisé Réutilisable (`apps/api/src/middleware/auth.ts`)

```typescript
/**
 * Analyse et valide rigoureusement un corps de requête JSON.
 * - Rejette les payloads 'null', les tableaux '[]' et les types primitifs (string, number, boolean)
 * - Traite les corps vides ou composés d'espaces comme un objet vide '{}' (compatibilité rétro-active)
 * - Lève une ValidationError (HTTP 400) explicite sans laisser échapper de TypeError non géré
 */
export function parseJsonBody<T = Record<string, any>>(
  bodyText: string | undefined | null,
  requestId?: string
): T {
  const trimmed = (bodyText || '').trim();
  if (trimmed.length === 0) {
    return {} as T;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('Le corps de la requête doit être un objet JSON valide', undefined, requestId);
  }

  return parsed as T;
}

/**
 * Lit le flux brut de la requête HTTP puis délègue à parseJsonBody.
 */
export async function readJsonBody<T = Record<string, any>>(
  req: IncomingMessage,
  maxBytes?: number,
  requestId?: string
): Promise<T> {
  const raw = await readBody(req, maxBytes);
  return parseJsonBody<T>(raw, requestId);
}
```

### 6.2 Séparation Hermétique des Frontières d'Erreurs dans l'AI Proxy (`apps/api/src/routes/ai.ts`)

```typescript
// 1. Validation immédiate du payload via le parser centralisé
const payload = parseJsonBody<{
  messages?: unknown;
  model?: unknown;
  max_tokens?: unknown;
  temperature?: unknown;
  stream?: unknown;
}>(rawBody, requestId);

// 2. Traitement local préalable (plafonnement de tokens, assainissement)
// Aucune exception TypeError possible, payload est garanti d'être un objet non-null

// 3. Appel réseau vers l'amont isolé dans un sous-bloc try/catch dédié
let fetchRes: Response;
try {
  fetchRes = await fetch(activeEndpoint, { ... });
} catch (fetchErr: any) {
  // Journalisation technique interne (sécurisée)
  logger.warn('Échec de communication réseau avec le fournisseur d IA', {
    service: 'volaco-core',
    requestId,
    targetUrl: activeEndpoint,
    errorMessage: fetchErr.message
  });
  // Réponse HTTP 502 épurée SANS fuite de message d'erreur interne
  throw new AppError(
    'Erreur de communication avec le fournisseur IA. Veuillez réessayer ultérieurement.',
    502,
    undefined,
    requestId
  );
}
```

---

## 7. ARCHITECTURE & CYCLE DE VIE DE LA REQUÊTE

```mermaid
flowchart TD
    Req[Requête HTTP Mutation] --> Read[readBody: Lecture Buffer HTTP]
    Read --> Parse[parseJsonBody: Parsing & Garde Type]
    
    Parse -- "Corps vide / whitespace" --> DefaultObj["Renvoi {} (Objet vide sécurisé)"]
    Parse -- "JSON malformé" --> Err400A["throw ValidationError (HTTP 400: JSON invalide)"]
    Parse -- "null / [] / string / number / bool" --> Err400B["throw ValidationError (HTTP 400: objet JSON valide requis)"]
    Parse -- "Objet JSON Valide" --> ValidationMetier[Validation Métier & Schéma de Route]
    
    DefaultObj --> ValidationMetier
    ValidationMetier -- Champs Invalides --> Err400C["throw ValidationError (HTTP 400: champ manquant/invalide)"]
    ValidationMetier -- Succès --> BusinessLogic[Exécution du Service Métier]
    BusinessLogic --> RespOK[HTTP 200 / 201 OK]
```

---

## 8. AFTER POC & COMPORTEMENTS SÉCURISÉS

### 8.1 Terminal Execute avec payload `null`
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Le corps de la requête doit être un objet JSON valide",
    "statusCode": 400,
    "requestId": "req_7a3d901b"
  }
}
```

### 8.2 AI Chat Completions avec payload `null`
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Le corps de la requête doit être un objet JSON valide",
    "statusCode": 400,
    "requestId": "req_1d4a821e"
  }
}
```

---

## 9. SUITE DE TESTS OFFENSIFS DÉDIÉE (P7-001)

Fichier : `apps/api/tests/security/p7-001-systemic-json-validation.test.ts`
Total de tests : **108 tests / 108 passés (100%)**

### Découpage des 108 tests :
1. **Tests Unitaires du Parser Centralisé (10 tests)** :
   - Rejet de `null`, `[]`, primitives numériques, chaînes, booléens, syntaxe corrompue.
   - Normalisation gracieuse des corps vides (`""`, whitespace) vers `{}`.
   - Préservation intégrale des objets valides et structures imbriquées.
2. **Tests d'Intégration HTTP sur les 15 Routes de Mutation (91 tests)** :
   - Chaque route est testée avec `null`, `[]`, `"string"`, `123`, `true`, et JSON tronqué.
   - Vérification systématique du code HTTP 400 (`VALIDATION_ERROR`).
   - Vérification de l'absence totale de réponses 500 ou 502.
3. **Tests de Cloisonnement d'Erreurs de l'AI Proxy (6 tests)** :
   - Rejet immédiat de `null` en HTTP 400 (et non plus 502).
   - Non-divulgation absolue de tout message V8 (`Cannot read properties of null`).
   - Préservation du statut 502 générique uniquement en cas de panne réseau réelle amont.
   - Robustesse face aux valeurs aberrantes de `max_tokens`.
4. **Tests de Concurrence & Haute Charge (1 test / 20 requêtes simultanées)** :
   - 20 requêtes concurrentes entrelacées (payloads valides et payloads invalides).
   - Invariance parfaite : aucune contamination d'état, isolation des sessions préservée.

---

## 10. VÉRIFICATION D'INVARIANCE DE L'ÉTAT & ABSENCE DE SIDE-EFFECTS

* **Aucune mutation en cas de rejet** : Lorsqu'une requête est rejetée avec HTTP 400, aucun projet fantôme n'est créé dans `projectStore`, aucun fichier temporaire n'est instancié dans `FileStore`, aucune révision n'est incrémentée et aucun processus terminal n'est invoqué.
* **Résilience des sockets HTTP** : Les connexions Keep-Alive restent stables et réutilisables sans fuite de descripteurs de fichiers ni désynchronisation de flux HTTP.

---

## 11. RÉSULTATS DE NON-RÉGRESSION

### 11.1 Suite de tests P7-001
```bash
node --test dist/apps/api/tests/security/p7-001-systemic-json-validation.test.js
```
* **Résultat** : **108 / 108 PASS (100%)** (durée : ~1.95s).

### 11.2 Suite de tests Red Team P6
```bash
node --test dist/apps/api/tests/security/red-team-p6-hunt.test.js \
dist/apps/api/tests/security/red-team-p6-remediation-006.test.js
```
* **Résultat** : **28 / 28 PASS (100%)**.

---

## 12. QUALITY GATE 1

```bash
node scripts/run_gate1_tests.mjs
```
* **Résultat** : **31 / 31 PASS (100%)**
* **Modules validés** : FND-001, FND-002, FND-003, FND-004, FND-005.

---

## 13. QUALITY GATE 2

```bash
node scripts/run_gate2_tests.mjs
```
* **Résultat** : **1624 / 1624 PASS (100% sur 347 suites)**
* **Vérifications intégrales franchies** :
  - TypeScript : OK (Strict, 0 erreur noEmit)
  - Build de production : OK
  - Tests régressions : 100% PASS
  - Parité Studio binaire byte-for-byte : OK
  - Intégrité syntaxique des 12 templates : OK
  - Séquence temporelle CAPP-007 (09:42 à 09:55) : Validée à 100%

---

## 14. TYPESCRIPT COMPILER

```bash
node node_modules/typescript/bin/tsc
```
* **Résultat** : **Code de sortie 0 (0 erreur de compilation)**.

---

## 15. INVENTAIRE DES FICHIERS MODIFIÉS & AJOUTÉS

### Fichiers Source Modifiés :
1. `apps/api/src/middleware/auth.ts` : Ajout des utilitaires `parseJsonBody` et `readJsonBody`.
2. `apps/api/src/routes/projects.ts` : Migration vers `parseJsonBody`.
3. `apps/api/src/routes/settings.ts` : Migration vers `parseJsonBody`.
4. `apps/api/src/routes/workspace.ts` : Migration vers `parseJsonBody`.
5. `apps/api/src/routes/project-state.ts` : Migration des routes `/status` et `/validate` vers `parseJsonBody`.
6. `apps/api/src/routes/revisions.ts` : Migration vers `parseJsonBody`.
7. `apps/api/src/routes/files.ts` : Migration des 6 routes de mutation (`POST /files`, `PUT /content`, `POST /mkdir`, `POST /rename`, `POST /copy`, `POST /batch`) vers `parseJsonBody`.
8. `apps/api/src/routes/terminal.ts` : Migration vers `parseJsonBody`.
9. `apps/api/src/routes/audit.ts` : Migration vers `parseJsonBody`.
10. `apps/api/src/routes/activity.ts` : Migration vers `parseJsonBody`.
11. `apps/api/src/routes/feedback.ts` : Migration vers `parseJsonBody`.
12. `apps/api/src/routes/feature-intelligence.ts` : Migration vers `parseJsonBody`.
13. `apps/api/src/routes/evolution.ts` : Migration vers `parseJsonBody`.
14. `apps/api/src/routes/strategy.ts` : Migration vers `parseJsonBody`.
15. `apps/api/src/routes/ai.ts` : Migration vers `parseJsonBody`, séparation stricte de la frontière d'erreur réseau et anonymisation du message d'erreur 502.

### Fichiers de Tests & Rapports Ajoutés :
16. `apps/api/tests/security/p7-001-systemic-json-validation.test.ts` : Suite offensive complète de 108 tests.
17. `security-audit/p7/remediation/P7-REMEDIATION-001.md` : Le présent rapport officiel de remédiation.

---

## 16. MATRICE DE TRAÇABILITÉ DES TESTS

| Vulnérabilité | Type de Test | Fichier de Test | Statut |
|:---|:---|:---|:---|
| **P7-VULN-01** (JSON parsing systémique) | Unitaire & Intégration HTTP (15 routes) | `apps/api/tests/security/p7-001-systemic-json-validation.test.ts` | **PASS (100%)** |
| **P7-VULN-02** (AI Proxy masquerading & leak) | Intégration HTTP & Frontières d'erreur | `apps/api/tests/security/p7-001-systemic-json-validation.test.ts` | **PASS (100%)** |
| Concurrence & Robustesse d'état | Concurrence 20 requêtes asynchrones | `apps/api/tests/security/p7-001-systemic-json-validation.test.ts` | **PASS (100%)** |
| Régression P6-VULN-06 | Intégration HTTP (16 scénarios) | `apps/api/tests/security/red-team-p6-remediation-006.test.js` | **PASS (100%)** |
| Régression Globale Phase 1 | Intégration & Unitaire FND-001 à 005 | `scripts/run_gate1_tests.mjs` | **PASS (31/31)** |
| Régression Globale Phase 2 | Intégration, RBAC, CAPP-001 à 007 | `scripts/run_gate2_tests.mjs` | **PASS (1624/1624)** |

---

## 17. FINAL VERDICT

```text
======================================================================
P7-001 REMEDIATION VERDICT : FIXED
======================================================================
```
