/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Intelligence & Product Evolution Engine - Comprehensive Test Suite
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FeatureIntelligenceService,
  EvidenceEngine,
  EvidenceRanker,
  ConfidenceEngine,
  SignalCollector,
  FeatureGapDetector,
  FeatureRedundancyDetector,
  FeatureConflictDetector,
  OpportunityDetector,
  FeatureCandidateGenerator,
  FeatureSpecGenerator,
  FeatureAlternativeGenerator,
  FeatureImpactAnalyzer,
  DependencyAnalyzer,
  BlastRadiusAnalyzer,
  FeatureValueEngine,
  PriorityEngine,
  OpportunityRanking,
  FeatureGraphBuilder,
  FeatureDependencyGraph,
  FeatureStateMachine,
  FeatureLifecycle,
  FeatureAuditBridge,
  FeatureConversationBridge,
  FeatureOrchestratorBridge,
  FeatureIntelligenceLruCache,
  computeFeatureCandidateHash,
  computeFeatureReportHash,
  compareFeatureCandidates
} from '../../../src/ai-native/feature-intelligence/index.js';

import type {
  FeatureCandidate,
  FeatureEvidence,
  FeatureDiscoveryRequest,
  FeatureFileEntry
} from '../../../src/ai-native/feature-intelligence/types.js';

import type { ApplicationDNA } from '../../../src/ai-native/dna/types.js';
import type { ApplicationAuditReport } from '../../../src/ai-native/application-audit/types.js';
import type { ConversationTurn, ArchitecturalDecisionRecord } from '../../../src/ai-native/conversation-intelligence/types.js';
import { ForbiddenError, NotFoundError } from '../../../src/errors.js';

// --- Fixtures & Mocks Déterministes ---

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
    layers: [],
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

const MOCK_AUDIT_REPORT: ApplicationAuditReport = {
  reportId: 'aar-mock-001',
  tenantId: 'tenant-test',
  projectId: 'proj-001',
  overallScore: 68,
  dimensionScores: {
    architecture: 80,
    codeQuality: 85,
    security: 90,
    performance: 65,
    ux: 60,
    accessibility: 55,
    aiConfig: 85,
    designHarmony: 70
  },
  findings: [
    {
      id: 'f-a11y-1',
      dimension: 'ACCESSIBILITY',
      severity: 'HIGH',
      title: 'Contraste insuffisant',
      description: 'Le contraste du texte principal est de 2.8:1 (seuil requis: 4.5:1).',
      location: { filePath: 'index.html', line: 12 },
      cause: 'Couleur de texte trop claire sur fond blanc',
      impact: 'Illisibilité pour les utilisateurs malvoyants',
      recommendation: 'Adopter une couleur plus sombre ou un mode contrasté',
      autoRemediable: true,
      evidence: []
    },
    {
      id: 'f-a11y-2',
      dimension: 'ACCESSIBILITY',
      severity: 'MEDIUM',
      title: 'Bouton sans libellé accessible',
      description: 'Le bouton icône n a pas d attribut aria-label.',
      location: { filePath: 'src/components/Header.tsx', line: 8 },
      cause: 'Manque aria-label',
      impact: 'Non vocalisable par les lecteurs d écran',
      recommendation: 'Ajouter aria-label="Menu"',
      autoRemediable: true,
      evidence: []
    },
    {
      id: 'f-ux-1',
      dimension: 'UX',
      severity: 'MEDIUM',
      title: 'Débordement responsive horizontal',
      description: 'Largeur fixe 450px provoquant un scroll horizontal sur mobile.',
      location: { filePath: 'src/components/UserList.tsx', line: 15 },
      cause: 'Largeur fixe en px',
      impact: 'Expérience dégradée sur smartphones',
      recommendation: 'Utiliser max-w-full ou w-full',
      autoRemediable: true,
      evidence: []
    }
  ],
  summary: {
    totalFindings: 3,
    criticalCount: 0,
    highCount: 1,
    mediumCount: 2,
    lowCount: 0,
    infoCount: 0,
    autoRemediableCount: 3
  },
  auditHash: 'aar:1234567890abcdef',
  createdAt: '2026-09-07T10:00:00.000Z',
  durationMs: 45
};

const MOCK_FILES: FeatureFileEntry[] = [
  {
    path: 'index.html',
    content: '<!DOCTYPE html><html><body><div id="root"></div><script src="src/main.js"></script></body></html>'
  },
  {
    path: 'src/components/UserList.js',
    content: 'export function UserList() { return "<div class=\'users\'><ul><li>User 1</li></ul></div>"; }'
  },
  {
    path: 'src/services/api.js',
    content: 'export function fetchUsers() { return fetch("/api/users"); }'
  }
];

