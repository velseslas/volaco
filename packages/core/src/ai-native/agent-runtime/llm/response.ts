/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * LLM Response Abstraction & Metrics
 */

import type { TokenUsage } from '../types.js';

export interface LLMToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export type LLMFinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export interface LLMResponse {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly toolCalls?: readonly LLMToolCall[] | undefined;
  readonly finishReason: LLMFinishReason;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly structuredOutput?: unknown | undefined;
}

export interface LLMChunk {
  readonly textChunk?: string | undefined;
  readonly toolCallChunk?: unknown | undefined;
  readonly isLast: boolean;
}
