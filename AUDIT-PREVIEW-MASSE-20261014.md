# AUDIT PREVIEW GRANDE MASSE — volaco-core (audit chirurgical)

**Date :** 14 octobre 2026 · **Méthode :** lecture directe du code (preuves `fichier:ligne`), mesures du banc du 13/10, état disque/base réels · **Read-only : rien modifié.**
**Référence :** fait suite à `AUDIT-PREVIEW-20261012.md` (26 constats) — on ne répète que ce qui change le verdict masse ; les 6 correctifs FREEZE depuis sont intégrés (SEC-01/02/03, PV-01/02/03).

---

## 0. Verdict en 30 secondes

| Palier | Verdict |
|---|---|
| **1–30 utilisateurs** | ✅ Tient (banc du 13/10 : lectures ~1 500 req/s, écritures 583/s non saturées). |
| **~100 utilisateurs actifs** | 🔴 **Casse sur 3 murs** : sémaphore IA (3 slots partagés), Chromium sans plafond (OOM), builds concurrents qui se corrompent. |
| **1 000+** | 🔴 Refonte horizontale obligatoire (voir audit 50k req/s : file IA, Redis, workers). |

**Le mur n°1 n'est pas le CPU : c'est le sémaphore IA à 3 + deux routes lourdes qui le CONTOURNENT** (trou chirurgical §2-M1).

---

## 1. Capacité mesurée (rappel banc 13/10, nouveau code)

| Chemin | Plafond mesuré | p95 au plafond |
|---|---|---|
| Lectures API / santé | ~1 200–1 770 req/s | 53–78 ms |
| Statique (moteur preview) | ~1 380 req/s | 69 ms |
| Écritures projets | > 583/s (non saturé) | 41 ms |
| Logins | ~75/s | 265 ms |
| Générations IA (chat + app) | **3 simultanées puis 503** | refus en ~15 ms |

État réel du disque/base : `workspace/` **214 Mo / 6 338 fichiers**, `volaco.db` 41 Mo + WAL 22 Mo, document `revisions` **17,8 Mo** (stringifié à chaque révision).

---

## 2. Constats chirurgicaux masse (nouveaux ou aggravés)

### M1 — `/repair` et `/render` contournent le sémaphore IA (TROU)
`apps/api/src/server.ts:496-502` — `isAiHeavy` ne couvre que `generate|edit|apply-edits|images|orchestrate|stream|ai/chat`. Or :
- `routes/repair.ts:140-183` boucle jusqu'à 3 itérations avec **appel LLM par itération** (`:162`) + **rendu Chromium par itération** →LLM + Chromium **non bornés** ;
- `routes/render.ts` + `real-renderer.ts:190` lancent **1 Chromium par appel** (timeout 15 s `:56`, sandbox toujours off `:193`).

**Effet masse :** le garde-fou "3 slots" est évitable en tapant `/repair` : N réparations parallèles = N×LLM + N×Chromium. C'est la porte de sortie du seul plafond IA.

