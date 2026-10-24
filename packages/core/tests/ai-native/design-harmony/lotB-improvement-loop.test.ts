/**
 * LOT B — CDC V8 §17-§21 : boucle d'amélioration, garde-fous anti-régression,
 * comparaison de versions, contrôle humain (preuves core, sans I/O).
 *
 * Prouve que :
 *  1. le plan §21 est dérivé des seuls sous-scores MESURÉS (tri par gain
 *     potentiel réel, WHY/WHAT/IMPACT/RISKS, id déterministe) ;
 *  2. le comparateur §20 conclut au format du CDC (+8 hierarchy, no
 *     regression, ACCEPT) et refuse les régressions ;
 *  3. les garde-fous §19 détectent erreurs runtime, findings a11y, code à
 *     risque et régression AQS — verdict APPROVE/ROLLBACK ;
 *  4. la boucle §17/§18 s'arrête sur cible, delta < seuil, borne, garde-fou
 *     (rollback réel) ou modification impossible — et reste déterministe.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AQS_DIMENSION_ORDER,
  AQS_WEIGHTS,
  ImprovementPlanner,
  RegressionGuard,
  VisualImprovementLoop,
  VisualVersionComparator,
  evaluateAqsNonRegression,
  type AestheticMeasurement,
  type AestheticQualityScore,
  type AqsDimensionId,
  type AqsSubScore,
  type DesignHarmonyFinding,
  type RegressionGuardInput
} from '../../../src/index.js';

/** AQS synthétique : chaque dimension vaut `base` sauf surcharge explicite. */
function aqsOf(values: Partial<Record<AqsDimensionId, number | null>>, base = 90): AestheticQualityScore {
  const subScores: AqsSubScore[] = AQS_DIMENSION_ORDER.map((id) => {
    const value = Object.prototype.hasOwnProperty.call(values, id) ? values[id]! : base;
    if (value === null) {
      return { id, label: id, value: null, confidence: 0, evidence: [], unknownReason: 'test UNKNOWN' };
    }
    return { id, label: id, value, confidence: 0.8, evidence: ['preuve de test'] };
  });
  let weighted = 0;
  let covered = 0;
  for (const sub of subScores) {
    if (sub.value === null) continue;
    weighted += sub.value * AQS_WEIGHTS[sub.id];
    covered += AQS_WEIGHTS[sub.id];
  }
  return {
    version: '8.0',
    determinism: 'DETERMINISTIC',
    overall: covered > 0 ? Math.round(weighted / covered) : null,
    subScores,
    computedCount: subScores.filter((s) => s.value !== null).length,
    unknownCount: subScores.filter((s) => s.value === null).length,
    coverage: Math.round(covered * 100) / 100
  };
}

function aqsUniform(value: number): AestheticQualityScore {
  return aqsOf({}, value);
}

function measurementOf(
  aqs: AestheticQualityScore,
  extra: Partial<AestheticMeasurement> = {}
): AestheticMeasurement {
  return {
    aqs,
    critique: { axes: [], findings: [], coverage: 0, layoutSource: 'ESTIMATED', evaluatedAt: '2026-10-19T00:00:00.000Z' },
    responsiveFindings: [],
    runtimeErrors: [],
    ...extra
  };
}

function finding(over: Partial<DesignHarmonyFinding> = {}): DesignHarmonyFinding {
  return {
    id: 'finding-test',
    category: 'ACCESSIBILITY',
    severity: 'HIGH',
    confidence: 0.9,
    pageRoute: '/',
    property: 'contrastRatio',
    observedValue: '2.1',
    evidence: [],
    recommendation: 'Corriger le contraste',
    designDrift: false,
    ...over
  };
}

function guardInput(over: Partial<RegressionGuardInput> = {}): RegressionGuardInput {
  return {
    htmlBefore: '<html><body><p>Avant</p></body></html>',
    htmlAfter: '<html><body><p>Après</p></body></html>',
    aqsBefore: aqsUniform(80),
    aqsAfter: aqsUniform(85),
    runtimeErrorsBefore: [],
    runtimeErrorsAfter: [],
    findingsBefore: [],
    findingsAfter: [],
    mobileOverflowBefore: { overflowX: false, wideElements: 0 },
    mobileOverflowAfter: { overflowX: false, wideElements: 0 },
    ...over
  };
}

