# Test de charge backend — RÉSULTATS MESURÉS

**Date de la campagne :** 12 octobre 2026, 23 h 03 → 23 h 09 (UTC) · **Analyse :** 13 octobre 2026
**Machine :** le client de charge et le serveur ont tourné sur **le même poste** (voir §10 « limites »)
**Rapports bruts :** `bench/bench-2026-10-12T23-09-29-316Z.md`, `bench-2026-10-12T23-04-46-724Z.md`, `bench-2026-10-12T23-09-43-468Z.md`

---

## 1. Réponse directe à la question posée

| Charge | Plafond **mesuré** | Latence p95 au plafond |
|---|---|---|
| Endpoint trivial (`GET /health`) | **~1 200 à 1 700 req/s** | 52-55 ms |
| Lecture API (`GET /api/v1/projects`) | **~900 à 1 200 req/s** | 90-98 ms |
| **Fichiers statiques** (JS servi par `readFileSync`, sans cache) | **~550 req/s** ← premier mur matériel | 168 ms |
| **Écriture** (`POST /api/v1/projects`, réécriture + `fsync`) | **~100 écritures/s** | 198 ms |
| **Connexion** (`POST /api/v1/auth/login`, `scrypt`) | **~35 connexions/s** ← mur le plus dur | 554 ms (p99 **1 056 ms**) |
| Génération IA (proxy Mistral) | **3 simultanées**, refus immédiat au-delà | 503 en 15 ms |

