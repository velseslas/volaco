/**
 * VibeCode Core - Design Harmony
 * CDC V8 §9/§10 — ComponentContractStore : overrides de COMPOSANTS persistés
 * par couple tenantId+projectId (dépréciation / désactivation d'un composant).
 *
 * RÉUTILISE le mécanisme de persistance existant (dataFilePath +
 * readJsonFile/writeJsonFileSync) — même patron que DesignSystemStore /
 * DesignRulesConfigStore. FAILURE-SAFE + ISOLATION par clé composite.
 *
 * LE STORE EST PASSIF : il n'accepte que des overrides DÉJÀ normalisés
 * (normalizeComponentOverride) — aucun verdict fabriqué. Un override est un
 * upsert par composant ; la suppression (AVAILABLE) est explicite.
 */

import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import {
  COMPONENT_CONTRACTS_VERSION,
  MAX_COMPONENT_OVERRIDES,
  type ComponentContractOverride
} from './component-contracts.js';

export const COMPONENT_CONTRACTS_DATA_FILE = 'component-contract-overrides';

export interface StoredComponentOverride {
  readonly tenantId: string;
  readonly projectId: string;
  readonly componentId: string;
  readonly override: ComponentContractOverride;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly catalogVersion: string;
}

export function componentContractKey(tenantId: string, projectId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}`;
}

interface ProjectOverrides {
  readonly tenantId: string;
  readonly projectId: string;
  readonly items: Record<string, StoredComponentOverride>;
}

export class ComponentContractStore {
  private projects: Record<string, ProjectOverrides> = {};
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath(COMPONENT_CONTRACTS_DATA_FILE);
    if (this.persistent) {
      try {
        const loaded = readJsonFile<Record<string, ProjectOverrides>>(this.filePath, {});
        if (loaded && typeof loaded === 'object') {
          this.projects = loaded;
        }
      } catch {
        this.projects = {};
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.projects);
    } catch {
      // FAILURE-SAFE : la persistance ne fait jamais échouer l'appelant.
    }
  }

  private getProject(tenantId: string, projectId: string): ProjectOverrides | undefined {
    const key = componentContractKey(tenantId, projectId);
    const record = this.projects[key];
    if (!record) return undefined;
    if (record.tenantId !== tenantId.trim() || record.projectId !== projectId.trim()) return undefined;
    return record;
  }

  /**
   * Enregistre (upsert) l'override d'UN composant — remplace le précédent pour
   * ce composant. Borne : MAX_COMPONENT_OVERRIDES composants par projet.
   */
  public set(params: {
    tenantId: string;
    projectId: string;
    componentId: string;
    override: ComponentContractOverride;
    updatedBy: string;
    updatedAt: string;
  }): StoredComponentOverride {
    const tenantId = params.tenantId.trim();
    const projectId = params.projectId.trim();
    const key = componentContractKey(tenantId, projectId);
    const project = this.getProject(tenantId, projectId) ?? { tenantId, projectId, items: {} };
    if (!project.items[params.componentId] && Object.keys(project.items).length >= MAX_COMPONENT_OVERRIDES) {
      throw new Error(`Au plus ${MAX_COMPONENT_OVERRIDES} overrides de composants par projet.`);
    }
    const stored: StoredComponentOverride = deepFreeze(
      structuredClone({
        tenantId,
        projectId,
        componentId: params.componentId.trim(),
        override: params.override,
        updatedAt: params.updatedAt,
        updatedBy: params.updatedBy.trim(),
        catalogVersion: COMPONENT_CONTRACTS_VERSION
      })
    );
    project.items[stored.componentId] = stored;
    this.projects[key] = project;
    this.persist();
    return stored;
  }

  /** Override d'un composant (undefined si aucun). */
  public get(tenantId: string, projectId: string, componentId: string): StoredComponentOverride | undefined {
    return this.getProject(tenantId, projectId)?.items[componentId.trim()];
  }

  /** Tous les overrides du projet (ordre stable : ordre d'insertion des ids). */
  public list(tenantId: string, projectId: string): readonly StoredComponentOverride[] {
    const project = this.getProject(tenantId, projectId);
    if (!project) return [];
    return Object.keys(project.items)
      .sort()
      .map((componentId) => project.items[componentId]!)
      .filter((entry): entry is StoredComponentOverride => entry !== undefined);
  }

  /** Retire l'override (retour au catalogue). true s'il existait. */
  public clearFor(tenantId: string, projectId: string, componentId: string): boolean {
    const project = this.getProject(tenantId, projectId);
    const id = componentId.trim();
    if (!project || !project.items[id]) return false;
    delete project.items[id];
    if (Object.keys(project.items).length === 0) {
      delete this.projects[componentContractKey(tenantId, projectId)];
    }
    this.persist();
    return true;
  }

  /** Vide le store en mémoire ET la persistance associée (tests). */
  public clear(): void {
    this.projects = {};
    this.persist();
  }
}

/** Singleton de production — persistance réelle (même convention que les autres stores). */
export const componentContractStore = new ComponentContractStore({ persist: true });
