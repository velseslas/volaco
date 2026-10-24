/**
 * VibeCode Core - AI Providers multi-fournisseurs compatibles OpenAI
 *
 * LOT MULTI-MODÈLES — 7 fournisseurs supplémentaires partagent EXACTEMENT le
 * format filaire de Mistral (POST {baseUrl}/chat/completions, Bearer, messages,
 * tools, SSE `data:` en delta.content) :
 *   openai, deepseek, kimi (Moonshot), glm (Zhipu), qwen (DashScope),
 *   groq, xai (xAI Grok).
 *
 * Modèle de code = MistralProviderAdapter (di signature identique : fetch
 * injectable pour les tests, credentials tenant en surcharge, usage/abort).
 * Les clés restent STRICTEMENT côté serveur (env, décision utilisateur) :
 * credentials?.apiKey reste accepté pour les flux internes existants.
 */

import { aiUsageTracker, MODEL_PRICING } from '../usage.js';
import {
  AIProviderAdapter,
  AIProviderAuthError,
  AIProviderDescriptor,
  AIProviderError,
  AIProviderGenerateRequest,
  AIProviderGenerateResponse,
  AIProviderTimeoutError,
  TenantProviderCredentials
} from './types.js';
import {
  OPENAI_COMPATIBLE_PROVIDERS,
  OpenAiCompatibleProviderConfig,
  providerEnvKey,
  providerStoredKey
} from './provider-catalog.js';

export class OpenAICompatibleProviderAdapter implements AIProviderAdapter {
  public readonly descriptor: AIProviderDescriptor;
  private readonly config: OpenAiCompatibleProviderConfig;
  private readonly fetchFn: typeof fetch;

  constructor(config: OpenAiCompatibleProviderConfig, customFetch?: typeof fetch) {
    this.config = config;
    this.fetchFn = customFetch ?? fetch;
    this.descriptor = {
      providerId: config.providerId,
      providerName: config.providerName,
      models: config.models,
      capabilities: config.capabilities,
      contextWindow: config.contextWindow,
      structuredOutput: true,
      streaming: true,
      toolCalling: true,
      reasoning: config.reasoning,
      vision: config.vision,
      costMetadata: MODEL_PRICING,
      availability: 'AVAILABLE',
      healthStatus: 'HEALTHY'
    };
  }

  private resolveApiKey(credentials?: TenantProviderCredentials | undefined): string | undefined {
    // Priorité : credentials du tenant (flux internes) > clé de carte > env.
    return credentials?.apiKey
      || providerStoredKey(this.config.providerId)
      || providerEnvKey(this.config.providerId)
      || undefined;
  }

