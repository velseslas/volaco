/**
 * P0-masse — RENDUS CHROMIUM BORNÉS.
 *
 * /render/preview (1 navigateur) et /repair (LLM + jusqu'à 3 rendus)
 * contournaient le sémaphore IA : N appels parallèles = N Chromium + N LLM.
 * Compteur séparé VOLACO_MAX_CONCURRENT_RENDER (défaut 2) + /repair qui
 * prend les DEUX slots. Refus homogène 503 + Retry-After.
 *
 * Déterministe : les slots sont occupés directement (même process que le
 * serveur de test), les routes répondent 404 sur projet inexistant AVANT
 * tout Chromium/LLM — aucun navigateur lancé, aucun timing.
 */
import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  releaseAiSlot,
  releaseRenderSlot,
  runtimeSnapshot,
  tryAcquireAiSlot,
  tryAcquireRenderSlot
} from '../../../packages/core/src/observability/runtime-metrics.js';

describe('P0-masse : compteur Chromium (unitaire)', () => {
  it('1. borne respectée, libération rouvre, snapshot exposé', () => {
    process.env.VOLACO_MAX_CONCURRENT_RENDER = '1';
    assert.equal(tryAcquireRenderSlot(), true);
    assert.equal(tryAcquireRenderSlot(), false, 'borne respectée');
    releaseRenderSlot();
    assert.equal(tryAcquireRenderSlot(), true, 'slot libéré rouvre');
    releaseRenderSlot();
    const snap = runtimeSnapshot();
    assert.ok(snap.peakRender >= 1, 'pic tracé');
    assert.ok(snap.totalRenderStarted >= 2);
    assert.equal(snap.maxConcurrentRender, 1, 'borne configurée exposée');
    delete process.env.VOLACO_MAX_CONCURRENT_RENDER;
  });
});

describe('P0-masse : /render et /repair bornés (HTTP)', () => {
  let server: Server;
  let baseUrl: string;
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'ten_render_01', 'x-user-role': 'OWNER' };
  const FAKE = 'proj_fantome_xyz';

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
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('2. slots render pleins → POST /render/preview : 503 RENDER_BUSY', async () => {
    assert.equal(tryAcquireRenderSlot(), true);
    assert.equal(tryAcquireRenderSlot(), true);
    try {
      const res = await fetch(`${baseUrl}/api/v1/projects/${FAKE}/render/preview`, {
        method: 'POST', headers: H, body: JSON.stringify({})
      });
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(body.error?.code, 'RENDER_BUSY');
      assert.ok(res.headers.get('retry-after'), 'Retry-After présent');
    } finally {
      releaseRenderSlot();
      releaseRenderSlot();
    }
  });

  it('3. slots libres → même requête traverse (404 projet, pas 503)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${FAKE}/render/preview`, {
      method: 'POST', headers: H, body: JSON.stringify({})
    });
    assert.equal(res.status, 404, 'sémaphore traversé : la route répond (projet inconnu)');
    assert.equal(runtimeSnapshot().activeRender, 0, 'slot libéré après réponse');
  });

  it('4. slots IA pleins → POST /repair : 503 AI_BUSY (/repair prend un slot IA)', async () => {
    assert.equal(tryAcquireAiSlot(), true);
    assert.equal(tryAcquireAiSlot(), true);
    assert.equal(tryAcquireAiSlot(), true);
    try {
      const res = await fetch(`${baseUrl}/api/v1/projects/${FAKE}/repair`, {
        method: 'POST', headers: H, body: JSON.stringify({})
      });
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(body.error?.code, 'AI_BUSY');
    } finally {
      releaseAiSlot();
      releaseAiSlot();
      releaseAiSlot();
    }
  });

  it('5. compteurs indépendants : IA pleine → /render passe quand même', async () => {
    assert.equal(tryAcquireAiSlot(), true);
    assert.equal(tryAcquireAiSlot(), true);
    assert.equal(tryAcquireAiSlot(), true);
    try {
      const res = await fetch(`${baseUrl}/api/v1/projects/${FAKE}/render/preview`, {
        method: 'POST', headers: H, body: JSON.stringify({})
      });
      assert.equal(res.status, 404, 'le render ne consulte pas le compteur IA');
    } finally {
      releaseAiSlot();
      releaseAiSlot();
      releaseAiSlot();
    }
    assert.equal(runtimeSnapshot().activeAi, 0);
    assert.equal(runtimeSnapshot().activeRender, 0);
  });
});
