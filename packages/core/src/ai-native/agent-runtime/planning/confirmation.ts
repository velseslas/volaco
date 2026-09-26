/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Confirmation Policy Engine
 */

import type { AgentPlan } from '../types.js';

export interface ConfirmationPolicyOptions {
  readonly autoConfirmLowRisk?: boolean | undefined;
  readonly requireConfirmationForMutations?: boolean | undefined;
  readonly maxUnconfirmedFileChanges?: number | undefined;
}

export class ConfirmationPolicy {
  private readonly options: ConfirmationPolicyOptions;

  constructor(options?: ConfirmationPolicyOptions | undefined) {
    this.options = {
      autoConfirmLowRisk: true,
      requireConfirmationForMutations: false,
      maxUnconfirmedFileChanges: 3,
      ...options
    };
  }

  /**
   * Evaluates whether a plan must be explicitly confirmed by the user before execution.
   */
  public requiresConfirmation(plan: AgentPlan): { required: boolean; reason?: string | undefined } {
    if (this.options.requireConfirmationForMutations) {
      const hasMutation = plan.steps.some((s) => s.tool === 'execute_mutation');
      if (hasMutation) {
        return { required: true, reason: 'Toute mutation requiert une confirmation selon la politique' };
      }
    }

    // 1. Destructive mutations (DELETE_FILE)
    for (const step of plan.steps) {
      if (step.tool === 'execute_mutation') {
        const params = step.parameters;
        const planObj = params.plan as { mutations?: readonly { kind?: string }[] } | undefined;
        if (planObj?.mutations?.some((m) => m.kind === 'DELETE_FILE')) {
          return { required: true, reason: 'Suppression de fichier detectee dans le plan de mutation' };
        }
      }
    }

    // 2. High risk or breaking changes from Impact Analysis
    if (plan.impactAnalysis && typeof plan.impactAnalysis === 'object') {
      const impact = plan.impactAnalysis as { overallRisk?: string; breakingCount?: number; metrics?: { breakingCount?: number } };
      const breakingCount = impact.breakingCount ?? impact.metrics?.breakingCount ?? 0;
      if (impact.overallRisk === 'CRITICAL' || breakingCount > 0) {
        return { required: true, reason: `Risque d impact critique ou cassant (${impact.overallRisk})` };
      }
      if (impact.overallRisk === 'HIGH' && (breakingCount > 0 || plan.expectedChanges.length > 2)) {
        return { required: true, reason: `Risque d impact eleve (${impact.overallRisk}) avec modifications multiples` };
      }
    }

    // 3. Excessive number of modified files
    const maxFiles = this.options.maxUnconfirmedFileChanges ?? 3;
    if (plan.expectedChanges.length > maxFiles) {
      return {
        required: true,
        reason: `Nombre important de modifications (${plan.expectedChanges.length} fichiers > limite de ${maxFiles})`
      };
    }

    return { required: false };
  }
}
