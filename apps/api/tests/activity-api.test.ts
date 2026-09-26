import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';

describe('CAPP-007 : Project Activity & History HTTP API Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const testTenant = 'tenant_activity_api';
  let projectId: string;

  before(async () => {
    const proj = projectStore.createProject(testTenant, 'Projet Historique API');
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

  it('1. POST /api/v1/projects/:projectId/history/seed doit initialiser la séquence CAPP-007', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/history/seed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': testTenant,
        'X-User-Role': 'ADMIN'
      }
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.count, 7);
    assert.equal(body.history.length, 7);
  });

  it('2. GET /api/v1/projects/:projectId/history doit renvoyer la chronologie dans l ordre demandé', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/history?order=ASC`, {
      method: 'GET',
      headers: {
        'X-Tenant-Id': testTenant,
        'X-User-Role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.total, 7);

    // Vérifier les 7 étapes demandées par l'utilisateur
    assert.equal(body.history[0].displayTime, '09:42');
    assert.equal(body.history[0].description, 'User created project');

    assert.equal(body.history[1].displayTime, '09:45');
    assert.equal(body.history[1].description, 'File created');

    assert.equal(body.history[2].displayTime, '09:47');
    assert.equal(body.history[2].description, 'File modified');

    assert.equal(body.history[3].displayTime, '09:48');
    assert.equal(body.history[3].description, 'Revision 2 created');

    assert.equal(body.history[4].displayTime, '09:51');
    assert.equal(body.history[4].description, 'AI modification');

    assert.equal(body.history[5].displayTime, '09:53');
    assert.equal(body.history[5].description, 'Revision 3 created');

    assert.equal(body.history[6].displayTime, '09:55');
    assert.equal(body.history[6].description, 'Rollback → Revision 1');
  });

  it('3. POST /api/v1/projects/:projectId/history doit enregistrer une nouvelle activité manuelle', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': testTenant,
        'X-User-Role': 'ENGINEER'
      },
      body: JSON.stringify({
        type: 'CUSTOM',
        description: 'Exportation bundle ZIP terminée',
        actor: { name: 'Alex', type: 'USER' },
        displayTime: '10:02'
      })
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.activity.description, 'Exportation bundle ZIP terminée');
    assert.equal(body.activity.displayTime, '10:02');
  });

  it('4. Rejet RBAC : VIEWER ne peut pas appeler POST /history (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': testTenant,
        'X-User-Role': 'VIEWER'
      },
      body: JSON.stringify({
        type: 'CUSTOM',
        description: 'Test illégal'
      })
    });

    assert.equal(res.status, 403);
  });

  it('5. Rejet Multi-Tenant : un locataire tiers ne peut pas accéder à l historique (404 Not Found)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/history`, {
      method: 'GET',
      headers: {
        'X-Tenant-Id': 'tenant_inconnu_autre',
        'X-User-Role': 'ADMIN'
      }
    });

    assert.equal(res.status, 404);
  });
});
