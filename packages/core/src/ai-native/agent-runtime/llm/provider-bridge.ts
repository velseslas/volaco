/**
 * VibeCode Core - Pont entre le registre de fournisseurs IA réels
 * (packages/core/src/ai/providers, ex: Gemini, Mistral) et l'interface
 * LLMProvider attendue par agent-runtime.
 *
 * But concret : jusqu'ici, le registre de fournisseurs réels (avec de vrais
 * appels HTTP vers Gemini/Mistral) n'était utilisé que par ai-orchestrator.
 * Le moteur conversationnel (agent-runtime, utilisé par
 * conversation-intelligence, donc par le futur endpoint de conversation)
 * utilisait uniquement MockLLMProvider par défaut. Cette classe permet de
 * brancher le même registre réel sur le moteur conversationnel.
 */

import { randomUUID } from 'node:crypto';
import type { AIProviderRegistry } from '../../../ai/providers/registry.js';
import type { ProviderRequirements } from '../../../ai/providers/types.js';
import { logger } from '../../../logger.js';
import type { LLMMessage, LLMRequest } from './request.js';
import type { LLMProvider } from './provider.js';
import type { LLMResponse } from './response.js';

/**
 * Construit un prompt texte à partir d'une liste de messages (rôle + contenu),
 * car les adaptateurs de fournisseurs réels (Gemini/Mistral) attendent un
 * prompt + un systemPrompt séparés, pas une liste de messages façon chat.
 */
function buildPromptFromMessages(messages: readonly LLMMessage[]): {
  systemPrompt: string | undefined;
  prompt: string;
} {
  const systemParts: string[] = [];
  const conversationParts: string[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
    } else {
      const label = message.role === 'user' ? 'Utilisateur' : 'Assistant';
      conversationParts.push(`${label}: ${message.content}`);
    }
  }

  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    prompt: conversationParts.join('\n\n')
  };
}

export interface AIProviderRegistryLLMAdapterOptions {
  /**
   * Valeurs par défaut si l'appelant ne précise pas tenantId/projectId dans
   * `request.metadata`. Utile car aujourd'hui une seule instance de ce pont
   * est partagée par toutes les sessions de conversation (pas encore de
   * clé API distincte par tenant — voir le fichier de correctifs).
   */
  readonly defaultTenantId?: string | undefined;
  readonly defaultProjectId?: string | undefined;
  readonly requirements?: ProviderRequirements | undefined;
}

export class AIProviderRegistryLLMAdapter implements LLMProvider {
  public readonly providerId: string;
  public readonly modelId: string;

  constructor(
    private readonly registry: AIProviderRegistry,
    private readonly options: AIProviderRegistryLLMAdapterOptions = {}
  ) {
    const resolved = this.registry.resolve(this.options.requirements ?? {});
    this.providerId = resolved?.descriptor.providerId ?? 'none';
    this.modelId = resolved?.descriptor.models[0] ?? 'none';
  }

  public async generate(request: LLMRequest): Promise<LLMResponse> {
    const adapter = this.registry.resolve(this.options.requirements ?? {});
    if (!adapter) {
      throw new Error(
        "Aucun fournisseur IA réel n'est enregistré (Gemini/Mistral). " +
        'Vérifiez la configuration des clés API, ou utilisez explicitement MockLLMProvider pour les tests.'
      );
    }

    const tenantId = (request.metadata?.['tenantId'] as string | undefined) ?? this.options.defaultTenantId ?? 'default';
    const projectId = (request.metadata?.['projectId'] as string | undefined) ?? this.options.defaultProjectId ?? 'default';

    const { systemPrompt, prompt } = buildPromptFromMessages(request.messages);
    const credentials = this.registry.getTenantCredentials(tenantId, adapter.descriptor.providerId);

    const startedAt = Date.now();
    try {
      const response = await adapter.generate(
        {
          tenantId,
          projectId,
          prompt,
          systemPrompt,
          temperature: request.temperature,
          maxTokens: request.maxTokens
        },
        credentials
      );

      return {
        id: randomUUID(),
        provider: response.providerId,
        model: response.modelId,
        text: response.text,
        finishReason: 'stop',
        usage: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          totalTokens: response.usage.totalTokens
        },
        latencyMs: response.latencyMs
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Appel au fournisseur IA réel en échec — le moteur conversationnel ne peut pas générer de réponse.', {
        component: 'agent-runtime-provider-bridge',
        providerId: adapter.descriptor.providerId,
        tenantId,
        durationMs: Date.now() - startedAt,
        error: message
      });
      throw error;
    }
  }
}
