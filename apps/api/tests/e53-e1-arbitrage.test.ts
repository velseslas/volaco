/**
 * É53 LOT E1 — ARBITRAGE ATOMIQUE : annulation / persistance / terminaison.
 *
 * Un tour a UNE SEULE issue gagnante. Le point de linéarisation est le
 * ExecutionEventStore (opérations synchrones de l'event loop) :
 *   - `claimPersistenceWin` est posée par la route dans le MÊME tick
 *     synchrone que l'écriture effective (octets sur disque) ;
 *   - `cancelExecution` consomme la demande du POST /executions/:id/cancel.
 * Le premier fait gagne la course, l'autre est refusé honnêtement.
 *
 * Chaque test contrôle l'ÉTAT PERSISTÉ (record relu depuis le document
 * `executions.json` via le même backend que le store), pas seulement la
 * valeur de retour des fonctions.
 *
 * E2E (serveur en-process, provider Mistral mocké — harnais LOT B) :
 *   CAS A — annulation PENDANT la génération LLM (flux retenu ouvert par le
 *           test) → frame cancelled, AUCUN done, fichier et révisions
 *           intacts, record CANCELLED persisté ;
 *   CAS B — annulation APRÈS le done (persistance déjà validée) → le POST
 *           cancel est refusé honnêtement (`persistence_already_validated`),
 *           record COMPLETED, révision présente, fichier = contenu généré.
 */
import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { executionStore } from '../../../packages/core/src/ai-native/execution/store.js';
import { dataFilePath, readJsonFile } from '../../../packages/core/src/persistence/json-disk-cache.js';
import { revisionStore } from '../../../packages/core/src/model/revision-store.js';

process.env.MISTRAL_API_KEY = 'test-key-e53-e1';

const TENANT = 'e53-e1-t1';
const H = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT, 'x-user-role': 'OWNER' };

function newId(tag: string): string {
  return `e53e1-${tag}-${randomUUID().slice(0, 8)}`;
}

/** Ouvre un record RUNNING (état initial d'un tour de génération). */
function startRecord(id: string): void {
  executionStore.startExecution({ executionId: id, tenantId: TENANT, projectId: 'proj-e53e1', mode: 'create', prompt: 'test E1' });
  executionStore.appendEvent(id, { type: 'EXECUTION_STARTED', phase: 'UNDERSTAND', status: 'RUNNING', title: 'Démarrage' });
}

/** L'état PERSISTÉ (document disque), pas la Map en mémoire seule. */
function persistedRecord(id: string): Record<string, unknown> | undefined {
  const doc = readJsonFile<Record<string, Record<string, unknown>>>(dataFilePath('executions'), {});
  return doc[id];
}

// ————————————————————————————————————————————————————————————
// UNITAIRES — le store est l'arbitre (preuves sur le disque)
// ————————————————————————————————————————————————————————————

