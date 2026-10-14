/**
 * PV-07/SEC-06 — l'URL de rendu ne vient jamais de l'en-tête `Host` client,
 * et Chromium tourne sandboxé par défaut.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { buildRenderStartUrl } from '../src/routes/render.js';

describe('PV-07/SEC-06 : URL de rendu côté serveur (unitaire)', () => {
  it('1. hôte forgé ignoré, port du socket utilisé', () => {
    assert.equal(
      buildRenderStartUrl('169.254.169.254', '/preview-bundle/proj_x/', 4123),
      'http://127.0.0.1:4123/preview-bundle/proj_x/'
    );
    assert.equal(
      buildRenderStartUrl('evil.internal:666', '/preview-bundle/a/b.js', undefined),
      'http://127.0.0.1:3000/preview-bundle/a/b.js'
    );
  });

  it('2. chemin non-bundle → undefined (pas de navigation)', () => {
    assert.equal(buildRenderStartUrl('x', 'http://169.254.169.254/', 3000), undefined);
    assert.equal(buildRenderStartUrl('x', undefined, 3000), undefined);
    assert.equal(buildRenderStartUrl('x', '/api/v1/projects', 3000), undefined);
  });
});

describe('PV-07/SEC-06 : Host forgé de bout en bout (HTTP brut)', () => {
  let server: Server;
  let baseUrl: string;
  let port = 0;
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'ten_render_01', 'x-user-role': 'OWNER' };
  let projectId = '';

  before(async () => {
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        port = address.port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    const pres = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: 'Render Host' })
    });
    assert.equal(pres.status, 201);
    projectId = ((await pres.json()) as { project: { id: string } }).project.id;
  });

  after(async () => {
    await fetch(`${baseUrl}/api/v1/projects/${projectId}`, { method: 'DELETE', headers: H });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('3. Host: 169.254.169.254 ignoré — le bundle LOCAL est rendu (200)', async () => {
    const status: number = await new Promise((resolve, reject) => {
      const req = httpRequest(
        `${baseUrl}/api/v1/projects/${projectId}/render/preview`,
        {
          method: 'POST',
          headers: { ...H, Host: '169.254.169.254', 'Content-Length': Buffer.byteLength(JSON.stringify({})) }
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify({}));
    });
    // Avant le fix : navigation vers la métadonnée cloud → échec/timeout.
    // Après : 127.0.0.1:port local → rendu OK (Chromium sandboxé).
    assert.equal(status, 200);
  });
});
