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

  /**
   * CDC §16 — une hypothèse est révisable : l'ancienne version passe à
   * SUPERSEDED (traçable) et une nouvelle hypothèse hérite de ses preuves.
   */
  public revise(id: string, newStatement: string, reason: string, confidence?: number): Assumption | undefined {
    const existing = this.assumptions.get(id);
    if (!existing) return undefined;

    this.assumptions.set(id, { ...existing, status: 'SUPERSEDED' });

    const revised: Assumption = {
      id: `assump-${randomUUID().substring(0, 8)}`,
      statement: newStatement,
      confidence: confidence ?? existing.confidence,
      evidence: [...existing.evidence, `revision-of:${existing.id}`],
      status: 'PROPOSED',
      createdAt: Date.now(),
      revisedFrom: existing.id,
      revisionReason: reason
    };
    this.assumptions.set(revised.id, revised);
    return revised;
  }

  /**
   * CDC §16 — l'utilisateur n'est interrogé que lorsque l'incertitude ou le
   * risque le justifie : confiance sous le seuil, ou contexte à risque élevé.
   */
  public requiresUserInput(
    id: string,
    options: { confidenceThreshold?: number; risky?: boolean } = {}
  ): boolean {
    const a = this.assumptions.get(id);
    if (!a) return false;
    const threshold = options.confidenceThreshold ?? 0.7;
    return a.confidence < threshold || options.risky === true;
  }

  /** Persistance (séquence deterministe) — l'état survit au run. */
  public toJSON(): string {
    return JSON.stringify({ version: 1, assumptions: this.getAssumptions() });
  }

  public static fromJSON(json: string): AssumptionEngine {
    const engine = new AssumptionEngine();
    const parsed = JSON.parse(json) as { version?: number; assumptions?: Assumption[] };
    for (const a of parsed.assumptions ?? []) {
      engine.assumptions.set(a.id, a);
    }
    return engine;
  }
}
