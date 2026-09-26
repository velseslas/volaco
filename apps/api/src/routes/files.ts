import type { IncomingMessage, ServerResponse } from 'node:http';
import { FileExplorerService, fileStore } from '../../../../packages/core/src/file-explorer/index.js';
import { EditorService } from '../../../../packages/core/src/editor/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

export const fileExplorerService = new FileExplorerService(projectStore, fileStore, auditStore, revisionStore);
export const editorService = new EditorService(projectStore, fileStore, undefined, auditStore);

export async function handleFilesRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // Format attendu : /api/v1/projects/:projectId/files...
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix)) {
    return false;
  }

  const afterPrefix = pathname.substring(prefix.length);
  const parts = afterPrefix.split('/');
  const projectId = parts[0];
  const subRoute = parts[1];

  if (!projectId || subRoute !== 'files') {
    return false;
  }

  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  const action = parts[2]; // ex: 'content' ou 'rename'

  // 1. GET /api/v1/projects/:projectId/files/content?path=...
  if (req.method === 'GET' && action === 'content') {
    const rawPath = url.searchParams.get('path');
    if (!rawPath) {
      throw new ValidationError('Le paramètre de requête "path" est obligatoire', undefined, requestId);
    }

    const file = fileExplorerService.getFileContent(
      context.tenantId,
      projectId,
      rawPath,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ file, requestId }));
    return true;
  }

  // 1b. PUT /api/v1/projects/:projectId/files/content : Persistance du code (CORE-004)
  if (req.method === 'PUT' && action === 'content') {
    const bodyText = await readBody(req);
    let payload: { path?: string; content?: string };
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    if (!payload.path) {
      throw new ValidationError('Le champ "path" est obligatoire', undefined, requestId);
    }
    if (typeof payload.content !== 'string') {
      throw new ValidationError('Le champ "content" est obligatoire et doit être une chaîne', undefined, requestId);
    }

    const saved = editorService.saveFile(
      context.tenantId,
      projectId,
      { path: payload.path, content: payload.content },
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ result: saved, requestId }));
    return true;
  }

  // 2. GET /api/v1/projects/:projectId/files : Récupérer l'arborescence
  if (req.method === 'GET' && !action) {
    const summary = fileExplorerService.getFilesSummary(
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

  // 3. POST /api/v1/projects/:projectId/files/rename
  if (req.method === 'POST' && action === 'rename') {
    const bodyText = await readBody(req);
    let payload: { oldPath?: string; newPath?: string };
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    if (!payload.oldPath || !payload.newPath) {
      throw new ValidationError('Les champs "oldPath" et "newPath" sont obligatoires', undefined, requestId);
    }

    const renamed = fileExplorerService.renameFile(
      context.tenantId,
      projectId,
      { oldPath: payload.oldPath, newPath: payload.newPath },
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ file: renamed, requestId }));
    return true;
  }

  // 4. POST /api/v1/projects/:projectId/files : Créer un fichier ou un dossier
  if (req.method === 'POST' && !action) {
    const bodyText = await readBody(req);
    let payload: { path?: string; type?: 'file' | 'directory'; content?: string };
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    if (!payload.path) {
      throw new ValidationError('Le champ "path" est obligatoire', undefined, requestId);
    }

    const created = fileExplorerService.createFile(
      context.tenantId,
      projectId,
      {
        path: payload.path,
        type: payload.type || 'file',
        content: payload.content
      },
      context.role,
      requestId
    );

    res.statusCode = 201;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ file: created, requestId }));
    return true;
  }

  // 5. DELETE /api/v1/projects/:projectId/files?path=...
  if (req.method === 'DELETE' && !action) {
    const rawPath = url.searchParams.get('path');
    if (!rawPath) {
      throw new ValidationError('Le paramètre de requête "path" est obligatoire pour la suppression', undefined, requestId);
    }

    const deleted = fileExplorerService.deleteFile(
      context.tenantId,
      projectId,
      rawPath,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: deleted, deletedPath: rawPath, requestId }));
    return true;
  }

  // 6. POST /api/v1/projects/:projectId/files/commit (CAPP-002: Association des changements à une révision)
  if (req.method === 'POST' && action === 'commit') {
    const bodyText = await readBody(req);
    let payload: { message?: string; author?: string };
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    if (!payload.message) {
      throw new ValidationError('Le champ "message" est obligatoire pour commiter l\'arbre', undefined, requestId);
    }

    const revision = fileExplorerService.commitTreeToRevision(
      context.tenantId,
      projectId,
      payload.message,
      payload.author || context.role,
      undefined,
      context.role,
      requestId
    );

    res.statusCode = 201;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ revision, requestId }));
    return true;
  }

  // 7. POST /api/v1/projects/:projectId/files/move (CAPP-003: Déplacement de fichier ou dossier)
  if (req.method === 'POST' && action === 'move') {
    const bodyText = await readBody(req);
    let payload: { oldPath?: string; newPath?: string };
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    if (!payload.oldPath || !payload.newPath) {
      throw new ValidationError('Les champs "oldPath" et "newPath" sont obligatoires pour le déplacement', undefined, requestId);
    }

    const moved = fileExplorerService.moveFile(
      context.tenantId,
      projectId,
      { oldPath: payload.oldPath, newPath: payload.newPath },
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ file: moved, requestId }));
    return true;
  }

  // 8. POST /api/v1/projects/:projectId/files/operation (CAPP-003: Moteur unifié d'opérations sur les fichiers)
  if (req.method === 'POST' && action === 'operation') {
    const bodyText = await readBody(req);
    let payload: any;
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    if (!payload || !payload.type) {
      throw new ValidationError('Le champ "type" de l\'opération est obligatoire', undefined, requestId);
    }
    if (!payload.path) {
      throw new ValidationError('Le champ "path" est obligatoire pour l\'opération', undefined, requestId);
    }

    const result = fileExplorerService.executeOperation(
      context.tenantId,
      projectId,
      payload,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ result, requestId }));
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
