import type { IncomingMessage, ServerResponse } from 'node:http';
import { metricsCollector } from '../../../../packages/core/src/observability/metrics.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { aiUsageTracker } from '../../../../packages/core/src/ai/usage.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import type { RequestContext } from '../middleware/auth.js';

export function handleObservabilityRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): boolean {
  // 1. GET /api/v1/metrics
  if (req.method === 'GET' && (pathname === '/metrics' || pathname === '/api/v1/metrics')) {
    const metrics = metricsCollector.getMetricsSummary();
    res.statusCode = 200;
    res.end(JSON.stringify({ metrics, requestId }));
    return true;
  }

  // 2. GET /api/v1/audit : Journal d'audit du tenant
  if (req.method === 'GET' && pathname === '/api/v1/audit') {
    assertPermission(context.role, 'TENANT_MANAGE', requestId);
    const events = auditStore.query(context.tenantId);
    res.statusCode = 200;
    res.end(JSON.stringify({ tenantId: context.tenantId, events, requestId }));
    return true;
  }

  // 3. GET /api/v1/ai/usage : Suivi des coÃ»ts et tokens IA
  if (req.method === 'GET' && pathname === '/api/v1/ai/usage') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const usage = aiUsageTracker.getUsageSummary(context.tenantId);
    res.statusCode = 200;
    res.end(JSON.stringify({ usage, requestId }));
    return true;
  }

  return false;
}
