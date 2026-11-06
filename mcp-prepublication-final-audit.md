# VOLACO CORE — AUDIT FINAL DE PRÉPUBLICATION (GATE DE SÉCURITÉ)

> **Type :** audit indépendant — **read-only sur l'environnement réel**. Aucune publication, aucune activation, aucune modification de `dist`/`.env`/`.volaco-data`.
> **Date :** 2026-11-05
> **Dépôt :** `C:/Users/FAYCAL/Desktop/volcanoo/volaco-core` (accès `Y:\`), `master`, HEAD `ea987c582b6a609ab419786d81633bfabbc5f18b`.
> **Seules écritures de cette mission :** 1 fichier suivi (`deploy/huggingface/README.md`, correction V-03 complémentaire) + son clone gitignoré. **Aucun** artefact, config ou donnée modifié.

---

## 1. RÉSUMÉ EXÉCUTIF

**L'audit confirme indépendamment l'essentiel du rapport précédent — avec deux découvertes nouvelles et un verdict conditionnel.**

**Confirmé :**
- Intégrité **intacte** : `dist`, `.env`, `.volaco-data`, Studio **inchangés** (hashes identiques).
- **V-02 corrigé** : les 3 suites Preview Builder passent de « échec au boot » à **37/38** ; le seul échec restant est **pré-existant** (invariant n°11).
- **V-03 corrigé** (et étendu, cf. découverte ci-dessous).
- **Reproductibilité source→dist : DÉMONTRÉE** par build shadow isolé — **559/559 fichiers JS non-test identiques** ; 0 orphelin ; `dist` **non modifié** par le build.
- **`patch/dist/` : STALE**, non importé, non tracké, non appliqué.
- **Non-régression : 3032 tests → 3007 pass / 25 fail / 0 annulé** (reproduit à l'identique).
- **Rollback artefact : DÉMONTRÉ** en environnement isolé (bascule, échec simulé, restauration, hash identique, DB `integrity_check: ok`).

**Découvertes nouvelles (non signalées précédemment) :**

- **GATE-01 (P1) — Fail-closed neutralisé par le filet de sécurité process.** `loadConfig()` **lève** correctement l'erreur si `VOLACO_JWT_SECRET` est absent, **mais** le handler pré-existant `process.on('uncaughtException', …)` (`server.ts:772-788`) **avalé** l'exception et journalise « *le serveur continue de fonctionner* ». Résultat : le processus **ne s'arrête pas** et **ne binde pas** le port — un opérateur voit un log trompeur au lieu d'une sortie fatale claire. Pas de trou de sécurité (aucun service exposé), mais **défaut opérationnel/observabilité** à corriger avant activation.
- **GATE-02 (P2) — Documentation de déploiement contradictoire.** `deploy/huggingface/README.md` (suivi) et sa copie `upload/` (gitignorée) indiquaient encore `AUTH_SECRET` comme « secret de signature JWT » et **omettaient** `VOLACO_JWT_SECRET` → un opérateur suivant ce guide aurait un service qui ne démarre pas. **Corrigé** dans cette mission.

**Verdict : `GO SOUS CONDITIONS`.** Reproductibilité, V-02, V-03 et rollback artefact démontrés ; mais **le rollback complet (config/data) reste NON DÉMONTRÉ**, le **secret n'est pas encore fourni**, et **GATE-01** doit être traité.

---

## 2. ÉTAT INITIAL

| Élément | Valeur | Preuve |
|---|---|---|
| realpath | `…\Desktop\volcanoo\volaco-core` | `(Get-Item Y:\).Target` |
| Commit / branche | `ea987c5` / `master` | `git rev-parse` |
| Worktree | **139 modifiés**, **52 non suivis** | `git status --porcelain` |
| Serveur actif | **:3000** pid **7908**, `node --env-file=.env dist/apps/api/src/server.js`, démarré **2026-11-04 21:40:14** | `Win32_Process` |
| Autre | :8080 pid 23696 (autre workspace, hors dépôt) | `Win32_Process` |
| `.env` (noms seulement) | `PORT, NODE_ENV, AUTH_SECRET, MISTRAL_API_KEY, MISTRAL_MODEL` | lecture noms |
| Données | `.volaco-data/volaco.db` (41 Mo), WAL 61 Mo | listing |
| Rapports | `mcp-lot-b-report.md` ✅, `mcp-master-audit-post-lot-b.md` ✅, `mcp-safe-activation-report.md` ✅ — **`mcp-lot-a-report.md` ABSENT** | listing |

**Écart vs phase précédente :** 138→**139** modifiés (les 6 de la phase précédente **+1** de celle-ci, `deploy/huggingface/README.md`), 51→**52** non suivis (le rapport précédent **+1** depuis, `mcp-prepublication-final-audit.md` à venir). **Aucune modification non autorisée.**

---

## 3. INTÉGRITÉ DES FICHIERS (Phase A)

### Empreintes SHA-256 (avant / après mission — identiques pour les protégés)

| Fichier | Hash (16) | Attendu (rapport précédent) | Statut |
|---|---|---|---|
| `dist/apps/api/src/server.js` | `711E60EB3A0F8397` | `711E60EB3A0F8397` | ✅ inchangé |
| `dist/packages/core/src/config.js` | `8565993F69EF8482` | `8565993F69EF8482` | ✅ inchangé |
| `apps/studio/index.html` | `6802BCF4E2E971FB` | `6802BCF4E2E971FB` | ✅ inchangé |
| `apps/studio/preview-builder-app.js` | `37BD83E444F8FAD1` | `37BD83E444F8FAD1` | ✅ inchangé |
| `.env` | `FF8DED541E2E47A9` | `FF8DED541E2E47A9` | ✅ inchangé |
| `.env.example` | `7ED49AEBB2BB19BF` | `7ED49AEBB2BB19BF` | ✅ (V-03 phase préc.) |
| `README.md` | `7B5A622C70C1FD2F` | `7B5A622C70C1FD2F` | ✅ (V-03 phase préc.) |
| `packages/core/src/config.ts` | `E70B6BE35FA4CD99` | `E70B6BE35FA4CD99` (rapport Lot B) | ✅ inchangé |
| **`dist` (agrégat 2497 fichiers)** | **`030B5726B6F26701`** | — | ✅ **inchangé avant/après** |

- `.tmp-lot8-tsconfig.json` : `D69E29BDC6BFC96D` ; `.tmp-lot8-build/` : 798 fichiers, agrégat `07C1CBB6BBB6585F`.
- Rapports : `mcp-lot-b-report.md` `2765C84BB54FE315`, `mcp-master-audit-post-lot-b.md` `75167D66C0200A95`, `mcp-safe-activation-report.md` `22BF79DE66C807FA`.

### Les 6 modifications de la phase précédente (vérifiées)
`.env.example`, `README.md`, `docs/adr/ADR-002-jwt-per-user-tenants.md`, `packages/core/tests/preview-builder/{preview-final,preview-integration,real-source}.test.ts` — **exactement** les 6 attendues. ✅

**Critère de validation : ATTEINT** — aucune modification non autorisée, aucune altération des données/artefacts protégés.

---

## 4. VÉRIFICATION V-02 (Phase B1)

| Contrôle | Résultat |
|---|---|
| 1. Import du helper **avant** `createApiServer` | ✅ `import '../_lot-b-secret-env.js';` en tête des 3 fichiers |
| 2. Helper limité aux tests | ✅ importé **uniquement** par des `*.test.ts` (aucun fichier `src/`) |
| 3. Entropie suffisante | ✅ `randomBytes(32)` = 256 bits |
| 4. Aucune valeur secrète persistée | ✅ n'écrit que `process.env` en mémoire |
| 5. Aucun fallback en production | ✅ aucun `src/` n'importe le helper |
| 6. Aucun contrôle affaibli | ✅ `config.ts` inchangé (`E70B6BE35FA4CD99`) |
| 7. Validation obligatoire en production | ✅ prouvé : sans secret, `loadConfig()` **lève** ; en `NODE_ENV=production` + `VOLACO_STRICT_AUTH='0'`, `resolveStrictAuth()` reste **true** (strict non désactivable) |

**Rejeu isolé** (build shadow, `VOLACO_DATA_DIR` temporaire) : **37/38**. Échec unique = `real-source` n°11.

**Analyse de l'échec n°11 (pré-existant, NON corrigé) :** le test exige que `conversation.ts` soit l'**unique** émetteur `/stream`. Or `apps/api/src/routes/agent-generation-pipeline.ts` (fichier **non suivi**, mtime **2026-11-02**, hors Lot A/B) contient `/stream`. Le test échoue pour cette raison **indépendamment de V-02** (V-02 n'a ajouté qu'un import). **Statut : pré-existant, à traiter par le propriétaire de ce fichier** (soit retirer `/stream` de ce fichier, soit mettre à jour l'invariant). Ni « corrigé » ni « régressé » par V-02.

---

## 5. VÉRIFICATION V-03 (Phase B2)

| Point | `.env.example` | `README.md` | `ADR-002` |
|---|---|---|---|
| `VOLACO_JWT_SECRET` documenté | ✅ | ✅ | ✅ |
| Génération sécurisée (`openssl`/`randomBytes`) | ✅ | — | — |
| Longueur min 32 octets explicite | ✅ | ✅ | ✅ |
| Indépendant de `VOLACO_API_KEY` | ✅ | ✅ | — |
| `AUTH_SECRET` = historique | ✅ [SEC-004] | ✅ | ✅ |
| `VOLACO_STRICT_AUTH` documenté | ✅ | ✅ | — |
| `NODE_ENV` + implications | ✅ | — | — |
| Aucun secret réel | ✅ (placeholders) | — | — |

**Contradictions résiduelles détectées et corrigées (GATE-02) :**
- `deploy/huggingface/README.md` (suivi) et `deploy/huggingface/upload/README.md` (gitignoré) : table de secrets lisait encore `AUTH_SECRET = secret de signature JWT`, sans `VOLACO_JWT_SECRET`. **Corrigés** (ajout `VOLACO_JWT_SECRET` obligatoire + statut historique de `AUTH_SECRET` + commande de génération).
- Restent : `.zcode/plans/*.md` (plan de travail, non opérationnel) et les archives `docs/archives/`, `docs/security-audit/p*` (historiques — non modifiés, ce sont des rapports datés). **Scan secrets : aucun secret.**

---

## 6. REPRODUCTIBILITÉ SOURCE → DIST (Phase C)

### C1 — Périmètre
- Build : `npm run build` = `tsc` ; outil : TypeScript ; config racine `tsconfig.json` (`target ES2022`, `module NodeNext`, `declaration: true`, `sourceMap: true`, `outDir: ./dist`, `include: ["packages/**/*.ts","apps/**/*.ts"]`).
- Pas d'alias, pas de post-build, pas de générateur, pas de copie de statique déclarée. **`scripts/clean-dist.mjs`** supprime tout `dist/` (⚠️ RELEASE-POLICY : ne jamais l'invoquer en préparation release).

