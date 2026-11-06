/**
 * VibeCode Studio API — PAGE CLÉS API (agents).
 *
 * Choix scellés avec l'opérateur : clés d'agents stockées SERVEUR
 * (ai-agent-keys.json, gitignored), bascule automatique tracée côté exécuteur.
 *
 * Contrat (clés JAMAIS exposées — indice 4 derniers caractères seulement, règle SEC-003) :
 *   GET  /api/v1/ai/agent-keys           → roster des 7 agents + état des slots
 *                   (par agent : {primary?: {providerId, hint}, fallback?: {...}})
 *   POST /api/v1/ai/agent-keys/<agentId>/slot → body : {slot:'primary'|'fallback', providerId, apiKey} ;
 *                      apiKey vide → suppression du slot ; retour = indice + providerId.
 */
/* Raison du préfixe /agent-keys : le contrat /api/v1/…/agents (pluriel,
 * ÉTAPES 32/37) est PRIS par la route d'exécution d'agents — son prédicat
 * endsWith('/agents') capterait le GET du roster. Préfixe spécifique = zéro
 * collision, aucun branchement conditionnel fragile. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { readBody } from '../middleware/body.js';
import type { RequestContext } from '../middleware/auth.js';
import {
  AGENT_KEYS_IDS,
  agentCredentialHints,
  setAgentCredentialSlot,
  type AgentCredentialSlotName
} from '../../../../packages/core/src/ai/providers/agent-keys.js';
import type { AIOrchestratorService } from '../../../../packages/core/src/ai-native/ai-orchestrator/service.js';

let orchestratorRef: AIOrchestratorService | undefined;

export function configureAgentKeysRoute(service: AIOrchestratorService): void {
  orchestratorRef = service;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export async function handleAiAgentKeysRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  if (pathname === '/api/v1/ai/agent-keys' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const roster = orchestratorRef ? orchestratorRef.agentRoster() : [];
    const agents = roster.map((a) => ({
      id: a.id,
      name: a.name,
      domain: a.domain,
      description: a.description,
      capabilities: a.capabilities,
      requiresProviderCapabilities: a.requiresProviderCapabilities,
      credentials: agentCredentialHints(a.id)
    }));
    sendJson(res, 200, { agents, expectedAgentCount: AGENT_KEYS_IDS.length, requestId });
    return true;
  }

  const credMatch = /^\/api\/v1\/ai\/agent-keys\/([a-z0-9-]{1,64})\/slot$/.exec(pathname);
  if (credMatch && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const bodyText = await readBody(req);
    let body: { slot?: unknown; providerId?: unknown; apiKey?: unknown };
    try {
      body = bodyText ? (JSON.parse(bodyText) as { slot?: unknown; providerId?: unknown; apiKey?: unknown }) : {};
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }
    const agentId = decodeURIComponent(String(credMatch[1] ?? ''));
    const slotName = typeof body.slot === 'string' ? body.slot.trim() : '';
    if (slotName !== 'primary' && slotName !== 'fallback') {
      throw new ValidationError(`Slot invalide : ${slotName || '(absent)'} (primary ou fallback attendus)`, undefined, requestId);
    }
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
    if (body.apiKey !== undefined && body.apiKey !== null && typeof body.apiKey !== 'string') {
      throw new ValidationError('apiKey doit être une chaîne (ou absente/vide pour suppression du slot)', undefined, requestId);
    }
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
    try {
      const result = setAgentCredentialSlot(agentId, slotName as AgentCredentialSlotName, providerId, apiKey);
      sendJson(res, 200, {
        agentId,
        slot: slotName,
        providerId: result.providerId,
        keyStored: result.stored,
        keyHint: result.hint,
        message: result.stored
          ? `Clé ${slotName} de l'agent enregistrée (${result.providerId}, ${result.hint}). Basculera automatiquement en cas d'échec du principal.`
          : `Slot ${slotName} de l'agent supprimé.`
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { message, requestId });
    }
    return true;
  }

  return false;
}
