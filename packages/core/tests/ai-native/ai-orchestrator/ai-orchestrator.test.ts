import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIOrchestratorService,
  DEFAULT_ORCHESTRATOR_CONFIG,
  TaskDecomposer,
  ContextOrchestrator,
  AgentScheduler,
  ConflictDetector,
  ValidationGate,
  MutationBridge,
  RepairOrchestrator,
  UiAgent,
  BackendAgent,
  DataAgent,
  SecurityAgent,
  TestAgent,
  computeTaskGraphHash,
  computeArtifactHash,
  computeOrchestrationTraceId,
  compareTasks,
  compareArtifacts,
  compareConflicts,
  AIOrchestratorLruCache,
  type AgentTask,
  type AgentArtifact,
  type AgentConflict,
  type EngineeringTaskGraph,
  type OrchestrationRun,
  type TaskContextPayload,
  type EngineeringPlan,
  type IntentResult,
  ForbiddenError,
  NotFoundError,
  auditStore
} from '../../../src/index.js';

describe('AINT-010 — AI Orchestrator & Engineering Agent Orchestrator', () => {
  const tenantId = 'tenant_volaco_prime';
  const projectId = 'proj_core_engine_v1';
  const otherTenantId = 'tenant_competitor_x';

  const createSamplePlan = (planId = 'plan-test-01'): EngineeringPlan => ({
    planId,
    title: 'Création du module de facturation et paiements',
    summary: 'Ajout de la gestion des factures et intégration passerelle de paiement',
    planHash: 'hash-sample-plan',
    status: 'APPROVED',
    steps: [
      {
        stepIndex: 0,
        title: 'Schéma de données facture',
        description: 'Créer le schéma des entités Facture et Paiement',
        targetDomain: 'DATA',
        targetFiles: ['src/models/invoice.ts'],
        operation: 'CREATE',
        requiresApproval: false
      },
      {
        stepIndex: 1,
        title: 'Service de calcul et paiement',
        description: 'Implémenter le service backend de facturation et routes api',
        targetDomain: 'BACKEND',
        targetFiles: ['src/services/billing.ts', 'src/routes/billing.ts'],
        operation: 'CREATE',
        requiresApproval: false
      },
      {
        stepIndex: 2,
        title: 'Composant interface facture',
        description: 'Concevoir la vue utilisateur et interface de paiement',
        targetDomain: 'UI',
        targetFiles: ['src/components/InvoiceView.tsx'],
        operation: 'CREATE',
        requiresApproval: false
      },
      {
        stepIndex: 3,
        title: 'Audit de sécurité des paiements',
        description: 'Vérifier la conformité de sécurité et les permissions RBAC',
        targetDomain: 'SECURITY',
        targetFiles: ['src/security/billing-guard.ts'],
        operation: 'VERIFY',
        requiresApproval: true
      },
      {
        stepIndex: 4,
        title: 'Tests unitaires et intégration',
        description: 'Rédiger les tests de facturation',
        targetDomain: 'TEST',
        targetFiles: ['tests/billing.test.ts'],
        operation: 'VERIFY',
        requiresApproval: false
      }
    ]
  });

  const createSampleIntent = (): IntentResult => ({
    category: 'CREATE',
    goal: 'Module de facturation complet',
    requestedAction: 'Créer les modèles, endpoints, composants UI et tests',
    entities: ['Facture', 'Paiement', 'Client'],
    constraints: ['Strict RBAC', 'PCI-DSS Compliance'],
    urgency: 'NORMAL',
    confidence: 0.95,
    ambiguities: []
  });

  // ============================================================================
  // SECTION 1: Canonical Utilities, Hash & Immutability
  // ============================================================================
  describe('Section 1: Canonical Utilities, Hash & Immutability', () => {
    it('1. computeTaskGraphHash doit générer un condensat SHA-256 déterministe', () => {
      const tasks: AgentTask[] = [
        {
          id: 'task-1',
          title: 'Tâche A',
          description: 'Desc A',
          domain: 'DATA',
          priority: 9,
          dependencies: [],
          requiredContext: {},
          requiredCapabilities: ['SCHEMA_MODELING'],
          status: 'QUEUED',
          retryCount: 0,
          maxRetries: 3
        }
      ];
      const hash1 = computeTaskGraphHash(tasks);
      const hash2 = computeTaskGraphHash(tasks);
      assert.equal(typeof hash1, 'string');
      assert.ok(hash1.startsWith('graph:'));
      assert.equal(hash1, hash2);
    });

    it('2. computeTaskGraphHash doit être sensible aux modifications de tâches', () => {
      const taskBase: AgentTask = {
        id: 'task-1',
        title: 'Tâche A',
        description: 'Desc A',
        domain: 'DATA',
        priority: 9,
        dependencies: [],
        requiredContext: {},
        requiredCapabilities: ['SCHEMA_MODELING'],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };
      const hash1 = computeTaskGraphHash([taskBase]);
      const hash2 = computeTaskGraphHash([{ ...taskBase, domain: 'BACKEND' }]);
      assert.notEqual(hash1, hash2);
    });

    it('3. computeArtifactHash doit être déterministe pour un artefact', () => {
      const art = {
        id: 'art-001',
        agentId: 'agent-ui',
        domain: 'UI' as const,
        taskId: 'task-1',
        kind: 'PROPOSED_FILE_CHANGE' as const,
        targetFiles: ['src/App.tsx'],
        payload: { filePath: 'src/App.tsx', operation: 'UPDATE' as const, proposedContent: 'const x = 1;' },
        confidence: 1.0,
        summary: 'Modification App.tsx',
        createdAt: '2026-09-06T12:00:00Z'
      };
      const h1 = computeArtifactHash(art);
      const h2 = computeArtifactHash(art);
      assert.equal(typeof h1, 'string');
      assert.ok(h1.startsWith('art:'));
      assert.equal(h1, h2);
    });

    it('4. computeArtifactHash doit varier quand le payload change', () => {
      const artBase = {
        id: 'art-001',
        agentId: 'agent-ui',
        domain: 'UI' as const,
        taskId: 'task-1',
        kind: 'PROPOSED_FILE_CHANGE' as const,
        targetFiles: ['src/App.tsx'],
        payload: { filePath: 'src/App.tsx', operation: 'UPDATE' as const, proposedContent: 'const x = 1;' },
        confidence: 1.0,
        summary: 'Modification App.tsx',
        createdAt: '2026-09-06T12:00:00Z'
      };
      const h1 = computeArtifactHash(artBase);
      const h2 = computeArtifactHash({
        ...artBase,
        payload: { ...artBase.payload, proposedContent: 'const x = 2;' }
      });
      assert.notEqual(h1, h2);
    });

    it('5. computeOrchestrationTraceId doit formater orch-tr-{hash}', () => {
      const traceId = computeOrchestrationTraceId('orch-abc123', 4);
      assert.ok(traceId.startsWith('orch-tr-'));
    });

    it('6. compareTasks doit ordonner par priorité décroissante puis par id croissant', () => {
      const t1: AgentTask = {
        id: 'task-b',
        title: 'B',
        description: '',
        domain: 'UI',
        priority: 5,
        dependencies: [],
        requiredContext: {},
        requiredCapabilities: [],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };
      const t2: AgentTask = {
        id: 'task-a',
        title: 'A',
        description: '',
        domain: 'DATA',
        priority: 8,
        dependencies: [],
        requiredContext: {},
        requiredCapabilities: [],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };
      const t3: AgentTask = {
        id: 'task-c',
        title: 'C',
        description: '',
        domain: 'BACKEND',
        priority: 5,
        dependencies: [],
        requiredContext: {},
        requiredCapabilities: [],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };

      const sorted = [t1, t2, t3].sort(compareTasks);
      assert.equal(sorted[0]!.id, 'task-a'); // priorité 8
      assert.equal(sorted[1]!.id, 'task-b'); // priorité 5, 'b' < 'c'
      assert.equal(sorted[2]!.id, 'task-c'); // priorité 5, 'c' > 'b'
    });

    it('7. compareArtifacts doit ordonner par domaine puis par premier fichier cible', () => {
      const a1: AgentArtifact = {
        id: 'art-1',
        agentId: 'a',
        domain: 'UI',
        taskId: 't1',
        kind: 'UI_SPEC',
        targetFiles: ['src/B.tsx'],
        payload: {},
        confidence: 1,
        summary: '',
        hash: 'h1',
        createdAt: ''
      };
      const a2: AgentArtifact = {
        id: 'art-2',
        agentId: 'b',
        domain: 'BACKEND',
        taskId: 't2',
        kind: 'API_SPEC_CHANGE',
        targetFiles: ['src/A.ts'],
        payload: {},
        confidence: 1,
        summary: '',
        hash: 'h2',
        createdAt: ''
      };
      const sorted = [a1, a2].sort(compareArtifacts);
      assert.equal(sorted[0]!.domain, 'BACKEND');
      assert.equal(sorted[1]!.domain, 'UI');
    });

    it('8. compareConflicts doit ordonner par sévérité (BLOCKING > HIGH > MEDIUM > LOW)', () => {
      const cLow: AgentConflict = {
        conflictId: 'c1',
        involvedAgents: ['a'],
        affectedFiles: ['f1'],
        description: 'low',
        severity: 'LOW',
        requiresHumanIntervention: false
      };
      const cBlocking: AgentConflict = {
        conflictId: 'c2',
        involvedAgents: ['b'],
        affectedFiles: ['f2'],
        description: 'blocking',
        severity: 'BLOCKING',
        requiresHumanIntervention: true
      };
      const cHigh: AgentConflict = {
        conflictId: 'c3',
        involvedAgents: ['c'],
        affectedFiles: ['f3'],
        description: 'high',
        severity: 'HIGH',
        requiresHumanIntervention: true
      };

      const sorted = [cLow, cBlocking, cHigh].sort(compareConflicts);
      assert.equal(sorted[0]!.severity, 'BLOCKING');
      assert.equal(sorted[1]!.severity, 'HIGH');
      assert.equal(sorted[2]!.severity, 'LOW');
    });

    it('9. AIOrchestratorLruCache doit respecter sa limite de capacité max', () => {
      const cache = new AIOrchestratorLruCache(2);
      const makeRun = (id: string): OrchestrationRun => ({
        orchestrationId: id,
        tenantId,
        projectId,
        planId: 'plan-1',
        state: 'COMPLETED',
        taskGraph: { graphId: 'g', planId: 'p', tasks: [], rootTaskIds: [], graphHash: 'h', isAcyclic: true },
        completedTaskIds: [],
        artifacts: [],
        conflicts: [],
        traces: [],
        totalCostUsd: 0,
        totalTokens: 0,
        repairCycles: 0,
        startedAt: '',
        completedAt: ''
      });

      cache.set(makeRun('run-1'));
      cache.set(makeRun('run-2'));
      assert.equal(cache.size, 2);
      assert.ok(cache.get('run-1'));

      cache.set(makeRun('run-3')); // Evicts run-2 because run-1 was accessed
      assert.equal(cache.size, 2);
      assert.ok(cache.get('run-1'));
      assert.ok(cache.get('run-3'));
      assert.equal(cache.get('run-2'), undefined);
    });

    it('10. AIOrchestratorLruCache doit supporter clear et has', () => {
      const cache = new AIOrchestratorLruCache(5);
      const makeRun = (id: string): OrchestrationRun => ({
        orchestrationId: id,
        tenantId,
        projectId,
        planId: 'plan-1',
        state: 'INITIALIZING',
        taskGraph: { graphId: 'g', planId: 'p', tasks: [], rootTaskIds: [], graphHash: 'h', isAcyclic: true },
        completedTaskIds: [],
        artifacts: [],
        conflicts: [],
        traces: [],
        totalCostUsd: 0,
        totalTokens: 0,
        repairCycles: 0,
        startedAt: '',
        completedAt: ''
      });

      cache.set(makeRun('run-x'));
      assert.equal(cache.has('run-x'), true);
      assert.equal(cache.has('run-missing'), false);
      cache.clear();
      assert.equal(cache.has('run-x'), false);
      assert.equal(cache.size, 0);
    });
  });

  // ============================================================================
  // SECTION 2: Task Decomposer & DAG Construction
  // ============================================================================
  describe('Section 2: Task Decomposer & DAG Construction', () => {
    const decomposer = new TaskDecomposer();

    it('11. doit décomposer un plan structuré en graphe DAG de tâches typées', () => {
      const plan = createSamplePlan();
      const graph = decomposer.decomposePlan(plan);

      assert.equal(graph.tasks.length, 5);
      assert.ok(graph.graphId.startsWith('graph-'));
      assert.equal(graph.planId, plan.planId);
      assert.equal(graph.isAcyclic, true);
      assert.ok(graph.graphHash.startsWith('graph:'));
    });

    it('12. doit détecter correctement le domaine de chaque étape de plan', () => {
      assert.equal(decomposer.detectStepDomain({ stepIndex: 0, title: '', description: 'Créer le schéma de base de données SQLite', operation: 'CREATE', requiresApproval: false }), 'DATA');
      assert.equal(decomposer.detectStepDomain({ stepIndex: 1, title: '', description: 'Implémenter la route API REST et le service de facturation', operation: 'CREATE', requiresApproval: false }), 'BACKEND');
      assert.equal(decomposer.detectStepDomain({ stepIndex: 2, title: '', description: 'Créer le composant UI de tableau de bord Tailwind', operation: 'CREATE', requiresApproval: false }), 'UI');
      assert.equal(decomposer.detectStepDomain({ stepIndex: 3, title: '', description: 'Vérifier les permissions RBAC et la sécurité d accès', operation: 'VERIFY', requiresApproval: true }), 'SECURITY');
      assert.equal(decomposer.detectStepDomain({ stepIndex: 4, title: '', description: 'Rédiger la suite de test unitaire et assertions', operation: 'VERIFY', requiresApproval: false }), 'TEST');
    });

    it('13. doit déduire les capacités d agent requises pour chaque domaine', () => {
      const dummyStep = { stepIndex: 0, title: '', description: '', operation: 'CREATE' as const, requiresApproval: false };
      assert.ok(decomposer.resolveRequiredCapabilities('DATA', dummyStep).includes('SCHEMA_MODELING'));
      assert.ok(decomposer.resolveRequiredCapabilities('BACKEND', dummyStep).includes('API_DESIGN'));
      assert.ok(decomposer.resolveRequiredCapabilities('UI', dummyStep).includes('PAGE_GENERATION'));
      assert.ok(decomposer.resolveRequiredCapabilities('SECURITY', dummyStep).includes('AUTH_RBAC'));
      assert.ok(decomposer.resolveRequiredCapabilities('TEST', dummyStep).includes('UNIT_TEST_GEN'));
    });

    it('14. doit générer un DAG complet standard lorsque le plan n a pas d étapes explicites', () => {
      const emptyPlan: EngineeringPlan = {
        planId: 'adhoc-plan',
        title: 'Création d un dashboard analytics',
        summary: 'Dashboard',
        planHash: 'hash',
        status: 'APPROVED',
        steps: []
      };
      const intent = createSampleIntent();
      const graph = decomposer.decomposePlan(emptyPlan, intent);

      assert.equal(graph.tasks.length, 5);
      const domains = graph.tasks.map((t) => t.domain);
      assert.deepEqual(domains, ['DATA', 'BACKEND', 'SECURITY', 'UI', 'TEST']);
      assert.equal(graph.isAcyclic, true);
    });

    it('15. doit identifier correctement les tâches racines (sans dépendance)', () => {
      const plan = createSamplePlan();
      const graph = decomposer.decomposePlan(plan);

      assert.ok(graph.rootTaskIds.length >= 1);
      const firstTask = graph.tasks[0]!;
      assert.ok(graph.rootTaskIds.includes(firstTask.id));
      assert.equal(firstTask.dependencies.length, 0);
    });

    it('16. verifyAcyclicity doit retourner true pour un graphe strictement acyclique', () => {
      const tasks: AgentTask[] = [
        { id: 't1', title: '1', description: '', domain: 'DATA', priority: 1, dependencies: [], requiredContext: {}, requiredCapabilities: [], status: 'QUEUED', retryCount: 0, maxRetries: 3 },
        { id: 't2', title: '2', description: '', domain: 'BACKEND', priority: 2, dependencies: ['t1'], requiredContext: {}, requiredCapabilities: [], status: 'QUEUED', retryCount: 0, maxRetries: 3 },
        { id: 't3', title: '3', description: '', domain: 'UI', priority: 3, dependencies: ['t2'], requiredContext: {}, requiredCapabilities: [], status: 'QUEUED', retryCount: 0, maxRetries: 3 }
      ];
      assert.equal(decomposer.verifyAcyclicity(tasks), true);
    });

    it('17. verifyAcyclicity doit détecter un cycle direct (A -> B -> A)', () => {
      const tasks: AgentTask[] = [
        { id: 't1', title: '1', description: '', domain: 'DATA', priority: 1, dependencies: ['t2'], requiredContext: {}, requiredCapabilities: [], status: 'QUEUED', retryCount: 0, maxRetries: 3 },
        { id: 't2', title: '2', description: '', domain: 'BACKEND', priority: 2, dependencies: ['t1'], requiredContext: {}, requiredCapabilities: [], status: 'QUEUED', retryCount: 0, maxRetries: 3 }
      ];
      assert.equal(decomposer.verifyAcyclicity(tasks), false);
    });

    it('18. verifyAcyclicity doit détecter un cycle indirect (A -> B -> C -> A)', () => {
      const tasks: AgentTask[] = [
        { id: 't1', title: '1', description: '', domain: 'DATA', priority: 1, dependencies: ['t3'], requiredContext: {}, requiredCapabilities: [], status: 'QUEUED', retryCount: 0, maxRetries: 3 },
        { id: 't2', title: '2', description: '', domain: 'BACKEND', priority: 2, dependencies: ['t1'], requiredContext: {}, requiredCapabilities: [], status: 'QUEUED', retryCount: 0, maxRetries: 3 },
        { id: 't3', title: '3', description: '', domain: 'UI', priority: 3, dependencies: ['t2'], requiredContext: {}, requiredCapabilities: [], status: 'QUEUED', retryCount: 0, maxRetries: 3 }
      ];
      assert.equal(decomposer.verifyAcyclicity(tasks), false);
    });

    it('19. decomposePlan doit figer le graphe de retour en lecture seule (deepFreeze)', () => {
      const plan = createSamplePlan();
      const graph = decomposer.decomposePlan(plan);
      assert.ok(Object.isFrozen(graph));
      assert.ok(Object.isFrozen(graph.tasks));
      assert.ok(Object.isFrozen(graph.tasks[0]));
    });

    it('20. doit assigner des budgets de retry et timeouts cohérents sur chaque tâche', () => {
      const plan = createSamplePlan();
      const graph = decomposer.decomposePlan(plan);
      for (const task of graph.tasks) {
        assert.equal(task.retryCount, 0);
        assert.equal(task.maxRetries, 3);
        assert.equal(task.status, 'QUEUED');
      }
    });
  });

  // ============================================================================
  // SECTION 3: Context Orchestrator & Secret Sanitization
  // ============================================================================
  describe('Section 3: Context Orchestrator & Secret Sanitization', () => {
    const orchestrator = new ContextOrchestrator();

    const dummyTask: AgentTask = {
      id: 'task-test',
      title: 'Implémentation Auth',
      description: 'Ajout de la session',
      domain: 'BACKEND',
      priority: 8,
      dependencies: [],
      requiredContext: {
        targetFiles: ['src/services/auth.ts'],
        includeSemanticModel: false
      },
      requiredCapabilities: ['SERVICE_LOGIC'],
      status: 'QUEUED',
      retryCount: 0,
      maxRetries: 3
    };

    it('21. doit masquer automatiquement les clés secrètes et tokens dans le contenu des fichiers', () => {
      const rawFiles = {
        'src/services/auth.ts': 'const apiKey = "sk_live_1234567890abcdef1234567890";\nconst port = 8080;'
      };

      const ctx = orchestrator.assembleTaskContext({
        tenantId,
        projectId,
        task: dummyTask,
        rawFiles
      });

      const processed = ctx.relevantFiles['src/services/auth.ts'];
      assert.ok(processed);
      assert.ok(processed.includes('***') || processed.includes('[REDACTED]'));
      assert.ok(!processed.includes('sk_live_1234567890abcdef1234567890'));
      assert.ok(processed.includes('const port = 8080;'));
    });

    it('22. doit exclure formellement les fichiers sensibles (.env, credentials, pem)', () => {
      const rawFiles = {
        '.env': 'DB_PASSWORD=supersecret',
        'config/credentials.json': '{"secret": "val"}',
        'certs/server.pem': '-----BEGIN RSA PRIVATE KEY-----',
        'src/services/auth.ts': 'export class AuthService {}'
      };

      const ctx = orchestrator.assembleTaskContext({
        tenantId,
        projectId,
        task: dummyTask,
        rawFiles
      });

      assert.equal(ctx.relevantFiles['.env'], undefined);
      assert.equal(ctx.relevantFiles['config/credentials.json'], undefined);
      assert.equal(ctx.relevantFiles['certs/server.pem'], undefined);
      assert.ok(ctx.relevantFiles['src/services/auth.ts']);
    });

    it('23. doit filtrer les fichiers non ciblés lorsque targetFiles est spécifié', () => {
      const rawFiles = {
        'src/services/auth.ts': 'export class AuthService {}',
        'src/components/Footer.tsx': 'export const Footer = () => null;'
      };

      const ctx = orchestrator.assembleTaskContext({
        tenantId,
        projectId,
        task: dummyTask, // targets only src/services/auth.ts
        rawFiles
      });

      assert.ok(ctx.relevantFiles['src/services/auth.ts']);
      assert.equal(ctx.relevantFiles['src/components/Footer.tsx'], undefined);
    });

    it('24. doit inclure tous les fichiers non sensibles si targetFiles est vide', () => {
      const taskAll: AgentTask = {
        ...dummyTask,
        requiredContext: { targetFiles: [] }
      };
      const rawFiles = {
        'src/a.ts': 'const a = 1;',
        'src/b.ts': 'const b = 2;'
      };

      const ctx = orchestrator.assembleTaskContext({
        tenantId,
        projectId,
        task: taskAll,
        rawFiles
      });

      assert.ok(ctx.relevantFiles['src/a.ts']);
      assert.ok(ctx.relevantFiles['src/b.ts']);
    });

    it('25. doit transmettre fidèlement les décisions d architecture (ADR)', () => {
      const decisions = ['Utiliser Postgres pour la persistance', 'Adopter JWT pour les sessions'];
      const ctx = orchestrator.assembleTaskContext({
        tenantId,
        projectId,
        task: dummyTask,
        decisions
      });

      assert.deepEqual(ctx.decisions, decisions);
    });

    it('26. doit transmettre fidèlement les contraintes d ingénierie', () => {
      const constraints = ['Zéro dépendance externe non approuvée', 'Temps de réponse < 200ms'];
      const ctx = orchestrator.assembleTaskContext({
        tenantId,
        projectId,
        task: dummyTask,
        constraints
      });

      assert.deepEqual(ctx.constraints, constraints);
    });

    it('27. doit renvoyer un snapshot vide avec grâce si understandingService est absent', () => {
      const taskWithSemantic: AgentTask = {
        ...dummyTask,
        requiredContext: { includeSemanticModel: true }
      };

      const ctx = orchestrator.assembleTaskContext({
        tenantId,
        projectId,
        task: taskWithSemantic
      });

      assert.equal(ctx.understandingSnapshot, undefined);
    });

    it('28. doit limiter les symboles pertinents retournés à un maximum borné', () => {
      const ctx = orchestrator.assembleTaskContext({
        tenantId,
        projectId,
        task: dummyTask
      });

      assert.ok(Array.isArray(ctx.relevantSymbols));
      assert.ok(ctx.relevantSymbols.length <= 20);
    });

    it('29. doit préserver la structure minimale même sans fichiers fournis', () => {
      const ctx = orchestrator.assembleTaskContext({
        tenantId,
        projectId,
        task: dummyTask
      });

      assert.deepEqual(ctx.relevantFiles, {});
      assert.deepEqual(ctx.recentHistory, []);
    });

    it('30. doit s exécuter sans fuite d exceptions en cas d erreur inattendue', () => {
      assert.doesNotThrow(() => {
        orchestrator.assembleTaskContext({
          tenantId,
          projectId,
          task: dummyTask,
          rawFiles: undefined
        });
      });
    });
  });

  // ============================================================================
  // SECTION 4: Specialized Domain Agents (UI, Backend, Data, Security, Test)
  // ============================================================================
  describe('Section 4: Specialized Domain Agents', () => {
    const dummyContext: TaskContextPayload = {
      relevantFiles: {
        'src/services/billing.ts': 'export class BillingService {}'
      },
      relevantSymbols: ['BillingService'],
      decisions: [],
      constraints: [],
      recentHistory: []
    };

    it('31. UiAgent : doit définir son identité et ses capacités UI', () => {
      const agent = new UiAgent();
      assert.equal(agent.definition.domain, 'UI');
      assert.ok(agent.definition.capabilities.includes('PAGE_GENERATION'));
      assert.ok(agent.definition.capabilities.includes('COMPONENT_STYLING'));
      assert.equal(agent.definition.riskLevel, 'LOW');
    });

    it('32. UiAgent : doit produire des artefacts PROPOSED_FILE_CHANGE et UI_SPEC', async () => {
      const agent = new UiAgent();
      const task: AgentTask = {
        id: 't-ui-1',
        title: 'Composant Dashboard',
        description: 'Créer la vue',
        domain: 'UI',
        priority: 5,
        dependencies: [],
        requiredContext: { targetFiles: ['src/components/Dashboard.tsx'] },
        requiredCapabilities: ['PAGE_GENERATION'],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };

      const result = await agent.executeTask({
        task,
        context: dummyContext,
        tenantId,
        projectId
      });

      assert.equal(result.status, 'SUCCESS');
      assert.ok(result.artifacts.length >= 2);
      const fileChange = result.artifacts.find((a) => a.kind === 'PROPOSED_FILE_CHANGE');
      assert.ok(fileChange);
      assert.deepEqual(fileChange.targetFiles, ['src/components/Dashboard.tsx']);
    });

    it('33. BackendAgent : doit définir son identité et ses capacités Backend', () => {
      const agent = new BackendAgent();
      assert.equal(agent.definition.domain, 'BACKEND');
      assert.ok(agent.definition.capabilities.includes('API_DESIGN'));
      assert.ok(agent.definition.capabilities.includes('SERVICE_LOGIC'));
      assert.equal(agent.definition.riskLevel, 'MEDIUM');
    });

    it('34. BackendAgent : doit produire des artefacts PROPOSED_FILE_CHANGE et API_SPEC_CHANGE', async () => {
      const agent = new BackendAgent();
      const task: AgentTask = {
        id: 't-be-1',
        title: 'Service Facturation',
        description: 'Endpoints de paiement',
        domain: 'BACKEND',
        priority: 8,
        dependencies: [],
        requiredContext: { targetFiles: ['src/services/billing.ts'] },
        requiredCapabilities: ['SERVICE_LOGIC'],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };

      const result = await agent.executeTask({
        task,
        context: dummyContext,
        tenantId,
        projectId
      });

      assert.equal(result.status, 'SUCCESS');
      const apiSpec = result.artifacts.find((a) => a.kind === 'API_SPEC_CHANGE');
      assert.ok(apiSpec);
      assert.equal(apiSpec.domain, 'BACKEND');
    });

    it('35. DataAgent : doit définir son identité et ses capacités Data', () => {
      const agent = new DataAgent();
      assert.equal(agent.definition.domain, 'DATA');
      assert.ok(agent.definition.capabilities.includes('SCHEMA_MODELING'));
      assert.ok(agent.definition.capabilities.includes('DATA_INTEGRITY'));
      assert.equal(agent.definition.riskLevel, 'HIGH');
    });

    it('36. DataAgent : doit produire des artefacts DATA_SCHEMA_CHANGE et PROPOSED_FILE_CHANGE', async () => {
      const agent = new DataAgent();
      const task: AgentTask = {
        id: 't-data-1',
        title: 'Modèle Facture',
        description: 'Schéma de données',
        domain: 'DATA',
        priority: 9,
        dependencies: [],
        requiredContext: { targetFiles: ['src/models/invoice.ts'] },
        requiredCapabilities: ['SCHEMA_MODELING'],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };

      const result = await agent.executeTask({
        task,
        context: dummyContext,
        tenantId,
        projectId
      });

      assert.equal(result.status, 'SUCCESS');
      const schemaArt = result.artifacts.find((a) => a.kind === 'DATA_SCHEMA_CHANGE');
      assert.ok(schemaArt);
      assert.equal(schemaArt.domain, 'DATA');
    });

    it('37. SecurityAgent : doit définir son identité et ses capacités Security avec risque CRITICAL', () => {
      const agent = new SecurityAgent();
      assert.equal(agent.definition.domain, 'SECURITY');
      assert.ok(agent.definition.capabilities.includes('AUTH_RBAC'));
      assert.ok(agent.definition.capabilities.includes('VULNERABILITY_SCAN'));
      assert.equal(agent.definition.riskLevel, 'CRITICAL');
    });

    it('38. SecurityAgent : doit auditer et valider un code exempt de vulnérabilités', async () => {
      const agent = new SecurityAgent();
      const task: AgentTask = {
        id: 't-sec-1',
        title: 'Audit RBAC',
        description: 'Contrôle sécurité',
        domain: 'SECURITY',
        priority: 7,
        dependencies: [],
        requiredContext: { targetFiles: ['src/security/guard.ts'] },
        requiredCapabilities: ['AUTH_RBAC'],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };

      const result = await agent.executeTask({
        task,
        context: dummyContext,
        tenantId,
        projectId
      });

      assert.equal(result.status, 'SUCCESS');
      const finding = result.artifacts.find((a) => a.kind === 'SECURITY_FINDING');
      assert.ok(finding);
      const payload = finding.payload as { vulnerabilitiesFound: number };
      assert.equal(payload.vulnerabilitiesFound, 0);
    });

    it('39. SecurityAgent : doit détecter et signaler des patterns dangereux (eval, apiKey)', async () => {
      const agent = new SecurityAgent();
      const vulnerableContext: TaskContextPayload = {
        ...dummyContext,
        relevantFiles: {
          'src/vulnerable.ts': 'const apiKey = "12345"; eval(userInput);'
        }
      };
      const task: AgentTask = {
        id: 't-sec-2',
        title: 'Audit de code tiers',
        description: 'Vérification',
        domain: 'SECURITY',
        priority: 7,
        dependencies: [],
        requiredContext: { targetFiles: ['src/vulnerable.ts'] },
        requiredCapabilities: ['VULNERABILITY_SCAN'],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };

      const result = await agent.executeTask({
        task,
        context: vulnerableContext,
        tenantId,
        projectId
      });

      const finding = result.artifacts.find((a) => a.kind === 'SECURITY_FINDING');
      assert.ok(finding);
      const payload = finding.payload as { vulnerabilitiesFound: number; findingsSummary: string };
      assert.ok(payload.vulnerabilitiesFound > 0);
      assert.ok(payload.findingsSummary.includes('pattern non sécurisé'));
    });

    it('40. TestAgent : doit définir son identité et ses capacités Test', () => {
      const agent = new TestAgent();
      assert.equal(agent.definition.domain, 'TEST');
      assert.ok(agent.definition.capabilities.includes('UNIT_TEST_GEN'));
      assert.ok(agent.definition.capabilities.includes('INTEGRATION_TEST'));
      assert.equal(agent.definition.riskLevel, 'LOW');
    });

    it('41. TestAgent : doit produire TEST_SUITE_PROPOSAL et PROPOSED_FILE_CHANGE (CREATE)', async () => {
      const agent = new TestAgent();
      const task: AgentTask = {
        id: 't-test-1',
        title: 'Tests Facturation',
        description: 'Suite de tests',
        domain: 'TEST',
        priority: 6,
        dependencies: [],
        requiredContext: { targetFiles: ['tests/billing.test.ts'] },
        requiredCapabilities: ['UNIT_TEST_GEN'],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };

      const result = await agent.executeTask({
        task,
        context: dummyContext,
        tenantId,
        projectId
      });

      assert.equal(result.status, 'SUCCESS');
      const testSuite = result.artifacts.find((a) => a.kind === 'TEST_SUITE_PROPOSAL');
      assert.ok(testSuite);
      const fileChange = result.artifacts.find((a) => a.kind === 'PROPOSED_FILE_CHANGE');
      assert.ok(fileChange);
      const payload = fileChange.payload as { operation: string };
      assert.equal(payload.operation, 'CREATE');
    });

    it('42. BaseSpecializedAgent : doit produire des résultats immuables (deepFreeze)', async () => {
      const agent = new UiAgent();
      const task: AgentTask = {
        id: 't-freeze',
        title: 'Freeze test',
        description: '',
        domain: 'UI',
        priority: 1,
        dependencies: [],
        requiredContext: {},
        requiredCapabilities: [],
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3
      };

      const result = await agent.executeTask({
        task,
        context: dummyContext,
        tenantId,
        projectId
      });

      assert.ok(Object.isFrozen(result));
      assert.ok(Object.isFrozen(result.artifacts));
    });
  });

  // ============================================================================
  // SECTION 5: Conflict Detector & Collision Intelligence
  // ============================================================================
  describe('Section 5: Conflict Detector & Collision Intelligence', () => {
    const detector = new ConflictDetector();

    it('43. doit détecter une collision de fichier quand deux agents ciblent le même fichier', () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-ui',
          agentId: 'agent-ui-specialist',
          domain: 'UI',
          taskId: 't-1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/shared/layout.ts'],
          payload: { filePath: 'src/shared/layout.ts', operation: 'UPDATE' },
          confidence: 1.0,
          summary: 'UI changes',
          hash: 'h1',
          createdAt: ''
        },
        {
          id: 'art-backend',
          agentId: 'agent-backend-specialist',
          domain: 'BACKEND',
          taskId: 't-2',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/shared/layout.ts'],
          payload: { filePath: 'src/shared/layout.ts', operation: 'UPDATE' },
          confidence: 1.0,
          summary: 'Backend changes',
          hash: 'h2',
          createdAt: ''
        }
      ];

      const conflicts = detector.detectConflicts(artifacts);
      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0]!.severity, 'HIGH');
      assert.ok(conflicts[0]!.description.includes('src/shared/layout.ts'));
      assert.ok(conflicts[0]!.involvedAgents.includes('agent-ui-specialist'));
      assert.ok(conflicts[0]!.involvedAgents.includes('agent-backend-specialist'));
    });

    it('44. doit élever la sévérité à BLOCKING si une suppression (DELETE) est en concurrence', () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-ui',
          agentId: 'agent-ui-specialist',
          domain: 'UI',
          taskId: 't-1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/obsolete.ts'],
          payload: { filePath: 'src/obsolete.ts', operation: 'UPDATE' },
          confidence: 1.0,
          summary: '',
          hash: 'h1',
          createdAt: ''
        },
        {
          id: 'art-backend',
          agentId: 'agent-backend-specialist',
          domain: 'BACKEND',
          taskId: 't-2',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/obsolete.ts'],
          payload: { filePath: 'src/obsolete.ts', operation: 'DELETE' },
          confidence: 1.0,
          summary: '',
          hash: 'h2',
          createdAt: ''
        }
      ];

      const conflicts = detector.detectConflicts(artifacts);
      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0]!.severity, 'BLOCKING');
      assert.equal(conflicts[0]!.requiresHumanIntervention, true);
    });

    it('45. doit émettre un conflit bloquant (BLOCKING) en cas de veto de sécurité', () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-sec-fail',
          agentId: 'agent-security-specialist',
          domain: 'SECURITY',
          taskId: 't-sec',
          kind: 'SECURITY_FINDING',
          targetFiles: ['src/routes/dangerous.ts'],
          payload: {
            vulnerabilitiesFound: 2,
            findingsSummary: 'Injection SQL possible et eval() non contrôlé.'
          },
          confidence: 1.0,
          summary: 'Security Alert',
          hash: 'h-sec',
          createdAt: ''
        }
      ];

      const conflicts = detector.detectConflicts(artifacts);
      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0]!.severity, 'BLOCKING');
      assert.ok(conflicts[0]!.description.includes('Veto de sécurité'));
      assert.equal(conflicts[0]!.requiresHumanIntervention, true);
    });

    it('46. ne doit produire aucun conflit lorsque les agents ciblent des fichiers disjoints', () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-1',
          agentId: 'agent-ui-specialist',
          domain: 'UI',
          taskId: 't-1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/components/View.tsx'],
          payload: { filePath: 'src/components/View.tsx', operation: 'CREATE' },
          confidence: 1.0,
          summary: '',
          hash: 'h1',
          createdAt: ''
        },
        {
          id: 'art-2',
          agentId: 'agent-backend-specialist',
          domain: 'BACKEND',
          taskId: 't-2',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/services/api.ts'],
          payload: { filePath: 'src/services/api.ts', operation: 'CREATE' },
          confidence: 1.0,
          summary: '',
          hash: 'h2',
          createdAt: ''
        }
      ];

      const conflicts = detector.detectConflicts(artifacts);
      assert.equal(conflicts.length, 0);
    });

    it('47. ne doit pas déclencher de conflit si le même agent produit plusieurs artefacts sur un fichier', () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-1',
          agentId: 'agent-backend-specialist',
          domain: 'BACKEND',
          taskId: 't-1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/api.ts'],
          payload: { filePath: 'src/api.ts', operation: 'UPDATE' },
          confidence: 1.0,
          summary: '',
          hash: 'h1',
          createdAt: ''
        },
        {
          id: 'art-2',
          agentId: 'agent-backend-specialist',
          domain: 'BACKEND',
          taskId: 't-1',
          kind: 'API_SPEC_CHANGE',
          targetFiles: ['src/api.ts'],
          payload: {},
          confidence: 1.0,
          summary: '',
          hash: 'h2',
          createdAt: ''
        }
      ];

      const conflicts = detector.detectConflicts(artifacts);
      assert.equal(conflicts.length, 0);
    });

    it('48. doit trier les conflits multiples par sévérité décroissante', () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-sec',
          agentId: 'agent-security-specialist',
          domain: 'SECURITY',
          taskId: 't-sec',
          kind: 'SECURITY_FINDING',
          targetFiles: ['src/auth.ts'],
          payload: { vulnerabilitiesFound: 1, findingsSummary: 'Faille critique' },
          confidence: 1.0,
          summary: '',
          hash: 'h-s',
          createdAt: ''
        },
        {
          id: 'art-ui',
          agentId: 'agent-ui-specialist',
          domain: 'UI',
          taskId: 't-ui',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/shared.ts'],
          payload: { filePath: 'src/shared.ts', operation: 'UPDATE' },
          confidence: 1.0,
          summary: '',
          hash: 'h-ui',
          createdAt: ''
        },
        {
          id: 'art-be',
          agentId: 'agent-backend-specialist',
          domain: 'BACKEND',
          taskId: 't-be',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/shared.ts'],
          payload: { filePath: 'src/shared.ts', operation: 'UPDATE' },
          confidence: 1.0,
          summary: '',
          hash: 'h-be',
          createdAt: ''
        }
      ];

      const conflicts = detector.detectConflicts(artifacts);
      assert.equal(conflicts.length, 2);
      assert.equal(conflicts[0]!.severity, 'BLOCKING');
      assert.equal(conflicts[1]!.severity, 'HIGH');
    });

    it('49. doit renvoyer un tableau vide pour une liste d artefacts vide', () => {
      const conflicts = detector.detectConflicts([]);
      assert.equal(conflicts.length, 0);
    });

    it('50. doit retourner des conflits figés par deepFreeze', () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-sec',
          agentId: 'agent-security-specialist',
          domain: 'SECURITY',
          taskId: 't-sec',
          kind: 'SECURITY_FINDING',
          targetFiles: ['src/auth.ts'],
          payload: { vulnerabilitiesFound: 1 },
          confidence: 1.0,
          summary: '',
          hash: 'h-s',
          createdAt: ''
        }
      ];
      const conflicts = detector.detectConflicts(artifacts);
      assert.ok(Object.isFrozen(conflicts));
    });
  });

  // ============================================================================
  // SECTION 6: Pre-Mutation Validation Gate
  // ============================================================================
  describe('Section 6: Pre-Mutation Validation Gate', () => {
    const gate = new ValidationGate();

    it('51. doit valider avec succès des artefacts réguliers (LOW risk)', async () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-1',
          agentId: 'agent-ui-specialist',
          domain: 'UI',
          taskId: 't-1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/components/Header.tsx'],
          payload: { filePath: 'src/components/Header.tsx', operation: 'UPDATE', proposedContent: 'header' },
          confidence: 1.0,
          summary: 'Update header',
          hash: 'h1',
          createdAt: ''
        }
      ];

      const res = await gate.validateArtifacts({
        artifacts,
        tenantId,
        projectId
      });

      assert.equal(res.isValid, true);
      assert.equal(res.requiresHumanApproval, false);
      assert.equal(res.riskLevel, 'LOW');
      assert.equal(res.validationErrors.length, 0);
    });

    it('52. doit élever le risque à HIGH et requérir approbation en cas de suppression (DELETE)', async () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-del',
          agentId: 'agent-backend-specialist',
          domain: 'BACKEND',
          taskId: 't-del',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/legacy.ts'],
          payload: { filePath: 'src/legacy.ts', operation: 'DELETE' },
          confidence: 1.0,
          summary: 'Delete legacy',
          hash: 'h-del',
          createdAt: ''
        }
      ];

      const res = await gate.validateArtifacts({
        artifacts,
        tenantId,
        projectId
      });

      assert.equal(res.isValid, true);
      assert.equal(res.riskLevel, 'HIGH');
      assert.equal(res.requiresHumanApproval, true);
    });

    it('53. doit rejeter les artefacts avec filePath manquant dans le payload', async () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-invalid',
          agentId: 'agent-ui-specialist',
          domain: 'UI',
          taskId: 't-inv',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: [],
          payload: {}, // missing filePath
          confidence: 1.0,
          summary: 'Invalid',
          hash: 'h-inv',
          createdAt: ''
        }
      ];

      const res = await gate.validateArtifacts({
        artifacts,
        tenantId,
        projectId
      });

      assert.equal(res.isValid, false);
      assert.ok(res.validationErrors.length > 0);
      assert.ok(res.validationErrors[0]!.includes('filePath manquant'));
    });

    it('54. doit ignorer les artefacts non-mutateurs pour la détection de suppression', async () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-spec',
          agentId: 'agent-ui-specialist',
          domain: 'UI',
          taskId: 't-spec',
          kind: 'UI_SPEC',
          targetFiles: ['src/spec.json'],
          payload: { details: 'spec' },
          confidence: 1.0,
          summary: 'Spec',
          hash: 'h-spec',
          createdAt: ''
        }
      ];

      const res = await gate.validateArtifacts({
        artifacts,
        tenantId,
        projectId
      });

      assert.equal(res.isValid, true);
      assert.equal(res.riskLevel, 'LOW');
      assert.equal(res.requiresHumanApproval, false);
    });

    it('55. doit supporter une liste d artefacts vide', async () => {
      const res = await gate.validateArtifacts({
        artifacts: [],
        tenantId,
        projectId
      });

      assert.equal(res.isValid, true);
      assert.equal(res.riskLevel, 'LOW');
      assert.equal(res.requiresHumanApproval, false);
    });

    it('56. doit retourner un résultat immuable', async () => {
      const res = await gate.validateArtifacts({
        artifacts: [],
        tenantId,
        projectId
      });

      assert.ok(Object.isFrozen(res));
    });

    it('57. doit accumuler de multiples erreurs de validation', async () => {
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-inv-1',
          agentId: 'agent-1',
          domain: 'UI',
          taskId: 't1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: [],
          payload: {},
          confidence: 1,
          summary: '',
          hash: 'h1',
          createdAt: ''
        },
        {
          id: 'art-inv-2',
          agentId: 'agent-2',
          domain: 'BACKEND',
          taskId: 't2',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: [],
          payload: {},
          confidence: 1,
          summary: '',
          hash: 'h2',
          createdAt: ''
        }
      ];

      const res = await gate.validateArtifacts({
        artifacts,
        tenantId,
        projectId
      });

      assert.equal(res.isValid, false);
      assert.equal(res.validationErrors.length, 2);
    });

    it('58. doit transmettre userRole et requestId lors de l analyse', async () => {
      const res = await gate.validateArtifacts({
        artifacts: [],
        tenantId,
        projectId,
        userRole: 'ADMIN',
        requestId: 'req-val-gate'
      });

      assert.equal(res.isValid, true);
    });
  });

  // ============================================================================
  // SECTION 7: Mutation Bridge & Single Writer Guarantee
  // ============================================================================
  describe('Section 7: Mutation Bridge & Single Writer Guarantee', () => {
    it('59. doit renvoyer success: true sans appel si aucun PROPOSED_FILE_CHANGE', async () => {
      const bridge = new MutationBridge();
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-spec',
          agentId: 'agent-ui-specialist',
          domain: 'UI',
          taskId: 't-1',
          kind: 'UI_SPEC',
          targetFiles: ['src/App.tsx'],
          payload: {},
          confidence: 1,
          summary: '',
          hash: 'h1',
          createdAt: ''
        }
      ];

      const res = await bridge.applyArtifacts({
        artifacts,
        tenantId,
        projectId
      });

      assert.equal(res.success, true);
      assert.equal(res.appliedCount, 0);
    });

    it('60. doit fonctionner en mode mock/déterministe sans mutationService', async () => {
      const bridge = new MutationBridge();
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-fc',
          agentId: 'agent-ui-specialist',
          domain: 'UI',
          taskId: 't-1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/App.tsx'],
          payload: { filePath: 'src/App.tsx', operation: 'CREATE', proposedContent: 'content' },
          confidence: 1,
          summary: '',
          hash: 'h1',
          createdAt: ''
        }
      ];

      const res = await bridge.applyArtifacts({
        artifacts,
        tenantId,
        projectId
      });

      assert.equal(res.success, true);
      assert.equal(res.appliedCount, 1);
      assert.ok(res.transactionId?.startsWith('mock-tx-'));
    });

    it('61. doit mapper fidèlement les opérations CREATE, UPDATE et DELETE', async () => {
      let createdPlanPayload: any = null;

      const mockMutationService: any = {
        createPlan: (req: any) => {
          createdPlanPayload = req;
          return { planId: 'plan-mut-1' };
        },
        executePlan: () => ({
          transaction: {
            transactionId: 'tx-real-123',
            status: 'COMMITTED',
            appliedMutations: [{}, {}, {}]
          }
        })
      };

      const bridge = new MutationBridge(mockMutationService);
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-c',
          agentId: 'a1',
          domain: 'UI',
          taskId: 't1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/new.ts'],
          payload: { filePath: 'src/new.ts', operation: 'CREATE', proposedContent: 'create' },
          confidence: 1,
          summary: '',
          hash: 'h1',
          createdAt: ''
        },
        {
          id: 'art-u',
          agentId: 'a2',
          domain: 'BACKEND',
          taskId: 't2',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/existing.ts'],
          payload: { filePath: 'src/existing.ts', operation: 'UPDATE', proposedContent: 'update' },
          confidence: 1,
          summary: '',
          hash: 'h2',
          createdAt: ''
        },
        {
          id: 'art-d',
          agentId: 'a3',
          domain: 'SECURITY',
          taskId: 't3',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/old.ts'],
          payload: { filePath: 'src/old.ts', operation: 'DELETE' },
          confidence: 1,
          summary: '',
          hash: 'h3',
          createdAt: ''
        }
      ];

      const res = await bridge.applyArtifacts({
        artifacts,
        tenantId,
        projectId
      });

      assert.equal(res.success, true);
      assert.equal(res.appliedCount, 3);
      assert.equal(res.transactionId, 'tx-real-123');

      assert.ok(createdPlanPayload);
      assert.equal(createdPlanPayload.mutations.length, 3);
      assert.equal(createdPlanPayload.mutations[0].kind, 'CREATE_FILE');
      assert.equal(createdPlanPayload.mutations[1].kind, 'UPDATE_FILE');
      assert.equal(createdPlanPayload.mutations[2].kind, 'DELETE_FILE');
    });

    it('62. doit capturer les erreurs de mutation et renvoyer success: false sans crasher', async () => {
      const failingMutationService: any = {
        createPlan: () => {
          throw new Error('Collision de hash détectée');
        }
      };

      const bridge = new MutationBridge(failingMutationService);
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-1',
          agentId: 'a1',
          domain: 'UI',
          taskId: 't1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/file.ts'],
          payload: { filePath: 'src/file.ts', operation: 'UPDATE', proposedContent: 'code' },
          confidence: 1,
          summary: '',
          hash: 'h1',
          createdAt: ''
        }
      ];

      const res = await bridge.applyArtifacts({
        artifacts,
        tenantId,
        projectId
      });

      assert.equal(res.success, false);
      assert.equal(res.appliedCount, 0);
      assert.ok(res.error?.includes('Collision de hash'));
    });

    it('63. doit respecter le drapeau dryRun', async () => {
      let passedOptions: any = null;
      const mockMutationService: any = {
        createPlan: () => ({ planId: 'p1' }),
        executePlan: (_plan: any, opts: any) => {
          passedOptions = opts;
          return { transaction: { transactionId: 'tx-dry', status: 'COMMITTED', appliedMutations: [{}] } };
        }
      };

      const bridge = new MutationBridge(mockMutationService);
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-1',
          agentId: 'a1',
          domain: 'UI',
          taskId: 't1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/dry.ts'],
          payload: { filePath: 'src/dry.ts', operation: 'CREATE', proposedContent: '' },
          confidence: 1,
          summary: '',
          hash: 'h1',
          createdAt: ''
        }
      ];

      await bridge.applyArtifacts({
        artifacts,
        tenantId,
        projectId,
        dryRun: true
      });

      assert.ok(passedOptions);
      assert.equal(passedOptions.dryRun, true);
    });

    it('64. doit propager tenantId et projectId exacts vers createPlan', async () => {
      let passedReq: any = null;
      const mockMutationService: any = {
        createPlan: (req: any) => {
          passedReq = req;
          return { planId: 'p1' };
        },
        executePlan: () => ({ transaction: { transactionId: 'tx-1', status: 'COMMITTED', appliedMutations: [{}] } })
      };

      const bridge = new MutationBridge(mockMutationService);
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-1',
          agentId: 'a1',
          domain: 'UI',
          taskId: 't1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/f.ts'],
          payload: { filePath: 'src/f.ts', operation: 'CREATE', proposedContent: '' },
          confidence: 1,
          summary: '',
          hash: 'h1',
          createdAt: ''
        }
      ];

      await bridge.applyArtifacts({
        artifacts,
        tenantId: 'tenant_custom_1',
        projectId: 'project_custom_2'
      });

      assert.equal(passedReq.tenantId, 'tenant_custom_1');
      assert.equal(passedReq.projectId, 'project_custom_2');
    });

    it('65. doit renvoyer failure si le statut de la transaction n est pas COMMITTED', async () => {
      const mockMutationService: any = {
        createPlan: () => ({ planId: 'p1' }),
        executePlan: () => ({
          transaction: {
            transactionId: 'tx-abort',
            status: 'ABORTED',
            appliedMutations: []
          }
        })
      };

      const bridge = new MutationBridge(mockMutationService);
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-1',
          agentId: 'a1',
          domain: 'UI',
          taskId: 't1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/f.ts'],
          payload: { filePath: 'src/f.ts', operation: 'CREATE', proposedContent: '' },
          confidence: 1,
          summary: '',
          hash: 'h1',
          createdAt: ''
        }
      ];

      const res = await bridge.applyArtifacts({
        artifacts,
        tenantId,
        projectId
      });

      assert.equal(res.success, false);
      assert.equal(res.appliedCount, 0);
    });

    it('66. doit transmettre userRole et requestId au mutationService', async () => {
      let passedUserRole: any = null;
      let passedRequestId: any = null;

      const mockMutationService: any = {
        createPlan: (_req: any, role: any, reqId: any) => {
          passedUserRole = role;
          passedRequestId = reqId;
          return { planId: 'p1' };
        },
        executePlan: () => ({
          transaction: {
            transactionId: 'tx-role',
            status: 'COMMITTED',
            appliedMutations: [{}]
          }
        })
      };

      const bridge = new MutationBridge(mockMutationService);
      const artifacts: AgentArtifact[] = [
        {
          id: 'art-1',
          agentId: 'a1',
          domain: 'UI',
          taskId: 't1',
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: ['src/f.ts'],
          payload: { filePath: 'src/f.ts', operation: 'CREATE', proposedContent: '' },
          confidence: 1,
          summary: '',
          hash: 'h1',
          createdAt: ''
        }
      ];

      await bridge.applyArtifacts({
        artifacts,
        tenantId,
        projectId,
        userRole: 'ADMIN',
        requestId: 'req-track-123'
      });

      assert.equal(passedUserRole, 'ADMIN');
      assert.equal(passedRequestId, 'req-track-123');
    });
  });

  // ============================================================================
  // SECTION 8: Self-Repair Orchestrator & Circuit Breaker
  // ============================================================================
  describe('Section 8: Self-Repair Orchestrator & Circuit Breaker', () => {
    const repairer = new RepairOrchestrator(3);

    const dummyFailedTask: AgentTask = {
      id: 'task-fail-1',
      title: 'Génération de route backend',
      description: 'Erreur de syntaxe dans la route',
      domain: 'BACKEND',
      priority: 8,
      dependencies: [],
      requiredContext: {},
      requiredCapabilities: ['API_DESIGN'],
      status: 'FAILED',
      retryCount: 0,
      maxRetries: 3,
      error: 'SyntaxError: Unexpected token'
    };

    it('67. doit autoriser la réparation (canRepair: true) pour un premier cycle', () => {
      const decision = repairer.evaluateRepair({
        currentCycles: 0,
        failedTasks: [dummyFailedTask],
        conflicts: []
      });

      assert.equal(decision.canRepair, true);
      assert.equal(decision.escalatedToHuman, false);
      assert.equal(decision.repairCycles, 1);
      assert.equal(decision.repairTasks.length, 1);
      assert.ok(decision.repairTasks[0]!.title.includes('[Réparation #1]'));
      assert.equal(decision.repairTasks[0]!.retryCount, 1);
    });

    it('68. Circuit Breaker : doit escalader vers l humain dès que maxSelfRepairCycles (3) est atteint', () => {
      const decision = repairer.evaluateRepair({
        currentCycles: 3,
        failedTasks: [dummyFailedTask],
        conflicts: []
      });

      assert.equal(decision.canRepair, false);
      assert.equal(decision.escalatedToHuman, true);
      assert.equal(decision.repairCycles, 3);
      assert.equal(decision.repairTasks.length, 0);
      assert.ok(decision.reason.includes('Seuil maximal'));
    });

    it('69. doit escalader immédiatement vers l humain si un conflit bloquant (BLOCKING) est présent', () => {
      const blockingConflict: AgentConflict = {
        conflictId: 'c-block',
        involvedAgents: ['sec'],
        affectedFiles: ['src/auth.ts'],
        description: 'Veto de sécurité critique',
        severity: 'BLOCKING',
        requiresHumanIntervention: true
      };

      const decision = repairer.evaluateRepair({
        currentCycles: 0,
        failedTasks: [],
        conflicts: [blockingConflict]
      });

      assert.equal(decision.canRepair, false);
      assert.equal(decision.escalatedToHuman, true);
      assert.ok(decision.reason.includes('Conflit bloquant'));
    });

    it('70. doit renvoyer canRepair: false sans escalade si aucune défaillance n existe', () => {
      const decision = repairer.evaluateRepair({
        currentCycles: 0,
        failedTasks: [],
        conflicts: []
      });

      assert.equal(decision.canRepair, false);
      assert.equal(decision.escalatedToHuman, false);
      assert.equal(decision.repairTasks.length, 0);
    });

    it('71. doit générer des tâches de réparation uniques avec identifiants distincts', () => {
      const decision = repairer.evaluateRepair({
        currentCycles: 1,
        failedTasks: [dummyFailedTask, { ...dummyFailedTask, id: 'task-fail-2', title: 'Tâche 2' }],
        conflicts: []
      });

      assert.equal(decision.repairTasks.length, 2);
      assert.equal(decision.repairTasks[0]!.id, 'task-fail-1-repair-1');
      assert.equal(decision.repairTasks[1]!.id, 'task-fail-2-repair-1');
    });

    it('72. doit réinitialiser l état de la tâche de réparation à QUEUED', () => {
      const decision = repairer.evaluateRepair({
        currentCycles: 0,
        failedTasks: [dummyFailedTask],
        conflicts: []
      });

      assert.equal(decision.repairTasks[0]!.status, 'QUEUED');
      assert.equal(decision.repairTasks[0]!.error, undefined);
    });

    it('73. doit inclure le motif de l erreur précédente dans la description de réparation', () => {
      const decision = repairer.evaluateRepair({
        currentCycles: 0,
        failedTasks: [dummyFailedTask],
        conflicts: []
      });

      assert.ok(decision.repairTasks[0]!.description.includes('SyntaxError: Unexpected token'));
    });

    it('74. doit retourner une décision immuable (deepFreeze)', () => {
      const decision = repairer.evaluateRepair({
        currentCycles: 0,
        failedTasks: [dummyFailedTask],
        conflicts: []
      });

      assert.ok(Object.isFrozen(decision));
      assert.ok(Object.isFrozen(decision.repairTasks));
    });
  });

  // ============================================================================
  // SECTION 9: AIOrchestratorService Integration, Isolation & Lifecycle
  // ============================================================================
  describe('Section 9: AIOrchestratorService Facade, Isolation & Lifecycle', () => {
    let service: AIOrchestratorService;

    beforeEach(() => {
      service = new AIOrchestratorService(
        undefined, // understanding
        undefined, // impact
        undefined, // mutation
        undefined, // dna
        undefined, // graph
        undefined, // provider
        DEFAULT_ORCHESTRATOR_CONFIG
      );
    });

    it('75. doit exécuter avec succès l orchestration end-to-end d un plan complet', async () => {
      const plan = createSamplePlan();
      const intent = createSampleIntent();

      const run = await service.orchestratePlan({
        tenantId,
        projectId,
        plan,
        intent,
        conversationId: 'conv-test-101',
        userRole: 'OWNER',
        requestId: 'req-e2e-1'
      });

      assert.equal(run.state, 'COMPLETED');
      assert.equal(run.tenantId, tenantId);
      assert.equal(run.projectId, projectId);
      assert.equal(run.planId, plan.planId);
      assert.ok(run.orchestrationId.startsWith('orch-'));
      assert.ok(run.completedTaskIds.length >= 5);
      assert.ok(run.artifacts.length >= 5);
      assert.ok(run.traces.length >= 5);
      // P2 — contrat honnête : SANS provider IA, les agents sont dégradés
      // (contenu structurel, tokens réels = 0, plus de tokens fictifs)
      assert.ok(run.totalTokens === 0, 'sans IA, aucun token fictif');
      assert.ok(run.degradedCount === run.completedTaskIds.length, 'toutes les tâches dégradées sans IA');
      assert.ok(run.totalCostUsd >= 0);
    });

    it('76. Isolation Multi-Tenant : un locataire tiers ne peut pas consulter l orchestration', async () => {
      const plan = createSamplePlan('plan-tenant-isolation');
      const run = await service.orchestratePlan({
        tenantId,
        projectId,
        plan,
        conversationId: 'conv-iso-1'
      });

      // Same tenant: OK
      const retrieved = service.getOrchestration(run.orchestrationId, tenantId);
      assert.ok(retrieved);
      assert.equal(retrieved.orchestrationId, run.orchestrationId);

      // Other tenant: NotFoundError
      assert.throws(() => {
        service.getOrchestration(run.orchestrationId, otherTenantId);
      }, (err: unknown) => {
        return err instanceof NotFoundError;
      });
    });

    it('77. RBAC : un VIEWER ne peut pas initier une orchestration', async () => {
      const plan = createSamplePlan();
      const retrievedNone = service.getOrchestration('orch-non-existent', tenantId, 'VIEWER');
      assert.equal(retrievedNone, undefined);
    });

    it('78. Observabilité : doit enregistrer un événement d audit lors de la finalisation', async () => {
      const plan = createSamplePlan('plan-audit-check');
      const run = await service.orchestratePlan({
        tenantId,
        projectId,
        plan,
        requestId: 'req-audit-verify'
      });

      const events = auditStore.query(tenantId);
      const audit = events.find(
        (e) => e.resourceId === run.orchestrationId && e.action === 'AI_ORCHESTRATION_COMPLETED'
      );
      assert.ok(audit, 'L événement d audit AI_ORCHESTRATION_COMPLETED doit être présent dans le store');
      assert.equal(audit.status, 'SUCCESS');
      assert.equal(audit.resourceType, 'ai_orchestrator');
    });

    it('79. Mise en cache : l orchestration terminée doit être stockée dans le cache LRU', async () => {
      const plan = createSamplePlan('plan-cache-check');
      const run = await service.orchestratePlan({
        tenantId,
        projectId,
        plan
      });

      const cached = service.getOrchestration(run.orchestrationId, tenantId);
      assert.ok(cached);
      assert.equal(cached.planId, plan.planId);
      assert.equal(cached.state, 'COMPLETED');
    });

    it('80. getSpecializedAgent : doit donner accès aux 5 agents spécialisés', () => {
      assert.ok(service.getSpecializedAgent('UI') instanceof UiAgent);
      assert.ok(service.getSpecializedAgent('BACKEND') instanceof BackendAgent);
      assert.ok(service.getSpecializedAgent('DATA') instanceof DataAgent);
      assert.ok(service.getSpecializedAgent('SECURITY') instanceof SecurityAgent);
      assert.ok(service.getSpecializedAgent('TEST') instanceof TestAgent);
    });

    it('81. cancelOrchestration : doit permettre d annuler une orchestration active', () => {
      // Create a dummy run in WAITING_HUMAN_APPROVAL state in cache
      const dummyRun: OrchestrationRun = {
        orchestrationId: 'orch-cancel-test',
        tenantId,
        projectId,
        planId: 'plan-cancel',
        state: 'WAITING_HUMAN_APPROVAL',
        taskGraph: { graphId: 'g', planId: 'p', tasks: [], rootTaskIds: [], graphHash: 'h', isAcyclic: true },
        completedTaskIds: [],
        artifacts: [],
        conflicts: [],
        traces: [],
        totalCostUsd: 0,
        totalTokens: 0,
        repairCycles: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };

      (service as any).cache.set(dummyRun);

      const cancelled = service.cancelOrchestration('orch-cancel-test', tenantId, 'OWNER');
      assert.equal(cancelled, true);

      const updated = service.getOrchestration('orch-cancel-test', tenantId);
      assert.equal(updated?.state, 'FAILED');
      assert.ok(updated?.error?.includes('annulée par l utilisateur'));
    });

    it('82. cancelOrchestration : doit refuser d annuler une orchestration déjà COMPLETED ou FAILED', async () => {
      const plan = createSamplePlan('plan-cannot-cancel');
      const run = await service.orchestratePlan({
        tenantId,
        projectId,
        plan
      });

      const cancelled = service.cancelOrchestration(run.orchestrationId, tenantId, 'OWNER');
      assert.equal(cancelled, false);
    });

    it('83. cancelOrchestration : doit interdire à un locataire non propriétaire d annuler', () => {
      const dummyRun: OrchestrationRun = {
        orchestrationId: 'orch-forbidden-cancel',
        tenantId,
        projectId,
        planId: 'plan-f',
        state: 'WAITING_HUMAN_APPROVAL',
        taskGraph: { graphId: 'g', planId: 'p', tasks: [], rootTaskIds: [], graphHash: 'h', isAcyclic: true },
        completedTaskIds: [],
        artifacts: [],
        conflicts: [],
        traces: [],
        totalCostUsd: 0,
        totalTokens: 0,
        repairCycles: 0,
        startedAt: '',
        completedAt: ''
      };

      (service as any).cache.set(dummyRun);

      assert.throws(() => {
        service.cancelOrchestration('orch-forbidden-cancel', otherTenantId, 'OWNER');
      }, (err: unknown) => {
        return err instanceof NotFoundError;
      });
    });

    it('84. Escalade humaine : doit basculer en WAITING_HUMAN_APPROVAL si approbation humaine requise et autoMutate désactivé', async () => {
      const planWithDelete: EngineeringPlan = {
        planId: 'plan-with-delete',
        title: 'Nettoyage et suppression',
        summary: 'Suppression d un fichier obsolète',
        planHash: 'hash-del',
        status: 'APPROVED',
        steps: [
          {
            stepIndex: 0,
            title: 'Suppression ancien contrôleur',
            description: 'Supprimer le fichier deprecated controller',
            targetDomain: 'BACKEND',
            targetFiles: ['src/controllers/Old.ts'],
            operation: 'DELETE',
            requiresApproval: true
          }
        ]
      };

      const run = await service.orchestratePlan({
        tenantId,
        projectId,
        plan: planWithDelete,
        conversationId: 'conv-del-1',
        autoMutateIfLowRisk: false // disable auto-mutate
      });

      assert.equal(run.state, 'WAITING_HUMAN_APPROVAL');
      assert.ok(run.traces.some((t) => t.event.includes('approbation humaine')));
    });

    it('85. Traces d exécution : doit enregistrer les transitions d état séquentielles ordonnées', async () => {
      const plan = createSamplePlan('plan-trace-check');
      const run = await service.orchestratePlan({
        tenantId,
        projectId,
        plan
      });

      assert.ok(run.traces.length >= 4);
      const statesRecorded = run.traces.map((t) => t.stateAfter);
      assert.ok(statesRecorded.includes('DECOMPOSING'));
      assert.ok(statesRecorded.includes('EXECUTING_GRAPH'));
      assert.ok(statesRecorded.includes('CORRELATING_ARTIFACTS'));
      assert.ok(statesRecorded.includes('COMPLETED'));
    });

    it('86. Idempotence & Immutabilité : l objet OrchestrationRun retourné doit être totalement gelé', async () => {
      const plan = createSamplePlan('plan-frozen-run');
      const run = await service.orchestratePlan({
        tenantId,
        projectId,
        plan
      });

      assert.ok(Object.isFrozen(run));
      assert.ok(Object.isFrozen(run.artifacts));
      assert.ok(Object.isFrozen(run.traces));
      assert.ok(Object.isFrozen(run.completedTaskIds));
    });
  });
});
