import type { IncomingMessage, ServerResponse } from 'node:http';
import { WorkspaceService } from '../../../../packages/core/src/workspace/service.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
export const workspaceService = new WorkspaceService(projectStore, auditStore, fileStore, revisionStore);

export async function handleWorkspaceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // Format attendu : /api/v1/projects/:projectId/workspace ou /api/v1/projects/:projectId/summary
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix)) {
    return false;
  }

  const afterPrefix = pathname.substring(prefix.length);
  const parts = afterPrefix.split('/');
  const projectId = parts[0];
  const subRoute = parts[1];

  if (!projectId || (subRoute !== 'workspace' && subRoute !== 'summary')) {
    return false;
  }

  // 1. GET /api/v1/projects/:projectId/summary (CAPP-001)
  if (req.method === 'GET' && subRoute === 'summary') {
    const summary = workspaceService.getProjectSummary(
      context.tenantId,
      projectId,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ summary, requestId }));
    return true;
  }

  // 2. GET /api/v1/projects/:projectId/workspace (CAPP-001)
  if (req.method === 'GET' && subRoute === 'workspace') {
    const workspace = workspaceService.getWorkspace(
      context.tenantId,
      projectId,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ workspace, requestId }));
    return true;
  }

  // 3. PUT /api/v1/projects/:projectId/workspace (CAPP-001)
  if (req.method === 'PUT' && subRoute === 'workspace') {
    const bodyText = await readBody(req);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    const updated = workspaceService.updateWorkspaceState(
      context.tenantId,
      projectId,
      payload,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ workspace: updated, requestId }));
    return true;
  }

  return false;
}

