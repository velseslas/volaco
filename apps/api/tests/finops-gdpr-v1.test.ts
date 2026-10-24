/**
 * CDC §53 FinOps + §50 Gouvernance — tranches V1 (e2e HTTP).
 * FinOps : agrégation coût/tokens par modèle/provider/projet/jour depuis
 *          les événements d'usage réels. RGPD : portabilité (export JSON)
 *          et droit à l'effacement (erase tenant).
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { aiUsageTracker } from '../../../packages/core/src/ai/usage.js';

const TENANT = 'tenant_finops';

const HO = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': TENANT, 'x-user-role': 'OWNER' };
const HE = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': TENANT, 'x-user-role': 'ENGINEER' };

describe('FINOPS + RGPD — tranches V1 (e2e)', () => {
  let server: Server;
  let baseUrl = '';
  let projectId = '';

  before(async () => {
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    const project = projectStore.createProject(TENANT, 'Boutique FinOps Test');
    projectId = project.id;
    // Deux événements SUCCESS (facturés) + un ERROR (0 coût, compté séparément)
    aiUsageTracker.recordUsage(TENANT, projectId, 'mistral-medium-latest', 100, 50, 'req_fin_1', 'mistral');
    aiUsageTracker.recordUsage(TENANT, projectId, 'gemini-2.5-flash', 200, 100, 'req_fin_2', 'gemini');
    aiUsageTracker.recordAttempt({
      tenantId: TENANT, projectId, model: 'mistral-medium-latest',
      provider: 'mistral', requestId: 'req_fin_3', kind: 'ERROR', error: 'simulated'
    });
  });

  after(() => {
    server.close();
    for (const p of projectStore.listProjects(TENANT)) {
      projectStore.deleteProject(TENANT, p.id);
    }
  });

  it('§53 GET /finops/summary agrège coût, tokens et requêtes par modèle', async () => {
    const res = await fetch(`${baseUrl}/api/v1/finops/summary`, { headers: HO });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.tenantId, TENANT);
    assert.equal(body.pricing, 'estimated');
    assert.equal(body.totals.totalTokens, 450);
    assert.ok(body.totals.costUsd > 0, 'coût estimé strictement positif');
    assert.equal(body.totals.billedRequests, 2, '2 requêtes facturées (SUCCESS)');
    assert.equal(body.totals.errorCount, 1, '1 erreur comptée');
    const models = body.byModel.map((b: any) => b.key);
    assert.ok(models.includes('mistral-medium-latest'), 'bucket par modèle présent');
    const providers = body.byProvider.map((b: any) => b.key);
    assert.ok(providers.includes('mistral') && providers.includes('gemini'), 'buckets par provider');
    assert.ok(body.byDay.length >= 1, 'bucket par jour');
  });

  it('§53 GET /projects/:id/finops — Cost/Project + refus TENANT_MANAGE aux non-owner', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/finops`, { headers: HE });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.projectId, projectId);
    assert.equal(body.totals.totalTokens, 450);

    const denied = await fetch(`${baseUrl}/api/v1/finops/summary`, { headers: HE });
    assert.equal(denied.status, 403, 'la vue tenant est réservée à TENANT_MANAGE');
  });

  it('§50 GET /gdpr/export — portabilité : projets + usage + audit du tenant', async () => {
    const res = await fetch(`${baseUrl}/api/v1/gdpr/export`, { headers: HO });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.format, 'volaco-gdpr-export/1');
    assert.equal(body.tenantId, TENANT);
    assert.ok(Array.isArray(body.projects) && body.projects.some((p: any) => p.id === projectId));
    assert.ok(Array.isArray(body.usage) && body.usage.length >= 2);
    assert.ok(Array.isArray(body.audit));
  });

  it('§50 DELETE /gdpr/erase — droit à l effacement, cascade complète', async () => {
    const res = await fetch(`${baseUrl}/api/v1/gdpr/erase`, { method: 'DELETE', headers: HO });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.deleted >= 1, true);
    assert.equal(projectStore.getProject(TENANT, projectId), null, 'projet effacé');

    // Le tenant est vide : un nouvel export ne contient plus le projet
    const res2 = await fetch(`${baseUrl}/api/v1/gdpr/export`, { headers: HO });
    const body2 = await res2.json() as any;
    assert.ok(!body2.projects.some((p: any) => p.id === projectId), 'plus de projet après erase');
  });
});
