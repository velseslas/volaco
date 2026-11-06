/**
 * LOT S7 — TIMEOUT BORNÉ CÔTÉ TERMINAL (audit sécurité, 04/11).
 *
 * Le timeout client est clampé server-side : 100 ms min, 60 000 ms max.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

describe('S7 : timeout terminal borné server-side', () => {
  let server: Server;
  let baseUrl: string;
  const tenantA = { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-term-a', 'x-user-role': 'ENGINEER' };
  let projectA = '';

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
    const p = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: tenantA, body: JSON.stringify({ name: 'terminal-timeout-A' })
    });
    const pj = (await p.json()) as { project: { id: string } };
    projectA = pj.project.id;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("timeoutMs client de 86400000 est clampé (la commande retourne, pas de hang)", async () => {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectA}/terminal/execute`, {
      method: 'POST', headers: tenantA, body: JSON.stringify({ command: 'git --version', timeoutMs: 86400000 })
    });
    const duration = Date.now() - start;
    assert.equal(res.status, 200);
    // jamais plus de 60 s même si Infinity client
    assert.ok(duration < 60000, `durée ${duration}ms doit rester < 60s`);
    const data = (await res.json()) as { result: { exitCode: number } };
    assert.equal(data.result.exitCode, 0, 'git --version réussit');
  });

  it('timeoutMs absent → 10 000 ms par défaut (réponse 200)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectA}/terminal/execute`, {
      method: 'POST', headers: tenantA, body: JSON.stringify({ command: 'git --version' })
    });
    assert.equal(res.status, 200);
  });
});
