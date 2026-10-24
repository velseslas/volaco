/**
 * VibeCode Core - API Tier
 * Design Intelligence Route (ÉTAPE 8 — CDC V8 §5-§16)
 *
 * Expose le langage visuel de l'application :
 *  - Tokens inférés du DOM réel (TokenInferer, AINT-011) : couleurs, typo,
 *    spacing, shapes, élévation, MOTION (§7.6) et LAYOUT (§7.7) ;
 *  - Design Harmony (harmonie, dérive du design, incohérences) ;
 *  - Design Direction v1 : caractéristiques esthétiques dérivées de façon
 *    DÉTERMINISTE des tokens (aucun Math.random — exigence CDC §16 V8) ;
 *  - DQI = Design Quality Index combinant harmonie + qualité perçue, avec
 *    gouvernance V8.1 (§8) : BLOQUÉ si une dimension critique est en échec ou
 *    non mesurée (le plafond ne dépasse jamais la dimension défaillante) ;
 *  - LOT 1 (§11) : artefact Design System PERSISTÉ (tokens + direction
 *    appliquée + règles versionnées) relisible via GET .../design/system ;
 *    catalogue de règles versionné exposé via GET .../design/rules.
 *  - LOT A (§13/§14) : GET .../design/aesthetic — Design Critic + AQS
 *    (12 sous-scores mesurés ou UNKNOWN), sur DOM réel quand Chromium répond.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { VisualIntelligenceService } from '../../../../packages/core/src/ai-native/visual-intelligence/service.js';
import { extractDocumentCss } from '../../../../packages/core/src/ai-native/visual-intelligence/engine/css-parser.js';
import { DesignHarmonyService } from '../../../../packages/core/src/ai-native/design-harmony/service.js';
import { designReportStore } from '../../../../packages/core/src/ai-native/design-harmony/report-store.js';
import { buildDesignSystemArtifact, designSystemStore } from '../../../../packages/core/src/ai-native/design-harmony/design-system-store.js';
import { DESIGN_RULES_CATALOG, DESIGN_RULES_CATALOG_VERSION } from '../../../../packages/core/src/ai-native/design-harmony/design-rules.js';
import { TokenInferer } from '../../../../packages/core/src/ai-native/design-harmony/engine/token-inferer.js';
import { deriveDesignDirection } from '../../../../packages/core/src/ai-native/design-harmony/design-direction.js';
import { applyDesignDirectionOverride } from '../../../../packages/core/src/ai-native/design-harmony/design-direction-catalog.js';
import { designDirectionStore } from '../../../../packages/core/src/ai-native/design-harmony/design-direction-store.js';
import { measureProjectAesthetics } from './design-measure.js';
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
  // GET /api/v1/projects/:projectId/design            → analyse + persistance
  // GET /api/v1/projects/:projectId/design/system     → artefact Design System persisté
  // GET /api/v1/projects/:projectId/design/rules      → catalogue de règles versionné
  // GET /api/v1/projects/:projectId/design/aesthetic  → Critic §13 + AQS §14 (Lot A)
  const prefix = '/api/v1/projects/';
  if (req.method !== 'GET' || !pathname.startsWith(prefix)) {
    return false;
  }
  let kind: 'analyze' | 'system' | 'rules' | 'aesthetic' | undefined;
  if (pathname.endsWith('/design/system')) kind = 'system';
  else if (pathname.endsWith('/design/rules')) kind = 'rules';
  else if (pathname.endsWith('/design/aesthetic')) kind = 'aesthetic';
  else if (pathname.endsWith('/design')) kind = 'analyze';
  if (!kind) return false;
  const suffix = kind === 'analyze' ? '/design' : `/design/${kind}`;
  const projectId = pathname.slice(prefix.length, -suffix.length);
  if (!projectId || projectId.includes('/')) return false;

  assertPermission(context.role, 'PROJECT_READ', requestId);

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: `Projet ${projectId} introuvable`, requestId }));
    return true;
  }

  // LOT 1 (§11) — catalogue de règles versionné : statique, identique pour
  // tous les projets (l'application aux tokens du projet vit dans l'artefact).
  if (kind === 'rules') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      version: DESIGN_RULES_CATALOG_VERSION,
      rules: DESIGN_RULES_CATALOG.map((rule) => ({
        id: rule.id,
        category: rule.category,
        description: rule.description
      })),
      requestId
    }));
    return true;
  }

  // LOT 1 (§11) — dernier artefact Design System persisté. S'il n'existe pas
  // encore : 404 honnête (aucun artefact fabriqué à la volée).
  if (kind === 'system') {
    const artifact = designSystemStore.get(context.tenantId, projectId);
    if (!artifact) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        message: `Aucun artefact Design System persisté pour ce projet (lancer GET /api/v1/projects/${projectId}/design d'abord)`,
        requestId
      }));
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ system: artifact, requestId }));
    return true;
  }

  const files = fileStore.getAllProjectFiles(context.tenantId, projectId);
  const htmlContent = files['index.html'];
  if (!htmlContent || htmlContent.trim().length === 0) {
    throw new ValidationError('Ce projet ne contient aucun index.html à analyser', undefined, requestId);
  }

  // LOT A (§13/§14) — mesure dédiée : rendu réel best-effort (DOM desktop +
  // mobile + overflow) puis critique et AQS. Route ADDITIVE : la réponse
  // historique de GET /design reste inchangée (non-régression e53/e42).
  // LOT B — le pipeline de mesure est désormais centralisé dans
  // design-measure.ts (partagé avec la boucle d'amélioration et le gate de
  // réparation). La réponse ci-dessous est STRICTEMENT identique.
  if (kind === 'aesthetic') {
    const measurement = await measureProjectAesthetics({
      tenantId: context.tenantId,
      projectId,
      requestId,
      role: context.role,
      files
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      aesthetic: measurement.aqs,
      critique: measurement.critique,
      tokens: measurement.tokens,
      layoutSource: measurement.snapshot.layoutSource ?? 'ESTIMATED',
      responsive: {
        mobileAnalyzed: true,
        viewport: measurement.mobileSnapshot.viewport,
        overflow: measurement.mobileOverflow ?? null,
        findings: measurement.responsiveFindings.length
      },
      requestId
    }));
    return true;
  }

  // CDC V8 §7 — les blocs <style> du document sont lus par le pipeline
  // statique (variables CSS, media queries, transitions/keyframes).
  const cssContent = extractDocumentCss(htmlContent);

  // 1. Snapshot visuel du DOM réel (AINT-012) + styles du document
  const analysis = await visualService.analyzeVisuals(
    { tenantId: context.tenantId, projectId, htmlContent, cssContent, requestId },
    context.role
  );
  const snapshot = analysis.snapshot;

  // 2. Harmonie + dérive + tokens inférés (AINT-011)
  const report = await harmonyService.analyzeDesignHarmony(
    { tenantId: context.tenantId, projectId, snapshots: [snapshot], requestId },
    context.role
  );
  // ÉTAPE 42 Phase 4A — comparaison avec le DERNIER rapport réellement
  // persisté (DesignReportStore, clé tenant:project). Premier appel : previous
  // = null, AUCUN delta inventé. Le rapport courant est ensuite persisté.
  const previousReport = designReportStore.get(context.tenantId, projectId);
  const comparison = previousReport
    ? harmonyService.compareReports(previousReport, report)
    : undefined;
  const tokens = tokenInferer.inferDesignSystem([snapshot], { cssContent });

  // 3. Design Direction v1 — dérivation déterministe des tokens (§6 CDC V8).
  //    CDC V8 §11 — SOURCE UNIQUE : la même fonction (design-direction.ts,
  //    core) alimente le contexte design réel des agents UI — aucune
  //    heuristique dupliquée entre l'API et l'orchestrateur.
  const fonts = snapshot.extractedFonts.slice(0, 4);
  // É44 P3 — la pénalité couleur du DQI doit s'appliquer sur le nombre RÉEL
  // de couleurs extraites : tronquer à 8 avant comptage rendait le terme
  // `colors.length - 8` toujours nul (terme mort démontré en Phase 2D).
  const realColorCount = snapshot.extractedColors.length;

  const derivedDirection = deriveDesignDirection(tokens, {
    // Parité stricte avec la sortie historique : la direction consomme le
    // compteur de couleurs RETENU (≤ 8) ; le DQI garde realColorCount.
    extractedColorCount: snapshot.extractedColors.slice(0, 8).length,
    extractedFonts: fonts,
    interactiveElementsCount: snapshot.interactiveElements.length,
    totalElementsCount: snapshot.totalElementsCount
  });
  // LOT C (§6) — la direction peut être FIXÉE par le projet (override
  // persistant) : elle prime sur la dérivation, sans changer la forme de la
  // réponse (non-régression e42/e53).
  const directionOverrideRecord = designDirectionStore.get(context.tenantId, projectId);
  const designDirection = directionOverrideRecord
    ? applyDesignDirectionOverride(derivedDirection, directionOverrideRecord.override)
    : derivedDirection;

  // 4. DQI v1 = harmonie (60 %) + qualité perçue dérivée des preuves DOM (40 %).
  //    Heuristique déterministe — le CDC V8 §16 exige la reproductibilité.
  const perceived = Math.max(0, Math.min(100, 100 - Math.max(0, realColorCount - 8) * 4 - Math.max(0, fonts.length - 3) * 6));
  const baseDqi = Math.round(report.overallScore * 0.6 + perceived * 0.4);
  // 4bis. P0 V8.1 §8 — gouvernance : aucun score ne doit autoriser à lui seul
  // une modification, et le DQI ne peut pas ignorer une défaillance critique.
  // Le DQI est BLOQUÉ (plafonné) si une dimension critique est en échec
  // (accessibilité < 50) ou non mesurée, ou si des findings CRITICAL existent.
  // Cas réel prouvé : DQI 94 alors que l'accessibilité responsive valait 0 et
  // que 6 findings contraste CRITICAL existaient. Le plafond ne dépasse jamais
  // le score de la dimension défaillante (a11y 0 → DQI 0).
  const a11yPillar = report.subScores.responsiveA11yHarmony;
  const a11yKnown = typeof a11yPillar === 'number' && Number.isFinite(a11yPillar);
  const criticalFindingsCount = report.findings.filter((f) => f.severity === 'CRITICAL').length;
  const dqiBlocked = criticalFindingsCount > 0 || !a11yKnown || (a11yKnown && a11yPillar < 50);
  const dqi = dqiBlocked
    ? Math.min(baseDqi, a11yKnown ? Math.max(0, Math.min(49, Math.round(a11yPillar))) : 49)
    : baseDqi;

  // 5. LOT 1 (§11) — artefact Design System : les tokens RÉELS, la direction
  //    réellement appliquée et les règles du catalogue VERSIONNÉ, assemblés
  //    en artefact projet persisté (relisible via GET .../design/system).
  const systemArtifact = buildDesignSystemArtifact({
    report,
    direction: designDirection,
    dqi,
    recordedAt: new Date().toISOString(),
    tokens
  });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    designDirection,
    tokens,
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
  // LOT 1 (§11) — le dernier artefact Design System suit le dernier rapport.
  designSystemStore.record(systemArtifact);
  return true;
}
