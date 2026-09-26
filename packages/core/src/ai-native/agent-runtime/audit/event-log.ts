/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Immutable Audit Event Log & Deterministic Run Hash
 */

import { createHash, randomUUID } from 'node:crypto';
import { canonicalObject } from '../../context/engine/base.js';
import type { AgentAuditEvent, AuditEventType } from '../types.js';

export class AuditEventLog {
  private readonly events: AgentAuditEvent[] = [];

  constructor(
    public readonly runId: string,
    public readonly tenantId: string,
    public readonly projectId: string
  ) {}

  public append(
    type: AuditEventType,
    payload: Record<string, unknown>,
    provenance?: string | undefined
  ): AgentAuditEvent {
    const event: AgentAuditEvent = {
      id: `aevt-${randomUUID().substring(0, 8)}`,
      runId: this.runId,
      tenantId: this.tenantId,
      projectId: this.projectId,
      type,
      timestamp: Date.now(),
      payload,
      ...(provenance !== undefined ? { provenance } : {})
    };
    this.events.push(event);
    return event;
  }

  public getEvents(): readonly AgentAuditEvent[] {
    return [...this.events];
  }

  /**
   * Computes a deterministic SHA-256 runHash based on canonical representation
   * of the run's stable structural elements (ignoring volatile timestamps/IDs).
   */
  public static computeRunHash(stableData: Record<string, unknown>): string {
    const {
      createdAt: _d1,
      updatedAt: _d2,
      runHash: _d3,
      id: _d4,
      ...cleanData
    } = stableData;

    const canonical = canonicalObject(cleanData);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }
}
