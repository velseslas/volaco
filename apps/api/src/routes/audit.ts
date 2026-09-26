import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ApplicationAuditService,
  ApplicationAuditConversationBridge,
  ApplicationAuditOrchestratorBridge,
  type AuditFileEntry,
  type ApplicationAuditRequest
} from '../../../../packages/core/src/ai-native/application-audit/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

export const applicationAuditService = new ApplicationAuditService();
export const conversationBridge = new ApplicationAuditConversationBridge();
export const orchestratorBridge = new ApplicationAuditOrchestratorBridge();

export async function handleAuditRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const prefix = '/api/v1/projects/';

  // 1. POST ou GET /api/v1/projects/:projectId/audit
  if (pathname.startsWith(prefix) && pathname.includes('/audit')) {
    const afterPrefix = pathname.substring(prefix.length);
    const parts = afterPrefix.split('/');
    const projectId = parts[0];
    const subAction = parts[1];

    if (projectId && subAction === 'audit') {
      if (req.method !== 'POST' && req.method !== 'GET') {
        return false;
      }

      assertPermission(context.role, 'PROJECT_READ', requestId);

      const project = projectStore.getProject(context.tenantId, projectId);
      if (!project) {
        throw new NotFoundError(`Projet ${projectId}`, requestId);
      }

      let payload: Partial<ApplicationAuditRequest> = {};
      if (req.method === 'POST') {
        const bodyText = await readBody(req);
        if (bodyText && bodyText.trim().length > 0) {
          try {
            payload = JSON.parse(bodyText);
          } catch {
            throw new ValidationError('JSON invalide dans le corps de la requête d audit', undefined, requestId);
          }
        }
      }

      // Résolution des fichiers : payload prioritaire, sinon FileStore
      let files: AuditFileEntry[] = [];
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
            content: '<!DOCTYPE html>\n<html lang="fr">\n<head><title>App</title></head>\n<body><div id="root"></div></body>\n</html>'
          }
        ];
      }

      const auditRequest: ApplicationAuditRequest = {
        tenantId: context.tenantId,
        projectId,
        files,
        ...(payload.dna ? { dna: payload.dna } : {}),
        ...(payload.snapshots ? { snapshots: payload.snapshots } : {}),
        ...(payload.designHarmonyReport ? { designHarmonyReport: payload.designHarmonyReport } : {}),
        ...(payload.config ? { config: payload.config } : {}),
        callerRole: context.role
      };

      const report = await applicationAuditService.analyzeApplication(
        auditRequest,
        context.role,
        requestId
      );

      const conversationSummary = conversationBridge.explainAuditReport(report);
      const remediationTasks = orchestratorBridge.proposeRemediationTasks(report);

      auditStore.record({
        tenantId: context.tenantId,
        userId: context.role,
        action: 'APPLICATION_AUDIT_EXECUTE',
        resourceType: 'APPLICATION_AUDIT',
        resourceId: report.reportId,
        status: 'SUCCESS',
        requestId,
        metadata: {
          overallScore: report.overallScore,
          totalFindings: report.summary.totalFindings,
          criticalCount: report.summary.criticalCount,
          auditHash: report.auditHash
        }
      });

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          report,
          conversationSummary,
          remediationTasks,
          requestId
        })
      );
      return true;
    }
  }

  // 2. POST /api/v1/audit (Audit direct in-memory)
  if (pathname === '/api/v1/audit' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);

    const bodyText = await readBody(req);
    let payload: Partial<ApplicationAuditRequest> = {};
    if (bodyText && bodyText.trim().length > 0) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        throw new ValidationError('JSON invalide dans le corps de la requête d audit', undefined, requestId);
      }
    }

    const tenantId = payload.tenantId || context.tenantId;
    const projectId = payload.projectId || 'in-memory-audit';

    const files: AuditFileEntry[] = Array.isArray(payload.files) && payload.files.length > 0
      ? payload.files.map((f: any) => ({ path: String(f.path || 'index.html'), content: String(f.content || '') }))
      : [{ path: 'index.html', content: '<!DOCTYPE html><html><body><h1>Audit</h1></body></html>' }];

    const auditRequest: ApplicationAuditRequest = {
      tenantId,
      projectId,
      files,
      ...(payload.dna ? { dna: payload.dna } : {}),
      ...(payload.snapshots ? { snapshots: payload.snapshots } : {}),
      ...(payload.designHarmonyReport ? { designHarmonyReport: payload.designHarmonyReport } : {}),
      ...(payload.config ? { config: payload.config } : {}),
      callerRole: context.role
    };

    const report = await applicationAuditService.analyzeApplication(
      auditRequest,
      context.role,
      requestId
    );

    const conversationSummary = conversationBridge.explainAuditReport(report);
    const remediationTasks = orchestratorBridge.proposeRemediationTasks(report);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        report,
        conversationSummary,
        remediationTasks,
        requestId
      })
    );
    return true;
  }

  return false;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', (err) => reject(err));
  });
}
