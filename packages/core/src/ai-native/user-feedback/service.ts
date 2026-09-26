/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * User Feedback & Bug Intelligence Service - Master Facade
 */

import { randomUUID, createHash } from 'node:crypto';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { NotFoundError } from '../../errors.js';
import { auditStore } from '../../observability/audit.js';

import type {
  AggregatedProblem,
  FeedbackAnalysisRequest,
  ProblemStatus,
  ProposedRemediationPlan,
  UserFeedbackComparison,
  UserFeedbackConfig,
  UserFeedbackReport,
  UserFeedbackSummary,
  UserSignal
} from './types.js';
import { computeFeedbackReportHash, computeProblemHash, compareProblems, deepFreeze } from './canonical.js';
import { UserFeedbackLruCache, type UserFeedbackCacheMetrics } from './cache.js';

import { SignalIngestor } from './ingestion/signal-ingestor.js';
import { FeedbackClassifier } from './classification/feedback-classifier.js';
import { BugClassifier } from './classification/bug-classifier.js';
import { FeedbackClusterer } from './intelligence/feedback-clusterer.js';
import { DuplicateDetector } from './intelligence/duplicate-detector.js';
import { RecurringProblemDetector } from './intelligence/recurring-problem-detector.js';
import { RegressionDetector } from './intelligence/regression-detector.js';
import { ContradictionDetector } from './intelligence/contradiction-detector.js';
import { TrendDetector } from './intelligence/trend-detector.js';
import { RootCauseCorrelator } from './intelligence/root-cause-correlator.js';

import { FeedbackEvidenceEngine } from './evidence/feedback-evidence-engine.js';
import { EvidenceRanker } from './evidence/evidence-ranker.js';

import { UserImpactAnalyzer } from './impact/user-impact-analyzer.js';
import { FeatureImpactAnalyzer } from './impact/feature-impact-analyzer.js';
import { RoleImpactAnalyzer } from './impact/role-impact-analyzer.js';
import { ApplicationImpactAnalyzer } from './impact/application-impact-analyzer.js';

import { SeverityEngine } from './scoring/severity-engine.js';
import { ConfidenceEngine } from './scoring/confidence-engine.js';
import { UrgencyEngine } from './scoring/urgency-engine.js';
import { ProblemPriorityEngine } from './scoring/problem-priority-engine.js';

import { ProblemGraphBuilder } from './graph/problem-graph.js';
import { ProblemLifecycleManager } from './lifecycle/problem-lifecycle.js';
import { FeedbackOrchestratorBridge } from './bridge/orchestrator-bridge.js';

const DEFAULT_CONFIG: UserFeedbackConfig = {
  minConfidenceThreshold: 0.30,
  enableDeduplication: true,
  enableContradictionDetection: true,
  enableRegressionDetection: true,
  enableAuditBridge: true,
  enableFeatureBridge: true,
  strictEvidenceCheck: true
};

export class UserFeedbackService {
  private readonly ingestor = new SignalIngestor();
  private readonly classifier = new FeedbackClassifier();
  private readonly bugClassifier = new BugClassifier();
  private readonly clusterer = new FeedbackClusterer();
  private readonly duplicateDetector = new DuplicateDetector();
  private readonly recurringDetector = new RecurringProblemDetector();
  private readonly regressionDetector = new RegressionDetector();
  private readonly contradictionDetector = new ContradictionDetector();
  private readonly trendDetector = new TrendDetector();
  private readonly rootCauseCorrelator = new RootCauseCorrelator();

  private readonly evidenceEngine = new FeedbackEvidenceEngine();
  private readonly evidenceRanker = new EvidenceRanker();

  private readonly userImpactAnalyzer = new UserImpactAnalyzer();
  private readonly featureImpactAnalyzer = new FeatureImpactAnalyzer();
  private readonly roleImpactAnalyzer = new RoleImpactAnalyzer();
  private readonly appImpactAnalyzer = new ApplicationImpactAnalyzer();

  private readonly severityEngine = new SeverityEngine();
  private readonly confidenceEngine = new ConfidenceEngine();
  private readonly urgencyEngine = new UrgencyEngine();
  private readonly priorityEngine = new ProblemPriorityEngine();

  private readonly graphBuilder = new ProblemGraphBuilder();
  private readonly lifecycleManager = new ProblemLifecycleManager();
  private readonly orchestratorBridge = new FeedbackOrchestratorBridge();

  private readonly cache: UserFeedbackLruCache;
  private readonly projectReports = new Map<string, UserFeedbackReport>();

