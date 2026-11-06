# Banc de mesure backend — méthode et estimation de saturation (12 octobre 2026)

## 0. Ce que je peux faire ici, et ce que je ne peux pas

- **Je ne peux pas exécuter le test** : dans cette session, l'exécution shell est indisponible (les commandes ne s'exécutent pas, vérifié à plusieurs reprises). Je ne peux donc ni lancer le serveur, ni générer de la charge, ni même écrire un fichier via un script.
- **Ce que je fournis** : (a) le **modèle de saturation déduit du code**, goulot par goulot, avec les plafonds réellement codés ; (b) la **méthode de mesure** et le banc de charge à lancer de votre côté.
- **Aucune mesure ci-dessous n'est expérimentale** : ce sont des plafonds de conception et des ordres de grandeur, pas des relevés. Ils sont volontairement donnés en fourchettes.

---

## 1. Les plafonds réellement codés (avant toute question de performance)

| Goulot | Plafond | Ce que ça veut dire concrètement | Preuve |
|---|---|---|---|
| Rate limiter API | **600 requêtes/minute par IP** (fenêtre fixe de 60 s) | **10 req/s soutenu**, ou 600 en rafale puis 429 pendant le reste de la minute | `apps/api/src/server.ts` — `RATE_LIMIT_API_MAX = 600`, `checkRateLimit()` |
| Rate limiter IA | **60/minute par IP** | 1 req/s sur le proxy IA | `apps/api/src/server.ts` — `RATE_LIMIT_AI_MAX = 60` |
| Sémaphore IA | **3 simultanés** (`VOLACO_MAX_CONCURRENT_AI`, ajustable) | la 4ᵉ génération reçoit **503 AI_BUSY** + `Retry-After` | `apps/api/src/server.ts` — `tryAcquireAiSlot()` |
| Taille de corps | 1 Mo (sauf `/api/v1/mcp/call`, non borné) | les requêtes volumineuses sont refusées en 413 | `apps/api/src/middleware/body.ts` |
| Verrouillage connexion | 5 échecs/minute par couple **IP + email** | freine la force brute, mais pas le coût CPU global | `apps/api/src/routes/auth.ts` |
| Processus | **mono-processus, mono-thread** (aucune clusterisation) | tout est séquentiel : une opération bloquante gèle **tout le serveur** | `apps/api/src/server.ts` |

**Conséquence immédiate :** quel que soit le matériel, **une même adresse IP ne peut pas dépasser 10 requêtes/s** sur `/api` et 1 req/s sur l'IA. Si vos utilisateurs arrivent derrière un reverse proxy, un VPN ou le même réseau (cas courant en local), **ils partagent ce plafond**.

---

## 2. Les goulots de traitement (ce qui casse en premier)

| Goulot | Nature | Plafond théorique | Preuve |
|---|---|---|---|
| Journalisation | **une écriture synchrone par requête** (stdout redirigé vers `server.log`) sur le chemin critique | quelques milliers de req/s au mieux ; s'effondre si le disque ralentit | `packages/core/src/logger.ts` (`console.log` par entrée) + `server.ts` (un `logger.info` par requête) |
| Écritures de données | **réécriture complète du document JSON + `fsync`** à chaque mutation ; l'audit réécrit jusqu'à 5 000 événements, le VFS réécrit **tous les projets de tous les locataires** | **100 à 500 écritures/s** au mieux, en baisse proportionnelle au volume de données | `persistence/json-disk-cache.ts`, `observability/audit.ts`, `file-explorer/store.ts` |
| Authentification | **`scryptSync` bloquant** (~50 à 100 ms par vérification) — et seulement **si l'email existe** | **~15 à 20 connexions/s maximum**, puis gel total (tout le serveur attend le hachage) | `packages/core/src/identity/user-store.ts` |
| Fichiers statiques | `readFileSync` **à chaque requête**, aucun cache, aucune compression ; la page du Studio dépasse 14 000 lignes | quelques centaines de req/s | `server.ts` (service statique), taille de `apps/studio/index.html` |
| Rendu headless | **un lancement de Chromium par rendu**, jusqu'à 4-5 par appel de réparation, sans plafond de concurrence visible | coût machine direct, non borné | `real-renderer.ts`, `routes/repair.ts` |
| Générations IA | un slot occupé pendant **toute** la durée du flux SSE | 3 en parallèle, puis 503 | `server.ts`, `routes/conversation.ts` |

**Effet de bord mesurable :** comme tout est mono-thread, une seule opération bloquante (commande terminal synchrone, hachage, écriture disque, build Vite) **gèle les autres clients** — c'est le « dommage collatéral » que le banc mesure avec sa sonde.

---

## 3. Estimation par profil d'usage (réponse à « à combien d'utilisateurs/seconde »)

⚠️ Ordres de grandeur déduits du code, **pas** des mesures. À confronter au banc (§5).

