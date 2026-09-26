# PATCH 05 — Persistence Guard

Patch chirurgical. Ne supprime ni ne regenere `dist`.

Fichiers modifiés :
- packages/core/src/persistence/json-disk-cache.ts
- packages/core/src/repository/index.ts
- dist/packages/core/src/persistence/json-disk-cache.js
- dist/packages/core/src/repository/index.js

Le patch conserve les API et emplacements de données existants. Il ajoute une visibilité explicite des erreurs de persistance, des fichiers temporaires uniques, un fsync avant remplacement et le nettoyage des temporaires. Le mode strict est opt-in avec `VOLACO_PERSISTENCE_STRICT=1`.

NE PAS : supprimer/reconstruire dist, lancer npm run build, toucher aux phases 9.5 à 19.

Test : appliquer le script, redémarrer le serveur et vérifier les fonctions existantes. Ne pas activer le mode strict au premier test.
