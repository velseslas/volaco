/**
 * LOT S2 — CSP STRICTE SUR LE STUDIO (audit sécurité, 04/11).
 *
 * Le principal ne doit plus dépendre d'une exception de CSP ; les previews
 * isolées restent sandboxées par leurs propres en-têtes.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

describe('S2 : en-tête Content-Security-Policy sur le Studio', () => {
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

  async function cspOf(path: string): Promise<string> {
    const res = await fetch(`${baseUrl}${path}`);
    assert.equal(res.status, 200, `${path} doit répondre 200`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, `un en-tête Content-Security-Policy est émis pour ${path}`);
    return csp ?? '';
  }

  it('le shell Studio porte une CSP non vide, sans ressource externe', async () => {
    const csp = await cspOf('/studio');
    assert.ok(csp.includes('default-src \'self\''), 'default-src restreint au même origine');
    assert.ok(csp.includes('script-src \'self\' \'unsafe-inline\''), 'script inline autorisé , externe interdit');
    assert.ok(csp.includes('object-src \'none\''), 'objects/embed externes interdits');
    assert.ok(csp.includes('base-uri \'self\''), 'base uri restreinte');
    assert.ok(csp.includes('connect-src \'self\''), 'connect restreint');
    assert.ok(csp.includes('frame-src \'self\''), 'frames restreintes');
    assert.ok(!csp.includes('*'), 'aucun joker dans la CSP');
  });

  it("l'index racine porte la même CSP", async () => {
    const csp = await cspOf('/');
    assert.ok(csp.includes('default-src \'self\''));
  });
});
