/**
 * VibeCode Core - Design Harmony
 * CDC V8 §8 — DesignRulesConfigStore : config de règles PERSISTÉE par
 * couple tenantId+projectId (seuils héritables + règles personnalisées).
 *
 * RÉUTILISE le mécanisme de persistance existant (dataFilePath +
 * readJsonFile/writeJsonFileSync) — même patron que DesignSystemStore.
 * FAILURE-SAFE + ISOLATION par clé composite, comme les autres stores.
 */

import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import {
  DEFAULT_DESIGN_RULES_CONFIG,
  DESIGN_RULE_AUDIT_CATALOG_VERSION,
  type DesignRulesConfig
} from './design-rules-audit.js';

export const DESIGN_RULES_CONFIG_DATA_FILE = 'design-rules-configs';

export interface StoredDesignRulesConfig {
  readonly tenantId: string;
  readonly projectId: string;
  readonly config: DesignRulesConfig;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly catalogVersion: string;
}

export function designRulesConfigKey(tenantId: string, projectId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}`;
}

export class DesignRulesConfigStore {
  private configs: Record<string, StoredDesignRulesConfig> = {};
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath(DESIGN_RULES_CONFIG_DATA_FILE);
    if (this.persistent) {
      try {
        const loaded = readJsonFile<Record<string, StoredDesignRulesConfig>>(this.filePath, {});
        if (loaded && typeof loaded === 'object') {
          this.configs = loaded;
        }
      } catch {
        this.configs = {};
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.configs);
    } catch {
      // FAILURE-SAFE.
    }
  }

  /** Enregistre (upsert) la config projet — remplace la précédente. */
  public set(params: {
    tenantId: string;
    projectId: string;
    config: DesignRulesConfig;
    updatedBy: string;
    updatedAt: string;
  }): StoredDesignRulesConfig {
    const record: StoredDesignRulesConfig = deepFreeze(structuredClone({
      tenantId: params.tenantId.trim(),
      projectId: params.projectId.trim(),
      config: params.config,
      updatedAt: params.updatedAt,
      updatedBy: params.updatedBy.trim(),
      catalogVersion: DESIGN_RULE_AUDIT_CATALOG_VERSION
    }));
    this.configs[designRulesConfigKey(record.tenantId, record.projectId)] = record;
    this.persist();
    return record;
  }

  /** Config effective : celle du projet ou les défauts CDC. */
  public getEffective(tenantId: string, projectId: string): DesignRulesConfig {
    return this.get(tenantId, projectId)?.config ?? DEFAULT_DESIGN_RULES_CONFIG;
  }

  public get(tenantId: string, projectId: string): StoredDesignRulesConfig | undefined {
    const record = this.configs[designRulesConfigKey(tenantId, projectId)];
    if (!record) return undefined;
    if (record.tenantId !== tenantId.trim() || record.projectId !== projectId.trim()) return undefined;
    return record;
  }

  /** Vide le store en mémoire ET la persistance associée (tests). */
  public clear(): void {
    this.configs = {};
    this.persist();
  }
}

/** Singleton de production — persistance réelle (même convention que designSystemStore). */
export const designRulesConfigStore = new DesignRulesConfigStore({ persist: true });
