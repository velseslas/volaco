/**
 * CDC V8.1 WOW §13 — MATRICE DE RÉGRESSION VISUELLE : preuves réelles.
 *
 * Prouve :
 *  - les cinq largeurs minimales 375/768/1024/1440/1920 ;
 *  - le statut PASS/FAIL/UNKNOWN et la comparaison à une baseline ;
 *  - les axes thèmes/états/locales/données déclarés honnêtement
 *    (`DECLARED` ≠ preuve de rendu, `measured=0`) ;
 *  - le repli déterministe de mesure d'overflow ;
 *  - l'historique persistant qui retire les captures base64.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VISUAL_REGRESSION_VIEWPORTS,
  buildMeasuredMatrixAxes,
  buildVisualRegressionMatrix,
  compareVisualRegressionMatrices,
  countHorizontalOverflow,
  detectDeclaredMatrixAxes,
  sha256Base64,
  type VisualRegressionMatrixReport,
  type VisualRegressionViewportEntry
} from '../../../src/ai-native/visual-intelligence/regression-matrix.js';
import { VisualRegressionMatrixStore } from '../../../src/ai-native/visual-intelligence/regression-matrix-store.js';
import type { VisualSnapshot } from '../../../src/ai-native/visual-intelligence/types.js';

function entry(
  width: number,
  status: 'PASS' | 'FAIL' | 'UNKNOWN',
  options: {
    hash?: string | null;
    overflowX?: boolean;
    runtimeErrors?: readonly string[];
    score?: number | null;
  } = {}
): VisualRegressionViewportEntry {
  const spec = VISUAL_REGRESSION_VIEWPORTS.find((candidate) => candidate.width === width)!;
  return {
    width,
    height: spec.height,
    kind: spec.kind,
    label: spec.label,
    status,
    runtimeErrors: options.runtimeErrors ?? [],
    consoleErrors: [],
    overflowX: options.overflowX ?? false,
    wideElements: options.overflowX ? 1 : 0,
    screenshotHash: options.hash === undefined ? `hash-${width}` : options.hash,
    screenshotBytes: 1_024,
    elementCount: 42,
    interactiveCount: 3,
    critiqueCoverage: 1,
    critiqueAxes: options.score === null
      ? []
      : [
          { axis: 'VISUAL_HIERARCHY', score: options.score ?? 80, confidence: 0.9 },
          { axis: 'COMPOSITION', score: options.score ?? 80, confidence: 0.9 }
        ],
    critiqueFindingCount: 1,
    layoutSource: 'RUNTIME',
    durationMs: 250
  };
}

function report(
  viewports: readonly VisualRegressionViewportEntry[],
  generatedAt = '2026-10-21T10:00:00.000Z'
): VisualRegressionMatrixReport {
  return buildVisualRegressionMatrix({
    tenantId: 'tenant-a',
    projectId: 'project-1',
    page: 'index.html',
    generatedAt,
    viewports
  });
}

describe('CDC V8.1 Lot 4 — matrice 375→1920 §13', () => {
  it('1. les cinq largeurs minimales et leurs kinds réels', () => {
    assert.deepEqual(VISUAL_REGRESSION_VIEWPORTS.map((spec) => spec.width), [375, 768, 1024, 1440, 1920]);
    assert.deepEqual(VISUAL_REGRESSION_VIEWPORTS.map((spec) => spec.kind), [
      'MOBILE',
      'TABLET',
      'LAPTOP',
      'DESKTOP_HD',
      'WIDE'
    ]);
  });

  it('2. matrice complète PASS : couverture 5/5 et axes non mesurés exposés', () => {
    const matrix = report(VISUAL_REGRESSION_VIEWPORTS.map((spec) => entry(spec.width, 'PASS')));
    assert.equal(matrix.version, '8.1');
    assert.equal(matrix.summary.measuredViewports, 5);
    assert.equal(matrix.summary.passed, 5);
    assert.equal(matrix.summary.failed, 0);
    assert.equal(matrix.summary.unknown, 0);
    assert.equal(matrix.summary.coverageRatio, 1);
    assert.equal(matrix.summary.overallStatus, 'PASS');
    const viewportAxis = matrix.axes.find((axis) => axis.id === 'VIEWPORT')!;
    assert.equal(viewportAxis.basis, 'MEASURED');
    assert.equal(viewportAxis.measured, 5);
    const dataAxis = matrix.axes.find((axis) => axis.id === 'DATA')!;
    assert.equal(dataAxis.status, 'NOT_CONFIGURED');
    assert.equal(dataAxis.measured, 0);
    assert.ok(matrix.reportId.startsWith('vrm-'));
  });

  it('3. FAIL réel (overflow) et UNKNOWN (rendu impossible) ne sont pas maquillés', () => {
    const failed = report([
      entry(375, 'FAIL', { overflowX: true, runtimeErrors: ['TypeError: boom'] }),
      ...VISUAL_REGRESSION_VIEWPORTS.slice(1).map((spec) => entry(spec.width, 'PASS'))
    ]);
    assert.equal(failed.summary.overallStatus, 'FAIL');
    assert.equal(failed.summary.failed, 1);
    assert.equal(failed.viewports[0]!.overflowX, true);
    assert.deepEqual(failed.viewports[0]!.runtimeErrors, ['TypeError: boom']);

    const unknown = report([
      entry(375, 'UNKNOWN', { hash: null }),
      ...VISUAL_REGRESSION_VIEWPORTS.slice(1).map((spec) => entry(spec.width, 'PASS'))
    ]);
    assert.equal(unknown.summary.overallStatus, 'PARTIAL');
    assert.equal(unknown.summary.unknown, 1);
    assert.equal(unknown.summary.coverageRatio, 0.8);
  });

  it('4. comparaison baseline : overflow/erreur/statut nouveau = régression explicite', () => {
    const baseline = report(
      VISUAL_REGRESSION_VIEWPORTS.map((spec) => entry(spec.width, 'PASS', { score: 80 })),
      '2026-10-21T09:00:00.000Z'
    );
    const current = report(
      [
        entry(375, 'FAIL', { hash: 'new-hash', overflowX: true, runtimeErrors: ['Error'], score: 78 }),
        ...VISUAL_REGRESSION_VIEWPORTS.slice(1).map((spec) => entry(spec.width, 'PASS', { score: 82 }))
      ],
      '2026-10-21T10:00:00.000Z'
    );
    const comparison = compareVisualRegressionMatrices(current.viewports, baseline);
    assert.equal(comparison.recommendation, 'REVIEW');
    assert.equal(comparison.regressions.length, 1);
    const first = comparison.viewports[0]!;
    assert.equal(first.verdict, 'REGRESSION');
    assert.equal(first.overflowIntroduced, true);
    assert.equal(first.runtimeErrorsIntroduced, 1);
    assert.equal(first.screenshotChanged, true);
    assert.equal(first.critiqueDelta, -2);

    const accepted = compareVisualRegressionMatrices(
      VISUAL_REGRESSION_VIEWPORTS.map((spec) => entry(spec.width, 'PASS', { score: 82 })),
      baseline
    );
    assert.equal(accepted.recommendation, 'ACCEPT');
    assert.equal(accepted.regressions.length, 0);
  });

  it('5. axes déclarés : thèmes/états/locales sont DECLARED, jamais prétendus mesurés', () => {
    const html = `<!DOCTYPE html><html lang="fr"><head><style>
      @media (prefers-color-scheme: dark) { body { background: #000; } }
      [data-theme="dark"] { color: white; }
      .btn:hover { color: red; }
      .btn:focus-visible { outline: 2px solid red; }
      .btn:disabled { opacity: .5; }
    </style></head><body><div class="loading"></div><div class="empty"></div><div class="error"></div></body></html>`;
    const axes = detectDeclaredMatrixAxes(html);
    const themes = axes.find((axis) => axis.id === 'THEME')!;
    const states = axes.find((axis) => axis.id === 'STATE')!;
    const locales = axes.find((axis) => axis.id === 'LOCALE')!;
    const data = axes.find((axis) => axis.id === 'DATA')!;
    assert.equal(themes.basis, 'DECLARED');
    assert.equal(themes.measured, 0);
    assert.equal(themes.declared, 2);
    assert.ok(states.declared >= 5);
    assert.equal(states.measured, 0);
    assert.equal(locales.declared, 1);
    assert.equal(locales.status, 'PARTIAL');
    assert.equal(data.status, 'NOT_CONFIGURED');
    assert.equal(data.measured, 0);
  });

  it('5bis. P0 audit — axes MESURÉS : un rendu réel remplace la déclaration, jamais l inverse', () => {
    const measured = buildMeasuredMatrixAxes({
      theme: {
        variantsRendered: 2,
        renderingDiffers: true,
        mechanism: 'émulation prefers-color-scheme: dark',
        declared: 2
      },
      state: {
        variantsRendered: 3,
        variantsDiffering: 3,
        methods: ['survol réel du premier élément interactif', 'focus réel', 'disabled réel'],
        declared: 5
      }
    });
    const themeAxis = measured.find((axis) => axis.id === 'THEME')!;
    assert.equal(themeAxis.status, 'MEASURED');
    assert.equal(themeAxis.basis, 'MEASURED');
    assert.equal(themeAxis.measured, 2);
    assert.match(themeAxis.reason!, /rendues pour de vrai/);
    const stateAxis = measured.find((axis) => axis.id === 'STATE')!;
    assert.equal(stateAxis.status, 'PARTIAL', '3/8 états rendus ne vaut pas 8/8');
    assert.equal(stateAxis.basis, 'MEASURED');
    assert.equal(stateAxis.measured, 3);
    assert.match(stateAxis.reason!, /3\/8 état\(s\) rendu\(s\) réellement/);

    // Un thème rendu mais inerte n'est JAMAIS présenté comme mesuré.
    const inert = buildMeasuredMatrixAxes({
      theme: {
        variantsRendered: 2,
        renderingDiffers: false,
        mechanism: 'attribut data-theme="dark"',
        declared: 2
      }
    });
    assert.equal(inert[0]!.status, 'PARTIAL');
    assert.equal(inert[0]!.basis, 'MEASURED');
    assert.match(inert[0]!.reason!, /ne diffère pas de la référence/);

    // Priorité : l'axe mesuré remplace la déclaration dans la matrice finale ;
    // les autres déclarations restent intactes.
    const declaredOnly = detectDeclaredMatrixAxes(`<!DOCTYPE html><html lang="fr"><head><style>
      @media (prefers-color-scheme: dark) { body { background: #000; } }
    </style></head><body></body></html>`);
    assert.equal(declaredOnly.find((axis) => axis.id === 'THEME')!.basis, 'DECLARED');
    const matrix = buildVisualRegressionMatrix({
      tenantId: 'tenant-a',
      projectId: 'project-1',
      page: 'index.html',
      generatedAt: '2026-10-21T10:00:00.000Z',
      viewports: VISUAL_REGRESSION_VIEWPORTS.map((spec) => entry(spec.width, 'PASS')),
      declaredAxes: declaredOnly,
      measuredAxes: measured
    });
    const finalTheme = matrix.axes.find((axis) => axis.id === 'THEME')!;
    assert.equal(finalTheme.basis, 'MEASURED');
    assert.equal(finalTheme.measured, 2);
    const finalState = matrix.axes.find((axis) => axis.id === 'STATE')!;
    assert.equal(finalState.basis, 'MEASURED');
    assert.equal(finalState.measured, 3);
    const finalLocale = matrix.axes.find((axis) => axis.id === 'LOCALE')!;
    assert.equal(finalLocale.basis, 'DECLARED', 'les autres déclarations restent intactes');
    assert.equal(finalLocale.declared, 1);
  });

  it('6. repli overflow déterministe + hash de capture', () => {
    const snapshot = {
      viewport: { kind: 'MOBILE', width: 375, height: 667, scale: 1 },
      rootNode: {
        layout: { x: 0, y: 0, width: 420, height: 800, isVisible: true, hasOverflow: true },
        children: [
          { layout: { x: 10, y: 10, width: 380, height: 20, isVisible: true, hasOverflow: true }, children: [] }
        ]
      }
    } as unknown as VisualSnapshot;
    const measured = countHorizontalOverflow(snapshot);
    assert.equal(measured.overflowX, true);
    assert.equal(measured.wideElements, 2);
    assert.equal(sha256Base64('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('7. store : baseline, historique et suppression des captures base64', () => {
    const store = new VisualRegressionMatrixStore();
    const withScreenshot = report(
      VISUAL_REGRESSION_VIEWPORTS.map((spec) => ({
        ...entry(spec.width, 'PASS'),
        screenshotBase64: 'data-image'
      }))
    );
    const stored = store.record(withScreenshot);
    assert.equal(stored.viewports[0]!.screenshotBase64, undefined);
    assert.equal(store.latest('tenant-a', 'project-1')?.reportId, stored.reportId);
    assert.equal(store.latest('tenant-a', 'project-2'), undefined);
    assert.equal(store.list('tenant-a', 'project-1').length, 1);
    store.clear();
    assert.equal(store.latest('tenant-a', 'project-1'), undefined);
  });
});
