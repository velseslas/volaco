/**
 * VibeCode Core - API Tier
 * Application DNA Route (LOT 3) — expose l'ADN réellement extraite du projet
 * par l'AINT-002 (stack, architecture, composants, conventions). Avant cette
 * route, le panneau DNA du Studio affichait un manifeste JSON codé en dur.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApplicationDNAService } from '../../../../packages/core/src/ai-native/dna/service.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';

let dnaService: ApplicationDNAService | undefined;

export function configureDnaRoute(service: ApplicationDNAService): void {
  dnaService = service;
  logger.info('ApplicationDNA route configurée (Lot 3)', { component: 'dna-route' });
}

export async function handleDnaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // GET /api/v1/projects/:projectId/dna
  const prefix = '/api/v1/projects/';
  if (req.method !== 'GET' || !pathname.startsWith(prefix) || !pathname.endsWith('/dna')) {
    return false;
  }
  const projectId = pathname.slice(prefix.length, -'/dna'.length);
  if (!projectId) return false;

  assertPermission(context.role, 'PROJECT_READ', requestId);

  if (!dnaService) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'ApplicationDNAService non configuré.', requestId }));
    return true;
  }

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: `Projet ${projectId} introuvable`, requestId }));
    return true;
  }

  try {
    const dna = dnaService.extractDNA(context.tenantId, projectId, context.role, requestId);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ dna, requestId }));
  } catch (error) {
    // Projet vide ou inextraction possible : réponse structurée, pas un 500 brut
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Extraction DNA impossible', {
      component: 'dna-route',
      tenantId: context.tenantId,
      projectId,
      error: message,
      requestId
    });
    res.statusCode = 422;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: `Extraction DNA impossible : ${message}`, requestId }));
  }
  return true;
}
