/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Application Audit Service - Master Facade
 */

import { randomUUID, createHash } from 'node:crypto';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { NotFoundError } from '../../errors.js';
import { auditStore } from '../../observability/audit.js';
import { ArchitectureAuditor } from './auditors/architecture-auditor.js';
import { CodeQualityAuditor } from './auditors/code-quality-auditor.js';
import { SecurityAuditor } from './auditors/security-auditor.js';
import { PerformanceAuditor } from './auditors/performance-auditor.js';
import { UXAuditor } from './auditors/ux-auditor.js';
import { AccessibilityAuditor } from './auditors/accessibility-auditor.js';
import { AIConfigAuditor } from './auditors/ai-config-auditor.js';
import { DesignHarmonyBridgeAuditor } from './auditors/design-harmony-bridge-auditor.js';
import { ApplicationAuditScoreEngine } from './engine/score-engine.js';
import { FindingsAggregator } from './engine/findings-aggregator.js';
import { ApplicationAuditLruCache } from './cache.js';
import {
  computeApplicationAuditHash,
  deepFreeze
} from './canonical.js';
import type {
  ApplicationAuditComparison,
  ApplicationAuditFinding,
  ApplicationAuditReport,
  ApplicationAuditRequest,
  AuditDimension,
  AuditDimensionStatus,
  AuditDimensionStatusMap
} from './types.js';

export class ApplicationAuditService {
  private readonly architectureAuditor = new ArchitectureAuditor();
  private readonly codeQualityAuditor = new CodeQualityAuditor();
  private readonly securityAuditor = new SecurityAuditor();
  private readonly performanceAuditor = new PerformanceAuditor();
  private readonly uxAuditor = new UXAuditor();
  private readonly accessibilityAuditor = new AccessibilityAuditor();
  private readonly aiConfigAuditor = new AIConfigAuditor();
  private readonly designHarmonyAuditor = new DesignHarmonyBridgeAuditor();

  private readonly scoreEngine = new ApplicationAuditScoreEngine();
  private readonly findingsAggregator = new FindingsAggregator();
  private readonly cache: ApplicationAuditLruCache;

  constructor(cacheCapacity = 50) {
    this.cache = new ApplicationAuditLruCache(cacheCapacity);
  }

