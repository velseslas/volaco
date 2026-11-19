/**
 * É53 LOT E3 — INTERRUPTION RÉELLE DES APPELS LLM.
 *
 * Le signal d'annulation doit atteindre le TRANSPORT HTTP du fournisseur
 * (AbortController par tour /stream) et l'arrêt doit être prouvé au niveau
 * du transport (signal reçu par la requête active, deltas refusés après
 * l'abandon, lecteur libéré). Classification honnête (Correction B) :
 * abandon demandé par l'appelant ≠ timeout ≠ erreur réseau ≠ erreur
 * fournisseur. L'arbitrage E1 (cancelExecution) et les points de contrôle
 * E2 (cancelInterrupted) restent les SEULES autorités de l'issue.
 *
 * Correspondance avec les 10 preuves obligatoires du CDC E3 :
 *   n°1  signal reçu par la requête active  → A1/A1-G/A1-O (transport)
 *   n°2  annulation acceptée → arrêt du flux → B2 (E2E + transport)
 *   n°3  0 token consommé après annulation  → A3 (transport) + B2 (frames)
 *   n°4  ressources/lecteurs libérés        → A4 (cancel du flux, 2 scénarios)
 *   n°5  timeout ≠ annulation utilisateur   → A5
 *   n°6  erreur réseau ≠ annulation         → A6
 *   n°7  refus CAS B → pas d'abandon        → B7 (E2E + transport)
 *   n°8  deux tours simultanés non partagés → B8 (E2E + transport)
 *   n°9  déconnexion client → interruption  → B9 (socket détruit + transport)
 *   n°10 terminaison normale non affectée   → B10 (E2E + transport)
 *
 * PREUVE DE LIBÉRATION (n°4) — deux formes, selon l'état du flux :
 *   - flux ENCORE lisible (break du consommateur, fin normale) :
 *     la callback `cancel()` du source EST invoquée (A4) ;
 *   - flux ERONÉ par l'abandon (comportement undici : le socket est détruit) :
 *     la spec Web Streams n'invoque PAS la callback `cancel()` — la preuve
 *     est alors `deltasAtAbort` : l'index du dernier delta émis par le
 *     transport au moment de l'abandon, gelé à cet instant (A1/A3/B2/B9 :
 *     zéro émission après l'abandon, socket du fournisseur coupé).
 *
 * Transports contrôlés : les adapters réellement utilisés par le chemin
 * streaming (Mistral par défaut, Gemini en repli, openai-compatible
 * atteignable par le registre) sont instanciés avec un `fetch` instrumenté ;
 * la suite E2E patche `globalThis.fetch` AVANT la création du serveur
 * (l'adapter capture `fetch` à la construction — même protocole que E2).
 */
import './_lot-b-legacy-env.js';

process.env.MISTRAL_API_KEY = 'test-key-e53-e3';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { createApiServer } from '../src/server.js';
import { dataFilePath, readJsonFile } from '../../../packages/core/src/persistence/json-disk-cache.js';
import { MistralProviderAdapter } from '../../../packages/core/src/ai/providers/mistral-adapter.js';
import { GeminiProviderAdapter } from '../../../packages/core/src/ai/providers/gemini-adapter.js';
import { createOpenAICompatibleAdapters } from '../../../packages/core/src/ai/providers/openai-compatible.js';
import {
  AIProviderAbortedError,
  AIProviderError,
  AIProviderTimeoutError,
  type TenantProviderCredentials
} from '../../../packages/core/src/ai/providers/types.js';

const CREDS: TenantProviderCredentials = { tenantId: 'tenant-e3', providerId: 'mistral', apiKey: 'mock-key-e3' };
const GEMINI_CREDS: TenantProviderCredentials = { tenantId: 'tenant-e3', providerId: 'gemini', apiKey: 'mock-key-e3' };
const OPENAI_CREDS: TenantProviderCredentials = { tenantId: 'tenant-e3', providerId: 'openai', apiKey: 'mock-key-e3' };

