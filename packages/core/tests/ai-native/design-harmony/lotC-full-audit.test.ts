/**
 * LOT C — CDC V8 §31 : FULL DESIGN AUDIT (agrégation multi-pages).
 *
 * Prouve que l'agrégateur est PUR et HONNÊTE :
 *  1. qualité globale / harmonie / esthétique = moyennes PONDÉRÉES par la
 *     couverture réelle des sous-scores (aucune page mesurable → null) ;
 *  2. Design Drift : UNKNOWN avec moins de 2 pages, DETECTED sur preuve
 *     cross-page réelle (jamais « aucune dérive » sans preuve) ;
 *  3. UX consistency et accessibilité = pénalités RÉELLES par sévérité ;
 *  4. recommandations uniquement pour des sous-scores réellement < 80 ;
 *  5. les règles §8 sont agrégées page par page ;
 *  6. breakpoints réellement mesurés (desktop + mobile).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AQS_DIMENSION_ORDER,
  computeFullDesignAuditSummary,
  fullAuditCoverage,
  type AestheticQualityScore,
  type AqsDimensionId,
  type DesignHarmonyFinding,
  type FullDesignAuditPageInput
} from '../../../src/index.js';

function makeAqs(
  overall: number | null,
  coverage: number,
  values: Partial<Record<AqsDimensionId, number | null>> = {}
): AestheticQualityScore {
  const subScores = AQS_DIMENSION_ORDER.map((id) => ({
    id,
    label: id,
    value: overall === null ? null : (values[id] ?? overall),
    confidence: 0.9,
    evidence: ['mesure de test']
  }));
  return {
    version: '8.0',
    determinism: 'DETERMINISTIC',
    overall,
    subScores,
    computedCount: subScores.filter((score) => score.value !== null).length,
    unknownCount: subScores.filter((score) => score.value === null).length,
    coverage
  };
}

function makeFinding(
  severity: DesignHarmonyFinding['severity'],
  property: string,
  pageRoute = '/'
): DesignHarmonyFinding {
  return {
    id: `finding-${severity}-${property}`,
    category: 'CROSS_PAGE',
    severity,
    confidence: 0.9,
    pageRoute,
    property,
    observedValue: 'observed',
    recommendation: `corriger ${property}`,
    designDrift: severity === 'HIGH' || severity === 'CRITICAL',
    evidence: [{ source: 'DOM_SNAPSHOT', detail: 'preuve', pageRoute, occurrences: 1 }]
  };
}

function page(
  path: string,
  aqs: AestheticQualityScore,
  options: {
    findings?: readonly DesignHarmonyFinding[];
    rules?: { total: number; pass: number; fail: number; unknown: number };
  } = {}
): FullDesignAuditPageInput {
  return {
    path,
    aqs,
    responsiveFindings: options.findings ?? [],
    runtimeErrors: [],
    overflowX: false,
    ruleSummary: options.rules ?? { total: 10, pass: 8, fail: 2, unknown: 0 },
    viewports: {
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 }
    }
  };
}

describe('LOT C §31 — Full Design Audit (multi-pages / breakpoints)', () => {
  it('1. qualité globale = moyenne pondérée par la couverture réelle', () => {
    const summary = computeFullDesignAuditSummary(
      [
        page('index.html', makeAqs(90, 1)),
        page('about.html', makeAqs(60, 0.5))
      ],
      []
    );
    // (90×1 + 60×0.5) / 1.5 = 80
    assert.equal(summary.globalDesignQuality, 80);
    assert.equal(summary.designHarmony, 80);
    assert.equal(summary.aestheticQuality, 80);
    assert.equal(summary.pagesAnalyzed, 2);
    assert.equal(summary.pagesMeasured, 2);
    assert.deepEqual([...summary.breakpoints].sort(), ['desktop 1440×900', 'mobile 390×844']);
  });

  it('2. harmonie/esthétique = sous-ensembles documentés de l’AQS', () => {
    const highHarmony = makeAqs(70, 1, {
      color_harmony: 95,
      typography: 90,
      spacing_rhythm: 85,
      component_quality: 80,
      brand_alignment: 100,
      visual_hierarchy: 40,
      composition: 50,
      visual_balance: 45,
      perceived_quality: 55,
      information_density: 60
    });
    const summary = computeFullDesignAuditSummary([page('index.html', highHarmony)], []);
    assert.equal(summary.designHarmony, 90);
    assert.equal(summary.aestheticQuality, 50);
    assert.equal(summary.globalDesignQuality, 70);
  });

  it('3. Design Drift : UNKNOWN < 2 pages, NONE sans finding, DETECTED sur preuve', () => {
    const one = computeFullDesignAuditSummary([page('index.html', makeAqs(90, 1))], []);
    assert.equal(one.designDrift.status, 'UNKNOWN');
    assert.equal(one.uxConsistency, null);

    const two = computeFullDesignAuditSummary(
      [page('index.html', makeAqs(90, 1)), page('about.html', makeAqs(90, 1))],
      []
    );
    assert.equal(two.designDrift.status, 'NONE');
    assert.equal(two.uxConsistency, 100);

    const drift = computeFullDesignAuditSummary(
      [page('index.html', makeAqs(90, 1)), page('about.html', makeAqs(90, 1))],
      [makeFinding('HIGH', 'header-background'), makeFinding('LOW', 'footer-padding')]
    );
    assert.equal(drift.designDrift.status, 'DETECTED');
    assert.equal(drift.designDrift.findings, 1, 'seule la sévérité HIGH compte comme dérive');
    assert.equal(drift.designDrift.details.length, 1);
    assert.match(drift.designDrift.details[0]!, /header-background/);
    // 100 − 15 (HIGH) − 3 (LOW) = 82
    assert.equal(drift.uxConsistency, 82);
  });

  it('4. accessibilité = pénalité réelle par sévérité, moyenne des pages', () => {
    const summary = computeFullDesignAuditSummary(
      [
        page('index.html', makeAqs(90, 1)),
        page('about.html', makeAqs(80, 1), { findings: [makeFinding('HIGH', 'contrast')] })
      ],
      []
    );
    // page 1 : 100 ; page 2 : 100 − 15 = 85 → moyenne 92,5 → 93
    assert.equal(summary.accessibility, 93);
  });

  it('5. recommandations : uniquement les sous-scores réellement < 80', () => {
    const values: Partial<Record<AqsDimensionId, number>> = {};
    for (const id of AQS_DIMENSION_ORDER) values[id] = 90;
    values.typography = 55;
    values.color_harmony = 75;
    const summary = computeFullDesignAuditSummary(
      [
        page('index.html', makeAqs(60, 1, values)),
        page('about.html', makeAqs(95, 1))
      ],
      []
    );
    const dimensions = summary.recommendations.map((rec) => `${rec.page}:${rec.dimension}:${rec.severity}`);
    assert.deepEqual(dimensions.sort(), ['index.html:color_harmony:LOW', 'index.html:typography:HIGH']);
    for (const rec of summary.recommendations) {
      assert.match(rec.message, /mesuré \d+\/100/);
    }
  });

  it('6. règles §8 agrégées page par page', () => {
    const summary = computeFullDesignAuditSummary(
      [
        page('index.html', makeAqs(90, 1), { rules: { total: 10, pass: 7, fail: 2, unknown: 1 } }),
        page('about.html', makeAqs(80, 1), { rules: { total: 10, pass: 9, fail: 1, unknown: 0 } })
      ],
      []
    );
    assert.deepEqual(summary.rules, { total: 20, pass: 16, fail: 3, unknown: 1 });
  });

  it('7. aucune page mesurable → scores null (jamais de valeur de remplissage)', () => {
    const summary = computeFullDesignAuditSummary(
      [page('index.html', makeAqs(null, 0)), page('about.html', makeAqs(null, 0))],
      []
    );
    assert.equal(summary.globalDesignQuality, null);
    assert.equal(summary.designHarmony, null);
    assert.equal(summary.aestheticQuality, null);
    assert.equal(summary.pagesMeasured, 0);
    assert.equal(summary.pagesAnalyzed, 2);
    assert.equal(fullAuditCoverage([page('index.html', makeAqs(null, 0))]), 0);
  });
});