  public async generate(
    request: AIProviderGenerateRequest,
    credentials?: TenantProviderCredentials | undefined
  ): Promise<AIProviderGenerateResponse> {
    const providerId = this.config.providerId;
    const apiKey = this.resolveApiKey(credentials);
    if (!apiKey || apiKey.trim().length === 0) {
      throw new AIProviderAuthError(
        `Clé API ${this.config.providerName} manquante. Spécifiez la variable d'environnement attendue ou configurez les credentials du tenant.`,
        providerId,
        request.requestId
      );
    }

    const baseUrl = (credentials?.baseUrl || this.config.baseUrl).replace(/\/+$/, '');
    const endpoint = `${baseUrl}/chat/completions`;
    const model = request.model || providerEnvDefaultModel(providerId) || this.config.defaultModel;
    const timeoutMs = request.timeoutMs ?? 15000;

    // É33 — Historique multi-tours, format identique à Mistral.
    let messages: Record<string, unknown>[];
    if (request.messages && request.messages.length > 0) {
      messages = request.messages.map((m) => {
        const wire: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          wire.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments ?? '{}' }
          }));
        }
        if (m.role === 'tool') {
          if (m.toolCallId) wire.tool_call_id = m.toolCallId;
          if (m.name) wire.name = m.name;
        }
        return wire;
      });
    } else {
      messages = [];
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      messages.push({ role: 'user', content: request.prompt });
    }

    const requestBody: Record<string, unknown> = {
      model,
      messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 4096,
      stream: false
    };
    if (request.tools && request.tools.length > 0) {
      requestBody.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (request.signal?.aborted) {
      clearTimeout(timer);
      const aborted = new Error(`Appel ${providerId} interrompu : client abandonné.`);
      aborted.name = 'AbortError';
      throw aborted;
    }
    request.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    const startTime = Date.now();

    aiUsageTracker.recordAttempt({
      tenantId: request.tenantId,
      projectId: request.projectId,
      model,
      provider: providerId,
      requestId: request.requestId ?? 'req-unknown',
      kind: 'START'
    });

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(credentials?.customHeaders ?? {})
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        let errMessage = `HTTP ${response.status}`;
        try {
          const errBody = (await response.json()) as { message?: string; error?: { message?: string } };
          errMessage = errBody?.error?.message || errBody?.message || errMessage;
        } catch {
          // Keep HTTP status
        }
        if (response.status === 401 && apiKey.length >= 8) {
          const hint = `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
          errMessage += ` (clé utilisée par le serveur : ${hint}, longueur ${apiKey.length} caractères — comparez avec la clé testée)`;
        }
        const sanitizedMsg = errMessage.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***');
        throw new AIProviderError(sanitizedMsg, providerId, response.status, request.requestId);
      }

      interface CompatibleApiResponse {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      }

      const data = (await response.json()) as CompatibleApiResponse;
      const text = data?.choices?.[0]?.message?.content ?? '';

      const rawToolCalls = data?.choices?.[0]?.message?.tool_calls;
      const toolCalls = rawToolCalls?.length
        ? rawToolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function?.name ?? '',
            arguments: tc.function?.arguments || '{}'
          }))
        : undefined;

      const inputTokens = data?.usage?.prompt_tokens ?? Math.ceil(request.prompt.length / 4);
      const outputTokens = data?.usage?.completion_tokens ?? Math.ceil(text.length / 4);
      const totalTokens = data?.usage?.total_tokens ?? (inputTokens + outputTokens);

      const usageRecord = aiUsageTracker.recordUsage(
        request.tenantId,
        request.projectId,
        model,
        inputTokens,
        outputTokens,
        request.requestId ?? 'req-unknown',
        providerId
      );

      return {
        text,
        providerId,
        modelId: model,
        latencyMs,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens
        },
        costUsd: usageRecord.estimatedCostUsd,
        rawResponse: data,
        ...(toolCalls ? { toolCalls } : {})
      };
    } catch (err: unknown) {
      const rawErr = err instanceof Error ? err.message : String(err);
      aiUsageTracker.recordAttempt({
        tenantId: request.tenantId,
        projectId: request.projectId,
        model,
        provider: providerId,
        requestId: request.requestId ?? 'req-unknown',
        kind: 'ERROR',
        error: rawErr.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***').slice(0, 300)
      });
      if (err instanceof AIProviderError || err instanceof AIProviderAuthError) {
        throw err;
      }
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        throw new AIProviderTimeoutError(providerId, timeoutMs, request.requestId);
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = rawMsg.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***');
      throw new AIProviderError(`Erreur d'appel ${this.config.providerName} : ${sanitized}`, providerId, 500, request.requestId);
    } finally {
      clearTimeout(timer);
    }
  }

  public async checkHealth(credentials?: TenantProviderCredentials | undefined): Promise<boolean> {
    const apiKey = this.resolveApiKey(credentials);
    if (!apiKey) return false;
    try {
      const res = await this.fetchFn(`${(credentials?.baseUrl || this.config.baseUrl).replace(/\/+$/, '')}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`
        }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * STREAMING — même contrat que MistralProviderAdapter.generateStream :
   * SSE OpenAI (lignes `data: {...}`), deltas via choices[0].delta.content.
   */
  public async *generateStream(
    request: AIProviderGenerateRequest,
    credentials?: TenantProviderCredentials | undefined
  ): AsyncIterable<string> {
    const providerId = this.config.providerId;
    const apiKey = this.resolveApiKey(credentials);
    if (!apiKey || apiKey.trim().length === 0) {
      throw new AIProviderAuthError(
        `Clé API ${this.config.providerName} manquante pour le streaming.`,
        providerId,
        request.requestId
      );
    }

    const baseUrl = (credentials?.baseUrl || this.config.baseUrl).replace(/\/+$/, '');
    const endpoint = `${baseUrl}/chat/completions`;
    const model = request.model || providerEnvDefaultModel(providerId) || this.config.defaultModel;
    const timeoutMs = request.timeoutMs ?? 120000;

    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          ...(credentials?.customHeaders ?? {})
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 4096,
          stream: true
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        let errMessage = `HTTP ${response.status}`;
        try {
          const errBody = (await response.json()) as { message?: string; error?: { message?: string } };
          errMessage = errBody?.error?.message || errBody?.message || errMessage;
        } catch {
          // Keep HTTP status
        }
        throw new AIProviderError(errMessage, providerId, response.status, request.requestId);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AIProviderError(`Réponse ${providerId} sans flux lisible`, providerId, 502, request.requestId);
      }
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (!finished) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let sep = buffer.indexOf('\n');
        while (sep >= 0) {
          const line = buffer.slice(0, sep).trim();
          buffer = buffer.slice(sep + 1);
          sep = buffer.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { finished = true; break; }
          try {
            const evt = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string | null } }>;
            };
            const delta = evt?.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // fragment SSE non JSON (ligne partielle) — ignoré
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof AIProviderError || err instanceof AIProviderAuthError) {
        throw err;
      }
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        throw new AIProviderTimeoutError(providerId, timeoutMs, request.requestId);
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = rawMsg.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***');
      throw new AIProviderError(`Erreur de streaming ${this.config.providerName} : ${sanitized}`, providerId, 500, request.requestId);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Default model overridable par l'environnement (ex. OPENAI_MODEL). */
export function providerEnvDefaultModel(providerId: string): string | undefined {
  const raw = process.env[`${providerId.toUpperCase()}_MODEL`];
  if (raw === undefined || raw.trim() === '') return undefined;
  return raw.trim().match(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,80}$/) ? raw.trim() : undefined;
}

/**
 * LOT MULTI-MODÈLES — fabrique les 7 adaptateurs compatibles OpenAI à partir
 * du catalogue (openai, deepseek, kimi, glm, qwen, groq, xai).
 */
export function createOpenAICompatibleAdapters(customFetch?: typeof fetch): OpenAICompatibleProviderAdapter[] {
  return OPENAI_COMPATIBLE_PROVIDERS.map((config) => new OpenAICompatibleProviderAdapter(config, customFetch));
}
