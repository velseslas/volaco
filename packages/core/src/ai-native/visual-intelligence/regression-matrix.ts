/**
 * VibeCode Core - Visual Intelligence
 * CDC V8.1 WOW §13 — MATRICE DE RÉGRESSION VISUELLE.
 *
 * La matrice 375 → 1920 est une PREUVE, pas un slogan :
 *  - chaque largeur est rendue réellement et produit une capture + un hash ;
 *  - un débordement horizontal, une erreur runtime ou une mesure absente est
 *    exposé tel quel (FAIL / UNKNOWN), jamais masqué ;
 *  - les autres axes du CDC (thèmes, états, locales, données) sont déclarés
 *    séparément. Une déclaration CSS n'est PAS une mesure de rendu : le champ
 *    `basis` le dit explicitement.
 *  - P0 audit 2026-10 : les axes THÈME et ÉTATS peuvent désormais être
 *    RÉELLEMENT rendus (basis MEASURED, variantes capturées par
 *    `renderAxisVariantProbe` + `buildMeasuredMatrixAxes`). Un axe mesuré
 *    remplace sa déclaration ; l'inverse n'arrive jamais.
 *
 * Le module est pur : le rendu Chromium est injecté par la route API, les
 * tests fournissent des entrées contrôlées.
 */

import { createHash } from 'node:crypto';
import { deepFreeze } from '../ai-orchestrator/canonical.js';
import type { CriticAxisId } from '../design-harmony/types.js';
import type { NormalizedDomNode, ViewportKind, VisualSnapshot } from './types.js';

export const VISUAL_REGRESSION_MATRIX_VERSION = '8.1' as const;

export interface VisualRegressionViewportSpec {
  readonly width: number;
  readonly height: number;
  readonly kind: ViewportKind;
  readonly label: string;
}

/** Les cinq largeurs minimales du CDC V8.1 §13. */
export const VISUAL_REGRESSION_VIEWPORTS: readonly VisualRegressionViewportSpec[] = deepFreeze([
  { width: 375, height: 667, kind: 'MOBILE', label: 'Mobile 375' },
  { width: 768, height: 1024, kind: 'TABLET', label: 'Tablet 768' },
  { width: 1024, height: 768, kind: 'LAPTOP', label: 'Laptop 1024' },
  { width: 1440, height: 900, kind: 'DESKTOP_HD', label: 'Desktop 1440' },
  { width: 1920, height: 1080, kind: 'WIDE', label: 'Wide 1920' }
]);

export type MatrixViewportStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type MatrixAxisId = 'VIEWPORT' | 'THEME' | 'STATE' | 'LOCALE' | 'DATA';
export type MatrixAxisBasis = 'MEASURED' | 'DECLARED' | 'NOT_CONFIGURED';
export type MatrixAxisStatus = 'MEASURED' | 'DECLARED' | 'PARTIAL' | 'NOT_CONFIGURED';

export interface MatrixCritiqueAxis {
  readonly axis: CriticAxisId;
  readonly score: number | null;
  readonly confidence: number;
}

export interface VisualRegressionViewportEntry {
  readonly width: number;
  readonly height: number;
  readonly kind: ViewportKind;
  readonly label: string;
  readonly status: MatrixViewportStatus;
  readonly runtimeErrors: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly overflowX: boolean;
  readonly wideElements: number;
  readonly screenshotHash: string | null;
  readonly screenshotBytes: number;
  readonly screenshotBase64?: string | undefined;
  readonly elementCount: number;
  readonly interactiveCount: number;
  readonly critiqueCoverage: number;
  readonly critiqueAxes: readonly MatrixCritiqueAxis[];
  readonly critiqueFindingCount: number;
  readonly layoutSource: 'RUNTIME' | 'ESTIMATED' | 'UNKNOWN';
  readonly durationMs: number;
  readonly error?: string | undefined;
}

export interface MatrixAxisCoverage {
  readonly id: MatrixAxisId;
  readonly label: string;
  readonly status: MatrixAxisStatus;
  readonly basis: MatrixAxisBasis;
  /** Nombre d'éléments RÉELLEMENT mesurés (0 pour un axe seulement déclaré). */
  readonly measured: number;
  /** Nombre d'éléments DÉCLARÉS par le code (0 si non configuré). */
  readonly declared: number;
  /** Minimum attendu par le CDC. */
  readonly expected: number;
  readonly reason?: string | undefined;
}

