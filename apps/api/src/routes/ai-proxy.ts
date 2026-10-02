/**
 * VibeCode Core - API Tier
 * AI Proxy Route — relaie les appels vers Mistral/Codestral depuis le serveur,
 * pour que la clé API ne soit plus jamais visible dans le code du navigateur
 * (correction du problème de sécurité SEC-003 identifié lors de l'audit).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';

// É34 — Format d'outil transmis tel quel à Mistral (type function).
// La validation fine (name/parameters) appartient au modèle et à Mistral ;
// le proxy garantit uniquement la forme et ne modifie jamais le contenu.
interface MistralToolDefinition {
  type?: string;
  function?: { name?: string; description?: string; parameters?: unknown };
}

interface ChatCompletionRequestBody {
  model?: string;
  messages?: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  tools?: MistralToolDefinition[];
}

export async function handleAiProxyRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  if (pathname !== '/api/v1/ai/chat/completions' || req.method !== 'POST') {
    return false;
  }

  assertPermission(context.role, 'PROJECT_READ', requestId);

  const bodyText = await readBody(req);
  let body: ChatCompletionRequestBody;
  try {
    body = bodyText ? (JSON.parse(bodyText) as ChatCompletionRequestBody) : {};
  } catch {
    throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ValidationError('Le champ "messages" est obligatoire et ne peut pas être vide', undefined, requestId);
  }

  // É34 — Tool-calling : les outils éventuels du client sont relayés au
  // modèle. Un champ présent mais non-array est rejeté explicitement (pas
  // d'ignorance silencieuse) ; absent, le comportement est inchangé.
  if (body.tools !== undefined && !Array.isArray(body.tools)) {
    throw new ValidationError('Le champ "tools", s il est fourni, doit être un tableau', undefined, requestId);
  }

  // La clé API reste strictement côté serveur. Un utilisateur peut fournir sa
  // propre clé personnelle via l'en-tête X-Mistral-Api-Key (ex: réglages du
  // Studio) ; à défaut, la clé du serveur (variable d'environnement) est
  // utilisée. Elle n'est jamais renvoyée au client.
  const clientProvidedKey = req.headers['x-mistral-api-key'];
  const apiKey = (typeof clientProvidedKey === 'string' && clientProvidedKey.trim().length > 0
    ? clientProvidedKey.trim()
    : process.env.MISTRAL_API_KEY) || '';

  if (!apiKey) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      message: "Aucune clé API Mistral configurée côté serveur (variable d'environnement MISTRAL_API_KEY manquante).",
      requestId
    }));
    return true;
  }

  const startedAt = Date.now();
  try {
    const upstreamResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: body.model || process.env.MISTRAL_MODEL || 'codestral-latest',
        messages: body.messages,
        temperature: body.temperature ?? 0.2,
        max_tokens: body.max_tokens ?? 8192,
        // É34 — les tools du client (le cas échéant) partent inchangés ;
        // Mistral peut alors répondre avec des tool_calls, que la réponse
        // brute ci-dessous retourne déjà au client sans altération.
        ...(Array.isArray(body.tools) && body.tools.length > 0 ? { tools: body.tools } : {})
      })
    });

    const responseText = await upstreamResponse.text();
    res.statusCode = upstreamResponse.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(responseText);

    logger.info('Appel proxy IA (Mistral) terminé', {
      component: 'ai-proxy',
      tenantId: context.tenantId,
      status: upstreamResponse.status,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Échec de l’appel proxy IA (Mistral)', {
      component: 'ai-proxy',
      tenantId: context.tenantId,
      error: message,
      durationMs: Date.now() - startedAt
    });
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: `Erreur réseau vers Mistral : ${message}`, requestId }));
  }

  return true;
}
