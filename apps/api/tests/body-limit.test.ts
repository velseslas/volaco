/**
 * Tests de régression durcissement HTTP (audit 26/09/2026 — SEC-05)
 *
 * Avant correctif : chaque route lisait son corps via un accumulateur sans
 * limite (DoS par POST volumineux) et il n'existait aucun rate limiting.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

describe('Durcissement HTTP : limite de corps et rate limiting', () => {
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

  it('1. accepte un corps de taille normale (201, le chemin nominal fonctionne)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local' },
      body: JSON.stringify({ name: 'Projet test limite' })
    });
    assert.equal(res.status, 201);
  });

  it('2. refuse un corps > 1 Mo avec 413 PAYLOAD_TOO_LARGE (réponse délivrée, pas de connexion reset)', async () => {
    const bigBody = JSON.stringify({ name: 'x', content: 'A'.repeat(1_100_000) });
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local' },
      body: bigBody
    });
    assert.equal(res.status, 413, 'Le serveur doit répondre 413 (et non fermer brutalement la connexion)');
    const body = await res.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, 'PAYLOAD_TOO_LARGE');
  });

  it('3. applique un rate limiting (429 après ~600 requêtes API / minute)', async () => {
    // Bucket partagé par IP pour ce process : on martèle le dashboard jusqu'à
    // dépasser RATE_LIMIT_API_MAX (600/min) et on attend au moins un 429.
    let saw429 = false;
    for (let i = 0; i < 700; i++) {
      const res = await fetch(`${baseUrl}/api/v1/dashboard/summary`);
      if (res.status === 429) {
        saw429 = true;
        const body = await res.json() as { error?: { code?: string } };
        assert.equal(body.error?.code, 'RATE_LIMITED');
        assert.equal(res.headers.get('retry-after'), '60');
        break;
      }
      assert.ok(res.status === 200, `Statut inattendu ${res.status} à la requête ${i}`);
    }
    assert.ok(saw429, 'Le 429 doit finir par apparaître avant 700 requêtes');
  });
});