/** Attend qu'une condition devienne vraie (fenêtre bornée, pas de veille indéfinie). */
async function waitFor(condition: () => boolean, timeoutMs = 3000, stepMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor : délai dépassé');
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

/** Tolère un settle asynchrone (propagation abort → transport → lecteur). */
const settle = (ms = 300): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ==================== PARTIE A — ADAPTERS (transport contrôlé direct) ====================

interface TransportCall {
  url: string;
  /** signal REÇU par le transport (= signal du contrôleur interne de l'adapter). */
  signal: AbortSignal | null;
  cancelSeen: boolean;
  deltasEnqueued: number;
  /** tentatives d'émission REFUSÉES parce que le signal était déjà annulé. */
  enqueueAfterAbort: number;
  /** index du dernier delta émis QUAND l'abandon a traversé le transport (null = jamais abandonné). */
  deltasAtAbort: number | null;
}

interface ControlledTransport {
  fetchFn: typeof fetch;
  state: {
    lastCall: TransportCall | null;
    events: string[];
    delayMs: number;
    holdDone: boolean;
    releaseDone: () => void;
  };
}

/**
 * Transport SSE contrôlé, RÉACTIF au signal : comme undici, il coupe le corps
 * (controller.error(AbortError)) dès que le signal tombe — une lecture
 * en cours est rejetée, plus aucun delta n'est délivré après l'abandon.
 */
function makeControlledTransport(options?: { delayMs?: number; holdDone?: boolean }): ControlledTransport {
  const state = {
    lastCall: null as TransportCall | null,
    events: [] as string[],
    delayMs: options?.delayMs ?? 60,
    holdDone: options?.holdDone ?? true,
    releaseDone: () => {}
  };
  const fetchFn: typeof fetch = (async (_url: unknown, init?: { signal?: AbortSignal | null; body?: unknown }) => {
    const call: TransportCall = {
      url: String(_url),
      signal: (init?.signal as AbortSignal | null) ?? null,
      cancelSeen: false,
      deltasEnqueued: 0,
      enqueueAfterAbort: 0,
      deltasAtAbort: null
    };
    state.lastCall = call;
    const signal = call.signal;
    const encoder = new TextEncoder();
    const mkAbortErr = (): Error => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      return e;
    };
    // Comme undici : l'abandon ERONE le corps (le socket est détruit). On
    // gèle l'index du dernier delta émis à cet instant : c'est la preuve
    // transport « plus aucune émission après l'abandon ».
    const abortNow = (): Error => {
      if (call.deltasAtAbort === null) call.deltasAtAbort = call.deltasEnqueued;
      return mkAbortErr();
    };
    const sleep = (ms: number): Promise<void> => new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(t); reject(abortNow()); };
      const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    const rs = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (signal?.aborted) { call.enqueueAfterAbort++; throw abortNow(); }
          for (const ev of state.events) {
            if (signal?.aborted) { call.enqueueAfterAbort++; throw abortNow(); }
            controller.enqueue(encoder.encode(ev));
            call.deltasEnqueued++;
            await sleep(state.delayMs);
          }
          if (state.holdDone) {
            // Flux tenu ouvert : ni [DONE] ni close tant que rien n'arrive
            // (abandon du signal OU libération manuelle du test).
            await new Promise<void>((resolve) => {
              state.releaseDone = resolve;
              signal?.addEventListener('abort', () => resolve(), { once: true });
            });
            if (signal?.aborted) throw abortNow();
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          // Comme undici : le corps est ERONÉ — une read() en cours est rejetée.
          try { controller.error(err instanceof Error ? err : new Error(String(err))); } catch { /* déjà fermé */ }
        }
      },
      cancel() { call.cancelSeen = true; }
    });
    return new Response(rs, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  return { fetchFn, state };
}

