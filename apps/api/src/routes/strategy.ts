/**
 * VibeCode Core - API Tier
 * AI Strategy Optimizer Routes (AINT-016)
 */

import { logger } from '../../../../packages/core/src/logger.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  StrategyOptimizerService,
  StrategyConversationBridge,
  StrategyOrchestratorBridge,
  DecisionProvenanceEngine,
  type StrategyOptimizationRequest,
  type StrategicRecommendation
} from '../../../../packages/core/src/ai-native/strategy/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

export const strategyService = new StrategyOptimizerService();
export const strategyConversationBridge = new StrategyConversationBridge();
export const strategyOrchestratorBridge = new StrategyOrchestratorBridge();
export const decisionProvenanceEngine = new DecisionProvenanceEngine();

export async function handleStrategyRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const prefix = '/api/v1/projects/';

  // Check if route matches /api/v1/projects/:projectId/strategy*
  if (pathname.startsWith(prefix) && pathname.includes('/strategy')) {
    const afterPrefix = pathname.substring(prefix.length);
    const parts = afterPrefix.split('/');
    const projectId = parts[0];
    const subRoute = parts[1]; // 'strategy'
    const actionOrId = parts[2]; // e.g. 'analyze', 'recommendations', 'roadmap', 'compare'
    const subActionOrId = parts[3]; // e.g. ':recommendationId'
    const tailAction = parts[4]; // e.g. 'approve', 'reject'

    if (projectId && subRoute === 'strategy') {
      const project = projectStore.getProject(context.tenantId, projectId);
      if (!project) {
        throw new NotFoundError(`Projet ${projectId}`, requestId);
      }

      // 1. POST /api/v1/projects/:projectId/strategy/analyze or GET /api/v1/projects/:projectId/strategy
      if (!actionOrId || actionOrId === 'analyze') {
        assertPermission(context.role, 'PROJECT_READ', requestId);

        let payload: Partial<StrategyOptimizationRequest> = {};
        if (req.method === 'POST') {
          const bodyText = await readBody(req);
          if (bodyText && bodyText.trim().length > 0) {
            try {
              payload = JSON.parse(bodyText);
            } catch {
              throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
            }
          }
        }

        // Return cached report if GET and available
        if (req.method === 'GET') {
          const existing = strategyService.getReport(context.tenantId, projectId, context.role, requestId);
          if (existing) {
            const chatOverview = strategyConversationBridge.formatStrategyOverview(existing);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: true,
                report: existing,
                chatOverview,
                requestId
              })
            );
            return true;
          }
        }

        const optimizationRequest: StrategyOptimizationRequest = {
          tenantId: context.tenantId,
          projectId,
          ...(payload.dna ? { dna: payload.dna } : {}),
          ...(payload.auditReport ? { auditReport: payload.auditReport } : {}),
          ...(payload.featureReport ? { featureReport: payload.featureReport } : {}),
          ...(payload.feedbackReport ? { feedbackReport: payload.feedbackReport } : {}),
          ...(payload.semanticGraph ? { semanticGraph: payload.semanticGraph } : {}),
          ...(payload.impactReport ? { impactReport: payload.impactReport } : {}),
          ...(payload.options ? { options: payload.options } : {}),
          callerRole: context.role
        };

        const report = await strategyService.optimizeStrategy(optimizationRequest, requestId);
        const chatOverview = strategyConversationBridge.formatStrategyOverview(report);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            report,
            chatOverview,
            requestId
          })
        );
        return true;
      }

      // 2. GET /api/v1/projects/:projectId/strategy/recommendations
      if (actionOrId === 'recommendations' && !subActionOrId) {
        assertPermission(context.role, 'PROJECT_READ', requestId);

        let report = strategyService.getReport(context.tenantId, projectId, context.role, requestId);
        if (!report) {
          report = await strategyService.optimizeStrategy(
            { tenantId: context.tenantId, projectId, callerRole: context.role },
            requestId
          );
        }

        const prioritiesSummary = strategyConversationBridge.formatTopPriorities(report);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            totalCount: report.allRecommendations.length,
            topPriorities: report.topPriorities,
            recommendations: report.allRecommendations,
            prioritiesSummary,
            requestId
          })
        );
        return true;
      }

      // 3. GET /api/v1/projects/:projectId/strategy/recommendations/:recommendationId
      if (actionOrId === 'recommendations' && subActionOrId && !tailAction) {
        assertPermission(context.role, 'PROJECT_READ', requestId);

        let report = strategyService.getReport(context.tenantId, projectId, context.role, requestId);
        if (!report) {
          report = await strategyService.optimizeStrategy(
            { tenantId: context.tenantId, projectId, callerRole: context.role },
            requestId
          );
        }

        const rec = report.allRecommendations.find(r => r.id === subActionOrId);
        if (!rec) {
          throw new NotFoundError(`Recommandation ${subActionOrId}`, requestId);
        }

        const provenanceTrace = decisionProvenanceEngine.buildProvenanceTrace(rec);
        const whyExplanation = strategyConversationBridge.formatWhyExplanation(rec);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            recommendation: rec,
            provenanceTrace,
            whyExplanation,
            requestId
          })
        );
        return true;
      }

      // 4. POST /api/v1/projects/:projectId/strategy/recommendations/:recommendationId/approve
      if (actionOrId === 'recommendations' && subActionOrId && tailAction === 'approve') {
        assertPermission(context.role, 'PROJECT_UPDATE', requestId);

        const bodyText = await readBody(req);
        let reason = 'Approuvé par utilisateur';
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText);
            if (parsed.reason) reason = parsed.reason;
          } catch (err) {
            logger.warn('Corps de requête non-JSON ou invalide pour approveRecommendation — raison ignorée', {
              component: 'strategy-routes',
              action: 'approve',
              err: err instanceof Error ? err.message : String(err)
            });
          }
        }

        const result = await strategyService.approveRecommendation(
          context.tenantId,
          projectId,
          subActionOrId,
          context.role,
          reason,
          requestId
        );

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            result,
            requestId
          })
        );
        return true;
      }

      // 5. POST /api/v1/projects/:projectId/strategy/recommendations/:recommendationId/reject
      if (actionOrId === 'recommendations' && subActionOrId && tailAction === 'reject') {
        assertPermission(context.role, 'PROJECT_UPDATE', requestId);

        const bodyText = await readBody(req);
        let reason = 'Rejeté par utilisateur';
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText);
            if (parsed.reason) reason = parsed.reason;
          } catch (err) {
            logger.warn('Corps de requête non-JSON ou invalide pour rejectRecommendation — raison ignorée', {
              component: 'strategy-routes',
              action: 'reject',
              err: err instanceof Error ? err.message : String(err)
            });
          }
        }

        const result = await strategyService.rejectRecommendation(
          context.tenantId,
          projectId,
          subActionOrId,
          context.role,
          reason,
          requestId
        );

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            result,
            requestId
          })
        );
        return true;
      }

      // 6. POST or GET /api/v1/projects/:projectId/strategy/roadmap
      if (actionOrId === 'roadmap') {
        assertPermission(context.role, 'PROJECT_READ', requestId);

        let report = strategyService.getReport(context.tenantId, projectId, context.role, requestId);
        if (!report) {
          report = await strategyService.optimizeStrategy(
            { tenantId: context.tenantId, projectId, callerRole: context.role },
            requestId
          );
        }

        const roadmapSummary = strategyConversationBridge.formatRoadmap(report.roadmap);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            roadmap: report.roadmap,
            roadmapSummary,
            requestId
          })
        );
        return true;
      }

      // 7. POST /api/v1/projects/:projectId/strategy/compare
      if (actionOrId === 'compare') {
        assertPermission(context.role, 'PROJECT_READ', requestId);

        let report = strategyService.getReport(context.tenantId, projectId, context.role, requestId);
        if (!report) {
          report = await strategyService.optimizeStrategy(
            { tenantId: context.tenantId, projectId, callerRole: context.role },
            requestId
          );
        }

        const alternativesSummary = strategyConversationBridge.formatAlternatives(report.whatIfAnalysis);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            whatIfAnalysis: report.whatIfAnalysis,
            alternativesSummary,
            requestId
          })
        );
        return true;
      }
    }
  }

  return false;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