const MOCK_CONVERSATIONS: ConversationTurn[] = [
  {
    turnIndex: 0,
    turnId: 'turn-1',
    userMessage: { id: 'm1', sender: 'HUMAN', content: 'Peut-on ajouter un dashboard avec des statistiques et analytics ?', timestamp: '2026-09-07T10:05:00Z' },
    stateBefore: 'UNDERSTANDING',
    stateAfter: 'PLANNING',
    intent: { category: 'CREATE', goal: 'dashboard', requestedAction: 'add dashboard', entities: [], constraints: [], urgency: 'NORMAL', confidence: 0.9, ambiguities: [] },
    assumptions: [],
    decisions: [],
    agentResponse: { id: 'm2', sender: 'AGENT', content: 'Bien sûr.', timestamp: '2026-09-07T10:05:05Z' },
    trace: {
      traceId: 'tr-1',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      stateBefore: 'UNDERSTANDING',
      stateAfter: 'PLANNING',
      intentCategory: 'CREATE',
      contextHash: 'c-hash-1',
      applicationHash: 'a-hash-1',
      actionTaken: 'PLAN',
      confidence: 0.9,
      events: [],
      durationMs: 12
    }
  },
  {
    turnIndex: 1,
    turnId: 'turn-2',
    userMessage: { id: 'm3', sender: 'HUMAN', content: 'Oui je veux voir des graphiques analytics sur les ventes.', timestamp: '2026-09-07T10:06:00Z' },
    stateBefore: 'PLANNING',
    stateAfter: 'PLANNING',
    intent: { category: 'CREATE', goal: 'analytics charts', requestedAction: 'add analytics', entities: [], constraints: [], urgency: 'NORMAL', confidence: 0.95, ambiguities: [] },
    assumptions: [],
    decisions: [],
    agentResponse: { id: 'm4', sender: 'AGENT', content: 'Très bien.', timestamp: '2026-09-07T10:06:05Z' },
    trace: {
      traceId: 'tr-2',
      sessionId: 'sess-1',
      turnId: 'turn-2',
      stateBefore: 'PLANNING',
      stateAfter: 'PLANNING',
      intentCategory: 'CREATE',
      contextHash: 'c-hash-2',
      applicationHash: 'a-hash-2',
      actionTaken: 'PLAN',
      confidence: 0.95,
      events: [],
      durationMs: 15
    }
  }
];

