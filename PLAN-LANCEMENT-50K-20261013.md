# PLAN DE LANCEMENT — 50 000 comptes gratuits

**Date :** 13 octobre 2026 · **Scénario :** ouverture de 50 000 comptes gratuits, avec effet d'annonce (« tout le monde en parle »).
**Base de chiffrage :** mesures du 12 octobre (1 200-1 700 req/s par instance · 100 écritures/s · 3 générations en parallèle · 35 connexions/s).

---

## 1. L'arithmétique du lancement (ce que 50 000 comptes impliquent vraiment)

| Étape | Volume | Charge correspondante | Verdict sur ton backend actuel |
|---|---|---|---|
| Inscriptions | 50 000 en 7 jours = ~300/heure | ~5 inscriptions/minute | ✅ **tenable** (35/s mesurées) |
| Premiers essais | 20 % la 1ʳᵉ semaine = 10 000 personnes | ~1 500 générations/jour en moyenne | 🟠 **à condition d'avoir une file** |
| **Pic du jour d'annonce** | ~3 000 sessions en même temps ; 5-10 % générant ⇒ **200 à 300 générations demandées en parallèle** | 4 500 req/s · 150-300 écritures/s | 🔴 **ton backend refuse à partir de la 4ᵉ** (plafond actuel : 3 en parallèle) |
| Coût IA | 30 000 à 75 000 générations sur la vague | **600 à 3 750 € de budget modèle** | 🔴 à plafonner AVANT, sinon la facture décide pour toi |
| Infrastructure | 3 instances + base + cache + supervision | ~200-400 €/mois | 🟠 non en place aujourd'hui |

**Le chiffre qui doit te réveiller : 200 à 300 générations demandées au même instant, pour une capacité actuelle de 3.** Sans file d'attente, ce ne sont pas 3 personnes qui sont servies et 297 qui attendent : ce sont **297 personnes qui voient une erreur** — et qui l'écrivent.

---

## 2. Ce qui doit être vrai le jour du lancement (liste go / no-go)

### Indispensable — sinon ne lance pas
1. **Sécurité du lot 0** (12 travaux) : un lancement médiatisé expose ton serveur au monde. Une clé volée ou un projet lisible par tous, le jour de l'annonce, devient l'article.
2. **File d'attente + position visible** : « vous êtes 243ᵉ, environ 12 minutes ». C'est ce qui transforme 300 refus en 300 personnes patientes. **C'est la brique n°1 du lancement.**
3. **Plafonds de consommation par compte** (crédits, avec expiration comme chez les leaders) + **plafond de dépense globale par jour**. Sans eux, ton budget part en 48 h — et le premier abuseur consomme pour 1 000 personnes.
4. **Base de données** : 150-300 écritures/s au pic, quand ton stockage plafonne à 100/s **mesurées** et se dégrade avec le volume. Non négociable.
5. **Réparation du gel** (journalisation, hachage, cache statique) : au lancement, une seule requête d'enregistrement bloque **tous** les autres. C'est le défaut le plus visible en public.
6. **Serveur relançable et honnête** : arrêt propre, exécutions interrompues marquées comme telles, aucune génération fantôme dans l'interface.
7. **Réinitialisation de mot de passe** : avec 50 000 comptes, l'absence de cette fonction devient un déluge de messages au support — le jour où tu veux convaincre.
8. **Supervision + alertes + une personne disponible** : débit, latence, taux de refus, profondeur de file, coût IA à l'heure. Un lancement sans tableau de bord, c'est piloter à l'aveugle le jour qui compte le plus.

### Fortement recommandé
9. **Test de charge à 2-3 × le pic attendu** (≈ 6 000 à 10 000 requêtes/s simulées, 300 générations en file) — réalisé **avant** l'annonce, avec la file en place, et pas seulement sur `/health`.
10. **Interrupteur d'urgence** (« mode prudence ») : couper la génération en un réglage et garder le reste vivant, sans redéployer.
11. **Page d'état + message d'attente assumé** : mieux vaut dire « nous sommes à capacité, 12 minutes d'attente » que laisser un écran qui tourne.
12. **Limitation par route** : à l'ouverture, la limitation par adresse réseau protège mal (un lancement, ce sont des milliers d'adresses, mais aussi des robots et des grappes d'abus).

### Peut attendre après le lancement
Invitations d'équipe, export de projet, contrat d'API écrit, pagination, indicateurs avancés, isolation par conteneur (obligatoire seulement pour des inconnus **anonymes** — tes 50 000 comptes sont des comptes, donc identifiables).

