/**
 * LOT S5 — SESSION JWT EN sessionStorage (audit sécurité, 04/11).
 *
 * Le principal ne doit plus transmettre le JWT via un stockage global : session
 * par onglet, migration un coup depuis localStorage puis effacement.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

describe('S5 : session JWT par onglet (sessionStorage)', () => {
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

  it("le principal ne mentionne plus localStorage.setItem('vibecode_auth_token')", async () => {
    const res = await fetch(`${baseUrl}/studio`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes("localStorage.setItem('vibecode_auth_token'"), 'plus aucune écriture globale du JWT');
    assert.ok(html.includes("sessionStorage.setItem(sessionTokenKey()"), 'session par onglet présente');
    assert.ok(html.includes("vibecode_auth_token"), 'clé de session conservée');
  });

  it('le header Authorization reste transporté par le Bearer (sans cookie HttpOnly côté client)', async () => {
    const signup = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `s5-${Date.now().toString(36)}@volaco.test`, password: 'mot-de-passe-long', name: 'S5 Test' })
    });
    assert.equal(signup.status, 201);
    const data = (await signup.json()) as { token: string };
    assert.ok(data.token.split('.').length === 3);
    const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${data.token}` } });
    assert.equal(me.status, 200);
    const anon = await fetch(`${baseUrl}/api/v1/auth/me`);
    assert.equal(anon.status, 401);
  });
});
