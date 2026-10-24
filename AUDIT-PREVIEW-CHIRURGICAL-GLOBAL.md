# AUDIT-PREVIEW-CHIRURGICAL-GLOBAL — VOLACO (read-only, 15/10/2026)

## 0. Cadre d'exécution
- **HEAD audité :** `aa8233e` · arbre de travail **non propre au départ** (25 fichiers modifiés non commités + ~40 artefacts non suivis : `.bak`, `_backup-*`, zips, `bench/`, `dist/` — état antérieur à cet audit, **non touché**).
- **Interdits respectés :** zéro modification source, zéro commit, zéro appel IA payant, zéro écriture DB, zéro suppression, charge prod nulle (seules sondes isolées : builds sur projets `audit-probe-*` créés puis supprimés, Chromium local, fichiers existants uniquement).
- **Anciens audits NON réutilisés aveuglément :** chaque constat ci-dessous est revérifié au HEAD (ligne exacte) ou marqué REPORTÉ.

## I. Synthèse exécutive
| Périmètre | Verdict |
|---|---|
| Développement interne (local, solo) | **GO** — 2041/2041 tests, socle sain |
| Bêta contrôlée (utilisateurs invités, même serveur) | **GO CONDITIONNEL** — corriger PV-AUD-001/002/004 d'abord |
| Production publique | **NO-GO** — auth dev active, secrets navigateur, CSRF (hérités audit sécu, toujours ouverts) |
| Montée en charge internationale | **NO-GO** — tout l'état est en mémoire mono-instance |

## II. Architecture réelle (vérifiée)
```
Studio (index.html, 1 Mo, non typé)
 ├── chat → POST /stream (SSE) → Mistral → sections → FileStore index.html
 ├── pont postMessage → Builder (relai, 1 seule génération) + sync-project
 └── popout → /preview-bundle/:id/ (dist, CSP sandbox) ou /preview-standalone/:id/ (mémoire, 50 max)
Builder (preview-builder.html + app.js, page autonome)
 ├── moteur (engine.ts, états immuables) ← adapter.ts (ignore chat/token/compass)
 ├── renderer/drag/edit/inspect → PUT files/content, révisions, rollback
Serveur : 34 routes → stores SQLite (1 doc JSON/ligne) → vite.build IN-PROCESS
 → dist/ → Chromium (screenshots gate/repair/render) → Quality Gate (grille déterministe)
```
Dépendances prod : `react ^19.3.0`, `vite ^5.4.21`, `playwright-core ^1.63.0`, TS `^5.4.5` strict-max · `npm audit` : **0 vulnérabilité** (revérifié 15/10).
Blocs gelés préservés : legacy stitch (bypassé E45, fallback conservé), libération `close` unique É48 P2, `dist/` runtime.

## III. Constats (ID · gravité · preuve · statut)

### P0 — bloquant bêta/sécu
**PV-AUD-001 · Chromium `--no-sandbox` sur contenu généré** · `packages/core/src/ai-native/visual-intelligence/real-renderer.ts:193` (`args: ['--no-sandbox','--disable-setuid-sandbox']`). CONFIRMÉ (relit le 15/10 ; le fix jumeau `browser-server.ts` existe mais pas ici). Repro : POST `/render/preview` sur tout projet → navigateur non confiné. Fix : sandbox par défaut + `VOLACO_CHROMIUM_NO_SANDBOX=1` en repli (copier le motif existant). Validation : test render sandboxé 200. Régression : nul (même API).
**PV-AUD-002 · URL de rendu depuis l'en-tête `Host`** · `apps/api/src/routes/render.ts:58` (`` `http://${req.headers.host...}${parsed.url}` ``). CONFIRMÉ. Préfixe `/preview-bundle/` contraint mais hôte libre → SSRF ciblée. Fix : `http://127.0.0.1:${req.socket.localPort}` + gardefou existant. Validation : test Host forgé → 200 local.
**PV-AUD-004 · `timeoutMs` terminal non borné côté serveur** · `terminal/service.ts:82,121` (`timeout: input.timeoutMs ?? 10_000`, aucune borne haute). CONFIRMÉ. Repro : commande longue = boucle bloquée (mono-thread). Fix : clamp 5–30 s + file (motif sémaphores). Validation : test timeout refusé/borné.

