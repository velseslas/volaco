/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Dynamic Tool Selector
 */

import type { AgentIntent, ToolSelection } from '../types.js';
import type { ToolRegistry } from './registry.js';

export class ToolSelector {
  constructor(private readonly registry: ToolRegistry) {}

  public selectTools(intent: AgentIntent): readonly ToolSelection[] {
    const selections: ToolSelection[] = [];

    // Reading context is always relevant first
    if (this.registry.has('build_context')) {
      selections.push({
        tool: 'build_context',
        reason: 'Assembler le contexte pertinent via AINT-003',
        priority: 10,
        expectedInformationGain: 0.9,
        risk: 'LOW',
        input: { userIntent: intent.goal, focusFiles: intent.entities.filter((e) => e.includes('.')) }
      });
    }

    // If explicit file targets exist, schedule read_file
    for (const entity of intent.entities) {
      if (entity.includes('.') && this.registry.has('read_file')) {
        selections.push({
          tool: 'read_file',
          reason: `Lire le fichier cible ${entity}`,
          priority: 9,
          expectedInformationGain: 0.85,
          risk: 'LOW',
          input: { path: entity }
        });
      }
    }

    // If mutation is required, impact analysis is mandatory before mutation
    if (intent.requiresMutation && this.registry.has('analyze_impact')) {
      selections.push({
        tool: 'analyze_impact',
        reason: 'Calculer le rayon d explosion et verifier la criticite avant toute modification (AINT-005)',
        priority: 8,
        expectedInformationGain: 0.8,
        risk: 'LOW',
        input: { targetFiles: intent.entities.filter((e) => e.includes('.')) }
      });
    }

    return selections;
  }
}
