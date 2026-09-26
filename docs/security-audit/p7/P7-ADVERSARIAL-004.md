# P7-004 — RAPPORT D'AUDIT ADVERSARIAL INDÉPENDANT POST-HARDENING
**Volaco Core — Audit de Robustesse et Fuzzing de Confusion de Types**
**Date :** 13 Septembre 2026  
**Auditeur Sécurité :** Antigravity Security Agent  
**Nature de la mission :** Audit indépendant strict (Zéro modification de code source)  
**Statut Global :** **CONDITIONAL (Confirmed findings identified for next remediation lot)**

---

## 1. Scope

Le périmètre de l'audit adversarial **P7-004** couvre l'ensemble des routes d'entrée utilisateur HTTP et des couches de services du monorepo Volaco Core suite aux campagnes P7-001 (Validation JSON systémique), P7-002 (Revalidation adversariale), et P7-003 (Hardening H-01 / H-02).

L'audit a pour objectifs exclusifs :
1. Déterminer si d'autres routes de mutation peuvent encore déclencher un `HTTP 500` via confusion de types (`TypeError`, `RangeError`, `SyntaxError`).
2. Identifier les divergences de validation entre la couche HTTP (contrôleur) et la couche métier (service).
3. Vérifier les risques de fuites d'informations runtime V8/Node.js dans les réponses HTTP.
4. Évaluer l'intégrité de l'état (invariance, corruptions partielles, objets fantômes).
5. Tester activement toute possibilité de contournement de P7-001 (parser JSON) et de P7-003 (H-01 tags, H-02 activity).
6. Éprouver la robustesse sous concurrence élevée (burst 30 requêtes entrelacées).

---

## 2. Baseline

Avant toute tentative d'injection adversariale, l'état de référence de la base de code a été validé à 100% :

- **TypeScript compilation (`tsc`) :** 0 erreur (Code de sortie 0)
- **Régression P7-001 (`p7-001-systemic-json-validation.test.js`) :** 108/108 PASS
- **Régression P7-003 (`p7-003-hardening-h01-h02.test.js`) :** 34/34 PASS
- **Régression P6 Red Team (`red-team-p6-hunt.test.js` & `red-team-p6-remediation-006.test.js`) :** 28/28 PASS
- **Quality Gate 1 (`run_gate1_tests.mjs`) :** 31/31 PASS
- **Quality Gate 2 (`run_gate2_tests.mjs`) :** 1658/1658 PASS

La baseline initiale est strictement intègre et opérationnelle.

---

## 3. Cartographie des surfaces sensibles

Une analyse statique des opérations JavaScript sensibles a été menée à travers les contrôleurs HTTP et les services du monorepo :
- Appels à des méthodes de chaîne (`.trim()`, `.toLowerCase()`, `.replace()`, `.startsWith()`, `.slice()`)
- Itérations et projections d'objets (`Object.entries()`, `Object.keys()`, `Object.values()`, spread `...`)
- Manipulation de collections et déduplication (`new Set()`, `[...iterable]`)
- Primitives de buffer et de cryptographie (`Buffer.byteLength()`, `createHash().update()`)