### C2 — Build shadow strictement isolé
- tsconfig temporaire `.tmp-gate-shadow-tsconfig.json` étendant `tsconfig.json`, `outDir: ./.tmp-gate-shadow`, `declaration:false`, `sourceMap:false`.
- **Garantie d'isolation vérifiée :** agrégat `dist` **`030B5726B6F26701` AVANT et APRÈS** le build → le build n'a **rien** écrit dans `dist`. Aucun accès `.volaco-data`, aucun serveur réel.

### C3 — Comparaison

| Mesure | Résultat |
|---|---|
| `dist` JS non-test | **559** |
| Identiques (contenu, hors ligne `//# sourceMappingURL`) | **559 / 559** |
| Différents | **0** |
| Manquants dans le build shadow | **0** |
| Fichiers **en plus** dans `dist` | `apps/api/tests/bench-ttf.js` (helper `.js` committé sur disque, non compilé par tsc, non référencé, non `*.test.js`) + les `.d.ts`/`.js.map` (normaux : shadow sans declaration/sourceMap) |
| Orphelins (`.js` sans `.ts` source) | **0** |

**Conclusion :** `dist` est **intégralement reproductible** depuis les sources actuelles. Publier les sources actuelles **ne fait disparaître aucune fonctionnalité** présente dans le `dist` courant.

