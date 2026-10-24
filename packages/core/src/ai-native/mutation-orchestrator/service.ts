/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Mutation Orchestrator Facade Service
 */

import { randomUUID } from 'node:crypto';
import { NotFoundError, ValidationError } from '../../errors.js';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { auditStore } from '../../observability/audit.js';
import type { CodeIntelligenceService } from '../understanding/service.js';
import type { ApplicationDNAService } from '../dna/service.js';
import type { SemanticCodeGraphService } from '../semantic-graph/service.js';
import type { ImpactIntelligenceService } from '../impact-intelligence/service.js';
import type { IMutableFileSource } from './filesystem/adapter.js';
import { createTransactionSnapshot } from './filesystem/snapshot.js';
import { buildMutationPlan, type CreatePlanRequest } from './engine/planner.js';
import { validatePlanAgainstImpact } from './engine/validator.js';
import { executeSingleMutation } from './engine/mutation-engine.js';
import { rollbackTransaction } from './engine/rollback.js';
import { verifyPostMutationState } from './engine/verification.js';
import { computeTransactionHash, deepFreeze } from './engine/canonical.js';
import { MutationPlanLruCache } from './cache.js';
import type {
  MutationExecutionOptions,
  MutationExecutionResult,
  MutationOrchestratorConfig,
  MutationPlan,
  MutationTransaction,
  PlanValidationResult,
  MutationRollbackResult, SingleMutation,
  StructuredDiff
} from './types.js';
import { MutationValidationError } from './types.js';

export const DEFAULT_MUTATION_CONFIG: MutationOrchestratorConfig = {
  maxMutationsPerPlan: 100,
  allowDirectRouteMutation: true,
  requireImpactAnalysis: false,
  cacheMaxEntries: 100,
  transactionsMaxEntries: 100
};

export class MutationOrchestratorService {
  private readonly config: MutationOrchestratorConfig;
  private readonly planCache: MutationPlanLruCache;
  private readonly transactions = new Map<string, MutationTransaction>();

  constructor(
    private readonly fileSource: IMutableFileSource,
    private readonly codeIntelService?: CodeIntelligenceService | undefined,
    private readonly dnaService?: ApplicationDNAService | undefined,
    private readonly semanticGraphService?: SemanticCodeGraphService | undefined,
    private readonly impactService?: ImpactIntelligenceService | undefined,
    config?: Partial<MutationOrchestratorConfig> | undefined
  ) {
    this.config = {
      ...DEFAULT_MUTATION_CONFIG,
      ...config
    };
    this.planCache = new MutationPlanLruCache(this.config.cacheMaxEntries);
  }

  /**
   * V7-WIRE-2 — registre borné (LRU) des transactions.
   *
   * Avant ce correctif, `transactions` était une `Map` non bornée : chaque
   * génération du flux ajoutait une transaction (snapshots de fichiers
   * compris) sans jamais évincer les anciennes. Le registre est maintenant
   * borné par `transactionsMaxEntries` (défaut 100).
   */
  private rememberTransaction(transaction: MutationTransaction): void {
    const key = transaction.transactionId;
    if (this.transactions.has(key)) {
      this.transactions.delete(key);
    } else {
      const maxEntries = Math.max(1, this.config.transactionsMaxEntries);
      while (this.transactions.size >= maxEntries) {
        const oldest = this.transactions.keys().next().value;
        if (oldest === undefined) break;
        this.transactions.delete(oldest);
      }
    }
    this.transactions.set(key, transaction);
  }

  /** Un accès en lecture rafraîchit la position LRU (les rollbacks récents restent disponibles). */
  private touchTransaction(transactionId: string): void {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return;
    this.transactions.delete(transactionId);
    this.transactions.set(transactionId, transaction);
  }

  /**
   * Creates a validated, topologically ordered MutationPlan.
   */
  public createPlan(
    request: CreatePlanRequest,
    userRole: Role = 'ENGINEER',
    requestId?: string | undefined
  ): MutationPlan {
    // 1. RBAC (reading & creating plan)
    assertPermission(userRole, 'PROJECT_READ', requestId);

    // 2. Fetch current graph from AINT-004
    const graph = this.semanticGraphService
      ? this.semanticGraphService.buildGraph(
          { tenantId: request.tenantId, projectId: request.projectId },
          userRole,
          requestId
        )
      : undefined;

    const baseGraphHash = request.baseGraphHash || graph?.graphHash || 'unhashed';

    // 3. Optional Impact Analysis from AINT-005
    let impactAnalysis;
    if (this.impactService && graph) {
      try {
        const targetFiles = Array.from(new Set(request.mutations.map((m) => m.operation.path)));
        impactAnalysis = this.impactService.analyzeImpactOnGraph(
          graph,
          { targetFiles },
          userRole,
          requestId
        );
      } catch {
        // Impact analysis non-fatal for createPlan
      }
    }

    // 4. Build Plan
    const plan = buildMutationPlan(
      {
        ...request,
        baseGraphHash,
        baseImpactHash: impactAnalysis?.impactHash ?? request.baseImpactHash
      },
      this.fileSource,
      graph,
      impactAnalysis
    );

    // 5. Audit Logging
    if (requestId) {
      try {
        auditStore.record({
          tenantId: request.tenantId,
          userId: 'system',
          action: 'MUTATION_PLAN_CREATED',
          resourceType: 'mutation_plan',
          resourceId: plan.planId,
          status: 'SUCCESS',
          metadata: {
            planHash: plan.planHash,
            mutationCount: plan.mutations.length,
            riskLevel: plan.riskLevel
          },
          requestId
        });
      } catch {
        // Ignore audit error
      }
    }

    return plan;
  }

