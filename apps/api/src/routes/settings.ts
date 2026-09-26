import type { IncomingMessage, ServerResponse } from 'node:http';
import { SettingsService } from '../../../../packages/core/src/settings/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
export const settingsService = new SettingsService(projectStore, auditStore);

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // Format attendu : /api/v1/projects/:projectId/settings
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix)) {
    return false;
  }

  const afterPrefix = pathname.substring(prefix.length);
  const parts = afterPrefix.split('/');
  const projectId = parts[0];
  const subRoute = parts[1];

  if (!projectId || subRoute !== 'settings') {
    return false;
  }

  // 1. GET /api/v1/projects/:projectId/settings
  if (req.method === 'GET') {
    const settings = settingsService.getSettings(
      context.tenantId,
      projectId,
      true,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ settings, requestId }));
    return true;
  }

  // 2. PUT /api/v1/projects/:projectId/settings
  if (req.method === 'PUT') {
    const bodyText = await readBody(req);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    const updated = settingsService.updateSettings(
      context.tenantId,
      projectId,
      payload,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ settings: updated, requestId }));
    return true;
  }

  return false;
}