describe('É53 LOT E1 — arbitrage atomique du store (point de linéarisation)', () => {
  it('CAS A — annulation gagnée AVANT la validation de persistance : claim refusée, record CANCELLED persisté', () => {
    const id = newId('cas-a');
    startRecord(id);
    assert.equal(executionStore.cancelExecution(id, 'user_cancel'), true, "l'annulation gagne la course");
    assert.equal(executionStore.claimPersistenceWin(id), false, 'la persistance ne peut plus prétendre avoir gagné');
    assert.equal(executionStore.hasPersistenceWon(id), false);
    const rec = executionStore.getExecution(id)!;
    assert.equal(rec.status, 'CANCELLED');
    assert.equal(rec.cancelReason, 'user_cancel');
    const disk = persistedRecord(id) as Record<string, unknown> | undefined;
    assert.ok(disk, 'record présent dans le document persisté');
    assert.equal(disk!['status'], 'CANCELLED', 'statut CANCELLED PERSISTÉ sur disque');
    assert.equal(disk!['persistenceWon'], undefined, 'aucune claim de persistance persistée');
  });

  it('CAS B — persistance gagnée AVANT la demande d\u2019annulation : annulation refusée, COMPLETED persisté', () => {
    const id = newId('cas-b');
    startRecord(id);
    assert.equal(executionStore.claimPersistenceWin(id), true, "l'écriture effective a gagné la course");
    assert.equal(executionStore.cancelExecution(id, 'user_cancel'), false, 'annulation trop tard : refusée honnêtement');
    assert.equal(executionStore.hasPersistenceWon(id), true);
    // La clôture honnête suit : COMPLETED avec le bilan réel de l'écriture.
    assert.equal(executionStore.completeExecution(id, { htmlChars: 1234 }), true);
    const rec = executionStore.getExecution(id)!;
    assert.equal(rec.status, 'COMPLETED');
    assert.equal(rec.persistenceWon, true);
    assert.equal(rec.summary?.htmlChars, 1234);
    const disk = persistedRecord(id) as Record<string, unknown> | undefined;
    assert.equal(disk!['status'], 'COMPLETED', 'statut COMPLETED PERSISTÉ sur disque');
    assert.equal(disk!['persistenceWon'], true, 'claim de persistance PERSISTÉE sur disque');
  });

  it('course simultanée, ordre 1 — cancel puis complete dans le même tick : CANCELLED stable', () => {
    const id = newId('race-cancel-first');
    startRecord(id);
    executionStore.cancelExecution(id, 'user_cancel');
    executionStore.completeExecution(id, { htmlChars: 99 });
    const rec = executionStore.getExecution(id)!;
    assert.equal(rec.status, 'CANCELLED', 'la terminaison tardive ne remplace pas l\u2019annulation');
    assert.ok(!rec.summary?.htmlChars, 'aucun bilan de succès sur un tour annulé');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_COMPLETED').length, 0, 'aucun événement EXECUTION_COMPLETED après CANCELLED');
  });

  it('course simultanée, ordre 2 — complete puis cancel dans le même tick : COMPLETED stable', () => {
    const id = newId('race-complete-first');
    startRecord(id);
    executionStore.completeExecution(id, {});
    assert.equal(executionStore.cancelExecution(id, 'user_cancel'), false, 'l\u2019annulation ne peut pas écraser le succès');
    assert.equal(executionStore.getExecution(id)!.status, 'COMPLETED');
  });

  it('completeExecution() après CANCELLED : refusé, statut et motif intacts', () => {
    const id = newId('complete-after-cancel');
    startRecord(id);
    executionStore.cancelExecution(id, 'user_cancel');
    assert.equal(executionStore.completeExecution(id, { htmlChars: 55 }), false);
    const rec = executionStore.getExecution(id)!;
    assert.equal(rec.status, 'CANCELLED');
    assert.equal(rec.cancelReason, 'user_cancel');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_COMPLETED').length, 0);
  });

  it('failExecution() après CANCELLED : refusé, statut CANCELLED préservé', () => {
    const id = newId('fail-after-cancel');
    startRecord(id);
    executionStore.cancelExecution(id, 'user_cancel');
    assert.equal(executionStore.failExecution(id, 'erreur tardive'), false);
    const rec = executionStore.getExecution(id)!;
    assert.equal(rec.status, 'CANCELLED', 'une annulation ne devient jamais un échec');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_FAILED').length, 0);
  });

  it('double demande d\u2019annulation : une seule transition, un seul événement, premier motif conservé', () => {
    const id = newId('double-cancel');
    startRecord(id);
    assert.equal(executionStore.cancelExecution(id, 'user_cancel'), true);
    assert.equal(executionStore.cancelExecution(id, 'second_click'), false);
    const rec = executionStore.getExecution(id)!;
    assert.equal(rec.status, 'CANCELLED');
    assert.equal(rec.cancelReason, 'user_cancel', 'le motif du premier gagnant est conservé');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_CANCELLED').length, 1, 'un seul événement d\u2019annulation persisté');
  });

  it('double failExecution : motif enrichi, un seul événement EXECUTION_FAILED', () => {
    const id = newId('double-fail');
    startRecord(id);
    assert.equal(executionStore.failExecution(id, 'première erreur'), true);
    assert.equal(executionStore.failExecution(id, 'erreur complémentaire'), true);
    const rec = executionStore.getExecution(id)!;
    assert.equal(rec.status, 'FAILED');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_FAILED').length, 1);
    assert.equal(rec.summary?.error, 'erreur complémentaire', 'motif enrichi sans nouvelle transition');
  });

  it('completeExecution deux fois : summary enrichi, un seul événement EXECUTION_COMPLETED', () => {
    const id = newId('double-complete');
    startRecord(id);
    assert.equal(executionStore.completeExecution(id, { htmlChars: 10 }), true);
    assert.equal(executionStore.completeExecution(id, { score: 92 }), true);
    const rec = executionStore.getExecution(id)!;
    assert.equal(rec.status, 'COMPLETED');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_COMPLETED').length, 1);
    assert.equal(rec.summary?.htmlChars, 10);
    assert.equal(rec.summary?.score, 92);
  });
});

