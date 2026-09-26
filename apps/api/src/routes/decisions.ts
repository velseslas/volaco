/**
 * VibeCode Core - API Tier
 * Decisions Route (ÉTAPE 5) — ADR réels depuis le Decision Ledger (Phase 9.5).
 * Remplace les cartes ADR statiques du Studio.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DecisionLedger } from '../../../../packages/core/src/ai-native/decision-engine/decision-ledger.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import type { RequestContext } from '../middleware/auth.js';

let ledger: DecisionLedger | undefined;

export function configureDecisionsRoute(l: DecisionLedger): void {
  ledger = l;
}

export async function handleDecisionsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // GET /api/v1/projects/:projectId/decisions
  const prefix = '/api/v1/projects/';
  if (req.method !== 'GET' || !pathname.startsWith(prefix) || !pathname.endsWith('/decisions')) {
    return false;
  }
  const projectId = pathname.slice(prefix.length, -'/decisions'.length);
  if (!projectId) return false;

  assertPermission(context.role, 'PROJECT_READ', requestId);

  if (!ledger) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'DecisionLedger non configuré.', requestId }));
    return true;
  }

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: `Projet ${projectId} introuvable`, requestId }));
    return true;
  }

  const decisions = ledger.getActiveDecisions(projectId);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ decisions, requestId }));
  return true;
}
