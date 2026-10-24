/**
 * VibeCode Core - Design Harmony
 * CDC V8 §11 — DesignSystemStore : artefact Design System PERSISTÉ par
 * couple tenantId+projectId (dernier artefact — upsert).
 *
 * L'artefact fige, pour un projet :
 *   - les TOKENS réellement inférés du DOM (InferredDesignSystem du rapport) ;
 *   - la DESIGN DIRECTION appliquée (dérivée de façon déterministe — la
 *     direction PERSISTÉE fait référence pour les relectrices) ;
 *   - les RÈGLES applicables instanciées depuis le catalogue versionné
 *     (design-rules.ts) + sa version — traçabilité de ce qui a été appliqué ;
 *   - la référence au rapport source (reportId + reportHash) pour lier
 *     artefact ↔ analyse.
 *
 * RÉUTILISE EXCLUSIVEMENT le mécanisme de persistance existant
 * (dataFilePath + readJsonFile/writeJsonFileSync → SQLite/documents, repli
 * fichiers) — même patron que DesignReportStore/AuditStore. Aucun node:fs,
 * aucune écriture dans les fichiers projet.
 *
 * LE STORE EST PASSIF : il n'accepte que des artefacts déjà construits par
 * buildDesignSystemArtifact (aucun verdict fabriqué). ISOLATION : clé logique
 * `tenantId:projectId` + filtre à la lecture. FAILURE-SAFE : aucun problème
 * de persistance ne jette vers l'appelant.
 */

import { createHash } from 'node:crypto';
import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import { buildAppliedDesignRules, designRulesInputFromTokens, DESIGN_RULES_CATALOG_VERSION, type AppliedDesignRule } from './design-rules.js';
import type { DesignDirection } from './design-direction.js';
import type { DesignHarmonyReport, InferredDesignSystem } from './types.js';

export const DESIGN_SYSTEM_DATA_FILE = 'design-system-artifacts';

/** Version du schéma d'artefact — incrémenter si la forme change. */
export const DESIGN_SYSTEM_SCHEMA_VERSION = 1;

export interface DesignSystemArtifact {
  readonly schemaVersion: number;
  readonly artifactId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly source: {
    readonly reportId: string;
    readonly reportHash: string;
    readonly overallScore: number;
    readonly dqi: number;
  };
  readonly analyzedRoutes: readonly string[];
  readonly generatedAt: string;
  readonly recordedAt: string;
  readonly direction: DesignDirection;
  readonly tokens: InferredDesignSystem;
  readonly rules: {
    readonly catalogVersion: string;
    readonly items: readonly AppliedDesignRule[];
  };
}

/** Clé logique composite (dérivée des champs — rien de généré). */
export function designSystemKey(tenantId: string, projectId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}`;
}

/**
 * Identifiant d'artefact DÉTERMINISTE (mêmes entrées → même id). N'inclut
 * NI recordedAt, NI dqi volatil : le contenu de référence (rapport source,
 * direction, version de catalogue) seulement.
 */
export function computeDesignSystemArtifactId(params: {
  tenantId: string;
  projectId: string;
  schemaVersion: number;
  sourceReportHash: string;
  catalogVersion: string;
  direction: DesignDirection;
}): string {
  const raw = `${params.tenantId}:${params.projectId}:${params.schemaVersion}:${params.sourceReportHash}:${params.catalogVersion}:${JSON.stringify(params.direction)}`;
  return 'dsa:' + createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
}

/**
 * Construit l'artefact à partir du rapport RÉEL (sortie de
 * DesignHarmonyService) + de la direction réellement appliquée par la route.
 * Fonction PURE et déterministe (hors recordedAt, horodatage d'écriture).
 */
export function buildDesignSystemArtifact(params: {
  report: DesignHarmonyReport;
  direction: DesignDirection;
  dqi: number;
  recordedAt: string;
  /**
   * Tokens RÉELLEMENT calculés par la route (avec preuves documentaires :
   * motion §7.6 + layout §7.7). Absent → tokens du rapport (compatibilité).
   */
  tokens?: InferredDesignSystem | undefined;
}): DesignSystemArtifact {
  const { report, direction, dqi, recordedAt } = params;
  const tokens = params.tokens ?? report.inferredDesignSystem;
  const ruleInput = designRulesInputFromTokens(tokens);
  const rules = buildAppliedDesignRules(ruleInput);
  const artifactId = computeDesignSystemArtifactId({
    tenantId: report.tenantId,
    projectId: report.projectId,
    schemaVersion: DESIGN_SYSTEM_SCHEMA_VERSION,
    sourceReportHash: report.reportHash,
    catalogVersion: DESIGN_RULES_CATALOG_VERSION,
    direction
  });

  return deepFreeze({
    schemaVersion: DESIGN_SYSTEM_SCHEMA_VERSION,
    artifactId,
    tenantId: report.tenantId,
    projectId: report.projectId,
    source: {
      reportId: report.reportId,
      reportHash: report.reportHash,
      overallScore: report.overallScore,
      dqi
    },
    analyzedRoutes: report.analyzedRoutes.slice(0, 10),
    generatedAt: report.generatedAt,
    recordedAt,
    direction,
    tokens,
    rules: {
      catalogVersion: DESIGN_RULES_CATALOG_VERSION,
      items: rules
    }
  });
}

export class DesignSystemStore {
  private artifacts: Record<string, DesignSystemArtifact> = {};
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath(DESIGN_SYSTEM_DATA_FILE);
    if (this.persistent) {
      try {
        const loaded = readJsonFile<Record<string, DesignSystemArtifact>>(this.filePath, {});
        if (loaded && typeof loaded === 'object') {
          this.artifacts = loaded;
        }
      } catch {
        // Un problème de chargement ne casse jamais l'instanciation du store.
        this.artifacts = {};
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.artifacts);
    } catch {
      // FAILURE-SAFE : la persistance ne doit jamais faire échouer l'appelant.
    }
  }

  /**
   * Enregistre l'artefact DÉJÀ construit (buildDesignSystemArtifact). Upsert
   * déterministe par clé composite tenantId:projectId — le nouvel artefact
   * REMPLACE le précédent (c'est le "dernier artefact"). Trace figée.
   */
  public record(artifact: DesignSystemArtifact): void {
    const key = designSystemKey(artifact.tenantId, artifact.projectId);
    this.artifacts[key] = deepFreeze(structuredClone(artifact));
    this.persist();
  }

  /** Lecture isolée : tenantId + projectId requis (filtre en profondeur). */
  public get(tenantId: string, projectId: string): DesignSystemArtifact | undefined {
    const artifact = this.artifacts[designSystemKey(tenantId, projectId)];
    if (!artifact) return undefined;
    if (artifact.tenantId !== tenantId.trim() || artifact.projectId !== projectId.trim()) {
      return undefined;
    }
    return artifact;
  }

  /** Indique si un artefact existe pour ce couple. */
  public has(tenantId: string, projectId: string): boolean {
    return this.get(tenantId, projectId) !== undefined;
  }

  /** Vide le store en mémoire ET la persistance associée (tests). */
  public clear(): void {
    this.artifacts = {};
    this.persist();
  }
}

/** Source minimale requise (DesignSystemStore réel ou store de test). */
export interface DesignSystemStoreLike {
  get(tenantId: string, projectId: string): DesignSystemArtifact | undefined;
}

/** Singleton de production — persistance réelle (même convention qu'auditStore). */
export const designSystemStore = new DesignSystemStore({ persist: true });
