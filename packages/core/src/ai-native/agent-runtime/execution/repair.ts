/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Autonomous Repair Loop & Failure Recovery
 */

import { logger } from '../../../logger.js';
import { RepairExhaustedError } from '../types.js';
import type { MutationOrchestratorService } from '../../mutation-orchestrator/service.js';
import type { BudgetTracker } from '../reasoning/budget.js';
import type { VerificationResult } from './verification.js';
import type { Role } from '../../../identity/permissions.js';

export class RepairEngine {
  constructor(private readonly mutationService?: MutationOrchestratorService | undefined) {}

  /**
   * Attempts to autonomously repair post-mutation verification errors.
   */
  public async attemptRepair(
    verification: VerificationResult,
    transactionId: string | undefined,
    budgetTracker: BudgetTracker,
    userRole: Role = 'ENGINEER'
  ): Promise<{ repaired: boolean; error?: string | undefined }> {
    try {
      budgetTracker.recordRepairAttempt();
    } catch (err) {
      // Max repair attempts reached -> rollback and fail
      if (transactionId && this.mutationService) {
        try {
          await this.mutationService.rollback(transactionId, userRole);
        } catch (err) {
          logger.warn('Erreur secondaire lors du rollback de réparation', {
            component: 'repair-engine',
            transactionId,
            err: err instanceof Error ? err.message : String(err)
          });
        }
      }
      throw err;
    }

    const firstError = verification.errors[0] ?? 'Erreur inconnue';

    // If no mutation service or repair fails, perform rollback
    if (!this.mutationService || !transactionId) {
      return { repaired: false, error: firstError };
    }

    // In this iteration, if verification has errors and cannot be automatically fixed,
    // we trigger rollback
    try {
      await this.mutationService.rollback(transactionId, userRole);
      return {
        repaired: false,
        error: `Echec de validation post-mutation. Rollback execute avec succes. Erreur: ${firstError}`
      };
    } catch (rbErr) {
      const rbMsg = rbErr instanceof Error ? rbErr.message : String(rbErr);
      return {
        repaired: false,
        error: `Echec de validation et erreur de rollback : ${rbMsg}`
      };
    }
  }
}
