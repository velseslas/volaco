/**
 * VibeCode Core - Design Harmony
 * CDC V8 §31 — FULL DESIGN AUDIT (agrégateur multi-pages / breakpoints).
 *
 * Le CDC exige un audit GLOBAL : toutes les pages, tous les breakpoints, puis
 * « Global Design Quality, Design Harmony, Aesthetic Quality, Design Drift,
 * UX consistency, Accessibility, Recommendations ».
 *
 * Cette fonction est PURE : elle agrège des mesures RÉELLES page par page
 * (AQS §14, findings responsive, erreurs runtime, overflow, résultats de
 * règles §8) et les findings cross-page réels (CrossPageHarmonyEngine). Aucune
 * valeur inventée :
 *   - une moyenne n'est calculée que sur des sous-scores MESURÉS (couverture
 *     réelle) ; aucune page mesurable => null ;
 *   - l'absence de preuve cross-page (moins de 2 pages) => UNKNOWN, jamais
 *     « aucune dérive » ;
 *   - les recommandations proviennent de sous-scores réellement < 80.
 */

import type {
  AestheticQualityScore,
  AqsDimensionId,
  DesignHarmonyFinding,
  HarmonySeverity
} from './types.js';

/** Les dimensions « harmonie » du CDC (sous-ensemble documenté de l'AQS). */
export const FULL_AUDIT_HARMONY_DIMENSIONS: readonly AqsDimensionId[] = [
  'color_harmony',
  'typography',
  'spacing_rhythm',
  'component_quality',
  'brand_alignment'
];

/** Les dimensions « qualité esthétique perçue » (sous-ensemble documenté). */
export const FULL_AUDIT_AESTHETIC_DIMENSIONS: readonly AqsDimensionId[] = [
  'visual_hierarchy',
  'composition',
  'visual_balance',
  'perceived_quality',
  'information_density'
];

export interface FullDesignAuditBreakpoint {
  readonly width: number;
  readonly height: number;
}

export interface FullDesignAuditViewports {
  readonly desktop: FullDesignAuditBreakpoint;
  readonly mobile: FullDesignAuditBreakpoint;
}

export interface FullDesignAuditRuleSummary {
  readonly total: number;
  readonly pass: number;
  readonly fail: number;
  readonly unknown: number;
}

export interface FullDesignAuditPageInput {
  readonly path: string;
  readonly aqs: AestheticQualityScore;
  readonly responsiveFindings: readonly DesignHarmonyFinding[];
  readonly runtimeErrors: readonly string[];
  readonly overflowX?: boolean | null | undefined;
  readonly ruleSummary: FullDesignAuditRuleSummary;
  readonly viewports: FullDesignAuditViewports;
}

export type DesignDriftStatus = 'NONE' | 'DETECTED' | 'UNKNOWN';

