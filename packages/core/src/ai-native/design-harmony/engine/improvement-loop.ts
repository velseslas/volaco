/**
 * VibeCode Core - Design Harmony
 * CDC V8 §17/§18 — VISUAL AUTO-IMPROVEMENT ENGINE / ITERATIVE OPTIMIZATION.
 *
 * Boucle réelle :
 *   ANALYZE → CRITIQUE → SCORE (AQS) → IDENTIFY WEAKNESSES
 *   → GENERATE IMPROVEMENT PLAN → MODIFY → RENDER → COMPARE → GATE.
 *
 * La boucle elle-même ne fait AUCUNE I/O : la mesure et la modification sont
 * injectées (`ImprovementLoopDeps`). La route API fournit le rendu Chromium
 * réel et le modifier LLM ; les tests fournissent des mesures/modifiers
 * contrôlés. Arrêt automatique (§18) :
 *  - quality target atteint ;
 *  - improvement delta < threshold (y compris <= 0) ;
 *  - borne d'itérations ;
 *  - aucune faiblesse mesurée ;
 *  - garde-fou §19 en échec (rollback) ;
 *  - score non mesurable / modification impossible.
 */

import { ImprovementPlanner } from './improvement-plan.js';
import { RegressionGuard } from './regression-guard.js';
import { VisualVersionComparator } from './version-compare.js';
import type {
  AestheticMeasurement,
  AestheticQualityScore,
  ImprovementHumanReport,
  ImprovementIteration,
  ImprovementLoopOptions,
  ImprovementLoopOutcome,
  ImprovementLoopStopReason,
  ImprovementPlan
} from '../types.js';

export const IMPROVEMENT_TARGET_DEFAULT = 90;
export const IMPROVEMENT_DELTA_THRESHOLD_DEFAULT = 2;
export const IMPROVEMENT_MAX_ITERATIONS_DEFAULT = 2;
/** Borne dure : la boucle ne peut jamais dépasser 4 modifications (§18 borné). */
export const IMPROVEMENT_MAX_ITERATIONS_LIMIT = 4;

