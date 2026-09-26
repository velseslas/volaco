/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Atomic Mutation Execution Engine
 */

import { createHash } from 'node:crypto';
import type { IMutableFileSource } from '../filesystem/adapter.js';
import type {
  SingleMutation,
  StructuredDiff
} from '../types.js';
import { MutationExecutionError } from '../types.js';
import { computeStructuredDiff } from './diff.js';
import { validateMutationPreconditions } from './preconditions.js';

export interface ApplyMutationResult {
  readonly diff: StructuredDiff;
  readonly contentHashAfter: string | undefined;
}

/**
 * Calculates new file content for symbol, import, export, route, or component updates.
 */
function applyCodePatch(
  originalContent: string,
  mutation: SingleMutation
): string {
  const op = mutation.operation;

  // If full replacement content is specified directly
  if (op.content !== undefined) {
    return op.content;
  }

  // Targeted line slice replacement
  if (op.lineStart !== undefined && op.lineEnd !== undefined && op.replacement !== undefined) {
    const lines = originalContent.split('\n');
    const startIdx = Math.max(0, op.lineStart - 1);
    const endIdx = Math.min(lines.length, op.lineEnd);
    lines.splice(startIdx, endIdx - startIdx, op.replacement);
    return lines.join('\n');
  }

  // Targeted string / specifier replacement
  if (op.replacement !== undefined) {
    if (op.importSpecifier && originalContent.includes(op.importSpecifier)) {
      return originalContent.replace(op.importSpecifier, op.replacement);
    }
    if (op.symbolName && originalContent.includes(op.symbolName)) {
      return originalContent.replace(op.symbolName, op.replacement);
    }
  }

  return originalContent;
}

/**
 * Applies a single mutation atomically to the mutable file source (or dry-run simulated).
 */
export function executeSingleMutation(
  fileSource: IMutableFileSource,
  tenantId: string,
  projectId: string,
  mutation: SingleMutation,
  dryRun = false,
  currentGraphHash?: string | undefined,
  requestId?: string | undefined
): ApplyMutationResult {
  // 1. Verify preconditions
  validateMutationPreconditions(mutation, fileSource, tenantId, projectId, currentGraphHash, requestId);

  const path = mutation.operation.path;
  const currentFile = fileSource.getFile(tenantId, projectId, path);
  const beforeContent = currentFile ? currentFile.content : null;

  let afterContent: string | null = null;

  try {
    switch (mutation.kind) {
      case 'CREATE_FILE': {
        afterContent = mutation.operation.content ?? '';
        if (!dryRun) {
          fileSource.createFile(tenantId, projectId, path, afterContent);
        }
        break;
      }
      case 'UPDATE_FILE': {
        afterContent = mutation.operation.content ?? '';
        if (!dryRun) {
          fileSource.updateFile(tenantId, projectId, path, afterContent);
        }
        break;
      }
      case 'DELETE_FILE': {
        afterContent = null;
        if (!dryRun) {
          fileSource.deleteFile(tenantId, projectId, path);
        }
        break;
      }
      case 'RENAME_FILE': {
        const newPath = mutation.operation.newPath!;
        afterContent = beforeContent;
        if (!dryRun) {
          fileSource.renameFile(tenantId, projectId, path, newPath);
        }
        break;
      }
      case 'MOVE_FILE': {
        const newPath = mutation.operation.newPath!;
        afterContent = beforeContent;
        if (!dryRun) {
          fileSource.moveFile(tenantId, projectId, path, newPath);
        }
        break;
      }
      case 'UPDATE_SYMBOL':
      case 'UPDATE_IMPORT':
      case 'UPDATE_EXPORT':
      case 'UPDATE_ROUTE':
      case 'UPDATE_COMPONENT': {
        if (!beforeContent) {
          throw new MutationExecutionError(
            `Fichier cible '${path}' introuvable pour la mutation de code '${mutation.kind}'`,
            { mutationId: mutation.mutationId, path },
            requestId
          );
        }
        afterContent = applyCodePatch(beforeContent, mutation);
        if (!dryRun) {
          fileSource.updateFile(tenantId, projectId, path, afterContent);
        }
        break;
      }
      default:
        const unknownKind = (mutation as { readonly kind: string }).kind;
        throw new MutationExecutionError(`Type de mutation inconnu : ${unknownKind}`, {}, requestId);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name.startsWith('Mutation')) {
      throw err;
    }
    throw new MutationExecutionError(
      `Échec d'exécution de la mutation '${mutation.mutationId}' sur '${path}': ${err instanceof Error ? err.message : String(err)}`,
      { mutationId: mutation.mutationId, path, error: String(err) },
      requestId
    );
  }

  const diff = computeStructuredDiff(path, mutation.kind, beforeContent, afterContent);
  const contentHashAfter = afterContent !== null
    ? createHash('sha256').update(afterContent).digest('hex')
    : undefined;

  return {
    diff,
    contentHashAfter
  };
}
