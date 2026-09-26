/**
 * VibeCode Studio - Project State Store (CAPP-004)
 */

import type { ValidationReport } from './types.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';

function reviveReport(raw: ValidationReport): ValidationReport {
  return { ...raw, validatedAt: new Date(raw.validatedAt) };
}

export class ProjectStateStore {
  private validationReports = new Map<string, ValidationReport>();
  private readonly filePath: string | undefined;

  constructor(options?: { persist?: boolean }) {
    if (options?.persist) {
      this.filePath = dataFilePath('project-state');
      const raw = readJsonFile<Record<string, ValidationReport>>(this.filePath, {});
      for (const [key, report] of Object.entries(raw)) {
        this.validationReports.set(key, reviveReport(report));
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const obj: Record<string, ValidationReport> = {};
    for (const [key, report] of this.validationReports.entries()) {
      obj[key] = report;
    }
    writeJsonFileSync(this.filePath, obj);
  }

  private getKey(tenantId: string, projectId: string): string {
    return `${tenantId}:${projectId}`;
  }

  public getValidationReport(tenantId: string, projectId: string): ValidationReport {
    const key = this.getKey(tenantId, projectId);
    const existing = this.validationReports.get(key);
    if (existing) {
      return existing;
    }
    const initial: ValidationReport = {
      status: 'PENDING',
      checks: {
        build: false,
        typecheck: false,
        lint: false,
        tests: false,
        security: false
      },
      errors: [],
      warnings: [],
      validatedAt: new Date()
    };
    this.validationReports.set(key, initial);
    this.persist();
    return initial;
  }

  public saveValidationReport(tenantId: string, projectId: string, report: ValidationReport): ValidationReport {
    const key = this.getKey(tenantId, projectId);
    this.validationReports.set(key, report);
    this.persist();
    return report;
  }

  public clear(): void {
    this.validationReports.clear();
    this.persist();
  }
}

export const projectStateStore = new ProjectStateStore({ persist: true });
