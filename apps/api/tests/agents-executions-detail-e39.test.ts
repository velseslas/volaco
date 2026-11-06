/**
 * ÉTAPE 39 Phase 3 — GET /agents/executions/:executionId/tasks
 *
 * Détail corrélé d'un batch : la trace BATCH stockée + les traces TASK
 * stockées (corrélation batchExecutionId/taskExecutionId — convention É37).
 * Lecture PURE : les tâches jamais exécutées (BLOCKED/PENDING) restent dans
 * tasksWithoutTrace — AUCUNE ExecutionTrace fabriquée.
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  AgentTraceStore,
  assertPermission,
  agentTraceStore,
  ForbiddenError
} from '../../../packages/core/src/index.js';

describe('ÉTAPE 39 Phase 3 — GET /agents/executions/:executionId/tasks', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_p39d';

  let okBatchId = 'agxb-p3d-ok';        // batch COMPLETED (2 tâches réussies)
  let mixedBatchId = 'agxb-p3d-mixed';  // batch avec une tâche FAILED + BLOCKED + COMPLETED
  let taskExecutionIds: string[] = [];

  function tasksUrl(executionId: string, proj = projectId, ten = tenant): string {
    return `${baseUrl}/api/v1/projects/${proj}/agents/executions/${encodeURIComponent(executionId)}/tasks`;
  }
  function headers(ten = tenant, role = 'OWNER'): Record<string, string> {
    return { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': ten, 'x-user-role': role };
  }

  before(async () => {
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers: headers(), body: JSON.stringify({ name: 'E39 P3 détail batch' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;

    // Batch 1 — COMPLETED : 2 tâches indépendantes réussies
    const b1 = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute-batch`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ executionId: okBatchId, tasks: [
        { taskId: 'ok-a', agentId: 'reference-agent', order: 1, task: { title: 'OK A', operation: 'CREATE', targetFiles: ['src/ok-a.ts'], requiredCapabilities: ['FILE_MUTATION'] } },
        { taskId: 'ok-b', agentId: 'reference-agent', order: 2, task: { title: 'OK B', operation: 'CREATE', targetFiles: ['src/ok-b.ts'], requiredCapabilities: ['FILE_MUTATION'] } }
      ] })
    });
    assert.equal(b1.status, 200);

    // Batch 2 — FAILED avec BLOCKED : fail (CREATE sur existant) → blocked (dépend)
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ agentId: 'reference-agent', executionId: 'agx-p3d-precreate', task: { title: 'Pre', operation: 'CREATE', targetFiles: ['src/pre.ts'], requiredCapabilities: ['FILE_MUTATION'] } })
    });
    const b2 = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute-batch`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ executionId: mixedBatchId, tasks: [
        { taskId: 'mixed-ok', agentId: 'reference-agent', order: 1, task: { title: 'Mixed OK', operation: 'CREATE', targetFiles: ['src/mixed-ok.ts'], requiredCapabilities: ['FILE_MUTATION'] } },
        { taskId: 'mixed-fail', agentId: 'reference-agent', order: 2, task: { title: 'Mixed FAIL', operation: 'CREATE', targetFiles: ['src/pre.ts'], requiredCapabilities: ['FILE_MUTATION'] } },
        { taskId: 'mixed-blocked', agentId: 'reference-agent', order: 3, dependencies: ['mixed-fail'], task: { title: 'Mixed BLOCKED', operation: 'CREATE', targetFiles: ['src/mixed-blocked.ts'], requiredCapabilities: ['FILE_MUTATION'] } }
      ] })
    });
    assert.equal(b2.status, 200);

    // taskExecutionIds réels (convention É37)
    taskExecutionIds = [`${okBatchId}--ok-a`, `${okBatchId}--ok-b`];
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // A — batch trouvé → 200 + shape exacte
  it('A: batch réel trouvé → 200, shape {batch, taskTraces, tasksWithoutTrace, requestId}', async () => {
    const res = await fetch(tasksUrl(okBatchId), { headers: headers() });
    console.error("[DBG-A] store:", JSON.stringify(agentTraceStore.query(tenant, projectId).map((t) => ({ id: t.executionId, kind: t.kind }))));
    if (res.status !== 200) console.error("[DBG-A] status:", res.status, "body:", JSON.stringify(await res.json()).slice(0, 300));
    const body = await res.json() as Record<string, unknown>;
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['batch', 'requestId', 'taskTraces', 'tasksWithoutTrace']);
    assert.equal((body.batch as { kind?: string }).kind, 'BATCH');
    assert.equal((body.batch as { executionId?: string }).executionId, okBatchId);
    assert.equal((body.taskTraces as unknown[]).length, 2);
    assert.deepEqual(body.tasksWithoutTrace, [], 'toutes les tâches ont été exécutées');
  });

  // B — batch inexistant → 404 NOT_FOUND
  it('B: batch inexistant → 404 NOT_FOUND', async () => {
    const res = await fetch(tasksUrl('agxb-inexistant-p3d'), { headers: headers() });
    assert.equal(res.status, 404);
    const body = await res.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, 'NOT_FOUND');
  });

  // C/D — cross-tenant / cross-project → 404 canonique identique
  it('C+D: cross-tenant et cross-project → même 404 canonique, aucune fuite', async () => {
    const ct = await fetch(tasksUrl(okBatchId, projectId, 'tenant_p39d_autre'));
    assert.equal(ct.status, 404);
    const cp = await fetch(tasksUrl(okBatchId, 'proj-autre-p3d'));
    assert.equal(cp.status, 404);
    const ctBody = await ct.json() as { error?: { code?: string; message?: string } };
    const cpBody = await cp.json() as { error?: { code?: string; message?: string } };
    assert.equal(ctBody.error?.code, 'NOT_FOUND');
    assert.equal(cpBody.error?.code, 'NOT_FOUND');
    assert.doesNotMatch(ctBody.error?.message ?? '', /reference-agent|COMPLETED|SUCCESS/);
  });

  // E/F/G/H/I — tâches jamais exécutées et statuts réellement stockés
  it('E→I: batch mixte — FAILED conservé, BLOCKED dans tasksWithoutTrace, COMPLETED avec trace complète', async () => {
    const res = await fetch(tasksUrl(mixedBatchId), { headers: headers() });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      batch: { status?: string; counts?: Record<string, number> };
      taskTraces: Array<{ executionId: string; status: string }>;
      tasksWithoutTrace: Array<{ taskId: string; status: string; blockedReason?: string }>;
    };

    // F — TASK COMPLETED réelle : trace complète présente
    const okTrace = body.taskTraces.find((t) => t.executionId === `${mixedBatchId}--mixed-ok`);
    assert.ok(okTrace, 'la tâche réussie a sa trace TASK');
    assert.equal(okTrace!.status, 'SUCCESS');

    // G — TASK FAILED réelle : trace présente avec le verdict réel
    const failTrace = body.taskTraces.find((t) => t.executionId === `${mixedBatchId}--mixed-fail`);
    assert.ok(failTrace, 'la tâche échouée a sa trace TASK');
    assert.equal(failTrace!.status, 'FAILURE');

    // E+H — BLOCKED : JAMAIS de trace TASK fabriquée, identifiable via tasksWithoutTrace
    assert.ok(!body.taskTraces.some((t) => t.executionId === `${mixedBatchId}--mixed-blocked`), 'aucune trace fabriquée pour une tâche jamais exécutée');
    const blocked = body.tasksWithoutTrace.find((t) => t.taskId === 'mixed-blocked');
    assert.ok(blocked, 'la tâche bloquée est identifiable via tasksWithoutTrace');
    assert.equal(blocked!.status, 'BLOCKED');
    assert.match(blocked!.blockedReason ?? '', /dépendance/);

    // Statuts réellement stockés (batch FAILED, counts réels)
    assert.equal(body.batch?.status, 'FAILED');
    assert.equal(body.batch?.counts?.failed, 1);
    assert.equal(body.batch?.counts?.blocked, 1);
    assert.equal(body.batch?.counts?.completed, 1);
  });

  // J — corrélation batch → TASK exacte
  it('J: corrélation batch → TASK exacte (convention É37, taskExecutionIds réels)', async () => {
    const res = await fetch(tasksUrl(okBatchId), { headers: headers() });
    const body = await res.json() as { taskTraces: Array<{ executionId: string; batchExecutionId?: string }> };
    assert.deepEqual(
      body.taskTraces.map((t) => t.executionId).sort(),
      taskExecutionIds.slice().sort(),
      'taskExecutionIds = <batchId>--<taskId> réels'
    );
    assert.ok(body.taskTraces.every((t) => t.batchExecutionId === okBatchId), 'corrélation persistée dans chaque trace TASK');
  });

  // K+L+N — transactionId / Gate / rollback réels conservés
  it('K+L+N: transactionId, Gate et rollback réels conservés tels quels', async () => {
    const res = await fetch(tasksUrl(okBatchId), { headers: headers() });
    const body = await res.json() as { taskTraces: Array<{ mutation?: { transactionId?: string; executed?: boolean }; gate?: { passed?: boolean }; rollback?: { performed?: boolean; verified?: boolean } }> };
    for (const t of body.taskTraces) {
      assert.match(t.mutation?.transactionId ?? '', /^tx-/, 'transaction AINT-006 réelle');
      assert.equal(t.mutation?.executed, true);
      assert.equal(t.gate?.passed, true, 'Gate réel PASS');
      assert.equal(t.rollback?.performed, false, 'aucun rollback nécessaire (succès réel)');
    }
  });

  // M — Repair uniquement lorsqu'il existe réellement
  it('M: Repair absent sans réparation réelle — présent avec politique + divergence réelle', async () => {
    // Sans politique : aucun repair (batch simple réussi)
    const resOk = await fetch(tasksUrl(okBatchId), { headers: headers() });
    const bodyOk = await resOk.json() as { taskTraces: Array<{ repair?: unknown }> };
    assert.ok(bodyOk.taskTraces.every((t) => t.repair === undefined), 'aucun repair fabriqué');

    // Avec politique + divergence réelle (source corrompue une fois) : repair réel visible
    class CorruptOnceSource extends InMemoryMutableFileSource {
      public writes = 0;
      public override createFile(t: string, p: string, f: string, c: string): void {
        this.writes += 1;
        super.createFile(t, p, f, this.writes === 1 ? c + '\n// CORRUPTED\n' : c);
      }
    }
    const chain = makeLocalChain(new CorruptOnceSource());
    const tenantId = `tenant_p39d_repair`;
    const projectIdR = `proj_p39d_repair`;
    const outcome = await chain.agentExecution.execute({
      executionId: 'agx-p3d-repair', agentId: 'reference-agent', task: makeLocalTask(),
      context: { relevantFiles: {}, relevantSymbols: [], decisions: [], constraints: [], recentHistory: [] },
      tenantId, projectId: projectIdR, userRole: 'OWNER',
      repairPolicy: { enabled: true, maxAttempts: 1 }
    });
    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.repair?.attempted, true);
    // La trace stockée via le pipeline porte le repair réel — le GET le retourne tel quel
    const stored = agentTraceStore.get(tenantId, projectIdR, 'agx-p3d-repair')!;
    assert.deepEqual(stored.repair, outcome.repair);
  });

  // O — phases identiques aux traces persistées
  it('O: phases des taskTraces identiques aux traces persistées dans le store', async () => {
    const res = await fetch(tasksUrl(okBatchId), { headers: headers() });
    const body = await res.json() as { taskTraces: Array<{ executionId: string; phases: unknown[] }> };
    for (const t of body.taskTraces) {
      const stored = agentTraceStore.get(tenant, projectId, t.executionId)!;
      assert.deepEqual(t.phases, stored.phases, 'phases = projection exacte de la trace stockée');
    }
  });

  // P — reconstruction persist:true puis contenu identique
  it('P: reconstruction AgentTraceStore persist:true → même contenu', async () => {
    const reloaded = new AgentTraceStore({ persist: true });
    const reloadedBatch = reloaded.get(tenant, projectId, okBatchId);
    const res = await fetch(tasksUrl(okBatchId), { headers: headers() });
    const body = await res.json() as { batch: unknown; taskTraces: unknown[] };
    assert.deepEqual(
      JSON.parse(JSON.stringify(body.batch)),
      JSON.parse(JSON.stringify(reloadedBatch)),
      'batch GET = batch du store reconstruit'
    );
    for (const t of body.taskTraces as Array<{ executionId: string }>) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(t)),
        JSON.parse(JSON.stringify(reloaded.get(tenant, projectId, t.executionId))),
        'taskTrace GET = trace du store reconstruit'
      );
    }
  });

  // Q — RBAC avant lecture
  it('Q: RBAC — assertPermission(PROJECT_READ) appelé avant la lecture du store', async () => {
    const res = await fetch(tasksUrl(okBatchId), { headers: headers(tenant, 'VIEWER') });
    assert.equal(res.status, 200, 'VIEWER a PROJECT_READ → 200');
    const full = resolve(process.cwd(), 'apps/api/src/routes/agent-execution.ts');
    const code = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const branchStart = code.indexOf("pathname.endsWith('/tasks') && req.method === 'GET'");
    const permIndex = code.indexOf("assertPermission(context.role, 'PROJECT_READ'", branchStart);
    assert.ok(permIndex > branchStart, 'RBAC AVANT la lecture');
    assert.ok(code.indexOf('agentTraceStore.get(', permIndex) > permIndex, 'lecture store APRÈS le RBAC');
    // Le mécanisme de refus existant jette quand la permission manque
    assert.throws(() => assertPermission('VIEWER', 'PROJECT_MUTATE'), ForbiddenError);
  });

  // R — lecture pure (inspection)
  it('R: lecture pure — aucun record(), aucune écriture, aucune exécution dans la branche', () => {
    const full = resolve(process.cwd(), 'apps/api/src/routes/agent-execution.ts');
    const code = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const branchStart = code.indexOf("pathname.endsWith('/tasks') && req.method === 'GET'");
    const detailStart = code.indexOf("pathname.includes('/agents/executions/') && req.method === 'GET'");
    const branch = code.slice(branchStart, detailStart);
    assert.doesNotMatch(branch, /\.record\(/, 'aucune écriture de trace');
    assert.doesNotMatch(branch, /applyArtifacts|rollbackTransaction|execute\(/, 'aucune exécution/mutation');
    assert.doesNotMatch(branch, /node:fs|writeJsonFileSync|readJsonFile/, 'aucun accès filesystem direct');
    assert.doesNotMatch(branch, /buildTaskTrace|buildBatchTrace/, 'aucune reconstruction de trace');
    assert.ok(branch.includes("agentTraceStore.get(context.tenantId, projectId, executionId)"), 'lecture via le store existant');
    assert.ok(branch.includes('agentTraceStore.query(context.tenantId, projectId)'), 'corrélation via le store existant');
  });

  // S — déterminisme
  it('S: déterminisme — deux appels identiques → même réponse (hors requestId)', async () => {
    const r1 = await (await fetch(tasksUrl(okBatchId), { headers: headers() })).json() as Record<string, unknown>;
    const r2 = await (await fetch(tasksUrl(okBatchId), { headers: headers() })).json() as Record<string, unknown>;
    const strip = (b: Record<string, unknown>) => {
      const { requestId, ...rest } = b;
      void requestId;
      return rest;
    };
    assert.deepEqual(strip(r1), strip(r2), 'même batch → même réponse');
  });

  // T — routage : /tasks capturé par la nouvelle branche, détail + POST inchangés
  it('T: routage — /tasks NON capturé par GET /:executionId ; GET détail et POST inchangés', async () => {
    // La branche détail (É38 Phase 6) aurait retourné la trace BATCH brute —
    // la sous-route retourne la shape corrélée : preuve du routage correct.
    const tasksRes = await fetch(tasksUrl(okBatchId), { headers: headers() });
    const tasksBody = await tasksRes.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(tasksBody).sort(), ['batch', 'requestId', 'taskTraces', 'tasksWithoutTrace']);

    // GET détail inchangé : la trace BATCH exacte (É38 Phase 6)
    const detailRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions/${okBatchId}`, { headers: headers() });
    assert.equal(detailRes.status, 200);
    const detailBody = await detailRes.json() as { trace: { kind?: string; executionId?: string } };
    assert.equal(detailBody.trace.kind, 'BATCH');
    assert.equal(detailBody.trace.executionId, okBatchId);

    // POST inchangés
    const headersPost = headers();
    const eRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers: headersPost,
      body: JSON.stringify({ agentId: 'reference-agent', executionId: 'agx-p3d-reg', task: { title: 'REG', operation: 'CREATE', targetFiles: ['src/reg.ts'], requiredCapabilities: ['FILE_MUTATION'] } })
    });
    assert.equal(eRes.status, 200);
    const bRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute-batch`, {
      method: 'POST', headers: headersPost,
      body: JSON.stringify({ executionId: 'agxb-p3d-reg', tasks: [{ taskId: 'reg1', agentId: 'reference-agent', order: 1, task: { title: 'REG B', operation: 'CREATE', targetFiles: ['src/regb.ts'], requiredCapabilities: ['FILE_MUTATION'] } }] })
    });
    assert.equal(bRes.status, 200);
  });

  // Isolation : un batch d'un autre tenant/projet n'est jamais retourné
  it('Isolation: les traces TASK corrélées viennent uniquement du tenant/projet du batch', async () => {
    // Une trace TASK du même executionId chez un AUTRE tenant ne doit pas fuiter
    const other = JSON.parse(JSON.stringify(agentTraceStore.get(tenant, projectId, `${okBatchId}--ok-a`))) as { tenantId: string };
    other.tenantId = 'tenant_p39d_autre';
    // (simulation : on ne peut pas écrire chez un autre tenant sans exécution réelle —
    //  l'isolation est garantie par le filtre tenant de query())
    const res = await fetch(tasksUrl(okBatchId, projectId, 'tenant_p39d_autre'));
    assert.equal(res.status, 404, 'le batch est invisible depuis un autre tenant');
    const resSame = await fetch(tasksUrl(okBatchId), { headers: headers() });
    const body = await resSame.json() as { taskTraces: Array<{ tenantId?: string; batchExecutionId?: string }> };
    assert.ok(body.taskTraces.every((t) => t.tenantId === tenant), 'les traces TASK retournées appartiennent au tenant du batch');
    assert.ok(body.taskTraces.every((t) => t.batchExecutionId === okBatchId), 'les traces TASK retournées appartiennent au batch demandé');
  });
});

// Chaîne locale pour le test M (repair réel) — même montage que É35/É36
import { InMemoryMutableFileSource, CodeIntelligenceService, ApplicationDNAService, SemanticCodeGraphService, ImpactIntelligenceService, MutationOrchestratorService, MutationBridge, AgentRegistryService, AgentExecutionService, ReferenceAgent, type AgentTask } from '../../../packages/core/src/index.js';

function makeLocalChain(source: InMemoryMutableFileSource) {
  const codeIntel = new CodeIntelligenceService(source);
  const dna = new ApplicationDNAService(codeIntel);
  const graph = new SemanticCodeGraphService(codeIntel, dna, source);
  const impact = new ImpactIntelligenceService(graph);
  const mutationOrchestrator = new MutationOrchestratorService(source, codeIntel, dna, graph, impact);
  const registry = new AgentRegistryService();
  registry.register(new ReferenceAgent());
  const agentExecution = new AgentExecutionService(registry, new MutationBridge(mutationOrchestrator), source);
  return { agentExecution };
}

function makeLocalTask(): AgentTask {
  return {
    id: `task-p3d-${Math.random().toString(36).slice(2, 6)}`,
    title: 'Tâche repair P3d', description: '', domain: 'ARCHITECTURE', priority: 1,
    dependencies: [], requiredContext: { targetFiles: ['src/repair-target.ts'] },
    requiredCapabilities: ['FILE_MUTATION'], status: 'READY', operation: 'CREATE',
    retryCount: 0, maxRetries: 0
  };
}
