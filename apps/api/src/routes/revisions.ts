import type { IncomingMessage, ServerResponse } from 'node:http';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/index.js';
import { buildApp, writeAppFile } from '../../../../packages/core/src/app-pipeline.js';
import { logger } from '../../../../packages/core/src/logger.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
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

    // E40 — le rollback est HONNÊTE : les fichiers restaurés sont écrits
    // dans le FileStore (sinon l'index.html réel resterait sur l'état
    // antérieur et seule l'historique aurait changé).
    let restoredFiles = 0;
    let appFilesRestored = false;
    for (const [path, artifact] of Object.entries(rollbackRevision.files)) {
      const content = typeof artifact === 'string'
        ? artifact
        : (artifact as { content?: string }).content;
      if (typeof content === 'string' && content.length > 0) {
        fileStore.saveFile(context.tenantId, projectId, path, content);
        restoredFiles += 1;
        // P5 — les fichiers app/* (projets React) sont re-syncronisés dans
        // le workspace de build et le bundle est reconstruit.
        if (path.startsWith('app/')) {
          const writeRes = writeAppFile(projectId, path.slice(4), content);
          if (writeRes.ok) appFilesRestored = true;
        }
      }
    }
    if (appFilesRestored) {
      try {
        await buildApp(projectId);
      } catch (err) {
        logger.warn('Rebuild post-rollback en échec', {
          component: 'revisions-route', projectId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, rollbackRevision, restoredFiles, requestId }));
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

