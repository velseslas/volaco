import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ProjectStateService,
  projectStateStore
} from '../../../../packages/core/src/project-state/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { WorkspaceService } from '../../../../packages/core/src/workspace/service.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
export const workspaceServiceInstance = new WorkspaceService(projectStore, auditStore, fileStore, revisionStore);
export const projectStateService = new ProjectStateService(
  projectStore,
  projectStateStore,
  revisionStore,
  workspaceServiceInstance,
  auditStore,
  fileStore
);

export async function handleProjectStateRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix)) {
    return false;
  }

  const afterPrefix = pathname.substring(prefix.length);
  const parts = afterPrefix.split('/');
  const projectId = parts[0];
  const subRoute = parts[1]; // 'state', 'status', 'validate', 'activity'

  if (!projectId) {
    return false;
  }

  // 1. GET /api/v1/projects/:projectId/state
  if (req.method === 'GET' && subRoute === 'state') {
    const state = projectStateService.getProjectState(
      context.tenantId,
      projectId,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ state, requestId }));
    return true;
  }

  // 2. PUT /api/v1/projects/:projectId/status
  if (req.method === 'PUT' && subRoute === 'status') {
    const bodyText = await readBody(req);
    let payload: { status?: any; reason?: string };
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    if (!payload.status) {
      throw new ValidationError('Le champ "status" est obligatoire', undefined, requestId);
    }

    const state = projectStateService.updateProjectStatus(
      context.tenantId,
      projectId,
      { status: payload.status, reason: payload.reason },
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ state, requestId }));
    return true;
  }

  // 3. POST /api/v1/projects/:projectId/validate
  if (req.method === 'POST' && subRoute === 'validate') {
    const bodyText = await readBody(req);
    let payload: { checks?: any } = {};
    if (bodyText && bodyText.trim().length > 0) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
      }
    }

    const validation = projectStateService.runProjectValidation(
      context.tenantId,
      projectId,
      { checks: payload.checks },
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ validation, requestId }));
    return true;
  }

  // 4. GET /api/v1/projects/:projectId/activity
  if (req.method === 'GET' && subRoute === 'activity') {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 20;

    const activity = projectStateService.getRecentActivity(
      context.tenantId,
      projectId,
      limit,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ activity, count: activity.length, requestId }));
    return true;
  }

  return false;
}

