/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Impact Intelligence Bridge (AINT-005 Integration)
 */

import type { Role } from '../../../identity/permissions.js';
import type { ImpactIntelligenceService } from '../../impact-intelligence/service.js';
import type { EngineeringPlan } from '../types.js';

export interface PlanImpactResult {
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly affectedFiles: readonly string[];
  readonly requiresConfirmation: boolean;
  readonly blastRadiusSummary: string;
}

export class ImpactBridge {
  constructor(
    private readonly impactService?: ImpactIntelligenceService | undefined
  ) {}

  public assessPlanImpact(
    plan: EngineeringPlan,
    tenantId: string,
    projectId: string,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): PlanImpactResult {
    const targetFilesSet = new Set<string>();
    let hasDelete = false;

    for (const step of plan.steps) {
      if (step.operation === 'DELETE') {
        hasDelete = true;
      }
      if (step.targetFiles) {
        for (const file of step.targetFiles) {
          targetFilesSet.add(file);
        }
      }
    }

    const targetFiles = Array.from(targetFilesSet);

    if (this.impactService && targetFiles.length > 0) {
      try {
        const analysis = this.impactService.analyzeImpact(
          {
            tenantId,
            projectId,
            targetFiles
          },
          userRole,
          requestId
        );

        const riskLevel = analysis.overallRisk;
        const requiresConfirmation = riskLevel === 'HIGH' || riskLevel === 'CRITICAL' || hasDelete;

        return {
          riskLevel,
          affectedFiles: targetFiles,
          requiresConfirmation,
          blastRadiusSummary: `Impact assessment: ${analysis.impactedNodes.length} nodes affected, ${analysis.metrics.breakingCount} breaking. Risk: ${riskLevel}.`
        };
      } catch {
        // Fallback to heuristic
      }
    }

    const riskLevel: PlanImpactResult['riskLevel'] = hasDelete
      ? 'HIGH'
      : targetFiles.length > 3
      ? 'MEDIUM'
      : 'LOW';

    return {
      riskLevel,
      affectedFiles: targetFiles,
      requiresConfirmation: riskLevel === 'HIGH',
      blastRadiusSummary: `Heuristic impact: ${targetFiles.length} direct file(s) targeted. Estimated risk: ${riskLevel}.`
    };
  }
}
