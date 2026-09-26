/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * AI Orchestration & Agent Execution Engine - Advanced Verification Suite
 *
 * Covers:
 * A — Agent Registry & 9 Specialized Roles
 * B — Tool Registry, 12 Standard Tools & Capability Boundaries
 * C — Task DAG, Cycles, Topological Sort & Parallel Batches
 * D — 12-State Deterministic State Machine
 * E — Impact Gate & Mutation Gate
 * F — Recovery Taxonomy & Rollback Engine (8 Error Kinds)
 * G — Observability & Orchestration Metrics
 * H — End-to-End Orchestration
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  AgentOrchestrator,
  AgentRegistry,
  Agent,
  createAgentDefinition,
  ToolRegistry,
  TaskDAG,
  TaskScheduler,
  createExecutionTask,
  AgentStateMachine,
  RecoveryEngine,
  OrchestrationMetricsManager,
  CycleDetectedError,
  AgentCapabilityError,
  GateRejectedError,
  RecoveryExhaustedError,
  InvalidStateTransitionError,
  ValidationError,
  ForbiddenError,
  STANDARD_TOOL_NAMES,
  TOOL_DEFINITIONS,
  type AgentRole,
  type ExecutionTask
} from '../../../src/index.js';

describe('AINT-007 : AI Orchestration & Multi-Agent Execution Engine', () => {

  // ==========================================================================
  // A — Agent Registry & 9 Specialized Roles
  // ==========================================================================
  describe('A. Agent Registry & Specialized Roles', () => {
    let registry: AgentRegistry;

    beforeEach(() => {
      registry = new AgentRegistry();
    });

    it('A.1 doit enregistrer les 9 agents spécialisés par défaut', () => {
      const requiredRoles: AgentRole[] = [
        'ARCHITECT_AGENT',
        'CODE_AGENT',
        'UI_AGENT',
        'BACKEND_AGENT',
        'DATABASE_AGENT',
        'SECURITY_AGENT',
        'TEST_AGENT',
        'DEBUG_AGENT',
        'REVIEW_AGENT'
      ];

      for (const role of requiredRoles) {
        const agent = registry.getByRole(role);
        assert.ok(agent, `L agent ${role} doit être présent dans le registre`);
        assert.strictEqual(agent.agentType, role);
        assert.ok(agent.allowedOperations.length > 0, `L agent ${role} doit avoir des opérations autorisées`);
      }
    });

    it('A.2 doit empêcher l enregistrement de doublons avec ValidationError', () => {
      const def = createAgentDefinition('CODE_AGENT', 'agent-duplicate-test');
      registry.register(def);

      assert.throws(
        () => {
          registry.register(def);
        },
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('déjà enregistré'));
          return true;
        }
      );
    });

    it('A.3 doit valider les capability boundaries des agents', () => {
      const reviewDef = registry.getByRole('REVIEW_AGENT')!;
      const reviewAgent = new Agent(reviewDef);

      assert.strictEqual(reviewAgent.canPerform('READ_FILE'), true);
      assert.strictEqual(reviewAgent.canPerform('read_file'), true);
      // REVIEW_AGENT cannot execute mutations
      assert.strictEqual(reviewAgent.canPerform('EXECUTE_MUTATION'), false);

      const codeDef = registry.getByRole('CODE_AGENT')!;
      const codeAgent = new Agent(codeDef);
      assert.strictEqual(codeAgent.canPerform('EXECUTE_MUTATION'), true);
    });
  });

  // ==========================================================================
  // B — Tool Registry, 12 Standard Tools & Capability Boundaries
  // ==========================================================================
  describe('B. Tool Registry & Standard Tools', () => {
    let toolRegistry: ToolRegistry;

    beforeEach(() => {
      toolRegistry = new ToolRegistry();
    });

    it('B.1 doit contenir les 12 outils standards officiels', () => {
      for (const toolName of STANDARD_TOOL_NAMES) {
        assert.strictEqual(toolRegistry.has(toolName), true, `Outil standard ${toolName} manquant`);
        const def = toolRegistry.get(toolName);
        assert.ok(def, `Définition de ${toolName} introuvable`);
        assert.ok(def.name);
        assert.ok(def.permissions.length > 0);
      }
      assert.strictEqual(STANDARD_TOOL_NAMES.length, 12);
    });

    it('B.2 doit supporter la résolution insensible à la casse (alias)', () => {
      assert.ok(toolRegistry.get('read_file'));
      assert.ok(toolRegistry.get('READ_FILE'));
      assert.ok(toolRegistry.get('search_code'));
      assert.ok(toolRegistry.get('SEARCH_CODE'));
      assert.ok(toolRegistry.get('execute_mutation'));
      assert.ok(toolRegistry.get('EXECUTE_MUTATION'));
    });

    it('B.3 doit bloquer un agent dont les allowedTools excluent l outil demandé (AgentCapabilityError)', async () => {
      const ctx = {
        tenantId: 't-1',
        projectId: 'p-1',
        runId: 'r-1',
        userRole: 'ENGINEER' as const,
        agentRole: 'REVIEW_AGENT' as const,
        allowedTools: ['READ_FILE', 'SEARCH_CODE']
      };

      await assert.rejects(
        async () => {
          await toolRegistry.execute('EXECUTE_MUTATION', { plan: {} }, ctx);
        },
        (err: unknown) => {
          assert.ok(err instanceof AgentCapabilityError);
          assert.strictEqual(err.statusCode, 403);
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // C — Task DAG Engine (Cycles, Topological Sort, Parallel Batches)
  // ==========================================================================
  describe('C. Task DAG Engine', () => {
    it('C.1 doit ordonner les tâches selon le tri topologique déterministe', () => {
      const dag = new TaskDAG();
      const t1 = createExecutionTask({ taskId: 'task-1', description: 't1', requiredAgent: 'ARCHITECT_AGENT' });
      const t2 = createExecutionTask({ taskId: 'task-2', description: 't2', dependencies: ['task-1'], requiredAgent: 'CODE_AGENT' });
      const t3 = createExecutionTask({ taskId: 'task-3', description: 't3', dependencies: ['task-2'], requiredAgent: 'TEST_AGENT' });

      dag.addTask(t3);
      dag.addTask(t1);
      dag.addTask(t2);

      const sorted = dag.getTopologicalOrder();
      assert.strictEqual(sorted.length, 3);
      assert.strictEqual(sorted[0]!.taskId, 'task-1');
      assert.strictEqual(sorted[1]!.taskId, 'task-2');
      assert.strictEqual(sorted[2]!.taskId, 'task-3');
    });

    it('C.2 doit calculer les lots d exécution parallèle (batches)', () => {
      const dag = new TaskDAG();
      const tRoot = createExecutionTask({ taskId: 't-root', description: 'root', requiredAgent: 'ARCHITECT_AGENT' });
      const tA = createExecutionTask({ taskId: 't-a', description: 'a', dependencies: ['t-root'], requiredAgent: 'CODE_AGENT' });
      const tB = createExecutionTask({ taskId: 't-b', description: 'b', dependencies: ['t-root'], requiredAgent: 'UI_AGENT' });
      const tMerge = createExecutionTask({ taskId: 't-merge', description: 'merge', dependencies: ['t-a', 't-b'], requiredAgent: 'REVIEW_AGENT' });

      dag.addTask(tRoot);
      dag.addTask(tA);
      dag.addTask(tB);
      dag.addTask(tMerge);

      const batches = dag.getExecutionBatches();
      assert.strictEqual(batches.length, 3);

      // Batch 0: [t-root]
      assert.strictEqual(batches[0]!.length, 1);
      assert.strictEqual(batches[0]![0]!.taskId, 't-root');

      // Batch 1: [t-a, t-b] (parallel)
      assert.strictEqual(batches[1]!.length, 2);
      const batch1Ids = batches[1]!.map((t) => t.taskId).sort();
      assert.deepStrictEqual(batch1Ids, ['t-a', 't-b']);

      // Batch 2: [t-merge]
      assert.strictEqual(batches[2]!.length, 1);
      assert.strictEqual(batches[2]![0]!.taskId, 't-merge');
    });

    it('C.3 doit détecter les cycles directs et lever CycleDetectedError', () => {
      const dag = new TaskDAG();
      const t1 = createExecutionTask({ taskId: 't-1', description: 't1', dependencies: ['t-2'], requiredAgent: 'CODE_AGENT' });
      const t2 = createExecutionTask({ taskId: 't-2', description: 't2', dependencies: ['t-1'], requiredAgent: 'TEST_AGENT' });

      dag.addTask(t1);
      dag.addTask(t2);

      assert.throws(
        () => {
          dag.validate();
        },
        (err: unknown) => {
          assert.ok(err instanceof CycleDetectedError);
          assert.strictEqual(err.statusCode, 400);
          return true;
        }
      );
    });

    it('C.4 doit détecter les cycles indirects complexes (A -> B -> C -> A)', () => {
      const dag = new TaskDAG();
      const tA = createExecutionTask({ taskId: 'A', description: 'A', dependencies: ['C'], requiredAgent: 'CODE_AGENT' });
      const tB = createExecutionTask({ taskId: 'B', description: 'B', dependencies: ['A'], requiredAgent: 'CODE_AGENT' });
      const tC = createExecutionTask({ taskId: 'C', description: 'C', dependencies: ['B'], requiredAgent: 'CODE_AGENT' });

      dag.addTask(tA);
      dag.addTask(tB);
      dag.addTask(tC);

      assert.throws(
        () => {
          dag.getTopologicalOrder();
        },
        (err: unknown) => {
          assert.ok(err instanceof CycleDetectedError);
          return true;
        }
      );
    });

    it('C.5 doit ordonner de manière déterministe les tâches indépendantes par taskId', () => {
      const dag1 = new TaskDAG();
      const dag2 = new TaskDAG();

      const tasks = ['z-task', 'a-task', 'm-task', 'b-task'].map((id) =>
        createExecutionTask({ taskId: id, description: id, requiredAgent: 'CODE_AGENT' })
      );

      for (const t of tasks) dag1.addTask(t);
      for (const t of [...tasks].reverse()) dag2.addTask(t);

      const order1 = dag1.getTopologicalOrder().map((t) => t.taskId);
      const order2 = dag2.getTopologicalOrder().map((t) => t.taskId);

      assert.deepStrictEqual(order1, ['a-task', 'b-task', 'm-task', 'z-task']);
      assert.deepStrictEqual(order2, ['a-task', 'b-task', 'm-task', 'z-task']);
    });
  });

  // ==========================================================================
  // D — 12-State Deterministic State Machine
  // ==========================================================================
  describe('D. 12-State Machine Lifecycle', () => {
    it('D.1 doit parcourir le cycle complet des 12 états', () => {
      const sm = new AgentStateMachine('test-run', 'RECEIVED');
      assert.strictEqual(sm.getState(), 'RECEIVED');

      sm.transition('UNDERSTANDING', 'comprendre intention');
      sm.transition('PLANNING', 'generer plan');
      sm.transition('CONTEXT_BUILDING', 'assembler contexte');
      sm.transition('EXECUTING', 'lancer execution');
      sm.transition('MUTATING', 'mutation via AINT-006');
      sm.transition('VERIFYING', 'validation post-mutation');
      sm.transition('REPAIRING', 'boucle de reparation');
      sm.transition('MUTATING', 'mutation de reparation');
      sm.transition('VERIFYING', 'nouvelle verification');
      sm.transition('COMPLETED', 'succes');

      assert.strictEqual(sm.getState(), 'COMPLETED');
      assert.strictEqual(sm.isTerminal(), true);
      assert.strictEqual(sm.getHistory().length, 10);
    });

    it('D.2 doit rejeter une transition illégale avec InvalidStateTransitionError', () => {
      const sm = new AgentStateMachine('test-illegal', 'RECEIVED');

      assert.throws(
        () => {
          sm.transition('MUTATING', 'saut interdit');
        },
        (err: unknown) => {
          assert.ok(err instanceof InvalidStateTransitionError);
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // E — Impact Gate & Mutation Gate
  // ==========================================================================
  describe('E. Impact Gate & Security Boundaries', () => {
    let orchestrator: AgentOrchestrator;

    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    it('E.1 doit valider l impact gate pour un rôle autorisé avec risque faible', async () => {
      const res = await orchestrator.evaluateImpactGate(
        ['src/button.tsx'],
        'tenant-1',
        'proj-1',
        'ENGINEER'
      );
      assert.strictEqual(res.passed, true);
      assert.strictEqual(orchestrator.getState(), 'WAITING_GATE');
    });

    it('E.2 doit enregistrer un échec de gate dans les métriques', () => {
      const metricsMgr = new OrchestrationMetricsManager();
      metricsMgr.recordGateEvaluated(false);

      const metrics = metricsMgr.getMetrics();
      assert.strictEqual(metrics.impactGates, 1);
      assert.strictEqual(metrics.blockedMutations, 1);
    });
  });

  // ==========================================================================
  // F — Recovery Taxonomy & Rollback Engine (8 Error Kinds)
  // ==========================================================================
  describe('F. Recovery Engine & Error Taxonomy', () => {
    let recovery: RecoveryEngine;

    beforeEach(() => {
      recovery = new RecoveryEngine(undefined, 3, 3);
    });

    it('F.1 doit classifier fidèlement les 8 types d erreur', () => {
      assert.strictEqual(recovery.classifyError(new Error('connection timeout network')), 'TRANSIENT_ERROR');
      assert.strictEqual(recovery.classifyError(new Error('LLM model output hallucination')), 'MODEL_ERROR');
      assert.strictEqual(recovery.classifyError(new Error('champ requis manquant schema validation')), 'VALIDATION_ERROR');
      assert.strictEqual(recovery.classifyError(new Error('ToolExecutionError: outil non disponible')), 'TOOL_ERROR');
      assert.strictEqual(recovery.classifyError(new Error('StalePlanError: graph hash mismatch')), 'STALE_CONTEXT');
      assert.strictEqual(recovery.classifyError(new Error('GateRejectedError: rayon d explosion')), 'IMPACT_FAILURE');
      assert.strictEqual(recovery.classifyError(new Error('mutation failed: precondition')), 'MUTATION_FAILURE');
      assert.strictEqual(recovery.classifyError(new Error('post-mutation verification failed')), 'POST_VALIDATION_FAILURE');
    });

    it('F.2 doit lever RecoveryExhaustedError lorsque le budget de retry est épuisé', async () => {
      await assert.rejects(
        async () => {
          await recovery.handleError({
            error: new Error('connection timeout'),
            errorKind: 'TRANSIENT_ERROR',
            attempt: 3,
            userRole: 'ENGINEER'
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof RecoveryExhaustedError);
          assert.strictEqual(err.statusCode, 500);
          return true;
        }
      );
    });

    it('F.3 doit proposer une REPAIR pour POST_VALIDATION_FAILURE avant la limite', async () => {
      const resolution = await recovery.handleError({
        error: new Error('typecheck failed'),
        errorKind: 'POST_VALIDATION_FAILURE',
        attempt: 1,
        userRole: 'ENGINEER'
      });

      assert.strictEqual(resolution.action, 'REPAIR');
      assert.strictEqual(resolution.shouldRetry, true);
    });

    it('F.4 doit déclencher ROLLBACK pour MUTATION_FAILURE', async () => {
      const resolution = await recovery.handleError({
        error: new Error('mutation failed'),
        errorKind: 'MUTATION_FAILURE',
        attempt: 1,
        userRole: 'ENGINEER'
      });

      assert.strictEqual(resolution.action, 'ROLLBACK');
      assert.strictEqual(resolution.shouldRetry, false);
    });
  });

  // ==========================================================================
  // G — Observability & Orchestration Metrics
  // ==========================================================================
  describe('G. Orchestration Observability & Metrics', () => {
    it('G.1 doit tracker fidèlement les métriques d exécution', () => {
      const mgr = new OrchestrationMetricsManager();

      mgr.recordTaskCreated();
      mgr.recordAgentCall();
      mgr.recordToolCall();
      mgr.recordRetry();
      mgr.recordRepair();
      mgr.recordBlockedMutation();
      mgr.recordImpactGate();
      mgr.recordCacheHit();
      mgr.recordCacheMiss();
      mgr.recordExecution(150, true);

      const m = mgr.getMetrics();
      assert.strictEqual(m.executionCount, 2); // 1 taskCreated + 1 execution
      assert.strictEqual(m.successCount, 1);
      assert.strictEqual(m.agentCalls, 1);
      assert.strictEqual(m.toolCalls, 1);
      assert.strictEqual(m.retryCount, 1);
      assert.strictEqual(m.repairCount, 1);
      assert.strictEqual(m.blockedMutations, 1);
      assert.strictEqual(m.impactGates, 1);
      assert.strictEqual(m.cacheHits, 1);
      assert.strictEqual(m.cacheMisses, 1);
      assert.ok(m.averageExecutionTime > 0);
    });
  });

  // ==========================================================================
  // H — End-to-End Orchestration Engine
  // ==========================================================================
  describe('H. End-to-End Multi-Agent DAG Execution', () => {
    it('H.1 doit exécuter un DAG complet multi-agents avec succès', async () => {
      const orchestrator = new AgentOrchestrator();

      const task1 = orchestrator.receiveTask({
        id: 't-ui',
        title: 'Créer composant UI',
        intent: 'Créer un composant UI avec React',
        tenantId: 'tenant-1',
        projectId: 'proj-1',
        userRole: 'ENGINEER'
      });

      assert.strictEqual(task1.assignedAgent, 'UI_AGENT');
      assert.strictEqual(orchestrator.getState(), 'UNDERSTANDING');

      const agent = orchestrator.selectAgent(task1, 'ENGINEER');
      assert.strictEqual(agent.role, 'UI_AGENT');

      const dag = new TaskDAG();
      dag.addTask(task1);

      const report = await orchestrator.executeDAG(dag, {
        tenantId: 'tenant-1',
        projectId: 'proj-1',
        runId: 'run-e2e',
        userRole: 'ENGINEER'
      });

      assert.strictEqual(report.success, true);
      assert.strictEqual(report.executedTasksCount, 1);
      assert.strictEqual(orchestrator.getState(), 'COMPLETED');
      assert.ok(report.totalDurationMs >= 0);
    });
  });
});
