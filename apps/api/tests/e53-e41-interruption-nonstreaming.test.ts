/**
 * É53 LOT E4.1 — INTERRUPTION RÉELLE DES APPELS LLM NON-STREAMING (E2E).
 *
 * Étend E3 (streaming) aux appels generate() NON-streaming et à la chaîne
 * multi-agents via /execute : le signal du tour (E1/E2/E3 — seule autorité)
 * doit atteindre :
 *   - T1   : l'appel de clôture (closing, generate(), 20 s) quand le client
 *            se DÉCONNECTE pendant l'appel → transport coupé, AUCUNE frame
 *            closing sur un socket mort, record déjà terminal (COMPLETED) ;
 *   - T1bis: CAS B — un POST cancel pendant la clôture est REFUSÉ (record
 *            déjà terminal) → la clôture suit normalement, AUCUN abandon ;
 *   - T2   : l'appel de classification (classify, generate(), 200 tokens)
 *            quand une annulation utilisateur est ACCEPTÉE pendant l'appel
 *            → transport coupé, ⏹ unique, AUCUN repli mots-clés, AUCUN autre
 *            appel LLM (ni streaming, ni closing) ;
 *   - T3   : déconnexion client pendant la classification → même issue
 *            honnête (CANCELLED client_gone), zéro travail lancé ;
 *   - T4   : la RÉÉCRITURE de /execute (regenerateFileForPlan, generate(),
 *            8192 tokens) quand le client abandonne la requête pendant
 *            l'appel → PREUVE TRANSPORT (signal tombé), résultat tardif
 *            JAMAIS écrit : le fichier garde la mutation COMMITTED (V1),
 *            le contenu tardif V2 est neutralisé.
 *
 * Preuves transport (même protocole que E3) : le fetch reçoit le signal du
 * contrôleur INTERNE de l'adapter (identité d'instance prouvée au niveau
 * unitaire — suite U) ; E2E = call.signal.aborted === true.
 *
 * Routing du transport contrôlé (le body porte la signature de l'appel) :
 *   stream===true → flux SSE (E3) ; max_tokens 200 → classify ;
 *   max_tokens 400 → closing ; max_tokens 8192 sans marqueur d'agent →
 *   regen (réécriture /execute) ; 8192 + marqueur « agent spécialisé » →
 *   agent (suite chaîne, F3).
 */
import './_lot-b-legacy-env.js';

process.env.MISTRAL_API_KEY = 'test-key-e53-e41';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { createApiServer } from '../src/server.js';
import { dataFilePath, readJsonFile } from '../../../packages/core/src/persistence/json-disk-cache.js';

function sseBody(...parts: string[]): string {
  return parts
    .map((p) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n')
    .join('');
}
const DONE_CHUNK = 'data: [DONE]\n\n';
const SECTION_HERO = '<SECTION name="hero" mode="create"><h1>Boulangerie du Coin</h1><p>Pains au levain, cuits au feu de bois chaque matin.</p></SECTION>';
const SECTION_MENU = '<SECTION name="menu" mode="create"><h2>Nos pains</h2><p>Baguette tradition, campagne, seigle, pain aux noix.</p></SECTION>';
const SECTION_CONTACT = '<SECTION name="contact" mode="create"><h2>Contact</h2><p>contact@exemple.fr — 01 23 45 67 89.</p></SECTION>';

/** Lecteur SSE incrémental (même protocole que la suite E3). */
function frameReader(res: Response): { next(): Promise<Record<string, unknown> | null> } {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const queue: Array<Record<string, unknown>> = [];
  let finished = false;
  async function pump(): Promise<void> {
    if (queue.length > 0 || finished) return;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { finished = true; return; }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          const l = line.trim();
          if (!l.startsWith('data:')) continue;
          try { queue.push(JSON.parse(l.slice(5).trim()) as Record<string, unknown>); } catch { /* ignore */ }
        }
      }
      if (queue.length > 0) return;
    }
  }
  return {
    async next(): Promise<Record<string, unknown> | null> {
      await pump();
      return queue.shift() ?? null;
    }
  };
}

function persistedRecord(id: string): Record<string, unknown> | undefined {
  const doc = readJsonFile<Record<string, Record<string, unknown>>>(dataFilePath('executions'), {});
  return doc[id];
}

