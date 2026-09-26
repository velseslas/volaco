/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Rollback Orchestration Engine
 */

import type { IMutableFileSource } from '../filesystem/adapter.js';
import type { MutationRollbackResult, TransactionSnapshot } from '../types.js';
import { restoreTransactionSnapshot } from '../filesystem/snapshot.js';

/**
 * Reverts an in-flight or failed mutation transaction back to its exact pre-mutation state.
 */
export function rollbackTransaction(
  fileSource: IMutableFileSource,
  snapshot: TransactionSnapshot,
  transactionId: string
): MutationRollbackResult {
  const startTime = Date.now();
  const restoredFiles = restoreTransactionSnapshot(fileSource, snapshot);
  const restoredTreeHash = fileSource.computeTreeHash(snapshot.tenantId, snapshot.projectId);
  const durationMs = Math.max(0, Date.now() - startTime);

  return {
    transactionId,
    success: true,
    restoredFiles,
    restoredTreeHash,
    durationMs
  };
}
