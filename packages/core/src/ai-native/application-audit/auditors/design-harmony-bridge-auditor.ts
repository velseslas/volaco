/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Design Harmony Bridge Auditor - Integration of AINT-012 Findings
 */

import type { DesignHarmonyReport } from '../../design-harmony/types.js';
import type { ApplicationAuditFinding } from '../types.js';

export class DesignHarmonyBridgeAuditor {
  public audit(report?: DesignHarmonyReport): readonly ApplicationAuditFinding[] {
    if (!report) {
      return [];
    }

    const findings: ApplicationAuditFinding[] = [];

    for (const f of report.findings) {
      const loc: { pageRoute?: string; selector?: string } = {};
      if (f.pageRoute) loc.pageRoute = f.pageRoute;
      if (f.selector) loc.selector = f.selector;

      findings.push({
        id: `aaf-dh-${f.id}`,
        dimension: 'DESIGN_HARMONY',
        severity: f.severity,
        title: `Dérive Design Harmony : ${f.category} (${f.property})`,
        description: `Valeur observée '${f.observedValue}' divergente de la référence attendue '${f.expectedValue ?? 'N/A'}'.`,
        location: loc,
        cause: `Élément UI non conforme aux tokens du Design System ou anomalie statistique de cluster.`,
        impact: `Incohérence esthétique et baisse du Design Harmony Score (${report.overallScore}/100).`,
        recommendation: f.recommendation,
        autoRemediable: true,
        suggestedAction: {
          agentDomain: 'UI',
          actionType: 'ALIGN_DESIGN_TOKEN',
          description: f.recommendation
        },
        evidence: f.evidence.map((ev) => {
          const item: {
            source: 'DESIGN_HARMONY';
            detail: string;
            observedValue?: string | number;
            thresholdValue?: string | number;
            selector?: string;
          } = {
            source: 'DESIGN_HARMONY',
            detail: ev.detail
          };
          if (f.observedValue !== undefined) item.observedValue = f.observedValue;
          if (f.expectedValue !== undefined) item.thresholdValue = f.expectedValue;
          if (ev.selector) item.selector = ev.selector;
          return item;
        })
      });
    }

    return findings;
  }
}
