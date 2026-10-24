/**
 * VibeCode Core - Design Harmony
 * CDC V8 §24 — DesignMemoryStore : décisions design PERSISTÉES par couple
 * tenantId+projectId (liste ordonnée, supersession non destructive).
 *
 * RÉUTILISE le mécanisme de persistance existant (dataFilePath +
 * readJsonFile/writeJsonFileSync → SQLite/documents, repli fichiers) — même
 * patron que DesignSystemStore/AuditStore. Aucun node:fs.
 *
 * GARANTIES :
 *  - idempotence : enregistrer deux fois la même décision (même id de
 *    contenu) ne crée pas de doublon ;
 *  - supersession non destructive : la décision reste traçable (status
 *    SUPERSEDED + auteur + horodatage) ;
 *  - borne : au plus 200 décisions par couple (les plus anciennes
 *    SUPERSEDED sont écartées en premier — jamais une décision ACTIVE) ;
 *  - ISOLATION : clé logique `tenantId:projectId` + filtre à la lecture ;
 *  - FAILURE-SAFE : aucun problème de persistance ne jette vers l'appelant.
 */

import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import type { DesignMemoryDecision } from './design-memory.js';

export const DESIGN_MEMORY_DATA_FILE = 'design-memory-decisions';

/** Borne dure par couple tenant+projet (les SUPERSEDED les plus anciennes partent d'abord). */
export const DESIGN_MEMORY_MAX_DECISIONS = 200;

export function designMemoryKey(tenantId: string, projectId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}`;
}

export class DesignMemoryStore {
  private decisions: Record<string, DesignMemoryDecision[]> = {};
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath(DESIGN_MEMORY_DATA_FILE);
    if (this.persistent) {
      try {
        const loaded = readJsonFile<Record<string, DesignMemoryDecision[]>>(this.filePath, {});
        if (loaded && typeof loaded === 'object') {
          this.decisions = loaded;
        }
      } catch {
        this.decisions = {};
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.decisions);
    } catch {
      // FAILURE-SAFE.
    }
  }

  /** Toutes les décisions du couple (ordre d'enregistrement, plus récente en dernier). */
  public list(tenantId: string, projectId: string): readonly DesignMemoryDecision[] {
    const entries = this.decisions[designMemoryKey(tenantId, projectId)] ?? [];
    return entries.filter((entry) => entry.tenantId === tenantId.trim() && entry.projectId === projectId.trim());
  }

  /** Décisions ACTIVES uniquement. */
  public listActive(tenantId: string, projectId: string): readonly DesignMemoryDecision[] {
    return this.list(tenantId, projectId).filter((entry) => entry.status === 'ACTIVE');
  }

  public get(tenantId: string, projectId: string, decisionId: string): DesignMemoryDecision | undefined {
    return this.list(tenantId, projectId).find((entry) => entry.id === decisionId);
  }

  /**
   * Enregistre une décision (idempotent par id de contenu). Si l'id existe
   * déjà, l'entrée existante est retournée inchangée (`created: false`).
   */
  public record(decision: DesignMemoryDecision): { decision: DesignMemoryDecision; created: boolean } {
    const key = designMemoryKey(decision.tenantId, decision.projectId);
    const entries = this.decisions[key] ?? [];
    const existing = entries.find((entry) => entry.id === decision.id);
    if (existing) {
      return { decision: existing, created: false };
    }
    entries.push(deepFreeze(structuredClone(decision)));
    this.decisions[key] = this.prune(entries);
    this.persist();
    return { decision: this.decisions[key]!.find((entry) => entry.id === decision.id)!, created: true };
  }

  /**
   * Supersede une décision ACTIVE (retourne undefined si introuvable ou déjà
   * superseded). Ne supprime jamais rien.
   */
  public supersede(
    tenantId: string,
    projectId: string,
    decisionId: string,
    supersededBy: string,
    supersededAt: string
  ): DesignMemoryDecision | undefined {
    const key = designMemoryKey(tenantId, projectId);
    const entries = this.decisions[key];
    if (!entries) return undefined;
    const index = entries.findIndex(
      (entry) =>
        entry.id === decisionId &&
        entry.tenantId === tenantId.trim() &&
        entry.projectId === projectId.trim() &&
        entry.status === 'ACTIVE'
    );
    if (index < 0) return undefined;
    const updated: DesignMemoryDecision = deepFreeze({
      ...structuredClone(entries[index]!),
      status: 'SUPERSEDED' as const,
      supersededAt,
      supersededBy: supersededBy.trim()
    });
    entries[index] = updated;
    this.decisions[key] = this.prune(entries);
    this.persist();
    return updated;
  }

  /**
   * Borne la liste : si dépassement, retire les SUPERSEDED les plus anciennes
   * d'abord ; n'écarte jamais une ACTIVE tant qu'il reste une SUPERSEDED.
   */
  private prune(entries: DesignMemoryDecision[]): DesignMemoryDecision[] {
    if (entries.length <= DESIGN_MEMORY_MAX_DECISIONS) return entries;
    const survivors = [...entries];
    let index = 0;
    while (survivors.length > DESIGN_MEMORY_MAX_DECISIONS && index < survivors.length) {
      if (survivors[index]!.status === 'SUPERSEDED') {
        survivors.splice(index, 1);
      } else {
        index += 1;
      }
    }
    return survivors.slice(-DESIGN_MEMORY_MAX_DECISIONS);
  }

  /** Vide le store en mémoire ET la persistance associée (tests). */
  public clear(): void {
    this.decisions = {};
    this.persist();
  }
}

/** Singleton de production — persistance réelle (même convention que designSystemStore). */
export const designMemoryStore = new DesignMemoryStore({ persist: true });