  public async analyzeApplication(
    request: ApplicationAuditRequest,
    userRole?: Role,
    requestId?: string | undefined
  ): Promise<ApplicationAuditReport> {
    const effectiveRole = userRole ?? request.callerRole ?? 'VIEWER';
    assertPermission(effectiveRole, 'PROJECT_READ', requestId);

    const { tenantId, projectId, files = [], snapshots = [], dna, designHarmonyReport, config } = request;
    if (!tenantId || !tenantId.trim()) {
      throw new Error('tenantId est requis.');
    }
    if (!projectId || !projectId.trim()) {
      throw new Error('projectId est requis.');
    }
    const startTime = Date.now();

    // 1. Compute Request Fingerprint for Cache
    const filesContent = files.map((f) => `${f.path}:${f.content.length}`).sort().join('|');
    const snapContent = snapshots.map((s) => s.snapshotHash).sort().join('|');
    const dnaHash = dna ? dna.dnaHash : 'nodna';
    const dhHash = designHarmonyReport ? designHarmonyReport.reportHash : 'nodh';

    const cacheKey = `${tenantId}:${projectId}:${createHash('sha256').update(`${filesContent}:${snapContent}:${dnaHash}:${dhHash}`, 'utf8').digest('hex').substring(0, 16)}`;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Execute 8 Auditors
    const enabled = config?.enabledDimensions ?? [
      'ARCHITECTURE',
      'CODE_QUALITY',
      'SECURITY',
      'PERFORMANCE',
      'UX',
      'ACCESSIBILITY',
      'AI_CONFIG',
      'DESIGN_HARMONY'
    ];

    // Preuves réellement disponibles pour chaque dimension. Une dimension
    // sans preuve reste UNKNOWN : elle ne doit jamais être notée 100.
    const dimensionStatus: Record<AuditDimension, AuditDimensionStatus> = {
      ARCHITECTURE: 'UNKNOWN',
      CODE_QUALITY: 'UNKNOWN',
      SECURITY: 'UNKNOWN',
      PERFORMANCE: 'UNKNOWN',
      UX: 'UNKNOWN',
      ACCESSIBILITY: 'UNKNOWN',
      AI_CONFIG: 'UNKNOWN',
      DESIGN_HARMONY: 'UNKNOWN'
    };

    if (enabled.includes('ARCHITECTURE')) {
      dimensionStatus.ARCHITECTURE = files.length > 0 ? 'MEASURED' : 'UNKNOWN';
    }
    if (enabled.includes('CODE_QUALITY')) {
      dimensionStatus.CODE_QUALITY = files.length > 0 ? 'MEASURED' : 'UNKNOWN';
    }
    if (enabled.includes('SECURITY')) {
      dimensionStatus.SECURITY = files.length > 0 ? 'MEASURED' : 'UNKNOWN';
    }
    if (enabled.includes('PERFORMANCE')) {
      dimensionStatus.PERFORMANCE = snapshots.length > 0
        ? 'MEASURED'
        : (files.length > 0 ? 'PARTIAL' : 'UNKNOWN');
    }
    if (enabled.includes('UX')) {
      dimensionStatus.UX = snapshots.length > 0
        ? 'MEASURED'
        : (files.length > 0 ? 'PARTIAL' : 'UNKNOWN');
    }
    if (enabled.includes('ACCESSIBILITY')) {
      dimensionStatus.ACCESSIBILITY = snapshots.length > 0 ? 'MEASURED' : 'UNKNOWN';
    }
    if (enabled.includes('AI_CONFIG')) {
      dimensionStatus.AI_CONFIG = files.length > 0 ? 'MEASURED' : 'UNKNOWN';
    }
    if (enabled.includes('DESIGN_HARMONY')) {
      dimensionStatus.DESIGN_HARMONY = designHarmonyReport ? 'MEASURED' : 'UNKNOWN';
    }

    const rawFindings: ApplicationAuditFinding[] = [];

    if (enabled.includes('ARCHITECTURE')) {
      rawFindings.push(...this.architectureAuditor.audit(files, dna));
    }
    if (enabled.includes('CODE_QUALITY')) {
      rawFindings.push(
        ...this.codeQualityAuditor.audit(
          files,
          config?.cyclomaticComplexityThreshold,
          config?.maxFunctionLinesThreshold
        )
      );
    }
    if (enabled.includes('SECURITY')) {
      rawFindings.push(...this.securityAuditor.audit(files));
    }
    if (enabled.includes('PERFORMANCE')) {
      rawFindings.push(...this.performanceAuditor.audit(files, snapshots, config?.maxDomElementsThreshold));
    }
    if (enabled.includes('UX')) {
      rawFindings.push(...this.uxAuditor.audit(files, snapshots));
    }
    if (enabled.includes('ACCESSIBILITY')) {
      rawFindings.push(...this.accessibilityAuditor.audit(snapshots));
    }
    if (enabled.includes('AI_CONFIG')) {
      rawFindings.push(...this.aiConfigAuditor.audit(files));
    }
    if (enabled.includes('DESIGN_HARMONY')) {
      rawFindings.push(...this.designHarmonyAuditor.audit(designHarmonyReport));
    }

    // 3. Aggregate & Enforce NO EVIDENCE -> NO CLAIM
    const { findings, summary } = this.findingsAggregator.aggregate(rawFindings);

    // 4. Compute Scores
    const baselineHarmony = designHarmonyReport ? designHarmonyReport.overallScore : undefined;
    const { overallScore, dimensionScores, dimensionStatus: computedStatus, coverage } =
      this.scoreEngine.computeScores(findings, baselineHarmony, dimensionStatus);

    const durationMs = Date.now() - startTime;
    const reportId = `aar-${randomUUID().slice(0, 8)}`;

    const auditHash = computeApplicationAuditHash({
      tenantId,
      projectId,
      overallScore,
      findingsCount: findings.length,
      dimensionScores,
      dimensionStatus: computedStatus,
      coverage
    });

    const report: ApplicationAuditReport = deepFreeze({
      reportId,
      tenantId,
      projectId,
      overallScore,
      dimensionScores,
      dimensionStatus: computedStatus,
      coverage,
      findings,
      summary,
      auditHash,
      createdAt: new Date().toISOString(),
      durationMs
    });

    // 5. Store in Cache
    this.cache.set(cacheKey, report);
    this.cache.set(reportId, report);

    // 6. Record Observability Audit
    auditStore.record({
      tenantId,
      userId: 'system',
      action: 'APPLICATION_AUDIT_COMPLETED',
      resourceType: 'application_audit',
      resourceId: reportId,
      status: 'SUCCESS',
      metadata: {
        projectId,
        overallScore,
        totalFindings: findings.length,
        criticalCount: summary.criticalCount,
        highCount: summary.highCount,
        durationMs
      },
      requestId: requestId || 'req-app-audit'
    });

    return report;
  }

