import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

describe('FND-003 : Multi-Tenancy & RBAC HTTP Integration Tests', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
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

  it('doit crÃ©er un projet rattachÃ© au tenant de la requÃªte', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant_acme',
        'X-User-Role': 'ENGINEER'
      },
      body: JSON.stringify({ name: 'Portail Client Acme', description: 'App B2B' })
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.project.name, 'Portail Client Acme');
    assert.equal(body.project.tenantId, 'tenant_acme');
    assert.ok(body.project.id);
  });

  it('doit empÃªcher un autre tenant de voir les projets crÃ©Ã©s (Ã‰tanchÃ©itÃ© Multi-Tenant)', async () => {
    // 1. Liste pour tenant_acme -> contient au moins notre projet
    const resAcme = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { 'X-Tenant-Id': 'tenant_acme', 'X-User-Role': 'VIEWER' }
    });
    assert.equal(resAcme.status, 200);
    const dataAcme = (await resAcme.json()) as any;
    assert.ok(dataAcme.projects.length >= 1);
    const acmeProjectId = dataAcme.projects[0].id;

    // 2. Liste pour tenant_rival -> 0 projet
    const resRival = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { 'X-Tenant-Id': 'tenant_rival', 'X-User-Role': 'VIEWER' }
    });
    assert.equal(resRival.status, 200);
    const dataRival = (await resRival.json()) as any;
    assert.equal(dataRival.projects.length, 0);

    // 3. Tentative d'accÃ¨s direct par ID par tenant_rival -> 404
    const resDirect = await fetch(`${baseUrl}/api/v1/projects/${acmeProjectId}`, {
      headers: { 'X-Tenant-Id': 'tenant_rival', 'X-User-Role': 'VIEWER' }
    });
    assert.equal(resDirect.status, 404);
  });

  it('doit interdire Ã  un VIEWER de crÃ©er un projet (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant_acme',
        'X-User-Role': 'VIEWER'
      },
      body: JSON.stringify({ name: 'Projet Illicite' })
    });

    assert.equal(res.status, 403);
    const body = (await res.json()) as any;
    assert.equal(body.error.code, 'FORBIDDEN');
  });

  it('doit interdire Ã  un ENGINEER de supprimer un projet (403), mais autoriser un ADMIN (200)', async () => {
    // 1. CrÃ©ation par un ENGINEER
    const createRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant_acme',
        'X-User-Role': 'ENGINEER'
      },
      body: JSON.stringify({ name: 'Projet Ã€ Supprimer' })
    });
    assert.equal(createRes.status, 201);
    const { project } = (await createRes.json()) as any;

    // 2. Tentative de suppression par un ENGINEER -> 403
    const delResEngineer = await fetch(`${baseUrl}/api/v1/projects/${project.id}`, {
      method: 'DELETE',
      headers: {
        'X-Tenant-Id': 'tenant_acme',
        'X-User-Role': 'ENGINEER'
      }
    });
    assert.equal(delResEngineer.status, 403);

    // 3. Suppression autorisÃ©e par un ADMIN -> 200
    const delResAdmin = await fetch(`${baseUrl}/api/v1/projects/${project.id}`, {
      method: 'DELETE',
      headers: {
        'X-Tenant-Id': 'tenant_acme',
        'X-User-Role': 'ADMIN'
      }
    });
    assert.equal(delResAdmin.status, 200);
    const delBody = (await delResAdmin.json()) as any;
    assert.equal(delBody.success, true);
  });
});
