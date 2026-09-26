# PATCH 01 — Build & Test Hygiene

## Objectif
Rendre les validations reproductibles en empêchant les fichiers `dist/` obsolètes de survivre aux builds.

## Modifications
- Ajout de `scripts/clean-dist.mjs`.
- `npm run build` nettoie automatiquement `dist/` avant compilation via `prebuild`.
- `npm test` reconstruit automatiquement depuis une source propre via `pretest`.
- `gate1:verify` lance un clean build avant les tests historiques.
- `gate2:verify` utilise `npm run build` afin d'appliquer le clean build au lieu d'appeler `tsc` directement.

## Non-modifié volontairement
- Architecture IA.
- Orchestrator et agents.
- Authentification.
- Persistance.
- API métier.
- Studio.
- UI.

## Validation effectuée
- `npm run typecheck` : PASS.
- `npm run gate1:verify` : PASS — 31/31 tests.
- `npm run build` : PASS.

La suite complète `npm test` a été lancée mais n'a pas terminé dans la fenêtre d'exécution d'audit ; aucun échec de test n'a été utilisé pour justifier le patch.