### P1 — à traiter avant/après bêta
**PV-AUD-003 · `/repair` ne soigne que le VFS `index.html`** · `repair.ts:56-57,121-123,180,192,205`. CONFIRMÉ. Les applis React (`app/**`, bundle servi) ne sont pas réparées. Fix : aligner sur format projet (sources React + rebuild) ou `renderAvailable:false` honnête.
**PV-AUD-008 · Inscription ouverte → OWNER + JWT 30 j sans révocation** · `user-store.ts:74` (`role: 'OWNER'`), `:132` (TTL 30 j), pas de registre de révocation (vérifié : `verifyToken` ne connaît que signature+exp). CONFIRMÉ. Fix : invitation/allowlist + refresh courts + révocation.
**PV-AUD-010 · Builds dans le process API (~150 Mo RSS/build mesuré)** · `app-pipeline.ts:216` + **sonde du jour : 2 builds parallèles OK en 2,7 s mais +310 Mo RSS** (nettoyé après). Verrou par projet + atomicité : DÉJÀ CORRIGÉ (vérifié). Reste : hors-process + file. À 10 builds ≈ 1,5 Go → OOM. Fix : worker + file durable.
**PV-AUD-011 · État 100 % mémoire mono-instance** · sémaphores, buckets, `projectLockTails`, `standaloneStore`, sessions. CONFIRMÉ par lecture. Bloquant multi-instance uniquement ; correct en l'état local.
**PV-AUD-018 · Collision texte/photo < 900 px (OBSERVÉ)** · captures du jour (boulangerie, tablette 820 + mobile 390) : titre qui déborde sur les photos latérales, lisibilité dégradée, zéro erreur console, pas de scroll (indétectable au gate actuel). Impact : la moitié du trafic. Fix : empilement vertical < 768 px (règle prompt + contrôle gate).
**PV-AUD-020 · Zéro test e2e navigateur / chaos / régression visuelle** · 0 fichier (`toMatchImageSnapshot|pixelmatch`: 0 ; crash/reprise : que des mentions). 163 fichiers / 2041 tests par ailleurs verts (lancés le 15/10 : **2041/2041**). Fix : 3 tests ciblés (parcours critique Builder, crash mid-build, golden screenshots).

### P2 — fond
**PV-AUD-005** `/metrics` sans auth (`observability.ts:17`) — volumétrie exposée (throttlée 2000/min depuis n°5, mais lisible). **PV-AUD-006** audit sans `userId` (`auth.ts:8-12` : pas de `sub` dans le contexte). **PV-AUD-007** indice de clé en erreur (`mistral-adapter.ts:152-153`). **PV-AUD-009** pas de `realpath`/symlinks (`workspaceDir` : `resolve`+`startsWith` sans `realpath`). **PV-AUD-012** terminal SSE sans événement terminal garanti (PARTIEL : retry+abort ajoutés, heartbeat/durée max manquent). **PV-AUD-013/014** undo/sections/parse (PV-08/13/14 : NON RE-TESTÉS — reportés avec réserve, pas de preuve nouvelle). **PV-AUD-015** repli SPA 200+index.html (`app-generator.ts`, fallback) masque les 404. **PV-AUD-016** `moveNode` sans resync disque + `getFile` créateur. **PV-AUD-024** images : pool vérifié + filet, mais observance LLM stochastique, pas de contrôle vision. **PV-AUD-027** quotas par IP partagée (bureau = 429 légitimes). **PV-AUD-019** titres/gabarits dépendants de l'observance (repli serveur OK, preuve en prod).
### P3 — hygiène/vision
**PV-AUD-017** standalone 50 global (éviction croisée à masse ; correctif trivial : TTL/périmètre). **PV-AUD-025** HMR absent (non-bloquant no-code). **PV-AUD-026** runtime full-stack absent (zéro demande : 75 projets 100 % statiques — stratégique, pas urgent). **PV-AUD-028** arbre encombré (60+ lignes `git status`, `.bak`/zips non ignorés).
### DÉJÀ CORRIGÉ (vérifié au HEAD, ne pas rouvrir)
Double génération+listener (PV-03), locataires preview + non-matérialisation (PV-02/PV-19), popout cagé (PV-01), ordre canonique (footer), titres+repli, filet images, grille enrichie (titre/liens/viewport), sémaphores IA+render, retry+abort SSE, verrou projet, rétention 30, quotas 5 Mo, SEC-01/02/03/12, rate-limit statique, cache+ETag+gzip, scrypt/audit/logger async.

