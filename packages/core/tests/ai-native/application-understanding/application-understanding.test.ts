import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
  ApplicationUnderstandingService,
  DEFAULT_UNDERSTANDING_CONFIG,
  UnderstandingLruCache,
  calculateConfidence,
  determineCertainty,
  isSensitivePath,
  maskSensitiveDetail,
  createUnderstandingEvidence,
  discoverFeatures,
  discoverDomains,
  discoverWorkflows,
  discoverUserJourneys,
  discoverDataFlows,
  discoverBusinessRules,
  assembleSemanticModel,
  runUnderstandingAnalysis,
  computeUnderstandingHash,
  compareFeatures,
  compareDomains,
  compareWorkflows,
  compareJourneys,
  compareDataFlows,
  compareBusinessRules,
  selectFeatures,
  selectDomains,
  selectWorkflows,
  selectJourneys,
  selectBusinessRules,
  selectDataFlows,
  selectComponentsForFeature,
  selectFilesForFeature,
  selectDependenciesForFeature,
  selectEntryPointsForFeature,
  selectCapabilities,
  executeSemanticQuery,
  type ApplicationSemanticModel,
  type SemanticCodeGraph,
  type SemanticNode,
  type SemanticEdge,
  type ApplicationDNA,
  ValidationError,
  ForbiddenError
} from '../../../src/index.js';

function computeSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function buildSyntheticGraph(nodes: SemanticNode[], edges: SemanticEdge[]): SemanticCodeGraph {
  const nodeById: Record<string, string> = {};
  const nodesByKind: Record<string, string[]> = {};
  const nodesByFile: Record<string, string[]> = {};
  const outgoing: Record<string, string[]> = {};
  const incoming: Record<string, string[]> = {};

  for (const n of nodes) {
    nodeById[n.id] = n.id;
    const kindArr = nodesByKind[n.kind] || [];
    kindArr.push(n.id);
    nodesByKind[n.kind] = kindArr;
    if (n.filePath) {
      const fileArr = nodesByFile[n.filePath] || [];
      fileArr.push(n.id);
      nodesByFile[n.filePath] = fileArr;
    }
    outgoing[n.id] = [];
    incoming[n.id] = [];
  }

  for (const e of edges) {
    if (outgoing[e.sourceId]) outgoing[e.sourceId]!.push(e.id);
    if (incoming[e.targetId]) incoming[e.targetId]!.push(e.id);
  }

  const nodesHash = computeSha256(JSON.stringify(nodes.map(n => n.id)));
  const edgesHash = computeSha256(JSON.stringify(edges.map(e => e.id)));
  const graphHash = computeSha256(`${nodesHash}:${edgesHash}`);

  return {
    schemaVersion: '1.0.0',
    assemblerVersion: '1.0.0',
    tenantId: 'tenant-test',
    projectId: 'proj-test',
    treeHash: 'tree-hash-1234',
    graphHash,
    createdAt: new Date().toISOString(),
    durationMs: 15,
    nodes,
    edges,
    indexes: {
      nodeById,
      nodesByKind: nodesByKind as any,
      nodesByFile,
      outgoingEdgesByNode: outgoing,
      incomingEdgesByNode: incoming
    },
    metrics: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesByKind: {},
      edgesByKind: {},
      isolatedNodeCount: 0,
      maxOutDegree: 2,
      maxInDegree: 2,
      fileNodeCount: nodes.filter(n => n.kind === 'FILE').length,
      symbolNodeCount: nodes.filter(n => n.kind === 'SYMBOL').length,
      moduleNodeCount: 0,
      layerNodeCount: 0,
      routeNodeCount: nodes.filter(n => n.kind === 'ROUTE').length,
      componentNodeCount: nodes.filter(n => n.kind === 'COMPONENT').length,
      importEdgeCount: edges.filter(e => e.kind === 'IMPORTS').length,
      referenceEdgeCount: edges.filter(e => e.kind === 'REFERENCES').length,
      compositionEdgeCount: 0,
      moduleMembershipCount: 0,
      layerMembershipCount: 0
    }
  };
}

function buildSyntheticDNA(): ApplicationDNA {
  return {
    schemaVersion: '1.0.0',
    analyzerVersion: '1.0.0',
    tenantId: 'tenant-test',
    projectId: 'proj-test',
    treeHash: 'tree-hash-1234',
    dnaHash: 'dna-hash-5678',
    extractedAt: new Date().toISOString(),
    durationMs: 25,
    stack: {
      language: { name: 'TypeScript', category: 'language', confidence: 'CONFIRMED', evidence: [] },
      framework: { name: 'Express', category: 'framework', confidence: 'CONFIRMED', evidence: [] },
      runtime: { name: 'Node.js', category: 'runtime', confidence: 'CONFIRMED', evidence: [] },
      uiLibrary: { name: 'React', category: 'ui', confidence: 'CONFIRMED', evidence: [] },
      databaseOrOrm: { name: 'PostgreSQL', category: 'database', confidence: 'CONFIRMED', evidence: [] },
      additionalTechnologies: [
        { name: 'TailwindCSS', category: 'styling', confidence: 'CONFIRMED', evidence: [] },
        { name: 'Stripe', category: 'other', confidence: 'CONFIRMED', evidence: [] }
      ]
    },
    architecture: {
      primaryPattern: { pattern: 'LAYERED_ARCHITECTURE', confidence: 'CONFIRMED', evidence: [] },
      entryPoints: [
        { path: 'src/index.ts', role: 'server_entry', confidence: 'CONFIRMED' },
        { path: 'src/client.tsx', role: 'client_entry', confidence: 'CONFIRMED' }
      ],
      layers: [
        { name: 'UI', kind: 'frontend', filePaths: ['src/components/LoginForm.tsx'], dependenciesOnLayers: ['API'], confidence: 'CONFIRMED' },
        { name: 'API', kind: 'backend', filePaths: ['src/routes/auth.ts'], dependenciesOnLayers: [], confidence: 'CONFIRMED' }
      ],
      routesCount: 3,
      componentsCount: 3
    },
    components: [
      { name: 'LoginForm', filePath: 'src/components/LoginForm.tsx', classification: 'COMPONENT_CONFIRMED', propsCount: 3, hooksUsed: ['useState'], lineStart: 1, lineEnd: 40 },
      { name: 'PaymentModal', filePath: 'src/components/PaymentModal.tsx', classification: 'COMPONENT_CONFIRMED', propsCount: 4, hooksUsed: ['useState', 'useStripe'], lineStart: 1, lineEnd: 60 },
      { name: 'DashboardCard', filePath: 'src/components/DashboardCard.tsx', classification: 'COMPONENT_CONFIRMED', propsCount: 2, hooksUsed: [], lineStart: 1, lineEnd: 30 }
    ],
    modules: [
      { name: 'AuthModule', rootPath: 'src/auth', files: ['src/auth/service.ts'], publicExports: ['AuthService'], externalDependencies: [] },
      { name: 'BillingModule', rootPath: 'src/billing', files: ['src/billing/stripe.ts'], publicExports: ['PaymentService'], externalDependencies: ['stripe'] }
    ],
    graphMetrics: {
      nodeCount: 10,
      edgeCount: 12,
      directDependencies: {},
      reverseDependencies: {},
      topologicalOrder: [],
      circularDependencies: [],
      isolatedFiles: [],
      mostDependedOnFiles: []
    },
    summary: {
      totalFiles: 10,
      analyzedFiles: 10,
      diagnosticsCount: 0,
      overallHealth: 'HEALTHY',
      primaryLanguage: 'TypeScript',
      primaryFramework: 'Express'
    }
  };
}

