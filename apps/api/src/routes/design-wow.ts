/**
 * VibeCode Core - API Tier
 * Design WOW Route — CDC V8.1 §9/§13/§18 (Lot 4).
 *
 * Routes ADDITIVES (aucune modification de GET .../design) :
 *  - GET    .../design/quality-budget              budget effectif + bornes CDC
 *  - PUT    .../design/quality-budget              budget projet persistant
 *  - DELETE .../design/quality-budget              retour au budget par défaut
 *  - GET    .../design/quality-budget/executions   exécutions réelles archivées
 *  - POST   .../design/visual-regression           matrice réelle 375→1920
 *            (P0 audit 2026-10 : axes thème/états RENDUS pour de vrai quand
 *            la page les déclare — une déclaration n'est jamais une mesure)
 *  - GET    .../design/visual-regression           dernière matrice
 *  - GET    .../design/visual-regression/history   historique des matrices
 *  - POST   .../design/pairwise                     évaluation A/B + dataset
 *  - GET    .../design/pairwise/dataset             dataset de référence
 *  - POST   .../design/pairwise/:id/preference      confirmation humaine
 *
 * HONNÊTETÉ : une capture absente, un rendu impossible, un axe non mesuré ou
 * une préférence système seule sont exposés comme tels. Aucune décision n'est
 * inventée, aucun fichier workspace n'est écrit.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { VisualIntelligenceService } from '../../../../packages/core/src/ai-native/visual-intelligence/service.js';
import { DesignCriticEngine } from '../../../../packages/core/src/ai-native/design-harmony/engine/design-critic.js';
import { extractDocumentCss } from '../../../../packages/core/src/ai-native/visual-intelligence/engine/css-parser.js';
import { renderProjectPreview, renderAxisVariantProbe, type AxisVariantRequest } from '../../../../packages/core/src/ai-native/visual-intelligence/real-renderer.js';
import {
  buildMeasuredMatrixAxes,
  buildVisualRegressionMatrix,
  countHorizontalOverflow,
  detectDeclaredMatrixAxes,
  matrixViewportSpec,
  sha256Base64,
  VISUAL_REGRESSION_VIEWPORTS,
  type MatrixAxisCoverage,
  type MeasuredStateEvidence,
  type MeasuredThemeEvidence,
  type VisualRegressionViewportEntry
} from '../../../../packages/core/src/ai-native/visual-intelligence/regression-matrix.js';
import { visualRegressionMatrixStore } from '../../../../packages/core/src/ai-native/visual-intelligence/regression-matrix-store.js';
import {
  DEFAULT_QUALITY_BUDGET,
  QUALITY_BUDGET_BOUNDS,
  QUALITY_BUDGET_VERSION,
  QualityBudgetValidationError,
  normalizeQualityBudget
} from '../../../../packages/core/src/ai-native/design-harmony/quality-budget.js';
import { qualityBudgetStore } from '../../../../packages/core/src/ai-native/design-harmony/quality-budget-store.js';
import {
  designEvaluationDatasetStore,
  evaluatePairwiseVisual,
  PairwiseEvaluationError,
  type PairwisePreference
} from '../../../../packages/core/src/ai-native/design-harmony/pairwise-evaluation.js';
import { VisualVersionComparator } from '../../../../packages/core/src/ai-native/design-harmony/engine/version-compare.js';
import { measureProjectAesthetics } from './design-measure.js';
import { readBody } from '../middleware/body.js';
import type { RequestContext } from '../middleware/auth.js';

const PREFIX = '/api/v1/projects/';
const DESIGN_PREFIX = '/design/';
const MAX_PAGE_BYTES = 400_000;

const visualService = new VisualIntelligenceService(undefined, { enableVisionLLM: false });
const designCritic = new DesignCriticEngine();
const versionComparator = new VisualVersionComparator();

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const parsed = await readBody(req);
    const value = typeof parsed === 'string' ? JSON.parse(parsed || '{}') : (parsed || {});
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function requireApprover(body: Record<string, unknown>, requestId: string): string {
  const approvedBy = typeof body.approvedBy === 'string' ? body.approvedBy.trim() : '';
  if (approvedBy.length < 2) {
    throw new ValidationError(
      'Le contrôle humain exige "approvedBy" (identité de l\'approbateur, 2 caractères minimum).',
      undefined,
      requestId
    );
  }
  return approvedBy;
}

function auditEvent(params: {
  tenantId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string;
  metadata: Record<string, unknown>;
}): void {
  try {
    auditStore.record({
      tenantId: params.tenantId,
      userId: 'system',
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      status: 'SUCCESS',
      metadata: params.metadata,
      requestId: params.requestId
    });
  } catch {
    // L'audit ne doit jamais bloquer une opération déjà persistée.
  }
}

function parseLimit(url: string, fallback = 20): number {
  try {
    const value = Number(new URL(url, 'http://localhost').searchParams.get('limit'));
    return Number.isFinite(value) && value > 0 ? Math.min(100, Math.round(value)) : fallback;
  } catch {
    return fallback;
  }
}

function parseViewportWidths(value: unknown, requestId: string): readonly number[] {
  if (value === undefined || value === null) {
    return VISUAL_REGRESSION_VIEWPORTS.map((spec) => spec.width);
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(
      '"viewports" doit être un tableau non vide de largeurs 375, 768, 1024, 1440 ou 1920.',
      { field: 'viewports' },
      requestId
    );
  }
  const widths: number[] = [];
  for (const raw of value) {
    const width = Number(raw);
    if (!matrixViewportSpec(width)) {
      throw new ValidationError(
        `Largeur de viewport non supportée : ${String(raw)}.`,
        { field: 'viewports', allowed: VISUAL_REGRESSION_VIEWPORTS.map((spec) => spec.width) },
        requestId
      );
    }
    if (!widths.includes(width)) widths.push(width);
  }
  return widths;
}

function parsePairwisePreference(value: unknown, requestId: string): PairwisePreference {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (text !== 'A' && text !== 'B' && text !== 'EQUIVALENT') {
    throw new ValidationError(
      '"preference" doit valoir A, B ou EQUIVALENT.',
      { field: 'preference' },
      requestId
    );
  }
  return text;
}

interface ResolvedVersion {
  readonly html: string;
  readonly versionId: string;
}

function resolveRevisionVersion(
  tenantId: string,
  projectId: string,
  revisionId: string,
  requestId: string
): ResolvedVersion {
  const revision = revisionStore.getRevision(tenantId, projectId, revisionId);
  if (!revision) {
    throw new ValidationError(
      `Révision introuvable : ${revisionId}`,
      { field: 'revisionId' },
      requestId
    );
  }
  const html = revision.files['index.html']?.content ?? '';
  if (!html.trim()) {
    throw new ValidationError(
      `La révision ${revisionId} ne contient pas d'index.html.`,
      { field: 'revisionId' },
      requestId
    );
  }
  return { html, versionId: revision.id };
}

async function buildViewportEntry(params: {
  tenantId: string;
  projectId: string;
  requestId: string;
  role: RequestContext['role'];
  files: Record<string, string>;
  entryFile: string;
  width: number;
  includeScreenshots: boolean;
}): Promise<VisualRegressionViewportEntry> {
  const spec = matrixViewportSpec(params.width);
  if (!spec) throw new Error(`Viewport non supporté : ${params.width}`);
  const html = params.files[params.entryFile] ?? '';
  const cssContent = extractDocumentCss(html);
  const pageRoute = params.entryFile === 'index.html' ? '/' : `/${params.entryFile}`;

  try {
    const render = await renderProjectPreview(params.files, {
      entryFile: params.entryFile,
      viewport: { width: spec.width, height: spec.height },
      timeoutMs: 20_000,
      skipMobileProbe: true
    });
    const analysis = await visualService.analyzeVisuals(
      {
        tenantId: params.tenantId,
        projectId: params.projectId,
        pageRoute,
        htmlContent: html,
        cssContent,
        runtimeDom: render.runtimeDom,
        viewport: spec.kind,
        requestId: params.requestId
      },
      params.role
    );
    const critique = designCritic.critique(analysis.snapshot);
    const fallbackOverflow = countHorizontalOverflow(analysis.snapshot);
    const overflow = render.viewportOverflow ?? fallbackOverflow;
    const consoleErrors = render.consoleMessages
      .filter((message) => message.type === 'error')
      .map((message) => message.text)
      .slice(0, 10);
    const runtimeErrors = render.pageErrors.slice(0, 10);
    const screenshotBytes = Buffer.from(render.screenshotBase64, 'base64').length;
    return {
      width: spec.width,
      height: spec.height,
      kind: spec.kind,
      label: spec.label,
      status: runtimeErrors.length > 0 || overflow.overflowX ? 'FAIL' : 'PASS',
      runtimeErrors,
      consoleErrors,
      overflowX: overflow.overflowX,
      wideElements: overflow.wideElements,
      screenshotHash: sha256Base64(render.screenshotBase64),
      screenshotBytes,
      ...(params.includeScreenshots ? { screenshotBase64: render.screenshotBase64 } : {}),
      elementCount: analysis.snapshot.totalElementsCount,
      interactiveCount: analysis.snapshot.interactiveElements.length,
      critiqueCoverage: critique.coverage,
      critiqueAxes: critique.axes.map((axis) => ({
        axis: axis.axis,
        score: axis.score,
        confidence: axis.confidence
      })),
      critiqueFindingCount: critique.findings.length,
      layoutSource: analysis.snapshot.layoutSource ?? 'UNKNOWN',
      durationMs: render.durationMs
    };
  } catch (error) {
    return {
      width: spec.width,
      height: spec.height,
      kind: spec.kind,
      label: spec.label,
      status: 'UNKNOWN',
      runtimeErrors: [],
      consoleErrors: [],
      overflowX: false,
      wideElements: 0,
      screenshotHash: null,
      screenshotBytes: 0,
      elementCount: 0,
      interactiveCount: 0,
      critiqueCoverage: 0,
      critiqueAxes: [],
      critiqueFindingCount: 0,
      layoutSource: 'UNKNOWN',
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * P0 audit 2026-10 — §13 : lancer, quand la page en déclare, le RENDU RÉEL
 * des variantes d'axes (thème sombre/alternatif, états hover/focus/disabled)
 * dans une session Chromium dédiée, puis traduire les preuves en axes mesurés.
 *
 * Aucune déclaration n'est comptée comme mesure : sans variante réellement
 * appliquée, aucun axe mesuré n'est produit et les déclarations honnêtes de
 * `detectDeclaredMatrixAxes` restent seules. Chromium indisponible → retour
 * vide (les axes restent DECLARED, jamais un succès inventé).
 */
