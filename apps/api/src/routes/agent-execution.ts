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
  /** ÉTAPE 36 — active la réparation bornée (maxAttempts=1) après Gate FAIL. */
  repair?: boolean;
  task?: {
    title?: string;
    description?: string;
    operation?: string;
    targetFiles?: string[];
    requiredCapabilities?: string[];
  };
}


/** ÉTAPE 37 — route batch minimale (LE MÊME scheduler / AgentExecutionService). */
interface BatchTaskBody {
  taskId?: string;
  agentId?: string;
  dependencies?: string[];
  order?: number;
  task?: { title?: string; description?: string; operation?: string; targetFiles?: string[]; requiredCapabilities?: string[] };
}

async function handleBatch(
  req: IncomingMessage, res: ServerResponse, pathname: string,
  context: RequestContext, requestId: string
): Promise<boolean> {
  assertPermission(context.role, 'PROJECT_READ', requestId);
  if (!orchestratorRef) {
    sendJson(res, 503, { message: 'AIOrchestratorService non configure', requestId });
    return true;
  }
  const parts = pathname.split('/');
  const projectId = parts[4];
  if (!projectId) { sendJson(res, 400, { message: 'projectId manquant', requestId }); return true; }
  const bodyText = await readBody(req);
  let body: { executionId?: string; maxConcurrency?: number; repair?: boolean; tasks?: BatchTaskBody[] };
  try { body = bodyText ? JSON.parse(bodyText) : {}; }
  catch { throw new ValidationError('JSON invalide', undefined, requestId); }
  if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
    sendJson(res, 400, { message: 'tasks obligatoire (au moins une tâche)', requestId });
    return true;
  }
  const executionId = (body.executionId && body.executionId.trim()) || `agxb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const tasks = body.tasks.map((t, idx) => {
      const taskBody = t.task;
      const taskId = String(t.taskId || `task-${idx + 1}`);
      return {
        taskId,
        agentId: String(t.agentId || ''),
        dependencies: Array.isArray(t.dependencies) ? t.dependencies.map(String) : [],
        order: typeof t.order === 'number' ? t.order : idx + 1,
        task: {
          id: taskId,
          title: (taskBody && String(taskBody.title)) || `Tâche batch ${idx + 1}`,
          description: (taskBody && String(taskBody.description)) || '',
          domain: 'ARCHITECTURE' as const,
          priority: 1,
          dependencies: Array.isArray(t.dependencies) ? t.dependencies.map(String) : [],
          requiredContext: { targetFiles: taskBody && Array.isArray(taskBody.targetFiles) ? taskBody.targetFiles : [] },
          requiredCapabilities: (taskBody && Array.isArray(taskBody.requiredCapabilities) ? taskBody.requiredCapabilities : []) as never,
          status: 'READY' as const,
          operation: ((taskBody && taskBody.operation) || 'CREATE') as never,
          retryCount: 0,
          maxRetries: 0
        }
      };
    });
    logger.info('Batch multi-agents demandé (ÉTAPE 37)', { component: 'agent-execution-route', executionId, tenantId: context.tenantId, projectId, tasks: tasks.length, maxConcurrency: body.maxConcurrency });
    const outcome = await orchestratorRef.executeBatch({
      executionId,
      tenantId: context.tenantId,
      projectId,
      tasks,
      ...(body.maxConcurrency !== undefined ? { maxConcurrency: body.maxConcurrency } : {}),
      repairPolicy: body.repair === true ? { enabled: true, maxAttempts: 1 } : undefined,
      userRole: context.role,
      requestId
    });
    logger.info('Batch multi-agents terminé (ÉTAPE 37)', { component: 'agent-execution-route', executionId, status: outcome.status, counts: outcome.counts });
    sendJson(res, 200, { outcome, requestId });
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('DAG_INVALID') || message.includes('AGENT_UNKNOWN') || message.includes('CAPABILITY_UNSUPPORTED') ? 400 : 500;
    logger.warn('Echec batch multi-agents', { component: 'agent-execution-route', error: message, requestId });
    sendJson(res, statusCode, { message: 'Erreur batch: ' + message, requestId });
    return true;
  }
}
export async function handleAgentExecutionRoutes(
  req: IncomingMessage, res: ServerResponse, pathname: string,
  context: RequestContext, requestId: string
): Promise<boolean> {
  if (pathname.includes('/agents/execute-batch') && req.method === 'POST') {
    return handleBatch(req, res, pathname, context, requestId);
  }
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
      dryRun: body.dryRun === true,
      repairPolicy: body.repair === true ? { enabled: true, maxAttempts: 1 } : undefined
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
