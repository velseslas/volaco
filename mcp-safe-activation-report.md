# RAPPORT — MISE EN SERVICE SÛRE (activation contrôlée Lots A + B)

> **Type :** corrections ciblées + validation + préparation de publication. **Aucun build de publication, aucun remplacement de `dist`, aucun redémarrage, aucune activation runtime.**
> **Date :** 2026-11-05
> **Dépôt :** `C:/Users/FAYCAL/Desktop/volcanoo/volaco-core` (accès `Y:\`), branche `master`, HEAD `ea987c582b6a609ab419786d81633bfabbc5f18b`.
> **Périmètre :** V-02 (P1), V-03 (P1), analyse V-07 (P2), préparation publication. **V-01 (P0 activation runtime) reste hors de ce mandat** (Phase d'activation = autorisation distincte).

---

## 1. ÉTAT INITIAL

| Élément | Valeur | Preuve |
|---|---|---|
| Dépôt / realpath | `…\Desktop\volcanoo\volaco-core` | `(Get-Item Y:\).Target` |
| Commit | `ea987c5` (2026-10-26) | `git rev-parse HEAD` |
| Worktree | 132 modifiés, 51 non suivis (dont Lot A/B + travail pré-existant) | `git status` |
| Serveur actif | **:3000** pid **7908**, `node --env-file=.env dist/apps/api/src/server.js`, démarré **2026-11-04 21:40:14** | `Win32_Process`, `Get-Process` |
| Autre listener | :8080 pid 23696 (`tsx src/server.ts`, **autre workspace zCode**, hors dépôt) | `Win32_Process` |
| Config active | `.env` — variables : `PORT, NODE_ENV(=development), AUTH_SECRET, MISTRAL_API_KEY, MISTRAL_MODEL` — **ni `VOLACO_JWT_SECRET`, ni `VOLACO_API_KEY`, ni `VOLACO_STRICT_AUTH`** | lecture noms de variables |
| Données | `.volaco-data/` : `volaco.db` (41 Mo, 05/11 01:06), WAL 61 Mo | listing |
| Rapports | `mcp-lot-b-report.md` **PRÉSENT** ; `mcp-master-audit-post-lot-b.md` **PRÉSENT** ; **`mcp-lot-a-report.md` ABSENT** | listing |

**Évolution signalée :** `mcp-lot-a-report.md` n'existe pas (déjà constaté à l'audit). La continuité documentaire Lot A repose uniquement sur des commentaires de code.

---

## 2. INVENTAIRE DU DÉPÔT (avant/après)

**Empreintes des fichiers protégés — AVANT l'intervention :**

| Fichier | SHA-256 (16) |
|---|---|
| `dist/apps/api/src/server.js` | `711E60EB3A0F8397` |
| `dist/packages/core/src/config.js` | `8565993F69EF8482` |
| `apps/studio/index.html` | `6802BCF4E2E971FB` |
| `apps/studio/preview-builder-app.js` | `37BD83E444F8FAD1` |
| `.env` | `FF8DED541E2E47A9` |
| `.env.example` | `0BC234D2F19BBD66` |

**Empreintes — APRÈS l'intervention :** `dist/…server.js`, `dist/…config.js`, `apps/studio/index.html`, `apps/studio/preview-builder-app.js` et `.env` sont **inchangés** (mêmes empreintes). Seuls les fichiers de la mission changent :
`.env.example` → `7ED49AEBB2BB19BF`, `README.md` → `7B5A622C70C1FD2F`, `docs/adr/ADR-002-jwt-per-user-tenants.md` → `13A713276E5CB5B0`, + 3 suites Preview Builder.

**Données :** `.volaco-data/volaco.db` **non modifié** (mtime 05/11 01:06, antérieur à la mission). Tous les tests de cette mission ont utilisé un `VOLACO_DATA_DIR` **temporaire**.

---

## 3. CORRECTION V-02 — PREVIEW BUILDER

### Diagnostic
Les 3 suites `packages/core/tests/preview-builder/{preview-final,preview-integration,real-source}.test.ts` appellent `createApiServer(...)` → `loadConfig()` → **exige** `VOLACO_JWT_SECRET` depuis B3-1. Elles ne **testent pas** le JWT (pages/SSE/rendu du Preview Builder) et s'authentifient via en-têtes `x-tenant-id`/`x-user-role` (nécessitent donc le strict désactivé en test). Aucune ne fournissait de secret → refus de démarrage.

### Stratégie retenue (centralisée, cohérente avec l'app)
Import side-effect du helper **existant** `packages/core/tests/_lot-b-secret-env.ts` en **premier** import (comme `core.test.ts`). Ce helper :
- fournit `VOLACO_JWT_SECRET` = `randomBytes(32).toString('base64')` **généré en test uniquement** ;
- désactive le strict (`VOLACO_STRICT_AUTH='0'`) **en dev/test uniquement** ;
- **n'est importé par aucun code de production** → aucun fallback de production ajouté.

### Modification (diff minimal)
`preview-final.test.ts`, `preview-integration.test.ts`, `real-source.test.ts` : ajout d'une ligne `import '../_lot-b-secret-env.js';` en tête. **Aucune** fonctionnalité Preview Builder modifiée. **Aucune** validation de `VOLACO_JWT_SECRET` affaiblie.

### Preuve que la validation de production tient toujours
Probe isolé sans `VOLACO_JWT_SECRET` : `loadConfig()` → `Secret JWT VOLACO_JWT_SECRET absent ou invalide … ` (**refus conservé**).

### Résultats
| Suite | Avant | Après |
|---|---|---|
| `preview-final` | 1 échec (boot) | **0 échec** |
| `preview-integration` | 1 échec (boot) | **0 échec** |
| `real-source` | 6 échecs/annulés (boot) | **1 échec** = test n°11 (**pré-existant**, cf. §6) |
| **Ensemble des 3** | 3 suites en échec au boot | **37/38** (le seul échec = invariant n°11 pré-existant) |

> Le test n°11 de `real-source` (`un seul émetteur de stream`) échoue car `apps/api/src/routes/agent-generation-pipeline.ts` (fichier **pré-existant**, hors Lot A/B) contient `/stream`. **Sans lien avec V-02** : ce test échouait déjà pour cette raison.

---

## 4. CORRECTION V-03 — DOCUMENTATION ET CONFIGURATION

### Fichiers modifiés
1. **`.env.example`** (réécrit) :
   - **[SEC-001] `VOLACO_JWT_SECRET`** : rôle, format (base64 canonique ≥ 32 octets), génération (`openssl rand -base64 32` / `node -e …randomBytes(32)…`), stockage (jamais Git/logs), **indépendance de `VOLACO_API_KEY`**, conséquence d'absence/invalidité (**refus de démarrage**), **rotation** (invalidation des JWT + fenêtre planifiée, renvoi `mcp-lot-b-report.md §9`). Placeholder uniquement — **aucune valeur réelle**.
   - **[SEC-002] `VOLACO_API_KEY`** clarifiée (identité partagée, ≠ JWT).
   - `NODE_ENV` : règles exactes (production ⇒ strict **imposé** ; dev/test ⇒ strict **par défaut**, `VOLACO_STRICT_AUTH='0'` seul répit, dev/test uniquement).
   - `VOLACO_STRICT_AUTH` : portée et non-désactivation en production.
   - Quotas MCP `VOLACO_MCP_QUOTA_*` documentés (optionnels).
   - **[SEC-004] `AUTH_SECRET`** rétrogradé en variable **historique** (ne signe plus les JWT ; sert à dériver la clé d'API de prod ; réutilisation interdite).
2. **`README.md`** : tableau de configuration corrigé — `VOLACO_JWT_SECRET` ajouté (obligatoire), `AUTH_SECRET` marqué « historique / ne signe plus les JWT », `VOLACO_STRICT_AUTH` ajouté.
3. **`docs/adr/ADR-002-jwt-per-user-tenants.md`** : encadré de mise à jour (Lot B) — secret dédié, refus de démarrage, `sv`/`jti`, logout.

### Vérifications
- `.env.example` ne contient **que des placeholders** (scan secrets : « Aucun secret détecté »).
- Cohérence avec le code : `config.ts` exige base64 canonique ≥ 32 octets ≠ clé API — exactement ce qui est documenté.
- **Absence de « build » dans cette correction** : aucune génération d'artefact.

---

## 5. TESTS CIBLÉS

Environnement : build **isolé** (`.tmp-safeact-build/`, tsconfig temporaire étendant `tsconfig.json`, `outDir` hors `dist`) — **jamais `dist`**. `VOLACO_DATA_DIR` temporaire.

| Groupe | Suites | Tests | Pass | Fail |
|---|---|---:|---:|---:|
| Preview Builder (3) + auth/strict + Lot B + audit | 10 fichiers | 76 | 75 | **1** (real-source n°11, pré-existant) |
| MCP Lot A/B + sécurité + tenancy + auth | 13 fichiers | 141 | **141** | 0 |
| Studio C35 + B4-11 | 2 fichiers | 27 | 26 | **1** (B4-11, pré-existant) |

Détail : `auth-strict` 5/5, `auth-strict-mode` 4/4, `auth-enforcement`, `lot-b-auth-revocation` 2/2, `lot-b-audit-quota` 6/6, `lot-b-session-unit` 3/3, `audit-api`, `mcp-remote-b1/b2/b3/c34/servers/servers-strict/real-handshake`, `mcp-builtin-governance`, `mcp-project-validation`, `security-hardening`, `tenancy`, `auth-api`, `auth-me` → **tous verts**.

---

## 6. NON-RÉGRESSION

**Périmètre exact mesuré :** `dist/**/*.test.js` = **266 fichiers** (133 API + 133 core, sous-répertoires inclus), exécutés via `node --test --test-concurrency=1`, `VOLACO_DATA_DIR` temporaire.

| Exécution | Tests | Pass | Fail | Annulés | Skipped | Todo |
|---|---:|---:|---:|---:|---:|---:|
| Avant V-02 (audit, `dist`) | 3032 | 3000 | 28 | 4 | 0 | 0 |
| **Après V-02 (build isolé)** | **3032** | **3007** | **25** | **0** | 0 | 0 |

**Régressions Preview Builder corrigées :** `preview-final` (0 fail), `preview-integration` (0 fail) : **entièrement vertes**. `real-source` : passe de 6 échecs/annulés à **1 seul échec pré-existant** (test n°11).

**Échecs restants (25) — tous pré-existants ou environnementaux, suivis séparément :**

| Fichier | Nb | Cause | Lien Lot A/B |
|---|---:|---|---|
| `ai-providers-routes` | 2 | keyring `VOLACO_MCP_REMOTE_KEY` (travail S4 pré-existant) | non |
| `providers-multimodel` (core) | 4 | idem | non |
| `app-generator-gate` | 3 | build/bundle | non (échoue sur HEAD) |
| `app-image-policy` | 4 | politique image/bundle | non (échoue sur HEAD) |
| `revisions` | 5 | rollback/bundle | non (échoue sur HEAD) |
| `mcp-publication-policy` | 2 | build bundle MCP | non (échoue sur HEAD) |
| `app-bundle` | 1 | isolation bundle 404 | non (échoue sur HEAD) |
| `v7-stream-preparation` | 1 | mémoire projet (conversation) | non |
| `v8-completion` | 1 | bouton Studio (HTML) | non |
| `mcp-remote-studio-b4` (B4-11) | 1 | empreinte `preview-builder-app.js` invalidée (fichier modifié par travail pré-existant) | non |
| `real-source` (n°11) | 1 | `/stream` dans `agent-generation-pipeline.ts` (pré-existant) | non |

> **Aucun de ces échecs n'est introduit par V-02/V-03.** Ils relèvent de travail pré-existant non commité, de dépendances d'environnement (keyring, Chromium, EPERM Windows) ou d'invariants de test devenus obsolètes.

---

## 7. ANALYSE V-07 — PERFORMANCE DU JOURNAL D'AUDIT

### Cause (décomposée par micro-benchmark isolé)

| Taille du journal | `JSON.stringify` seul | stringify + écriture SQLite | Δ écriture | Taille sérialisée |
|---:|---:|---:|---:|---:|
| 0 | 0,00 ms | 0,13 ms | 0,13 ms | 2 o |
| 500 | **0,80 ms** | 0,83 ms | 0,02 ms | 98 Ko |
| 1 000 | **1,51 ms** | 2,10 ms | 0,59 ms | 197 Ko |
| 2 500 | **5,82 ms** | 4,47 ms | (bruit) | 494 Ko |
| 4 900 | **7,98 ms** | 8,64 ms | 0,66 ms | 969 Ko |

**Conclusion :** le coût est **dominé par la sérialisation O(n) de l'ensemble du journal** à chaque écriture (`JSON.stringify(this.events.slice(-5000))`), pas par l'écriture SQLite. Comme `record()` déclenche un **flush synchrone** sur chaque action CRITICAL **et chaque FAILURE** (donc chaque refus de quota), chaque acte sensible coûte ~**8 ms bloquants** (event loop) quand le journal approche son cap → **amplification / vecteur d'auto-DoS**.

### Options évaluées (sans implémentation)

| Option | Durabilité | Coût | Verdict |
|---|---|---|---|
| **1. Append-only ligne SQLite** (1 `INSERT` par événement) | Forte (chaque évt durable) | O(1)/évt | **Recommandée** |
| 2. Segmentation par taille (fichiers de N évt) | Forte | O(N_plus_petit) | Bonne, mais gère rotation |
| 3. Indexation (index par tenant/action) | — | +coût écriture | Utile à la lecture, pas au flush |
| 4. Archivage (évacuer les anciens) | Forte | O(n) déplacé | Complémentaire |
| 5. Réduction des copies (éviter `slice`+`stringify` complet) | — | Réduit constante | Ne résout pas O(n) |
| 6. Écriture transactionnelle adaptée (batch async borné) | Moyenne (fenêtre de perte) | Lisse la latence | Acceptable pour FAILURE non sensibles |

**Garanties à préserver :** le flush synchrone des actions CRITICAL ne doit **pas** être supprimé ; l'append-only le rend **moins coûteux tout en gardant la durabilité par événement** (meilleur des deux).

### Protocole de benchmark isolé proposé
1. `VOLACO_DATA_DIR` temporaire dédié ; 2. pré-remplir à 0/1000/2500/4900 événements ; 3. mesurer `record()` d'une action CRITICAL (p50/p95 sur ≥ 500 itérations) ; 4. mesurer séparément `JSON.stringify` et l'écriture ; 5. comparer avant/après implémentation (mêmes tailles) ; 6. **jamais** sur le serveur actif ni sur `.volaco-data` réel.

---

## 8. ÉTAT DE `dist`

- `dist` à jour vs source : **oui** (build 05/11 01:30 ≥ source la plus récente).
- **Nouvelle vérification décisive :** comparaison `dist/*.js` (non-test, **559 fichiers**) contre un **build source-dérivé isolé** → **559/559 identiques** après retrait de la ligne `//# sourceMappingURL` (les `.map` expliquent l'écart brut apparent). **Aucun orphelin** (tous les `.js` de `dist` ont un `.ts` source).
- **Le dossier `patch/dist/` est STALE** : ses fichiers portent d'anciens noms (`mutate.js`, `validate.js`, `preview.js`, `memory.js`, `security-middleware.js`, `server.js` 528 lignes) **absents du `dist` actuel** (renommés en `mutation-engine`, etc. ; `server.js` courant = 733 lignes, source-dérivé). Ce n'est **pas** un overlay runtime actif.

> **ÉVOLUTION MAJEURE à signaler :** au moment de cet audit, `dist` est **entièrement reproductible depuis les sources** — l'hypothèse « `dist` contient des correctifs manuels absents des sources » (RELEASE-POLICY) **n'est plus vérifiée**. Un rebuild propre serait *a priori* non destructeur pour le code. **Cela reste néanmoins non exécuté** (interdit en cette phase).

---

## 9. ÉCARTS SOURCE / DIST

| Sens | Constat |
|---|---|
| Sources sans artefact `dist` | **Aucun** (tous compilés) |
| `dist` sans source | **Aucun** orphelin (hors `apps/api/tests/bench-ttf.js`, helper JS committé, copié dans dist) |
| Contenu divergent (hors sourceMappingURL) | **0 / 559** |
| `patch/dist/` (historique) | **Stale** — non appliqué au runtime |

---

## 10. STRATÉGIE DE PUBLICATION (préparée, non exécutée)

1. **Préconditions** : V-02 ✅, V-03 ✅, tests ciblés ✅, écarts source/dist **nuls** ✅, `VOLACO_JWT_SECRET` présent dans l'environnement cible (**à faire**), migration sessions analysée (§12).
2. **Sauvegarde vérifiable (avant tout)** :
   - artefact : copie intégrale de `dist/` (avec hash manifest `Get-FileHash` de chaque `.js`) ;
   - configuration : copie de `.env` (hors Git) + hash ;
   - données : **snapshot** de `.volaco-data/volaco.db` + `-wal`/`-shm` **serveur arrêté** (SQLite WAL cohérent).
3. **Secrets** : générer `VOLACO_JWT_SECRET` (≥ 32 octets base64 canonique), vérifier ≠ `VOLACO_API_KEY`/`AUTH_SECRET` ; ne jamais l'afficher.
4. **Génération d'artefacts** : **NE PAS** utiliser `npm run build` (qui suit `clean-dist.mjs` et supprime tout `dist/`). Utiliser, selon l'état :
   - **Option A (recommandée si source==dist, cas actuel)** : `tsc` en place (sans `clean-dist`) régénère uniquement ce qui change → sûr puisque `dist` est source-représentable ; **ou**
   - **Option B (conservatrice, conforme RELEASE-POLICY)** : `node scripts/prepare-release.mjs` (préserve `dist/` **octet pour octet**), puis ne remplacer que les fichiers modifiés.
5. **Vérification des hashes** : comparer le manifeste `dist` post-génération au manifeste sauvegardé ; toute différence inattendue ⇒ **arrêt**.
6. **Migrations** : aucune migration de base prévue (le store `jwt-sessions` se crée à l'usage). Vérifier l'absence de schéma à migrer.
7. **Remplacement + redémarrage** : sur **autorisation distincte** uniquement (§ Phase d'activation).
8. **Sondes post-démarrage** : cf. §15 (à préparer).
9. **Rollback** : §11.

**Lacune signalée :** pas de Dockerfile / script de publication atomique versionné ; la procédure repose sur `prepare-release.mjs` + copie manuelle. Pas de manifeste `dist` versionné (à générer à la publication).

---

## 11. STRATÉGIE DE ROLLBACK

1. **Artifacts** : restaurer `dist/` depuis la sauvegarde (copie intégrale + manifeste) — restaure l'ancien runtime sans toucher aux données.
2. **Configuration** : restaurer `.env` sauvegardé (retrait du nouveau `VOLACO_JWT_SECRET`).
3. **Données** : **ne pas** restaurer la base sauf incident de données explicite (le remplacement d'artifact est réversible sans toucher `.volaco-data`). Si nécessaire : arrêt serveur → restaurer `volaco.db*` depuis le snapshot → redémarrage.
4. **Vérification post-rollback** : mêmes sondes (§15) doivent repasser à l'état antérieur.
5. **Démonstration sur environnement isolé** : à réaliser (copie hors dépôt) avant publication — **non exécutée ici** (pas de publication).

---

## 12. GESTION DES SECRETS

- `VOLACO_JWT_SECRET` : **absent** du `.env` actuel → **condition bloquante de publication** (le service refuserait de démarrer). À ajouter dans l'environnement cible.
- Distinction imposée : `VOLACO_JWT_SECRET` ≠ `VOLACO_API_KEY` ≠ `AUTH_SECRET` (rejet au démarrage sinon).
- `.env` est **gitignoré** (vérifié) ; `.env.example` ne contient que des placeholders ; scan secrets « Aucun secret détecté ».
- Le secret n'apparaît dans aucun log/rapport ; jamais renvoyé par une route.

---

## 13. MIGRATION DES SESSIONS

- **Effet du nouveau secret** : les JWT signés avec l'ancien mécanisme (`AUTH_SECRET`) deviennent **invalides** → les utilisateurs existants **se reconnectent** (signup/login émettent des jetons au nouveau format avec `sv`/`jti`).
- **Anciens jetons** : tout jeton sans `sv` est **refusé** (`session-store.isTokenStillValid`). Pas de fallback réintroduit.
- **Sessions persistantes** : document `jwt-sessions` (versions + jti révoqués) — **aucune migration** de schéma ; se remplit à l'usage.
- **Concurrence logout/requêtes** : vérifiée par tests (`lot-b-auth-revocation`).
- **Incohérence assumée** : la fenêtre de reconnexion est **globale** (tous les utilisateurs actifs). À planifier hors heures de pointe.

---

## 14. RISQUES DE PUBLICATION

| # | Risque | Sév. | Mitigation |
|---|---|---|---|
| R-01 | `.env` cible sans `VOLACO_JWT_SECRET` → **refus de démarrage** | **Élevé** | Précondition §10.1 ; vérifier avant bascule |
| R-02 | Confusion `patch/dist/` (stale) prise pour un overlay actif | Moyen | Ne PAS appliquer `patch/` ; `dist` est source-représentable (§8) |
| R-03 | Utiliser `npm run build` (supprime `dist`) | Élevé | Interdit ; utiliser Option A/B (§10.4) |
| R-04 | `NODE_ENV=development` dans `.env` → pas de verrou production | Moyen | Passer à `production` pour un hôte exposé |
| R-05 | Invalidation globale des sessions (reconnexion forcée) | Faible | Fenêtre planifiée |
| R-06 | Base ouverte en WAL pendant la sauvegarde | Moyen | Snapshot serveur **arrêté** |
| R-07 | B4-11 / real-source n°11 : tests figés désynchronisés | Faible | Suivre séparément (pré-existant), ne pas masquer |

---

## 15. SONDES POST-DÉMARRAGE (à préparer pour la phase d'activation)

| # | Sonde | Attendu |
|---|---|---|
| 1 | `POST /api/v1/auth/logout` | **route reconnue** (≠ 404) ; sans JWT → 401 |
| 2 | Route privée sans auth | 401 |
| 3 | Route privée avec `x-tenant-id`/`x-user-role` seuls | **401** (strict) |
| 4 | JWT invalide / forgé | 401 |
| 5 | JWT valide → logout → réutilisation | before 200 → after **401** |
| 6 | MCP prepare sans permission | 403 |
| 7 | MCP call sans confirmation | 400/409 |
| 8 | Dépassement de quota MCP | 429 audité (`MCP_REMOTE_RATE_LIMITED`) |
| 9 | Événement critique | `pending=0` (flush durable) |
| 10 | Preview Builder | page servie (200) |

---

## 16. RÉSULTATS D'INTÉGRITÉ

- `dist/` **non modifié** (server.js `711E60EB…`, config.js `8565993F…`).
- `.env` **non modifié** (`FF8DED54…`).
- `.volaco-data` **non modifié** (mtime antérieurs).
- `apps/studio/index.html` / `preview-builder-app.js` **non modifiés**.
- Aucun fichier `dist/.volaco-data/.tmp-lot8-*` touché.
- Artefacts temporaires créés puis **supprimés** (`.tmp-safeact-*`).
- Aucun secret exposé ; `check-secrets --all` : **aucun secret**.
- Fichiers modifiés par la mission : 6 (3 tests V-02, `.env.example`, `README.md`, `ADR-002`).

---

## 17. VERDICT DE PRÉPARATION

- **V-02 : CORRIGÉ.** Les 3 suites Preview Builder démarrent via un helper de test centralisé ; `preview-final` et `preview-integration` **entièrement vertes** ; `real-source` ne conserve qu'un échec **pré-existant** (invariant n°11). Aucune validation affaiblie.
- **V-03 : CORRIGÉ.** `VOLACO_JWT_SECRET`, `VOLACO_STRICT_AUTH`, `NODE_ENV` et le statut historique de `AUTH_SECRET` documentés dans `.env.example`, `README.md` et `ADR-002`.
- **Publication : PRÉPARÉE — NON PRÊTE À EXÉCUTER.** Préparée techniquement (stratégie, rollback, sondes, analyse source/dist = aucun écart), mais **une condition bloquante demeure** : **`VOLACO_JWT_SECRET` doit être présent dans l'environnement cible** (§12, R-01). Le rollback doit encore être **démontré sur un environnement isolé** (§11.5). Aucune publication n'est effectuée.

**V-01 (P0 : activation runtime) reste OUVERTE** et relève de la phase d'activation soumise à autorisation distincte.

---

## 18. STOP

Aucun build de publication, aucun remplacement de `dist`, aucune migration réelle, aucun redémarrage, aucune activation runtime, aucun Lot C/D.
**En attente de l'autorisation explicite de publication.**
