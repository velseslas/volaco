/**
 * VibeCode Core - API Tier
 * Real Render Routes — vrai aperçu visuel (navigateur headless réel).
 *
 * IMPORTANT : cette route dépend du module `real-renderer.ts`, écrit sans
 * pouvoir être testé avec un vrai navigateur dans l'environnement de
 * rédaction. À vérifier concrètement avant toute mise en production —
 * voir CORRECTIONS.md pour la procédure.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderProjectPreview } from '../../../../packages/core/src/ai-native/visual-intelligence/real-renderer.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import { readBody } from '../middleware/body.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';

export async function handleRenderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix) || !pathname.endsWith('/render/preview')) {
    return false;
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return false;
  }

  const afterPrefix = pathname.substring(prefix.length);
  const projectId = afterPrefix.split('/')[0];
  if (!projectId) {
    return false;
  }

  assertPermission(context.role, 'PROJECT_READ', requestId);

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    throw new NotFoundError(`Projet ${projectId}`, requestId);
  }

  // P5 — un body { url: '/preview-bundle/:id/' } capture le BUNDLE React
  // exécuté (et non les fichiers sources HTML) via une URL directe.
  let startUrl: string | undefined;
  if (req.method === 'POST') {
    try {
      const bodyText = await readBody(req);
      const parsed = JSON.parse(bodyText || '{}') as { url?: string };
      if (parsed.url && parsed.url.startsWith('/preview-bundle/')) {
        startUrl = `http://${req.headers.host || '127.0.0.1:3000'}${parsed.url}`;
      }
    } catch { /* pas de body : rendu fichiers classique */ }
  }

  const files = fileStore.getAllProjectFiles(context.tenantId, projectId);
  if (Object.keys(files).length === 0 && !startUrl) {
    throw new ValidationError('Ce projet ne contient aucun fichier à rendre', undefined, requestId);
  }

  try {
    const result = startUrl
      ? await renderProjectPreview({}, { startUrl })
      : await renderProjectPreview(files);

    auditStore.record({
      tenantId: context.tenantId,
      userId: context.role,
      action: 'REAL_RENDER_PREVIEW',
      resourceType: 'PROJECT',
      resourceId: projectId,
      status: 'SUCCESS',
      metadata: {
        durationMs: result.durationMs,
        consoleMessageCount: result.consoleMessages.length,
        pageErrorCount: result.pageErrors.length
      },
      requestId
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        screenshotBase64: result.screenshotBase64,
        consoleMessages: result.consoleMessages,
        pageErrors: result.pageErrors,
        viewport: result.viewport,
        entryFile: result.entryFile,
        renderedAt: result.renderedAt,
        durationMs: result.durationMs,
        requestId
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Échec du rendu visuel réel', {
      component: 'render-route',
      projectId,
      tenantId: context.tenantId,
      error: message
    });

    auditStore.record({
      tenantId: context.tenantId,
      userId: context.role,
      action: 'REAL_RENDER_PREVIEW',
      resourceType: 'PROJECT',
      resourceId: projectId,
      status: 'FAILURE',
      metadata: { error: message },
      requestId
    });

    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'RENDER_UNAVAILABLE',
        message,
        hint: "Vérifiez que Chromium est installé : npx playwright install chromium",
        requestId
      })
    );
  }

  return true;
}
