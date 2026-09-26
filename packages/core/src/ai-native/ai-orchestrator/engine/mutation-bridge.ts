/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Mutation Bridge - Translates Agent Artifacts to AINT-006 Transactions (Single Writer)
 */

import type { Role } from '../../../identity/permissions.js';
import type { MutationOrchestratorService } from '../../mutation-orchestrator/service.js';
import type { SingleMutation } from '../../mutation-orchestrator/types.js';
import type { AgentArtifact, ProposedFileChangePayload } from '../types.js';

export interface MutationBridgeResult {
  readonly success: boolean;
  readonly transactionId?: string | undefined;
  readonly appliedCount: number;
  readonly error?: string | undefined;
}

export class MutationBridge {
  constructor(
    private readonly mutationService?: MutationOrchestratorService | undefined
  ) {}

  public async applyArtifacts(params: {
    artifacts: readonly AgentArtifact[];
    tenantId: string;
    projectId: string;
    userRole?: Role | undefined;
    requestId?: string | undefined;
    dryRun?: boolean | undefined;
  }): Promise<MutationBridgeResult> {
    const { artifacts, tenantId, projectId, userRole = 'ENGINEER', requestId, dryRun = false } = params;

    const fileChanges = artifacts.filter((a) => a.kind === 'PROPOSED_FILE_CHANGE');
    if (fileChanges.length === 0) {
      return {
        success: true,
        appliedCount: 0
      };
    }

    if (!this.mutationService) {
      // Mock / Verification mode: mutations prepared without physical disk write
      return {
        success: true,
        transactionId: `mock-tx-${Date.now().toString(36)}`,
        appliedCount: fileChanges.length
      };
    }

    try {
      const targetFiles: string[] = [];
      const mutations: SingleMutation[] = [];

      for (let i = 0; i < fileChanges.length; i++) {
        const art = fileChanges[i]!;
        const payload = art.payload as ProposedFileChangePayload;
        const filePath = payload.filePath;
        targetFiles.push(filePath);

        const opKind = payload.operation === 'CREATE'
          ? 'CREATE_FILE'
          : payload.operation === 'DELETE'
          ? 'DELETE_FILE'
          : 'UPDATE_FILE';

        mutations.push({
          mutationId: `mut-${art.id}-${i + 1}`,
          kind: opKind,
          target: filePath,
          preconditions: [],
          operation: {
            path: filePath,
            content: payload.proposedContent || ''
          },
          expectedOutcome: payload.reason || 'Modification de fichier par agent spécialisé',
          evidence: []
        });
      }

      // 1. Create plan in AINT-006 (topologically sorted, pre-validated)
      const plan = this.mutationService.createPlan(
        {
          tenantId,
          projectId,
          // Le hash réel du graphe doit être résolu par createPlan (fallback
          // graph?.graphHash) : une constante ici garantissait un rejet
          // STALE_MUTATION_PLAN à chaque exécution transactionnelle.
          baseGraphHash: '',
          requestId,
          mutations
        },
        userRole,
        requestId
      );

      // 2. Execute plan transactionally through AINT-006
      const executionResult = this.mutationService.executePlan(
        plan,
        {
          dryRun,
          allowHighRisk: true
        },
        userRole,
        requestId
      );

      return {
        success: executionResult.transaction.status === 'COMMITTED',
        transactionId: executionResult.transaction.transactionId,
        appliedCount: executionResult.transaction.appliedMutations.length
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        appliedCount: 0,
        error: msg
      };
    }
  }
}
