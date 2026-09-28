/**
 * EXECUTION TRANSPARENCY (T2) — consultation des exécutions persistées.
 *
 * GET /api/v1/projects/:projectId/executions            → liste (méta seulement)
 * GET /api/v1/projects/:projectId/executions/latest     → dernière exécution complète
 * GET /api/v1/projects/:projectId/executions/:executionId → exécution complète
 *
 * La liste ne renvoie PAS les événements (volume) ; le détail seul les porte.
 * Ces routes alimentent le replay Studio après refresh (CDC §17) : le backend
 * reste la source de vérité de l'état d'exécution.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError } from '../../../../packages/core/src/errors.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { executionStore } from '../../../../packages/core/src/ai-native/execution/store.js';
import type { ExecutionRecord } from '../../../../packages/core/src/ai-native/execution/types.js';
import type { RequestContext } from '../middleware/auth.js';

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/** Métadonnées sans les événements (liste légère). */
function toSummary(record: ExecutionRecord): Record<string, unknown> {
  return {
    executionId: record.executionId,
    status: record.status,
    phase: record.phase,
    mode: record.mode,
    prompt: record.prompt,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    eventsCount: record.events.length,
    summary: record.summary
  };
}

export async function handleExecutionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix) || !pathname.includes('/executions')) {
    return false;
  }
  if (req.method !== 'GET') {
    return false;
  }

  const afterPrefix = pathname.substring(prefix.length);
  const parts = afterPrefix.split('/');
  const projectId = parts[0];
  const subRoute = parts[1];
  if (!projectId || subRoute !== 'executions') {
    return false;
  }
  const executionId = parts[2];

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    throw new NotFoundError(`Projet ${projectId}`, requestId);
  }
  assertPermission(context.role, 'PROJECT_READ', requestId);

  // GET .../executions → liste (méta)
  if (!executionId) {
    const executions = executionStore.listExecutions(context.tenantId, projectId);
    sendJson(res, 200, { executions: executions.map(toSummary), requestId });
    return true;
  }

  // GET .../executions/latest → dernière exécution complète (replay refresh)
  const record = executionId === 'latest'
    ? executionStore.getLatestExecution(context.tenantId, projectId)
    : executionStore.getExecution(executionId);
  // Isolation tenant : un executionId d'un autre tenant est introuvable ici.
  if (!record || record.tenantId !== context.tenantId) {
    throw new NotFoundError(`Exécution ${executionId}`, requestId);
  }
  sendJson(res, 200, { execution: record, requestId });
  return true;
}