export interface MatrixViewportComparison {
  readonly width: number;
  readonly label: string;
  readonly beforeStatus: MatrixViewportStatus;
  readonly afterStatus: MatrixViewportStatus;
  readonly screenshotChanged: boolean;
  readonly overflowIntroduced: boolean;
  readonly runtimeErrorsIntroduced: number;
  readonly critiqueDelta: number | null;
  readonly verdict: 'REGRESSION' | 'UNCHANGED' | 'UNKNOWN';
}

export interface VisualRegressionComparison {
  readonly baselineReportId: string;
  readonly baselineGeneratedAt: string;
  readonly viewports: readonly MatrixViewportComparison[];
  readonly regressions: readonly string[];
  readonly recommendation: 'ACCEPT' | 'REVIEW' | 'NO_BASELINE';
  readonly conclusion: string;
}

export interface VisualRegressionMatrixSummary {
  readonly measuredViewports: number;
  readonly expectedViewports: number;
  readonly passed: number;
  readonly failed: number;
  readonly unknown: number;
  readonly coverageRatio: number;
  readonly overallStatus: 'PASS' | 'FAIL' | 'PARTIAL';
}

export interface VisualRegressionMatrixReport {
  readonly version: typeof VISUAL_REGRESSION_MATRIX_VERSION;
  readonly reportId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly page: string;
  readonly generatedAt: string;
  readonly viewports: readonly VisualRegressionViewportEntry[];
  readonly axes: readonly MatrixAxisCoverage[];
  readonly summary: VisualRegressionMatrixSummary;
  readonly comparison: VisualRegressionComparison | null;
}

export interface BuildMatrixInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly page: string;
  readonly generatedAt: string;
  readonly viewports: readonly VisualRegressionViewportEntry[];
  readonly declaredAxes?: readonly MatrixAxisCoverage[] | undefined;
  /**
   * P0 audit 2026-10 — axes RÉELLEMENT rendus (ex. THEME/STATE mesurés par la
   * route avec captures réelles). Priorité sur les déclarations : une mesure
   * remplace une déclaration, jamais l'inverse.
   */
  readonly measuredAxes?: readonly MatrixAxisCoverage[] | undefined;
  readonly baseline?: VisualRegressionMatrixReport | null | undefined;
}

export function matrixViewportSpec(width: number): VisualRegressionViewportSpec | undefined {
  return VISUAL_REGRESSION_VIEWPORTS.find((spec) => spec.width === width);
}

