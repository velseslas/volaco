# CERTIFICATION V8 — WALKTHROUGH (CDC §13/§14)

Référence : HEAD du jour · Suite : `node scripts/run-tests.mjs` · Typecheck : `npm run typecheck`

Chaque contrôle du CDC V8 §13, sa preuve et comment la rejouer.

| Contrôle | Exigence CDC | Preuve dans le dépôt | Rejouer |
|---|---|---|---|
| **TypeScript** | 0 erreur en strict mode | `tsc --noEmit` sortie vide | `npm run typecheck` |
| **Tests** | 100 % des tests de référence passants | Suite node:test : **2705 pass / 0 fail** (553 suites) | `node scripts/run-tests.mjs` |
| **Régression** | Aucune régression critique | `regression-guard.ts` + `version-compare.ts` bloquent l'acceptation ; matrice visuelle 375→1920 (`visual-intelligence/regression-matrix.ts`) | `POST /api/v1/projects/:id/design/improve {apply:false}` puis comparaison |
| **Visual** | Captures reproductibles + avant/après | Real-renderer (Playwright/Chromium, viewport 1440 par défaut) + panneau « Comparaison avant/après » du Studio (`compareBefore`) | Générer → bouton « ✨ Améliore le design » |
| **Accessibility** | Contrôles intégrés au pipeline | Étape a11y WCAG de la chaîne de validation (`ai-native/validation/validation-chain.ts`) + `responsive-a11y-harmony.ts` | Inclus dans chaque validation de génération |
| **Security** | Contrôles intégrés au pipeline | Étape sécurité de la chaîne + gates MCP fail-closed + `image-gate` + isolation cross-tenant testée (`images-tenant-isolation.test.ts`) | `node scripts/run-tests.mjs 'dist/**/images-tenant-isolation*'` |
| **Determinism** | Scores et règles reproductibles | `reportHash` déterministe (validation-chain), AQS et score-engine déterministes, `design-rules-config-store` versionné | Deux validations successives → même hash |
| **Traceability** | Amélioration traçable et réversible | Journal d'audit persistant + révisions/rollback (`/revisions`) + changesets hachés + approbation humaine `approvedBy` (§21) | `GET /api/v1/audit` · restauration via révisions |

## Boucle d'auto-amélioration (§8) — protocole complet

1. `POST /api/v1/projects/:id/design/improve` `{apply:false}` → analyse + proposition (sans modification).
2. Revue humaine ; comparaison avant/après dans le Studio.
3. `POST … {apply:true, approvedBy:"…"}` → application **uniquement** avec approbation explicite.
4. Régression bloquante → refus d'acceptation ; rollback toujours disponible.

## Livrables V8 (§14) — état

Design Intelligence Engine ✓ · Direction model ✓ · Token registry ✓ · Rules engine ✓ · System resolver ✓ · Aesthetic Quality Engine ✓ · Harmony renforcé ✓ · Before/after ✓ · Contrats Orchestrator ✓ · API/bridges/Studio ✓ · Tests ✓ · **Ce document (walkthrough)** ✓
