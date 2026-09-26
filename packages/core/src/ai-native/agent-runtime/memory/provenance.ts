/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Provenance Tracker & Evidence Factory
 */

import { randomUUID } from 'node:crypto';
import type { EvidenceKind, EvidenceRecord } from '../types.js';

export class ProvenanceTracker {
  private readonly evidenceRecords = new Map<string, EvidenceRecord>();

  public createEvidence(
    kind: EvidenceKind,
    source: string,
    reference: string,
    summary: string,
    payload?: Record<string, unknown> | undefined
  ): EvidenceRecord {
    const id = `ev-${randomUUID().substring(0, 8)}`;
    const record: EvidenceRecord = {
      id,
      kind,
      source,
      reference,
      summary,
      timestamp: Date.now(),
      ...(payload !== undefined ? { payload } : {})
    };
    this.evidenceRecords.set(id, record);
    return record;
  }

  public getEvidence(id: string): EvidenceRecord | undefined {
    return this.evidenceRecords.get(id);
  }

  public listEvidence(): readonly EvidenceRecord[] {
    return Array.from(this.evidenceRecords.values());
  }
}
