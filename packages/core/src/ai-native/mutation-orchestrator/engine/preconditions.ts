/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Preconditions Engine: Concurrency Detection & Invariant Verification
 */

import { createHash } from 'node:crypto';
import type { IMutableFileSource } from '../filesystem/adapter.js';
import type { MutationPrecondition, SingleMutation } from '../types.js';
import {
  ConcurrentModificationError,
  MutationPreconditionError,
  MutationConflictError
} from '../types.js';

/**
 * Validates all preconditions of a single mutation against the current file source and graph.
 */
export function validateMutationPreconditions(
  mutation: SingleMutation,
  fileSource: IMutableFileSource,
  tenantId: string,
  projectId: string,
  currentGraphHash?: string | undefined,
  requestId?: string | undefined
): void {
  const filePath = mutation.operation.path;
  const currentFile = fileSource.getFile(tenantId, projectId, filePath);

  // 1. Automatic Concurrency Check: If contentHashBefore is specified, verify current file hash matches
  if (mutation.contentHashBefore !== undefined) {
    if (!currentFile) {
      throw new ConcurrentModificationError(
        `Conflit de concurrence: le fichier '${filePath}' attendait le hash '${mutation.contentHashBefore}', mais le fichier a été supprimé`,
        { filePath, expectedHash: mutation.contentHashBefore, actual: 'FILE_MISSING' },
        requestId
      );
    }
    const currentHash = currentFile.hash ?? createHash('sha256').update(currentFile.content).digest('hex');
    if (currentHash !== mutation.contentHashBefore) {
      throw new ConcurrentModificationError(
        `Conflit de concurrence détecté: le fichier '${filePath}' a été modifié en dehors de la transaction (attendu: '${mutation.contentHashBefore}', actuel: '${currentHash}')`,
        { filePath, expectedHash: mutation.contentHashBefore, actualHash: currentHash },
        requestId
      );
    }
  }

  // 2. Automatic File Existence check based on Kind
  if (mutation.kind === 'CREATE_FILE') {
    if (currentFile) {
      throw new MutationConflictError(
        `Impossible de créer le fichier '${filePath}' : il existe déjà`,
        { filePath },
        requestId
      );
    }
  } else if (
    mutation.kind === 'UPDATE_FILE' ||
    mutation.kind === 'DELETE_FILE' ||
    mutation.kind === 'RENAME_FILE' ||
    mutation.kind === 'MOVE_FILE' ||
    mutation.kind === 'UPDATE_SYMBOL' ||
    mutation.kind === 'UPDATE_IMPORT' ||
    mutation.kind === 'UPDATE_EXPORT' ||
    mutation.kind === 'UPDATE_ROUTE' ||
    mutation.kind === 'UPDATE_COMPONENT'
  ) {
    if (!currentFile) {
      throw new MutationPreconditionError(
        `Précondition échouée: le fichier cible '${filePath}' est introuvable pour l'opération ${mutation.kind}`,
        { filePath, kind: mutation.kind },
        requestId
      );
    }
  }

  // 3. Explicit Declared Preconditions
  for (const pc of mutation.preconditions) {
    evaluatePrecondition(pc, currentFile, currentGraphHash, requestId);
  }
}

function evaluatePrecondition(
  pc: MutationPrecondition,
  currentFile: { content: string; hash?: string | undefined } | null,
  currentGraphHash?: string | undefined,
  requestId?: string | undefined
): void {
  switch (pc.kind) {
    case 'FILE_EXISTS': {
      if (!currentFile) {
        throw new MutationPreconditionError(
          `Précondition échouée (FILE_EXISTS) : le fichier '${pc.target}' n'existe pas`,
          { precondition: pc },
          requestId
        );
      }
      break;
    }
    case 'FILE_NOT_EXISTS': {
      if (currentFile) {
        throw new MutationConflictError(
          `Précondition échouée (FILE_NOT_EXISTS) : le fichier '${pc.target}' existe déjà`,
          { precondition: pc },
          requestId
        );
      }
      break;
    }
    case 'CONTENT_HASH_MATCHES': {
      if (!currentFile) {
        throw new MutationPreconditionError(
          `Précondition échouée (CONTENT_HASH_MATCHES) : le fichier '${pc.target}' est introuvable`,
          { precondition: pc },
          requestId
        );
      }
      const actualHash = currentFile.hash ?? createHash('sha256').update(currentFile.content).digest('hex');
      if (pc.expectedValue && actualHash !== pc.expectedValue) {
        throw new ConcurrentModificationError(
          `Précondition échouée (CONTENT_HASH_MATCHES) : attendu '${pc.expectedValue}', obtenu '${actualHash}'`,
          { precondition: pc, actualHash },
          requestId
        );
      }
      break;
    }
    case 'GRAPH_HASH_MATCHES': {
      if (pc.expectedValue && currentGraphHash && currentGraphHash !== pc.expectedValue) {
        throw new MutationPreconditionError(
          `Précondition échouée (GRAPH_HASH_MATCHES) : le graphHash courant '${currentGraphHash}' ne correspond pas à '${pc.expectedValue}'`,
          { precondition: pc, currentGraphHash },
          requestId
        );
      }
      break;
    }
    case 'SYMBOL_EXISTS': {
      if (!currentFile) {
        throw new MutationPreconditionError(
          `Précondition échouée (SYMBOL_EXISTS) : fichier '${pc.target}' introuvable`,
          { precondition: pc },
          requestId
        );
      }
      if (pc.expectedValue && !currentFile.content.includes(pc.expectedValue)) {
        throw new MutationPreconditionError(
          `Précondition échouée (SYMBOL_EXISTS) : le symbole '${pc.expectedValue}' est introuvable dans '${pc.target}'`,
          { precondition: pc },
          requestId
        );
      }
      break;
    }
    case 'SYMBOL_NOT_EXISTS': {
      if (currentFile && pc.expectedValue && currentFile.content.includes(pc.expectedValue)) {
        throw new MutationPreconditionError(
          `Précondition échouée (SYMBOL_NOT_EXISTS) : le symbole '${pc.expectedValue}' existe déjà dans '${pc.target}'`,
          { precondition: pc },
          requestId
        );
      }
      break;
    }
    case 'IMPORT_EXISTS': {
      if (!currentFile) {
        throw new MutationPreconditionError(
          `Précondition échouée (IMPORT_EXISTS) : fichier '${pc.target}' introuvable`,
          { precondition: pc },
          requestId
        );
      }
      if (pc.expectedValue && !currentFile.content.includes(pc.expectedValue)) {
        throw new MutationPreconditionError(
          `Précondition échouée (IMPORT_EXISTS) : l'import '${pc.expectedValue}' est introuvable dans '${pc.target}'`,
          { precondition: pc },
          requestId
        );
      }
      break;
    }
    default:
      break;
  }
}