describe('AINT-014 : Feature Intelligence & Product Evolution Engine Unit Tests', () => {

  // --- 1. Evidence Engine & NO EVIDENCE -> NO CLAIM ---

  describe('1. Evidence Engine & NO EVIDENCE -> NO CLAIM', () => {
    const engine = new EvidenceEngine();

    it('1.1 doit rejeter impitoyablement toute liste d évidences vide', () => {
      const res = engine.validateEvidence([]);
      assert.equal(res.isValid, false);
      assert.ok(res.reason?.includes('NO EVIDENCE -> NO CLAIM'));
    });

    it('1.2 doit rejeter les évidences sans description substantielle ou sans références matérielles', () => {
      const badEvidence: FeatureEvidence = {
        id: 'ev-bad',
        source: 'feedback',
        description: 'court',
        confidence: 0.5,
        references: []
      };
      const res = engine.validateEvidence([badEvidence]);
      assert.equal(res.isValid, false);
    });

    it('1.3 doit valider des évidences solides et extraire les sources distinctes', () => {
      const validEvidence: FeatureEvidence = engine.createEvidence(
        'ev-ok',
        'audit',
        'Non-conformité WCAG 2.1 AA détectée avec score bas',
        0.9,
        [{ sourceId: 'f-1', filePath: 'index.html', detail: 'Contraste 2.8:1' }]
      );
      const res = engine.validateEvidence([validEvidence]);
      assert.equal(res.isValid, true);
      assert.equal(res.totalEvidenceCount, 1);
      assert.deepEqual(res.distinctSources, ['audit']);
    });
  });

  // --- 2. Evidence Ranker & Confidence Engine ---

  describe('2. Evidence Ranker & Confidence Engine', () => {
    const ranker = new EvidenceRanker();
    const confEngine = new ConfidenceEngine();

    it('2.1 doit ordonner les sources par autorité décroissante (audit > conversation > usage)', () => {
      const evAudit: FeatureEvidence = {
        id: 'ev-audit',
        source: 'audit',
        description: 'Preuve issue d un scan AST',
        confidence: 0.9,
        references: [{ sourceId: 's1', detail: 'test' }]
      };
      const evUsage: FeatureEvidence = {
        id: 'ev-usage',
        source: 'usage',
        description: 'Preuve issue de télémétrie',
        confidence: 0.9,
        references: [{ sourceId: 's2', detail: 'test' }]
      };
      const ranked = ranker.rankEvidence([evUsage, evAudit]);
      assert.equal(ranked[0]!.source, 'audit');
    });

    it('2.2 doit calculer un score de confiance déterministe avec bonus multi-sources', () => {
      const multiEvidence: FeatureEvidence[] = [
        { id: 'e1', source: 'audit', description: 'audit evidence', confidence: 0.9, references: [{ sourceId: '1', detail: 'a' }] },
        { id: 'e2', source: 'conversation', description: 'conv evidence', confidence: 0.85, references: [{ sourceId: '2', detail: 'b' }] },
        { id: 'e3', source: 'application', description: 'app evidence', confidence: 0.8, references: [{ sourceId: '3', detail: 'c' }, { sourceId: '4', detail: 'd' }] }
      ];
      const score = confEngine.computeConfidenceScore(multiEvidence);
      assert.ok(score >= 75 && score <= 100);
    });

    it('2.3 doit renvoyer 0 si aucune évidence n est fournie', () => {
      assert.equal(confEngine.computeConfidenceScore([]), 0);
    });
  });

  // --- 3. Signal Collector & Gap Detector ---

  describe('3. Signal Collector & Feature Gap Detector', () => {
    const collector = new SignalCollector();
    const gapDetector = new FeatureGapDetector();

    it('3.1 doit collecter les signaux applicatifs, routes et composants sans altération', () => {
      const signals = collector.collectSignals({
        files: MOCK_FILES,
        dna: MOCK_DNA
      });
      assert.equal(signals.totalFileCount, 3);
      assert.ok(signals.detectedComponents.includes('UserList'));
    });

    it('3.2 doit détecter le gap de recherche globale quand aucun composant Search n existe', () => {
      const signals = collector.collectSignals({ files: MOCK_FILES });
      const gaps = gapDetector.detectGaps(signals);
      const searchGap = gaps.find((g) => g.id === 'gap-search-filter');
      assert.ok(searchGap);
      assert.equal(searchGap.category, 'FUNCTIONAL_GAP');
      assert.ok(searchGap.initialEvidence.length > 0);
    });

    it('3.3 doit détecter le gap d export de données multi-formats', () => {
      const signals = collector.collectSignals({ files: MOCK_FILES });
      const gaps = gapDetector.detectGaps(signals);
      const exportGap = gaps.find((g) => g.id === 'gap-data-export');
      assert.ok(exportGap);
    });
  });

  // --- 4. Redundancy Detector ---

  describe('4. Feature Redundancy Detector', () => {
    const redundancyDetector = new FeatureRedundancyDetector();
    const collector = new SignalCollector();

    it('4.1 doit déclarer REDUNDANT une opportunité de recherche si SearchBar existe déjà', () => {
      const signals = collector.collectSignals({
        files: [
          { path: 'src/components/SearchBar.js', content: 'export function SearchBar() { return "<input>"; }' }
        ]
      });
      const res = redundancyDetector.checkRedundancy('Moteur de Recherche Globale', 'Recherche rapide', signals);
      assert.equal(res.isRedundant, true);
      assert.ok(res.reason?.includes('SearchBar'));
    });

    it('4.2 doit déclarer REDUNDANT si une route existante /search est déjà présente', () => {
      const signals = collector.collectSignals({
        files: [
          { path: 'index.html', content: '<a href="/search">Recherche</a>' }
        ]
      });
      const res = redundancyDetector.checkRedundancy('Recherche Globale', 'Barre de recherche', signals);
      assert.equal(res.isRedundant, true);
    });

    it('4.3 doit autoriser une opportunité totalement nouvelle sans redondance', () => {
      const signals = collector.collectSignals({ files: MOCK_FILES });
      const res = redundancyDetector.checkRedundancy('Mode Hors Ligne PWA', 'Service worker et cache', signals);
      assert.equal(res.isRedundant, false);
    });
  });

  // --- 5. Conflict Detector ---

  describe('5. Feature Conflict Detector', () => {
    const conflictDetector = new FeatureConflictDetector();

    it('5.1 doit détecter un conflit avec le DNA si verrouillage propriétaire imposé', () => {
      const res = conflictDetector.checkConflict({
        title: 'Verrouillage Cloud',
        description: 'coupler directement à openai sans abstraction',
        proposedSolution: 'coupler directement à openai en dur',
        dna: MOCK_DNA
      });
      assert.equal(res.hasConflict, true);
      assert.equal(res.conflictKind, 'DNA_CONFLICT');
    });

    it('5.2 doit détecter un conflit architectural si tentative SQL direct dans une SPA', () => {
      const res = conflictDetector.checkConflict({
        title: 'Connexion Directe BDD',
        description: 'connexion sql directe depuis le composant React',
        proposedSolution: 'pilote postgresql natif dans le client',
        dna: MOCK_DNA
      });
      assert.equal(res.hasConflict, true);
      assert.equal(res.conflictKind, 'ARCHITECTURE_CONFLICT');
    });

    it('5.3 doit détecter un conflit de sécurité si proposition d eval ou clé api en clair', () => {
      const res = conflictDetector.checkConflict({
        title: 'Exécution Dynamique',
        description: 'utiliser eval pour parser les règles',
        proposedSolution: 'utiliser eval directement',
        dna: MOCK_DNA
      });
      assert.equal(res.hasConflict, true);
      assert.equal(res.conflictKind, 'SECURITY_CONFLICT');
    });

    it('5.4 doit détecter un conflit avec un ADR existant', () => {
      const adr: ArchitecturalDecisionRecord = {
        decisionId: 'adr-001',
        sessionId: 's1',
        projectId: 'p1',
        statement: 'Pas de mode sombre dans cette version',
        reason: 'Charte graphique épurée',
        evidence: 'Choix designer',
        confidence: 0.9,
        alternatives: [],
        selectedAlternative: 'Light Only',
        status: 'ACTIVE',
        createdAt: '2026-09-07T10:00:00Z'
      };
      const res = conflictDetector.checkConflict({
        title: 'Mode Sombre Automatique',
        description: 'Ajouter un mode sombre dynamique',
        proposedSolution: 'Implémenter le mode sombre',
        decisions: [adr]
      });
      assert.equal(res.hasConflict, true);
    });
  });

  // --- 6. Generation, Spec & Alternatives ---

  describe('6. Feature Generation & Specification', () => {
    const altGen = new FeatureAlternativeGenerator();
    const specGen = new FeatureSpecGenerator();
    const candGen = new FeatureCandidateGenerator();

    it('6.1 doit générer une version MVP et une version Complète avec compromis clairs', () => {
      const alts = altGen.generateAlternatives('Recherche', 'Barre de recherche client');
      assert.equal(alts.length, 2);
      assert.equal(alts[0]!.isRecommended, true);
      assert.equal(alts[0]!.estimatedEffort, 'S');
      assert.equal(alts[1]!.estimatedEffort, 'L');
    });

    it('6.2 doit produire une spécification complète avec scope, out-of-scope et critères de succès', () => {
      const spec = specGen.generateSpec({
        title: 'Recherche Globale',
        problem: 'Pas d outil de recherche',
        proposedSolution: 'Composant client',
        affectedModules: ['src/components/search']
      });
      assert.ok(spec.scope.length > 0);
      assert.ok(spec.outOfScope.length > 0);
      assert.ok(spec.successCriteria.length > 0);
    });

    it('6.3 doit générer un candidat complet doté d un hash déterministe', () => {
      const candidate = candGen.generateCandidate({
        rawGap: {
          id: 'gap-test',
          title: 'Export JSON',
          description: 'Export de données',
          category: 'FUNCTIONAL_GAP',
          problem: 'Pas d export',
          proposedSolution: 'Téléchargement JSON',
          affectedModules: ['src/services'],
          dependencies: [],
          initialEvidence: [
            { id: 'e1', source: 'application', description: 'Application sans export', confidence: 0.8, references: [{ sourceId: '1', detail: 'test' }] }
          ]
        }
      });
      assert.ok(candidate);
      assert.ok(candidate.candidateHash.startsWith('fop:'));
      assert.equal(candidate.status, 'CANDIDATE');
    });
  });

  // --- 7. Impact, Dependencies & Blast Radius ---

  describe('7. Impact, Dependencies & Blast Radius Analysis', () => {
    const impactAnalyzer = new FeatureImpactAnalyzer();
    const blastAnalyzer = new BlastRadiusAnalyzer();

    it('7.1 doit calculer un blast radius proportionnel aux modules et fichiers touchés', () => {
      const low = blastAnalyzer.computeBlastRadius({ affectedModulesCount: 1, affectedFilesCount: 1, touchesCoreOrAuth: false });
      const high = blastAnalyzer.computeBlastRadius({ affectedModulesCount: 5, affectedFilesCount: 8, touchesCoreOrAuth: true });
      assert.ok(high.blastRadiusScore > low.blastRadiusScore);
      assert.equal(low.estimatedComplexity, 'LOW');
      assert.equal(high.estimatedComplexity, 'VERY_HIGH');
    });

    it('7.2 doit analyser l impact global et marquer les modules affectés', () => {
      const impact = impactAnalyzer.analyzeImpact({
        affectedModules: ['src/views', 'src/components'],
        title: 'Recherche Vue'
      });
      assert.equal(impact.isBreaking, false);
      assert.ok(impact.dependencies.includes('src/styles'));
    });
  });

  // --- 8. Scoring Engine & Determinism ---

  describe('8. Scoring Engine & Deterministic Priority', () => {
    const valueEngine = new FeatureValueEngine();
    const priorityEngine = new PriorityEngine();

    it('8.1 doit calculer les 5 composantes de valeur de manière bornée dans [0, 100]', () => {
      const vals = valueEngine.computeValueComponents({
        category: 'USER_NEED',
        impact: {
          affectedModules: [],
          affectedFiles: [],
          affectedLayers: [],
          dependencies: [],
          conflicts: [],
          risks: [],
          blastRadiusScore: 20,
          isBreaking: false,
          estimatedComplexity: 'LOW',
          estimatedEffort: 'S'
        },
        evidenceConfidence: 90,
        hasUserRequests: true,
        matchesDna: true
      });
      assert.ok(vals.businessValue >= 0 && vals.businessValue <= 100);
      assert.ok(vals.userImpact >= 0 && vals.userImpact <= 100);
      assert.ok(vals.strategicAlignment >= 0 && vals.strategicAlignment <= 100);
      assert.ok(vals.architecturalFeasibility >= 0 && vals.architecturalFeasibility <= 100);
      assert.ok(vals.riskMinimization >= 0 && vals.riskMinimization <= 100);
    });

    it('8.2 doit calculer un Priority Score strictement compris dans [0, 100] avec pénalités', () => {
      const scores = priorityEngine.computePriorityScore({
        businessValue: 90,
        evidenceConfidence: 85,
        userImpact: 90,
        strategicAlignment: 80,
        architecturalFeasibility: 95,
        riskMinimization: 85,
        penalties: 10
      });
      assert.ok(scores.priorityScore >= 0 && scores.priorityScore <= 100);
      assert.ok(scores.priorityScore >= 70 && scores.priorityScore <= 85);
    });

    it('8.3 doit borner à 0 en cas de pénalités écrasantes', () => {
      const scores = priorityEngine.computePriorityScore({
        businessValue: 20,
        evidenceConfidence: 20,
        userImpact: 20,
        strategicAlignment: 20,
        architecturalFeasibility: 20,
        riskMinimization: 20,
        penalties: 100
      });
      assert.equal(scores.priorityScore, 0);
    });
  });

  // --- 9. Opportunity Ranking & Comparators ---

  describe('9. Opportunity Ranking & Stability', () => {
    const ranking = new OpportunityRanking();

    it('9.1 doit ordonner de manière strictement stable les opportunités par priorité décroissante', () => {
      const candA = { id: 'a', scores: { priorityScore: 80, evidenceConfidence: 90, businessValue: 80 } } as any;
      const candB = { id: 'b', scores: { priorityScore: 95, evidenceConfidence: 85, businessValue: 90 } } as any;
      const candC = { id: 'c', scores: { priorityScore: 80, evidenceConfidence: 95, businessValue: 80 } } as any;

      const sorted = ranking.rankOpportunities([candA, candB, candC]);
      assert.equal(sorted[0]!.id, 'b'); // Score 95
      assert.equal(sorted[1]!.id, 'c'); // Score 80, confidence 95
      assert.equal(sorted[2]!.id, 'a'); // Score 80, confidence 90
    });
  });

  // --- 10. Feature Graph & Topological Sort ---

  describe('10. Feature Graph & Dependency Resolution', () => {
    const graphBuilder = new FeatureGraphBuilder();

    it('10.1 doit construire les arêtes et identifier les briques fondatrices', () => {
      const candidates: FeatureCandidate[] = [
        {
          id: 'gap-activity-audit',
          title: 'Journal d Activité',
          category: 'ARCHITECTURE',
          status: 'CANDIDATE',
          scores: { priorityScore: 80 }
        } as any,
        {
          id: 'conv-opp-analytics-dashboard',
          title: 'Dashboard Analytique',
          category: 'USER_NEED',
          status: 'CANDIDATE',
          scores: { priorityScore: 90 }
        } as any
      ];

      const graph = graphBuilder.buildGraph(candidates);
      assert.equal(graph.edges.length, 1);
      assert.equal(graph.edges[0]!.kind, 'DEPENDS_ON');
      assert.equal(graph.edges[0]!.fromFeatureId, 'gap-activity-audit');
      assert.equal(graph.edges[0]!.toFeatureId, 'conv-opp-analytics-dashboard');
      assert.ok(graph.foundationalFeatureIds.includes('gap-activity-audit'));
      assert.equal(graph.hasCycles, false);
      assert.deepEqual(graph.topologicalOrder, ['gap-activity-audit', 'conv-opp-analytics-dashboard']);
    });
  });

  // --- 11. Lifecycle State Machine ---

  describe('11. Lifecycle State Machine & History Tracking', () => {
    const stateMachine = new FeatureStateMachine();
    const lifecycle = new FeatureLifecycle();

    it('11.1 doit autoriser les transitions légales', () => {
      assert.equal(stateMachine.canTransition('DETECTED', 'VALIDATING'), true);
      assert.equal(stateMachine.canTransition('CANDIDATE', 'PROPOSED'), true);
      assert.equal(stateMachine.canTransition('PROPOSED', 'USER_REVIEW'), true);
      assert.equal(stateMachine.canTransition('USER_REVIEW', 'ACCEPTED'), true);
      assert.equal(stateMachine.canTransition('ACCEPTED', 'PLANNED'), true);
      assert.equal(stateMachine.canTransition('PLANNED', 'IMPLEMENTED'), true);
    });

    it('11.2 doit rejeter impitoyablement les transitions illégales', () => {
      assert.equal(stateMachine.canTransition('DETECTED', 'IMPLEMENTED'), false);
      assert.equal(stateMachine.canTransition('REJECTED', 'ACCEPTED'), false);
    });

    it('11.3 doit appliquer la transition et consigner l historique', () => {
      const initialCandidate: FeatureCandidate = {
        id: 'c-1',
        title: 'Test',
        status: 'USER_REVIEW',
        history: []
      } as any;

      const updated = lifecycle.transition(initialCandidate, 'ACCEPTED', 'Approuvé par l utilisateur', 'admin-1');
      assert.equal(updated.status, 'ACCEPTED');
      assert.equal(updated.history.length, 1);
      assert.equal(updated.history[0]!.fromStatus, 'USER_REVIEW');
      assert.equal(updated.history[0]!.toStatus, 'ACCEPTED');
      assert.equal(updated.history[0]!.userId, 'admin-1');
    });

    it('11.4 doit lever une exception en cas de transition illégale via lifecycle', () => {
      const initialCandidate: FeatureCandidate = {
        id: 'c-1',
        title: 'Test',
        status: 'DETECTED',
        history: []
      } as any;

      assert.throws(() => {
        lifecycle.transition(initialCandidate, 'IMPLEMENTED');
      });
    });
  });

  // --- 12. Deterministic Hash & Cache ---

  describe('12. Deterministic Hash & LRU Cache', () => {
    it('12.1 doit produire des hashs identiques pour des entrées identiques', () => {
      const h1 = computeFeatureCandidateHash({
        id: 'c-1',
        title: 'Recherche Globale',
        category: 'FUNCTIONAL_GAP',
        problem: 'Pas de recherche',
        proposedSolution: 'Composant',
        priorityScore: 85
      });
      const h2 = computeFeatureCandidateHash({
        id: 'c-1',
        title: 'Recherche Globale',
        category: 'FUNCTIONAL_GAP',
        problem: 'Pas de recherche',
        proposedSolution: 'Composant',
        priorityScore: 85
      });
      assert.equal(h1, h2);
      assert.ok(h1.startsWith('fop:'));
    });

    it('12.2 doit gérer la capacité et l éviction LRU', () => {
      const cache = new FeatureIntelligenceLruCache(2);
      cache.set('k1', { reportId: 'r1' } as any);
      cache.set('k2', { reportId: 'r2' } as any);
      assert.ok(cache.has('k1'));
      assert.ok(cache.has('k2'));

      cache.set('k3', { reportId: 'r3' } as any); // Evicts k1
      assert.equal(cache.has('k1'), false);
      assert.equal(cache.has('k2'), true);
      assert.equal(cache.has('k3'), true);

      const metrics = cache.getMetrics();
      assert.equal(metrics.evictions, 1);
      assert.equal(metrics.size, 2);
    });
  });

  // --- 13. Audit Bridge (AINT-013) ---

  describe('13. Audit Bridge (AINT-013 Integration)', () => {
    const auditBridge = new FeatureAuditBridge();

    it('13.1 doit extraire une opportunité d accessibilité lorsque l audit révèle des faiblesses', () => {
      const opps = auditBridge.extractOpportunitiesFromAudit(MOCK_AUDIT_REPORT);
      const a11yOpp = opps.find((o) => o.id === 'audit-opp-a11y-theme');
      assert.ok(a11yOpp);
      assert.equal(a11yOpp.category, 'UX_IMPROVEMENT');
      assert.ok(a11yOpp.initialEvidence.length >= 2);
      assert.equal(a11yOpp.initialEvidence[0]!.source, 'audit');
    });

    it('13.2 doit extraire une opportunité de navigation responsive si anomalies UX', () => {
      const opps = auditBridge.extractOpportunitiesFromAudit(MOCK_AUDIT_REPORT);
      const uxOpp = opps.find((o) => o.id === 'audit-opp-responsive-nav');
      assert.ok(uxOpp);
    });
  });

  // --- 14. Conversation Bridge (AINT-009) ---

  describe('14. Conversation Bridge (AINT-009 Integration)', () => {
    const convBridge = new FeatureConversationBridge();

    it('14.1 doit détecter une opportunité d analytics quand répétée dans les conversations', () => {
      const opps = convBridge.extractOpportunitiesFromConversation(MOCK_CONVERSATIONS);
      const analyticsOpp = opps.find((o) => o.id === 'conv-opp-analytics-dashboard');
      assert.ok(analyticsOpp);
      assert.equal(analyticsOpp.category, 'USER_NEED');
      assert.ok(analyticsOpp.initialEvidence[0]!.confidence >= 0.85);
    });

    it('14.2 doit formater une synthèse claire en français pour le dialogue utilisateur', () => {
      const candidate: FeatureCandidate = {
        id: 'c-test',
        title: 'Recherche Rapide',
        specification: { problem: 'Pas de recherche', proposedSolution: 'Composant Kbd', scope: [], outOfScope: [], successCriteria: [], alternatives: [] },
        evidence: [{ id: 'e1', source: 'conversation', description: 'Demandé 3 fois', confidence: 0.9, references: [] }],
        impact: { blastRadiusScore: 20, estimatedComplexity: 'LOW', estimatedEffort: 'S', risks: [] },
        scores: { priorityScore: 88, evidenceConfidence: 92, businessValue: 85 }
      } as any;

      const explanation = convBridge.explainOpportunity(candidate);
      assert.ok(explanation.includes('Opportunité : Recherche Rapide'));
      assert.ok(explanation.includes('88/100'));
      assert.ok(explanation.includes('Preuves formelles constatées'));
    });
  });

  // --- 15. Orchestrator Bridge (AINT-010) ---

  describe('15. Orchestrator Bridge (AINT-010 Integration)', () => {
    const orchBridge = new FeatureOrchestratorBridge();

    it('15.1 doit convertir un candidat accepté en plan d ingénierie avec DAG acyclique', () => {
      const candidate: FeatureCandidate = {
        id: 'feat-export',
        title: 'Export Multi-Formats',
        category: 'FUNCTIONAL_GAP',
        status: 'ACCEPTED',
        specification: {
          problem: 'Pas d export',
          proposedSolution: 'Service d export Blob',
          scope: [],
          outOfScope: [],
          successCriteria: ['Fichier CSV généré'],
          alternatives: []
        },
        impact: {
          affectedModules: ['src/services/export'],
          affectedFiles: ['src/services/export.ts'],
          blastRadiusScore: 25,
          estimatedComplexity: 'LOW',
          estimatedEffort: 'S',
          risks: []
        },
        scores: { priorityScore: 85 }
      } as any;

      const plan = orchBridge.createEngineeringPlan(candidate);
      assert.ok(plan);
      assert.equal(plan.featureId, 'feat-export');
      assert.equal(plan.taskGraph.tasks.length, 3);
      assert.equal(plan.taskGraph.isAcyclic, true);
      assert.ok(plan.taskGraph.graphHash.startsWith('etg:'));
      assert.equal(plan.taskGraph.tasks[0]!.domain, 'ARCHITECTURE');
      assert.equal(plan.taskGraph.tasks[1]!.domain, 'BACKEND');
      assert.equal(plan.taskGraph.tasks[2]!.domain, 'TEST');
    });
  });

  // --- 16. Master Facade Service & RBAC / Multi-Tenancy ---

  describe('16. Master Facade Service & Security / Tenancy', () => {
    const service = new FeatureIntelligenceService();

    it('16.1 doit découvrir des opportunités de bout en bout pour un projet', async () => {
      const req: FeatureDiscoveryRequest = {
        tenantId: 'tenant-alpha',
        projectId: 'proj-alpha',
        files: MOCK_FILES,
        dna: MOCK_DNA,
        auditReport: MOCK_AUDIT_REPORT,
        conversationHistory: MOCK_CONVERSATIONS
      };

      const report = await service.discoverOpportunities(req, 'ENGINEER');
      assert.ok(report);
      assert.equal(report.tenantId, 'tenant-alpha');
      assert.equal(report.projectId, 'proj-alpha');
      assert.ok(report.opportunities.length > 0);
      assert.ok(report.summary.avgPriorityScore > 0);
      assert.ok(report.featureGraph.nodes.length > 0);
      assert.ok(report.reportHash.startsWith('fir:'));
    });

    it('16.2 doit réutiliser le cache lors de deux appels avec les mêmes paramètres', async () => {
      const req: FeatureDiscoveryRequest = {
        tenantId: 'tenant-alpha',
        projectId: 'proj-alpha',
        files: MOCK_FILES,
        dna: MOCK_DNA
      };

      const rep1 = await service.discoverOpportunities(req, 'ENGINEER');
      const rep2 = await service.discoverOpportunities(req, 'ENGINEER');
      assert.equal(rep1.reportId, rep2.reportId);
    });

    it('16.3 doit isoler hermétiquement les tenants (Tenant A != Tenant B)', async () => {
      const repA = await service.discoverOpportunities({
        tenantId: 'tenant-a',
        projectId: 'proj-shared',
        files: MOCK_FILES
      }, 'ENGINEER');

      const repB = await service.discoverOpportunities({
        tenantId: 'tenant-b',
        projectId: 'proj-shared',
        files: MOCK_FILES
      }, 'ENGINEER');

      assert.notEqual(repA.tenantId, repB.tenantId);
      assert.notEqual(repA.reportId, repB.reportId);
    });

    it('16.4 doit respecter RBAC : VIEWER peut lire mais ne peut pas muter de statut', async () => {
      const req: FeatureDiscoveryRequest = {
        tenantId: 'tenant-rbac',
        projectId: 'proj-rbac',
        files: MOCK_FILES
      };

      const report = await service.discoverOpportunities(req, 'VIEWER');
      assert.ok(report);

      // VIEWER tente de changer le statut d'une opportunité
      const firstOpp = report.opportunities[0]!;
      await assert.rejects(async () => {
        await service.transitionOpportunityStatus({
          tenantId: 'tenant-rbac',
          projectId: 'proj-rbac',
          featureId: firstOpp.id,
          newStatus: 'PROPOSED',
          userRole: 'VIEWER'
        });
      }, ForbiddenError);
    });

    it('16.5 doit permettre à un ENGINEER de faire évoluer le statut d une opportunité', async () => {
      const req: FeatureDiscoveryRequest = {
        tenantId: 'tenant-eng',
        projectId: 'proj-eng',
        files: MOCK_FILES
      };

      const report = await service.discoverOpportunities(req, 'ENGINEER');
      const opp = report.opportunities[0]!;

      const updated = await service.transitionOpportunityStatus({
        tenantId: 'tenant-eng',
        projectId: 'proj-eng',
        featureId: opp.id,
        newStatus: 'PROPOSED',
        userRole: 'ENGINEER'
      });

      assert.equal(updated.status, 'PROPOSED');
      assert.equal(updated.history.length, 2);
    });

    it('16.6 doit lever NotFoundError si projet ou opportunité inconnus', async () => {
      await assert.rejects(async () => {
        await service.transitionOpportunityStatus({
          tenantId: 'tenant-unknown',
          projectId: 'proj-unknown',
          featureId: 'opp-unknown',
          newStatus: 'ACCEPTED',
          userRole: 'ADMIN'
        });
      }, NotFoundError);
    });
  });

});