describe('LOT B §17/§21 — planificateur de faiblesses', () => {
  it('1. trie les faiblesses par gain potentiel réel et produit WHY/WHAT/IMPACT/RISKS', () => {
    const planner = new ImprovementPlanner();
    const measurement = measurementOf(aqsOf({
      visual_hierarchy: 54,
      spacing_rhythm: 40,
      typography: 92
    }));

    const plan = planner.plan(measurement, 1, { target: 90 });
    assert.deepEqual(
      plan.weaknesses.map((w) => w.dimension),
      ['visual_hierarchy', 'spacing_rhythm']
    );
    const hierarchy = plan.weaknesses[0]!;
    assert.equal(hierarchy.weight, AQS_WEIGHTS.visual_hierarchy);
    assert.equal(hierarchy.potentialGain, Math.round(AQS_WEIGHTS.visual_hierarchy * 36 * 10) / 10);
    const spacing = plan.weaknesses[1]!;
    assert.equal(spacing.potentialGain, Math.round(AQS_WEIGHTS.spacing_rhythm * 50 * 10) / 10);
    assert.equal(plan.planId, 'imp-1-visual_hierarchy+spacing_rhythm');

    const proposal = plan.proposals[0]!;
    assert.ok(proposal.why.includes('54/100'), 'le WHY cite la valeur mesurée');
    assert.ok(proposal.what.length > 20, 'le WHAT décrit le levier visuel');
    assert.ok(proposal.impact.includes('+'), "l'IMPACT chiffre le gain potentiel");
    assert.ok(proposal.risks.length >= 1, 'les RISKS sont listés');

    // Déterminisme : même mesure => même plan (aucun Math.random).
    assert.deepEqual(planner.plan(measurement, 1, { target: 90 }), plan);
  });

  it('2. second rideau : si aucune dimension sous 80, vise les dimensions sous la cible', () => {
    const planner = new ImprovementPlanner();
    const plan = planner.plan(measurementOf(aqsOf({ typography: 88, spacing_rhythm: 85 }, 95)), 2, { target: 90 });
    assert.deepEqual(plan.weaknesses.map((w) => w.dimension), ['spacing_rhythm', 'typography']);
    assert.ok(plan.weaknesses.every((w) => w.potentialGain > 0));
  });
});

describe('LOT B §20 — comparaison de versions A/B', () => {
  it('3. cas CDC : version B améliore hiérarchie/spacing/typographie -> ACCEPT', () => {
    const comparator = new VisualVersionComparator();
    const before = aqsOf({ visual_hierarchy: 80, spacing_rhythm: 82, typography: 88 });
    const after = aqsOf({ visual_hierarchy: 88, spacing_rhythm: 87, typography: 91 });
    const comparison = comparator.compare(before, after);

    assert.ok(comparison.scoreDelta !== null && comparison.scoreDelta > 0);
    assert.deepEqual(comparison.improvements, ['+8 hierarchy', '+5 spacing', '+3 typography']);
    assert.deepEqual(comparison.regressions, []);
    assert.equal(comparison.noRegressionDetected, true);
    assert.equal(comparison.recommendation, 'ACCEPT');
    assert.equal(
      comparison.conclusion,
      'Version B improves: +8 hierarchy, +5 spacing, +3 typography. No regression detected. Recommendation: ACCEPT.'
    );
    // Chaque delta de dimension est comparable des deux côtés (sources réelles).
    const spacing = comparison.dimensions.find((d) => d.id === 'spacing')!;
    assert.deepEqual(spacing.comparableSources, ['spacing_rhythm']);
    assert.equal(spacing.delta, 5);
  });

  it('4. une dimension qui recule -> REJECT avec liste explicite', () => {
    const comparator = new VisualVersionComparator();
    const comparison = comparator.compare(
      aqsOf({ visual_hierarchy: 80, spacing_rhythm: 90 }),
      aqsOf({ visual_hierarchy: 85, spacing_rhythm: 84 })
    );
    assert.equal(comparison.noRegressionDetected, false);
    assert.deepEqual(comparison.regressions, ['-6 spacing']);
    assert.equal(comparison.recommendation, 'REJECT');
    assert.ok(comparison.conclusion.includes('Version B regresses: -6 spacing.'));
    assert.ok(comparison.conclusion.endsWith('Recommendation: REJECT.'));
  });

  it('5. versions équivalentes -> KEEP ; dimension non comparable -> delta null (jamais 0 inventé)', () => {
    const comparator = new VisualVersionComparator();
    const keep = comparator.compare(aqsUniform(88), aqsUniform(88));
    assert.equal(keep.recommendation, 'KEEP');
    assert.ok(keep.conclusion.includes('Recommendation: KEEP.'));

    const before = aqsOf({ responsive_quality: null });
    const after = aqsOf({ responsive_quality: 70 });
    const mixed = comparator.compare(before, after);
    const responsive = mixed.dimensions.find((d) => d.id === 'responsive')!;
    assert.equal(responsive.delta, null);
    assert.equal(responsive.before, null);
    assert.deepEqual(responsive.comparableSources, []);
  });
});

