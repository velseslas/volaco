/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Contradiction & Conflict Detection Engine
 */

import type {
  ConversationAssumption,
  DecisionRecord,
  IntentResult,
  ProjectMemory,
  ContradictionRecord
} from '../types.js';

export class ContradictionDetector {
  /**
   * Detects contradictions between current intent/assumptions and established project memory / decisions.
   */
  public detectContradictions(params: {
    newIntent: IntentResult;
    newAssumptions?: readonly ConversationAssumption[] | undefined;
    projectMemory: ProjectMemory;
    activeDecisions: readonly DecisionRecord[];
  }): readonly ContradictionRecord[] {
    const { newIntent, newAssumptions = [], projectMemory, activeDecisions } = params;
    const contradictions: ContradictionRecord[] = [];

    const intentText = `${newIntent.goal} ${newIntent.requestedAction} ${newIntent.constraints.join(' ')}`.toLowerCase();

    // 1. Check against active architectural decisions
    for (const decision of activeDecisions) {
      if (decision.status !== 'ACTIVE') continue;

      const statementLower = decision.statement.toLowerCase();

      // Technology or framework conflict detection
      if (
        (statementLower.includes('tailwind') && intentText.includes('bootstrap')) ||
        (statementLower.includes('bootstrap') && intentText.includes('tailwind')) ||
        (statementLower.includes('graphql') && intentText.includes('rest only')) ||
        (statementLower.includes('postgresql') && intentText.includes('mongodb'))
      ) {
        contradictions.push({
          id: `conflict-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'DECISION_CONFLICT',
          previousItem: `Decision ${decision.decisionId}: ${decision.statement}`,
          newItem: newIntent.goal,
          explanation: `Nouvelle demande '${newIntent.goal}' entre en conflit direct avec la décision active: '${decision.statement}'`,
          resolved: false
        });
      }
    }

    // 2. Check against known project constraints
    for (const constraint of projectMemory.knownConstraints) {
      const constraintLower = constraint.toLowerCase();

      if (
        (constraintLower.includes('do not delete') || constraintLower.includes('ne pas supprimer')) &&
        newIntent.category === 'DELETE'
      ) {
        contradictions.push({
          id: `conflict-c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'CONSTRAINT_CONFLICT',
          previousItem: constraint,
          newItem: newIntent.requestedAction,
          explanation: `L'action demandée viole la contrainte de projet: '${constraint}'`,
          resolved: false
        });
      }
    }

    // 3. Check new assumptions against known conventions
    for (const assumption of newAssumptions) {
      const assumptionLower = assumption.statement.toLowerCase();
      for (const convention of projectMemory.knownConventions) {
        const conventionLower = convention.toLowerCase();
        if (
          (conventionLower.includes('typescript strict') && assumptionLower.includes('disable type checking')) ||
          (conventionLower.includes('esm only') && assumptionLower.includes('commonjs'))
        ) {
          contradictions.push({
            id: `conflict-a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'ARCHITECTURE_CONFLICT',
            previousItem: convention,
            newItem: assumption.statement,
            explanation: `L'hypothèse '${assumption.statement}' viole la convention d'architecture: '${convention}'`,
            resolved: false
          });
        }
      }
    }

    return Object.freeze(contradictions);
  }
}
