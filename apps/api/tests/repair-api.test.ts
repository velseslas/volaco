/**
 * Tests ÉTAPE 7 — route Self-Repair bornée (POST /api/v1/projects/:id/repair)
 *
 * Sans clé LLM dans l'environnement de test, la route répond 503 (aucun
 * fournisseur IA) — le test vérifie le garde-fou et le 404 projet inconnu.
 * La boucle complète (diagnosis → patch → validate) est couverte en E2E live.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

describe('ÉTAPE 7 : route Self-Repair', () => {
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. refuse un projet inexistant (404)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/proj_inexistant/repair`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 2 })
    });
    assert.equal(res.status, 404);
  });

  it('2. HTML propre -> 200, aucune réparation nécessaire (diagnosis sans erreurs runtime)', async () => {
    // Crée un projet + un HTML propre via le compte local (fallback dev)
    const create = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'Étape 7 Repair' })
    });
    assert.equal(create.status, 201);
    const pid = ((await create.json()) as { project: { id: string } }).project.id;

    const put = await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path: 'index.html', content: '<!DOCTYPE html><html><head><title>OK</title></head><body><h1>Sain</h1></body></html>' })
    });
    assert.equal(put.status, 200);

    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/repair`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 2 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      repaired: boolean;
      initialScore: number;
      finalScore: number;
      iterations: { action: string }[];
    };
    // Aucune erreur runtime détectée au diagnostic -> aucune réparation lancée
    assert.equal(body.iterations[0]!.action, 'no-repair-needed');
    assert.equal(body.finalScore, body.initialScore);
    assert.equal(body.repaired, true);
  });
});