### C4 — `patch/dist/`
- **Contenu :** 33 fichiers d'anciens noms (`mutate.js`, `validate.js`, `preview.js`, `memory.js`, `security-middleware.js`, `server.js` 528 lignes…).
- **Usage :** **aucun** import depuis `src/` ni `dist/` (grep vide) ; **référencé uniquement par `prepare-release.mjs`** qui le **copie** dans la release sans l'appliquer.
- **Git :** **non tracké** (0 fichier suivi).
- **Ancienneté :** plus récent **2026-09-25**.
- **Verdict :** **STALE** — noms de fichiers absents du `dist` actuel (renommés depuis). **Non appliqué au runtime.** Ne pas le supprimer (hors mandat), mais le considérer inerte.

---

## 7. AUDIT `patch/dist/` — synthèse
Voir §6-C4. Aucune dépendance de packaging ne le lit pour *composer* le runtime ; il est copié mais inerte. **Aucun impact fonctionnel.**

---

## 8. CONFIGURATION JWT (Phase D)

1. **Mécanisme de chargement :** `start` = `node --env-file=.env dist/.../server.js`. De plus, `server.ts:768-773` appelle **`process.loadEnvFile()`** (sans argument) au boot.
2. **Fichier réellement chargé :** `.env` (depuis le `cwd`). **⚠️ Comportement à connaître :** `process.loadEnvFile()` no-arg recharge `.env` du cwd **indépendamment** du `--env-file`. Un `--env-file=autre` **n'empêche pas** le chargement de `.env` si présent.
3. **Priorité :** **environnement réel > `.env`** (vérifié empiriquement : une variable déjà positionnée dans le shell **gagne** sur la valeur du fichier). Donc injecter le secret via l'environnement réel est prioritaire.
4. **Longueur :** ≥ 32 octets décodés (`config.ts:49`).
5. **Format :** base64 **canonique** (`decoded.toString('base64') === raw`).
6. **Indépendance :** rejet si octets égaux à `VOLACO_API_KEY` (base64 ou utf8).
7. **Fallback :** **aucun** (pas de secret éphémère, pas d'`AUTH_SECRET`).
8. **Absent :** `loadConfig()` **lève** « … Le service refuse de démarrer ».
9. **Invalide :** idem (format/longueur/clé API).
10. **Production :** strict **imposé** ; `VOLACO_STRICT_AUTH='0'` **ignoré**.
11. **Dev/test :** strict par défaut ; `'0'` désactive.

### GATE-01 (P1) — détail (nouvelle découverte)
- `config.ts:90` lève (prouvé, stack : `loadConfig → createApiServer → server.js:698`).
- **Mais** `server.ts:772-788` : `process.on('uncaughtException', err => logger.warn('Exception non interceptée — le serveur continue de fonctionner', …))` → **l'exception est absorbée**.
- **Comportement observé (isolé) :** processus **vivant** (12 s+), **port non ouvert** (`listening=False`), log trompeur « le serveur continue de fonctionner ». **Aucune sortie fatale claire.**
- **Impact :** opérateur induit en erreur (croit à un démarrage partiel) ; processus zombie à superviser. **Pas** d'exposition de service (le port n'est pas bindé) → pas de fail-open de sécurité, mais fail-closed **non signalé proprement**.
- **Recommandation :** ne pas avaler `uncaughtException` pendant le bootstrap (ou `process.exit(1)` explicite sur échec `loadConfig`), afin que « refuse de démarrer » soit **observable**.

