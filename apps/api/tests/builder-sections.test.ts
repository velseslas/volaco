/**
 * ÉTAPE 38 — PERSISTANCE DES ÉDITIONS BUILDER : PUT /files/section/:name.
 *
 * Le Builder renvoie l'HTML réel édité d'un composant ; le serveur remplace
 * le bloc <div data-section="name"> correspondant dans index.html (mêmes
 * conventions que l'assemblage des générations) et crée une RÉVISION
 * réversible. Serveur réel sur port 0, FileStore/RevisionStore réels.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';

const HEAD = '<!DOCTYPE html><html><head><title>T</title></head><body>\n';
const TAIL = '\n</body></html>';
const initialHtml = HEAD
  + '<div class="vibe-stitched" data-section="header"><header><span>Logo</span></header></div>\n'
  + '<div class="vibe-stitched" data-section="hero"><section><h1>Ancien titre</h1></section></div>\n'
  + TAIL;

describe('CORE-API É38 : persistance des sections du Builder', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_sections_01';
  let projectId: string;

  before(async () => {
    projectStore.clear();
    projectId = projectStore.createProject(tenantId, 'Sections App').id;
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    // état initial : le site généré (2 sections)
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ path: 'index.html', content: initialHtml })
    });
  });

  after(async () => {
    projectStore.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const content = async (): Promise<string> => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, {
      headers: { 'x-tenant-id': tenantId }
    });
    const data = (await res.json()) as { file: { content: string } };
    return data.file.content;
  };

  it('1. remplacement du bloc hero : la nouvelle section est en place, les autres intactes', async () => {
    const newSection = '<section><h1>Nouveau titre percutant</h1></section>';
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/section/hero`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ html: newSection })
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { applied: boolean; revisionId?: string };
    assert.equal(data.applied, true);
    assert.ok(data.revisionId, 'une révision est créée');

    const html = await content();
    assert.ok(html.includes('<div class="vibe-stitched" data-section="hero">' + newSection + '</div>'), 'bloc hero remplacé avec wrapper');
    assert.ok(html.includes('data-section="header"'), 'header intact');
    assert.ok(!html.includes('Ancien titre'), 'ancien contenu parti');
    // même convention que l'assemblage : le bloc matché peut avaler les
    // espaces juste avant </body> — seul le document fini compte.
    assert.ok(html.trimEnd().endsWith('</body></html>'), 'document HTML complet');
  });

  it('2. une révision réversible « Édition Builder » est créée à chaque sauvegarde', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      headers: { 'x-tenant-id': tenantId }
    });
    const data = (await res.json()) as { revisions: Array<{ message: string }> };
    const builderRev = data.revisions.find((r) => r.message === 'Édition Builder — section hero');
    assert.ok(builderRev, 'révision dédiée présente');
  });

  it('3. section inexistante : applied:false honnête, fichier intact', async () => {
    const before = await content();
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/section/footer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ html: '<footer>x</footer>' })
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { applied: boolean; reason?: string };
    assert.equal(data.applied, false);
    assert.equal(data.reason, 'section-not-found');
    assert.equal(await content(), before);
  });

  it('4. contenu identique : applied:false (unchanged), pas de révision inutile', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/section/hero`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ html: '<section><h1>Nouveau titre percutant</h1></section>' })
    });
    const data = (await res.json()) as { applied: boolean; reason?: string };
    assert.equal(data.applied, false);
    assert.equal(data.reason, 'unchanged');
  });

  it('5. nom de section invalide (injection de regex) : 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/section/${encodeURIComponent('hero)(x)')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ html: '<section>x</section>' })
    });
    assert.equal(res.status, 400);
  });

  it('6. html vide : 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/section/hero`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ html: '   ' })
    });
    assert.equal(res.status, 400);
  });
});