| Profil d'usage | Charge d'un utilisateur actif | Saturation estimée | Ce qui casse |
|---|---|---|---|
| **Navigation / consultation** (Studio, projets, fichiers) | 1 à 3 req/s, avec rafales | **10 req/s par IP** (plafond politique) → **5 à 10 utilisateurs simultanés par IP** ; la capacité machine, elle, se situe plutôt vers **1 000 à 3 000 req/s** sur un poste récent | d'abord le 429 (politique), ensuite la journalisation synchrone |
| **Édition / écriture** (fichiers, révisions, sections) | 1 à 3 écritures/s | **100 à 500 écritures/s** au total, **en baisse à mesure que les données grossissent** | réécriture complète + `fsync` par mutation ; latences en escalier |
| **Connexion / inscription** | rare, mais coûteuse | **15 à 20 par seconde maximum**, puis **gel total** du serveur | `scryptSync` bloquant ; en plus, 5 tentatives/minute par couple IP+email |
| **Génération IA** | 1 appel long (secondes à dizaines de secondes) | **3 simultanées** (503 au-delà), **60/minute par IP** | sémaphore IA |
| **Rendu headless / réparation** | 1 Chromium par appel | quelques appels concurrents suffisent à saturer le poste | aucun plafond visible |
| **Flux SSE** (conversation) | 1 connexion longue par session | dépend des slots IA, pas du nombre de connexions | sémaphore IA |

**Lecture synthétique :**

- **En usage mono-utilisateur local (votre cas aujourd'hui) : vous êtes autour de 1 à 5 % de la capacité.** Aucune saturation à craindre.
- **Pour plusieurs utilisateurs simultanés**, l'ordre des murs est : **(1)** le plafond de 10 req/s par IP — beaucoup plus bas que la capacité réelle de la machine ; **(2)** le hachage bloquant dès ~15-20 connexions/s ; **(3)** les écritures synchrones dès quelques centaines par seconde, en se dégradant avec le volume ; **(4)** le sémaphore IA à 3 générations.
- **Si vous voulez encaisser du débit**, le levier n'est pas le matériel mais le code : journalisation asynchrone, écritures différées/batchées, hachage asynchrone, et — pour aller au-delà d'un processus — plusieurs instances derrière un répartiteur (les compteurs de limitation et le sémaphore étant aujourd'hui **en mémoire**, ils seraient à externaliser).

---

## 4. Deux découvertes à intégrer à l'audit (faites en préparant le banc)

1. **Le hachage n'a lieu que si l'email existe** : la vérification des identifiants retourne immédiatement quand l'email est inconnu, **avant** tout calcul `scrypt` (`identity/user-store.ts`). Deux conséquences :
   - le déni de service par rafale de hachages est **plus étroit** que ce que j'avais écrit dans l'audit de sécurité (il faut connaître un email valide, et le verrouillage par IP+email limite à 5 essais/minute) — je corrige ce point : la sévérité du volet « DoS CPU par rotation d'emails » est **surestimée** ;
   - en revanche cela crée un **oracle de temps** : email inconnu → réponse quasi immédiate ; email connu → réponse ~50-100 ms plus tard. **Énumération des comptes par mesure de latence**, à ajouter aux constats (niveau moyen), en complément du message « Un compte existe déjà pour cet email » renvoyé par l'inscription.
2. **Le plafond de 600 req/min n'est pas configurable** (constante en dur) : impossible de le relever par variable d'environnement pour un test de charge — le banc doit donc travailler **par rafales inférieures à 600 requêtes par minute et par IP**, sinon il mesure le 429 et non la capacité.

---

## 5. Comment mesurer réellement (méthode et interprétation)

**Protocole recommandé** (le banc proposé l'applique) :
1. démarrer le serveur sur `127.0.0.1` (`start-vibecode.ps1` ou `npm start`) ;
2. relever d'abord ce qui est **déjà cassé** : `npm run typecheck` et `npm test` (je n'ai pas pu les lancer) — un socle rouge fausserait la lecture ;
3. par scénario : **rafale de N requêtes** (N × paliers < 600 par minute) à concurrence croissante (1, 10, 50, 100), en attendant 61 s entre deux scénarios pour réinitialiser la fenêtre ;
4. mesurer **p50 / p95 / p99 / débit**, et surtout **la latence d'une sonde concurrente** (`GET /health` toutes les 200 ms) : c'est elle qui révèle le blocage des autres clients ;
5. relever `/api/v1/metrics` avant/après (compteurs et mémoire).

**Grille de lecture :**
- **le débit cesse de progresser** quand la concurrence augmente → saturation atteinte ;
- **p95 qui explose** (> 5× le p95 à concurrence 1, ou > 100 ms) → file d'attente = traitement séquentiel ;
- **429** → vous mesurez le plafond politique, pas la capacité : recommencez sur une autre minute ;
- **503** → plafond de concurrence IA atteint ;
- **sonde qui monte pendant une charge d'écriture ou d'authentification** → confirmation du blocage mono-thread.

**Pour aller plus loin (au-delà du banc maison) :** un outil dédié (k6, autocannon) lancé depuis une **autre machine ou un conteneur** permet de dépasser le plafond par IP ; et l'instrumentation `perf_hooks.monitorEventLoopDelay()` côté serveur donnerait la mesure directe du gel de la boucle d'événements.

---

## 6. Limites de cette estimation

1. **Aucune mesure** : tout ce document est déduit du code, pas observé (exécution impossible ici).
2. Les ordres de grandeur de capacité brute (1 000-3 000 req/s, 100-500 écritures/s) dépendent fortement du disque (SSD/NVMe), de l'antivirus Windows et du volume de données déjà stocké.
3. Les scénarios d'écriture réels dépendent de la taille du document de données : plus vous avez de projets/événements, plus chaque écriture coûte cher — un banc sur une base vide **surestime** la capacité.
4. Le banc ne mesure pas les coûts externes (latence du fournisseur IA, temps de build Vite, lancement de Chromium), qui dominent leurs scénarios respectifs.