### Procédure opérateur (secret — non exécutée ici)
1. Générer localement : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (ou `openssl rand -base64 32`).
2. Vérifier ≠ `VOLACO_API_KEY` et ≠ `AUTH_SECRET`.
3. Stocker dans le **gestionnaire de secrets** du déploiement (env réel, prioritaire sur `.env`) ou dans `.env` **local non versionné** ; permissions minimales.
4. **Jamais** dans Git, **jamais** dans un log, **jamais** renvoyé par une route.
5. Rotation : remplacer + redémarrer (invalide tous les JWT) hors heures de pointe (cf. `mcp-lot-b-report.md §9`).

> Le secret **reste à fournir par l'opérateur** : `VOLACO_JWT_SECRET` est **absent** de `.env` et de tout `.env.*` (vérifié — présence seulement). **Aucune valeur n'a été lue ni affichée.**

---

## 9-10. DÉMONSTRATION DU ROLLBACK (Phase E) — ARTEFACT DÉMONTRÉ

Environnement **totalement isolé** : `%TEMP%\volaco-rollback-*` (supprimé en fin de mission) ; copie de `dist` + `apps/studio` ; jonction `node_modules` (lecture seule) ; `.env` de test (`VOLACO_JWT_SECRET` aléatoire 32 octets, `VOLACO_API_KEY` distinct, `NODE_ENV=production`, `VOLACO_STRICT_AUTH=1`) ; port **3199** (non utilisé) ; `.volaco-data` **jamais** touché. **Serveur réel :3000 jamais utilisé.**