### Matrice des routes de mutation auditées :
| Route HTTP | Méthode | Payload attendu | Opérations JS sensibles en profondeur |
| :--- | :--- | :--- | :--- |
| `/api/v1/projects/:id/revisions` | POST | `{ message, files }` | `message.trim()`, `Object.entries(files)`, `Buffer.byteLength(content)` |
| `/api/v1/projects/:id/files/commit` | POST | `{ message, author }` | `message.trim()` dans `commitTreeToRevision` |
| `/api/v1/projects/:id/files/content` | PUT | `{ path, content }` | `sanitizePath(path)`, `Buffer.byteLength(content)` |
| `/api/v1/projects/:id/files` | POST | `{ path, type, content }` | `sanitizePath(path)`, `parts.split('/')` |
| `/api/v1/projects/:id/files/rename` | POST | `{ oldPath, newPath }` | `sanitizePath(oldPath)`, `sanitizePath(newPath)` |
| `/api/v1/projects/:id/files/move` | POST | `{ oldPath, newPath }` | `sanitizePath(oldPath)`, `sanitizePath(newPath)` |
| `/api/v1/projects/:id/files/operation`| POST | `{ type, path, ... }` | `op.type switch`, `sanitizePath(path)` |
| `/api/v1/projects/:id/settings` | PUT | `{ stack, envVars, tags }` | `tags.map()`, `new Set(tags)`, object checks |
| `/api/v1/projects/:id/activity` | POST | `{ type, description }` | `type.trim()`, `description.trim()` |
| `/api/v1/projects/:id/terminal/execute` | POST | `{ command, timeoutMs }` | `validateAndParseCommand(command)` |
| `/api/v1/projects/:id/workspace` | PUT | `{ activeFile, openFiles, ... }`| Assignation de session |
| `/api/v1/projects/:id/status` | PUT | `{ status, reason }` | `allowed.includes(status)` |
| `/api/v1/ai/chat/completions` | POST | `{ messages, model, ... }` | `Array.isArray(messages)`, `sanitizeAiMessages` |

---

## 4. Méthodologie adversariale

Pour chaque endpoint de mutation, une matrice de fuzzing de types a été injectée :
- `null`, `[]`, `{}`, `true`, `false`
- `0`, `123`, `-1`, `999999999999`
- `""`, `"   "`, `"normal"`
- `["string"]`, `{"nested": "object"}`
- Objets avec valeurs hétérogènes (`{ "a.txt": 123 }`, `{ "a.txt": null }`)

Chaque réponse HTTP a été inspectée sur :
- Statut HTTP (400 attendu pour toute entrée non conforme ; 500 interdit)
- Présence d'exceptions non gérées ou de messages V8 (`is not a function`, `ERR_INVALID_ARG_TYPE`)
- Invariance de l'état applicatif après rejet

---

## 5. Résultats par endpoint

1. **`POST /api/v1/projects/:id/revisions` : VULNÉRABLE (CONFIRMED)**
   - `message: 123` / `true` / `{}` -> Exception non gérée `TypeError: input.message.trim is not a function` -> **HTTP 500 INTERNAL_ERROR**
   - `files: { "file.txt": 123 }` / `{ "file.txt": null }` -> Exception non gérée `TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type string... Received type number` -> **HTTP 500 INTERNAL_ERROR**
   - `files: 123` -> Création silencieuse d'une révision vide avec **HTTP 201** (Hardening)

2. **`POST /api/v1/projects/:id/files/commit` : VULNÉRABLE (CONFIRMED)**
   - `message: 123` / `true` / `{}` -> Exception non gérée `TypeError: message.trim is not a function` dans `FileExplorerService.commitTreeToRevision` -> **HTTP 500 INTERNAL_ERROR**

3. **`PUT /api/v1/projects/:id/files/content` : ROBUSTE (PASS)**
   - `path: 123` -> Rejeté par `sanitizePath` en **HTTP 400 VALIDATION_ERROR**
   - `content: 123` -> Rejeté par `typeof payload.content !== 'string'` en **HTTP 400 VALIDATION_ERROR**

4. **`POST /api/v1/projects/:id/files` : ROBUSTE (PASS)**
   - `path: 123` -> Rejeté par `sanitizePath` en **HTTP 400 VALIDATION_ERROR**

5. **`POST /api/v1/projects/:id/files/rename` & `/move` : ROBUSTE (PASS)**
   - `oldPath: 123` / `newPath: 456` -> Rejetés par `sanitizePath` en **HTTP 400 VALIDATION_ERROR**

6. **`POST /api/v1/projects/:id/files/operation` : ROBUSTE (PASS)**
   - `type: 123` -> Rejeté par le switch default en **HTTP 400 VALIDATION_ERROR**

