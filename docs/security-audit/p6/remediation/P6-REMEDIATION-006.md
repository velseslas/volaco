# RAPPORT DE REMÉDIATION - P6-REMEDIATION-006

## VULNÉRABILITÉ : P6-VULN-06 — Unhandled Exception via Null JSON Payload

* **Projet** : Volaco Core
* **Mission** : P6-REMEDIATION-006
* **Date** : 13 Septembre 2026
* **Sévérité** : LOW / MEDIUM (CVSS v3.1: 5.3 / CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L)
* **Auteur / Évaluateur** : Équipe Sécurité Offensive & Red Team Volaco
* **Statut Final** : **FIXED**

---

## 1. EXECUTIVE SUMMARY

Pendant la campagne **P6 Independent Final Red Team / Zero-Day Hunt**, une vulnérabilité de plantage non contrôlé (déni de service localisé / exception non gérée) a été constatée sur la route de création de projet :
* **Comportement vulnérable constaté** :
  L'envoi d'une requête HTTP `POST /api/v1/projects` avec un payload JSON littéral `null` (`Content-Type: application/json`, body: `null`) provoquait une exception non interceptée :
  `TypeError: Cannot read properties of null (reading 'name')`
  Cette exception remontait jusqu'au gestionnaire d'erreur global du serveur HTTP, déclenchant un log d'erreur avec stack trace et renvoyant une réponse `HTTP 500 Internal Server Error` (`INTERNAL_ERROR`).
* **Impact** :
  Bien que le serveur Node.js ne soit pas arrêté grâce au bloc `try/catch` global du listener HTTP, l'endpoint violait les principes de robustesse défensive (CWE-390 / CWE-754) en traitant une erreur de validation client comme une défaillance interne du serveur. De plus, les logs d'erreurs étaient pollués d'exceptions internes et les scanners de vulnérabilités signalaient une fragilité du runtime.
* **Remédiation appliquée** :
  Dans `apps/api/src/routes/projects.ts`, une validation structurelle explicite a été insérée immédiatement après le parsing JSON pour s'assurer que le corps de la requête est un objet non nul et non tableau avant toute tentative d'accès à la propriété `.name`.
  Tout payload `null`, tableau (`[]`), ou primitif (`123`, `"string"`, `true`) est désormais proprement intercepté et rejeté avec une `ValidationError` (`HTTP 400 Bad Request`), sans aucune exception non maîtrisée.

---

## 2. VULNÉRABILITÉ

* **Identifiant** : `P6-VULN-06`
* **Intitulé** : Unhandled Exception via Null JSON Payload
* **CWE** :
  - CWE-754: Improper Check for Unusual or Exceptional Conditions
  - CWE-390: Detection of Error Condition Without Action
  - CWE-20: Improper Input Validation
* **Classification** : Robustesse de l'API / Gestion des exceptions d'entrée / Résilience aux payloads non conformes

---

## 3. ENDPOINT CONCERNÉ

* **Méthode HTTP** : `POST`
* **Route** : `/api/v1/projects`
* **Fichier source** : `apps/api/src/routes/projects.ts` (fonction `handleProjectsRoutes`)

---

## 4. ROOT CAUSE

Dans l'implémentation initiale de `apps/api/src/routes/projects.ts` :
```typescript
// AVANT (Vulnérable à TypeError sur null)
const bodyText = await readBody(req);
let payload: { name?: string; description?: string };
try {
  payload = JSON.parse(bodyText || '{}');
} catch {
  throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
}

if (!payload.name || typeof payload.name !== 'string') {
  throw new ValidationError('Le champ "name" est obligatoire', undefined, requestId);
}
```

**Mécanisme de défaillance :**
1. En JavaScript/JSON standard, la chaîne `"null"` est un JSON parfaitement valide (`JSON.parse("null") === null`).
2. Le bloc `try/catch` ne lève aucune exception syntaxique car le JSON est valide.
3. La variable `payload` prend la valeur `null`.
4. L'expression `payload.name` tente alors d'accéder à la propriété `name` sur `null`.
5. Le moteur V8 lève immédiatement un `TypeError` natif : `Cannot read properties of null (reading 'name')`.
6. Ne s'agissant pas d'une sous-classe de `AppError`, l'erreur s'échappe de la route et atteint le gestionnaire global de `server.ts` qui la traite en incident `HTTP 500`.

---

## 5. BEFORE POC

Script de test offensif reproduisant la vulnérabilité sur une instance réelle du serveur HTTP :
```javascript
const res = await fetch('http://127.0.0.1:' + port + '/api/v1/projects', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + validJwtToken,
    'Content-Type': 'application/json'
  },
  body: 'null'
});
console.log('Status:', res.status);
console.log('Body:', await res.json());
```