  /**
   * Validates a MutationPlan against the live project state and Impact Gate.
   */
  public validatePlan(
    plan: MutationPlan,
    userRole: Role = 'ENGINEER',
    requestId?: string | undefined
  ): PlanValidationResult {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const graph = this.semanticGraphService
      ? this.semanticGraphService.buildGraph(
          { tenantId: plan.tenantId, projectId: plan.projectId },
          userRole,
          requestId
        )
      : undefined;

    const currentGraphHash = graph?.graphHash ?? plan.baseGraphHash;

    const cacheKey = this.planCache.computeCacheKey(
      plan.tenantId,
      plan.projectId,
      currentGraphHash,
      plan.planHash
    );

    const cached = this.planCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let impactAnalysis;
    if (this.impactService && graph) {
      try {
        const targetFiles = Array.from(new Set(plan.mutations.map((m) => m.operation.path)));
        impactAnalysis = this.impactService.analyzeImpactOnGraph(
          graph,
          { targetFiles },
          userRole,
          requestId
        );
      } catch {
        // Ignore impact analysis lookup failure
      }
    }

    const result = validatePlanAgainstImpact(plan, currentGraphHash, impactAnalysis, undefined, requestId);
    this.planCache.set(cacheKey, result);

    if (requestId) {
      try {
        auditStore.record({
          tenantId: plan.tenantId,
          userId: 'system',
          action: 'MUTATION_VALIDATED',
          resourceType: 'mutation_plan',
          resourceId: plan.planId,
          status: result.valid ? 'SUCCESS' : 'FAILURE',
          metadata: {
            valid: result.valid,
            blockers: result.blockers
          },
          requestId
        });
      } catch {
        // Ignore audit error
      }
    }

    return result;
  }

  /**
   * Dry-run preview of a mutation plan. Zero filesystem mutation.
   */
  public previewPlan(
    plan: MutationPlan,
    options?: MutationExecutionOptions | undefined,
    userRole: Role = 'ENGINEER',
    requestId?: string | undefined
  ): MutationExecutionResult {
    return this.executePlan(plan, { ...options, dryRun: true }, userRole, requestId);
  }

