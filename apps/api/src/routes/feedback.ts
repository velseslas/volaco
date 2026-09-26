/**
 * VibeCode Core - API Tier
 * User Feedback & Bug Intelligence Routes (AINT-015)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  UserFeedbackService,
  ConversationBridge,
  FeedbackOrchestratorBridge,
  type FeedbackAnalysisRequest,
  type ProblemStatus
} from '../../../../packages/core/src/ai-native/user-feedback/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
export const userFeedbackService = new UserFeedbackService();
export const feedbackConversationBridge = new ConversationBridge();
export const feedbackOrchestratorBridge = new FeedbackOrchestratorBridge();

export async function handleFeedbackRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const prefix = '/api/v1/projects/';

  // 1. Routes associées à un projet : /api/v1/projects/:projectId/feedback/*
  if (pathname.startsWith(prefix) && pathname.includes('/feedback')) {
    const afterPrefix = pathname.substring(prefix.length);
    const parts = afterPrefix.split('/');
    const projectId = parts[0];
    const subRoute = parts[1]; // 'feedback'
    const problemId = parts[2]; // e.g. 'PRB-123' ou 'analyze' ou undefined
    const subAction = parts[3]; // e.g. 'lifecycle', 'plan'

    if (projectId && subRoute === 'feedback') {
      const project = projectStore.getProject(context.tenantId, projectId);
      if (!project) {
        throw new NotFoundError(`Projet ${projectId}`, requestId);
      }

      // 1.a POST /api/v1/projects/:projectId/feedback/analyze ou GET /api/v1/projects/:projectId/feedback
      if (!problemId || problemId === 'analyze') {
        assertPermission(context.role, 'PROJECT_READ', requestId);

        let payload: Partial<FeedbackAnalysisRequest> = {};
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

        // Si méthode GET et rapport déjà en cache, le renvoyer
        if (req.method === 'GET') {
          const existing = userFeedbackService.getReport(context.tenantId, projectId, context.role, requestId);
          if (existing) {
            const conversationSummary = feedbackConversationBridge.formatReportForChat(existing);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: true,
                report: existing,
                conversationSummary,
                requestId
              })
            );
            return true;
          }
        }

        const analysisRequest: FeedbackAnalysisRequest = {
          tenantId: context.tenantId,
          projectId,
          signals: payload.signals || [],
          rawFeedbacks: payload.rawFeedbacks || ['Application active'],
          errors: payload.errors || [],
          conversationTurns: payload.conversationTurns || [],
          ...(payload.dna ? { dna: payload.dna } : {}),
          ...(payload.auditReport ? { auditReport: payload.auditReport } : {}),
          ...(payload.existingDecisions ? { existingDecisions: payload.existingDecisions } : {}),
          ...(payload.config ? { config: payload.config } : {}),
          callerRole: context.role
        };

        const report = await userFeedbackService.analyzeFeedback(
          analysisRequest,
          context.role,
          requestId
        );

        const conversationSummary = feedbackConversationBridge.formatReportForChat(report);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            report,
            conversationSummary,
            requestId
          })
        );
        return true;
      }

      // 1.b POST /api/v1/projects/:projectId/feedback/:problemId/lifecycle
      if (problemId && subAction === 'lifecycle' && req.method === 'POST') {
        assertPermission(context.role, 'PROJECT_UPDATE', requestId);

        const bodyText = await readBody(req);
        let body: { newStatus?: ProblemStatus; reason?: string } = {};
        if (bodyText && bodyText.trim().length > 0) {
          try {
            body = JSON.parse(bodyText);
          } catch {
            throw new ValidationError('JSON invalide dans la requête de cycle de vie', undefined, requestId);
          }
        }

        if (!body.newStatus) {
          throw new ValidationError('newStatus est obligatoire', undefined, requestId);
        }

        const updatedProblem = await userFeedbackService.transitionProblemStatus({
          tenantId: context.tenantId,
          projectId,
          problemId,
          newStatus: body.newStatus,
          reason: body.reason,
          userRole: context.role,
          requestId
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            problem: updatedProblem,
            requestId
          })
        );
        return true;
      }

      // 1.c POST /api/v1/projects/:projectId/feedback/:problemId/plan
      if (problemId && subAction === 'plan' && req.method === 'POST') {
        assertPermission(context.role, 'PROJECT_UPDATE', requestId);

        const remediationPlan = await userFeedbackService.createRemediationPlan({
          tenantId: context.tenantId,
          projectId,
          problemId,
          userRole: context.role,
          requestId
        });

        auditStore.record({
          tenantId: context.tenantId,
          userId: context.role,
          action: 'FEEDBACK_REMEDIATION_PLAN_GENERATED',
          resourceType: 'remediation_plan',
          resourceId: problemId,
          status: 'SUCCESS',
          metadata: {
            projectId,
            problemId,
            tasksCount: remediationPlan.taskGraph.tasks.length,
            graphHash: remediationPlan.taskGraph.graphHash
          },
          requestId
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            plan: remediationPlan,
            requestId
          })
        );
        return true;
      }

      // 1.d GET /api/v1/projects/:projectId/feedback/:problemId
      if (problemId && !subAction && req.method === 'GET') {
        assertPermission(context.role, 'PROJECT_READ', requestId);

        const problem = userFeedbackService.getProblemById(context.tenantId, projectId, problemId, context.role, requestId);
        if (!problem) {
          throw new NotFoundError(`Problème ${problemId}`, requestId);
        }

        const conversationDetail = feedbackConversationBridge.formatProblemDetail(problem);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            problem,
            conversationDetail,
            requestId
          })
        );
        return true;
      }
    }
  }

  // 2. POST /api/v1/feedback/analyze (Analyse directe in-memory)
  if (pathname === '/api/v1/feedback/analyze' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);

    const bodyText = await readBody(req);
    let payload: Partial<FeedbackAnalysisRequest> = {};
    if (bodyText && bodyText.trim().length > 0) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        throw new ValidationError('JSON invalide dans la requête d analyse directe', undefined, requestId);
      }
    }

    const tenantId = payload.tenantId || context.tenantId;
    const projectId = payload.projectId || 'in-memory-feedback';

    const analysisRequest: FeedbackAnalysisRequest = {
      tenantId,
      projectId,
      signals: payload.signals || [],
      rawFeedbacks: payload.rawFeedbacks || ['Analyse in-memory'],
      errors: payload.errors || [],
      conversationTurns: payload.conversationTurns || [],
      ...(payload.dna ? { dna: payload.dna } : {}),
      ...(payload.auditReport ? { auditReport: payload.auditReport } : {}),
      ...(payload.existingDecisions ? { existingDecisions: payload.existingDecisions } : {}),
      ...(payload.config ? { config: payload.config } : {}),
      callerRole: context.role
    };

    const report = await userFeedbackService.analyzeFeedback(
      analysisRequest,
      context.role,
      requestId
    );

    const conversationSummary = feedbackConversationBridge.formatReportForChat(report);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        report,
        conversationSummary,
        requestId
      })
    );
    return true;
  }

  return false;
}

