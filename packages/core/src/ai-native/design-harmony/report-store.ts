/**
 * VibeCode Core - Design Harmony
 * ÉTAPE 42 Phase 4A — DesignReportStore : registre du DERNIER rapport
 * DesignHarmony par couple tenantId+projectId.
 *
 * RÉUTILISE EXCLUSIVEMENT le mécanisme de persistance existant
 * (dataFilePath + readJsonFile/writeJsonFileSync → SQLite/documents, repli
 * fichiers) — le même patron que AgentTraceStore/AuditStore. Aucun nouveau
 * backend, aucun node:fs, aucune écriture dans les fichiers projet.
 *
 * LE STORE EST PASSIF :
 * - il n'accepte que des DesignHarmonyReport déjà produits par
 *   DesignHarmonyService.analyzeDesignHarmony (aucun verdict fabriqué) ;
 * - il ne crée ni reportId, ni score, ni finding, ni phase ;
 * - un seul rapport conservé par couple tenant/projet (le dernier) —
 *   l'enregistrement suivant remplace le précédent (upsert).
 *
 * ISOLATION : clé logique `tenantId:projectId` + filtre simultané à la
 * lecture — un rapport d'un autre tenant/projet ne peut jamais être
 * récupéré.
 *
 * FAILURE-SAFE : aucun problème de persistance ne jette vers l'appelant.
 */

import { deepFreeze } from '../../ai-native/ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import type { DesignHarmonyReport } from './types.js';

export const DESIGN_REPORT_DATA_FILE = 'design-harmony-reports';

/** Clé logique composite (dérivée des champs du rapport — rien de généré). */
export function designReportKey(tenantId: string, projectId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}`;
}

export class DesignReportStore {
  private reports: Record<string, DesignHarmonyReport> = {};
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath(DESIGN_REPORT_DATA_FILE);
    if (this.persistent) {
      try {
        const loaded = readJsonFile<Record<string, DesignHarmonyReport>>(this.filePath, {});
        if (loaded && typeof loaded === 'object') {
          this.reports = loaded;
        }
      } catch {
        // Un problème de chargement ne casse jamais l'instanciation du store.
        this.reports = {};
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.reports);
    } catch {
      // FAILURE-SAFE : la persistance ne doit jamais faire échouer l'appelant.
    }
  }

  /**
   * Enregistre le rapport DÉJÀ construit (sortie réelle de
   * DesignHarmonyService). Upsert déterministe par clé composite
   * tenantId:projectId — le nouveau rapport REMPLACE le précédent (c'est le
   * "dernier rapport"). La trace stockée est figée (deepFreeze).
   */
  public record(report: DesignHarmonyReport): void {
    const key = designReportKey(report.tenantId, report.projectId);
    this.reports[key] = deepFreeze(structuredClone(report));
    this.persist();
  }

  /** Lecture isolée : tenantId + projectId requis. */
  public get(tenantId: string, projectId: string): DesignHarmonyReport | undefined {
    return this.reports[designReportKey(tenantId, projectId)];
  }

  /** Indique si un rapport précédent existe pour ce couple. */
  public has(tenantId: string, projectId: string): boolean {
    return this.reports[designReportKey(tenantId, projectId)] !== undefined;
  }

  /** Vide le store en mémoire ET la persistance associée (tests). */
  public clear(): void {
    this.reports = {};
    this.persist();
  }
}

/** Singleton de production — persistance réelle (même convention qu'auditStore). */
export const designReportStore = new DesignReportStore({ persist: true });
