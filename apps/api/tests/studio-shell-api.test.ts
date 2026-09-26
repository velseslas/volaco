import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../packages/core/src/file-explorer/store.js';

describe('CAPP-005 : Studio Shell HTTP API Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_shell_api_01';
  let projectId: string;

  before(async () => {
    projectStore.clear();
    fileStore.clear();

    const proj = projectStore.createProject(tenantId, 'Projet Shell API Test');
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. GET /api/v1/projects/:projectId/shell : doit renvoyer le ViewModel unifié (JSON)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/shell`, {
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(body.shell);
    assert.equal(body.shell.tenantId, tenantId);
    assert.equal(body.shell.projectId, projectId);
    assert.equal(body.shell.project.status, 'CREATED');
    assert.ok(body.shell.layout);
    assert.equal(body.shell.layout.title, 'VibeCode Studio');
  });

  it('2. GET /shell : doit servir l interface HTML du Studio Shell (200 OK text/html)', async () => {
    const res = await fetch(`${baseUrl}/shell?projectId=${projectId}`, {
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('text/html'));
    const html = await res.text();
    assert.ok(html.includes('<!DOCTYPE html>') || html.includes('html'));
    assert.ok(html.includes('VibeCode Studio'));
  });

  it('3. GET /studio : doit également servir le Studio Shell', async () => {
    const res = await fetch(`${baseUrl}/studio?projectId=${projectId}`, {
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('text/html'));
  });

  it('4. Isolation Multi-Tenant : doit renvoyer 404 pour un locataire non autorisé sur /shell API', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/shell`, {
      headers: {
        'x-tenant-id': 'tenant_pirate_hacker',
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 404);
  });
});