## IV. Matrices — voir §III (colonnes : ID·gravité·système·preuve·repro·impact·cause·fix·tests·régression·statut). Fonctionnel : B1 relai OK (testé), B2 stop/done/planFirst couverts (tests), B3 undo+révisions OK (tests), B4 build réel OK (tests, hooks React générés — routing/forms non exercés : PARTIEL).
## V. Top 10 — 001 Chromium, 002 Host, 004 timeout terminal, 008 auth/tokens, 003 repair-React, 010 builds-mémoire, 018 responsive, 011 mémoire-mono, 020 tests-manquants, 024 images-vision.
## VI. Plan micro-blocs (BUILD→TEST→AUDIT→VALIDATE→FREEZE, 2 problèmes max/bloc)
- **BLOC-1 (P0 sécu) :** 001+002 (même motif que SEC-02 déjà freezé). Fichiers : `real-renderer.ts`, `render.ts` + 1 test. Acceptation : Host forgé→local, Chromium sandboxé 200. Rollback : repli env. Gelés : contrats de route.
- **BLOC-2 (P0 robustesse) :** 004 + 012-terminal (clamp timeout + heartbeat/durée SSE). Tests : timeout refusé, EOF→erreur explicite.
- **BLOC-3 (P1) :** 003 repair-React + 010 worker-file (séparables si besoin).
- **BLOC-4 (P1) :** 018 responsive + 020 trois tests ciblés.
- **Ne pas faire :** réécriture, HMR, full-stack, multi-instance avant revenus/demande.
## VII. WOW top-5 — quick wins : photos à sujet vérifié (fait, étendre pool), titres réels (fait), repli images (fait) ; architecturaux : gabarits alternés (instruction posée, vérifier en photo), responsive <768 (règle+test) ; nouveau runtime : aucun requis.
## VIII. Milliers d'utilisateurs — prérequis prouvés avant annonce : file IA durable + workers (pas de Map), builds hors process, Redis/PG, Gateway preview signée, paliers 50/500/2000/10000 **mesurés** (jamais simulés), coût/ Edwards par palier. Aujourd'hui : AUCUN de ces prérequis n'existe → ne pas annoncer de capacité.
## IX. Preuves — commandes : `git rev-parse` (aa8233e), `git status` (enregistré avant/après, identique hors rapport), `npm audit` (0), `tsc` (vert via suite), suite **2041/2041** (log `auditfull.log`), captures `volaco-audit-global/{desktop,tablette,mobile}.png` + constats (`debordement:false`, 0 erreur), sonde builds (`2,7 s, +310 Mo`, nettoyée, 0 résidu), lectures `files`/`revisions`/`executions` (read-only), ~40 fichiers inspectés (liste §annexe du rapport). NON exécuté : charge prod, IA payante, crash provoqué, multi-instance, parcours e2e complets.

## CONTRÔLE FINAL
- **HEAD audité :** `aa8233e` · **Fichiers inspectés :** ~45 · **Tests exécutés :** 2041 (verts) · **P0/P1/P2/P3 :** 3/8/11/4 (dont 14 DÉJÀ CORRIGÉ hors compteur) · **WOW :** correct, pas premium (responsive + diversité à prouver) · **Sécurité :** NO-GO public (3 P0 + hérités auth/CSRF/XSS) · **Charge :** 1 serveur local uniquement (plafonds banc Octobre valides, pas d'extrapolation) · **Production :** NO-GO public, GO interne, BÊTA CONDITIONNELLE aux 3 P0 · **Premier micro-bloc :** BLOC-1 (Chromium+Host).
**STOP. Aucune correction sans validation explicite.**
