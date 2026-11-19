/**
 * É53 LOT E2 — TEST 7 : POST /executions/:id/cancel OPÉRATIONNEL en
 * `VOLACO_EXECUTION_TIMELINE=off` (fichier séparé : le flag de télémétrie est
 * un `const` de module capturé au chargement de conversation.ts, l'env est
 * fixé par `_e53-e2-timeline-off-env.ts` AVANT l'import de server.js).
 *
 * Correction B — l'annulation est un CONTRÔLE d'exécution, pas de la
 * télémétrie :
 *   T7  — annulation PENDANT la génération : le POST cancel ne lève PAS de
 *         NotFoundError (comportement d'avant E2), le drapeau est posé, la
 *         consommation s'arrête, la frame ⏹ est émise, aucun done/diff, le
 *         fichier reste intact ; AUCUN record d'exécution (design : sans
 *         télémétrie, ni record ni timeline — l'arbitrage local porte le
 *         CAS B via la preuve `persistenceVerified`) ;
 *   T7b — annulation PENDANT la complétion post-écriture (clôture retardée) :
 *         CAS B local honnête — le POST est REFUSÉ
 *         (`persistence_already_validated`, preuve portée par le drapeau),
 *         la clôture suit normalement, fichier byte-identique au `done.html`.
 *
 * Provider Mistral mocké (harnais LOT B). Volontairement SANS record :
 * `executionStore.getExecution()` doit rester undefined pour ces ids.
 */
import './_e53-e2-timeline-off-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { executionStore, activeCancelFlags } from '../../../packages/core/src/ai-native/execution/store.js';
import { revisionStore } from '../../../packages/core/src/model/revision-store.js';
import { dataFilePath, readJsonFile } from '../../../packages/core/src/persistence/json-disk-cache.js';

process.env.MISTRAL_API_KEY = 'test-key-e53-e2-off';

const TENANT = 'e53-e2-off-t7';
const H = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT, 'x-user-role': 'OWNER' };

/** Corps SSE de deltas SANS le terminal [DONE] (le mock le retient à part). */
function sseBody(...parts: string[]): string {
  return parts
    .map((p) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n')
    .join('');
}
const DONE_CHUNK = 'data: [DONE]\n\n';

const SECTION_HERO = '<SECTION name="hero" mode="create"><h1>Boulangerie du Coin</h1><p>Pains au levain.</p></SECTION>';
const SECTION_MENU = '<SECTION name="menu" mode="create"><h2>Nos pains</h2><p>Baguette, campagne, seigle.</p></SECTION>';
const SECTION_CONTACT = '<SECTION name="contact" mode="create"><h2>Contact</h2><p>contact@exemple.fr</p></SECTION>';

/** Lecteur SSE incrémental — UN SEUL reader pour tout le test. */
function frameReader(res: Response): { next(): Promise<Record<string, unknown> | null> } {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const queue: Array<Record<string, unknown>> = [];
  let finished = false;
  async function pump(): Promise<void> {
    while (queue.length === 0 && !finished) {
      const { done, value } = await reader.read();
      if (done) { finished = true; break; }
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          try { queue.push(JSON.parse(t.slice(5).trim()) as Record<string, unknown>); } catch { /* ignore */ }
        }
      }
    }
  }
  return {
    async next(): Promise<Record<string, unknown> | null> {
      await pump();
      return queue.shift() ?? null;
    }
  };
}

/** Doc persisté des exécutions — doit rester SANS record en télémétrie OFF. */
function readExecutionsDoc(): Record<string, Record<string, unknown>> {
  return readJsonFile<Record<string, Record<string, unknown>>>(dataFilePath('executions'), {});
}

