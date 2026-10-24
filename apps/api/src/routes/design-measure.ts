/**
 * VibeCode Core - API Tier
 * LOT B — mesure esthétique PARTAGÉE (CDC V8 §13/§14/§17).
 *
 * Source de vérité unique pour mesurer un projet :
 *   rendu réel best-effort (desktop + mobile + overflow) → VisualIntelligence
 *   → Critic §13 → tokens §7 → AQS §14 (desktop et mobile réels).
 *
 * Utilisée par :
 *  - GET /design/aesthetic (Lot A, réponse inchangée) ;
 *  - POST /design/improve (Lot B : mesure avant/après de la boucle) ;
 *  - POST /repair (Lot B : gate AQS de non-régression du patch).
 *
 * Le rendu est ÉVITÉ quand le DOM runtime est déjà disponible (le renderer
 * l'a capturé) : aucun double lancement Chromium inutile.
 */

import { VisualIntelligenceService } from '../../../../packages/core/src/ai-native/visual-intelligence/service.js';
import { renderProjectPreview } from '../../../../packages/core/src/ai-native/visual-intelligence/real-renderer.js';
import type { MobileOverflowResult } from '../../../../packages/core/src/ai-native/visual-intelligence/real-renderer.js';
import { extractDocumentCss } from '../../../../packages/core/src/ai-native/visual-intelligence/engine/css-parser.js';
import { DesignCriticEngine } from '../../../../packages/core/src/ai-native/design-harmony/engine/design-critic.js';
import { AestheticQualityEngine } from '../../../../packages/core/src/ai-native/design-harmony/engine/aqs-engine.js';
import { ResponsiveA11yHarmonyEngine } from '../../../../packages/core/src/ai-native/design-harmony/engine/responsive-a11y-harmony.js';
import { TokenInferer } from '../../../../packages/core/src/ai-native/design-harmony/engine/token-inferer.js';
import type {
  AestheticQualityScore,
  DesignCritique,
  DesignHarmonyFinding,
  InferredDesignSystem
} from '../../../../packages/core/src/ai-native/design-harmony/types.js';
import type { VisualSnapshot } from '../../../../packages/core/src/ai-native/visual-intelligence/types.js';
import type { Role } from '../../../../packages/core/src/identity/permissions.js';

const visualService = new VisualIntelligenceService();
const designCritic = new DesignCriticEngine();
const aestheticEngine = new AestheticQualityEngine();
const responsiveEngine = new ResponsiveA11yHarmonyEngine();
const tokenInferer = new TokenInferer();

export interface AestheticMeasurementInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly role: Role;
  readonly files: Record<string, string>;
  /** Page d'entrée à mesurer (défaut : index.html) — §31 multi-pages. */
  readonly entryFile?: string | undefined;
  /** Route réelle de la page mesurée (traçabilité cross-page §31 ; défaut '/'). */
  readonly pageRoute?: string | undefined;
  /** DOM runtime déjà capturé (optionnel) : évite un rendu supplémentaire. */
  readonly runtimeDom?: unknown;
  readonly mobileRuntimeDom?: unknown;
  readonly mobileOverflow?: MobileOverflowResult;
}

export interface AestheticMeasurementResult {
  readonly htmlContent: string;
  readonly snapshot: VisualSnapshot;
  readonly mobileSnapshot: VisualSnapshot;
  readonly mobileOverflow?: MobileOverflowResult | undefined;
  readonly responsiveFindings: readonly DesignHarmonyFinding[];
  readonly critique: DesignCritique;
  readonly tokens: InferredDesignSystem;
  readonly aqs: AestheticQualityScore;
  /** Erreurs runtime observées au rendu de CETTE passe ([] si aucun rendu). */
  readonly runtimeErrors: readonly string[];
}

export async function measureProjectAesthetics(
  input: AestheticMeasurementInput
): Promise<AestheticMeasurementResult> {
  const entryFile = input.entryFile ?? 'index.html';
  const pageRoute = input.pageRoute ?? '/';
  const htmlContent = input.files[entryFile] ?? '';
  const cssContent = extractDocumentCss(htmlContent);

  let runtimeDom = input.runtimeDom;
  let mobileRuntimeDom = input.mobileRuntimeDom;
  let mobileOverflow = input.mobileOverflow;
  let runtimeErrors: readonly string[] = [];
  if (runtimeDom === undefined) {
    try {
      const render = await renderProjectPreview(input.files, { entryFile });
      runtimeDom = render.runtimeDom;
      mobileRuntimeDom = render.mobileRuntimeDom;
      mobileOverflow = render.mobileOverflow;
      runtimeErrors = render.pageErrors;
    } catch {
      // Rendu optionnel : le repli statique (HTML + CSS documentaire) reste
      // une analyse réelle, tracée par layoutSource=ESTIMATED.
    }
  }

  const desktopAnalysis = await visualService.analyzeVisuals(
    {
      tenantId: input.tenantId,
      projectId: input.projectId,
      pageRoute,
      htmlContent,
      cssContent,
      ...(runtimeDom !== undefined ? { runtimeDom } : {}),
      requestId: input.requestId
    },
    input.role
  );
  const mobileAnalysis = await visualService.analyzeVisuals(
    {
      tenantId: input.tenantId,
      projectId: input.projectId,
      pageRoute,
      htmlContent,
      cssContent,
      viewport: 'MOBILE',
      ...(mobileRuntimeDom !== undefined ? { runtimeDom: mobileRuntimeDom } : {}),
      requestId: input.requestId
    },
    input.role
  );

  const snapshot = desktopAnalysis.snapshot;
  const mobileSnapshot = mobileAnalysis.snapshot;
  const responsiveFindings = responsiveEngine.analyzeResponsiveAndA11y([mobileSnapshot]);
  const critique = designCritic.critique(snapshot);
  const tokens = tokenInferer.inferDesignSystem([snapshot], { cssContent });
  const aqs = aestheticEngine.compute({
    snapshot,
    critique,
    tokens,
    responsiveFindings,
    mobileSnapshot,
    ...(mobileOverflow !== undefined ? { mobileOverflow } : {})
  });

  return {
    htmlContent,
    snapshot,
    mobileSnapshot,
    ...(mobileOverflow !== undefined ? { mobileOverflow } : {}),
    responsiveFindings,
    critique,
    tokens,
    aqs,
    runtimeErrors
  };
}