---

## 3. Le chemin critique de lancement (extrait du plan global, réordonné)

| Ordre | Travaux (numéros du plan global) | Durée | Pourquoi dans le chemin critique |
|---|---|---|---|
| 1 | Lot 0 complet (**1 à 12**) | ~3 jours | Sans cela, le lancement publie tes failles |
| 2 | Honnêteté (**13, 14, 15, 16, 22, 23**) | ~3 jours | Arrêt propre, aucune génération fantôme, plafond de dépense |
| 3 | Performance mesurée (**25, 26, 27, 28, 29**) | ~4 jours | Supprime le gel — le défaut le plus visible en public |
| 4 | **Base de données** (**31, 32, 34**) | 1 à 3 semaines | Le mur des écritures : 100/s aujourd'hui, 300/s au pic |
| 5 | **File + files d'attente + travaux détachables** (**36, 37**) | 1 à 2 semaines | Transforme 300 refus en 300 personnes patientes |
| 6 | **API sans état + 3 instances** (**39**) | ~1 semaine | 4 500 req/s = 3 copies du serveur |
| 7 | **Réinitialisation de mot de passe** (**54**) | ~3 jours | 50 000 comptes = un support qui explose sans elle |
| 8 | Supervision + alertes + page d'état | ~3 jours | Piloter le jour J |
| 9 | Mode prudence (**52**) + test de charge au pic (**42, 47**) | ~3 jours | Se protéger et savoir où on casse |
| | **Total** | **≈ 6 à 8 semaines** | *(au lieu de 3-4 mois pour la cible complète)* |

**Ce que tu peux laisser après l'annonce** : isolation par conteneur, invitations, facturation complète, micro-VM. Rien de tout cela n'est nécessaire pour servir 50 000 comptes **pendant** une vague.

**Trois travaux s'ajoutent au chemin critique du fait du contexte de marché (§7)** : l'accès **payable** aux crédits IA, l'encaissement **local**, et la **protection contre les comptes multiples** sur les crédits gratuits. Cela porte le chemin critique à **7 à 10 semaines**.

---

## 4. Les trois façons de rater ce lancement

1. **L'infrastructure tient, mais le produit paraît cassé.** 300 personnes veulent générer, 3 sont servies, les autres voient une erreur. La vague d'enthousiasme devient une vague de captures d'écran.
   *Parade :* file d'attente visible, position, durée estimée.
2. **Le coût dérape.** Sans plafond par compte ni plafond quotidien, une poignée d'abus consomme le budget prévu pour 50 000 personnes, en un week-end.
   *Parade :* crédits par compte avec expiration, plafond global journalier, alerte à 50 % du budget.
3. **Une faille est publiée pendant l'annonce.** Une clé exposée, un projet lisible par tous, un contenu généré qui exécute du code sur ton origine : la nouvelle qui circule n'est plus celle que tu voulais.
   *Parade :* le lot 0 complet **avant** l'ouverture.

---

## 5. La version intelligente du lancement (recommandée)

Tu peux garder « tout le monde en parle » **sans** exposer ta plateforme au pic maximal :

- **Annonce avec jauge** : « 50 000 places gratuites » + liste d'attente assumée. La file devient un **argument marketing** (« déjà 4 231 personnes en attente ») au lieu d'un bug.
- **Ouverture par vagues** : 500 → 5 000 → 50 000. Chaque vague est un test de charge réel, et tu corriges entre les deux. C'est exactement ce que font les plateformes qui ont survécu à leur succès.
- **Deux niveaux de comptes** : gratuit avec crédits limités et expiration (comme le leader du marché) ; payant avec capacité réelle. Tu convertis pendant la vague, pas après.

C'est la différence entre « le lancement a cassé » et « le lancement a saturé, et c'est pour ça que je suis passé payant ».

---

## 6. Budget de lancement à prévoir

| Poste | Montant estimé |
|---|---|
| Générations IA (30 000 à 75 000) | **600 à 3 750 €** |
| Infrastructure (3 instances + base + cache + supervision) | 200 à 400 €/mois |
| Développement du chemin critique (§3) | 6 à 8 semaines de travail |
| **Total argent** | **≈ 1 000 à 4 500 €** pour la vague |

**La bonne nouvelle :** ce budget est modeste si tu le compares à ce que coûte un lancement raté — et chaque euro dépensé ici est réutilisé pour la suite (base de données, files, supervision restent).

---

