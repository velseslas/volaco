# AUDIT QUALITÉ CODE — volaco-core au 14/10/2026 (mesuré, read-only)

**Socle vérifié :** `tsc` strict:max vert, **2000/2000 tests**, `npm audit` **0 vulnérabilité**, 480 fichiers sources.

## 1. Verdict

| Axe | Note | Détail |
|---|---|---|
| Discipline de typage | **A** | `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `exactOptionalPropertyTypes` (le max raisonnable) ; **17 `any`**, 17 `as unknown as`, 4 `eslint-disable` sur 480 fichiers. |
| Dépendances | **A** | 3 prod (`playwright-core`, `react`, `react-dom`), 0 vulnérabilité. Surface minuscule = risque minuscule. |
| Tests | **A-** | 2000 pass, 0 skip, 0 todo. Moins : page hôte Builder et contrat SSE non couverts (déjà noté §8 audit preview). |
| Duplication | **C+** | 3 `workspaceDir` rivaux, 8 `sendJson` copiés, accumulateur body maison à côté de `readBody`. |
| Découpage | **C** | `conversation.ts` 89,5 Ko ; `server.ts` ~700 lignes multi-rôles ; `index.html` 1 Mo + `preview-builder-app.js` 100 Ko+ hors typage. |
| Hygiène d'arbre | **C-** | `.bak`, `_backup-*`, zips, `dist/` versionné : la "référence" se devine, les `git add` distraits menacent. |

**Note globale : B.** Cœur sain et discipliné, périphérie qui s'est empâtée vite (6 mois, un seul dev + IA).

## 2. Constats chirurgicaux (preuves `fichier:ligne`)

### Q-01 — 3 `workspaceDir` qui divergent (risque réel)
- `app-pipeline.ts:48` (durci SEC-01 : forme + confinement, **jette**) ;
- `file-explorer/store.ts:24` + `terminal/service.ts:35` (**sanitisent** en remplaçant par `_`, ne jettent jamais).
Deux philosophies cohabitent sans contrat commun : un id `..` **jette** d'un côté, devient `_` de l'autre (collisions silencieuses possibles entre projets `a/b` et `a_b`). → **Une seule fonction partagée**, un seul comportement.

### Q-02 — L'accumulateur body maison survit à côté de `readBody`
`mcp.ts:79-83` relit le corps auagrange octets **sans borne** (SEC-12 intact) alors que `middleware/body.ts` borne à 1 Mo partout ailleurs. 5 lignes à remplacer par `readBody(req)`.

### Q-03 — 8 `sendJson` copiés-collés
Un helper par fichier de route (ex. `auth.ts:15`, `preview-standalone.ts`). Divergence déjà visible (charset présent/absent, codes ad hoc). → un helper partagé `routes/_json.ts`.

### Q-04 — `conversation.ts` 89,5 Ko : le monolithe n°1
Stream SSE + questions + pièces jointes + vérif agent + tool-calls + planification : 6 responsabilités, 2 `eslint-disable` (les seuls du `src` avec l'autre moitié). Chaque nouveau correctif conversationnel augmente le risque de régression croisée. → extraire par étape (prompt, pièces jointes, vérification) avec les tests existants comme filet (ils sont bons).

### Q-05 — Le Studio n'est pas typé
`index.html` (1 Mo) + `preview-builder-app.js` : `tsc` ne les voit pas (`node --check` manuel seulement). C'est là qu'est né PV-03 (doublon invisible au build). → `checkJs` ou extraction des modules critiques en `.ts`.

### Q-06 — 55 TODO/FIXME, 14 `console.*` en source
Bruit de fond normal, mais sans propriétaire ni date : distinguer "dette acceptée" (ticket) de "pense-bête" (supprimer sous 30 j).

### Q-07 — Arbre encombré (SEC-14 intact, aggravé par nos phases)
`.bak` ×7, `_backup-*` ×2, zips, `dist/` suivi : `git status` fait 60+ lignes. → `.gitignore` complété + dossier `archives/` hors dépôt + `dist/` regénérable documenté (nos rebuilds répétés prouvent qu'il l'est : 2000/2000 après chaque rebuild).

## 3. Ce qu'il ne faut PAS faire
- Migrer de framework / réécrire : le socle (typage, tests, stores) est sain — une réécriture jetterait 2000 tests qui passent.
- Ajouter une lib de validation partout d'un coup : commencer par **une** route pilote (ex. MCP : `readBody` + schéma), mesurer, puis généraliser.
- Linter sévère immédiat sur tout l'arbre : 480 fichiers d'un coup = bruit ; l'activer **par dossier**, en commençant par `routes/`.

## 4. Plan (heures, même discipline)
1. Q-02 (15 min) : `readBody` dans `mcp.ts` — ferme SEC-12 au passage.
2. Q-01 (1 h) : `workspaceDir` unique partagé + test d'équivalence.
3. Q-03 + Q-07 (1 h) : helper JSON partagé, `.gitignore`, archives déplacées.
4. Q-04/Q-05 (fond) : découpage `conversation.ts` par étape, `checkJs` sur le Studio.

*Preuves : `tsconfig.json`, `package.json`, `npm audit`, comptages grep (17/17/4/55/14/8), `conversation.ts` 89,5 Ko, `mcp.ts:79-83`, `app-pipeline.ts:48` vs `store.ts:24` vs `terminal/service.ts:35`, `git status`.*