| Étape | Action | Résultat |
|---|---|---|
| 1-3 | Installer + démarrer artefact A, sonder la santé | ✅ `/health` 200 ; Studio 200 |
| 4 | Sauvegarder (hash + copie) | ✅ agrégat A `030B5726B6F26701` (= `dist` réel) |
| 5-6 | Préparer + démarrer candidate B (build shadow) | ✅ health 200 |
| 7 | Sondes sécurité candidate B | ✅ `logout` 401, `noauth` 401, `forged headers` 401 |
| — | Preuve révocation (end-to-end) | ✅ `signup 201 → before 200 → logout 200 (all-sessions) → after 401` |
| 8 | **Simuler échec** candidate C (module corrompu) | ✅ échec : `SyntaxError: does not provide an export` ; `health FAILED` |
| 9-10 | **Rollback** : restaurer A + redémarrer (isolé) | ✅ health 200 en ~1 s |
| 11 | Sondes post-restauration | ✅ identiques à l'état précédent |
| 12 | Hash artefact restauré | ✅ `030B5726B6F26701` = **identique** |
| 13-14 | Intégrité base temporaire | ✅ `PRAGMA integrity_check: ok` ; pas de corruption |

**Durées :** restauration artefact (rm + copie de 2497 fichiers) = opération FS **sub-seconde** ; démarrage→prêt ≈ **1 s**. **Résultat : rollback ARTEFACT DÉMONTRÉ.**

### Les trois rollbacks (distincts — statut)
| Type | Procédure | Statut |
|---|---|---|
| **Artefact (`dist`)** | restaurer la copie sauvée (hash vérifié) | **DÉMONTRÉ** (isolé) |
| **Configuration (`.env`)** | restaurer `.env` sauvé (retrait/ajout secret) | **NON DÉMONTRÉ** (analyse) — la manipulation `.env` du sandbox a seulement **révélé GATE-01**. Procédure à démontrer en phase d'activation. |
| **Données (`.volaco-data`)** | snapshot serveur arrêté (WAL cohérent) | **NON DÉMONTRÉ** (isolé) — non tenté (aucune migration ; `.volaco-data` réel interdit) |

---

## 11. MATRICE DE CONTRÔLE POST-PUBLICATION (Phase F — à exécuter après autorisation)