---

## 6. BEFORE HTTP RESPONSE

### Statut HTTP
```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json
Connection: keep-alive
```

### Corps de la réponse
```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Erreur interne du serveur",
    "statusCode": 500,
    "requestId": "req_3f16dd0410784646"
  }
}
```

### Journal serveur (Logs)
```text
{"timestamp":"2026-09-13T01:42:16.642Z","level":"error","message":"Erreur interne non gérée lors du traitement HTTP","requestId":"req_3f16dd0410784646","context":{"service":"volaco-core","error":"Cannot read properties of null (reading 'name')","stack":"TypeError: Cannot read properties of null (reading 'name')\n    at handleProjectsRoutes (file:///.../dist/apps/api/src/routes/projects.js:26:22)\n    ...","method":"POST","path":"/api/v1/projects","tenantId":"tenant-poc-006"}}
```

---

## 7. CORRECTION APPLIQUÉE

Dans `apps/api/src/routes/projects.ts` :
```typescript
// APRÈS (Sécurisé avec garde de type structurelle)
const bodyText = await readBody(req);
let payload: unknown;
try {
  payload = JSON.parse(bodyText || '{}');
} catch {
  throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
}

if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
  throw new ValidationError('Le corps de la requête doit être un objet JSON valide', undefined, requestId);
}

const projectPayload = payload as { name?: unknown; description?: unknown };
if (!projectPayload.name || typeof projectPayload.name !== 'string' || projectPayload.name.trim().length === 0) {
  throw new ValidationError('Le champ "name" est obligatoire', undefined, requestId);
}

const description = typeof projectPayload.description === 'string' ? projectPayload.description : undefined;
const project = projectStore.createProject(context.tenantId, projectPayload.name.trim(), description);
res.statusCode = 201;
res.end(JSON.stringify({ project, requestId }));
return true;
```

---

## 8. ARCHITECTURE & VALIDATION CONCERNÉE

Le flux de traitement respecte désormais la chaîne de validation stricte :
```text
Requête HTTP POST
       │
       ▼
readBody(req) (Extraction du flux brut de bytes)
       │
       ▼
JSON.parse(bodyText || '{}') (Contrôle syntaxique)
       │
       ▼
Validation de forme (Non-null, typeof 'object', !Array.isArray)
       │
       ├─ Échec ──► throw ValidationError (HTTP 400 "objet JSON valide")
       │
       ▼
Validation des champs métier (name est string non-vide)
       │
       ├─ Échec ──► throw ValidationError (HTTP 400 "name obligatoire")
       │
       ▼
createProject() & Réponse HTTP 201 Created
```

---

## 9. AFTER POC

Exécution du même script de test avec payload `null` :
```javascript
const res = await fetch('http://127.0.0.1:' + port + '/api/v1/projects', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + validJwtToken,
    'Content-Type': 'application/json'
  },
  body: 'null'
});
console.log('Status:', res.status);
console.log('Body:', await res.json());
```

### Réponse HTTP obtenue
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json
Connection: keep-alive
```

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Le corps de la requête doit être un objet JSON valide",
    "statusCode": 400,
    "requestId": "req_08fe7fd3dc5240d2"
  }
}
```

---

## 10. TESTS OFFENSIFS

La suite offensive dédiée `apps/api/tests/security/red-team-p6-remediation-006.test.ts` implémente 16 tests automatisés :
1. **TEST 1 — null payload** : Rejeté avec HTTP 400 `VALIDATION_ERROR` ("objet JSON valide").
2. **TEST 2 — absent body** : Traité par repli `{}` puis rejeté avec HTTP 400 (champ `name` obligatoire).
3. **TEST 3 — malformed JSON** : Erreur de syntaxe JSON interceptée, HTTP 400 `VALIDATION_ERROR`.
4. **TEST 4 — array payload `[]`** : Tableaux rejetés avec HTTP 400.
5. **TEST 5 — primitive string `"hello"`** : Chaînes primitives rejetées avec HTTP 400.
6. **TEST 6 — primitive number `12345`** : Nombres primitifs rejetés avec HTTP 400.
7. **TEST 7 — primitive boolean `true`** : Booléens primitifs rejetés avec HTTP 400.
8. **TEST 8 — empty object `{}`** : Rejeté avec HTTP 400 (champ `name` obligatoire).
9. **TEST 9 — object without name `{ description: "..." }`** : Rejeté avec HTTP 400.
10. **TEST 10 — object with `name: null`** : Rejeté avec HTTP 400.
11. **TEST 11 — object with `name: 123`** : Rejeté avec HTTP 400.
12. **TEST 12 — object with unknown fields** : Champs inconnus tolérés, création avec HTTP 201.
13. **TEST 13 — valid payload** : Création nominale, HTTP 201 avec métadonnées complètes.
14. **TEST 14 — state invariance** : Invariance prouvée, aucun projet créé dans `projectStore`.
15. **TEST 15 — real HTTP flow** : Zéro fuite de stack trace ou de chemin interne.
16. **TEST 16 — regressions guard** : P6-001 à P6-005 intacts et opérationnels.

