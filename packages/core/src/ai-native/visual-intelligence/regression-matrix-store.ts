/**
 * VibeCode Core - Visual Intelligence
 * CDC V8.1 WOW §13 — historique des matrices de régression visuelle.
 *
 * Chaque exécution est archivée avec ses hashes de captures (jamais les
 * captures base64, trop volumineuses pour un état persistant). La matrice la
 * plus récente sert de baseline à la suivante ; sans baseline, aucune
 * comparaison n'est inventée.
 */

import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import type { VisualRegressionMatrixReport } from './regression-matrix.js';

export const VISUAL_REGRESSION_MATRIX_DATA_FILE = 'visual-regression-matrices';
export const VISUAL_REGRESSION_MATRIX_MAX_RUNS = 20;

export function visualRegressionMatrixKey(tenantId: string, projectId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}`;
}

function withoutScreenshots(report: VisualRegressionMatrixReport): VisualRegressionMatrixReport {
  return deepFreeze({
    ...structuredClone(report),
    viewports: report.viewports.map((entry) => ({
      ...entry,
      screenshotBase64: undefined
    }))
  });
}

export class VisualRegressionMatrixStore {
  private runs: Record<string, VisualRegressionMatrixReport[]> = {};
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath(VISUAL_REGRESSION_MATRIX_DATA_FILE);
    if (this.persistent) {
      try {
        const loaded = readJsonFile<Record<string, VisualRegressionMatrixReport[]>>(this.filePath, {});
        if (loaded && typeof loaded === 'object') this.runs = loaded;
      } catch {
        this.runs = {};
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.runs);
    } catch {
      // FAILURE-SAFE.
    }
  }

  public record(report: VisualRegressionMatrixReport): VisualRegressionMatrixReport {
    const key = visualRegressionMatrixKey(report.tenantId, report.projectId);
    const entries = this.runs[key] ?? [];
    const stored = withoutScreenshots(report);
    const existing = entries.find((entry) => entry.reportId === stored.reportId);
    if (!existing) {
      entries.push(stored);
      this.runs[key] = entries.slice(-VISUAL_REGRESSION_MATRIX_MAX_RUNS);
      this.persist();
    }
    return stored;
  }

  public latest(tenantId: string, projectId: string): VisualRegressionMatrixReport | undefined {
    const entries = this.runs[visualRegressionMatrixKey(tenantId, projectId)] ?? [];
    return entries[entries.length - 1];
  }

  public list(tenantId: string, projectId: string, limit = 10): readonly VisualRegressionMatrixReport[] {
    const entries = this.runs[visualRegressionMatrixKey(tenantId, projectId)] ?? [];
    const bounded = Math.max(1, Math.min(VISUAL_REGRESSION_MATRIX_MAX_RUNS, Math.round(limit)));
    return entries.slice(-bounded).reverse();
  }

  public clear(): void {
    this.runs = {};
    this.persist();
  }
}

/** Singleton de production. */
export const visualRegressionMatrixStore = new VisualRegressionMatrixStore({ persist: true });
