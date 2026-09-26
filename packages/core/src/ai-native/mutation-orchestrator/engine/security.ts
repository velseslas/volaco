/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Mutation Security Engine: Path Traversal & Secret File Protection
 */

import { MutationSecurityError } from '../types.js';

const PROHIBITED_FILE_PATTERNS: readonly RegExp[] = [
  /^.env(..+)?$/i,
  /.pem$/i,
  /.key$/i,
  /.crt$/i,
  /.cert$/i,
  /^id_rsa.*$/i,
  /.*secret.*/i,
  /.*credential.*/i,
  /.*password.*/i
];

/**
 * Validates that a file path is safe for mutation.
 * Rejects path traversal and secret/credential files.
 */
export function assertSafeMutationPath(filePath: string, requestId?: string): void {
  if (!filePath || typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new MutationSecurityError('Chemin de fichier manquant ou vide pour la mutation', { filePath }, requestId);
  }

  // 1. Path traversal detection
  const normalized = filePath.replace(/\\/g, '/').trim();
  const parts = normalized.split('/');

  for (const part of parts) {
    if (part === '..' || part === '.') {
      throw new MutationSecurityError(
        `Tentative de Path Traversal ('${part}') interdite pour le chemin : ${filePath}`,
        { filePath },
        requestId
      );
    }
    if (part.includes('\0')) {
      throw new MutationSecurityError(
        'Caractère nul interdit dans le chemin de fichier',
        { filePath },
        requestId
      );
    }
  }

  // Absolute path checks (e.g. C:/ or /)
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/')) {
    throw new MutationSecurityError(
      `Chemin absolu interdit pour la mutation : ${filePath}`,
      { filePath },
      requestId
    );
  }

  // 2. Secret & credential file blacklist
  const basename = parts[parts.length - 1] ?? '';
  for (const pattern of PROHIBITED_FILE_PATTERNS) {
    if (pattern.test(basename)) {
      throw new MutationSecurityError(
        `Modification d'un fichier sensible ou secret strictement interdite : ${filePath}`,
        { filePath, pattern: pattern.source },
        requestId
      );
    }
  }
}

/**
 * Asserts that multiple paths are all safe for mutation.
 */
export function assertSafeMutationPaths(filePaths: readonly string[], requestId?: string): void {
  for (const path of filePaths) {
    assertSafeMutationPath(path, requestId);
  }
}
