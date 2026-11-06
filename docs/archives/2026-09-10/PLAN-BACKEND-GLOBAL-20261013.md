# PLAN GLOBAL BACKEND — corrections et ajouts

**Date :** 13 octobre 2026 · **Projet :** volaco-core
**Sources :** audit backend/sécurité (`AUDIT-BACKEND-SECURITE-20261012.md`), audit du preview (`AUDIT-PREVIEW-20261012.md`), audit de la conversation (`AUDIT-CONVERSATION-20261013.md`), campagne de charge (`BENCH-RESULTATS-MESURES-20261013.md`), plan d'architecture (`ARCHITECTURE-QUI-ENCAISSE-20261013.md`), paquet de déploiement (`deploy/`).

**Périmètre :** serveur d'API, persistance, build et service des applications générées, moteur conversationnel, sécurité, outillage.
**Hors périmètre :** l'interface du Studio (sauf sa taille et sa mise en cache), le design, et le produit « environnement d'exécution » — regroupé dans le **LOT 7**, qui est un chantier à part.

**Comment lire ce plan :** chaque ligne est un travail vérifiable. Un lot n'est **terminé** que lorsque son **critère d'acceptation** est mesuré — pas quand le code est écrit. Chaque lot suit ta méthode : BUILD → TEST → AUDIT → VALIDATE → FREEZE.

**Effort :** S = moins d'une journée · M = 1 à 3 jours · L = chantier (1 semaine et plus).

---

## 0. État des lieux (ce que les mesures disent)

| Domaine | Verdict mesuré |
|---|---|
| Débit de lecture | **1 200 à 1 700 req/s** — correct |
| Fichiers statiques | **550 req/s** — premier mur |
| Écritures | **100/s** — deuxième mur, et il se dégrade avec le volume |
| Connexions | **35/s**, mais **gèle tout le serveur** (sonde : 18 → 485 ms) |
| Générations IA | 3 en parallèle, refus propre — bien conçu |
| Données | un fichier réécrit **en entier** à chaque écriture ; corruption ⇒ effacement silencieux |
| Sécurité | 3 critiques + 6 élevés **ouverts** (lecture de fichiers, SSRF, RCE terminal, auth non appliquée) |
| Honnêteté de l'état | générations fantômes après redémarrage, éditions écrasées en silence, repli simulateur invisible |

**Conclusion :** le backend n'est pas lent, il est **mal isolé**, **fragile en écriture**, et **pas encore sûr**. Les lots ci-dessous traitent ces trois points dans cet ordre.

---

## LOT 0 — Fermer l'exposition

**Objectif :** pouvoir mettre le serveur en ligne sans risquer tes clés ni tes données.
**Effort total :** ~3 jours · **Prérequis :** aucun.

| # | Travail | Réf. | Effort |
|---|---|---|---|
| 1 | Authentification obligatoire par défaut (hors connexion/inscription et santé) | SEC-04 | S |
| 2 | Retirer l'exécution de scripts de projet du terminal (elle permet d'exécuter du code arbitraire) | SEC-03 | S |
| 3 | Valider l'identifiant de projet **avant** tout appel MCP (lecture de fichiers hors projet) | SEC-01 | S |
| 4 | Vérifier l'appartenance au locataire sur `/app/*` et `/preview-bundle`, et étendre le garde-fou d'authentification à ces chemins | PV-02 | M |
| 5 | Sortir le contenu généré de l'origine du Studio (ne plus l'ouvrir en onglet, retirer la clé IA du navigateur) | PV-01, SEC-08 | M |
| 6 | Contrôle d'origine sur les requêtes qui modifient (fin du déclenchement depuis un site tiers) + exiger le type JSON | SEC-05 | S |
| 7 | Navigateur headless : liste d'hôtes autorisés + sandbox réactivé | SEC-02, PV-07 | M |
| 8 | Rendu : ne plus construire l'URL depuis l'en-tête fourni par le client | SEC-06 | S |
| 9 | Appliquer le correctif d'adresse réelle (derrière l'accueil/Cloudflare) | ADD-01 (`PATCH-IP-REELLE.md`) | S |
| 10 | Retirer l'indice de clé des erreurs et du disque | SEC-07, CV-07 | S |
| 11 | Exiger le droit d'**écriture** sur les routes de conversation qui modifient le projet | CV-01 | S |
| 12 | Régénérer la clé Mistral et nettoyer les copies anciennes du dépôt | SEC-14 | S (toi) |

