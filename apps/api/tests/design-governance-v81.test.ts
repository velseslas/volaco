/**
 * V8.1 §26 — « Design Governance : Who/What/Why/When/Previous/New/Impact ».
 *
 * Le registre unifié (M-2) agrège les sources RÉELLES sans en fabriquer :
 *  1. override de direction → who/approval = approbateur réel, what = dims
 *     fixées, previous/why/impact = null (upsert sans historique) ;
 *  2. décision mémoire → why = raison OBLIGATOIRE §24, status ACTIVE ;
 *  3. supersession → événement séparé previous=ACTIVE → new=SUPERSEDED
 *     avec supersededBy réel ;
 *  4. override composant §9/§10 → why = raison réelle, new = statut ;
 *  5. le ledger est DÉTERMINISTE (deux lectures → mêmes événements triés) ;
 *  6. agrégateur PUR (unitaire) : messages d'amélioration non parsables →
 *     previous/new/impact null (jamais de delta inventé), tri at DESC/id ASC.
 *
 * Le projet est un vrai projet HTML (aucune mesure AQS n'est nécessaire —
 * ces sources sont des stores, pas des rendus).
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildDesignGovernanceLedger } from '../../../packages/core/src/ai-native/design-harmony/design-governance.js';

const tenant = 'tenant_dgov_v81';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

const CLEAN_HTML =
  '<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>Design Governance</title></head>' +
  '<body style="background:#ffffff;color:#111827"><h1 style="color:#111827;background:#ffffff">Titre</h1>' +
  '<p style="color:#111827">Texte lisible sur fond clair.</p></body></html>';

describe('V8.1 §26 — Design Governance : ledger unifié des décisions de design', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;

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

    const pres = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'Design governance ledger' })
    });
    assert.equal(pres.status, 201, 'création du projet');
    const project = (await pres.json()) as { project?: { id?: string }; id?: string };
    projectId = String(project.project?.id ?? project.id);
    assert.ok(projectId, 'id projet');

    const pfres = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: CLEAN_HTML })
    });
    assert.ok(pfres.ok, 'index.html écrit');
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. sources réelles → événements Who/What/Why/When/Previous/New/Impact/Approval', async () => {
    // a) Override de direction §6 (approvedBy = approbateur réel).
    const putDir = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/direction`, {
      method: 'PUT', headers,
      body: JSON.stringify({ override: { style: 'Sharp & Technical', motion: 'None' }, approvedBy: 'test-approver' })
    });
    assert.equal(putDir.status, 200, 'override direction accepté');

    // b) Décision mémoire §24 (raison obligatoire).
    const postMem = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/memory`, {
      method: 'POST', headers,
      body: JSON.stringify({ decision: 'Garder une densité compacte', reason: 'Public métier expert, écrans denses.' })
    });
    assert.equal(postMem.status, 200, 'décision mémoire enregistrée');
    const mem = (await postMem.json()) as { decision: { id: string } };

    // c) Supersession non destructive de la décision.
    const delMem = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/design/memory/${encodeURIComponent(mem.decision.id)}?by=supersede-test`,
      { method: 'DELETE', headers }
    );
    assert.equal(delMem.status, 200, 'supersession acceptée');

    // d) Décision mémoire ACTIVE (2e décision, non superseded).
    const postMem2 = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/memory`, {
      method: 'POST', headers,
      body: JSON.stringify({ decision: 'Contrastes AA minimum', reason: 'Accessibilité exigée par la charte.' })
    });
    assert.equal(postMem2.status, 200);

    // e) Override composant §9/§10 (raison obligatoire pour DISABLED).
    const putComp = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/button`, {
      method: 'PUT', headers,
      body: JSON.stringify({
        status: 'DISABLED',
        reason: 'Remplacé par le composant action-v2 du design system.',
        approvedBy: 'test-approver'
      })
    });
    assert.equal(putComp.status, 200, 'override composant accepté');

    // f) Lecture du ledger unifié.
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/governance`, { headers });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ledger: {
        counts: Record<string, number>;
        sources: Record<string, boolean>;
        events: Array<{
          id: string; source: string; status: string; at: string; who: string;
          what: string; why: string | null; previous: string | null; new: string;
          impact: string | null; approval: string | null;
        }>;
      };
    };
    const ledger = body.ledger;

    // Sources réelles toutes couvertes.
    assert.deepEqual(ledger.sources, { direction: true, memory: true, revisions: true, components: true });

    // Direction : who/approval = approbateur réel, what = dimensions fixées,
    // previous/why/impact = null (upsert sans historique — jamais inventé).
    const dirEvent = ledger.events.find((event) => event.source === 'design-direction');
    assert.ok(dirEvent, 'événement direction présent');
    assert.equal(dirEvent.who, 'test-approver');
    assert.equal(dirEvent.approval, 'test-approver');
    assert.ok(dirEvent.what.includes('style=Sharp & Technical'));
    assert.ok(dirEvent.what.includes('motion=None'));
    assert.equal(dirEvent.previous, null);
    assert.equal(dirEvent.why, null);
    assert.equal(dirEvent.impact, null);

    // Mémoire ACTIVE : why = raison réelle, status ACTIVE, approval null.
    const activeEvents = ledger.events.filter(
      (event) => event.source === 'design-memory' && event.status === 'ACTIVE'
    );
    assert.equal(activeEvents.length, 1, 'une seule décision active');
    assert.equal(activeEvents[0]!.why, 'Accessibilité exigée par la charte.');

    // Supersession : previous=ACTIVE → new=SUPERSEDED, who = supersededBy réel.
    const superseded = ledger.events.find(
      (event) => event.source === 'design-memory' && event.status === 'SUPERSEDED'
    );
    assert.ok(superseded, 'événement supersession présent');
    assert.equal(superseded.previous, 'ACTIVE');
    assert.equal(superseded.new, 'SUPERSEDED');
    assert.equal(superseded.who, 'supersede-test');

    // Composant : why = raison réelle, new = statut réel.
    const compEvent = ledger.events.find((event) => event.source === 'design-component');
    assert.ok(compEvent, 'événement composant présent');
    assert.equal(compEvent.why, 'Remplacé par le composant action-v2 du design system.');
    assert.equal(compEvent.new, 'DISABLED');
    assert.equal(compEvent.what.includes('button'), true);

    // Compteurs cohérents.
    assert.equal(ledger.counts.directionOverride, 1);
    assert.equal(ledger.counts.memoryActive, 1);
    assert.equal(ledger.counts.memorySuperseded, 1);
    assert.equal(ledger.counts.component, 1);
    assert.equal(ledger.counts.total, ledger.events.length);

    // Tous les événements portent les 8 attributs §26 (nulls honnêtes).
    for (const event of ledger.events) {
      assert.ok(event.id.length > 0 && event.who.length > 0 && event.what.length > 0 && event.at.length > 0);
      assert.ok(typeof event.why === 'string' || event.why === null);
      assert.ok(typeof event.previous === 'string' || event.previous === null);
      assert.ok(typeof event.impact === 'string' || event.impact === null);
      assert.ok(typeof event.approval === 'string' || event.approval === null);
    }

    // DÉTERMINISME : deux lectures → mêmes événements (tri at DESC, id ASC).
    const res2 = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/governance`, { headers });
    const body2 = (await res2.json()) as typeof body;
    assert.deepEqual(body2.ledger.events, ledger.events);
    for (let i = 1; i < ledger.events.length; i++) {
      assert.ok(ledger.events[i - 1]!.at >= ledger.events[i]!.at, 'événements triés at DESC');
    }
  });

  it('2. agrégateur PUR : delta AQS réellement parsé, non parsable → null (jamais inventé)', () => {
    const fakeRevision = (
      id: string,
      message: string,
      createdAt: string
    ) => ({
      id,
      tenantId: 't-unit',
      projectId: 'p-unit',
      revisionNumber: 1,
      message,
      author: 'rev-author',
      createdAt: new Date(createdAt),
      files: {},
      decisions: [],
      provenance: { source: 'USER' as const }
    });

    const ledger = buildDesignGovernanceLedger({
      tenantId: 't-unit',
      projectId: 'p-unit',
      generatedAt: '2026-11-10T00:00:00.000Z',
      directionStore: { get: () => undefined },
      memoryStore: { list: () => [] },
      componentStore: { list: () => [] },
      revisionStore: {
        listRevisions: () => [
          fakeRevision('rev-1', 'Design Improve — AQS 72 → 84 (quality_target_reached)', '2026-11-09T10:00:00.000Z'),
          fakeRevision('rev-2', 'Design Improve — AQS ? → ? (unknown)', '2026-11-09T11:00:00.000Z'),
          fakeRevision('rev-3', 'Rollback vers la révision #1 (rev-1)', '2026-11-09T12:00:00.000Z')
        ]
      }
    });

    // Seules les améliorations (préfixe canonique) deviennent des événements.
    assert.equal(ledger.events.length, 2);
    const parsed = ledger.events.find((event) => event.id === 'gov:improvement:rev-1')!;
    assert.equal(parsed.previous, 'AQS 72');
    assert.equal(parsed.new, 'AQS 84');
    assert.equal(parsed.impact, 'delta AQS +12');
    assert.equal(parsed.who, 'rev-author');

    // Message non parsable → deltas null (honnêteté §26 — aucun chiffre inventé).
    const unparsed = ledger.events.find((event) => event.id === 'gov:improvement:rev-2')!;
    assert.equal(unparsed.previous, null);
    assert.equal(unparsed.new, null);
    assert.equal(unparsed.impact, null);

    // DÉTERMINISME : mêmes entrées → ledger strictement identique (hors generatedAt).
    const ledgerAgain = buildDesignGovernanceLedger({
      tenantId: 't-unit',
      projectId: 'p-unit',
      generatedAt: '2026-11-10T00:00:00.000Z',
      directionStore: { get: () => undefined },
      memoryStore: { list: () => [] },
      componentStore: { list: () => [] },
      revisionStore: {
        listRevisions: () => [
          fakeRevision('rev-1', 'Design Improve — AQS 72 → 84 (quality_target_reached)', '2026-11-09T10:00:00.000Z'),
          fakeRevision('rev-2', 'Design Improve — AQS ? → ? (unknown)', '2026-11-09T11:00:00.000Z'),
          fakeRevision('rev-3', 'Rollback vers la révision #1 (rev-1)', '2026-11-09T12:00:00.000Z')
        ]
      }
    });
    assert.deepEqual(ledgerAgain, ledger);
  });

  it('3. sans aucune donnée : ledger vide, AUCUN événement fabriqué (sources consultées sans erreur)', () => {
    const ledger = buildDesignGovernanceLedger({
      tenantId: 't-empty',
      projectId: 'p-empty',
      generatedAt: '2026-11-10T00:00:00.000Z',
      directionStore: { get: () => undefined },
      memoryStore: { list: () => [] },
      componentStore: { list: () => [] },
      revisionStore: { listRevisions: () => [] }
    });
    assert.equal(ledger.events.length, 0);
    assert.equal(ledger.counts.total, 0);
    assert.deepEqual(ledger.sources, { direction: true, memory: true, revisions: true, components: true });
  });
});
