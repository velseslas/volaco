/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Intelligence Service - Master Facade
 */

import { randomUUID, createHash } from 'node:crypto';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { NotFoundError } from '../../errors.js';
import { auditStore } from '../../observability/audit.js';
import { OpportunityDetector } from './discovery/opportunity-detector.js';
import { FeatureGraphBuilder } from './graph/feature-graph.js';
import { FeatureLifecycle } from './lifecycle/feature-lifecycle.js';
import { FeatureIntelligenceLruCache } from './cache.js';
import { computeFeatureReportHash, deepFreeze } from './canonical.js';
import type {
  FeatureCandidate,
  FeatureDiscoveryRequest,
  FeatureIntelligenceReport,
  FeatureOpportunityStatus,
  FeatureIntelligenceSummary
} from './types.js';

export class FeatureIntelligenceService {
  private readonly detector = new OpportunityDetector();
  private readonly graphBuilder = new FeatureGraphBuilder();
  private readonly lifecycle = new FeatureLifecycle();
  private readonly cache: FeatureIntelligenceLruCache;
  private readonly projectReports = new Map<string, FeatureIntelligenceReport>();

  constructor(cacheCapacity = 50) {
    this.cache = new FeatureIntelligenceLruCache(cacheCapacity);
  }

  /**
   * Analyse et découvre les opportunités d'évolution produit
   */
  public async discoverOpportunities(
    request: FeatureDiscoveryRequest,
    userRole?: Role,
    requestId?: string | undefined
  ): Promise<FeatureIntelligenceReport> {
    const effectiveRole = userRole ?? request.callerRole ?? 'VIEWER';
    assertPermission(effectiveRole, 'PROJECT_READ', requestId);

    const { tenantId, projectId, files = [], dna, auditReport, conversationHistory = [], existingDecisions = [] } = request;
    if (!tenantId || !tenantId.trim()) {
      throw new Error('tenantId est requis.');
    }
    if (!projectId || !projectId.trim()) {
      throw new Error('projectId est requis.');
    }

    const startTime = Date.now();

    // 1. Calcul du fingerprint de requête pour le cache
    const filesFingerprint = files.map((f) => `${f.path}:${f.content.length}`).sort().join('|');
    const dnaFingerprint = dna ? dna.dnaHash : 'nodna';
    const auditFingerprint = auditReport ? auditReport.auditHash : 'noaudit';
    const convFingerprint = conversationHistory.length.toString();
    const decFingerprint = existingDecisions.length.toString();

    const cacheKey = `${tenantId}:${projectId}:${createHash('sha256')
      .update(`${filesFingerprint}:${dnaFingerprint}:${auditFingerprint}:${convFingerprint}:${decFingerprint}`, 'utf8')
      .digest('hex')
      .substring(0, 16)}`;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Exécution du détecteur d'opportunités
    const opportunities = this.detector.detectOpportunities(request);

    // 3. Construction du graphe de fonctionnalités
    const featureGraph = this.graphBuilder.buildGraph(opportunities);

    // 4. Calcul du résumé statistique
    const totalDetected = opportunities.length;
    const acceptedCount = opportunities.filter((o) => o.status === 'ACCEPTED').length;
    const rejectedCount = opportunities.filter((o) => o.status === 'REJECTED').length;
    const deferredCount = opportunities.filter((o) => o.status === 'DEFERRED').length;
    const candidateCount = opportunities.filter((o) => o.status === 'CANDIDATE' || o.status === 'PROPOSED').length;

    const avgPriorityScore = totalDetected > 0
      ? Math.round(opportunities.reduce((sum, o) => sum + o.scores.priorityScore, 0) / totalDetected)
      : 0;

    const summary: FeatureIntelligenceSummary = {
      totalDetected,
      candidateCount,
      acceptedCount,
      rejectedCount,
      deferredCount,
      avgPriorityScore,
      topOpportunities: opportunities.slice(0, 5)
    };

    const durationMs = Date.now() - startTime;
    const reportId = `fir-${randomUUID().slice(0, 8)}`;

    const reportHash = computeFeatureReportHash({
      tenantId,
      projectId,
      opportunitiesCount: totalDetected,
      avgPriorityScore,
      candidateHashes: opportunities.map((o) => o.candidateHash)
    });

    const report: FeatureIntelligenceReport = deepFreeze({
      reportId,
      tenantId,
      projectId,
      opportunities,
      summary,
      featureGraph,
      reportHash,
      createdAt: new Date().toISOString(),
      durationMs
    });

    // 5. Stockage en cache et mapping de projet
    this.cache.set(cacheKey, report);
    this.cache.set(reportId, report);
    this.projectReports.set(`${tenantId}:${projectId}`, report);

    // 6. Traçabilité Observabilité
    auditStore.record({
      tenantId,
      userId: effectiveRole,
      action: 'FEATURE_INTELLIGENCE_DISCOVERED',
      resourceType: 'feature_intelligence',
      resourceId: reportId,
      status: 'SUCCESS',
      metadata: {
        projectId,
        totalDetected,
        avgPriorityScore,
        durationMs
      },
      requestId: requestId || 'req-feat-intel'
    });

    return report;
  }

