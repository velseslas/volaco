/**
 * ÉTAPE 41 Phase C — détail d'une exécution BATCH dans le panneau Agents.
 *
 * Le panneau consomme EXCLUSIVEMENT les routes GET existantes :
 * GET /agents/executions/:id (trace BATCH) + GET /agents/executions/:id/tasks
 * (traces TASK corrélées + tasksWithoutTrace). Lecture pure — les tâches
 * BLOCKED/PENDING restent sans trace fabriquée.
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { agentTraceStore } from '../../../packages/core/src/index.js';

describe('ÉTAPE 41 Phase C — détail BATCH corrélé (GET /:id + /tasks)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_e41c';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

  let okBatchId = 'agxb-e41c-ok';        // batch COMPLETED (2 tâches réussies)
  let mixedBatchId = 'agxb-e41c-mixed';  // batch FAILED avec BLOCKED

  function createBatchUrl(projectId: string): string {
    return baseUrl + '/api/v1/projects/' + projectId + '/agents/execute-batch';
  }
  function batchUrl(id: string, suffix = ''): string {
    return `${baseUrl}/api/v1/projects/${projectId}/agents/executions/${encodeURIComponent(id)}${suffix}`;
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
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E41 PC détail batch' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;

    // Batch 1 — COMPLETED : 2 tâches réussies
    const b1 = await fetch(createBatchUrl(projectId), {
      method: 'POST', headers,
      body: JSON.stringify({ executionId: okBatchId, tasks: [
        { taskId: 'ok-a', agentId: 'reference-agent', order: 1, task: { title: 'OK A', operation: 'CREATE', targetFiles: ['src/ok-a.ts'], requiredCapabilities: ['FILE_MUTATION'] } },
        { taskId: 'ok-b', agentId: 'reference-agent', order: 2, task: { title: 'OK B', operation: 'CREATE', targetFiles: ['src/ok-b.ts'], requiredCapabilities: ['FILE_MUTATION'] } }
      ] })
    });
    assert.equal(b1.status, 200);

    // Batch 2 — FAILED avec BLOCKED : fail (CREATE sur existant) → blocked (dépend)
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers,
      body: JSON.stringify({ agentId: 'reference-agent', executionId: 'agx-p3d-pre', task: { title: 'Pre', operation: 'CREATE', targetFiles: ['src/pre.ts'], requiredCapabilities: ['FILE_MUTATION'] } })
    });
    const b2 = await fetch(createBatchUrl(projectId), {
      method: 'POST', headers,
      body: JSON.stringify({ executionId: mixedBatchId, tasks: [
        { taskId: 'm-ok', agentId: 'reference-agent', order: 1, task: { title: 'MO', operation: 'CREATE', targetFiles: ['src/m-ok.ts'], requiredCapabilities: ['FILE_MUTATION'] } },
        { taskId: 'm-fail', agentId: 'reference-agent', order: 2, task: { title: 'MF', operation: 'CREATE', targetFiles: ['src/pre.ts'], requiredCapabilities: ['FILE_MUTATION'] } },
        { taskId: 'm-blk', agentId: 'reference-agent', order: 3, dependencies: ['m-fail'], task: { title: 'MB', operation: 'CREATE', targetFiles: ['src/m-blk.ts'], requiredCapabilities: ['FILE_MUTATION'] } }
      ] })
    });
    assert.equal(b2.status, 200);
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // 1/2/5/6 — BATCH réel sélectionnable, détail réel servi (executionId/kind/status)
  it('1+2+5+6: batch réel sélectionnable → GET /:id sert le détail BATCH réel (id/kind/status)', async () => {
    const res = await fetch(batchUrl(okBatchId), { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { trace: { executionId?: string; kind?: string; status?: string } };
    assert.equal(body.trace.executionId, okBatchId);
    assert.equal(body.trace.kind, 'BATCH');
    assert.equal(body.trace.status, 'COMPLETED');
  });

  // 3 — GET /:id/tasks réellement consommé
  it('3: GET /:id/tasks réellement consommé → traces TASK corrélées', async () => {
    const res = await fetch(batchUrl(okBatchId, '/tasks'), { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { batch: { executionId?: string }; taskTraces: Array<{ executionId?: string }>; tasksWithoutTrace: unknown[] };
    assert.equal(body.batch.executionId, okBatchId);
    assert.equal(body.taskTraces.length, 2);
  });

  // 4/7 — executionId + compteurs identiques au backend
  it('4+7: counts identiques au backend (aucun verdict recalculé côté panneau)', async () => {
    const detail = await (await fetch(batchUrl(okBatchId), { headers })).json() as { trace: { counts?: Record<string, unknown>; status?: string } };
    const tasks = await (await fetch(batchUrl(okBatchId, '/tasks'), { headers })).json() as { batch?: { counts?: Record<string, unknown> } };
    assert.deepEqual(detail.trace.counts, { completed: 2, failed: 0, cancelled: 0, blocked: 0, pending: 0, total: 2 });
    assert.deepEqual(tasks.batch?.counts, detail.trace.counts, 'compteurs identiques entre /:id et /tasks');
    assert.equal(detail.trace.status, 'COMPLETED');
  });

  // 8/9 — TASK corrélées identiques + corrélation par identifiant
  it('8+9: TASK corrélées identiques au backend, corrélation par taskExecutionId (jamais par position)', async () => {
    const tasks = await (await fetch(batchUrl(okBatchId, '/tasks'), { headers })).json() as {
      batch: { executionId?: string };
      taskTraces: Array<{ executionId?: string; batchExecutionId?: string }>;
    };
    assert.equal(tasks.batch?.executionId, okBatchId);
    for (const t of tasks.taskTraces) {
      assert.equal(t.batchExecutionId, okBatchId, 'chaque trace TASK porte le batchExecutionId réel');
      assert.match(t.executionId ?? '', new RegExp('^' + okBatchId + '--'));
    }
  });

  // 10/11 — tasksWithoutTrace préservé (batch FAILED avec BLOCKED)
  it('10+11: BLOCKED conservé dans tasksWithoutTrace — aucune trace fabriquée', async () => {
    const res = await fetch(batchUrl(mixedBatchId, '/tasks'), { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { batch: { status?: string }; taskTraces: Array<{ executionId?: string }>; tasksWithoutTrace: Array<{ taskId?: string; status?: string; blockedReason?: string }> };
    assert.equal(body.batch?.status, 'FAILED');
    const blocked = body.tasksWithoutTrace.find((t) => t.taskId === 'm-blk');
    assert.ok(blocked, 'la tâche bloquée est identifiable');
    assert.equal(blocked!.status, 'BLOCKED');
    assert.match(blocked!.blockedReason ?? '', /dépendance/);
    assert.ok(!body.taskTraces.some((t) => (t.executionId ?? '').endsWith('m-blk')), 'aucune trace fabriquée pour la tâche bloquée');
  });

  // 12 — aucun Gate/artifact/mutation fabriqué pour une tâche sans trace
  it('12: les tâches BLOCKED/PENDING n ont ni gate ni artifacts ni mutation fabriqués', async () => {
    const res = await fetch(batchUrl(mixedBatchId, '/tasks'), { headers });
    const body = await res.json() as { tasksWithoutTrace: Array<Record<string, unknown>> };
    for (const t of body.tasksWithoutTrace) {
      assert.equal(t.gate, undefined, 'aucun gate fabriqué');
      assert.equal(t.artifacts, undefined, 'aucun artifact fabriqué');
      assert.equal(t.mutation, undefined, 'aucune mutation fabriquée');
    }
  });

  // 13 — échappement HTML dans le rendu du détail batch
  it('13: échappement HTML — le rendu du détail batch échappe les valeurs', () => {
    const full = resolve(process.cwd(), 'apps/studio/index.html');
    const served = readFileSync(full, 'utf8');
    assert.match(served, /function openAgentsBatchDetail\(/, 'fonction détail batch présente');
    const fnStart = served.indexOf('async function openAgentsBatchDetail');
    const fnEnd = served.indexOf('function closeAgentsTaskDetail');
    const fn = served.slice(fnStart, fnEnd);
    assert.ok(fn.includes('agentsPanelEscape(batch.executionId)'));
    assert.ok(fn.includes('agentsPanelEscape(batch.status)'));
    assert.ok(fn.includes('agentsPanelEscape(p.phase)'));
    assert.ok(fn.includes('agentsPanelEscape(t.taskId)'));
    assert.ok(fn.includes('agentsPanelEscape(t.blockedReason)'));
    // Aucune injection brute des valeurs dynamiques
    assert.doesNotMatch(fn, /innerHTML\s*\+=[^;]*\$\{[^}]*batch\.(status|executionId)[^}]*\}[^;]*;/, 'aucune injection brute');
  });

  // 14 — navigation retour fonctionnelle
  it('14: navigation — bouton retour vers la liste présent dans le rendu', () => {
    const full = resolve(process.cwd(), 'apps/studio/index.html');
    const served = readFileSync(full, 'utf8');
    const fnStart = served.indexOf('async function openAgentsBatchDetail');
    const fn = served.slice(fnStart, served.indexOf('function closeAgentsTaskDetail'));
    assert.ok(fn.includes('closeAgentsTaskDetail()'), 'bouton retour vers la liste');
    assert.ok(fn.includes('Rafraîchir'), 'refresh manuel du détail batch');
  });

  // 15 — une TASK corrélée avec trace peut ouvrir le détail Phase B (onclick présent)
  it('15: TASK corrélée avec trace → onclick openAgentsTaskDetail (réutilise le détail Phase B)', async () => {
    const full = resolve(process.cwd(), 'apps/studio/index.html');
    const served = readFileSync(full, 'utf8');
    const fnStart = served.indexOf('async function openAgentsBatchDetail');
    const fn = served.slice(fnStart, served.indexOf('function closeAgentsTaskDetail'));
    assert.match(fn, /openAgentsTaskDetail\(/, 'les traces TASK corrélées réutilisent le détail Phase B');
    assert.match(fn, /hasTrace/, 'la corrélation trace/néant est distinguée');
  });

  // 16/17 — aucune donnée fictive, aucun polling
  it('16+17: aucune donnée fictive, aucun polling dans le détail batch', () => {
    const full = resolve(process.cwd(), 'apps/studio/index.html');
    const served = readFileSync(full, 'utf8');
    const fnStart = served.indexOf('async function openAgentsBatchDetail');
    const fn = served.slice(fnStart, served.indexOf('function closeAgentsTaskDetail'));
    assert.doesNotMatch(fn, /setInterval|setTimeout.*refresh|polling/i, 'aucun polling');
    assert.doesNotMatch(fn, /demo|mock|fake/i, 'aucune donnée de démonstration');
    assert.doesNotMatch(fn, /success: true|'SUCCESS'.*artifacts: \[\]/, 'aucun verdict fabriqué');
  });

  // 18/19 — non-régression Phase A + Phase B
  it('18: non-régression Phase A — liste exécutions toujours fonctionnelle', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions?order=DESC&limit=50`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { items: Array<{ executionId: string }>; count: number };
    assert.ok(body.count >= 3, 'les exécutions des batches + precreate sont listées');
    assert.ok(body.items.some((i) => i.executionId === okBatchId));
    assert.ok(body.items.some((i) => i.executionId === mixedBatchId));
  });

  it('19: non-régression Phase B — détail TASK toujours fonctionnel après Phase C', async () => {
    const res = await fetch(batchUrl(okBatchId, '').replace('/agents/executions/agxb-e41c-ok', '/agents/executions/' + encodeURIComponent(okBatchId + '--ok-a')), { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { trace: { kind?: string; executionId?: string } };
    assert.equal(body.trace.kind, 'TASK');
    assert.equal(body.trace.executionId, okBatchId + '--ok-a');
  });
});
