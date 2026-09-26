/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Assumption Engine (NO EVIDENCE -> NO CLAIM)
 */

import { randomUUID } from 'node:crypto';
import type { Assumption, AssumptionStatus } from '../types.js';

export class AssumptionEngine {
  private readonly assumptions = new Map<string, Assumption>();

  public addAssumption(
    statement: string,
    confidence: number,
    evidence: readonly string[] = []
  ): Assumption {
    const id = `assump-${randomUUID().substring(0, 8)}`;
    const assumption: Assumption = {
      id,
      statement,
      confidence: Math.max(0, Math.min(1, confidence)),
      evidence,
      status: 'PROPOSED',
      createdAt: Date.now()
    };
    this.assumptions.set(id, assumption);
    return assumption;
  }

  public updateStatus(id: string, status: AssumptionStatus): Assumption | undefined {
    const existing = this.assumptions.get(id);
    if (!existing) return undefined;

    const updated: Assumption = {
      ...existing,
      status,
      validatedAt: status === 'VALIDATED' ? Date.now() : existing.validatedAt
    };
    this.assumptions.set(id, updated);
    return updated;
  }

  public validateAssumption(id: string, evidenceRef: string): Assumption | undefined {
    const existing = this.assumptions.get(id);
    if (!existing) return undefined;

    const updated: Assumption = {
      ...existing,
      evidence: [...existing.evidence, evidenceRef],
      status: 'VALIDATED',
      validatedAt: Date.now()
    };
    this.assumptions.set(id, updated);
    return updated;
  }

  public rejectAssumption(id: string): Assumption | undefined {
    return this.updateStatus(id, 'REJECTED');
  }

  public expireAssumptions(): void {
    for (const [id, a] of this.assumptions.entries()) {
      if (a.status === 'PROPOSED') {
        this.assumptions.set(id, { ...a, status: 'EXPIRED' });
      }
    }
  }

  public getAssumptions(): readonly Assumption[] {
    return Array.from(this.assumptions.values());
  }

  public get(id: string): Assumption | undefined {
    return this.assumptions.get(id);
  }
}