---

## 11. TESTS HTTP RÉELS

Les 16 tests sont exécutés contre une véritable socket réseau Node.js (`http://127.0.0.1:<port>`) avec parsing HTTP réel, passage dans les middlewares de rate limiting et d'authentification JWT, sérialisation/désérialisation JSON et écriture dans les repositories.

---

## 12. VÉRIFICATION ABSENCE DE SIDE EFFECTS

* **Aucun projet fantôme** : Test 14 vérifie que la liste `projectStore.listProjects(tenantId)` contient exactement 0 projet après une salve d'injections invalides.
* **Aucun effet de mémoire** : Aucun résidu n'est stocké dans les repositories de persistance.
* **Aucun crash de socket** : La connexion HTTP reste saine et réutilisable pour les requêtes suivantes.

---

## 13. P6 REGRESSION

Résultats de l'ensemble des suites de remédiation P6 :
```bash
node --test dist/apps/api/tests/security/red-team-p6-remediation-001.test.js \
dist/apps/api/tests/security/red-team-p6-remediation-002.test.js \
dist/apps/api/tests/security/red-team-p6-remediation-003.test.js \
dist/apps/api/tests/security/red-team-p6-remediation-004.test.js \
dist/apps/api/tests/security/red-team-p6-remediation-005.test.js \
dist/apps/api/tests/security/red-team-p6-remediation-006.test.js
```
* **Suites exécutées** : 6
* **Tests passés** : **91 / 91 PASS (100%)**
* **Échecs** : 0

Test d'audit global Red Team P6 :
```bash
node --test dist/apps/api/tests/security/red-team-p6-hunt.test.js
```
* **Tests passés** : **12 / 12 PASS (100%)** (P6-VULN-01 à P6-VULN-06 prouvés corrigés + P6-DEFENSE-01 à 06 validés).

---

## 14. P3-P5 REGRESSION

```bash
node --test dist/apps/api/tests/security/red-team-p5-remediation-*.test.js \
dist/apps/api/tests/security/red-team-p4-*.test.js \
dist/apps/api/tests/security/red-team-p3-live.test.js
```
* **Suites exécutées** : 28
* **Tests passés** : **138 / 138 PASS (100%)**
* **Échecs** : 0

---

## 15. QUALITY GATE 1

```bash
node scripts/run_gate1_tests.mjs
```
* **Tests passés** : **31 / 31 PASS (100%)**
* **Modules vérifiés** : FND-001 à FND-005

---

## 16. QUALITY GATE 2

```bash
node scripts/run_gate2_tests.mjs
```
* **Tests passés** : **1516 / 1516 PASS (100% sur 342 suites)**
* **Vérifications intégrales franchies** :
  - Compilation TypeScript (Strict, 0 erreurs)
  - Parité Studio binaire byte-for-byte
  - Intégrité syntaxique des 12 templates HTML
  - Séquence temporelle CAPP-007 (09:42 à 09:55)

---

## 17. TYPESCRIPT

```bash
node node_modules/typescript/bin/tsc
```
* Résultat : **0 erreur, build propre**.

---

## 18. FILES MODIFIED

1. `apps/api/src/routes/projects.ts` : Ajout de la garde de validation d'objet non-null et non-array.
2. `apps/api/tests/security/red-team-p6-hunt.test.ts` : Mise à jour du test P6-VULN-06 pour vérifier la réponse 400 VALIDATION_ERROR.
3. `apps/api/tests/security/red-team-p6-remediation-006.test.ts` : Création de la suite de test offensive dédiée (16 tests).
4. `security-audit/p6/remediation/P6-REMEDIATION-006.md` : Création du présent rapport de remédiation.

---

## 19. OUT-OF-SCOPE FINDINGS ÉVENTUELS

Aucun finding résiduel n'a été identifié durant cette mission.
Toutes les vulnérabilités du plan P6 (P6-VULN-01 à P6-VULN-06) sont désormais intégralement corrigées et éprouvées.

---

## 20. FINAL VERDICT

```text
======================================================================
P6-REMEDIATION-006 VERDICT : FIXED
======================================================================
```