| Domaine | Contrôle attendu | Commande (à lancer après bascule) | Résultat attendu |
|---|---|---|---|
| Démarrage | Service opérationnel | `GET /health` | 200 |
| JWT | Secret dédié obligatoire | (config) | démarrage OK seulement si `VOLACO_JWT_SECRET` valide |
| Authentification | Routes privées protégées | `GET /api/v1/projects` sans auth | 401 |
| Usurpation | Headers falsifiés sans effet | `GET /api/v1/projects` + `x-tenant-id`/`x-user-role` | 401 (strict) |
| Révocation | Token révoqué refusé | signup→`before 200`→logout→`after 401` | 200 puis 401 |
| Logout | Endpoint reconnu + authentifié | `POST /api/v1/auth/logout` sans JWT | 401 (≠ 404) |
| MCP | Exécution gouvernée | `GET /api/v1/mcp/servers` (sans perm) | 401/403 |
| STDIO | Aucun contournement | (revue) aucun `spawn` MCP | — |
| HTTP | SSRF conservée | connecteur URL privée | refus |
| Confirmation | Call sans confirmation refusé | `POST …/tools/:t/call` sans `confirmationId` | 400/409 |
| Audit | Événements critiques persistés | `auditStore.health()` / journal | `pending=0` après évt critique |
| Quotas | Dépassement refusé + audité | > N appels MCP/min | 429 + `MCP_REMOTE_RATE_LIMITED` |
| Multi-tenant | Isolation | projet d'un tenant via token d'un autre | 404 indiscernable |
| Preview Builder | Fonctionnement normal | `GET /preview-builder.html` | 200 |
| Studio | Chargement/auth normaux | `GET /` + login | 200 |
| Santé | Logs cohérents | logs de démarrage | pas de « continue de fonctionner » trompeur (**GATE-01**) |

**Contrôles d'identité/tenant renforcés (au-delà du statut HTTP) :** vérifier le **tenant résolu** (issu du JWT, non des headers), les **données retournées** (aucune fuite cross-tenant), et l'**absence d'identité fabriquée**. À instrumenter via les réponses réelles.

