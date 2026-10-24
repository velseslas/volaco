/**
 * VibeCode Core - API Tier
 * Feature Intelligence & Product Evolution Routes (AINT-014)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FeatureIntelligenceService,
  FeatureConversationBridge,
  FeatureOrchestratorBridge,
  type FeatureFileEntry,
  type FeatureDiscoveryRequest,
  type FeatureOpportunityStatus
} from '../../../../packages/core/src/ai-native/feature-intelligence/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
export const featureIntelligenceService = new FeatureIntelligenceService();
export const featureConversationBridge = new FeatureConversationBridge();
export const featureOrchestratorBridge = new FeatureOrchestratorBridge();

export async function handleFeatureIntelligenceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const prefix = '/api/v1/projects/';

  // 1. Routes associées à un projet : /api/v1/projects/:projectId/features/*
  if (pathname.startsWith(prefix) && pathname.includes('/features')) {
    const afterPrefix = pathname.substring(prefix.length);
    const parts = afterPrefix.split('/');
    const projectId = parts[0];
    const subRoute = parts[1]; // 'features'
    const featureId = parts[2]; // e.g. 'gap-search-filter' ou undefined
    const subAction = parts[3]; // e.g. 'lifecycle', 'plan'

    if (projectId && subRoute === 'features') {
      const project = projectStore.getProject(context.tenantId, projectId);
      if (!project) {
        throw new NotFoundError(`Projet ${projectId}`, requestId);
      }

      // 1.a POST /api/v1/projects/:projectId/features/analyze ou GET /api/v1/projects/:projectId/features
      if (!featureId || featureId === 'analyze') {
        assertPermission(context.role, 'PROJECT_READ', requestId);

        let payload: Partial<FeatureDiscoveryRequest> = {};
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

        // Récupération des fichiers : payload prioritaire, sinon FileStore
        let files: FeatureFileEntry[] = [];
        if (payload.files && Array.isArray(payload.files) && payload.files.length > 0) {
          files = payload.files.map((f: any) => ({
            path: String(f.path || 'index.html'),
            content: String(f.content || '')
          }));
        } else {
          const storedFiles = fileStore.getAllProjectFiles(context.tenantId, projectId);
          files = Object.entries(storedFiles).map(([path, content]) => ({
            path,
            content
          }));
        }

        if (files.length === 0) {
          files = [
            {
              path: 'index.html',
              content: '<!DOCTYPE html><html><body><h1>App</h1></body></html>'
            }
          ];
        }

        const discoveryRequest: FeatureDiscoveryRequest = {
          tenantId: context.tenantId,
          projectId,
          files,
          ...(payload.dna ? { dna: payload.dna } : {}),
          ...(payload.auditReport ? { auditReport: payload.auditReport } : {}),
          ...(payload.conversationHistory ? { conversationHistory: payload.conversationHistory } : {}),
          ...(payload.existingDecisions ? { existingDecisions: payload.existingDecisions } : {}),
          ...(payload.config ? { config: payload.config } : {}),
          callerRole: context.role
        };

        const report = await featureIntelligenceService.discoverOpportunities(
          discoveryRequest,
          context.role,
          requestId
        );

        const conversationSummary = featureConversationBridge.explainReport(report);

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

      // 1.b POST /api/v1/projects/:projectId/features/:featureId/lifecycle
      if (featureId && subAction === 'lifecycle' && req.method === 'POST') {
        assertPermission(context.role, 'PROJECT_UPDATE', requestId);

        const bodyText = await readBody(req);
        let body: { newStatus?: FeatureOpportunityStatus; reason?: string } = {};
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

        const updatedOpportunity = await featureIntelligenceService.transitionOpportunityStatus({
          tenantId: context.tenantId,
          projectId,
          featureId,
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
            opportunity: updatedOpportunity,
            requestId
          })
        );
        return true;
      }

      // 1.c POST /api/v1/projects/:projectId/features/:featureId/plan
      if (featureId && subAction === 'plan' && req.method === 'POST') {
        assertPermission(context.role, 'PROJECT_UPDATE', requestId);

        const candidate = featureIntelligenceService.getOpportunityById(context.tenantId, projectId, featureId);
        if (!candidate) {
          throw new NotFoundError(`Opportunité ${featureId}`, requestId);
        }

        const engineeringPlan = featureOrchestratorBridge.createEngineeringPlan(candidate);

        auditStore.record({
          tenantId: context.tenantId,
          userId: context.role,
          action: 'FEATURE_ENGINEERING_PLAN_GENERATED',
          resourceType: 'feature_candidate',
          resourceId: featureId,
          status: 'SUCCESS',
          metadata: {
            projectId,
            featureTitle: candidate.title,
            tasksCount: engineeringPlan.taskGraph.tasks.length,
            graphHash: engineeringPlan.taskGraph.graphHash
          },
          requestId
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            plan: engineeringPlan,
            requestId
          })
        );
        return true;
      }

      // 1.d GET /api/v1/projects/:projectId/features/:featureId
      if (featureId && !subAction && req.method === 'GET') {
        assertPermission(context.role, 'PROJECT_READ', requestId);

        const candidate = featureIntelligenceService.getOpportunityById(context.tenantId, projectId, featureId);
        if (!candidate) {
          throw new NotFoundError(`Opportunité ${featureId}`, requestId);
        }

        const conversationSummary = featureConversationBridge.explainOpportunity(candidate);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: true,
            opportunity: candidate,
            conversationSummary,
            requestId
          })
        );
        return true;
      }
    }
  }

  // 2. POST /api/v1/features/analyze (Analyse directe in-memory)
  if (pathname === '/api/v1/features/analyze' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);

    const bodyText = await readBody(req);
    let payload: Partial<FeatureDiscoveryRequest> = {};
    if (bodyText && bodyText.trim().length > 0) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        throw new ValidationError('JSON invalide dans la requête d analyse directe', undefined, requestId);
      }
    }

    const tenantId = context.tenantId; // SÉCURITÉ (SEC-TENANT) : le tenant ne vient JAMAIS du corps — un client ne choisit pas son locataire.
    const projectId = payload.projectId || 'in-memory-features';

    const files: FeatureFileEntry[] = Array.isArray(payload.files) && payload.files.length > 0
      ? payload.files.map((f: any) => ({ path: String(f.path || 'index.html'), content: String(f.content || '') }))
      : [{ path: 'index.html', content: '<!DOCTYPE html><html><body><h1>Direct Analysis</h1></body></html>' }];

    const discoveryRequest: FeatureDiscoveryRequest = {
      tenantId,
      projectId,
      files,
      ...(payload.dna ? { dna: payload.dna } : {}),
      ...(payload.auditReport ? { auditReport: payload.auditReport } : {}),
      ...(payload.conversationHistory ? { conversationHistory: payload.conversationHistory } : {}),
      ...(payload.existingDecisions ? { existingDecisions: payload.existingDecisions } : {}),
      ...(payload.config ? { config: payload.config } : {}),
      callerRole: context.role
    };

    const report = await featureIntelligenceService.discoverOpportunities(
      discoveryRequest,
      context.role,
      requestId
    );

    const conversationSummary = featureConversationBridge.explainReport(report);

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

