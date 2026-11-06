/**
 * Tests Lot 5 — Design Critic v1 (POST /api/v1/projects/:id/visual/analyze)
 *
 * Le rapport combine un rendu réel (si Chromium disponible — sinon dégradation
 * gracieuse documentée dans les findings) et une analyse DOM déterministe.
 * Le score est reproductible : mêmes preuves => même score (aucun Math.random).
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

interface CriticResponse {
  score: number;
  findings: { severity: string; source: string; title: string; detail: string }[];
  stats: { colors: number; fonts: number; interactiveElements: number };
  renderAvailable: boolean;
}

describe('Lot 5 : Design Critic v1 (/visual/analyze)', () => {
  let server: Server;
  let baseUrl: string;
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
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'Lot5 Visual Critic' })
    });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. refuse l\'analyse quand le projet n\'a plus d\'index.html (400)', async () => {
    // Un projet neuf est pré-seedé avec index.html : on le supprime d'abord.
    const del = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files?path=index.html`, {
      method: 'DELETE',
      headers: H
    });
    assert.ok(del.status === 200 || del.status === 404, 'La suppression doit aboutir (ou le fichier est déjà absent)');
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/visual/analyze`, {
      method: 'POST',
      headers: H
    });
    assert.equal(res.status, 400, 'Sans index.html, l\'analyse doit être refusée (400)');
    // Restaure le fichier pour les tests suivants
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path: 'index.html', content: '<!DOCTYPE html><html><body>reset</body></html>' })
    });
  });

  it('2. produit un rapport structuré avec score déterministe (200)', async () => {
    // Un HTML volontairement multi-polices pour déclencher un finding DESIGN
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        path: 'index.html',
        content: '<!DOCTYPE html><html><head><title>T</title></head><body style="font-family:A"><h1 style="font-family:B">X</h1><p style="font-family:C">y</p><span style="font-family:D">z</span><button>Cliquer</button></body></html>'
      })
    });
    assert.equal(put.status, 200);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/visual/analyze`, {
      method: 'POST',
      headers: H
    });
    assert.equal(res.status, 200, 'La route /visual/analyze doit être montée et fonctionnelle');
    const body = (await res.json()) as CriticResponse;

    assert.ok(typeof body.score === 'number' && body.score >= 0 && body.score <= 100, 'Score 0-100');
    assert.ok(Array.isArray(body.findings), 'findings obligatoire');
    assert.ok(body.renderAvailable === false || body.renderAvailable === true);

    // Déterminisme : deux appels identiques => même score (exigence CDC §16 V8)
    const res2 = await fetch(`${baseUrl}/api/v1/projects/${projectId}/visual/analyze`, {
      method: 'POST',
      headers: H
    });
    const body2 = (await res2.json()) as CriticResponse;
    assert.equal(body2.score, body.score, 'Le score doit être déterministe (reproductible)');
  });

  it('3b. beauté acte 2 : titre générique, image morte, lien mort et viewport manquant sont signalés', async () => {
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        path: 'index.html',
        content: '<!DOCTYPE html><html><head><title>VibeCode Studio</title></head><body><img alt="cassée"><a href="#">clique</a><button>Go</button></body></html>'
      })
    });
    assert.equal(put.status, 200);
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/visual/analyze`, {
      method: 'POST',
      headers: H
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as CriticResponse;
    const titles = body.findings.map((f) => f.title);
    assert.ok(titles.some((t) => t.includes('Titre générique')), 'titre générique détecté');
    assert.ok(titles.some((t) => t.includes('sans source')), 'image sans src détectée');
    assert.ok(titles.some((t) => t.includes('sans destination')), 'lien mort détecté');
    assert.ok(titles.some((t) => t.includes('Viewport')), 'viewport manquant détecté');
    assert.ok(body.score < 100, 'le 100 systématique recule face aux vrais défauts');
  });

  it('3. rendu réel indisponible => dégradation gracieuse documentée dans les findings', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/visual/analyze`, {
      method: 'POST',
      headers: H
    });
    const body = (await res.json()) as CriticResponse;
    if (!body.renderAvailable) {
      const finding = body.findings.find((f) => f.title.includes('Rendu réel indisponible'));
      assert.ok(finding, 'Un finding LOW doit expliquer l\'indisponibilité du rendu réel');
    }
  });
});
