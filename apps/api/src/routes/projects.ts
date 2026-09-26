import type { IncomingMessage, ServerResponse } from 'node:http';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

export async function handleProjectsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const base = '/api/v1/projects';

  // 1. GET /api/v1/projects : Liste les projets du tenant
  if (req.method === 'GET' && pathname === base) {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const projects = projectStore.listProjects(context.tenantId);
    res.statusCode = 200;
    res.end(JSON.stringify({ tenantId: context.tenantId, projects, requestId }));
    return true;
  }

  // 2. POST /api/v1/projects : CrÃ©e un projet pour le tenant
  if (req.method === 'POST' && pathname === base) {
    assertPermission(context.role, 'PROJECT_CREATE', requestId);
    const bodyText = await readBody(req);
    let payload: { name?: string; description?: string };
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requÃªte', undefined, requestId);
    }

    if (!payload.name || typeof payload.name !== 'string') {
      throw new ValidationError('Le champ "name" est obligatoire', undefined, requestId);
    }

    const project = projectStore.createProject(context.tenantId, payload.name, payload.description);
    res.statusCode = 201;
    res.end(JSON.stringify({ project, requestId }));
    return true;
  }

  // 3. Routes avec identifiant direct : /api/v1/projects/:id (sans sous-ressources comme /revisions)
  if (pathname.startsWith(base + '/')) {
    const remainder = pathname.substring(base.length + 1);
    // Si la route contient un sous-chemin (ex. /revisions), laisser la suite de la chaÃ®ne traiter
    if (remainder.includes('/')) {
      return false;
    }

    const id = remainder;
    if (!id) return false;

    // GET /api/v1/projects/:id
    if (req.method === 'GET') {
      assertPermission(context.role, 'PROJECT_READ', requestId);
      const project = projectStore.getProject(context.tenantId, id);
      if (!project) {
        throw new NotFoundError(`Projet ${id}`, requestId);
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ project, requestId }));
      return true;
    }

    // DELETE /api/v1/projects/:id
    if (req.method === 'DELETE') {
      assertPermission(context.role, 'PROJECT_DELETE', requestId);
      const deleted = projectStore.deleteProject(context.tenantId, id);
      if (!deleted) {
        throw new NotFoundError(`Projet ${id}`, requestId);
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, deletedId: id, requestId }));
      return true;
    }
  }

  return false;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', (err) => reject(err));
  });
}