export interface FullDesignAuditRecommendation {
  readonly dimension: AqsDimensionId;
  readonly page: string;
  readonly message: string;
  readonly severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface FullDesignAuditSummary {
  readonly pagesAnalyzed: number;
  readonly pagesMeasured: number;
  /** Breakpoints réellement mesurés (ex. « desktop 1440×900 »). */
  readonly breakpoints: readonly string[];
  readonly globalDesignQuality: number | null;
  readonly designHarmony: number | null;
  readonly aestheticQuality: number | null;
  readonly designDrift: {
    readonly status: DesignDriftStatus;
    readonly findings: number;
    readonly details: readonly string[];
  };
  readonly uxConsistency: number | null;
  readonly accessibility: number | null;
  readonly recommendations: readonly FullDesignAuditRecommendation[];
  readonly rules: FullDesignAuditRuleSummary;
}

const SEVERITY_PENALTY: Record<HarmonySeverity, number> = {
  CRITICAL: 25,
  HIGH: 15,
  MEDIUM: 8,
  LOW: 3,
  INFO: 1
};

export const FULL_AUDIT_RECOMMENDATION_THRESHOLD = 80;

function weightedMean(pages: readonly FullDesignAuditPageInput[], valueOf: (page: FullDesignAuditPageInput) => number | null): number | null {
  let numerator = 0;
  let weightSum = 0;
  for (const page of pages) {
    const value = valueOf(page);
    if (value === null) continue;
    const weight = page.aqs.coverage > 0 ? page.aqs.coverage : 1;
    numerator += value * weight;
    weightSum += weight;
  }
  if (weightSum === 0) return null;
  return Math.round(numerator / weightSum);
}

function subScoreMean(page: FullDesignAuditPageInput, ids: readonly AqsDimensionId[]): number | null {
  const values = page.aqs.subScores
    .filter((score) => ids.includes(score.id) && score.value !== null)
    .map((score) => score.value as number);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pagePenalty(findings: readonly DesignHarmonyFinding[]): number {
  let penalty = 0;
  for (const finding of findings) {
    penalty += SEVERITY_PENALTY[finding.severity] ?? 0;
  }
  return Math.min(100, penalty);
}

function breakpointLabel(name: string, viewport: FullDesignAuditBreakpoint): string {
  return `${name} ${viewport.width}×${viewport.height}`;
}

/**
 * Agrège les mesures réelles de toutes les pages. `crossPageFindings` doit
 * provenir du CrossPageHarmonyEngine sur les snapshots desktop réels.
 */
export function computeFullDesignAuditSummary(
  pages: readonly FullDesignAuditPageInput[],
  crossPageFindings: readonly DesignHarmonyFinding[]
): FullDesignAuditSummary {
  const measuredPages = pages.filter((page) => page.aqs.overall !== null);
  const orderedPages = [...pages].sort((a, b) => a.path.localeCompare(b.path));

  const globalDesignQuality = weightedMean(measuredPages, (page) => page.aqs.overall);

  const designHarmony = weightedMean(measuredPages, (page) => subScoreMean(page, FULL_AUDIT_HARMONY_DIMENSIONS));
  const aestheticQuality = weightedMean(measuredPages, (page) => subScoreMean(page, FULL_AUDIT_AESTHETIC_DIMENSIONS));

  // Drift : preuve cross-page requise (>= 2 pages) — sinon UNKNOWN honnête.
  const driftFindings = crossPageFindings.filter(
    (finding) => finding.designDrift || finding.severity === 'HIGH' || finding.severity === 'CRITICAL'
  );
  const designDrift =
    orderedPages.length < 2
      ? {
          status: 'UNKNOWN' as const,
          findings: 0,
          details: ['moins de 2 pages : aucune comparaison cross-page possible']
        }
      : {
          status: (driftFindings.length > 0 ? 'DETECTED' : 'NONE') as DesignDriftStatus,
          findings: driftFindings.length,
          details: driftFindings.slice(0, 5).map(
            (finding) =>
              `${finding.category} — ${finding.property} (${finding.pageRoute}) : ${finding.recommendation}`
          )
        };

  // UX consistency : pénalité réelle des findings cross-page, si >= 2 pages.
  let uxConsistency: number | null;
  if (orderedPages.length < 2) {
    uxConsistency = null;
  } else {
    const penalty = pagePenalty(crossPageFindings);
    uxConsistency = Math.max(0, 100 - penalty);
  }

  // Accessibilité : pénalité réelle des findings responsive/a11y page par page.
  const accessibility =
    orderedPages.length === 0
      ? null
      : Math.round(
          orderedPages.reduce((sum, page) => sum + Math.max(0, 100 - pagePenalty(page.responsiveFindings)), 0) /
            orderedPages.length
        );

  // Recommandations : uniquement les sous-scores réellement mesurés < seuil.
  const recommendations: FullDesignAuditRecommendation[] = [];
  for (const page of orderedPages) {
    for (const score of page.aqs.subScores) {
      if (score.value === null || score.value >= FULL_AUDIT_RECOMMENDATION_THRESHOLD) continue;
      recommendations.push({
        dimension: score.id,
        page: page.path,
        message: `${score.label} mesuré ${score.value}/100 sur ${page.path}`,
        severity: score.value < 60 ? 'HIGH' : score.value < 70 ? 'MEDIUM' : 'LOW'
      });
    }
  }
  recommendations.sort((a, b) => {
    if (a.page !== b.page) return a.page.localeCompare(b.page);
    return a.dimension.localeCompare(b.dimension);
  });

  const rules = orderedPages.reduce<FullDesignAuditRuleSummary>(
    (acc, page) => ({
      total: acc.total + page.ruleSummary.total,
      pass: acc.pass + page.ruleSummary.pass,
      fail: acc.fail + page.ruleSummary.fail,
      unknown: acc.unknown + page.ruleSummary.unknown
    }),
    { total: 0, pass: 0, fail: 0, unknown: 0 }
  );

  const breakpointSet = new Set<string>();
  for (const page of orderedPages) {
    breakpointSet.add(breakpointLabel('desktop', page.viewports.desktop));
    breakpointSet.add(breakpointLabel('mobile', page.viewports.mobile));
  }

  return {
    pagesAnalyzed: orderedPages.length,
    pagesMeasured: measuredPages.length,
    breakpoints: Array.from(breakpointSet),
    globalDesignQuality,
    designHarmony,
    aestheticQuality,
    designDrift,
    uxConsistency,
    accessibility,
    recommendations: recommendations.slice(0, 12),
    rules
  };
}

/** Moyenne de couverture réelle des pages mesurées (0..1) — preuve d'honnêteté. */
export function fullAuditCoverage(pages: readonly FullDesignAuditPageInput[]): number {
  const measured = pages.filter((page) => page.aqs.overall !== null);
  if (measured.length === 0) return 0;
  const average = measured.reduce((sum, page) => sum + page.aqs.coverage, 0) / measured.length;
  return Math.round(average * 100) / 100;
}
