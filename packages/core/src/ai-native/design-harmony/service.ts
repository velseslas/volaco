/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Design Harmony Service Facade
 */

import { randomUUID } from 'node:crypto';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { auditStore } from '../../observability/audit.js';
import { NotFoundError } from '../../errors.js';
import type { AIProviderRegistry } from '../../ai/providers/registry.js';
import type { AgentTask } from '../ai-orchestrator/types.js';
import {
  compareFindings,
  computeDesignHarmonyReportHash,
  deepFreeze
} from './canonical.js';
import { DesignHarmonyLruCache } from './cache.js';
import { TokenInferer } from './engine/token-inferer.js';
import { DriftDetector } from './engine/drift-detector.js';
import { ComponentHarmonyEngine } from './engine/component-harmony.js';
import { CrossPageHarmonyEngine } from './engine/cross-page-harmony.js';
import { ResponsiveA11yHarmonyEngine } from './engine/responsive-a11y-harmony.js';
import { ScoreEngine } from './engine/score-engine.js';
import { RecommendationEngine } from './engine/recommendation-engine.js';
import { DesignHarmonyConversationBridge } from './bridge/conversation-bridge.js';
import { DesignHarmonyOrchestratorBridge } from './bridge/orchestrator-bridge.js';
import type {
  DesignHarmonyComparison,
  DesignHarmonyConfig,
  DesignHarmonyFinding,
  DesignHarmonyReport,
  DesignHarmonyRequest
} from './types.js';

export const DEFAULT_DESIGN_HARMONY_CONFIG: DesignHarmonyConfig = {
  cacheMaxEntries: 100,
  minConfidenceThreshold: 0.7,
  enableLLMSynthesis: false
};

export class DesignHarmonyService {
  private readonly config: DesignHarmonyConfig;
  private readonly cache: DesignHarmonyLruCache;
  private readonly tokenInferer: TokenInferer;
  private readonly driftDetector: DriftDetector;
  private readonly componentHarmony: ComponentHarmonyEngine;
  private readonly crossPageHarmony: CrossPageHarmonyEngine;
  private readonly responsiveA11yHarmony: ResponsiveA11yHarmonyEngine;
  private readonly scoreEngine: ScoreEngine;
  private readonly recommendationEngine: RecommendationEngine;
  private readonly conversationBridge: DesignHarmonyConversationBridge;
  private readonly orchestratorBridge: DesignHarmonyOrchestratorBridge;

  constructor(
    private readonly providerRegistry?: AIProviderRegistry | undefined,
    config?: Partial<DesignHarmonyConfig> | undefined
  ) {
    this.config = {
      ...DEFAULT_DESIGN_HARMONY_CONFIG,
      ...config
    };

    this.cache = new DesignHarmonyLruCache(this.config.cacheMaxEntries);
    this.tokenInferer = new TokenInferer();
    this.driftDetector = new DriftDetector();
    this.componentHarmony = new ComponentHarmonyEngine();
    this.crossPageHarmony = new CrossPageHarmonyEngine();
    this.responsiveA11yHarmony = new ResponsiveA11yHarmonyEngine();
    this.scoreEngine = new ScoreEngine();
    this.recommendationEngine = new RecommendationEngine();
    this.conversationBridge = new DesignHarmonyConversationBridge();
    this.orchestratorBridge = new DesignHarmonyOrchestratorBridge();
  }

