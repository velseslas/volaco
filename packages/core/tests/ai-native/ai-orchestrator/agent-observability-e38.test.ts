/**
 * ÉTAPE 38 (Phase 2) — Projections de trace : tests de pureté et de fidélité
 *
 * Les outcomes sont produits par le VRAI pipeline (AgentExecutionService /
 * MultiAgentScheduler réels), puis projetés via buildTaskTrace /
 * buildBatchTrace. Les tests vérifient que la trace ne contient RIEN d'autre
 * que ce que les outcomes réels portent — aucune phase, statut, transaction,
 * gate/repair/rollback inventés.
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
  BaseSpecializedAgent,
  ReferenceAgent,
  buildTaskTrace,
  buildBatchTrace,
  deriveBatchCorrelation,
  type AgentTask,
  type AgentResult
} from '../../../src/index.js';

describe('ÉTAPE 38 Phase 2 — ExecutionTrace : projections pures', () => {
  let tenantId: string;
  let projectId: string;
  let seq = 0;

  beforeEach(() => {
    seq += 1;
    tenantId = 'tenant-e38';
    projectId = `proj-e38-${seq}`;
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

  const ctx = { relevantFiles: {}, relevantSymbols: [], decisions: [], constraints: [], recentHistory: [] };

  function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
      id: `task-e38-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Tâche É38', description: '', domain: 'ARCHITECTURE', priority: 1,
      dependencies: [], requiredContext: { targetFiles: ['src/target.ts'] },
      requiredCapabilities: ['FILE_MUTATION'], status: 'READY', operation: 'CREATE',
      retryCount: 0, maxRetries: 0, ...overrides
    };
  }

  // A — TASK SUCCESS réel → trace correcte
  it('A: TASK SUCCESS réel → trace TASK fidèle (statut, agent, artifact, mutation, gate)', async () => {
    const { source, agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await agentExecution.execute({
      executionId: 'agx-e38-a', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const trace = buildTaskTrace({ outcome, tenantId, projectId });

    assert.equal(trace.kind, 'TASK');
    assert.equal(trace.executionId, 'agx-e38-a');
    assert.equal(trace.agentId, 'reference-agent');
    assert.equal(trace.taskId, outcome.result.taskId);
    assert.equal(trace.status, 'SUCCESS', 'verdict réel recopié tel quel');
    assert.equal(trace.artifactCount, 1);
    assert.equal(trace.mutation?.executed, true);
    assert.ok(trace.mutation?.transactionId);
    assert.equal(trace.gate?.passed, true, 'Gate réel visible');
    assert.equal(trace.verification?.performed, true);
    assert.equal(trace.verification?.passed, true);
    assert.equal(trace.phases.length, outcome.phases.length, 'phases = projection exacte');
    assert.ok(trace.endedAt);
    assert.equal(trace.durationMs, outcome.durationMs);
    // Le fichier réel existe (la trace reflète une exécution réelle)
    assert.ok(source.getFile(tenantId, projectId, 'src/target.ts'));
  });

  // B — TASK FAILURE réel
  it('B: TASK FAILURE réel → status FAILURE recopié, erreur réelle visible', async () => {
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await agentExecution.execute({
      executionId: 'agx-e38-b', agentId: 'agent-inconnu-38', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const trace = buildTaskTrace({ outcome, tenantId, projectId });

    assert.equal(trace.status, 'FAILURE');
    assert.match(trace.error ?? '', /AGENT_UNKNOWN/);
    assert.equal(trace.artifactCount, 0);
    assert.equal(trace.mutation?.executed, false);
    assert.equal(trace.gate, undefined, 'aucun gate si la tâche n a jamais atteint la mutation');
  });

  // C/D — Gate PASS / FAIL visibles
  it('C+D: Gate PASS et Gate FAIL réellement visibles dans la trace', async () => {
    // PASS
    const chainOk = makeChain(new InMemoryMutableFileSource({}));
    const outcomeOk = await chainOk.agentExecution.execute({
      executionId: 'agx-e38-c', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const traceOk = buildTaskTrace({ outcome: outcomeOk, tenantId, projectId });
    assert.equal(traceOk.gate?.gateId, 'FILE_MUTATION_GATE');
    assert.equal(traceOk.gate?.passed, true);
    assert.ok(traceOk.gate!.checks.length >= 3);

    // FAIL : divergence réelle store/artifact → gate FAIL avec contrôles
    class CorruptWriteSource extends InMemoryMutableFileSource {
      public override createFile(t: string, p: string, f: string, c: string): void {
        super.createFile(t, p, f, c + '\n// CORRUPTED\n');
      }
    }
    const chainFail = makeChain(new CorruptWriteSource());
    const outcomeFail = await chainFail.agentExecution.execute({
      executionId: 'agx-e38-d', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const traceFail = buildTaskTrace({ outcome: outcomeFail, tenantId, projectId });
    assert.equal(traceFail.status, 'ROLLED_BACK');
    assert.equal(traceFail.gate?.passed, false);
    assert.match(traceFail.gate?.reason ?? '', /contrôle\(s\) de vérification en échec/);
  });

  // E — Repair présent UNIQUEMENT si réellement présent
  it('E: repair visible seulement quand réellement déclenché (politique)', async () => {
    class CorruptOnceSource extends InMemoryMutableFileSource {
      public writes = 0;
      public override createFile(t: string, p: string, f: string, c: string): void {
        this.writes += 1;
        super.createFile(t, p, f, this.writes === 1 ? c + '\n// CORRUPTED\n' : c);
      }
    }
    // Chaîne 1 (sans politique) : sa propre source corrompue
    const chainNoRepair = makeChain(new CorruptOnceSource());

    // Sans politique → aucun repair dans la trace
    const outcomeNoRepair = await chainNoRepair.agentExecution.execute({
      executionId: 'agx-e38-e1', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const traceNoRepair = buildTaskTrace({ outcome: outcomeNoRepair, tenantId, projectId });
    assert.equal(traceNoRepair.repair, undefined, 'aucun repair inventé');
    assert.equal(traceNoRepair.status, 'ROLLED_BACK');

    // Chaîne 2 (avec politique) : sa propre source corrompue → repair réel
    const chainRepaired = makeChain(new CorruptOnceSource());
    const outcomeRepaired = await chainRepaired.agentExecution.execute({
      executionId: 'agx-e38-e2', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER',
      repairPolicy: { enabled: true, maxAttempts: 1 }
    });
    const traceRepaired = buildTaskTrace({ outcome: outcomeRepaired, tenantId, projectId });
    assert.equal(traceRepaired.repair?.attempted, true);
    assert.equal(traceRepaired.repair?.repairId, 'rep-agx-e38-e2-1');
    assert.equal(traceRepaired.repair?.gateAfterPassed, true);
    assert.equal(traceRepaired.status, 'SUCCESS');
  });

  // F/G — Rollback réel / FAILED_ROLLBACK conservés
  it('F+G: rollback réel visible ; FAILED_ROLLBACK conservé tel quel', async () => {
    class CorruptAlwaysSource extends InMemoryMutableFileSource {
      public override createFile(t: string, p: string, f: string, c: string): void {
        super.createFile(t, p, f, c + '\n// CORRUPTED-ALWAYS\n');
      }
    }
    const { agentExecution } = makeChain(new CorruptAlwaysSource());
    const outcome = await agentExecution.execute({
      executionId: 'agx-e38-f', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const trace = buildTaskTrace({ outcome, tenantId, projectId });
    assert.equal(trace.status, 'ROLLED_BACK');
    assert.equal(trace.rollback?.performed, true);
    assert.equal(trace.rollback?.verified, true, 'restauration réellement vérifiée');

    // FAILED_ROLLBACK : restauration impossible
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
    const failing = new CorruptAndFailingDelete();
    const chainFailing = makeChain(failing);
    const outcomeFailedRollback = await chainFailing.agentExecution.execute({
      executionId: 'agx-e38-g', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const traceFailedRollback = buildTaskTrace({ outcome: outcomeFailedRollback, tenantId, projectId });
    assert.equal(traceFailedRollback.status, 'FAILED_ROLLBACK', 'statut réel conservé tel quel');
    assert.equal(traceFailedRollback.rollback?.verified, false);
  });

  // H — Cancellation conservée
  it('H: cancellation réelle conservée telle quelle', async () => {
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const controller = new AbortController();
    controller.abort();
    const outcome = await agentExecution.execute({
      executionId: 'agx-e38-h', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', signal: controller.signal
    });
    const trace = buildTaskTrace({ outcome, tenantId, projectId });
    assert.equal(trace.status, 'CANCELLED');
    assert.equal(trace.cancellation?.requested, true);
    assert.equal(trace.cancellation?.at, 'BEFORE_AGENT');
    assert.equal(trace.mutation?.executed, false);
  });

  // I/J — Artifact résumé exact / transactionId exact
  it('I+J: résumé artifact exact et transactionId exact', async () => {
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await agentExecution.execute({
      executionId: 'agx-e38-ij', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const trace = buildTaskTrace({ outcome, tenantId, projectId });

    const realArtifact = outcome.artifacts[0]!;
    const summary = trace.artifacts![0]!;
    assert.deepEqual(summary, {
      id: realArtifact.id,
      kind: realArtifact.kind,
      targetFiles: [...realArtifact.targetFiles],
      hash: realArtifact.hash
    });
    assert.equal(trace.mutation?.transactionId, outcome.mutation.transactionId);
  });

  // K — phases : aucune phase fantôme
  it('K: phases = projection exacte des phases réelles (aucune fantôme)', async () => {
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await agentExecution.execute({
      executionId: 'agx-e38-k', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const trace = buildTaskTrace({ outcome, tenantId, projectId });
    assert.equal(trace.phases.length, outcome.phases.length);
    for (let i = 0; i < outcome.phases.length; i++) {
      assert.equal(trace.phases[i]!.phase, outcome.phases[i]!.phase);
      assert.equal(trace.phases[i]!.at, outcome.phases[i]!.at);
      assert.equal(trace.phases[i]!.detail, outcome.phases[i]!.detail);
    }
    // Une phase de repair fantôme ne peut pas exister sans repair réel
    assert.ok(!trace.phases.some((p) => p.phase.startsWith('REPAIR')), 'aucune phase REPAIR sans réparation réelle');
  });

  // L — BATCH : corrélation exacte
  it('L: BATCH → corrélation taskId/taskExecutionId/status exacte (convention É37)', async () => {
    const { scheduler, source } = makeChain(new InMemoryMutableFileSource({}));
    const batchOutcome = await scheduler.execute({
      executionId: 'agxb-e38-l', tenantId, projectId,
      tasks: [makeSpec('alpha', 1, 'src/alpha.ts'), makeSpec('beta', 2, 'src/beta.ts')],
      maxConcurrency: 4, userRole: 'OWNER'
    });
    const trace = buildBatchTrace({ outcome: batchOutcome, tenantId, projectId });

    assert.equal(trace.kind, 'BATCH');
    assert.equal(trace.executionId, 'agxb-e38-l');
    assert.equal(trace.status, batchOutcome.status);
    assert.equal(trace.counts?.completed, 2);
    assert.equal(trace.tasks?.length, 2);
    for (const entry of trace.tasks!) {
      assert.equal(entry.taskExecutionId, `agxb-e38-l--${entry.taskId}`, 'corrélation réelle É37');
      assert.equal(entry.status, 'COMPLETED');
      assert.equal(entry.executionStatus, 'SUCCESS');
    }
    assert.ok(source.getFile(tenantId, projectId, 'src/alpha.ts'));
  });

  // M — BLOCKED/PENDING conservés comme outcomes É37
  it('M: BLOCKED/PENDING conservés tels quels dans la trace batch', async () => {
    const { scheduler, source } = makeChain(new InMemoryMutableFileSource({}));
    source.createFile(tenantId, projectId, 'src/exists.ts', 'export const original = 1;\n');
    const batchOutcome = await scheduler.execute({
      executionId: 'agxb-e38-m', tenantId, projectId,
      tasks: [
        makeSpec('fail', 1, 'src/exists.ts'),
        makeSpec('child', 2, 'src/child.ts', ['fail']),
        makeSpec('indep', 3, 'src/indep.ts')
      ],
      maxConcurrency: 4, userRole: 'OWNER'
    });
    const trace = buildBatchTrace({ outcome: batchOutcome, tenantId, projectId });

    assert.equal(trace.status, 'FAILED');
    const entries = Object.fromEntries(trace.tasks!.map((t) => [t.taskId, t]));
    assert.equal(entries['fail']!.status, 'FAILED');
    assert.equal(entries['child']!.status, 'BLOCKED');
    assert.match(entries['child']!.blockedReason ?? '', /dépendance/);
    assert.equal(entries['child']!.executionStatus, undefined, 'tâche jamais exécutée : aucun verdict inventé');
    // indep : la vague suivante n est pas soumise après l échec → PENDING (arrêt)
    assert.ok(['PENDING', 'COMPLETED', 'BLOCKED'].includes(entries['indep']!.status));
  });

  // N — déterminisme hors timestamps
  it('N: déterminisme — même outcome projeté deux fois → deepEqual total ; structure identique entre runs', async () => {
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await agentExecution.execute({
      executionId: 'agx-e38-n', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const t1 = buildTaskTrace({ outcome, tenantId, projectId });
    const t2 = buildTaskTrace({ outcome, tenantId, projectId });
    assert.deepEqual(t1, t2, 'même outcome → même trace (déterminisme total)');

    // Deux runs distincts avec MÊME tâche (ids fixes) : seule la structure
    // hors champs temporels/identifiants dérivés doit être identique.
    const { agentExecution: exec2 } = makeChain(new InMemoryMutableFileSource({}));
    const outcome2 = await exec2.execute({
      executionId: 'agx-e38-n', agentId: 'reference-agent', task: makeTask({ id: outcome.result.taskId }),
      context: ctx, tenantId, projectId: `proj-e38-n2-${seq}`, userRole: 'OWNER'
    });
    const t3 = buildTaskTrace({ outcome: outcome2, tenantId, projectId: `proj-e38-n2-${seq}` });
    const stripTime = (trace: typeof t1) => ({
      // Le projectId légitimement différent entre runs est neutralisé.
      ...trace,
      projectId: '<proj>',
      phases: trace.phases.map((p) => ({ phase: p.phase, detail: p.detail ? p.detail.replace(/tx-[a-f0-9-]+/g, '<tx>') : undefined })),
      startedAt: '<t>', endedAt: '<t>', durationMs: 0,
      mutation: trace.mutation ? { ...trace.mutation, transactionId: '<tx>' } : undefined
    });
    assert.deepEqual(stripTime(t1), stripTime(t3), 'même structure hors champs temporels réels');
  });

  // O — aucun verdict fabriqué
  it('O: trace.status === outcome.status pour tous les verdicts (aucun verdict propre à la trace)', async () => {
    const cases: Array<{ status: string; traceStatus: string }> = [];
    const { agentExecution } = makeChain(new InMemoryMutableFileSource({}));
    const ok = await agentExecution.execute({
      executionId: 'agx-e38-o1', agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    cases.push({ status: ok.status, traceStatus: buildTaskTrace({ outcome: ok, tenantId, projectId }).status });
    const unknown = await agentExecution.execute({
      executionId: 'agx-e38-o2', agentId: 'ghost-38', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    cases.push({ status: unknown.status, traceStatus: buildTaskTrace({ outcome: unknown, tenantId, projectId }).status });
    for (const c of cases) {
      assert.equal(c.traceStatus, c.status, 'la trace ne produit aucun verdict propre');
    }
  });

  // P/Q — pas de node:fs, aucune mutation dans trace.ts
  it('P+Q: trace.ts sans node:fs, sans mutation, sans accès FileStore', () => {
    const full = resolve(process.cwd(), 'packages/core/src/ai-native/ai-orchestrator/execution/trace.ts');
    assert.ok(existsSync(full));
    const raw = readFileSync(full, 'utf8');
    // Les mentions DOCUMENTAIRES (commentaires) ne sont pas du code : matcher
    // le code réel, hors commentaires.
    const content = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(content, /node:fs/);
    assert.doesNotMatch(content, /writeFileSync|writeFile\(/);
    assert.doesNotMatch(content, /MutationBridge|MutationOrchestratorService/, 'aucune dépendance de mutation');
    assert.doesNotMatch(content, /getFile|FileStore/, 'aucune lecture de store');
    assert.doesNotMatch(content, /Date\.now|randomUUID|Math\.random/, 'aucun identifiant/horodatage généré');
  });

  // Corrélation : dérivation de batch
  it('deriveBatchCorrelation: lit la convention É37, ne fabrique rien hors batch', () => {
    assert.deepEqual(deriveBatchCorrelation('agxb-x--t1'), { batchExecutionId: 'agxb-x' });
    assert.deepEqual(deriveBatchCorrelation('agx-standalone'), {});
  });
});
