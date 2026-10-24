/**
 * VibeCode Core - Design Harmony
 * CDC V8 §19 — REGRESSION PROTECTION.
 *
 * Une amélioration esthétique ne doit jamais casser : fonctionnalité,
 * accessibilité, responsive, performance, sécurité, logique métier.
 * Pipeline du CDC : DESIGN IMPROVEMENT → FUNCTIONAL VALIDATION →
 * ACCESSIBILITY → SECURITY → REGRESSION → APPROVE.
 *
 * Chaque garde-fou s'appuie sur des preuves avant/après RÉELLES :
 *  - FUNCTIONAL  : erreurs runtime observées au rendu (nouvelles = FAIL) ;
 *  - ACCESSIBILITY : nouvelles findings a11y HIGH/CRITICAL ;
 *  - SECURITY    : nouveaux motifs de code dangereux introduits ;
 *  - RESPONSIVE  : overflow mobile apparu + nouvelles findings responsive ;
 *  - REGRESSION  : aucune dimension AQS ni le score global ne recule au-delà
 *                  de la tolérance ; la couverture de preuves ne s'effondre
 *                  pas (sinon le score deviendrait complaisant).
 *
 * Les ids des findings ne sont jamais utilisés comme clé (certains moteurs
 * historiques génèrent des ids non déterministes) : la clé canonique est
 * catégorie + propriété + sélecteur + valeur observée.
 */

import { AQS_DIMENSION_ORDER } from './aqs-engine.js';
import type {
  AestheticQualityScore,
  AqsDimensionId,
  DesignHarmonyFinding,
  RegressionGuardEvaluation,
  RegressionGuardInput,
  RegressionGuardResult
} from '../types.js';

export const DEFAULT_DIMENSION_TOLERANCE = 2;
/** Une perte de couverture > 25 points de pourcentage masque une régression. */
export const COVERAGE_REGRESSION_THRESHOLD = 0.25;

interface SecurityPattern {
  readonly id: string;
  readonly pattern: RegExp;
}