  public getReport(
    reportId: string,
    tenantId: string,
    userRole: Role = 'VIEWER',
    requestId?: string | undefined
  ): ApplicationAuditReport {
    assertPermission(userRole, 'PROJECT_READ', requestId);
    const rep = this.cache.get(reportId);
    if (!rep) {
      throw new NotFoundError(`Rapport d'audit '${reportId}' introuvable.`);
    }

    // Strict multi-tenant isolation
    if (rep.tenantId !== tenantId) {
      throw new NotFoundError(`Rapport d'audit '${reportId}' introuvable.`);
    }

    return rep;
  }

  public compareReports(
    prev: ApplicationAuditReport,
    curr: ApplicationAuditReport
  ): ApplicationAuditComparison {
    const scoreDelta = curr.overallScore === null || prev.overallScore === null
      ? null
      : curr.overallScore - prev.overallScore;

    const delta = (current: number | null, previous: number | null): number | null =>
      current === null || previous === null ? null : current - previous;

    const dimensionDeltas: Record<AuditDimension, number | null> = {
      ARCHITECTURE: delta(curr.dimensionScores.architecture, prev.dimensionScores.architecture),
      CODE_QUALITY: delta(curr.dimensionScores.codeQuality, prev.dimensionScores.codeQuality),
      SECURITY: delta(curr.dimensionScores.security, prev.dimensionScores.security),
      PERFORMANCE: delta(curr.dimensionScores.performance, prev.dimensionScores.performance),
      UX: delta(curr.dimensionScores.ux, prev.dimensionScores.ux),
      ACCESSIBILITY: delta(curr.dimensionScores.accessibility, prev.dimensionScores.accessibility),
      AI_CONFIG: delta(curr.dimensionScores.aiConfig, prev.dimensionScores.aiConfig),
      DESIGN_HARMONY: delta(curr.dimensionScores.designHarmony, prev.dimensionScores.designHarmony)
    };

    const prevIds = new Set(prev.findings.map((f) => f.id));
    const currIds = new Set(curr.findings.map((f) => f.id));

    const resolvedFindingIds = prev.findings.filter((f) => !currIds.has(f.id)).map((f) => f.id);
    const newFindingIds = curr.findings.filter((f) => !prevIds.has(f.id)).map((f) => f.id);

    const improvements: string[] = [];
    const regressions: string[] = [];

    if (scoreDelta !== null && scoreDelta > 0) {
      improvements.push(`Score global en hausse de +${scoreDelta} points (${prev.overallScore} -> ${curr.overallScore}).`);
    } else if (scoreDelta !== null && scoreDelta < 0) {
      regressions.push(`Score global en baisse de ${scoreDelta} points (${prev.overallScore} -> ${curr.overallScore}).`);
    }

    if (resolvedFindingIds.length > 0) {
      improvements.push(`${resolvedFindingIds.length} anomalie(s) résolue(s).`);
    }

    if (newFindingIds.length > 0) {
      regressions.push(`${newFindingIds.length} nouvelle(s) anomalie(s) détectée(s).`);
    }

    return {
      previousReportId: prev.reportId,
      currentReportId: curr.reportId,
      scoreDelta,
      dimensionDeltas,
      resolvedFindingIds,
      newFindingIds,
      improvements,
      regressions
    };
  }

  public async auditApplication(
    request: ApplicationAuditRequest,
    userRole?: Role,
    requestId?: string
  ): Promise<ApplicationAuditReport> {
    return this.analyzeApplication(request, userRole, requestId);
  }

  public compareAuditReports(
    prev: ApplicationAuditReport,
    curr: ApplicationAuditReport
  ): ApplicationAuditComparison {
    return this.compareReports(prev, curr);
  }

  public getCacheMetrics() {
    return this.cache.getMetrics();
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
