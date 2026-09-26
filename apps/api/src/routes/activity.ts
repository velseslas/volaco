import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  projectActivityService
} from '../../../../packages/core/src/activity/index.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
export async function handleActivityRoutes(
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
  const subRoute = parts[1]; // 'history' ou 'activity'
  const action = parts[2];   // 'seed' ou undefined

  if (!projectId || (subRoute !== 'history' && subRoute !== 'activity')) {
    return false;
  }

  // 1. POST /api/v1/projects/:projectId/history/seed (Initialise la séquence de référence CAPP-007)
  if (req.method === 'POST' && action === 'seed') {
    const seeded = projectActivityService.seedReferenceHistory(
      context.tenantId,
      projectId,
      context.role,
      requestId
    );

    res.statusCode = 201;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      count: seeded.length,
      history: seeded,
      requestId
    }));
    return true;
  }

  // 2. GET /api/v1/projects/:projectId/history
  if (req.method === 'GET' && !action) {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const limitParam = url.searchParams.get('limit');
    const orderParam = url.searchParams.get('order');
    const typeParam = url.searchParams.get('type');
    const actorTypeParam = url.searchParams.get('actorType');

    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const order = orderParam === 'ASC' ? 'ASC' : 'DESC';

    const history = projectActivityService.getProjectHistory(
      context.tenantId,
      projectId,
      {
        limit,
        order,
        ...(typeParam ? { type: typeParam as any } : {}),
        ...(actorTypeParam ? { actorType: actorTypeParam as any } : {})
      },
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      history,
      total: history.length,
      requestId
    }));
    return true;
  }

  // 3. POST /api/v1/projects/:projectId/history (Création manuelle d'une entrée)
  if (req.method === 'POST' && !action) {
    const bodyText = await readBody(req);
    let payload: any;
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    const activity = projectActivityService.recordActivity(
      context.tenantId,
      projectId,
      payload,
      context.role,
      requestId
    );

    res.statusCode = 201;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      activity,
      requestId
    }));
    return true;
  }

  return false;
}

