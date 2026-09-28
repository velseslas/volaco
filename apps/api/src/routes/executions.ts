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
import { executionStore, activeCancelFlags } from '../../../../packages/core/src/ai-native/execution/store.js';
import { normalizeExecutionRecord } from '../../../../packages/core/src/ai-native/execution/activity.js';
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
  if (req.method !== 'GET' && req.method !== 'POST') {
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

  // POST .../executions/:id/cancel → annulation réelle (T5, CDC §20)
  if (req.method === 'POST') {
    if (parts[3] !== 'cancel' || !executionId) {
      return false;
    }
    const record = executionStore.getExecution(executionId);
    if (!record || record.tenantId !== context.tenantId) {
      throw new NotFoundError(`Exécution ${executionId}`, requestId);
    }
    const flag = activeCancelFlags.get(executionId);
    if (flag) {
      flag.cancelled = true;
      sendJson(res, 200, { cancelled: true, executionId, requestId });
      return true;
    }
    // Exécution en attente de validation de plan : l'annulation est la
    // décision « rejeter » — marquée CANCELLED, pas FAILED.
    if (record.status === 'WAITING_USER') {
      executionStore.cancelExecution(executionId, 'user_cancel');
      sendJson(res, 200, { cancelled: true, executionId, requestId });
      return true;
    }
    sendJson(res, 200, { cancelled: false, reason: 'not_active', status: record.status, executionId, requestId });
    return true;
  }

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
  // LOT B — les deux vues partent ensemble : raw (traçabilité) + activities
  // (vue normalisée pour le renderer unique du Live Activity Stream).
  sendJson(res, 200, {
    execution: record,
    activities: normalizeExecutionRecord(record.events),
    requestId
  });
  return true;
}
