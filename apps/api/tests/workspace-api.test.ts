import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../packages/core/src/file-explorer/store.js';
import { revisionStore } from '../../../packages/core/src/model/revision-store.js';

describe('CAPP-001 : Project Workspace & Summary HTTP API Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantA = 'tenant_ws_alpha';
  const tenantB = 'tenant_ws_beta';
  let projectA: { id: string; name: string };

  before(async () => {
    projectStore.clear();
    fileStore.clear();
    revisionStore.clear();

    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    // Créer un projet de test pour tenantA
    projectA = projectStore.createProject(tenantA, 'Workspace Alpha Project', 'Description Workspace Alpha');
    // Ajouter une révision et des fichiers
    revisionStore.createRevision(tenantA, projectA.id, {
      message: 'Initial Commit API',
      author: 'system',
      files: { 'index.html': '<h1>Workspace Ready</h1>' },
      provenance: { source: 'USER', prompt: 'Setup' }
    });
  });

  after(async () => {
    projectStore.clear();
    fileStore.clear();
    revisionStore.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('doit renvoyer le workspace complet (200 OK) avec révision et fichiers pour un ENGINEER', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectA.id}/workspace`, {
      headers: {
        'x-tenant-id': tenantA,
        'x-user-role': 'ENGINEER'
      }
    });

    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.ok(data.workspace);
    assert.equal(data.workspace.projectId, projectA.id);
    assert.equal(data.workspace.tenantId, tenantA);
    assert.equal(data.workspace.status, 'READY');
    assert.equal(data.workspace.state.activeFile, 'index.html');
    assert.equal(data.workspace.revisionNumber, 1);
    assert.ok(data.workspace.currentRevisionId);
    assert.ok(Array.isArray(data.workspace.files));
    assert.ok(data.workspace.summary);
    assert.equal(data.workspace.summary.name, 'Workspace Alpha Project');
  });

  it('doit renvoyer le résumé du projet (200 OK) via GET /summary', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectA.id}/summary`, {
      headers: {
        'x-tenant-id': tenantA,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.ok(data.summary);
    assert.equal(data.summary.projectId, projectA.id);
    assert.equal(data.summary.tenantId, tenantA);
    assert.equal(data.summary.name, 'Workspace Alpha Project');
    assert.equal(data.summary.revisionNumber, 1);
    assert.ok(data.summary.filesCount >= 1);
  });

  it('doit autoriser la mise à jour du workspace (200 OK) pour le rôle ENGINEER', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectA.id}/workspace`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantA,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        activeFile: 'styles.css',
        openFiles: ['index.html', 'styles.css'],
        isDirty: true
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.equal(data.workspace.state.activeFile, 'styles.css');
    assert.deepEqual(data.workspace.state.openFiles, ['index.html', 'styles.css']);
    assert.equal(data.workspace.state.isDirty, true);
  });

  it('doit interdire la mise à jour du workspace (403 Forbidden) pour le rôle VIEWER', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectA.id}/workspace`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantA,
        'x-user-role': 'VIEWER'
      },
      body: JSON.stringify({ activeFile: 'hacked.css' })
    });

    assert.equal(res.status, 403);
  });

  it('doit respecter strictement l isolation multi-tenant (404 Not Found)', async () => {
    // Tenant B ne peut pas accéder au workspace de Tenant A
    const resWs = await fetch(`${baseUrl}/api/v1/projects/${projectA.id}/workspace`, {
      headers: {
        'x-tenant-id': tenantB,
        'x-user-role': 'ENGINEER'
      }
    });
    assert.equal(resWs.status, 404);

    // Tenant B ne peut pas accéder au summary de Tenant A
    const resSum = await fetch(`${baseUrl}/api/v1/projects/${projectA.id}/summary`, {
      headers: {
        'x-tenant-id': tenantB,
        'x-user-role': 'ENGINEER'
      }
    });
    assert.equal(resSum.status, 404);
  });

  it('doit isoler l accès sans header tenant explicite (404 Not Found via default-tenant)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectA.id}/workspace`);
    assert.equal(res.status, 404);
  });
});
