/**
 * P0 V8.1 §23 — « Rattacher Design Memory aux Decisions ».
 *
 * La Design Memory n'est PAS un silo indépendant (interdit par §23) :
 *  1. une décision design enregistrée est référencée dans le Decision Ledger
 *     partagé — le MÊME que GET .../decisions (id mémoire = id ledger) ;
 *  2. l'Application Model expose les références réelles (compteurs + dernier
 *     id) dans sources.designMemory ;
 *  3. supersede → la décision quitte les décisions ACTIVES du ledger, sans
 *     être supprimée (historique auditable) ;
 *  4. aucune entrée étrangère (autre tenant/projet) n'est fusionnée.
 *
 * Le projet est un vrai projet HTML → DNA extractible → racine réelle.
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const tenant = 'tenant_dmem_v81';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

const CLEAN_HTML =
  '<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>Design Memory</title></head>' +
  '<body style="background:#ffffff;color:#111827"><h1 style="color:#111827;background:#ffffff">Titre</h1>' +
  '<p style="color:#111827">Texte lisible sur fond clair.</p></body></html>';

describe('P0 V8.1 §23 — Design Memory rattachée aux Decisions et à l Application Model', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const { createApiServer } = await import('../src/server.js');
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('décision design → ledger partagé + Application Model, supersede → historique conservé', async () => {
    // Projet réel avec un index.html (DNA extractible → Application Model possible).
    const pres = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'P0 design memory' })
    });
    const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: CLEAN_HTML })
    });

    // 1. Enregistrement de la décision design (§24).
    const memRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/design/memory`, {
      method: 'POST', headers,
      body: JSON.stringify({
        decision: 'Utiliser des tableaux compacts',
        reason: 'Application destinée à des utilisateurs professionnels exigeant la densité',
        approvedBy: 'test-v81'
      })
    });
    assert.equal(memRes.status, 200);
    const mem = await memRes.json() as { decision: { id: string }; created: boolean };
    assert.equal(mem.created, true);

    // 2. La décision est référencée dans le ledger PARTAGÉ (GET /decisions).
    const decRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/decisions`, { headers });
    assert.equal(decRes.status, 200);
    const decs = await decRes.json() as {
      decisions: Array<{ decisionId: string; intentCategory: string; status: string; tenantId: string; projectId: string; rationale: string }>;
    };
    const linked = decs.decisions.find((d) => d.decisionId === mem.decision.id);
    assert.ok(linked, 'la décision design est référencée par id dans le ledger');
    assert.equal(linked.intentCategory, 'DESIGN');
    assert.equal(linked.status, 'ACCEPTED');
    assert.equal(linked.tenantId, tenant);
    assert.equal(linked.projectId, pid);
    assert.match(linked.rationale, /professionnels/);

    // 3. L'Application Model expose la source designMemory (références réelles).
    const modelRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/application-model`, { headers });
    assert.equal(modelRes.status, 200);
    const model = (await modelRes.json()) as {
      model: { sources: { designMemory?: { totalCount: number; activeCount: number; latestDecisionId?: string } } };
    };
    const dm = model.model.sources.designMemory;
    assert.ok(dm, 'source designMemory présente dans le modèle racine');
    assert.equal(dm.totalCount, 1);
    assert.equal(dm.activeCount, 1);
    assert.equal(dm.latestDecisionId, mem.decision.id);

    // 4. Supersede (non destructif) → plus ACTIVE dans /decisions, historique conservé.
    const relRes = await fetch(
      `${baseUrl}/api/v1/projects/${pid}/design/memory/${encodeURIComponent(mem.decision.id)}?by=test-v81`,
      { method: 'DELETE', headers }
    );
    assert.equal(relRes.status, 200);
    const decs2 = await (await fetch(`${baseUrl}/api/v1/projects/${pid}/decisions`, { headers })).json() as {
      decisions: Array<{ decisionId: string }>;
    };
    assert.ok(
      !decs2.decisions.some((d) => d.decisionId === mem.decision.id),
      'décision superseded → absente des décisions actives'
    );

    // 5. La mémoire complète reste listée (total 1) mais plus aucune active.
    const memoryAfter = await (await fetch(`${baseUrl}/api/v1/projects/${pid}/design/memory`, { headers })).json() as {
      decisions: Array<{ id: string; status: string }>;
    };
    assert.equal(memoryAfter.decisions.length, 1);
    assert.equal(memoryAfter.decisions[0]!.status, 'SUPERSEDED');

    const model2 = (await (await fetch(`${baseUrl}/api/v1/projects/${pid}/application-model`, { headers })).json()) as {
      model: { sources: { designMemory?: { totalCount: number; activeCount: number } } };
    };
    assert.equal(model2.model.sources.designMemory!.totalCount, 1);
    assert.equal(model2.model.sources.designMemory!.activeCount, 0);
  });
});
