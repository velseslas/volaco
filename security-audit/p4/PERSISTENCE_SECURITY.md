# AUDIT DE LA PERSISTANCE DURABLE ET DE LA RÉSISTANCE AUX CRASHS (PERSISTENCE_SECURITY)

## 1. Mécanisme de Stockage Fichier Durable (`DurableFileStorage`)

Pour répondre aux observations de P3-001-B concernant la vulnérabilité des stores purement volatils lors du recyclage des conteneurs en production :
- Le module `packages/core/src/repository/index.ts` implémente une persistance sur disque basée sur le format JSON structuré.
- L'écriture physique respecte le principe d'atomicité : les données sont sérialisées dans un fichier temporaire unique (`.tmp`), suivi d'un renommage atomique (`fs.renameSync`). Cette technique garantit qu'une coupure brutale de courant ou un signal `SIGKILL` ne peut en aucun cas laisser un fichier d'état dans un état tronqué ou corrompu.

## 2. Validation de Non-Régression au Redémarrage

Des tests simulant la terminaison et le redémarrage à chaud de l'application ont validé la survie intégrale des données :
- **Projets :** Les entités de projet sont relues fidèlement avec leurs métadonnées (`P4-DUR-01`).
- **Arborescence de fichiers :** La hiérarchie des fichiers et les révisions associées restent intactes (`P4-DUR-02`).
- **Piste d'audit :** L'historique des événements et la chaîne de hachage SHA-256 sont préservés sans altération (`P4-DUR-03`).
