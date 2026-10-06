/**
 * P5 — OBSERVABILITY / SCALABILITÉ.
 *
 * 1. Semaphore IA : borne la concurrence des opérations lourdes (audit :
 *    « boucles LLM bloquantes sans limite »). Au-delà de la borne :
 *    503 AI_BUSY + Retry-After ; un slot libéré rouvre la porte.
 * 2. /api/v1/metrics enrichi : mémoire process + concurrence IA.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { releaseAiSlot, runtimeSnapshot, tryAcquireAiSlot } from '../../../packages/core/src/observability/runtime-metrics.js';
import { imageProviderRegistry, type ImageProvider } from '../../../packages/core/src/image/registry.js';

describe('P5 : semaphore de concurrence IA (unitaire)', () => {
  it('1. limite atteinte → false ; libéré → true', () => {
    process.env.VOLACO_MAX_CONCURRENT_AI = '2';
    assert.equal(tryAcquireAiSlot(), true);
    assert.equal(tryAcquireAiSlot(), true);
    assert.equal(tryAcquireAiSlot(), false, 'borne respectée');
    releaseAiSlot();
    assert.equal(tryAcquireAiSlot(), true, 'slot libéré rouvre');
    releaseAiSlot();
    releaseAiSlot();
  });

  it('2. snapshot : pic et total tracés', () => {
    const snap = runtimeSnapshot();
    assert.ok(snap.heapUsedMb > 0);
    assert.ok(snap.peakAi >= 2, 'le pic de la séquence précédente est tracé');
    assert.ok(snap.totalAiStarted >= 3);
  });
});

describe('P5 : concurrence en réel — 4 générations parallèles, borne 2', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';

  before(async () => {
    process.env.VOLACO_MAX_CONCURRENT_AI = '2';
    // provider LENT (400 ms) : 4 requêtes parallèles → 2 passent, 2 × 503
    imageProviderRegistry.register({
      id: 'slow-p5',
      name: 'Slow P5',
      isAvailable: () => true,
      generate: async (prompt: string) => {
        await new Promise((r) => setTimeout(r, 400));
        return { data: Buffer.from('P5:' + prompt.length), contentType: 'image/jpeg' };
      }
    });

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
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { headers: { 'x-tenant-id': 'tenant_p5_02', 'x-user-role': 'ENGINEER' }, body: JSON.stringify({ name: 'P5 Concurrency' }), method: 'POST' });
    const pdata = (await pres.json()) as { project?: { id?: string }; id?: string };
    projectId = (pdata.project || pdata).id as string;
  });

  after(async () => {
    delete process.env.VOLACO_MAX_CONCURRENT_AI;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. 4 générations parallèles : 2 réussissent, 2 × 503 AI_BUSY', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        fetch(`${baseUrl}/api/v1/projects/${projectId}/images/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_p5_02', 'x-user-role': 'ENGINEER' },
          body: JSON.stringify({ prompt: 'test de concurrence' })
        })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 201, 503, 503], 'exactement 2 créées, 2 refusées');
    const busy = await results.find((r) => r.status === 503)!.json();
    assert.equal((busy as { error?: { code?: string } }).error?.code, 'AI_BUSY');
    assert.ok(results.find((r) => r.status === 503)!.headers.get('retry-after'), 'Retry-After présent');
  });

  it('2. après libération : la concurrence redevient disponible', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/images/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_p5_02', 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ prompt: 'test post concurrence' })
    });
    assert.equal(res.status, 201);
  });

  it('4. /orchestrate est borné par le sémaphore IA (É47 P2-2)', async () => {
    // Occupe les 2 slots avec des générations lentes (provider slow-p5)
    const holders = Promise.all(
      Array.from({ length: 2 }, () =>
        fetch(`${baseUrl}/api/v1/projects/${projectId}/images/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_p5_02', 'x-user-role': 'ENGINEER' },
          body: JSON.stringify({ prompt: 'occupation des slots' })
        })
      )
    );
    await new Promise((r) => setTimeout(r, 60)); // laisse les 2 slots être acquis
    // Slots pleins : /orchestrate est refusé 503 AI_BUSY (comme les autres IA lourdes)
    const orch = await fetch(`${baseUrl}/api/v1/projects/${projectId}/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_p5_02', 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ plan: { planId: 'p-sem', steps: [{ stepIndex: 0, title: 'x', description: 'x', targetDomain: 'UI', targetFiles: ['a.ts'], operation: 'CREATE', requiresApproval: false }] } })
    });
    assert.equal(orch.status, 503, 'orchestration refusée quand les slots IA sont saturés');
    const busy = await orch.json();
    assert.equal((busy as { error?: { code?: string } }).error?.code, 'AI_BUSY');
    await holders; // libération
    // Slots libres : /orchestrate passe le sémaphore et atteint la route (400 sans plan)
    const orch2 = await fetch(`${baseUrl}/api/v1/projects/${projectId}/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_p5_02', 'x-user-role': 'ENGINEER' },
      body: '{}'
    });
    assert.equal(orch2.status, 400, 'sémaphore traversé : la route répond (plan manquant)');
  });

  it('3. /metrics expose le snapshot runtime (mémoire + IA)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/metrics`, { headers: { 'x-tenant-id': 'tenant_p5_02' } });
    const data = (await res.json()) as { runtime?: { heapUsedMb?: number; rssMb?: number; maxConcurrentAi?: number } };
    assert.ok(data.runtime, 'runtime snapshot présent');
    assert.ok((data.runtime?.heapUsedMb ?? 0) > 0, 'mémoire process tracée');
    assert.equal(data.runtime?.maxConcurrentAi, 2, 'borne configurée exposée');
  });
});
