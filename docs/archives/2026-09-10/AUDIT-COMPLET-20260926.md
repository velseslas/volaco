# AUDIT COMPLET — volaco-core (VibeCode Studio Core)

**Date :** 26/09/2026 · **Périmètre :** ensemble du dépôt `C:\Users\FAYCAL\.gemini\antigravity\scratch\volaco-core` · **Méthode :** lecture statique exhaustive (architecture, sécurité, qualité, tests, hygiène), vérification directe des constats critiques.

---

## Verdict global

**Projet solide sur le fond, en danger immédiat sur la forme.**

L'architecture (monolithe modulaire TS strict, 13 ADR, RBAC multi-tenant, 57 suites de tests) est de qualité nettement supérieure à la moyenne. Mais le projet présente **un risque existentiel non géré** : la moitié du travail récent (phases 9.5 à 23) n'existe que dans `dist/` (le dossier de build), pas dans les sources — **un simple `npm run build` le détruirait** — et il n'y a **aucun dépôt git** pour rattraper une erreur. Par ailleurs la sécurité du mode dev est ouverte (bypass auth + écoute LAN) et la clé Mistral du `.env` est morte (401), donc l'IA réelle est down.

| Domaine | Note | Résumé |
|---|---|---|
| Architecture & conception | **B+** | Monolithe modulaire cohérent, ADRs à jour, séparation nette apps/packages |
| Risque d'intégrité du code | **F** | Phases 9.5–23 uniquement dans `dist/`, pas de git, `npm run build` destructeur |
| Sécurité (dev) | **D** | Bypass auth hors production + écoute `0.0.0.0` + clé par défaut prévisible |
| Sécurité (conception) | **B** | Whitelist terminal, sanitizePath, aucun eval/vm, écritures atomiques confinées |
| Qualité de code | **A−** | tsconfig très strict, 0 `@ts-ignore`, 3 `as any` en src, 1 catch vide |
| Tests | **C+** | 57 suites propres MAIS gates qui valident du code mort (40 tests orphelins dans dist) |
| Hygiène du dépôt | **D−** | ~100 Mo de résidus, 5 systèmes de backups manuels, mojibake d'encodage |

---

## 1. Architecture — ce qu'est le projet

**~77 400 lignes de TypeScript** (487 fichiers, dont ~53 800 de src et ~23 600 de tests) en monorepo à `package.json` unique (pas de workspaces npm) :

- **`apps/api`** — serveur HTTP **`node:http` natif** (zéro framework), 476 lignes pour `server.ts`, 20 modules de routes REST sous `/api/v1`, middleware d'auth, métriques par requête, gestion d'erreurs centralisée (`AppError`), handlers `uncaughtException`/`unhandledRejection`.
- **`apps/studio`** — frontend **monofichier de 832 Ko** (`index.html`, 10 863 lignes, ~200 fonctions JS inline, 23 blocs `<script>`), Tailwind + html2canvas + JSZip vendorisés, 4 vues, 11 appels fetch vers l'API. Servi directement par le serveur.
- **`packages/core`** (408 fichiers) — tout le métier : persistance **JSON sur disque** (`.volaco-data/`, écriture atomique tmp+fsync+rename), et surtout **`ai-native/` : 349 fichiers, ~44 300 lignes, 91 % du cœur** — agent-runtime (39 fich.), user-feedback (43), strategy (41), conversation-intelligence, ai-orchestrator (agents spécialisés), decision-engine, mutation-orchestrator, semantic-graph, visual-intelligence, etc.

Stack : TypeScript 5.4 **strict intégral** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESM pur, Node natif sans framework, **aucune base de données**, aucune WebSocket. Un seul runtime dep : `playwright-core` (preview engine).

Documentation vivante réelle : **13 ADRs** (`docs/adr/`), 6 `SPEC-PHASE-*.md`, `CORRECTIONS.md` (journal de 16 corrections), dossier `security-audit/` avec 8 vagues d'audits internes (verdict P8 : baseline NON gelée).

---

