/**
 * CDC §16 — CONFIRMATION INTERACTIVE DES HYPOTHÈSES (audit moteurs, 04/11).
 *
 * 1. POST verdicts (CONFIRMED + REJECTED) → activeAssumptions à jour et le
 *    libellé CONFIRMED rejoint la mémoire projet (knownConventions).
 * 2. Dédoublonnage : re-confirmer la même hypothèse ne duplique pas la
 *    convention.
 * 3. Validation honnête : verdict invalide → 400 ; batch vide → 400.
 * 4. GET → lecture des statuts opérateur de la session.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

process.env.MISTRAL_API_KEY = 'test-key-conv-audit';

describe('CONV §16 : verdicts d\u2019hypothèses (confirmation interactive)', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'conv-assump-t1', 'x-user-role': 'OWNER' };
  let projectId = '';
  let sessionId = '';

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
    const p = await realFetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: 'conv-assump' })
    });
    const pj = (await p.json()) as { project: { id: string } };
    projectId = pj.project.id;
    const s = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions`, {
      method: 'POST', headers: H, body: '{}'
    });
    const sj = (await s.json()) as { session: { sessionId: string } };
    sessionId = sj.session.sessionId;
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  async function postVerdicts(body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
    const res = await realFetch(
      `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/assumptions`,
      { method: 'POST', headers: H, body: JSON.stringify(body) }
    );
    const data = (await res.json()) as Record<string, unknown>;
    return { status: res.status, data };
  }

  it('confirme et rejette des hypothèses ; la convention ne rejoint que le CONFIRMED', async () => {
    const { status, data } = await postVerdicts({
      verdicts: [
        {
          id: 'assump_test_theme',
          statement: 'Le thème visuel privilégié est sombre et arrondi',
          verdict: 'CONFIRMED',
          confidence: 0.9,
          risk: 'LOW',
          reversible: true
        },
        {
          id: 'assump_test_domaine',
          statement: 'Le domaine cible est la restauration',
          verdict: 'REJECTED',
          confidence: 0.7,
          risk: 'MEDIUM'
        }
      ]
    });
    assert.equal(status, 200);
    const active = (data.activeAssumptions ?? []) as Array<{ id: string; status: string }>;
    const conventions = (data.knownConventions ?? []) as string[];
    const theme = active.find((a) => a.id === 'assump_test_theme');
    const domaine = active.find((a) => a.id === 'assump_test_domaine');
    assert.ok(theme, 'hypothèse confirmée traçée dans la session');
    assert.ok(domaine, 'hypothèse rejetée traçée dans la session');
    assert.equal(theme.status, 'CONFIRMED');
    assert.equal(domaine.status, 'REJECTED');
    assert.ok(
      conventions.some((c) => c.toLowerCase() === 'le thème visuel privilégié est sombre et arrondi'),
      'le libellé CONFIRMED rejoint la mémoire projet'
    );
    assert.ok(
      !conventions.some((c) => c.toLowerCase().includes('restauration')),
      'le REJECTED ne rejoint PAS la mémoire projet'
    );
  });

  it('déduplique la convention (re-confirmer ne duplique pas)', async () => {
    const { status, data } = await postVerdicts({
      verdicts: [{ id: 'assump_test_theme', statement: 'Le thème visuel privilégié est sombre et arrondi', verdict: 'CONFIRMED' }]
    });
    assert.equal(status, 200);
    const conventions = (data.knownConventions ?? []) as string[];
    const matches = conventions.filter((c) => c.toLowerCase() === 'le thème visuel privilégié est sombre et arrondi');
    assert.equal(matches.length, 1, 'une seule occurrence de la convention');
  });

  it('rejette honnêtement un verdict invalide (400)', async () => {
    const missing = await postVerdicts({ verdicts: [{ id: 'x', statement: 'y' }] });
    assert.equal(missing.status, 400);
    const empty = await postVerdicts({ verdicts: [] });
    assert.equal(empty.status, 400);
  });

  it('expose les verdicts en lecture (GET)', async () => {
    const res = await realFetch(
      `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/assumptions`,
      { headers: H }
    );
    assert.equal(res.status, 200);
    const data = (await res.json()) as { activeAssumptions: Array<{ id: string; status: string }> };
    const ids = data.activeAssumptions.map((a) => a.id);
    assert.ok(ids.includes('assump_test_theme'), 'verdict persisté sur la session');
  });
});
