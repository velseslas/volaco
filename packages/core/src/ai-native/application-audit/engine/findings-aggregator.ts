/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Findings Aggregator - Deduplication & NO EVIDENCE -> NO CLAIM Enforcement
 */

import { compareAuditFindings } from '../canonical.js';
import type { ApplicationAuditFinding, AuditSummary } from '../types.js';

export class FindingsAggregator {
  public aggregate(rawFindings: readonly ApplicationAuditFinding[]): {
    findings: readonly ApplicationAuditFinding[];
    summary: AuditSummary;
  } {
    // 1. Enforce NO EVIDENCE -> NO CLAIM
    // A finding without concrete evidence is rejected
    const verifiedFindings = rawFindings.filter(
      (f) => f.evidence && f.evidence.length > 0 && f.evidence[0]!.detail.trim().length > 0
    );

    // 2. Sort Deterministically by Severity then Dimension then Title
    const sorted = [...verifiedFindings].sort(compareAuditFindings);

    // 3. Compute Summary Counts
    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;
    let infoCount = 0;
    let autoRemediableCount = 0;

    for (const f of sorted) {
      if (f.severity === 'CRITICAL') criticalCount++;
      else if (f.severity === 'HIGH') highCount++;
      else if (f.severity === 'MEDIUM') mediumCount++;
      else if (f.severity === 'LOW') lowCount++;
      else if (f.severity === 'INFO') infoCount++;

      if (f.autoRemediable) autoRemediableCount++;
    }

    const summary: AuditSummary = {
      totalFindings: sorted.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      infoCount,
      autoRemediableCount
    };

    return {
      findings: sorted,
      summary
    };
  }
}
