/**
 * Tests ÉTAPE 8 — Design Intelligence (GET /api/v1/projects/:id/design)
 *
 * Tokens inférés du DOM réel, harmonie + dérive (AINT-011), Design Direction
 * dérivée de façon DÉTERMINISTE (2 appels => même direction et même DQI).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

describe('ÉTAPE 8 : Design Intelligence (/design)', () => {
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
      body: JSON.stringify({ name: 'Étape 8 Design' })
    });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        path: 'index.html',
        content: '<!DOCTYPE html><html><head><title>Design</title><style>button{border-radius:12px;padding:16px}</style></head><body style="background:#070912;color:#f1f5f9;font-family:Inter"><h1>Titre</h1><button>Action</button><input type="text"/></body></html>'
      })
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. renvoie tokens inférés + harmonie + direction + DQI (200)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers: H });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      designDirection: Record<string, unknown>;
      tokens: Record<string, unknown>;
      harmony: { overallScore: number; subScores: Record<string, number> };
      dqi: number;
    };
    assert.ok(body.tokens, 'tokens inférés obligatoires');
    assert.ok(typeof body.harmony.overallScore === 'number' && body.harmony.overallScore >= 0, 'score d\'harmonie obligatoire');
    assert.ok(body.designDirection && typeof body.designDirection.style === 'string', 'Design Direction obligatoire');
    assert.ok(typeof body.dqi === 'number' && body.dqi >= 0 && body.dqi <= 100, 'DQI 0-100');
  });

  it('2. déterminisme : deux appels => même DQI et même direction', async () => {
    const a = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers: H })).json() as { dqi: number; designDirection: Record<string, unknown> };
    const b = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers: H })).json() as { dqi: number; designDirection: Record<string, unknown> };
    assert.equal(a.dqi, b.dqi, 'Le DQI doit être reproductible (aucun Math.random — CDC §16 V8)');
    assert.deepEqual(a.designDirection, b.designDirection, 'La direction doit être déterministe');
  });
});
