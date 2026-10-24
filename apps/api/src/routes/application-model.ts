/**
 * VibeCode Core - API Tier
 * CDC §12 — Route Application Model : GET .../application-model.
 *
 * Le "centre de connaissance unique" du CDC : une racine PERSISTÉE par
 * projet, assemblant les sources réelles déjà produites par les moteurs :
 *  - modèle sémantique (AINT-004, ApplicationUnderstandingService) ;
 *  - Application DNA (AINT-002) ;
 *  - révisions applicatives réellement enregistrées ;
 *  - mémoire conversationnelle projet (décisions, plans, contraintes…).
 *
 * Le modèle est recalculé à la demande depuis les moteurs (caches LRU en
 * amont) puis persisté (upsert) — jamais un modèle fabriqué sans source.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApplicationUnderstandingService } from '../../../../packages/core/src/ai-native/application-understanding/service.js';
import { ApplicationDNAService } from '../../../../packages/core/src/ai-native/dna/service.js';
import { buildApplicationModel } from '../../../../packages/core/src/ai-native/application-model/builder.js';
import { applicationModelStore } from '../../../../packages/core/src/ai-native/application-model/store.js';
import { designMemoryStore } from '../../../../packages/core/src/ai-native/design-harmony/design-memory-store.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import type { Role } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError } from '../../../../packages/core/src/errors.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';
import { conversationIntelligenceService } from './conversation.js';

let understandingService: ApplicationUnderstandingService | undefined;
let dnaService: ApplicationDNAService | undefined;

export function configureApplicationModelRoute(deps: {
  understandingService: ApplicationUnderstandingService;
  dnaService: ApplicationDNAService;
}): void {
  understandingService = deps.understandingService;
  dnaService = deps.dnaService;
  logger.info('Application Model route configurée (§12)', { component: 'application-model-route' });
}

export async function handleApplicationModelRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // GET /api/v1/projects/:projectId/application-model
  const prefix = '/api/v1/projects/';
  if (req.method !== 'GET' || !pathname.startsWith(prefix)) {
    return false;
  }
  const parts = pathname.substring(prefix.length).split('/');
  const projectId = parts[0];
  if (!projectId || parts[1] !== 'application-model' || parts.length > 2) {
    return false;
  }

  assertPermission(context.role, 'PROJECT_READ', requestId);

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    throw new NotFoundError(`Projet ${projectId}`, requestId);
  }

  const model = buildAndRecordApplicationModel({
    tenantId: context.tenantId,
    projectId,
    role: context.role,
    requestId
  });

  if (!model) {
    res.statusCode = 422;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      message: 'Application Model impossible : ni compréhension sémantique ni DNA extractibles (projet vide ?).',
      requestId
    }));
    return true;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ model, requestId }));
  return true;
}

export interface ApplicationModelBuildInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly role: Role;
  readonly requestId: string;
}

/**
 * Assemble la racine Application Model depuis les sources réelles, puis
 * l'upserte. Réutilisé par la route (à la demande) et par le flux
 * conversationnel (après chaque mutation persistée) — une seule vérité.
 * Retourne null si aucune source de connaissance n'est extractible.
 */
export function buildAndRecordApplicationModel(
  input: ApplicationModelBuildInput
): ReturnType<typeof buildApplicationModel> {
  const { tenantId, projectId, role, requestId } = input;
  if (!projectStore.getProject(tenantId, projectId)) {
    return undefined;
  }

  // Sources réelles — une source indisponible est simplement ABSENTE
  // (jamais remplacée par une valeur inventée).
  let understanding: ReturnType<ApplicationUnderstandingService['buildUnderstanding']> | undefined;
  if (understandingService) {
    try {
      understanding = understandingService.buildUnderstanding({ tenantId, projectId }, role, requestId);
    } catch {
      understanding = undefined;
    }
  }

  let dna: ReturnType<ApplicationDNAService['extractDNA']> | undefined;
  if (dnaService) {
    try {
      dna = dnaService.extractDNA(tenantId, projectId, role, requestId);
    } catch {
      dna = undefined;
    }
  }

  const revisions = revisionStore.listRevisions(tenantId, projectId);
  const memory = conversationIntelligenceService.getLatestProjectMemory(tenantId, projectId, role, requestId);

  const model = buildApplicationModel({
    tenantId,
    projectId,
    builtAt: new Date().toISOString(),
    understanding,
    dna,
    revisions,
    memory: memory ?? undefined,
    // P0 (audit 2026-10) — §23 : la Design Memory est rattachée au modèle
    // racine (références réelles, aucune duplication de contenu).
    designDecisions: designMemoryStore.list(tenantId, projectId)
  });

  if (model) {
    applicationModelStore.record(model);
  }
  return model;
}
