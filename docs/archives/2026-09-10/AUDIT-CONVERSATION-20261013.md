# AUDIT — DOMAINE CONVERSATION (volaco-core)

**Date :** 13 octobre 2026 · **Périmètre :** route `/conversation/**` (`apps/api/src/routes/conversation.ts`, ~1 700 lignes), moteur `packages/core/src/ai-native/conversation-intelligence/**`, boucle d'outils `packages/core/src/ai/tool-loop.ts`, adaptateurs et comptabilité `packages/core/src/ai/**`, traces d'exécution (`ai-native/execution/store.ts`), branchement dans `server.ts`.
**Méthode :** lecture directe du code (audit read-only) + deux explorations parallèles ciblées ; **chaque constat lourd a été revérifié par mes soins** avant intégration.
**Constats :** **24** — **0 critique**, **7 élevés**, **12 moyens**, **5 faibles**.

**Marqueurs :** `[V]` vérifié par lecture directe · `[R]` rapporté puis revérifié · `[?]` rapporté, **non revérifié**.

---

## 0. Limites

- **Aucune exécution** (shell indisponible) : pas de test, pas de build, pas d'appel réel au fournisseur. Les comportements de facturation, de mémoire et de course sont **déduits du code**.
- Les **fichiers de tests** du domaine existent (listés en §8) mais leur **contenu n'a pas été lu de bout en bout** : aucune affirmation n'est faite sur ce qu'ils testent réellement.
- Le domaine « conversation » est le plus étendu du projet : cet audit couvre le chemin réel du Studio, pas l'exhaustivité de `ai-native/**`.

---

## 1. Verdict

Contrairement au preview, **le domaine conversation est le mieux construit des trois** : flux SSE avec battement de cœur, arrêt propre garanti, arrêt de la consommation du modèle quand le client part (économie de tokens), boucle d'outils bornée avec terminaison prouvée, isolation par locataire/projet, comptabilité d'usage honnête (aucun coût inventé), et une **consigne anti-injection explicite** dans le prompt système.

Ses faiblesses ne sont pas des trous béants mais trois familles de défauts : **des permissions trop laxistes** (écrire avec un droit de lecture), **des bornes manquantes** (tours de session, durée de flux, taille de contexte), et **des replis silencieux** (le simulateur peut se faire passer pour l'IA, l'annulation ne coupe pas vraiment l'appel).

| Domaine | État | Commentaire |
|---|---|---|
| Contrat SSE et fin de flux | 🟢/🟠 | `res.end()` **toujours** appelé en `finally` (`:1689-1693`) ; mais pas d'événement terminal unique (CV-08) |
| Économie de jetons (client parti) | 🟢 | `clientGone` coupe la consommation (`:1119`, `:1250`) — rare et bien vu |
| Permissions | 🔴 | Écrire dans le projet avec le seul droit de **lecture** (CV-01) |
| Bornes et anti-abus | 🟠 | Tours de session non plafonnés sur le chemin réel (CV-03), contexte non tronqué (CV-15) |
| Gestion d'échec | 🟠 | Repli silencieux sur textes pré-écrits (CV-05), erreur brute parfois renvoyée (CV-06) |
| Coût IA | 🟠 | 2 à 4 appels modèle par message, sans plafond de contexte (CV-15), sans retry (CV-17) |
| Mémoire / rétention | 🟠 | Plusieurs collections non bornées, pas de purge (CV-18, CV-19) |
| Qualité / code mort | 🟢/🟠 | Boucle d'outils exemplaire ; trois modules non branchés (CV-21) |

---

## 2. Cartographie du chemin réel

```
Studio ──POST /api/v1/projects/:id/conversation/sessions            → créer une session
       ──POST …/sessions/:sid/stream  (SSE, chemin principal)
       ──POST …/sessions/:sid/turns   (JSON, chemin moteur)
       ──POST …/sessions/:sid/confirm (approuver/rejeter un plan)
       ──POST …/sessions/:sid/execute (exécuter le plan approuvé)
       ──GET  …/conversation/memory   (mémoire projet)
       ──GET  …/sessions/:sid         (relecture d'une session)

Chemin SSE : classification d'intention → (plan si CREATE/MODIFY) → stream Mistral
             → assemblage du HTML → sauvegarde + révision → clôture LLM → done
Appels au modèle par message : 2 (réponse simple) · 3 (génération/modification)
                              · +1 sur /execute · +1 par itération d'outil (5 à 10)
```

---

## 3. Constats ÉLEVÉS

### CV-01 — Écrire dans le projet avec un simple droit de lecture `[R]`
`apps/api/src/routes/conversation.ts:526, 548, 565, 640` (turns, confirm, execute, stream) exigent **uniquement** `PROJECT_READ` ; or `VIEWER` possède exactement `PROJECT_READ` (`packages/core/src/identity/permissions.ts`). Le chemin stream **écrit** le fichier du projet : `conversation.ts:1443` — `fileStore.saveFile(context.tenantId, projectId, 'index.html', assembledHtml)` puis `createRevision` (`:1451`).

**Impact.** Un compte en lecture seule (ou un jeton partagé pour de la consultation) peut **modifier les fichiers d'un projet** et **consommer du crédit IA**. À comparer avec `agent-execution.ts:66/280`, qui exige correctement `PROJECT_MUTATE`.
**Correctif.** Exiger `PROJECT_UPDATE` (ou `PROJECT_MUTATE`) sur `turns`, `stream` et `execute` ; garder `PROJECT_READ` sur la lecture de session et la mémoire.

### CV-02 — `/execute` : génération complète en 15 secondes de budget (échec quasi certain) + aucune révision `[V]`
`conversation.ts:347-350` — `adapter.generate({ …, maxTokens: 8192 })` **sans `timeoutMs`** ; l'adaptateur applique alors son défaut : `mistral-adapter.ts:57` — `const timeoutMs = request.timeoutMs ?? 15000`. Puis `fileStore.saveFile(...)` (`:364`) **sans `createRevision`** (celui-ci n'existe que dans le flux stream, `:1451`).

