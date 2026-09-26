/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Audit Bridge - Ingestion and risk correlation with AINT-013 Application Audit
 */

import type { ApplicationAuditReport, ApplicationAuditFinding } from '../../application-audit/types.js';

export class StrategyAuditBridge {
  /**
   * Extracts unresolved critical and high severity audit findings.
   */
  public extractCriticalFindings(report?: ApplicationAuditReport): ApplicationAuditFinding[] {
    if (!report || !report.findings) {
      return [];
    }
    return report.findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  }

  /**
   * Computes the overall health index based on audit score.
   */
  public getHealthScore(report?: ApplicationAuditReport): number {
    if (!report) return 80;
    return typeof report.overallScore === 'number' ? report.overallScore : 80;
  }
}
