import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';
import type { AIOrchestratorService } from '../../../../packages/core/src/ai-native/ai-orchestrator/service.js';
import type {
  OrchestrationExecutionRefusalCode
} from '../../../../packages/core/src/ai-native/ai-orchestrator/types.js';
import type { EngineeringPlan, IntentResult } from '../../../../packages/core/src/ai-native/conversation-intelligence/types.js';
import {
  DEFAULT_ORCHESTRATION_HISTORY_LIMIT,
  MAX_ORCHESTRATION_RUNS,
  orchestrationRunStore
} from '../../../../packages/core/src/ai-native/ai-orchestrator/run-store.js';

import { readBody } from '../middleware/body.js';
let orchestratorService: AIOrchestratorService | undefined;

export function configureOrchestratorService(service: AIOrchestratorService): void {
  orchestratorService = service;
  logger.info('AIOrchestratorService configure (Phase 9)', { component: 'orchestrate-route' });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

interface OrchestratePath {
  projectId: string | undefined;
  action: string | undefined;
  orchestrationId: string | undefined;
  operation: string | undefined;
}

/** /api/v1/projects/:projectId/orchestrate[/:orchestrationId[/preview|apply]] | /orchestrations */
function parseOrchestratePath(pathname: string): OrchestratePath {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  return {
    projectId: parts[3],
    action: parts[4],
    orchestrationId: parts[5],
    operation: parts[6]
  };
}

/** V7-LOT6 — traduction des refus métier en statuts HTTP non ambigus. */
function executionRefusalStatus(code: OrchestrationExecutionRefusalCode): number {
  if (code === 'RUN_NOT_FOUND') return 404;
  if (
    code === 'INVALID_ARTIFACTS' ||
    code === 'PREFLIGHT_FAILED' ||
    code === 'RUNTIME_FAILED' ||
    code === 'FUNCTIONAL_TESTS_FAILED'
  ) return 422;
  if (code === 'EXECUTION_FAILED') return 500;
  return 409;
}

export async function handleOrchestrateRoutes(
  req: IncomingMessage, res: ServerResponse, pathname: string,
  context: RequestContext, requestId: string
): Promise<boolean> {
  const { projectId, action, orchestrationId, operation } = parseOrchestratePath(pathname);
  if (!projectId || (action !== 'orchestrate' && action !== 'orchestrations')) return false;

  // V7-WIRE-5 — historique durable des analyses multi-agents (lecture pure).
  // Le store est filtré par tenant + projet ; aucun run d'un autre tenant
  // n'est visible, même avec un orchestrationId exact.
  if (action === 'orchestrations' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const rawLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(MAX_ORCHESTRATION_RUNS, Math.floor(rawLimit))
      : DEFAULT_ORCHESTRATION_HISTORY_LIMIT;
    const items = orchestrationRunStore.query(context.tenantId, projectId, limit);
    sendJson(res, 200, { items, count: items.length, requestId });
    return true;
  }

  // GET /projects/:id/orchestrate/:orchestrationId — relit le run persisté
  // (pas le cache mémoire du service) : la preuve survit au redémarrage.
  if (action === 'orchestrate' && orchestrationId && !operation && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const run = orchestrationRunStore.get(context.tenantId, projectId, orchestrationId);
    if (!run) {
      sendJson(res, 404, { message: 'Orchestration introuvable', requestId });
      return true;
    }
    sendJson(res, 200, { run, requestId });
    return true;
  }

  // V7-LOT6 — sandbox dry-run : aucune écriture, PROJECT_READ suffit.
  if (action === 'orchestrate' && orchestrationId && operation === 'preview' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    if (!orchestratorService) {
      sendJson(res, 503, { message: 'AIOrchestratorService non configure', requestId });
      return true;
    }
    const run = orchestrationRunStore.get(context.tenantId, projectId, orchestrationId);
    if (!run) {
      sendJson(res, 404, { message: 'Orchestration introuvable', requestId });
      return true;
    }
    try {
      const outcome = await orchestratorService.previewRun(run, {
        tenantId: context.tenantId,
        projectId,
        userRole: context.role,
        requestId
      });
      sendJson(
        res,
        outcome.ok ? 200 : executionRefusalStatus(outcome.code),
        { ...outcome, requestId }
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Echec sandbox orchestration', { component: 'orchestrate-route', orchestrationId, error: message, requestId });
      sendJson(res, 500, { message: 'Erreur sandbox orchestration: ' + message, requestId });
      return true;
    }
  }

  // V7-LOT6 — application confirmée : PROJECT_MUTATE + confirm explicite.
  // Les artefacts sont revalidés ici (jamais confiance au run persisté seul),
  // le préflight HTML bloque avant l'écriture et AINT-006 reste le seul writer.
  if (action === 'orchestrate' && orchestrationId && operation === 'apply' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_MUTATE', requestId);
    if (!orchestratorService) {
      sendJson(res, 503, { message: 'AIOrchestratorService non configure', requestId });
      return true;
    }
    const bodyText = await readBody(req);
    let body: { confirm?: boolean; acceptRisk?: boolean; acceptBreaking?: boolean };
    try {
      const parsed: unknown = bodyText ? JSON.parse(bodyText) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ValidationError('Corps JSON invalide : objet attendu', undefined, requestId);
      }
      body = parsed as { confirm?: boolean; acceptRisk?: boolean; acceptBreaking?: boolean };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('JSON invalide', undefined, requestId);
    }
    const run = orchestrationRunStore.get(context.tenantId, projectId, orchestrationId);
    if (!run) {
      sendJson(res, 404, { message: 'Orchestration introuvable', requestId });
      return true;
    }
    try {
      const outcome = await orchestratorService.applyRun(run, {
        tenantId: context.tenantId,
        projectId,
        userRole: context.role,
        requestId,
        confirm: body.confirm === true,
        acceptRisk: body.acceptRisk === true,
        acceptBreaking: body.acceptBreaking === true
      });
      // Un échec transactionnel après rollback laisse un run FAILED réel :
      // on le persiste pour que l'historique ne mente pas.
      if (outcome.ok) {
        orchestrationRunStore.save(outcome.run);
      } else if (outcome.run) {
        orchestrationRunStore.save(outcome.run);
      }
      sendJson(
        res,
        outcome.ok ? 200 : executionRefusalStatus(outcome.code),
        { ...outcome, requestId }
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Echec application orchestration', { component: 'orchestrate-route', orchestrationId, error: message, requestId });
      sendJson(res, 500, { message: 'Erreur application orchestration: ' + message, requestId });
      return true;
    }
  }

  if (action !== 'orchestrate' || orchestrationId || req.method !== 'POST') return false;

  // É47 P2 (P1-2) — l'orchestration peut appliquer des mutations via AINT-006 :
  // la route exige PROJECT_MUTATE (et non PROJECT_READ). Un VIEWER est
  // rejeté en 403 avant toute exécution d'agents (aucun coût caché).
  assertPermission(context.role, 'PROJECT_MUTATE', requestId);
  if (!orchestratorService) {
    sendJson(res, 503, { message: 'AIOrchestratorService non configure', requestId });
    return true;
  }
  const bodyText = await readBody(req);
  let body: { plan?: EngineeringPlan; intent?: IntentResult; conversationId?: string };
  try { body = bodyText ? JSON.parse(bodyText) : {}; }
  catch { throw new ValidationError('JSON invalide', undefined, requestId); }
  if (!body.plan || !body.plan.planId || !body.plan.steps || body.plan.steps.length === 0) {
    sendJson(res, 400, { message: 'plan obligatoire avec planId + steps', requestId });
    return true;
  }
  logger.info('Orchestration demandee', { component: 'orchestrate-route', tenantId: context.tenantId, projectId, planId: body.plan.planId, planSteps: body.plan.steps.length });
  try {
    const run = await orchestratorService.orchestratePlan({
      tenantId: context.tenantId, projectId, plan: body.plan, intent: body.intent,
      conversationId: body.conversationId,
      userRole: context.role, requestId, autoMutateIfLowRisk: false
    });
    // V7-WIRE-5 — le run complet est persisté AVANT la réponse : le Studio
    // peut le relire via GET /orchestrations, y compris après redémarrage.
    orchestrationRunStore.save(run);
    logger.info('Orchestration terminee', { component: 'orchestrate-route', orchestrationId: run.orchestrationId, state: run.state, completedTasks: run.completedTaskIds.length, artifacts: run.artifacts.length, cost: run.totalCostUsd, tokens: run.totalTokens });
    sendJson(res, 200, { run, requestId });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Echec orchestration', { component: 'orchestrate-route', error: message, requestId });
    sendJson(res, 500, { message: 'Erreur orchestration: ' + message, requestId });
    return true;
  }
}
