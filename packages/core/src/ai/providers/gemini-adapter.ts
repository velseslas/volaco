/**
 * VibeCode Core - AI Provider Abstraction
 * Official Google Gemini Adapter (Production Server-Side Adapter)
 */

import { aiUsageTracker } from '../usage.js';
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

export class GeminiProviderAdapter implements AIProviderAdapter {
  public readonly descriptor: AIProviderDescriptor = {
    providerId: 'gemini',
    providerName: 'Google Gemini',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
    capabilities: [
      'FAST',
      'DEEP_REASONING',
      'CODE_GENERATION',
      'LARGE_CONTEXT',
      'VISION',
      'STREAMING',
      'STRUCTURED_OUTPUT'
    ],
    contextWindow: 1048576,
    structuredOutput: true,
    streaming: true,
    toolCalling: true,
    reasoning: true,
    vision: true,
    costMetadata: {
      'gemini-1.5-flash': { promptCostPerMillion: 0.075, completionCostPerMillion: 0.30 },
      'gemini-1.5-pro': { promptCostPerMillion: 1.25, completionCostPerMillion: 5.00 },
      'gemini-2.0-flash': { promptCostPerMillion: 0.10, completionCostPerMillion: 0.40 }
    },
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
    const apiKey = credentials?.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new AIProviderAuthError(
        'Clé API Gemini manquante. Spécifiez GEMINI_API_KEY ou configurez les credentials du tenant.',
        'gemini',
        request.requestId
      );
    }

    const baseUrl = (credentials?.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const model = request.model || 'gemini-1.5-flash';
    const endpoint = `${baseUrl}/v1beta/models/${model}:generateContent`;
    const timeoutMs = request.timeoutMs ?? 15000;

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    if (request.systemPrompt) {
      contents.push({ role: 'user', parts: [{ text: `[System Instruction]\n${request.systemPrompt}` }] });
      contents.push({ role: 'model', parts: [{ text: 'Instructions bien reçues et appliquées.' }] });
    }
    contents.push({ role: 'user', parts: [{ text: request.prompt }] });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

    // É48 P4 (J-6) — l'attempt est visible dès le démarrage de l'appel
    // (crash/timeout/erreur → l'événement START reste tracé, coût 0).
    aiUsageTracker.recordAttempt({
      tenantId: request.tenantId,
      projectId: request.projectId,
      model,
      provider: 'gemini',
      requestId: request.requestId ?? 'req-unknown',
      kind: 'START'
    });

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey.trim(),
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(credentials?.customHeaders ?? {})
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: request.temperature ?? 0.2,
            maxOutputTokens: request.maxTokens ?? 4096
          }
        }),
        signal: controller.signal
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        let errMessage = `HTTP ${response.status}`;
        try {
          const errBody = (await response.json()) as { error?: { message?: string } };
          errMessage = errBody?.error?.message || errMessage;
        } catch {
          // Keep default
        }
        const sanitizedMsg = errMessage.replace(/key=[a-zA-Z0-9_-]+/gi, 'key=***');
        throw new AIProviderError(sanitizedMsg, 'gemini', response.status, request.requestId);
      }

      interface GeminiApiResponse {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      }

      const data = (await response.json()) as GeminiApiResponse;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      const inputTokens = data?.usageMetadata?.promptTokenCount ?? Math.ceil(request.prompt.length / 4);
      const outputTokens = data?.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
      const totalTokens = data?.usageMetadata?.totalTokenCount ?? (inputTokens + outputTokens);

      const usageRecord = aiUsageTracker.recordUsage(
        request.tenantId,
        request.projectId,
        model,
        inputTokens,
        outputTokens,
        request.requestId ?? 'req-unknown',
        'gemini'
      );

      return {
        text,
        providerId: 'gemini',
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
      // É48 P4 (J-6) — terminal ERROR unique : appel réel, usage inconnu, coût 0
      const rawErr = err instanceof Error ? err.message : String(err);
      aiUsageTracker.recordAttempt({
        tenantId: request.tenantId,
        projectId: request.projectId,
        model,
        provider: 'gemini',
        requestId: request.requestId ?? 'req-unknown',
        kind: 'ERROR',
        error: rawErr.replace(/key=[a-zA-Z0-9_-]+/gi, 'key=***').slice(0, 300)
      });
      if (err instanceof AIProviderError || err instanceof AIProviderAuthError) {
        throw err;
      }
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        throw new AIProviderTimeoutError('gemini', timeoutMs, request.requestId);
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = rawMsg.replace(/key=[a-zA-Z0-9_-]+/gi, 'key=***');
      throw new AIProviderError(`Erreur d'appel Gemini: ${sanitized}`, 'gemini', 500, request.requestId);
    } finally {
      clearTimeout(timer);
    }
  }

  public async checkHealth(credentials?: TenantProviderCredentials | undefined): Promise<boolean> {
    const apiKey = credentials?.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) return false;
    try {
      const res = await this.fetchFn('https://generativelanguage.googleapis.com/v1beta/models', {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey.trim()
        }
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
