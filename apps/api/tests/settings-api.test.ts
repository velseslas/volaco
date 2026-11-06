import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';

interface ProjectSettingsApiResponse {
  settings: {
    projectId: string;
    tenantId: string;
    stack: {
      framework: string;
      buildTool: string;
      nodeVersion: string;
    };
    envVars: Record<string, string>;
    tags: string[];
    updatedAt: string;
  };
  requestId: string;
}

describe('CORE-006 : Project Settings API Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_set_api_01';
  let projectId: string;

  before(async () => {
    projectStore.clear();
    const proj = projectStore.createProject(tenantId, 'Settings Integration App');
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

  it('doit récupérer les paramètres par défaut d un projet (GET)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/settings`, {
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as ProjectSettingsApiResponse;
    assert.equal(body.settings.projectId, projectId);
    assert.equal(body.settings.tenantId, tenantId);
    assert.equal(body.settings.stack.framework, 'html-vanilla');
    assert.ok(res.headers.has('x-request-id'));
  });

  it('doit mettre à jour la stack et masquer les variables sensibles (PUT)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        stack: { framework: 'vue', buildTool: 'vite' },
        envVars: {
          API_SECRET_KEY: 'secret_123456789_abcdef',
          VITE_APP_TITLE: 'Mon SaaS Vue'
        },
        tags: ['vue', 'frontend']
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as ProjectSettingsApiResponse;
    assert.equal(body.settings.stack.framework, 'vue');
    assert.equal(body.settings.stack.buildTool, 'vite');
    // Vérification du masquage de sécurité
    assert.ok(
      body.settings.envVars['API_SECRET_KEY']!.includes('...') ||
      body.settings.envVars['API_SECRET_KEY']!.includes('***')
    );
    assert.notEqual(body.settings.envVars['API_SECRET_KEY'], 'secret_123456789_abcdef');
    assert.equal(body.settings.envVars['VITE_APP_TITLE'], 'Mon SaaS Vue');
  });

  it('doit interdire la modification des paramètres au rôle VIEWER (403)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      },
      body: JSON.stringify({
        tags: ['hack']
      })
    });

    assert.equal(res.status, 403);
  });

  it('doit garantir l étanchéité multi-tenant (404)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/settings`, {
      headers: {
        'x-tenant-id': 'tenant_pirate_settings',
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 404);
  });
});