## 7. Le contexte « premier en Algérie et en Afrique » — ce que ça change côté backend

Le positionnement ne change rien à l'ingénierie ; **les contraintes du marché, si**. Quatre points, tous côté backend.

### 7.1 Le paiement local est un chantier de lancement (pas d'après-lancement)

Deux chemins à supporter, dans cet ordre de simplicité :

| Chemin | Ce que ça demande côté backend | Effort |
|---|---|---|
| **Bons prépayés** (revendeurs, paiement en espèces) | lots de codes générés, endpoint de rachat (usage unique, anti-force brute, expiration), registre, réconciliation revendeur | M |
| **Passerelle locale** (cartes CIB / Edahabia) | commande, webhook de confirmation **idempotent**, crédits provisionnés **après** confirmation, facture, remboursement | M |

Nouveaux travaux à ajouter au plan global : **63** registre des commandes et des crédits (montants en unités entières, jamais en nombres flottants) · **64** webhook de paiement rejouable et signé · **65** provisionnement et expiration des crédits + journal d'audit · **66** bons prépayés (génération, rachat, anti-force brute) · **67** factures et taxes locales · **68** passage d'un compte gratuit à un compte payant sans perte de projets.

**Conséquence de calendrier :** si tu veux convertir **pendant** la vague (et c'est tout l'intérêt), ce chantier entre dans le chemin critique et ajoute **1 à 2 semaines**.

### 7.2 Le carburant : tes crédits IA sont payables en devises

À trancher **avant** toute architecture : comment recharges-tu ton compte chez le fournisseur de modèles ? Sans carte internationale, c'est le point de blocage réel du produit — l'architecture n'y change rien, mais le **choix du fournisseur** compte. Bonne nouvelle : ton code possède déjà un registre multi-fournisseurs (Mistral, Gemini) — **acheter la capacité IA là où tu peux payer est un changement de configuration, pas une réécriture**. C'est un atout à préserver, pas à casser.

### 7.3 La contrainte de paiement à l'étranger rend l'auto-hébergement obligatoire (et c'est une bonne nouvelle)

Les six services managés du plan « international » (base hébergée, cache, micro-VM, passerelle IA, traçage, plateforme de déploiement) exigent tous une **carte internationale**. Le plan simple — un VPS + Docker — est aussi **le seul qui reste payable depuis l'Algérie**. Donc : auto-héberger d'abord, passer au managé quand tu factureras en devises.

### 7.4 Réseau, mobile et fraude : trois priorités qui montent

- **Coupures réseau fréquentes (4G)** : les **travaux détachables** (n° 37) passent de « confort » à « nécessité ». Sinon chaque coupure perd une génération, et l'utilisateur conclut que le produit bugue.
- **Données mobiles coûteuses** : la page du Studio (14 000+ lignes, servie sans cache) est le premier poste de consommation de données de tes utilisateurs → l'alléger et la mettre en cache (travail B) devient **prioritaire**, pas cosmétique.
- **Fraude aux crédits gratuits** : 50 000 comptes dans un marché à faible coût d'accès, ce sont souvent 3 000 personnes avec 16 comptes chacune. Il faut : limitation d'inscription par adresse réseau et par opérateur, vérification légère, **crédits accordés progressivement et expirant**, détection de grappes. Sans cela, ta « base de 50 000 » est un chiffre creux — et c'est ton budget IA qui part.

### 7.5 Ce que « premier en Afrique » t'apporte côté backend

Aucune architecture de référence à copier pour ce marché : ton avantage se construit sur trois **choix d'ingénierie** — la **latence régionale** (héberger en Europe donne 50 à 80 ms vers le Maghreb ; Cloudflare rapproche les fichiers), **le paiement que les concurrents internationaux n'ont pas**, et **la conformité locale**. Ce sont des décisions de backend, pas de marketing.

---

## 8. Ce que je fais tout de suite, si tu veux

Par ordre d'utilité pour ce lancement :

1. **Le scénario de connexions maintenues** dans le banc (100, 500, 1 000 flux ouverts) — répond à « combien de personnes connectées je tiens » avec des chiffres.
2. **Le test de file d'attente** : simuler 300 générations demandées d'un coup et vérifier que la file encaisse, affiche les positions et ne perd personne.
3. **Les patchs du lot 0** (1 à 12), prêts à appliquer.
4. **Le fichier d'intégration continue** + le script de vérification « fumée », pour que la préparation du lancement ne régresse pas.

Dis-moi lequel tu veux en premier.
