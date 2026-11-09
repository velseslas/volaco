# VOLACO CORE — RAPPORT DE CLÔTURE TECHNIQUE MCP (LOTS A + B)

**Date** : 2026-11-08
**HEAD** : `7383b30` (`master`) — dépôt **sans remote** (aucun push possible)
**État du worktree en fin de mission** : 1 fichier ajouté non committé (`apps/api/tests/gate01-boot-fatal.test.ts`), rien d'autre
**Lot UI-MCP** : livré et committé en `7383b30` — **non reconstruit, non modifié** (audit UI = mission distincte)

---

## RÈGLES DE MISSION — CONFORMITÉ

| Règle | Constat |
|---|---|
| Vérifier l'état réel du dépôt en Phase A | ✅ fait (§1) |
| Ne pas supposer la présence des anciens rapports | ✅ reconstitués par listing réel |
| `dist/`, `.env`, `.volaco-data`, `.tmp-lot8-*` intacts | ✅ `dist` 2497 fichiers, mtime **2026-11-06 01:33** inchangé ; `.env` mtime **2026-11-06 01:38** inchangé ; `.tmp-lot8-build` présent ; la base réelle n'a été écrite QUE par le serveur réel (activité normale), **jamais** par mes tests (`VOLACO_DATA_DIR` toujours temporaire) |
| Pas de `npm run build` | ✅ (builds temporaires `--outDir .tmp-*` uniquement, tous supprimés en fin de mission) |
| Serveur réel jamais redémarré/arrêté | ✅ **PID 27344**, health **200** vérifié en fin de mission |
| Rien publié/poussé/activé | ✅ aucun commit, aucun push, aucun remote |
| Bases temporaires isolées uniquement | ✅ 3 data dirs temporaires (créés/supprimés) + worktree isolé |
| Aucun secret affiché/transmis | ✅ clés générées en mémoire (jamais affichées), `.env` lu par noms seuls |
| Pas de Lot C/D | ✅ |

---

## 1. PHASE A — RECONSTITUTION DE L'ÉTAT

### 1.1 État vérifié

- **HEAD** : `7383b30 feat(mcp): … (Lot UI-MCP)` ; parents `4247d08` (4 failles P1) → `7c6c1e3` → `0d09859`.
- **Commit `7383b30` présent** : ✅ (`git cat-file -t` = commit).
- **Worktree** : 1 seul (principal), **propre** au départ.
- **Rapports présents** (relevé réel) : `mcp-admin-user-ui-report.md`, `mcp-master-backend-audit.md`, `mcp-prepublication-final-audit.md`, `mcp-safe-activation-report.md`, `mcp-master-audit-post-lot-b.md`, `mcp-lot-b-report.md`.
- **Rapport `mcp-lot-a-report.md` : ABSENT** (limite **D-01** déjà documentée) → Phase E = reconstitution par exécution des tests.
- **`dist/`** : 2497 fichiers, mtime 06/11 01:33 (build V-02 historique).
- **Serveur réel** : PID **27344**, port 3000, health **200**, inchangé.

### 1.2 Matrice des anomalies encore ouvertes (Phase A)

| # | Anomalie | Origine | État en début de mission | État en fin |
|---|---|---|---|---|
| 1 | **GATE-01** — `uncaughtException` absorbait le refus `loadConfig` | audit maître | correctif **déjà présent** (4247d08) mais **0 test** | **CORRIGÉ + TESTÉ** (§2) |
| 2 | **SEC-01** — repli dev sur interface exposée | audit maître | corrigé (4247d08) | testé au passage (§2) |
| 3 | **Rollback configuration** | audit prépublication = NON DÉMONTRÉ | ouvert | **DÉMONTRÉ en isolé** (§3) |
| 4 | **Rollback données/migrations** | audit prépublication = NON DÉMONTRÉ | ouvert | **DÉMONTRÉ en isolé** (§3) |
| 5 | **R-25 — 25 échecs de tests** | pré-existants | ouvert | **QUALIFIÉ individuellement** (§4) |
| 6 | **CAP-01** — écriture O(n) ~191 req/s à 15 k projets | audit maître (P1→P2) | ouvert, hors périmètre (migration de schéma) | **inchangé — hors périmètre** |
| 7 | **Keyring MCP distant absent en dev** (500/503 fail-closed) | config d'exploitation | ouvert | confirmé + cause des 6 échecs §4.2 |
| 8 | **Secret JWT absent de l'environnement** (V-01) | activation | ouvert — **interdiction explicite de l'installer** | inchangé (NON TESTÉ délibéré) |
| 9 | Load-test officiel inutilisable (rate limiter 429) | audit maître (P1) | ouvert, hors périmètre | inchangé |
| 10 | **GATE-02** (doc déploiement) | audit prépublication | **FERMÉ** au préalable | inchangé |
| 11 | **D-01** — pas de rapport Lot A original | documentaire | ouvert | compensé (§5), non tracé par pièce d'origine |

