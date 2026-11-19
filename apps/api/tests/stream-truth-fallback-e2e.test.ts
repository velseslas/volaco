/**
 * É53 LOT B — CANAL FALLBACK + REFUS MÉTIER du Mutation Orchestrator, e2e.
 *
 * Fichier SÉPARÉ : le moteur est RECONFIGURÉ après la création du serveur
 * (`configureStreamMutationEngine`) — les tests node --test tournent dans des
 * processus distincts, aucune contamination des autres suites.
 *
 *   F1 — moteur NON injecté (indisponibilité TECHNIQUE) : repli direct TRACÉ
 *        (frame mutation_fallback), écriture vérifiée par lecture à rebours
 *        → done updated:true avec persistedVia 'fallback'.
 *   F2 — moteur REFUSANT la validation (refus MÉTIER/SÉCURITÉ) : AUCUN repli
 *        (jamais de fileStore.saveFile), frame mutation_refused, frame error
 *        « Persistance de index.html impossible », AUCUN done, fichier intact.
 */
import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { configureStreamMutationEngine } from '../src/routes/conversation.js';
import type { StreamMutationEngine } from '../src/routes/stream-mutation.js';
import type { MutationPlan, PlanValidationResult } from '../../../packages/core/src/ai-native/mutation-orchestrator/types.js';

process.env.MISTRAL_API_KEY = 'test-key-truth-fallback';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'truth-fb-t1', 'x-user-role': 'OWNER' };

function sse(...parts: string[]): string {
  return parts
    .map((p) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n')
    .join('') + 'data: [DONE]\n\n';
}

const SECTION_HERO = '<SECTION name="hero" mode="create"><h1>Studio du repli</h1><p>Canal fallback vérifié.</p></SECTION>';

/** Moteur double : la validation refuse (refus métier explicite). */
function refusingEngine(): StreamMutationEngine {
  const plan: MutationPlan = {
    schemaVersion: '1.0.0',
    planId: 'plan-fake-refused',
    tenantId: 'tenant',
    projectId: 'project',
    createdAt: new Date().toISOString(),
    baseGraphHash: '',
    mutations: [],
    expectedChanges: [],
    riskLevel: 'LOW',
    validationStatus: 'PENDING',
    planHash: 'hash'
  };
  return {
    createPlan() {
      return plan;
    },
    validatePlan(_plan: MutationPlan): PlanValidationResult {
      return {
        planId: plan.planId,
        valid: false,
        riskLevel: plan.riskLevel,
        blockers: ['politique de sécurité : écriture refusée (e2e)'],
        warnings: []
      };
    },
    executePlan() {
      throw new Error('ne doit jamais être appelé après un refus de validation');
    }
  };
}

describe('É53 LOT B — canal fallback + refus métier (e2e)', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;
  let streamScript = '';

  before(async () => {
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      let wantsStream = true;
      try { wantsStream = JSON.parse(String(init?.body ?? '{}')).stream === true; } catch { /* défaut : flux */ }
      if (wantsStream) return new Response(streamScript, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '{"summary":"Clôture","suggestions":["A","B","C"]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => { server.listen(0, () => { baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port; resolve(); }); });
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  async function createProject(name: string): Promise<string> {
    const p = await realFetch(baseUrl + '/api/v1/projects', { method: 'POST', headers: H, body: JSON.stringify({ name }) });
    const pj = (await p.json()) as { project: { id: string } };
    return pj.project.id;
  }

  async function stream(projectId: string, message: string): Promise<{ types: string[]; done: Record<string, unknown> | null; error: Record<string, unknown> | null }> {
    const s = await realFetch(baseUrl + '/api/v1/projects/' + projectId + '/conversation/sessions', { method: 'POST', headers: H, body: '{}' });
    const sj = (await s.json()) as { session: { sessionId: string } };
    const res = await realFetch(baseUrl + '/api/v1/projects/' + projectId + '/conversation/sessions/' + sj.session.sessionId + '/stream', {
      method: 'POST', headers: { ...H, Accept: 'text/event-stream' }, body: JSON.stringify({ message, isModification: false })
    });
    assert.equal(res.status, 200);
    const out = { types: [] as string[], done: null as Record<string, unknown> | null, error: null as Record<string, unknown> | null };
    const text = await res.text();
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim()) as Record<string, unknown> & { type: string };
        out.types.push(ev.type);
        if (ev.type === 'done') out.done = ev;
        if (ev.type === 'error') out.error = ev;
      } catch { /* ignore */ }
    }
    return out;
  }

  async function fileContent(projectId: string): Promise<string> {
    const f = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, { headers: H });
    const fd = (await f.json()) as { file?: { content?: string } };
    return fd.file?.content ?? '';
  }

  it('F1 — moteur non injecté : repli TRACÉ, écriture vérifiée, persistedVia "fallback"', async () => {
    // Override APRÈS la création du serveur : le moteur n'est plus injecté.
    configureStreamMutationEngine(undefined);
    try {
      streamScript = sse('Sans orchestrateur…\n\n', SECTION_HERO);
      const projectId = await createProject('F1 fallback');
      const out = await stream(projectId, 'Crée un site de test');

      assert.ok(out.types.includes('mutation_fallback'), 'le repli direct est TRACÉ (frame dédiée)');
      const done = out.done as Record<string, unknown> | null;
      assert.ok(done, 'frame done émise');
      assert.equal(done!['updated'], true, 'l\u2019écriture du repli est réellement persistée ET vérifiée');
      assert.equal(done!['persistedVia'], 'fallback', 'le canal est dit honnêtement');
      assert.ok(!('partial' in done!));
      assert.equal(typeof done!['revisionId'], 'string', 'révision réelle créée aussi sur le canal fallback');
      assert.deepEqual(done!['committedFiles'], [{ taskId: 'stream', files: ['index.html'] }]);

      const html = String(done!['html']);
      const persisted = await fileContent(projectId);
      assert.ok(persisted.includes('Studio du repli'), 'le contenu du repli est dans le fichier');
      assert.equal(html, persisted, 'done.html byte-identique au fichier relu');
    } finally {
      // Restauration défensive (le processus est isolé, mais on reste propre).
      configureStreamMutationEngine(undefined);
    }
  });

  it('F2 — moteur refusant la validation : AUCUN repli, mutation_refused + error, fichier intact', async () => {
    configureStreamMutationEngine(refusingEngine());
    try {
      streamScript = sse('Tentative…\n\n', SECTION_HERO);
      const projectId = await createProject('F2 refus');
      const out = await stream(projectId, 'Crée un site de test');

      assert.ok(out.types.includes('mutation_refused'), 'le refus métier est tracé (frame dédiée)');
      assert.ok(!out.types.includes('mutation_fallback'), 'AUCUN repli : un refus de validation n\u2019est jamais contourné');
      assert.ok(!out.done, 'AUCUNE frame done : le refus n\u2019est jamais un succès');
      assert.ok(out.error, 'frame error émise');
      assert.match(String(out.error!['error']), /Persistance de index\.html impossible/);
      assert.match(String(out.error!['error']), /politique de sécurité/, 'la raison réelle du refus transite');

      const persisted = await fileContent(projectId);
      assert.match(persisted, /Hello VibeCode/, 'le fichier reste intact : aucune écriture, même en repli');
    } finally {
      configureStreamMutationEngine(undefined);
    }
  });
});