7. **`POST /api/v1/projects/:id/terminal/execute` : ROBUSTE (PASS)**
   - `command: 123` / `true` -> Rejeté par `validateAndParseCommand` en **HTTP 400 VALIDATION_ERROR**

8. **`PUT /api/v1/projects/:id/settings` : ROBUSTE (PASS - Protection H-01 confirmée)**
   - `tags: 123`, `tags: [123]`, `tags: null` -> Rejetés en **HTTP 400 VALIDATION_ERROR**

9. **`POST /api/v1/projects/:id/activity` : ROBUSTE (PASS - Protection H-02 confirmée)**
   - `description: 123`, `description: []`, `type: 123` -> Rejetés en **HTTP 400 VALIDATION_ERROR**

10. **`POST /api/v1/ai/chat/completions` : ROBUSTE (PASS)**
    - Messages primitifs, mal formés ou non-tableaux rejetés ou normalisés sans fuite.

---

## 6. Tests de confusion de types

Les tests ont révélé deux points de rupture où la validation se contente d'un contrôle de présence truthy (`if (!payload.message)`) sans validation stricte de type (`typeof payload.message === 'string'`) :
- Dans `apps/api/src/routes/revisions.ts` et `packages/core/src/model/revision-store.ts`
- Dans `apps/api/src/routes/files.ts` et `packages/core/src/file-explorer/service.ts`

---

## 7. Tests de contournement P7-001

Tentatives d'injection de payloads JSON non-objets (`null`, `[]`, `"text"`, `123`, `true`) et de syntaxes JSON malformées sur tous les endpoints de mutation.
- **Résultat :** Aucun contournement possible.
- Toutes les routes HTTP passent désormais systématiquement par `parseJsonBody`, rejetant immédiatement les primitives en HTTP 400.
- **Verdict : NO BYPASS**

---

## 8. Tests H-01 (CORE-006 SettingsService)

Tentatives d'injection de types anormaux pour `tags` (`123`, `true`, `{}`, `null`, `[123]`, `[true]`, `[{}]`, `["ok", 123]`).
- **Résultat :** Rejet systématique en HTTP 400 `VALIDATION_ERROR` tant au niveau de la route que du service.
- Aucun `TypeError: not iterable` observable.
- **Verdict : NO BYPASS**

---

## 9. Tests H-02 (CAPP-007 ProjectActivityService)

Tentatives d'injection de types anormaux pour `description` et `type` (`123`, `true`, `{}`, `[]`, `""`, `"   "`).
- **Résultat :** Rejet systématique en HTTP 400 `VALIDATION_ERROR`.
- Aucun `TypeError: trim is not a function` observable.
- Aucune entrée d'activité corrompue n'est créée.
- **Verdict : NO BYPASS**

---

## 10. Tests de fuite d'information

Examen des corps de réponse lors du déclenchement des erreurs 500 :
- Format renvoyé : `{"error":{"code":"INTERNAL_ERROR","message":"Erreur interne du serveur","statusCode":500,"requestId":"..."}}`
- Les détails internes V8 (`message.trim is not a function`, traces de pile, chemins `packages/core/...`) sont consignés dans les journaux structurés du serveur mais **ne sont pas divulgués au client HTTP** par défaut (sauf si `ENABLE_DEV_ERROR_DETAILS=true` en environnement de dev explicite).
- **Verdict fuite d'information HTTP : PASS (Aucune fuite externe)**

---

## 11. Tests de concurrence

Exécution d'un burst de 30 requêtes simultanées mélangeant requêtes valides (GET state), requêtes invalides H-01 (tags non valides), et requêtes invalides H-02 (descriptions non valides).
- **Résultats :**
  - 30/30 requêtes traitées sans collision d'état.
  - Aucune contamination entre requêtes ou fuite multi-tenant.
  - État du projet parfaitement invariant après les rejets 400.

---

## 12. Findings CONFIRMED

