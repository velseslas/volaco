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
import { getActiveAiProviderId, getCatalogEntry, providerEnvKey, providerStoredKey } from '../../../../packages/core/src/ai/providers/provider-catalog.js';

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

// P0-PROD (audit de production) — plafonds serveur du proxy IA. Le client
// ne peut plus fixer un max_tokens arbitraire : tout dépassement est
// clampé, jamais refusé silencieusement augmenté. Les variables
// d'environnement ne peuvent que DURCIR (baisser) ces plafonds.
//
// LOT S6 — Quota par tenant : l'audit a signalé qu'un tenant A ne devait pas
// pouvoir épuiser le budget d'un autre tenant sur la même IP (NAT partagé) ni
// sur le quota global (`RATE_LIMIT_AI_MAX`). Compteur par tenantId/minute
// (clé `context.tenantId` côté serveur) géré ci-dessous ; variable
// `VOLACO_PROXY_TENANT_REQ_PER_MINUTE` (défaut 100, opérateur-contrôlé).
const PROXY_HARD_MAX_TOKENS = 8192;
const PROXY_MAX_MESSAGES = 200;
const PROXY_MAX_MESSAGE_CHARS = 100_000;
const PROXY_FETCH_TIMEOUT_MS = 45_000;
const PROXY_MAX_ATTEMPTS = 3;
const PROXY_RETRY_BASE_DELAY_MS = 500;
const PROXY_TENANT_WINDOW_MS = 60_000;
const tenantProxyBuckets = new Map<string, { count: number; windowStart: number }>();

function tenantProxyQuotaPerMinute(): number {
  const raw = process.env.VOLACO_PROXY_TENANT_REQ_PER_MINUTE;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 100;
}

