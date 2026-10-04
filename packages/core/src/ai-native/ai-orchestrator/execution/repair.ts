/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * ÉTAPE 36 — Classification d'échec + RepairPlan + réparation de référence
 *
 * Classification DÉTERMINISTE du failure (réutilise les erreurs É35).
 * RepairPlan typé, borné : maxAttempts = 1 par défaut, aucune boucle,
 * aucune récursion. La stratégie de référence (UNE seule) traite le cas
 * explicitement sûr « divergence de contenu après une mutation contrôlée » :
 *
 *   1. restaurer l'état sûr via le single-writer (rollback réel É35) ;
 *   2. vérifier la restauration ;
 *   3. réappliquer UNE fois la mutation attendue via le single-writer ;
 *   4. relancer le Gate (même gate que la première vérification) ;
 *   5. PASS → verdict final ; FAIL → rollback final + FAILED/ROLLED_BACK.
 *
 * Tout autre cas → REPAIR_UNSUPPORTED : aucune invention de correction,
 * aucune mutation supplémentaire.
 */

import type { IReadOnlyFileSource } from '../../understanding/types.js';
import type { MutationBridge } from '../engine/mutation-bridge.js';
import type { AgentArtifact } from '../types.js';
import type { GateResult } from './gate.js';
import { evaluateFileMutationGate } from './gate.js';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type RepairFailureReason =
  | 'VERIFICATION_FAILED'
  | 'ARTIFACT_INVALID'
  | 'MUTATION_FAILED'
  | 'ROLLBACK_FAILED'
  | 'CANCELLATION'
  | 'UNSUPPORTED_OPERATION';

export function classifyGateFailure(params: {
  readonly gate?: GateResult | undefined;
  readonly mutationExecuted: boolean;
  readonly mutationError?: string | undefined;
  readonly cancelled: boolean;
  readonly rollbackFailed?: boolean | undefined;
}): RepairFailureReason {
  if (params.cancelled) return 'CANCELLATION';
  if (params.rollbackFailed) return 'ROLLBACK_FAILED';
  if (!params.mutationExecuted) return 'MUTATION_FAILED';
  if (params.gate && !params.gate.passed) return 'VERIFICATION_FAILED';
  if (params.mutationError) return 'MUTATION_FAILED';
  return 'UNSUPPORTED_OPERATION';
}

// ---------------------------------------------------------------------------
// RepairPlan
// ---------------------------------------------------------------------------

export type RepairAction = 'ROLLBACK_THEN_REAPPLY';

export interface RepairPlan {
  /** Identifiant DÉTERMINISTE : rep-<executionId>-<attempt>. */
  readonly repairId: string;
  readonly executionId: string;
  readonly reason: RepairFailureReason;
  readonly detail: string;
  readonly allowedActions: readonly RepairAction[];
  readonly target: { readonly paths: readonly string[] };
  readonly maxAttempts: number;
}

export const DEFAULT_REPAIR_MAX_ATTEMPTS = 1;

export function buildRepairPlan(params: {
  readonly executionId: string;
  readonly attempt: number;
  readonly reason: RepairFailureReason;
  readonly detail: string;
  readonly targetPaths: readonly string[];
  readonly maxAttempts?: number | undefined;
}): RepairPlan {
  return {
    repairId: `rep-${params.executionId}-${params.attempt}`,
    executionId: params.executionId,
    reason: params.reason,
    detail: params.detail,
    allowedActions: ['ROLLBACK_THEN_REAPPLY'],
    target: { paths: [...params.targetPaths] },
    maxAttempts: params.maxAttempts ?? DEFAULT_REPAIR_MAX_ATTEMPTS
  };
}

// ---------------------------------------------------------------------------
// Réparation de référence (bornée)
// ---------------------------------------------------------------------------

export interface RepairExecutionContext {
  readonly executionId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly userRole?: string | undefined;
  readonly requestId?: string | undefined;
  /** Artifacts validés de l'exécution d'origine. */
  readonly fileChanges: readonly AgentArtifact[];
  /** Snapshot AVANT la mutation d'origine (état sûr à restaurer). */
  readonly beforeSnapshot: readonly { path: string; existed: boolean; content: string | undefined }[];
  /** Transaction de la mutation d'origine (pour le rollback réel). */
  readonly transactionId?: string | undefined;
  /** Gate déjà évalué (l'échec à l'origine du repair). */
  readonly failedGate: GateResult;
  /** Observateur read-only de la source (LA même source). */
  readonly fileObserver: IReadOnlyFileSource;
  readonly isAborted: () => boolean;
}

