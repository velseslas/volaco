/**
 * VibeCode Core - Design Harmony
 * CDC V8 §6 — DesignDirectionStore : override de Design Direction PERSISTÉ
 * par couple tenantId+projectId (contrainte persistante du projet).
 *
 * RÉUTILISE le mécanisme de persistance existant (dataFilePath +
 * readJsonFile/writeJsonFileSync → SQLite/documents, repli fichiers) — même
 * patron que DesignSystemStore. Aucun node:fs, aucune écriture projet.
 *
 * ISOLATION : clé logique `tenantId:projectId` + filtre à la lecture.
 * FAILURE-SAFE : aucun problème de persistance ne jette vers l'appelant.
 */

import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import { DESIGN_DIRECTION_CATALOG_VERSION } from './design-direction-catalog.js';
import type { DesignDirectionOverride } from './design-direction.js';

export const DESIGN_DIRECTION_DATA_FILE = 'design-direction-overrides';

export interface StoredDesignDirectionOverride {
  readonly tenantId: string;
  readonly projectId: string;
  readonly override: DesignDirectionOverride;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly catalogVersion: string;
}

/** Clé logique composite (dérivée des champs — rien de généré). */
export function designDirectionKey(tenantId: string, projectId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}`;
}

export class DesignDirectionStore {
  private overrides: Record<string, StoredDesignDirectionOverride> = {};
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath(DESIGN_DIRECTION_DATA_FILE);
    if (this.persistent) {
      try {
        const loaded = readJsonFile<Record<string, StoredDesignDirectionOverride>>(this.filePath, {});
        if (loaded && typeof loaded === 'object') {
          this.overrides = loaded;
        }
      } catch {
        this.overrides = {};
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.overrides);
    } catch {
      // FAILURE-SAFE.
    }
  }

  /** Enregistre (upsert) la décision de direction — remplace la précédente. */
  public set(params: {
    tenantId: string;
    projectId: string;
    override: DesignDirectionOverride;
    updatedBy: string;
    updatedAt: string;
  }): StoredDesignDirectionOverride {
    const record: StoredDesignDirectionOverride = deepFreeze(structuredClone({
      tenantId: params.tenantId.trim(),
      projectId: params.projectId.trim(),
      override: params.override,
      updatedAt: params.updatedAt,
      updatedBy: params.updatedBy.trim(),
      catalogVersion: DESIGN_DIRECTION_CATALOG_VERSION
    }));
    this.overrides[designDirectionKey(record.tenantId, record.projectId)] = record;
    this.persist();
    return record;
  }

  /** Lecture isolée : tenantId + projectId requis (filtre en profondeur). */
  public get(tenantId: string, projectId: string): StoredDesignDirectionOverride | undefined {
    const record = this.overrides[designDirectionKey(tenantId, projectId)];
    if (!record) return undefined;
    if (record.tenantId !== tenantId.trim() || record.projectId !== projectId.trim()) return undefined;
    return record;
  }

  /** Retire l'override (retour à la dérivation déterministe). */
  public clearFor(tenantId: string, projectId: string): boolean {
    const key = designDirectionKey(tenantId, projectId);
    if (!(key in this.overrides)) return false;
    delete this.overrides[key];
    this.persist();
    return true;
  }

  /** Vide le store en mémoire ET la persistance associée (tests). */
  public clear(): void {
    this.overrides = {};
    this.persist();
  }
}

/** Singleton de production — persistance réelle (même convention que designSystemStore). */
export const designDirectionStore = new DesignDirectionStore({ persist: true });
