/**
 * ÉTAPE 38 Phase 5 — Intégration runtime BATCH : MultiAgentScheduler →
 * buildBatchTrace → agentTraceStore (singleton persist:true).
 *
 * Les traces BATCH sont enregistrées AUTOMATIQUEMENT par le chemin de
 * production (après le verdict réel du batch). Les tests traversent le VRAI
 * pipeline É37 et lisent le VRAI store.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  InMemoryMutableFileSource,
  CodeIntelligenceService,
  ApplicationDNAService,
  SemanticCodeGraphService,
  ImpactIntelligenceService,
  MutationOrchestratorService,
  MutationBridge,
  AgentRegistryService,
  AgentExecutionService,
  MultiAgentScheduler,
  ReferenceAgent,
  agentTraceStore,
  buildBatchTrace,
  type AgentTask,
  type AgentResult
} from '../../../src/index.js';

describe('ÉTAPE 38 Phase 5 — intégration BATCH → AgentTraceStore', () => {
  let seq = 0;

  beforeEach(() => {
    seq += 1;
  });

  function makeChain(source: InMemoryMutableFileSource) {
    const codeIntel = new CodeIntelligenceService(source);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, source);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(source, codeIntel, dna, graph, impact);
    const registry = new AgentRegistryService();
    registry.register(new ReferenceAgent());
    const agentExecution = new AgentExecutionService(registry, new MutationBridge(mutationOrchestrator), source);
    const scheduler = new MultiAgentScheduler(agentExecution);
    return { source, registry, agentExecution, scheduler };
  }

  function makeSpec(taskId: string, order: number, targetFile: string, dependencies: string[] = []) {
    return {
      taskId, agentId: 'reference-agent', dependencies, order,
      task: {
        id: taskId, title: `Tâche ${taskId}`, description: '', domain: 'ARCHITECTURE' as const,
        priority: 1, dependencies,
        requiredContext: { targetFiles: [targetFile] },
        requiredCapabilities: ['FILE_MUTATION'] as never[],
        status: 'READY' as const, operation: 'CREATE' as const, retryCount: 0, maxRetries: 0
      }
    };
  }

  // A — BATCH COMPLETED : projection exacte
  it('A: batch COMPLETED → trace BATCH persistée, projection exacte', async () => {
    const { source, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-a-${seq}`;
    const projectId = `p-a-${seq}`;
    const outcome = await scheduler.execute({
      executionId: 'agxb-p5-a', tenantId, projectId,
      tasks: [makeSpec('alpha', 1, 'src/alpha.ts'), makeSpec('beta', 2, 'src/beta.ts')],
      maxConcurrency: 4, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'COMPLETED');
    const trace = agentTraceStore.get(tenantId, projectId, 'agxb-p5-a')!;
    assert.ok(trace, 'trace BATCH enregistrée automatiquement');
    assert.equal(trace.kind, 'BATCH');
    assert.equal(trace.executionId, outcome.executionId);
    assert.equal(trace.tenantId, tenantId);
    assert.equal(trace.projectId, projectId);
    assert.equal(trace.status, outcome.status);
    assert.deepEqual(trace.tasks, outcome.tasks.map((t) => ({
      taskId: t.spec.taskId,
      agentId: t.spec.agentId,
      taskExecutionId: t.taskExecutionId,
      status: t.status,
      executionStatus: t.outcome?.status
    })));
    assert.deepEqual(trace.counts, outcome.counts);
    assert.deepEqual(trace.phases, outcome.phases);
    assert.ok(source.getFile(tenantId, projectId, 'src/alpha.ts'));
    assert.ok(source.getFile(tenantId, projectId, 'src/beta.ts'));
  });

  // B — BATCH FAILED : BLOCKED conservé, jamais transformé
  it('B: batch FAILED → trace FAILED, BLOCKED conservé (jamais transformé en succès)', async () => {
    const base = new InMemoryMutableFileSource({});
    base.createFile('t-b', 'p-b', 'src/exists.ts', 'export const original = 1;\n');
    const { source, scheduler } = makeChain(base);
    const tenantId = 't-b';
    const projectId = 'p-b';
    const outcome = await scheduler.execute({
      executionId: 'agxb-p5-b', tenantId, projectId,
      tasks: [
        makeSpec('fail', 1, 'src/exists.ts'),
        makeSpec('child', 2, 'src/child.ts', ['fail'])
      ],
      maxConcurrency: 4, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILED');
    const trace = agentTraceStore.get(tenantId, projectId, 'agxb-p5-b')!;
    assert.equal(trace.status, 'FAILED');
    const entries = Object.fromEntries(trace.tasks!.map((t) => [t.taskId, t]));
    assert.equal(entries['fail']!.status, 'FAILED');
    assert.equal(entries['fail']!.executionStatus, 'FAILURE');
    assert.equal(entries['child']!.status, 'BLOCKED', 'BLOCKED reste BLOCKED');
    assert.equal(entries['child']!.executionStatus, undefined, 'jamais exécutée : aucun verdict inventé');
    assert.match(entries['child']!.blockedReason ?? '', /dépendance/);
    assert.equal(source.getFile(tenantId, projectId, 'src/child.ts'), null, 'aucune mutation de B');
  });

  // C — BATCH CANCELLED réel
  it('C: batch CANCELLED réel → trace CANCELLED, tasks conservées telles quelles', async () => {
    const { source, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-c-${seq}`;
    const projectId = `p-c-${seq}`;
    const controller = new AbortController();
    controller.abort();
    const outcome = await scheduler.execute({
      executionId: 'agxb-p5-c', tenantId, projectId,
      tasks: [makeSpec('c1', 1, 'src/c.ts')],
      userRole: 'OWNER', signal: controller.signal
    });
    assert.equal(outcome.status, 'CANCELLED');
    const trace = agentTraceStore.get(tenantId, projectId, 'agxb-p5-c')!;
    assert.equal(trace.status, 'CANCELLED', 'aucune cancellation inventée ni transformée');
    assert.equal(trace.tasks![0]!.status, 'PENDING');
    assert.equal(trace.tasks![0]!.executionStatus, undefined);
    assert.equal(source.getFile(tenantId, projectId, 'src/c.ts'), null);
  });

  // D+E+F — corrélation exacte, DAG, BLOCKED/PENDING
  it('D+E+F: corrélation É37 exacte (batchId→taskExecutionId), DAG conservé, BLOCKED/PENDING fidèles', async () => {
    const base = new InMemoryMutableFileSource({});
    base.createFile('t-def', 'p-def', 'src/exists.ts', 'export const original = 1;\n');
    const { scheduler } = makeChain(base);
    const outcome = await scheduler.execute({
      executionId: 'agxb-p5-def', tenantId: 't-def', projectId: 'p-def',
      tasks: [
        makeSpec('ok', 1, 'src/ok.ts'),
        makeSpec('fail', 2, 'src/exists.ts'),
        makeSpec('blocked', 3, 'src/blocked.ts', ['fail']),
        makeSpec('grandChild', 4, 'src/gc.ts', ['blocked'])
      ],
      maxConcurrency: 4, userRole: 'OWNER'
    });

    const trace = agentTraceStore.get('t-def', 'p-def', 'agxb-p5-def')!;
    for (const entry of trace.tasks!) {
      assert.equal(entry.taskExecutionId, `agxb-p5-def--${entry.taskId}`, 'corrélation É37 exacte');
      // Aucune corrélation reconstruite arbitrairement : les taskExecutionIds
      // correspondent EXACTEMENT à ceux de l'outcome réel
      const real = outcome.tasks.find((t) => t.spec.taskId === entry.taskId)!;
      assert.equal(entry.taskExecutionId, real.taskExecutionId);
      assert.equal(entry.status, real.status);
      assert.equal(entry.executionStatus, real.outcome?.status);
      if (real.blockedReason !== undefined) assert.equal(entry.blockedReason, real.blockedReason);
    }
    const entries = Object.fromEntries(trace.tasks!.map((t) => [t.taskId, t]));
    assert.equal(entries['ok']!.status, 'COMPLETED');
    assert.equal(entries['fail']!.status, 'FAILED');
    assert.equal(entries['blocked']!.status, 'BLOCKED');
    assert.equal(entries['grandChild']!.status, 'BLOCKED', 'dépendance transitive conservée');
    assert.deepEqual(trace.counts, outcome.counts);
  });

  // F(bis)+H — phases/waves exactes
  it('Phases: trace.phases deepEqual avec une projection fraîche du même outcome', async () => {
    const { scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-ph-${seq}`;
    const projectId = `p-ph-${seq}`;
    const outcome = await scheduler.execute({
      executionId: 'agxb-p5-ph', tenantId, projectId,
      tasks: [makeSpec('p1', 1, 'src/p1.ts'), makeSpec('p2', 2, 'src/p2.ts')],
      maxConcurrency: 4, userRole: 'OWNER'
    });
    const stored = agentTraceStore.get(tenantId, projectId, 'agxb-p5-ph')!;
    const fresh = buildBatchTrace({ outcome, tenantId, projectId });
    assert.deepEqual(stored.phases, fresh.phases);
    assert.deepEqual(stored, fresh, 'trace stockée = projection fraîche (tout le contrat)');
  });

  // I — la trace ne fabrique aucune information de tâche absente de l'outcome
  it('Projection: la trace BATCH ne contient que ce que l outcome porte (aucun champ fabriqué)', async () => {
    const { scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-i-${seq}`;
    const projectId = `p-i-${seq}`;
    const outcome = await scheduler.execute({
      executionId: 'agxb-p5-i', tenantId, projectId,
      tasks: [makeSpec('i1', 1, 'src/i1.ts')],
      userRole: 'OWNER'
    });
    const trace = agentTraceStore.get(tenantId, projectId, 'agxb-p5-i')!;
    assert.equal(trace.artifactCount, undefined, 'une trace BATCH ne porte pas d artifacts propres');
    assert.equal(trace.mutation, undefined, 'pas de mutation propre à la trace batch');
    assert.deepEqual(Object.keys(trace).sort(), Object.keys(buildBatchTrace({ outcome, tenantId, projectId })).sort());
  });

  // J — déterminisme
  it('Déterminisme: même outcome → projection batch identique (deepEqual total)', async () => {
    const { scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-j-${seq}`;
    const projectId = `p-j-${seq}`;
    const outcome = await scheduler.execute({
      executionId: 'agxb-p5-j', tenantId, projectId,
      tasks: [makeSpec('j1', 1, 'src/j1.ts')],
      userRole: 'OWNER'
    });
    const t1 = agentTraceStore.get(tenantId, projectId, 'agxb-p5-j')!;
    const t2 = buildBatchTrace({ outcome, tenantId, projectId });
    assert.deepEqual(t1, t2);
  });

  // K — isolation tenant/projet
  it('Isolation: même executionId sur deux tenants/projets → traces distinctes, aucune lecture croisée', async () => {
    const chainA = makeChain(new InMemoryMutableFileSource({}));
    const chainB = makeChain(new InMemoryMutableFileSource({}));
    const tenantA = `t-ka-${seq}`;
    const projectA = `p-ka-${seq}`;
    const tenantB = `t-kb-${seq}`;
    const projectB = `p-kb-${seq}`;
    await chainA.scheduler.execute({
      executionId: 'agxb-p5-shared', tenantId: tenantA, projectId: projectA,
      tasks: [makeSpec('shared', 1, 'src/shared.ts')], userRole: 'OWNER'
    });
    await chainB.scheduler.execute({
      executionId: 'agxb-p5-shared', tenantId: tenantB, projectId: projectB,
      tasks: [makeSpec('shared', 1, 'src/shared.ts')], userRole: 'OWNER'
    });
    assert.equal(agentTraceStore.get(tenantA, projectA, 'agxb-p5-shared')!.tenantId, tenantA);
    assert.equal(agentTraceStore.get(tenantB, projectB, 'agxb-p5-shared')!.tenantId, tenantB);
    // Phase 4 : chaque exécution de tâche enregistre AUSSI sa trace TASK —
    // le batch contient 1 BATCH + n TASK ; on vérifie le BATCH isolément.
    assert.equal(agentTraceStore.query(tenantA, projectA).filter((t) => t.kind === 'BATCH').length, 1);
    assert.equal(agentTraceStore.query(tenantB, projectB).filter((t) => t.kind === 'BATCH').length, 1);
    assert.equal(agentTraceStore.get(tenantA, projectB, 'agxb-p5-shared'), undefined);
    assert.equal(agentTraceStore.get(tenantB, projectA, 'agxb-p5-shared'), undefined);
  });

  // L — upsert
  it('Upsert: même batch tenant/projet/executionId → une seule trace, dernière version', async () => {
    const { scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-l-${seq}`;
    const projectId = `p-l-${seq}`;
    await scheduler.execute({
      executionId: 'agxb-p5-l', tenantId, projectId,
      tasks: [makeSpec('l1', 1, 'src/l1.ts')], userRole: 'OWNER'
    });
    await scheduler.execute({
      executionId: 'agxb-p5-l', tenantId, projectId,
      tasks: [makeSpec('l1b', 1, 'src/l1b.ts')], userRole: 'OWNER'
    });
    const traces = agentTraceStore.query(tenantId, projectId).filter((t) => t.executionId === 'agxb-p5-l');
    assert.equal(traces.length, 1);
    assert.equal(traces[0]!.tasks![0]!.taskId, 'l1b', 'dernière version conservée');
  });

  // M — failure-safe : store défaillant → batch normal, verdict inchangé
  it('Failure-safe: record forcé à jeter → batch normal, verdict inchangé, aucune exception', async () => {
    const { source, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-m-${seq}`;
    const projectId = `p-m-${seq}`;
    const originalRecord = agentTraceStore.record.bind(agentTraceStore);
    agentTraceStore.record = () => {
      throw new Error('TRACE_STORE_DOWN_BATCH');
    };
    try {
      const outcome = await scheduler.execute({
        executionId: 'agxb-p5-m', tenantId, projectId,
        tasks: [makeSpec('m1', 1, 'src/m1.ts')], userRole: 'OWNER'
      });
      assert.equal(outcome.status, 'COMPLETED', 'verdict réel inchangé malgré la défaillance du store');
      assert.equal(outcome.counts.completed, 1);
      assert.ok(source.getFile(tenantId, projectId, 'src/m1.ts'), 'mutation réelle effectuée');
      assert.equal(agentTraceStore.get(tenantId, projectId, 'agxb-p5-m'), undefined, 'aucune trace enregistrée');
    } finally {
      agentTraceStore.record = originalRecord;
    }
  });

  // N — immutabilité
  it('Immutabilité: trace stockée figée ; outcome original inchangé', async () => {
    const { scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-n-${seq}`;
    const projectId = `p-n-${seq}`;
    const outcome = await scheduler.execute({
      executionId: 'agxb-p5-n', tenantId, projectId,
      tasks: [makeSpec('n1', 1, 'src/n1.ts')], userRole: 'OWNER'
    });
    const outcomeSnapshot = JSON.parse(JSON.stringify(outcome));
    const stored = agentTraceStore.get(tenantId, projectId, 'agxb-p5-n')!;
    const storedSnapshot = JSON.parse(JSON.stringify(stored));
    assert.throws(
      () => { (stored as { status: string }).status = 'COMPLETED2'; },
      TypeError,
      'trace stockée protégée contre mutation'
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(agentTraceStore.get(tenantId, projectId, 'agxb-p5-n'))),
      storedSnapshot,
      'trace stockée inchangée (comparaison JSON round-trip des deux côtés)'
    );
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcomeSnapshot, 'outcome original inchangé');
  });

  // Inspection : aucun verdict fabriqué par la couche de trace, aucun node:fs
  it('Anti-faux-succès + node:fs: multi-agent-scheduler.ts — projection pure, aucun verdict fabriqué', () => {
    const full = resolve(process.cwd(), 'packages/core/src/ai-native/ai-orchestrator/execution/multi-agent-scheduler.ts');
    assert.ok(existsSync(full));
    const codeOnly = readFileSync(full, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.ok(codeOnly.includes('buildBatchTrace({ outcome, tenantId: request.tenantId, projectId: request.projectId })'));
    const recordIndex = codeOnly.indexOf('agentTraceStore.record(');
    const freezeIndex = codeOnly.indexOf('return outcome;');
    assert.ok(recordIndex > 0 && freezeIndex > recordIndex, 'enregistrement post-verdict, avant return');
    assert.doesNotMatch(codeOnly, /trace.*status\s*=\s*['"]COMPLETED['"]/, 'aucun statut fabriqué par la couche de trace');
    assert.doesNotMatch(codeOnly, /from 'node:fs'/);
    // La logique métier du verdict reste dans le scheduler (counts/completed)
    assert.ok(codeOnly.includes("counts.completed === counts.total"));
  });

  // Agent stub utile aux cas où reference-agent ne suffit pas (réservé)
  function unusedStub(): AgentResult {
    return {
      taskId: 'x', agentId: 'x', status: 'FAILURE', artifacts: [], conflicts: [],
      tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0
    };
  }
  void unusedStub;
  type AgentTaskRef = AgentTask;
  void (0 as unknown as AgentTaskRef);
});