  constructor(cacheCapacity = 50) {
    this.cache = new UserFeedbackLruCache(cacheCapacity);
  }

  /**
   * Analyse l'ensemble des signaux, erreurs et retours utilisateurs pour produire un rapport structuré
   */
  public async analyzeFeedback(
    request: FeedbackAnalysisRequest,
    userRole?: Role,
    requestId?: string
  ): Promise<UserFeedbackReport> {
    const effectiveRole = userRole ?? request.callerRole ?? 'VIEWER';
    assertPermission(effectiveRole, 'PROJECT_READ', requestId);

    const { tenantId, projectId } = request;
    if (!tenantId || !tenantId.trim()) {
      throw new Error('tenantId est requis.');
    }
    if (!projectId || !projectId.trim()) {
      throw new Error('projectId est requis.');
    }

    const startTime = Date.now();
    const config: UserFeedbackConfig = { ...DEFAULT_CONFIG, ...request.config };

    // 1. Ingestion de tous les signaux
    const allSignals = this.ingestor.ingest(request);

    // Calcul de la clé de cache
    const signalsHash = createHash('sha256')
      .update(allSignals.map(s => s.id).sort().join('|') || 'empty', 'utf8')
      .digest('hex')
      .substring(0, 16);
    const cacheKey = `${tenantId}:${projectId}:${signalsHash}`;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Détection des contradictions
    const contradictions = config.enableContradictionDetection
      ? this.contradictionDetector.detectContradictions(allSignals)
      : [];

    // 3. Déduplication et regroupement thématique
    const clusters = this.clusterer.clusterByTheme(allSignals);
    const rawProblems: AggregatedProblem[] = [];

    for (const cluster of clusters) {
      // Déduplication intra-cluster
      const subSignals: UserSignal[] = config.enableDeduplication
        ? this.duplicateDetector.clusterDuplicates(cluster.signals).map(d => d.canonicalSignal)
        : [...cluster.signals];

      const primarySignal = subSignals[0];
      if (!primarySignal) continue;

      const category = this.classifier.classify(primarySignal).category;
      const bugSubtype = category === 'BUG' ? this.bugClassifier.classifyBug(primarySignal).subtype : undefined;

      // Preuves matérielles (NO EVIDENCE -> NO CLAIM)
      const rawEvidence = this.evidenceEngine.extractEvidence(cluster.signals);
      const rankedEvidence = this.evidenceRanker.rank(rawEvidence);

      if (config.strictEvidenceCheck && !this.evidenceEngine.hasSufficientEvidence(rankedEvidence, config.minConfidenceThreshold)) {
        continue;
      }

      // Analyses d'impact
      const userImpact = this.userImpactAnalyzer.analyze(cluster.signals);
      const featureImpact = this.featureImpactAnalyzer.analyze(cluster.signals);
      const roleImpact = this.roleImpactAnalyzer.analyze(cluster.signals);
      const appImpact = this.appImpactAnalyzer.analyze(cluster.signals);

      // Analyses temporelles et récurrence
      const recurrence = this.recurringDetector.analyzeRecurrence(cluster.signals);
      const regression = config.enableRegressionDetection
        ? this.regressionDetector.detectRegression(cluster.signals, request.existingDecisions)
        : { status: 'NONE' as const, confidence: 1, reasoning: 'Désactivé' };
      const trendAnalysis = this.trendDetector.analyzeTrend(cluster.signals);

      // Corrélation cause racine
      const rootCause = this.rootCauseCorrelator.correlate(
        cluster.signals,
        rankedEvidence,
        request.dna,
        request.auditReport
      );

      // Évaluation des scores
      const severityAssessment = this.severityEngine.assessSeverity(cluster.signals, bugSubtype);
      const confidenceScore = this.confidenceEngine.computeOverallConfidence(cluster.signals, rankedEvidence);
      const urgencyAssessment = this.urgencyEngine.assessUrgency({
        severity: severityAssessment.severity,
        regressionStatus: regression.status,
        trend: trendAnalysis.trend,
        isBlockingCoreFlow: appImpact.isBlockingCoreFlow
      });

      const hasContradiction = contradictions.some(c => c.topic === cluster.key || c.topic.includes(cluster.representativeTitle));

      const scores = this.priorityEngine.computeScores({
        severityScore: severityAssessment.severityScore,
        confidenceScore,
        userImpactScore: userImpact.userImpactScore,
        frequencyScore: recurrence.frequencyScore,
        blastRadiusScore: appImpact.blastRadiusScore,
        regressionStatus: regression.status,
        isBlockingCoreFlow: appImpact.isBlockingCoreFlow,
        hasContradiction
      });

      const problemId = `PRB-${createHash('sha256').update(cluster.key, 'utf8').digest('hex').substring(0, 8).toUpperCase()}`;
      const title = `${cluster.representativeTitle}`;
      const description = `${primarySignal.normalizedText || primarySignal.rawText}`;

      const problemHash = computeProblemHash({
        id: problemId,
        title,
        category,
        description,
        priorityScore: scores.priorityScore
      });

      const createdAt = cluster.signals[0]?.timestamp || new Date().toISOString();

      rawProblems.push({
        id: problemId,
        title,
        description,
        category,
        subtype: bugSubtype,
        status: 'CONFIRMED',
        severity: severityAssessment.severity,
        urgency: urgencyAssessment.urgency,
        regressionStatus: regression.status,
        trend: trendAnalysis.trend,
        signals: cluster.signals,
        evidence: rankedEvidence,
        impact: {
          affectedUsersCount: userImpact.affectedUsersCount,
          affectedSessionsCount: userImpact.affectedSessionsCount,
          affectedRoles: roleImpact.affectedRoles,
          affectedFeatures: featureImpact.affectedFeatures,
          affectedFiles: appImpact.affectedFiles,
          userImpactRatio: userImpact.userImpactRatio,
          isBlockingCoreFlow: appImpact.isBlockingCoreFlow,
          blastRadiusScore: appImpact.blastRadiusScore
        },
        scores,
        rootCauseHypothesis: rootCause.hypothesis,
        suggestedRemediation: rootCause.suggestedRemediation,
        problemHash,
        createdAt,
        updatedAt: createdAt,
        history: [
          {
            fromStatus: 'DETECTED',
            toStatus: 'CONFIRMED',
            timestamp: createdAt,
            reason: 'Qualification automatique via AINT-015'
          }
        ]
      });
    }

    // 4. Tri déterministe
    rawProblems.sort(compareProblems);

    // 5. Construction du graphe des problèmes
    const problemGraph = this.graphBuilder.buildGraph(rawProblems);

    // 6. Calcul des synthèses
    const totalProblems = rawProblems.length;
    const criticalBugsCount = rawProblems.filter(p => p.severity === 'CRITICAL').length;
    const confirmedRegressionsCount = rawProblems.filter(p => p.regressionStatus === 'CONFIRMED').length;
    const featureRequestsCount = rawProblems.filter(p => p.category === 'FEATURE_REQUEST').length;
    const avgPriorityScore = totalProblems > 0
      ? Math.round(rawProblems.reduce((sum, p) => sum + p.scores.priorityScore, 0) / totalProblems)
      : 0;

    const summary: UserFeedbackSummary = {
      totalSignals: allSignals.length,
      totalProblems,
      criticalBugsCount,
      confirmedRegressionsCount,
      featureRequestsCount,
      contradictionClustersCount: contradictions.length,
      avgPriorityScore,
      topProblems: rawProblems.slice(0, 5)
    };

    const durationMs = Date.now() - startTime;
    const reportId = `ufr-${randomUUID().slice(0, 8)}`;

    const reportHash = computeFeedbackReportHash({
      tenantId,
      projectId,
      problemsCount: totalProblems,
      avgPriorityScore,
      problemHashes: rawProblems.map(p => p.problemHash)
    });

    const report: UserFeedbackReport = deepFreeze({
      reportId,
      tenantId,
      projectId,
      problems: rawProblems,
      contradictions,
      summary,
      problemGraph,
      reportHash,
      createdAt: new Date().toISOString(),
      durationMs
    });

    // Mise en cache
    this.cache.set(cacheKey, report);
    this.cache.set(reportId, report);
    this.projectReports.set(`${tenantId}:${projectId}`, report);

    // Audit d'observabilité
    auditStore.record({
      tenantId,
      userId: effectiveRole,
      action: 'USER_FEEDBACK_ANALYZED',
      resourceType: 'user_feedback',
      resourceId: reportId,
      status: 'SUCCESS',
      metadata: {
        projectId,
        totalSignals: allSignals.length,
        totalProblems,
        avgPriorityScore,
        durationMs
      },
      requestId: requestId || 'req-feedback-intel'
    });

    return report;
  }

