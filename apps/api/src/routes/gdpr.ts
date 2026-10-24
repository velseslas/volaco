/**
 * CDC §50 — Data Governance : tranche RGPD V1.
 *   GET    /api/v1/gdpr/export  (TENANT_MANAGE) — portabilité : tout le jeu de
 *          données du tenant (projets, usage IA, journal d'audit) en JSON.
 *   DELETE /api/v1/gdpr/erase   (TENANT_MANAGE) — droit à l'effacement :
 *          supprime tous les projets du tenant (cascade fichiers/révisions,
 *          best-effort orphelins, identique à DELETE /projects/:id).
 * Chaque opération est inscrite au journal d'audit.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { aiUsageTracker } from '../../../../packages/core/src/ai/usage.js';
import type { RequestContext } from '../middleware/auth.js';

export function handleGdprRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): boolean {
  // 1. GET /api/v1/gdpr/export — portabilité (CDC §50 : portability)
  if (req.method === 'GET' && pathname === '/api/v1/gdpr/export') {
    assertPermission(context.role, 'TENANT_MANAGE', requestId);

    const projects = projectStore.listProjects(context.tenantId);
    const usage = aiUsageTracker.getRecordsFor(context.tenantId);
    const audit = auditStore.query(context.tenantId);

    auditStore.record({
      tenantId: context.tenantId,
      userId: context.tenantId,
      action: 'GDPR_EXPORT',
      resourceType: 'tenant',
      resourceId: context.tenantId,
      status: 'SUCCESS',
      metadata: { projects: projects.length, usageRecords: usage.length },
      requestId: requestId ?? 'req_gdpr_export'
    });

    res.statusCode = 200;
    res.setHeader('Content-Disposition', `attachment; filename="volaco-export-${context.tenantId}.json"`);
    res.end(JSON.stringify({
      exportedAt: new Date().toISOString(),
      tenantId: context.tenantId,
      format: 'volaco-gdpr-export/1',
      projects,
      usage,
      audit
    }, null, 2));
    return true;
  }

  // 2. DELETE /api/v1/gdpr/erase — droit à l'effacement (CDC §50 : deletion)
  if (req.method === 'DELETE' && pathname === '/api/v1/gdpr/erase') {
    assertPermission(context.role, 'TENANT_MANAGE', requestId);

    const projects = projectStore.listProjects(context.tenantId);
    let deleted = 0;
    const failed: string[] = [];
    for (const project of projects) {
      const ok = projectStore.deleteProject(context.tenantId, project.id);
      if (ok) deleted += 1;
      else failed.push(project.id);
    }

    auditStore.record({
      tenantId: context.tenantId,
      userId: context.tenantId,
      action: 'GDPR_ERASE',
      resourceType: 'tenant',
      resourceId: context.tenantId,
      status: failed.length === 0 ? 'SUCCESS' : 'FAILURE',
      metadata: { requested: projects.length, deleted, failed },
      requestId: requestId ?? 'req_gdpr_erase'
    });

    res.statusCode = 200;
    res.end(JSON.stringify({
      tenantId: context.tenantId,
      requested: projects.length,
      deleted,
      failed,
      requestId
    }));
    return true;
  }

  return false;
}
