/**
 * VibeCore - AI-Native Engineering Tier (AINT-007)
 * Provider Abstraction & Production Mock Provider
 */

import { randomUUID } from 'node:crypto';
import { LLMProviderError } from '../types.js';
import type { LLMRequest } from './request.js';
import { estimateTokenCount } from './request.js';
import type { LLMChunk, LLMResponse } from './response.js';

export interface LLMProvider {
  readonly providerId: string;
  readonly modelId: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
  stream?(request: LLMRequest): AsyncIterable<LLMChunk>;
}

export interface CannedResponseRule {
  readonly match: string | RegExp;
  readonly response: {
    readonly text?: string | undefined;
    readonly toolCalls?: readonly {
      readonly id: string;
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    }[] | undefined;
    readonly structuredOutput?: unknown | undefined;
    readonly finishReason?: 'stop' | 'tool_calls' | 'length' | 'error' | undefined;
  };
}

export interface MockLLMProviderConfig {
  readonly providerId?: string | undefined;
  readonly modelId?: string | undefined;
  readonly simulatedLatencyMs?: number | undefined;
  readonly failureRate?: number | undefined;
  readonly defaultResponseText?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export class MockLLMProvider implements LLMProvider {
  public readonly providerId: string;
  public readonly modelId: string;
  private readonly config: MockLLMProviderConfig;
  private readonly cannedResponses: CannedResponseRule[] = [];
  private readonly callHistory: LLMRequest[] = [];
  private shouldFailNextTime: string | null = null;
  private shouldTimeoutNextTime = false;

  constructor(config?: MockLLMProviderConfig) {
    this.providerId = config?.providerId ?? 'mock-provider';
    this.modelId = config?.modelId ?? 'mock-codestral-v1';
    this.config = {
      simulatedLatencyMs: 5,
      failureRate: 0,
      defaultResponseText: 'Mock LLM acknowledgment.',
      ...config
    };
  }

  public addCannedResponse(rule: CannedResponseRule): void {
    this.cannedResponses.push(rule);
  }

  public clearCannedResponses(): void {
    this.cannedResponses.length = 0;
  }

  public setFailNext(errorMessage: string): void {
    this.shouldFailNextTime = errorMessage;
  }

  public setTimeoutNext(timeout = true): void {
    this.shouldTimeoutNextTime = timeout;
  }

  public getCallHistory(): readonly LLMRequest[] {
    return [...this.callHistory];
  }

  public clearHistory(): void {
    this.callHistory.length = 0;
  }

  public async generate(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    this.callHistory.push(request);

    // Timeout simulation
    if (this.shouldTimeoutNextTime) {
      this.shouldTimeoutNextTime = false;
      throw new LLMProviderError(
        `Delai d'attente depasse (${this.config.timeoutMs ?? 5000}ms)`,
        this.providerId
      );
    }

    // Injected failure simulation
    if (this.shouldFailNextTime !== null) {
      const msg = this.shouldFailNextTime;
      this.shouldFailNextTime = null;
      throw new LLMProviderError(msg, this.providerId);
    }

    if (this.config.simulatedLatencyMs && this.config.simulatedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.simulatedLatencyMs));
    }

    // Combine request texts to match canned rules
    const combinedContent = request.messages.map((m) => m.content).join('\n');

    let matchedRule: CannedResponseRule | undefined;
    for (const rule of this.cannedResponses) {
      if (typeof rule.match === 'string') {
        if (combinedContent.includes(rule.match)) {
          matchedRule = rule;
          break;
        }
      } else if (rule.match.test(combinedContent)) {
        matchedRule = rule;
        break;
      }
    }

    const text = matchedRule?.response.text ?? this.config.defaultResponseText ?? 'Mock response';
    const toolCalls = matchedRule?.response.toolCalls;
    const structuredOutput = matchedRule?.response.structuredOutput;
    const finishReason = matchedRule?.response.finishReason ?? (toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop');

    const inputTokens = estimateTokenCount(combinedContent);
    const outputTokens = estimateTokenCount(text) + (toolCalls ? toolCalls.length * 20 : 0);
    const totalTokens = inputTokens + outputTokens;

    const response: LLMResponse = {
      id: `resp-${randomUUID().substring(0, 8)}`,
      provider: this.providerId,
      model: this.modelId,
      text,
      ...(toolCalls !== undefined ? { toolCalls } : {}),
      finishReason,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens
      },
      latencyMs: Date.now() - startTime,
      ...(structuredOutput !== undefined ? { structuredOutput } : {})
    };

    return response;
  }

  public async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const response = await this.generate(request);
    const words = response.text.split(' ');
    for (let i = 0; i < words.length; i++) {
      const isLast = i === words.length - 1;
      yield {
        textChunk: (i > 0 ? ' ' : '') + words[i],
        isLast
      };
    }
  }
}
