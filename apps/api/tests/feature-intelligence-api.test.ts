import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../packages/core/src/file-explorer/store.js';
import { auditStore } from '../../../packages/core/src/observability/audit.js';

describe('AINT-014 : Feature Intelligence & Product Evolution HTTP API Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_feature_api_01';
  let projectId: string;

  before(async () => {
    projectStore.clear();
    fileStore.clear();
    auditStore.clear();

    const proj = projectStore.createProject(tenantId, 'Projet Feature Intelligence API Test');
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
    auditStore.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. POST /api/v1/projects/:projectId/features/analyze : doit découvrir des opportunités et renvoyer le rapport', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/features/analyze`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.ok(body.report);
    assert.equal(body.report.tenantId, tenantId);
    assert.equal(body.report.projectId, projectId);
    assert.ok(body.report.opportunities.length > 0);
    assert.ok(body.conversationSummary.includes('Rapport d Intelligence Produit'));
  });

  it('2. GET /api/v1/projects/:projectId/features : doit renvoyer les opportunités découvertes', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/features`, {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.ok(body.report.opportunities.length > 0);
  });

  it('3. GET /api/v1/projects/:projectId/features/:featureId : doit renvoyer le détail et l explication d une opportunité', async () => {
    // Récupérer le premier ID
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/features`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as any;
    const firstId = listBody.report.opportunities[0].id;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/features/${firstId}`, {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.opportunity.id, firstId);
    assert.ok(body.conversationSummary.includes('Opportunité :'));
  });

  it('4. POST /api/v1/projects/:projectId/features/:featureId/lifecycle : doit faire évoluer le statut', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/features`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as any;
    const firstId = listBody.report.opportunities[0].id;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/features/${firstId}/lifecycle`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        newStatus: 'PROPOSED',
        reason: 'Présenté à l utilisateur'
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.opportunity.status, 'PROPOSED');
  });

  it('5. POST /api/v1/projects/:projectId/features/:featureId/plan : doit générer un plan d ingénierie AINT-010', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/features`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as any;
    const firstId = listBody.report.opportunities[0].id;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/features/${firstId}/plan`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.ok(body.plan);
    assert.equal(body.plan.featureId, firstId);
    assert.ok(body.plan.taskGraph.tasks.length >= 3);
  });

  it('6. POST /api/v1/features/analyze : doit analyser en mémoire sans projet existant', async () => {
    const res = await fetch(`${baseUrl}/api/v1/features/analyze`, {
      method: 'POST',
      headers: {
        'x-tenant-id': 'tenant-direct',
        'x-user-role': 'VIEWER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        files: [
          { path: 'index.html', content: '<html><body><h1>Test</h1></body></html>' },
          { path: 'src/app.js', content: 'export function App() { return "<div>app</div>"; }' }
        ]
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.ok(body.report.opportunities.length > 0);
  });

  it('7. Sécurité & Multi-Tenant : doit refuser l accès si le projet appartient à un autre tenant (404)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/features`, {
      method: 'GET',
      headers: {
        'x-tenant-id': 'tenant_intruder',
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 404);
  });

  it('8. RBAC : un VIEWER ne peut pas exécuter de transition de cycle de vie (403)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/features/gap-search-filter/lifecycle`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        newStatus: 'ACCEPTED'
      })
    });

    assert.equal(res.status, 403);
  });
});
