/**
 * VibeCode Core - Persistence légère sur disque (fichiers JSON)
 *
 * PATCH 05 - Persistence Guard
 * - écritures temporaires uniques
 * - fsync du fichier temporaire avant remplacement
 * - nettoyage du fichier temporaire en cas d'échec
 * - journalisation explicite des erreurs de persistance
 * - mode strict opt-in via VOLACO_PERSISTENCE_STRICT=1
 *
 * IMPORTANT : ce module reste une persistance mono-instance sur disque.
 * Il ne remplace pas une vraie base de données distribuée.
 */
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export function dataFilePath(name: string): string {
  const dir = process.env.VOLACO_DATA_DIR || join(process.cwd(), '.volaco-data');
  return join(dir, `${name}.json`);
}

function persistenceStrict(): boolean {
  return process.env.VOLACO_PERSISTENCE_STRICT === '1';
}

function reportPersistenceError(operation: string, filePath: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[VOLACO:PERSISTENCE] ${operation} failed for ${filePath}: ${message}`);
  if (persistenceStrict()) {
    throw error instanceof Error ? error : new Error(message);
  }
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    const raw = readFileSync(filePath, 'utf8');
    if (!raw || raw.trim().length === 0) return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    reportPersistenceError('read', filePath, error);
    return fallback;
  }
}

export function writeJsonFileSync(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
    const fd = openSync(tmpPath, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // Preserve the original persistence error.
    }
    reportPersistenceError('write', filePath, error);
  }
}
