# Une architecture qui encaisse — plan simple (13 octobre 2026)

## L'idée en une phrase

Aujourd'hui, tout se passe **dans une seule pièce, avec un seul employé, un cahier unique qu'il réécrit en entier à chaque commande, et la cuisine dans la même pièce**.

Pour encaisser, il faut séparer six choses : **plusieurs employés**, **un vrai placard**, **un tableau partagé**, **une cuisine à part**, **un comptoir pour les fichiers**, et **une salle par client**.

---

## 1. Le schéma cible

```
                        Internet
                           │
              ┌────────────▼────────────┐
              │  Répartiteur (Nginx)    │  ← portier : TLS, fichiers statiques en cache
              └────────────┬────────────┘
                  ┌────────┼────────┐
                  ▼        ▼        ▼
             Serveur 1  Serveur 2  Serveur 3     ← API identiques (on en ajoute à volonté)
                  └────────┼────────┘
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   Base de données     Tableau partagé     File d'attente
   (Postgres)          (Redis)             (travaux lourds)
   le vrai placard     compteurs communs        │
                                               ▼
                                        Ouvriers (workers)
                                        + salle isolée
                                          par application générée
```

---

## 2. Les six blocs : aujourd'hui → cible

| Bloc | Aujourd'hui | Cible | Ce que ça règle (mesuré) |
|---|---|---|---|
| **Employés** | 1 processus, 1 machine | 2 à N serveurs identiques derrière un répartiteur | dépasse le plafond d'un seul processus (~1 200-1 700 req/s) |
| **Placard** | un fichier réécrit en entier + `fsync` à chaque écriture | base de données qui écrit **seulement la ligne modifiée** | le mur de **100 écritures/s**, et la dégradation quand les données grossissent |
| **Tableau partagé** | compteurs dans la mémoire du serveur | Redis partagé par tous les serveurs | permet d'avoir **plusieurs serveurs** sans casser les limites (ni le sémaphore IA) |
| **Comptoir fichiers** | `readFileSync` à chaque requête, sans cache | répartiteur qui sert les fichiers en cache, avec compression | le mur de **550 req/s** (aujourd'hui c'est le premier à céder) |
| **Cuisine à part** | génération IA, compilation, navigateur d'aperçu **dans le serveur** | file d'attente + ouvriers dédiés | supprime l'effet « tout le monde attend » (mesuré : 18 ms → 200-500 ms) |
| **Salle par client** | tout le monde dans la même pièce | chaque application générée dans sa propre boîte, sur son propre domaine | indispensable dès qu'il y a des inconnus (et c'est aussi le début de ton « Preview Engine ») |

---

## 3. Le plan, en 4 étapes

### Étape 0 — Les gains immédiats (quelques heures de travail)
1. **Écrire les journaux sans bloquer** (aujourd'hui : une écriture disque synchrone à chaque requête).
2. **Mettre les fichiers statiques en cache + compression** (aujourd'hui : relus du disque à chaque fois).
3. **Rendre la vérification de mot de passe non bloquante** (aujourd'hui : elle gèle tout ~30 ms).

→ Effet : le premier mur (550 req/s) remonte au niveau des autres, et **l'effet « tout le monde attend » disparaît**.

### Étape 1 — Le placard (quelques jours)
Remplacer la persistance « un fichier réécrit en entier » par une **base de données** (Postgres).
→ Effet : **100 écritures/s → plusieurs milliers**, et la dégradation quand le nombre de projets augmente disparaît. C'est ce qui casse **en premier** quand les utilisateurs arrivent.

### Étape 2 — Plusieurs employés (1 à 3 semaines)
Mettre un **répartiteur** devant, lancer **plusieurs serveurs**, déplacer les compteurs dans **Redis**, et envoyer les travaux lourds (IA, compilation, navigateur) dans une **file d'attente avec des ouvriers**.
→ Effet : la capacité devient **horizontale** — pour encaisser plus, on ajoute des serveurs au lieu d'optimiser du code.

### Étape 3 — La salle par client (1 à 2 mois)
Chaque application générée tourne dans sa **boîte isolée**, servie sur **son propre domaine**. C'est le cœur de ton document « Full-Stack Preview Engine », et la condition pour ouvrir au public.
→ Effet : on peut laisser des inconnus générer et exécuter du code sans que ça menace les autres — et c'est aussi ce qui permet d'offrir plus de stacks (Node, Python…).

---

## 4. L'échelle de capacité : ce que chaque étape débloque

| Palier | Utilisateurs **simultanés** réellement actifs | Condition |
|---|---|---|
| Aujourd'hui | **30 à 50** (et ça rame dès qu'on écrit ou se connecte) | — |
| Après l'étape 0 | **100 à 150** sur la même machine, sans effet « tout le monde attend » | journalisation, cache, hachage |
| Après l'étape 1 | Les écritures et la croissance des données ne sont plus le facteur limitant | base de données |
| Après l'étape 2 | **Plusieurs milliers** : on ajoute des serveurs | répartiteur + Redis + file d'attente |
| Après l'étape 3 | Ouverture au public possible (inconnus) | isolation des applications générées |

---

## 5. La règle d'or

> **Un seul serveur plafonne, quel que soit le code.** Pour aller au-delà, on ajoute des copies.
> Donc : **aucune donnée importante ne doit vivre dans la mémoire d'un serveur** (aujourd'hui les compteurs de limitation et le sémaphore IA y vivent — c'est ce qui empêche d'en lancer plusieurs).

---

## 6. Ce qu'on garde tel quel (à ne pas casser)

- Le **découpage** actuel (routes / services / moteur) : c'est ce qui rend cette évolution possible sans réécriture.
- Les **tests** et le typage strict.
- Les **bonnes décisions déjà prises** : limitation de l'IA à 3 en parallèle (comportement sous charge exemplaire : refus propre en 15 ms), interdiction des commandes dangereuses au terminal, mots de passe bien chiffrés, interface d'aperçu isolée dans son cadre.
- La **persistance actuelle** pour l'usage local : elle peut rester le mode « développement ».

---

## 7. Ce que ça coûte, honnêtement

| Étape | Effort | Prérequis humain |
|---|---|---|
| 0 | Quelques heures | développeur |
| 1 | Quelques jours | développeur + base de données à installer |
| 2 | 1 à 3 semaines | développeur + hébergement (2-3 serveurs, Redis) |
| 3 | 1 à 2 mois | développeur + isolation par conteneur (coût d'hébergement supérieur) |

**Deux réserves, en une ligne chacune :** (1) avant d'ouvrir à des inconnus, les trois correctifs de sécurité déjà identifiés restent le ticket d'entrée ; (2) une fois la capacité réglée, le mur suivant sera **le coût de l'IA**, pas la vitesse — c'est à ce moment-là que les quotas deviendront utiles, pas avant.
