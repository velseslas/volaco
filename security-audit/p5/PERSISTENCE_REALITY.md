# AUDIT DE RÉALITÉ DE LA PERSISTANCE DURABLE (PERSISTENCE_REALITY)

## 1. Mécanisme de Résistance aux Pannes

L'implémentation `DurableFileStorage` dans `packages/core/src/repository/index.ts` :
- Sérialise l'état complet sous forme de fichier JSON sur le disque local.
- Utilise un fichier temporaire (`.tmp`) suivi d'une opération atomique `fs.renameSync()`.
- Cette approche garantit qu'un crash du processus pendant une écriture ne corrompt jamais le fichier principal.

## 2. Limite d'Architecture

Bien que durable sur un nœud unique (single-node filesystem), ce système ne dispose pas d'une couche de réplication multi-nœuds distribuée. Il est parfaitement adapté à un déploiement avec volume persistant attaché, mais requiert une base de données externe pour une mise à l'échelle horizontale partagée.