  /**
   * Effectue une transition de cycle de vie sur une opportunité existante
   */
  public async transitionOpportunityStatus(params: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly featureId: string;
    readonly newStatus: FeatureOpportunityStatus;
    readonly reason?: string | undefined;
    readonly userRole?: Role | undefined;
    readonly requestId?: string | undefined;
  }): Promise<FeatureCandidate> {
    const effectiveRole = params.userRole ?? 'ENGINEER';
    assertPermission(effectiveRole, 'PROJECT_UPDATE', params.requestId);

    const projectKey = `${params.tenantId}:${params.projectId}`;
    const report = this.projectReports.get(projectKey);
    if (!report) {
      throw new NotFoundError(`Rapport d opportunités pour le projet ${params.projectId}`, params.requestId);
    }

    const candidateIndex = report.opportunities.findIndex((o) => o.id === params.featureId);
    if (candidateIndex === -1) {
      throw new NotFoundError(`Opportunité ${params.featureId}`, params.requestId);
    }

    const candidate = report.opportunities[candidateIndex]!;
    const updatedCandidate = this.lifecycle.transition(
      candidate,
      params.newStatus,
      params.reason,
      effectiveRole
    );

    // Mettre à jour la collection interne
    const updatedOpportunities = [...report.opportunities];
    updatedOpportunities[candidateIndex] = updatedCandidate;

    const updatedReport: FeatureIntelligenceReport = deepFreeze({
      ...report,
      opportunities: updatedOpportunities
    });

    this.projectReports.set(projectKey, updatedReport);

    auditStore.record({
      tenantId: params.tenantId,
      userId: effectiveRole,
      action: 'FEATURE_STATUS_CHANGED',
      resourceType: 'feature_candidate',
      resourceId: params.featureId,
      status: 'SUCCESS',
      metadata: {
        projectId: params.projectId,
        fromStatus: candidate.status,
        toStatus: params.newStatus,
        reason: params.reason
      },
      requestId: params.requestId || 'req-feat-transition'
    });

    return updatedCandidate;
  }

  /**
   * Récupère le dernier rapport en cache pour un projet
   */
  public getCachedReport(tenantId: string, projectId: string): FeatureIntelligenceReport | undefined {
    return this.projectReports.get(`${tenantId}:${projectId}`);
  }

  /**
   * Récupère une opportunité par son ID
   */
  public getOpportunityById(tenantId: string, projectId: string, featureId: string): FeatureCandidate | undefined {
    const report = this.projectReports.get(`${tenantId}:${projectId}`);
    return report?.opportunities.find((o) => o.id === featureId);
  }

  /**
   * Vide les caches
   */
  public clearCache(): void {
    this.cache.clear();
    this.projectReports.clear();
  }
}
