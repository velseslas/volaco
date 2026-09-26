/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Specialized Backend & Business Logic Agent
 */

import { BaseSpecializedAgent } from './base-agent.js';
import type { AgentArtifact, AgentTask, TaskContextPayload } from '../types.js';
import type { AIProviderRegistry } from '../../../ai/providers/registry.js';

export class BackendAgent extends BaseSpecializedAgent {
  constructor(registry?: AIProviderRegistry | undefined) {
    super(
      {
        id: 'agent-backend-specialist',
        name: 'Backend & Services Specialist',
        domain: 'BACKEND',
        capabilities: ['API_DESIGN', 'SERVICE_LOGIC'],
        description: 'Responsable des endpoints d API, des services d orchestration et de la logique métier.',
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
    const targetFile = task.requiredContext.targetFiles?.[0] || 'src/services/app-service.ts';

    const op = task.operation === 'DELETE' ? 'DELETE' : task.operation === 'CREATE' ? 'CREATE' : 'UPDATE';

    const fileChangeArtifact = this.createArtifact({
      id: `art-${task.id}-backend-change`,
      taskId: task.id,
      kind: 'PROPOSED_FILE_CHANGE',
      targetFiles: [targetFile],
      payload: {
        filePath: targetFile,
        operation: op,
        proposedContent: op === 'DELETE' ? undefined : generatedText,
        reason: `Mise en œuvre du service par ${this.definition.name}`
      },
      summary: `Logique backend générée pour ${targetFile}`
    });

    const apiSpecArtifact = this.createArtifact({
      id: `art-${task.id}-api-spec`,
      taskId: task.id,
      kind: 'API_SPEC_CHANGE',
      targetFiles: [targetFile],
      payload: {
        endpoints: [{ method: 'POST', path: '/api/v1/resource', authRequired: true }],
        protocol: 'REST / JSON'
      },
      summary: 'Spécification des endpoints API'
    });

    return [fileChangeArtifact, apiSpecArtifact];
  }
}
