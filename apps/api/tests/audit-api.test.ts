import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../packages/core/src/file-explorer/store.js';
import { auditStore } from '../../../packages/core/src/observability/audit.js';

describe('AINT-013 : Application Audit HTTP API Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_audit_api_01';
  let projectId: string;

  before(async () => {
    projectStore.clear();
    fileStore.clear();
    auditStore.clear();

    const proj = projectStore.createProject(tenantId, 'Projet Audit API Test');
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

  it('1. POST /api/v1/projects/:projectId/audit : doit auditer les fichiers du projet et renvoyer le rapport complet', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/audit`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'DEVELOPER',
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
    assert.ok(typeof body.report.overallScore === 'number');
    assert.ok(body.report.overallScore >= 0 && body.report.overallScore <= 100);
    assert.ok(body.report.dimensionScores);
    assert.ok(typeof body.report.dimensionScores.security === 'number');
    assert.ok(typeof body.report.dimensionScores.architecture === 'number');
    assert.ok(typeof body.report.dimensionScores.codeQuality === 'number');
    assert.ok(body.report.summary);
    assert.ok(body.conversationSummary.includes('Diagnostic Global'));
    assert.ok(Array.isArray(body.remediationTasks));
  });

  it('2. POST /api/v1/projects/:projectId/audit : doit détecter les anomalies sur des fichiers transmis en payload', async () => {
    const maliciousCode = `
      export function bad() {
        const code = "secret";
        eval(code);
        document.write("<h1>bad</h1>");
      }
    `;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/audit`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'DEVELOPER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        files: [
          { path: 'src/bad.js', content: maliciousCode }
        ]
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.ok(body.report.findings.length > 0);
    const secFindings = body.report.findings.filter((f: any) => f.dimension === 'SECURITY');
    assert.ok(secFindings.length > 0);
    assert.ok(secFindings.some((f: any) => f.title.includes('eval')));
  });

  it('3. GET /api/v1/projects/:projectId/audit : doit fonctionner en consultation GET', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/audit`, {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.ok(body.report.overallScore >= 0);
  });

  it('4. POST /api/v1/audit : doit exécuter un audit in-memory direct sans ID de projet préalable', async () => {
    const res = await fetch(`${baseUrl}/api/v1/audit`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        files: [
          { path: 'index.html', content: '<!DOCTYPE html><html><body><h1>Safe</h1></body></html>' }
        ]
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.ok(body.report.overallScore >= 90);
  });

  it('5. Isolation Multi-Tenant : doit renvoyer 404 pour un locataire étranger non autorisé', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/audit`, {
      method: 'POST',
      headers: {
        'x-tenant-id': 'tenant_pirate_hacker',
        'x-user-role': 'DEVELOPER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 404);
  });

  it('6. Observabilité : doit enregistrer l événement APPLICATION_AUDIT_EXECUTE dans l auditStore', async () => {
    const events = auditStore.query(tenantId, { action: 'APPLICATION_AUDIT_EXECUTE' });
    assert.ok(events.length >= 1);
    assert.equal(events[0]?.status, 'SUCCESS');
    assert.ok(events[0]?.metadata?.overallScore !== undefined);
  });
});
