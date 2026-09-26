/**
 * VibeCode Core - AI Provider Abstraction
 * Official Mistral AI & Codestral Adapter (Production Server-Side Adapter)
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

export class MistralProviderAdapter implements AIProviderAdapter {
  public readonly descriptor: AIProviderDescriptor = {
    providerId: 'mistral',
    providerName: 'Mistral AI',
    models: ['codestral-latest', 'mistral-large', 'mistral-small', 'open-mistral-7b'],
    capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING'],
    contextWindow: 131072,
    structuredOutput: true,
    streaming: true,
    toolCalling: true,
    reasoning: false,
    vision: false,
    costMetadata: MODEL_PRICING,
    availability: 'AVAILABLE',
    healthStatus: 'HEALTHY'
  };

  private readonly fetchFn: typeof fetch;

  constructor(customFetch?: typeof fetch) {
    this.fetchFn = customFetch ?? fetch;
  }

  public async generate(
    request: AIProviderGenerateRequest,
    credentials?: TenantProviderCredentials | undefined
  ): Promise<AIProviderGenerateResponse> {
    const apiKey = credentials?.apiKey || process.env.MISTRAL_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new AIProviderAuthError(
        'Clé API Mistral manquante. Spécifiez MISTRAL_API_KEY ou configurez les credentials du tenant.',
        'mistral',
        request.requestId
      );
    }

    const baseUrl = (credentials?.baseUrl || 'https://api.mistral.ai').replace(/\/+$/, '');
    const endpoint = `${baseUrl}/v1/chat/completions`;
    const model = request.model || 'codestral-latest';
    const timeoutMs = request.timeoutMs ?? 15000;

    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(credentials?.customHeaders ?? {})
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 4096
        }),
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
        // Sur une erreur d'authentification, on ajoute un indice sûr (jamais la
        // clé complète) pour permettre de vérifier facilement si le serveur
        // utilise bien la clé attendue, sans jamais exposer le secret entier.
        if (response.status === 401 && apiKey.length >= 8) {
          const hint = `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
          errMessage += ` (clé utilisée par le serveur : ${hint}, longueur ${apiKey.length} caractères — comparez avec la clé testée)`;
        }
        // Mask any potential secret that might be echoed back
        const sanitizedMsg = errMessage.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***');
        throw new AIProviderError(sanitizedMsg, 'mistral', response.status, request.requestId);
      }

      interface MistralApiResponse {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      }

      const data = (await response.json()) as MistralApiResponse;
      const text = data?.choices?.[0]?.message?.content ?? '';

      const inputTokens = data?.usage?.prompt_tokens ?? Math.ceil(request.prompt.length / 4);
      const outputTokens = data?.usage?.completion_tokens ?? Math.ceil(text.length / 4);
      const totalTokens = data?.usage?.total_tokens ?? (inputTokens + outputTokens);

      const usageRecord = aiUsageTracker.recordUsage(
        request.tenantId,
        request.projectId,
        model,
        inputTokens,
        outputTokens,
        request.requestId ?? 'req-unknown'
      );

      return {
        text,
        providerId: 'mistral',
        modelId: model,
        latencyMs,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens
        },
        costUsd: usageRecord.estimatedCostUsd,
        rawResponse: data
      };
    } catch (err: unknown) {
      if (err instanceof AIProviderError || err instanceof AIProviderAuthError) {
        throw err;
      }
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        throw new AIProviderTimeoutError('mistral', timeoutMs, request.requestId);
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = rawMsg.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***');
      throw new AIProviderError(`Erreur d'appel Mistral: ${sanitized}`, 'mistral', 500, request.requestId);
    } finally {
      clearTimeout(timer);
    }
  }

  public async checkHealth(credentials?: TenantProviderCredentials | undefined): Promise<boolean> {
    const apiKey = credentials?.apiKey || process.env.MISTRAL_API_KEY;
    if (!apiKey) return false;
    try {
      const res = await this.fetchFn('https://api.mistral.ai/v1/models', {
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
   * STREAMING — Appelle Mistral avec stream: true et yield les chunks de texte
   * au fur et à mesure qu'ils arrivent. Permet au Studio d'afficher la réponse
   * en temps réel (effet machine à écrire, comme Cursor / v0 / ChatGPT).
   *
   * Retourne un AsyncIterable<string> où chaque élément est un fragment de
   * texte delta (généralement 1-5 tokens). Le caller peut boucler avec
   * `for await (const chunk of stream) { ... }`.
   */
  public async *generateStream(
    request: AIProviderGenerateRequest,
    credentials?: TenantProviderCredentials | undefined
  ): AsyncIterable<string> {
    const apiKey = credentials?.apiKey || process.env.MISTRAL_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new AIProviderAuthError(
        'Clé API Mistral manquante pour le streaming. Spécifiez MISTRAL_API_KEY ou configurez les credentials du tenant.',
        'mistral',
        request.requestId
      );
    }

    const baseUrl = (credentials?.baseUrl || 'https://api.mistral.ai').replace(/\/+$/, '');
    const endpoint = `${baseUrl}/v1/chat/completions`;
    const model = request.model || 'codestral-latest';
    const timeoutMs = request.timeoutMs ?? 120000; // 2 minutes pour le streaming

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
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: request.temperature ?? 0.4,
          max_tokens: request.maxTokens ?? 8192,
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
        const sanitizedMsg = errMessage.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***');
        throw new AIProviderError(sanitizedMsg, 'mistral', response.status, request.requestId);
      }

      if (!response.body) {
        throw new AIProviderError('Stream vide reçu de Mistral', 'mistral', 500, request.requestId);
      }

      // Parse SSE stream ligne par ligne
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Mistral envoie des lignes au format SSE : "data: {...}\n\n"
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Garde la dernière ligne incomplète dans le buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') {
            return; // Fin du stream
          }

          try {
            const chunk = JSON.parse(dataStr) as {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string | null;
              }>;
            };
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta && delta.length > 0) {
              yield delta;
            }
          } catch {
            // Ligne non-JSON ou partielle, on ignore
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof AIProviderError || err instanceof AIProviderAuthError) {
        throw err;
      }
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        throw new AIProviderTimeoutError('mistral', timeoutMs, request.requestId);
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = rawMsg.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***');
      throw new AIProviderError(`Erreur de streaming Mistral: ${sanitized}`, 'mistral', 500, request.requestId);
    } finally {
      clearTimeout(timer);
    }
  }
}
