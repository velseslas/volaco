/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Run Memory Store
 */

import { randomUUID } from 'node:crypto';
import type {
  Assumption,
  ConversationMessage,
  DecisionRecord,
  EvidenceRecord,
  ObservationRecord,
  RunMemory,
  ToolExecutionResult
} from '../types.js';

export class RunMemoryStore {
  private readonly conversationHistory: ConversationMessage[] = [];
  private readonly observations: ObservationRecord[] = [];
  private readonly decisions: DecisionRecord[] = [];
  private readonly toolInvocations: ToolExecutionResult[] = [];
  private readonly assumptions: Assumption[] = [];
  private readonly facts: EvidenceRecord[] = [];

  constructor(
    public readonly runId: string,
    public readonly tenantId: string,
    public readonly projectId: string
  ) {}

  public addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
    this.conversationHistory.push({
      role,
      content,
      timestamp: Date.now()
    });
  }

  public addObservation(text: string, source: string): ObservationRecord {
    const obs: ObservationRecord = {
      id: `obs-${randomUUID().substring(0, 8)}`,
      text,
      source,
      timestamp: Date.now()
    };
    this.observations.push(obs);
    return obs;
  }

  public addDecision(
    rationale: string,
    chosenAction: string,
    alternativesConsidered: readonly string[] = [],
    evidenceRefs: readonly string[] = []
  ): DecisionRecord {
    const dec: DecisionRecord = {
      id: `dec-${randomUUID().substring(0, 8)}`,
      rationale,
      chosenAction,
      alternativesConsidered,
      timestamp: Date.now(),
      evidenceRefs
    };
    this.decisions.push(dec);
    return dec;
  }

  public recordToolInvocation(result: ToolExecutionResult): void {
    this.toolInvocations.push(result);
  }

  public addFact(fact: EvidenceRecord): void {
    this.facts.push(fact);
  }

  public addAssumption(assumption: Assumption): void {
    this.assumptions.push(assumption);
  }

  public getSnapshot(): RunMemory {
    return {
      runId: this.runId,
      tenantId: this.tenantId,
      projectId: this.projectId,
      conversationHistory: [...this.conversationHistory],
      observations: [...this.observations],
      decisions: [...this.decisions],
      toolInvocations: [...this.toolInvocations],
      assumptions: [...this.assumptions],
      facts: [...this.facts]
    };
  }
}
