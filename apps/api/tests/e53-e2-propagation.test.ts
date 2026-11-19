/**
 * É53 LOT E2 — PROPAGATION SERVEUR DE L'ANNULATION DANS /STREAM.
 *
 * E1 reste l'autorité atomique (cancelExecution / claimPersistenceWin) ; E2
 * vérifie que l'annulation acceptée est RESPECTÉE par toute la chaîne :
 * chaque point de contrôle centralisé (`cancelInterrupted`) stoppe la
 * progression avant l'étape suivante, sans done/closing/error « résultat
 * normal » après une annulation gagnante, et sans interrompre artificiellement
 * une mutation déjà validée (CAS B).
 *
 * Provider Mistral mocké (harnais LOT B). Les fenêtres de course sont
 * déterministes :
 *   T1 — annulation pendant la consommation du flux (deltas espacés) :
 *        la consommation s'arrête au chunk suivant, AUCUN aval ne s'exécute ;
 *   T2 — annulation après le dernier contenu, avant [DONE] : le drain et
 *        l'aval ne s'exécutent pas (aucune frame diff = assemblage, mutation,
 *        persistance, gate, synthèse jamais atteints) ;
 *   T3 — annulation pendant la complétion post-écriture (clôture retardée) :
 *        CAS B — refus honnête, la clôture suit normalement (aucune
 *        interruption artificielle d'une mutation validée).
 *
 * Chaque test contrôle l'état PERSISTÉ (record relu du disque, fichier du
 * projet relu via l'API, révisions via le revisionStore).
 */
import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { executionStore } from '../../../packages/core/src/ai-native/execution/store.js';
import { revisionStore } from '../../../packages/core/src/model/revision-store.js';
import { dataFilePath, readJsonFile } from '../../../packages/core/src/persistence/json-disk-cache.js';

process.env.MISTRAL_API_KEY = 'test-key-e53-e2';

const TENANT = 'e53-e2-t1';
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

/** État persisté du record (document disque), pas la Map en mémoire seule. */
function persistedRecord(id: string): Record<string, unknown> | undefined {
  const doc = readJsonFile<Record<string, Record<string, unknown>>>(dataFilePath('executions'), {});
  return doc[id];
}

