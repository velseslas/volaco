/**
 * Espace utilisateur — GET /api/v1/auth/me :
 * identité réelle de l'appelant, UNIQUEMENT issue d'un JWT vérifié.
 *
 * Couverture :
 *   1. Bearer JWT valide  -> 200 + identité exacte (id/email/name/role/tenant) ;
 *   2. sans Bearer        -> 401 (jamais de contexte fabriqué depuis les headers) ;
 *   3. clé API partagée   -> 401 explicite (aucune identité individuelle — D7) ;
 *   4. token forgé        -> 401 (signature invalide) ;
 *   5. sub fantôme        -> 401 (jeton signé de ce process, mais compte inexistant).
 *
 * Zero-jeton-fuite : la réponse ne contient ni mot de passe, ni hash, ni salt.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { signToken } from '../../../packages/core/src/identity/user-store.js';

const EMAIL = 'me-user@volaco.test';
const PASSWORD = 'mot-de-passe-long';
const NAME = 'Marc Test';

describe('Espace utilisateur : GET /api/v1/auth/me', () => {
  let server: Server;
  let baseUrl: string;
  let token = '';

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
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: NAME })
    });
    assert.equal(res.status, 201, 'le signup doit réussir avant les composants /me');
    token = ((await res.json()) as { token: string }).token;
    assert.ok(token.length > 10, 'un JWT est renvoyé au signup');
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. Bearer JWT valide -> 200 + identité réelle (id/email/name/role/tenant)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      user: { id: string; email: string; name: string; role: string; tenantId: string; passwordHash?: string; passwordSalt?: string };
      requestId: string;
    };
    assert.equal(body.user.email, EMAIL);
    assert.equal(body.user.name, NAME);
    assert.equal(body.user.role, 'OWNER');
    assert.ok(body.user.id.startsWith('usr_'), 'sub = identifiant usr_* du compte');
    assert.ok(body.user.tenantId.startsWith('ten-'), 'tenant dédié du compte');
    void body.requestId;
    // Aucune donnée secrète ne fuit dans la réponse publique :
    assert.equal((body.user as Record<string, unknown>).passwordHash, undefined);
    assert.equal((body.user as Record<string, unknown>).passwordSalt, undefined);
    assert.equal((body.user as Record<string, unknown>).createdAt, undefined);
  });

  it('2. sans Bearer -> 401 (le repli dev ne construit jamais d\'identité)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'x-user-role': 'OWNER', 'x-tenant-id': 'spoofed-tenant' }
    });
    assert.equal(res.status, 401, 'les headers spoofables ne doivent pas produire de /me');
  });

  it('3. clé API partagée -> 401 explicite (aucune identité individuelle — D7)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: 'Bearer dev-key-change-me' }
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { message?: string };
    assert.match(String(body.message || ''), /clé API/i, 'le refus doit nommer la clé API partagée');
  });

  it('4. token forgé (signature invalide) -> 401', async () => {
    const parts = token.split('.');
    const forged = `${parts[0]}.${parts[1]}.sig-invalide-tamponnee`;
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${forged}` }
    });
    assert.equal(res.status, 401);
  });

  it('5. sub fantôme (jeton signé de ce process, compte inexistant) -> 401', async () => {
    const ghost = signToken({
      id: 'usr_ghost00000000001',
      tenantId: 'ten-ghost000000',
      role: 'OWNER',
      email: 'ghost@volaco.test'
    });
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${ghost}` }
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { message?: string };
    assert.match(String(body.message || ''), /compte/i);
  });

  it('6. autres routes GET /auth/* restent non montées (comportement inchangé)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/unknown`);
    assert.equal(res.status, 404, 'GET inconnu sous /auth doit finir en 404 du routeur');
  });
});