**Critère d'acceptation :** sans jeton, **tout** `/api` répond 401 ; le contenu généré ne peut plus lire le jeton ni la clé ; un scan de secrets ne trouve rien dans le dépôt ; `npm test` est refusé par le terminal ; deux appareils simultanés ne se bloquent pas mutuellement.

---

## LOT 1 — Rendre le backend honnête

**Objectif :** que le serveur ne mente jamais — ni sur son état, ni sur ce qu'il facture, ni sur ce qu'il a perdu.
**Effort total :** ~1 semaine.

| # | Travail | Réf. | Effort |
|---|---|---|---|
| 13 | Refuser de démarrer si un document de données est illisible ; copie de sécurité avant chaque écriture ; afficher le système de stockage actif dans `/health` | ADD-02 | S |
| 14 | Arrêt propre + balayage au démarrage des exécutions interrompues (« échec — serveur redémarré » au lieu de « en cours ») | ADD-03 | M |
| 15 | Cesser d'avaler les erreurs fatales : laisser le processus mourir, le superviseur le relance | ADD-04 | S |
| 16 | Clé d'idempotence sur les actions qui modifient + contrôle d'empreinte sur les écritures de fichiers (fin des écrasements silencieux) | ADD-05 | M |
| 17 | `/execute` : budget de temps réaliste (120 s) + création d'une révision après écriture | CV-02 | S |
| 18 | Plafond de tours appliqué aussi au chemin réel du Studio + troncature des messages conservés | CV-03, CV-14 | S |
| 19 | Annulation : couper réellement l'appel au modèle ; coût « inconnu » au lieu de zéro | CV-04 | S |
| 20 | Marquer visiblement les réponses du simulateur (et l'indiquer dans l'interface) | CV-05 | S |
| 21 | Messages d'erreur utilisateur normalisés (plus d'erreur brute du fournisseur) | CV-06 | S |
| 22 | Plafond de dépense IA par jour et par locataire, avec refus explicite | ADD-06 | M |
| 23 | Rétention et rotation (audit, usage, traces, sessions) | ADD-07 | S |
| 24 | Rotation des journaux du serveur | ADD-08 | S |

**Critère d'acceptation :** redémarrer en pleine génération → l'exécution est marquée interrompue, l'interface ne tourne plus dans le vide ; un document corrompu **empêche** le démarrage avec un message clair ; un double-clic ne double pas la facture ; une modification concurrente est **refusée** au lieu d'être perdue ; le plafond de dépense se déclenche sur un test de boucle.

---

## LOT 2 — Les gains de performance mesurés

**Objectif :** supprimer les trois causes identifiées par la campagne de charge.
**Effort total :** ~1 semaine.

| # | Travail | Effet attendu (mesuré) | Effort |
|---|---|---|---|
| 25 | Sortir la journalisation du chemin critique (écriture asynchrone ou échantillonnée) | gain sur **tous** les endpoints (aujourd'hui : 1 écriture disque synchrone par requête) | S |
| 26 | Hachage asynchrone (au lieu de bloquer le serveur ~30 ms par connexion) | le gel des autres clients retombe de **485 ms à ~30 ms** | S |
| 27 | Cache + compression pour les fichiers statiques (+ empreinte de version) | le mur de **550 req/s** passe au niveau des autres endpoints | S |
| 28 | Mesure interne de l'engorgement (boucle d'événements) + histogramme par route dans `/metrics` | l'engorgement devient **visible** au lieu d'être déduit | S |
| 29 | Limitation par route (connexion, génération, lecture) + journal des refus (401/403/429) | fin du réglage unique trop mou partout | M |
| 30 | Commandes externes asynchrones + plafond de temps imposé par le serveur | plus de gel sur une commande longue | M |

**Critère d'acceptation :** rejouer le banc → la sonde concurrente reste **sous ~50 ms** pendant les écritures et les connexions ; le débit statique dépasse **1 500 req/s** ; `/metrics` expose l'engorgement.

---

## LOT 3 — La persistance (le vrai plafond)

**Objectif :** passer de « un fichier réécrit en entier » à « on écrit seulement ce qui change ».
**Effort total :** 2 à 4 semaines · **C'est le lot qui débloque la montée en charge.**