> La matrice est **PRÊTE mais non exécutée** (exige l'environnement publié). Les sondes 1-4 et la révocation ont toutefois déjà été **exercées avec succès** dans l'environnement isolé (§10).

---

## 12. ÉVALUATION DES RISQUES (Phase G)

| ID | Sév. | Fichier:ligne | Constat | Déclencheur | Impact | Repro | Recommandation | Statut |
|---|---|---|---|---|---|---|---|---|
| **GATE-01** | **P1** | `apps/api/src/server.ts:772-788` | `uncaughtException` avale le refus `loadConfig` | `.env`/env sans `VOLACO_JWT_SECRET` | Pas de service (port non bindé) mais processus zombie + log trompeur « continue de fonctionner » | isolé (fait) | ne pas avaler au bootstrap ; `process.exit(1)` sur échec config | **OUVERT** |
| **GATE-02** | **P2** | `deploy/huggingface/README.md` (+ copie) | doc déploiement affirmait `AUTH_SECRET` = secret JWT | opérateur suivant le guide | service ne démarre pas (secret absent) | lecture | **CORRIGÉ** cette mission | **FERMÉ** |
| **V-01** | **P0** | runtime `:3000` + `.env` | Lot B dormant + secret absent `.env` | déploiement actuel | garanties non actives | sonde | déployer + fournir le secret | **OUVERT (opérationnel)** |
| **V-02** | **P1** | `preview-builder/*.test.ts` | 3 suites échouaient au boot | exécution tests | couverture perdue | rejeu | **CORRIGÉ** | **FERMÉ** |
| **V-03** | **P1** | `.env.example`/`README`/`ADR-002`/deploy | doc obsolète | opérateur | confusion / non-démarrage | lecture | **CORRIGÉ** (+deploy) | **FERMÉ** |
| **R-11** | **P2** | `real-source.test.ts:127` | invariant « unique émetteur /stream » violé par `agent-generation-pipeline.ts` (pré-existant) | exécution | 1 test rouge | rejeu | propriétaire du fichier : corriger la source ou l'invariant | **OUVERT (pré-existant)** |
| **R-25** | **P2** | 25 suites | échecs pré-existants (bundle/révision/UI/keyring/HTML) | exécution | qualité | rejeu | suivi séparé | **OUVERT (pré-existant)** |
| **V-06** | **P2** | `rate-limit.ts` | quotas **mono-instance** | scale horizontal | quota ×N | lecture | compteur partagé si scale | OUVERT (scale) |
| **V-07** | **P2** | `observability/audit.ts` | amplification `JSON.stringify` O(n) sur flush critique (~8 ms à 4900 évt) | rafale d'événements critiques | auto-DoS event-loop | micro-bench | append-only SQLite (§7 rapport préc.) | OUVERT (perf) |
| **R-PATCH** | **P3** | `patch/dist/` | overlay stale inerte | — | aucun | grep | documenter ; ne pas appliquer | CONNU |
| **R-ENV** | **P2** | `server.ts:768` | `process.loadEnvFile()` no-arg recharge `.env` du cwd | env `--env-file` alternatif | surcharge inattendue | testé | documenter la priorité (env réel > `.env`) | OUVERT |

**P0/P1 bloquants :** V-01 (P0 opérationnel : non déployé) et GATE-01 (P1 : fail-closed non observable). Ni l'un ni l'autre n'est un trou de sécurité exploitables, mais **V-01 + secret manquant** bloquent l'activation, et **GATE-01** doit être corrigé pour un démarrage honnête.

---

## 13. TESTS EXÉCUTÉS

| Groupe | Fichiers | Tests | Pass | Fail |
|---|---|---:|---:|---:|
| Preview Builder (V-02) isolés | 3 | 38 | 37 | 1 (n°11 pré-existant) |
| MCP + sécurité + tenancy + auth (phase préc., reproduits) | 13 | 141 | 141 | 0 |
| **Non-régression globale (glob `dist/**/*.test.js`)** | **266** | **3032** | **3007** | **25** |

Toutes exécutions : `node --test --test-concurrency=1`, **build shadow isolé**, `VOLACO_DATA_DIR` **temporaire**. `dist` jamais modifié. Sonde end-to-end isolée : `signup 201 → before 200 → logout 200 → after 401` ; `forged headers → 401`.

---

## 14. TESTS NON EXÉCUTÉS (et pourquoi)

| Non exécuté | Raison |
|---|---|
| Rollback **configuration** et **données** (réels) | interdits (pas de modif `.env`/`.volaco-data`) ; seul le rollback **artefact** isolé a été démontré |
| Benchmark de charge (`bench-backend.mjs`, `load-test.mjs`) | créent des données / visent `:3000` réel — interdits |
| Sondes post-publication (§11) | exigent l'environnement publié |
| Rotation de secret réelle | interdite (pas de changement de secret) |
| 4 `t.skip` Chromium (render/host) | dépendance navigateur absente |

---

## 15. RÉSULTATS AVANT / APRÈS (cette mission)

| Indicateur | Avant mission | Après mission |
|---|---|---|
| Modified / untracked | 138 / 51 | **139 / 52** |
| `dist` agrégat | `030B5726B6F26701` | **`030B5726B6F26701`** (inchangé) |
| `.env` | `FF8DED541E2E47A9` | **inchangé** |
| Tests globaux | 3032 / 3007 / 25 | **3032 / 3007 / 25** (reproduit) |
| Doc déploiement contradictoire | présente (2 fichiers) | **corrigée** |
| GATE-01 (fail-closed) | non connu | **identifié (P1)** |

---

## 16. LIMITATIONS

1. **Aucun build de publication, aucune activation, aucun redémarrage** — le runtime `:3000` reste **pré-Lot B**.
2. **Rollback config/données non démontrés** (interdits sur le réel ; seuls artefact + DB temporaire isolés l'ont été).
3. **`mcp-lot-a-report.md` absent** : continuité documentaire Lot A non traçable par pièce.
4. **GATE-01** découvert en isolé ; non corrigé (hors mandat read-only, à autoriser).
5. **25 échecs pré-existants** non traités (hors Lot A/B).
6. **Inspections runtime** limitées aux sondes HTTP non destructives + analyse temporelle (pas d'introspection mémoire).
7. **Bench de charge non exécuté** (interdit) : conclusions de perf issues de micro-mesures mémoire.

---

## 17. GATE FINAL — VERDICT PAR CRITÈRE

| Critère | Verdict | Preuve |
|---|---|---|
| Intégrité du dépôt | **VALIDÉ** | hashes `dist`/`.env`/`.volaco-data` identiques |
| V-02 | **VALIDÉ** | 3 suites réparées (37/38) ; validation prod intacte |
| V-03 | **VALIDÉ** | `.env.example`/`README`/`ADR-002` + `deploy/*` corrigés |
| Reproductibilité source/dist | **VALIDÉ** | 559/559 identiques ; 0 orphelin ; build n'a pas touché `dist` |
| Absence de perte fonctionnelle | **VALIDÉ** | `dist` reproductible ; `patch/` inerte non appliqué |
| Secret JWT | **NON PRÊT** | `VOLACO_JWT_SECRET` absent de `.env`/env cible |
| Rollback artefact | **VALIDÉ** | isolé : hash restauré `030B5726B6F26701` |
| Rollback configuration | **NON DÉMONTRÉ** | analyse seulement (GATE-01 découvert) |
| Rollback données | **NON DÉMONTRÉ** | non tenté (interdit sur le réel) |
| Matrice de sécurité | **PRÊTE** (non exécutée) | §11 |
| Risques P0/P1 | **BLOQUANTS à l'activation** (V-01, GATE-01) — mais **corrigibles**, pas de fail-open sécurité démontré | §12 |

### Verdict général : **GO SOUS CONDITIONS**

Motifs (conformes aux règles du gate) :
- **Pas de NO-GO** : intégrité **validée**, reproductibilité **validée**, V-02/V-03 **validés**, **rollback artefact démontré**, aucune vulnérabilité de type fail-open démontrée.
- **Pas de GO** : (a) le **rollback complet (config/données) n'est pas démontré** ; (b) le **secret JWT n'est pas disponible** dans l'environnement cible ; (c) **GATE-01** (P1) doit être corrigé pour que le refus de démarrage soit observable.

**Conditions à lever avant GO :**
1. Fournir `VOLACO_JWT_SECRET` valide dans l'environnement cible (opérateur).
2. Corriger **GATE-01** (ne pas avaler le refus de config au bootstrap).
3. Démontrer le **rollback configuration** et proposer/démontrer le **rollback données** (isolé).
4. Exécuter la **matrice §11** après publication, avec vérification d'identité/tenant réelle.

---

## 18. COMMANDES DE REPRODUCTION UTILES

```powershell
# Identité
[System.IO.Path]::GetFullPath("Y:\") ; (Get-Item "Y:\").Target ; git rev-parse HEAD ; git status --porcelain

# Empreintes protégées
Get-FileHash dist\apps\api\src\server.js,dist\packages\core\src\config.js,.env -Algorithm SHA256

# Build shadow ISOLÉ (jamais dans dist) — tsconfig étendant tsconfig.json, outDir=.tmp-gate-shadow
npx tsc -p .tmp-gate-shadow-tsconfig.json
# (vérifier dist inchangé : agrégat 030B5726B6F26701 avant/après)

# Tests globaux (data dir temporaire)
$env:VOLACO_DATA_DIR = <temp> ; node --test --test-concurrency=1 dist/**/*.test.js

# Sonde runtime read-only sur le serveur ACTUEL (pré-Lot B)
Invoke-WebRequest http://127.0.0.1:3000/api/v1/auth/logout -Method POST -Body '{}' -ContentType application/json   # => 404 (dormant)
```

**Note :** les commandes de publication/activation **ne doivent pas** être exécutées avant autorisation explicite.

---

**FIN DU RAPPORT — audit read-only ; aucune publication, activation, build de publication, redémarrage ou modification de `dist`/`.env`/`.volaco-data`.**

**En attente de ta décision.**
