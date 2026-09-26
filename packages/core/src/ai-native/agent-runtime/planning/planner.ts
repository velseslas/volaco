/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Agent Planner
 */

import { randomUUID } from 'node:crypto';
import type { AgentIntent, AgentPlan, AgentStep, Assumption } from '../types.js';
import { ConfirmationPolicy } from './confirmation.js';
import { PlanValidator } from './validator.js';
import type { ToolRegistry } from '../tools/registry.js';

export class AgentPlanner {
  private readonly confirmationPolicy: ConfirmationPolicy;
  private readonly validator: PlanValidator;

  constructor(
    toolRegistry: ToolRegistry,
    confirmationPolicy?: ConfirmationPolicy | undefined
  ) {
    this.confirmationPolicy = confirmationPolicy ?? new ConfirmationPolicy();
    this.validator = new PlanValidator(toolRegistry);
  }

  public createPlan(
    intent: AgentIntent,
    assumptions: readonly Assumption[],
    impactAnalysis?: unknown | undefined
  ): AgentPlan {
    const planId = `plan-${randomUUID().substring(0, 8)}`;
    const steps: AgentStep[] = [];
    const requiredTools: string[] = [];
    const expectedChanges: string[] = [];
    const risks: string[] = [];

    // Step 1: Read Context
    steps.push({
      id: `step-1-${randomUUID().substring(0, 4)}`,
      index: 1,
      description: 'Assembler et verifier le contexte disponible pour la demande',
      tool: 'build_context',
      parameters: { userIntent: intent.goal, focusFiles: intent.entities.filter((e) => e.includes('.')) },
      expectedOutput: 'Contexte assemble',
      status: 'PENDING'
    });
    requiredTools.push('build_context');

    // Step 2: Read target files
    for (const entity of intent.entities) {
      if (entity.includes('.')) {
        steps.push({
          id: `step-${steps.length + 1}-${randomUUID().substring(0, 4)}`,
          index: steps.length + 1,
          description: `Lire le fichier cible ${entity}`,
          tool: 'read_file',
          parameters: { path: entity },
          expectedOutput: 'Contenu du fichier',
          status: 'PENDING'
        });
        if (!requiredTools.includes('read_file')) requiredTools.push('read_file');
        expectedChanges.push(entity);
      }
    }

    // Step 3: If mutation needed, evaluate impact first
    if (intent.requiresMutation) {
      steps.push({
        id: `step-${steps.length + 1}-${randomUUID().substring(0, 4)}`,
        index: steps.length + 1,
        description: 'Analyser l impact et verifier l absence de regression critique (AINT-005)',
        tool: 'analyze_impact',
        parameters: { targetFiles: expectedChanges },
        expectedOutput: 'Rapport d impact et score de risque',
        status: 'PENDING'
      });
      if (!requiredTools.includes('analyze_impact')) requiredTools.push('analyze_impact');

      // Step 4: Preview mutation (dry-run)
      steps.push({
        id: `step-${steps.length + 1}-${randomUUID().substring(0, 4)}`,
        index: steps.length + 1,
        description: 'Calculer la previsualisation des diffs structurels (AINT-006 dry-run)',
        tool: 'preview_mutation',
        parameters: { plan: { targetFiles: expectedChanges } },
        expectedOutput: 'Diffs calcules',
        status: 'PENDING'
      });
      if (!requiredTools.includes('preview_mutation')) requiredTools.push('preview_mutation');

      // Step 5: Execute mutation
      steps.push({
        id: `step-${steps.length + 1}-${randomUUID().substring(0, 4)}`,
        index: steps.length + 1,
        description: 'Appliquer la mutation atomique controlee (AINT-006)',
        tool: 'execute_mutation',
        parameters: { plan: { targetFiles: expectedChanges } },
        expectedOutput: 'Transaction validee',
        status: 'PENDING'
      });
      if (!requiredTools.includes('execute_mutation')) requiredTools.push('execute_mutation');

      // Step 6: Post-mutation verification
      steps.push({
        id: `step-${steps.length + 1}-${randomUUID().substring(0, 4)}`,
        index: steps.length + 1,
        description: 'Verifier l integrite du code et l absence d erreur de syntaxe ou type (AINT-001/AINT-007)',
        tool: 'run_typecheck',
        parameters: {},
        expectedOutput: 'Zero erreur de type',
        status: 'PENDING'
      });
      if (!requiredTools.includes('run_typecheck')) requiredTools.push('run_typecheck');
    }

    if (intent.type === 'DELETE_FILE') {
      risks.push('Perte definitive de fichiers');
    }

    const preliminaryPlan: AgentPlan = {
      id: planId,
      goal: intent.goal,
      assumptions,
      steps,
      requiredTools,
      expectedChanges,
      risks,
      impactAnalysis,
      confirmationRequired: false,
      validated: false
    };

    const confirmCheck = this.confirmationPolicy.requiresConfirmation(preliminaryPlan);
    const confirmationRequired = confirmCheck.required || intent.requiresConfirmation;

    const validatedPlan: AgentPlan = {
      ...preliminaryPlan,
      confirmationRequired,
      validated: true
    };

    this.validator.validate(validatedPlan);

    return validatedPlan;
  }
}
