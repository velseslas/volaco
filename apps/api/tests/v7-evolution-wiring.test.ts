/**
 * V7-WIRE-4 — Panneau Évolution (AINT-017) branché sur le flux réel.
 *
 * Le panneau Studio appelait directement `/features/analyze` (AINT-014) et
 * n'utilisait jamais le moteur AINT-017. Il consomme désormais
 * `POST /projects/:id/evolution/analyze` et rend le rapport réel :
 * readiness, santé produit, propositions adossées à des preuves.
 *
 * Preuves :
 *  - l'API renvoie un rapport complet sur des sources réelles ;
 *  - toutes les propositions portent au moins une évidence ;
 *  - un projet sans preuve ne fabrique aucune proposition ;
 *  - le Studio n'appelle plus `/features/analyze` et rend les champs AINT-017.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

process.env.MISTRAL_API_KEY = 'test-key-v7-evolution';

// `eval()` et `document.write()` déclenchent des constats d'audit réels
// (AINT-013) → évidences FACT → proposition AINT-017.
const RISKY_HTML =
  '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>V7 WIRE-4</title></head>' +
  '<body><h1>Évolution</h1><script>eval("2+2"); document.write("x");</script></body></html>';

describe('V7-WIRE-4 — Évolution AINT-017 dans le Studio', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;
  const sseBody =
    'data: {"choices":[{"delta":{"content":"Réponse courte."}}]}\n\n' + 'data: [DONE]\n\n';
  const H = {
    'Content-Type': 'application/json',
    'x-tenant-id': 'v7-evolution-t1',
    'x-user-role': 'OWNER'
  };

  before(async () => {
    globalThis.fetch = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })) as typeof fetch;
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolveListen) => {
      server.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolveListen();
      });
    });
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
  });

  async function createProject(name: string): Promise<string> {
    const res = await realFetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name })
    });
    assert.ok([200, 201].includes(res.status));
    const body = (await res.json()) as { project: { id: string } };
    return body.project.id;
  }

  async function putFile(projectId: string, path: string, content: string): Promise<void> {
    const res = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path, content })
    });
    assert.equal(res.status, 200);
  }

  it('1. sources réelles → rapport complet, propositions toutes adossées à des preuves', async () => {
    const projectId = await createProject('v7-evolution-risky');
    await putFile(projectId, 'index.html', RISKY_HTML);

    const res = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/evolution/analyze`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ forceRecompute: true })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      report: {
        id: string;
        readinessStatus: string;
        totalEvidenceEvaluated: number;
        healthScore: { overall: number };
        proposals: {
          id: string;
          priorityScore: number;
          urgency: string;
          evidence: unknown[];
        }[];
      };
    };
    const report = body.report;

    assert.match(report.id, /^evr:[0-9a-f]{16}$/);
    assert.ok(
      ['BLOCKED', 'UNKNOWN', 'READY', 'READY_WITH_RISK', 'NOT_READY'].includes(report.readinessStatus)
    );
    assert.ok(report.healthScore.overall >= 0 && report.healthScore.overall <= 100);
    assert.ok(report.totalEvidenceEvaluated >= 1, 'au moins une preuve issue de l audit réel');
    assert.ok(report.proposals.length >= 1, 'les constats réels produisent une proposition');

    for (const proposal of report.proposals) {
      assert.ok(proposal.evidence.length > 0, `proposition ${proposal.id} sans évidence`);
      assert.ok(proposal.priorityScore >= 0 && proposal.priorityScore <= 100);
      assert.ok(proposal.urgency.length > 0);
    }
  });

  it('2. projet vide → NO EVIDENCE → NO CLAIM (aucune proposition fabriquée)', async () => {
    const projectId = await createProject('v7-evolution-vide');
    const res = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/evolution/analyze`, {
      method: 'POST',
      headers: H
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      report: { totalEvidenceEvaluated: number; proposals: unknown[] };
    };
    assert.equal(body.report.totalEvidenceEvaluated, 0);
    assert.equal(body.report.proposals.length, 0);
  });

  it('3. le Studio appelle /evolution/analyze et rend les champs AINT-017', () => {
    const studio = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.ok(studio.includes('/evolution/analyze'), 'endpoint AINT-017 appelé');
    assert.ok(studio.includes('forceRecompute: true'), 'Actualiser force le recalcul');
    assert.ok(studio.includes('lastEvolutionReport'), 'le rapport serveur est la source');
    assert.ok(studio.includes('lastEvolutionReport.proposals'), 'les propositions réelles sont rendues');
    assert.ok(studio.includes('readinessStatus'), 'le readiness est affiché');
    assert.ok(studio.includes('healthScore'), 'la santé produit est affichée');
    assert.ok(studio.includes('aint-017-evolution-report.json'), 'l’export restitue le rapport AINT-017');
    assert.ok(studio.includes('AINT-017 Engine'), 'le badge nomme le moteur réel');
    assert.ok(!studio.includes('/features/analyze'), 'le panneau ne doit plus appeler AINT-014 directement');
    assert.ok(!studio.includes('runFeaturesDiscovery'), 'l’ancien handler est supprimé');
  });
});