  /**
   * Atomically executes a MutationPlan with full snapshot, verification, and automatic rollback on failure.
   */
  public executePlan(
    plan: MutationPlan,
    options?: MutationExecutionOptions | undefined,
    userRole: Role = 'ENGINEER',
    requestId?: string | undefined
  ): MutationExecutionResult {
    const startTime = Date.now();
    const dryRun = Boolean(options?.dryRun);

    // 1. Strict RBAC enforcement: Requires PROJECT_MUTATE (or PROJECT_UPDATE)
    if (!dryRun) {
      assertPermission(userRole, 'PROJECT_MUTATE', requestId);
    } else {
      assertPermission(userRole, 'PROJECT_READ', requestId);
    }

    // 2. Validate Plan against Impact Gate
    const graph = this.semanticGraphService
      ? this.semanticGraphService.buildGraph(
          { tenantId: plan.tenantId, projectId: plan.projectId },
          userRole,
          requestId
        )
      : undefined;

    const currentGraphHash = graph?.graphHash ?? plan.baseGraphHash;

    let impactAnalysis;
    if (this.impactService && graph && !options?.skipImpactCheck) {
      try {
        const targetFiles = Array.from(new Set(plan.mutations.map((m) => m.operation.path)));
        impactAnalysis = this.impactService.analyzeImpactOnGraph(
          graph,
          { targetFiles },
          userRole,
          requestId
        );
      } catch {
        // Ignore impact analysis failure
      }
    }

    const validation = validatePlanAgainstImpact(plan, currentGraphHash, impactAnalysis, options, requestId);
    if (!validation.valid) {
      throw new MutationValidationError(
        `Plan de mutation rejeté par l'Impact Gate: ${validation.blockers.join(' | ')}`,
        { blockers: validation.blockers, planId: plan.planId },
        requestId
      );
    }

    // 3. Create Pre-Mutation Transactional Snapshot
    const affectedFiles: string[] = [];
    for (const m of plan.mutations) {
      affectedFiles.push(m.operation.path);
      if (m.operation.newPath) {
        affectedFiles.push(m.operation.newPath);
      }
    }

    const snapshot = createTransactionSnapshot(
      this.fileSource,
      plan.tenantId,
      plan.projectId,
      affectedFiles
    );

    const transactionId = `tx-${randomUUID()}`;

    if (requestId) {
      try {
        auditStore.record({
          tenantId: plan.tenantId,
          userId: 'system',
          action: 'MUTATION_STARTED',
          resourceType: 'mutation_transaction',
          resourceId: transactionId,
          status: 'SUCCESS',
          metadata: { planId: plan.planId, dryRun },
          requestId
        });
      } catch {
        // Ignore audit error
      }
    }

    const appliedMutations: SingleMutation[] = [];
    const diffs: StructuredDiff[] = [];

    // 4. Sequential Atomic Execution
    try {
      for (const mutation of plan.mutations) {
        const stepResult = executeSingleMutation(
          this.fileSource,
          plan.tenantId,
          plan.projectId,
          mutation,
          dryRun,
          currentGraphHash,
          requestId
        );

        appliedMutations.push({
          ...mutation,
          contentHashAfter: stepResult.contentHashAfter
        });
        diffs.push(stepResult.diff);
      }

      // 5. Post-Mutation Verification (AINT-001 syntax check & explicit invariants)
      let revalidation;
      if (!dryRun) {
        revalidation = verifyPostMutationState(
          plan.tenantId,
          plan.projectId,
          plan,
          this.fileSource,
          this.codeIntelService,
          this.semanticGraphService,
          { invariants: options?.invariants, requestId }
        );
      }

      const durationMs = Math.max(0, Date.now() - startTime);
      const createdAt = new Date().toISOString();

      const txPayload = {
        transactionId,
        planId: plan.planId,
        tenantId: plan.tenantId,
        projectId: plan.projectId,
        status: 'COMMITTED' as const,
        appliedMutations,
        diffs,
        snapshot
      };

      const transactionHash = computeTransactionHash(txPayload);

      const transaction: MutationTransaction = deepFreeze({
        ...txPayload,
        transactionHash,
        createdAt,
        durationMs
      });

      if (!dryRun) {
        this.rememberTransaction(transaction);
      }

      // V7-LOT6 — un dry-run ne doit JAMAIS être journalisé comme un commit :
      // le sandbox calcule des diffs sans écrire, l'audit doit refléter la
      // réalité (MUTATION_STARTED conserve dryRun: true).
      if (!dryRun && requestId) {
        try {
          auditStore.record({
            tenantId: plan.tenantId,
            userId: 'system',
            action: 'MUTATION_COMMITTED',
            resourceType: 'mutation_transaction',
            resourceId: transactionId,
            status: 'SUCCESS',
            metadata: {
              transactionHash,
              durationMs,
              appliedCount: appliedMutations.length
            },
            requestId
          });
        } catch {
          // Ignore audit error
        }
      }

      const resultingTreeHash = this.fileSource.computeTreeHash(plan.tenantId, plan.projectId);

      return {
        success: true,
        dryRun,
        transaction,
        diffs,
        resultingTreeHash,
        resultingGraphHash: revalidation?.newGraphHash,
        revalidation
      };
    } catch (err: unknown) {
      // 6. Automatic Rollback on Any Failure
      if (!dryRun) {
        rollbackTransaction(this.fileSource, snapshot, transactionId);

        if (requestId) {
          try {
            auditStore.record({
              tenantId: plan.tenantId,
              userId: 'system',
              action: 'MUTATION_ROLLED_BACK',
              resourceType: 'mutation_transaction',
              resourceId: transactionId,
              status: 'SUCCESS',
              metadata: { error: err instanceof Error ? err.message : String(err) },
              requestId
            });
          } catch {
            // Ignore audit error
          }
        }
      }

      throw err;
    }
  }

  /**
   * Explicit rollback of a previously committed or recorded transaction.
   */
  public rollback(
    transactionId: string,
    userRole: Role = 'ENGINEER',
    requestId?: string | undefined
  ): MutationRollbackResult {
    assertPermission(userRole, 'PROJECT_MUTATE', requestId);

    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new NotFoundError(`Transaction de mutation '${transactionId}' introuvable`, requestId);
    }
    this.touchTransaction(transactionId);

    const result = rollbackTransaction(this.fileSource, transaction.snapshot, transactionId);

    // Mark transaction as rolled back
    const updatedTx: MutationTransaction = deepFreeze({
      ...transaction,
      status: 'ROLLED_BACK'
    });
    this.rememberTransaction(updatedTx);

    if (requestId) {
      try {
        auditStore.record({
          tenantId: transaction.tenantId,
          userId: 'system',
          action: 'MUTATION_ROLLED_BACK',
          resourceType: 'mutation_transaction',
          resourceId: transactionId,
          status: 'SUCCESS',
          metadata: { restoredFiles: result.restoredFiles },
          requestId
        });
      } catch {
        // Ignore audit error
      }
    }

    return result;
  }

  public getTransaction(
    transactionId: string,
    userRole: Role = 'VIEWER',
    requestId?: string | undefined
  ): MutationTransaction | undefined {
    assertPermission(userRole, 'PROJECT_READ', requestId);
    const transaction = this.transactions.get(transactionId);
    if (transaction) this.touchTransaction(transactionId);
    return transaction;
  }

  public clearCache(): void {
    this.planCache.clear();
  }
}
