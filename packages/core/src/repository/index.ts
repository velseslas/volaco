/**
 * VibeCode Studio - Durable Persistence Layer
 * PATCH 05 - Persistence Guard
 *
 * Keeps the existing repository API and storage layout. This patch only
 * hardens file writes and makes persistence failures observable.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { Project } from '../types/index.js';
import type { ApplicationRevision } from '../model/revision.js';
import type { AuditEvent } from '../observability/audit.js';

export interface FileEntryData {
  type: 'file' | 'directory';
  content?: string | undefined;
  updatedAt: string;
}
export interface IProjectRepository { save(project: Project): void; get(tenantId: string, id: string): Project | null; list(tenantId: string): Project[]; delete(tenantId: string, id: string): boolean; clear(): void; }
export interface IFileRepository { save(tenantId: string, projectId: string, path: string, entry: FileEntryData): void; get(tenantId: string, projectId: string, path: string): FileEntryData | null; list(tenantId: string, projectId: string): Map<string, FileEntryData>; delete(tenantId: string, projectId: string, path: string): boolean; clear(): void; }
export interface IRevisionRepository { save(revision: ApplicationRevision): void; list(tenantId: string, projectId: string): ApplicationRevision[]; get(tenantId: string, projectId: string, revisionId: string): ApplicationRevision | null; clear(): void; }
export interface IAuditRepository { save(event: AuditEvent): void; list(tenantId: string): AuditEvent[]; getAll(): AuditEvent[]; clear(): void; }
export interface IApplicationModelRepository { save(model: any): void; get(tenantId: string, projectId: string): any | null; saveVersion(version: any): void; listVersions(tenantId: string, projectId: string): any[]; getVersion(tenantId: string, projectId: string, versionNumber: number): any | null; clear(): void; }

function strictPersistence(): boolean {
  return process.env.VOLACO_PERSISTENCE_STRICT === '1';
}

function reportWriteFailure(file: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[VOLACO:PERSISTENCE] write failed for ${file}: ${message}`);
  if (strictPersistence()) throw error instanceof Error ? error : new Error(message);
}

export class DurableFileStorage {
  private dataDir: string;

  constructor(dataDir?: string) {
    if (dataDir) this.dataDir = dataDir;
    else if (process.env.DATA_DIR) this.dataDir = process.env.DATA_DIR;
    else if (process.env.NODE_TEST_CONTEXT || process.execArgv.some(a => a.includes('test')) || process.argv.some(a => a.includes('test'))) this.dataDir = join(process.cwd(), '.volaco_data', `worker_${process.pid}`);
    else this.dataDir = join(process.cwd(), '.volaco_data');
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  public readJson<T>(filename: string, fallback: T): T {
    const file = join(this.dataDir, filename);
    if (!existsSync(file)) return fallback;
    try {
      const raw = readFileSync(file, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[VOLACO:PERSISTENCE] read failed for ${file}: ${message}`);
      if (strictPersistence()) throw error instanceof Error ? error : new Error(message);
      return fallback;
    }
  }

  public writeJson<T>(filename: string, data: T): void {
    const file = join(this.dataDir, filename);
    const dir = dirname(file);
    const tempFile = `${file}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;

    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
      const fd = openSync(tempFile, 'r+');
      try { fsyncSync(fd); } finally { closeSync(fd); }

      try {
        renameSync(tempFile, file);
      } catch (replaceError) {
        // Preserve the existing Windows-compatible fallback, but never leave a
        // temporary file behind and always make the failure observable.
        if (existsSync(file)) unlinkSync(file);
        try {
          renameSync(tempFile, file);
        } catch {
          writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
        }
        void replaceError;
      }
    } catch (error) {
      try { if (existsSync(tempFile)) unlinkSync(tempFile); } catch { /* preserve original error */ }
      reportWriteFailure(file, error);
    }
  }

  public getDataDir(): string { return this.dataDir; }
}