/** Attend qu'une condition devienne vraie (fenêtre bornée, pas de veille indéfinie). */
async function waitFor(condition: () => boolean, timeoutMs = 3000, stepMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor : délai dépassé');
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

describe('É53 LOT E4.1 — NS. appels NON-streaming : clôture, classification, réécriture /execute', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;

  interface StreamCall {
    signal: AbortSignal | null;
    held: boolean;
    release: () => void;
    deltasEnqueued: number;
    enqueueAfterAbort: number;
    deltasAtAbort: number | null;
  }
  type JsonKind = 'classify' | 'closing' | 'regen' | 'agent' | 'unknown';
  interface JsonCall {
    kind: JsonKind;
    signal: AbortSignal | null;
    held: boolean;
    release: () => void;
    maxTokens: number;
  }
  const transport = {
    streamCalls: [] as StreamCall[],
    jsonCalls: [] as JsonCall[],
    streamScript: '',
    streamDelayMs: 0,
    holdStream: false,
    holds: { classify: false, closing: false, regen: false, agent: false } as { [k in JsonKind]?: boolean },
    /** Classification scriptée (défaut : CREATE — T1/T2/T3 ; MODIFY pour T4). */
    classifyJson: '{"category": "CREATE", "urgency": "NORMAL", "confidence": 0.9}',
    /** Contenu tardif scripté pour la réécriture : NE DOIT JAMAIS être écrit. */
    regenV2: '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>V2 tardif</title></head><body><h1>V2 tardif — contenu que le client n a jamais vu</h1><p>Ce contenu ne doit jamais atteindre le disque après une annulation.</p></body></html>',
    /** Flux scripté pour les agents (utilisé par la suite chaîne F3). */
    agentFlux: ''
  };

  before(async () => {
    // Transport contrôlé : le patch est installé AVANT createApiServer (les
    // adapters capturent `fetch` à leur construction — même protocole que E3).
    globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal | null; body?: unknown }) => {
      let body: { stream?: boolean; max_tokens?: number; messages?: Array<{ role?: string; content?: string }> } = {};
      try { body = JSON.parse(String(init?.body ?? '{}')) as typeof body; } catch { /* défaut */ }
      const signal = (init?.signal as AbortSignal | null) ?? null;
      const mkAbortErr = (): Error => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        return e;
      };

      // --- Flux SSE (appel principal streaming — chemin E3, inchangé) -----
      if (body.stream === true) {
        const call: StreamCall = {
          signal, held: false, release: () => {},
          deltasEnqueued: 0, enqueueAfterAbort: 0, deltasAtAbort: null
        };
        transport.streamCalls.push(call);
        const abortNow = (): Error => {
          if (call.deltasAtAbort === null) call.deltasAtAbort = call.deltasEnqueued;
          return mkAbortErr();
        };
        const sleep = (ms: number): Promise<void> => new Promise<void>((resolve, reject) => {
          const onAbort = (): void => { clearTimeout(t); reject(abortNow()); };
          const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
          signal?.addEventListener('abort', onAbort, { once: true });
        });
        const events = transport.streamScript.split('\n\n').filter(Boolean).map((e) => e + '\n\n');
        const encoder = new TextEncoder();
        const rs = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              if (signal?.aborted) { call.enqueueAfterAbort++; throw abortNow(); }
              for (const ev of events) {
                if (signal?.aborted) { call.enqueueAfterAbort++; throw abortNow(); }
                controller.enqueue(encoder.encode(ev));
                call.deltasEnqueued++;
                if (transport.streamDelayMs > 0) await sleep(transport.streamDelayMs);
              }
              if (transport.holdStream) {
                await new Promise<void>((resolve) => {
                  call.held = true;
                  call.release = resolve;
                  signal?.addEventListener('abort', () => resolve(), { once: true });
                });
                if (signal?.aborted) throw abortNow();
              }
              controller.enqueue(encoder.encode(DONE_CHUNK));
              controller.close();
            } catch (err) {
              try { controller.error(err instanceof Error ? err : new Error(String(err))); } catch { /* déjà fermé */ }
            }
          }
        });
        return new Response(rs, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }

      // --- generate() NON-streaming : routage par signature du body -------
      const maxTokens = Number(body.max_tokens ?? 0);
      const system = String(body.messages?.[0]?.content ?? '');
      let kind: JsonKind = 'unknown';
      if (maxTokens === 200) kind = 'classify';
      else if (maxTokens === 400) kind = 'closing';
      else if (maxTokens === 8192) kind = system.includes('agent spécialisé') ? 'agent' : 'regen';
      const call: JsonCall = { kind, signal, held: false, release: () => {}, maxTokens };
      transport.jsonCalls.push(call);

      // HOLD : l'appel tient jusqu'à l'abandon (signal) ou la libération
      // manuelle du test. L'abandon traverse le transport : AbortError.
      if (transport.holds[kind]) {
        await new Promise<void>((resolve) => {
          call.held = true;
          call.release = resolve;
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        if (signal?.aborted) throw mkAbortErr();
      }

      const content = kind === 'classify'
        ? transport.classifyJson
        : kind === 'closing'
        ? '{"summary": "Clôture déterministe", "suggestions": ["Retoucher le hero", "Ajouter la carte du jour", "Voir la page contact"]}'
        : kind === 'agent'
        ? transport.agentFlux
        : kind === 'regen'
        ? transport.regenV2
        : 'ok';
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => { baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port; resolve(); });
    });
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'e53-e41-ns', 'x-user-role': 'OWNER' };

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

  async function openStream(
    projectId: string,
    message: string,
    body: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<{ res: Response; sessionId: string }> {
    const s = await realFetch(baseUrl + '/api/v1/projects/' + projectId + '/conversation/sessions', { method: 'POST', headers: H, body: '{}' });
    const sj = (await s.json()) as { session: { sessionId: string } };
    const sessionId = sj.session.sessionId;
    const res = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`, {
      method: 'POST',
      headers: { ...H, Accept: 'text/event-stream' },
      body: JSON.stringify({ message, ...body }),
      ...(signal !== undefined ? { signal } : {})
    });
    return { res, sessionId };
  }

  async function cancelExecution(projectId: string, executionId: string): Promise<Record<string, unknown>> {
    const r = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/executions/${executionId}/cancel`, { method: 'POST', headers: H });
    return (await r.json()) as Record<string, unknown>;
  }

  async function readUntilDone(reader: ReturnType<typeof frameReader>): Promise<{ frames: Array<Record<string, unknown>>; executionId: string }> {
    const frames: Array<Record<string, unknown>> = [];
    let executionId = '';
    for (;;) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
      if (!executionId && typeof f.executionId === 'string') executionId = f.executionId;
      if (f.type === 'done') break;
    }
    return { frames, executionId };
  }

  /** Lit jusqu'à la frame demandée (inclusive) ; retourne tout ce qui a été lu. */
  async function readUntilType(
    reader: ReturnType<typeof frameReader>,
    stopType: string
  ): Promise<Array<Record<string, unknown>>> {
    const frames: Array<Record<string, unknown>> = [];
    for (;;) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
      if (f.type === stopType) break;
    }
    return frames;
  }

  /** Extrait l'executionId sans bloquer : le recorder (E2) enrichit CHAQUE
   * frame post-start avec executionId — on s'arrête dès la première enrichie
   * (le flux reste ouvert pendant le hold, on ne lit jamais jusqu'à la fin). */
  async function readExecutionId(reader: ReturnType<typeof frameReader>): Promise<string> {
    for (;;) {
      const f = await reader.next();
      if (!f) return '';
      if (typeof f.executionId === 'string' && (f.executionId as string).length > 0) {
        return f.executionId as string;
      }
    }
  }

  it('T1 — DÉCONNEXION PENDANT LA CLÔTURE : transport coupé, AUCUNE frame closing sur un socket mort', async () => {
    transport.streamCalls = [];
    transport.jsonCalls = [];
    transport.streamScript = sseBody('Voici votre boulangerie !\n\n', SECTION_HERO + '\n\n', SECTION_MENU + '\n\n', SECTION_CONTACT + '\n\n', 'Voilà, c\u2019est prêt !\n\n');
    transport.streamDelayMs = 0;
    transport.holdStream = false;
    transport.holds = { classify: false, closing: true, regen: false, agent: false };

    const projectId = await createProject('E41 T1 disconnect pendant la clôture');
    const clientCtrl = new AbortController();
    const { res } = await openStream(projectId, 'Crée un site de boulangerie', { isModification: false }, clientCtrl.signal);
    assert.equal(res.status, 200);
    const reader = frameReader(res);
    const { frames, executionId } = await readUntilDone(reader);
    assert.ok(executionId, 'executionId reçu');
    assert.ok(frames.some((f) => f.type === 'done'), 'done reçu (le record passe terminal AVANT la clôture)');

    // La clôture (generate 400) est EN COURS côté transport (tenue).
    await waitFor(() => transport.jsonCalls.some((c) => c.kind === 'closing' && c.held === true), 15000);
    const closingCall = transport.jsonCalls.find((c) => c.kind === 'closing')!;
    assert.ok(closingCall.signal, 'PREUVE TRANSPORT : l appel de clôture porte un AbortSignal (E4.1 — signal transmis)');

    // Le client RACCROCHE pendant l'appel de 20 s → res 'close' (E3) → le
    // signal du tour arme le transport → l'appel de clôture est coupé.
    clientCtrl.abort();
    await waitFor(() => closingCall.signal?.aborted === true, 5000);
    assert.equal(closingCall.signal!.aborted, true, 'PREUVE TRANSPORT : la déconnexion a coupé l appel de clôture EN PLEIN APPEL');

    // AUCUNE frame closing ne peut suivre (garde E4.1 clientGone||aborted) —
    // le reader est mort avec le socket : on ne peut rien lire de plus.
    let lateFrames = 0;
    try {
      for (;;) {
        const f = await reader.next();
        if (!f) break;
        lateFrames++;
      }
    } catch { /* socket client détruit — lecture impossible */ }
    assert.equal(lateFrames, 0, 'AUCUNE frame lisible après la déconnexion (pas de closing tardif)');

    // Le record était DÉJÀ TERMINAL pendant la clôture (ordre du code :
    // completeExecution → done → closing) : jamais FAILED.
    await waitFor(() => persistedRecord(executionId)?.['status'] === 'COMPLETED', 10000);
    assert.equal(persistedRecord(executionId)!.status, 'COMPLETED', 'le record reste COMPLETED (la clôture n est qu une embellie)');

    // Le flux streaming (déjà terminé) n a JAMAIS été abandonné en cours :
    // l'abandon est arrivé APRÈS la fermeture du transport (aucun delta
    // refusé) — seule la clôture (encore en vol) a été coupée.
    assert.equal(transport.streamCalls[0]!.enqueueAfterAbort, 0, 'le flux principal s est terminé normalement (aucun delta refusé après l abandon)');
    assert.equal(transport.jsonCalls.filter((c) => c.kind === 'regen').length, 0, 'AUCUNE réécriture sur le chemin /stream (la clôture est le seul autre appel)');
  });

  it('T1bis — CAS B : cancel REFUSÉ pendant la clôture → clôture normale, AUCUN abandon', async () => {
    transport.streamCalls = [];
    transport.jsonCalls = [];
    transport.streamScript = sseBody('Conception !\n\n', SECTION_HERO + '\n\n', SECTION_MENU + '\n\n', 'Terminé !\n\n');
    transport.streamDelayMs = 0;
    transport.holdStream = false;
    transport.holds = { classify: false, closing: true, regen: false, agent: false };

    const projectId = await createProject('E41 T1bis CAS B refus pendant la clôture');
    const { res } = await openStream(projectId, 'Crée un site de boulangerie', { isModification: false });
    assert.equal(res.status, 200);
    const reader = frameReader(res);
    const { frames, executionId } = await readUntilDone(reader);
    assert.ok(executionId && frames.some((f) => f.type === 'done'), 'done reçu (persistance validée)');

    await waitFor(() => transport.jsonCalls.some((c) => c.kind === 'closing' && c.held === true), 15000);
    const closingCall = transport.jsonCalls.find((c) => c.kind === 'closing')!;

    // Le record est déjà terminal : le POST cancel doit être REFUSÉ (CAS B)
    // — et le drapeau n est jamais posé, donc AUCUN abandon du transport.
    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel.cancelled, false, 'CAS B : annulation refusée (persistance déjà validée)');
    assert.equal(cancel.reason, 'persistence_already_validated');

    // La clôture suit NORMALEMENT (libération du hold du transport).
    closingCall.release();
    const rest: Array<Record<string, unknown>> = [];
    for (;;) {
      const f = await reader.next();
      if (!f) break;
      rest.push(f);
    }
    const closingFrame = rest.find((f) => f.type === 'closing') as Record<string, unknown> | undefined;
    assert.ok(closingFrame, 'la clôture est émise normalement après le refus CAS B');
    assert.equal(closingFrame!['source'], 'llm', 'la clôture provient bien de l appel LLM (résultat utilisé)');

    // PREUVE TRANSPORT : le signal n a JAMAIS été armé (refus → pas d abandon).
    assert.equal(closingCall.signal?.aborted, false, 'CAS B : AUCUN abandon de l appel de clôture');
    assert.ok(transport.streamCalls[0]!.signal?.aborted === false, 'AUCUN abandon du flux non plus');
    await waitFor(() => persistedRecord(executionId)?.['status'] === 'COMPLETED', 10000);
    assert.equal(persistedRecord(executionId)!.status, 'COMPLETED');
  });

  it('T2 — CANCEL PENDANT LA CLASSIFICATION : transport coupé, ⏹ unique, AUCUN repli ni autre appel', async () => {
    transport.streamCalls = [];
    transport.jsonCalls = [];
    transport.streamScript = '';
    transport.holds = { classify: true, closing: false, regen: false, agent: false };

    const projectId = await createProject('E41 T2 cancel pendant la classification');
    const { res } = await openStream(projectId, 'Crée un site de boulangerie', { isModification: false });
    assert.equal(res.status, 200);
    const reader = frameReader(res);

    await waitFor(() => transport.jsonCalls.some((c) => c.kind === 'classify' && c.held === true), 15000);
    const classifyCall = transport.jsonCalls.find((c) => c.kind === 'classify')!;
    assert.ok(classifyCall.signal, 'PREUVE TRANSPORT : l appel de classification porte un AbortSignal (E4.1)');

    // L'annulation arrive PENDANT l'appel de classification : CAS A accepté
    // (aucune mutation en cours) → le signal arme le transport.
    const executionId = await readExecutionId(reader);
    assert.ok(executionId, 'executionId reçu (frame enrichie, hold en cours)');

    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel.cancelled, true, 'CAS A : annulation acceptée pendant la classification');

    await waitFor(() => classifyCall.signal?.aborted === true, 5000);
    assert.equal(classifyCall.signal!.aborted, true, 'PREUVE TRANSPORT : l annulation a coupé l appel de classification EN PLEIN APPEL');

    // L'issue du tour : ⏹ unique (arbitrage E1), AUCUN repli mots-clés
    // (l'abandon est REJETÉ par classifyIntentViaAI — correction E4.1),
    // AUCUN autre appel LLM (ni streaming, ni closing).
    const rest = await readUntilType(reader, 'cancelled');
    const cancelledFrames = rest.filter((f) => f.type === 'cancelled');
    assert.equal(cancelledFrames.length, 1, 'exactement UNE frame ⏹');
    assert.ok(!rest.some((f) => f.type === 'done'), 'aucun done après annulation');
    assert.ok(!rest.some((f) => f.type === 'error'), 'l abandon n est jamais une erreur LLM');
    assert.ok(!rest.some((f) => f.type === 'plan'), 'aucun travail continué après annulation (pas de plan)');

    await waitFor(() => persistedRecord(executionId)?.['status'] === 'CANCELLED', 5000);
    assert.equal(persistedRecord(executionId)!.status, 'CANCELLED');

    // PREUVE : la classification est le SEUL appel qui a eu lieu.
    assert.equal(transport.jsonCalls.length, 1, 'AUCUN autre appel non-streaming (closing jamais lancé)');
    assert.equal(transport.streamCalls.length, 0, 'AUCUN appel streaming (le repli direct n a jamais démarré)');
  });

  it('T3 — DÉCONNEXION PENDANT LA CLASSIFICATION : issue CANCELLED client_gone, zéro travail', async () => {
    transport.streamCalls = [];
    transport.jsonCalls = [];
    transport.holds = { classify: true, closing: false, regen: false, agent: false };

    const projectId = await createProject('E41 T3 disconnect pendant la classification');
    // Socket HTTP brut (comme B9/E3) : la déconnexion est réelle et sûre.
    const sessionRes = await realFetch(baseUrl + '/api/v1/projects/' + projectId + '/conversation/sessions', { method: 'POST', headers: H, body: '{}' });
    const sessionJson = (await sessionRes.json()) as { session: { sessionId: string } };
    const socket = await new Promise<Socket>((resolve, reject) => {
      const sk = connect(
        { host: '127.0.0.1', port: (server.address() as AddressInfo).port },
        () => {
          const body = JSON.stringify({ message: 'Crée un site de boulangerie', isModification: false });
          sk.write(
            `POST /api/v1/projects/${projectId}/conversation/sessions/${sessionJson.session.sessionId}/stream HTTP/1.1\r\n` +
            'Host: 127.0.0.1\r\nContent-Type: application/json\r\nAccept: text/event-stream\r\n' +
            `x-tenant-id: e53-e41-ns\r\nx-user-role: OWNER\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
          );
          resolve(sk);
        }
      );
      sk.on('error', reject);
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => { raw += chunk; });
    await waitFor(() => /"executionId":"req_/.test(raw), 10000);
    const executionIdMatch = raw.match(/"executionId":"(req_[A-Za-z0-9_]+)"/);
    assert.ok(executionIdMatch, 'executionId reçu dans le flux brut');
    const executionId = executionIdMatch[1] ?? '';
    assert.ok(executionId.length > 0, 'executionId extrait du flux brut');

    await waitFor(() => transport.jsonCalls.some((c) => c.kind === 'classify' && c.held === true), 15000);
    const classifyCall = transport.jsonCalls.find((c) => c.kind === 'classify')!;

    // Le client RACCROCHE pendant l'appel de classification.
    socket.destroy();
    await waitFor(() => classifyCall.signal?.aborted === true, 5000);
    assert.equal(classifyCall.signal!.aborted, true, 'PREUVE TRANSPORT : la déconnexion a coupé l appel de classification');

    await waitFor(() => persistedRecord(executionId)?.['status'] === 'CANCELLED', 5000);
    const record = persistedRecord(executionId);
    assert.ok(record, 'record persisté');
    assert.equal(record!['status'], 'CANCELLED', 'issue honnête : CANCELLED (client_gone), jamais FAILED');

    // PREUVE : la classification est le SEUL appel ; aucun travail ne suit.
    assert.equal(transport.jsonCalls.length, 1, 'AUCUN autre appel non-streaming');
    assert.equal(transport.streamCalls.length, 0, 'AUCUN appel streaming après la déconnexion');
  });

  it('T4 — RÉÉCRITURE /execute : abandon pendant l appel → PREUVE TRANSPORT + résultat tardif JAMAIS écrit', async () => {
    transport.streamCalls = [];
    transport.jsonCalls = [];
    transport.holds = { classify: false, closing: false, regen: true, agent: false };
    transport.regenV2 = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>V2 tardif</title></head><body><h1>V2 tardif — contenu que le client n a jamais vu</h1><p>Jamais écrit.</p></body></html>';
    // É53 LOT E4.1 — diagnostic 2ᵉ exécution : la mutation du plan CREATE sur
    // index.html échoue HONNÊTEMENT (le fichier seedé existe déjà :
    // MutationConflictError « il existe déjà ») → executionResult.success ===
    // false → la réécriture n'est jamais lancée et le test ne peut pas
    // prouver la neutralisation du résultat tardif. Le scénario cible donc
    // une MODIFICATION (UPDATE_FILE sur le fichier seedé) : même cible
    // index.html, même réécriture /execute, mutation réellement COMMITTED.
    transport.classifyJson = '{"category": "MODIFY", "urgency": "NORMAL", "confidence": 0.9}';

    const projectId = await createProject('E41 T4 réécriture abandonnée pendant l appel');
    const htmlBefore = await fileContent(projectId);
    assert.ok(htmlBefore.length > 0, 'index.html seedé présent (base de comparaison)');

    // 1) planFirst → le plan (étape de mutation sur index.html, fichier
    //    explicitement nommé) est persisté sur CETTE session (FIX-PLANFIRST).
    const { res, sessionId } = await openStream(projectId, 'Modifie la page boulangerie dans index.html', { isModification: true, planFirst: true });
    assert.equal(res.status, 200);
    const reader = frameReader(res);
    let planId = '';
    let sawConfirm = false;
    for (;;) {
      const f = await reader.next();
      if (!f) break;
      if (!planId && f.type === 'plan' && typeof (f as { plan?: { planId?: string } }).plan?.planId === 'string') {
        planId = ((f as { plan: { planId: string } }).plan).planId;
      }
      if (f.type === 'done' && f.awaitingConfirmation === true) sawConfirm = true;
    }
    assert.ok(planId, 'planId émis');
    assert.ok(sawConfirm, 'attente de confirmation');
    assert.equal(transport.streamCalls.length, 0, 'planFirst : AUCUN appel streaming (le flux s arrête à la confirmation)');
    assert.equal(transport.jsonCalls.length, 1, 'planFirst : la classification seule');

    // 2) confirm sur LA MÊME session → activePlan APPROVED.
    const c = await realFetch(
      `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/confirm`,
      { method: 'POST', headers: H, body: JSON.stringify({ planId, approved: true }) }
    );
    assert.equal(c.status, 200, 'confirm accepté sur la session du plan');
    const cj = (await c.json()) as { session?: { activePlan?: { status?: string } } };
    assert.equal(cj.session?.activePlan?.status, 'APPROVED', 'activePlan APPROVED (protocole FIX-PLANFIRST)');

    // 3) /execute sur CETTE session — requête ABORTABLE : la réécriture
    //    (regen, 8192 tokens) est tenue par le transport pendant qu on
    //    abandonne la requête client. executeApprovedPlan tourne D ABORD
    //    (mutation COMMITTED du reference-agent), la regen part ENSUITE.
    const execCtrl = new AbortController();
    const execPromise = realFetch(
      `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/execute`,
      { method: 'POST', headers: H, body: '{}', signal: execCtrl.signal }
    ).catch((err: unknown) => ({ aborted: true, error: err }));

    await waitFor(() => transport.jsonCalls.some((c) => c.kind === 'regen' && c.held === true), 20000);
    const regenCall = transport.jsonCalls.find((c) => c.kind === 'regen')!;
    assert.ok(regenCall.signal, 'PREUVE TRANSPORT : l appel de réécriture porte un AbortSignal (E4.1)');

    // La mutation COMMITTED (reference-agent, contenu déterministe V1) a déjà
    // eu lieu : le fichier porte V1. Le client abandonne pendant la regen.
    const htmlAfterMutation = await fileContent(projectId);
    assert.ok(htmlAfterMutation.includes('Généré par reference-agent'), 'la mutation V1 est COMMITTED (contenu déterministe de reference-agent)');

    execCtrl.abort(); // le client abandonne la requête /execute
    await waitFor(() => regenCall.signal?.aborted === true, 5000);
    assert.equal(regenCall.signal!.aborted, true, 'PREUVE TRANSPORT : l abandon de la requête a coupé l appel de réécriture EN PLEIN APPEL');

    // Le fetch client rejette (socket fermé).
    const execResult = await execPromise as { aborted?: boolean };
    assert.equal(execResult.aborted, true, 'la requête /execute a bien été abandonnée côté client');

    // PREUVE DE NEUTRALISATION : le résultat tardif V2 n est JAMAIS écrit.
    const htmlFinal = await fileContent(projectId);
    assert.ok(!htmlFinal.includes('V2 tardif'), 'le contenu tardif V2 n a JAMAIS atteint le disque');
    assert.ok(htmlFinal.includes('Généré par reference-agent'), 'le fichier garde la mutation COMMITTED V1');
    assert.equal(htmlFinal, htmlAfterMutation, 'octets IDENTIQUES : aucune écriture post-annulation');

    // PREUVE : ni streaming, ni clôture, ni agent LLM sur ce chemin.
    assert.equal(transport.streamCalls.length, 0, 'AUCUN appel streaming sur /execute');
    assert.equal(transport.jsonCalls.filter((c) => c.kind === 'regen').length, 1, 'exactement UNE réécriture (coupée)');

    // Sanity : le contenu initial n a pas été restauré (la mutation V1 tient).
    assert.notEqual(htmlFinal, htmlBefore, 'la mutation COMMITTED V1 est préservée telle quelle');
  });
});
