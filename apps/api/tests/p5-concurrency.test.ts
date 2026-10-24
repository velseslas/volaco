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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  // Porte déterministe pour J-1 : la requête « longue » reste ACTIVE côté
  // provider jusqu'à libération manuelle par le test → l'état observable
  // « exactement 1 slot occupé » existe forcément, quelle que soit la charge
  // machine (anti-flakiness par construction, plus par fenêtre de temps).
  let releaseLongRequest: () => void = () => {};
  let longRequestGate: Promise<void> = Promise.resolve();

  before(async () => {
    process.env.VOLACO_MAX_CONCURRENT_AI = '2';
    // provider LENT (400 ms) : 4 requêtes parallèles → 2 passent, 2 × 503
    // Porte J-1 : prompt > 30 caractères → bloqué jusqu'à releaseLongRequest().
    // Tous les autres prompts (≤ 30) gardent le comportement historique 400 ms.
    longRequestGate = new Promise<void>((resolve) => { releaseLongRequest = resolve; });
    imageProviderRegistry.register({
      id: 'slow-p5',
      name: 'Slow P5',
      isAvailable: () => true,
      generate: async (prompt: string) => {
        if (prompt.length > 30) await longRequestGate;
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

  it('5. J-1 : chaque requête terminée libère EXACTEMENT un slot (pas de double-release close+finish)', async () => {
    // Scénario de régression (borne 2) :
    //   A démarre à t=0 ; B à t=+250 ms. B est BLOQUÉE côté provider (porte
    //   déterministe) tant que le test ne la libère pas → après la fin de A,
    //   l'état « exactement 1 slot occupé (B) » est garanti observable, sans
    //   dépendre de la vitesse disque/CPU (anti-flakiness par construction).
    //   Avec le bug double-release (finish + close), la fin de A libérait DEUX
    //   slots → activeAi tombait à 0 alors que B tournait encore, et C ET D
    //   passaient (2 slots inventés).
    const H5 = { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_p5_02', 'x-user-role': 'ENGINEER' };
    const gen = (prompt: string) =>
      fetch(`${baseUrl}/api/v1/projects/${projectId}/images/generate`, {
        method: 'POST', headers: H5, body: JSON.stringify({ prompt })
      });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const a = gen('J1 requête courte A');
    await sleep(250); // décale B pour qu'il survive à A
    const b = gen('J1 requête longue Bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'); // > 30 → porte
    const aRes = await a;
    await aRes.text(); // consomme la réponse → res terminé côté serveur
    // Déterminisme : B étant bloquée côté provider, l'état « B seul actif »
    // (activeAi === 1) est garanti atteignable. Avec le bug double-release,
    // cet état n'arrive jamais (le compteur passe directement à 0).
    let activeAi = -1;
    for (let i = 0; i < 150; i++) {
      const m = (await (await fetch(`${baseUrl}/api/v1/metrics`, { headers: H5 })).json()) as { runtime?: { activeAi?: number } };
      activeAi = m.runtime?.activeAi ?? -1;
      if (activeAi === 1) break;
      await sleep(100);
    }
    assert.equal(activeAi, 1, 'état observable : exactement B actif (1 slot)');

    // Le slot de B est encore occupé : parmi C/D/E/F, UNE SEULE doit passer
    const cde = await Promise.all([gen('J1 Cc'), gen('J1 Dd'), gen('J1 Ee'), gen('J1 Ff')]);
    const created = cde.filter((r) => r.status === 201).length;
    const busy = cde.filter((r) => r.status === 503).length;
    assert.equal(created, 1, `exactement 1 requête admise pendant B (bug double-release : 2 admises)`);
    assert.equal(busy, 3, 'les 3 autres sont refusées 503 AI_BUSY');

    // Libération déterministe de B, puis retour à l'état initial
    releaseLongRequest();
    await b;
    const after = await gen('J1 post-vérification');
    assert.equal(after.status, 201, 'compteur exactement revenu à l état initial');
  });

  it('6. garde source : UNE seule libération terminale dans le câblage sémaphore', () => {
    const src = readFileSync(resolve(process.cwd(), 'apps/api/src/server.ts'), 'utf8');
    const blockStart = src.indexOf('const isAiHeavy');
    assert.ok(blockStart > 0, 'câblage sémaphore présent');
    const block = src.slice(blockStart, blockStart + 1400); // acquire + 503 + libération
    const releases = (block.match(/releaseAiSlot\(\)/g) || []).length;
    assert.equal(releases, 1, 'un seul appel releaseAiSlot dans le câblage (close uniquement)');
    assert.doesNotMatch(block, /res\.on\('finish'[^)]*releaseAiSlot/, 'pas de double libération sur finish');
    assert.match(block, /res\.on\('close', \(\) => releaseAiSlot\(\)\)/, 'libération terminale sur close');
  });
});