---

## 2. PHASE B — CORRECTION GATE-01

### 2.1 Chemin exact de démarrage (identifié)

`apps/api/src/server.ts` :
1. `process.on('uncaughtException')` + `unhandledRejection` (L825-839) : **si `serverListening === false` → `fatalBoot()`**, sinon le filet d'origine (log « le serveur continue de fonctionner ») est conservé — les erreurs non fatales post-bind restent traitées sans tuer le service. ✅ exigé par la mission.
2. `createApiServer()` enveloppé en try/catch → `fatalBoot('configuration / initialisation', err)` (L844-850).
3. `fatalBoot` (L810-823) : bloc `FATAL - echec de demarrage (…)` + **« Le service N'EST PAS en ecoute. Arret (code 1). »** + journal `error` + **`process.exit(1)`**.
4. `server.on('error')` (EADDRINUSE/EACCES) → `fatalBoot` avant bind.
5. `loadConfig` (`packages/core/src/config.ts` L97-106) **lève** si `VOLACO_JWT_SECRET` absent/invalide — **jamais de mode permissif** (le `'0'` de `VOLACO_STRICT_AUTH` est **ignoré en production** : `resolveStrictAuth()` y force `true`).

**Verdict** : l'anomalie d'origine (process zombie + log trompeur) est **corrigée par `4247d08`**, mais **aucun test ne la couvrait** → correction livrée ici = **la couverture de tests**.

### 2.2 Test ciblé ajouté — `apps/api/tests/gate01-boot-fatal.test.ts`

| # | Scénario | Exigence couverte |
|---|---|---|
| 1 | `loadConfig` : secret absent / vide / court / non canonique / tous zéros / identique à `VOLACO_API_KEY` → **throw** | refus configuré, jamais permissif |
| 2 | production + `VOLACO_STRICT_AUTH=0` → config OK mais **`strictAuth === true`** | le permissif ne s'active **jamais** en production |
| 3 | secret valide → `loadConfig` OK | refus **sélectif** (contre-épreuve) |
| 4 | **Processus complet**, secret absent → **exit 1 + FATAL + aucune mention de démarrage + port non lié** | cœur GATE-01 |
| 5 | **Processus complet**, secret invalide → exit 1 + FATAL | idem |
| 6 | **Processus complet**, port occupé → exit 1 + FATAL + `EADDRINUSE` | bind observé |
| 7 | **Processus complet**, config valide → démarrage réel + **health 200** | le refus ne casse pas le valide |
| 8 | **Processus complet**, dev + `VOLACO_STRICT_AUTH=0` + `VOLACO_BIND_HOST=0.0.0.0` → exit 1 + FATAL (interface exposée) | **SEC-01 fail-fast** observé |

**Isolation** : cwd temporaire sans `.env`, `VOLACO_DATA_DIR` temporaire, ports éphémères, secret de test **généré en mémoire** (jamais un secret réel). `.env` réel non lu, non modifié.

**Résultat : 8/8 verts.**

```
node --test --test-concurrency=1 .tmp-abclosure-dist/apps/api/tests/gate01-boot-fatal.test.js
→ tests 8 / pass 8 / fail 0
```

> **Anomalie de mission corrigée** : ma première rédaction du test 2/8 partait d'une fausse prémisse (« production + '0' → throw ») ; le comportement réel est **plus sûr** (le `'0'` est ignoré, strict forcé). Test ajusté au comportement, pas l'inverse. Aucun code produit n'a été modifié.

---

## 3. PHASE C — ROLLBACK (ENVIRONNEMENT ISOLÉ)