describe('É53 LOT E2 T7 — POST cancel opérationnel en VOLACO_EXECUTION_TIMELINE=off', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;
  let streamScript = '';
  let streamChunkDelayMs = 0;
  let holdStream: Promise<void> = Promise.resolve();
  let releaseStream: () => void = () => {};
  let closingDelayMs = 0;

  before(async () => {
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      let wantsStream = true;
      try { wantsStream = JSON.parse(String(init?.body ?? '{}')).stream === true; } catch { /* défaut : flux */ }
      if (wantsStream) {
        const events = streamScript.split('\n\n').filter(Boolean).map((e) => e + '\n\n');
        const encoder = new TextEncoder();
        const rs = new ReadableStream({
          async start(controller) {
            try {
              for (const ev of events) {
                controller.enqueue(encoder.encode(ev));
                if (streamChunkDelayMs > 0) await new Promise((r) => setTimeout(r, streamChunkDelayMs));
              }
              await holdStream;
              controller.enqueue(encoder.encode(DONE_CHUNK));
              controller.close();
            } catch {
              // La route a rompu le for-await (annulation) — but atteint.
            }
          }
        });
        return new Response(rs, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (closingDelayMs > 0) await new Promise((r) => setTimeout(r, closingDelayMs));
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
    releaseStream();
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  async function createProject(name: string): Promise<string> {
    const p = await realFetch(baseUrl + '/api/v1/projects', { method: 'POST', headers: H, body: JSON.stringify({ name }) });
    const pj = (await p.json()) as { project: { id: string } };
    return pj.project.id;
  }

  async function fileContent(projectId: string): Promise<string> {
    const f = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, { headers: H });
    const fd = (await f.json()) as { file?: { content?: string } };
    return fd.file?.content ?? '';
  }

  async function openStream(projectId: string, message: string, body: Record<string, unknown> = {}): Promise<Response> {
    const s = await realFetch(baseUrl + '/api/v1/projects/' + projectId + '/conversation/sessions', { method: 'POST', headers: H, body: '{}' });
    const sj = (await s.json()) as { session: { sessionId: string } };
    return realFetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sj.session.sessionId}/stream`, {
      method: 'POST', headers: { ...H, Accept: 'text/event-stream' },
      body: JSON.stringify({ message, ...body })
    });
  }

  async function cancelExecution(projectId: string, executionId: string): Promise<{ status: number; json: Record<string, unknown> }> {
    const r = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/executions/${executionId}/cancel`, { method: 'POST', headers: H });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  }

  it('T7 — annulation PENDANT la génération : POST cancel 200 (jamais 404), drapeau posé, consommation stoppée, fichier intact, AUCUN record', async () => {
    streamScript = sseBody('Voici votre boulangerie !\n\n', SECTION_HERO + '\n\n', SECTION_MENU + '\n\n', SECTION_CONTACT + '\n\n');
    streamChunkDelayMs = 120;
    holdStream = new Promise<void>((r) => { releaseStream = r; });
    closingDelayMs = 0;
    const projectId = await createProject('E2 T7 annulation timeline off');
    const htmlBefore = await fileContent(projectId);

    const res = await openStream(projectId, 'Crée un site de boulangerie', { isModification: false });
    assert.equal(res.status, 200);
    const reader = frameReader(res);
    const frames: Array<Record<string, unknown>> = [];
    let executionId = '';
    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
      if (!executionId && typeof f.executionId === 'string') executionId = f.executionId;
      if (f.type === 'section_end') break; // la section hero vient d'être posée
    }
    // CORRECTION B — frame start avec executionId explicite : sans télémétrie,
    // les frames nues ne sont pas enrichies par le recorder ; sans cet id le
    // client ne pourrait JAMAIS savoir quoi annuler.
    assert.ok(executionId, 'frame start porte executionId explicite (timeline off)');

    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel.status, 200, 'POST cancel = 200 — JAMAIS NotFoundError (couplage historique corrigé)');
    assert.equal(cancel.json['cancelled'], true, 'drapeau posé sans record (contrôle ≠ télémétrie)');

    releaseStream();
    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
    }
    const types = frames.map((f) => f.type);
    assert.ok(types.includes('cancelled'), 'frame cancelled émise');
    assert.ok(!types.includes('done'), 'AUCUN done après annulation gagnante');
    assert.ok(!types.includes('diff'), 'aucun diff : assemblage/mutation/persistance jamais atteints');
    assert.ok(!types.includes('closing'), 'aucune clôture');
    assert.ok(!types.includes('error'), 'une annulation n\u2019est pas une erreur');

    // Fichier intact + AUCUN record (design timeline off) + drapeau retiré.
    assert.equal(await fileContent(projectId), htmlBefore, 'fichier inchangé — aucune écriture');
    assert.ok(executionStore.getExecution(executionId) === null, 'aucun record en mémoire (télémétrie off)');
    assert.equal(readExecutionsDoc()[executionId], undefined, 'aucun record persisté sur disque (télémétrie off)');
    assert.ok(!activeCancelFlags.has(executionId), 'drapeau retiré à la fin du tour (cleanup inconditionnel)');
  });

  it('T7b — annulation PENDANT la complétion post-écriture : CAS B local honnête (refus, clôture suit, fichier conservé)', async () => {
    streamScript = sseBody('Voici votre boulangerie !\n\n', SECTION_HERO + '\n\n') + DONE_CHUNK;
    streamChunkDelayMs = 0;
    holdStream = Promise.resolve();
    releaseStream = () => {};
    closingDelayMs = 400; // fenêtre déterministe APRÈS le done (clôture en attente)
    const projectId = await createProject('E2 T7b CAS B local timeline off');
    const revisionsBefore = revisionStore.listRevisions(TENANT, projectId).length;

    const res = await openStream(projectId, 'Crée un site de boulangerie', { isModification: false });
    const reader = frameReader(res);
    const frames: Array<Record<string, unknown>> = [];
    let executionId = '';
    let done: Record<string, unknown> | null = null;
    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
      if (!executionId && typeof f.executionId === 'string') executionId = f.executionId;
      if (f.type === 'done') { done = f; break; }
    }
    assert.ok(done, 'frame done reçue');
    assert.equal(done!['updated'], true, 'écriture réellement persistée et vérifiée (lecture à rebours)');
    assert.ok(executionId, 'executionId reçu');

    // Annulation pendant la complétion : la preuve locale `persistenceVerified`
    // (posée sur le drapeau par la vérification post-écriture) refuse
    // honnêtement — la sémantique CAS B est IDENTIQUE sans record.
    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.json['cancelled'], false, 'annulation refusée : mutation déjà validée (preuve locale)');
    assert.equal(cancel.json['reason'], 'persistence_already_validated', 'arbitrage CAS B honnête sans record');

    // La clôture suit NORMALEMENT (aucune interruption artificielle).
    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
    }
    const types = frames.map((f) => f.type);
    assert.ok(types.includes('closing'), 'clôture émise normalement — mutation validée honorée');
    assert.ok(!types.includes('cancelled'), 'AUCUNE frame cancelled après refus');
    assert.ok(!types.includes('error'), 'aucune erreur technique induite');

    // Fichier byte-identique au done.html ; révision créée (film projet ≠
    // télémétrie) ; TOUJOURS aucun record (design timeline off).
    assert.equal(String(done!['html']), await fileContent(projectId), 'done.html byte-identique au fichier persisté');
    assert.ok(revisionStore.listRevisions(TENANT, projectId).length > revisionsBefore, 'révision créée');
    assert.ok(executionStore.getExecution(executionId) === null, 'aucun record (télémétrie off)');
    assert.equal(readExecutionsDoc()[executionId], undefined, 'aucun record persisté (télémétrie off)');

    // Après le tour (drapeau retiré, aucun record) : l'exécution n'existe plus
    // pour le cancel — NotFoundError honnête (limite documentée du mode off :
    // la sécurité repose sur l'imprévisibilité du requestId + l'autorisation
    // du projet dans l'URL).
    const late = await cancelExecution(projectId, executionId);
    assert.equal(late.status, 404, 'POST cancel tardif : 404 sans record ni drapeau (design)');
  });
});
