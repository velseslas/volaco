/**
 * P2 — ROUTE DU BUNDLE : GET /preview-bundle/:id/ sert le HTML autonome
 * (scripts + styles inlinés) avec CORS ouvert (l'iframe sandboxée a une
 * origine opaque). La génération elle-même est validée en E2E réel (Mistral).
 */

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
  const projectId = 'proj_bundle_test_01';

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
    // un projet React minimal construit via le pipeline
    ensureWorkspace(projectId, true);
    writeAppFile(projectId, 'src/App.tsx', 'export default function App() { return <div className="p-8">Bundle OK</div>; }');
    const build = await buildApp(projectId);
    assert.equal(build.ok, true, 'build de préparation : ' + build.errors.join(' | '));
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. GET /preview-bundle/:id/ → 200, HTML autonome (script inliné)', async () => {
    const res = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
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
});
