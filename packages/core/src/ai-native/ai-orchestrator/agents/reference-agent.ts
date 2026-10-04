/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * ÉTAPE 32 — Reference Agent (agent de référence déterministe)
 *
 * Agent interne de test/démonstration du contrat d'exécution d'agent :
 * - déterministe (même tâche → même résultat, même contenu de fichier) ;
 * - n'appelle AUCUNE API externe, AUCUN LLM, AUCUN MCP ;
 * - ne touche JAMAIS au workspace directement : il produit un artifact
 *   PROPOSED_FILE_CHANGE concret, et la mutation passe obligatoirement par
 *   MutationOrchestratorService via le contrat d'exécution.
 *
 * Le contenu produit est dérivé de la tâche (titre/description) : vérifiable
 * et reproductible.
 */

import { computeArtifactHash, deepFreeze } from '../canonical.js';
import type {
  AgentArtifact,
  AgentResult,
  AgentTask,
  TaskContextPayload
} from '../types.js';
import type { AIProviderRegistry } from '../../../ai/providers/registry.js';
import { aiProviderRegistry } from '../../../ai/providers/registry.js';
import { BaseSpecializedAgent } from './base-agent.js';

export const REFERENCE_AGENT_ID = 'reference-agent';

export class ReferenceAgent extends BaseSpecializedAgent {
  constructor(registry?: AIProviderRegistry | undefined) {
    super(
      {
        id: REFERENCE_AGENT_ID,
        name: 'Reference Agent (déterministe)',
        domain: 'ARCHITECTURE',
        capabilities: ['SERVICE_LOGIC', 'SCHEMA_MODELING'],
        description:
          'Agent de référence déterministe pour le contrat d exécution É32 : produit un fichier réel à partir de la tâche, sans LLM, sans réseau, sans MCP.',
        riskLevel: 'LOW',
        requiredProviderCapabilities: [],
        allowedTools: []
      },
      registry ?? aiProviderRegistry
    );
  }

  /**
   * Exécution déterministe : PAS d'appel LLM (override complet de
   * BaseSpecializedAgent.executeTask). Même entrée → même AgentResult.
   */
  public override async executeTask(params: {
    task: AgentTask;
    context: TaskContextPayload;
    tenantId: string;
    projectId: string;
    requestId?: string | undefined;
  }): Promise<AgentResult> {
    const startTime = Date.now();
    const { task } = params;

    const targetFile = task.requiredContext.targetFiles?.[0];

    // Tâche de mutation sans fichier cible → FAILURE réel (jamais de contenu
    // fabriqué vers une destination inventée).
    if (!targetFile) {
      return deepFreeze({
        taskId: task.id,
        agentId: this.definition.id,
        status: 'FAILURE' as const,
        artifacts: [],
        conflicts: [],
        tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: Date.now() - startTime,
        error: 'REFERENCE_AGENT_INVALID_TASK: aucune targetFile fournie par la tâche'
      });
    }

    const operation = task.operation === 'DELETE' ? 'DELETE' : task.operation === 'CREATE' ? 'CREATE' : 'UPDATE';
    const proposedContent = this.buildDeterministicContent(task);

    const artifact: AgentArtifact = {
      id: `art-${task.id}-reference`,
      taskId: task.id,
      agentId: this.definition.id,
      domain: this.definition.domain,
      kind: 'PROPOSED_FILE_CHANGE',
      targetFiles: [targetFile],
      payload: {
        filePath: targetFile,
        operation,
        ...(operation === 'DELETE' ? {} : { proposedContent }),
        reason: `Fichier produit par le reference-agent (É32) pour la tâche '${task.title}'`
      },
      summary: `Fichier déterministe pour ${targetFile}`,
      evidences: [
        {
          source: 'FILE',
          identifier: targetFile,
          hash: computeArtifactHash({
            id: `art-${task.id}-reference`,
            taskId: task.id,
            domain: this.definition.domain,
            kind: 'PROPOSED_FILE_CHANGE',
            targetFiles: [targetFile],
            payload: { targetFile, operation, proposedContent }
          }),
          summary: 'Contenu déterministe dérivé de la tâche'
        }
      ],
      confidence: 1,
      hash: computeArtifactHash({
        id: `art-${task.id}-reference`,
        taskId: task.id,
        domain: this.definition.domain,
        kind: 'PROPOSED_FILE_CHANGE',
        targetFiles: [targetFile],
        payload: { targetFile, operation, proposedContent }
      }),
      createdAt: new Date().toISOString()
    };

    return deepFreeze({
      taskId: task.id,
      agentId: this.definition.id,
      status: 'SUCCESS' as const,
      degraded: false,
      artifacts: [artifact],
      conflicts: [],
      tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      durationMs: Date.now() - startTime
    });
  }

  /**
   * Hook jamais utilisé (executeTask est surchargé) mais requis par la classe
   * abstraite : construction d'artifacts depuis un texte généré.
   */
  protected buildArtifacts(params: {
    task: AgentTask;
    context: TaskContextPayload;
    generatedText: string;
  }): readonly AgentArtifact[] {
    return [];
  }

  /**
   * Contenu déterministe : dérivé uniquement de la tâche. Même tâche →
   * octets identiques.
   */
  private buildDeterministicContent(task: AgentTask): string {
    const lines = [
      '// Généré par reference-agent (ÉTAPE 32 — contrat d exécution d agent).',
      '// Contenu déterministe : dérivé uniquement de la tâche reçue.',
      `// Tâche : ${task.title}`,
      `// Description : ${task.description}`,
      `export const REFERENCE_TASK_ID = ${JSON.stringify(task.id)};`,
      `export const REFERENCE_TASK_TITLE = ${JSON.stringify(task.title)};`,
      `export const REFERENCE_AGENT = ${JSON.stringify(this.definition.id)};`
    ];
    return `${lines.join('\n')}\n`;
  }
}