**Impact.** Demander à un modèle de produire une application complète (jusqu'à 8 192 jetons) en **15 secondes** échoue presque systématiquement → l'utilisateur voit « exécution du plan » échouer, et **la fonctionnalité paraît cassée**. Quand elle réussit, la modification n'a **aucun retour arrière** (pas de révision).
**Correctif.** Passer `timeoutMs: 120000` (comme ailleurs), et créer une révision après l'écriture — la brique existe déjà.

### CV-03 — Aucun plafond de tours sur le chemin réel du Studio `[V]`
Le garde `maxTurnsPerSession` (50) n'existe que dans `processTurn` : `service.ts:441-443`. Le chemin utilisé par le Studio passe par `recordStreamTurn` (`service.ts:255-341`), qui **n'en a aucun** et fait `turns: [...session.turns, turn]` puis `persistSession(...)`.

**Impact.** Une session peut croître sans limite ; chaque tour est **réécrit en entier sur disque** (persistance synchrone, cf. audit backend) → dégradation progressive, et la session complète est renvoyée par `GET /sessions/:id` et `GET /conversation/memory`. Un client peut provoquer une croissance non bornée en bouclant.
**Correctif.** Appliquer le même plafond dans `recordStreamTurn`, et tronquer l'historique renvoyé.

### CV-04 — L'annulation ne coupe pas réellement l'appel au modèle `[V]` / `[?]` (facturation)
`conversation.ts:1119` sort de la boucle sur `clientGone || cancelFlag.cancelled`, mais l'adaptateur ne fait que `clearTimeout(timer)` dans son `finally` (`mistral-adapter.ts:455-457`) : **aucun `controller.abort()`**. Le commentaire du même fichier (`:457-459`) affirme que « le stream consommé partiellement est un appel réel incomplet » et enregistre un terminal `ABORTED` à **coût 0** — ce qui contredit l'hypothèse d'une coupure effective.

**Impact.** Une génération annulée peut continuer à consommer des jetons côté fournisseur pendant jusqu'à 120 s, tout en étant comptabilisée « coût 0 » : la comptabilité devient **fausse dans le sens favorable**, et la facture réelle dépasse le suivi. *(Le montant réel n'est pas vérifiable sans exécution.)*
**Correctif.** Appeler `controller.abort()` sur annulation/déconnexion (le `AbortSignal` existe déjà), et enregistrer `ABORTED` comme coût **inconnu** plutôt que nul.

