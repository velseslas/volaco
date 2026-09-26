/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Transactional File Snapshot & Restoration Engine
 */

import { createHash, randomUUID } from 'node:crypto';
import type { IMutableFileSource } from './adapter.js';
import type { FileSnapshotEntry, TransactionSnapshot } from '../types.js';
import { MutationRollbackError } from '../types.js';
import { deepFreeze } from '../../context/engine/base.js';

/**
 * Creates a complete transactional snapshot of specified files prior to mutation.
 */
export function createTransactionSnapshot(
  fileSource: IMutableFileSource,
  tenantId: string,
  projectId: string,
  affectedFiles: readonly string[]
): TransactionSnapshot {
  const originalTreeHash = fileSource.computeTreeHash(tenantId, projectId);
  const fileEntries: Record<string, FileSnapshotEntry> = {};

  // Deduplicate file paths
  const uniquePaths = Array.from(new Set(affectedFiles)).sort();

  for (const path of uniquePaths) {
    const file = fileSource.getFile(tenantId, projectId, path);
    if (file) {
      fileEntries[path] = {
        path,
        exists: true,
        content: file.content,
        hash: file.hash
      };
    } else {
      fileEntries[path] = {
        path,
        exists: false
      };
    }
  }

  const snapshotId = `snap-${randomUUID()}`;
  const createdAt = new Date().toISOString();

  const snapshot: TransactionSnapshot = {
    snapshotId,
    tenantId,
    projectId,
    createdAt,
    files: fileEntries,
    originalTreeHash
  };

  return deepFreeze(snapshot);
}

/**
 * Restores all files in the snapshot back to their exact pre-mutation state.
 * Throws MutationRollbackError if the restored treeHash doesn't match the original.
 */
export function restoreTransactionSnapshot(
  fileSource: IMutableFileSource,
  snapshot: TransactionSnapshot
): readonly string[] {
  const restoredPaths: string[] = [];

  for (const [path, entry] of Object.entries(snapshot.files)) {
    if (entry.exists && entry.content !== undefined) {
      // File originally existed: restore original content
      const current = fileSource.getFile(snapshot.tenantId, snapshot.projectId, path);
      if (current) {
        fileSource.updateFile(snapshot.tenantId, snapshot.projectId, path, entry.content);
      } else {
        fileSource.createFile(snapshot.tenantId, snapshot.projectId, path, entry.content);
      }
      restoredPaths.push(path);
    } else if (!entry.exists) {
      // File did not originally exist: delete if it was created
      const current = fileSource.getFile(snapshot.tenantId, snapshot.projectId, path);
      if (current) {
        fileSource.deleteFile(snapshot.tenantId, snapshot.projectId, path);
        restoredPaths.push(path);
      }
    }
  }

  // Re-verify that project treeHash is identical to original
  const currentTreeHash = fileSource.computeTreeHash(snapshot.tenantId, snapshot.projectId);
  if (currentTreeHash !== snapshot.originalTreeHash) {
    throw new MutationRollbackError(
      `Rollback verification failed: expected treeHash '${snapshot.originalTreeHash}', but got '${currentTreeHash}'`,
      {
        tenantId: snapshot.tenantId,
        projectId: snapshot.projectId,
        expectedTreeHash: snapshot.originalTreeHash,
        actualTreeHash: currentTreeHash
      }
    );
  }

  return restoredPaths.sort();
}
