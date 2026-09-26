/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Technical Debt Analyzer - Evaluates audit findings from AINT-013 and computes technical debt index
 */

import type { StrategyContext, StrategyEvidence, RecommendationType } from '../types.js';
import type { ApplicationAuditFinding } from '../../application-audit/types.js';

export interface EvaluatedDebtItem {
  findingId: string;
  recommendationType: RecommendationType;
  title: string;
  description: string;
  debtScore: number; // 0-100 severity/debt impact
  category: string;
  affectedFile?: string | undefined;
  evidence: StrategyEvidence[];
  effortPoints: number;
}

export class TechnicalDebtAnalyzer {
  /**
   * Analyzes technical debt and quality issues from the audit report.
   */
  public analyze(context: StrategyContext): { items: EvaluatedDebtItem[]; overallDebtIndex: number } {
    if (!context.auditReport || !context.auditReport.findings) {
      return { items: [], overallDebtIndex: 0 };
    }

    const items: EvaluatedDebtItem[] = [];
    let totalSeverityWeight = 0;

    for (const finding of context.auditReport.findings) {
      let recType: RecommendationType = 'REDUCE_TECHNICAL_DEBT';

      if (finding.dimension === 'SECURITY') {
        recType = 'FIX_SECURITY_RISK';
      } else if (finding.dimension === 'ARCHITECTURE') {
        recType = 'FIX_ARCHITECTURAL_RISK';
      } else if (finding.dimension === 'PERFORMANCE') {
        recType = 'IMPROVE_PERFORMANCE';
      } else if (finding.dimension === 'ACCESSIBILITY') {
        recType = 'IMPROVE_ACCESSIBILITY';
      } else if (finding.dimension === 'DESIGN_HARMONY') {
        recType = 'IMPROVE_DESIGN_HARMONY';
      } else if (finding.dimension === 'UX') {
        recType = 'IMPROVE_UX';
      }

      let severityScore = 40;
      let effortPoints = 2;
      if (finding.severity === 'CRITICAL') {
        severityScore = 95;
        effortPoints = 5;
      } else if (finding.severity === 'HIGH') {
        severityScore = 75;
        effortPoints = 3;
      } else if (finding.severity === 'MEDIUM') {
        severityScore = 50;
        effortPoints = 2;
      } else if (finding.severity === 'LOW') {
        severityScore = 25;
        effortPoints = 1;
      }

      totalSeverityWeight += severityScore;

      const evidence: StrategyEvidence[] = [
        {
          id: `ev-audit-${finding.id}`,
          source: 'AUDIT',
          description: `Rapport d'audit AINT-013: ${finding.description || finding.title}`,
          confidence: 0.9,
          provenanceType: 'FACT',
          verifiableReference: `AINT-013:${finding.id}`,
          dataPayload: { dimension: finding.dimension, severity: finding.severity, location: finding.location }
        }
      ];

      items.push({
        findingId: finding.id,
        recommendationType: recType,
        title: finding.title || `Résoudre ${finding.dimension.toLowerCase()}: ${finding.description.slice(0, 50)}`,
        description: finding.description || finding.recommendation || 'Dette technique identifiée par audit automatique.',
        debtScore: severityScore,
        category: finding.dimension,
        affectedFile: finding.location?.filePath,
        evidence,
        effortPoints
      });
    }

    const overallDebtIndex = items.length > 0 
      ? Math.min(100, Math.round(totalSeverityWeight / items.length))
      : 0;

    return { items, overallDebtIndex };
  }
}
