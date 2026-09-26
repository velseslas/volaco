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
interface ChatCompletionRequestBody {
  model?: string;
  messages?: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
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
        max_tokens: body.max_tokens ?? 8192
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