/** Retourne `true` si le tenant a encore du budget proxy sur la fenêtre. */
function checkTenantProxyQuota(tenantId: string): boolean {
  const normalized = (tenantId || '').trim();
  if (!normalized) return true;
  const now = Date.now();
  const max = tenantProxyQuotaPerMinute();
  const bucket = tenantProxyBuckets.get(normalized);
  if (!bucket || now - bucket.windowStart >= PROXY_TENANT_WINDOW_MS) {
    // Purge amortie pour éviter la fuite mémoire sur tenants ephemeral.
    if (tenantProxyBuckets.size > 10_000) {
      for (const [k, b] of tenantProxyBuckets) {
        if (now - b.windowStart >= PROXY_TENANT_WINDOW_MS) {
          tenantProxyBuckets.delete(k);
        }
      }
    }
    tenantProxyBuckets.set(normalized, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

function clampPositiveInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  if (floored < min) return min;
  if (floored > max) return max;
  return floored;
}

function envCeiling(name: string, hardCeiling: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return hardCeiling;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return hardCeiling;
  return Math.min(parsed, hardCeiling);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * LOT MULTI-MODÈLES — traduction Anthropic : system séparé, max_tokens
 * obligatoire, rôles bornés à user/assistant, tools en input_schema.
 * Uniquement utilisé quand le fournisseur cible est Claude.
 */
function buildAnthropicUpstreamPayload(
  body: ChatCompletionRequestBody,
  model: string,
  maxTokens: number
): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts: string[] = [];
  const convo: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    convo.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  const payload: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature: body.temperature ?? 0.2,
    messages: convo
  };
  if (systemParts.length > 0) {
    payload.system = systemParts.join('\n\n');
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    payload.tools = body.tools.map((t) => ({
      name: t.function?.name ?? String((t as unknown as { name?: string }).name ?? 'tool'),
      description: t.function?.description ?? '',
      input_schema: t.function?.parameters ?? {}
    }));
  }
  return payload;
}

/** LOT MULTI-MODÈLES — traduction Gemini : format Google natif generateContent
 * (system → systemInstruction, assistant → role "model") ; le modèle passe
 * dans l'URL, jamais dans le corps. Les tool calls ne sont pas traduits ici :
 * le format functionDeclarations Google diffère — refus explicite plutôt que
 * une requête mensongère. */
function buildGeminiUpstreamPayload(
  body: ChatCompletionRequestBody,
  maxTokens: number
): Record<string, unknown> {
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    throw new ValidationError(
      'Gemini : les tool calls ne sont pas adressables par ce proxy (format Google natif) — la génération intégrée reste disponible.',
      undefined
    );
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts: string[] = [];
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const payload: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: body.temperature ?? 0.2, maxOutputTokens: maxTokens }
  };
  if (systemParts.length > 0) {
    payload.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
  }
  return payload;
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

  // LOT S6 — quota par tenant : l'audit a signalé qu'un tenant A ne devait pas
  // pouvoir épuiser le budget d'un autre tenant sur la même IP (NAT partagé) ni
  // sur le quota global (`RATE_LIMIT_AI_MAX`). Compteur par tenantId/minute
  // (clé `context.tenantId` côté serveur) géré ci-dessous ; variable
  // `VOLACO_PROXY_TENANT_REQ_PER_MINUTE` (défaut 100, opérateur-contrôlé).
  // Plafond serveur transversal (planchers applicatifs) ; 429 explicite avec
  // Retry-After quand le plafond par tenant est dépassé.
  if (!checkTenantProxyQuota(context.tenantId)) {
    res.statusCode = 429;
    res.setHeader('Retry-After', '60');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: {
        code: 'PROXY_TENANT_QUOTA_EXCEEDED',
        message: 'Quota proxy IA pour ce tenant atteint — réessayez dans une minute.',
        statusCode: 429,
        requestId
      }
    }));
    return true;
  }

  // P0-PROD — validation serveur des paramètres client (facture IA bornée).
  const maxOutputTokens = envCeiling('VOLACO_PROXY_MAX_TOKENS', PROXY_HARD_MAX_TOKENS);
  if (body.messages.length > PROXY_MAX_MESSAGES) {
    throw new ValidationError(`Le champ "messages" ne peut pas dépasser ${PROXY_MAX_MESSAGES} messages`, undefined, requestId);
  }
  let inboundChars = 0;
  for (const m of body.messages) {
    if (!m || typeof m.role !== 'string' || typeof m.content !== 'string') {
      throw new ValidationError('Chaque message doit avoir un "role" et un "content" de type chaîne', undefined, requestId);
    }
    if (m.content.length > PROXY_MAX_MESSAGE_CHARS) {
      throw new ValidationError(`Un message dépasse la taille maximale (${PROXY_MAX_MESSAGE_CHARS} caractères)`, undefined, requestId);
    }
    inboundChars += m.content.length;
  }
  if (body.temperature !== undefined && (!Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2)) {
    throw new ValidationError('Le champ "temperature" doit être compris entre 0 et 2', undefined, requestId);
  }
  // FIX CLÉS GROQ (2026-11-02) — les identifiers de modèle actuels de Groq
  // portent un espace de noms avec '/' (openai/gpt-oss-120b…). La whitelist
  // ci-dessous rejetait tout id contenant '/' → le relais renvoyait 400
  // pour un corps pourtant valide. '/' est aussi toléré dès le 2e caractère.
  if (body.model !== undefined && (typeof body.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9\/._-]{0,63}$/.test(body.model))) {
    throw new ValidationError('Le champ "model", s il est fourni, doit être un identifiant de modèle valide', undefined, requestId);
  }
  const requestedMaxTokens = body.max_tokens ?? 8192;
  const effectiveMaxTokens = clampPositiveInt(requestedMaxTokens, 8192, 1, maxOutputTokens);

  // É34 — Tool-calling : les outils éventuels du client sont relayés au
  // modèle. Un champ présent mais non-array est rejeté explicitement (pas
  // d'ignorance silencieuse) ; absent, le comportement est inchangé.
  if (body.tools !== undefined && !Array.isArray(body.tools)) {
    throw new ValidationError('Le champ "tools", s il est fourni, doit être un tableau', undefined, requestId);
  }

  // La clé API reste strictement côté serveur. LOT MULTI-MODÈLES :
  //  - X-Provider-Id (optionnel) choisit le fournisseur ;
  //  - sinon le fournisseur ACTIF du tableau de bord (commutateur ON) ;
  //  - sinon Mistral (héritage strict : comportement identique à avant).
  // L'utilisateur peut fournir sa propre clé personnelle via X-Provider-Api-Key
  // (X-Mistral-Api-Key reste accepté pour Mistral) ; à défaut, la clé du
  // serveur (env) est utilisée. Elle n'est jamais renvoyée au client.
  const headerProvider = typeof req.headers['x-provider-id'] === 'string'
    ? String(req.headers['x-provider-id']).trim().toLowerCase()
    : '';
  const requestedProvider = headerProvider.length > 0 && headerProvider.length <= 24 && /^[a-z0-9-]+$/.test(headerProvider)
    ? headerProvider
    : (getActiveAiProviderId() ?? 'mistral');
  const providerConfig = getCatalogEntry(requestedProvider);
  if (!providerConfig) {
    throw new ValidationError(`Fournisseur IA inconnu : ${requestedProvider}`, undefined, requestId);
  }

  const genericKey = typeof req.headers['x-provider-api-key'] === 'string' ? String(req.headers['x-provider-api-key']).trim() : '';
  const legacyMistralKey = requestedProvider === 'mistral' && typeof req.headers['x-mistral-api-key'] === 'string'
    ? String(req.headers['x-mistral-api-key']).trim()
    : '';
  const clientProvidedKey = genericKey.length > 0 ? genericKey : legacyMistralKey;
  // Priorité : clé du client (test personnel) > clé enregistrée dans la carte > env.
  const apiKey = (clientProvidedKey
    || providerStoredKey(requestedProvider)
    || providerEnvKey(requestedProvider)) || '';

  if (!apiKey) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      message: `Aucune clé API ${providerConfig.providerName} configurée côté serveur (${providerConfig.envKeys.join(' ou ')} manquantes).`,
      requestId
    }));
    return true;
  }

  const startedAt = Date.now();
  const upstreamModel = body.model
    || (providerConfig.modelEnvKey ? (process.env[providerConfig.modelEnvKey] || '') : '')
    || providerConfig.defaultModel;
  const isClaude = providerConfig.providerId === 'claude';
  // LOT MULTI-MODÈLES — la géométrie upstream suit le FORMAT du fournisseur :
  // compatible OpenAI → /chat/completions ; Claude → /v1/messages ; Gemini →
  // /models/<model>:generateContent. CORRECTIF 404 : avant, tout fournisseur
  // non-compatible-OpenAI (donc GEMINI et Gemini seul) tombait dans la branche
  // Claude → URL https://…/v1beta/v1/messages refusée par Google (HTTP 404).
  const isGemini = providerConfig.providerId === 'gemini';
  const upstreamUrl = providerConfig.openaiCompatible
    ? `${providerConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`
    : isGemini
      ? `${providerConfig.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(upstreamModel)}:generateContent`
      : `${providerConfig.baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const upstreamHeaders: Record<string, string> = isClaude
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    : isGemini
      ? { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }
      : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const upstreamPayload: Record<string, unknown> = isClaude
    ? buildAnthropicUpstreamPayload(body, upstreamModel, effectiveMaxTokens)
    : isGemini
      ? buildGeminiUpstreamPayload(body, effectiveMaxTokens)
      : {
          model: upstreamModel,
          messages: body.messages,
          temperature: body.temperature ?? 0.2,
          max_tokens: effectiveMaxTokens,
          // É34 — les tools du client (le cas échéant) partent inchangés ;
          // Mistral peut alors répondre avec des tool_calls, que la réponse
          // brute ci-dessous retourne déjà au client sans altération.
          ...(Array.isArray(body.tools) && body.tools.length > 0 ? { tools: body.tools } : {})
        };

  // P0-PROD — timeout borné + retry backoff sur erreurs réseau / 429 / 5xx.
  // Avant : fetch sans signal ni retry — un provider lent laissait la
  // requête HTTP pendre jusqu'à la fermeture socket.
  let upstreamResponse: Response | null = null;
  let lastNetworkError: string | null = null;
  // FIX TEST-HONNÊTETÉ (page Clés API) : quand la clé client mistral est
  // rejetée (401) et que le serveur retente avec SA clé env, le client reçoit
  // un 200 — sans ce marqueur il croirait SA clé valide. La réponse porte
  // désormais X-Volaco-Client-Key-Rejected: 1 dans ce cas.
  let clientKeyRejectedMistral = false;
  for (let attempt = 1; attempt <= PROXY_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(upstreamPayload),
        signal: controller.signal
      });
      // FIX 401 récurrent — une clé fournie par le client (X-Mistral-Api-Key,
      // souvent une ancienne clé révoquée stockée dans le navigateur) ne doit
      // pas faire échouer la requête quand le serveur possède une clé valide :
      // retente UNE fois avec la clé serveur, sans compter comme tentative.
      if (res.status === 401 && clientProvidedKey && requestedProvider === 'mistral') {
        const envMistralKey = (providerEnvKey('mistral') || '').trim();
        if (envMistralKey && apiKey !== envMistralKey) {
          logger.warn('Proxy IA : clé client rejetée (401), nouvelle tentative avec la clé serveur', {
            component: 'ai-proxy',
            tenantId: context.tenantId,
            rejectedKeyHint: `${clientProvidedKey.slice(0, 4)}...${clientProvidedKey.slice(-4)} (len ${clientProvidedKey.length})`
          });
          await res.arrayBuffer().catch(() => null);
          const retry = await fetch(upstreamUrl, {
            method: 'POST',
            headers: { ...upstreamHeaders, Authorization: `Bearer ${envMistralKey}` },
            body: JSON.stringify(upstreamPayload),
            signal: controller.signal
          });
          upstreamResponse = retry;
          clientKeyRejectedMistral = true;
          break;
        }
      }
      if ((res.status === 429 || res.status >= 500) && attempt < PROXY_MAX_ATTEMPTS) {
        await res.arrayBuffer().catch(() => null);
        const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 10_000)
          : PROXY_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        logger.warn('Proxy IA : réponse transitoire, nouvel essai', {
          component: 'ai-proxy',
          tenantId: context.tenantId,
          status: res.status,
          attempt,
          delayMs
        });
        await sleep(delayMs);
        continue;
      }
      upstreamResponse = res;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastNetworkError = message;
      if (attempt < PROXY_MAX_ATTEMPTS) {
        const delayMs = PROXY_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        logger.warn('Proxy IA : échec réseau, nouvel essai', {
          component: 'ai-proxy',
          tenantId: context.tenantId,
          error: message,
          attempt,
          delayMs
        });
        await sleep(delayMs);
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!upstreamResponse) {
    logger.warn('Échec du proxy IA après épuisement des tentatives', {
      component: 'ai-proxy',
      tenantId: context.tenantId,
      provider: providerConfig.providerId,
      error: lastNetworkError,
      durationMs: Date.now() - startedAt
    });
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: `Erreur réseau vers ${providerConfig.providerName} après ${PROXY_MAX_ATTEMPTS} tentatives : ${lastNetworkError ?? 'inconnue'}`, requestId }));
    return true;
  }

  try {
    const responseText = await upstreamResponse.text();
    // LOT MULTI-MODÈLES — Claude renvoie sa forme propre (content blocks) ;
    // on re-trade vers la forme OpenAI attendue par le Studio (choices/usage),
    // pour que le client reste identique quel que soit le fournisseur.
    let responseBody = responseText;
    if (isClaude) {
      try {
        const anthropic = JSON.parse(responseText) as {
          content?: Array<{ type: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const text = (anthropic.content ?? [])
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text as string)
          .join('');
        const inputTokens = anthropic.usage?.input_tokens ?? 0;
        const outputTokens = anthropic.usage?.output_tokens ?? 0;
        responseBody = JSON.stringify({
          choices: [{ message: { role: 'assistant', content: text } }],
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens
          }
        });
      } catch {
        // format inattendu → texte brut inchangé
      }
    }
    // LOT MULTI-MODÈLES — traduction des réponses Gemini (generateContent) vers
    // la forme OpenAI attendue par le Studio : candidates[0].content.parts →
    // choices[0].message.content ; usageMetadata → usage standard.
    if (isGemini && upstreamResponse.ok) {
      try {
        const gemini = JSON.parse(responseText) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const text = (gemini.candidates?.[0]?.content?.parts ?? [])
          .map((p) => (typeof p?.text === 'string' ? p.text : ''))
          .join('');
        const inTokens = gemini.usageMetadata?.promptTokenCount ?? 0;
        const outTokens = gemini.usageMetadata?.candidatesTokenCount ?? 0;
        responseBody = JSON.stringify({
          choices: [{ message: { role: 'assistant', content: text } }],
          usage: {
            prompt_tokens: inTokens,
            completion_tokens: outTokens,
            total_tokens: inTokens + outTokens
          }
        });
      } catch {
        // format inattendu → texte brut inchangé
      }
    }
    res.statusCode = upstreamResponse.status;
    res.setHeader('Content-Type', 'application/json');
    if (clientKeyRejectedMistral) {
      // Honnêteté : même si le retry env a réussi, la clé DU CLIENT est invalide.
      res.setHeader('X-Volaco-Client-Key-Rejected', '1');
    }
    if (upstreamResponse.status >= 400) {
      // CORRECTIF UX — l'erreur upstream (401 clé invalide, 404 modèle absent,
      // 419 etc.) arrive avec le format propre du fournisseur ; sans traduction,
      // le Studio n'affiche que « HTTP 404 » sans cause. On expose la cause.
      let upstreamMessage = responseText.slice(0, 300).trim();
      try {
        const parsed = JSON.parse(responseText) as { error?: { message?: string }; message?: string };
        upstreamMessage = String(parsed?.error?.message ?? parsed?.message ?? upstreamMessage);
      } catch { /* corps non-JSON → extrait brut conservé */ }
      res.end(JSON.stringify({
        message: `${providerConfig.providerName} a refusé la requête (HTTP ${upstreamResponse.status}) : ${upstreamMessage}`,
        providerId: providerConfig.providerId,
        model: upstreamModel,
        requestId
      }));
    } else {
      res.end(responseBody);
    }

    logger.info('Appel proxy IA terminé', {
      component: 'ai-proxy',
      tenantId: context.tenantId,
      provider: providerConfig.providerId,
      status: upstreamResponse.status,
      model: upstreamModel,
      maxTokens: effectiveMaxTokens,
      inboundChars,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Échec de l’appel proxy IA', {
      component: 'ai-proxy',
      tenantId: context.tenantId,
      provider: providerConfig.providerId,
      error: message,
      durationMs: Date.now() - startedAt
    });
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: `Erreur réseau vers ${providerConfig.providerName} : ${message}`, requestId }));
  }

  return true;
}