describe('LOT B §19 — garde-fous anti-régression', () => {
  it('6. corrige une régression AQS au-delà de la tolérance, tolère le bruit', () => {
    const small = evaluateAqsNonRegression(aqsofDim('visual_hierarchy', 80), aqsofDim('visual_hierarchy', 79), 2);
    assert.equal(small.regressed, false, 'une baisse de 1 pt reste dans la tolérance');

    const real = evaluateAqsNonRegression(aqsofDim('visual_hierarchy', 80), aqsofDim('visual_hierarchy', 72), 2);
    assert.equal(real.regressed, true);
    assert.ok(real.reasons[0]!.includes('visual_hierarchy'));
    assert.equal(real.dimensionDeltas.find((d) => d.dimension === 'visual_hierarchy')!.delta, -8);

    // Couverture effondrée : des preuves ont disparu -> régression signalée.
    const coverage = evaluateAqsNonRegression(aqsCoverage(0.9), aqsCoverage(0.5), 2);
    assert.equal(coverage.regressed, true);
    assert.ok(coverage.reasons.some((r) => r.includes('couverture')));

    function aqsofDim(id: AqsDimensionId, value: number): AestheticQualityScore {
      return aqsOf({ [id]: value } as Partial<Record<AqsDimensionId, number>>);
    }
    function aqsCoverage(coverage: number): AestheticQualityScore {
      const base = aqsOf({}, 85);
      return { ...base, coverage };
    }
  });

  it("7. pipeline §19 : nouvelle erreur runtime, finding a11y, code à risque, overflow -> ROLLBACK", () => {
    const guard = new RegressionGuard();

    const clean = guard.evaluate(guardInput());
    assert.equal(clean.verdict, 'APPROVE');
    assert.ok(clean.guards.every((g) => g.status === 'PASS'));

    const broken = guard.evaluate(guardInput({
      runtimeErrorsAfter: ['TypeError: boom']
    }));
    assert.equal(broken.verdict, 'ROLLBACK');
    assert.equal(broken.guards.find((g) => g.guard === 'FUNCTIONAL')!.status, 'FAIL');

    const a11y = guard.evaluate(guardInput({
      findingsAfter: [finding({ property: 'contrastRatio', observedValue: '2.1', severity: 'HIGH' })]
    }));
    assert.equal(a11y.guards.find((g) => g.guard === 'ACCESSIBILITY')!.status, 'FAIL');

    const security = guard.evaluate(guardInput({
      htmlAfter: '<html><body><script>eval("x")</script></body></html>'
    }));
    assert.equal(security.guards.find((g) => g.guard === 'SECURITY')!.status, 'FAIL');

    const responsive = guard.evaluate(guardInput({
      mobileOverflowAfter: { overflowX: true, wideElements: 3 }
    }));
    assert.equal(responsive.guards.find((g) => g.guard === 'RESPONSIVE')!.status, 'FAIL');

    // Le pipeline complet reste dans l'ordre du CDC.
    assert.deepEqual(broken.guards.map((g) => g.guard), ['FUNCTIONAL', 'ACCESSIBILITY', 'SECURITY', 'RESPONSIVE', 'REGRESSION']);
  });
});