describe('AINT-008: Application Understanding & Semantic Reasoning Engine', () => {

  // Sample data set
  const sampleNodes: SemanticNode[] = [
    { id: 'node_ep_main', kind: 'ENTRY_POINT', name: 'src/index.ts', filePath: 'src/index.ts', metadata: {}, evidence: [] },
    { id: 'node_route_login', kind: 'ROUTE', name: '/api/auth/login', filePath: 'src/routes/auth.ts', lineStart: 10, lineEnd: 30, metadata: {}, evidence: [] },
    { id: 'node_route_pay', kind: 'ROUTE', name: '/api/checkout/pay', filePath: 'src/routes/checkout.ts', lineStart: 15, lineEnd: 45, metadata: {}, evidence: [] },
    { id: 'node_route_dash', kind: 'ROUTE', name: '/api/dashboard/stats', filePath: 'src/routes/dashboard.ts', lineStart: 5, lineEnd: 25, metadata: {}, evidence: [] },
    { id: 'node_comp_login', kind: 'COMPONENT', name: 'LoginForm', filePath: 'src/components/LoginForm.tsx', lineStart: 1, lineEnd: 50, metadata: {}, evidence: [] },
    { id: 'node_comp_pay', kind: 'COMPONENT', name: 'PaymentModal', filePath: 'src/components/PaymentModal.tsx', lineStart: 1, lineEnd: 70, metadata: {}, evidence: [] },
    { id: 'node_comp_dash', kind: 'COMPONENT', name: 'DashboardCard', filePath: 'src/components/DashboardCard.tsx', lineStart: 1, lineEnd: 35, metadata: {}, evidence: [] },
    { id: 'node_srv_auth', kind: 'CLASS', name: 'AuthService', filePath: 'src/services/AuthService.ts', lineStart: 1, lineEnd: 80, metadata: {}, evidence: [] },
    { id: 'node_srv_pay', kind: 'CLASS', name: 'PaymentService', filePath: 'src/services/PaymentService.ts', lineStart: 1, lineEnd: 90, metadata: {}, evidence: [] },
    { id: 'node_fn_perm', kind: 'FUNCTION', name: 'assertPermission', filePath: 'src/security/permissions.ts', lineStart: 5, lineEnd: 20, metadata: {}, evidence: [] },
    { id: 'node_fn_val', kind: 'FUNCTION', name: 'validatePaymentSchema', filePath: 'src/validation/payment.ts', lineStart: 10, lineEnd: 30, metadata: {}, evidence: [] },
    { id: 'node_fn_state', kind: 'FUNCTION', name: 'transitionOrderStatus', filePath: 'src/orders/stateMachine.ts', lineStart: 12, lineEnd: 40, metadata: {}, evidence: [] }
  ];

  const sampleEdges: SemanticEdge[] = [
    { id: 'e1', kind: 'ROUTES_TO', sourceId: 'node_route_login', targetId: 'node_srv_auth', evidence: [], metadata: {} },
    { id: 'e2', kind: 'IMPORTS', sourceId: 'node_comp_login', targetId: 'node_route_login', evidence: [], metadata: {} },
    { id: 'e3', kind: 'ROUTES_TO', sourceId: 'node_route_pay', targetId: 'node_srv_pay', evidence: [], metadata: {} },
    { id: 'e4', kind: 'REFERENCES', sourceId: 'node_srv_pay', targetId: 'node_fn_val', evidence: [], metadata: {} },
    { id: 'e5', kind: 'REFERENCES', sourceId: 'node_srv_auth', targetId: 'node_fn_perm', evidence: [], metadata: {} },
    { id: 'e6', kind: 'DEPENDS_ON', sourceId: 'node_srv_pay', targetId: 'node_fn_state', evidence: [], metadata: {} }
  ];

  const syntheticGraph = buildSyntheticGraph(sampleNodes, sampleEdges);
  const syntheticDNA = buildSyntheticDNA();

  // =========================================================================
  // Section A: Semantic Model Tests
  // =========================================================================
  describe('A — Semantic Model Construction & Invariants', () => {
    it('1. Doit construire un modèle sémantique complet avec schemaVersion 1.0.0', () => {
      const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      assert.strictEqual(model.schemaVersion, '1.0.0');
      assert.strictEqual(model.tenantId, 'tenant-test');
      assert.strictEqual(model.projectId, 'proj-test');
      assert.ok(model.understandingHash.length === 64, 'Hash SHA-256 de 64 caractères attendu');
    });

    it('2. Doit contenir toutes les sections obligatoires sans exception', () => {
      const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      assert.ok(Array.isArray(model.domains), 'domains array required');
      assert.ok(Array.isArray(model.features), 'features array required');
      assert.ok(Array.isArray(model.workflows), 'workflows array required');
      assert.ok(Array.isArray(model.userJourneys), 'userJourneys array required');
      assert.ok(Array.isArray(model.dataFlows), 'dataFlows array required');
      assert.ok(Array.isArray(model.businessRules), 'businessRules array required');
      assert.ok(Array.isArray(model.components), 'components array required');
      assert.ok(Array.isArray(model.services), 'services array required');
      assert.ok(Array.isArray(model.apis), 'apis array required');
      assert.ok(Array.isArray(model.entryPoints), 'entryPoints array required');
      assert.ok(Array.isArray(model.boundaries), 'boundaries array required');
      assert.ok(model.capabilities !== undefined, 'capabilities required');
      assert.ok(model.summary !== undefined, 'summary required');
      assert.ok(model.metrics !== undefined, 'metrics required');
    });

    it('3. Invariant d intégrité : les totaux du summary doivent correspondre exactement aux longueurs des collections', () => {
      const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      assert.strictEqual(model.summary.totalDomains, model.domains.length);
      assert.strictEqual(model.summary.totalFeatures, model.features.length);
      assert.strictEqual(model.summary.totalWorkflows, model.workflows.length);
      assert.strictEqual(model.summary.totalJourneys, model.userJourneys.length);
      assert.strictEqual(model.summary.totalBusinessRules, model.businessRules.length);
      assert.strictEqual(model.summary.totalDataFlows, model.dataFlows.length);
    });

    it('4. Les métriques doivent fidèlement dénombrer les niveaux de certitude', () => {
      const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      const totalCertainty = model.metrics.observedCount + model.metrics.inferredCount + model.metrics.hypothesizedCount;
      const expectedTotal = model.domains.length + model.features.length + model.workflows.length +
        model.userJourneys.length + model.dataFlows.length + model.businessRules.length;
      assert.strictEqual(totalCertainty, expectedTotal);
    });

    it('5. Les métadonnées temporelles doivent être cohérentes (createdAt ISO, durationMs >= 0)', () => {
      const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      assert.ok(!isNaN(Date.parse(model.createdAt)), 'createdAt doit être une date ISO valide');
      assert.ok(model.durationMs >= 0, 'durationMs doit être positif');
    });
  });

  // =========================================================================
  // Section B: Feature Discovery Tests
  // =========================================================================
  describe('B — Feature Discovery', () => {
    it('6. Doit découvrir les fonctionnalités basées sur les routes, composants et symboles', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const ids = features.map(f => f.featureId);
      assert.ok(ids.includes('feat_authentication'), 'Doit détecter feat_authentication');
      assert.ok(ids.includes('feat_payments_billing'), 'Doit détecter feat_payments_billing');
      assert.ok(ids.includes('feat_dashboard_analytics'), 'Doit détecter feat_dashboard_analytics');
    });

    it('7. Doit dédupliquer et trier canoniquement les fonctionnalités par featureId', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const ids = features.map(f => f.featureId);
      const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(ids, sortedIds, 'Les features doivent être triées canoniquement');
      const uniqueIds = new Set(ids);
      assert.strictEqual(ids.length, uniqueIds.size, 'Aucune feature en double');
    });

    it('8. Règle No Evidence -> No Claim : un graphe sans nœuds pertinents ne génère aucune feature', () => {
      const emptyGraph = buildSyntheticGraph([], []);
      const features = discoverFeatures(emptyGraph);
      assert.strictEqual(features.length, 0, 'Aucune feature sans preuve');
    });

    it('9. Une feature doit regrouper ses composants, routes et services associés', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const auth = features.find(f => f.featureId === 'feat_authentication');
      assert.ok(auth !== undefined);
      assert.ok(auth.components.includes('LoginForm'), 'LoginForm doit être rattaché');
      assert.ok(auth.routes.includes('/api/auth/login'), 'Route /api/auth/login rattachée');
      assert.ok(auth.services.includes('AuthService'), 'AuthService rattaché');
    });

    it('10. Doit tracer les dépendances inter-features à partir des edges du graphe', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const billing = features.find(f => f.featureId === 'feat_payments_billing');
      assert.ok(billing !== undefined);
      assert.ok(billing.dependencies.includes('validatePaymentSchema') || billing.dependencies.length > 0);
    });
  });

  // =========================================================================
  // Section C: Domain Discovery Tests
  // =========================================================================
  describe('C — Domain Discovery', () => {
    it('11. Doit regrouper les features dans les domaines sémantiques correspondants', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const domains = discoverDomains(features);
      const domainIds = domains.map(d => d.domainId);
      assert.ok(domainIds.includes('dom_authentication'));
      assert.ok(domainIds.includes('dom_billing'));
      assert.ok(domainIds.includes('dom_analytics'));
    });

    it('12. Doit trier canoniquement les domaines par domainId', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const domains = discoverDomains(features);
      const domainIds = domains.map(d => d.domainId);
      const sortedIds = [...domainIds].sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(domainIds, sortedIds);
    });

    it('13. Doit agréger l ensemble des fichiers concernés par toutes les features du domaine', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const domains = discoverDomains(features);
      const authDomain = domains.find(d => d.domainId === 'dom_authentication');
      assert.ok(authDomain !== undefined);
      assert.ok(authDomain.relatedFiles.includes('src/components/LoginForm.tsx') || authDomain.relatedFiles.includes('src/routes/auth.ts'));
    });

    it('14. Doit attribuer un niveau de certitude et une confiance déterministe à chaque domaine', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const domains = discoverDomains(features);
      for (const d of domains) {
        assert.ok(['OBSERVED', 'INFERRED', 'HYPOTHESIZED'].includes(d.certainty));
        assert.ok(d.confidence >= 0.10 && d.confidence <= 0.98);
      }
    });
  });

  // =========================================================================
  // Section D: Workflow Discovery Tests
  // =========================================================================
  describe('D — Workflow Discovery', () => {
    it('15. Doit découvrir les workflows applicatifs à partir des routes et points d entrée', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const workflows = discoverWorkflows(syntheticGraph, features);
      assert.ok(workflows.length >= 3, 'Au moins 3 workflows dérivés des routes');
    });

    it('16. Chaque workflow doit avoir une séquence d étapes numérotées séquentiellement', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const workflows = discoverWorkflows(syntheticGraph, features);
      for (const wf of workflows) {
        assert.ok(wf.steps.length > 0);
        wf.steps.forEach((step, idx) => {
          assert.strictEqual(step.stepIndex, idx);
          assert.ok(step.name.length > 0);
          assert.ok(['USER', 'SYSTEM'].includes(step.actor));
        });
      }
    });

    it('17. Doit identifier des points de défaillance (failure points) potentiels réalistes', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const workflows = discoverWorkflows(syntheticGraph, features);
      for (const wf of workflows) {
        assert.ok(wf.failurePoints.length > 0, 'Tout workflow doit avoir au moins un failurePoint identifié');
      }
    });

    it('18. Doit être trié de manière déterministe par workflowId', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const workflows = discoverWorkflows(syntheticGraph, features);
      const ids = workflows.map(w => w.workflowId);
      const sorted = [...ids].sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(ids, sorted);
    });
  });

  // =========================================================================
  // Section E: User Journey Discovery Tests
  // =========================================================================
  describe('E — User Journey Discovery', () => {
    it('19. Doit découvrir le parcours d authentification lorsque la feature auth est présente', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const journeys = discoverUserJourneys(syntheticGraph, features);
      const authJourney = journeys.find(j => j.journeyId === 'journey_user_authentication');
      assert.ok(authJourney !== undefined);
      assert.strictEqual(authJourney.actor, 'ANONYMOUS_USER');
      assert.ok(authJourney.steps.length >= 3);
    });

    it('20. Doit découvrir le parcours de commande lorsque la feature billing est présente', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const journeys = discoverUserJourneys(syntheticGraph, features);
      const payJourney = journeys.find(j => j.journeyId === 'journey_checkout_purchase');
      assert.ok(payJourney !== undefined);
      assert.strictEqual(payJourney.actor, 'CUSTOMER');
      assert.ok(payJourney.terminalStates.includes('PAYMENT_SUCCESS'));
    });

    it('21. Doit inclure un parcours d exploration principal de l application', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const journeys = discoverUserJourneys(syntheticGraph, features);
      const mainJourney = journeys.find(j => j.journeyId === 'journey_primary_exploration');
      assert.ok(mainJourney !== undefined);
      assert.ok(mainJourney.steps.length >= 2);
    });

    it('22. Les parcours utilisateurs doivent être triés canoniquement', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const journeys = discoverUserJourneys(syntheticGraph, features);
      const ids = journeys.map(j => j.journeyId);
      const sorted = [...ids].sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(ids, sorted);
    });
  });

  // =========================================================================
  // Section F: Data Flow Discovery Tests
  // =========================================================================
  describe('F — Data Flow Discovery', () => {
    it('23. Doit tracer les flux de données à partir des routes et composants formulaires', () => {
      const flows = discoverDataFlows(syntheticGraph);
      assert.ok(flows.length >= 3, 'Au moins 3 flux de données tracés');
    });

    it('24. Chaque flux de données doit identifier des sources et des destinations', () => {
      const flows = discoverDataFlows(syntheticGraph);
      for (const df of flows) {
        assert.ok(df.sources.length > 0, 'Source requise');
        assert.ok(df.destinations.length > 0, 'Destination requise');
      }
    });

    it('25. Doit identifier les étapes de passage (steps) et les risques potentiels', () => {
      const flows = discoverDataFlows(syntheticGraph);
      const payFlow = flows.find(f => f.flowId.includes('checkout') || f.flowId.includes('pay'));
      if (payFlow) {
        assert.ok(payFlow.potentialRisks.length > 0, 'Risque de sécurité ou de validation attendu');
      }
    });

    it('26. Les flux de données doivent être triés canoniquement par flowId', () => {
      const flows = discoverDataFlows(syntheticGraph);
      const ids = flows.map(f => f.flowId);
      const sorted = [...ids].sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(ids, sorted);
    });
  });

  // =========================================================================
  // Section G: Business Rule Discovery Tests
  // =========================================================================
  describe('G — Business Rule Discovery', () => {
    it('27. Doit détecter les règles d autorisation à partir des symboles permission/RBAC', () => {
      const rules = discoverBusinessRules(syntheticGraph);
      const authRules = rules.filter(r => r.type === 'AUTHORIZATION');
      assert.ok(authRules.length > 0, 'Au moins une règle d autorisation attendue');
      assert.ok(authRules.some(r => r.name.includes('assertPermission')));
    });

    it('28. Doit détecter les règles de validation à partir des symboles validate/schema', () => {
      const rules = discoverBusinessRules(syntheticGraph);
      const valRules = rules.filter(r => r.type === 'VALIDATION');
      assert.ok(valRules.length > 0, 'Au moins une règle de validation attendue');
      assert.ok(valRules.some(r => r.name.includes('validatePaymentSchema')));
    });

    it('29. Doit détecter les transitions d état et invariants de machine à états', () => {
      const rules = discoverBusinessRules(syntheticGraph);
      const stateRules = rules.filter(r => r.type === 'STATE_TRANSITION');
      assert.ok(stateRules.length > 0, 'Au moins une transition d état attendue');
      assert.ok(stateRules.some(r => r.name.includes('transitionOrderStatus')));
    });

    it('30. Chaque règle doit stipuler son emplacement, ses conditions et ses effets', () => {
      const rules = discoverBusinessRules(syntheticGraph);
      for (const r of rules) {
        assert.ok(r.location.filePath !== undefined);
        assert.ok(r.conditions.length > 0);
        assert.ok(r.effects.length > 0);
      }
    });

    it('31. Les règles métier doivent être dédupliquées et triées canoniquement', () => {
      const rules = discoverBusinessRules(syntheticGraph);
      const ids = rules.map(r => r.ruleId);
      const uniqueIds = new Set(ids);
      assert.strictEqual(ids.length, uniqueIds.size);
      const sorted = [...ids].sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(ids, sorted);
    });
  });

  // =========================================================================
  // Section H: Confidence Engine Tests
  // =========================================================================
  describe('H — Confidence Engine', () => {
    it('32. Doit calculer une confiance bornée entre 0.10 et 0.98', () => {
      const confZero = calculateConfidence([]);
      assert.ok(confZero >= 0.10 && confZero <= 0.98);

      const highEv = [
        createUnderstandingEvidence('ROUTE_DECLARATION', 'src', 'desc', { confidence: 0.95 }),
        createUnderstandingEvidence('AST_SYMBOL', 'src', 'desc', { confidence: 0.95 }),
        createUnderstandingEvidence('COMPONENT_PROFILE', 'src', 'desc', { confidence: 0.95 }),
        createUnderstandingEvidence('GRAPH_EDGE', 'src', 'desc', { confidence: 0.90 })
      ];
      const confHigh = calculateConfidence(highEv);
      assert.ok(confHigh >= 0.85 && confHigh <= 0.98);
    });

    it('33. Doit récompenser la corroboration multi-sources (bonus de variété)', () => {
      const singleSource = [
        createUnderstandingEvidence('AST_SYMBOL', 's1', 'd1'),
        createUnderstandingEvidence('AST_SYMBOL', 's2', 'd2')
      ];
      const multiSource = [
        createUnderstandingEvidence('AST_SYMBOL', 's1', 'd1'),
        createUnderstandingEvidence('ROUTE_DECLARATION', 's2', 'd2'),
        createUnderstandingEvidence('COMPONENT_PROFILE', 's3', 'd3'),
        createUnderstandingEvidence('GRAPH_EDGE', 's4', 'd4')
      ];
      const cSingle = calculateConfidence(singleSource, 0.40);
      const cMulti = calculateConfidence(multiSource, 0.40);
      assert.ok(cMulti > cSingle, 'La diversité des preuves doit donner une confiance supérieure');
    });

    it('34. determineCertainty doit catégoriser fidèlement (OBSERVED >= 0.80, INFERRED >= 0.55, HYPOTHESIZED < 0.55)', () => {
      assert.strictEqual(determineCertainty(0.85), 'OBSERVED');
      assert.strictEqual(determineCertainty(0.80), 'OBSERVED');
      assert.strictEqual(determineCertainty(0.79), 'INFERRED');
      assert.strictEqual(determineCertainty(0.55), 'INFERRED');
      assert.strictEqual(determineCertainty(0.54), 'HYPOTHESIZED');
      assert.strictEqual(determineCertainty(0.20), 'HYPOTHESIZED');
    });

    it('35. Le calcul de confiance doit être déterministe et arrondi à 4 décimales', () => {
      const ev = [createUnderstandingEvidence('AST_SYMBOL', 's1', 'd1')];
      const c1 = calculateConfidence(ev);
      const c2 = calculateConfidence(ev);
      assert.strictEqual(c1, c2);
      const decimals = c1.toString().split('.')[1]?.length ?? 0;
      assert.ok(decimals <= 4, 'Doit avoir au plus 4 décimales');
    });
  });

  // =========================================================================
  // Section I: Evidence & Provenance Tests
  // =========================================================================
  describe('I — Evidence & Provenance', () => {
    it('36. Chaque élément sémantique doit posséder des preuves non vides', () => {
      const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      for (const f of model.features) assert.ok(f.evidence.length > 0);
      for (const d of model.domains) assert.ok(d.evidence.length > 0);
      for (const w of model.workflows) assert.ok(w.evidence.length > 0);
      for (const j of model.userJourneys) assert.ok(j.evidence.length > 0);
      for (const df of model.dataFlows) assert.ok(df.evidence.length > 0);
      for (const br of model.businessRules) assert.ok(br.evidence.length > 0);
    });

    it('37. La traçabilité doit remonter aux fichiers et lignes de code sources', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      const authFeat = features.find(f => f.featureId === 'feat_authentication');
      assert.ok(authFeat !== undefined);
      const fileEvidence = authFeat.evidence.find(e => e.filePath !== undefined);
      assert.ok(fileEvidence !== undefined);
      assert.ok(fileEvidence.filePath?.includes('src/'));
    });

    it('38. Les preuves doivent être triées canoniquement par source', () => {
      const features = discoverFeatures(syntheticGraph, syntheticDNA);
      for (const f of features) {
        const sources = f.evidence.map(e => e.source);
        const sortedSources = [...sources].sort((a, b) => a.localeCompare(b));
        assert.deepStrictEqual(sources, sortedSources);
      }
    });

    it('39. Une preuve doit comporter kind, source, detail et confidence', () => {
      const ev = createUnderstandingEvidence('AST_SYMBOL', 'test_src', 'test_detail', { confidence: 0.85 });
      assert.strictEqual(ev.kind, 'AST_SYMBOL');
      assert.strictEqual(ev.source, 'test_src');
      assert.strictEqual(ev.detail, 'test_detail');
      assert.strictEqual(ev.confidence, 0.85);
    });
  });

  // =========================================================================
  // Section J: Determinism Tests
  // =========================================================================
  describe('J — Determinism', () => {
    it('40. Deux analyses identiques doivent produire des résultats strictement identiques', () => {
      const model1 = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      const model2 = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      assert.strictEqual(model1.understandingHash, model2.understandingHash);
      assert.strictEqual(model1.summary.totalFeatures, model2.summary.totalFeatures);
      assert.strictEqual(model1.summary.totalDomains, model2.summary.totalDomains);
    });

    it('41. L inversion de l ordre des nœuds dans le graphe ne doit pas modifier le hash', () => {
      const reversedGraph = {
        ...syntheticGraph,
        nodes: [...syntheticGraph.nodes].reverse(),
        edges: [...syntheticGraph.edges].reverse()
      };
      const modelA = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      const modelB = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, reversedGraph, syntheticDNA);
      assert.strictEqual(modelA.understandingHash, modelB.understandingHash);
    });

    it('42. Les comparateurs canoniques doivent garantir un ordre strict et reproductible', () => {
      const f1 = { featureId: 'feat_b', name: 'B', description: '', domainId: 'd', certainty: 'OBSERVED' as const, confidence: 0.8, relatedNodes: [], relatedFiles: [], entryPoints: [], routes: [], dataSources: [], dependencies: [], components: [], services: [], evidence: [] };
      const f2 = { featureId: 'feat_a', name: 'A', description: '', domainId: 'd', certainty: 'OBSERVED' as const, confidence: 0.8, relatedNodes: [], relatedFiles: [], entryPoints: [], routes: [], dataSources: [], dependencies: [], components: [], services: [], evidence: [] };
      const list = [f1, f2].sort(compareFeatures);
      assert.strictEqual(list[0]?.featureId, 'feat_a');
      assert.strictEqual(list[1]?.featureId, 'feat_b');
    });
  });

  // =========================================================================
  // Section K: Semantic Hashing Tests
  // =========================================================================
  describe('K — Semantic Hashing', () => {
    it('43. Le hash doit faire exactement 64 caractères hexadécimaux SHA-256', () => {
      const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      assert.strictEqual(model.understandingHash.length, 64);
      assert.match(model.understandingHash, /^[a-f0-9]{64}$/);
    });

    it('44. Les métadonnées volatiles (createdAt, durationMs) ne doivent pas influencer le hash', () => {
      const payloadA = {
        tenantId: 't1',
        projectId: 'p1',
        createdAt: '2026-01-01T00:00:00.000Z',
        durationMs: 10,
        understandingHash: 'ignored',
        data: 'stable'
      };
      const payloadB = {
        tenantId: 't1',
        projectId: 'p1',
        createdAt: '2026-12-31T23:59:59.999Z',
        durationMs: 9999,
        understandingHash: 'ignored_different',
        data: 'stable'
      };
      const hashA = computeUnderstandingHash(payloadA);
      const hashB = computeUnderstandingHash(payloadB);
      assert.strictEqual(hashA, hashB);
    });

    it('45. Deux projets différents doivent produire des hashs différents', () => {
      const model1 = runUnderstandingAnalysis({ tenantId: 'tenant-1', projectId: 'proj-1' }, syntheticGraph, syntheticDNA);
      const model2 = runUnderstandingAnalysis({ tenantId: 'tenant-2', projectId: 'proj-2' }, syntheticGraph, syntheticDNA);
      assert.notStrictEqual(model1.understandingHash, model2.understandingHash);
    });
  });

  // =========================================================================
  // Section L: Immutability Tests
  // =========================================================================
  describe('L — Immutability (deepFreeze)', () => {
    it('46. Le modèle racine retourné doit être gelé (Object.isFrozen)', () => {
      const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      assert.strictEqual(Object.isFrozen(model), true);
    });

    it('47. Les collections internes doivent être profondément immuables', () => {
      const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      assert.strictEqual(Object.isFrozen(model.features), true);
      assert.strictEqual(Object.isFrozen(model.domains), true);
      assert.strictEqual(Object.isFrozen(model.workflows), true);
      if (model.features.length > 0 && model.features[0]) {
        assert.strictEqual(Object.isFrozen(model.features[0]), true);
        assert.strictEqual(Object.isFrozen(model.features[0].relatedFiles), true);
      }
    });

    it('48. Toute tentative de mutation directe doit lever une exception en mode strict', () => {
      const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);
      assert.throws(() => {
        (model as any).newProp = 'illegal';
      }, TypeError);
      assert.throws(() => {
        (model.features as any).push('illegal');
      }, TypeError);
    });
  });

  // =========================================================================
  // Section M: Security & Secret Sanitization Tests
  // =========================================================================
  describe('M — Security & Secret Masking', () => {
    it('49. isSensitivePath doit identifier tous les fichiers sensibles (.env, .key, .pem, id_rsa)', () => {
      assert.strictEqual(isSensitivePath('.env'), true);
      assert.strictEqual(isSensitivePath('.env.production'), true);
      assert.strictEqual(isSensitivePath('certs/private.key'), true);
      assert.strictEqual(isSensitivePath('ssl/server.pem'), true);
      assert.strictEqual(isSensitivePath('~/.ssh/id_rsa'), true);
      assert.strictEqual(isSensitivePath('config/credentials.json'), true);
      assert.strictEqual(isSensitivePath('src/components/LoginForm.tsx'), false);
    });

    it('50. Les preuves issues de fichiers sensibles doivent être masquées ([REDACTED])', () => {
      const ev = createUnderstandingEvidence('AST_SYMBOL', 'secret-leak', 'super_secret_token=12345', { filePath: '.env' });
      assert.strictEqual(ev.filePath, '[REDACTED]');
      assert.strictEqual(ev.detail, '[REDACTED SENSITIVE FILE]');
    });

    it('51. maskSensitiveDetail doit caviarder les clés API et tokens dans les descriptions', () => {
      const rawText = 'Connecting with api_key="sk-live-99887766554433221100" to database';
      const masked = maskSensitiveDetail(rawText);
      assert.ok(!masked.includes('sk-live-99887766554433221100'));
      assert.ok(masked.includes('MASKED_SECRET'));
    });
  });

  // =========================================================================
  // Section N: RBAC Tests
  // =========================================================================
  describe('N — RBAC Permissions', () => {
    class MockGraphService {
      buildGraph() { return syntheticGraph; }
    }

    it('52. Un VIEWER doit pouvoir construire et consulter la compréhension sémantique', () => {
      const service = new ApplicationUnderstandingService(new MockGraphService() as any);
      const model = service.buildUnderstanding({ tenantId: 'tenant-test', projectId: 'proj-test' }, 'VIEWER');
      assert.ok(model !== null);
      assert.strictEqual(model.tenantId, 'tenant-test');
    });

    it('53. ENGINEER, ADMIN et OWNER doivent être pleinement autorisés', () => {
      const service = new ApplicationUnderstandingService(new MockGraphService() as any);
      assert.doesNotThrow(() => service.buildUnderstanding({ tenantId: 'tenant-test', projectId: 'proj-test' }, 'ENGINEER'));
      assert.doesNotThrow(() => service.buildUnderstanding({ tenantId: 'tenant-test', projectId: 'proj-test' }, 'ADMIN'));
      assert.doesNotThrow(() => service.buildUnderstanding({ tenantId: 'tenant-test', projectId: 'proj-test' }, 'OWNER'));
    });

    it('54. Un rôle invalide doit lever une ForbiddenError', () => {
      const service = new ApplicationUnderstandingService(new MockGraphService() as any);
      assert.throws(() => {
        service.buildUnderstanding({ tenantId: 'tenant-test', projectId: 'proj-test' }, 'INVALID_ROLE' as any);
      }, ForbiddenError);
    });
  });

  // =========================================================================
  // Section O: Multi-Tenancy Tests
  // =========================================================================
  describe('O — Multi-Tenancy Isolation', () => {
    class MockGraphService {
      buildGraph(req: any) { return { ...syntheticGraph, tenantId: req.tenantId, projectId: req.projectId }; }
    }

    it('55. Les modèles sémantiques doivent être strictement étanches par tenantId et projectId', () => {
      const service = new ApplicationUnderstandingService(new MockGraphService() as any);
      const modelA = service.buildUnderstanding({ tenantId: 'tenant-alpha', projectId: 'proj-1' });
      const modelB = service.buildUnderstanding({ tenantId: 'tenant-beta', projectId: 'proj-1' });
      assert.strictEqual(modelA.tenantId, 'tenant-alpha');
      assert.strictEqual(modelB.tenantId, 'tenant-beta');
      assert.notStrictEqual(modelA.understandingHash, modelB.understandingHash);
    });

    it('56. Validation : l omission du tenantId doit lever une ValidationError', () => {
      const service = new ApplicationUnderstandingService(new MockGraphService() as any);
      assert.throws(() => {
        service.buildUnderstanding({ tenantId: '', projectId: 'p1' });
      }, ValidationError);
    });

    it('57. Validation : l omission du projectId doit lever une ValidationError', () => {
      const service = new ApplicationUnderstandingService(new MockGraphService() as any);
      assert.throws(() => {
        service.buildUnderstanding({ tenantId: 't1', projectId: '   ' });
      }, ValidationError);
    });
  });

  // =========================================================================
  // Section P: LRU Cache Tests
  // =========================================================================
  describe('P — LRU Cache', () => {
    it('58. Doit renvoyer le modèle en cache lors d un appel identique (Cache Hit)', () => {
      const cache = new UnderstandingLruCache(10);
      const model = runUnderstandingAnalysis({ tenantId: 't1', projectId: 'p1' }, syntheticGraph);
      const key = UnderstandingLruCache.buildKey('t1', 'p1', syntheticGraph.graphHash);
      cache.set(key, model);

      const cached = cache.get(key);
      assert.strictEqual(cached, model);
      const metrics = cache.getMetrics();
      assert.strictEqual(metrics.hits, 1);
      assert.strictEqual(metrics.misses, 0);
    });

    it('59. Doit enregistrer un Cache Miss lors d une clé inconnue', () => {
      const cache = new UnderstandingLruCache(10);
      const res = cache.get('unknown-key');
      assert.strictEqual(res, null);
      assert.strictEqual(cache.getMetrics().misses, 1);
    });

    it('60. Doit évincer le plus ancien élément quand la limite maxEntries est atteinte', () => {
      const cache = new UnderstandingLruCache(2);
      const m1 = runUnderstandingAnalysis({ tenantId: 't1', projectId: 'p1' }, syntheticGraph);
      const m2 = runUnderstandingAnalysis({ tenantId: 't1', projectId: 'p2' }, syntheticGraph);
      const m3 = runUnderstandingAnalysis({ tenantId: 't1', projectId: 'p3' }, syntheticGraph);

      cache.set('k1', m1);
      cache.set('k2', m2);
      cache.set('k3', m3); // k1 should be evicted

      assert.strictEqual(cache.has('k1'), false);
      assert.strictEqual(cache.has('k2'), true);
      assert.strictEqual(cache.has('k3'), true);
      assert.strictEqual(cache.getMetrics().evictions, 1);
    });

    it('61. invalidateProject doit supprimer tous les modèles associés à un projet', () => {
      const cache = new UnderstandingLruCache(10);
      const m1 = runUnderstandingAnalysis({ tenantId: 't1', projectId: 'p1' }, syntheticGraph);
      cache.set(UnderstandingLruCache.buildKey('t1', 'p1', 'hash1'), m1);
      cache.set(UnderstandingLruCache.buildKey('t1', 'p1', 'hash2'), m1);
      cache.set(UnderstandingLruCache.buildKey('t1', 'p2', 'hash1'), m1);

      const evicted = cache.invalidateProject('t1', 'p1');
      assert.strictEqual(evicted, 2);
      assert.strictEqual(cache.has(UnderstandingLruCache.buildKey('t1', 'p2', 'hash1')), true);
    });
  });

  // =========================================================================
  // Section Q: Empty & Degraded Projects
  // =========================================================================
  describe('Q — Empty & Degraded Projects', () => {
    it('62. Un graphe totalement vide doit produire un modèle valide sans crasher', () => {
      const emptyGraph = buildSyntheticGraph([], []);
      const model = runUnderstandingAnalysis({ tenantId: 't-empty', projectId: 'p-empty' }, emptyGraph);
      assert.strictEqual(model.domains.length, 0);
      assert.strictEqual(model.features.length, 0);
      assert.strictEqual(model.summary.totalFeatures, 0);
      assert.ok(model.understandingHash.length === 64);
    });

    it('63. Un projet sans DNA doit fonctionner en se basant exclusivement sur le graphe', () => {
      const model = runUnderstandingAnalysis({ tenantId: 't-nodna', projectId: 'p-nodna' }, syntheticGraph, undefined);
      assert.ok(model.features.length > 0);
      assert.ok(model.domains.length > 0);
    });

    it('64. Des nœuds isolés sans edges doivent être traités avec résilience', () => {
      const isolatedNode: SemanticNode = { id: 'node_iso', kind: 'SYMBOL', name: 'orphanFunction', metadata: {}, evidence: [] };
      const isolatedGraph = buildSyntheticGraph([isolatedNode], []);
      const model = runUnderstandingAnalysis({ tenantId: 't-iso', projectId: 'p-iso' }, isolatedGraph);
      assert.ok(model.schemaVersion === '1.0.0');
    });
  });

  // =========================================================================
  // Section R: Semantic Query Engine Tests
  // =========================================================================
  describe('R — Semantic Query Engine', () => {
    const model = runUnderstandingAnalysis({ tenantId: 'tenant-test', projectId: 'proj-test' }, syntheticGraph, syntheticDNA);

    it('65. selectFeatures doit filtrer par domainId, certainty et nom', () => {
      const authFeats = selectFeatures(model, { domainId: 'dom_authentication' });
      assert.ok(authFeats.every(f => f.domainId === 'dom_authentication'));

      const nameFiltered = selectFeatures(model, { nameContains: 'Auth' });
      assert.ok(nameFiltered.length > 0);
    });

    it('66. selectDomains doit filtrer par minConfidence et nom', () => {
      const highConfDomains = selectDomains(model, { minConfidence: 0.70 });
      assert.ok(highConfDomains.every(d => d.confidence >= 0.70));
    });

    it('67. selectWorkflows et selectJourneys doivent filtrer par acteur', () => {
      const userWorkflows = selectWorkflows(model, { actor: 'USER' });
      assert.ok(userWorkflows.length > 0);
      const anonJourneys = selectJourneys(model, { actor: 'ANONYMOUS_USER' });
      assert.ok(anonJourneys.length > 0);
    });

    it('68. selectBusinessRules doit filtrer par type de règle', () => {
      const authRules = selectBusinessRules(model, { type: 'AUTHORIZATION' });
      assert.ok(authRules.every(r => r.type === 'AUTHORIZATION'));
    });

    it('69. Fonctions de liaison de feature (composants, fichiers, dépendances, entryPoints)', () => {
      const comps = selectComponentsForFeature(model, 'feat_authentication');
      assert.ok(comps.some(c => c.name === 'LoginForm'));
      const files = selectFilesForFeature(model, 'feat_authentication');
      assert.ok(files.length > 0);
    });

    it('70. executeSemanticQuery doit gérer la pagination (offset, limit, total)', () => {
      const res = executeSemanticQuery(model, {
        tenantId: 'tenant-test',
        projectId: 'proj-test',
        query: { kind: 'FEATURES', limit: 1, offset: 0 }
      });
      assert.strictEqual(res.limit, 1);
      assert.strictEqual(res.offset, 0);
      assert.strictEqual(res.items.length, 1);
      assert.ok(res.total >= 1);
    });
  });

  // =========================================================================
  // Section S: Full Service Integration & Regression
  // =========================================================================
  describe('S — Full Service Integration & Regression', () => {
    class MockGraphService {
      buildGraph(req: any) { return { ...syntheticGraph, tenantId: req.tenantId, projectId: req.projectId }; }
    }
    class MockDnaService {
      extractDNA() { return syntheticDNA; }
    }

    it('71. ApplicationUnderstandingService.buildUnderstanding doit s exécuter de bout en bout', () => {
      const service = new ApplicationUnderstandingService(
        new MockGraphService() as any,
        new MockDnaService() as any
      );
      const model = service.buildUnderstanding({ tenantId: 't-e2e', projectId: 'p-e2e' }, 'OWNER', 'req-1234');
      assert.ok(model !== null);
      assert.strictEqual(model.tenantId, 't-e2e');
      assert.strictEqual(model.summary.totalFeatures, model.features.length);
    });

    it('72. queryUnderstanding et getUnderstandingMetrics doivent fonctionner sur le service', () => {
      const service = new ApplicationUnderstandingService(
        new MockGraphService() as any,
        new MockDnaService() as any
      );
      const metrics = service.getUnderstandingMetrics('t-e2e', 'p-e2e');
      assert.ok(metrics.featureCount > 0);

      const queryRes = service.queryUnderstanding({
        tenantId: 't-e2e',
        projectId: 'p-e2e',
        query: { kind: 'DOMAINS' }
      });
      assert.ok(queryRes.items.length > 0);
    });

    it('73. getUnderstanding doit renvoyer le modèle mis en cache et null si inexistant', () => {
      const service = new ApplicationUnderstandingService(new MockGraphService() as any);
      assert.strictEqual(service.getUnderstanding('t-none', 'p-none'), null);
      service.buildUnderstanding({ tenantId: 't-cached', projectId: 'p-cached' });
      const cached = service.getUnderstanding('t-cached', 'p-cached');
      assert.ok(cached !== null);
      assert.strictEqual(cached?.tenantId, 't-cached');
    });
  });

});
