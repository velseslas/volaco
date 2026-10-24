/**
 * CDC §53 — route FinOps.
 *   GET /api/v1/finops/summary?projectId=…   (TENANT_MANAGE)
 *   GET /api/v1/projects/:projectId/finops   (PROJECT_READ — Cost/Project)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { summarizeFinOps } from '../../../../packages/core/src/ai/finops.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

export function handleFinopsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): boolean {
  // 1. GET /api/v1/finops/summary — vue tenant entière (Cost/User côté orga)
  if (req.method === 'GET' && pathname === '/api/v1/finops/summary') {
    assertPermission(context.role, 'TENANT_MANAGE', requestId);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const projectId = url.searchParams.get('projectId') ?? undefined;
    const summary = summarizeFinOps(context.tenantId, { projectId });
    res.statusCode = 200;
    res.end(JSON.stringify({ ...summary, requestId }));
    return true;
  }

  // 2. GET /api/v1/projects/:projectId/finops — Cost/Project
  const projectPrefix = '/api/v1/projects/';
  if (req.method === 'GET' && pathname.startsWith(projectPrefix) && pathname.endsWith('/finops')) {
    const middle = pathname.substring(projectPrefix.length, pathname.length - '/finops'.length);
    const projectId = middle.split('/')[0];
    if (!projectId || middle.includes('/')) {
      throw new ValidationError('projectId invalide', { field: 'projectId' }, requestId);
    }
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const summary = summarizeFinOps(context.tenantId, { projectId });
    res.statusCode = 200;
    res.end(JSON.stringify({ ...summary, requestId }));
    return true;
  }

  return false;
}