### CV-05 — Le simulateur peut se faire passer pour l'IA `[V]` / `[?]` (exposition client)
`packages/core/src/ai-native/conversation-intelligence/provider/reasoning-provider.ts:31-36` renvoie des réponses **pré-écrites** (ex. « Plan d'ingénierie structuré élaboré pour satisfaire l'objectif : X. »). `LLMReasoningProvider` y bascule **silencieusement** sur toute erreur (timeout, JSON illisible, schéma invalide) — `llm-reasoning-provider.ts` (dernier `catch` → `return this.fallback.reason(request)`), et le serveur choisit ce chemin dès qu'aucune clé n'est configurée (`server.ts` bootstrap).

**Impact.** L'utilisateur — ou son client — peut recevoir une réponse **qui n'a pas été produite par une IA** sans aucun signe distinctif (le drapeau interne `fallbackUsed` n'est pas exposé dans le flux : `[?]`). C'est exactement le défaut qui avait déjà été signalé une première fois dans ce projet.
**Correctif.** Marquer explicitement le repli dans la réponse (`fallback: true` + raison courte) et l'afficher côté interface.

### CV-06 — Erreur technique brute renvoyée à l'utilisateur hors 401/403 `[V]`
`conversation.ts:1676-1688` : le message n'est remplacé par un texte actionnable que si `/HTTP\s*40[13]/` correspond ; **sinon** `emit({ type: 'error', error: message })` transmet le message brut du fournisseur (corps d'erreur Mistral, statut, détail interne).

