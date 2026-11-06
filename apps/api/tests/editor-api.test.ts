import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../packages/core/src/file-explorer/store.js';

interface SaveFileApiResponse {
  result: {
    tenantId: string;
    projectId: string;
    path: string;
    sizeBytes: number;
    sha256: string;
    savedAt: string;
    workspaceSynced: boolean;
  };
  requestId: string;
}

interface FileContentResponse {
  file: {
    path: string;
    name: string;
    content: string;
    sizeBytes: number;
  };
  requestId: string;
}

describe('CORE-004 : Code Editor API Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_ed_api_01';
  let projectId: string;

  before(async () => {
    projectStore.clear();
    fileStore.clear();
    const proj = projectStore.createProject(tenantId, 'Editor Integration Project');
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
    projectStore.clear();
    fileStore.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('doit sauvegarder le contenu via PUT et retourner le condensat SHA-256', async () => {
    const newCode = '<!DOCTYPE html><html><body><h1>VibeCode Core</h1></body></html>';
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        path: 'index.html',
        content: newCode
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as SaveFileApiResponse;
    assert.equal(body.result.path, 'index.html');
    assert.equal(body.result.sizeBytes, Buffer.byteLength(newCode, 'utf8'));
    assert.equal(body.result.sha256.length, 64);
    assert.ok(res.headers.has('x-request-id'));

    // Vérifier la relecture immédiate via GET
    const getRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, {
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });
    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as FileContentResponse;
    assert.equal(getBody.file.content, newCode);
  });

  it('doit interdire la sauvegarde à un utilisateur avec rôle VIEWER (403)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      },
      body: JSON.stringify({
        path: 'index.html',
        content: 'hacked'
      })
    });

    assert.equal(res.status, 403);
  });

  it('doit refuser la modification d un projet d un autre tenant (404)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': 'tenant_autre_adversaire',
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        path: 'index.html',
        content: 'pirate'
      })
    });

    assert.equal(res.status, 404);
  });

  it('doit valider la présence des champs obligatoires path et content (400)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        path: ''
      })
    });

    assert.equal(res.status, 400);
  });
});
