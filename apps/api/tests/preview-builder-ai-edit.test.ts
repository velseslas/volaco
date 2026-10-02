/**
 * ÉTAPE 35 — ROUTE /preview-builder/ai-edit.js : le module isomorphe de la
 * boucle d'édition IA (compilé depuis packages/core) est bien servi au
 * navigateur, comme engine.js/editing.js avant lui.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

describe('CORE-API É35 : service du module ai-edit.js du Preview Builder', () => {
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('le module compilé est servi (ESM navigateur, export runAiEditLoop)', async () => {
    const res = await fetch(`${baseUrl}/preview-builder/ai-edit.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /javascript/);
    const body = await res.text();
    assert.ok(body.includes('runAiEditLoop'), 'export présent');
    assert.ok(body.includes('set_image_src'), 'les outils sont définis dans le module');
  });
});