| # | Travail | Effort |
|---|---|---|
| 31 | Base de données, avec migration des documents actuels (utilisateurs, projets, fichiers, révisions, audit, usage IA, sessions, exécutions) | L |
| 32 | Migrations versionnées + sauvegarde automatique + **restauration testée** | M |
| 33 | Plafonds du système de fichiers virtuel, resynchronisation disque sur déplacement, lecture sans effet de bord (fin des projets fantômes) | PV-17 | M |
| 34 | Identité de l'utilisateur dans le contexte + audit qui dit **qui** a fait quoi | SEC-11 | S |
| 35 | Jetons courts + révocation | SEC-19 | M |

**Critère d'acceptation :** rejouer le banc avec **5 000 projets** → aucune dégradation du débit d'écriture ; **≥ 1 000 écritures/s** ; le journal d'audit nomme une personne ; restauration testée sur un jeu réel.

---

## LOT 4 — Découplage et montée en charge

**Objectif :** que la capacité devienne une question de **nombre de serveurs**, pas de code.
**Effort total :** 3 à 6 semaines.

| # | Travail | Effort |
|---|---|---|
| 36 | File d'attente (Redis) + **3 files** : action rapide / génération complète / déploiement, avec limite de concurrence par fournisseur | L |
| 37 | Travaux **détachables** : identifiant de tâche consultable — fermer l'onglet n'annule plus la génération | M |
| 38 | Sortir du processus d'API : compilation, navigateur d'aperçu, appels aux modèles (ouvriers dédiés) | L |
| 39 | Compteurs partagés (limites + sémaphore IA hors mémoire) → **plusieurs instances** du serveur derrière l'accueil | M |
| 40 | Build atomique (répertoire versionné + bascule) : plus jamais de preview vide après un échec | PV-06 | S |

**Critère d'acceptation :** 3 instances tournent simultanément ; une génération lourde ne change **pas** la latence des lectures ; fermer puis revenir donne le résultat ; un build échoué laisse le **dernier bundle valide** en place.

---

## LOT 5 — Contrat, qualité, outillage

**Objectif :** que les erreurs se détectent **avant** tes utilisateurs.
**Effort total :** ~1 semaine.

| # | Travail | Effort |
|---|---|---|
| 41 | Intégration continue : vérification des types, tests, audit des dépendances, scan de secrets | ADD-19 | S |
| 42 | Test de charge automatique **avec seuils** (échec si le p95 se dégrade) | ADD-20 | S |
| 43 | Contrat d'API écrit + tests de contrat sur les événements temps réel | ADD-21 | M |
| 44 | Un **seul** format de réponse d'erreur + catalogue de codes | ADD-22 | S |
| 45 | Pagination des listes (projets, révisions, historique, audit, exécutions) | ADD-23 | M |
| 46 | Tests aléatoires des analyseurs (chemins, sections, événements) — c'est là que j'ai trouvé le plus de bugs | ADD-24 | M |
| 47 | Script de vérification « fumée » : 10 chemins critiques sur des données jetables | ADD-25 | S |
| 48 | Gardes d'état des exécutions + identifiants générés par le serveur | CV-11, CV-12 | S |
| 49 | Retour de pression sur les flux temps réel + troncature du contexte envoyé au modèle | CV-13, CV-15 | S |
| 50 | Reprise (nouvelle tentative + délai croissant) sur les appels aux modèles | CV-17 | S |
| 51 | Modèle léger pour classer, modèle fort pour générer + réutilisation du contexte | ADD-26 | M |

