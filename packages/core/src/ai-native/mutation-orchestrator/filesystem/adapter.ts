/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Mutable File Source Interface & FileStore Adapter
 */

import { createHash } from 'node:crypto';
import type { IReadOnlyFileSource } from '../../understanding/types.js';
import type { FileStore } from '../../../file-explorer/store.js';
import { sanitizePath } from '../../../file-explorer/store.js';

export interface IMutableFileSource extends IReadOnlyFileSource {
  computeTreeHash(tenantId: string, projectId: string): string;
  createFile(tenantId: string, projectId: string, filePath: string, content: string): void;
  updateFile(tenantId: string, projectId: string, filePath: string, content: string): void;
  deleteFile(tenantId: string, projectId: string, filePath: string): boolean;
  renameFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void;
  moveFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void;
  cloneState(tenantId: string, projectId: string): Record<string, string>;
}

/**
 * Adapter exposing FileStore as an IMutableFileSource.
 */
export class FileStoreAdapter implements IMutableFileSource {
  constructor(private readonly fileStore: FileStore) {}

  public getFile(tenantId: string, projectId: string, filePath: string) {
    const f = this.fileStore.getFile(tenantId, projectId, filePath);
    if (!f) return null;
    if (f.hash !== undefined) {
      return {
        path: f.path,
        name: f.name,
        content: f.content,
        sizeBytes: f.sizeBytes,
        hash: f.hash,
        updatedAt: f.updatedAt
      };
    }
    return {
      path: f.path,
      name: f.name,
      content: f.content,
      sizeBytes: f.sizeBytes,
      updatedAt: f.updatedAt
    };
  }

  public getAllProjectFiles(tenantId: string, projectId: string): Record<string, string> {
    return this.fileStore.getAllProjectFiles(tenantId, projectId);
  }

  public computeTreeHash(tenantId: string, projectId: string): string {
    return this.fileStore.computeTreeHash(tenantId, projectId);
  }

  public createFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    const clean = sanitizePath(filePath);
    this.fileStore.createNode(tenantId, projectId, clean, 'file', content);
  }

  public updateFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    const clean = sanitizePath(filePath);
    this.fileStore.saveFile(tenantId, projectId, clean, content);
  }

  public deleteFile(tenantId: string, projectId: string, filePath: string): boolean {
    const clean = sanitizePath(filePath);
    return this.fileStore.deleteNode(tenantId, projectId, clean);
  }

  public renameFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void {
    const cleanOld = sanitizePath(oldPath);
    const cleanNew = sanitizePath(newPath);
    this.fileStore.renameNode(tenantId, projectId, cleanOld, cleanNew);
  }

  public moveFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void {
    const cleanOld = sanitizePath(oldPath);
    const cleanNew = sanitizePath(newPath);
    this.fileStore.moveNode(tenantId, projectId, cleanOld, cleanNew);
  }

  public cloneState(tenantId: string, projectId: string): Record<string, string> {
    return { ...this.fileStore.getAllProjectFiles(tenantId, projectId) };
  }
}

/**
 * Standalone in-memory mutable file source for isolated testing and verification.
 */
export class InMemoryMutableFileSource implements IMutableFileSource {
  private readonly files = new Map<string, Record<string, string>>();

  constructor(initialFiles?: Record<string, Record<string, string>>) {
    if (initialFiles) {
      for (const [key, map] of Object.entries(initialFiles)) {
        this.files.set(key, { ...map });
      }
    }
  }

  private key(tenantId: string, projectId: string): string {
    return `${tenantId}:${projectId}`;
  }

  private getMap(tenantId: string, projectId: string): Record<string, string> {
    const k = this.key(tenantId, projectId);
    let map = this.files.get(k);
    if (!map) {
      map = {};
      this.files.set(k, map);
    }
    return map;
  }

  public getFile(tenantId: string, projectId: string, filePath: string) {
    const map = this.getMap(tenantId, projectId);
    const clean = sanitizePath(filePath);
    const content = map[clean];
    if (content === undefined) return null;
    return {
      path: clean,
      name: clean.split('/').pop() ?? clean,
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      hash: createHash('sha256').update(content).digest('hex'),
      updatedAt: new Date()
    };
  }

  public getAllProjectFiles(tenantId: string, projectId: string): Record<string, string> {
    return { ...this.getMap(tenantId, projectId) };
  }

  public computeTreeHash(tenantId: string, projectId: string): string {
    const map = this.getMap(tenantId, projectId);
    const entries = Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => `${path}:${createHash('sha256').update(content).digest('hex')}`);
    return createHash('sha256').update(entries.join('\n')).digest('hex');
  }

  public createFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    const map = this.getMap(tenantId, projectId);
    const clean = sanitizePath(filePath);
    map[clean] = content;
  }

  public updateFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    const map = this.getMap(tenantId, projectId);
    const clean = sanitizePath(filePath);
    map[clean] = content;
  }

  public deleteFile(tenantId: string, projectId: string, filePath: string): boolean {
    const map = this.getMap(tenantId, projectId);
    const clean = sanitizePath(filePath);
    if (map[clean] !== undefined) {
      delete map[clean];
      return true;
    }
    return false;
  }

  public renameFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void {
    const map = this.getMap(tenantId, projectId);
    const cleanOld = sanitizePath(oldPath);
    const cleanNew = sanitizePath(newPath);
    const content = map[cleanOld];
    if (content !== undefined) {
      delete map[cleanOld];
      map[cleanNew] = content;
    }
  }

  public moveFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void {
    this.renameFile(tenantId, projectId, oldPath, newPath);
  }

  public cloneState(tenantId: string, projectId: string): Record<string, string> {
    return { ...this.getMap(tenantId, projectId) };
  }
}
