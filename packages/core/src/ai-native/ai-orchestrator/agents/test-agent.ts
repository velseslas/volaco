/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Specialized Test & Verification Agent
 */

import { BaseSpecializedAgent } from './base-agent.js';
import type { AgentArtifact, AgentTask, TaskContextPayload } from '../types.js';
import type { AIProviderRegistry } from '../../../ai/providers/registry.js';

export class TestAgent extends BaseSpecializedAgent {
  constructor(registry?: AIProviderRegistry | undefined) {
    super(
      {
        id: 'agent-test-specialist',
        name: 'Quality & Test Specialist',
        domain: 'TEST',
        capabilities: ['UNIT_TEST_GEN', 'INTEGRATION_TEST', 'E2E_SCENARIO'],
        description: 'Responsable de la génération des suites de tests unitaires, vérification des régressions et validation des assertions.',
        riskLevel: 'LOW',
        requiredProviderCapabilities: ['CODE_GENERATION'],
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
    const targetFile = task.requiredContext.targetFiles?.[0] || 'tests/generated.test.ts';

    const testSuiteArtifact = this.createArtifact({
      id: `art-${task.id}-test-suite`,
      taskId: task.id,
      kind: 'TEST_SUITE_PROPOSAL',
      targetFiles: [targetFile],
      payload: {
        testCases: [
          { name: `Vérification du comportement nominal de ${task.title}`, expected: 'PASS' },
          { name: 'Vérification de la gestion des erreurs', expected: 'THROWS_VALIDATION' }
        ],
        suiteCode: generatedText
      },
      summary: 'Suite de tests unitaires automatisée'
    });

    const fileChangeArtifact = this.createArtifact({
      id: `art-${task.id}-test-file`,
      taskId: task.id,
      kind: 'PROPOSED_FILE_CHANGE',
      targetFiles: [targetFile],
      payload: {
        filePath: targetFile,
        operation: 'CREATE',
        proposedContent: generatedText,
        reason: 'Ajout de la suite de tests automatisée'
      },
      summary: `Fichier de test généré ${targetFile}`
    });

    return [testSuiteArtifact, fileChangeArtifact];
  }
}