describe('É53 LOT E2 — propagation de l\u2019annulation dans /stream', () => {
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
        // Deltas individuels (événements SSE complets), espacés si demandé :
        // la consommation du flux est alors contrôle par contrôle.
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
              // La route a rompu le for-await (annulation) : le stream est
              // annulé côté consommateur — rien à faire, c'est le but.
            }
          }
        });
        return new Response(rs, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      // Clôture LLM (generate non-stream) — retardable pour une fenêtre
      // déterministe APRÈS le done (phase de complétion post-écriture).
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

  async function cancelExecution(projectId: string, executionId: string): Promise<Record<string, unknown>> {
    const r = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/executions/${executionId}/cancel`, { method: 'POST', headers: H });
    return (await r.json()) as Record<string, unknown>;
  }

  it('T1 — annulation PENDANT la génération : consommation stoppée au chunk suivant, aucun aval (assemblage, mutation, persistance, gate, synthèse)', async () => {
    streamScript = sseBody('Voici votre boulangerie !\n\n', SECTION_HERO + '\n\n', SECTION_MENU + '\n\n', SECTION_CONTACT + '\n\n', 'Voilà, c\u2019est prêt !\n\n');
    streamChunkDelayMs = 120; // deltas espacés : fenêtre de course large et stable
    holdStream = new Promise<void>((r) => { releaseStream = r; });
    closingDelayMs = 0;
    const projectId = await createProject('E2 T1 annulation en cours de génération');
    const htmlBefore = await fileContent(projectId);
    const revisionsBefore = revisionStore.listRevisions(TENANT, projectId).length;

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
      if (f.type === 'section_end') break; // la 1ʳᵉ section vient d'être posée
    }
    assert.ok(executionId, 'executionId reçu (frame start)');
    assert.ok(frames.some((f) => f.type === 'section_end'), 'section hero posée avant l\u2019annulation');

    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel['cancelled'], true, 'annulation acceptée (drapeau posé)');

    // Le route consomme au plus UN chunk de plus (le check par chunk casse la
    // boucle) : les sections suivantes ne sont JAMAIS consommées.
    releaseStream();
    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
    }
    const types = frames.map((f) => f.type);
    const sectionEnds = types.filter((t) => t === 'section_end').length;
    assert.equal(sectionEnds, 1, 'consommation stoppée après la 1ʳᵉ section — frames: ' + types.join(','));
    assert.ok(types.includes('cancelled'), 'frame cancelled émise');
    assert.ok(!types.includes('done'), 'AUCUN done après annulation gagnante');
    assert.ok(!types.includes('closing'), 'aucune clôture après annulation');
    assert.ok(!types.includes('error'), 'une annulation n\u2019est pas une erreur');
    assert.ok(!types.includes('diff'), 'aucun diff : assemblage jamais exécuté');
    assert.ok(!types.includes('compass') || !frames.some((f) => f.type === 'compass' && f.state === 'COMPLETED'), 'compass jamais COMPLETED');

    // État persisté + cohérence des terminaux (non dupliqués).
    const rec = executionStore.getExecution(executionId)!;
    assert.equal(rec.status, 'CANCELLED');
    assert.equal(rec.persistenceWon, undefined);
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_CANCELLED').length, 1, 'exactement UN événement d\u2019annulation');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_COMPLETED').length, 0, 'aucun EXECUTION_COMPLETED');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_FAILED').length, 0, 'aucun EXECUTION_FAILED');
    const disk = persistedRecord(executionId) as Record<string, unknown> | undefined;
    assert.equal(disk!['status'], 'CANCELLED', 'CANCELLED persisté sur disque');

    // Absence de progression : fichier et révisions intacts.
    assert.equal(await fileContent(projectId), htmlBefore, 'fichier inchangé — aucune écriture');
    assert.equal(revisionStore.listRevisions(TENANT, projectId).length, revisionsBefore, 'aucune révision créée');
  });

  it('T2 — annulation après le dernier contenu streamé, AVANT [DONE] : drain et aval jamais exécutés (aucun diff, aucune écriture)', async () => {
    streamScript = sseBody('Voici votre boulangerie !\n\n', SECTION_HERO + '\n\n', SECTION_MENU + '\n\n', SECTION_CONTACT + '\n\n', 'Voilà, c\u2019est prêt !\n\n');
    streamChunkDelayMs = 0; // tout le contenu arrive d'un bloc, [DONE] retenu
    holdStream = new Promise<void>((r) => { releaseStream = r; });
    closingDelayMs = 0;
    const projectId = await createProject('E2 T2 annulation pré-assemblage');
    const htmlBefore = await fileContent(projectId);
    const revisionsBefore = revisionStore.listRevisions(TENANT, projectId).length;

    const res = await openStream(projectId, 'Crée un site de boulangerie', { isModification: false });
    const reader = frameReader(res);
    const frames: Array<Record<string, unknown>> = [];
    let executionId = '';
    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
      if (!executionId && typeof f.executionId === 'string') executionId = f.executionId;
      // Dernière section_end émise PENDANT le stream : le parseur du route
      // avance d'UNE transition par delta (opérateur OU fermeture), la 3ᵉ
      // section n'est ouverte qu'au drainage (après la fin du flux).
      if (f.type === 'section_end' && f.name === 'menu') break;
    }
    assert.ok(executionId, 'executionId reçu');
    const sectionEnds = frames.filter((f) => f.type === 'section_end').map((f) => String(f.name));
    assert.deepEqual(sectionEnds, ['hero', 'menu'], '2 sections posées pendant le stream ; la 3ᵉ attend le drainage');
    assert.ok(!frames.some((f) => f.type === 'section_start' && f.name === 'contact'), 'la 3ᵉ section jamais ouverte avant [DONE]');

    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel['cancelled'], true, 'annulation acceptée');

    releaseStream();
    const afterFrames: Array<Record<string, unknown>> = [];
    while (true) {
      const f = await reader.next();
      if (!f) break;
      afterFrames.push(f);
    }
    const afterTypes = afterFrames.map((f) => f.type);
    assert.ok(afterTypes.includes('cancelled'), 'frame cancelled émise');
    assert.ok(!afterTypes.includes('done'), 'AUCUN done après annulation gagnante');
    assert.ok(!afterTypes.includes('diff'), 'AUCUN diff : assemblage + Mutation Orchestrator + persistance jamais atteints');
    assert.ok(!afterTypes.includes('closing'), 'aucune clôture');
    assert.ok(!afterTypes.includes('error'), 'aucune erreur technique');
    // AUCUNE progression : le point de contrôle n°0 (post-boucle) précède le
    // drainage — la 3ᵉ section n'est ni ouverte ni posée après l'annulation.
    assert.ok(!afterTypes.includes('section_start') && !afterTypes.includes('section_end'), 'drainage skippé : aucune section après annulation');

    const rec = executionStore.getExecution(executionId)!;
    assert.equal(rec.status, 'CANCELLED');
    assert.equal(rec.persistenceWon, undefined);
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_CANCELLED').length, 1, 'un seul événement d\u2019annulation (non dupliqué)');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_COMPLETED').length, 0);
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_FAILED').length, 0);
    assert.equal(await fileContent(projectId), htmlBefore, 'fichier inchangé — aucune écriture');
    assert.equal(revisionStore.listRevisions(TENANT, projectId).length, revisionsBefore, 'aucune révision créée');
  });

  it('T3 — annulation pendant la complétion post-écriture : CAS B refus honnête, la clôture suit (aucune interruption artificielle)', async () => {
    streamScript = sseBody('Voici votre boulangerie !\n\n', SECTION_HERO + '\n\n') + DONE_CHUNK; // flux complet immédiat
    streamChunkDelayMs = 0;
    holdStream = Promise.resolve();
    releaseStream = () => {};
    closingDelayMs = 400; // fenêtre déterministe APRÈS le done (clôture en attente)
    const projectId = await createProject('E2 T3 annulation pendant la complétion');
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
    assert.equal(done!['updated'], true, 'écriture réellement persistée et vérifiée');
    assert.ok(executionId, 'executionId reçu');

    // Annulation DURING la complétion (validations passées, clôture en attente) :
    // la persistance a déjà gagné (E1) → refus honnête, pas d'interruption.
    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel['cancelled'], false, 'annulation refusée : la mutation est déjà validée');
    assert.equal(cancel['reason'], 'persistence_already_validated', 'motif d\u2019arbitrage CAS B');

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

    // Cohérence terminale : COMPLETED unique, aucune annulation, révision présente.
    const rec = executionStore.getExecution(executionId)!;
    assert.equal(rec.status, 'COMPLETED');
    assert.equal(rec.persistenceWon, true);
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_COMPLETED').length, 1, 'exactement UN événement de complétion');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_CANCELLED').length, 0, 'aucun EXECUTION_CANCELLED');
    assert.equal(rec.events.filter((e) => e.type === 'EXECUTION_FAILED').length, 0);
    assert.ok(revisionStore.listRevisions(TENANT, projectId).length > revisionsBefore, 'révision créée (contenu cohérent)');
    assert.equal(String(done!['html']), await fileContent(projectId), 'done.html byte-identique au fichier persisté');

    // POST cancel APRÈS la fin du stream (drapeau supprimé) : réponse honnête.
    const lateCancel = await cancelExecution(projectId, executionId);
    assert.equal(lateCancel['cancelled'], false);
    assert.equal(lateCancel['reason'], 'not_active');
    assert.equal(lateCancel['status'], 'COMPLETED');
  });
});