### M2 — Chromium sans plafond = OOM programmée
Chaque navigateur ≈ 200–500 Mo RAM. 20 `/render` ou 7 `/repair` concurrents ≈ plusieurs Go + CPU : le process tombe (pas de reprise : mono-instance, §6-5 de l'audit sécu). Aucune file, aucun compteur (`runtime-metrics.ts` ne suit que les slots IA).

### M3 — Builds concurrents : corruption toujours possible (PV-06 intact)
`app-pipeline.ts:231-232` — `outDir: 'dist'`, `emptyOutDir: true`, **toujours dans le process API, toujours sans verrou**. À 2 générations simultanées (déjà possible : 3 slots !), un build vide le `dist` de l'autre. Le banc ne l'a pas heurté (1 projet testé) ; à 100 utilisateurs ce n'est plus un `[?]` mais du statistiquement certain.

### M4 — Flux fantômes : slots et crédits brûlés après déconnexion
- `app-edit.ts:190-193` : `clientGone` coupe l'ENVOI mais `runToolLoop` **continue** (pas d'`AbortSignal` — `tool-loop.ts` n'en connaît aucun) ;
- pas d'événement terminal garanti côté preview (PV-05 intact), pas de heartbeat/durée max (PV-15 intact).
**Effet masse :** à 100 users mobiles (onglets fermés, réseau 4G), une part des 3 slots est occupée par des générations pour personne + facturation Mistral pour rien.

### M5 — Pas de gestion du 503 côté Builder (UX)
`preview-builder-app.js` : zéro occurrence de `AI_BUSY`/`503`/`retry` (vérifié). À masse, quand le sémaphore refuse, l'utilisateur ne voit pas "réessaie dans 15 s" mais un "Building…" potentiellement infini (conjugué à PV-05). Le refus propre côté serveur existe ; **l'affichage n'existe pas**.

### M6 — Croissance sans purge (le mur lent)
- `workspace/` : +1 dossier + `dist/` par projet généré, **214 Mo déjà**, aucune purge, aucune quota ;
- `revisions` : **17,8 Mo**, +1 révision **par tour de stream** (route conversation), stringifié à chaque écriture ;
- `file-explorer/store.ts` : **toujours aucun plafond** taille/nombre (PV-17 intact), tout en RAM ;
- `preview-standalone.ts` (notre PV-01) : plafond **50 entrées GLOBAL tous locataires** — à masse, les aperçus s'évictent entre utilisateurs (fonctionnel, pas sécu ; à passer par locataire ou à purger par TTL).

### M7 — Rate limits par IP : le piège du bureau partagé
`server.ts` : 600/min API, 2 000/min statique, 60/min IA **par IP**. Un chargement Studio ≈ 10 fichiers statiques + N appels API. Derrière **une même IP de sortie** (bureau, école, VPN d'entreprise), 30–60 utilisateurs = 429 **légitimes** bien avant toute saturation machine. À documenter dans l'UX (message "réseau partagé saturé") et à passer par utilisateur authentifié un jour.

### M8 — Ce que nos 6 correctifs ont déjà fermé (ne pas re-compter)
Traversée `projectId` (SEC-01, protège aussi `ensureWorkspace`), SSRF navigateur MCP + sandbox (SEC-02), `npm test` (SEC-03), double facturation (PV-03), locataires preview JSON + non-matérialisation bundle (PV-02/PV-19), cage popout + ETag/304/gzip + 429 statique. **Restent exposés :** `/render` (Host+nosandbox : PV-07/PV-09/SEC-06), builds (PV-06), SSE (PV-05/15/20), undo/sections (PV-08/13/14), XSS Studio (SEC-08).

---

## 3. Ce qui casse en premier à 100 utilisateurs (ordre chronologique probable)

1. **503 AI_BUSY en rafale** (3 slots pour chat+generate+edit) → utilisateurs bloqués des minutes ;
2. **Contournement par `/repair`** → facture Mistral + OOM Chromium ;
3. **Bundles corrompus** (builds concurrents, `emptyOutDir`) → previews 404 intermittents, tickets "ça marchait hier" ;
4. **Disque/base qui gonflent** (workspace, revisions 17,8 Mo → 100 Mo+) → écritures qui ralentissent à nouveau ;
5. **429 derrière IP partagées** → incompréhension ("ça marche chez moi, pas au bureau").

---

## 4. Plan correctif (chirurgical, sans refonte)

**P0 — avant toute montée en charge (heures, même discipline que d'habitude)**
1. Inclure `/repair` (+ son LLM) et `/render` dans le sémaphore — ou mieux : **2 compteurs séparés** (`AI_SLOTS=3`, `CHROMIUM_SLOTS=2`), refus 503+Retry-After homogène. Tue M1+M2 au prix de 2 constantes.
2. UX 503 côté Builder : message "file saturée, nouvel essai dans 15 s" + **retry auto 1×** (fini les "Building…" fantômes). Tue M5.
3. Propager l'abandon client au tool-loop (`AbortSignal` : `clientGone` → annule LLM + libère le slot). Tue M4.

**P1 — semaine**
4. Build hors process (worker thread) + **verrou par projet** + sortie `dist-<buildId>` + bascule atomique. Tue M3.
5. Rétention : purge workspaces orphelins, cap revisions/projet, TTL + périmètre locataire sur l'aperçu isolé, plafonds FileStore. Tue M6.
6. Compter le 429 par **utilisateur authentifié** (repli IP) + message dédié IP partagée. Tue M7.

**P2 — fond (renvoi)**
7. File IA (BullMQ) + workers autoscalés, Redis, builds distribués — voir audit 50k req/s. Sans ça, pas de palier 1 000+.

## 5. Ce qu'il ne faut PAS faire
- Monter `VOLACO_MAX_CONCURRENT_AI` à 50 "pour tenir" : sans file, c'est 50 builds/Chromium concurrents → **OOM + corruption garanties** (pire que le 503 propre).
- Mettre un CDN devant `/preview-bundle` sans signer les URLs : copierait le trou PV-02 chez le CDN.
- Multi-processus (cluster) avant Redis : les 3 sémaphores/buckets sont en mémoire → 4 workers = 4× les plafonds + états incohérents.

*Preuves : `server.ts:496-502`, `repair.ts:29,140-183`, `real-renderer.ts:56,190-207`, `app-pipeline.ts:212,231-232`, `app-edit.ts:190-193`, `tool-loop.ts` (aucun signal), `preview-builder-app.js` (aucun retry), `revision-store.ts` (aucun cap), `file-explorer/store.ts` (aucun plafond), `preview-standalone.ts` (cap 50 global), mesures bench-2026-10-13T23-19-13-940Z.*
