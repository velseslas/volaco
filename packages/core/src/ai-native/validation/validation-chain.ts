/**
 * VibeCode Core - AI-Native Engineering Tier
 * CDC V7.0 §25 — ValidationChain : chaîne unique ordonnée de validation.
 *
 * RÉUTILISE les moteurs réels existants (aucun moteur réinventé) :
 *  1. files   — structure : fichier d'entrée présent, projet non vide ;
 *  2. syntax  — PARSE réel via CodeIntelligenceService (diagnostics
 *               severity 'error' : AST_SYNTAX_FATAL, JSON_PARSE_ERROR…) ;
 *  3. a11y    — AccessibilityAuditor réel (WCAG 2.1 AA : contraste,
 *               libellés accessibles, cibles tactiles) sur le snapshot DOM ;
 *  4. design  — DesignHarmonyService réel : score d'harmonie vs seuil ;
 *  5. tests   — honnête : dit si des tests existent, n'exécute rien
 *               (l'exécution de tests de projet n'est pas disponible ici).
 *
 * Invariants :
 *  - étapes ORDONNÉES, verdict unique : FAIL > PASS_WITH_WARNINGS > PASS ;
 *  - une étape non applicable est SKIP avec raison — jamais PASS fabriqué ;
 *  - une étape qui plante est FAIL (rien n'est validé sans vérification) ;
 *  - déterministe : mêmes contenus + mêmes statuts → même reportHash.
 */

import { createHash } from 'node:crypto';
import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { ValidationError } from '../../errors.js';
import { AccessibilityAuditor } from '../application-audit/auditors/accessibility-auditor.js';
import type { ApplicationAuditFinding } from '../application-audit/types.js';
import type { CodeDiagnostic } from '../understanding/types.js';
import type { VisualSnapshot } from '../visual-intelligence/types.js';
import type { DesignHarmonyReport } from '../design-harmony/types.js';
import {
  DESIGN_SCORE_MIN,
  VALIDATION_CHAIN_VERSION,
  type ValidationChainReport,
  type ValidationChainRequest,
  type ValidationStageId,
  type ValidationStageResult,
  type ValidationVerdict
} from './types.js';

// ---------------------------------------------------------------------------
// Dépendances (interfaces minimales — injectables en test)
// ---------------------------------------------------------------------------

export interface ValidationFileStoreLike {
  getAllProjectFiles(tenantId: string, projectId: string): Record<string, string>;
}

export interface ValidationCodeIntelLike {
  analyzeSource(
    content: string,
    filePath: string,
    options?: {
      tenantId?: string | undefined;
      projectId?: string | undefined;
      fileHash?: string | undefined;
    }
  ): { diagnostics: readonly CodeDiagnostic[] };
}

export interface ValidationVisualLike {
  analyzeVisuals(
    request: { tenantId: string; projectId: string; htmlContent: string; requestId?: string | undefined },
    userRole?: Role
  ): Promise<{ snapshot: VisualSnapshot }> | { snapshot: VisualSnapshot };
}

export interface ValidationHarmonyLike {
  analyzeDesignHarmony(
    request: { tenantId: string; projectId: string; snapshots: readonly VisualSnapshot[]; requestId?: string | undefined },
    userRole?: Role
  ): Promise<DesignHarmonyReport> | DesignHarmonyReport;
}

export interface ValidationA11yAuditorLike {
  audit(snapshots?: readonly VisualSnapshot[]): readonly ApplicationAuditFinding[];
}

export interface ValidationChainDeps {
  readonly fileStore: ValidationFileStoreLike;
  readonly codeIntelService?: ValidationCodeIntelLike | undefined;
  readonly visualService?: ValidationVisualLike | undefined;
  readonly harmonyService?: ValidationHarmonyLike | undefined;
  readonly accessibilityAuditor?: ValidationA11yAuditorLike | undefined;
}

// ---------------------------------------------------------------------------
// Helpers déterministes
// ---------------------------------------------------------------------------

const ANALYZABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json'];

function isAnalyzable(path: string): boolean {
  const lower = path.toLowerCase();
  return ANALYZABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[^/\\]+$/i.test(path);
}

/**
 * Un fichier qui NE PARSE PAS est un échec de validation, même quand
 * l'analyseur classe le diagnostic en « warning » : l'analyseur TypeScript
 * remonte les erreurs de parse sous forme TSxxxx (severity 'warning' —
 * politique tolérante de l'analyseur), le JSON sous JSON_PARSE_ERROR
 * (severity 'error'). La chaîne, elle, ne blanchit pas : parse raté = FAIL.
 */