const A_EVENTS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(
  (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`
);
// Format filaire GEMINI (candidates → parts → text) : le parser Gemini
// n'accepte PAS le format Mistral/OpenAI (choices → delta → content).
const GEMINI_EVENTS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(
  (t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`
);

describe('É53 LOT E3 — A. adapters streaming : le signal atteint le transport', () => {
  it('A1 (CDC n°1, n°2 partiel, n°4) — Mistral : la requête active reçoit l\u2019abandon, erreur classée « abandon », lecteur libéré', async () => {
    const { fetchFn, state } = makeControlledTransport({ delayMs: 60, holdDone: true });
    state.events = A_EVENTS.slice(0, 2);
    const adapter = new MistralProviderAdapter(fetchFn);
    const external = new AbortController();
    const chunks: string[] = [];
    const consumed = (async () => {
      for await (const chunk of adapter.generateStream(
        { tenantId: 'tenant-e3', projectId: 'proj-a1', prompt: 'génère', signal: external.signal },
        CREDS
      )) {
        chunks.push(chunk);
      }
    })();
    await waitFor(() => chunks.length >= 1); // requête ACTIVE : au moins un delta consommé
    external.abort();
    await assert.rejects(consumed, (err: unknown) => {
      assert.ok(err instanceof AIProviderAbortedError, 'abandon externe → AIProviderAbortedError, pas un timeout');
      assert.ok(!(err instanceof AIProviderTimeoutError));
      return true;
    });
    // PREUVE TRANSPORT : le signal passé à la requête HTTP est tombé.
    assert.ok(state.lastCall, 'le transport a bien reçu la requête');
    assert.ok(state.lastCall.signal, 'la requête HTTP porte un AbortSignal');
    assert.equal(state.lastCall.signal!.aborted, true, 'le transport a reçu l\u2019abandon');
    await settle(300);
    // PREUVE TRANSPORT : le corps HTTP a été ERONÉ par l'abandon (comportement
    // undici : le socket est détruit) — plus AUCUN delta n'est émis après.
    // La callback `cancel()` du source n'est invoquée que sur un flux ENCORE
    // lisible (cas break : preuve dédiée A4) — la spec Web Streams ne
    // l'appelle pas sur un flux déjà eroné.
    assert.ok(state.lastCall.deltasAtAbort !== null, 'l\u2019abandon a traversé jusqu\u2019au transport');
    assert.equal(state.lastCall.deltasEnqueued, state.lastCall.deltasAtAbort, 'ZÉRO delta émis après l\u2019abandon (transport mort, lecteur libéré)');
  });

  it('A1-G (CDC n°1) — Gemini : même propagation du signal d\u2019appelant jusqu\u2019au transport', async () => {
    const { fetchFn, state } = makeControlledTransport({ delayMs: 60, holdDone: true });
    state.events = GEMINI_EVENTS;
    const adapter = new GeminiProviderAdapter(fetchFn);
    const external = new AbortController();
    const chunks: string[] = [];
    const consumed = (async () => {
      for await (const chunk of adapter.generateStream(
        { tenantId: 'tenant-e3', projectId: 'proj-a1g', prompt: 'génère', signal: external.signal },
        GEMINI_CREDS
      )) {
        chunks.push(chunk);
      }
    })();
    await waitFor(() => chunks.length >= 1);
    external.abort();
    await assert.rejects(consumed, (err: unknown) => err instanceof AIProviderAbortedError);
    assert.ok(state.lastCall?.signal);
    assert.equal(state.lastCall.signal!.aborted, true, 'transport Gemini : abandon reçu');
    await settle(300);
    assert.ok(state.lastCall.deltasAtAbort !== null, 'l\u2019abandon a traversé jusqu\u2019au transport Gemini');
    assert.equal(state.lastCall.deltasEnqueued, state.lastCall.deltasAtAbort, 'Gemini : ZÉRO delta émis après l\u2019abandon');
  });

  it('A1-O (CDC n°1) — openai-compatible (registre) : même propagation', async () => {
    const { fetchFn, state } = makeControlledTransport({ delayMs: 60, holdDone: true });
    state.events = A_EVENTS.slice(0, 2);
    const adapter = createOpenAICompatibleAdapters(fetchFn)[0]!;
    const external = new AbortController();
    const chunks: string[] = [];
    const consumed = (async () => {
      for await (const chunk of adapter.generateStream(
        { tenantId: 'tenant-e3', projectId: 'proj-a1o', prompt: 'génère', signal: external.signal },
        OPENAI_CREDS
      )) {
        chunks.push(chunk);
      }
    })();
    await waitFor(() => chunks.length >= 1);
    external.abort();
    await assert.rejects(consumed, (err: unknown) => err instanceof AIProviderAbortedError);
    assert.ok(state.lastCall?.signal);
    assert.equal(state.lastCall.signal!.aborted, true, 'transport openai-compatible : abandon reçu');
    await settle(300);
    assert.ok(state.lastCall.deltasAtAbort !== null, 'l\u2019abandon a traversé jusqu\u2019au transport openai-compatible');
    assert.equal(state.lastCall.deltasEnqueued, state.lastCall.deltasAtAbort, 'openai-compatible : ZÉRO delta émis après l\u2019abandon');
  });

  it('A3 (CDC n°3) — Mistral : ZÉRO delta consommé après l\u2019abandon (preuve transport)', async () => {
    const { fetchFn, state } = makeControlledTransport({ delayMs: 60, holdDone: false });
    state.events = A_EVENTS; // 5 deltas espacés, puis [DONE]
    const adapter = new MistralProviderAdapter(fetchFn);
    const external = new AbortController();
    const chunks: string[] = [];
    const consumed = (async () => {
      for await (const chunk of adapter.generateStream(
        { tenantId: 'tenant-e3', projectId: 'proj-a3', prompt: 'génère', signal: external.signal },
        CREDS
      )) {
        chunks.push(chunk);
      }
    })();
    await waitFor(() => chunks.length >= 2);
    const atAbort = chunks.length;
    external.abort();
    await assert.rejects(consumed, (err: unknown) => err instanceof AIProviderAbortedError);
    await settle(400); // largement > 2 pas d'émission : rien ne peut plus arriver
    assert.ok(state.lastCall);
    assert.ok(chunks.length < A_EVENTS.length, 'flux stoppé avant la fin (pas de consommation complète)');
    assert.ok(state.lastCall.deltasEnqueued >= chunks.length, 'chaque delta consommé a bien été émis par le transport');
    assert.ok(state.lastCall.deltasAtAbort !== null, 'l\u2019abandon a traversé jusqu\u2019au transport');
    assert.equal(state.lastCall.deltasEnqueued, state.lastCall.deltasAtAbort, 'ZÉRO delta émis après l\u2019abandon (transport coupé pendant l\u2019attente)');
    assert.equal(chunks.length, atAbort, 'ZÉRO nouveau delta consommé après l\u2019abandon');
  });

  it('A4 (CDC n°4) — Mistral : sortie SIMPLE du for await libère aussi le lecteur (pas de socket résiduel)', async () => {
    const { fetchFn, state } = makeControlledTransport({ delayMs: 40, holdDone: false });
    state.events = A_EVENTS;
    const adapter = new MistralProviderAdapter(fetchFn);
    const chunks: string[] = [];
    for await (const chunk of adapter.generateStream(
      { tenantId: 'tenant-e3', projectId: 'proj-a4', prompt: 'génère' },
      CREDS
    )) {
      chunks.push(chunk);
      if (chunks.length >= 2) break; // le consommateur s'en va SANS abandon explicite
    }
    await settle(200);
    assert.ok(state.lastCall);
    assert.equal(state.lastCall.cancelSeen, true, 'reader.cancel() détruit le transport même sur break du consommateur');
  });

  it('A5 (CDC n°5) — un TIMEOUT n\u2019est pas une annulation utilisateur : AIProviderTimeoutError, signal d\u2019appelant intact', async () => {
    const { fetchFn, state } = makeControlledTransport({ delayMs: 250, holdDone: true });
    state.events = A_EVENTS.slice(0, 1);
    const adapter = new MistralProviderAdapter(fetchFn);
    const external = new AbortController(); // JAMAIS annulé par le test
    await assert.rejects(
      (async () => {
        for await (const _chunk of adapter.generateStream(
          { tenantId: 'tenant-e3', projectId: 'proj-a5', prompt: 'génère', timeoutMs: 80, signal: external.signal },
          CREDS
        )) { /* le premier delta peut arriver, le timeout suit */ }
      })(),
      (err: unknown) => {
        assert.ok(err instanceof AIProviderTimeoutError, 'timeout interne → AIProviderTimeoutError');
        assert.ok(!(err instanceof AIProviderAbortedError), 'un timeout n\u2019est JAMAIS classé « abandon appelant »');
        return true;
      }
    );
    assert.equal(external.signal.aborted, false, 'le timeout technique n\u2019annule pas le signal de l\u2019appelant');
    assert.ok(state.lastCall?.signal?.aborted, 'mais il coupe bien le transport en cours');
  });

  it('A6 (CDC n°6) — une erreur RÉSEAU n\u2019est pas une annulation utilisateur', async () => {
    const networkDown: typeof fetch = (async () => {
      throw new TypeError('fetch failed : réseau coupé');
    }) as typeof fetch;
    const adapter = new MistralProviderAdapter(networkDown);
    const external = new AbortController();
    await assert.rejects(
      (async () => {
        for await (const _chunk of adapter.generateStream(
          { tenantId: 'tenant-e3', projectId: 'proj-a6', prompt: 'génère', signal: external.signal },
          CREDS
        )) { /* aucun delta attendu */ }
      })(),
      (err: unknown) => {
        assert.ok(err instanceof AIProviderError, 'erreur réseau → AIProviderError (erreur transport)');
        assert.ok(!(err instanceof AIProviderAbortedError));
        assert.ok(!(err instanceof AIProviderTimeoutError));
        assert.match((err as Error).message, /réseau coupé/);
        return true;
      }
    );
    assert.equal(external.signal.aborted, false, 'l\u2019appelant n\u2019a pas annulé : le signal reste intact');
  });
});

// ==================== PARTIE B — /stream RÉEL (E2E, transport réactif) ====================

function sseBody(...parts: string[]): string {
  return parts
    .map((p) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n')
    .join('');
}
const DONE_CHUNK = 'data: [DONE]\n\n';
const SECTION_HERO = '<SECTION name="hero" mode="create"><h1>Boulangerie du Coin</h1><p>Pains au levain.</p></SECTION>';
const SECTION_MENU = '<SECTION name="menu" mode="create"><h2>Nos pains</h2><p>Baguette, campagne, seigle.</p></SECTION>';
const SECTION_CONTACT = '<SECTION name="contact" mode="create"><h2>Contact</h2><p>contact@exemple.fr</p></SECTION>';

/** Lecteur SSE incrémental (même protocole que la suite E2). */
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

function persistedRecord(id: string): Record<string, unknown> | undefined {
  const doc = readJsonFile<Record<string, Record<string, unknown>>>(dataFilePath('executions'), {});
  return doc[id];
}

describe('É53 LOT E3 — B. /stream réel : annulation acceptée, déconnexion, CAS B, simultané', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;

  interface E3Call {
    signal: AbortSignal | null;
    cancelSeen: boolean;
    deltasEnqueued: number;
    enqueueAfterAbort: number;
    /** index du dernier delta émis QUAND l'abandon a traversé le transport (null = jamais abandonné). */
    deltasAtAbort: number | null;
    /** vrai quand le flux a ATTEINT son hold (tenu ouvert) — release() est alors effectif. */
    held: boolean;
    /** libère le hold TENUS de CE flux précis (chaque call a le sien). */
    release: () => void;
  }
  const transport = {
    calls: [] as E3Call[],
    script: '',
    chunkDelayMs: 0,
    holdDone: true,
    releaseDone: () => {},
    closingDelayMs: 0
  };

  before(async () => {
    // Transport réactif : le corps est ERONÉ dès que le signal tombe (comme
    // undici détruit le socket). Preuves transport = signal.aborted +
    // deltasAtAbort (zéro émission après l'abandon) + cancel du flux quand
    // le flux est encore lisible.
    globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal | null; body?: unknown }) => {
      let wantsStream = true;
      try { wantsStream = JSON.parse(String(init?.body ?? '{}')).stream === true; } catch { /* défaut : flux */ }
      if (wantsStream) {
        const call: E3Call = {
          signal: (init?.signal as AbortSignal | null) ?? null,
          cancelSeen: false,
          deltasEnqueued: 0,
          enqueueAfterAbort: 0,
          deltasAtAbort: null,
          held: false,
          release: () => {}
        };
        transport.calls.push(call);
        const signal = call.signal;
        const events = transport.script.split('\n\n').filter(Boolean).map((e) => e + '\n\n');
        const encoder = new TextEncoder();
        const mkAbortErr = (): Error => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          return e;
        };
        // Comme undici : l'abandon ERONE le corps (socket détruit). On gèle
        // l'index du dernier delta émis à cet instant : preuve transport
        // « plus aucune émission après l'abandon ».
        const abortNow = (): Error => {
          if (call.deltasAtAbort === null) call.deltasAtAbort = call.deltasEnqueued;
          return mkAbortErr();
        };
        const sleep = (ms: number): Promise<void> => new Promise<void>((resolve, reject) => {
          const onAbort = () => { clearTimeout(t); reject(abortNow()); };
          const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
          signal?.addEventListener('abort', onAbort, { once: true });
        });
        const rs = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              if (signal?.aborted) { call.enqueueAfterAbort++; throw abortNow(); }
              for (const ev of events) {
                if (signal?.aborted) { call.enqueueAfterAbort++; throw abortNow(); }
                controller.enqueue(encoder.encode(ev));
                call.deltasEnqueued++;
                if (transport.chunkDelayMs > 0) await sleep(transport.chunkDelayMs);
              }
              if (transport.holdDone) {
                await new Promise<void>((resolve) => {
                  call.held = true;
                  transport.releaseDone = resolve;
                  call.release = () => resolve();
                  signal?.addEventListener('abort', () => resolve(), { once: true });
                });
                if (signal?.aborted) throw abortNow();
              }
              controller.enqueue(encoder.encode(DONE_CHUNK));
              controller.close();
            } catch (err) {
              try { controller.error(err instanceof Error ? err : new Error(String(err))); } catch { /* déjà fermé */ }
            }
          },
          cancel() { call.cancelSeen = true; }
        });
        return new Response(rs, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      // generate() non-stream (clôture LLM, classification d'intent...)
      if (transport.closingDelayMs > 0) await new Promise((r) => setTimeout(r, transport.closingDelayMs));
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '{"summary":"Clôture","suggestions":["A","B","C"]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => { baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port; resolve(); });
    });
  });

  after(async () => {
    globalThis.fetch = realFetch;
    transport.releaseDone();
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
      method: 'POST',
      headers: { ...H, Accept: 'text/event-stream' },
      body: JSON.stringify({ message, ...body })
    });
  }

  async function cancelExecution(projectId: string, executionId: string): Promise<Record<string, unknown>> {
    const r = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/executions/${executionId}/cancel`, { method: 'POST', headers: H });
    return (await r.json()) as Record<string, unknown>;
  }

  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'e53-e3-b', 'x-user-role': 'OWNER' };

  it('B2 (CDC n°2, n°3) — annulation ACCEPTÉE : transport coupé en plein appel, ⏹ unique, aucun token/done/error après', async () => {
    transport.calls = [];
    transport.script = sseBody('Voici votre boulangerie !\n\n', SECTION_HERO + '\n\n', SECTION_MENU + '\n\n', SECTION_CONTACT + '\n\n', 'Voilà, c\u2019est prêt !\n\n');
    transport.chunkDelayMs = 120; // fenêtre de course large et stable
    transport.holdDone = true;
    transport.closingDelayMs = 0;
    const projectId = await createProject('E3 B2 annulation acceptée coupe le transport');
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
      if (f.type === 'section_end') break; // la 1ʳᵉ section vient d'être posée
    }
    assert.ok(executionId, 'executionId reçu (frame start)');
    assert.ok(transport.calls.length >= 1, 'un appel LLM streaming est actif côté transport');

    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel.cancelled, true, 'annulation acceptée (CAS A)');

    // Le transport a bien reçu l'abandon DANS la fenêtre de course.
    const llmCall = transport.calls[0]!;
    await waitFor(() => llmCall.signal?.aborted === true, 4000);
    assert.equal(llmCall.signal!.aborted, true, 'PREUVE TRANSPORT : la requête LLM active a reçu le signal d\u2019abandon');
    // Le corps HTTP est ERONÉ par l'abandon (comportement undici : le socket
    // est détruit) — plus AUCUN delta n'est émis après. La callback `cancel()`
    // du source n'est invoquée que sur un flux ENCORE lisible (A4/B7) : la
    // spec Web Streams ne l'appelle pas sur un flux déjà eroné.
    await waitFor(() => llmCall.deltasAtAbort !== null, 4000);
    assert.equal(llmCall.deltasEnqueued, llmCall.deltasAtAbort, 'PREUVE TRANSPORT : ZÉRO delta émis après l\u2019abandon (socket du fournisseur coupé)');

    const postCancel: Array<Record<string, unknown>> = [];
    while (true) {
      const f = await reader.next();
      if (!f) break;
      postCancel.push(f);
    }
    const cancelledFrames = postCancel.filter((f) => f.type === 'cancelled');
    assert.equal(cancelledFrames.length, 1, 'exactement UNE frame ⏹ (garde E2 cancelFrameEmitted)');
    assert.equal(postCancel[postCancel.length - 1]?.type, 'cancelled', 'la DERNIÈRE frame est ⏹ — aucun done/error/closing après');
    assert.ok(!postCancel.some((f) => f.type === 'done'), 'aucun done après annulation gagnante');
    assert.ok(!postCancel.some((f) => f.type === 'error'), 'l\u2019abandon n\u2019est JAMAIS transformé en erreur LLM');
    assert.ok(!postCancel.some((f) => f.type === 'closing'), 'aucune clôture après annulation gagnante');

    const record = persistedRecord(executionId);
    assert.ok(record, 'record persisté (timeline ON)');
    await waitFor(() => persistedRecord(executionId)?.['status'] === 'CANCELLED', 5000);
    assert.equal(persistedRecord(executionId)!['status'], 'CANCELLED', 'issue = CANCELLED (arbitrage E1), pas FAILED');
    assert.equal(await fileContent(projectId), htmlBefore, 'aucune mutation du fichier (annulation gagnante)');
  });

  it('B7 (CDC n°7) — CAS B : annulation REFUSÉE après persistance → AUCUN abandon du transport, tour complet', async () => {
    transport.calls = [];
    transport.script = sseBody('Conception !\n\n', SECTION_HERO + '\n\n', SECTION_MENU + '\n\n', 'Terminé !\n\n');
    transport.chunkDelayMs = 0;
    transport.holdDone = false; // le flux se termine normalement
    transport.closingDelayMs = 600; // fenêtre déterministe APRÈS le done (clôture en attente)
    const projectId = await createProject('E3 B7 CAS B refus honnête');

    const res = await openStream(projectId, 'Crée un site de boulangerie', { isModification: false });
    assert.equal(res.status, 200);
    const reader = frameReader(res);
    const frames: Array<Record<string, unknown>> = [];
    let executionId = '';
    let sawDone = false;
    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
      if (!executionId && typeof f.executionId === 'string') executionId = f.executionId;
      if (f.type === 'done') { sawDone = true; break; } // le done = la persistance a gagné
    }
    assert.ok(executionId && sawDone, 'done reçu (persistance validée)');

    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel.cancelled, false, 'refus honnête (CAS B)');
    assert.equal(cancel.reason, 'persistence_already_validated');

    // PREUVE TRANSPORT : la requête LLM (déjà terminée) n'a JAMAIS été abandonnée
    // et la clôture suit normalement.
    assert.ok(transport.calls.length >= 1);
    const casBCall = transport.calls[0]!;
    assert.equal(casBCall.signal?.aborted, false, 'CAS B : AUCUN abandon (le drapeau n\u2019est jamais posé)');
    assert.equal(casBCall.deltasAtAbort, null, 'CAS B : le flux s\u2019est épuisé NORMALEMENT (aucune émission refusée par un abandon)');

    while (true) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
    }
    assert.ok(frames.some((f) => f.type === 'closing'), 'la clôture suit normalement après le refus CAS B');
    assert.ok(frames.some((f) => f.type === 'done'), 'le done initial est préservé');
    assert.ok(!frames.some((f) => f.type === 'cancelled'), 'aucune frame ⏹ (annulation refusée)');
    assert.ok(!frames.some((f) => f.type === 'error'), 'aucune erreur fabriquée');

    await waitFor(() => persistedRecord(executionId)?.['status'] === 'COMPLETED', 20000);
    const record = persistedRecord(executionId);
    assert.equal(record!['status'], 'COMPLETED', 'le tour suit sa vérité réelle : COMPLETED');
    const html = await fileContent(projectId);
    assert.ok(html.includes('Boulangerie du Coin'), 'mutation appliquée (persistance gagnante)');
  });

  it('B8 (CDC n°8) — deux tours SIMULTANÉS : signaux distincts, annuler A n\u2019interrompt pas B', async () => {
    transport.calls = [];
    transport.script = sseBody('Voici votre site !\n\n', SECTION_HERO + '\n\n', SECTION_MENU + '\n\n', SECTION_CONTACT + '\n\n', 'Voilà !\n\n');
    transport.chunkDelayMs = 120;
    transport.holdDone = true;
    transport.closingDelayMs = 0;
    const projectA = await createProject('E3 B8 tour A (annulé)');
    const projectB = await createProject('E3 B8 tour B (témoin)');
    const htmlBeforeB = await fileContent(projectB);

    // Messages SUFFISAMMENT précis pour éviter la voie clarification locale
    // (le pipeline pose une question au lieu de générer si la demande est
    // trop vague) : deux tours de GÉNération simultanés, comme le CDC n°8.
    const resA = await openStream(projectA, 'Crée un site de boulangerie', { isModification: false });
    const resB = await openStream(projectB, 'Crée un site de boulangerie artisanal', { isModification: false });
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    const readerA = frameReader(resA);
    const readerB = frameReader(resB);

    let execA = '';
    while (true) {
      const f = await readerA.next();
      if (!f) break;
      if (!execA && typeof f.executionId === 'string') execA = f.executionId;
      if (f.type === 'section_end') break;
    }
    let execB = '';
    while (true) {
      const f = await readerB.next();
      if (!f) break;
      if (!execB && typeof f.executionId === 'string') execB = f.executionId;
      if (f.type === 'section_end') break;
    }
    assert.ok(execA && execB, 'les deux tours sont actifs');
    assert.notEqual(execA, execB, 'deux exécutions distinctes');
    // Les deux requêtes LLM sont actives côté transport (B démarre quelques
    // centaines de ms après A : checkPoints + recherche d'images).
    await waitFor(() => transport.calls.length >= 2, 8000);
    assert.ok(transport.calls.length >= 2, 'deux requêtes LLM streaming actives');

    const cancel = await cancelExecution(projectA, execA);
    assert.equal(cancel.cancelled, true);

    // PREUVE TRANSPORT : deux signaux DISTINCTS (jamais partagés entre tours).
    assert.ok(transport.calls.length >= 2, 'deux requêtes LLM streaming actives');
    await waitFor(() => transport.calls.some((c) => c.signal?.aborted === true), 4000);
    const abortedCalls = transport.calls.filter((c) => c.signal?.aborted === true);
    assert.equal(abortedCalls.length, 1, 'UN SEUL tour est abandonné (celui qui a demandé l\u2019annulation)');
    const callA = transport.calls[0]!;
    const callBWitness = transport.calls[1]!;
    assert.ok(callA.signal !== callBWitness.signal, 'chaque tour a son propre AbortSignal');
    const callB = transport.calls.find((c) => c.signal?.aborted === false);
    assert.ok(callB, 'le transport du tour B est identifiable (jamais abandonné)');

    // On libère le flux TENU du tour témoin (hold INDIVIDUEL du call de B) —
    // B reçoit son [DONE] et suit sa course normale pendant que A est
    // interrompu. L'ordre des fetchs LLM étant non déterministe entre les
    // deux tours, on libère le call PRÉCIS qui n'a pas été abandonné, et on
    // attend que son flux ait REJOINT son hold (release() est sans effet
    // tant que le flux tient les events en cours d'émission).
    await waitFor(() => callB.held === true, 10000);
    callB.release();

    // A : ⏹ unique, aucun done/error.
    const postA: Array<Record<string, unknown>> = [];
    while (true) {
      const f = await readerA.next();
      if (!f) break;
      postA.push(f);
    }
    assert.equal(postA.filter((f) => f.type === 'cancelled').length, 1, 'A : exactement une frame ⏹');
    assert.ok(!postA.some((f) => f.type === 'done'), 'A : aucun done après annulation');
    assert.ok(!postA.some((f) => f.type === 'error'), 'A : aucune erreur fabriquée');
    await waitFor(() => persistedRecord(execA)?.['status'] === 'CANCELLED', 5000);
    assert.equal(persistedRecord(execA)!['status'], 'CANCELLED');

    // B : le tour témoin se termine NORMALEMENT (done + fichier écrit).
    const postB: Array<Record<string, unknown>> = [];
    while (true) {
      const f = await readerB.next();
      if (!f) break;
      postB.push(f);
    }
    assert.ok(postB.some((f) => f.type === 'done'), 'B : terminaison normale (done)');
    assert.ok(!postB.some((f) => f.type === 'cancelled'), 'B : aucune ⏹');
    await waitFor(() => persistedRecord(execB)?.['status'] === 'COMPLETED', 20000);
    assert.equal(persistedRecord(execB)!['status'], 'COMPLETED', 'B : COMPLETED');
    assert.notEqual(await fileContent(projectB), htmlBeforeB, 'B : mutation appliquée normalement');
  });

  it('B9 (CDC n°9) — DÉCONNEXION CLIENT : interruption réelle du transport (signal coupé), issue CANCELLED client_gone', async () => {
    transport.calls = [];
    transport.script = sseBody('Voici votre boulangerie !\n\n', SECTION_HERO + '\n\n', SECTION_MENU + '\n\n', SECTION_CONTACT + '\n\n', 'Voilà !\n\n');
    transport.chunkDelayMs = 120;
    transport.holdDone = true;
    transport.closingDelayMs = 0;
    const projectId = await createProject('E3 B9 déconnexion client');

    // VRAIE déconnexion client : socket HTTP brut détruit net (comme un
    // onglet fermé). Un simple AbortSignal de fetch keep-alive ne prévient
    // pas toujours le serveur à temps pour prouver l'interruption.
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
            `x-tenant-id: e53-e3-b\r\nx-user-role: OWNER\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
          );
          resolve(sk);
        }
      );
      sk.on('error', reject);
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => { raw += chunk; });
    // Le tour démarre : la frame start porte l'executionId.
    await waitFor(() => /"executionId":"req_/.test(raw), 10000);
    const executionId = raw.match(/"executionId":"(req_[A-Za-z0-9_]+)"/)![1]!;

    // La requête LLM est ACTIVE côté transport (checkpoints passés, au moins
    // un delta émis par le fournisseur).
    await waitFor(() => transport.calls.length >= 1, 10000);
    const b9Call = transport.calls[0]!;
    await waitFor(() => b9Call.deltasEnqueued >= 1, 10000);

    // Le client RACCROCHE (socket détruit) — le serveur doit couper le
    // transport LLM, pas seulement cesser de lire.
    socket.destroy();
    await waitFor(() => b9Call.signal?.aborted === true, 5000);
    assert.equal(b9Call.signal!.aborted, true, 'PREUVE TRANSPORT : la déconnexion client a coupé la requête LLM active');
    await waitFor(() => b9Call.deltasAtAbort !== null, 5000);
    assert.equal(b9Call.deltasEnqueued, b9Call.deltasAtAbort, 'PREUVE TRANSPORT : ZÉRO delta émis après la déconnexion (socket fournisseur coupé)');

    await waitFor(() => persistedRecord(executionId)?.['status'] === 'CANCELLED', 5000);
    const record = persistedRecord(executionId);
    assert.ok(record, 'record persisté');
    assert.equal(record!['status'], 'CANCELLED', 'issue honnête : CANCELLED (client_gone), jamais FAILED');
  });

  it('B10 (CDC n°10) — TERMINAISON NORMALE : aucun abandon, done + clôture + mutation intacte', async () => {
    transport.calls = [];
    transport.script = sseBody('Conception !\n\n', SECTION_HERO + '\n\n', SECTION_MENU + '\n\n', SECTION_CONTACT + '\n\n', 'Voilà !\n\n');
    transport.chunkDelayMs = 40;
    transport.holdDone = false;
    transport.closingDelayMs = 0;
    const projectId = await createProject('E3 B10 terminaison normale');

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
    }
    assert.ok(executionId, 'executionId reçu');
    assert.ok(frames.some((f) => f.type === 'done'), 'done émis');
    assert.ok(frames.some((f) => f.type === 'closing'), 'clôture émise');
    assert.ok(!frames.some((f) => f.type === 'cancelled'), 'aucune ⏹');
    assert.ok(!frames.some((f) => f.type === 'error'), 'aucune erreur');

    assert.ok(transport.calls.length >= 1);
    assert.equal(transport.calls[0]!.signal?.aborted, false, 'terminaison normale : AUCUN abandon (signal jamais armé)');
    await waitFor(() => persistedRecord(executionId)?.['status'] === 'COMPLETED', 20000);
    const record = persistedRecord(executionId);
    assert.equal(record!['status'], 'COMPLETED');
    const html = await fileContent(projectId);
    assert.ok(html.includes('Boulangerie du Coin'), 'fichier écrit normalement');
    assert.ok(html.includes('Nos pains'), 'sections assemblées');
  });
});
