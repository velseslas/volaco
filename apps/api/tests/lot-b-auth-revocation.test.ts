/**
 * LOT B (Phase 2, décisions 2 & 3) — tests HTTP de bout en bout :
 *   P0 : la clé API ne peut PAS forger une identité OWNER (/auth/me → 401).
 *   B3 : un JWT signé non expiré NE PASSE PLUS après révocation (logout).
 *
 * Note runner : on ferme le serveur avec closeAllConnections() et on utilise
 * des sockets non persistantes, pour que `node --test` rende la main.
 */

import './_lot-b-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

const H_CLOSE = { Connection: 'close' } as const;

describe('LOT B — HTTP (P0 + B3 révocation)', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('1. la clé API partagée ne donne AUCUNE identité individuelle (/auth/me → 401)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { ...H_CLOSE, Authorization: `Bearer ${process.env.VOLACO_API_KEY}` }
    });
    assert.equal(res.status, 401);
    await res.arrayBuffer().catch(() => null);
  });

  it('2. un JWT signé passe, puis est REFUSÉ après logout (révocation effective)', async () => {
    const signup = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...H_CLOSE },
      body: JSON.stringify({
        email: `revoke-${Date.now().toString(36)}@t.volaco`,
        password: 'mot-de-passe-long',
        name: 'Rev'
      })
    });
    assert.equal(signup.status, 201);
    const token = ((await signup.json()) as { token: string }).token;
    const auth = { Authorization: `Bearer ${token}`, ...H_CLOSE };

    const before = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: auth });
    assert.equal(before.status, 200, 'jeton valide avant révocation');
    await before.arrayBuffer().catch(() => null);

    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: '{}'
    });
    assert.equal(logout.status, 200);
    const body = (await logout.json()) as { revoked: string };
    assert.equal(body.revoked, 'all-sessions');

    const after1 = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: auth });
    assert.equal(after1.status, 401, 'un JWT signé non expiré NE PASSE PLUS après révocation');
    await after1.arrayBuffer().catch(() => null);
  });
});