export interface RepairOutcome {
  /** Une réparation a-t-elle été réellement tentée ? */
  readonly performed: boolean;
  /** REPAIR_UNSUPPORTED : raison explicite si le cas n'est pas supporté. */
  readonly unsupported?: string | undefined;
  readonly attemptsUsed: number;
  /** Gate relancé après réparation. */
  readonly gateAfter?: GateResult | undefined;
  readonly rolledBack: boolean;
  readonly rollbackVerified: boolean;
  readonly cancelled: boolean;
  readonly error?: string | undefined;
}

const SUPPORTED_REASON: RepairFailureReason = 'VERIFICATION_FAILED';

/**
 * Réparation de référence : unique stratégie supportée = divergence de
 * contenu (VERIFICATION_FAILED) après une mutation réellement appliquée,
 * sur des artifacts CREATE/UPDATE uniquement (cas sûr : le contenu attendu
 * est entièrement connu et l'état sûr est restaurable par rollback).
 */
export function isRepairSupported(params: {
  readonly reason: RepairFailureReason;
  readonly fileChanges: readonly AgentArtifact[];
}): boolean {
  if (params.reason !== SUPPORTED_REASON) return false;
  if (params.fileChanges.length === 0) return false;
  return params.fileChanges.every((artifact) => {
    const payload = artifact.payload as { operation?: string; proposedContent?: unknown };
    return payload?.operation === 'CREATE' || payload?.operation === 'UPDATE';
  });
}

export class FileRepairService {
  constructor(private readonly mutationBridge: MutationBridge) {}

  /**
   * Safety checks AVANT toute action de réparation. Retourne la raison du
   * refus, ou null si toutes les conditions sont réunies.
   */
  public safetyCheck(params: {
    readonly plan: RepairPlan;
    readonly executionId: string;
    readonly tenantId: string;
    readonly projectId: string;
    readonly attempt: number;
    readonly fileChanges: readonly AgentArtifact[];
    readonly resolvedAgentCapabilities: readonly string[] | undefined;
  }): string | null {
    if (params.plan.executionId !== params.executionId) {
      return 'REPAIR_REFUSED: executionId du plan différent de l exécution';
    }
    if (params.plan.maxAttempts < 1 || params.attempt >= params.plan.maxAttempts) {
      return `REPAIR_REFUSED: limite d attempts atteinte (${params.attempt}/${params.plan.maxAttempts})`;
    }
    if (params.plan.allowedActions.length === 0 || !params.plan.allowedActions.includes('ROLLBACK_THEN_REAPPLY')) {
      return 'REPAIR_REFUSED: aucune action autorisée dans le plan';
    }
    if (params.plan.target.paths.length === 0 || params.plan.target.paths.some((p) => p.trim().length === 0)) {
      return 'REPAIR_REFUSED: cible non identifiée';
    }
    if (params.fileChanges.length === 0) {
      return 'REPAIR_REFUSED: aucun artifact valide à réappliquer';
    }
    for (const artifact of params.fileChanges) {
      const payload = artifact.payload as { filePath?: unknown; operation?: unknown; newPath?: unknown };
      if (!payload || typeof payload.filePath !== 'string' || payload.filePath.trim().length === 0) {
        return 'REPAIR_REFUSED: artifact invalide (filePath manquant)';
      }
      if (typeof payload.operation !== 'string' || !['CREATE', 'UPDATE', 'DELETE', 'RENAME', 'MOVE'].includes(payload.operation)) {
        return 'REPAIR_REFUSED: artifact invalide (opération inconnue)';
      }
    }
    if (!params.resolvedAgentCapabilities || !params.resolvedAgentCapabilities.includes('FILE_MUTATION')) {
      return 'REPAIR_REFUSED: capability FILE_MUTATION non autorisée pour l agent résolu';
    }
    return null;
  }