const SECURITY_PATTERNS: readonly SecurityPattern[] = [
  { id: 'eval()', pattern: /eval\s*\(/g },
  { id: 'new Function()', pattern: /new\s+Function\s*\(/g },
  { id: 'document.write()', pattern: /document\.write\s*\(/g },
  { id: 'javascript: URL', pattern: /javascript\s*:/gi }
];

export interface AqsDimensionRegression {
  readonly dimension: AqsDimensionId;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly regressed: boolean;
}

export interface AqsNonRegressionResult {
  readonly regressed: boolean;
  readonly overallDelta: number | null;
  readonly coverageDelta: number;
  readonly dimensionDeltas: readonly AqsDimensionRegression[];
  readonly reasons: readonly string[];
}

/**
 * §19 — non-régression AQS, réutilisée par la boucle d'amélioration ET par
 * la réparation (gate design post-patch). Seules les dimensions mesurées des
 * DEUX côtés sont comparées ; une dimension devenue UNKNOWN est couverte par
 * le contrôle de couverture (on ne prétend pas mesurer l'invisible).
 */
export function evaluateAqsNonRegression(
  before: AestheticQualityScore,
  after: AestheticQualityScore,
  tolerance: number = DEFAULT_DIMENSION_TOLERANCE
): AqsNonRegressionResult {
  const dimensionDeltas: AqsDimensionRegression[] = [];
  for (const dimension of AQS_DIMENSION_ORDER) {
    const beforeValue = before.subScores.find((s) => s.id === dimension)?.value ?? null;
    const afterValue = after.subScores.find((s) => s.id === dimension)?.value ?? null;
    if (beforeValue === null || afterValue === null) continue;
    const delta = afterValue - beforeValue;
    dimensionDeltas.push({
      dimension,
      before: beforeValue,
      after: afterValue,
      delta,
      regressed: delta < -tolerance
    });
  }

  const overallDelta = before.overall !== null && after.overall !== null
    ? after.overall - before.overall
    : null;
  const coverageDelta = Math.round((after.coverage - before.coverage) * 100) / 100;

  const reasons: string[] = [];
  for (const entry of dimensionDeltas) {
    if (entry.regressed) {
      reasons.push(`${entry.dimension} régresse de ${entry.delta} pts (${entry.before} → ${entry.after})`);
    }
  }
  if (overallDelta !== null && overallDelta < -tolerance) {
    reasons.push(`score global en baisse de ${overallDelta} pts (${before.overall} → ${after.overall})`);
  }
  if (coverageDelta < -COVERAGE_REGRESSION_THRESHOLD) {
    reasons.push(
      `couverture des preuves en baisse de ${Math.round(coverageDelta * 100)} pts ` +
      `(${Math.round(before.coverage * 100)} % → ${Math.round(after.coverage * 100)} %)`
    );
  }

  return {
    regressed: reasons.length > 0,
    overallDelta,
    coverageDelta,
    dimensionDeltas,
    reasons
  };
}

function findingKey(finding: DesignHarmonyFinding): string {
  return [finding.category, finding.property, finding.selector ?? '', String(finding.observedValue)].join('|');
}

const CRITICAL_SEVERITIES = new Set(['HIGH', 'CRITICAL']);

function newSevereFindings(
  before: readonly DesignHarmonyFinding[],
  after: readonly DesignHarmonyFinding[],
  category: DesignHarmonyFinding['category']
): DesignHarmonyFinding[] {
  const known = new Set(before.filter((f) => f.category === category).map(findingKey));
  return after.filter(
    (f) => f.category === category && CRITICAL_SEVERITIES.has(f.severity) && !known.has(findingKey(f))
  );
}

function countPattern(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

export class RegressionGuard {
  /** §19 — évalue le pipeline complet et rend APPROVE ou ROLLBACK. */
  public evaluate(input: RegressionGuardInput): RegressionGuardEvaluation {
    const tolerance = input.dimensionTolerance ?? DEFAULT_DIMENSION_TOLERANCE;
    const guards: RegressionGuardResult[] = [
      this.functional(input),
      this.accessibility(input),
      this.security(input),
      this.responsive(input),
      this.regression(input, tolerance)
    ];

    const failed = guards.filter((g) => g.status === 'FAIL');
    return {
      verdict: failed.length > 0 ? 'ROLLBACK' : 'APPROVE',
      guards,
      reasons: failed.map((g) => g.summary)
    };
  }

  private functional(input: RegressionGuardInput): RegressionGuardResult {
    const known = new Set(input.runtimeErrorsBefore);
    const fresh = [...new Set(input.runtimeErrorsAfter.filter((error) => !known.has(error)))];
    const evidence = [
      `erreurs runtime avant=${input.runtimeErrorsBefore.length}, après=${input.runtimeErrorsAfter.length}`,
      ...fresh.slice(0, 5).map((error) => `nouvelle erreur : ${error}`)
    ];
    return fresh.length > 0
      ? {
          guard: 'FUNCTIONAL',
          status: 'FAIL',
          summary: `${fresh.length} nouvelle(s) erreur(s) runtime introduite(s) par la modification`,
          evidence
        }
      : {
          guard: 'FUNCTIONAL',
          status: 'PASS',
          summary: 'Aucune nouvelle erreur runtime',
          evidence
        };
  }

  private accessibility(input: RegressionGuardInput): RegressionGuardResult {
    const fresh = newSevereFindings(input.findingsBefore, input.findingsAfter, 'ACCESSIBILITY');
    const evidence = [
      `findings a11y avant=${input.findingsBefore.filter((f) => f.category === 'ACCESSIBILITY').length}, ` +
      `après=${input.findingsAfter.filter((f) => f.category === 'ACCESSIBILITY').length}`,
      ...fresh.slice(0, 5).map((f) => `nouvelle finding ${f.severity} : ${f.property} (${f.observedValue})`)
    ];
    return fresh.length > 0
      ? {
          guard: 'ACCESSIBILITY',
          status: 'FAIL',
          summary: `${fresh.length} nouvelle(s) finding(s) d'accessibilité HIGH/CRITICAL`,
          evidence
        }
      : {
          guard: 'ACCESSIBILITY',
          status: 'PASS',
          summary: "Aucune nouvelle finding d'accessibilité grave",
          evidence
        };
  }

  private security(input: RegressionGuardInput): RegressionGuardResult {
    const evidence: string[] = [];
    let introduced = 0;
    for (const { id, pattern } of SECURITY_PATTERNS) {
      const before = countPattern(input.htmlBefore, pattern);
      const after = countPattern(input.htmlAfter, pattern);
      if (after > before) {
        introduced += after - before;
        evidence.push(`${id} : ${before} → ${after}`);
      }
    }
    return introduced > 0
      ? {
          guard: 'SECURITY',
          status: 'FAIL',
          summary: `${introduced} motif(s) de code à risque introduit(s)`,
          evidence
        }
      : {
          guard: 'SECURITY',
          status: 'PASS',
          summary: 'Aucun nouveau motif de code à risque (eval/Function/document.write/javascript:)',
          evidence: ['aucun motif à risque ajouté']
        };
  }

  private responsive(input: RegressionGuardInput): RegressionGuardResult {
    const fresh = newSevereFindings(input.findingsBefore, input.findingsAfter, 'RESPONSIVE');
    const overflowIntroduced = input.mobileOverflowBefore?.overflowX === false
      && input.mobileOverflowAfter?.overflowX === true;
    const evidence: string[] = [];
    if (input.mobileOverflowBefore !== undefined || input.mobileOverflowAfter !== undefined) {
      evidence.push(
        `overflow mobile avant=${input.mobileOverflowBefore?.overflowX ?? 'non mesuré'}, ` +
        `après=${input.mobileOverflowAfter?.overflowX ?? 'non mesuré'}`
      );
    }
    evidence.push(
      `findings responsive avant=${input.findingsBefore.filter((f) => f.category === 'RESPONSIVE').length}, ` +
      `après=${input.findingsAfter.filter((f) => f.category === 'RESPONSIVE').length}`
    );
    evidence.push(...fresh.slice(0, 5).map((f) => `nouvelle finding ${f.severity} : ${f.property} (${f.observedValue})`));

    if (overflowIntroduced || fresh.length > 0) {
      return {
        guard: 'RESPONSIVE',
        status: 'FAIL',
        summary: overflowIntroduced
          ? 'débordement horizontal mobile introduit'
          : `${fresh.length} nouvelle(s) finding(s) responsive HIGH/CRITICAL`,
        evidence
      };
    }
    if (input.mobileOverflowBefore === undefined && input.mobileOverflowAfter === undefined && input.findingsBefore.length === 0 && input.findingsAfter.length === 0) {
      return {
        guard: 'RESPONSIVE',
        status: 'UNKNOWN',
        summary: 'Aucune preuve mobile disponible (overflow et findings absents)',
        evidence
      };
    }
    return {
      guard: 'RESPONSIVE',
      status: 'PASS',
      summary: 'Aucun débordement mobile ni nouvelle finding responsive grave',
      evidence
    };
  }

  private regression(input: RegressionGuardInput, tolerance: number): RegressionGuardResult {
    const result = evaluateAqsNonRegression(input.aqsBefore, input.aqsAfter, tolerance);
    const evidence = [
      `score global : ${input.aqsBefore.overall ?? 'UNKNOWN'} → ${input.aqsAfter.overall ?? 'UNKNOWN'}`,
      `couverture : ${Math.round(input.aqsBefore.coverage * 100)} % → ${Math.round(input.aqsAfter.coverage * 100)} %`,
      ...result.reasons
    ];
    return result.regressed
      ? {
          guard: 'REGRESSION',
          status: 'FAIL',
          summary: `régression AQS détectée : ${result.reasons.join(' ; ')}`,
          evidence
        }
      : {
          guard: 'REGRESSION',
          status: 'PASS',
          summary: `Aucune régression AQS au-delà de ${tolerance} pts (tolérance)`,
          evidence
        };
  }
}
