/**
 * Tests Lot 3 — route Application DNA réelle (GET /api/v1/projects/:id/dna)
 *
 * Avant ce lot, le panneau DNA du Studio affichait un manifeste codé en dur ;
 * la DNA extraite par l'AINT-002 n'était exposée par aucune route.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

describe('Lot 3 : route /dna — Application DNA réelle', () => {
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
      body: JSON.stringify({ name: 'Lot3 DNA' })
    });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. renvoie 404 pour un projet inexistant', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/proj_inexistant/dna`, { headers: H });
    assert.equal(res.status, 404);
  });

  it('2. extrait une DNA réelle après sauvegarde d\'un fichier (200)', async () => {
    // Sauvegarde un fichier réel pour que l'extraction ait une matière
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        path: 'index.html',
        content: '<!DOCTYPE html><html><head><title>Demo</title></head><body><h1>Démo</h1><button>OK</button></body></html>'
      })
    });
    assert.equal(put.status, 200);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/dna`, { headers: H });
    assert.equal(res.status, 200, 'La route /dna doit être montée et extraire la DNA du projet');
    const body = (await res.json()) as { dna: Record<string, unknown> };
    assert.ok(body.dna, 'dna obligatoire');
    assert.ok(typeof body.dna === 'object');
  });
});
