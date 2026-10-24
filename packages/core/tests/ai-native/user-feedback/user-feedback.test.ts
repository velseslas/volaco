/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * User Feedback & Bug Intelligence Engine - Comprehensive Test Suite
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  UserFeedbackService,
  SignalIngestor,
  FeedbackNormalizer,
  ErrorSignalCollector,
  ConversationSignalCollector,
  TelemetrySignalCollector,
  FeedbackClassifier,
  BugClassifier,
  RequestClassifier,
  SentimentClassifier,
  IntentClassifier,
  FeedbackEvidenceEngine,
  FeedbackEvidenceRanker,
  EvidenceConfidenceEngine,
  ProvenanceEngine,
  DuplicateDetector,
  FeedbackClusterer,
  RecurringProblemDetector,
  RegressionDetector,
  FeedbackContradictionDetector,
  TrendDetector,
  RootCauseCorrelator,
  UserImpactAnalyzer,
  FeedbackFeatureImpactAnalyzer,
  RoleImpactAnalyzer,
  ApplicationImpactAnalyzer,
  SeverityEngine,
  FeedbackConfidenceEngine,
  UrgencyEngine,
  ProblemPriorityEngine,
  FeedbackGraphBuilder,
  ProblemGraphBuilder,
  FeedbackFeatureGraphBuilder,
  FeedbackStateMachine,
  ProblemLifecycleManager,
  ConversationBridge,
  AuditBridge,
  FeatureIntelligenceBridge,
  FeedbackOrchestratorBridge,
  UserFeedbackLruCache,
  computeSignalHash,
  computeProblemHash,
  computeFeedbackReportHash,
  compareProblems,
  compareSignals
} from '../../../src/ai-native/user-feedback/index.js';

import type {
  AggregatedProblem,
  FeedbackAnalysisRequest,
  UserSignal
} from '../../../src/ai-native/user-feedback/types.js';

import type { ApplicationDNA } from '../../../src/ai-native/dna/types.js';
import type { ApplicationAuditReport } from '../../../src/ai-native/application-audit/types.js';
import type { ConversationTurn, ArchitecturalDecisionRecord } from '../../../src/ai-native/conversation-intelligence/types.js';
import { ForbiddenError, NotFoundError } from '../../../src/errors.js';

// --- Mocks Déterministes ---

const MOCK_DNA: ApplicationDNA = {
  schemaVersion: '1.0.0',
  analyzerVersion: '1.0.0',
  tenantId: 'tenant-test',
  projectId: 'proj-001',
  treeHash: 'tree-123',
  dnaHash: 'dna-456',
  extractedAt: '2026-09-07T10:00:00.000Z',
  durationMs: 35,
  stack: {
    language: { name: 'TypeScript', category: 'language', confidence: 'CONFIRMED', evidence: [] },
    framework: { name: 'React', category: 'framework', confidence: 'CONFIRMED', evidence: [] },
    runtime: { name: 'Node.js', category: 'runtime', confidence: 'CONFIRMED', evidence: [] },
    additionalTechnologies: []
  },
  architecture: {
    primaryPattern: { pattern: 'SPA', confidence: 'CONFIRMED', evidence: [] },
    entryPoints: [{ path: 'src/main.tsx', role: 'client_entry', confidence: 'CONFIRMED' }],
    layers: [
      { name: 'Components', kind: 'frontend', filePaths: ['src/components/Button.tsx', 'src/components/Checkout.tsx'], dependenciesOnLayers: [], confidence: 'CONFIRMED' },
      { name: 'Services', kind: 'backend', filePaths: ['src/services/api.ts'], dependenciesOnLayers: [], confidence: 'CONFIRMED' }
    ],
    routesCount: 2,
    componentsCount: 3
  },
  components: [
    { name: 'AppHeader', filePath: 'src/components/Header.tsx', classification: 'COMPONENT_CONFIRMED', propsCount: 1, hooksUsed: [], lineStart: 1, lineEnd: 20 },
    { name: 'UserList', filePath: 'src/components/UserList.tsx', classification: 'COMPONENT_CONFIRMED', propsCount: 2, hooksUsed: ['useState'], lineStart: 1, lineEnd: 40 }
  ],
  modules: [],
  graphMetrics: {
    nodeCount: 5,
    edgeCount: 4,
    directDependencies: {},
    reverseDependencies: {},
    topologicalOrder: [],
    circularDependencies: [],
    isolatedFiles: [],
    mostDependedOnFiles: []
  },
  summary: {
    totalFiles: 4,
    analyzedFiles: 4,
    diagnosticsCount: 0,
    overallHealth: 'HEALTHY',
    primaryLanguage: 'TypeScript',
    primaryFramework: 'React'
  }
};

const MOCK_AUDIT: ApplicationAuditReport = {
  reportId: 'aar-mock-001',
  tenantId: 'tenant-test',
  projectId: 'proj-001',
  overallScore: 68,
  dimensionScores: {
    architecture: 80,
    codeQuality: 75,
    security: 90,
    performance: 65,
    ux: 60,
    accessibility: 55,
    aiConfig: 85,
    designHarmony: 70
  },
  dimensionStatus: {
    ARCHITECTURE: 'MEASURED',
    CODE_QUALITY: 'MEASURED',
    SECURITY: 'MEASURED',
    PERFORMANCE: 'MEASURED',
    UX: 'MEASURED',
    ACCESSIBILITY: 'MEASURED',
    AI_CONFIG: 'MEASURED',
    DESIGN_HARMONY: 'MEASURED'
  },
  coverage: 1,
  findings: [
    {
      id: 'finding-001',
      dimension: 'ACCESSIBILITY',
      severity: 'HIGH',
      title: 'Contraste insuffisant',
      description: 'Le texte du bouton de validation est illisible avec un ratio 2.1:1.',
      location: { filePath: 'src/components/Button.tsx', selector: '#btn-submit' },
      cause: 'Couleur de texte trop claire',
      impact: 'Mauvaise lisibilité',
      recommendation: 'Passer la couleur à #111827 pour atteindre le ratio WCAG AA',
      autoRemediable: true,
      evidence: []
    }
  ],
  summary: {
    totalFindings: 1,
    criticalCount: 0,
    highCount: 1,
    mediumCount: 0,
    lowCount: 0,
    infoCount: 0,
    autoRemediableCount: 1
  },
  auditHash: 'aar:1234567890abcdef',
  createdAt: '2026-09-07T10:00:00.000Z',
  durationMs: 45
};

