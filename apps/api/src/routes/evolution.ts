/**
 * VibeCode Core - API Tier
 * CDC §31 — Route d'évolution applicative : POST .../evolution/analyze.
 *
 * Avant cette route, le moteur `ai-native/evolution/*` (AINT-017) était
 * ORPHELIN : complet, testé, jamais branché. Cette route l'exécute sur des
 * sources RÉELLES assemblées ici :
 *  - rapport d'audit applicatif AINT-013 (fichiers + snapshot visuel +
 *    dernier rapport d'harmonie design persisté s'il existe) ;
 *  - opportunités produit AINT-014 (dérivées des fichiers + de l'audit).
 * Le rapport est consultatif : aucune mutation de code (Human Control).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ApplicationAuditService,
  type AuditFileEntry
} from '../../../../packages/core/src/ai-native/application-audit/index.js';
import { FeatureIntelligenceService } from '../../../../packages/core/src/ai-native/feature-intelligence/index.js';
import { EvolutionService } from '../../../../packages/core/src/ai-native/evolution/index.js';
import { VisualIntelligenceService } from '../../../../packages/core/src/ai-native/visual-intelligence/service.js';
import type { VisualSnapshot } from '../../../../packages/core/src/ai-native/visual-intelligence/types.js';
import { designReportStore } from '../../../../packages/core/src/ai-native/design-harmony/report-store.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';

const auditService = new ApplicationAuditService();
const featureService = new FeatureIntelligenceService();
const evolutionService = new EvolutionService();
const visualService = new VisualIntelligenceService();

export async function handleEvolutionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // POST /api/v1/projects/:projectId/evolution/analyze
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix)) {
    return false;
  }
  const parts = pathname.substring(prefix.length).split('/');
  const projectId = parts[0];
  if (!projectId || parts[1] !== 'evolution' || parts[2] !== 'analyze') {
    return false;
  }
  if (req.method !== 'POST') {
    return false;
  }

  assertPermission(context.role, 'PROJECT_READ', requestId);

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    throw new NotFoundError(`Projet ${projectId}`, requestId);
  }

  let forceRecompute = false;
  const bodyText = await readBody(req);
  if (bodyText && bodyText.trim().length > 0) {
    let payload: { forceRecompute?: unknown };
    try {
      payload = JSON.parse(bodyText) as { forceRecompute?: unknown };
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête d évolution', undefined, requestId);
    }
    if (payload.forceRecompute !== undefined) {
      if (typeof payload.forceRecompute !== 'boolean') {
        throw new ValidationError('Le champ "forceRecompute" doit être un booléen', undefined, requestId);
      }
      forceRecompute = payload.forceRecompute;
    }
  }

  // 1. Fichiers réels du projet → entrées d'audit.
  const storedFiles = fileStore.getAllProjectFiles(context.tenantId, projectId);
  const files: AuditFileEntry[] = Object.entries(storedFiles).map(([path, content]) => ({ path, content }));

  // 2. Snapshot visuel de l'entrée HTML (si présente) — alimente les
  // auditeurs accessibilité/UX. Un échec visuel ne bloque pas l'audit
  // (les auditeurs fichiers continuent) : il est simplement absent.
  let snapshots: VisualSnapshot[] = [];
  const htmlContent = storedFiles['index.html'];
  if (htmlContent && htmlContent.trim().length > 0) {
    try {
      const analysis = await visualService.analyzeVisuals(
        { tenantId: context.tenantId, projectId, htmlContent, requestId },
        context.role
      );
      snapshots = [analysis.snapshot];
    } catch {
      snapshots = [];
    }
  }

  // 3. Dernier rapport d'harmonie design persisté (s'il existe — jamais fabriqué).
  const latestDesignReport = designReportStore.get(context.tenantId, projectId);

  const auditReport = await auditService.analyzeApplication(
    {
      tenantId: context.tenantId,
      projectId,
      files,
      ...(snapshots.length > 0 ? { snapshots } : {}),
      ...(latestDesignReport ? { designHarmonyReport: latestDesignReport } : {}),
      callerRole: context.role
    },
    context.role,
    requestId
  );

  // 4. Opportunités produit réelles (AINT-014) — nourries par les fichiers
  // et le rapport d'audit fraîchement calculé.
  const featureReport = await featureService.discoverOpportunities(
    {
      tenantId: context.tenantId,
      projectId,
      files,
      auditReport,
      callerRole: context.role
    },
    context.role,
    requestId
  );

  // 5. Moteur d'évolution (AINT-017) — évidence → état → propositions.
  const report = evolutionService.analyze(
    {
      tenantId: context.tenantId,
      projectId,
      callerRole: context.role,
      sources: { auditReport, featureReport },
      options: { forceRecompute }
    },
    context.role,
    requestId
  );

  auditStore.record({
    tenantId: context.tenantId,
    userId: context.role,
    action: 'EVOLUTION_ANALYZE',
    resourceType: 'EVOLUTION_REPORT',
    resourceId: report.id,
    status: 'SUCCESS',
    requestId,
    metadata: {
      readinessStatus: report.readinessStatus,
      proposalsCount: report.proposals.length,
      totalEvidence: report.totalEvidenceEvaluated,
      reportHash: report.reportHash
    }
  });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ report, requestId }));
  return true;
}
