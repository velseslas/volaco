/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Impact Gate & Stale Analysis Detection Engine
 */

import type { ImpactAnalysis } from '../../impact-intelligence/types.js';
import type {
  MutationExecutionOptions,
  MutationPlan,
  PlanValidationResult
} from '../types.js';
import {
  StaleImpactError,
  StalePlanError
} from '../types.js';

/**
 * Validates a MutationPlan against the current live graph and optional Impact Analysis.
 * Enforces:
 * 1. Stale Plan Detection (currentGraphHash === plan.baseGraphHash)
 * 2. Stale Impact Detection (currentGraphHash === impact.graphHash)
 * 3. Impact Risk Gating (rejects HIGH/CRITICAL or BREAKING unless permitted)
 */
export function validatePlanAgainstImpact(
  plan: MutationPlan,
  currentGraphHash: string,
  impactAnalysis?: ImpactAnalysis | undefined,
  options?: MutationExecutionOptions | undefined,
  requestId?: string | undefined
): PlanValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // 1. Stale Plan Check
  if (plan.baseGraphHash !== currentGraphHash) {
    throw new StalePlanError(
      `Plan de mutation obsolète (STALE_MUTATION_PLAN): le graphe courant a changé (base: '${plan.baseGraphHash}', actuel: '${currentGraphHash}')`,
      { planId: plan.planId, baseGraphHash: plan.baseGraphHash, currentGraphHash },
      requestId
    );
  }

  // 2. Stale Impact Check
  if (impactAnalysis) {
    if (impactAnalysis.graphHash !== currentGraphHash) {
      throw new StaleImpactError(
        `Analyse d'impact obsolète (STALE_IMPACT_ANALYSIS): le graphe courant a changé (impact.graphHash: '${impactAnalysis.graphHash}', actuel: '${currentGraphHash}')`,
        { planId: plan.planId, impactGraphHash: impactAnalysis.graphHash, currentGraphHash },
        requestId
      );
    }
    if (plan.baseImpactHash && impactAnalysis.impactHash !== plan.baseImpactHash) {
      throw new StaleImpactError(
        `Condensat d'impact obsolète: l'analyse d'impact a changé (plan: '${plan.baseImpactHash}', analyse: '${impactAnalysis.impactHash}')`,
        { planId: plan.planId, expectedImpactHash: plan.baseImpactHash, actualImpactHash: impactAnalysis.impactHash },
        requestId
      );
    }

    // 3. Impact Risk Gating
    const risk = impactAnalysis.overallRisk;
    if ((risk === 'CRITICAL' || risk === 'HIGH') && !options?.allowHighRisk) {
      blockers.push(
        `Mutation bloquée par l'Impact Gate: le niveau de risque est '${risk}' et 'allowHighRisk' n'a pas été accordé.`
      );
    }

    if (impactAnalysis.metrics.breakingCount > 0 && !options?.allowBreaking) {
      blockers.push(
        `Mutation bloquée par l'Impact Gate: ${impactAnalysis.metrics.breakingCount} changement(s) de rupture (BREAKING) détecté(s) et 'allowBreaking' n'a pas été accordé.`
      );
    }
  }

  // Plan risk fallback check
  if (!impactAnalysis) {
    if ((plan.riskLevel === 'CRITICAL' || plan.riskLevel === 'HIGH') && !options?.allowHighRisk) {
      blockers.push(
        `Mutation bloquée par l'Impact Gate: le niveau de risque est '${plan.riskLevel}' et 'allowHighRisk' n'a pas été accordé.`
      );
    }
  }

  // 4. Evidence Verification
  for (const m of plan.mutations) {
    if (m.kind !== 'CREATE_FILE' && (!m.evidence || m.evidence.length === 0)) {
      warnings.push(`Mutation '${m.mutationId}' sur '${m.operation.path}' sans preuve formelle attachée.`);
    }
  }

  const valid = blockers.length === 0;

  return {
    planId: plan.planId,
    valid,
    riskLevel: impactAnalysis?.overallRisk ?? plan.riskLevel,
    impactAnalysis,
    blockers,
    warnings
  };
}
