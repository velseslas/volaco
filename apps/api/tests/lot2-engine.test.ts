/**
 * LOT 2 — Moteur : preuves API de bout en bout.
 *
 *  §25 — POST /api/v1/projects/:id/validate        → chaîne unique ordonnée
 *        (structure → parse réel → a11y WCAG → design → tests) + verdict ;
 *        route historique enrichie : { validation, report, requestId } ;
 *  §11 — POST /api/v1/projects/:id/conversation/sessions/:sid/back
 *        → retour arrière réel (rollbackLastTurn, jusqu'ici sans route) ;
 *  §31 — POST /api/v1/projects/:id/evolution/analyze
 *        → moteur AINT-017 branché sur sources réelles (NO EVIDENCE → NO CLAIM) ;
 *  §12 — GET  /api/v1/projects/:id/application-model
 *        → racine unifiée persistée (compréhension + DNA + révisions + mémoire).
 *
 * Le fetch global est remplacé par un double SSE (comme conversation-question
 * planfirst) : seuls les appels serveur → Mistral le traversent ; les requêtes
 * du test utilisent le fetch réel.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

process.env.MISTRAL_API_KEY = 'test-key-lot2';

const CLEAN_HTML =
  '<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>Lot 2</title></head>' +
  '<body style="background:#ffffff;color:#111827"><h1 style="color:#111827;background:#ffffff">Titre</h1>' +
  '<p style="color:#111827">Texte lisible sur fond clair.</p></body></html>';

describe('LOT 2 — Moteur : validation / back / évolution / application-model', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;
  const sseBody = 'data: {"choices":[{"delta":{"content":"Réponse courte."}}]}\n\n' + 'data: [DONE]\n\n';
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'lot2-t1', 'x-user-role': 'OWNER' };

  before(async () => {
    globalThis.fetch = (async () =>
      new Response(sseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch;
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  async function createProject(name: string): Promise<string> {
    const res = await realFetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name })
    });
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
    const body = (await res.json()) as { success?: boolean };
    assert.notEqual(body.success, false, 'écriture refusée : ' + JSON.stringify(body));
  }

  async function collectStream(projectId: string, sessionId: string, message: string): Promise<number> {
    const res = await realFetch(
      `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`,
      { method: 'POST', headers: { ...H, Accept: 'text/event-stream' }, body: JSON.stringify({ message }) }
    );
    if (res.status !== 200 || !res.body) return res.status;
    const reader = res.body.getReader();
    while (!(await reader.read()).done) {
      // consume — le tour est enregistré à la fin du flux
    }
    return res.status;
  }

  describe('§25 — validation en chaîne unique', () => {
    it('1. projet propre → chaîne ordonnée + verdict non-FAIL', async () => {
      const projectId = await createProject('lot2-valid');
      await putFile(projectId, 'index.html', CLEAN_HTML);
      await putFile(projectId, 'app/main.ts', 'export function sum(a: number, b: number): number { return a + b; }\n');

      const res = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/validate`, {
        method: 'POST',
        headers: H
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        validation?: unknown;
        report: {
          verdict: string;
          stages: { id: string; status: string }[];
          treeHash: string;
          fileCount: number;
          chainVersion: string;
        };
      };
      assert.ok(body.validation !== undefined, 'la clé historique `validation` reste présente');
      const report = body.report;
      assert.deepEqual(report.stages.map((s) => s.id), ['files', 'syntax', 'a11y', 'design', 'tests']);
      assert.ok(['PASS', 'PASS_WITH_WARNINGS'].includes(report.verdict), 'verdict=' + report.verdict);
      const syntax = report.stages.find((s) => s.id === 'syntax')!;
      assert.equal(syntax.status, 'PASS', 'le parse réel ne doit trouver aucune erreur');
      assert.equal(report.fileCount, 2);
      assert.match(report.treeHash, /^[0-9a-f]{64}$/);
    });

    it('2. erreur de syntaxe réelle (fichier TS cassé) → syntax FAIL + verdict FAIL', async () => {
      const projectId = await createProject('lot2-broken');
      await putFile(projectId, 'index.html', CLEAN_HTML);
      await putFile(projectId, 'app/broken.ts', 'export function broken( { return ; }\n');

      const res = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/validate`, {
        method: 'POST',
        headers: H
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { report: { verdict: string; stages: { id: string; status: string; evidence: string[] }[] } };
      assert.equal(body.report.verdict, 'FAIL');
      const syntax = body.report.stages.find((s) => s.id === 'syntax')!;
      assert.equal(syntax.status, 'FAIL');
      assert.match(syntax.evidence.join('\n'), /\[(TS\d+|AST_SYNTAX_FATAL)\]/);
    });

    it('3. entryFile imposé mais absent → 400 honnête', async () => {
      const projectId = await createProject('lot2-entry');
      await putFile(projectId, 'index.html', CLEAN_HTML);
      const res = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/validate`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ entryFile: 'absent.html' })
      });
      assert.equal(res.status, 400);
    });

    it('4. projet inconnu → 404', async () => {
      const res = await realFetch(`${baseUrl}/api/v1/projects/proj_inexistant_lot2/validate`, {
        method: 'POST',
        headers: H
      });
      assert.equal(res.status, 404);
    });
  });

  describe('§11 — retour arrière conversationnel', () => {
    it('5. sans tour → 400 honnête ; après un tour réel → retour arrière effectif', async () => {
      const projectId = await createProject('lot2-back');
      const sessionRes = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions`, {
        method: 'POST',
        headers: H,
        body: '{}'
      });
      assert.equal(sessionRes.status, 201);
      const sessionId = ((await sessionRes.json()) as { session: { sessionId: string } }).session.sessionId;

      // Aucun tour → refus honnête.
      const emptyBack = await realFetch(
        `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/back`,
        { method: 'POST', headers: H }
      );
      assert.equal(emptyBack.status, 400);

      // Un tour réel via le flux question.
      const streamStatus = await collectStream(projectId, sessionId, 'Explique-moi ce projet en une phrase.');
      assert.equal(streamStatus, 200);

      const back = await realFetch(
        `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/back`,
        { method: 'POST', headers: H }
      );
      assert.equal(back.status, 200);
      const body = (await back.json()) as { session: { turns: unknown[]; currentState: string } };
      assert.equal(body.session.turns.length, 0, 'le tour a réellement été annulé');
      assert.ok(typeof body.session.currentState === 'string');
    });
  });

  describe('§31 — moteur d évolution branché', () => {
    it('6. analyse réelle → rapport complet, propositions toutes adossées à de l évidence', async () => {
      const projectId = await createProject('lot2-evolution');
      await putFile(projectId, 'index.html', CLEAN_HTML);

      const res = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/evolution/analyze`, {
        method: 'POST',
        headers: H
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        report: {
          id: string;
          tenantId: string;
          proposals: { id: string; evidence: unknown[] }[];
          readinessStatus: string;
          applicationState: { stateHash: string };
          totalEvidenceEvaluated: number;
          reportHash: string;
        };
      };
      const report = body.report;
      assert.match(report.id, /^evr:[0-9a-f]{16}$/);
      assert.equal(report.tenantId, 'lot2-t1');
      assert.match(report.reportHash, /^[0-9a-f]{64}$/);
      assert.ok(report.applicationState.stateHash.length > 0);
      assert.ok(
        ['BLOCKED', 'UNKNOWN', 'READY', 'READY_WITH_RISK', 'NOT_READY'].includes(report.readinessStatus)
      );
      for (const proposal of report.proposals) {
        assert.ok(proposal.evidence.length > 0, `proposition ${proposal.id} sans évidence`);
      }
    });

    it('7. projet vide → NO EVIDENCE → NO CLAIM (aucune proposition fabriquée)', async () => {
      const projectId = await createProject('lot2-evolution-vide');
      const res = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/evolution/analyze`, {
        method: 'POST',
        headers: H
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { report: { proposals: unknown[]; totalEvidenceEvaluated: number } };
      assert.equal(body.report.totalEvidenceEvaluated, 0);
      assert.equal(body.report.proposals.length, 0);
    });
  });

  describe('§12 — Application Model persisté', () => {
    it('8. racine construite depuis les services réels + persistée (lecture stable)', async () => {
      const projectId = await createProject('lot2-model');
      await putFile(projectId, 'index.html', CLEAN_HTML);

      const first = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/application-model`, {
        method: 'GET',
        headers: H
      });
      assert.equal(first.status, 200);
      const body = (await first.json()) as {
        model: {
          modelId: string;
          modelHash: string;
          sourceCount: number;
          sources: { understanding?: unknown; dna?: unknown };
        };
      };
      const model = body.model;
      assert.match(model.modelId, /^am:[0-9a-f]{16}$/);
      assert.match(model.modelHash, /^[0-9a-f]{64}$/);
      assert.ok(model.sourceCount >= 1, 'au moins une source réelle');
      assert.ok(model.sources.understanding !== undefined || model.sources.dna !== undefined);

      const second = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/application-model`, {
        method: 'GET',
        headers: H
      });
      assert.equal(second.status, 200);
      const body2 = (await second.json()) as { model: { modelId: string } };
      assert.equal(body2.model.modelId, model.modelId, 'mêmes sources → même racine');
    });

    it('9. projet inconnu → 404', async () => {
      const res = await realFetch(`${baseUrl}/api/v1/projects/proj_inexistant_lot2/application-model`, {
        method: 'GET',
        headers: H
      });
      assert.equal(res.status, 404);
    });
  });
});
