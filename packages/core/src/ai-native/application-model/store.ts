/**
 * VibeCode Core - AI-Native Engineering Tier
 * CDC §12 — ApplicationModelStore : racine Application Model PERSISTÉE par
 * couple tenantId+projectId (dernier modèle — upsert).
 *
 * RÉUTILISE le mécanisme de persistance existant (dataFilePath +
 * readJsonFile/writeJsonFileSync → SQLite/documents, repli fichiers) — même
 * patron que DesignSystemStore/AuditStore. Aucun node:fs direct.
 *
 * LE STORE EST PASSIF : il n'accepte que des racines déjà construites par
 * buildApplicationModel (aucun modèle fabriqué). ISOLATION : clé logique
 * `tenantId:projectId` + filtre à la lecture. FAILURE-SAFE : aucun problème
 * de persistance ne jette vers l'appelant.
 */

import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import type { ApplicationModelRoot } from './types.js';

export const APPLICATION_MODEL_DATA_FILE = 'application-models';

/** Clé logique composite (dérivée des champs — rien de généré). */
export function applicationModelKey(tenantId: string, projectId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}`;
}

export class ApplicationModelStore {
  private models: Record<string, ApplicationModelRoot> = {};
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath(APPLICATION_MODEL_DATA_FILE);
    if (this.persistent) {
      try {
        const loaded = readJsonFile<Record<string, ApplicationModelRoot>>(this.filePath, {});
        if (loaded && typeof loaded === 'object') {
          this.models = loaded;
        }
      } catch {
        // Un problème de chargement ne casse jamais l'instanciation du store.
        this.models = {};
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.models);
    } catch {
      // FAILURE-SAFE : la persistance ne doit jamais faire échouer l'appelant.
    }
  }

  /**
   * Enregistre la racine DÉJÀ construite (buildApplicationModel). Upsert
   * déterministe par clé composite — le nouveau modèle REMPLACE le précédent.
   */
  public record(model: ApplicationModelRoot): void {
    const key = applicationModelKey(model.tenantId, model.projectId);
    this.models[key] = deepFreeze(structuredClone(model));
    this.persist();
  }

  /** Lecture isolée : tenantId + projectId requis (filtre en profondeur). */
  public get(tenantId: string, projectId: string): ApplicationModelRoot | undefined {
    const model = this.models[applicationModelKey(tenantId, projectId)];
    if (!model) return undefined;
    if (model.tenantId !== tenantId.trim() || model.projectId !== projectId.trim()) {
      return undefined;
    }
    return model;
  }

  /** Indique si un modèle existe pour ce couple. */
  public has(tenantId: string, projectId: string): boolean {
    return this.get(tenantId, projectId) !== undefined;
  }

  /** Vide le store en mémoire ET la persistance associée (tests). */
  public clear(): void {
    this.models = {};
    this.persist();
  }
}

/** Source minimale requise (store réel ou store de test). */
export interface ApplicationModelStoreLike {
  get(tenantId: string, projectId: string): ApplicationModelRoot | undefined;
}

/** Singleton de production — persistance réelle (même convention que designSystemStore). */
export const applicationModelStore = new ApplicationModelStore({ persist: true });