async function measureDeclaredMatrixAxes(params: {
  tenantId: string;
  projectId: string;
  requestId: string;
  files: Record<string, string>;
  entryFile: string;
  widths: readonly number[];
  declaredAxes: readonly MatrixAxisCoverage[];
}): Promise<readonly MatrixAxisCoverage[]> {
  const themeDeclared = params.declaredAxes.find((axis) => axis.id === 'THEME');
  const stateDeclared = params.declaredAxes.find((axis) => axis.id === 'STATE');
  const themeNeeded = themeDeclared !== undefined && themeDeclared.status !== 'NOT_CONFIGURED';
  const stateNeeded = stateDeclared !== undefined && stateDeclared.status !== 'NOT_CONFIGURED';
  if (!themeNeeded && !stateNeeded) return [];

  const probeWidth = params.widths.includes(1440) ? 1440 : params.widths[0];
  const spec = probeWidth !== undefined ? matrixViewportSpec(probeWidth) : undefined;
  if (!spec) return [];

  const html = params.files[params.entryFile] ?? '';
  const requests: AxisVariantRequest[] = [];
  let themeMechanism: string | undefined;
  if (themeNeeded) {
    if (/prefers-color-scheme\s*:\s*dark/i.test(html)) {
      requests.push({ id: 'theme-dark', colorScheme: 'dark' });
      themeMechanism = 'émulation prefers-color-scheme: dark';
    } else {
      const values: string[] = [];
      for (const match of html.matchAll(/data-theme\s*=\s*["']([^"']+)["']/gi)) {
        if (match[1] !== undefined) values.push(match[1]);
      }
      const candidate = values.find((value) => /dark/i.test(value)) ?? values[0];
      if (candidate !== undefined) {
        requests.push({ id: 'theme-alternate', setRootAttribute: { name: 'data-theme', value: candidate } });
        themeMechanism = `attribut data-theme="${candidate}"`;
      } else if (/prefers-color-scheme\s*:\s*light/i.test(html)) {
        requests.push({ id: 'theme-light', colorScheme: 'light' });
        themeMechanism = 'émulation prefers-color-scheme: light';
      }
    }
  }
  if (stateNeeded) {
    requests.push({ id: 'state-hover', interaction: 'hover-first-interactive' });
    requests.push({ id: 'state-focus', interaction: 'focus-first-interactive' });
    requests.push({ id: 'state-disabled', interaction: 'disable-first-interactive' });
  }
  if (requests.length === 0) return [];

  try {
    const probe = await renderAxisVariantProbe(
      params.files,
      {
        entryFile: params.entryFile,
        viewport: { width: spec.width, height: spec.height },
        timeoutMs: 20_000
      },
      requests
    );
    const baseHash = sha256Base64(probe.baseScreenshotBase64);

    let theme: MeasuredThemeEvidence | undefined;
    if (themeMechanism !== undefined) {
      const capture = probe.variants.find((variant) => variant.id.startsWith('theme-'));
      if (capture && capture.applied) {
        theme = {
          variantsRendered: 2,
          renderingDiffers:
            capture.screenshotBase64.length > 0 && sha256Base64(capture.screenshotBase64) !== baseHash,
          mechanism: themeMechanism,
          declared: themeDeclared?.declared ?? 0
        };
      }
    }

    const appliedStates = probe.variants.filter((variant) => variant.id.startsWith('state-') && variant.applied);
    const state: MeasuredStateEvidence | undefined = appliedStates.length > 0
      ? {
          variantsRendered: appliedStates.length,
          variantsDiffering: appliedStates.filter(
            (variant) => variant.screenshotBase64.length > 0 && sha256Base64(variant.screenshotBase64) !== baseHash
          ).length,
          methods: appliedStates.map((variant) => variant.detail),
          declared: stateDeclared?.declared ?? 0
        }
      : undefined;

    return buildMeasuredMatrixAxes({ theme, state });
  } catch {
    return [];
  }
}