**Critère d'acceptation :** un envoi de code qui casse un test **ne passe pas** ; une baisse de performance **ne passe pas** ; le format d'erreur est identique partout ; la facture par message baisse (mesurable dans l'usage) ; le **coût par utilisateur actif** est exposé en continu.

---

## LOT 6 — Préparer l'ouverture à d'autres

**Effort total :** 2 à 3 semaines.

| # | Travail | Effort |
|---|---|---|
| 52 | Mode « prudence » par réglage : couper terminal, génération et MCP sans recompiler | ADD-27 | S |
| 53 | Invitations / membres par projet (ou assumer explicitement « un compte = un monde ») | ADD-28 | M |
| 54 | Réinitialisation de mot de passe | ADD-29 | M |
| 55 | Export d'un projet (archive avec son historique) | ADD-30 | M |
| 56 | Quotas, facturation et séparation des coûts par compte | ADD-31 | L |

**Critère d'acceptation :** tu peux inviter un testeur avec un rôle limité ; il récupère son compte après un oubli ; tu sais ce que chaque compte consomme ; un utilisateur peut partir avec son travail.

---

## LOT 7 — Chantier séparé : l'environnement d'exécution

**Condition d'ouverture au public inconnu. À ne pas mélanger avec les lots 0-6.**
**Effort total :** 1 à 2 mois.

| # | Travail | Effort |
|---|---|---|
| 57 | Accueil dédié au contenu généré : origine séparée, en-têtes stricts, réseau contrôlé | L |
| 58 | Contrat universel d'exécution (le socle existe déjà : généraliser, pas réécrire) | M |
| 59 | Serveur de développement + mise à jour à chaud (fin des rechargements complets) | L |
| 60 | Isolation par conteneur des applications générées (limites CPU/mémoire/temps/réseau) | L |
| 61 | Remonter les journaux d'exécution vers l'auto-correction | M |
| 62 | Puis, et seulement ensuite : étude d'un runtime cloud (WebContainer ou micro-VM) | L |

---

## Cible à horizon — ce que « 10 000 utilisateurs » veut dire

Trois lectures, trois dimensionnements (chiffres issus de la campagne de charge du 12 octobre) :

| Lecture | Charge à encaisser | Ce que ça demande | Délai réaliste |
|---|---|---|---|
| **10 000 inscrits** (~100 à 500 actifs en même temps) | ~750 req/s · 5-25 écritures/s · 10-50 générations en parallèle | 1 à 2 serveurs + base de données + files d'attente. Coût IA ≈ 200-500 €/mois, infra ≈ 50-150 €/mois | **3-4 mois : c'est ce plan** |
| **10 000 connectés en même temps** | 10 000 à 20 000 req/s | 5 à 15 serveurs, base en bascule, répartition de charge, supervision, astreinte | 12-24 mois, avec équipe et financement |
| **10 000 générations en parallèle** | ~30 000 appels au modèle simultanés | Impossible sans contrats fournisseurs multiples | Problème de **facturation**, pas de serveurs |

**Les quatre fondations** qui organisent les lots 3 à 5 — valables quelle que soit la lecture :

1. **API sans état** : aucune donnée métier critique uniquement en mémoire, aucune opération lourde bloquant les requêtes (la règle d'or du §0).
2. **Persistance transactionnelle multi-tenant** : base de données, migrations, sauvegardes et **restauration vérifiée**.
3. **Exécution distribuée** : files durables, ouvriers indépendants, reprise après panne, quotas et isolation des générations.
4. **Capacité démontrée** : paliers testés avec seuils de latence et **coût par utilisateur mesuré**.

**Paliers de capacité à tester** (à intégrer aux critères d'acceptation des lots 2, 3 et 4) :

| Palier | Requêtes/s visés | Écritures/s | Générations en parallèle | Comment on le vérifie |
|---|---|---|---|---|
| 50 sessions | ~75 | 5 | 3 | banc actuel, en local |
| 500 sessions | ~750 | 25 | 50 | banc, depuis ton PC vers le VPS |
| 2 000 sessions | ~3 000 | 100 | 200 | banc + 3 instances du serveur |
| 10 000 sessions | ~15 000 | 500 | 1 000 | banc multi-sources + 5 à 15 instances |

**Indicateurs de premier rang** (à exposer, pas à estimer) : coût du modèle **par utilisateur actif** et **par génération** · latence p95 par route · engorgement de la boucle d'événements · taux de refus (429/503) · profondeur des files d'attente.

### La vraie unité de dimensionnement d'une plateforme **agentique**

Ce n'est ni la session, ni la génération : c'est **l'appel de modèle simultané**. Chaque demande utilisateur se décompose en plusieurs agents, et chaque agent consomme des appels.

| Cible annoncée | Traduction backend | Contrainte réelle |
|---|---|---|
| 100 000 inscrits | 1 000 à 5 000 sessions simultanées | 8 à 15 instances (à 1 500-2 500 req/s chacune après optimisation) |
| 10 000 sessions simultanées | 15 000 à 20 000 req/s | + base de données, + compteurs partagés, + cache |
| **1 000 générations actives** | **5 000 à 8 000 appels de modèle simultanés** (5 à 8 agents par demande) | **quota du fournisseur et budget** : c'est le mur, pas les serveurs |
| 99,9 % de disponibilité | 43 minutes d'indisponibilité par mois | redondance, supervision, astreinte : une **promesse d'exploitation**, pas un schéma |

**Deux conséquences de dimensionnement :**

1. **L'unité de facturation doit être l'appel de modèle (le crédit), jamais l'abonnement illimité** — un coût qui varie de 1 à 10 selon la demande ne peut pas être couvert par un prix fixe.
2. **Le crédit n'est pas seulement de la facturation : c'est ton limiteur de charge.** Un budget de crédits décrémenté à chaque appel de modèle plafonne *à la fois* la facture et la concurrence. C'est le seul mécanisme qui fait tenir les deux ensemble.

**La nature des utilisateurs compte plus que leur nombre** : l'isolation des applications générées (lot 7) est **obligatoire** pour des utilisateurs anonymes, mais **pas** pour des utilisateurs invités et connus. C'est la porte qui permet d'ouvrir tôt à des testeurs sans attendre les micro-VM.

---

## Récapitulatif et jalons

| Lot | Contenu | Effort | Ce que tu peux montrer à la fin |
|---|---|---|---|
| 0 | Fermer l'exposition | ~3 jours | « Le serveur est en ligne, et il est fermé. » |
| 1 | Honnêteté | ~1 semaine | « Rien ne ment : ni l'état, ni la facture, ni les données. » |
| 2 | Performance mesurée | ~1 semaine | « La charge ne gèle plus personne. » |
| 3 | Persistance | 2-4 semaines | « 5 000 projets ne changent rien à la vitesse. » |
| 4 | Découplage | 3-6 semaines | « J'ajoute un serveur, la capacité double. » |
| 5 | Outillage | ~1 semaine | « Les régressions n'atteignent plus les utilisateurs. » |
| 6 | Ouverture | 2-3 semaines | « Je peux inviter des testeurs sereinement. » |
| 7 | Exécution isolée | 1-2 mois | « Des inconnus peuvent générer du code sans risque. » |
| **Total** | | **≈ 3 à 4 mois** (un développeur à temps plein) | |

**Ordre recommandé, sans exception :** 0 → 1 → 2 → (mise en ligne, mesure réelle) → 3 → 4 → 5 → 6 → 7.
Les lots 1 et 2 peuvent avancer en parallèle du lot 0 par une deuxième personne, mais **rien ne passe avant le lot 0**.

---

## Ce qu'il ne faut PAS faire maintenant

- **Tout réécrire** en Go/Python ou en microservices : ton serveur n'est pas le goulot (1 200-1 700 req/s mesurés), et tu perdrais les tests et le comportement acquis.
- **Indexer le code en vecteurs à chaque modification** : tu as déjà un graphe sémantique qui choisit les bons fichiers **sans rien payer**.
- **Déployer les applications générées sur une plateforme sans disque** : elles ne démarrent pas (mêmes limites que Vercel).
- **Kubernetes, GraphQL, multi-région** : aucun de ces sujets n'est ton problème avant 20 développeurs.

---

## Ce qui est déjà fait (à ne pas refaire)

- **Quatre audits complets** : backend/sécurité, preview, conversation, plus la campagne de charge.
- **Le banc de mesure** (`scripts/bench-backend.mjs`), capable de mesurer en local **et** sur un serveur distant.
- **Le paquet de déploiement** (`deploy/`) : image, orchestration, accueil public, guide pas à pas, correctif d'adresse réelle.
- **Le plan d'architecture** (`ARCHITECTURE-QUI-ENCAISSE-20261013.md`) : les six blocs et l'ordre.
- Un serveur **déjà en ligne** ? Non — c'est la première action du lot 0.

---

## Honnêteté sur ce plan

1. **Aucun de ces travaux n'a été exécuté** : je n'ai pas d'exécution dans ma session, donc pas de compilation ni de test de ma part. Les correctifs doivent être appliqués puis **vérifiés** (c'est le critère d'acceptation de chaque lot).
2. **Les efforts sont des ordres de grandeur** pour un développeur qui connaît le projet, pas des devis.
3. **Les identifiants de constats** (SEC, PV, CV, ADD) renvoient aux rapports : chaque travail est traçable jusqu'à sa preuve dans le code.
4. Les deux réserves déjà énoncées restent valables : avant d'ouvrir à des inconnus, le **lot 0** est le ticket d'entrée ; et une fois la capacité réglée, le mur suivant sera **le coût de l'IA**, pas la vitesse.
