# Rapport Lot UI-MCP — Espaces Admin & User du catalogue MCP

**Date** : 2026-11-08
**État** : livré, **non commité** (attente d'autorisation de clôture)
**HEAD** : `4247d08` (master) — dépôt **sans remote** (push impossible tant qu'aucune URL n'est fournie)

---

## 1. Périmètre livré

Deux espaces MCP complémentaires au hub existant, **sans second hub concurrent** :

| Espace | Route (hash) | Module | Lignes | Vue `index.html` |
|---|---|---|---|---|
| **User** — découverte, activation, imports personnels | `#mcphub` | `apps/studio/mcp-user-hub.js` (IIFE ES5) | 791 | L3348 `view-mcphub` |
| **Admin** — gestion du catalogue global | `#mcpadmin` | `apps/studio/mcp-admin.js` (IIFE ES5) | 1009 | L3366 `view-mcpadmin` |

Éditions `apps/studio/index.html` : 6 (2 vues, 2 boutons de menu L1168/L1181, `HASH_VIEWS` L8508, `switchSystemView`, 2 tags `<script>` L19764-19766).

**Ce qui n'a PAS été recréé** (existant conservé tel quel) : le hub `#mcp` et ses routes `mcp-remote` / `mcp-remote/journal` / `mcp-remote/connectors` (espace « MCP distant »), l'exécution MCP (`prepare` → confirmation → `call`), le moteur SSRF, les quotas.

---

## 2. Phase A — Matrice d'audit (pages / routes / API / permissions)

### 2.1 Backend — routeur unique `apps/api/src/routes/mcp-catalog.ts`

| Route | Méthode | Permission serveur | Réponse |
|---|---|---|---|
| `/api/v1/mcp/catalog` | GET | publique (PUBLIE + `public` uniquement) | `{entries,categories}` — 404 indiscernable sinon |
| `/api/v1/mcp/catalog/:id/activate` | POST | `MCP_REMOTE_INVOKE` + JWT | `{activated,connector}` |
| `/api/v1/mcp/catalog/:id/deactivate` | POST | `MCP_REMOTE_INVOKE` + JWT | — |
| `/api/v1/mcp/admin/catalog` | GET | `MCP_CATALOG_MANAGE` | `{entries,byStatus}` |
| `/api/v1/mcp/admin/catalog` | POST | `MCP_CATALOG_MANAGE` | création **forcée BROUILLON** |
| `/api/v1/mcp/admin/catalog/:id` | PATCH (statut) | `MCP_CATALOG_MANAGE` | matrice servie ; 409 `MCP_CATALOG_INVALID_TRANSITION` |
| `/api/v1/mcp/admin/catalog/:id` | DELETE | `MCP_CATALOG_MANAGE` | 409 `MCP_CATALOG_DEPENDENCY` tant qu'instance existe |
| `/api/v1/mcp/admin/stats` | GET | `MCP_CATALOG_MANAGE` | `{catalog,connections,personalImports,recentOperations}` |
| `/api/v1/mcp/admin/catalog/:id/history` | GET | `MCP_CATALOG_MANAGE` | audit `MCP_CATALOG` (activations user exclues) |
| imports personnels (`mcp-remote/connectors` scope mine) | POST/GET | `MCP_REMOTE_INVOKE` + JWT | privés, `tenant`-scoped, secrets chiffrés |

- **Permission `MCP_CATALOG_MANAGE`** ajoutée OWNER+ADMIN (`packages/core/src/identity/permissions.ts`) ; codes d'erreur dédiés (`packages/core/src/errors.ts`).
- **Matrice imposée par le serveur** : `BROUILLON → VALIDATION → PUBLIE ⇄ DÉSACTIVÉ` (+ retours autorisés) ; toute transition hors matrice = 409. Le front n'est qu'un afficheur.
- **Catalogue GLOBAL** : table `mcp_catalog` **sans `tenant_id`** (`packages/core/src/mcp/catalog/store.ts`), avec normalisation NFD des catégories côté serveur (miroir `normalizeText` côté front).
- **Imports personnels** : jamais écrits dans `mcp_catalog`, jamais agrégés en ligne (uniquement compteurs), secrets chiffrés et **jamais renvoyés en lecture**.
- **Audit** : action `MCP_CATALOG` (`packages/core/src/observability/audit.ts`) ; les activations utilisateur sont exclues de l'historique admin.
- **Aucune exécution d'outil MCP** dans les deux modules (garde statique USI-08/MSI-09) : ni `prepare`, ni `call`.

### 2.2 Front — règles appliquées

- 2 modules **IIFE ES5** : `var`, ni `??` ni `?.`, ni `innerHTML`, ni `classList`.
- Session via `localStorage['vibecode_auth_token']` + décodage JWT ; `window.syncMcpAdminMenu` ne manipule **que** le mot `hidden` sur le bouton de menu.
- **Les permissions sont revérifiées côté backend à chaque appel** : masquer le bouton n'est qu'un confort d'affichage ; sans `MCP_CATALOG_MANAGE`, l'API répond 403 (observé : 403 pré-login sur `/mcp/admin/*`).
- Design sombre existant (`bg-[#06080e]`), cartes, pilules à compteurs, `data-role` responsive.

---

## 3. Tests — 59/59

| Bloc | Fichiers | Résultat |
|---|---|---|
| API admin | `apps/api/tests/mcp-catalog-admin.test.ts` | **14/14** |
| API user | `apps/api/tests/mcp-catalog-user.test.ts` | **12/12** |
| Séparation admin/user | `apps/api/tests/mcp-catalog-separation.test.ts` | **7/7** |
| UI (structure + modules) | `packages/core/tests/studio/mcp-{user-hub-studio,admin-studio,uimcp-shell-structure}.test.ts` | **26/26** |
| **Total lot** | | **59/59** |

- Typecheck `npx tsc --noEmit` → **EXIT 0**.
- Build temporaire `.tmp-uimcp-dist` (jamais `dist`) → **EXIT 0**.
- 3 bugs UI ont été **détectés puis corrigés par les tests** : compteur après désactivation, toast d'import, lignes d'historique non rattachées + `state.loadError` non effacé.

### 3.1 Non-régression du shell édité (preuves)

| Sous-ensemble | Résultat | Échec | Qualification |
|---|---|---|---|
| `preview-builder` (`real-source`, `preview-integration`, `preview-final`) | 37 pass / 1 fail | `real-source` n°11 | **pré-existant documenté** (`mcp-prepublication-final-audit.md` §89 : `agent-generation-pipeline.ts` contient `/stream`, fichier non suivi hors lot) |
| Shell (`studio-shell-api`, `agents-batch-detail/panel/task-detail-e41`, `builder-fidelity-head-styles`) | 42 pass / 1 fail | `agents-task-detail-e41` #6 (`AGENT_STARTED`+`FINAL_DEGRADED`) | **pré-existant/environnemental — prouvé** |

**Preuve worktree du 2ᵉ échec** : `git worktree add .tmp-uimcp-baseline HEAD` (`4247d08`) → build EXIT 0 → 12/12 dans son propre cwd (sans `.env`), mais **11/12 avec le même cwd `Y:\` (.env présent) = même échec #6**. L'échec dépend de l'environnement, pas des changements du lot. Worktree supprimé ensuite (`git worktree list` = principal uniquement).
Test n°10 de `real-source` (celui qui lit `index.html`) → ✅ passe. `agent-generation-pipeline.ts` est suivi et **non modifié** (`git status` vide sur ce fichier).

---

## 4. Validation navigateur end-to-end (instance isolée port 3212)

**Méthode** : serveur isolé (base `VOLACO_DATA_DIR` temporaire, `VOLACO_BIND_HOST=127.0.0.1`, **cwd = `Y:\`** pour servir le `apps/studio` source modifié), compte jetable créé via l'UI d'inscription (`uimcp-owner@test.local`, compte de test sur instance isolée — pas un secret utilisateur). PID réel **27344 (port 3000) jamais touché**, `dist/` jamais remplacé, `.volaco-data` intouché.

| Scénario | Résultat |
|---|---|
| Menu admin visible pour OWNER (`menuAdminHidden:false`) ; 403 pré-login sur `/mcp/admin/*` | ✅ fail-closed serveur observé |
| `#mcphub` : **0 erreur console** ; pilules `Tous/Activés`, catégorie, état vide, formulaire import privé (mention « chiffré / jamais renvoyé ») | ✅ |
| `#mcpadmin` : **0 erreur console** ; stats **réelles** (0 sur base vide), cartes `personal-aggregates` + `connections`, pilules à compteurs, état vide, `data-role=admin-dashboard` | ✅ |
| Création via UI → « Notion MCP (démo UI) » → **BROUILLON forcé** + toast « statut initial forcé par le serveur » | ✅ |
| Transitions UI : « Statut maintenant : En validation. » → « Statut maintenant : Publié. » | ✅ |
| Historique audit : Création → `BROUILLON→VALIDATION` → `VALIDATION→PUBLIE` (userId + horodatages) | ✅ |
| Retour `#mcphub` : entrée visible `Tous (1)` → clic **Activer** réel → carte « Activé / Désactiver », `Activés (1)`, toast serveur | ✅ |
| `personalRows:0` après activation catalogue (les instances catalogue restent exclues de la liste perso) | ✅ |

### 4.1 Captures

`browser.screenshot` est **impossible** tant que la fenêtre desktop OpenCode est masquée (« needs a visible tab », même après `tabs.focus`) → voie alternative validée : capture in-page via `html2canvas` (chargé localement, `apps/studio/html2canvas.min.js` L32) → `canvas.toBlob` → `<a download>` → `browser.files.get` :

| Vue | Taille | Fichier |
|---|---|---|
| `#mcpadmin` (dashboard, agrégats, historique, carte Publiée) | 1000×1081, 189 Ko | `Temp\opencode\uimcp-capture-admin.png` |
| `#mcphub` (toast d'activation, carte Activé, imports privés) | 1000×931, 112 Ko | `Temp\opencode\uimcp-capture-user.png` |

*(Les deux captures ont été visuellement validées dans la session.)*

---

## 5. Limitations documentées

1. **Keyring MCP distant absent en dev (pré-existant, fail-closed)** : `packages/core/src/mcp/remote/crypto.ts` L163-173 exige `VOLACO_MCP_REMOTE_KEY_ID` — sans elle, routes 500/503 `MCP_REMOTE_CONFIG`. Vérifié sur **le serveur réel :3000 → 503 aussi** (PID 27344 inchangé) ; `.env` ne contient que AUTH_SECRET / MISTRAL_API_KEY / VOLACO_JWT_SECRET (noms seuls vérifiés). L'instance isolée a reçu un keyring dédié (`uimcp-ui-v1`, clé générée en mémoire, **jamais affichée**). Correction hors périmètre (config d'exploitation).
2. **CAP-01 (P2, résiduel)** : flush de persistance O(n) → ~191 req/s à 15 000 projets ; correction = migration de schéma, hors périmètre du lot.
3. **2 échecs de non-régression** : les deux prouvés pré-existants/environnementaux (§3.1) — ni corrigés ni régressés par ce lot.
4. **Screenshots natifs** : bloqués par la fenêtre desktop masquée ; contournés par html2canvas (§4.1).
5. **Push** : dépôt local **sans remote** — aucune action de push possible sans URL fournie.

---

## 6. Fichiers du lot (état git : 8 modifiés + 10 non suivis)

**Modifiés** : `apps/api/src/routes/mcp-remote.ts`, `apps/api/src/server.ts`, `apps/studio/index.html`, `packages/core/src/{errors,identity/permissions,observability/audit}.ts`, `packages/core/src/mcp/remote/{store,types}.ts`.

**Nouveaux (non suivis)** : `apps/api/src/routes/mcp-catalog.ts`, 3 tests API (`mcp-catalog-{admin,user,separation}.test.ts`), 2 modules front (`apps/studio/mcp-{user-hub,admin}.js`), `packages/core/src/mcp/catalog/`, 3 tests UI (`mcp-{user-hub-studio,admin-studio,uimcp-shell-structure}.test.ts`).

**Non touché (règles de lot)** : `.volaco-data`, `dist/`, serveur réel PID 27344, `.tmp-lot8-*`, aucun commit, aucun Lot C/D.

---

## 7. Fonctionnalités manquantes / suites possibles

- Config du keyring MCP distant en environnement dev (§5.1) — décision d'exploitation, pas de code.
- Éventuelles actions admin avancées non couvertes par la matrice (duplication d'entrée, réordonnancement des catégories) — non demandées.
- Correction de CAP-01 (migration de schéma) et des 2 échecs pré-existants — hors lot.

---

**Fin du rapport — en attente d'autorisation de clôture (aucun commit effectué).**
