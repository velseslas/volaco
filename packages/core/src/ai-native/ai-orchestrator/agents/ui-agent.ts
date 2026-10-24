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
    const { task, context, generatedText } = params;
    const targetFile = task.requiredContext.targetFiles?.[0] || 'src/components/View.tsx';
    const designContext = context.designContext;

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
        reason: designContext
          ? `Mise à jour d'interface design-aware (Design DNA réel, rapport ${designContext.reportId}) réalisée par ${this.definition.name}`
          : `Mise à jour d'interface réalisée par ${this.definition.name}`
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
        stylingFramework: 'TailwindCSS',
        // CDC V8 §11 — traçabilité du Design DNA réellement appliqué (absent
        // quand aucun rapport n'existe : payload historique inchangé).
        ...(designContext
          ? {
              designAware: true,
              designContextSource: {
                reportId: designContext.reportId,
                generatedAt: designContext.generatedAt,
                overallScore: designContext.overallScore
              },
              designDirection: designContext.direction,
              designDirectionSource: designContext.directionSource,
              designRulesApplied: designContext.rules.length,
              designRulesCatalogVersion: designContext.rulesCatalogVersion
            }
          : {})
      },
      summary: designContext
        ? `Spécification de design responsive alignée sur le Design DNA du projet (rapport ${designContext.reportId})`
        : 'Spécification de design responsive et hiérarchie de composants'
    });

    return [fileChangeArtifact, specArtifact];
  }
}
