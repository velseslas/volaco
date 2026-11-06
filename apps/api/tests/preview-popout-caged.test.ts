/**
 * PV-01 — popout cagé : le bundle et l'aperçu isolé portent CSP sandbox +
 * COOP (origine opaque même en onglet) ; le blob: a disparu du popout ;
 * l'aperçu isolé exige un dépôt authentifié et oublie tout au redémarrage.
 */
import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { ensureWorkspace, writeAppFile, buildApp } from '../../../packages/core/src/app-pipeline.js';

describe('PV-01 : popout cagé (CSP sandbox + COOP, pas de blob)', () => {
  let server: Server;
  let baseUrl: string;
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'ten_pv01', 'x-user-role': 'OWNER' };
  let projectId: string;

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
    const created = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: 'PV-01' })
    });
    assert.equal(created.status, 201);
    projectId = ((await created.json()) as { project: { id: string } }).project.id;
    ensureWorkspace(projectId, true);
    writeAppFile(projectId, 'src/App.tsx', 'export default function App() { return <div>PV01</div>; }');
    const build = await buildApp(projectId);
    assert.equal(build.ok, true);
  });

  after(async () => {
    await fetch(`${baseUrl}/api/v1/projects/${projectId}`, { method: 'DELETE', headers: H });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. bundle en onglet : CSP sandbox + COOP + nosniff', async () => {
    const res = await fetch(`${baseUrl}/preview-bundle/${projectId}/`, { headers: H });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy') || '', /sandbox/);
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('2. aperçu isolé : dépôt authentifié → lecture cagée éphémère', async () => {
    const html = '<!DOCTYPE html><html><head><title>t</title></head><body>MARQUEUR-PV01-' + 'x'.repeat(200) + '</body></html>';
    const dep = await fetch(`${baseUrl}/api/v1/preview/standalone`, {
      method: 'POST', headers: H, body: JSON.stringify({ projectId, html })
    });
    assert.equal(dep.status, 201);
    const { id, url } = (await dep.json()) as { id: string; url: string };
    assert.ok(/^pv_[0-9a-f]{32}$/.test(id), 'id indevinable');
    const get = await fetch(`${baseUrl}${url}`);
    assert.equal(get.status, 200);
    assert.match(get.headers.get('content-security-policy') || '', /sandbox/);
    assert.equal(get.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(get.headers.get('cache-control'), 'no-store');
    assert.ok((await get.text()).includes('MARQUEUR-PV01-'), 'le HTML déposé est resservi à l’identique');
  });

  it('3. inconnu / autrui / vide : 404, 404, 400', async () => {
    const html = '<html><body>' + 'y'.repeat(200) + '</body></html>';
    const unknownProj = await fetch(`${baseUrl}/api/v1/preview/standalone`, {
      method: 'POST', headers: H, body: JSON.stringify({ projectId: 'proj_inconnu_xyz', html })
    });
    assert.equal(unknownProj.status, 404);
    const evilProj = await fetch(`${baseUrl}/api/v1/preview/standalone`, {
      method: 'POST', headers: H, body: JSON.stringify({ projectId: '../../x', html })
    });
    assert.equal(evilProj.status, 400);
    const empty = await fetch(`${baseUrl}/api/v1/preview/standalone`, {
      method: 'POST', headers: H, body: JSON.stringify({ html: 'court' })
    });
    assert.equal(empty.status, 400);
    const ghost = await fetch(`${baseUrl}/preview-standalone/pv_00000000000000000000000000000000/`);
    assert.equal(ghost.status, 404);
  });

  it('4. garde source : aucun blob: ouvert en onglet dans popoutPreview', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'apps/studio/index.html'), 'utf8');
    const start = src.indexOf('async function popoutPreview()');
    const popout = src.slice(start, start + 4500);
    // Le blob restant n'alimente qu'un TÉLÉCHARGEMENT (origine fichier à
    // l'ouverture, jamais celle du Studio) — aucun window.open(blob).
    assert.ok(!popout.includes('window.open(url'), 'aucun blob: ouvert en onglet');
    assert.ok(popout.includes('/api/v1/preview/standalone'), 'le chemin nominal passe par l’aperçu isolé');
    assert.ok(popout.includes("a.download = 'apercu-volaco.html'"), 'repli sûr : téléchargement');
  });
});