## 2. CONSTAT N°1 — EXISTENTIEL : `dist/` est la seule maison des phases 9.5–23

C'est le problème qui écrase tous les autres.

**Les faits vérifiés :**

- `packages/core/src/ai-native/` contient **19 modules** ; `dist/packages/core/src/ai-native/` en contient **28**. Neuf modules n'existent **que dans le build** :
  `application-model`, `auto-improvement`, `design-intelligence`, `memory-engine`, `mutation-engine`, `preview-engine`, `quality-engine`, `validation-engine`, `visual-analysis-engine`.
- `dist/apps/api/src/server.js` fait **618 lignes** contre **476** pour `apps/api/src/server.ts` (+30 %) : le serveur de production importe 5 services (`CodeIntelligenceService`, `ApplicationDNAService`, `SemanticCodeGraphService`, `ApplicationUnderstandingService`, `ImpactIntelligenceService`) **absents du serveur source**.
- `package.json` contient `"prebuild": "node scripts/clean-dist.mjs"` → **`npm run build` purge `dist/` puis le reconstruit depuis des sources qui n'ont plus ces modules.** Le résultat : destruction des phases 9.5–23, du preview engine, du mutation engine… La doctrine documentée dans `PATCH-03-README.md` était « ne JAMAIS rebuild ».
- **40 tests compilés orphelins** dans `dist/`, dont **toute la suite sécurité red-team p2→p6** (`dist/apps/api/tests/security/`), `rate-limit`, `cors`, `supply-chain`, `secrets-settings`… **supprimés des sources mais toujours exécutés** par `npm test` (`node --test dist/**/*.test.js`).
- `dist/` mélange des fichiers du build du 4/09 et des injections manuelles du 26/09 — c'est un build hybride, musée + production.

**Conséquences :** impossible de rebuild proprement, impossible de tester la vraie surface, le moindre accident (`npm run build`, `npm test` qui déclenche `pretest` → `build` !) détruit du travail irremplaçable. **`npm test` est lui-même piégé** : il déclenche `pretest: npm run build` → `prebuild: clean-dist`.

**Remède :** rétro-porter immédiatement les 9 modules + le `server.js` de `dist/` vers les sources TS (les `.js` de dist sont lisibles et typables progressivement), OU au minimum geler `dist/` en lecture seule et retirer les hooks `prebuild`/`pretest`.

---

## 3. Sécurité

### 3.1 CRITIQUE — Bypass d'authentification complet hors production

`apps/api/src/middleware/auth.ts:31-58` (vérifié ligne par ligne) : si le Bearer est absent/invalide **et que `NODE_ENV ≠ production`**, la requête est **acceptée quand même** avec `tenantId` et `role` lus dans les en-têtes client `X-Tenant-Id` / `X-User-Role`. N'importe qui envoie `X-User-Role: OWNER` et obtient les pleins pouvoirs. Le garde 401 n'existe qu'en production (`server.ts:233-238`). Les logs du 26/09 confirment l'exploitation passive : requêtes traitées en `role: ENGINEER` sans auth.

### 3.2 ÉLEVÉ — Le serveur écoute sur toutes les interfaces

`apps/api/src/server.ts:469` : `server.listen(config.port)` **sans host** → écoute sur `0.0.0.0`/`::`, alors que la console affiche « http://127.0.0.1:3000 » (trompeur). Combiné au §3.1, **toute la machine/LAN accède à l'API** : création/suppression de projets, mutation de fichiers, proxy IA. À noter : le mini-serveur de rendu, lui, bind correctement `127.0.0.1` (`real-renderer.ts:116`) — la correction est triviale.

### 3.3 ÉLEVÉ — Secrets

