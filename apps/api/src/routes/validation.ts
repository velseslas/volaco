/**
 * VibeCode Core - API Tier
 * CDC V7.0 §25 — Chaîne de validation UNIQUE, branchée sur LA route
 * POST /api/v1/projects/:projectId/validate (route historique, augmentée).
 *
 * Avant ce module, cette route se contentait de RELIRE les cases cochées par
 * l'appelant (checks.build/typecheck/lint/tests/security) sans RIEN exécuter,
 * puis mettait à jour le statut projet. La ValidationChain exécute désormais
 * des vérifications RÉELLES et ordonnées (structure → parse → a11y WCAG →
 * design → tests) : la réponse de la route porte
 * { validation, report, requestId } — `validation` (rétro-compatible) +
 * `report` (chaîne réelle).
 */

import {
  ValidationChain,
  type ValidationChainReport,
  type ValidationChainRequest,
  type ValidationCodeIntelLike
} from '../../../../packages/core/src/ai-native/validation/index.js';
import { VisualIntelligenceService } from '../../../../packages/core/src/ai-native/visual-intelligence/service.js';
import { DesignHarmonyService } from '../../../../packages/core/src/ai-native/design-harmony/service.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import type { Role } from '../../../../packages/core/src/identity/permissions.js';

const visualService = new VisualIntelligenceService();
const harmonyService = new DesignHarmonyService();

// Chaîne par défaut : structure seule tant que l'analyseur de code n'est pas
// configuré (l'étape syntaxe serait alors SKIP). server.ts appelle configure
// au boot.
let validationChain = new ValidationChain({ fileStore, visualService, harmonyService });

export function configureValidationRoute(deps: { codeIntelService: ValidationCodeIntelLike }): void {
  validationChain = new ValidationChain({
    fileStore,
    codeIntelService: deps.codeIntelService,
    visualService,
    harmonyService
  });
}

/** Exécution de la chaîne réelle — appelée par la route /validate. */
export function runValidationChain(
  request: ValidationChainRequest,
  userRole: Role,
  requestId: string
): Promise<ValidationChainReport> {
  return validationChain.run(request, userRole, requestId);
}