  /**
   * Récupère le dernier rapport analysé pour un projet
   */
  public getReport(
    tenantId: string,
    projectId: string,
    userRole?: Role,
    requestId?: string
  ): UserFeedbackReport | undefined {
    assertPermission(userRole ?? 'VIEWER', 'PROJECT_READ', requestId);
    return this.projectReports.get(`${tenantId}:${projectId}`);
  }

  /**
   * Récupère un problème spécifique par son identifiant
   */
  public getProblemById(
    tenantId: string,
    projectId: string,
    problemId: string,
    userRole?: Role,
    requestId?: string
  ): AggregatedProblem | undefined {
    assertPermission(userRole ?? 'VIEWER', 'PROJECT_READ', requestId);
    const report = this.projectReports.get(`${tenantId}:${projectId}`);
    if (!report) return undefined;
    return report.problems.find(p => p.id === problemId);
  }

  /**
   * Effectue une transition de cycle de vie sur un problème
   */
  public async transitionProblemStatus(params: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly problemId: string;
    readonly newStatus: ProblemStatus;
    readonly reason?: string | undefined;
    readonly userRole?: Role | undefined;
    readonly requestId?: string | undefined;
  }): Promise<AggregatedProblem> {
    const effectiveRole = params.userRole ?? 'ENGINEER';
    assertPermission(effectiveRole, 'PROJECT_UPDATE', params.requestId);

    const report = this.projectReports.get(`${params.tenantId}:${params.projectId}`);
    if (!report) {
      throw new NotFoundError(`Aucun rapport de feedback trouvé pour le projet ${params.projectId}`);
    }

    const problemIndex = report.problems.findIndex(p => p.id === params.problemId);
    if (problemIndex === -1) {
      throw new NotFoundError(`Problème ${params.problemId} non trouvé.`);
    }

    const currentProblem = report.problems[problemIndex];
    if (!currentProblem) {
      throw new NotFoundError(`Problème ${params.problemId} non trouvé.`);
    }

    const updatedProblem = this.lifecycleManager.transition(
      currentProblem,
      params.newStatus,
      params.reason,
      effectiveRole
    );

    const updatedProblems = [...report.problems];
    updatedProblems[problemIndex] = updatedProblem;

    const updatedReport: UserFeedbackReport = deepFreeze({
      ...report,
      problems: updatedProblems
    });

    this.projectReports.set(`${params.tenantId}:${params.projectId}`, updatedReport);
    this.cache.set(report.reportId, updatedReport);

    auditStore.record({
      tenantId: params.tenantId,
      userId: effectiveRole,
      action: 'USER_FEEDBACK_PROBLEM_TRANSITIONED',
      resourceType: 'user_feedback_problem',
      resourceId: params.problemId,
      status: 'SUCCESS',
      metadata: {
        fromStatus: currentProblem.status,
        toStatus: params.newStatus,
        reason: params.reason
      },
      requestId: params.requestId || 'req-feedback-trans'
    });

    return updatedProblem;
  }

  /**
   * Génère un plan de remédiation technique pour AINT-010 AI Orchestrator
   */
  public async createRemediationPlan(params: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly problemId: string;
    readonly userRole?: Role | undefined;
    readonly requestId?: string | undefined;
  }): Promise<ProposedRemediationPlan> {
    assertPermission(params.userRole ?? 'ENGINEER', 'PROJECT_READ', params.requestId);

    const problem = this.getProblemById(params.tenantId, params.projectId, params.problemId, params.userRole, params.requestId);
    if (!problem) {
      throw new NotFoundError(`Problème ${params.problemId} non trouvé.`);
    }

    return this.orchestratorBridge.createRemediationPlan(problem);
  }

  /**
   * Compare deux rapports de retours utilisateurs
   */
  public compareReports(
    prevReportId: string,
    currentReport: UserFeedbackReport
  ): UserFeedbackComparison {
    const previous = this.cache.get(prevReportId);
    if (!previous) {
      return {
        previousReportId: prevReportId,
        currentReportId: currentReport.reportId,
        newProblems: currentReport.problems.map(p => p.id),
        resolvedProblems: [],
        priorityScoreDelta: 0
      };
    }

    const prevIds = new Set(previous.problems.map(p => p.id));
    const currIds = new Set(currentReport.problems.map(p => p.id));

    const newProblems = currentReport.problems.filter(p => !prevIds.has(p.id)).map(p => p.id);
    const resolvedProblems = previous.problems.filter(p => !currIds.has(p.id)).map(p => p.id);
    const priorityScoreDelta = currentReport.summary.avgPriorityScore - previous.summary.avgPriorityScore;

    return {
      previousReportId: prevReportId,
      currentReportId: currentReport.reportId,
      newProblems,
      resolvedProblems,
      priorityScoreDelta
    };
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public getCacheMetrics(): UserFeedbackCacheMetrics {
    return this.cache.getMetrics();
  }
}
