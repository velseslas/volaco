/**
 * LOT S6 — QUOTA PAR TENANT DU PROXY IA (audit sécurité, 04/11).
 *
 * Un tenant A ne doit plus pouvoir épuiser le budget globale des requêtes IA
 * d'un autre tenant sur la même IP (NAT partagé) ; le quota par tenant reste
 * lisible en 429 avec Retry-After quand le plafond est dépassé.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

process.env.VOLACO_PROXY_TENANT_REQ_PER_MINUTE = '3';

describe('S6 : quota proxy IA par tenant', () => {
  let server: Server;
  let baseUrl: string;
  const tenantA = { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-proxy-a', 'x-user-role': 'ENGINEER' };
  const tenantB = { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-proxy-b', 'x-user-role': 'ENGINEER' };

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

  it("tenant A épuise son quota (429) sans affecter tenant B", async () => {
    const payload = JSON.stringify({ model: 'codestral-latest', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 });
    const statusesA: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/v1/ai/chat/completions`, { method: 'POST', headers: tenantA, body: payload });
      statusesA.push(res.status);
      // drain pour ne pas obstruer la chaîne
      await res.arrayBuffer().catch(() => null);
    }
    assert.ok(statusesA.some((s) => s === 429), 'tenant A doit être limité (429) après 3 appels');
    assert.ok(statusesA.filter((s) => s === 429).length >= 1);

    // tenant B reste dans son quota (pas 429 immédiats)
    const firstB = await fetch(`${baseUrl}/api/v1/ai/chat/completions`, { method: 'POST', headers: tenantB, body: payload });
    assert.ok(firstB.status !== 429, 'tenant B ne doit pas être bloqué par le quota de A');
    await firstB.arrayBuffer().catch(() => null);
  });
});