describe('LOT B §17/§18 — boucle d’amélioration bornée', () => {
  const html0 = '<html><body>v0</body></html>';
  const cand1 = '<html><body>v1</body></html>';
  const cand2 = '<html><body>v2</body></html>';

  function depsFrom(map: Record<string, AestheticMeasurement>, patches: Record<string, string | null>) {
    return {
      measure: async (html: string): Promise<AestheticMeasurement> => {
        const found = map[html];
        if (!found) throw new Error(`mesure non prévue pour ${html}`);
        return found;
      },
      modify: async (html: string): Promise<string | null> =>
        Object.prototype.hasOwnProperty.call(patches, html) ? patches[html]! : null
    };
  }

  it('8. itère jusqu’à la cible et s’arrête (TARGET_REACHED), déterminisme vérifié', async () => {
    const loop = new VisualImprovementLoop();
    const map = {
      [html0]: measurementOf(aqsUniform(70)),
      [cand1]: measurementOf(aqsUniform(82)),
      [cand2]: measurementOf(aqsUniform(91))
    };
    const deps = depsFrom(map, { [html0]: cand1, [cand1]: cand2 });

    const outcome = await loop.run(html0, deps, { target: 90, maxIterations: 3 });
    assert.equal(outcome.stopReason, 'TARGET_REACHED');
    assert.equal(outcome.applied, true);
    assert.equal(outcome.initialOverall, 70);
    assert.equal(outcome.finalOverall, 91);
    assert.equal(outcome.totalDelta, 21);
    assert.equal(outcome.finalHtml, cand2);
    assert.equal(outcome.iterations.length, 2);
    assert.equal(outcome.iterations[0]!.comparison!.scoreDelta, 12);
    assert.equal(outcome.iterations[0]!.accepted, true);
    assert.equal(outcome.iterations[1]!.stopReason, 'TARGET_REACHED');
    assert.equal(outcome.iterations[1]!.report.before, 82);
    assert.equal(outcome.iterations[1]!.report.after, 91);
    assert.equal(outcome.iterations[1]!.report.scoreDelta, 9);
    assert.ok(outcome.iterations[1]!.report.why.length >= 1);

    // Déterminisme : mêmes entrées => même issue complète.
    const again = await loop.run(html0, deps, { target: 90, maxIterations: 3 });
    assert.deepEqual(again, outcome);
  });

  it('9. delta sous le seuil -> le gain est conservé puis la boucle s’arrête', async () => {
    const loop = new VisualImprovementLoop();
    const cand = '<html><body>v1</body></html>';
    const deps = depsFrom(
      { [html0]: measurementOf(aqsUniform(70)), [cand]: measurementOf(aqsUniform(71)) },
      { [html0]: cand }
    );
    const outcome = await loop.run(html0, deps, { target: 90, deltaThreshold: 2, maxIterations: 2 });
    assert.equal(outcome.stopReason, 'DELTA_BELOW_THRESHOLD');
    assert.equal(outcome.applied, true);
    assert.equal(outcome.finalOverall, 71);
    assert.equal(outcome.finalHtml, cand);
    assert.equal(outcome.iterations[0]!.accepted, true);
  });

  it('10. garde-fou en échec -> rollback réel : aucun HTML dégradé n’est conservé', async () => {
    const loop = new VisualImprovementLoop();
    const cand = '<html><body>régression</body></html>';
    const deps = depsFrom(
      {
        [html0]: measurementOf(aqsUniform(70)),
        [cand]: measurementOf(aqsUniform(85), { runtimeErrors: ['TypeError: cassé'] })
      },
      { [html0]: cand }
    );
    const outcome = await loop.run(html0, deps, { target: 90, maxIterations: 2 });
    assert.equal(outcome.stopReason, 'REGRESSION_PROTECTED');
    assert.equal(outcome.applied, false);
    assert.equal(outcome.finalHtml, html0, 'le HTML d’origine est conservé (rollback)');
    assert.equal(outcome.finalOverall, 70);
    assert.equal(outcome.iterations[0]!.guardVerdict, 'ROLLBACK');
    assert.equal(outcome.iterations[0]!.accepted, false);
    assert.equal(outcome.iterations[0]!.stopReason, 'REGRESSION_PROTECTED');
  });

  it('11. modification impossible -> MODIFICATION_FAILED ; cible déjà atteinte -> aucune itération', async () => {
    const loop = new VisualImprovementLoop();
    const failed = await loop.run(
      html0,
      depsFrom({ [html0]: measurementOf(aqsUniform(70)) }, { [html0]: null }),
      { target: 90, maxIterations: 2 }
    );
    assert.equal(failed.stopReason, 'MODIFICATION_FAILED');
    assert.equal(failed.iterations.length, 1);
    assert.equal(failed.iterations[0]!.modified, false);
    assert.equal(failed.applied, false);
    assert.equal(failed.finalHtml, html0);

    const done = await loop.run(
      html0,
      depsFrom({ [html0]: measurementOf(aqsUniform(95)) }, {}),
      { target: 90, maxIterations: 2 }
    );
    assert.equal(done.stopReason, 'TARGET_REACHED');
    assert.equal(done.iterations.length, 0);
    assert.equal(done.applied, false);

    const unknownValues: Partial<Record<AqsDimensionId, null>> = {};
    for (const dimension of AQS_DIMENSION_ORDER) unknownValues[dimension] = null;
    const blind = await loop.run(
      html0,
      depsFrom({ [html0]: measurementOf(aqsOf(unknownValues)) }, {}),
      { target: 90, maxIterations: 2 }
    );
    assert.equal(blind.stopReason, 'SCORE_UNMEASURABLE');
    assert.equal(blind.finalOverall, null);
    assert.equal(blind.iterations.length, 0);
  });
});
