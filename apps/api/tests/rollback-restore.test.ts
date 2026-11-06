/**
 * E40 — ROLLBACK HONNÊTE : POST /revisions/:id/rollback restaure AUSSI le
 * FileStore (avant E40, seule l'historique changeait — le index.html réel
 * restait sur l'état antérieur).
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';

describe('CORE-API E40 : rollback = historique ET fichier réel', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_rollback_01';
  let projectId: string;

  const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };

  before(async () => {
    projectStore.clear();
    projectId = projectStore.createProject(tenantId, 'Rollback App').id;
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
    projectStore.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const content = async (): Promise<string> => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, {
      headers: { 'x-tenant-id': tenantId }
    });
    const data = (await res.json()) as { file: { content: string } | null };
    return data.file?.content ?? '';
  };

  it('1. créer la révision A (version X), puis remplacer le fichier par Y', async () => {
    const revRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ message: 'Version X', author: 'test', files: { 'index.html': '<html>X</html>' } })
    });
    assert.equal(revRes.status, 201);

    const putRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers: H,
      body: JSON.stringify({ path: 'index.html', content: '<html>Y</html>' })
    });
    assert.equal(putRes.status, 200);
    assert.equal(await content(), '<html>Y</html>');
  });

  it('2. rollback vers A : le FICHIER réel revient à X, pas seulement l historique', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, { headers: { 'x-tenant-id': tenantId } });
    const list = (await listRes.json()) as { revisions: Array<{ id: string; revisionNumber: number; message: string }> };
    const revA = list.revisions.find((r) => r.message === 'Version X');
    assert.ok(revA, 'révision A présente');

    const rbRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions/${revA!.id}/rollback`, {
      method: 'POST', headers: H
    });
    assert.equal(rbRes.status, 200);
    const rb = (await rbRes.json()) as { success: boolean; restoredFiles: number };
    assert.equal(rb.success, true);
    assert.ok(rb.restoredFiles >= 1, 'au moins un fichier réellement réécrit');

    assert.equal(await content(), '<html>X</html>');
  });

  it('3. le rollback crée une nouvelle révision (historique append-only)', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, { headers: { 'x-tenant-id': tenantId } });
    const list = (await listRes.json()) as { revisions: Array<{ message: string }> };
    assert.ok(list.revisions.some((r) => r.message.startsWith('Rollback vers la révision')), 'révision de rollback créée');
  });
});
