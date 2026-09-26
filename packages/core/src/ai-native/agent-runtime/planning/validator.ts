/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Plan Validator
 */

import { type AgentPlan, PlanValidationError } from '../types.js';
import type { ToolRegistry } from '../tools/registry.js';

export class PlanValidator {
  constructor(private readonly toolRegistry: ToolRegistry) {}

  public validate(plan: AgentPlan): void {
    const errors: string[] = [];

    if (!plan.goal || plan.goal.trim().length === 0) {
      errors.push('Le plan doit definir un objectif clair');
    }

    if (!plan.steps || plan.steps.length === 0) {
      errors.push('Le plan doit contenir au moins une etape');
    }

    let hasMutation = false;
    let hasPriorImpact = false;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (!step) continue;

      if (!step.tool || !this.toolRegistry.has(step.tool)) {
        errors.push(`Etape ${i + 1} (${step.id}) : outil inconnu '${step.tool}'`);
      }

      if (step.tool === 'analyze_impact') {
        hasPriorImpact = true;
      }

      if (step.tool === 'execute_mutation') {
        hasMutation = true;
        // RULE 7: Aucune mutation sans plan valide & RULE 4: impact check
        if (!hasPriorImpact && !plan.impactAnalysis) {
          errors.push(`Etape ${i + 1} : tentative de mutation sans analyse d impact prealable (AINT-005)`);
        }
      }
    }

    if (errors.length > 0) {
      throw new PlanValidationError('Le plan d agent viole les regles de securite ou d integrite', errors);
    }
  }
}
