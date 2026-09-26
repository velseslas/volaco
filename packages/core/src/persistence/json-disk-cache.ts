/**
 * VibeCode Core - Couche de persistance (ÉTAPE 3)
 *
 * Depuis l'étape 3, le backend par défaut est SQLite (node:sqlite, intégré à
 * Node 24) via `sqlite-backend.ts` : chaque couple (nom de document, JSON)
 * devient une ligne de la table `documents`. Les APIs `dataFilePath` /
 * `readJsonFile` / `writeJsonFileSync` sont INCHANGÉES pour les stores —
 * aucune route ni store n'a changé.
 *
 * - Migration transparente : un document absent de la base mais présent en
 *   fichier JSON hérité (.volaco-data/*.json) est importé au premier accès.
 * - Repli : `VOLACO_PERSISTENCE=json` force l'ancien comportement fichiers
 *   (utile si node:sqlite est indisponible). Écritures atomiques conservées
 *   dans ce mode (tmp unique + fsync + rename).
 *
 * IMPORTANT : même en SQLite, cette persistance reste mono-instance.
 * Elle ne remplace pas une base distribuée (CDC §38 — PostgreSQL viendra
 * quand le scale le justifiera).
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
import { documentKeyFromPath, isSqliteAvailable, readDocument, writeDocument } from './sqlite-backend.js';

export function dataFilePath(name: string): string {
  const dir = process.env.VOLACO_DATA_DIR || join(process.cwd(), '.volaco-data');
  return join(dir, `${name}.json`);
}

function persistenceStrict(): boolean {
  return process.env.VOLACO_PERSISTENCE_STRICT === '1';
}

function legacyFilesMode(): boolean {
  return process.env.VOLACO_PERSISTENCE === 'json';
}

function reportPersistenceError(operation: string, filePath: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[VOLACO:PERSISTENCE] ${operation} failed for ${filePath}: ${message}`);
  if (persistenceStrict()) {
    throw error instanceof Error ? error : new Error(message);
  }
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  // Backend SQLite (par défaut) — avec migration transparente des fichiers hérités
  if (!legacyFilesMode() && isSqliteAvailable()) {
    const key = documentKeyFromPath(filePath);
    const content = readDocument(key);
    if (content !== null) {
      try {
        return JSON.parse(content) as T;
      } catch (error) {
        reportPersistenceError('read', filePath, error);
        return fallback;
      }
    }
    // Migration : fichier JSON hérité existant -> import en base
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf8');
        if (raw && raw.trim().length > 0) {
          writeDocument(key, raw);
          return JSON.parse(raw) as T;
        }
      } catch (error) {
        reportPersistenceError('migrate', filePath, error);
        return fallback;
      }
    }
    return fallback;
  }

  // Backend fichiers JSON (hérité / VOLACO_PERSISTENCE=json)
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
  // Backend SQLite (par défaut)
  if (!legacyFilesMode() && isSqliteAvailable()) {
    const key = documentKeyFromPath(filePath);
    const written = writeDocument(key, JSON.stringify(data));
    if (written) return;
    // SQLite a échoué au moment de l'écriture -> repli fichiers ci-dessous
  }

  // Backend fichiers JSON (hérité / repli)
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
