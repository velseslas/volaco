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
    const model = request.model || process.env.MISTRAL_MODEL || 'codestral-latest';
    const timeoutMs = request.timeoutMs ?? 15000;

    // É33 — Historique multi-tours : quand request.messages est fourni, il
    // remplace la construction mono-tour systemPrompt+prompt. Sinon le
    // comportement existant est strictement inchangé.
    let messages: Record<string, unknown>[];
    if (request.messages && request.messages.length > 0) {
      messages = request.messages.map((m) => {
        const wire: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          wire.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments }
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
        max_tokens: request.maxTokens ?? 4096
      };
      // É32 — Tool-calling : les outils fournis par l'appelant sont transmis
      // au modèle dans le format OpenAI/Mistral (type: 'function').
      if (request.tools && request.tools.length > 0) {
        requestBody.tools = request.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters }
        }));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // P0-masse n°3 — abandon client : coupe l'appel réseau en cours.
      if (request.signal?.aborted) {
        clearTimeout(timer);
        const aborted = new Error('Appel Mistral interrompu : client abandonné.');
        aborted.name = 'AbortError';
        throw aborted;
      }
      request.signal?.addEventListener('abort', () => controller.abort(), { once: true });
      const startTime = Date.now();

      // É48 P4 (J-6) — l'attempt est visible dès le démarrage de l'appel :
      // crash/timeout/erreur → l'événement START reste tracé (coût 0).
      aiUsageTracker.recordAttempt({
        tenantId: request.tenantId,
        projectId: request.projectId,
        model,
        provider: 'mistral',
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

      const data = (await response.json()) as MistralApiResponse;
      const text = data?.choices?.[0]?.message?.content ?? '';

      // É32 — Tool-calling : les tool_calls du modèle sont extraits de la
      // réponse et retournés à l'appelant (sans exécution ici — l'appelant
      // décide quoi faire des arguments).
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
        'mistral'
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
        rawResponse: data,
        ...(toolCalls ? { toolCalls } : {})
      };
    } catch (err: unknown) {
      // É48 P4 (J-6) — terminal ERROR unique : l'appel a eu lieu mais n'a pas
      // abouti → usage inconnu, coût 0 (jamais inventé), message sanitisé.
      const rawErr = err instanceof Error ? err.message : String(err);
      aiUsageTracker.recordAttempt({
        tenantId: request.tenantId,
        projectId: request.projectId,
        model,
        provider: 'mistral',
        requestId: request.requestId ?? 'req-unknown',
        kind: 'ERROR',
        error: rawErr.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***').slice(0, 300)
      });
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
    const model = request.model || process.env.MISTRAL_MODEL || 'codestral-latest';
    const timeoutMs = request.timeoutMs ?? 120000; // 2 minutes pour le streaming

    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // É48 P4 (J-6) — exactement un terminal par appel de stream : SUCCESS
    // (complété, usage final non disponible → coût 0, J-6b différé), ERROR
    // (échec) ou ABORTED (interrompu avant complétion). Jamais deux.
    let streamTerminalEmitted = false;
    // J-6b — usage final réel transmis par Mistral dans le dernier chunk du
    // stream (`usage: {prompt_tokens, completion_tokens, total_tokens}`).
    // Absent la plupart du temps : on ne l'invente jamais (ni estimation,
    // ni zéro factuel — voir le terminal SUCCESS ci-dessous).
    let streamUsage: { promptTokens: number; completionTokens: number } | null = null;

    try {
      aiUsageTracker.recordAttempt({
        tenantId: request.tenantId,
        projectId: request.projectId,
        model,
        provider: 'mistral',
        requestId: request.requestId ?? 'req-unknown',
        kind: 'START'
      });

      // J-6b — terminal SUCCESS unique du stream. Si Mistral a transmis
      // l'usage final réel, il est enregistré avec son coût réel
      // (recordUsage). Sinon, on conserve l'event 0-coût historique
      // (usage inconnu — jamais converti en zéro factuel, jamais estimé).
      const recordStreamTerminalSuccess = (): void => {
        if (streamUsage) {
          aiUsageTracker.recordUsage(
            request.tenantId,
            request.projectId,
            model,
            streamUsage.promptTokens,
            streamUsage.completionTokens,
            request.requestId ?? 'req-unknown',
            'mistral'
          );
        } else {
          aiUsageTracker.recordAttempt({
            tenantId: request.tenantId,
            projectId: request.projectId,
            model,
            provider: 'mistral',
            requestId: request.requestId ?? 'req-unknown',
            kind: 'SUCCESS'
          });
        }
        streamTerminalEmitted = true;
      };

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
            // É48 P4 — terminal SUCCESS du stream (J-6b : usage réel si
            // transmis, sinon event 0-coût historique).
            recordStreamTerminalSuccess();
            return; // Fin du stream
          }

          try {
            const chunk = JSON.parse(dataStr) as {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string | null;
              }>;
              usage?: {
                prompt_tokens?: unknown;
                completion_tokens?: unknown;
                total_tokens?: unknown;
              };
            };
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta && delta.length > 0) {
              yield delta;
            }
            // J-6b — capture l'usage final réel quand Mistral le transmet
            // dans un chunk (dernier chunk avant [DONE]). Validation
            // stricte : nombres finis ≥ 0, sinon ignoré (jamais inventé).
            const u = chunk.usage;
            if (u && typeof u === 'object') {
              const p = u.prompt_tokens;
              const c = u.completion_tokens;
              if (typeof p === 'number' && typeof c === 'number' &&
                  Number.isFinite(p) && Number.isFinite(c) && p >= 0 && c >= 0) {
                streamUsage = { promptTokens: Math.floor(p), completionTokens: Math.floor(c) };
              }
            }
          } catch {
            // Ligne non-JSON ou partielle, on ignore
          }
        }
      }

      // É48 P4 — terminal SUCCESS : le corps du stream s'est terminé sans
      // [DONE] explicite (J-6b : usage réel si transmis, sinon 0-coût).
      if (!streamTerminalEmitted) {
        recordStreamTerminalSuccess();
      }
    } catch (err: unknown) {
      // É48 P4 — terminal ERROR unique pour le stream en échec
      const rawErr = err instanceof Error ? err.message : String(err);
      aiUsageTracker.recordAttempt({
        tenantId: request.tenantId,
        projectId: request.projectId,
        model,
        provider: 'mistral',
        requestId: request.requestId ?? 'req-unknown',
        kind: 'ERROR',
        error: rawErr.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***').slice(0, 300)
      });
      streamTerminalEmitted = true;
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
      // É48 P4 — le stream consommé partiellement (client déconnecté) est un
      // appel réel incomplet : usage inconnu → terminal ABORTED, coût 0.
      if (!streamTerminalEmitted) {
        aiUsageTracker.recordAttempt({
          tenantId: request.tenantId,
          projectId: request.projectId,
          model,
          provider: 'mistral',
          requestId: request.requestId ?? 'req-unknown',
          kind: 'ABORTED',
          error: 'stream interrompu avant complétion'
        });
      }
    }
  }
}
