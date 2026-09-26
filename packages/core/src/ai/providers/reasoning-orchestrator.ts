/**
 * VibeCode Core - AI Provider Abstraction
 * Production Reasoning Orchestrator (Implements AINT-009 ReasoningProvider)
 * Seamlessly bridges Conversation Intelligence to multi-provider adapters with intelligent routing and safe fallback.
 */

import type {
  NextActionKind,
  ReasoningProvider,
  ReasoningRequest,
  ReasoningResponse
} from '../../ai-native/conversation-intelligence/types.js';
import { DefaultReasoningProvider } from '../../ai-native/conversation-intelligence/provider/reasoning-provider.js';
import { aiProviderRegistry, AIProviderRegistry } from './registry.js';
import type { ProviderRequirements } from './types.js';

export interface ReasoningOrchestratorConfig {
  readonly defaultTimeoutMs?: number | undefined;
  readonly enableFallback?: boolean | undefined;
  readonly defaultTenantId?: string | undefined;
  readonly defaultProjectId?: string | undefined;
}

export class ReasoningOrchestrator implements ReasoningProvider {
  private readonly registry: AIProviderRegistry;
  private readonly fallbackProvider: ReasoningProvider;
  private readonly config: ReasoningOrchestratorConfig;

  constructor(
    registry?: AIProviderRegistry | undefined,
    fallbackProvider?: ReasoningProvider | undefined,
    config?: ReasoningOrchestratorConfig | undefined
  ) {
    this.registry = registry ?? aiProviderRegistry;
    this.fallbackProvider = fallbackProvider ?? new DefaultReasoningProvider();
    this.config = {
      defaultTimeoutMs: 10000,
      enableFallback: true,
      defaultTenantId: 'system-default',
      defaultProjectId: 'system-project',
      ...config
    };
  }

  public async reason(request: ReasoningRequest): Promise<ReasoningResponse> {
    const { intent, userMessage, history } = request;

    // 1. Determine taskKind from intent
    let taskKind: ProviderRequirements['taskKind'] = 'FAST_CONVERSATION';
    let nextAction: NextActionKind = 'RESPOND_DIRECTLY';

    switch (intent.category) {
      case 'CREATE':
      case 'MODIFY':
      case 'REFACTOR':
      case 'OPTIMIZE':
      case 'DEBUG':
        taskKind = 'CODE_GENERATION';
        nextAction = 'PRESENT_PLAN';
        break;

      case 'ANALYZE':
        taskKind = 'DEEP_ANALYSIS';
        nextAction = 'REQUEST_UNDERSTANDING';
        break;

      case 'DELETE':
        taskKind = 'DEEP_ANALYSIS';
        nextAction = 'REQUEST_CONFIRMATION';
        break;

      case 'QUESTION':
      case 'EXPLAIN':
      case 'EXPLORATION':
      default:
        taskKind = 'FAST_CONVERSATION';
        nextAction = 'RESPOND_DIRECTLY';
        break;
    }

    // 2. Resolve adapter from registry
    const adapter = this.registry.resolve({ taskKind });

    // If no external adapter registered or available, use deterministic offline fallback
    if (!adapter) {
      const fallbackRes = await this.fallbackProvider.reason(request);
      return {
        ...fallbackRes,
        metadata: {
          providerId: 'offline-default',
          modelId: 'deterministic-rules',
          latencyMs: 0,
          fallbackUsed: true,
          fallbackReason: 'No external provider adapter registered'
        }
      };
    }

    // 3. Prepare generation payload
    const tenantId = this.config.defaultTenantId!;
    const projectId = this.config.defaultProjectId!;
    const credentials = this.registry.getTenantCredentials(tenantId, adapter.descriptor.providerId);

    const historyContext = history.slice(-4).map((h) => `${h.sender}: ${h.content}`).join('\n');
    const systemPrompt =
      `Tu es l'ingénieur en chef IA de VibeCode Studio. Tu réponds à la requête de l'utilisateur avec rigueur, précision et clarté.\n` +
      `Catégorie d'intention détectée: ${intent.category}.\nObjectif: ${intent.goal}.`;

    const prompt =
      `${historyContext ? `Contexte récent:\n${historyContext}\n\n` : ''}` +
      `Requête utilisateur: ${userMessage}`;

    const startTime = Date.now();

    try {
      const genResponse = await adapter.generate(
        {
          tenantId,
          projectId,
          prompt,
          systemPrompt,
          timeoutMs: this.config.defaultTimeoutMs
        },
        credentials
      );

      const latencyMs = Date.now() - startTime;

      return {
        interpretation: `Raisonnement opéré par ${adapter.descriptor.providerName} (${genResponse.modelId}).`,
        intent,
        assumptions: [],
        clarifications: intent.ambiguities,
        reply: genResponse.text || `Instruction traitée avec succès pour : ${intent.goal}.`,
        confidence: Math.min(1, Math.max(0.7, intent.confidence)),
        nextAction,
        metadata: {
          providerId: genResponse.providerId,
          modelId: genResponse.modelId,
          latencyMs,
          tokens: genResponse.usage,
          fallbackUsed: false
        }
      };
    } catch (err: unknown) {
      if (!this.config.enableFallback) {
        throw err;
      }

      // Safe error sanitization without leaking any secrets
      const rawErrMsg = err instanceof Error ? err.message : String(err);
      const safeReason = rawErrMsg.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***');

      const fallbackRes = await this.fallbackProvider.reason(request);
      return {
        ...fallbackRes,
        metadata: {
          providerId: adapter.descriptor.providerId,
          modelId: 'fallback-deterministic',
          latencyMs: Date.now() - startTime,
          fallbackUsed: true,
          fallbackReason: safeReason
        }
      };
    }
  }
}
