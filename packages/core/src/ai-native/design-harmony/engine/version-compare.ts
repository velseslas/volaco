/**
 * VibeCode Core - Design Harmony
 * CDC V8 §20 — VISUAL VERSION COMPARISON (Version A vs Version B).
 *
 * Compare deux mesures AQS RÉELLES sur les dimensions demandées par le CDC
 * (score, layout, hiérarchie, couleurs, spacing, composants, responsive) et
 * conclut au format du CDC : « Version B improves: +8 hierarchy… No regression
 * detected. Recommendation: ACCEPT. »
 *
 * Honnêteté : une dimension n'est comparable que si AU MOINS une de ses
 * sources AQS est mesurée des DEUX côtés ; sinon son delta vaut null (UNKNOWN)
 * — jamais 0 par défaut.
 */

import type {
  AestheticQualityScore,
  AqsDimensionId,
  AqsSubScore,
  VisualVersionComparison,
  VisualVersionDimensionDelta,
  VisualVersionDimensionId,
  VisualVersionRecommendation
} from '../types.js';

interface VersionDimensionDefinition {
  readonly id: VisualVersionDimensionId;
  readonly label: string;
  /** Sous-scores AQS agrégés (moyenne des sources comparables). */
  readonly sources: readonly AqsDimensionId[];
}

/**
 * Mapping explicite des dimensions de comparaison du CDC vers l'AQS.
 * `layout` agrège composition + équilibre visuel ; `typography` est inclus
 * car l'exemple de conclusion du CDC cite « +3 typography ».
 */
export const VERSION_COMPARISON_DIMENSIONS: readonly VersionDimensionDefinition[] = [
  { id: 'score', label: 'Score global', sources: [] },
  { id: 'hierarchy', label: 'Hierarchy', sources: ['visual_hierarchy'] },
  { id: 'layout', label: 'Layout', sources: ['composition', 'visual_balance'] },
  { id: 'colors', label: 'Colors', sources: ['color_harmony'] },
  { id: 'spacing', label: 'Spacing', sources: ['spacing_rhythm'] },
  { id: 'components', label: 'Components', sources: ['component_quality'] },
  { id: 'typography', label: 'Typography', sources: ['typography'] },
  { id: 'responsive', label: 'Responsive', sources: ['responsive_quality'] }
];

function valueOf(score: AestheticQualityScore, dimension: AqsDimensionId): number | null {
  const sub: AqsSubScore | undefined = score.subScores.find((s) => s.id === dimension);
  return sub && sub.value !== null ? sub.value : null;
}

export class VisualVersionComparator {
  /**
   * §20 — comparaison A/B déterministe. `before` = Version A, `after` = B.
   */
  public compare(before: AestheticQualityScore, after: AestheticQualityScore): VisualVersionComparison {
    const scoreDelta = before.overall !== null && after.overall !== null
      ? after.overall - before.overall
      : null;

    const dimensions: VisualVersionDimensionDelta[] = VERSION_COMPARISON_DIMENSIONS.map((def) => {
      if (def.id === 'score') {
        return {
          id: def.id,
          label: def.label,
          sources: [],
          before: before.overall,
          after: after.overall,
          delta: scoreDelta,
          comparableSources: []
        };
      }
      const comparable = def.sources.filter(
        (source) => valueOf(before, source) !== null && valueOf(after, source) !== null
      );
      if (comparable.length === 0) {
        return {
          id: def.id,
          label: def.label,
          sources: def.sources,
          before: null,
          after: null,
          delta: null,
          comparableSources: []
        };
      }
      const beforeAvg = comparable.reduce((sum, source) => sum + valueOf(before, source)!, 0) / comparable.length;
      const afterAvg = comparable.reduce((sum, source) => sum + valueOf(after, source)!, 0) / comparable.length;
      const beforeRounded = Math.round(beforeAvg);
      const afterRounded = Math.round(afterAvg);
      return {
        id: def.id,
        label: def.label,
        sources: def.sources,
        before: beforeRounded,
        after: afterRounded,
        delta: afterRounded - beforeRounded,
        comparableSources: comparable
      };
    });

    // Le score global est comparé à part (scoreDelta) : les phrases du CDC
    // ne listent que les dimensions visuelles.
    const visual = dimensions.filter((d) => d.id !== 'score');
    const improvements = visual
      .filter((d) => d.delta !== null && d.delta > 0)
      .map((d) => `+${d.delta} ${d.id}`);
    const regressions = visual
      .filter((d) => d.delta !== null && d.delta < 0)
      .map((d) => `${d.delta} ${d.id}`);
    const noRegressionDetected = regressions.length === 0;

    const recommendation: VisualVersionRecommendation = (() => {
      if (scoreDelta !== null && scoreDelta > 0 && noRegressionDetected) return 'ACCEPT';
      if ((scoreDelta !== null && scoreDelta < 0) || !noRegressionDetected) return 'REJECT';
      return 'KEEP';
    })();

    return {
      beforeOverall: before.overall,
      afterOverall: after.overall,
      scoreDelta,
      dimensions,
      improvements,
      regressions,
      noRegressionDetected,
      recommendation,
      conclusion: buildConclusion(recommendation, improvements, regressions, scoreDelta)
    };
  }
}

function buildConclusion(
  recommendation: VisualVersionRecommendation,
  improvements: readonly string[],
  regressions: readonly string[],
  scoreDelta: number | null
): string {
  if (recommendation === 'ACCEPT') {
    const improved = improvements.length > 0
      ? improvements.join(', ')
      : `overall score (${scoreDelta !== null && scoreDelta > 0 ? '+' : ''}${scoreDelta ?? '?'})`;
    return `Version B improves: ${improved}. No regression detected. Recommendation: ACCEPT.`;
  }
  if (recommendation === 'REJECT') {
    const parts: string[] = [];
    if (improvements.length > 0) parts.push(`Version B improves: ${improvements.join(', ')}.`);
    if (regressions.length > 0) parts.push(`Version B regresses: ${regressions.join(', ')}.`);
    else if (scoreDelta !== null && scoreDelta < 0) parts.push(`Version B lowers the overall score (${scoreDelta}).`);
    parts.push('Recommendation: REJECT.');
    return parts.join(' ');
  }
  return 'No measurable improvement: versions are equivalent on measured dimensions. Recommendation: KEEP.';
}
