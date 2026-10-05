/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * ÉTAPE 40 Phase 4 — Specialized Code Agent (Mistral via provider existant)
 *
 * Agent LLM spécialisé dans la génération/implémentation de code. Réutilise
 * intégralement le pattern des agents spécialisés : executeTask hérité de
 * BaseSpecializedAgent (résolution provider par capabilities, prompt système
 * anti-injection), buildArtifacts produit des PROPOSED_FILE_CHANGE — la
 * mutation est ensuite appliquée EXCLUSIVEMENT par MutationOrchestratorService
 * via AgentExecutionService (single-writer, Gate/Repair/rollback É35/É36).
 */

import { BaseSpecializedAgent } from './base-agent.js';
import type { AgentArtifact, AgentTask, TaskContextPayload } from '../types.js';
import type { AIProviderRegistry } from '../../../ai/providers/registry.js';

export class CodeAgent extends BaseSpecializedAgent {
  constructor(registry?: AIProviderRegistry | undefined) {
    super(
      {
        id: 'agent-code-specialist',
        name: 'Code Specialist',
        domain: 'CODE',
        capabilities: ['SERVICE_LOGIC'],
        description: 'Responsable de l implémentation du code : génération et modification des fichiers sources via le provider LLM.',
        riskLevel: 'MEDIUM',
        requiredProviderCapabilities: ['CODE_GENERATION'],
        allowedTools: ['read_file', 'inspect_ast', 'inspect_graph']
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
    const targetFile = task.requiredContext.targetFiles?.[0] || 'src/code/generated.ts';

    const op = task.operation === 'DELETE' ? 'DELETE' : task.operation === 'CREATE' ? 'CREATE' : 'UPDATE';

    const fileChangeArtifact = this.createArtifact({
      id: `art-${task.id}-code-change`,
      taskId: task.id,
      kind: 'PROPOSED_FILE_CHANGE',
      targetFiles: [targetFile],
      payload: {
        filePath: targetFile,
        operation: op,
        proposedContent: op === 'DELETE' ? undefined : generatedText,
        reason: `Implémentation du code par ${this.definition.name}`
      },
      summary: `Code généré pour ${targetFile}`
    });

    return [fileChangeArtifact];
  }
}
