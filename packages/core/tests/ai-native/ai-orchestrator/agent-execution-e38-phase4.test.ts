/**
 * ÉTAPE 38 Phase 4 — Intégration runtime TASK : AgentExecutionService →
 * buildTaskTrace → agentTraceStore (singleton persist:true).
 *
 * Les traces sont enregistrées AUTOMATIQUEMENT par le chemin de production
 * (dans finish(), après le verdict réel). Les tests traversent le VRAI
 * pipeline et lisent le VRAI store.
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
  ReferenceAgent,
  agentTraceStore,
  buildTaskTrace,
  type AgentTask,
  type AgentResult
} from '../../../src/index.js';

describe('ÉTAPE 38 Phase 4 — intégration TASK → AgentTraceStore', () => {
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
    return { source, registry, agentExecution };
  }

  function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
      id: `task-p4-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Tâche P4', description: '', domain: 'ARCHITECTURE', priority: 1,
      dependencies: [], requiredContext: { targetFiles: ['src/target.ts'] },
      requiredCapabilities: ['FILE_MUTATION'], status: 'READY', operation: 'CREATE',
      retryCount: 0, maxRetries: 0, ...overrides
    };
  }

  const ctx = { relevantFiles: {}, relevantSymbols: [], decisions: [], constraints: [], recentHistory: [] };

  // A — SUCCESS : trace persistée automatiquement, projection exacte
  it('A: tâche SUCCESS → trace persistée, projection exacte de l outcome réel', async () => {
    const { source, agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-a-${seq}`;
    const projectId = `p-a-${seq}`;
    const outcome = await agentExecution.execute({
      executionId: 'agx-p4-a', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'SUCCESS');
    const trace = agentTraceStore.get(tenantId, projectId, 'agx-p4-a');
    assert.ok(trace, 'trace enregistrée automatiquement par le chemin de production');
    assert.equal(trace.executionId, outcome.executionId);
    assert.equal(trace.tenantId, tenantId);
    assert.equal(trace.projectId, projectId);
    assert.equal(trace.agentId, outcome.agentId);
    assert.equal(trace.status, outcome.status);
    assert.equal(trace.artifactCount, outcome.artifacts.length);
    const realArtifact = outcome.artifacts[0]!;
    assert.deepEqual(trace.artifacts![0], {
      id: realArtifact.id, kind: realArtifact.kind,
      targetFiles: [...realArtifact.targetFiles], hash: realArtifact.hash
    });
    assert.equal(trace.mutation?.transactionId, outcome.mutation.transactionId);
    assert.deepEqual(trace.gate, outcome.gate);
    assert.deepEqual(trace.verification && {
      performed: trace.verification.performed,
      passed: trace.verification.passed,
      checkCount: trace.verification.checkCount
    }, {
      performed: outcome.verification.performed,
      passed: outcome.verification.passed,
      checkCount: outcome.verification.checks.length
    });
    assert.deepEqual(trace.phases, outcome.phases, 'phases exactement dérivées');
    assert.ok(source.getFile(tenantId, projectId, 'src/target.ts'), 'mutation réelle');
  });

  // B — FAILURE réelle
  it('B: tâche FAILURE (agent inconnu) → trace persistée avec le verdict réel', async () => {
    const { source, agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-b-${seq}`;
    const projectId = `p-b-${seq}`;
    const outcome = await agentExecution.execute({
      executionId: 'agx-p4-b', agentId: 'agent-fantome-p4', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const trace = agentTraceStore.get(tenantId, projectId, 'agx-p4-b')!;
    assert.equal(trace.status, 'FAILURE');
    assert.match(trace.error ?? '', /AGENT_UNKNOWN/);
    assert.equal(trace.mutation?.executed, false);
    assert.equal(source.getFile(tenantId, projectId, 'src/target.ts'), null);
  });

  // C — ROLLED_BACK (divergence réelle É35/É36)
  it('C: ROLLED_BACK réel → trace persistée, rollback identique, aucune phase de repair fantôme', async () => {
    class CorruptAlwaysSource extends InMemoryMutableFileSource {
      public override createFile(t: string, p: string, f: string, c: string): void {
        super.createFile(t, p, f, c + '\n// CORRUPTED\n');
      }
    }
    const { source, agentExecution } = makeChain(new CorruptAlwaysSource());
    const tenantId = `t-c-${seq}`;
    const projectId = `p-c-${seq}`;
    const outcome = await agentExecution.execute({
      executionId: 'agx-p4-c', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const trace = agentTraceStore.get(tenantId, projectId, 'agx-p4-c')!;
    assert.equal(trace.status, 'ROLLED_BACK');
    assert.deepEqual(trace.rollback, outcome.rollback);
    assert.equal(trace.rollback?.verified, true);
    assert.deepEqual(trace.phases, outcome.phases);
    assert.ok(!trace.phases.some((p) => p.phase.startsWith('REPAIR')), 'aucune phase de repair fantôme');
    assert.equal(source.getFile(tenantId, projectId, 'src/target.ts'), null, 'état initial restauré');
  });

  // D — FAILED_ROLLBACK réel (É36)
  it('D: FAILED_ROLLBACK réel → trace conservée exactement, aucun changement de verdict', async () => {
    class CorruptAndFailingDelete extends InMemoryMutableFileSource {
      public writes = 0;
      public override createFile(t: string, p: string, f: string, c: string): void {
        this.writes += 1;
        super.createFile(t, p, f, this.writes === 1 ? c + '\n// CORRUPTED\n' : c);
      }
      public override deleteFile(t: string, p: string, f: string): boolean {
        throw new Error('DELETE_FAILED');
      }
    }
    const { agentExecution } = makeChain(new CorruptAndFailingDelete());
    const tenantId = `t-d-${seq}`;
    const projectId = `p-d-${seq}`;
    const outcome = await agentExecution.execute({
      executionId: 'agx-p4-d', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const trace = agentTraceStore.get(tenantId, projectId, 'agx-p4-d')!;
    assert.equal(trace.status, 'FAILED_ROLLBACK');
    assert.deepEqual(trace.rollback, outcome.rollback);
    assert.equal(trace.rollback?.verified, false);
  });

  // E — CANCELLED (AbortController réel, point BEFORE_AGENT)
  it('E: CANCELLED réel → trace persistée, cancellation identique, aucune mutation inventée', async () => {
    const { source, agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-e-${seq}`;
    const projectId = `p-e-${seq}`;
    const controller = new AbortController();
    controller.abort();
    const outcome = await agentExecution.execute({
      executionId: 'agx-p4-e', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', signal: controller.signal
    });
    const trace = agentTraceStore.get(tenantId, projectId, 'agx-p4-e')!;
    assert.equal(trace.status, 'CANCELLED');
    assert.deepEqual(trace.cancellation, outcome.cancellation);
    assert.equal(trace.cancellation?.at, 'BEFORE_AGENT');
    assert.equal(trace.mutation?.executed, false);
    assert.equal(source.getFile(tenantId, projectId, 'src/target.ts'), null);
  });

  // F — Gate PASS/FAIL + Repair réels
  it('F: Gate PASS/FAIL réels + Repair présent uniquement si réellement exécuté', async () => {
    // Gate PASS
    const chainOk = makeChain(new InMemoryMutableFileSource({}));
    const tenantOk = `t-f1-${seq}`;
    const projOk = `p-f1-${seq}`;
    const outcomeOk = await chainOk.agentExecution.execute({
      executionId: 'agx-p4-f1', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId: tenantOk, projectId: projOk, userRole: 'OWNER'
    });
    assert.deepEqual(agentTraceStore.get(tenantOk, projOk, 'agx-p4-f1')!.gate, outcomeOk.gate);
    assert.equal(agentTraceStore.get(tenantOk, projOk, 'agx-p4-f1')!.gate?.passed, true);
    assert.equal(agentTraceStore.get(tenantOk, projOk, 'agx-p4-f1')!.repair, undefined, 'aucun repair sans réparation réelle');

    // Gate FAIL + Repair réel (politique activée, divergence réelle)
    class CorruptOnceSource extends InMemoryMutableFileSource {
      public writes = 0;
      public override createFile(t: string, p: string, f: string, c: string): void {
        this.writes += 1;
        super.createFile(t, p, f, this.writes === 1 ? c + '\n// CORRUPTED\n' : c);
      }
    }
    const chainRepair = makeChain(new CorruptOnceSource());
    const tenantR = `t-f2-${seq}`;
    const projR = `p-f2-${seq}`;
    const outcomeR = await chainRepair.agentExecution.execute({
      executionId: 'agx-p4-f2', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId: tenantR, projectId: projR, userRole: 'OWNER',
      repairPolicy: { enabled: true, maxAttempts: 1 }
    });
    const traceR = agentTraceStore.get(tenantR, projR, 'agx-p4-f2')!;
    assert.deepEqual(traceR.gate, outcomeR.gate);
    assert.equal(traceR.gate?.passed, true, 're-Gate après réparation');
    assert.deepEqual(traceR.repair, outcomeR.repair);
    assert.equal(traceR.repair?.attempted, true);
    assert.equal(traceR.repair?.repairId, 'rep-agx-p4-f2-1');
  });

  // G — transactionId exact (déjà couvert en A, re-vérifié isolément)
  it('G: transactionId exactement celui de la mutation réelle', async () => {
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-g-${seq}`;
    const projectId = `p-g-${seq}`;
    const outcome = await agentExecution.execute({
      executionId: 'agx-p4-g', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    assert.equal(agentTraceStore.get(tenantId, projectId, 'agx-p4-g')!.mutation?.transactionId, outcome.mutation.transactionId);
    assert.match(outcome.mutation.transactionId ?? '', /^tx-/);
  });

  // H — phases deepEqual avec une projection fraîche du même outcome
  it('H: phases deepEqual entre trace stockée et projection fraîche du même outcome', async () => {
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-h-${seq}`;
    const projectId = `p-h-${seq}`;
    const outcome = await agentExecution.execute({
      executionId: 'agx-p4-h', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const stored = agentTraceStore.get(tenantId, projectId, 'agx-p4-h')!;
    const fresh = buildTaskTrace({ outcome, tenantId, projectId });
    assert.deepEqual(stored.phases, fresh.phases);
    assert.deepEqual(stored, fresh, 'trace stockée = projection fraîche (tout le contrat)');
  });

  // I — outcome immutable après enregistrement
  it('I: outcome original inchangé ; muter la source ne modifie pas la trace stockée', async () => {
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-i-${seq}`;
    const projectId = `p-i-${seq}`;
    const outcome = await agentExecution.execute({
      executionId: 'agx-p4-i', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const outcomeSnapshot = JSON.parse(JSON.stringify(outcome));
    const trace = agentTraceStore.get(tenantId, projectId, 'agx-p4-i')!;
    const traceSnapshot = JSON.parse(JSON.stringify(trace));
    // La trace retournée par le store est FIGÉE (protection Phase 3) : toute
    // tentative de mutation est refusée et la trace stockée reste identique.
    assert.throws(
      () => { (trace as { status: string }).status = 'FAILURE'; },
      TypeError,
      'la trace stockée est protégée contre mutation'
    );
    assert.deepEqual(agentTraceStore.get(tenantId, projectId, 'agx-p4-i'), traceSnapshot, 'trace stockée inchangée');
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcomeSnapshot, 'outcome original inchangé');
  });

  // J — failure-safe : un store défaillant ne change jamais l'exécution
  it('J: échec du TraceStore → exécution normale, verdict réel inchangé, aucune exception remontée', async () => {
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-j-${seq}`;
    const projectId = `p-j-${seq}`;
    const originalRecord = agentTraceStore.record.bind(agentTraceStore);
    agentTraceStore.record = () => {
      throw new Error('TRACE_STORE_DOWN');
    };
    try {
      const outcome = await agentExecution.execute({
        executionId: 'agx-p4-j', agentId: 'reference-agent', task: makeTask(),
        context: ctx, tenantId, projectId, userRole: 'OWNER'
      });
      assert.equal(outcome.status, 'SUCCESS', 'verdict réel inchangé malgré la défaillance du store');
      assert.ok(outcome.mutation.executed);
      assert.equal(agentTraceStore.get(tenantId, projectId, 'agx-p4-j'), undefined, 'aucune trace enregistrée (store défaillant)');
    } finally {
      agentTraceStore.record = originalRecord;
    }
  });

  // K — isolation tenant/projet
  it('K: deux exécutions même executionId, tenants/projets différents → traces strictement isolées', async () => {
    const chainA = makeChain(new InMemoryMutableFileSource({}));
    const chainB = makeChain(new InMemoryMutableFileSource({}));
    const tenantA = `t-ka-${seq}`;
    const projectA = `p-ka-${seq}`;
    const tenantB = `t-kb-${seq}`;
    const projectB = `p-kb-${seq}`;
    await chainA.agentExecution.execute({
      executionId: 'agx-p4-shared', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId: tenantA, projectId: projectA, userRole: 'OWNER'
    });
    await chainB.agentExecution.execute({
      executionId: 'agx-p4-shared', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId: tenantB, projectId: projectB, userRole: 'OWNER'
    });

    const traceA = agentTraceStore.get(tenantA, projectA, 'agx-p4-shared')!;
    const traceB = agentTraceStore.get(tenantB, projectB, 'agx-p4-shared')!;
    assert.equal(traceA.tenantId, tenantA);
    assert.equal(traceB.tenantId, tenantB);
    assert.equal(agentTraceStore.query(tenantA, projectA).length, 1);
    assert.equal(agentTraceStore.query(tenantB, projectB).length, 1);
    assert.equal(agentTraceStore.get(tenantA, projectB, 'agx-p4-shared'), undefined, 'aucune fuite croisée');
    assert.equal(agentTraceStore.get(tenantB, projectA, 'agx-p4-shared'), undefined);
  });

  // L — upsert : même executionId dans le même tenant/projet
  it('L: même executionId même tenant/projet → upsert, une seule trace, dernière version', async () => {
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const tenantId = `t-l-${seq}`;
    const projectId = `p-l-${seq}`;
    await agentExecution.execute({
      executionId: 'agx-p4-l', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    await agentExecution.execute({
      executionId: 'agx-p4-l', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const traces = agentTraceStore.query(tenantId, projectId).filter((t) => t.executionId === 'agx-p4-l');
    assert.equal(traces.length, 1, 'jamais de doublon');
  });

  // M/N — inspection du code modifié : aucune fabrication, aucun node:fs
  it('M+N: agent-execution.ts — aucun verdict fabriqué par la trace, aucun node:fs ajouté', () => {
    const full = resolve(process.cwd(), 'packages/core/src/ai-native/ai-orchestrator/execution/agent-execution.ts');
    assert.ok(existsSync(full));
    const codeOnly = readFileSync(full, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // L'intégration ne fabrique rien : buildTaskTrace + record, rien d'autre
    assert.ok(codeOnly.includes('buildTaskTrace({ outcome, tenantId: request.tenantId, projectId: request.projectId })'));
    assert.doesNotMatch(codeOnly, /trace.*status\s*=\s*['"]SUCCESS['"]/, 'aucun statut fabriqué pour la trace');
    assert.doesNotMatch(codeOnly, /trace.*phases\.push/, 'aucune phase ajoutée artificiellement');
    assert.doesNotMatch(codeOnly, /from 'node:fs'/);
    // La détermination du verdict précède l'enregistrement : le try/catch est
    // APRÈS le bloc audit (verdict déjà arrêté).
    const auditIndex = codeOnly.indexOf("action: 'AGENT_EXECUTED'");
    const traceIndex = codeOnly.indexOf('agentTraceStore.record(');
    assert.ok(auditIndex > 0 && traceIndex > auditIndex, 'verdict déterminé AVANT enregistrement de la trace');
  });
});
