import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';
import type { AIOrchestratorService } from '../../../../packages/core/src/ai-native/ai-orchestrator/service.js';
import type { EngineeringPlan, IntentResult } from '../../../../packages/core/src/ai-native/conversation-intelligence/types.js';

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

export async function handleOrchestrateRoutes(
  req: IncomingMessage, res: ServerResponse, pathname: string,
  context: RequestContext, requestId: string
): Promise<boolean> {
  if (!pathname.includes('/orchestrate') || req.method !== 'POST') return false;
  assertPermission(context.role, 'PROJECT_READ', requestId);
  if (!orchestratorService) {
    sendJson(res, 503, { message: 'AIOrchestratorService non configure', requestId });
    return true;
  }
  const parts = pathname.split('/');
  const projectId = parts[4];
  if (!projectId) { sendJson(res, 400, { message: 'projectId manquant', requestId }); return true; }
  const bodyText = await readBody(req);
  let body: { plan?: EngineeringPlan; intent?: IntentResult };
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
      userRole: context.role, requestId, autoMutateIfLowRisk: false
    });
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