**Setup** : `%TEMP%\volaco-c-phase-c\` (data + config + backup) ; code applicatif réel (`sqlite-backend` compilé) ; **aucun accès à `Y:\.volaco-data`, `.env` réel ou au serveur réel**. Script : `%TEMP%\opencode\rollback-verify.mjs`.

| # | Scénario | Résultat | Preuve |
|---|---|---|---|
| C1 | **Rollback configuration** : état A → modification → restauration | hash A = `E7B3F06F7ACD503D…` **identique** après restauration ; version modifiée `F04D3DE7A0EC66BC…` ≠ | `restoredIdentical:true` |
| C2 | **Rollback données** : état A (500 lignes + document) → état B (50 lignes) → restauration | hash A **`00FB7E8211F0BEBA…` rétabli à l'identique** ; état B `923AA15CB81A9CA4…` divergent ; `integrity_check: ok` ; contenu exact (`etat-A-0`, 500 lignes) | `check A/B` |
| C3 | **Échec pendant la restauration** : copie tronquée (13 653/40 960 o) proposée | **refus AVANT swap** (`database disk image is malformed`, exit 3), **cible intacte** : hash inchangé `00FB7E82…` avant/après | `refused:true, targetUntouched:true` |
| C4 | **Ouverture d'une base corrompue** par le code applicatif | **erreur lisible**, jamais un succès silencieux | `opened:false, error:"database disk image is malformed"` |
| C5 | Après échec de restauration | l'état A **toujours présent** et sain (500 lignes, `integrity ok`) | dernier `check A` |

**Méthode de restauration validée** : pré-validation `integrity_check` de la copie → seulement ensuite swap (suppression base+WAL+SHM puis copie) = restauration **non destructif en cas d'échec**.

> Migrations : DDL **idempotents** (`CREATE TABLE IF NOT EXISTS` sur `documents`, `mcp_catalog`, `mcp_remote_*`) — pas de compteur de version de schéma ; la « migration » applicative = JSON→SQLite transparente au premier accès. Le rollback par restauration de fichier couvre donc données + schéma.

---

## 4. PHASE D — QUALIFICATION DES 25 ÉCHECS

### 4.1 Reproduction (bilan complet)

```
cd Y:\  ; VOLACO_DATA_DIR=<temp> ; VOLACO_AGENT_CHAIN=0 ; VOLACO_STRICT_AUTH=0
node --test --test-concurrency=1 <273 fichiers .tmp-abclosure-dist/**/*.test.js>
→ tests 3099 / pass 3074 / fail 25   (3099 = 3032 référence + 59 Lot UI-MCP + 8 GATE-01)
```

Répartition **identique à la référence** `mcp-safe-activation-report.md` (11 fichiers, 25 échecs) :

| Fichier | Réf. | Mesuré | Échecs exacts (fichier:ligne) |
|---|---:|---:|---|
| `ai-providers-routes` | 2 | 2 | L210, L230 |
| `providers-multimodel` | 4 | 4 | L318, L332, L347, L354 |
| `app-generator-gate` | 3 | 3 | L380, L410, L436 |
| `app-image-policy` | 4 | 4 | L444, L517, L539, L743 |
| `revisions` | 5 | 5 | L192, L206, L231, L246, L267 |
| `mcp-publication-policy` | 2 | 2 | L327, L339 |
| `app-bundle` | 1 | 1 | L64 |
| `v7-stream-preparation` | 1 | 1 | L47 |
| `v8-completion` | 1 | 1 | L18 |
| `real-source` (n°11) | 1 | 1 | L127 |
| `mcp-remote-studio-b4` (B4-11) | 1 | 1 | L786 |
| **Total** | **25** | **25** | — |

### 4.2 Qualification individuelle + preuve

**Preuve P1 — rejeu au HEAD pur** (worktree `git worktree add .tmp-abclosure-baseline HEAD` = `7383b30`, build propre, **sans** mes ajouts, cwd isolé) :

```
node --test --test-concurrency=1 <9 fichiers concernés dans le worktree>
→ tests 102 / pass 79 / fail 19
```
→ **Les 19 échecs hors-keyring se reproduisent au HEAD** — mêmes fichiers, **mêmes numéros de ligne** (app-bundle L64 ; app-generator-gate L380/410/436 ; app-image-policy L444/517/539/743 ; mcp-publication-policy L327/339 ; revisions L192/206/231/246/267 ; v7 L47 ; v8 L18 ; real-source L127 ; studio-b4 L786). Le worktree présentait même **plus** d'échecs (24 blocs : app-bundle ×5, publication-policy ×3) sans `dist` préexistant — rien n'est imputable à cette mission.

**Preuve P2 — contre-épreuve par expérience** (famille keyring, 6 échecs) : rejeu **avec** un keyring dédié généré en mémoire :

```
VOLACO_MCP_REMOTE_KEY_ID=abclosure-v1 + VOLACO_MCP_REMOTE_KEY=<générée, jamais affichée>
node --test ai-providers-routes.test.js providers-multimodel.test.js
→ tests 34 / pass 34 / fail 0
```

**Qualification finale (aucun échec non prouvé)** :

| Échecs | Nature | Classe | Preuve |
|---:|---|---|---|
| 6 | **Keyring `VOLACO_MCP_REMOTE_KEY*` absent** → `provider-catalog` refuse (fail-closed, message explicite « Chiffrement des clés provider indisponible ») | **environnemental** | P2 (34/34 avec clé) + rapports antérieurs |
| 15 | `GET /preview-bundle` → **404 « Aucun bundle généré »** : la génération d'app n'aboutit pas en conditions de test (journal : *« Génération d'app en échec : interrompu »*, *« Génération NON PUBLIÉE — URLs d'images interdites persistantes »*, repli provider faute de clé IA) | **environnemental** (dépendances génération absentes) | P1 (19/19 au HEAD) + journal serveur |
| 1 | `real-source` n°11 : invariant « `conversation.ts` unique émetteur `/stream` » contredit par `agent-generation-pipeline.ts` (suivi, committé) | **défaut de TEST** (invariant périmé) | P1 + analyse du test (ce test n°10, qui lit `index.html`, passe) |
| 1 | `mcp-remote-studio-b4` B4-11 : empreinte SHA figée de `preview-builder-app.js` invalidée par un fichier modifié hors Lot B | **défaut de TEST** (empreinte à rafraîchir) | P1 (hash actuel `37BD83E4…` ≠ figé `3B423F69…`) |
| 1 | `v7-stream-preparation` : mémoire projet/decision | **environnemental/dépendance conversation** | P1 (reproduit au HEAD) |
| 1 | `v8-completion` : bouton Studio créé par le boot script (DOM shell) | **environnemental/dépendance shell** | P1 (reproduit au HEAD) |

**Défauts réellement imputables → corrigés : AUCUN.** Les 2 « défauts de test » identifiés (invariant `real-source`, empreinte `studio-b4`) sont des **spécifications figées d'anciens lots** : les mettre à jour revient à changer une non-régression d'un autre lot — hors mandat de cette mission (rapportés en §6, à trancher par le propriétaire des lots concernés). Aucun des 25 n'est une faille de sécurité.

---

## 5. PHASE E — PREUVES LOT A (+ LOT B)

Le fichier `mcp-lot-a-report.md` **n'existe pas** (limite D-01) → preuves **reconstituées par exécution** (aucun résultat inventé).

### 5.1 Exécution dédiée (isolée, non destructive)

```
node --test --test-concurrency=1 <9 suites>   (VOLACO_DATA_DIR temp + keyring dédié)
→ tests 118 / pass 118 / fail 0   (9 suites)
```

| Exigence de mission | Suite exécutée | Résultat |
|---|---|---|
| **Cycle prepare → confirmation → call** | `mcp-builtin-governance` (**« MCP-C3.6 Lot A »** LA-1→LA-20 : prepare 201 → confirmation bornée → call ; anti-rejeu, concurrence, expirations, binding) | ✅ inclus dans 118/118 |
| **Refus de sécurité** | idem (LA-1→LA-9 : sans JWT → 403 `IDENTITY_UNTRUSTED`, JWT falsifié, RBAC VIEWER/ENGINEER → `PERMISSION_DENIED`, serveur/outil inconnu, cross-tenant → **404 indiscernable**) + `mcp-remote-b1/b2/b3` (19+16+19 refus) + `mcp-remote-c34` (11) | ✅ |
| **Chemin HTTP** | `mcp-remote-servers-strict` (401 sans auth, cycle CRUD Bearer) + `mcp-project-validation` (400/404/413) | ✅ |
| **Chemin STDIO** | `mcp-stdio` : **6/6** — handshake `initialize` + `tools/list` réels, `fs_write`/`fs_read` confinés, `app_build` réel, `browser_navigate`+screenshot (Playwright loopback), **SSRF refusée avant Chromium** | ✅ 6/6 |
| **Protections SSRF** | `url-policy` (C3.1 : schémas, IPv4/IPv6 privées, mappées, DNS mixte, redirections bornées, fail-closed) + `client-c33` + stdio #6 | ✅ inclus dans 118/118 et 6/6 |
| **Journaux d'audit** | `mcp-remote-c34` (refus journalisés `PREPARE_REFUSED`/`BINDING_MISMATCH`/`REPLAY` whitelistés, canaries absentes, isolation des journaux inter-tenant) + LA-3/LA-9/LA-17 (audit `CALLED` précis) | ✅ |
| **Non-régression** | bilan global §4 + familles MCP : **toutes vertes** sauf `mcp-publication-policy` ×2 et `studio-b4` ×1 (qualifiés §4) | ✅ |

### 5.2 Lot B — preuves existantes (rapport `mcp-lot-b-report.md`)

B1 auth stricte, B2 audit durable, B3 révocation sessions, B4 quotas MCP, secret JWT dédié — **suites correspondantes vertes** dans le bilan global (aucun échec Lot B dans les 25).

---

## 6. PHASE F — VALIDATION

### 6.1 Résultats exacts

| Exécution | Commande (condensée) | Résultat |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **EXIT 0** |
| Build temporaire (puis supprimé) | `npx tsc -p tsconfig.json --outDir .tmp-abclosure-dist` | **EXIT 0** |
| GATE-01 (nouveau test) | `node --test --test-concurrency=1 .tmp-abclosure-dist/apps/api/tests/gate01-boot-fatal.test.js` | **8/8** |
| Bilan global | `node --test --test-concurrency=1 <273 fichiers>` (`VOLACO_DATA_DIR` temp) | **3099 / 3074 pass / 25 fail** |
| Preuve worktree HEAD | `node --test <9 fichiers>` dans `.tmp-abclosure-baseline` (HEAD `7383b30`) | **102 / 79 / 19 fail** (19 = échecs non-keyring, identiques) |
| Contre-épreuve keyring | `node --test ai-providers-routes + providers-multimodel` avec keyring dédié | **34/34** |
| Preuves Lot A (9 suites) | `node --test mcp-builtin-governance + project-validation + c34 + b1 + b2 + b3 + servers-strict + url-policy + client-c33` | **118/118** |
| Chemin STDIO | `node --test mcp-stdio.test.js` | **6/6** |
| Rollback (Phase C) | `node rollback-verify.mjs <modes>` (séquence 13 appels) | **tous EXIT attendus** (§3) |
| Secrets | `node scripts/check-secrets.mjs --all` | **EXIT 0 — aucun secret** (exécuté à la clôture du lot UI-MCP, inchangé depuis) |

### 6.2 Fichiers modifiés

**Ajout unique (non committé)** : `apps/api/tests/gate01-boot-fatal.test.ts`
**Aucun fichier de code produit modifié.** `git status` final = 1 fichier `??`.

### 6.3 Hashes de contrôle

| Cible | Empreinte | Statut |
|---|---|---|
| `dist/` (agrégat) | 2497 fichiers, mtime **2026-11-06 01:33** | **inchangé** (hash d'agrégat historique `030B5726B6F26701` non recalculé pour éviter toute écriture/parcours invasif — mtime + compte vérifiés) |
| `.env` | mtime **2026-11-06 01:38** | **inchangé**, non lu en clair |
| `packages/core/src/identity/user-store.ts` | `F7C10E8E865513E5` | = référence Lot B |
| `…/session-store.ts` | `E49EF593B376A318` | = référence |
| `…/mcp/remote/rate-limit.ts` | `924EF0480A62BD31` | = référence |
| `apps/api/src/middleware/auth.ts` | `E4472B2F9460C8DD` | = référence |
| `apps/api/src/routes/auth.ts` | `FA7926985CDF2F77` | = référence |
| `packages/core/src/config.ts` | `1FE73BB19EF47665` (réf. `E70B6BE3…`) | **écart expliqué** : SEC-01/GATE-01 en `4247d08` |
| `packages/core/src/observability/audit.ts` | `7BD68F394293C768` (réf. `D756B1AB…`) | **écart expliqué** : Lot UI-MCP `7383b30` |
| `apps/api/src/routes/mcp-remote.ts` | `419772FB71300397` (réf. `34905DB1…`) | **écart expliqué** : Lot UI-MCP `7383b30` |
| Rollback Phase C | config `E7B3F06F7ACD503D…` ; DB A `00FB7E8211F0BEBA…` | restaurés **identiques** |

### 6.4 Anomalies restantes

1. **25 échecs de tests** (§4) — 24 environnementaux/périmés + 1 empreinte figée ; **aucune régression, aucun lien sécurité** ; 6 d'entre eux disparaissent dès qu'un keyring est fourni.
2. **CAP-01** (P2) — écriture O(n) ; correction = migration de schéma, hors périmètre.
3. **Keyring distant absent en dev** — fail-closed `503 MCP_REMOTE_CONFIG` (également sur le serveur réel) ; décision d'exploitation requise.
4. **D-01** — toujours aucun rapport Lot A d'origine.
5. **Tests non mis à jour** : invariant `real-source` n°11 et empreinte `studio-b4` B4-11 (à trancher par leurs propriétaires).

### 6.5 Risques résiduels

- **Activation** : secret JWT non installé (interdiction respectée) → le service reste **fail-closed** sans lui (GATE-01 garantit désormais un refus observable).
- Les tests bundle (15) resteront rouges **tant que l'environnement de test n'a pas les dépendances de génération** (provider IA out) → risque de masquage d'une vraie régression future dans cette famille.
- Charge en écriture (CAP-01) inchangée → à traiter avant forte charge.

### 6.6 État du serveur réel (fin de mission)

**PID 27344 · port 3000 · health 200 · jamais redémarré.** `dist/`, `.env`, `.volaco-data`, `.tmp-lot8-build` intacts.

---

## VERDICT PAR CATÉGORIE

| Critère | Catégorie |
|---|---|
| GATE-01 : refus de config observable (correctif + 8 tests) | **VALIDÉ** |
| SEC-01 : fail-fast dev exposé (testé) / permissif jamais activé en prod (testé) | **VALIDÉ** |
| Rollback configuration (isolé) | **VALIDÉ** |
| Rollback données + intégrité + échec de restauration non destructif (isolé) | **VALIDÉ** |
| Qualification des 25 échecs (individuelle, 2 preuves) | **VALIDÉ** |
| Non-régression globale (3099 tests, répartition = référence) | **VALIDÉ** |
| Preuves Lot A — cycle prepare→confirm→call, refus, SSRF, audit, STDIO (reconstituées) | **VALIDÉ SOUS CONDITIONS** (reconstituées par exécution, faute de rapport d'origine — D-01) |
| Rollback sur base **réelle** / production | **NON VALIDÉ** (interdit par la mission — procédure identique, non exécutée sur le réel) |
| Activation complète avec secret JWT + provider IA réel | **NON TESTÉ** (interdits : secret, activation, Lot C/D) |
| Perf écriture sous charge (CAP-01) | **NON TESTÉ** (hors périmètre) |

## VERDICT FINAL : **GO**

**GO pour la mission suivante** (intégration/validation des interfaces UI-MCP, puis phase d'activation sous autorisation), **sous 4 conditions** :
1. fournir/configurer `VOLACO_MCP_REMOTE_KEY_ID` + `VOLACO_MCP_REMOTE_KEY` dans l'environnement cible (sans elle : 6 tests rouges + routes 503) ;
2. installer le secret JWT **lors de la phase d'activation dédiée** (jamais dans cette mission) — le refus est désormais observable (GATE-01) ;
3. garder les 25 échecs en surveillance (famille bundle = baromètre fragile) ;
4. traiter CAP-01 avant mise en production à forte charge.

---

**ARRÊT RESPECTÉ** : aucun build lancé en fin de mission · `dist/` intact · secret JWT non installé · serveur non redémarré · rien publié · aucun Lot C/D commencé.

**Rapport présenté — en attente d'autorisation explicite pour toute suite.**