**Traduction en utilisateurs** — un utilisateur actif du Studio génère **1 à 3 requêtes/s** (et 5 à 6 au moment d'un chargement de page) :

- **Par IP, la limite réelle n'est pas la machine mais la politique** : 600 req/min/IP = **10 req/s par IP**, soit **3 à 10 utilisateurs actifs par IP**. La machine, elle, encaisse **~100 fois plus**.
- **Écritures** : 100/s ÷ 2 écritures par action ≈ **50 actions d'édition/s** pour tout le serveur.
- **Connexions** : 35/s, mais chacune **gèle le serveur ~30 ms** (voir §4) → au-delà de ~10 connexions/s simultanées, tous les autres utilisateurs subissent des latences de plusieurs centaines de millisecondes.
- **Générations IA** : 3 en parallèle, pas une de plus.

**Autrement dit : en usage mono-utilisateur local, vous êtes à moins de 1 % de la capacité. Le serveur casserait vers 30-50 utilisateurs simultanés réellement actifs** — et le premier à céder serait le chargement des pages (statique), puis les écritures.

---

## 2. Tableau complet des mesures

| Scénario | Conc. | req/s | p50 | p95 | p99 | max | Codes |
|---|---|---|---|---|---|---|---|
| health | 1 | 80 | 15.6 | 16.8 | 17.3 | 17.5 | 200×110 |
| health | 10 | **1 323** | 6.5 | 13.9 | 15.1 | 16.2 | 200×110 |
| health | 50 | 1 208 | 39.5 | 51.9 | 53.6 | 54.0 | 200×110 |
| health | 100 | **1 699** | 51.9 | 55.4 | 55.6 | 55.6 | 200×110 |
| projects-read | 1 | 80 | 15.5 | 17.2 | 17.8 | 19.8 | 200×110 |
| projects-read | 10 | **1 208** | 7.0 | 21.2 | 26.0 | 26.6 | 200×110 |
| projects-read | 50 | 1 038 | 39.6 | 62.6 | 63.0 | 63.1 | 200×110 |
| projects-read | 100 | 907 | 77.1 | 98.3 | 100.7 | 101.2 | 200×110 |
| bundle-static | 10 | **565** | 17.5 | 26.5 | 27.6 | 27.9 | 200×110 |
| bundle-static | 50 | 511 | 89.2 | 119.8 | 130.7 | 135.0 | 200×110 |
| bundle-static | 100 | 573 | 107.9 | **167.8** | 174.1 | 174.7 | 200×110 |
| projects-write | 1 | 67 | 15.5 | 21.1 | 25.0 | 25.0 | 201×40 |
| projects-write | 5 | **100** | 46.9 | 61.6 | 75.1 | 75.1 | 201×40 |
| projects-write | 20 | 100 | **184** | 197.8 | 206.2 | 206.2 | 201×40 |
| auth-login | 1 | 31 | 31.7 | 39.1 | 44.2 | 44.2 | 200×40 |
| auth-login | 5 | 35 | 138.8 | 141.4 | 226.2 | 226.2 | 200×40 |
| auth-login | 20 | **35** | **527** | 554.3 | **1 055.8** | 1 055.8 | 200×40 |

*(Les valeurs à concurrence 1 mesurent la latence d'un appel isolé, pas une capacité : à cette concurrence, le débit affiché est l'inverse du temps de réponse.)*

**Comment lire ces chiffres** — deux régimes seulement :
- **palier 10 → 100 sur `/health` et `projects-read`** : le débit ne progresse plus (1 200-1 700 req/s) alors que la latence passe de 14 ms à 55 ms (**×4**) → **file d'attente** : le serveur traite séquentiellement, la capacité est atteinte.
- **`bundle-static`, `projects-write`, `auth-login`** : le débit est **strictement plat** (573, 100, 35) pendant que la latence explose (**×6 à ×14**) → **saturation franche**, chaque requête supplémentaire n'ajoute que de l'attente.

---

## 3. Ce que la mesure confirme dans l'analyse statique

| Goulot identifié par lecture du code | Prédiction | Mesure | Verdict |
|---|---|---|---|
| Fichiers statiques servis par `readFileSync`, sans cache ni compression | « quelques centaines de req/s » | **565 req/s, plat de 10 à 100 de concurrence** | ✅ exact |
| Écritures : réécriture complète du document + `fsync` | « 100 à 500 écritures/s » | **100,3 écritures/s** | ✅ confirmé (bas de fourchette) |
| `scryptSync` bloquant sur la connexion | « 15-20 /s, puis gel » | **35 /s**, et p99 > 1 s | ⚠️ **mieux que prévu** (hachage ~30 ms, pas 50-100 ms) |
| Sémaphore IA à 3 | 503 au-delà de 3 | **200×3 puis 503×5**, refus en 15 ms | ✅ exact, et **bien implémenté** (refus immédiat, pas d'empilement) |
| Mono-thread, opérations bloquantes | « gèle tout le serveur » | sonde /health à **115 / 218 / 485 ms** p95 selon la charge | ✅ **démontré** |
| Rate limiter à 10 req/s par IP | plafond par IP | **jamais atteint dans le test** (rafales < 600/min) | ✅ conforme, mais voir §5 (trou hors `/api`) |
| Capacité brute de la pile HTTP | « 1 000-3 000 req/s » | **1 200-1 700 req/s** | ✅ exact |

---

## 4. Le dommage collatéral, chiffré (c'est le résultat le plus important)

Pendant chaque scénario, une sonde indépendante appelait `GET /health` toutes les 200 ms. Résultat :

| Charge en cours | Latence de la sonde (p50 → p95) | Lecture |
|---|---|---|
| Lecture API (`projects-read`) | 18,6 → **115,4 ms** | déjà ×6 sur un endpoint trivial |
| Écriture (`projects-write`) | 18,6 → **217,9 ms** | un éditeur qui enregistre bloque les autres |
| Connexion (`auth-login`) | 18,4 → **484,7 ms** | ~10 connexions suffisent à rendre le Studio inutilisable |

**Conséquence pratique :** le serveur ne ralentit pas « un peu » sous charge — **il cesse de servir les autres clients**. Un seul utilisateur qui enregistre des fichiers ou se connecte dégrade l'expérience de tous les autres. C'est le comportement attendu d'un processus unique dont les opérations coûteuses (hachage, `fsync`, lecture de fichier) sont synchrones — et c'est désormais mesuré, plus déduit.

---

## 5. Nouveau constat issu de la mesure : aucun rate limiting hors `/api`

- `bundle-static` atteint **573 req/s sans un seul 429**, alors que `/api` est plafonné à 10 req/s.
- Cause (déjà lue dans le code) : `apps/api/src/server.ts` n'applique `checkRateLimit()` qu'aux chemins commençant par `/api`.

**Conséquence :** `/health`, `/metrics`, `/preview-builder/*`, `/preview-bundle/*` **et tous les fichiers statiques du Studio** (dont `index.html`, qui pèse des milliers de lignes) sont **non throttlés** — et ce sont précisément les chemins les plus lents (550 req/s contre 1 200-1 700/req/s pour `/health`). C'est donc la surface la plus facile à saturer, et elle est ouverte.

---

## 6. Corrections à apporter aux audits précédents

1. **`scrypt` est plus rapide que mon estimation** (≈30 ms par vérification, 35 connexions/s) — je corrige la fourchette « 50-100 ms / 15-20 par seconde ».
2. **Le DoS par rotation d'emails était surestimé** (le hachage n'a lieu que si l'email existe — déjà corrigé), mais l'**oracle de latence** d'énumération de comptes reste valide : mesurez vous-même la différence, elle est visible dans ce test (connexion sur email inexistant = réponse immédiate, sur compte réel = ~30 ms).
3. **Le plafond de lecture est plus élevé que craint** (900-1 700 req/s) : le serveur n'est pas « lent » en soi — il est **mal isolé** (mono-thread) et **pénalisé par ses écritures**.
4. **Nouveau** : l'absence de rate limiting hors `/api` (§5) — à ajouter à l'audit de sécurité comme constat de disponibilité.

---

## 7. Ce qu'il faut optimiser, par ordre de gain attendu

| Priorité | Action | Effet attendu (sur les mesures ci-dessus) | Effort |
|---|---|---|---|
| 1 | **Sortir la journalisation du chemin critique** (un `console.log` synchrone par requête aujourd'hui) : écriture asynchrone ou échantillonnée | gain sur **tous** les endpoints ; c'est le coût commun à chaque requête | S |
| 2 | **Cache mémoire + ETag + gzip pour les fichiers statiques** | le mur de 550 req/s remonte probablement au niveau des autres endpoints (×2 à ×3) | S |
| 3 | **Hachage asynchrone** (`crypto.scrypt` dans un pool) au lieu de `scryptSync` | supprime le gel : la sonde à **485 ms** devrait retomber sous ~30 ms | S |
| 4 | **Écritures différées / batchées** (ou journal append-only) au lieu de réécrire le document complet + `fsync` | débloque le plafond de **100 écritures/s** et sa dégradation avec le volume | M |
| 5 | **Rate limiting hors `/api`** (au minimum `/health`, `/metrics`, `/preview-builder`, `/preview-bundle`, statiques) | ferme le §5 | S |
| 6 | **Build Vite hors du processus** (cf. audit preview) | évite qu'une génération bloque tout le serveur | M |
| 7 | **Plusieurs instances + compteurs partagés** | dépasse la limite mono-thread (aujourd'hui toutes les limites d'état sont en mémoire) | L |

---

## 8. Limites de cette campagne (à lire avant de conclure)

1. **Client et serveur sur la même machine** : les deux se partagent les cœurs ; les chiffres sont une capacité **conjointe**, pas la capacité seule du serveur. Un client externe (autre poste ou conteneur) donnerait probablement des chiffres **plus élevés** sur `/health` et `projects-read`.
2. **Variance importante entre les deux campagnes identiques** : même endpoint, même palier → **515 vs 1 208 req/s** (×2,3) sur `projects-read` à concurrence 10. Toute valeur isolée est à ±2×, seules les **tendances** sont fiables.
3. **Jeu de données petit** : 0 → 120 projets créés puis supprimés (120/120 nettoyés). La **dégradation avec le volume** n'est pas mesurée, alors que la persistance réécrit tout le document à chaque écriture.
4. **Peu d'échantillons** : 110 requêtes par palier → les p99 sont indicatifs, pas statistiquement solides.
5. **Une seule IP** : le rate limiter (600/min) n'a jamais été testé à sa limite ; et les scénarios d'écriture/connexion n'ont pas créé de collision entre utilisateurs.
6. **Pas d'instrumentation serveur** : le gel de la boucle d'événements est **inféré** de la sonde, pas mesuré directement (`perf_hooks.monitorEventLoopDelay` le donnerait).
7. Les scénarios IA ont consommé du crédit réel (8 appels) et le compte de test créé pour la mesure du hachage **reste dans le document « users »** (à retirer si vous le souhaitez).

## 9. Ce qu'il reste à mesurer (si vous voulez aller plus loin)

1. **Le Studio lui-même** : `GET /` (la page `index.html`, plusieurs milliers de lignes, servie sans cache) — c'est le chargement de page réel, probablement le vrai plafond perçu.
2. **La dégradation par volume** : rejouer `projects-write` avec 1 000 puis 5 000 projets pour chiffrer la pente.
3. **Les flux SSE** (conversation) : coût des connexions longues et interaction avec le sémaphore.
4. **Un client externe** + **plusieurs IP** pour séparer la part client de la part serveur et tester le rate limiter à sa limite.
5. **Event-loop lag** côté serveur, pour chiffrer le blocage au lieu de l'inférer.
