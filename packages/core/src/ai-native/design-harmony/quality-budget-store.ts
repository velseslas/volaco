/**
 * VibeCode Core - Design Harmony
 * CDC V8.1 WOW §18 — persistance des budgets et des exécutions.
 *
 * Un budget projet est une contrainte PERSISTANTE (même patron que
 * DesignRulesConfigStore) ; chaque exécution réelle est archivée avec son
 * budget, son usage et son statut. Aucun budget n'est inventé après coup :
 * l'exécution est enregistrée telle qu'elle a été mesurée.
 *
 * FAILURE-SAFE + ISOLATION par couple tenantId+projectId. Aucune écriture
 * workspace.
 */

import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import {
  DEFAULT_QUALITY_BUDGET,
  normalizeQualityBudget,
  type QualityBudget,
  type QualityBudgetExecution
} from './quality-budget.js';

export const QUALITY_BUDGET_DATA_FILE = 'quality-budget-state';
export const QUALITY_BUDGET_MAX_EXECUTIONS_PER_PROJECT = 50;

export interface StoredQualityBudgetConfig {
  readonly tenantId: string;
  readonly projectId: string;
  readonly budget: QualityBudget;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

interface StoredState {
  configs: Record<string, StoredQualityBudgetConfig>;
  executions: Record<string, QualityBudgetExecution[]>;
}

export function qualityBudgetKey(tenantId: string, projectId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}`;
}

export class QualityBudgetStore {
  private state: StoredState = { configs: {}, executions: {} };
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath(QUALITY_BUDGET_DATA_FILE);
    if (this.persistent) {
      try {
        const loaded = readJsonFile<StoredState>(this.filePath, { configs: {}, executions: {} });
        if (loaded && typeof loaded === 'object') {
          this.state = {
            configs: loaded.configs && typeof loaded.configs === 'object' ? loaded.configs : {},
            executions: loaded.executions && typeof loaded.executions === 'object' ? loaded.executions : {}
          };
        }
      } catch {
        this.state = { configs: {}, executions: {} };
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.state);
    } catch {
      // FAILURE-SAFE : un budget déjà utilisé ne doit pas faire échouer l'API.
    }
  }

  public getConfig(tenantId: string, projectId: string): StoredQualityBudgetConfig | undefined {
    return this.state.configs[qualityBudgetKey(tenantId, projectId)];
  }

  /** Budget effectif : override projet ou défaut CDC V8.1 documenté. */
  public getEffective(tenantId: string, projectId: string): QualityBudget {
    const stored = this.getConfig(tenantId, projectId);
    return stored ? stored.budget : DEFAULT_QUALITY_BUDGET;
  }

  public setConfig(params: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly budget: QualityBudget;
    readonly updatedBy: string;
    readonly updatedAt: string;
  }): StoredQualityBudgetConfig {
    const normalized = normalizeQualityBudget(params.budget, { strict: true });
    const stored: StoredQualityBudgetConfig = deepFreeze({
      tenantId: params.tenantId.trim(),
      projectId: params.projectId.trim(),
      budget: normalized,
      updatedBy: params.updatedBy.trim(),
      updatedAt: params.updatedAt
    });
    this.state.configs[qualityBudgetKey(params.tenantId, params.projectId)] = stored;
    this.persist();
    return stored;
  }

  public clearConfig(tenantId: string, projectId: string): boolean {
    const key = qualityBudgetKey(tenantId, projectId);
    const existed = this.state.configs[key] !== undefined;
    if (existed) {
      delete this.state.configs[key];
      this.persist();
    }
    return existed;
  }

  public recordExecution(execution: QualityBudgetExecution): { execution: QualityBudgetExecution; created: boolean } {
    const key = qualityBudgetKey(execution.tenantId, execution.projectId);
    const entries = this.state.executions[key] ?? [];
    const existing = entries.find((entry) => entry.executionId === execution.executionId);
    if (existing) {
      return { execution: existing, created: false };
    }
    entries.push(deepFreeze(structuredClone(execution)));
    this.state.executions[key] = entries.slice(-QUALITY_BUDGET_MAX_EXECUTIONS_PER_PROJECT);
    this.persist();
    return {
      execution: this.state.executions[key]!.find((entry) => entry.executionId === execution.executionId)!,
      created: true
    };
  }

  public listExecutions(tenantId: string, projectId: string, limit = 20): readonly QualityBudgetExecution[] {
    const entries = this.state.executions[qualityBudgetKey(tenantId, projectId)] ?? [];
    const bounded = Math.max(1, Math.min(QUALITY_BUDGET_MAX_EXECUTIONS_PER_PROJECT, Math.round(limit)));
    return entries
      .filter((entry) => entry.tenantId === tenantId.trim() && entry.projectId === projectId.trim())
      .slice(-bounded)
      .reverse();
  }

  public clear(): void {
    this.state = { configs: {}, executions: {} };
    this.persist();
  }
}

/** Singleton de production — persistance réelle. */
export const qualityBudgetStore = new QualityBudgetStore({ persist: true });
