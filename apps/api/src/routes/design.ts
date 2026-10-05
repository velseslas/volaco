/**
 * VibeCode Core - API Tier
 * Design Intelligence Route (ÉTAPE 8 — CDC V8 §5-§16)
 *
 * Expose le langage visuel de l'application :
 *  - Tokens inférés du DOM réel (TokenInferer, AINT-011) : couleurs,
 *    typographie, spacing, shapes, élévation — avec confidence + preuves ;
 *  - Design Harmony (harmonie, dérive du design, incohérences) ;
 *  - Design Direction v1 : caractéristiques esthétiques dérivées de façon
 *    DÉTERMINISTE des tokens (aucun Math.random — exigence CDC §16 V8) ;
 *  - DQI = Design Quality Index combinant harmonie + qualité perçue.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { VisualIntelligenceService } from '../../../../packages/core/src/ai-native/visual-intelligence/service.js';
import { DesignHarmonyService } from '../../../../packages/core/src/ai-native/design-harmony/service.js';
import { designReportStore } from '../../../../packages/core/src/ai-native/design-harmony/report-store.js';
import { TokenInferer } from '../../../../packages/core/src/ai-native/design-harmony/engine/token-inferer.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

const visualService = new VisualIntelligenceService();
const harmonyService = new DesignHarmonyService();
const tokenInferer = new TokenInferer();

export async function handleDesignRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // GET /api/v1/projects/:projectId/design
  const prefix = '/api/v1/projects/';
  if (req.method !== 'GET' || !pathname.startsWith(prefix) || !pathname.endsWith('/design')) {
    return false;
  }
  const projectId = pathname.slice(prefix.length, -'/design'.length);
  if (!projectId) return false;

  assertPermission(context.role, 'PROJECT_READ', requestId);

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: `Projet ${projectId} introuvable`, requestId }));
    return true;
  }

  const htmlContent = fileStore.getAllProjectFiles(context.tenantId, projectId)['index.html'];
  if (!htmlContent || htmlContent.trim().length === 0) {
    throw new ValidationError('Ce projet ne contient aucun index.html à analyser', undefined, requestId);
  }

  // 1. Snapshot visuel du DOM réel (AINT-012)
  const analysis = await visualService.analyzeVisuals(
    { tenantId: context.tenantId, projectId, htmlContent, requestId },
    context.role
  );
  const snapshot = analysis.snapshot;

  // 2. Harmonie + dérive + tokens inférés (AINT-011)
  const report = await harmonyService.analyzeDesignHarmony(
    { tenantId: context.tenantId, projectId, snapshots: [snapshot], requestId },
    context.role
  );
  // ÉTAPE 42 Phase 4A — comparaison avec le DERNIER rapport réellement
  // persisté (DesignReportStore, clé tenant:project). Premier appel :
  // previous = null, AUCUN delta inventé. Le rapport courant est ensuite
  // persisté comme dernier rapport.
  const previousReport = designReportStore.get(context.tenantId, projectId);
  const comparison = previousReport
    ? harmonyService.compareReports(previousReport, report)
    : undefined;
  const tokens = tokenInferer.inferDesignSystem([snapshot]);

  // 3. Design Direction v1 — dérivation déterministe des tokens (§6 CDC V8)
  const radiusValues = tokens.shapeTokens;
  const colors = snapshot.extractedColors.slice(0, 8);
  const fonts = snapshot.extractedFonts.slice(0, 4);
  const interactiveRatio = snapshot.totalElementsCount > 0
    ? snapshot.interactiveElements.length / snapshot.totalElementsCount
    : 0;

  const radiusKeys = Object.keys(radiusValues) as (keyof typeof radiusValues)[];
  const radiusSample = String(radiusValues[radiusKeys[0] ?? ('md' as keyof typeof radiusValues)] ?? '');
  const radiusPx = parseInt(radiusSample, 10) || 8;

  const designDirection = {
    style: radiusPx >= 16 ? 'Soft & Rounded' : radiusPx >= 8 ? 'Balanced Modern' : 'Sharp & Technical',
    density: interactiveRatio > 0.25 ? 'Dense' : interactiveRatio > 0.1 ? 'Balanced' : 'Spacious',
    personality: fonts.some((f) => /mono/i.test(f)) ? 'Professional / Technical' : 'Friendly / Editorial',
    motion: 'Subtle',
    visualEnergy: colors.length > 6 ? 'Expressive' : 'Calm',
    informationDensity: snapshot.totalElementsCount > 300 ? 'High' : snapshot.totalElementsCount > 120 ? 'Medium' : 'Low',
    evidence: {
      dominantRadiusPx: radiusPx,
      colorCount: colors.length,
      fontCount: fonts.length,
      interactiveElements: snapshot.interactiveElements.length,
      totalElements: snapshot.totalElementsCount
    }
  };

  // 4. DQI v1 = harmonie (60 %) + qualité perçue dérivée des preuves DOM (40 %).
  //    Heuristique déterministe — le CDC V8 §16 exige la reproductibilité.
  const perceived = Math.max(0, Math.min(100, 100 - Math.max(0, colors.length - 8) * 4 - Math.max(0, fonts.length - 3) * 6));
  const dqi = Math.round(report.overallScore * 0.6 + perceived * 0.4);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    designDirection,
    tokens: report.inferredDesignSystem,
    harmony: {
      overallScore: report.overallScore,
      subScores: report.subScores,
      driftSummary: report.driftSummary,
      topFindings: report.findings.slice(0, 10)
    },
    dqi,
    ...(previousReport ? {
      previous: {
        reportId: previousReport.reportId,
        overallScore: previousReport.overallScore,
        analyzedRoutes: previousReport.analyzedRoutes
      },
      comparison
    } : {}),
    requestId
  }));
  // ÉTAPE 42 Phase 4A — le rapport courant devient le dernier rapport.
  designReportStore.record(report);
  return true;
}
