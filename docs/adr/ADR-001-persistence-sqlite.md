# ADR-001 — Persistance : SQLite (node:sqlite) derrière l'API historique

**Décision :** Utiliser `node:sqlite` (intégré à Node 24, zéro dépendance native)
comme backend durable, via `persistence/sqlite-backend.ts`, routé par
`json-disk-cache.ts`. PostgreSQL reste l'objectif Annexe B quand le scale le
justifiera (§62 : Scale When Required, Not Because Possible).

**Contexte :** toute la persistance (projects, revisions, activity, audit, usage,
tenant, decision-ledger, fileStore) passait par des fichiers JSON mono-instance
via un module unique.

**Alternatives :** PostgreSQL dès maintenant (rejeté : complexité réseau/utilisateur
prématurée) ; better-sqlite3 (rejeté : compilation native Windows) ; rester en JSON
(rejeté : pas d'atomicité transactionnelle, pas de WAL).

**Conséquences :** interfaces inchangées pour tous les stores ; migration
transparente des fichiers .json hérités au premier accès ; repli
`VOLACO_PERSISTENCE=json` disponible ; sessions de conversation durables.

**Statut :** ACTIVE
