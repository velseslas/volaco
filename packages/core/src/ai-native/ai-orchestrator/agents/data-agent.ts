/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Specialized Data & Schema Architecture Agent
 */

import { BaseSpecializedAgent } from './base-agent.js';
import type { AgentArtifact, AgentTask, TaskContextPayload } from '../types.js';
import type { AIProviderRegistry } from '../../../ai/providers/registry.js';

export class DataAgent extends BaseSpecializedAgent {
  constructor(registry?: AIProviderRegistry | undefined) {
    super(
      {
        id: 'agent-data-specialist',
        name: 'Data & Schema Specialist',
        domain: 'DATA',
        capabilities: ['SCHEMA_MODELING', 'DATA_INTEGRITY'],
        description: 'Responsable des schémas d entités, modèles de persistance et cohérence des flux de données.',
        riskLevel: 'HIGH',
        requiredProviderCapabilities: ['DEEP_REASONING', 'CODE_GENERATION'],
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
    const targetFile = task.requiredContext.targetFiles?.[0] || 'src/models/schema.ts';

    const schemaArtifact = this.createArtifact({
      id: `art-${task.id}-data-schema`,
      taskId: task.id,
      kind: 'DATA_SCHEMA_CHANGE',
      targetFiles: [targetFile],
      payload: {
        entities: [{ name: 'RecordItem', fields: ['id', 'name', 'createdAt'] }],
        schemaDefinition: generatedText
      },
      summary: 'Schéma de données structuré'
    });

    const op = task.operation === 'DELETE' ? 'DELETE' : task.operation === 'CREATE' ? 'CREATE' : 'UPDATE';

    const fileChangeArtifact = this.createArtifact({
      id: `art-${task.id}-data-file-change`,
      taskId: task.id,
      kind: 'PROPOSED_FILE_CHANGE',
      targetFiles: [targetFile],
      payload: {
        filePath: targetFile,
        operation: op,
        proposedContent: op === 'DELETE' ? undefined : generatedText,
        reason: 'Mise à jour des types de données'
      },
      summary: `Contrats de données pour ${targetFile}`
    });

    return [schemaArtifact, fileChangeArtifact];
  }
}
