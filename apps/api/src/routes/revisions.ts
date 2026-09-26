import type { IncomingMessage, ServerResponse } from 'node:http';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

export async function handleRevisionsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // Motif : /api/v1/projects/:projectId/revisions[/:revisionId][/rollback]
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix)) return false;

  const remainder = pathname.slice(prefix.length);
  const parts = remainder.split('/');
  if (parts.length < 2 || parts[1] !== 'revisions') return false;

  const projectId = parts[0];
  if (!projectId) return false;

  // VÃ©rifier que le projet existe et appartient au tenant
  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    throw new NotFoundError(`Projet ${projectId}`, requestId);
  }

  // 1. GET /api/v1/projects/:projectId/revisions
  if (req.method === 'GET' && parts.length === 2) {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const revisions = revisionStore.listRevisions(context.tenantId, projectId);
    res.statusCode = 200;
    res.end(JSON.stringify({ projectId, revisions, requestId }));
    return true;
  }

  // 2. POST /api/v1/projects/:projectId/revisions
  if (req.method === 'POST' && parts.length === 2) {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const bodyText = await readBody(req);
    let payload: any;
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide', undefined, requestId);
    }

    if (!payload.message || !payload.files) {
      throw new ValidationError('Champs "message" et "files" obligatoires', undefined, requestId);
    }

    const revision = revisionStore.createRevision(context.tenantId, projectId, {
      message: payload.message,
      author: payload.author || 'engineer',
      files: payload.files,
      decisions: payload.decisions || [],
      provenance: payload.provenance || { source: 'USER', triggerRequestId: requestId }
    });

    res.statusCode = 201;
    res.end(JSON.stringify({ revision, requestId }));
    return true;
  }

  // 3. POST /api/v1/projects/:projectId/revisions/:id/rollback
  if (req.method === 'POST' && parts.length === 4 && parts[3] === 'rollback') {
    const targetRevId = parts[2];
    if (!targetRevId) return false;
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);

    const rollbackRevision = revisionStore.rollbackTo(
      context.tenantId,
      projectId,
      targetRevId,
      'engineer',
      requestId
    );

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, rollbackRevision, requestId }));
    return true;
  }

  // 4. GET /api/v1/projects/:projectId/revisions/:id
  if (req.method === 'GET' && parts.length === 3) {
    const revId = parts[2];
    if (!revId) return false;
    assertPermission(context.role, 'PROJECT_READ', requestId);

    const revision = revisionStore.getRevision(context.tenantId, projectId, revId);
    if (!revision) {
      throw new NotFoundError(`RÃ©vision ${revId}`, requestId);
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ revision, requestId }));
    return true;
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
