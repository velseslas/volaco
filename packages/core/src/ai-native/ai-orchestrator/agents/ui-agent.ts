/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Specialized UI & Design Agent
 */

import { BaseSpecializedAgent } from './base-agent.js';
import type { AgentArtifact, AgentTask, TaskContextPayload } from '../types.js';
import type { AIProviderRegistry } from '../../../ai/providers/registry.js';

export class UiAgent extends BaseSpecializedAgent {
  constructor(registry?: AIProviderRegistry | undefined) {
    super(
      {
        id: 'agent-ui-specialist',
        name: 'UI & Layout Specialist',
        domain: 'UI',
        capabilities: ['PAGE_GENERATION', 'COMPONENT_STYLING', 'RESPONSIVE_LAYOUT'],
        description: 'Responsable des vues, composants, ergonomie, design Tailwind CSS et accessibilité.',
        riskLevel: 'LOW',
        requiredProviderCapabilities: ['CODE_GENERATION', 'FAST'],
        allowedTools: ['read_file', 'inspect_ast']
      },
      registry
    );
  }

  protected buildArtifacts(params: {
    task: AgentTask;
    context: TaskContextPayload;
    generatedText: string;
  }): readonly AgentArtifact[] {
    const { task, generatedText } = params;
    const targetFile = task.requiredContext.targetFiles?.[0] || 'src/components/View.tsx';

    const op = task.operation === 'DELETE' ? 'DELETE' : task.operation === 'CREATE' ? 'CREATE' : 'UPDATE';

    const fileChangeArtifact = this.createArtifact({
      id: `art-${task.id}-ui-change`,
      taskId: task.id,
      kind: 'PROPOSED_FILE_CHANGE',
      targetFiles: [targetFile],
      payload: {
        filePath: targetFile,
        operation: op,
        proposedContent: op === 'DELETE' ? undefined : generatedText,
        reason: `Mise à jour d'interface réalisée par ${this.definition.name}`
      },
      summary: `Artefact UI généré pour ${targetFile}`
    });

    const specArtifact = this.createArtifact({
      id: `art-${task.id}-ui-spec`,
      taskId: task.id,
      kind: 'UI_SPEC',
      targetFiles: [targetFile],
      payload: {
        componentName: 'MainView',
        responsiveBreakpoints: ['sm', 'md', 'lg', 'xl'],
        stylingFramework: 'TailwindCSS'
      },
      summary: 'Spécification de design responsive et hiérarchie de composants'
    });

    return [fileChangeArtifact, specArtifact];
  }
}
