/**
 * Volaco Core - LOT 07: Durable Mutation Repository
 * Persists MutationTransaction records to .volaco_data/mutations.json via DurableFileStorage with multi-tenant partitioning.
 */

import { DurableFileStorage } from '../../repository/index.js';
import type { MutationTransaction } from './types.js';

export interface IMutationRepository {
  save(record: MutationTransaction): void;
  get(tenantId: string, projectId: string, transactionId: string): MutationTransaction | null;
  findById(transactionId: string): MutationTransaction | null;
  list(tenantId: string, projectId: string): MutationTransaction[];
  delete(tenantId: string, projectId: string, transactionId: string): boolean;
  clear(): void;
}

export class DurableMutationRepository implements IMutationRepository {
  private storage: DurableFileStorage;
  private readonly filename = 'mutations.json';

  constructor(dataDirOrStorage?: string | DurableFileStorage) {
    if (dataDirOrStorage instanceof DurableFileStorage) {
      this.storage = dataDirOrStorage;
    } else {
      this.storage = new DurableFileStorage(dataDirOrStorage);
    }
  }

  private getProjectKey(tenantId: string, projectId: string): string {
    return `${tenantId}:${projectId}`;
  }

  private loadAll(): Record<string, MutationTransaction[]> {
    return this.storage.readJson<Record<string, MutationTransaction[]>>(this.filename, {});
  }

  private saveAll(data: Record<string, MutationTransaction[]>): void {
    this.storage.writeJson(this.filename, data);
  }

  public save(record: MutationTransaction): void {
    const data = this.loadAll();
    const key = this.getProjectKey(record.tenantId, record.projectId);
    const list = data[key] || [];

    const index = list.findIndex((r) => r.transactionId === record.transactionId);
    if (index >= 0) {
      list[index] = record;
    } else {
      list.push(record);
    }
    data[key] = list;
    this.saveAll(data);
  }

  public get(tenantId: string, projectId: string, transactionId: string): MutationTransaction | null {
    const data = this.loadAll();
    const key = this.getProjectKey(tenantId, projectId);
    const list = data[key] || [];
    const found = list.find((r) => r.transactionId === transactionId);
    return found || null;
  }

  public findById(transactionId: string): MutationTransaction | null {
    const data = this.loadAll();
    for (const list of Object.values(data)) {
      const found = list.find((r) => r.transactionId === transactionId);
      if (found) return found;
    }
    return null;
  }

  public list(tenantId: string, projectId: string): MutationTransaction[] {
    const data = this.loadAll();
    const key = this.getProjectKey(tenantId, projectId);
    return data[key] || [];
  }

  public delete(tenantId: string, projectId: string, transactionId: string): boolean {
    const data = this.loadAll();
    const key = this.getProjectKey(tenantId, projectId);
    const list = data[key] || [];
    const initialLen = list.length;
    const filtered = list.filter((r) => r.transactionId !== transactionId);
    if (filtered.length !== initialLen) {
      data[key] = filtered;
      this.saveAll(data);
      return true;
    }
    return false;
  }

  public enableDurablePersistence(dataDirOrStorage?: string | DurableFileStorage): void {
    if (dataDirOrStorage instanceof DurableFileStorage) {
      this.storage = dataDirOrStorage;
    } else {
      this.storage = new DurableFileStorage(dataDirOrStorage);
    }
  }

  public clear(): void {
    this.saveAll({});
  }
}
