/**
 * n°5 — rate limiting hors /api : /health et le statique sont throttlés
 * (bucket séparé 2 000/min/IP), sans toucher au budget API/IA.
 */
import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

describe('n°5 : rate limiting du statique/santé', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
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

  it('1. rafale raisonnable (50× /health) : aucun 429', async () => {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`${baseUrl}/health`);
      assert.equal(res.status, 200, `requête ${i} ne doit pas être throttlée`);
      await res.arrayBuffer();
    }
  });

  it('2. flood statique (> 2 000/min/IP) : 429 RATE_LIMITED + Retry-After', async () => {
    let saw429 = false;
    // 50 déjà consommées en (1) : 2 000 de plus dépassent le bucket statique.
    for (let i = 0; i < 2_000; i++) {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 429) {
        saw429 = true;
        const body = (await res.json()) as { error?: { code?: string } };
        assert.equal(body.error?.code, 'RATE_LIMITED');
        assert.equal(res.headers.get('retry-after'), '60');
        break;
      }
      assert.equal(res.status, 200, `statut inattendu ${res.status} à la requête ${i}`);
      await res.arrayBuffer();
    }
    assert.ok(saw429, 'le 429 statique doit apparaître avant 2 050 requêtes');
  });

  it('3. buckets indépendants : le flood statique ne touche pas le budget API', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { 'x-tenant-id': 't', 'x-user-role': 'OWNER' }
    });
    assert.equal(res.status, 200, 'le bucket API doit être intact après un flood statique');
  });
});