  /**
   * Exécute la réparation bornée. Retourne RepairOutcome — JAMAIS un succès
   * fabriqué : le verdict final dépend du Gate relancé (gateAfter).
   */
  public async execute(params: {
    readonly plan: RepairPlan;
    readonly context: RepairExecutionContext;
    readonly bridge: MutationBridge;
    readonly userRole?: string | undefined;
    readonly requestId?: string | undefined;
  }): Promise<RepairOutcome> {
    const { plan, context } = params;

    // 1. Restauration de l'état sûr via le single-writer (rollback réel É35).
    if (context.isAborted()) {
      return this.cancelledResult(plan, 0, false, 'cancellation avant restauration');
    }
    if (!context.transactionId) {
      return {
        performed: false,
        unsupported: 'REPAIR_UNSUPPORTED: aucune transaction à restaurer',
        attemptsUsed: 0,
        rolledBack: false,
        rollbackVerified: false,
        cancelled: false
      };
    }
    const rollback = context.transactionId
      ? params.bridge.rollbackTransaction({
          transactionId: context.transactionId,
          tenantId: context.tenantId,
          projectId: context.projectId,
          userRole: (context.userRole as never) ?? 'OWNER',
          requestId: context.requestId
        })
      : { success: false, restoredFiles: [] as readonly string[] };
    if (!rollback.success) {
      return {
        performed: true,
        attemptsUsed: 1,
        rolledBack: true,
        rollbackVerified: false,
        cancelled: false,
        error: `REPAIR_ROLLBACK_FAILED: ${'la restauration de l état sûr a échoué'}`
      };
    }

    // Vérification RÉELLE de la restauration (source observée).
    const restorationMismatches: string[] = [];
    for (const entry of context.beforeSnapshot) {
      const current = context.fileObserver.getFile(context.tenantId, context.projectId, entry.path);
      if (entry.existed && (current === null || current.content !== entry.content)) {
        restorationMismatches.push(entry.path);
      }
      if (!entry.existed && current !== null) {
        restorationMismatches.push(entry.path);
      }
    }
    if (restorationMismatches.length > 0) {
      return {
        performed: true,
        attemptsUsed: 1,
        rolledBack: true,
        rollbackVerified: false,
        cancelled: false,
        error: `REPAIR_RESTORE_NOT_VERIFIED: état restauré différent de l état initial — ${restorationMismatches.join(', ')}`
      };
    }

    // 2. Cancellation pendant la réparation → rollback réel conservé, aucune réapplication.
    if (context.isAborted()) {
      return {
        performed: true,
        attemptsUsed: 1,
        rolledBack: true,
        rollbackVerified: true,
        cancelled: true,
        error: 'REPAIR_CANCELLED: cancellation observée après restauration — aucune réapplication'
      };
    }

    // 3. Réapplication UNE fois via le single-writer (mêmes artifacts validés).
    const reapply = await params.bridge.applyArtifacts({
      artifacts: context.fileChanges,
      tenantId: context.tenantId,
      projectId: context.projectId,
      userRole: (context.userRole as never) ?? 'OWNER',
      requestId: context.requestId,
      dryRun: false
    });
    if (!reapply.success) {
      // La réapplication a échoué : l'état reste l'état restauré (sûr).
      return {
        performed: true,
        attemptsUsed: 1,
        rolledBack: true,
        rollbackVerified: true,
        cancelled: false,
        error: `REPAIR_REAPPLY_FAILED: ${reapply.error ?? 'mutation de réparation non exécutée'} — état sûr conservé`
      };
    }

    // 4. Re-Gate (MÊME gate que la première vérification).
    const gateAfter = evaluateFileMutationGate({
      executionId: context.executionId,
      tenantId: context.tenantId,
      projectId: context.projectId,
      fileChanges: context.fileChanges,
      beforeSnapshot: context.beforeSnapshot,
      fileObserver: context.fileObserver
    });

    // 5. Le verdict final appartient à l'appelant (gateAfter.passed ?).
    return {
      performed: true,
      attemptsUsed: 1,
      gateAfter,
      rolledBack: true,
      rollbackVerified: true,
      cancelled: false
    };
  }

  private cancelledResult(plan: RepairPlan, attemptsUsed: number, rolledBack: boolean, detail: string): RepairOutcome {
    return {
      performed: false,
      attemptsUsed,
      rolledBack,
      rollbackVerified: rolledBack,
      cancelled: true,
      error: `REPAIR_CANCELLED: ${detail} (plan ${plan.repairId})`
    };
  }
}
