/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Autonomous Recovery Engine & Failure Taxonomy
 */

import { logger } from '../../../logger.js';
import type { Role } from '../../../identity/permissions.js';
import type { MutationOrchestratorService } from '../../mutation-orchestrator/service.js';
import {
  type RecoveryErrorKind,
  RecoveryExhaustedError,
  GateRejectedError,
  AgentCapabilityError
} from '../types.js';

export type RecoveryAction = 'RETRY' | 'REPAIR' | 'ROLLBACK' | 'REFRESH_CONTEXT' | 'FAIL';

export interface RecoveryResolution {
  readonly action: RecoveryAction;
  readonly shouldRetry: boolean;
  readonly errorKind: RecoveryErrorKind;
  readonly message: string;
  readonly rolledBack?: boolean | undefined;
}

export interface RecoveryOptions {
  readonly error: unknown;
  readonly errorKind?: RecoveryErrorKind | undefined;
  readonly attempt: number;
  readonly transactionId?: string | undefined;
  readonly userRole?: Role | undefined;
  readonly tenantId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly requestId?: string | undefined;
}

export class RecoveryEngine {
  constructor(
    private readonly mutationService?: MutationOrchestratorService | undefined,
    public readonly maxRetries: number = 3,
    public readonly maxRepairAttempts: number = 3
  ) {}

  /**
   * Classifies any runtime error into one of the 8 standard recovery error kinds.
   */
  public classifyError(err: unknown): RecoveryErrorKind {
    if (!err) {
      return 'TRANSIENT_ERROR';
    }

    const message = err instanceof Error ? err.message : String(err);
    const errName = (err as { name?: string }).name ?? '';

    if (err instanceof GateRejectedError || message.includes('IMPACT_GATE') || message.includes('GateRejectedError') || message.includes('rayon d explosion') || message.includes('blast radius')) {
      return 'IMPACT_FAILURE';
    }

    if (message.includes('stale') || message.includes('StalePlanError') || message.includes('baseGraphHash') || message.includes('graph hash mismatch')) {
      return 'STALE_CONTEXT';
    }

    if (message.includes('post-mutation') || message.includes('verification') || message.includes('typecheck failed') || message.includes('test failed') || message.includes('syntax error')) {
      return 'POST_VALIDATION_FAILURE';
    }

    if (message.includes('rollback') || message.includes('mutation failed') || message.includes('MutationExecutionError') || message.includes('precondition failed')) {
      return 'MUTATION_FAILURE';
    }

    if (err instanceof AgentCapabilityError || message.includes('AgentCapabilityError') || message.includes('ToolExecutionError') || message.includes('outil')) {
      return 'TOOL_ERROR';
    }

    if (errName === 'ValidationError' || message.includes('validation') || message.includes('schema') || message.includes('requis') || message.includes('invalide')) {
      return 'VALIDATION_ERROR';
    }

    if (message.includes('model') || message.includes('hallucination') || message.includes('token limit') || message.includes('LLM') || message.includes('format')) {
      return 'MODEL_ERROR';
    }

    if (message.includes('timeout') || message.includes('network') || message.includes('EAI_AGAIN') || message.includes('ECONNRESET')) {
      return 'TRANSIENT_ERROR';
    }

    return 'TRANSIENT_ERROR';
  }

  /**
   * Handles an error according to the recovery taxonomy, managing retries, repairs, and rollbacks.
   */
  public async handleError(options: RecoveryOptions): Promise<RecoveryResolution> {
    const { error, attempt, transactionId, userRole = 'ENGINEER', requestId } = options;
    const kind = options.errorKind ?? this.classifyError(error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    switch (kind) {
      case 'TRANSIENT_ERROR':
      case 'MODEL_ERROR':
      case 'TOOL_ERROR': {
        if (attempt >= this.maxRetries) {
          if (transactionId && this.mutationService) {
            try {
              await this.mutationService.rollback(transactionId, userRole, requestId);
            } catch (err) {
              logger.warn('Erreur secondaire lors du rollback de récupération', {
                component: 'recovery-engine',
                transactionId,
                err: err instanceof Error ? err.message : String(err)
              });
            }
          }
          throw new RecoveryExhaustedError(attempt, kind, errorMessage, requestId);
        }
        return {
          action: 'RETRY',
          shouldRetry: true,
          errorKind: kind,
          message: `Tentative de reprise (${attempt}/${this.maxRetries}) pour ${kind} : ${errorMessage}`
        };
      }

      case 'VALIDATION_ERROR': {
        if (attempt >= this.maxRetries) {
          throw new RecoveryExhaustedError(attempt, kind, errorMessage, requestId);
        }
        return {
          action: 'RETRY',
          shouldRetry: true,
          errorKind: kind,
          message: `Erreur de validation. Correction du plan requise (${attempt}/${this.maxRetries})`
        };
      }

      case 'STALE_CONTEXT': {
        if (attempt >= this.maxRetries) {
          throw new RecoveryExhaustedError(attempt, kind, errorMessage, requestId);
        }
        return {
          action: 'REFRESH_CONTEXT',
          shouldRetry: true,
          errorKind: kind,
          message: 'Contexte ou graphe semantique perime. Rafraichissement necessaire.'
        };
      }

      case 'IMPACT_FAILURE': {
        // Impact failures are not automatically retried without re-scoping
        return {
          action: 'FAIL',
          shouldRetry: false,
          errorKind: kind,
          message: `Operation bloquee par l Impact Gate : ${errorMessage}`
        };
      }

      case 'MUTATION_FAILURE': {
        let rolledBack = false;
        if (transactionId && this.mutationService) {
          try {
            await this.mutationService.rollback(transactionId, userRole, requestId);
            rolledBack = true;
          } catch {
            rolledBack = false;
          }
        }
        return {
          action: 'ROLLBACK',
          shouldRetry: false,
          errorKind: kind,
          message: `Echec de la mutation. Rollback declenche (effectue=${rolledBack}) : ${errorMessage}`,
          rolledBack
        };
      }

      case 'POST_VALIDATION_FAILURE': {
        if (attempt < this.maxRepairAttempts) {
          return {
            action: 'REPAIR',
            shouldRetry: true,
            errorKind: kind,
            message: `Tentative de reparation autonome (${attempt}/${this.maxRepairAttempts})`
          };
        }

        // Repair attempts exhausted -> Rollback
        let rolledBack = false;
        if (transactionId && this.mutationService) {
          try {
            await this.mutationService.rollback(transactionId, userRole, requestId);
            rolledBack = true;
          } catch {
            rolledBack = false;
          }
        }
        throw new RecoveryExhaustedError(
          attempt,
          kind,
          `Echec de validation post-mutation et reparations epuisees. Rollback applique (effectue=${rolledBack}). Erreur: ${errorMessage}`,
          requestId
        );
      }

      default: {
        return {
          action: 'FAIL',
          shouldRetry: false,
          errorKind: kind,
          message: errorMessage
        };
      }
    }
  }
}
