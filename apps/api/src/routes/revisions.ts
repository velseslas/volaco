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
import { imageGateInspect, imageGateInputsFromFilesMap } from '../middleware/image-gate.js';
import {
  formatImageViolations,
  inspectAppImageSources,
  type AppImageInspection
} from '../../../../packages/core/src/image/app-policy.js';
import { adoptedImageIds } from '../../../../packages/core/src/image/image-adoptions.js';
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

    // PATCH-R3-B3 — la carte `payload.files` EST l'objet transmis ci-dessous à
    // createRevision : les valeurs string qu'elle contient sont EXACTEMENT ce
    // que createFileArtifact persistera. Inspection AVANT toute persistance :
    // en cas de violation ou d'erreur d'inspection, aucun artefact partiel.
    const gate = imageGateInspect(imageGateInputsFromFilesMap(payload.files));
    if (gate.kind !== 'clean') {
      logger.warn('Création de révision refusée par la porte d images', {
        component: 'revisions-route',
        projectId,
        refused: gate.kind,
        imageIssues: gate.imageIssues,
        requestId
      });
      res.statusCode = 200;
      res.end(JSON.stringify({
        success: false,
        refused: gate.kind === 'violations' ? 'images' : 'inspection-error',
        imageIssues: gate.imageIssues,
        requestId
      }));
      return true;
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

    // PATCH-2 — sécurité de publication par rollback. La révision cible est
    // LUE (pure lecture, aucune écriture) et son contenu EXACT est inspecté
    // AVANT toute autre opération : ni le FileStore, ni le workspace, ni
    // l'historique (aucune révision dérivée), ni le bundle ne peuvent être
    // pollués par un contenu refusé. À l'inverse du flux antérieur, le gate
    // d'images ne peut PLUS être contourné par le chemin du rollback.
    const target = revisionStore.getRevision(context.tenantId, projectId, targetRevId);
    if (!target) {
      throw new NotFoundError(`Révision cible pour rollback introuvable : ${targetRevId}`, requestId);
    }

    const targetInputs: Array<{ path: string; content: string }> = [];
    for (const [path, artifact] of Object.entries(target.files)) {
      const content = typeof artifact === 'string'
        ? artifact
        : (artifact as { content?: string }).content;
      if (typeof content === 'string' && content.length > 0) {
        targetInputs.push({
          path: path.startsWith('app/') ? path.slice(4) : path,
          content
        });
      }
    }

    // FAIL-CLOSED : toute erreur d'inspection (contenu inaccessible,
    // exception du vérificateur) refuse le rollback — jamais de contournement.
    let inspection: AppImageInspection;
    try {
      inspection = inspectAppImageSources(targetInputs, { adoptedIds: adoptedImageIds() });
    } catch (err) {
      logger.warn('Rollback refusé : inspection des images en échec', {
        component: 'revisions-route', projectId, revisionId: targetRevId,
        error: err instanceof Error ? err.message : String(err), requestId
      });
      res.statusCode = 200;
      res.end(JSON.stringify({
        success: false,
        refused: 'inspection-error',
        imageIssues: ['inspection des références d images en échec : rollback refusé par précaution'],
        requestId
      }));
      return true;
    }

    if (inspection.violations.length > 0) {
      const imageIssues = formatImageViolations(inspection);
      logger.warn('Rollback refusé : URLs d images interdites dans la révision cible', {
        component: 'revisions-route', projectId, revisionId: targetRevId,
        violations: imageIssues, requestId
      });
      res.statusCode = 200;
      res.end(JSON.stringify({ success: false, refused: 'images', imageIssues, requestId }));
      return true;
    }
    // Références undetermined : la politique du pipeline EXISTANT s'applique
    // (génération/édition : non bloquantes à la réinspection). Le rollback
    // reste cohérent avec ce que ce même pipeline a déjà accepté — jamais
    // déclaré CONFORME, simplement traité comme le pipeline le fait déjà.

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

    // PATCH-2 — wording honnête : un rebuild en échec n'est PAS un succès.
    // Le bundle publié (échange atomique de buildApp) reste la dernière
    // version VALIDE ; les fichiers restaurés restent ceux de la cible.
    let buildFailed = false;
    let buildErrors: string[] = [];
    if (appFilesRestored) {
      try {
        const build = await buildApp(projectId);
        if (!build.ok) {
          buildFailed = true;
          buildErrors = build.errors.slice(0, 4);
        }
      } catch (err) {
        buildFailed = true;
        buildErrors.push((err instanceof Error ? err.message : String(err)).slice(0, 1000));
        logger.warn('Rebuild post-rollback en échec', {
          component: 'revisions-route', projectId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      success: !buildFailed,
      ...(buildFailed ? { buildFailed, buildErrors } : {}),
      rollbackRevision,
      restoredFiles,
      requestId
    }));
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

