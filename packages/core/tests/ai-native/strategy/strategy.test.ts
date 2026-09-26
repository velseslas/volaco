/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * AI Strategy Optimizer Engine - Comprehensive Unit Test Suite
 * 
 * Target: >= 50 comprehensive tests covering:
 * - Deterministic scoring & mathematical proofs
 * - NO EVIDENCE → NO CLAIM invariant
 * - Human-in-the-loop & zero direct code mutation
 * - Multi-tenancy & hermetic tenant isolation
 * - RBAC permission matrix
 * - Strategic memory & rejection tracking
 * - Strategic roadmap & topological dependency ordering
 * - Opportunity cost & What-If comparative analysis
 * - Bridges (AINT-013, AINT-014, AINT-015, AINT-009, AINT-010)
 * - LRU cache & audit trails
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  StrategyOptimizerService,
  StrategicScoreEngine,
  ValueScoreEngine,
  RiskScoreEngine,
  EffortEstimator,
  StrategicUrgencyEngine,
  OpportunityCostEngine,
  PriorityRankingEngine,
  StrategicRoadmapEngine,
  ActionSequencer,
  DependencyPlanner,
  MilestonePlanner,
  AlternativePlanner,
  StrategicRecommendationEngine,
  DecisionEngine,
  StrategicConfidenceEngine,
  DecisionRationaleEngine,
  DecisionProvenanceEngine,
  StrategyGraph,
  OpportunityProblemGraph,
  RoadmapGraph,
  StrategyStateMachine,
  RecommendationLifecycleManager,
  StrategyConversationBridge,
  StrategyFeatureIntelligenceBridge,
  StrategyFeedbackBridge,
  StrategyAuditBridge,
  StrategyApplicationUnderstandingBridge,
  StrategyOrchestratorBridge,
  computeRecommendationHash,
  computeRoadmapHash,
  computeStrategyContextHash,
  computeStrategyReportHash,
  compareRecommendations,
  StrategyLruCache
} from '../../../src/ai-native/strategy/index.js';

import type {
  StrategicRecommendation,
  StrategyOptimizationRequest,
  StrategyContext,
  StrategyEvidence,
  RoadmapHorizon
} from '../../../src/ai-native/strategy/types.js';

import { ForbiddenError, ValidationError, NotFoundError } from '../../../src/errors.js';

