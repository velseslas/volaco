/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * LLM Request Abstraction & Utilities
 */

export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
  readonly name?: string | undefined;
}

export interface LLMToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface LLMRequest {
  readonly messages: readonly LLMMessage[];
  readonly tools?: readonly LLMToolSpec[] | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly responseFormat?: 'text' | 'json' | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Heuristic token estimation: ~4 characters per token for typical code and text.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function createSystemMessage(content: string): LLMMessage {
  return { role: 'system', content };
}

export function createUserMessage(content: string): LLMMessage {
  return { role: 'user', content };
}

export function createAssistantMessage(content: string): LLMMessage {
  return { role: 'assistant', content };
}