// ————————————————————————————————————————————————————————————
// E2E — serveur en-process, provider Mistral mocké (harnais LOT B)
// ————————————————————————————————————————————————————————————

/** Corps SSE de deltas SANS le terminal [DONE] (le mock le retient à part). */
function sseBody(...parts: string[]): string {
  return parts
    .map((p) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n')
    .join('');
}
const DONE_CHUNK = 'data: [DONE]\n\n';

const SECTION_HERO = '<SECTION name="hero" mode="create"><h1>Boulangerie du Coin</h1><p>Pains au levain.</p></SECTION>';

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

describe('É53 LOT E1 — arbitrage de bout en bout (provider mocké)', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;
  let streamScript = '';
  let holdStream: Promise<void> = Promise.resolve();
  let releaseStream: () => void = () => {};
  let closingDelayMs = 0;

  before(async () => {
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      let wantsStream = true;
      try { wantsStream = JSON.parse(String(init?.body ?? '{}')).stream === true; } catch { /* défaut : flux */ }
      if (wantsStream) {
        // Flux LLM retenu : tout le script part, puis le stream reste OUVERT
        // jusqu'à ce que le test libère la porte — la route est alors garée
        // dans le for-await (fenêtre de course CAS A déterministe).
        const body = streamScript;
        const encoder = new TextEncoder();
        const rs = new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode(body));
            await holdStream;
            controller.enqueue(encoder.encode(DONE_CHUNK));
            controller.close();
          }
        });
        return new Response(rs, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      // Clôture LLM (generate non-stream) — retardable pour laisser au test
      // une fenêtre déterministe APRÈS le done (CAS B).
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

  async function cancelExecution(projectId: string, executionId: string): Promise<Record<string, unknown>> {
    const r = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/executions/${executionId}/cancel`, { method: 'POST', headers: H });
    return (await r.json()) as Record<string, unknown>;
  }

  it('CAS A — annulation PENDANT la génération LLM : ⏹, aucun done, fichier et révisions intacts', async () => {
    streamScript = sseBody('Intro.\n\n', SECTION_HERO + '\n\n'); // [DONE] retenu par la porte
    holdStream = new Promise<void>((r) => { releaseStream = r; });
    closingDelayMs = 0;
    const projectId = await createProject('E1 CAS A annulation pendant génération');
    const htmlBefore = await fileContent(projectId);
    const revisionsBefore = revisionStore.listRevisions(TENANT, projectId).length;

    const res = await openStream(projectId, 'Crée un site de boulangerie', { isModification: false });
    assert.equal(res.status, 200);
    const reader = frameReader(res);
    const frames: Array<Record<string, unknown>> = [];
    let executionId = '';
    // Phase 1 : jusqu'à la première section (la route est ensuite garée dans
    // le for-await, en attente du [DONE] retenu — fenêtre de course ouverte).
    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
      if (!executionId && typeof f.executionId === 'string') executionId = f.executionId;
      if (f.type === 'section_start') break;
    }
    assert.ok(executionId, 'executionId reçu (frame start) — frames: ' + frames.map((f) => f.type).join(','));

    // Double demande d'annulation (le Studio peut cliquer deux fois).
    const c1 = await cancelExecution(projectId, executionId);
    const c2 = await cancelExecution(projectId, executionId);
    assert.equal(c1['cancelled'], true, 'première demande acceptée (drapeau posé)');
    assert.equal(c2['cancelled'], true, 'deuxième demande acceptée (idempotente au niveau drapeau)');

    // Libération : le stream LLM se termine normalement.
    releaseStream();
    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
    }
    const types = frames.map((f) => f.type);
    assert.ok(types.includes('cancelled'), 'frame cancelled émise — frames: ' + types.join(','));
    assert.ok(!types.includes('done'), 'AUCUN done après annulation');
    assert.ok(!types.includes('closing'), 'aucune clôture après annulation');
    assert.ok(!types.includes('error'), 'une annulation n\u2019est pas une erreur (E1 : arbitrage du catch)');

    // État PERSISTÉ : CANCELLED, pas de claim de persistance.
    const rec = executionStore.getExecution(executionId)!;
    assert.equal(rec.status, 'CANCELLED');
    assert.equal(rec.persistenceWon, undefined);
    const disk = persistedRecord(executionId) as Record<string, unknown> | undefined;
    assert.equal(disk!['status'], 'CANCELLED', 'statut CANCELLED persisté sur disque');

    // Cohérence : fichier et révisions INTACTS (aucune écriture du tour annulé).
    assert.equal(await fileContent(projectId), htmlBefore, 'fichier inchangé — aucun fragment persisté');
    assert.equal(revisionStore.listRevisions(TENANT, projectId).length, revisionsBefore, 'aucune révision créée par le tour annulé');
  });

  it('CAS B — annulation APRÈS le done (persistance déjà validée) : refus honnête, COMPLETED, révision présente', async () => {
    streamScript = sseBody('Voici votre site !\n\n', SECTION_HERO + '\n\n') + DONE_CHUNK; // flux complet immédiat
    holdStream = Promise.resolve();
    releaseStream = () => {};
    closingDelayMs = 400; // clôture retardée : fenêtre déterministe APRÈS le done
    const projectId = await createProject('E1 CAS B annulation trop tard');
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
    assert.ok(done, 'frame done reçue — frames: ' + frames.map((f) => f.type).join(','));
    assert.equal(done!['updated'], true, 'l\u2019écriture a été réellement persistée et vérifiée');
    assert.ok(executionId, 'executionId reçu');

    // L'ANNULATION ARRIVE APRÈS LA VALIDATION DE PERSISTANCE (post-done,
    // clôture LLM encore en attente — fenêtre déterministe).
    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel['cancelled'], false, 'le serveur refuse honnêtement l\u2019annulation tardive');
    assert.equal(cancel['reason'], 'persistence_already_validated', 'motif d\u2019arbitrage explicite (CAS B)');

    // La clôture suit normalement (CAS B : le tour s'achève comme un succès).
    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
    }
    const types = frames.map((f) => f.type);
    assert.ok(types.includes('closing'), 'clôture émise normalement — annulation refusée');
    assert.ok(!types.includes('cancelled'), 'AUCUNE frame cancelled — l\u2019annulation a perdu la course');
    assert.ok(!types.includes('error'), 'aucune erreur technique induite par le refus');

    // Cohérence fichier / révision / statut : tout raconte la même histoire.
    const rec = executionStore.getExecution(executionId)!;
    assert.equal(rec.status, 'COMPLETED');
    assert.equal(rec.persistenceWon, true);
    const disk = persistedRecord(executionId) as Record<string, unknown> | undefined;
    assert.equal(disk!['status'], 'COMPLETED', 'statut COMPLETED persisté sur disque');
    assert.equal(disk!['persistenceWon'], true, 'claim de persistance persistée sur disque');
    const html = String(done!['html']);
    assert.equal(html, await fileContent(projectId), 'done.html byte-identique au fichier réellement persisté');
    assert.ok(revisionStore.listRevisions(TENANT, projectId).length > revisionsBefore, 'révision réellement créée par le tour (contenu cohérent)');
  });
});
