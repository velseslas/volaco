/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Audit Bridge: Integration & Cross-Referencing with Quality Audit Reports (AINT-013)
 */

import type { ApplicationAuditReport } from '../../application-audit/types.js';
import type { AggregatedProblem } from '../types.js';

export interface AuditCorrelationEntry {
  readonly problemId: string;
  readonly auditFindingId: string;
  readonly category: string;
  readonly severity: string;
  readonly matchConfidence: number;
}

export class AuditBridge {
  /**
   * Identifie les corrélations directes entre les problèmes utilisateurs et les constats d'audit
   */
  public correlateWithAudit(
    problems: readonly AggregatedProblem[],
    auditReport: ApplicationAuditReport
  ): readonly AuditCorrelationEntry[] {
    if (!problems || problems.length === 0 || !auditReport || !auditReport.findings) {
      return [];
    }

    const correlations: AuditCorrelationEntry[] = [];

    for (const prob of problems) {
      for (const finding of auditReport.findings) {
        const titleMatch = prob.title.toLowerCase().includes(finding.title.toLowerCase()) ||
          finding.title.toLowerCase().includes(prob.title.toLowerCase());

        const filePath = finding.location?.filePath;
        const fileMatch = Boolean(filePath && prob.impact.affectedFiles.some(
          f => f.toLowerCase().includes(filePath.toLowerCase())
        ));

        if (titleMatch || fileMatch) {
          correlations.push({
            problemId: prob.id,
            auditFindingId: finding.id,
            category: finding.dimension,
            severity: finding.severity,
            matchConfidence: titleMatch && fileMatch ? 0.95 : 0.75
          });
        }
      }
    }

    return correlations;
  }
}