export function sha256Base64(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Repli déterministe quand le renderer n'a pas fourni sa mesure d'overflow. */
export function countHorizontalOverflow(snapshot: VisualSnapshot): { overflowX: boolean; wideElements: number } {
  let wideElements = 0;
  const viewportWidth = snapshot.viewport.width;
  const visit = (node: NormalizedDomNode): void => {
    if (node.layout.isVisible && node.layout.x + node.layout.width > viewportWidth + 1) {
      wideElements += 1;
    }
    for (const child of node.children) visit(child);
  };
  visit(snapshot.rootNode);
  return {
    overflowX: wideElements > 0 || snapshot.rootNode.layout.width > viewportWidth + 1,
    wideElements: Math.min(wideElements, 50)
  };
}

function averageAxisScore(axes: readonly MatrixCritiqueAxis[]): number | null {
  const measured = axes.map((axis) => axis.score).filter((score): score is number => score !== null);
  if (measured.length === 0) return null;
  return Math.round((measured.reduce((total, score) => total + score, 0) / measured.length) * 10) / 10;
}

export function compareVisualRegressionMatrices(
  current: readonly VisualRegressionViewportEntry[],
  baseline: VisualRegressionMatrixReport
): VisualRegressionComparison {
  const rows: MatrixViewportComparison[] = current.map((entry) => {
    const before = baseline.viewports.find((candidate) => candidate.width === entry.width);
    if (!before) {
      return {
        width: entry.width,
        label: entry.label,
        beforeStatus: 'UNKNOWN',
        afterStatus: entry.status,
        screenshotChanged: false,
        overflowIntroduced: false,
        runtimeErrorsIntroduced: 0,
        critiqueDelta: null,
        verdict: 'UNKNOWN' as const
      };
    }
    const runtimeErrorsIntroduced = Math.max(0, entry.runtimeErrors.length - before.runtimeErrors.length);
    const overflowIntroduced = entry.overflowX && !before.overflowX;
    const beforeScore = averageAxisScore(before.critiqueAxes);
    const afterScore = averageAxisScore(entry.critiqueAxes);
    const critiqueDelta =
      beforeScore !== null && afterScore !== null ? Math.round((afterScore - beforeScore) * 10) / 10 : null;
    const regression =
      (before.status === 'PASS' && entry.status === 'FAIL') ||
      overflowIntroduced ||
      runtimeErrorsIntroduced > 0 ||
      (before.status === 'PASS' && entry.status === 'UNKNOWN');
    return {
      width: entry.width,
      label: entry.label,
      beforeStatus: before.status,
      afterStatus: entry.status,
      screenshotChanged:
        before.screenshotHash !== null &&
        entry.screenshotHash !== null &&
        before.screenshotHash !== entry.screenshotHash,
      overflowIntroduced,
      runtimeErrorsIntroduced,
      critiqueDelta,
      verdict: regression ? ('REGRESSION' as const) : ('UNCHANGED' as const)
    };
  });

  const regressions = rows
    .filter((row) => row.verdict === 'REGRESSION')
    .map((row) => `${row.label} : ${row.afterStatus}${row.overflowIntroduced ? ' + overflow' : ''}`);
  const recommendation = regressions.length > 0 ? 'REVIEW' : 'ACCEPT';
  return {
    baselineReportId: baseline.reportId,
    baselineGeneratedAt: baseline.generatedAt,
    viewports: rows,
    regressions,
    recommendation,
    conclusion:
      regressions.length > 0
        ? `Régressions détectées sur ${regressions.length} viewport(s) : ${regressions.join(' ; ')}. Revue requise.`
        : 'Aucune régression de statut, d’overflow ou d’erreur runtime détectée entre les deux matrices.'
  };
}

function buildAxes(
  viewports: readonly VisualRegressionViewportEntry[],
  declaredAxes: readonly MatrixAxisCoverage[],
  measuredAxes: readonly MatrixAxisCoverage[]
): readonly MatrixAxisCoverage[] {
  const measured = viewports.filter((entry) => entry.status !== 'UNKNOWN').length;
  const viewportAxis: MatrixAxisCoverage = {
    id: 'VIEWPORT',
    label: 'Largeurs 375 → 1920',
    status: measured >= VISUAL_REGRESSION_VIEWPORTS.length ? 'MEASURED' : measured > 0 ? 'PARTIAL' : 'NOT_CONFIGURED',
    basis: 'MEASURED',
    measured,
    declared: 0,
    expected: VISUAL_REGRESSION_VIEWPORTS.length,
    ...(measured < VISUAL_REGRESSION_VIEWPORTS.length
      ? { reason: `${measured}/${VISUAL_REGRESSION_VIEWPORTS.length} largeurs ont une mesure exploitable.` }
      : {})
  };
  const others = declaredAxes.filter((axis) => axis.id !== 'VIEWPORT');
  const byId = new Map<MatrixAxisId, MatrixAxisCoverage>();
  byId.set('VIEWPORT', viewportAxis);
  for (const axis of others) byId.set(axis.id, axis);
  // P0 audit 2026-10 — les axes RÉELLEMENT rendus remplacent les déclarations.
  for (const axis of measuredAxes) {
    if (axis.id !== 'VIEWPORT') byId.set(axis.id, axis);
  }
  const order: MatrixAxisId[] = ['VIEWPORT', 'THEME', 'STATE', 'LOCALE', 'DATA'];
  return order.map((id) => byId.get(id) ?? {
    id,
    label: id,
    status: 'NOT_CONFIGURED' as const,
    basis: 'NOT_CONFIGURED' as const,
    measured: 0,
    declared: 0,
    expected: id === 'THEME' ? 2 : id === 'STATE' ? 8 : id === 'LOCALE' ? 2 : 3,
    reason: 'Axe non configuré pour cette exécution.'
  });
}

/**
 * Déclare ce que le code du projet EXPOSE (pas ce qui a été rendu) pour les
 * axes thèmes/états/locales/données. Une déclaration ne vaut jamais preuve de
 * rendu : `basis=DECLARED` et `measured=0`.
 */
export function detectDeclaredMatrixAxes(html: string): readonly MatrixAxisCoverage[] {
  const styles = (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? []).join('\n');
  const css = styles + '\n' + (html.match(/<link[^>]+stylesheet[^>]*>/gi) ?? []).join('\n');

  const themeTokens = new Set<string>();
  for (const match of css.matchAll(/data-theme\s*=\s*["']([^"']+)["']/gi)) {
    themeTokens.add(match[1]!.toLowerCase());
  }
  if (/prefers-color-scheme\s*:\s*dark/i.test(css)) themeTokens.add('dark-media');
  if (/prefers-color-scheme\s*:\s*light/i.test(css)) themeTokens.add('light-media');
  const themeDeclared = themeTokens.size > 0 ? Math.min(2, themeTokens.size + 1) : 0;

  const states = new Set<string>();
  for (const state of ['hover', 'focus-visible', 'focus', 'active', 'disabled']) {
    if (new RegExp(`:${state}\\b`, 'i').test(css)) states.add(state);
  }
  for (const state of ['loading', 'empty', 'error', 'success', 'skeleton']) {
    if (new RegExp(`(?:class|data-state)\\s*=\\s*["'][^"']*\\b${state}\\b`, 'i').test(html)) {
      states.add(state);
    }
  }
  const stateDeclared = Math.min(8, states.size);

  const langs = new Set<string>();
  for (const match of html.matchAll(/\blang\s*=\s*["']([^"']+)["']/gi)) {
    langs.add(match[1]!.toLowerCase());
  }
  const hasRtl = /\bdir\s*=\s*["']rtl["']/i.test(html);
  const localeDeclared = Math.min(2, langs.size + (hasRtl ? 1 : 0));

  const axis = (
    id: MatrixAxisId,
    label: string,
    declared: number,
    expected: number,
    reason: string
  ): MatrixAxisCoverage => {
    const status: MatrixAxisStatus =
      declared >= expected ? 'DECLARED' : declared > 0 ? 'PARTIAL' : 'NOT_CONFIGURED';
    return {
      id,
      label,
      status,
      basis: declared > 0 ? 'DECLARED' : 'NOT_CONFIGURED',
      measured: 0,
      declared,
      expected,
      reason
    };
  };

  return [
    axis(
      'THEME',
      'Thèmes clair/sombre',
      themeDeclared,
      2,
      themeDeclared > 0
        ? 'Support de thème déclaré dans le CSS ; rendu des deux thèmes non mesuré par cette matrice.'
        : 'Aucun support de thème détecté.'
    ),
    axis(
      'STATE',
      'États loading/empty/error/success/disabled/hover/focus',
      stateDeclared,
      8,
      stateDeclared > 0
        ? `${stateDeclared} état(s) déclaré(s) dans le CSS/HTML ; rendu de chaque état non mesuré.`
        : 'Aucun état explicite détecté.'
    ),
    axis(
      'LOCALE',
      'Locales LTR/RTL',
      localeDeclared,
      2,
      localeDeclared > 0
        ? `${langs.size} locale(s) déclarée(s)${hasRtl ? ' + RTL' : ', RTL absent'} ; bascule de locale non mesurée.`
        : 'Aucune locale déclarée.'
    ),
    axis(
      'DATA',
      'Données vide/courte/volumineuse',
      0,
      3,
      'Aucune donnée de test n’est déclarée : cet axe reste NOT_CONFIGURED (aucune valeur inventée).'
    )
  ];
}

/**
 * P0 audit 2026-10 — §13 : axes RÉELLEMENT rendus.
 *
 * La route fournit les preuves (variantes capturées pour de vrai, hashes
 * comparés DANS la même session Chromium) ; cette fonction les traduit en
 * axes sans jamais fabriquer une mesure sans preuve :
 *  - THEME : 2 variantes rendues ET rendu qui diffère → MEASURED ; variantes
 *    rendues mais rendu identique → PARTIAL (le support déclaré n'affecte
 *    pas la page — c'est une information, pas un succès) ;
 *  - STATE : n/8 états réellement rendus → PARTIAL tant que 8/8 n'est pas
 *    atteint ; le détail des méthodes est exposé.
 */
export interface MeasuredThemeEvidence {
  /** Variantes de thème réellement rendues (référence + variante). */
  readonly variantsRendered: number;
  /** true si la capture du thème alternatif diffère de la référence. */
  readonly renderingDiffers: boolean;
  /** Mécanisme réellement appliqué (média, attribut…). */
  readonly mechanism: string;
  /** Nombre d'éléments déclarés par le code (inchangé, jamais maquillé). */
  readonly declared: number;
}

export interface MeasuredStateEvidence {
  readonly variantsRendered: number;
  readonly variantsDiffering: number;
  readonly methods: readonly string[];
  readonly declared: number;
}

export function buildMeasuredMatrixAxes(input: {
  readonly theme?: MeasuredThemeEvidence | undefined;
  readonly state?: MeasuredStateEvidence | undefined;
}): readonly MatrixAxisCoverage[] {
  const axes: MatrixAxisCoverage[] = [];
  const theme = input.theme;
  if (theme && theme.variantsRendered > 0) {
    const complete = theme.variantsRendered >= 2 && theme.renderingDiffers;
    axes.push({
      id: 'THEME',
      label: 'Thèmes clair/sombre',
      status: complete ? 'MEASURED' : 'PARTIAL',
      basis: 'MEASURED',
      measured: theme.variantsRendered,
      declared: theme.declared,
      expected: 2,
      reason: complete
        ? `${theme.variantsRendered} variantes rendues pour de vrai (${theme.mechanism}) ; le rendu diffère entre les thèmes.`
        : `${theme.variantsRendered} variante(s) rendue(s) (${theme.mechanism}) mais le rendu ne diffère pas de la référence : le support déclaré n'affecte pas la page.`
    });
  }
  const state = input.state;
  if (state && state.variantsRendered > 0) {
    axes.push({
      id: 'STATE',
      label: 'États loading/empty/error/success/disabled/hover/focus',
      status: state.variantsRendered >= 8 ? 'MEASURED' : 'PARTIAL',
      basis: 'MEASURED',
      measured: state.variantsRendered,
      declared: state.declared,
      expected: 8,
      reason: `${state.variantsRendered}/8 état(s) rendu(s) réellement (${state.methods.join(', ')}) ; ${state.variantsDiffering} change(nt) le rendu par défaut.`
    });
  }
  return axes;
}

export function buildVisualRegressionMatrix(input: BuildMatrixInput): VisualRegressionMatrixReport {
  const measuredViewports = input.viewports.filter((entry) => entry.status !== 'UNKNOWN').length;
  const passed = input.viewports.filter((entry) => entry.status === 'PASS').length;
  const failed = input.viewports.filter((entry) => entry.status === 'FAIL').length;
  const unknown = input.viewports.filter((entry) => entry.status === 'UNKNOWN').length;
  const overallStatus: VisualRegressionMatrixSummary['overallStatus'] =
    failed > 0 ? 'FAIL' : unknown > 0 || measuredViewports < VISUAL_REGRESSION_VIEWPORTS.length ? 'PARTIAL' : 'PASS';
  const axes = buildAxes(input.viewports, input.declaredAxes ?? [], input.measuredAxes ?? []);
  const comparison = input.baseline ? compareVisualRegressionMatrices(input.viewports, input.baseline) : null;
  const fingerprint = JSON.stringify({
    tenantId: input.tenantId,
    projectId: input.projectId,
    page: input.page,
    generatedAt: input.generatedAt,
    viewports: input.viewports.map((entry) => ({
      width: entry.width,
      status: entry.status,
      hash: entry.screenshotHash,
      overflowX: entry.overflowX,
      errors: entry.runtimeErrors.length
    }))
  });
  const reportId = 'vrm-' + createHash('sha256').update(fingerprint, 'utf8').digest('hex').slice(0, 16);

  return deepFreeze({
    version: VISUAL_REGRESSION_MATRIX_VERSION,
    reportId,
    tenantId: input.tenantId.trim(),
    projectId: input.projectId.trim(),
    page: input.page,
    generatedAt: input.generatedAt,
    viewports: input.viewports,
    axes,
    summary: {
      measuredViewports,
      expectedViewports: VISUAL_REGRESSION_VIEWPORTS.length,
      passed,
      failed,
      unknown,
      coverageRatio: Math.round((measuredViewports / VISUAL_REGRESSION_VIEWPORTS.length) * 100) / 100,
      overallStatus
    },
    comparison
  });
}