export async function handleDesignWowRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  if (!pathname.startsWith(PREFIX) || !pathname.includes(DESIGN_PREFIX)) return false;
  const rest = pathname.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return false;
  const projectId = rest.slice(0, slash);
  const tail = rest.slice(slash);
  if (!tail.startsWith(DESIGN_PREFIX)) return false;
  const sub = tail.slice(DESIGN_PREFIX.length);
  const match =
    sub === 'quality-budget' ||
    sub === 'quality-budget/executions' ||
    sub === 'visual-regression' ||
    sub === 'visual-regression/history' ||
    sub === 'pairwise' ||
    sub === 'pairwise/dataset' ||
    /^pairwise\/[^/]+\/preference$/.test(sub);
  if (!match) return false;

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    sendJson(res, 404, { message: `Projet ${projectId} introuvable`, requestId });
    return true;
  }

  // -------------------------------------------------------------------------
  // §18 — QUALITY BUDGETS (configuration persistante)
  // -------------------------------------------------------------------------
  if (sub === 'quality-budget' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const stored = qualityBudgetStore.getConfig(context.tenantId, projectId);
    sendJson(res, 200, {
      version: QUALITY_BUDGET_VERSION,
      effective: qualityBudgetStore.getEffective(context.tenantId, projectId),
      defaults: DEFAULT_QUALITY_BUDGET,
      bounds: QUALITY_BUDGET_BOUNDS,
      customized: stored !== undefined,
      config: stored ?? null,
      executions: qualityBudgetStore.listExecutions(context.tenantId, projectId, 5),
      requestId
    });
    return true;
  }

  if (sub === 'quality-budget' && req.method === 'PUT') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const body = await readJsonBody(req);
    const approvedBy = requireApprover(body, requestId);
    const raw = body.budget !== undefined ? body.budget : body;
    let budget;
    try {
      budget = normalizeQualityBudget(raw, { strict: true });
    } catch (error) {
      if (error instanceof QualityBudgetValidationError) {
        throw new ValidationError(error.message, { field: error.field }, requestId);
      }
      throw error;
    }
    const stored = qualityBudgetStore.setConfig({
      tenantId: context.tenantId,
      projectId,
      budget,
      updatedBy: approvedBy,
      updatedAt: new Date().toISOString()
    });
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_QUALITY_BUDGET_UPDATED',
      resourceType: 'design_quality_budget',
      resourceId: projectId,
      requestId,
      metadata: { approvedBy, budget }
    });
    sendJson(res, 200, { updated: true, config: stored, effective: stored.budget, requestId });
    return true;
  }

  if (sub === 'quality-budget' && req.method === 'DELETE') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const body = await readJsonBody(req);
    const approvedBy = requireApprover(body, requestId);
    const removed = qualityBudgetStore.clearConfig(context.tenantId, projectId);
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_QUALITY_BUDGET_RESET',
      resourceType: 'design_quality_budget',
      resourceId: projectId,
      requestId,
      metadata: { approvedBy, removed }
    });
    sendJson(res, 200, {
      reset: true,
      removed,
      effective: DEFAULT_QUALITY_BUDGET,
      requestId
    });
    return true;
  }

  if (sub === 'quality-budget/executions' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    sendJson(res, 200, {
      executions: qualityBudgetStore.listExecutions(context.tenantId, projectId, parseLimit(req.url || '/', 20)),
      requestId
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // §13 — MATRICE DE RÉGRESSION VISUELLE 375 → 1920
  // -------------------------------------------------------------------------
  if (sub === 'visual-regression' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await readJsonBody(req);
    const entryFile = typeof body.entryFile === 'string' && body.entryFile.trim().length > 0
      ? body.entryFile.trim()
      : 'index.html';
    if (entryFile.includes('..') || entryFile.includes('/') || entryFile.includes('\\')) {
      throw new ValidationError('"entryFile" doit être un nom de fichier simple.', { field: 'entryFile' }, requestId);
    }
    const files = fileStore.getAllProjectFiles(context.tenantId, projectId);
    const html = files[entryFile] ?? '';
    if (!html.trim()) {
      throw new ValidationError(`Aucun ${entryFile} à mesurer.`, undefined, requestId);
    }
    if (Buffer.byteLength(html, 'utf8') > MAX_PAGE_BYTES) {
      throw new ValidationError(
        `La page ${entryFile} dépasse la limite de ${MAX_PAGE_BYTES} octets.`,
        undefined,
        requestId
      );
    }
    const widths = parseViewportWidths(body.viewports, requestId);
    const includeScreenshots = body.includeScreenshots === true;
    const viewports: VisualRegressionViewportEntry[] = [];
    for (const width of widths) {
      viewports.push(
        await buildViewportEntry({
          tenantId: context.tenantId,
          projectId,
          requestId,
          role: context.role,
          files,
          entryFile,
          width,
          includeScreenshots
        })
      );
    }
    const declaredAxes = detectDeclaredMatrixAxes(html);
    // P0 audit 2026-10 — §13 : rend POUR DE VRAI les axes déclarés (thème,
    // états) ; sans déclaration, aucun rendu supplémentaire n'a lieu.
    const measuredAxes = await measureDeclaredMatrixAxes({
      tenantId: context.tenantId,
      projectId,
      requestId,
      files,
      entryFile,
      widths,
      declaredAxes
    });
    const baseline = visualRegressionMatrixStore.latest(context.tenantId, projectId) ?? null;
    const report = buildVisualRegressionMatrix({
      tenantId: context.tenantId,
      projectId,
      page: entryFile,
      generatedAt: new Date().toISOString(),
      viewports,
      declaredAxes,
      measuredAxes,
      baseline
    });
    const stored = visualRegressionMatrixStore.record(report);
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_VISUAL_REGRESSION_RUN',
      resourceType: 'visual_regression_matrix',
      resourceId: stored.reportId,
      requestId,
      metadata: {
        projectId,
        page: entryFile,
        widths,
        status: stored.summary.overallStatus,
        failed: stored.summary.failed,
        unknown: stored.summary.unknown
      }
    });
    sendJson(res, 200, { stored: true, report: stored, requestId });
    return true;
  }

  if (sub === 'visual-regression' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const latest = visualRegressionMatrixStore.latest(context.tenantId, projectId) ?? null;
    sendJson(res, 200, {
      report: latest,
      available: latest !== null,
      requestId
    });
    return true;
  }

  if (sub === 'visual-regression/history' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    sendJson(res, 200, {
      reports: visualRegressionMatrixStore.list(context.tenantId, projectId, parseLimit(req.url || '/', 10)),
      requestId
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // §9 — ÉVALUATION PAIRWISE + DATASET DE RÉFÉRENCE
  // -------------------------------------------------------------------------
  if (sub === 'pairwise' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const body = await readJsonBody(req);
    const files = fileStore.getAllProjectFiles(context.tenantId, projectId);
    const currentHtml = files['index.html'] ?? '';
    if (!currentHtml.trim()) {
      throw new ValidationError('Aucun index.html à comparer.', undefined, requestId);
    }

    let before: ResolvedVersion;
    if (typeof body.beforeHtml === 'string' && body.beforeHtml.trim().length > 0) {
      before = { html: body.beforeHtml, versionId: 'inline-before' };
    } else if (typeof body.beforeRevisionId === 'string' && body.beforeRevisionId.trim().length > 0) {
      before = resolveRevisionVersion(context.tenantId, projectId, body.beforeRevisionId.trim(), requestId);
    } else {
      const revisions = revisionStore.listRevisions(context.tenantId, projectId);
      const previous = revisions.length >= 2 ? revisions[revisions.length - 2] : revisions[0];
      if (!previous) {
        throw new ValidationError(
          'Aucune version antérieure : fournissez "beforeHtml" ou "beforeRevisionId".',
          { field: 'before' },
          requestId
        );
      }
      const html = previous.files['index.html']?.content ?? '';
      if (!html.trim()) {
        throw new ValidationError(
          'La version antérieure ne contient pas d’index.html.',
          { field: 'before' },
          requestId
        );
      }
      before = { html, versionId: previous.id };
    }

    let after: ResolvedVersion;
    if (typeof body.afterHtml === 'string' && body.afterHtml.trim().length > 0) {
      after = { html: body.afterHtml, versionId: 'inline-after' };
    } else if (typeof body.afterRevisionId === 'string' && body.afterRevisionId.trim().length > 0) {
      after = resolveRevisionVersion(context.tenantId, projectId, body.afterRevisionId.trim(), requestId);
    } else {
      after = { html: currentHtml, versionId: 'current' };
    }

    for (const [label, version] of [['before', before], ['after', after]] as const) {
      if (Buffer.byteLength(version.html, 'utf8') > MAX_PAGE_BYTES) {
        throw new ValidationError(
          `La version "${label}" dépasse la limite de ${MAX_PAGE_BYTES} octets.`,
          { field: label },
          requestId
        );
      }
    }

    const humanPreference =
      body.humanPreference === undefined || body.humanPreference === null || body.humanPreference === ''
        ? null
        : parsePairwisePreference(body.humanPreference, requestId);
    const evaluatorId = typeof body.evaluatorId === 'string' ? body.evaluatorId.trim() : '';
    if (humanPreference !== null && evaluatorId.length < 2) {
      throw new ValidationError(
        'Une préférence humaine exige "evaluatorId" (2 caractères minimum).',
        { field: 'evaluatorId' },
        requestId
      );
    }

    const beforeMeasurement = await measureProjectAesthetics({
      tenantId: context.tenantId,
      projectId,
      requestId,
      role: context.role,
      files: { ...files, 'index.html': before.html }
    });
    const afterMeasurement = await measureProjectAesthetics({
      tenantId: context.tenantId,
      projectId,
      requestId,
      role: context.role,
      files: { ...files, 'index.html': after.html }
    });

    const evaluation = evaluatePairwiseVisual({
      tenantId: context.tenantId,
      projectId,
      beforeVersionId: before.versionId,
      afterVersionId: after.versionId,
      before: beforeMeasurement.aqs,
      after: afterMeasurement.aqs,
      humanPreference,
      ...(evaluatorId.length > 0 ? { evaluatorId } : {}),
      ...(typeof body.notes === 'string' && body.notes.trim().length > 0 ? { notes: body.notes } : {})
    });
    const recorded = designEvaluationDatasetStore.record(evaluation);
    const comparison = versionComparator.compare(beforeMeasurement.aqs, afterMeasurement.aqs);
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_PAIRWISE_EVALUATED',
      resourceType: 'design_pairwise_evaluation',
      resourceId: evaluation.evaluationId,
      requestId,
      metadata: {
        projectId,
        beforeVersionId: before.versionId,
        afterVersionId: after.versionId,
        systemPreference: evaluation.systemPreference,
        humanPreference: evaluation.humanPreference,
        finalPreference: evaluation.finalPreference,
        coverage: evaluation.coverage
      }
    });

    sendJson(res, 200, {
      evaluated: true,
      recorded: recorded.created,
      evaluation,
      comparison,
      measurements: {
        before: {
          versionId: before.versionId,
          overall: beforeMeasurement.aqs.overall,
          coverage: beforeMeasurement.aqs.coverage,
          computedCount: beforeMeasurement.aqs.computedCount,
          unknownCount: beforeMeasurement.aqs.unknownCount,
          runtimeErrors: beforeMeasurement.runtimeErrors.length,
          layoutSource: beforeMeasurement.snapshot.layoutSource ?? 'UNKNOWN'
        },
        after: {
          versionId: after.versionId,
          overall: afterMeasurement.aqs.overall,
          coverage: afterMeasurement.aqs.coverage,
          computedCount: afterMeasurement.aqs.computedCount,
          unknownCount: afterMeasurement.aqs.unknownCount,
          runtimeErrors: afterMeasurement.runtimeErrors.length,
          layoutSource: afterMeasurement.snapshot.layoutSource ?? 'UNKNOWN'
        }
      },
      dataset: designEvaluationDatasetStore.stats(context.tenantId, projectId),
      requestId
    });
    return true;
  }

  if (sub === 'pairwise/dataset' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    sendJson(res, 200, {
      records: designEvaluationDatasetStore.list(
        context.tenantId,
        projectId,
        parseLimit(req.url || '/', 100)
      ),
      stats: designEvaluationDatasetStore.stats(context.tenantId, projectId),
      requestId
    });
    return true;
  }

  const preferenceMatch = /^pairwise\/([^/]+)\/preference$/.exec(sub);
  if (preferenceMatch && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const body = await readJsonBody(req);
    const approvedBy = requireApprover(body, requestId);
    const evaluatorId =
      typeof body.evaluatorId === 'string' && body.evaluatorId.trim().length >= 2
        ? body.evaluatorId.trim()
        : approvedBy;
    const preference = parsePairwisePreference(body.preference, requestId);
    let updated;
    try {
      updated = designEvaluationDatasetStore.setHumanPreference({
        tenantId: context.tenantId,
        projectId,
        evaluationId: preferenceMatch[1]!,
        preference,
        evaluatorId,
        evaluatedAt: new Date().toISOString(),
        ...(typeof body.notes === 'string' && body.notes.trim().length > 0 ? { notes: body.notes } : {})
      });
    } catch (error) {
      if (error instanceof PairwiseEvaluationError) {
        throw new ValidationError(error.message, { field: error.field }, requestId);
      }
      throw error;
    }
    if (!updated) {
      sendJson(res, 404, { message: `Évaluation ${preferenceMatch[1]} introuvable.`, requestId });
      return true;
    }
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_PAIRWISE_PREFERENCE_RECORDED',
      resourceType: 'design_pairwise_evaluation',
      resourceId: updated.evaluationId,
      requestId,
      metadata: { projectId, preference, evaluatorId }
    });
    sendJson(res, 200, {
      updated: true,
      evaluation: updated,
      dataset: designEvaluationDatasetStore.stats(context.tenantId, projectId),
      requestId
    });
    return true;
  }

  return false;
}
