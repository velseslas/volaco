/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Remediation Planner - Actionable Remediation Prioritization
 */

import type { AgentDomain } from '../../ai-orchestrator/types.js';
import type { ApplicationAuditFinding } from '../types.js';

export interface PrioritizedRemediation {
  readonly findingId: string;
  readonly dimension: string;
  readonly severity: string;
  readonly title: string;
  readonly recommendation: string;
  readonly agentDomain: AgentDomain;
  readonly actionType: string;
  readonly targetPath?: string;
}

export class RemediationPlanner {
  public planRemediations(
    findings: readonly ApplicationAuditFinding[]
  ): readonly PrioritizedRemediation[] {
    const remediations: PrioritizedRemediation[] = [];

    // Filter only auto-remediable findings with suggestedAction
    const candidates = findings.filter((f) => f.autoRemediable && f.suggestedAction);

    for (const c of candidates) {
      const action = c.suggestedAction!;
      const rem: PrioritizedRemediation = {
        findingId: c.id,
        dimension: c.dimension,
        severity: c.severity,
        title: c.title,
        recommendation: c.recommendation,
        agentDomain: action.agentDomain,
        actionType: action.actionType,
        ...(action.targetPath ? { targetPath: action.targetPath } : {})
      };
      remediations.push(rem);
    }

    return remediations;
  }
}
