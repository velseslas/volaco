import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { aiUsageTracker } from '../../../packages/core/src/ai/usage.js';

describe('FND-005 : Observability, Audit & Cost HTTP Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const testTenant = 'tenant_obs_secure';

  before(async () => {
    aiUsageTracker.recordUsage(testTenant, 'proj_1', 'codestral-latest', 50_000, 25_000, 'req_init');
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

  it('doit exposer les mÃ©triques systÃ¨me et incrÃ©menter le compteur de requÃªtes', async () => {
    // Effectuer 2 requÃªtes
    await fetch(`${baseUrl}/health`);
    await fetch(`${baseUrl}/health`);

    const res = await fetch(`${baseUrl}/api/v1/metrics`);
    assert.equal(res.status, 200);

    const body = (await res.json()) as any;
    assert.ok(body.metrics.totalRequests >= 2);
    assert.ok(body.metrics.successCount >= 2);
    assert.ok(body.metrics.uptimeSeconds >= 0);
  });

  it('doit retourner le rapport d audit pour le tenant avec rÃ´le OWNER (200), mais rejeter VIEWER (403)', async () => {
    // CrÃ©er un projet pour gÃ©nÃ©rer un Ã©vÃ©nement d audit
    await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': testTenant,
        'X-User-Role': 'ENGINEER'
      },
      body: JSON.stringify({ name: 'Audit Test Project' })
    });

    // RequÃªte par VIEWER -> 403 Forbidden (seul OWNER gÃ¨re le tenant)
    const resViewer = await fetch(`${baseUrl}/api/v1/audit`, {
      headers: { 'X-Tenant-Id': testTenant, 'X-User-Role': 'VIEWER' }
    });
    assert.equal(resViewer.status, 403);

    // RequÃªte par OWNER -> 200 OK
    const resOwner = await fetch(`${baseUrl}/api/v1/audit`, {
      headers: { 'X-Tenant-Id': testTenant, 'X-User-Role': 'OWNER' }
    });
    assert.equal(resOwner.status, 200);
    const bodyOwner = (await resOwner.json()) as any;
    assert.ok(bodyOwner.events.length >= 1);
    assert.equal(bodyOwner.events[0].action, 'PROJECT_CREATE');
  });

  it('doit exposer le rÃ©sumÃ© de consommation des tokens et coÃ»ts IA', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/usage`, {
      headers: { 'X-Tenant-Id': testTenant, 'X-User-Role': 'ENGINEER' }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.usage.tenantId, testTenant);
    assert.equal(body.usage.totalPromptTokens, 50_000);
    assert.equal(body.usage.totalCompletionTokens, 25_000);
    assert.ok(body.usage.totalCostUsd > 0);
  });
});
