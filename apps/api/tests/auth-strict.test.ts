/**
 * P0 — SÉCURITÉ DE MISE EN SERVICE.
 *
 * 1. Mode strict (VOLACO_STRICT_AUTH=1) : le repli dev (x-tenant-id /
 *    x-user-role spoofables) est désactivé — toute requête API sans Bearer
 *    valide est refusée 401, SAUF /auth/* (signup/login) et /health.
 * 2. Clé API production STABLE : dérivée de AUTH_SECRET (HMAC) au lieu d'un
 *    UUID éphémère qui changeait à chaque redémarrage.
 *
 * Le mode strict est lu PAR REQUÊTE (process.env) : les tests basculent le
 * drapeau dans le même process, puis le retirent (after) — zéro impact sur
 * les autres suites (processus séparés).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { deriveApiKeyFromSecret } from '../../../packages/core/src/config.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';

describe('CORE-API P0 : mode strict + clé API stable', () => {
  let server: Server;
  let baseUrl: string;
  let token = '';

  before(async () => {
    process.env.VOLACO_STRICT_AUTH = '1';
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    // un utilisateur réel via signup (route exemptée du strict)
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'p0@volaco.test', password: 'mot-de-passe-123', tenantName: 'P0 Tenant' })
    });
    assert.equal(res.status, 201, 'signup doit fonctionner en mode strict');
    const data = (await res.json()) as { token?: string; authToken?: string };
    token = data.token || data.authToken || '';
    assert.ok(token.length > 10, 'un JWT est renvoyé au signup');
  });

  after(async () => {
    delete process.env.VOLACO_STRICT_AUTH;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. sans Bearer : 401 (le repli dev est désactivé)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects`, { headers: { 'x-tenant-id': 'spoofed', 'x-user-role': 'OWNER' } });
    assert.equal(res.status, 401, 'les en-têtes spoofables ne passent plus');
  });

  it('2. avec un JWT valide (signup/login) : accès OK', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
  });

  it('3. /auth/login reste accessible en mode strict (pas de poulet-œuf)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'p0@volaco.test', password: 'mot-de-passe-123' })
    });
    assert.equal(res.status, 200);
  });

  it('4. /health reste accessible en mode strict', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
  });

  it('5. VOLACO_API_KEY valide donne aussi accès (intégrations)', async () => {
    // le serveur de test utilise la clé par défaut dev : on la passe telle quelle
    const res = await fetch(`${baseUrl}/api/v1/projects`, { headers: { Authorization: 'Bearer dev-key-change-me' } });
    assert.equal(res.status, 200, 'la clé d intégration ouvre en rôle OWNER');
  });
});

describe('CORE-API P0 : dérivation stable de la clé API', () => {
  it('même AUTH_SECRET → même clé (stable entre redémarrages)', () => {
    const a = deriveApiKeyFromSecret('un-secret-d-au-moins-32-caracteres!!');
    const b = deriveApiKeyFromSecret('un-secret-d-au-moins-32-caracteres!!');
    assert.equal(a, b);
    assert.ok(a.length === 48);
  });

  it('secrets différents → clés différentes', () => {
    const a = deriveApiKeyFromSecret('secret-A-qui-fait-trente-deux-caracteres!');
    const b = deriveApiKeyFromSecret('secret-B-qui-fait-trente-deux-caracteres!');
    assert.notEqual(a, b);
  });
});
