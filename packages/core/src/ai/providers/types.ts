/**
 * VibeCode Core - AI Provider Abstraction
 * Unified, decoupled type definitions for multi-provider LLM integrations
 */

import { AppError } from '../../errors.js';
import type { ModelPricing } from '../usage.js';

export type ProviderCapability =
  | 'FAST'
  | 'DEEP_REASONING'
  | 'CODE_GENERATION'
  | 'LARGE_CONTEXT'
  | 'STRUCTURED_OUTPUT'
  | 'STREAMING'
  | 'TOOL_CALLING'
  | 'VISION';

export type ProviderAvailability = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
export type ProviderHealthStatus = 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN';

export interface AIProviderDescriptor {
  readonly providerId: string;
  readonly providerName: string;
  readonly models: readonly string[];
  readonly capabilities: readonly ProviderCapability[];
  readonly contextWindow: number;
  readonly structuredOutput: boolean;
  readonly streaming: boolean;
  readonly toolCalling: boolean;
  readonly reasoning: boolean;
  readonly vision: boolean;
  readonly costMetadata: Record<string, ModelPricing>;
  readonly availability: ProviderAvailability;
  readonly healthStatus: ProviderHealthStatus;
}

export interface ProviderRequirements {
  readonly capabilities?: readonly ProviderCapability[] | undefined;
  readonly taskKind?: 'FAST_CONVERSATION' | 'DEEP_ANALYSIS' | 'CODE_GENERATION' | 'LARGE_CONTEXT' | undefined;
  readonly minContextWindow?: number | undefined;
  readonly preferredProviderId?: string | undefined;
  readonly preferredModelId?: string | undefined;
}

export interface TenantProviderCredentials {
  readonly tenantId: string;
  readonly providerId: string;
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly organizationId?: string | undefined;
  readonly customHeaders?: Record<string, string> | undefined;
}

export interface AIProviderGenerateRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly prompt: string;
  readonly systemPrompt?: string | undefined;
  readonly model?: string | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly requestId?: string | undefined;
}

export interface AIProviderGenerateResponse {
  readonly text: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly latencyMs: number;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly costUsd: number;
  readonly rawResponse?: unknown | undefined;
}

export interface AIProviderAdapter {
  readonly descriptor: AIProviderDescriptor;
  generate(
    request: AIProviderGenerateRequest,
    credentials?: TenantProviderCredentials | undefined
  ): Promise<AIProviderGenerateResponse>;
  checkHealth?(
    credentials?: TenantProviderCredentials | undefined
  ): Promise<boolean>;
}

export class AIProviderError extends AppError {
  constructor(
    message: string,
    public readonly providerId: string,
    statusCode = 502,
    requestId?: string | undefined
  ) {
    super(`[AI Provider: ${providerId}] ${message}`, 'INTERNAL_ERROR', statusCode, { providerId }, requestId);
    this.name = 'AIProviderError';
  }
}

export class AIProviderAuthError extends AppError {
  constructor(
    message: string,
    public readonly providerId: string,
    requestId?: string | undefined
  ) {
    super(`[AI Provider: ${providerId}] Authentification échouée : ${message}`, 'UNAUTHORIZED', 401, { providerId }, requestId);
    this.name = 'AIProviderAuthError';
  }
}

export class AIProviderTimeoutError extends AppError {
  constructor(
    public readonly providerId: string,
    public readonly timeoutMs: number,
    requestId?: string | undefined
  ) {
    super(`[AI Provider: ${providerId}] Délai dépassé (${timeoutMs}ms)`, 'INTERNAL_ERROR', 504, { providerId, timeoutMs }, requestId);
    this.name = 'AIProviderTimeoutError';
  }
}
