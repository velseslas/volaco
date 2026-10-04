/**
 * VibeCode Studio API — ÉTAPE 32
 * Route d'exécution unitaire d'agent (contrat réel É32).
 *
 * POST /api/v1/projects/:projectId/agents/execute
 *   body : { agentId, executionId?, task: { title, description, operation, targetFiles, requiredCapabilities? }, dryRun? }
 *   →    : { outcome } — statut honnête (SUCCESS/FAILURE/DEGRADED), artifacts,
 *          résultat de mutation réel, erreurs propagées. Aucun faux succès.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';
import type { AIOrchestratorService } from '../../../../packages/core/src/ai-native/ai-orchestrator/service.js';
import type { AgentTask, TaskContextPayload } from '../../../../packages/core/src/ai-native/ai-orchestrator/types.js';
import { readBody } from '../middleware/body.js';

let orchestratorRef: AIOrchestratorService | undefined;

export function configureAgentExecutionRoute(service: AIOrchestratorService): void {
  orchestratorRef = service;
  logger.info('AgentExecutionService configure (ÉTAPE 32)', { component: 'agent-execution-route' });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

interface AgentExecuteBody {
  agentId?: string;
  executionId?: string;
  dryRun?: boolean;
  task?: {
    title?: string;
    description?: string;
    operation?: string;
    targetFiles?: string[];
    requiredCapabilities?: string[];
  };
}

export async function handleAgentExecutionRoutes(
  req: IncomingMessage, res: ServerResponse, pathname: string,
  context: RequestContext, requestId: string
): Promise<boolean> {
  if (!pathname.includes('/agents/execute') || req.method !== 'POST') return false;
  assertPermission(context.role, 'PROJECT_READ', requestId);
  if (!orchestratorRef) {
    sendJson(res, 503, { message: 'AIOrchestratorService non configure (ÉTAPE 32)', requestId });
    return true;
  }
  const parts = pathname.split('/');
  const projectId = parts[4];
  if (!projectId) { sendJson(res, 400, { message: 'projectId manquant', requestId }); return true; }

  const bodyText = await readBody(req);
  let body: AgentExecuteBody;
  try { body = bodyText ? JSON.parse(bodyText) : {}; }
  catch { throw new ValidationError('JSON invalide', undefined, requestId); }

  if (!body.agentId || typeof body.agentId !== 'string') {
    sendJson(res, 400, { message: 'agentId obligatoire', requestId });
    return true;
  }
  if (!body.task || typeof body.task !== 'object') {
    sendJson(res, 400, { message: 'task obligatoire (title, description, operation, targetFiles)', requestId });
    return true;
  }
  const operation = body.task.operation ?? 'CREATE';
  if (!['CREATE', 'MODIFY', 'DELETE', 'ANALYZE', 'VERIFY'].includes(operation)) {
    sendJson(res, 400, { message: 'operation invalide', requestId });
    return true;
  }
  const targetFiles = Array.isArray(body.task.targetFiles) ? body.task.targetFiles : [];
  if (targetFiles.length === 0) {
    sendJson(res, 400, { message: 'targetFiles obligatoire (au moins un fichier)', requestId });
    return true;
  }

  const executionId = (body.executionId && body.executionId.trim()) || `agx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const task: AgentTask = {
    id: `task-${executionId}`,
    title: String(body.task.title || `Tâche ${executionId}`),
    description: String(body.task.description || ''),
    domain: 'ARCHITECTURE',
    priority: 1,
    dependencies: [],
    requiredContext: { targetFiles },
    requiredCapabilities: Array.isArray(body.task.requiredCapabilities) ? body.task.requiredCapabilities as never[] : [],
    status: 'READY',
    operation: operation as AgentTask['operation'],
    retryCount: 0,
    maxRetries: 0
  };
  const execContext: TaskContextPayload = {
    relevantFiles: {},
    relevantSymbols: [],
    decisions: [],
    constraints: [],
    recentHistory: []
  };

  logger.info('Exécution d agent demandée (ÉTAPE 32)', {
    component: 'agent-execution-route',
    tenantId: context.tenantId, projectId, agentId: body.agentId, executionId, operation, targetFiles
  });

  try {
    const outcome = await orchestratorRef.executeAgent({
      executionId,
      agentId: body.agentId,
      task,
      context: execContext,
      tenantId: context.tenantId,
      projectId,
      userRole: context.role,
      requestId,
      dryRun: body.dryRun === true
    });
    logger.info('Exécution d agent terminée (ÉTAPE 32)', {
      component: 'agent-execution-route',
      executionId, agentId: body.agentId, status: outcome.status,
      mutationExecuted: outcome.mutation.executed, appliedCount: outcome.mutation.appliedCount,
      artifacts: outcome.artifacts.length, error: outcome.error ?? null
    });
    sendJson(res, 200, { outcome, requestId });
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Echec exécution d agent', { component: 'agent-execution-route', error: message, requestId });
    sendJson(res, 500, { message: 'Erreur exécution agent: ' + message, requestId });
    return true;
  }
}