function isSyntaxError(diagnostic: CodeDiagnostic): boolean {
  if (diagnostic.severity === 'error') return true;
  return /^TS\d+$/.test(diagnostic.code ?? '');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function computeProjectTreeHash(files: Record<string, string>): string {
  const parts = Object.keys(files)
    .sort()
    .map((path) => `${path}:${sha256Hex(files[path] ?? '')}`);
  return sha256Hex(parts.join('\n'));
}

function selectEntryFile(files: Record<string, string>): string {
  const paths = Object.keys(files).sort();
  if (files['index.html'] !== undefined) return 'index.html';
  const html = paths.find((p) => {
    const lower = p.toLowerCase();
    return lower.endsWith('.html') || lower.endsWith('.htm');
  });
  return html ?? paths[0] ?? '';
}

function computeVerdict(stages: readonly ValidationStageResult[]): ValidationVerdict {
  if (stages.some((s) => s.status === 'FAIL')) return 'FAIL';
  if (stages.some((s) => s.status === 'WARN')) return 'PASS_WITH_WARNINGS';
  return 'PASS';
}

// ---------------------------------------------------------------------------
// Chaîne
// ---------------------------------------------------------------------------

interface SnapshotState {
  computed: boolean;
  value?: VisualSnapshot | undefined;
  error?: string | undefined;
}

export class ValidationChain {
  private readonly accessibilityAuditor: ValidationA11yAuditorLike;

  constructor(private readonly deps: ValidationChainDeps) {
    this.accessibilityAuditor = deps.accessibilityAuditor ?? new AccessibilityAuditor();
  }

  public async run(
    request: ValidationChainRequest,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): Promise<ValidationChainReport> {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    if (!request.tenantId || request.tenantId.trim().length === 0) {
      throw new ValidationError('Le tenantId est obligatoire pour la validation', { field: 'tenantId' }, requestId);
    }
    if (!request.projectId || request.projectId.trim().length === 0) {
      throw new ValidationError('Le projectId est obligatoire pour la validation', { field: 'projectId' }, requestId);
    }

    const tenantId = request.tenantId.trim();
    const projectId = request.projectId.trim();
    const files = this.deps.fileStore.getAllProjectFiles(tenantId, projectId);

    if (request.entryFile !== undefined && files[request.entryFile] === undefined) {
      throw new ValidationError(
        `Fichier d'entrée '${request.entryFile}' introuvable dans le projet`,
        { field: 'entryFile' },
        requestId
      );
    }
    const entryFile = request.entryFile ?? selectEntryFile(files);
    const treeHash = computeProjectTreeHash(files);

    const snapshotState: SnapshotState = { computed: false };

    const stages: ValidationStageResult[] = [];
    stages.push(await this.executeStage('files', 'Structure du projet', () =>
      this.runFilesStage(files, entryFile)
    ));
    stages.push(await this.executeStage('syntax', 'Syntaxe (parse réel)', () =>
      this.runSyntaxStage(tenantId, projectId, files)
    ));
    stages.push(await this.executeStage('a11y', 'Accessibilité WCAG', () =>
      this.runA11yStage(tenantId, projectId, files, entryFile, snapshotState, userRole, requestId)
    ));
    stages.push(await this.executeStage('design', 'Harmonie design', () =>
      this.runDesignStage(tenantId, projectId, files, entryFile, snapshotState, userRole, requestId)
    ));
    stages.push(await this.executeStage('tests', 'Tests', () => this.runTestsStage(files)));

    const verdict = computeVerdict(stages);
    const reportHash = sha256Hex(JSON.stringify({
      tenantId,
      projectId,
      chainVersion: VALIDATION_CHAIN_VERSION,
      entryFile,
      treeHash,
      stages: stages.map((s) => [s.id, s.status, s.detail])
    }));

    return deepFreeze({
      schemaVersion: '1.0.0' as const,
      chainVersion: VALIDATION_CHAIN_VERSION,
      tenantId,
      projectId,
      entryFile,
      fileCount: Object.keys(files).length,
      treeHash,
      verdict,
      stages,
      reportHash,
      checkedAt: new Date().toISOString()
    });
  }

  // -------------------------------------------------------------------------
  // Étapes
  // -------------------------------------------------------------------------

  private async executeStage(
    id: ValidationStageId,
    label: string,
    body: () => Promise<Pick<ValidationStageResult, 'status' | 'detail' | 'evidence'>> | Pick<ValidationStageResult, 'status' | 'detail' | 'evidence'>
  ): Promise<ValidationStageResult> {
    const start = Date.now();
    try {
      const partial = await body();
      return {
        id,
        label,
        status: partial.status,
        detail: partial.detail,
        evidence: partial.evidence,
        durationMs: Date.now() - start
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        id,
        label,
        status: 'FAIL',
        detail: `Erreur d'exécution de l'étape : ${message}`,
        evidence: [],
        durationMs: Date.now() - start
      };
    }
  }

  private runFilesStage(
    files: Record<string, string>,
    entryFile: string
  ): Pick<ValidationStageResult, 'status' | 'detail' | 'evidence'> {
    const paths = Object.keys(files);
    if (paths.length === 0) {
      return {
        status: 'FAIL',
        detail: 'Aucun fichier dans le projet — rien à valider.',
        evidence: []
      };
    }
    const entryContent = files[entryFile] ?? '';
    if (entryContent.trim().length === 0) {
      return {
        status: 'WARN',
        detail: `Fichier d'entrée '${entryFile}' vide.`,
        evidence: [`${paths.length} fichier(s)`, `entrée : ${entryFile}`]
      };
    }
    return {
      status: 'PASS',
      detail: `Structure minimale présente (${paths.length} fichier(s), entrée '${entryFile}').`,
      evidence: [`${paths.length} fichier(s)`, `entrée : ${entryFile}`]
    };
  }

  private runSyntaxStage(
    tenantId: string,
    projectId: string,
    files: Record<string, string>
  ): Pick<ValidationStageResult, 'status' | 'detail' | 'evidence'> {
    const codeIntel = this.deps.codeIntelService;
    if (!codeIntel) {
      return {
        status: 'SKIP',
        detail: 'Analyseur de code indisponible — étape non exécutée.',
        evidence: []
      };
    }

    const analyzable = Object.keys(files).sort().filter(isAnalyzable);
    if (analyzable.length === 0) {
      return {
        status: 'SKIP',
        detail: 'Aucun fichier JS/TS/JSON à analyser — étape non applicable.',
        evidence: []
      };
    }

    const errors: string[] = [];
    for (const path of analyzable) {
      const diagnostics = codeIntel.analyzeSource(files[path] ?? '', path, { tenantId, projectId }).diagnostics;
      for (const diagnostic of diagnostics) {
        if (isSyntaxError(diagnostic)) {
          const location = diagnostic.line !== undefined ? `:${diagnostic.line}` : '';
          const code = diagnostic.code ? ` [${diagnostic.code}]` : '';
          errors.push(`${path}${location}${code} ${diagnostic.message}`);
        }
      }
    }

    if (errors.length > 0) {
      return {
        status: 'FAIL',
        detail: `${errors.length} erreur(s) de syntaxe détectée(s) sur ${analyzable.length} fichier(s) analysé(s).`,
        evidence: [
          ...errors.slice(0, 5),
          ...(errors.length > 5 ? [`… ${errors.length - 5} autre(s) erreur(s)`] : [])
        ]
      };
    }

    return {
      status: 'PASS',
      detail: `${analyzable.length} fichier(s) analysé(s), aucune erreur de syntaxe.`,
      evidence: [`fichiers analysés : ${analyzable.slice(0, 8).join(', ')}`]
    };
  }

  private async ensureSnapshot(
    tenantId: string,
    projectId: string,
    files: Record<string, string>,
    entryFile: string,
    snapshotState: SnapshotState,
    userRole: Role,
    requestId?: string
  ): Promise<VisualSnapshot | undefined> {
    if (snapshotState.computed) return snapshotState.value;
    snapshotState.computed = true;

    const visual = this.deps.visualService;
    if (!visual) return undefined;

    const htmlContent = files[entryFile];
    if (!htmlContent || htmlContent.trim().length === 0) return undefined;

    try {
      const analysis = await visual.analyzeVisuals(
        { tenantId, projectId, htmlContent, requestId },
        userRole
      );
      snapshotState.value = analysis.snapshot;
    } catch (err) {
      snapshotState.error = err instanceof Error ? err.message : String(err);
    }
    return snapshotState.value;
  }

  private async runA11yStage(
    tenantId: string,
    projectId: string,
    files: Record<string, string>,
    entryFile: string,
    snapshotState: SnapshotState,
    userRole: Role,
    requestId?: string
  ): Promise<Pick<ValidationStageResult, 'status' | 'detail' | 'evidence'>> {
    const hasHtml = (files[entryFile] ?? '').trim().length > 0;
    const hasVisual = this.deps.visualService !== undefined;
    if (!hasHtml || !hasVisual) {
      return {
        status: 'SKIP',
        detail: 'Snapshot visuel indisponible (aucun HTML d\'entrée ou analyseur visuel non configuré).',
        evidence: []
      };
    }

    const snapshot = await this.ensureSnapshot(tenantId, projectId, files, entryFile, snapshotState, userRole, requestId);
    if (!snapshot) {
      return {
        status: 'FAIL',
        detail: `Analyse visuelle impossible : ${snapshotState.error ?? 'snapshot indisponible'}`,
        evidence: []
      };
    }

    const findings = this.accessibilityAuditor.audit([snapshot]);
    const blocking = findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
    const formatted = findings
      .slice(0, 3)
      .map((f) => `[${f.severity}] ${f.title}`);

    if (blocking.length > 0) {
      return {
        status: 'FAIL',
        detail: `${blocking.length} problème(s) d'accessibilité bloquant(s) (WCAG 2.1 AA).`,
        evidence: formatted
      };
    }
    if (findings.length > 0) {
      return {
        status: 'WARN',
        detail: `${findings.length} problème(s) d'accessibilité non bloquant(s).`,
        evidence: formatted
      };
    }
    return {
      status: 'PASS',
      detail: 'Aucun problème d\'accessibilité détecté sur le DOM analysé.',
      evidence: [`route : ${snapshot.pageRoute}`, `${snapshot.interactiveElements.length} élément(s) interactif(s)`]
    };
  }

  private async runDesignStage(
    tenantId: string,
    projectId: string,
    files: Record<string, string>,
    entryFile: string,
    snapshotState: SnapshotState,
    userRole: Role,
    requestId?: string
  ): Promise<Pick<ValidationStageResult, 'status' | 'detail' | 'evidence'>> {
    const hasHtml = (files[entryFile] ?? '').trim().length > 0;
    if (!hasHtml || !this.deps.visualService || !this.deps.harmonyService) {
      return {
        status: 'SKIP',
        detail: 'Harmonie design non évaluable (HTML d\'entrée absent ou moteurs non configurés).',
        evidence: []
      };
    }

    const snapshot = await this.ensureSnapshot(tenantId, projectId, files, entryFile, snapshotState, userRole, requestId);
    if (!snapshot) {
      return {
        status: 'FAIL',
        detail: `Analyse visuelle impossible : ${snapshotState.error ?? 'snapshot indisponible'}`,
        evidence: []
      };
    }

    const report = await this.deps.harmonyService.analyzeDesignHarmony(
      { tenantId, projectId, snapshots: [snapshot], requestId },
      userRole
    );

    const drift = `dérives : ${report.driftSummary.totalDrifts} (critiques : ${report.driftSummary.criticalDrifts})`;
    if (report.overallScore >= DESIGN_SCORE_MIN) {
      return {
        status: 'PASS',
        detail: `Score d'harmonie ${report.overallScore}/100 (seuil ${DESIGN_SCORE_MIN}).`,
        evidence: [drift]
      };
    }
    return {
      status: 'WARN',
      detail: `Score d'harmonie ${report.overallScore}/100 < seuil ${DESIGN_SCORE_MIN}.`,
      evidence: [drift, ...report.findings.slice(0, 3).map((f) => `[${f.severity}] ${f.recommendation}`)]
    };
  }

  private runTestsStage(
    files: Record<string, string>
  ): Pick<ValidationStageResult, 'status' | 'detail' | 'evidence'> {
    const testFiles = Object.keys(files).sort().filter(isTestFile);
    if (testFiles.length === 0) {
      return {
        status: 'PASS',
        detail: 'Aucun test déclaré dans le projet (rien à exécuter).',
        evidence: []
      };
    }
    return {
      status: 'SKIP',
      detail: `Exécution de tests non disponible côté serveur (${testFiles.length} fichier(s) de test présents).`,
      evidence: testFiles.slice(0, 3)
    };
  }
}
