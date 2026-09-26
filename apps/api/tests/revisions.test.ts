import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';

describe('FND-004 : Revisions & Application Model HTTP Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const testTenant = 'tenant_revisions_secure';
  let projectId: string;

  before(async () => {
    const proj = projectStore.createProject(testTenant, 'Projet Revisions Securise');
    projectId = proj.id;

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

  it('doit crÃ©er la premiÃ¨re rÃ©vision d un projet et calculer le hash SHA-256 des fichiers', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': testTenant,
        'X-User-Role': 'ENGINEER'
      },
      body: JSON.stringify({
        message: 'Initial Scaffold',
        files: {
          'index.html': '<html><body>Initial</body></html>'
        },
        provenance: { source: 'USER', prompt: 'CrÃ©ation initiale' }
      })
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.revision.revisionNumber, 1);
    assert.ok(body.revision.files['index.html']);
    assert.equal(body.revision.files['index.html'].hash.length, 64);
  });

  it('doit crÃ©er une seconde rÃ©vision et lister l historique dans l ordre chronologique', async () => {
    const postRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': testTenant,
        'X-User-Role': 'ENGINEER'
      },
      body: JSON.stringify({
        message: 'Second Commit',
        files: { 'index.html': '<html><body>Updated</body></html>' }
      })
    });
    assert.equal(postRes.status, 201);

    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      headers: { 'X-Tenant-Id': testTenant, 'X-User-Role': 'VIEWER' }
    });

    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as any;
    assert.equal(listBody.revisions.length, 2);
    assert.equal(listBody.revisions[0].revisionNumber, 1);
    assert.equal(listBody.revisions[1].revisionNumber, 2);
  });

  it('doit exÃ©cuter un rollback vers la rÃ©vision 1 et produire une rÃ©vision 3 restaurÃ©e', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      headers: { 'X-Tenant-Id': testTenant, 'X-User-Role': 'VIEWER' }
    });
    const { revisions } = (await listRes.json()) as any;
    const rev1Id = revisions[0].id;

    const rbRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions/${rev1Id}/rollback`, {
      method: 'POST',
      headers: { 'X-Tenant-Id': testTenant, 'X-User-Role': 'ENGINEER' }
    });

    assert.equal(rbRes.status, 200);
    const rbBody = (await rbRes.json()) as any;
    assert.equal(rbBody.rollbackRevision.revisionNumber, 3);
    assert.equal(rbBody.rollbackRevision.files['index.html'].content, '<html><body>Initial</body></html>');
    assert.equal(rbBody.rollbackRevision.provenance.source, 'SYSTEM_REPAIR');
  });

  it('doit rejeter l accÃ¨s aux rÃ©visions par un locataire rival (Ã‰tanchÃ©itÃ© Multi-Tenant)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      headers: { 'X-Tenant-Id': 'tenant_pirate_other', 'X-User-Role': 'VIEWER' }
    });
    assert.equal(res.status, 404);
  });
});