### P7-004-VULN-01 — MEDIUM — CVSS 5.3
**Unhandled TypeErrors in `POST /api/v1/projects/:projectId/revisions` via Non-String Message and File Contents**
- **Composant :** `apps/api/src/routes/revisions.ts` & `packages/core/src/model/revision-store.ts`
- **Mécanisme :**
  1. Si `payload.message` n'est pas une chaîne (ex. `123`, `true`, `{}`), `input.message.trim()` déclenche `TypeError: input.message.trim is not a function`.
  2. Si `payload.files` contient des valeurs non-chaînes (ex. `{"file.txt": 123}`), `createFileArtifact` déclenche `TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type string`.
- **Conséquence :** HTTP 500 INTERNAL_ERROR (Déni de service local / instabilité applicative).
- **Statut : CONFIRMED**

### P7-004-VULN-02 — MEDIUM — CVSS 5.3
**Unhandled TypeError in `POST /api/v1/projects/:projectId/files/commit` via Non-String Message**
- **Composant :** `apps/api/src/routes/files.ts` & `packages/core/src/file-explorer/service.ts`
- **Mécanisme :**
  Si `payload.message` est un type non-chaîne truthy (`123`, `true`, `{}`), `message.trim()` déclenche `TypeError: message.trim is not a function`.
- **Conséquence :** HTTP 500 INTERNAL_ERROR.
- **Statut : CONFIRMED**

---

## 13. Findings HARDENING

### H-03 — CORE-007 / CAPP-002 RevisionStore & Workspace State Loose Type Handling
- Dans `POST /api/v1/projects/:projectId/revisions`, si `payload.files` est un nombre (ex. `123`), `Object.entries(123)` renvoie `[]` et une révision vide est créée et persistée sans validation que `files` est un objet clé-valeur valide.
- Dans `WorkspaceService.updateWorkspaceState`, `openFiles` et d'autres champs de session acceptent des types hétérogènes sans contrôle strict de forme `Array.isArray`.
- **Statut : HARDENING**

---

## 14. False Positives

- **Hypothèse `PUT /files/content` avec `path: 123` :** Rejeté en HTTP 400 grâce à `sanitizePath`.
- **Hypothèse `POST /terminal/execute` avec `command: 123` :** Rejeté en HTTP 400 grâce à `validateAndParseCommand`.
- **Hypothèse `POST /files/rename` et `/move` :** Rejetés en HTTP 400 grâce à `sanitizePath`.
- **Hypothèse `POST /files/operation` avec type inconnu :** Rejeté en HTTP 400 par la clause `default`.

---

## 15. Résultats des Quality Gates

- **TypeScript compilation :** 0 erreur (Mode strict)
- **Suite dédiée P7-004 (`p7-004-adversarial-type-confusion.test.ts`) :** 11/11 PASS
- **Suite P7-001 :** 108/108 PASS
- **Suite P7-003 :** 34/34 PASS
- **Suite P6 :** 28/28 PASS
- **Quality Gate 1 :** 31/31 PASS
- **Quality Gate 2 :** 1658/1658 PASS

---

## 16. Repository Integrity

Conformément à la consigne stricte de la mission P7-004 :
- Aucun fichier de code source n'a été modifié.
- Aucun refactoring n'a été appliqué.
- Aucun test existant n'a été altéré.
- Les scripts de sonde temporaires créés dans `scratch/` ont tous été supprimés.
- Seuls le fichier de test dédié `apps/api/tests/security/p7-004-adversarial-type-confusion.test.ts` et le présent rapport ont été ajoutés.
- **Statut : PASS**

---

## 17. Final Verdict

L'audit adversarial P7-004 a confirmé deux vulnérabilités réelles de type `Unhandled TypeError` provoquant des retours `HTTP 500 INTERNAL_ERROR` sur les routes de révision (`POST /revisions` et `POST /files/commit`), ainsi qu'un finding de hardening sur la validation de la structure de fichiers de révision.

Conformément à la règle interdisant de déclarer `PASS` tant que des vulnérabilités confirmées subsistent et requièrent une remédiation dédiée (qui constituera le lot P7-005), le verdict est **CONDITIONAL**.
