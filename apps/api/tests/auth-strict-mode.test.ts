/**
 * CDC §35 — MODE STRICT (VOLACO_STRICT_AUTH=1) — audit moteurs, 04/11.
 *
 * Le strict désactive le repli dev par en-têtes x-tenant-id/x-user-role
 * (spoofables) : toute requête non publique sans Bearer valide est refusée.
 *
 * 1. Surface publique maintenue : /health, shell Studio (login chargeable —
 *    poulet-œuf) et routes /auth/*.
 * 2. 401 honnête sans Bearer, même avec en-têtes legacy présents.
 * 3. Bearer JWT signé → 200 ; le tenant vient du TOKEN SIGNÉ : un en-tête
 *    x-tenant-id mensonger est ignoré (couverture multi-tenant).
 * 4. /me sans identité individuelle → 401 (pas d'identité fabriquée).
 */

import './_lot-b-secret-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

process.env.VOLACO_STRICT_AUTH = '1';

describe('AUTH §35 : mode strict (repli dev désactivé, Bearer obligatoire)', () => {
  let server: Server;
  let baseUrl: string;
  const rand = Date.now().toString(36);
  let tokenA = '';
  let tokenB = '';

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

  it('1. la surface publique reste chargeable (health + shell Studio + signup)', async () => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const shell = await fetch(`${baseUrl}/studio`);
    assert.equal(shell.status, 200, 'le shell Studio (écran de connexion) doit rester public en strict');
    const signup = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `strict-a-${rand}@test.volaco`, password: 'mot-de-passe-long', name: 'Strict A' })
    });
    assert.equal(signup.status, 201, 'signup doit rester accessible sans Bearer (poulet-œuf)');
    const body = (await signup.json()) as { token: string };
    tokenA = body.token;
    const signupB = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `strict-b-${rand}@test.volaco`, password: 'mot-de-passe-long', name: 'Strict B' })
    });
    const bodyB = (await signupB.json()) as { token: string };
    tokenB = bodyB.token;
    assert.ok(tokenA.split('.').length === 3 && tokenB.split('.').length === 3, 'JWT 3 segments');
  });

  it('2. 401 sans Bearer — même avec en-têtes legacy présents (repli désactivé)', async () => {
    const noAuth = await fetch(`${baseUrl}/api/v1/projects`);
    assert.equal(noAuth.status, 401);
    const legacy = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { 'x-tenant-id': 'studio-local', 'x-user-role': 'OWNER' }
    });
    assert.equal(legacy.status, 401, 'les en-têtes legacy ne constituent PAS une authentification en strict');
  });

  it('3. Bearer JWT signé → 200 ; tenant depuis le token (header mensonger ignoré)', async () => {
    const spoofH = {
      'Content-Type': 'application/json',
      'x-tenant-id': 'tenant-espion',
      'x-user-role': 'OWNER',
      Authorization: `Bearer ${tokenA}`
    };
    const create = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: spoofH, body: JSON.stringify({ name: 'strict-probe-A' })
    });
    assert.equal(create.status, 201, 'un JWT signé authentifie (strict)');
    // Lecture avec le token de B (header x-tenant-id: 'tenant-espion' identique) :
    // le tenant vient du JWT, jamais du header → B ne voit pas le projet de A.
    const spy = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { 'x-tenant-id': 'tenant-espion', Authorization: `Bearer ${tokenB}` }
    });
    assert.equal(spy.status, 200);
    const spyList = (await spy.json()) as { projects: Array<{ name: string }> };
    assert.ok(
      !(spyList.projects ?? []).some((p) => p.name === 'strict-probe-A'),
      'le tenant espion reste isolé : couverture par le token, pas par le header'
    );
    const self = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { 'x-tenant-id': 'tenant-espion', Authorization: `Bearer ${tokenA}` }
    });
    const selfList = (await self.json()) as { projects: Array<{ name: string }> };
    assert.ok(
      (selfList.projects ?? []).some((p) => p.name === 'strict-probe-A'),
      'A retrouve son projet malgré le header mensonger (le token fait foi)'
    );
  });

  it('4. /me refuse les identités fabriquées (401 sans JWT utilisateur)', async () => {
    const anon = await fetch(`${baseUrl}/api/v1/auth/me`);
    assert.equal(anon.status, 401);
    const legacy = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'x-tenant-id': 'studio-local', 'x-user-role': 'OWNER' }
    });
    assert.equal(legacy.status, 401, 'pas de pseudo-utilisateur depuis les headers (D7)');
    const jwt = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${tokenA}` } });
    assert.equal(jwt.status, 200);
    const me = (await jwt.json()) as { user: { email: string } };
    assert.equal(me.user.email, `strict-a-${rand}@test.volaco`);
  });
});