  public async analyzeDesignHarmony(
    request: DesignHarmonyRequest,
    userRole: Role = 'VIEWER'
  ): Promise<DesignHarmonyReport> {
    const { tenantId, projectId, snapshots, requestId } = request;
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const startMs = Date.now();

    // Compute composite cache key
    const snapshotHashes = snapshots.map((s) => s.snapshotHash).sort().join(',');
    const cacheKey = `${tenantId}:${projectId}:${snapshotHashes}`;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const analyzedRoutes = Array.from(new Set(snapshots.map((s) => s.pageRoute))).sort();

    // 1. Infer Design System tokens
    const inferredDesignSystem = this.tokenInferer.inferDesignSystem(snapshots);

    // 2. Detect Drifts and Inconsistencies across dimensions
    const driftFindings = this.driftDetector.detectDrifts(snapshots, inferredDesignSystem);
    const componentFindings = this.componentHarmony.analyzeComponentClusters(snapshots);
    const crossPageFindings = this.crossPageHarmony.analyzeCrossPageConsistency(snapshots);
    const a11yFindings = this.responsiveA11yHarmony.analyzeResponsiveAndA11y(snapshots);

    // Combine and sort findings
    const allFindings: DesignHarmonyFinding[] = [
      ...driftFindings,
      ...componentFindings,
      ...crossPageFindings,
      ...a11yFindings
    ].filter((f) => f.confidence >= this.config.minConfidenceThreshold);

    allFindings.sort(compareFindings);

    // 3. Compute Deterministic Harmony Scores
    const { overallScore, subScores } = this.scoreEngine.computeScores(allFindings);

    // 4. Summarize Drifts
    const totalDrifts = allFindings.filter((f) => f.designDrift).length;
    const criticalDrifts = allFindings.filter((f) => f.designDrift && (f.severity === 'HIGH' || f.severity === 'CRITICAL')).length;

    // 5. Compute Report Hash
    const reportHash = computeDesignHarmonyReportHash({
      tenantId,
      projectId,
      overallScore,
      routes: analyzedRoutes,
      findingsCount: allFindings.length
    });

    const reportId = `dhr-${randomUUID().slice(0, 12)}`;
    const durationMs = Date.now() - startMs;

    // Optional LLM synthesis narrative if enabled and registry present
    let llmSummary: string | undefined = undefined;
    if (this.config.enableLLMSynthesis && this.providerRegistry) {
      try {
        const fastAdapter = this.providerRegistry.resolve({ capabilities: ['FAST'] });
        if (fastAdapter) {
          const resp = await fastAdapter.generate({
            tenantId,
            projectId,
            prompt: `Synthétise en 2 phrases professionnelles ce score de Design Harmony (${overallScore}/100) avec ${allFindings.length} remarques.`,
            requestId
          });
          llmSummary = resp.text.trim();
        }
      } catch {
        // Fallback gracefully without throwing
      }
    }

    const report: DesignHarmonyReport = deepFreeze({
      reportId,
      tenantId,
      projectId,
      analyzedRoutes,
      overallScore,
      subScores,
      inferredDesignSystem,
      findings: allFindings,
      driftSummary: {
        totalDrifts,
        criticalDrifts
      },
      reportHash,
      generatedAt: new Date().toISOString(),
      durationMs,
      llmSummary
    });

    // Store in cache
    this.cache.set(cacheKey, report);
    this.cache.set(reportId, report);

    // Record observability audit
    auditStore.record({
      tenantId,
      userId: 'system',
      action: 'DESIGN_HARMONY_AUDIT_COMPLETED',
      resourceType: 'design_harmony',
      resourceId: reportId,
      status: 'SUCCESS',
      metadata: {
        projectId,
        overallScore,
        findingsCount: allFindings.length,
        totalDrifts,
        routesCount: analyzedRoutes.length
      },
      requestId: requestId ?? 'req-dh'
    });

    return report;
  }

  public getReport(
    reportId: string,
    tenantId: string,
    userRole: Role = 'VIEWER',
    requestId?: string | undefined
  ): DesignHarmonyReport | undefined {
    assertPermission(userRole, 'PROJECT_READ', requestId);
    const report = this.cache.get(reportId);
    if (!report) return undefined;

    // Strict multi-tenant check
    if (report.tenantId !== tenantId) {
      throw new NotFoundError(`Rapport d'harmonie '${reportId}' introuvable.`);
    }

    return report;
  }

  public compareReports(
    previousReport: DesignHarmonyReport,
    currentReport: DesignHarmonyReport
  ): DesignHarmonyComparison {
    const scoreDelta = currentReport.overallScore - previousReport.overallScore;

    const prevDriftProps = new Set(previousReport.findings.filter((f) => f.designDrift).map((f) => `${f.pageRoute}:${f.property}`));
    const currDriftProps = new Set(currentReport.findings.filter((f) => f.designDrift).map((f) => `${f.pageRoute}:${f.property}`));

    const newDrifts = currentReport.findings.filter((f) => f.designDrift && !prevDriftProps.has(`${f.pageRoute}:${f.property}`));
    const resolvedDrifts: string[] = [];

    for (const prop of prevDriftProps) {
      if (!currDriftProps.has(prop)) {
        resolvedDrifts.push(`Résolu : drift sur ${prop}`);
      }
    }

    const improvements: string[] = [];
    const regressions: string[] = [];

    if (scoreDelta > 0) {
      improvements.push(`Score global en hausse de +${scoreDelta} points (${previousReport.overallScore} -> ${currentReport.overallScore})`);
    } else if (scoreDelta < 0) {
      regressions.push(`Score global en baisse de ${scoreDelta} points (${previousReport.overallScore} -> ${currentReport.overallScore})`);
    }

    return {
      previousReportId: previousReport.reportId,
      currentReportId: currentReport.reportId,
      scoreDelta,
      improvements,
      regressions,
      newDrifts,
      resolvedDrifts
    };
  }

  public explainReport(report: DesignHarmonyReport): string {
    return this.conversationBridge.explainDesignHarmony(report);
  }

  public proposeRemediationTasks(report: DesignHarmonyReport): readonly AgentTask[] {
    return this.orchestratorBridge.proposeEngineeringTasks(report);
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
