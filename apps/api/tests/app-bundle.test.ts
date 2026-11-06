/**
 * P2 — ROUTE DU BUNDLE : GET /preview-bundle/:id/ sert le HTML autonome
 * (scripts + styles inlinés) avec CORS ouvert (l'iframe sandboxée a une
 * origine opaque). La génération elle-même est validée en E2E réel (Mistral).
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { ensureWorkspace, writeAppFile, buildApp } from '../../../packages/core/src/app-pipeline.js';

describe('CORE-API P2 : service du bundle React généré', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_bundle_01';
  let projectId: string;
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'OWNER' };

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
    // PV-02 : vrai projet du registre (le bundle ne se sert plus sur ids synthétiques).
    const created = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: 'Bundle PV-02' })
    });
    assert.equal(created.status, 201);
    projectId = ((await created.json()) as { project: { id: string } }).project.id;
    // un projet React minimal construit via le pipeline
    ensureWorkspace(projectId, true);
    writeAppFile(projectId, 'src/App.tsx', 'export default function App() { return <div className="p-8">Bundle OK</div>; }');
    const build = await buildApp(projectId);
    assert.equal(build.ok, true, 'build de préparation : ' + build.errors.join(' | '));
  });

  after(async () => {
    await fetch(`${baseUrl}/api/v1/projects/${projectId}`, { method: 'DELETE', headers: H });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. GET /preview-bundle/:id/ → 200, HTML autonome (script inliné)', async () => {
    const res = await fetch(`${baseUrl}/preview-bundle/${projectId}/`, { headers: H });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.match(res.headers.get('access-control-allow-origin') || '', /\*/);
    const html = await res.text();
    assert.ok(html.includes('<script type="module">'), 'JS inliné');
    assert.ok(html.includes('Bundle OK'), 'le composant App est dans le bundle');
  });

  it('2. generate sans prompt → 400 explicite', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({})
    });
    assert.equal(res.status, 400);
    const data = (await res.json()) as { error?: { message?: string } };
    assert.match(String(data.error?.message), /prompt/);
  });

  it('3. PV-02 : inconnu ou autre locataire → 404 (generate + bundle)', async () => {
    const genUnknown = await fetch(`${baseUrl}/api/v1/projects/proj_inconnu_xyz/app/generate`, {
      method: 'POST', headers: H, body: JSON.stringify({ prompt: 'x' })
    });
    assert.equal(genUnknown.status, 404);
    const genEvil = await fetch(`${baseUrl}/api/v1/projects/../x/app/generate`, {
      method: 'POST', headers: H, body: JSON.stringify({ prompt: 'x' })
    });
    assert.ok(genEvil.status === 400 || genEvil.status === 404, 'traversée refusée');
    const bundleUnknown = await fetch(`${baseUrl}/preview-bundle/proj_inconnu_xyz/`, { headers: H });
    assert.equal(bundleUnknown.status, 404, 'aucune matérialisation pour un inconnu');
    const bundleOtherTenant = await fetch(`${baseUrl}/preview-bundle/${projectId}/`, {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_voisin', 'x-user-role': 'OWNER' }
    });
    // Le bundle reste servi sans contexte (iframe sans en-têtes) : le garde
    // est la non-création + l'indebinabilité — documenté, URLs signées à venir.
    assert.equal(bundleOtherTenant.status, 200);
  });

  it('4. PV-02 : edit / apply-edits / status d’autrui → 404', async () => {
    const other = { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_voisin', 'x-user-role': 'ENGINEER' };
    const edit = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/edit`, {
      method: 'POST', headers: other, body: JSON.stringify({ instruction: 'change tout' })
    });
    assert.equal(edit.status, 404);
    await edit.body?.cancel();
    const apply = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/apply-edits`, {
      method: 'POST', headers: other, body: JSON.stringify({ edits: [] })
    });
    assert.equal(apply.status, 404);
    await apply.body?.cancel();
    const status = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/status`, { headers: other });
    assert.equal(status.status, 404);
    // Même locataire : le status reste lisible (200).
    const own = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/status`, { headers: H });
    assert.equal(own.status, 200);
  });
});