- `.env:1` : vraie clé Mistral en clair (`mstrl_…`). Déjà **rejetée 401** par l'API (visible dans `server-err.log`) — l'IA réelle est donc **down** et le moteur conversationnel replie sur des règles par mots-clés. À révoquer définitivement côté Mistral et remplacer.
- `packages/core/src/ai\providers\mistral-adapter.ts:100-102` : en cas de 401, le message d'erreur loggue **4 premiers + 4 derniers caractères et la longueur de la clé** (`mstr...cSxo, longueur 45`) — confirmé dans `server-err.log`. Fuite partielle facilitant la validation d'une clé volée.
- `packages/core/src/config.ts:21` : `apiKey = VOLACO_API_KEY || 'dev-key-change-me'` hors production — et le `.env` actif contient précisément `VOLACO_API_KEY=dev-key-change-me`.

### 3.4 MOYEN — Ensemble des failles résiduelles

| Faille | Localisation | Détail |
|---|---|---|
| CORS `*` par défaut | `server.ts:182-184` | `CORS_ALLOWED_ORIGINS` non défini dans `.env` → `Access-Control-Allow-Origin: *` (SEC-004 ancienne, toujours vivante) |
| Sandbox iframe contournable | `apps/studio/index.html:1387` + `:4755` | `sandbox="allow-scripts allow-same-origin"` + `srcdoc` : le code généré par l'IA peut casser sa sandbox et appeler l'API same-origin (SEC-007 non corrigée) |
| CDN sans SRI | `apps/studio/index.html:11,16,23,30` | `cdn.tailwindcss.com`, cdnjs… chargés sans `integrity` (SEC-011 non corrigée) |
| Statique sans auth | `server.ts:264-287` | Tout `apps/studio/` est servi en dev avec un simple garde `!includes('..')` |
| Écriture temp non revalidée | `real-renderer.ts:72-80` | `join(tempDir, relativePath)` sans re-contrôle de `..` (sauvé aujourd'hui par `sanitizePath` en amont — défense en profondeur manquante) |
| Token non constant-time | `auth.ts:21` | `token !== config.apiKey` — timing théorique |

### 3.5 Points forts de sécurité (à préserver)

Terminal en **liste blanche stricte** (`terminal/whitelist.ts` : 4 binaires, sous-commandes fermées, motifs d'injection rejetés) exécuté via `execFileSync` **sans shell** ; `sanitizePath` hermétique sur toutes les opérations fichiers ; **aucun `eval`/`new Function`/`vm` serveur** ; moteur de mutation avec blacklist de fichiers secrets (`.env`, `.pem`, `id_rsa`…) ; écritures disque atomiques et confinées à 3 zones contrôlées ; isolation tenant par clés composites `${tenantId}:${projectId}` ; ancienne route SSRF `configure-key` supprimée. Les 8 vagues d'audit internes (`security-audit/`) restent globalement concordantes avec l'état réel du code.

---

## 4. Qualité de code et tests

**Remarquablement propre pour 77 k lignes :**
- **0 `@ts-ignore`**, **3 `as any`** dans tout le src (96 au total mais 93 dans les tests), TODO/FIXME quasi inexistants (les pattern-matches sont dans le détecteur de dette du projet lui-même) ;
- **1 seul catch vide** (`studio/renderer.ts:535`) ; gestion d'erreurs API homogène (try/parse → `ValidationError` → handler central `server.ts:418-429`) ;
- Aucun fichier monstre (max 781 lignes), modules bornés, ADRs tenues.

**Faiblesses :**
- **Aucun lint** (ni ESLint, ni Biome, ni Prettier) — seul `tsc` protège ;
- **Vitest installé et configuré mais jamais utilisé** : `test` = `node --test dist/**/*.test.js` (donc tester = builder = danger, cf. §2) ;
- Gates `gate1`/`gate2` avec **chiffres codés en dur** (« 169/169 PASS ») non recalculés — cosmétique trompeuse ;
- Gate 2 exécute les 97 tests de `dist/` dont 40 orphelins (§2) : elle valide du code mort ou échoue sur imports cassés ;
- **Mojibake dans les sources** : `'RequÃªte HTTP'` (`server.ts:241`) — fichier écrit/relu avec encodages incohérents, les logs serveur affichent ce texte corrompu.

---

## 5. Hygiène du dépôt

**Pas de git** (confirmé) alors qu'un `.gitignore` existe déjà. Le versionnage a été fait à la main : 2 `BACKUP-*`, 3 `patch-backup*` (dont **un doublon intégral créé 80 s après l'autre**), 9 `server.js.backup-phaseXX` **à l'intérieur de `dist/`**, 18 scripts `apply_*.ps1` one-shot à la racine. Total dépôt ≈ **187 Mo**.

**Supprimables sans perte (~100 Mo) :**

| Cible | Taille | Contenu |
|---|---|---|
| `.volaco_data/` | **97 Mo** | Ancienne persistance snake_case figée au 19/09 : **1 395 dossiers `worker_<pid>`** résidus de tests + `.tmp.*` orphelins (sauver éventuellement `conversations.json`/`plans.json` avant) |
| `index.html` + `volaco_studio.html` (racine) | 1,8 Mo | Copies pures (la racine est identique octet-pour-octet à la version servie) |
| `patch-backup-20260925-184017/` | 84 Ko | Doublon intégral du 183952 |
| `.volaco_test_data/` | 47 Ko | Fixtures plus référencées nulle part |
| `2/` | 0 Ko | Dossier vide (commande ratée) |
| PNG 4/09, `preview-final.png`, logs | ~280 Ko | Vestiges de validation visuelle ; `preview.png` ≡ `preview-final.png` |

**À archiver (seul historique existant du projet) :** `BACKUP-*`, `patch/`, `apply_*.ps1`, `CORRECTIONS.md`, `SPEC-PHASE-*.md`. À noter : les trois conventions `.volaco-data` (actif, kebab) / `.volaco_data` (mort, snake) / `.volaco_test_data` (mort) coexistent — seul le premier est légitime.

---

## 6. Plan d'action priorisé

### P0 — aujourd'hui (30 min, protège l'existant)
1. **`git init` + commit de l'état actuel** (le `.gitignore` existe déjà ; ajouter `.volaco_data/`, `patch-backup*/`, `BACKUP-*/` si besoin). C'est la seule protection réelle contre l'accident de build.
2. **Neutraliser le piège** : retirer `prebuild`/`pretest` de `package.json` (ou faire échouer `clean-dist.mjs` si modules fantômes détectés) tant que le rétro-portage n'est pas fait.
3. **Révoquer** la clé Mistral côté console et la retirer de `.env` ; corriger `mistral-adapter.ts:100-102` pour ne plus logguer d'indice de clé.
4. **`server.listen(config.port, '127.0.0.1')`** (`server.ts:469`).

### P1 — cette semaine
5. **Rétro-porter `dist/` → sources TS** : les 9 modules fantômes + le `server.js` enrichi (618 l.) vers `apps/api/src/server.ts`, puis **restaurer les 40 tests orphelins** (surtout la suite sécurité red-team p2–p6) dans les sources, et **rebuild propre** une fois la parité atteinte.
6. **Corriger le bypass dev** (`auth.ts:31-58`) : exiger le Bearer partout sauf health/status, quel que soit l'environnement ; le mode « legacy headers » ne devrait exister que derrière un flag `VOLACO_DEV_INSECURE=1` explicite.
7. Définir `CORS_ALLOWED_ORIGINS` dans `.env` ; ajouter SRI aux CDN ; re-considérer `allow-same-origin` dans la sandbox iframe.

### P2 — ce mois
8. Purge des ~100 Mo (tableau §5) après le commit git P0.
9. **Un seul pipeline de tests** (trancher vitest vs node --test), supprimer les chiffres codés en dur des gates, réparer le mojibake d'encodage (réécrire les fichiers en UTF-8 propre).
10. Introduire un lint (Biome ou ESLint) et brancher les gates dessus.
11. Prochain jalon produit : **AINT-016 (AI Strategy Optimizer)** — spécifié (`aint016_full_spec.txt`) mais non démarré ; à planifier **dans les sources cette fois**, pas en patch `dist/`.

---

*Audit réalisé par lecture statique ; les constats critiques (bypass auth, écoute réseau, divergence src/dist, secrets) ont été vérifiés par lecture directe du code concerné.*
