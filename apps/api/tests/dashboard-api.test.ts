import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';

interface DashboardSummaryResponse {
  summary: {
    tenantId: string;
    totalProjects: number;
    activeProjectId?: string;
    lastActivityAt?: string;
    projects: Array<{
      id: string;
      name: string;
      description?: string;
      createdAt: string;
      updatedAt: string;
      isCurrent?: boolean;
    }>;
  };
  requestId: string;
}

describe('CORE-002 : Dashboard API Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantA = 'tenant_dash_alpha';
  const tenantB = 'tenant_dash_beta';

  before(async () => {
    projectStore.clear();
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

  it('doit renvoyer un résumé vide pour un tenant sans projets', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary`, {
      headers: {
        'x-tenant-id': tenantA,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as DashboardSummaryResponse;
    assert.equal(body.summary.tenantId, tenantA);
    assert.equal(body.summary.totalProjects, 0);
    assert.equal(body.summary.projects.length, 0);
    assert.ok(res.headers.has('x-request-id'));
  });

  it('doit afficher les projets créés dans le dashboard summary', async () => {
    // 1. Créer un projet pour tenantA
    const createRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantA,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        name: 'Dashboard Alpha App',
        description: 'Application de test pour le dashboard'
      })
    });
    assert.equal(createRes.status, 201);
    const createdProject = (await createRes.json()) as { project: { id: string; name: string } };

    // 2. Interroger le dashboard
    const summaryRes = await fetch(`${baseUrl}/api/v1/dashboard/summary`, {
      headers: {
        'x-tenant-id': tenantA,
        'x-user-role': 'VIEWER'
      }
    });
    assert.equal(summaryRes.status, 200);
    const summaryBody = (await summaryRes.json()) as DashboardSummaryResponse;

    assert.equal(summaryBody.summary.totalProjects, 1);
    assert.equal(summaryBody.summary.projects.length, 1);
    assert.equal(summaryBody.summary.projects[0]!.id, createdProject.project.id);
    assert.equal(summaryBody.summary.projects[0]!.name, 'Dashboard Alpha App');
    assert.equal(summaryBody.summary.projects[0]!.description, 'Application de test pour le dashboard');
  });

  it('doit garantir l isolation stricte multi-tenant', async () => {
    // Tenant B ne doit rien voir des projets du Tenant A
    const summaryRes = await fetch(`${baseUrl}/api/v1/dashboard/summary`, {
      headers: {
        'x-tenant-id': tenantB,
        'x-user-role': 'VIEWER'
      }
    });
    assert.equal(summaryRes.status, 200);
    const summaryBody = (await summaryRes.json()) as DashboardSummaryResponse;

    assert.equal(summaryBody.summary.tenantId, tenantB);
    assert.equal(summaryBody.summary.totalProjects, 0);
    assert.equal(summaryBody.summary.projects.length, 0);
  });
});