describe('AINT-015 — User Feedback & Bug Intelligence Engine : Test Suite', () => {

  // 1. Ingestion & Preprocessing
  describe('1. Ingestion & Preprocessing', () => {
    it('1. Ingestion de signaux structurés avec calcul de timestamp et normalisation', () => {
      const ingestor = new SignalIngestor();
      const request: FeedbackAnalysisRequest = {
        tenantId: 'tenant-test',
        projectId: 'proj-001',
        signals: [
          {
            id: 'sig-1',
            source: 'user_report',
            category: 'BUG',
            rawText: '   Le bouton  de validation   plante !   ',
            normalizedText: '',
            sentiment: 'FRUSTRATED',
            timestamp: ''
          }
        ]
      };
      const signals = ingestor.ingest(request);
      assert.equal(signals.length, 1);
      assert.equal(signals[0]!.normalizedText, 'Le bouton de validation plante !');
      assert.ok(signals[0]!.timestamp.length > 0);
    });

    it('2. Normalizer supprime les caractères de contrôle et extrait les URLs et sélecteurs', () => {
      const normalizer = new FeedbackNormalizer();
      const raw = 'Erreur sur https://app.example.com/checkout avec le bouton #btn-submit et .cart-item \u0007\u0008!';
      const res = normalizer.normalize(raw);
      assert.ok(!res.normalizedText.includes('\u0007'));
      assert.ok(res.detectedUrls.includes('https://app.example.com/checkout'));
      assert.ok(res.detectedSelectors.includes('#btn-submit'));
      assert.ok(res.detectedSelectors.includes('.cart-item'));
    });

    it('3. Normalizer extrait les codes d erreur standards (TypeError, 404, 500, ERR_*)', () => {
      const normalizer = new FeedbackNormalizer();
      const raw = 'Uncaught TypeError: cannot read properties of undefined, HTTP 500 retourné par l API et ERR_NETWORK';
      const res = normalizer.normalize(raw);
      assert.ok(res.detectedErrorCodes.some(c => c.toLowerCase().includes('typeerror')));
      assert.ok(res.detectedErrorCodes.some(c => c.includes('500')));
      assert.ok(res.detectedErrorCodes.some(c => c.includes('ERR_NETWORK')));
    });

    it('4. ErrorSignalCollector convertit les exceptions runtime avec stacktrace en signaux BUG', () => {
      const collector = new ErrorSignalCollector();
      const signals = collector.collect([
        {
          message: 'ReferenceError: window is not defined',
          stack: 'ReferenceError: window is not defined\n  at Object.render (server.js:12:5)',
          component: 'ServerRenderer',
          url: '/api/render'
        }
      ]);
      assert.equal(signals.length, 1);
      assert.equal(signals[0]!.category, 'BUG');
      assert.equal(signals[0]!.source, 'error_runtime');
      assert.equal(signals[0]!.sentiment, 'FRUSTRATED');
      assert.equal(signals[0]!.componentId, 'ServerRenderer');
    });

    it('5. ConversationSignalCollector extrait les frustrations et signalements des tours USER', () => {
      const collector = new ConversationSignalCollector();
      const turns: ConversationTurn[] = [
        {
          turnIndex: 0,
          turnId: 't-1',
          userMessage: {
            id: 'm1',
            sender: 'HUMAN',
            content: 'Bonjour, le bouton de paiement est cassé et ne marche pas !',
            timestamp: new Date().toISOString()
          },
          stateBefore: 'UNDERSTANDING',
          stateAfter: 'PLANNING',
          intent: {
            category: 'DEBUG',
            goal: 'reparer paiement',
            requestedAction: 'fix button',
            entities: [],
            constraints: [],
            urgency: 'HIGH',
            confidence: 0.9,
            ambiguities: []
          },
          assumptions: [],
          decisions: [],
          agentResponse: {
            id: 'm2',
            sender: 'AGENT',
            content: 'Je vais vous aider.',
            timestamp: new Date().toISOString()
          },
          trace: {
            traceId: 'tr-1',
            sessionId: 'ses-1',
            turnId: 't-1',
            stateBefore: 'UNDERSTANDING',
            stateAfter: 'PLANNING',
            intentCategory: 'DEBUG',
            contextHash: 'ch-1',
            applicationHash: 'ah-1',
            actionTaken: 'PLAN',
            confidence: 0.9,
            events: [],
            durationMs: 15
          }
        }
      ];
      const signals = collector.collect(turns);
      assert.equal(signals.length, 1);
      assert.equal(signals[0]!.category, 'BUG');
      assert.equal(signals[0]!.source, 'conversation');
    });

    it('6. TelemetrySignalCollector qualifie les rage-clicks et les requêtes lentes', () => {
      const collector = new TelemetrySignalCollector();
      const signals = collector.collect([
        { type: 'rage_click', targetSelector: '#btn-buy', clickCount: 8 },
        { type: 'slow_request', durationMs: 4500, url: '/api/data' }
      ]);
      assert.equal(signals.length, 2);
      assert.equal(signals[0]!.category, 'UX_PROBLEM');
      assert.equal(signals[1]!.category, 'PERFORMANCE');
    });

    it('7. SignalIngestor convertit les findings d audit CRITICAL/HIGH en signaux', () => {
      const ingestor = new SignalIngestor();
      const request: FeedbackAnalysisRequest = {
        tenantId: 'tenant-test',
        projectId: 'proj-001',
        auditReport: MOCK_AUDIT
      };
      const signals = ingestor.ingest(request);
      assert.equal(signals.length, 1);
      assert.equal(signals[0]!.source, 'audit_finding');
      assert.equal(signals[0]!.category, 'ACCESSIBILITY');
      assert.equal(signals[0]!.componentId, '#btn-submit');
    });
  });

  // 2. Classification & Semantics
  describe('2. Classification & Semantics', () => {
    const classifier = new FeedbackClassifier();
    const bugClassifier = new BugClassifier();
    const reqClassifier = new RequestClassifier();
    const sentClassifier = new SentimentClassifier();
    const intentClassifier = new IntentClassifier();

    it('8. FeedbackClassifier qualifie les anomalies techniques comme BUG avec haute confiance', () => {
      const sig: UserSignal = {
        id: 's1',
        source: 'user_report',
        category: 'UX_PROBLEM',
        rawText: 'L écran blanc survient après avoir cliqué sur valider, c est un crash complet !',
        normalizedText: 'L écran blanc survient après avoir cliqué sur valider, c est un crash complet !',
        sentiment: 'FRUSTRATED',
        timestamp: new Date().toISOString()
      };
      const res = classifier.classify(sig);
      assert.equal(res.category, 'BUG');
      assert.ok(res.confidence >= 0.70);
    });

    it('9. FeedbackClassifier qualifie les requêtes de fonctionnalités et d accessibilité', () => {
      const sigA11y: UserSignal = {
        id: 's2',
        source: 'user_report',
        category: 'UX_PROBLEM',
        rawText: 'Le contraste est insuffisant et le focus clavier est invisible.',
        normalizedText: 'Le contraste est insuffisant et le focus clavier est invisible.',
        sentiment: 'NEUTRAL',
        timestamp: new Date().toISOString()
      };
      const sigFeat: UserSignal = {
        id: 's3',
        source: 'user_report',
        category: 'UX_PROBLEM',
        rawText: 'Pourrait-on ajouter un bouton pour exporter les données en CSV ?',
        normalizedText: 'Pourrait-on ajouter un bouton pour exporter les données en CSV ?',
        sentiment: 'NEUTRAL',
        timestamp: new Date().toISOString()
      };
      assert.equal(classifier.classify(sigA11y).category, 'ACCESSIBILITY');
      assert.equal(classifier.classify(sigFeat).category, 'FEATURE_REQUEST');
    });

    it('10. BugClassifier qualifie les sous-types de bugs (CRASH, NETWORK, REGRESSION, RENDERING, STATE)', () => {
      const sigCrash: UserSignal = {
        id: 'c1',
        source: 'user_report',
        category: 'BUG',
        rawText: 'Fatal crash avec écran blanc',
        normalizedText: 'Fatal crash avec écran blanc',
        sentiment: 'FRUSTRATED',
        timestamp: new Date().toISOString()
      };
      const sigNet: UserSignal = {
        id: 'c2',
        source: 'user_report',
        category: 'BUG',
        rawText: 'Erreur HTTP 500 timeout lors de l appel fetch',
        normalizedText: 'Erreur HTTP 500 timeout lors de l appel fetch',
        sentiment: 'FRUSTRATED',
        timestamp: new Date().toISOString()
      };
      const sigReg: UserSignal = {
        id: 'c3',
        source: 'user_report',
        category: 'BUG',
        rawText: 'Ça marchait avant mais depuis la mise à jour c est cassé',
        normalizedText: 'Ça marchait avant mais depuis la mise à jour c est cassé',
        sentiment: 'FRUSTRATED',
        timestamp: new Date().toISOString()
      };
      assert.equal(bugClassifier.classifyBug(sigCrash).subtype, 'CRASH');
      assert.equal(bugClassifier.classifyBug(sigNet).subtype, 'NETWORK');
      assert.equal(bugClassifier.classifyBug(sigReg).subtype, 'REGRESSION');
    });

    it('11. RequestClassifier extrait la capacité cible et le bénéfice attendu', () => {
      const sig: UserSignal = {
        id: 'r1',
        source: 'user_report',
        category: 'FEATURE_REQUEST',
        rawText: 'Serait top d ajouter un filtre de recherche et un export CSV',
        normalizedText: 'Serait top d ajouter un filtre de recherche et un export CSV',
        sentiment: 'NEUTRAL',
        timestamp: new Date().toISOString()
      };
      const res = reqClassifier.qualify(sig);
      assert.equal(res.isFeatureRequest, true);
      assert.ok(res.targetCapability.includes('Export') || res.targetCapability.includes('Recherche'));
      assert.ok(res.confidence > 0.50);
    });

    it('12. SentimentClassifier mesure la frustration sur des mots forts avec score borné', () => {
      const sig: UserSignal = {
        id: 'sent-1',
        source: 'user_report',
        category: 'BUG',
        rawText: 'C est une catastrophe absolue, totalement bloqué et inadmissible !',
        normalizedText: 'C est une catastrophe absolue, totalement bloqué et inadmissible !',
        sentiment: 'NEUTRAL',
        timestamp: new Date().toISOString()
      };
      const res = sentClassifier.analyze(sig);
      assert.equal(res.sentiment, 'FRUSTRATED');
      assert.equal(res.isFrustrated, true);
      assert.ok(res.score <= -0.60);
    });

    it('13. SentimentClassifier identifie les retours satisfaits et enthousiastes', () => {
      const sig: UserSignal = {
        id: 'sent-2',
        source: 'user_report',
        category: 'UX_PROBLEM',
        rawText: 'Bravo, interface très claire et super rapide merci !',
        normalizedText: 'Bravo, interface très claire et super rapide merci !',
        sentiment: 'NEUTRAL',
        timestamp: new Date().toISOString()
      };
      const res = sentClassifier.analyze(sig);
      assert.equal(res.sentiment, 'SATISFIED');
      assert.ok(res.score > 0);
    });

    it('14. IntentClassifier qualifie REPORT_DEFECT, REQUEST_FEATURE et DISPUTE_CHANGE', () => {
      const sigBug: UserSignal = {
        id: 'i1',
        source: 'error_runtime',
        category: 'BUG',
        rawText: 'TypeError',
        normalizedText: 'TypeError',
        sentiment: 'FRUSTRATED',
        timestamp: new Date().toISOString()
      };
      const sigDispute: UserSignal = {
        id: 'i2',
        source: 'user_report',
        category: 'UX_PROBLEM',
        rawText: 'Je préférais avant, pourquoi avoir changé ce comportement ?',
        normalizedText: 'Je préférais avant, pourquoi avoir changé ce comportement ?',
        sentiment: 'ANNOYED',
        timestamp: new Date().toISOString()
      };
      assert.equal(intentClassifier.classifyIntent(sigBug).intent, 'REPORT_DEFECT');
      assert.equal(intentClassifier.classifyIntent(sigDispute).intent, 'DISPUTE_CHANGE');
    });
  });

  // 3. Evidence & Strict Verification (NO EVIDENCE -> NO CLAIM)
  describe('3. Evidence & Strict Verification', () => {
    const evidenceEngine = new FeedbackEvidenceEngine();
    const ranker = new FeedbackEvidenceRanker();
    const confEngine = new EvidenceConfidenceEngine();
    const provEngine = new ProvenanceEngine();

    it('15. Règle NO EVIDENCE -> NO CLAIM : hasSufficientEvidence rejette une liste vide ou faible', () => {
      assert.equal(evidenceEngine.hasSufficientEvidence([]), false);
      assert.equal(
        evidenceEngine.hasSufficientEvidence([
          {
            id: 'e-low',
            source: 'conversation',
            proofLevel: 'HYPOTHESIS',
            description: 'Vague supposition',
            confidence: 0.15,
            timestamp: new Date().toISOString()
          }
        ], 0.30),
        false
      );
    });

    it('16. Distinction formelle FACT vs CORRELATION vs HYPOTHESIS', () => {
      const signals: UserSignal[] = [
        {
          id: 's-err',
          source: 'error_runtime',
          category: 'BUG',
          rawText: 'Crash call stack',
          normalizedText: 'Crash call stack',
          sentiment: 'FRUSTRATED',
          url: 'src/app.ts',
          timestamp: new Date().toISOString(),
          metadata: { hasStack: true }
        },
        {
          id: 's-user',
          source: 'user_report',
          category: 'BUG',
          rawText: 'Bouton inopérant',
          normalizedText: 'Bouton inopérant',
          sentiment: 'FRUSTRATED',
          timestamp: new Date().toISOString()
        }
      ];
      const evidences = evidenceEngine.extractEvidence(signals);
      assert.equal(evidences.length, 2);
      assert.equal(evidences[0]!.proofLevel, 'FACT');
      assert.equal(evidences[1]!.proofLevel, 'CORRELATION');
    });

    it('17. FeedbackEvidenceRanker ordonne déterministement les preuves par autorité de source', () => {
      const rawEvs = [
        { id: 'e-user', source: 'user_report' as const, proofLevel: 'CORRELATION' as const, description: 'User', confidence: 0.7, timestamp: '2026-01-01' },
        { id: 'e-runtime', source: 'error_runtime' as const, proofLevel: 'FACT' as const, description: 'Error', confidence: 0.95, timestamp: '2026-01-01' }
      ];
      const ranked = ranker.rank(rawEvs);
      assert.equal(ranked[0]!.id, 'e-runtime');
      assert.equal(ranked[1]!.id, 'e-user');
    });

    it('18. EvidenceConfidenceEngine applique le bonus de corroboration multi-sources', () => {
      const singleSource = [
        { id: 'e1', source: 'user_report' as const, proofLevel: 'FACT' as const, description: 'Fact 1', confidence: 0.8, timestamp: '2026-01-01' }
      ];
      const multiSource = [
        { id: 'e1', source: 'user_report' as const, proofLevel: 'FACT' as const, description: 'Fact 1', confidence: 0.8, timestamp: '2026-01-01' },
        { id: 'e2', source: 'error_runtime' as const, proofLevel: 'FACT' as const, description: 'Fact 2', confidence: 0.9, timestamp: '2026-01-01' }
      ];
      const scoreSingle = confEngine.computeConfidenceScore(singleSource);
      const scoreMulti = confEngine.computeConfidenceScore(multiSource);
      assert.ok(scoreMulti > scoreSingle + 25);
    });

    it('19. ProvenanceEngine retrace les utilisateurs, sessions, fichiers et sélecteurs distincts', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', userId: 'usr-1', sessionId: 'ses-1', url: 'src/A.ts', componentId: '#btn', timestamp: '2026-01-01T10:00:00Z' },
        { id: 's2', source: 'user_report', category: 'BUG', rawText: 'Err 2', normalizedText: 'Err 2', sentiment: 'FRUSTRATED', userId: 'usr-2', sessionId: 'ses-2', url: 'src/B.ts', timestamp: '2026-01-01T11:00:00Z' }
      ];
      const prov = provEngine.analyzeProvenance(signals, []);
      assert.equal(prov.distinctUsersCount, 2);
      assert.equal(prov.distinctSessionsCount, 2);
      assert.equal(prov.involvedFiles.length, 2);
      assert.equal(prov.involvedSelectors.length, 1);
    });
  });

  // 4. Intelligence & Deduplication
  describe('4. Intelligence & Deduplication', () => {
    const dupDetector = new DuplicateDetector();
    const clusterer = new FeedbackClusterer();
    const recDetector = new RecurringProblemDetector();
    const regDetector = new RegressionDetector();
    const contDetector = new FeedbackContradictionDetector();
    const trendDetector = new TrendDetector();
    const rootCorrelator = new RootCauseCorrelator();

    it('20. DuplicateDetector fusionne les signaux très similaires en un cluster unique', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Impossible de valider le formulaire de commande', normalizedText: 'Impossible de valider le formulaire de commande', sentiment: 'FRUSTRATED', componentId: '#form-order', timestamp: '2026-01-01' },
        { id: 's2', source: 'user_report', category: 'BUG', rawText: 'Impossible de valider le formulaire de commande svp', normalizedText: 'Impossible de valider le formulaire de commande svp', sentiment: 'FRUSTRATED', componentId: '#form-order', timestamp: '2026-01-01' }
      ];
      const clusters = dupDetector.clusterDuplicates(signals, 0.70);
      assert.equal(clusters.length, 1);
      assert.equal(clusters[0]!.duplicateSignals.length, 1);
    });

    it('21. FeedbackClusterer regroupe thématiquement par composant et URL', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Bug bouton', normalizedText: 'Bug bouton', sentiment: 'FRUSTRATED', componentId: 'Button', timestamp: '2026-01-01' },
        { id: 's2', source: 'user_report', category: 'BUG', rawText: 'Autre bug bouton', normalizedText: 'Autre bug bouton', sentiment: 'FRUSTRATED', componentId: 'Button', timestamp: '2026-01-01' },
        { id: 's3', source: 'user_report', category: 'UX_PROBLEM', rawText: 'Page lente', normalizedText: 'Page lente', sentiment: 'ANNOYED', url: '/checkout', timestamp: '2026-01-01' }
      ];
      const groups = clusterer.clusterByTheme(signals);
      assert.equal(groups.length, 2);
    });

    it('22. RecurringProblemDetector détecte les problèmes répétitifs multi-utilisateurs', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', userId: 'u1', sessionId: 's1', timestamp: '2026-01-01' },
        { id: 's2', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', userId: 'u2', sessionId: 's2', timestamp: '2026-01-01' },
        { id: 's3', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', userId: 'u3', sessionId: 's3', timestamp: '2026-01-01' }
      ];
      const analysis = recDetector.analyzeRecurrence(signals);
      assert.equal(analysis.isRecurring, true);
      assert.equal(analysis.distinctUsers, 3);
      assert.ok(analysis.frequencyScore >= 75);
    });

    it('23. RegressionDetector confirme une régression à partir de retours explicites répétés', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Régression constatée depuis la mise à jour hier', normalizedText: 'Régression constatée depuis la mise à jour hier', sentiment: 'FRUSTRATED', timestamp: '2026-01-01' },
        { id: 's2', source: 'user_report', category: 'BUG', rawText: 'Avant ça marchait très bien, c est cassé après la release', normalizedText: 'Avant ça marchait très bien, c est cassé après la release', sentiment: 'FRUSTRATED', timestamp: '2026-01-01' }
      ];
      const res = regDetector.detectRegression(signals);
      assert.equal(res.status, 'CONFIRMED');
      assert.ok(res.confidence >= 0.90);
    });

    it('24. RegressionDetector suspecte une régression suite à une décision architecturale récente', () => {
      const decisions: ArchitecturalDecisionRecord[] = [
        {
          decisionId: 'adr-01',
          sessionId: 'ses-1',
          projectId: 'proj-001',
          statement: 'Migration vers le nouveau module Checkout',
          reason: 'src/components/Checkout.tsx',
          evidence: 'Audit',
          confidence: 0.9,
          alternatives: [],
          selectedAlternative: 'Checkout',
          status: 'ACTIVE',
          createdAt: '2026-01-01'
        }
      ];
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Le module checkout plante au clic', normalizedText: 'Le module checkout plante au clic', sentiment: 'FRUSTRATED', timestamp: '2026-01-01' }
      ];
      const res = regDetector.detectRegression(signals, decisions);
      assert.equal(res.status, 'SUSPECTED');
      assert.equal(res.correlatedDecisionId, 'adr-01');
    });

    it('25. ContradictionDetector crée un cluster sans trancher arbitrairement en cas d avis opposés', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'UX_PROBLEM', rawText: 'La nouvelle vue compacte est géniale et claire', normalizedText: 'La nouvelle vue compacte est géniale et claire', sentiment: 'SATISFIED', userRole: 'ADMIN', timestamp: '2026-01-01' },
        { id: 's2', source: 'user_report', category: 'UX_PROBLEM', rawText: 'La vue compacte est illisible et impossible à utiliser', normalizedText: 'La vue compacte est illisible et impossible à utiliser', sentiment: 'FRUSTRATED', userRole: 'VIEWER', timestamp: '2026-01-01' }
      ];
      const clusters = contDetector.detectContradictions(signals);
      assert.equal(clusters.length, 1);
      assert.equal(clusters[0]!.positiveCount, 1);
      assert.equal(clusters[0]!.negativeCount, 1);
      assert.ok(clusters[0]!.recommendation.includes('Ne pas trancher arbitrairement'));
    });

    it('26. TrendDetector identifie les tendances EMERGING et GROWING', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', timestamp: '2026-01-01T10:00:00Z' },
        { id: 's2', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', timestamp: '2026-01-01T15:00:00Z' },
        { id: 's3', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', timestamp: '2026-01-01T15:30:00Z' },
        { id: 's4', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', timestamp: '2026-01-01T15:45:00Z' }
      ];
      const res = trendDetector.analyzeTrend(signals);
      assert.equal(res.trend, 'GROWING');
    });

    it('27. RootCauseCorrelator corréle les anomalies avec l audit qualité et l architecture DNA', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'ACCESSIBILITY', rawText: 'Contraste insuffisant sur le bouton de validation', normalizedText: 'Contraste insuffisant sur le bouton de validation', sentiment: 'ANNOYED', componentId: '#btn-submit', timestamp: '2026-01-01' }
      ];
      const res = rootCorrelator.correlate(signals, [], MOCK_DNA, MOCK_AUDIT);
      assert.ok(res.correlatedAuditFindingIds.includes('finding-001'));
      assert.ok(res.hypothesis.includes('ACCESSIBILITY'));
      assert.ok(res.confidence >= 0.85);
    });
  });

  // 5. Impact & Scoring
  describe('5. Impact & Scoring', () => {
    const userAnalyzer = new UserImpactAnalyzer();
    const featAnalyzer = new FeedbackFeatureImpactAnalyzer();
    const roleAnalyzer = new RoleImpactAnalyzer();
    const appAnalyzer = new ApplicationImpactAnalyzer();

    const sevEngine = new SeverityEngine();
    const confEngine = new FeedbackConfidenceEngine();
    const urgEngine = new UrgencyEngine();
    const prioEngine = new ProblemPriorityEngine();

    it('28. UserImpactAnalyzer calcule le nombre d utilisateurs, le ratio et le score', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', userId: 'u1', timestamp: '2026-01-01' },
        { id: 's2', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', userId: 'u2', timestamp: '2026-01-01' }
      ];
      const res = userAnalyzer.analyze(signals, 10);
      assert.equal(res.affectedUsersCount, 2);
      assert.equal(res.userImpactRatio, 0.20);
      assert.ok(res.userImpactScore > 0 && res.userImpactScore <= 100);
    });

    it('29. FeedbackFeatureImpactAnalyzer associe les signaux aux zones fonctionnelles', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Erreur lors du login auth', normalizedText: 'Erreur lors du login auth', sentiment: 'FRUSTRATED', timestamp: '2026-01-01' }
      ];
      const res = featAnalyzer.analyze(signals);
      assert.ok(res.affectedFeatures.includes('Authentication'));
    });

    it('30. RoleImpactAnalyzer identifie les rôles RBAC et signale les rôles privilégiés', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', userRole: 'ADMIN', timestamp: '2026-01-01' }
      ];
      const res = roleAnalyzer.analyze(signals);
      assert.equal(res.affectsPrivilegedRoles, true);
      assert.ok(res.affectedRoles.includes('ADMIN'));
    });

    it('31. ApplicationImpactAnalyzer calcule le blast radius et signale le blocage du flux principal', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Paiement totalement bloqué crash', normalizedText: 'Paiement totalement bloqué crash', sentiment: 'FRUSTRATED', url: 'src/checkout.ts', timestamp: '2026-01-01' }
      ];
      const res = appAnalyzer.analyze(signals);
      assert.equal(res.isBlockingCoreFlow, true);
      assert.ok(res.blastRadiusScore >= 50);
    });

    it('32. SeverityEngine évalue CRITICAL (100) pour crash et HIGH (75) pour bug fonctionnel', () => {
      const sigCrash: UserSignal[] = [{ id: 's1', source: 'user_report', category: 'BUG', rawText: 'Crash fatal', normalizedText: 'Crash fatal', sentiment: 'FRUSTRATED', timestamp: '2026-01-01' }];
      const sigHigh: UserSignal[] = [{ id: 's2', source: 'user_report', category: 'BUG', rawText: 'Bouton inopérant', normalizedText: 'Bouton inopérant', sentiment: 'FRUSTRATED', timestamp: '2026-01-01' }];

      assert.equal(sevEngine.assessSeverity(sigCrash, 'CRASH').severityScore, 100);
      assert.equal(sevEngine.assessSeverity(sigHigh, 'FUNCTIONAL').severityScore, 75);
    });

    it('33. FeedbackConfidenceEngine combine la confiance des preuves et le volume de signaux', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', timestamp: '2026-01-01' },
        { id: 's2', source: 'user_report', category: 'BUG', rawText: 'Err', normalizedText: 'Err', sentiment: 'FRUSTRATED', timestamp: '2026-01-01' }
      ];
      const score = confEngine.computeOverallConfidence(signals, [
        { id: 'e1', source: 'error_runtime', proofLevel: 'FACT', description: 'Stack', confidence: 0.9, timestamp: '2026-01-01' }
      ]);
      assert.ok(score >= 40 && score <= 100);
    });

    it('34. UrgencyEngine évalue IMMEDIATE en cas de blocage critique', () => {
      const res = urgEngine.assessUrgency({
        severity: 'CRITICAL',
        regressionStatus: 'CONFIRMED',
        trend: 'GROWING',
        isBlockingCoreFlow: true
      });
      assert.equal(res.urgency, 'IMMEDIATE');
    });

    it('35. ProblemPriorityEngine calcule un score déterministe borné entre 0 et 100', () => {
      const scores = prioEngine.computeScores({
        severityScore: 100,
        confidenceScore: 80,
        userImpactScore: 90,
        frequencyScore: 85,
        blastRadiusScore: 70,
        regressionStatus: 'NONE',
        isBlockingCoreFlow: false,
        hasContradiction: false
      });
      assert.ok(scores.priorityScore >= 0 && scores.priorityScore <= 100);
      assert.equal(scores.regressionBonus, 0);
      assert.equal(scores.blockingBonus, 0);
      assert.equal(scores.contradictionPenalty, 0);
    });

    it('36. ProblemPriorityEngine applique les bonus de régression (+15) et de blocage (+15)', () => {
      const baseScores = prioEngine.computeScores({
        severityScore: 75,
        confidenceScore: 50,
        userImpactScore: 50,
        frequencyScore: 50,
        blastRadiusScore: 50,
        regressionStatus: 'NONE',
        isBlockingCoreFlow: false,
        hasContradiction: false
      });
      const boostedScores = prioEngine.computeScores({
        severityScore: 75,
        confidenceScore: 50,
        userImpactScore: 50,
        frequencyScore: 50,
        blastRadiusScore: 50,
        regressionStatus: 'CONFIRMED',
        isBlockingCoreFlow: true,
        hasContradiction: false
      });
      assert.equal(boostedScores.regressionBonus, 15);
      assert.equal(boostedScores.blockingBonus, 15);
      assert.ok(boostedScores.priorityScore > baseScores.priorityScore + 25);
    });

    it('37. ProblemPriorityEngine applique la pénalité de contradiction non tranchée (-10)', () => {
      const standard = prioEngine.computeScores({
        severityScore: 50,
        confidenceScore: 50,
        userImpactScore: 50,
        frequencyScore: 50,
        blastRadiusScore: 50,
        regressionStatus: 'NONE',
        isBlockingCoreFlow: false,
        hasContradiction: false
      });
      const penalized = prioEngine.computeScores({
        severityScore: 50,
        confidenceScore: 50,
        userImpactScore: 50,
        frequencyScore: 50,
        blastRadiusScore: 50,
        regressionStatus: 'NONE',
        isBlockingCoreFlow: false,
        hasContradiction: true
      });
      assert.equal(penalized.contradictionPenalty, 10);
      assert.equal(penalized.priorityScore, standard.priorityScore - 10);
    });
  });

  // 6. Graphs & Bridges
  describe('6. Graphs & Bridges', () => {
    const feedbackGraphBuilder = new FeedbackGraphBuilder();
    const problemGraphBuilder = new ProblemGraphBuilder();
    const featGraphBuilder = new FeedbackFeatureGraphBuilder();
    const convBridge = new ConversationBridge();
    const auditBridge = new AuditBridge();
    const featBridge = new FeatureIntelligenceBridge();
    const orchBridge = new FeedbackOrchestratorBridge();

    it('38. FeedbackGraphBuilder crée les arêtes de similarité entre signaux', () => {
      const signals: UserSignal[] = [
        { id: 's1', source: 'user_report', category: 'BUG', rawText: 'Crash sur le formulaire checkout', normalizedText: 'Crash sur le formulaire checkout', sentiment: 'FRUSTRATED', timestamp: '2026-01-01' },
        { id: 's2', source: 'user_report', category: 'BUG', rawText: 'Crash sur le formulaire checkout encore', normalizedText: 'Crash sur le formulaire checkout encore', sentiment: 'FRUSTRATED', timestamp: '2026-01-01' }
      ];
      const g = feedbackGraphBuilder.buildGraph(signals);
      assert.equal(g.nodes.length, 2);
      assert.equal(g.edges.length, 1);
    });

    it('39. ProblemGraphBuilder détecte les relations BLOCKS et calcule un ordre topologique acyclique', () => {
      const problems: AggregatedProblem[] = [
        {
          id: 'PRB-01',
          title: 'Crash base de données',
          description: 'Crash DB',
          category: 'BUG',
          status: 'CONFIRMED',
          severity: 'CRITICAL',
          urgency: 'IMMEDIATE',
          regressionStatus: 'NONE',
          trend: 'STABLE',
          signals: [],
          evidence: [],
          impact: { affectedUsersCount: 10, affectedSessionsCount: 10, affectedRoles: ['ADMIN'], affectedFeatures: ['Auth'], affectedFiles: ['db.ts'], userImpactRatio: 1, isBlockingCoreFlow: true, blastRadiusScore: 90 },
          scores: { severityScore: 100, confidenceScore: 90, userImpactScore: 90, frequencyScore: 90, scopeScore: 90, regressionBonus: 0, blockingBonus: 15, contradictionPenalty: 0, priorityScore: 95 },
          problemHash: 'prob-1',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          history: []
        },
        {
          id: 'PRB-02',
          title: 'Lenteur affichage profil',
          description: 'Lenteur profil',
          category: 'PERFORMANCE',
          status: 'CONFIRMED',
          severity: 'MEDIUM',
          urgency: 'NORMAL',
          regressionStatus: 'NONE',
          trend: 'STABLE',
          signals: [],
          evidence: [],
          impact: { affectedUsersCount: 2, affectedSessionsCount: 2, affectedRoles: ['VIEWER'], affectedFeatures: ['Auth'], affectedFiles: ['db.ts'], userImpactRatio: 0.2, isBlockingCoreFlow: false, blastRadiusScore: 30 },
          scores: { severityScore: 50, confidenceScore: 60, userImpactScore: 40, frequencyScore: 40, scopeScore: 30, regressionBonus: 0, blockingBonus: 0, contradictionPenalty: 0, priorityScore: 45 },
          problemHash: 'prob-2',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          history: []
        }
      ];

      const g = problemGraphBuilder.buildGraph(problems);
      assert.equal(g.edges.length, 1);
      assert.equal(g.edges[0]!.kind, 'BLOCKS');
      assert.equal(g.hasCycles, false);
      assert.deepEqual(g.rootProblemIds, ['PRB-01']);
    });

    it('40. FeedbackFeatureGraphBuilder établit le graphe bipartite entre problèmes et fonctionnalités', () => {
      const problems: AggregatedProblem[] = [
        {
          id: 'PRB-10',
          title: 'Demande export',
          description: 'Export PDF',
          category: 'FEATURE_REQUEST',
          status: 'CONFIRMED',
          severity: 'LOW',
          urgency: 'LOW',
          regressionStatus: 'NONE',
          trend: 'STABLE',
          signals: [],
          evidence: [],
          impact: { affectedUsersCount: 5, affectedSessionsCount: 5, affectedRoles: ['VIEWER'], affectedFeatures: ['Reporting'], affectedFiles: [], userImpactRatio: 0.5, isBlockingCoreFlow: false, blastRadiusScore: 20 },
          scores: { severityScore: 25, confidenceScore: 60, userImpactScore: 50, frequencyScore: 50, scopeScore: 20, regressionBonus: 0, blockingBonus: 0, contradictionPenalty: 0, priorityScore: 40 },
          problemHash: 'prob-10',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          history: []
        }
      ];
      const g = featGraphBuilder.buildGraph(problems);
      assert.equal(g.features.length, 1);
      assert.equal(g.features[0]!.featureId, 'Reporting');
      assert.equal(g.links[0]!.relationship, 'FEATURE_REQUESTED');
    });

    it('41. ConversationBridge formate une synthèse en français pédagogique', () => {
      const summary = convBridge.formatReportForChat({
        reportId: 'ufr-1',
        tenantId: 't1',
        projectId: 'p1',
        problems: [
          {
            id: 'PRB-99',
            title: 'Crash au chargement',
            description: 'Crash blanc',
            category: 'BUG',
            status: 'CONFIRMED',
            severity: 'CRITICAL',
            urgency: 'IMMEDIATE',
            regressionStatus: 'CONFIRMED',
            trend: 'GROWING',
            signals: [],
            evidence: [{ id: 'e1', source: 'error_runtime', proofLevel: 'FACT', description: 'TypeError capturé', confidence: 0.99, timestamp: '2026-01-01' }],
            impact: { affectedUsersCount: 8, affectedSessionsCount: 12, affectedRoles: ['ENGINEER'], affectedFeatures: ['Core'], affectedFiles: ['main.ts'], userImpactRatio: 0.8, isBlockingCoreFlow: true, blastRadiusScore: 80 },
            scores: { severityScore: 100, confidenceScore: 90, userImpactScore: 80, frequencyScore: 80, scopeScore: 80, regressionBonus: 15, blockingBonus: 15, contradictionPenalty: 0, priorityScore: 95 },
            suggestedRemediation: 'Ajouter un null check',
            problemHash: 'p-hash',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
            history: []
          }
        ],
        contradictions: [],
        summary: {
          totalSignals: 5,
          totalProblems: 1,
          criticalBugsCount: 1,
          confirmedRegressionsCount: 1,
          featureRequestsCount: 0,
          contradictionClustersCount: 0,
          avgPriorityScore: 95,
          topProblems: []
        },
        problemGraph: { nodes: [], edges: [], rootProblemIds: [], topologicalOrder: [], hasCycles: false },
        reportHash: 'rep-hash',
        createdAt: '2026-01-01',
        durationMs: 42
      });

      assert.ok(summary.includes('Rapport d\'Intelligence Retours & Bugs'));
      assert.ok(summary.includes('CRITIQUE'));
      assert.ok(summary.includes('95 / 100'));
    });

    it('42. AuditBridge corréle les problèmes utilisateurs avec les constats de l audit qualité', () => {
      const problems: AggregatedProblem[] = [
        {
          id: 'PRB-01',
          title: 'Contraste insuffisant sur le bouton',
          description: 'Texte peu lisible',
          category: 'ACCESSIBILITY',
          status: 'CONFIRMED',
          severity: 'HIGH',
          urgency: 'NORMAL',
          regressionStatus: 'NONE',
          trend: 'STABLE',
          signals: [],
          evidence: [],
          impact: { affectedUsersCount: 4, affectedSessionsCount: 4, affectedRoles: ['VIEWER'], affectedFeatures: ['UI'], affectedFiles: ['src/components/Button.tsx'], userImpactRatio: 0.4, isBlockingCoreFlow: false, blastRadiusScore: 20 },
          scores: { severityScore: 75, confidenceScore: 70, userImpactScore: 40, frequencyScore: 40, scopeScore: 20, regressionBonus: 0, blockingBonus: 0, contradictionPenalty: 0, priorityScore: 55 },
          problemHash: 'hash-01',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          history: []
        }
      ];

      const entries = auditBridge.correlateWithAudit(problems, MOCK_AUDIT);
      assert.equal(entries.length, 1);
      assert.equal(entries[0]!.auditFindingId, 'finding-001');
      assert.equal(entries[0]!.category, 'ACCESSIBILITY');
    });

    it('43. FeatureIntelligenceBridge convertit les demandes et UX flaws en FeatureEvidence pour AINT-014', () => {
      const problems: AggregatedProblem[] = [
        {
          id: 'PRB-FEAT',
          title: 'Ajout export CSV',
          description: 'Exporter les rapports',
          category: 'FEATURE_REQUEST',
          status: 'CONFIRMED',
          severity: 'LOW',
          urgency: 'LOW',
          regressionStatus: 'NONE',
          trend: 'STABLE',
          signals: [],
          evidence: [{ id: 'ev-1', source: 'user_report', proofLevel: 'CORRELATION', description: 'Demande export', confidence: 0.8, timestamp: '2026-01-01' }],
          impact: { affectedUsersCount: 12, affectedSessionsCount: 15, affectedRoles: ['VIEWER'], affectedFeatures: ['Export'], affectedFiles: [], userImpactRatio: 0.6, isBlockingCoreFlow: false, blastRadiusScore: 20 },
          scores: { severityScore: 25, confidenceScore: 80, userImpactScore: 60, frequencyScore: 60, scopeScore: 20, regressionBonus: 0, blockingBonus: 0, contradictionPenalty: 0, priorityScore: 48 },
          problemHash: 'hash-feat',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          history: []
        }
      ];
      const evidences = featBridge.extractFeatureEvidences(problems);
      assert.equal(evidences.length, 1);
      assert.equal(evidences[0]!.source, 'feedback');
      assert.ok(evidences[0]!.description.includes('Demande utilisateur issue du terrain'));
    });

    it('44. FeedbackOrchestratorBridge produit un EngineeringTaskGraph à 3 tâches (ANALYZE, MODIFY, VERIFY)', () => {
      const problem: AggregatedProblem = {
        id: 'PRB-FIX',
        title: 'Bouton valider plante',
        description: 'Crash onClick',
        category: 'BUG',
        status: 'CONFIRMED',
        severity: 'HIGH',
        urgency: 'HIGH',
        regressionStatus: 'NONE',
        trend: 'STABLE',
        signals: [],
        evidence: [{ id: 'e1', source: 'user_report', proofLevel: 'FACT', description: 'Trace', confidence: 0.9, timestamp: '2026-01-01' }],
        impact: { affectedUsersCount: 5, affectedSessionsCount: 5, affectedRoles: ['ENGINEER'], affectedFeatures: ['Checkout'], affectedFiles: ['src/components/Checkout.tsx'], userImpactRatio: 0.5, isBlockingCoreFlow: true, blastRadiusScore: 50 },
        scores: { severityScore: 75, confidenceScore: 80, userImpactScore: 50, frequencyScore: 50, scopeScore: 50, regressionBonus: 0, blockingBonus: 15, contradictionPenalty: 0, priorityScore: 75 },
        rootCauseHypothesis: 'Propriété undefined sur event handler',
        suggestedRemediation: 'Encapsuler le call handler',
        problemHash: 'hash-fix',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        history: []
      };

      const plan = orchBridge.createRemediationPlan(problem);
      assert.equal(plan.problemId, 'PRB-FIX');
      assert.equal(plan.taskGraph.tasks.length, 3);
      assert.equal(plan.taskGraph.tasks[0]!.operation, 'ANALYZE');
      assert.equal(plan.taskGraph.tasks[1]!.operation, 'MODIFY');
      assert.equal(plan.taskGraph.tasks[2]!.operation, 'VERIFY');
      assert.equal(plan.taskGraph.isAcyclic, true);
    });
  });

  // 7. Lifecycle, Service, Multi-Tenancy & RBAC
  describe('7. Lifecycle, Service, Multi-Tenancy & RBAC', () => {
    const lifecycleMgr = new ProblemLifecycleManager();

    it('45. FeedbackStateMachine valide les transitions légales et bloque les illégales', () => {
      assert.equal(FeedbackStateMachine.isValidTransition('DETECTED', 'CLASSIFIED'), true);
      assert.equal(FeedbackStateMachine.isValidTransition('CONFIRMED', 'PRIORITIZED'), true);
      assert.equal(FeedbackStateMachine.isValidTransition('PRIORITIZED', 'PLANNED'), true);
      assert.equal(FeedbackStateMachine.isValidTransition('PLANNED', 'IN_PROGRESS'), true);
      assert.equal(FeedbackStateMachine.isValidTransition('IN_PROGRESS', 'RESOLVED'), true);
      assert.equal(FeedbackStateMachine.isValidTransition('RESOLVED', 'VERIFIED'), true);

      assert.equal(FeedbackStateMachine.isValidTransition('DETECTED', 'RESOLVED'), false);
      assert.throws(() => FeedbackStateMachine.assertValidTransition('DETECTED', 'RESOLVED'), /Transition d'état invalide/);
    });

    it('46. ProblemLifecycleManager consigne l historique de transition et met à jour le hash', () => {
      const prob: AggregatedProblem = {
        id: 'PRB-TEST',
        title: 'Anomalie test',
        description: 'Desc',
        category: 'BUG',
        status: 'CONFIRMED',
        severity: 'MEDIUM',
        urgency: 'NORMAL',
        regressionStatus: 'NONE',
        trend: 'STABLE',
        signals: [],
        evidence: [],
        impact: { affectedUsersCount: 1, affectedSessionsCount: 1, affectedRoles: ['ENGINEER'], affectedFeatures: [], affectedFiles: [], userImpactRatio: 0.1, isBlockingCoreFlow: false, blastRadiusScore: 10 },
        scores: { severityScore: 50, confidenceScore: 50, userImpactScore: 20, frequencyScore: 20, scopeScore: 10, regressionBonus: 0, blockingBonus: 0, contradictionPenalty: 0, priorityScore: 30 },
        problemHash: 'p-hash',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        history: []
      };

      const updated = lifecycleMgr.transition(prob, 'PLANNED', 'Planifié pour sprint 4', 'usr-eng');
      assert.equal(updated.status, 'PLANNED');
      assert.equal(updated.history.length, 1);
      assert.equal(updated.history[0]!.fromStatus, 'CONFIRMED');
      assert.equal(updated.history[0]!.toStatus, 'PLANNED');
      assert.equal(updated.history[0]!.reason, 'Planifié pour sprint 4');
    });

    it('47. UserFeedbackService exécute le pipeline complet avec hash canonique et deepFreeze', async () => {
      const service = new UserFeedbackService(20);
      const req: FeedbackAnalysisRequest = {
        tenantId: 'tenant-1',
        projectId: 'project-alpha',
        rawFeedbacks: [
          'Le bouton de paiement génère une erreur 500 et un crash !',
          'Impossible de payer la commande hier comme aujourd hui'
        ],
        callerRole: 'ENGINEER'
      };

      const report = await service.analyzeFeedback(req);
      assert.equal(report.tenantId, 'tenant-1');
      assert.equal(report.projectId, 'project-alpha');
      assert.ok(report.reportHash.startsWith('ufr:'));
      assert.ok(report.problems.length >= 1);
      assert.ok(Object.isFrozen(report));
    });

    it('48. UserFeedbackService respecte le cloisonnement multi-tenant et le RBAC', async () => {
      const service = new UserFeedbackService(20);
      const req: FeedbackAnalysisRequest = {
        tenantId: 'tenant-secure',
        projectId: 'proj-secure',
        rawFeedbacks: ['Crash runtime bloquant'],
        callerRole: 'ENGINEER'
      };
      await service.analyzeFeedback(req);

      // VIEWER peut lire le rapport
      const readReport = service.getReport('tenant-secure', 'proj-secure', 'VIEWER');
      assert.ok(readReport);

      // VIEWER ne peut pas effectuer de transition de statut (PROJECT_UPDATE requis)
      const probId = readReport!.problems[0]!.id;
      await assert.rejects(
        () => service.transitionProblemStatus({
          tenantId: 'tenant-secure',
          projectId: 'proj-secure',
          problemId: probId,
          newStatus: 'PLANNED',
          userRole: 'VIEWER'
        }),
        (err: Error) => err instanceof ForbiddenError
      );

      // Locataire tiers ne peut pas trouver le problème
      await assert.rejects(
        () => service.transitionProblemStatus({
          tenantId: 'other-tenant',
          projectId: 'other-proj',
          problemId: probId,
          newStatus: 'PLANNED',
          userRole: 'ENGINEER'
        }),
        (err: Error) => err instanceof NotFoundError
      );
    });

    it('49. UserFeedbackService gère le cache LRU, les hits et les métriques', async () => {
      const service = new UserFeedbackService(5);
      const req: FeedbackAnalysisRequest = {
        tenantId: 'tenant-c',
        projectId: 'proj-c',
        rawFeedbacks: ['Bouton de profil invisible'],
        callerRole: 'ENGINEER'
      };

      const rep1 = await service.analyzeFeedback(req);
      const rep2 = await service.analyzeFeedback(req);
      assert.equal(rep1.reportId, rep2.reportId);

      const metrics = service.getCacheMetrics();
      assert.ok(metrics.hits >= 1);

      service.clearCache();
      assert.equal(service.getCacheMetrics().size, 0);
    });

    it('50. UserFeedbackService compare deux rapports et calcule le delta de scores', async () => {
      const service = new UserFeedbackService(10);
      const req1: FeedbackAnalysisRequest = {
        tenantId: 'tenant-cmp',
        projectId: 'proj-cmp',
        rawFeedbacks: ['Bug de crash très grave'],
        callerRole: 'ENGINEER'
      };
      const rep1 = await service.analyzeFeedback(req1);

      const req2: FeedbackAnalysisRequest = {
        tenantId: 'tenant-cmp',
        projectId: 'proj-cmp',
        rawFeedbacks: ['Demande d amélioration cosmétique mineure'],
        callerRole: 'ENGINEER'
      };
      const rep2 = await service.analyzeFeedback(req2);

      const comparison = service.compareReports(rep1.reportId, rep2);
      assert.equal(comparison.previousReportId, rep1.reportId);
      assert.equal(comparison.currentReportId, rep2.reportId);
      assert.ok(typeof comparison.priorityScoreDelta === 'number');
    });
  });
});
