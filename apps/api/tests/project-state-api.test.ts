import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../packages/core/src/file-explorer/store.js';
import { projectStateStore } from '../../../packages/core/src/project-state/store.js';

describe('CAPP-004 : Project State & Application Status HTTP API Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_state_api_01';
  let projectId: string;

  before(async () => {
    projectStore.clear();
    fileStore.clear();
    projectStateStore.clear();

    const proj = projectStore.createProject(tenantId, 'Projet Web State API');
    projectId = proj.id;
    fileStore.initializeStandardTree(tenantId, projectId);

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
    fileStore.clear();
    projectStateStore.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. GET /api/v1/projects/:projectId/state : doit renvoyer l état unifié du projet', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/state`, {
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(body.state);
    assert.equal(body.state.tenantId, tenantId);
    assert.equal(body.state.projectId, projectId);
    assert.equal(body.state.status, 'CREATED');
    assert.ok(body.state.currentRevision);
    assert.ok(body.state.workspace);
    assert.ok(body.state.validation);
    assert.equal(body.state.validation.status, 'PENDING');
  });

  it('2. PUT /api/v1/projects/:projectId/status : doit mettre à jour le statut du projet', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({ status: 'ACTIVE', reason: 'Activation par API' })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.state.status, 'ACTIVE');
  });

  it('3. PUT /api/v1/projects/:projectId/status : doit rejeter les transitions illégales (400 Bad Request)', async () => {
    // Actuellement ACTIVE. Tenter de sauter directement à CREATED (non permis depuis ACTIVE)
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({ status: 'CREATED' })
    });

    assert.equal(res.status, 400);
  });

  it('4. POST /api/v1/projects/:projectId/validate : doit exécuter la validation et mettre à jour le statut', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        checks: { build: true, typecheck: true, lint: true, tests: true, security: true }
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.validation.status, 'VALID');

    // Vérifier que le statut du projet est devenu READY
    const stateRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/state`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const stateBody = (await stateRes.json()) as any;
    assert.equal(stateBody.state.status, 'READY');
  });

  it('5. GET /api/v1/projects/:projectId/activity : doit lister les activités récentes', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/activity?limit=5`, {
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(Array.isArray(body.activity));
    assert.ok(body.activity.length >= 2);
  });

  it('6. RBAC : doit interdire les mutations de statut au rôle VIEWER (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      },
      body: JSON.stringify({ status: 'ARCHIVED' })
    });

    assert.equal(res.status, 403);
  });

  it('7. Isolation Multi-Tenant : un locataire rival ne peut accéder aux états (404 Not Found)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/state`, {
      headers: {
        'x-tenant-id': 'tenant_pirate_other',
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 404);
  });
});
