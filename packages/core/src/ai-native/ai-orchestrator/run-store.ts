/**
 * V7-WIRE-5 — Persistance des runs AINT-010 (AI Orchestrator).
 *
 * Le service ne conservait ses runs que dans un cache LRU mémoire : un
 * redémarrage effaçait toute trace exploitable par le produit. Ce store
 * persiste les runs complets (même couche que les autres stores, SQLite par
 * défaut) avec une borne stricte : les plus anciens sortent au-delà de
 * MAX_ORCHESTRATION_RUNS. La lecture est filtrée par tenant + projet.
 */

import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import type { OrchestrationRun } from './types.js';

export const MAX_ORCHESTRATION_RUNS = 50;
export const DEFAULT_ORCHESTRATION_HISTORY_LIMIT = 20;

export class OrchestrationRunStore {
  private readonly runs = new Map<string, OrchestrationRun>();
  private readonly filePath: string | undefined;

  constructor(options?: { persist?: boolean }) {
    if (options?.persist) {
      this.filePath = dataFilePath('orchestration-runs');
      const raw = readJsonFile<Record<string, OrchestrationRun>>(this.filePath, {});
      for (const [key, run] of Object.entries(raw)) {
        if (!run || typeof run.orchestrationId !== 'string') continue;
        if (run.orchestrationId !== key) continue;
        this.runs.set(key, run);
      }
      this.prune();
    }
  }

  /** Enregistre le run final (idempotent : même id = remplacement). */
  public save(run: OrchestrationRun): void {
    if (!run || typeof run.orchestrationId !== 'string' || run.orchestrationId.length === 0) return;
    this.runs.set(run.orchestrationId, run);
    this.prune();
    this.persist();
  }

  /** Lecture stricte : un run d'un autre tenant/projet est invisible. */
  public get(tenantId: string, projectId: string, orchestrationId: string): OrchestrationRun | undefined {
    const run = this.runs.get(orchestrationId);
    if (!run) return undefined;
    if (run.tenantId !== tenantId || run.projectId !== projectId) return undefined;
    return run;
  }

  /** Historique du projet, du plus récent au plus ancien. */
  public query(tenantId: string, projectId: string, limit = DEFAULT_ORCHESTRATION_HISTORY_LIMIT): OrchestrationRun[] {
    const safeLimit = Math.max(1, Math.min(MAX_ORCHESTRATION_RUNS, Math.floor(limit)));
    return [...this.runs.values()]
      .filter((run) => run.tenantId === tenantId && run.projectId === projectId)
      .sort((a, b) => {
        const ta = a.completedAt || a.startedAt || '';
        const tb = b.completedAt || b.startedAt || '';
        const byDate = tb.localeCompare(ta);
        return byDate !== 0 ? byDate : b.orchestrationId.localeCompare(a.orchestrationId);
      })
      .slice(0, safeLimit);
  }

  public count(): number {
    return this.runs.size;
  }

  private prune(): void {
    if (this.runs.size <= MAX_ORCHESTRATION_RUNS) return;
    const oldestFirst = [...this.runs.values()].sort((a, b) => {
      const ta = a.completedAt || a.startedAt || '';
      const tb = b.completedAt || b.startedAt || '';
      const byDate = ta.localeCompare(tb);
      return byDate !== 0 ? byDate : a.orchestrationId.localeCompare(b.orchestrationId);
    });
    const excess = this.runs.size - MAX_ORCHESTRATION_RUNS;
    for (let i = 0; i < excess; i += 1) {
      const run = oldestFirst[i];
      if (run) this.runs.delete(run.orchestrationId);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const document: Record<string, OrchestrationRun> = {};
    for (const [key, run] of this.runs.entries()) document[key] = run;
    writeJsonFileSync(this.filePath, document);
  }
}

/** Singleton de production : les runs survivent aux redémarrages. */
export const orchestrationRunStore = new OrchestrationRunStore({ persist: true });
