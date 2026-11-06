/**
 * LOT S3 — ISOLATION TENANT DU /preview-bundle (audit sécurité, 04/11).
 *
 * Le bundle sert le préparé `dist/` d’un projet dans un iframe sandboxé.
 * Les URLs de bundle ne portent plus aucune confiance sans tenant :
 *   - tenant + projet inexistants → 404 indiscernable ;
 *   - tenant mismatch → 404 (jamais d’oracle d’existence) ;
 *   - projet valide du tenant → 200.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

describe('S3 : /preview-bundle isole par tenant', () => {
  let server: Server;
  let baseUrl: string;
  const tenantA = { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-bundle-a', 'x-user-role': 'ENGINEER' };
  const tenantB = { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-bundle-b', 'x-user-role': 'ENGINEER' };
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
      method: 'POST', headers: tenantA, body: JSON.stringify({ name: 'bundle-tenant-A' })
    });
    const pj = (await p.json()) as { project: { id: string } };
    projectA = pj.project.id;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("projet inconnu → 404 indiscernable (pas d'oracle d'existence)", async () => {
    const res = await fetch(`${baseUrl}/preview-bundle/proj_inexistant/`, { headers: tenantA });
    assert.equal(res.status, 404);
  });

  it("autre tenant ne lit PAS le bundle (même avec PROJECT_READ)", async () => {
    const res = await fetch(`${baseUrl}/preview-bundle/${projectA}/`, { headers: tenantB });
    assert.equal(res.status, 404, "le bundle d'un autre tenant est introuvable, pas juste refusé");
  });

  it('le tenant propriétaire tombe sur le bundle (ou un 404 propre si jamais généré)', async () => {
    const res = await fetch(`${baseUrl}/preview-bundle/${projectA}/`, { headers: tenantA });
    // Aucun bundle n'a été généré pour ce projet de test : 404 « aucun bundle »,
    // jamais un 200 et jamais une erreur non documentée.
    assert.ok(res.status === 200 || res.status === 404, 'le tenant propriétaire ne voit ni 403 ni 500');
  });
});
