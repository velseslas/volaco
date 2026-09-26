/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Provenance Engine: Full Traceability and Context Tracking
 */

import type { ProblemEvidence, UserSignal } from '../types.js';

export interface ProvenanceRecord {
  readonly signalCount: number;
  readonly distinctUsersCount: number;
  readonly distinctSessionsCount: number;
  readonly distinctSources: readonly string[];
  readonly earliestTimestamp: string;
  readonly latestTimestamp: string;
  readonly involvedFiles: readonly string[];
  readonly involvedSelectors: readonly string[];
}

export class ProvenanceEngine {
  public analyzeProvenance(
    signals: readonly UserSignal[],
    evidence: readonly ProblemEvidence[]
  ): ProvenanceRecord {
    const users = new Set<string>();
    const sessions = new Set<string>();
    const sources = new Set<string>();
    const files = new Set<string>();
    const selectors = new Set<string>();

    let earliest = signals[0]?.timestamp || new Date().toISOString();
    let latest = earliest;

    for (const sig of signals) {
      if (sig.userId) users.add(sig.userId);
      if (sig.sessionId) sessions.add(sig.sessionId);
      sources.add(sig.source);
      if (sig.url) files.add(sig.url);
      if (sig.componentId) selectors.add(sig.componentId);

      if (new Date(sig.timestamp).getTime() < new Date(earliest).getTime()) {
        earliest = sig.timestamp;
      }
      if (new Date(sig.timestamp).getTime() > new Date(latest).getTime()) {
        latest = sig.timestamp;
      }
    }

    for (const e of evidence) {
      sources.add(e.source);
      if (e.filePath) files.add(e.filePath);
      if (e.selector) selectors.add(e.selector);
    }

    return {
      signalCount: signals.length,
      distinctUsersCount: Math.max(1, users.size),
      distinctSessionsCount: Math.max(1, sessions.size),
      distinctSources: Array.from(sources).sort(),
      earliestTimestamp: earliest,
      latestTimestamp: latest,
      involvedFiles: Array.from(files).sort(),
      involvedSelectors: Array.from(selectors).sort()
    };
  }
}
