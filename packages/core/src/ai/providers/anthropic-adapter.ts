/**
 * VibeCode Core - AI Provider Abstraction
 * LOT MULTI-MODÈLES — Adaptateur Anthropic Claude (format /v1/messages).
 *
 * Le format Anthropic diffère d'OpenAI : system séparé, max_tokens obligatoire,
 * x-api-key (pas Bearer), blocs de contenu (text | tool_use | tool_result),
 * réponse non-choices. La traduction est faite ICI, jamais côté appelant :
 * l'adaptateur expose le MÊME contrat AIProviderAdapter que Mistral.
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
import { CLAUDE_PROVIDER_CONFIG, providerEnvKey, providerStoredKey } from './provider-catalog.js';
interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
}

export class AnthropicProviderAdapter implements AIProviderAdapter {
  public readonly descriptor: AIProviderDescriptor;
  private readonly fetchFn: typeof fetch;

  constructor(customFetch?: typeof fetch) {
    this.fetchFn = customFetch ?? fetch;
    this.descriptor = {
      providerId: CLAUDE_PROVIDER_CONFIG.providerId,
      providerName: CLAUDE_PROVIDER_CONFIG.providerName,
      models: CLAUDE_PROVIDER_CONFIG.models,
      capabilities: CLAUDE_PROVIDER_CONFIG.capabilities,
      contextWindow: CLAUDE_PROVIDER_CONFIG.contextWindow,
      structuredOutput: true,
      streaming: true,
      toolCalling: true,
      reasoning: CLAUDE_PROVIDER_CONFIG.reasoning,
      vision: CLAUDE_PROVIDER_CONFIG.vision,
      costMetadata: MODEL_PRICING,
      availability: 'AVAILABLE',
      healthStatus: 'HEALTHY'
    };
  }

  private resolveApiKey(credentials?: TenantProviderCredentials | undefined): string | undefined {
    // Priorité : credentials du tenant (flux internes) > clé de carte > env.
    return credentials?.apiKey || providerStoredKey('claude') || providerEnvKey('claude') || undefined;
  }

  /**
   * Traduit la demande unifiée en corps Anthropic :
   * - messages 'system' fusionnés dans le champ système dédié ;
   * - assistant.toolCalls → blocs tool_use ;
   * - 'tool' (résultat d'outil) → message user avec blocs tool_result.
   */
  private buildAnthropicBody(
    request: AIProviderGenerateRequest
  ): { body: Record<string, unknown>; model: string } {
    const model = request.model
      || (process.env.ANTHROPIC_MODEL && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(process.env.ANTHROPIC_MODEL)
        ? process.env.ANTHROPIC_MODEL
        : CLAUDE_PROVIDER_CONFIG.defaultModel);

    const systemParts: string[] = [];
    const convo: { role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }[] = [];

    if (request.messages && request.messages.length > 0) {
      for (const m of request.messages) {
        if (m.role === 'system') {
          systemParts.push(m.content);
          continue;
        }
        if (m.role === 'user') {
          // Message texte simple → forme string d'Anthropic (la plus sûre).
          convo.push({ role: 'user', content: m.content });
          continue;
        }
        if (m.role === 'assistant') {
          const toolCalls = m.toolCalls ?? [];
          if (toolCalls.length === 0) {
            // assistant sans appel d'outil : chaîne simple ; '' préserve l'alternance.
            convo.push({ role: 'assistant', content: m.content });
            continue;
          }
          // assistant porteur d'appels d'outils → blocs (texte éventuel en tête,
          // équivalent de la forme OpenAI content + tool_calls).
          const blocks: AnthropicContentBlock[] = [];
          if (m.content) {
            blocks.push({ type: 'text', text: m.content });
          }
          for (const tc of toolCalls) {
            blocks.push({
              type: 'tool_use',
              id: tc.id ?? 'toolu_' + Math.random().toString(36).slice(2, 10),
              name: tc.name,
              input: safeParse(tc.arguments ?? '{}')
            });
          }
          convo.push({ role: 'assistant', content: blocks });
          continue;
        }
        if (m.role === 'tool') {
          // Résultats d'outils : blocs tool_result dans un message user
          // (plusieurs résultats d'un même tour sont fusionnés en un message).
          pushToolResults(convo, [{ toolUseId: m.toolCallId ?? '', content: m.content }]);
        }
      }
    } else {
      if (request.systemPrompt) systemParts.push(request.systemPrompt);
      convo.push({ role: 'user', content: request.prompt });
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.2,
      messages: convo,
      stream: false
    };
    if (systemParts.length > 0) {
      body.system = systemParts.join('\n\n');
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }
    return { body, model };
  }

  public async generate(
    request: AIProviderGenerateRequest,
    credentials?: TenantProviderCredentials | undefined
  ): Promise<AIProviderGenerateResponse> {
    const providerId = 'claude';
    const apiKey = this.resolveApiKey(credentials);
    if (!apiKey || apiKey.trim().length === 0) {
      throw new AIProviderAuthError(
        'Clé API Anthropic manquante. Spécifiez ANTHROPIC_API_KEY (ou CLAUDE_API_KEY) ou configurez les credentials du tenant.',
        providerId,
        request.requestId
      );
    }

    const baseUrl = (credentials?.baseUrl || CLAUDE_PROVIDER_CONFIG.baseUrl).replace(/\/+$/, '');
    const endpoint = `${baseUrl}/v1/messages`;
    const timeoutMs = request.timeoutMs ?? 15000;
    const { body, model } = this.buildAnthropicBody(request);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (request.signal?.aborted) {
      clearTimeout(timer);
      const aborted = new Error('Appel Claude interrompu : client abandonné.');
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
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(credentials?.customHeaders ?? {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        let errMessage = `HTTP ${response.status}`;
        try {
          const errBody = (await response.json()) as { error?: { message?: string } };
          errMessage = errBody?.error?.message || errMessage;
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

      interface AnthropicApiResponse {
        content?: AnthropicContentBlock[];
        usage?: { input_tokens?: number; output_tokens?: number };
      }

      const data = (await response.json()) as AnthropicApiResponse;

      const text = (data?.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('');

      const toolUseBlocks = (data?.content ?? []).filter(
        (b) => b.type === 'tool_use' && typeof b.name === 'string'
      );
      const toolCalls = toolUseBlocks.length
        ? toolUseBlocks.map((b) => ({
            id: (b.id ?? '') as string,
            name: (b.name ?? '') as string,
            arguments: JSON.stringify(b.input ?? {})
          }))
        : undefined;

      const inputTokens = data?.usage?.input_tokens ?? Math.ceil(request.prompt.length / 4);
      const outputTokens = data?.usage?.output_tokens ?? Math.ceil(text.length / 4);
      const totalTokens = inputTokens + outputTokens;

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
      throw new AIProviderError(`Erreur d'appel Anthropic Claude : ${sanitized}`, providerId, 500, request.requestId);
    } finally {
      clearTimeout(timer);
    }
  }

  public async checkHealth(credentials?: TenantProviderCredentials | undefined): Promise<boolean> {
    const apiKey = this.resolveApiKey(credentials);
    if (!apiKey) return false;
    try {
      // Anthropic n'expose pas de /models GET public : un appel minimal /messages
      // avec 1 token prouve que la clé est acceptée (401 = clé morte).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await this.fetchFn(
          `${(credentials?.baseUrl || CLAUDE_PROVIDER_CONFIG.baseUrl).replace(/\/+$/, '')}/v1/messages`,
          {
            method: 'POST',
            headers: {
              'x-api-key': apiKey.trim(),
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: CLAUDE_PROVIDER_CONFIG.defaultModel,
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ping' }]
            }),
            signal: controller.signal
          }
        );
        return res.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }
}

export interface AnthropicToolResult {
  readonly toolUseId: string;
  readonly content: string;
}

/** Pose les résultats d'outils consécutifs dans un message user unique
 * (contrainte Anthropic : les tool_result voyagent dans un bloc user). */
function pushToolResults(
  convo: { role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }[],
  results: readonly AnthropicToolResult[]
): void {
  const last = convo[convo.length - 1];
  const blocks: AnthropicContentBlock[] = results.map((r) => ({
    type: 'tool_result',
    tool_use_id: r.toolUseId,
    content: r.content
  }));
  if (last && last.role === 'user' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) {
    last.content.push(...blocks);
  } else {
    convo.push({ role: 'user', content: blocks });
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