export interface ImprovementLoopDeps {
  /** Mesure complète d'un HTML candidat (rendu réel + AQS + preuves). */
  measure(html: string): Promise<AestheticMeasurement>;
  /** Produit le HTML modifié pour traiter le plan, ou null si impossible. */
  modify(html: string, plan: ImprovementPlan): Promise<string | null>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class VisualImprovementLoop {
  constructor(
    private readonly planner: ImprovementPlanner = new ImprovementPlanner(),
    private readonly comparator: VisualVersionComparator = new VisualVersionComparator(),
    private readonly guard: RegressionGuard = new RegressionGuard()
  ) {}

  public async run(
    html: string,
    deps: ImprovementLoopDeps,
    options: ImprovementLoopOptions = {}
  ): Promise<ImprovementLoopOutcome> {
    const target = clamp(options.target ?? IMPROVEMENT_TARGET_DEFAULT, 0, 100);
    const deltaThreshold = Math.max(0, options.deltaThreshold ?? IMPROVEMENT_DELTA_THRESHOLD_DEFAULT);
    const maxIterations = clamp(
      Math.trunc(options.maxIterations ?? IMPROVEMENT_MAX_ITERATIONS_DEFAULT),
      1,
      IMPROVEMENT_MAX_ITERATIONS_LIMIT
    );
    const dimensionTolerance = Math.max(0, options.dimensionTolerance ?? 2);

    const initial = await deps.measure(html);
    const initialOverall = initial.aqs.overall;
    const iterations: ImprovementIteration[] = [];

    const outcome = (
      stopReason: ImprovementLoopStopReason,
      applied: boolean,
      finalHtml: string,
      finalAqs: AestheticQualityScore
    ): ImprovementLoopOutcome => ({
      iterations,
      initialOverall,
      finalOverall: finalAqs.overall,
      totalDelta: initialOverall !== null && finalAqs.overall !== null
        ? finalAqs.overall - initialOverall
        : null,
      target,
      targetReached: finalAqs.overall !== null && finalAqs.overall >= target,
      stopReason,
      applied,
      finalHtml
    });

    if (initialOverall === null) {
      // Aucune décision possible sans score : jamais de « 0 » de remplissage.
      return outcome('SCORE_UNMEASURABLE', false, html, initial.aqs);
    }
    if (initialOverall >= target) {
      return outcome('TARGET_REACHED', false, html, initial.aqs);
    }

    let currentHtml = html;
    let current: AestheticMeasurement = initial;
    let applied = false;
    let stopReason: ImprovementLoopStopReason = 'MAX_ITERATIONS';

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const plan = this.planner.plan(current, iteration, { target });
      if (plan.weaknesses.length === 0) {
        stopReason = 'NO_ACTIONABLE_WEAKNESS';
        break;
      }

      let candidate: string | null = null;
      try {
        candidate = await deps.modify(currentHtml, plan);
      } catch {
        candidate = null;
      }

      if (candidate === null || candidate.trim().length === 0) {
        iterations.push({
          iteration,
          plan,
          aqsBefore: current.aqs.overall,
          aqsAfter: null,
          delta: null,
          modified: false,
          guardVerdict: null,
          guards: [],
          comparison: null,
          report: buildReport(plan, current.aqs.overall, null, null),
          accepted: false,
          stopReason: 'MODIFICATION_FAILED'
        });
        stopReason = 'MODIFICATION_FAILED';
        break;
      }

      // RENDER → ANALYZE → CRITIQUE → SCORE : mesure réelle du candidat.
      const after = await deps.measure(candidate);
      const comparison = this.comparator.compare(current.aqs, after.aqs);
      const guardEvaluation = this.guard.evaluate({
        htmlBefore: currentHtml,
        htmlAfter: candidate,
        aqsBefore: current.aqs,
        aqsAfter: after.aqs,
        runtimeErrorsBefore: current.runtimeErrors,
        runtimeErrorsAfter: after.runtimeErrors,
        findingsBefore: current.responsiveFindings,
        findingsAfter: after.responsiveFindings,
        ...(current.mobileOverflow !== undefined ? { mobileOverflowBefore: current.mobileOverflow } : {}),
        ...(after.mobileOverflow !== undefined ? { mobileOverflowAfter: after.mobileOverflow } : {}),
        dimensionTolerance
      });

      const delta = comparison.scoreDelta;
      const guardApproved = guardEvaluation.verdict === 'APPROVE';
      const accepted = guardApproved && delta !== null && delta > 0;

      let iterationStop: ImprovementLoopStopReason | undefined;
      if (!guardApproved) iterationStop = 'REGRESSION_PROTECTED';
      else if (delta === null) iterationStop = 'SCORE_UNMEASURABLE';
      else if (delta <= 0 || delta < deltaThreshold) iterationStop = 'DELTA_BELOW_THRESHOLD';
      else if (after.aqs.overall !== null && after.aqs.overall >= target) iterationStop = 'TARGET_REACHED';

      iterations.push({
        iteration,
        plan,
        aqsBefore: current.aqs.overall,
        aqsAfter: after.aqs.overall,
        delta,
        modified: true,
        guardVerdict: guardEvaluation.verdict,
        guards: guardEvaluation.guards,
        comparison,
        report: buildReport(plan, current.aqs.overall, after.aqs.overall, delta),
        accepted,
        ...(iterationStop !== undefined ? { stopReason: iterationStop } : {})
      });

      if (accepted) {
        applied = true;
        currentHtml = candidate;
        current = after;
      }

      if (iterationStop !== undefined) {
        stopReason = iterationStop;
        break;
      }
    }

    // §19 — si le dernier candidat a été refusé, le HTML retourné reste
    // l'état accepté (rollback déjà effectué logiquement, aucune écriture).
    return outcome(stopReason, applied, applied ? currentHtml : html, current.aqs);
  }
}

/** §21 — rapport WHY / WHAT / IMPACT / BEFORE / AFTER / SCORE DELTA / RISKS. */
function buildReport(
  plan: ImprovementPlan,
  before: number | null,
  after: number | null,
  delta: number | null
): ImprovementHumanReport {
  const potential = Math.round(
    plan.weaknesses.reduce((sum, weakness) => sum + weakness.potentialGain, 0) * 10
  ) / 10;
  const realGain = delta === null ? 'non mesurable' : `${delta >= 0 ? '+' : ''}${delta} pt(s)`;
  const risks: string[] = [];
  for (const proposal of plan.proposals) {
    for (const risk of proposal.risks) {
      if (!risks.includes(risk)) risks.push(risk);
    }
  }
  return {
    why: plan.proposals.map((proposal) => proposal.why),
    what: plan.proposals.map((proposal) => proposal.what),
    impact: `Gain AQS potentiel estimé : +${potential.toFixed(1)} pt(s) ; gain réel mesuré : ${realGain}.`,
    before,
    after,
    scoreDelta: delta,
    risks
  };
}
