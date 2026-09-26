import type { IncomingMessage, ServerResponse } from 'node:http';
import { DashboardService } from '../../../../packages/core/src/dashboard/service.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import type { RequestContext } from '../middleware/auth.js';

export const dashboardService = new DashboardService(projectStore, auditStore);

export function handleDashboardRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): boolean {
  // GET /api/v1/dashboard/summary
  if (req.method === 'GET' && pathname === '/api/v1/dashboard/summary') {
    const summary = dashboardService.getDashboardSummary(
      context.tenantId,
      undefined,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ summary, requestId }));
    return true;
  }

  return false;
}