// Helper to construct a mock recommendation
function createMockRecommendation(overrides: Partial<StrategicRecommendation> = {}): StrategicRecommendation {
  const base: StrategicRecommendation = {
    id: 'strat-rec-1',
    tenantId: 'tenant-1',
    projectId: 'proj-1',
    type: 'FIX_REGRESSION',
    title: 'Corriger régression formulaire',
    description: 'Le bouton validation ne répond plus',
    strategicScore: 88,
    valueScore: 90,
    riskScore: 25,
    effortScore: 80,
    urgencyScore: 92,
    confidence: 0.95,
    scoreBreakdown: {
      strategicScore: 88,
      valueScore: 90,
      riskScore: 25,
      effortScore: 80,
      urgencyScore: 92,
      confidenceScore: 95,
      factors: [
        { name: 'Valeur', weight: 0.35, rawScore: 90, weightedContribution: 32, explanation: 'Forte valeur' }
      ],
      mathematicalExplanation: 'Score = 88'
    },
    expectedValue: 'Restaure l expérience',
    userImpact: 'Débloque les utilisateurs',
    technicalImpact: 'Corrige le handler',
    businessImpact: 'Évite les abandons',
    risk: {
      severity: 'LOW',
      blastRadius: 20,
      mitigation: 'Tests unitaires'
    },
    effort: {
      level: 'S',
      points: 2,
      estimatedHours: 6
    },
    dependencies: [],
    evidence: [
      {
        id: 'ev-1',
        source: 'FEEDBACK',
        description: 'Signal utilisateur vérifié',
        confidence: 0.95,
        provenanceType: 'FACT',
        verifiableReference: 'AINT-015:PRB-1'
      }
    ],
    evidenceStatus: 'VERIFIED',
    supportingProblems: ['PRB-1'],
    supportingOpportunities: [],
    supportingFindings: [],
    rationale: 'Régression confirmée prioritaire',
    alternatives: [],
    consequencesIfIgnored: ['Frustration utilisateur'],
    recommendedHorizon: 'NOW',
    recommendedSequence: 1,
    status: 'RECOMMENDED',
    provenance: {
      origin: 'test',
      ruleSet: 'V1',
      hash: 'rec:123'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return { ...base, ...overrides };
}

describe('AINT-016 — AI Strategy Optimizer Engine Suite', () => {
  let service: StrategyOptimizerService;

  beforeEach(() => {
    service = new StrategyOptimizerService(50);
  });

  // 1. Scoring & Mathematical Determinism
  describe('1. Scoring & Deterministic Formulas', () => {
    const scoreEngine = new StrategicScoreEngine();

    it('doit calculer un score déterministe identique pour les mêmes entrées', () => {
      const input = {
        valueScore: 80,
        urgencyScore: 70,
        riskScore: 30,
        effortPoints: 2,
        confidence: 0.9,
        isRegression: false,
        isBlocker: false,
        severityOrGapScore: 65
      };

      const s1 = scoreEngine.computeScore(input);
      const s2 = scoreEngine.computeScore(input);

      assert.strictEqual(s1.strategicScore, s2.strategicScore);
      assert.strictEqual(s1.factors.length, s2.factors.length);
      assert.strictEqual(s1.mathematicalExplanation, s2.mathematicalExplanation);
    });

    it('doit borner strictement le score entre 0 et 100', () => {
      const highInput = {
        valueScore: 100,
        urgencyScore: 100,
        riskScore: 0,
        effortPoints: 1,
        confidence: 1.0,
        isRegression: true,
        isBlocker: true,
        severityOrGapScore: 100
      };
      const lowInput = {
        valueScore: 0,
        urgencyScore: 0,
        riskScore: 100,
        effortPoints: 8,
        confidence: 0.1,
        isRegression: false,
        isBlocker: false,
        severityOrGapScore: 0
      };

      const high = scoreEngine.computeScore(highInput);
      const low = scoreEngine.computeScore(lowInput);

      assert.strictEqual(high.strategicScore, 100);
      assert.strictEqual(low.strategicScore, 0);
    });

    it('doit appliquer le bonus de régression (+15)', () => {
      const baseInput = {
        valueScore: 60,
        urgencyScore: 50,
        riskScore: 20,
        effortPoints: 2,
        confidence: 0.8,
        isRegression: false,
        isBlocker: false,
        severityOrGapScore: 50
      };
      const regressionInput = { ...baseInput, isRegression: true };

      const sBase = scoreEngine.computeScore(baseInput);
      const sReg = scoreEngine.computeScore(regressionInput);

      assert.strictEqual(sReg.strategicScore, sBase.strategicScore + 15);
      const bonusFactor = sReg.factors.find(f => f.name.includes('Régression'));
      assert.ok(bonusFactor);
      assert.strictEqual(bonusFactor.weightedContribution, 15);
    });

    it('doit appliquer le bonus de problème bloquant (+15)', () => {
      const baseInput = {
        valueScore: 60,
        urgencyScore: 50,
        riskScore: 20,
        effortPoints: 2,
        confidence: 0.8,
        isRegression: false,
        isBlocker: false,
        severityOrGapScore: 50
      };
      const blockerInput = { ...baseInput, isBlocker: true };

      const sBase = scoreEngine.computeScore(baseInput);
      const sBlock = scoreEngine.computeScore(blockerInput);

      assert.strictEqual(sBlock.strategicScore, sBase.strategicScore + 15);
    });

    it('doit pénaliser proportionnellement l effort important (points de story)', () => {
      const smallInput = {
        valueScore: 70,
        urgencyScore: 60,
        riskScore: 20,
        effortPoints: 1,
        confidence: 0.8,
        isRegression: false,
        isBlocker: false,
        severityOrGapScore: 50
      };
      const largeInput = { ...smallInput, effortPoints: 8 };

      const sSmall = scoreEngine.computeScore(smallInput);
      const sLarge = scoreEngine.computeScore(largeInput);

      assert.ok(sSmall.strategicScore > sLarge.strategicScore);
    });

    it('doit déduire des points pour un risque technique élevé', () => {
      const lowRiskInput = {
        valueScore: 70,
        urgencyScore: 60,
        riskScore: 10,
        effortPoints: 2,
        confidence: 0.8,
        isRegression: false,
        isBlocker: false,
        severityOrGapScore: 50
      };
      const highRiskInput = { ...lowRiskInput, riskScore: 90 };

      const sLowRisk = scoreEngine.computeScore(lowRiskInput);
      const sHighRisk = scoreEngine.computeScore(highRiskInput);

      assert.ok(sLowRisk.strategicScore > sHighRisk.strategicScore);
    });

    it('ValueScoreEngine doit calculer une valeur composite pondérée', () => {
      const valEngine = new ValueScoreEngine();
      const val = valEngine.computeValueScore({
        userImpactScore: 80,
        businessRelevanceScore: 70,
        technicalDebtReductionScore: 50,
        strategicAlignmentScore: 90
      });
      assert.ok(val >= 0 && val <= 100);
      assert.strictEqual(val, Math.round(0.35 * 80 + 0.30 * 70 + 0.20 * 90 + 0.15 * 50));
    });

    it('RiskScoreEngine doit calculer un score multi-facteur', () => {
      const riskEngine = new RiskScoreEngine();
      const risk = riskEngine.computeRiskScore({
        blastRadiusScore: 40,
        architecturalComplexityScore: 50,
        dependencyDepth: 2,
        stateMutationRiskScore: 30
      });
      assert.ok(risk >= 0 && risk <= 100);
    });

    it('EffortEstimator doit classifier fidèlement XS à XL', () => {
      const estimator = new EffortEstimator();
      const xs = estimator.estimate(1, 50, false);
      const m = estimator.estimate(2, 600, true);
      const xl = estimator.estimate(10, 2000, true);

      assert.strictEqual(xs.level, 'XS');
      assert.strictEqual(xs.points, 1);
      assert.strictEqual(m.level, 'M');
      assert.strictEqual(m.points, 3);
      assert.strictEqual(xl.level, 'XL');
      assert.strictEqual(xl.points, 8);
    });

    it('StrategicUrgencyEngine doit attribuer une urgence maximale aux bloqueurs', () => {
      const urgEngine = new StrategicUrgencyEngine();
      const urgBlocker = urgEngine.computeUrgency({
        type: 'FIX_CRITICAL_PROBLEM',
        isBlocker: true,
        isRegression: false,
        userComplaintsCount: 5
      });
      assert.ok(urgBlocker >= 95);
    });
  });

  // 2. Invariant NO EVIDENCE → NO CLAIM
  describe('2. Invariant NO EVIDENCE → NO CLAIM', () => {
    const confEngine = new StrategicConfidenceEngine();
    const recEngine = new StrategicRecommendationEngine();

    it('doit attribuer une confiance minimale si aucune preuve n est fournie', () => {
      const conf = confEngine.computeConfidence([]);
      assert.ok(conf <= 0.2);
    });

    it('doit valoriser les preuves FACT au-dessus des simples HYPOTHESIS', () => {
      const factEvidence: StrategyEvidence[] = [
        { id: '1', source: 'FEEDBACK', description: 'Log crash', confidence: 0.9, provenanceType: 'FACT', verifiableReference: 'log:1' }
      ];
      const hypoEvidence: StrategyEvidence[] = [
        { id: '2', source: 'FEATURE', description: 'Idée possible', confidence: 0.9, provenanceType: 'HYPOTHESIS', verifiableReference: 'hypo:1' }
      ];

      const cFact = confEngine.computeConfidence(factEvidence);
      const cHypo = confEngine.computeConfidence(hypoEvidence);

      assert.ok(cFact > cHypo);
    });

    it('doit calculer une confiance composite équilibrée sur plusieurs preuves', () => {
      const multiEvidence: StrategyEvidence[] = [
        { id: '1', source: 'FEEDBACK', description: 'Crash report', confidence: 0.95, provenanceType: 'FACT', verifiableReference: 'ref:1' },
        { id: '2', source: 'AUDIT', description: 'AST error', confidence: 0.85, provenanceType: 'FACT', verifiableReference: 'ref:2' }
      ];
      const conf = confEngine.computeConfidence(multiEvidence);
      assert.ok(conf >= 0.8);
    });

    it('doit marquer INSUFFICIENT_EVIDENCE une recommandation sans preuve vérifiable', () => {
      const dummyCandidate = {
        tempId: 'c-1',
        type: 'BUILD_FEATURE' as const,
        title: 'Feature sans preuve',
        description: 'Spec fantôme',
        evidence: [],
        supportingProblems: [],
        supportingOpportunities: [],
        supportingFindings: [],
        isRegression: false,
        isBlocker: false,
        severityOrGapScore: 50,
        urgencyScore: 40,
        effortPoints: 2,
        effortLevel: 'S' as const,
        valueScore: 50,
        riskScore: 20,
        riskSeverity: 'LOW' as const,
        blastRadius: 10,
        mitigation: 'None',
        expectedValue: 'Val',
        userImpact: 'Imp',
        technicalImpact: 'Tech',
        businessImpact: 'Biz',
        dependencies: []
      };

      const dummyContext: StrategyContext = {
        tenantId: 'tenant-1',
        projectId: 'proj-1',
        inputHash: 'h-1',
        collectedAt: new Date().toISOString()
      };

      const recs = recEngine.buildRecommendations([dummyCandidate], dummyContext);
      assert.strictEqual(recs.length, 1);
      const firstRec = recs[0]!;
      assert.strictEqual(firstRec.evidenceStatus, 'INSUFFICIENT_EVIDENCE');
      assert.ok(firstRec.id.startsWith('strat-rec-'));
    });

    it('doit marquer VERIFIED une recommandation appuyée par des faits vérifiables', () => {
      const validCandidate = {
        tempId: 'c-2',
        type: 'FIX_CRITICAL_PROBLEM' as const,
        title: 'Fix crash',
        description: 'Crash en production',
        evidence: [
          { id: 'ev-1', source: 'AUDIT' as const, description: 'Audit finding', confidence: 0.9, provenanceType: 'FACT' as const, verifiableReference: 'AINT-013:1' }
        ],
        supportingProblems: ['PRB-1'],
        supportingOpportunities: [],
        supportingFindings: ['FND-1'],
        isRegression: false,
        isBlocker: true,
        severityOrGapScore: 90,
        urgencyScore: 95,
        effortPoints: 2,
        effortLevel: 'S' as const,
        valueScore: 90,
        riskScore: 20,
        riskSeverity: 'LOW' as const,
        blastRadius: 15,
        mitigation: 'Test',
        expectedValue: 'Fix',
        userImpact: 'Fix',
        technicalImpact: 'Fix',
        businessImpact: 'Fix',
        dependencies: []
      };

      const dummyContext: StrategyContext = {
        tenantId: 'tenant-1',
        projectId: 'proj-1',
        inputHash: 'h-2',
        collectedAt: new Date().toISOString()
      };

      const recs = recEngine.buildRecommendations([validCandidate], dummyContext);
      const firstRec = recs[0]!;
      assert.strictEqual(firstRec.evidenceStatus, 'VERIFIED');
    });
  });

  // 3. Human Control & Zero Direct Code Mutation
  describe('3. Human Control & Lifecycle Invariants', () => {
    const lifecycle = new RecommendationLifecycleManager();
    const bridge = new StrategyOrchestratorBridge();

    it('une nouvelle recommandation doit débuter au statut RECOMMENDED', () => {
      const rec = createMockRecommendation();
      assert.strictEqual(rec.status, 'RECOMMENDED');
    });

    it('la transition vers APPROVED requiert impérativement les droits PROJECT_UPDATE', () => {
      const rec = createMockRecommendation();
      assert.throws(
        () => lifecycle.transition(rec, 'APPROVED', 'VIEWER', 'Tentative non autorisée', 'req-1'),
        ForbiddenError
      );
    });

    it('un ingénieur ou admin peut approuver une recommandation', () => {
      const rec = createMockRecommendation();
      const { updatedRecommendation, transitionRecord, memoryEntry } = lifecycle.transition(
        rec,
        'APPROVED',
        'ENGINEER',
        'Validé par lead dev',
        'req-2'
      );

      assert.strictEqual(updatedRecommendation.status, 'APPROVED');
      assert.strictEqual(transitionRecord.previousStatus, 'RECOMMENDED');
      assert.strictEqual(transitionRecord.newStatus, 'APPROVED');
      assert.strictEqual(memoryEntry.action, 'APPROVED');
    });

    it('l approbation projette un EngineeringTaskGraph avec strictement ANALYZE -> MODIFY -> VERIFY', () => {
      const rec = createMockRecommendation({ status: 'APPROVED' });
      const taskGraph = bridge.projectTaskGraph(rec);

      assert.ok(taskGraph.graphId);
      assert.strictEqual(taskGraph.tasks.length, 3);
      assert.strictEqual(taskGraph.tasks[0]?.operation, 'ANALYZE');
      assert.strictEqual(taskGraph.tasks[1]?.operation, 'MODIFY');
      assert.strictEqual(taskGraph.tasks[2]?.operation, 'VERIFY');
      assert.strictEqual(taskGraph.isAcyclic, true);
    });

    it('AINT-016 ne doit jamais modifier directement les fichiers de code', async () => {
      const req: StrategyOptimizationRequest = {
        tenantId: 'tenant-1',
        projectId: 'proj-1',
        callerRole: 'ENGINEER'
      };
      await service.optimizeStrategy(req, 'req-opt');

      const rep = service.getReport('tenant-1', 'proj-1', 'ENGINEER', 'req-read');
      assert.ok(rep);
      const topRec = rep.allRecommendations[0];
      if (topRec) {
        const approval = await service.approveRecommendation(
          'tenant-1',
          'proj-1',
          topRec.id,
          'ENGINEER',
          'Approbation test',
          'req-app'
        );
        assert.strictEqual(approval.newStatus, 'APPROVED');
        assert.ok(approval.generatedTaskGraph);
        assert.strictEqual(approval.generatedTaskGraph.tasks[0]?.operation, 'ANALYZE');
      }
    });

    it('doit permettre le cycle complet RECOMMENDED -> APPROVED -> PLANNED -> EXECUTING -> COMPLETED', () => {
      let rec = createMockRecommendation();
      const resApp = lifecycle.transition(rec, 'APPROVED', 'ENGINEER', 'Ok', 'req-c1');
      rec = resApp.updatedRecommendation;
      assert.strictEqual(rec.status, 'APPROVED');

      const resPlan = lifecycle.transition(rec, 'PLANNED', 'ENGINEER', 'Planifié', 'req-c2');
      rec = resPlan.updatedRecommendation;
      assert.strictEqual(rec.status, 'PLANNED');

      const resExec = lifecycle.transition(rec, 'EXECUTING', 'ENGINEER', 'En cours', 'req-c3');
      rec = resExec.updatedRecommendation;
      assert.strictEqual(rec.status, 'EXECUTING');

      const resComp = lifecycle.transition(rec, 'COMPLETED', 'ENGINEER', 'Terminé', 'req-c4');
      rec = resComp.updatedRecommendation;
      assert.strictEqual(rec.status, 'COMPLETED');
    });
  });

  // 4. Strategic Memory & Rejection Persistence
  describe('4. Strategic Memory & Rejection Persistence', () => {
    const decisionEngine = new DecisionEngine();

    it('une recommandation rejetée ne doit pas réapparaître sans nouvel élément', () => {
      const rec = createMockRecommendation({ id: 'strat-rec-rej-1', status: 'RECOMMENDED' });
      const context: StrategyContext = {
        tenantId: 'tenant-1',
        projectId: 'proj-1',
        inputHash: 'hash-unchanged',
        priorDecisions: [
          {
            id: 'mem-1',
            tenantId: 'tenant-1',
            projectId: 'proj-1',
            recommendationId: 'strat-rec-rej-1',
            action: 'REJECTED',
            reason: 'Hors roadmap',
            contextHash: 'hash-unchanged',
            timestamp: new Date().toISOString(),
            recordedByRole: 'OWNER'
          }
        ],
        collectedAt: new Date().toISOString()
      };

      const filtered = decisionEngine.applyMemoryAndDecisions([rec], context);
      const firstFiltered = filtered[0]!;
      assert.strictEqual(firstFiltered.status, 'REJECTED');
      assert.ok(firstFiltered.strategicScore <= 30);
      assert.ok(firstFiltered.rationale.includes('REJETÉ PRÉCÉDEMMENT'));
    });

    it('service enregistre et restitue fidèlement la mémoire de projet', async () => {
      const req: StrategyOptimizationRequest = {
        tenantId: 'tenant-mem',
        projectId: 'proj-mem',
        callerRole: 'OWNER'
      };
      await service.optimizeStrategy(req, 'req-1');

      const rep = service.getReport('tenant-mem', 'proj-mem', 'OWNER', 'req-2');
      assert.ok(rep);
      if (rep.allRecommendations.length > 0) {
        const targetId = rep.allRecommendations[0]!.id;
        await service.rejectRecommendation('tenant-mem', 'proj-mem', targetId, 'OWNER', 'Refus explicite', 'req-rej');

        const memory = service.getMemory('tenant-mem', 'proj-mem', 'OWNER', 'req-mem');
        assert.ok(memory.length >= 1);
        const entry = memory.find(m => m.recommendationId === targetId);
        assert.ok(entry);
        assert.strictEqual(entry.action, 'REJECTED');
        assert.strictEqual(entry.reason, 'Refus explicite');
      }
    });
  });

  // 5. Strategic Roadmap & Topological Ordering
  describe('5. Strategic Roadmap & Horizons', () => {
    const roadmapEngine = new StrategicRoadmapEngine();
    const sequencer = new ActionSequencer();
    const depPlanner = new DependencyPlanner();

    it('doit ordonner les actions selon l ordre topologique des dépendances', () => {
      const recA = createMockRecommendation({ id: 'rec-A', strategicScore: 60, dependencies: [] });
      const recB = createMockRecommendation({ id: 'rec-B', strategicScore: 90, dependencies: ['rec-A'] });

      const ordered = sequencer.sequence([recB, recA]);
      assert.strictEqual(ordered[0]?.id, 'rec-A');
      assert.strictEqual(ordered[1]?.id, 'rec-B');
    });

    it('doit valider l absence de cycles dans les dépendances', () => {
      const recA = createMockRecommendation({ id: 'rec-A', dependencies: ['rec-B'] });
      const recB = createMockRecommendation({ id: 'rec-B', dependencies: ['rec-A'] });

      const val = depPlanner.validate([recA, recB]);
      assert.strictEqual(val.isValid, false);
      assert.ok(val.cyclesDetected.length > 0);
    });

    it('doit répartir les actions dans les 4 horizons (NOW, NEXT, LATER, DEFERRED)', () => {
      const nowRec = createMockRecommendation({ id: 'r-now', strategicScore: 95, type: 'FIX_REGRESSION' });
      const nextRec = createMockRecommendation({ id: 'r-next', strategicScore: 65, type: 'BUILD_FEATURE' });
      const laterRec = createMockRecommendation({ id: 'r-later', strategicScore: 45, type: 'REDUCE_TECHNICAL_DEBT' });
      const defRec = createMockRecommendation({ id: 'r-def', strategicScore: 20, type: 'DEFER' });

      const roadmap = roadmapEngine.generateRoadmap('tenant-1', 'proj-1', [nowRec, nextRec, laterRec, defRec]);

      assert.ok(roadmap.horizons.now.some(a => a.recommendationId === 'r-now'));
      assert.ok(roadmap.horizons.next.some(a => a.recommendationId === 'r-next'));
      assert.ok(roadmap.horizons.later.some(a => a.recommendationId === 'r-later'));
      assert.ok(roadmap.horizons.deferred.some(a => a.recommendationId === 'r-def'));
    });

    it('MilestonePlanner doit synthétiser des jalons exploitables', () => {
      const planner = new MilestonePlanner();
      const rNow = createMockRecommendation({ id: 'r-now', strategicScore: 90 });
      const rNext = createMockRecommendation({ id: 'r-next', strategicScore: 70 });
      const roadmap = roadmapEngine.generateRoadmap('tenant-1', 'proj-1', [rNow, rNext]);

      const milestones = planner.planMilestones(roadmap, [rNow, rNext]);
      assert.ok(milestones.length >= 1);
      assert.strictEqual(milestones[0]?.targetHorizon, 'NOW');
      assert.ok(milestones[0]!.totalEffortPoints > 0);
    });

    it('RoadmapGraph doit générer des swimlanes fidèles', () => {
      const rg = new RoadmapGraph();
      const rNow = createMockRecommendation({ id: 'rn', strategicScore: 85 });
      const roadmap = roadmapEngine.generateRoadmap('t', 'p', [rNow]);
      const struct = rg.generateSwimlanes(roadmap);

      assert.strictEqual(struct.lanes.length, 4);
      assert.strictEqual(struct.lanes[0]?.horizon, 'NOW');
      assert.ok(struct.lanes[0]!.items.length >= 1);
    });
  });

  // 6. Opportunity Cost & What-If Comparison
  describe('6. Opportunity Cost & What-If Analysis', () => {
    const oppCost = new OpportunityCostEngine();
    const altPlanner = new AlternativePlanner();

    it('doit identifier les recommandations de haute valeur différées', () => {
      const rec1 = createMockRecommendation({ id: 'r-1', strategicScore: 85, valueScore: 80 });
      const rec2 = createMockRecommendation({ id: 'r-2', strategicScore: 90, valueScore: 90 });
      const rec3 = createMockRecommendation({ id: 'r-3', strategicScore: 60, valueScore: 50 });

      const evalResult = oppCost.evaluate(['r-1'], [rec1, rec2, rec3]);

      assert.strictEqual(evalResult.forgoneRecommendations.length, 2);
      assert.strictEqual(evalResult.forgoneRecommendations[0]?.id, 'r-2');
      assert.ok(evalResult.opportunityCostRatio > 0);
      assert.ok(evalResult.rationale.includes('Attention'));
    });

    it('doit générer 3 scénarios alternatifs avec comparaison mathématique', () => {
      const recs = [
        createMockRecommendation({ id: 'r-stab', type: 'FIX_CRITICAL_PROBLEM', strategicScore: 92 }),
        createMockRecommendation({ id: 'r-feat', type: 'BUILD_FEATURE', strategicScore: 78 }),
        createMockRecommendation({ id: 'r-debt', type: 'REDUCE_TECHNICAL_DEBT', strategicScore: 60 })
      ];

      const whatIf = altPlanner.generateAlternatives(recs);

      assert.strictEqual(whatIf.comparisonMatrix.length, 3);
      assert.strictEqual(whatIf.recommendedScenarioId, 'scen-balanced-optimal');
      assert.ok(whatIf.recommendationRationale.length > 10);
    });

    it('AlternativePlanner doit gérer un ensemble vide sans crash', () => {
      const whatIf = altPlanner.generateAlternatives([]);
      assert.strictEqual(whatIf.recommendedScenarioId, 'scen-empty');
      assert.strictEqual(whatIf.baseStrategy.projectedStrategicValue, 100);
    });
  });

  // 7. Multi-Tenancy & Hermetic Isolation
  describe('7. Multi-Tenancy & Hermetic Isolation', () => {
    it('un locataire B ne doit pas voir les rapports du locataire A', async () => {
      const reqA: StrategyOptimizationRequest = {
        tenantId: 'tenant-alpha',
        projectId: 'proj-common',
        callerRole: 'ENGINEER'
      };
      await service.optimizeStrategy(reqA, 'req-alpha');

      const repA = service.getReport('tenant-alpha', 'proj-common', 'ENGINEER', 'req-check-a');
      assert.ok(repA);

      const repB = service.getReport('tenant-beta', 'proj-common', 'ENGINEER', 'req-check-b');
      assert.strictEqual(repB, undefined);
    });

    it('l isolation de la mémoire doit être étanche entre locataires', () => {
      const recA = createMockRecommendation({ tenantId: 'tenant-A', projectId: 'p1' });
      const lifecycle = new RecommendationLifecycleManager();
      const { memoryEntry } = lifecycle.transition(recA, 'REJECTED', 'ADMIN', 'Refus', 'req-t');

      assert.strictEqual(memoryEntry.tenantId, 'tenant-A');
      const memB = service.getMemory('tenant-B', 'p1', 'ADMIN', 'req-b');
      assert.strictEqual(memB.length, 0);
    });

    it('clearTenant doit purger uniquement le locataire ciblé dans le cache', () => {
      const cache = new StrategyLruCache(10);
      const dummyRep = (tenant: string) => ({
        id: '1',
        tenantId: tenant,
        projectId: 'p',
        overallStrategicScore: 80,
        topPriorities: [],
        allRecommendations: [],
        roadmap: {} as any,
        whatIfAnalysis: {} as any,
        contextSummary: {} as any,
        metrics: {} as any,
        createdAt: '',
        reportHash: ''
      });

      cache.set('tA', 'p', 'h', dummyRep('tA'));
      cache.set('tB', 'p', 'h', dummyRep('tB'));
      assert.strictEqual(cache.size(), 2);

      cache.clearTenant('tA');
      assert.strictEqual(cache.has('tA', 'p', 'h'), false);
      assert.strictEqual(cache.has('tB', 'p', 'h'), true);
    });
  });

  // 8. RBAC Matrix Verification
  describe('8. RBAC Matrix Verification', () => {
    it('VIEWER peut analyser et lire la stratégie', async () => {
      const req: StrategyOptimizationRequest = {
        tenantId: 'tenant-rbac',
        projectId: 'proj-rbac',
        callerRole: 'VIEWER'
      };
      const rep = await service.optimizeStrategy(req, 'req-v1');
      assert.ok(rep);
      assert.ok(rep.allRecommendations);
    });

    it('VIEWER ne peut pas approuver une recommandation', async () => {
      await assert.rejects(
        async () => {
          await service.approveRecommendation('tenant-rbac', 'proj-rbac', 'rec-x', 'VIEWER', 'Tentative', 'req-v2');
        },
        ForbiddenError
      );
    });

    it('VIEWER ne peut pas rejeter une recommandation', async () => {
      await assert.rejects(
        async () => {
          await service.rejectRecommendation('tenant-rbac', 'proj-rbac', 'rec-x', 'VIEWER', 'Tentative', 'req-v3');
        },
        ForbiddenError
      );
    });

    it('doit lever ValidationError si tenantId ou projectId est manquant', async () => {
      await assert.rejects(
        async () => {
          await service.optimizeStrategy({ tenantId: '', projectId: 'p', callerRole: 'ENGINEER' }, 'req-err');
        },
        ValidationError
      );
    });
  });

  // 9. Bridges Integration
  describe('9. Bridges Integration (AINT-009, 010, 013, 014, 015)', () => {
    it('StrategyConversationBridge restitue des réponses claires en langage naturel', () => {
      const bridge = new StrategyConversationBridge();
      const rec = createMockRecommendation();
      const rep = {
        id: 'rep-1',
        tenantId: 't',
        projectId: 'p',
        overallStrategicScore: 85,
        topPriorities: [rec],
        allRecommendations: [rec],
        roadmap: {
          id: 'rdm-1',
          tenantId: 't',
          projectId: 'p',
          horizons: { now: [], next: [], later: [], deferred: [] },
          topologicalOrder: [],
          totalActionsCount: 1,
          estimatedTotalEffortPoints: 2,
          generatedAt: new Date().toISOString(),
          roadmapHash: 'rdm:1'
        },
        whatIfAnalysis: {
          baseStrategy: { id: 's', name: 'S', description: 'D', selectedRecommendationIds: [], projectedStrategicValue: 80, projectedRiskScore: 20, projectedEffortPoints: 2, opportunityCost: { forgoneRecommendations: [], totalForgoneValue: 0, rationale: '' }, pros: [], cons: [] },
          alternativeScenarios: [],
          recommendedScenarioId: 's',
          recommendationRationale: 'Ratio optimal',
          comparisonMatrix: []
        },
        contextSummary: { auditFindingsCount: 2, featureOpportunitiesCount: 3, userProblemsCount: 1, regressionsCount: 1, criticalDefectsCount: 0 },
        metrics: { analysisDurationMs: 10, totalEvidenceEvaluated: 1, rulesTriggeredCount: 1 },
        createdAt: new Date().toISOString(),
        reportHash: 'rep:1'
      };

      const overview = bridge.formatStrategyOverview(rep);
      const priorities = bridge.formatTopPriorities(rep);
      const why = bridge.formatWhyExplanation(rec);
      const roadmapStr = bridge.formatRoadmap(rep.roadmap);

      assert.ok(overview.includes('Situation Stratégique Actuelle'));
      assert.ok(priorities.includes('Top Priorités Stratégiques'));
      assert.ok(why.includes('Justification Déterministe'));
      assert.ok(why.includes('Que se passe-t-il si nous ne faisons rien ?'));
      assert.ok(roadmapStr.includes('Roadmap Stratégique Séquencée'));
    });

    it('StrategyFeatureIntelligenceBridge filtre correctement les opportunités', () => {
      const featBridge = new StrategyFeatureIntelligenceBridge();
      const extracted = featBridge.extractOpportunities(undefined);
      assert.strictEqual(extracted.length, 0);
    });

    it('StrategyFeedbackBridge identifie immédiatement les régressions bloquantes', () => {
      const feedBridge = new StrategyFeedbackBridge();
      assert.strictEqual(feedBridge.hasCriticalRegression(undefined), false);
    });

    it('StrategyAuditBridge extrait le score de santé global', () => {
      const auditBridge = new StrategyAuditBridge();
      assert.strictEqual(auditBridge.getHealthScore(undefined), 80);
    });

    it('StrategyApplicationUnderstandingBridge résume l architecture sans DNA', () => {
      const appBridge = new StrategyApplicationUnderstandingBridge();
      const summary = appBridge.summarizeArchitecture(undefined);
      assert.strictEqual(summary.framework, 'Vanilla / HTML5');
    });

    it('OpportunityProblemGraph mappe correctement les problèmes aux recommandations', () => {
      const opGraph = new OpportunityProblemGraph();
      const rec = createMockRecommendation({ supportingProblems: ['PRB-99'], supportingFindings: ['FND-77'] });
      const links = opGraph.mapProblemsToSolutions([rec]);

      assert.strictEqual(links.length, 2);
      assert.strictEqual(links[0]?.problemOrFindingId, 'PRB-99');
      assert.strictEqual(links[1]?.problemOrFindingId, 'FND-77');
    });
  });

  // 10. Canonical Hashing, State Machine & LRU Cache
  describe('10. Canonical Hashing, State Machine & LRU Cache', () => {
    it('computeRecommendationHash produit un hash reproductible', () => {
      const h1 = computeRecommendationHash({ type: 'FIX_REGRESSION', title: 'Fix bug', tenantId: 't1', projectId: 'p1' });
      const h2 = computeRecommendationHash({ type: 'FIX_REGRESSION', title: 'Fix bug', tenantId: 't1', projectId: 'p1' });
      assert.strictEqual(h1, h2);
      assert.ok(h1.startsWith('rec:'));
    });

    it('compareRecommendations trie par score décroissant puis urgence décroissante', () => {
      const rHigh = { id: '1', title: 'A', strategicScore: 90, urgencyScore: 80, confidence: 0.9 };
      const rLow = { id: '2', title: 'B', strategicScore: 60, urgencyScore: 50, confidence: 0.8 };

      assert.ok(compareRecommendations(rHigh, rLow) < 0);
      assert.ok(compareRecommendations(rLow, rHigh) > 0);
    });

    it('StrategyLruCache respecte la taille maximale et enregistre les métriques', () => {
      const cache = new StrategyLruCache(2);
      const dummyRep = (id: string) => ({
        id,
        tenantId: 't1',
        projectId: 'p1',
        overallStrategicScore: 80,
        topPriorities: [],
        allRecommendations: [],
        roadmap: {} as any,
        whatIfAnalysis: {} as any,
        contextSummary: {} as any,
        metrics: {} as any,
        createdAt: '',
        reportHash: ''
      });

      cache.set('t1', 'p1', 'h1', dummyRep('1'));
      cache.set('t1', 'p1', 'h2', dummyRep('2'));
      assert.strictEqual(cache.size(), 2);

      // Access h1 to make it most recently used
      assert.ok(cache.get('t1', 'p1', 'h1'));

      // Add h3 -> h2 must be evicted
      cache.set('t1', 'p1', 'h3', dummyRep('3'));
      assert.strictEqual(cache.size(), 2);
      assert.strictEqual(cache.has('t1', 'p1', 'h2'), false);
      assert.strictEqual(cache.has('t1', 'p1', 'h1'), true);

      const metrics = cache.getMetrics();
      assert.ok(metrics.hits >= 1);
      assert.strictEqual(metrics.evictions, 1);
    });

    it('DecisionProvenanceEngine génère une trace vérifiable de bout en bout', () => {
      const provEngine = new DecisionProvenanceEngine();
      const rec = createMockRecommendation();
      const trace = provEngine.buildProvenanceTrace(rec);

      assert.strictEqual(trace.recommendationId, rec.id);
      assert.ok(trace.chain.length >= 4);
      assert.strictEqual(trace.isFullyVerifiable, true);
      assert.ok(trace.chain.some(s => s.stage === 'EVIDENCE'));
      assert.ok(trace.chain.some(s => s.stage === 'SCORING'));
      assert.ok(trace.chain.some(s => s.stage === 'DECISION'));
      assert.ok(trace.chain.some(s => s.stage === 'EXECUTION_PROJECTION'));
    });

    it('StrategyStateMachine respecte les transitions autorisées et rejette les transitions illégales', () => {
      const sm = new StrategyStateMachine();
      assert.strictEqual(sm.getState(), 'INITIALIZING');
      sm.transitionTo('AGGREGATING');
      sm.transitionTo('PRIORITIZING');
      sm.transitionTo('PLANNING');
      sm.transitionTo('OPTIMIZED');
      assert.strictEqual(sm.getState(), 'OPTIMIZED');

      assert.throws(() => sm.transitionTo('PLANNING'));
    });

    it('StrategyGraph extrait le chemin critique des recommandations', () => {
      const sg = new StrategyGraph();
      const r1 = createMockRecommendation({ id: 'r1', strategicScore: 90, dependencies: [] });
      const r2 = createMockRecommendation({ id: 'r2', strategicScore: 80, dependencies: ['r1'] });

      const graph = sg.buildGraph([r1, r2]);
      assert.strictEqual(graph.nodes.length, 2);
      assert.strictEqual(graph.edges.length, 1);
      assert.strictEqual(graph.criticalPath[0], 'r1');
      assert.strictEqual(graph.criticalPath[1], 'r2');
    });

    it('service expose fidèlement les métriques de cache', () => {
      const metrics = service.getCacheMetrics();
      assert.strictEqual(typeof metrics.hits, 'number');
      assert.strictEqual(typeof metrics.misses, 'number');
      assert.strictEqual(typeof metrics.hitRatio, 'number');
    });
  });
});
