/**
 * ÉTAPE 38 Phase 3 — AgentTraceStore : registre persistant des ExecutionTrace
 *
 * Les traces utilisées par les tests sont produites par les PROJECTIONS
 * PURES É38 Phase 2 (buildTaskTrace/buildBatchTrace) sur des outcomes RÉELS
 * (vrai pipeline AgentExecutionService / MultiAgentScheduler) ou par des
 * fixtures strictement conformes au contrat. Le store est passif : aucun
 * verdict, aucune fabrication.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
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
  buildTaskTrace,
  buildBatchTrace,
  AgentTraceStore,
  AGENT_TRACE_MAX,
  type ExecutionTrace,
  type AgentTask
} from '../../../src/index.js';

describe('ÉTAPE 38 Phase 3 — AgentTraceStore', () => {
  let tenantId: string;
  let projectId: string;
  let seq = 0;
  /** Répertoire de persistance NEUF par test (isolé, réel — pas de simulation). */
  let dataDir: string;

  beforeEach(() => {
    seq += 1;
    tenantId = 'tenant-e38s';
    projectId = `proj-e38s-${seq}`;
    dataDir = mkdtempSync(join(tmpdir(), 'volaco-e38s-'));
    process.env.VOLACO_DATA_DIR = dataDir;
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

  function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
      id: `task-e38s-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Tâche É38S', description: '', domain: 'ARCHITECTURE', priority: 1,
      dependencies: [], requiredContext: { targetFiles: ['src/target.ts'] },
      requiredCapabilities: ['FILE_MUTATION'], status: 'READY', operation: 'CREATE',
      retryCount: 0, maxRetries: 0, ...overrides
    };
  }

  const ctx = { relevantFiles: {}, relevantSymbols: [], decisions: [], constraints: [], recentHistory: [] };

  /** Produit une trace TASK RÉELLE via le vrai pipeline. */
  async function realTaskTrace(executionId: string, proj = projectId, source?: InMemoryMutableFileSource) {
    const chain = makeChain(source ?? new InMemoryMutableFileSource({}));
    const outcome = await chain.agentExecution.execute({
      executionId, agentId: 'reference-agent', task: makeTask(),
      context: ctx, tenantId, projectId: proj, userRole: 'OWNER'
    });
    return { outcome, trace: buildTaskTrace({ outcome, tenantId, projectId: proj }) };
  }

  /** Produit une trace BATCH RÉELLE via le vrai scheduler. */
  async function realBatchTrace(executionId: string, proj = projectId) {
    const { scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await scheduler.execute({
      executionId, tenantId, projectId: proj,
      tasks: [
        { taskId: 'alpha', agentId: 'reference-agent', dependencies: [], order: 1, task: { ...makeTask(), id: 'alpha', requiredContext: { targetFiles: ['src/alpha.ts'] } } },
        { taskId: 'beta', agentId: 'reference-agent', dependencies: [], order: 2, task: { ...makeTask(), id: 'beta', requiredContext: { targetFiles: ['src/beta.ts'] } } }
      ],
      maxConcurrency: 4, userRole: 'OWNER'
    });
    return { outcome, trace: buildBatchTrace({ outcome, tenantId, projectId: proj }) };
  }

  // A/B/C — record/get/query exacts
  it('A+B+C: record/get/query exacts (trace réelle TASK)', async () => {
    const store = new AgentTraceStore({ persist: false });
    const { trace } = await realTaskTrace('agx-e38s-a');

    store.record(trace);
    const got = store.get(tenantId, projectId, 'agx-e38s-a');
    assert.ok(got, 'trace récupérable');
    assert.deepEqual(got, trace, 'deepEqual avec la trace fournie');

    const queried = store.query(tenantId, projectId);
    assert.equal(queried.length, 1);
    assert.deepEqual(queried[0], trace);
    assert.equal(queried[0]!.kind, 'TASK');
  });

  // D/E/F/G — isolation tenant/projet + clé composite + upsert
  it('D+E+F+G: isolation tenant/projet, clé composite, upsert sans doublon', async () => {
    const store = new AgentTraceStore({ persist: false });
    const { trace } = await realTaskTrace('agx-e38s-shared');

    // Même executionId, tenant différent → deux traces DISTINCTES
    const otherTenant = JSON.parse(JSON.stringify({ ...trace, tenantId: 'tenant-autre' })) as ExecutionTrace;
    store.record(trace);
    store.record(otherTenant);
    assert.equal(store.get('tenant-autre', projectId, 'agx-e38s-shared')!.tenantId, 'tenant-autre');
    assert.equal(store.get(tenantId, projectId, 'agx-e38s-shared')!.tenantId, tenantId);
    assert.equal(store.query('tenant-autre', projectId).length, 1);

    // Même executionId, projet différent → trace distincte
    const otherProject = JSON.parse(JSON.stringify({ ...trace, projectId: 'proj-autre' })) as ExecutionTrace;
    store.record(otherProject);
    assert.equal(store.query(tenantId, 'proj-autre').length, 1);
    assert.equal(store.query(tenantId, projectId).length, 1);

    // get() exige tenantId + projectId + executionId exacts
    assert.equal(store.get(tenantId, 'proj-autre', 'agx-e38s-shared')!.projectId, 'proj-autre');
    assert.equal(store.get('tenant-inexistant', projectId, 'agx-e38s-shared'), undefined);
    assert.equal(store.get(tenantId, projectId, 'execution-inexistante'), undefined);

    // Upsert : même clé → remplacement, aucun doublon
    const { trace: trace2 } = await realTaskTrace('agx-e38s-shared', projectId);
    store.record(trace2);
    assert.equal(store.query(tenantId, projectId).length, 1, 'aucun doublon');
    assert.equal(store.get(tenantId, projectId, 'agx-e38s-shared')!.startedAt, trace2.startedAt);
  });

  // H/I — cap 500, plus récentes conservées
  it('H+I: cap 500 — exactement 500 conservées, les plus récentes, aucune corruption', async () => {
    const store = new AgentTraceStore({ persist: false });
    const { trace: first } = await realTaskTrace('agx-e38s-first');
    store.record(first);
    // 501 traces au total : first + 500 générées
    for (let i = 0; i < AGENT_TRACE_MAX; i++) {
      const { trace } = await realTaskTrace(`agx-e38s-gen-${i}`);
      store.record(trace);
    }
    assert.equal(AGENT_TRACE_MAX, 500);
    assert.equal(store.query(tenantId, projectId).length, 500, 'exactement 500 conservées');
    assert.equal(store.get(tenantId, projectId, 'agx-e38s-first'), undefined, 'la plus ancienne est éliminée');
    assert.ok(store.get(tenantId, projectId, `agx-e38s-gen-${AGENT_TRACE_MAX - 1}`), 'la plus récente est conservée');
    // Aucune trace d'un autre périmètre n'a été supprimée par erreur
    const { trace: other } = await realTaskTrace('agx-e38s-other', 'proj-autre-cap');
    store.record(other);
    assert.ok(store.get(tenantId, 'proj-autre-cap', 'agx-e38s-other'));
  });

  // J/K — persist:false
  it('J: persist:false — mémoire uniquement, nouvelle instance vide', async () => {
    const store = new AgentTraceStore({ persist: false });
    const { trace } = await realTaskTrace('agx-e38s-j');
    store.record(trace);
    assert.ok(store.get(tenantId, projectId, 'agx-e38s-j'), 'get en mémoire fonctionne');
    const fresh = new AgentTraceStore({ persist: false });
    assert.equal(fresh.get(tenantId, projectId, 'agx-e38s-j'), undefined, 'nouvelle instance vide');
  });

  // K/L/R — persistance réelle : rechargement multi-traces + isolation après reconstruction
  it('K+L+R: persistance réelle — record → NOUVELLE instance persist:true → traces retrouvées et isolées', async () => {
    const store = new AgentTraceStore({ persist: true });
    const { trace: taskTrace } = await realTaskTrace('agx-e38s-k-task');
    const { trace: batchTrace } = await realBatchTrace('agxb-e38s-k-batch', projectId);
    const otherTenant = JSON.parse(JSON.stringify({ ...taskTrace, tenantId: 'tenant-e38s-autre' })) as ExecutionTrace;
    store.record(taskTrace);
    store.record(batchTrace);
    store.record(otherTenant);

    // Rechargement : NOUVELLE instance persist:true sur le MÊME répertoire réel
    const reloaded = new AgentTraceStore({ persist: true });
    const got = reloaded.get(tenantId, projectId, 'agx-e38s-k-task');
    assert.ok(got, 'trace TASK toujours présente après reconstruction');
    assert.deepEqual(got, taskTrace, 'contenu identique après rechargement');
    const gotBatch = reloaded.get(tenantId, projectId, 'agxb-e38s-k-batch');
    assert.ok(gotBatch, 'trace BATCH toujours présente');
    assert.equal(gotBatch.kind, 'BATCH');
    assert.equal(gotBatch.tasks?.length, 2);
    assert.equal(reloaded.get('tenant-e38s-autre', projectId, 'agx-e38s-k-task')!.tenantId, 'tenant-e38s-autre');
    assert.equal(reloaded.get(tenantId, projectId, 'agx-e38s-k-task')!.tenantId, tenantId);
    assert.equal(reloaded.query('tenant-e38s-autre', projectId).length, 1);
    assert.equal(reloaded.query(tenantId, projectId).length, 2);
  });

  // M — clear
  it('M: clear() vide mémoire ET persistance associée', async () => {
    const store = new AgentTraceStore({ persist: true });
    const { trace } = await realTaskTrace('agx-e38s-m');
    store.record(trace);
    assert.ok(store.get(tenantId, projectId, 'agx-e38s-m'));
    store.clear();
    assert.equal(store.query(tenantId, projectId).length, 0);
    const reloaded = new AgentTraceStore({ persist: true });
    assert.equal(reloaded.query(tenantId, projectId).length, 0, 'persistance vidée');
  });

  // N/O — fidélité profonde + aucune fabrication
  it('N+O: fidélité profonde — champs conservés, absences conservées, rien de fabriqué', async () => {
    const store = new AgentTraceStore({ persist: false });
    const { trace } = await realTaskTrace('agx-e38s-no');
    store.record(trace);
    const got = store.get(tenantId, projectId, 'agx-e38s-no')!;

    assert.deepEqual(got, trace, 'fidélité structurelle complète');
    assert.deepEqual(got.phases, trace.phases);
    assert.equal(got.mutation?.transactionId, trace.mutation?.transactionId);
    assert.deepEqual(got.gate, trace.gate);
    assert.equal(got.repair, undefined, 'repair absent reste absent (aucune fabrication)');
    assert.equal(got.counts, undefined, 'counts absent pour une trace TASK');
    assert.equal(got.tasks, undefined, 'tasks absent pour une trace TASK');
    assert.equal(got.parentExecutionId, undefined, 'parent absent hors batch');
    // Aucun champ supplémentaire apparu
    assert.deepEqual(Object.keys(got).sort(), Object.keys(trace).sort());
  });

  // Trace BATCH : gate/repair/tasks/corrélations conservés
  it('Trace BATCH: gate/tâches/corrélations/verdicts réels conservés fidèlement', async () => {
    const store = new AgentTraceStore({ persist: false });
    const { trace } = await realBatchTrace('agxb-e38s-batch', projectId);
    store.record(trace);
    const got = store.get(tenantId, projectId, 'agxb-e38s-batch')!;
    assert.deepEqual(got, trace);
    assert.equal(got.tasks![0]!.taskExecutionId, 'agxb-e38s-batch--alpha');
    assert.equal(got.tasks![0]!.executionStatus, 'SUCCESS');
  });

  // BLOCKED/PENDING sans executionStatus
  it('Trace BLOCKED/PENDING: executionStatus absent, blockedReason conservé', async () => {
    // Le fichier pré-existant doit être dans LA SOURCE de la chaîne.
    const source = new InMemoryMutableFileSource({});
    source.createFile(tenantId, projectId, 'src/exists.ts', 'export const original = 1;\n');
    const { scheduler } = makeChain(source);

    const outcome = await scheduler.execute({
      executionId: 'agxb-e38s-blocked', tenantId, projectId,
      tasks: [
        makeSpec('fail', 1, 'src/exists.ts'),
        makeSpec('child', 2, 'src/child.ts', ['fail'])
      ],
      maxConcurrency: 4, userRole: 'OWNER'
    });
    const trace = buildBatchTrace({ outcome, tenantId, projectId });
    const store = new AgentTraceStore({ persist: false });
    store.record(trace);
    const got = store.get(tenantId, projectId, 'agxb-e38s-blocked')!;
    assert.deepEqual(got, trace);
    const fail = got.tasks!.find((t) => t.taskId === 'fail')!;
    assert.equal(fail.status, 'FAILED', 'CREATE sur existant refusé par le single-writer');
    const child = got.tasks!.find((t) => t.taskId === 'child')!;
    assert.equal(child.status, 'BLOCKED');
    assert.equal(child.executionStatus, undefined, 'jamais exécutée : aucun verdict inventé');
    assert.match(child.blockedReason ?? '', /dépendance/);
  });

  // S — déterminisme structurel
  it('S: déterminisme — mêmes traces → même résultat structurel', async () => {
    const buildStore = async () => {
      const store = new AgentTraceStore({ persist: false });
      const { trace: t1 } = await realTaskTrace('agx-e38s-s1');
      const { trace: t2 } = await realTaskTrace('agx-e38s-s2');
      store.record(t1);
      store.record(t2);
      return { store, traces: [t1, t2] };
    };
    const a = await buildStore();
    const b = await buildStore();
    const projection = (store: AgentTraceStore) =>
      store.query(tenantId, projectId).map((t) => ({
        executionId: t.executionId,
        kind: t.kind,
        status: t.status,
        artifactCount: t.artifactCount,
        gatePassed: t.gate?.passed
      }));
    assert.deepEqual(projection(a.store), projection(b.store));
    assert.deepEqual(
      a.traces.map((t) => t.executionId),
      b.traces.map((t) => t.executionId)
    );
  });

  // P/T — inspection du source : pas de node:fs, réutilisation de la persistance existante
  it('P+T: source sans node:fs, réutilisant json-disk-cache, sans verdict ni mutation', () => {
    const full = resolve(process.cwd(), 'packages/core/src/observability/agent-trace-store.ts');
    assert.ok(existsSync(full));
    const raw = readFileSync(full, 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(codeOnly, /node:fs/);
    assert.doesNotMatch(codeOnly, /writeFile\(|appendFile|createWriteStream/);
    assert.ok(codeOnly.includes('dataFilePath'), 'réutilise dataFilePath existant');
    assert.ok(codeOnly.includes('readJsonFile') && codeOnly.includes('writeJsonFileSync'), 'réutilise readJsonFile/writeJsonFileSync existants');
    assert.doesNotMatch(codeOnly, /MutationBridge|MutationOrchestratorService|AgentRegistry/, 'aucune dépendance de mutation/registry');
    assert.doesNotMatch(codeOnly, /'SUCCESS'|'COMPLETED'|success: true/, 'aucun verdict produit par le store');
    assert.match(codeOnly, /AGENT_TRACE_MAX = 500/, 'cap 500');
  });

  // Q — failure-safe persistance
  it('Q: failure-safe — l échec de persistance ne jette pas et conserve la trace en mémoire', async () => {
    const store = new AgentTraceStore({ persist: true });
    const { trace } = await realTaskTrace('agx-e38s-q');
    // Monkey-patch de la primitive EXISTANTE pour provoquer l'échec d'écriture
    // On perturbe la persistance via VOLACO_DATA_DIR invalide (primitives
    // existantes) : écrire vers un chemin impossible ne doit rien lancer.
    const previousDataDir = process.env.VOLACO_DATA_DIR;
    process.env.VOLACO_DATA_DIR = 'Z:\\chemin\\inexistant\\pour\\e38s';
    // Nouveau store : sa persistance visera un chemin invalide
    const brokenStore = new AgentTraceStore({ persist: true });
    process.env.VOLACO_DATA_DIR = previousDataDir;
    assert.doesNotThrow(() => brokenStore.record(trace), 'record ne jette jamais même si la persistance échoue');
    // La trace reste consultable en mémoire malgré l'échec de persistance
    assert.ok(brokenStore.get(tenantId, projectId, 'agx-e38s-q'), 'trace conservée en mémoire');
    assert.equal(brokenStore.get(tenantId, projectId, 'agx-e38s-q')!.status, trace.status, 'verdict inchangé');
    void store;
  });

  // ============================================================================
  // ÉTAPE 39 Phase 5 — CAP ISOLÉ PAR tenantId + projectId
  // ============================================================================
  describe('É39 Phase 5 — cap isolé par tenant/projet', () => {
    function makeBucketTrace(executionId: string, tenantId: string, projectId: string, status: string = 'SUCCESS'): ExecutionTrace {
      return buildTaskTrace({
        outcome: {
          executionId, agentId: 'reference-agent', taskId: 'task-' + executionId,
          status: status as never,
          result: { taskId: 'task-' + executionId, agentId: 'reference-agent', status: 'SUCCESS' as const, artifacts: [], conflicts: [], tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 1 },
          artifacts: [], mutation: { requested: false, executed: false, appliedCount: 0 },
          verification: { performed: false, passed: false, checks: [] },
          rollback: { performed: false, verified: false, restoredFiles: [] },
          cancellation: { requested: false },
          phases: [], startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', durationMs: 1000
        },
        tenantId, projectId
      });
    }

    it('A+B: tenant A à 501 → 500 conservées ; tenant B à 501 → 500 conservées (indépendamment)', async () => {
      const store = new AgentTraceStore({ persist: false });
      for (let i = 0; i < AGENT_TRACE_MAX + 1; i++) {
        store.record(makeBucketTrace('agx-a-' + i, 'tenant-a-cap', 'proj-a-cap'));
      }
      for (let i = 0; i < AGENT_TRACE_MAX + 1; i++) {
        store.record(makeBucketTrace('agx-b-' + i, 'tenant-b-cap', 'proj-b-cap'));
      }
      assert.equal(store.query('tenant-a-cap', 'proj-a-cap').length, AGENT_TRACE_MAX, 'bucket A = 500');
      assert.equal(store.query('tenant-b-cap', 'proj-b-cap').length, AGENT_TRACE_MAX, 'bucket B = 500');
    });

    it('C: la 501e trace de A n évince aucune trace de B', async () => {
      const store = new AgentTraceStore({ persist: false });
      // B d abord (une trace), puis A déborde, puis vérifier B intact
      store.record(makeBucketTrace('agx-b-keep', 'tenant-b-cap', 'proj-b-cap'));
      for (let i = 0; i < AGENT_TRACE_MAX + 1; i++) {
        store.record(makeBucketTrace('agx-a-' + i, 'tenant-a-cap', 'proj-a-cap'));
      }
      assert.ok(store.get('tenant-b-cap', 'proj-b-cap', 'agx-b-keep'), 'la trace de B est intacte après débordement de A');
    });

    it('D+E: la plus ancienne de A est évincée, la plus récente conservée', async () => {
      const store = new AgentTraceStore({ persist: false });
      for (let i = 0; i < AGENT_TRACE_MAX + 1; i++) {
        store.record(makeBucketTrace('agx-a-' + i, 'tenant-a-cap', 'proj-a-cap'));
      }
      assert.equal(store.get('tenant-a-cap', 'proj-a-cap', 'agx-a-0'), undefined, 'la plus ancienne évincée');
      assert.ok(store.get('tenant-a-cap', 'proj-a-cap', 'agx-a-' + AGENT_TRACE_MAX), 'la plus récente conservée');
    });

    it('F: même comportement pour plusieurs projets d un même tenant', async () => {
      const store = new AgentTraceStore({ persist: false });
      for (let i = 0; i < AGENT_TRACE_MAX + 1; i++) {
        store.record(makeBucketTrace('agx-p1-' + i, 'tenant-multi', 'proj-multi-1'));
      }
      for (let i = 0; i < 3; i++) {
        store.record(makeBucketTrace('agx-p2-' + i, 'tenant-multi', 'proj-multi-2'));
      }
      assert.equal(store.query('tenant-multi', 'proj-multi-1').length, AGENT_TRACE_MAX, 'proj-1 borné à 500');
      assert.equal(store.query('tenant-multi', 'proj-multi-2').length, 3, 'proj-2 intact (bucket distinct)');
    });

    it('G: upsert d une trace existante ne crée pas de doublon (cap isolé)', async () => {
      const store = new AgentTraceStore({ persist: false });
      for (let i = 0; i < AGENT_TRACE_MAX; i++) {
        store.record(makeBucketTrace('agx-up-' + i, 'tenant-up', 'proj-up'));
      }
      assert.equal(store.query('tenant-up', 'proj-up').length, AGENT_TRACE_MAX);
      // Upsert de la trace la plus récente : toujours 500, pas 501
      store.record(makeBucketTrace('agx-up-' + (AGENT_TRACE_MAX - 1), 'tenant-up', 'proj-up'));
      assert.equal(store.query('tenant-up', 'proj-up').length, AGENT_TRACE_MAX);
    });

    it('M: rétrocompatibilité — traces au format persistant existant lisibles', async () => {
      const store = new AgentTraceStore({ persist: true });
      const { trace } = await realTaskTrace('agx-e38s-m-retro');
      store.record(trace);
      // Le format persistant reste un tableau ExecutionTrace[] : une nouvelle
      // instance lit l'existant sans migration.
      const reloaded = new AgentTraceStore({ persist: true });
      assert.deepEqual(reloaded.get(tenantId, projectId, 'agx-e38s-m-retro'), trace);
    });

    it('O: aucun node:fs ni backend nouveau — éviction purement en mémoire', () => {
      const full = resolve(process.cwd(), 'packages/core/src/observability/agent-trace-store.ts');
      assert.ok(existsSync(full));
      const code = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(code, /node:fs/);
      assert.ok(code.includes('enforceBucketCap'), 'éviction par bucket');
      assert.ok(code.includes('slice(0, excess)'), 'éviction déterministe des plus anciennes');
    });
  });

  // Protection contre mutation externe
  it('Fidélité: muter l objet original après record ne modifie pas la trace stockée', async () => {
    const store = new AgentTraceStore({ persist: false });
    const { trace } = await realTaskTrace('agx-e38s-frozen');
    const mutable = { ...trace, status: 'SUCCESS' };
    store.record(mutable);
    // Tentative de mutation post-record de l'objet passé
    (mutable as { status: string }).status = 'FAILURE';
    assert.equal(store.get(tenantId, projectId, 'agx-e38s-frozen')!.status, 'SUCCESS', 'trace stockée figée à l enregistrement');
  });

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
});
