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
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import { agentTraceStore } from '../../../../packages/core/src/observability/agent-trace-store.js';
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
  // E3 — cette branche EXÉCUTE des agents (mutations réelles) : elle exige
  // donc PROJECT_MUTATE, comme orchestrate.ts. PROJECT_READ était insuffisant
  // (un VIEWER pouvait déclencher une exécution mutante).
  assertPermission(context.role, 'PROJECT_MUTATE', requestId);
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
      const agentId = String(t.agentId || '');
      return {
        taskId,
        agentId,
        dependencies: Array.isArray(t.dependencies) ? t.dependencies.map(String) : [],
        order: typeof t.order === 'number' ? t.order : idx + 1,
        task: {
          id: taskId,
          title: (taskBody && String(taskBody.title)) || `Tâche batch ${idx + 1}`,
          description: (taskBody && String(taskBody.description)) || '',
          domain: 'ARCHITECTURE' as const,
          priority: 1,
          dependencies: Array.isArray(t.dependencies) ? t.dependencies.map(String) : [],
          requiredContext: {
            targetFiles: taskBody && Array.isArray(taskBody.targetFiles) ? taskBody.targetFiles : [],
            // CDC V8 §11 — les tâches de l'UI Agent lisent le Design DNA réel
            // du projet (rapport Design Harmony persisté) avant génération.
            ...(agentId === 'agent-ui-specialist' ? { includeDna: true } : {})
          },
          requiredCapabilities: (taskBody && Array.isArray(taskBody.requiredCapabilities) ? taskBody.requiredCapabilities : []) as never,
          status: 'READY' as const,
          operation: ((taskBody && taskBody.operation) || 'CREATE') as never,
          retryCount: 0,
          maxRetries: 0
        }
      };
    });
    logger.info('Batch multi-agents demandé (ÉTAPE 37)', { component: 'agent-execution-route', executionId, tenantId: context.tenantId, projectId, tasks: tasks.length, maxConcurrency: body.maxConcurrency });
    // É53 LOT E4.2 — CORRECTION F1 (audit G1) : contrôleur de REQUÊTE
    // (pattern E3/E4.1 A2 déjà validé). Seule source d'annulation honnête
    // sur cette route : la DÉCONNEXION CLIENT — armé tant que la réponse
    // n'est pas terminée (writableEnded guard : une réponse COMPLÈTE et
    // close normale ne fait PAS abort) ; jamais partagé avec une autre
    // requête (créé ici, portée de la requête) ; distinct des timeouts
    // techniques des adapters. Aucune nouvelle autorité d'annulation
    // globale : le signal descend via le contrat MultiAgentSchedulerRequest
    // existant (scheduler É37 l.62/257, déjà testé U7-U9) jusqu'à chaque
    // agent. Le listener est TOUJOURS retiré (finally), y compris sur
    // exception.
    const batchAbortController = new AbortController();
    const onBatchGone = (): void => {
      if (!res.writableEnded) batchAbortController.abort();
    };
    res.once('close', onBatchGone);
    try {
      const outcome = await orchestratorRef.executeBatch({
        executionId,
        tenantId: context.tenantId,
        projectId,
        tasks,
        ...(body.maxConcurrency !== undefined ? { maxConcurrency: body.maxConcurrency } : {}),
        repairPolicy: body.repair === true ? { enabled: true, maxAttempts: 1 } : undefined,
        userRole: context.role,
        requestId,
        signal: batchAbortController.signal
      });
      logger.info('Batch multi-agents terminé (ÉTAPE 37)', { component: 'agent-execution-route', executionId, status: outcome.status, counts: outcome.counts });
      sendJson(res, 200, { outcome, requestId });
      return true;
    } finally {
      res.off('close', onBatchGone);
    }
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
  // ÉTAPE 40 Phase 2 — consultation du Registry RÉEL (É34) : projection des
  // agents réellement enregistrés (id/name/domain/capabilities/description/
  // requiresProviderCapabilities). Lecture PURE : aucune exécution, aucune
  // écriture, aucune fabrication — le roster est global (É34) ; le scope
  // projet n'est que la convention d'URL.
  if (pathname.endsWith('/agents') && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    if (!orchestratorRef) {
      sendJson(res, 503, { message: 'AIOrchestratorService non configure', requestId });
      return true;
    }
    const agents = orchestratorRef.getExecutionAgentRegistry().list().map((entry) => ({
      agentId: entry.id,
      name: entry.name,
      domain: entry.domain,
      capabilities: [...entry.capabilities],
      description: entry.description,
      requiresProviderCapabilities: [...entry.requiresProviderCapabilities]
    }));
    sendJson(res, 200, { agents, count: agents.length, requestId });
    return true;
  }

  // ÉTAPE 39 Phase 2 — liste des exécutions persistées du projet (LECTURE PURE).
  // Convention activity.ts : ?limit=N (taille de RÉPONSE — le cap de
  // rétention du store reste 500 et n'est pas modifié) et order=ASC|DESC
  // (défaut DESC). Tri sur startedAt (timestamp réel de ExecutionTrace),
  // tie-breaker déterministe executionId. Filtres = AND logique.
  if (pathname.endsWith('/agents/executions') && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const parts = pathname.split('/');
    const projectId = parts[4];
    if (!projectId) {
      sendJson(res, 400, { message: 'projectId manquant', requestId });
      return true;
    }
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const kindParam = url.searchParams.get('kind');
    const statusParam = url.searchParams.get('status');
    const agentIdParam = url.searchParams.get('agentId');
    const limitParam = url.searchParams.get('limit');
    const order = url.searchParams.get('order') === 'ASC' ? 'ASC' : 'DESC';

    const VALID_KINDS = ['TASK', 'BATCH'];
    if (kindParam !== null && !VALID_KINDS.includes(kindParam)) {
      throw new ValidationError(`kind invalide '${kindParam}' (valeurs : TASK, BATCH)`, undefined, requestId);
    }
    let limit: number | undefined;
    if (limitParam !== null) {
      limit = parseInt(limitParam, 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new ValidationError(`limit invalide '${limitParam}' (entier positif attendu)`, undefined, requestId);
      }
    }

    // Lecture PURE via le store existant — filtres = AND logique, appliqués
    // en mémoire (cap 500) ; aucun verdict calculé, les statuts proviennent
    // des traces stockées telles quelles.
    let items = agentTraceStore.query(context.tenantId, projectId);
    if (kindParam !== null) items = items.filter((t) => t.kind === kindParam);
    if (statusParam !== null) items = items.filter((t) => t.status === statusParam);
    if (agentIdParam !== null) items = items.filter((t) => t.agentId === agentIdParam);
    items = items.sort((a, b) => {
      const timeCmp = a.startedAt.localeCompare(b.startedAt);
      if (timeCmp !== 0) return timeCmp;
      return a.executionId < b.executionId ? -1 : a.executionId > b.executionId ? 1 : 0;
    });
    if (order === 'DESC') items = items.reverse();
    if (limit !== undefined) items = items.slice(0, limit);

    sendJson(res, 200, { items, count: items.length, requestId });
    return true;
  }

  // ÉTAPE 39 Phase 3 — détail corrélé d'un batch : la trace BATCH stockée +
  // les traces TASK stockées corrélées (batchExecutionId + taskExecutionId).
  // Branchée AVANT la branche GET détail (sinon '/tasks' serait capturé par
  // includes('/agents/executions/')). Lecture PURE : aucune fabrication —
  // les tâches jamais exécutées (BLOCKED/PENDING) restent sans trace TASK
  // et sont listées dans tasksWithoutTrace depuis la trace BATCH.
  if (pathname.includes('/agents/executions/') && pathname.endsWith('/tasks') && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const parts = pathname.split('/');
    const projectId = parts[4];
    const executionId = parts[7] ? decodeURIComponent(parts[7]) : '';
    if (!projectId || !executionId) {
      sendJson(res, 400, { message: 'projectId et executionId obligatoires', requestId });
      return true;
    }

    const batch = agentTraceStore.get(context.tenantId, projectId, executionId);
    if (!batch || batch.kind !== 'BATCH') {
      // 404 canonique identique : inexistant / autre tenant / autre projet /
      // ce n'est pas un batch — aucune information ne fuit.
      throw new NotFoundError(`Trace de batch '${executionId}'`, requestId);
    }
    const allTraces = agentTraceStore.query(context.tenantId, projectId);
    const batchTasks = batch.tasks ?? [];
    const expectedTaskIds = new Set(batchTasks.map((t) => t.taskExecutionId));
    const taskTraces = allTraces.filter((t) =>
      t.kind === 'TASK' &&
      t.batchExecutionId === executionId &&
      expectedTaskIds.has(t.executionId)
    );
    const tracedIds = new Set(taskTraces.map((t) => t.executionId));
    const tasksWithoutTrace = batchTasks
      .filter((t) => !tracedIds.has(t.taskExecutionId))
      .map((t) => ({
        taskId: t.taskId,
        taskExecutionId: t.taskExecutionId,
        status: t.status,
        ...(t.blockedReason !== undefined ? { blockedReason: t.blockedReason } : {})
      }));
    sendJson(res, 200, { batch, taskTraces, tasksWithoutTrace, requestId });
    return true;
  }

  // ÉTAPE 38 Phase 6 — consultation GET : évaluée AVANT le match générique
  // '/agents/execute' (qui contiendrait sinon le préfixe '/agents/executions').
  // Lecture PURE : agentTraceStore.get(...) uniquement — aucun recalcul de
  // verdict, aucune reconstruction, aucune écriture.
  if (pathname.includes('/agents/executions/') && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const parts = pathname.split('/');
    const projectId = parts[4];
    const executionId = parts[7] ? decodeURIComponent(parts[7]) : '';
    if (!projectId || !executionId) {
      sendJson(res, 400, { message: 'projectId et executionId obligatoires', requestId });
      return true;
    }
    const trace = agentTraceStore.get(context.tenantId, projectId, executionId);
    if (!trace) {
      // 404 canonique identique pour : exécution inexistante / autre tenant /
      // autre projet — aucune information ne fuit.
      throw new NotFoundError(`Trace d'exécution '${executionId}'`, requestId);
    }
    sendJson(res, 200, { trace, requestId });
    return true;
  }
  if (pathname.includes('/agents/execute-batch') && req.method === 'POST') {
    return handleBatch(req, res, pathname, context, requestId);
  }
  if (!pathname.includes('/agents/execute') || req.method !== 'POST') return false;
  // E3 — exécution unitaire d'agent = opération MUTANTE (le résultat peut
  // appliquer des modifications de fichiers). PROJECT_MUTATE requis.
  assertPermission(context.role, 'PROJECT_MUTATE', requestId);
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
    requiredContext: {
      targetFiles,
      // CDC V8 §11 — l'exécution unitaire de l'UI Agent est design-aware :
      // le contexte assemblé ci-dessous injecte le Design DNA réel du projet
      // (tokens/direction/règles du dernier rapport Design Harmony).
      ...(body.agentId === 'agent-ui-specialist' ? { includeDna: true } : {})
    },
    requiredCapabilities: Array.isArray(body.task.requiredCapabilities) ? body.task.requiredCapabilities as never[] : [],
    status: 'READY',
    operation: operation as AgentTask['operation'],
    retryCount: 0,
    maxRetries: 0
  };
  // CDC V8 §11 — contexte assemblé par LA MÊME source que le scheduler
  // (ContextOrchestrator) : assainissement des cibles, slice sémantique,
  // Design DNA réel quand includeDna. Sans fichier transmis ni rapport, le
  // contexte reste identique à l'ancien (payload vide).
  const execContext: TaskContextPayload = orchestratorRef.assembleTaskContext({
    tenantId: context.tenantId,
    projectId,
    task,
    userRole: context.role,
    requestId
  });

  logger.info('Exécution d agent demandée (ÉTAPE 32)', {
    component: 'agent-execution-route',
    tenantId: context.tenantId, projectId, agentId: body.agentId, executionId, operation, targetFiles
  });

  // É53 LOT E4.2 — CORRECTION F1 (audit G1) : contrôleur de REQUÊTE
  // (pattern E3/E4.1 A2 déjà validé, identique à /conversation …/execute).
  // Seule source d'annulation honnête : la DÉCONNEXION CLIENT — armé tant
  // que la réponse n'est pas terminée (writableEnded guard) ; jamais
  // partagé avec une autre requête ; distinct des timeouts techniques des
  // adapters. Le signal descend via le contrat AgentExecutionRequest
  // existant (agent-execution.ts l.399, déjà testé E4.1) jusqu'à l'appel
  // LLM de l'agent. Listener TOUJOURS retiré (finally).
  const executeAbortController = new AbortController();
  const onExecuteGone = (): void => {
    if (!res.writableEnded) executeAbortController.abort();
  };
  res.once('close', onExecuteGone);
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
      repairPolicy: body.repair === true ? { enabled: true, maxAttempts: 1 } : undefined,
      signal: executeAbortController.signal
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
  } finally {
    res.off('close', onExecuteGone);
  }
}