**Impact.** Fuite d'informations d'implémentation vers l'interface, messages incompréhensibles pour l'utilisateur final. (Le chemin *streaming* n'ajoute pas l'indice de clé — voir §10 — mais le corps d'erreur du fournisseur peut contenir des détails de compte.)
**Correctif.** Toujours passer par un message utilisateur normalisé ; garder le détail dans les journaux.

### CV-07 — Indice de clé Mistral **persisté sur disque** `[V]`
`mistral-adapter.ts:143-145` construit l'indice (4 + 4 caractères + longueur) ; `mistral-adapter.ts:219` le transmet à la comptabilité ; `ai/usage.ts:126-146` (`recordAttempt`) écrit l'erreur dans le document `ai-usage`, persisté à chaque appel (`persist()`, `:65`, plafond 10 000 enregistrements).

**Impact.** Un fragment de la clé (8 caractères + longueur) reste **en clair sur le disque** et dans les journaux. Il n'est **pas** exposé par `GET /api/v1/ai/usage` (qui ne renvoie que des totaux — vérifié). Risque : lecture du fichier de données, sauvegardes, partage de diagnostic.
**Correctif.** Retirer l'indice (ou le remplacer par une empreinte non réversible), et purger les enregistrements anciens.

---

## 4. Constats MOYENS

| ID | Constat | Preuve | Correctif |
|---|---|---|---|
| CV-08 `[V]` | Pas de terminal unique : `done` est émis **avant** `closing` (`:1625` puis `:1668`) et **jamais** sur erreur/annulation (`catch` → `error` seul, `:1688`) — une interface qui « ferme » sur `done` perd la clôture et ne sait pas qu'un flux s'est terminé en erreur | `conversation.ts:1625, 1668, 1688` | Émettre un `done` (ou `failed`) unique en fin de `finally` |
| CV-09 `[V]` | Le battement de cœur SSE est créé **après** les sorties anticipées « question » et « plan-first » (`:1084-1088` vs `:848`, `:909`) : ces chemins peuvent attendre jusqu'à 60 s **sans un octet** → coupure par un intermédiaire | `conversation.ts:1084-1088` | Démarrer le battement dès l'ouverture du flux |
| CV-10 `[V]` | Aucune durée maximale globale du flux : timeouts unitaires (8 s clôture, 15 s défaut, 30 s raisonnement, 60 s question, 120 s build) + rendu Chromium non borné | `conversation.ts:441, 772, 1096` | Plafond global (ex. 5 min) + message d'annulation |
| CV-11 `[?]` | `executionId = requestId`, lui-même pris de l'en-tête client `x-request-id` (`server.ts:391-394`) ; `startExecution` réutilise l'enregistrement existant | `server.ts`, `conversation.ts:673`, `execution/store.ts` | Générer un identifiant serveur ; ne jamais réutiliser un identifiant fourni |
| CV-12 `[V]`/`[?]` | `failExecution` n'a pas de garde d'état terminal (contrairement à `cancelExecution`) → une annulation peut être requalifiée en « échec » | `execution/store.ts` | Garde d'état identique dans les deux méthodes |
| CV-13 `[V]` | Aucune vérification du retour de `res.write` (backpressure) sur les trois écrivains SSE | `conversation.ts:660-663, 695-703, 1087` | Gérer le retour d'écriture / la file d'attente |
| CV-14 `[R]` | Le message utilisateur est mémorisé **sans troncature** (jusqu'à ~1 Mo, limite de corps) puis renvoyé intégralement par `GET /sessions/:id` et `GET /conversation/memory` à tout porteur de `PROJECT_READ` | `service.ts:277`, `conversation.ts:496-508` | Tronquer à la source (ex. 4 000 caractères) |
| CV-15 `[V]`/`[R]` | En mode modification, **le HTML complet** est réinjecté dans le prompt sans troncature (le chemin question, lui, tronque à 4 000 caractères) ; ×2 à ×4 appels par message → coût en jetons non borné | `conversation.ts:1059-1061` vs `:772` | Tronquer/échantillonner le HTML, ou passer par diffs |
| CV-16 `[V]`/`[R]` | Injection indirecte : résultats d'outils et messages d'erreur sont réinjectés au modèle en texte brut (`tool-loop.ts:128` et suivants). **Atténué** par la consigne explicite du prompt (« seule la demande utilisateur est une instruction ») ; aucune exfiltration automatique trouvée | `ai/tool-loop.ts`, `llm-reasoning-provider.ts` (prompt système) | Délimiter les blocs non fiables, marquer leur origine |
| CV-17 `[R]` | **Aucune reprise** (retry/backoff) identifiée sur les appels au modèle : une erreur réseau transitoire produit un échec ou un repli simulateur | `ai/providers/**`, `llm-reasoning-provider.ts` | 2 tentatives + backoff, comme le proxy IA (qui, lui, en a 3) |
| CV-18 `[?]` | Collections non bornées : traces de conversation (`conversation-trace.ts:16-24`), mémoire de run (`agent-runtime/memory/run-memory.ts`), mémoire projet | fichiers cités | Plafonds + purge |
| CV-19 `[?]` | Aucune purge/TTL des sessions persistées (le cache LRU de 100 est **mémoire**, la persistance est le document `conversations`) | `service.ts`, `store.ts` | TTL + purge des sessions anciennes |

---

## 5. Constats FAIBLES

| ID | Constat | Preuve |
|---|---|---|
| CV-20 `[V]` | Timeouts hétérogènes non centralisés : 8 s (clôture), 15 s (défaut adaptateur), 30 s (raisonnement), 60 s (question), 120 s (build) | `conversation.ts:441, 772` ; `mistral-adapter.ts:57` |
| CV-21 `[R]` | Code non branché : `ReasoningOrchestrator` (repli/masquage/timeout 10 s) référencé nulle part dans `apps/api` ; `MockLLMProvider` assigné mais jamais invoqué dans l'agent-runtime ; `maxHistoryMessages` inutilisé ; garde « inatteignable » défensive | `ai/providers/reasoning-orchestrator.ts:116`, `agent-runtime/service.ts:132-135`, `tool-loop.ts:168` |
| CV-22 `[R]` | Frames SSE sans `id:`/`retry:`, pas de reprise `Last-Event-ID` : une coupure réseau perd des jetons sans rattrapage, alors que les événements sont persistés côté serveur | `conversation.ts:660-663` |
| CV-23 `[R]` | La « dernière session » (donc la mémoire réinjectée) est choisie par **comparaison lexicographique** d'identifiants, pas par horodatage | `service.ts:228-246` |
| CV-24 `[V]` | Contrat SSE non typé (`Record<string, unknown>`, ~18 types de frames, double convention `event:` + `type`) : aucune détection automatique d'une divergence client/serveur | `conversation.ts:660, 688-703` |

---

## 6. Coût réel d'une conversation (multiplicateur de facture)

| Action utilisateur | Appels au modèle | Remarque |
|---|---|---|
| Question / explication (stream) | **2** | classification + flux de réponse |
| Création ou modification (stream) | **3** | classification + sections + clôture rédigée |
| `/execute` (plan approuvé) | **+1** | génération complète… avec 15 s de budget (CV-02) |
| Boucles d'outils (`app-generate`, `app-edit`, réparation) | **+1 par itération** | 5 par défaut, 8 à 10 sur les chemins d'édition |
| Run de l'agent-runtime | **0** | aucun appel réel (CV-21) |

**Autrement dit :** un simple « bonjour » peut coûter **2 appels** au modèle, et une demande de génération peut en enchaîner **plus de 10** — sans plafond de contexte (CV-15) et sans reprise (CV-17). C'est le poste de dépense à surveiller en premier quand la plateforme s'ouvrira.

---

## 7. Points positifs vérifiés (à préserver)

- **Fin de flux garantie** : `res.end()` dans un `finally` unique (`conversation.ts:1689-1693`) — contrairement au preview, un flux SSE se termine **toujours**.
- **Économie de jetons** : `clientGone` détecté et consommation du modèle interrompue (`:1119`) ; en cas de déconnexion, **aucun HTML partiel n'est sauvegardé** (`:1247-1253`, commentaire explicite) — protection de l'intégrité des fichiers.
- **Battement de cœur** SSE configurable (15 s, `VOLACO_SSE_HEARTBEAT_MS`) et « provider en attente » signalé toutes les 2 s (`:1084-1102`) : bonne expérience utilisateur.
- **Boucle d'outils exemplaire** (`ai/tool-loop.ts`) : nombre d'itérations borné, **dernier appel sans outils** (terminaison prouvée), résultats tronqués, erreurs renvoyées au modèle au lieu d'être levées, trace complète, coût cumulé.
- **Annulation** vérifiée à chaque morceau de flux (`:1119`) et drapeau nettoyé dans **tous** les chemins de sortie.
- **Garde d'entrée** stricte : projet vérifié par le registre du locataire avant tout traitement (`:469-485`), rôle contrôlé sur chaque endpoint.
- **Isolation** par clé `${tenantId}:${projectId}:${sessionId}` ; exécutions filtrées par locataire (`executions.ts:68-80`).
- **Comptabilité d'usage honnête** : START/SUCCESS/ERROR/ABORTED, **aucun coût inventé**, jamais bloquante (`ai/usage.ts`).
- **Consigne anti-injection explicite** dans le prompt système : les sections de contexte sont déclarées « de la RÉFÉRENCE », seule la demande utilisateur est une instruction.
- **Plan-first** : le plan est exposé avant confirmation, puis confirmé explicitement (`/confirm`, `/execute`).
- **Révision automatique** après chaque génération par le flux (`:1451`) — retour arrière possible sur ce chemin.
- Masquage des en-têtes (`Bearer ***`), message 401 actionnable, `temperature: 0` sur la classification.

---

## 8. Couverture de tests (état honnête)

**Fichiers identifiés** (contenu non vérifié de bout en bout) : `apps/api/tests/{conversation-shell, conversation-question-planfirst, plan-first-api, closing-synthesis, execution-events, p5-concurrency, ai-attempt-tracking}.test.ts`, `packages/core/tests/ai/{tool-loop, providers, tool-calling}.test.ts`, `packages/core/tests/ai-native/conversation-intelligence/conversation-intelligence.test.ts`, `packages/core/tests/ai-native/agent-runtime/{agent-runtime, orchestrator-dag}.test.ts`.

**Non couvert, à ma connaissance :** le plafond de tours sur le chemin stream (CV-03), le timeout de `/execute` (CV-02), la permission d'écriture (CV-01), la reprise après annulation (CV-04), et le contrat SSE côté client (CV-24). → **à traiter dans la même passe** que les correctifs.

---

## 9. Non vérifiable sans exécution

1. Facturation réelle des appels annulés (CV-04) et consommation réelle de jetons par message.
2. Exposition effective du drapeau de repli jusqu'à l'interface (CV-05).
3. Courses d'exécution (CV-11, CV-12) et sémantique exacte de `req.on('close')` selon la version de Node.
4. Couverture et validité des tests listés en §8.
5. Toute mesure de latence ou de débit du chemin conversationnel (le coût dominant étant la latence du fournisseur).

---

## 10. Corrections apportées aux audits précédents

1. **SEC-07 (indice de clé) — précisé.** L'indice n'est ajouté que dans le chemin **non streaming** (`mistral-adapter.ts:143-145`) ; le chemin **streaming** de la conversation ne l'ajoute pas (`:359-360`). Il atteint donc : les journaux, le **disque** (`ai-usage`), les routes de génération/édition, et le chemin `/execute` (qui utilise `generate`). Il ne part **pas** dans les jetons de réponse du chat.
2. **Constat CV1-18 du sous-audit — réfuté.** `apps/api/src/routes/executions.ts:68-71` vérifie bien `projectStore.getProject(context.tenantId, projectId)` avant toute lecture, et la liste est filtrée par locataire **et** projet (`:102`). Aucun accès croisé entre projets du même locataire sur ces routes. Constat écarté.

---

## 11. Plan correctif priorisé

**P0 — sécurité et corrections bloquantes (quelques heures)**
1. CV-01 : exiger `PROJECT_UPDATE`/`PROJECT_MUTATE` sur `turns`, `stream`, `execute`.
2. CV-02 : `timeoutMs: 120000` sur `/execute` **et** création d'une révision après écriture.
3. CV-07 : retirer l'indice de clé (journalisation par empreinte non réversible).
4. CV-03 : appliquer `maxTurnsPerSession` dans `recordStreamTurn` + troncature en sortie.

**P1 — fiabilité et coût (1 à 2 jours)**
5. CV-04 : `controller.abort()` à l'annulation + coût « inconnu » au lieu de 0.
6. CV-05 : marquer visiblement le repli simulateur.
7. CV-06 : normaliser tous les messages d'erreur client.
8. CV-09/CV-08 : battement de cœur dès l'ouverture ; événement terminal unique.
9. CV-15 : troncature du HTML réinjecté ; CV-17 : reprise avec backoff.

**P2 — durée de vie (1 semaine)**
10. CV-11/CV-12 : identifiants d'exécution générés côté serveur + gardes d'état.
11. CV-18/CV-19 : plafonds et purge (traces, sessions, mémoires).
12. CV-14 : ne pas conserver les messages longs ; CV-24 : typer le contrat SSE et le tester (client + serveur).

---

## 12. Avertissement opérationnel pour la mise en ligne

Deux points de ce domaine **changent ton plan de déploiement** :

1. **Cloudflare coupe les requêtes à 100 secondes** (offre gratuite et la plupart des offres). Or une génération peut durer **120 s** (build) voire plus, et le chemin « question » peut rester **60 s sans émettre un octet** (CV-09, battement de cœur absent sur cette branche). Résultat probable : des erreurs `524` sur les générations longues **si l'accueil Nginx/Cloudflare n'est pas configuré pour le streaming** — ce que fait déjà `deploy/nginx.conf` (pas de tampon, délais longs), mais Cloudflare reste la limite dure.
2. **Conséquence pratique :** commence par tester **directement sur le VPS** (port 3000 exposé temporairement, comme prévu à l'étape 9 du guide), puis ajoute Cloudflare **après** avoir vérifié qu'une génération complète passe. Sinon tu attribueras à ton serveur un échec qui vient de l'intermédiaire.
