/**
 * É53 LOT E4.1 — CHAÎNE D'AGENTS SPÉCIALISÉS : interruption réelle (E2E).
 *
 * La chaîne (Agent UI → Agent Backend → Agent Sécurité, via runAgentGeneration
 * Pipeline) reçoit le MÊME signal du tour que le streaming E3. Le transport
 * contrôlé route les appels d'agents par la signature du body (max_tokens
 * 8192 + marqueur « agent spécialisé » dans le systemPrompt → kind 'agent') ;
 * le MÊME flux scripté est servi aux trois agents (UI le produit, Backend le
 * recâble, Sécurité le renvoie à l'identique — comme en production où chaque
 * étape renvoie le flux complet).
 *
 *   - C1 : annulation utilisateur ACCEPTÉE pendant l'appel de l'Agent UI
 *          (transport tenu) → le signal arme le transport EN PLEIN APPEL,
 *          l'abandon remonte (agent → pipeline), AUCUNE étape Backend/
 *          Sécurité ne démarre, AUCUN appel streaming de repli n'est lancé,
 *          ⏹ unique et record CANCELLED (arbitrage E1/E2 — issue honnête).
 *   - C2 : chaîne NORMALE (aucune annulation) → 3 appels d'agents portent le
 *          signal NON armé, le flux de la chaîne est réinjecté comme source
 *          (AUCUN appel streaming direct), le fichier est écrit, done+closing
 *          et record COMPLETED — la chaîne qui réussit ne coûte aucun appel
 *          direct.
 *   - C3 : DEUX tours séquentiels sur la MÊME session : l'abandon du tour A
 *          pendant l'Agent UI donne ⏹ + CANCELLED pour A UNIQUEMENT ; le tour
 *          B s'exécute intégralement (done + closing + COMPLETED + fichier
 *          écrit) — les signaux des deux tours sont DISTINCTS (aucun
 *          AbortController partagé entre tours, E4.1 = propagation, jamais
 *          une nouvelle autorité d'annulation).
 *
 * PORTE DE LA CHAÎNE (pipeline l.288) : sous node --test, NODE_TEST_CONTEXT
 * est défini et désactive la chaîne. Ce fichier la SUPPRIME de son
 * environnement (lecture à l'appel — le delete en tête suffit) pour tester la
 * chaîne réelle ; VOLACO_AGENT_CHAIN est aussi nettoyé par précaution.
 */
import './_lot-b-legacy-env.js';

// PORTE DE LA CHAÎNE — supprimée AVANT toute requête (le gate lit
// process.env à chaque appel de runAgentGenerationPipeline).
delete process.env.NODE_TEST_CONTEXT;
delete process.env.VOLACO_AGENT_CHAIN;
process.env.MISTRAL_API_KEY = 'test-key-e53-e41-chain';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { dataFilePath, readJsonFile } from '../../../packages/core/src/persistence/json-disk-cache.js';

/** Lecteur SSE incrémental (même protocole que la suite E3/F1). */
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

/** Flux d'agent scripté : DESIGN_DNA + PAGE_TITLE + narration + 3 sections
 * (>200 chars, marqueurs <SECTION présents, AUCUNE URL externe — le
 * garde-fou d'exfiltration le laisse passer). Le MÊME flux est servi aux
 * trois agents : l'UI le produit, Backend/ Sécurité le renvoient à
 * l'identique (chaque étape renvoie le flux complet, comme en production). */
const AGENT_FLUX = [
  '<!-- DESIGN_DNA: {"palette":{"bg":"#faf6f0","fg":"#2b2118","accent":"#b45309"},"font":"Georgia","mode":"light"} -->',
  '<!-- PAGE_TITLE: Boulangerie du Coin -->',
  'Voici la page de votre boulangerie, pensée avec soin et livrée en trois rubriques.',
  '<SECTION name="hero" mode="create"><h1>Boulangerie du Coin</h1><p>Pains au levain cuits au feu de bois chaque matin.</p></SECTION>',
  '<SECTION name="menu" mode="create"><h2>Nos pains</h2><p>Baguette tradition, campagne, seigle, pain aux noix.</p></SECTION>',
  '<SECTION name="contact" mode="create"><h2>Contact</h2><p>contact@exemple.fr — 01 23 45 67 89.</p></SECTION>',
  'Toutes les rubriques sont en place, bonne dégustation !'
].join('\n') + '\n';

describe('É53 LOT E4.1 — CH. chaîne d agents : annulation réelle pendant les appels LLM des agents', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;

  type JsonKind = 'classify' | 'closing' | 'regen' | 'agent' | 'unknown';
  interface JsonCall {
    kind: JsonKind;
    signal: AbortSignal | null;
    held: boolean;
    release: () => void;
    maxTokens: number;
  }
  interface StreamCall {
    signal: AbortSignal | null;
    held: boolean;
    release: () => void;
  }
  const transport = {
    streamCalls: [] as StreamCall[],
    jsonCalls: [] as JsonCall[],
    holds: { classify: false, closing: false, regen: false, agent: false } as { [k in JsonKind]?: boolean }
  };

  before(async () => {
    // Transport contrôlé installé AVANT createApiServer (les adapters
    // capturent fetch à leur construction — même protocole que E3/F1).
    globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal | null; body?: unknown }) => {
      let body: { stream?: boolean; max_tokens?: number; messages?: Array<{ role?: string; content?: string }> } = {};
      try { body = JSON.parse(String(init?.body ?? '{}')) as typeof body; } catch { /* défaut */ }
      const signal = (init?.signal as AbortSignal | null) ?? null;
      const mkAbortErr = (): Error => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        return e;
      };

      // --- Appel streaming (jamais attendu quand la chaîne réussit) -------
      if (body.stream === true) {
        const call: StreamCall = { signal, held: false, release: () => {} };
        transport.streamCalls.push(call);
        await new Promise<void>((resolve) => {
          call.held = true;
          call.release = resolve;
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        if (signal?.aborted) throw mkAbortErr();
        const encoder = new TextEncoder();
        const rs = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"flux direct inattendu"}}]}\n\n'));
            controller.close();
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

      if (transport.holds[kind]) {
        await new Promise<void>((resolve) => {
          call.held = true;
          call.release = resolve;
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        if (signal?.aborted) throw mkAbortErr();
      }

      const content = kind === 'classify'
        ? '{"category": "CREATE", "urgency": "NORMAL", "confidence": 0.9}'
        : kind === 'closing'
        ? '{"summary": "Chaîne terminée, site livré", "suggestions": ["Retoucher le hero", "Ajouter une carte", "Voir le contact"]}'
        : kind === 'agent'
        ? AGENT_FLUX
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

  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'e53-e41-chain', 'x-user-role': 'OWNER' };

  async function createProject(name: string): Promise<string> {
    const p = await realFetch(baseUrl + '/api/v1/projects', { method: 'POST', headers: H, body: JSON.stringify({ name }) });
    const pj = (await p.json()) as { project: { id: string } };
    return pj.project.id;
  }

  async function createSession(projectId: string): Promise<string> {
    const s = await realFetch(baseUrl + '/api/v1/projects/' + projectId + '/conversation/sessions', { method: 'POST', headers: H, body: '{}' });
    const sj = (await s.json()) as { session: { sessionId: string } };
    return sj.session.sessionId;
  }

  async function streamOn(projectId: string, sessionId: string, message: string, signal?: AbortSignal): Promise<Response> {
    return realFetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`, {
      method: 'POST',
      headers: { ...H, Accept: 'text/event-stream' },
      body: JSON.stringify({ message }),
      ...(signal !== undefined ? { signal } : {})
    });
  }

  async function cancelExecution(projectId: string, executionId: string): Promise<Record<string, unknown>> {
    const r = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/executions/${executionId}/cancel`, { method: 'POST', headers: H });
    return (await r.json()) as Record<string, unknown>;
  }

  async function fileContent(projectId: string): Promise<string> {
    const f = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, { headers: H });
    const fd = (await f.json()) as { file?: { content?: string } };
    return fd.file?.content ?? '';
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

  /** Extrait l'executionId : le recorder (E2) enrichit CHAQUE frame post-start
   * avec executionId — on lit les premières frames et on s'arrête dès la
   * première enrichie (jamais jusqu'à la fin du flux, qui reste ouvert). */
  async function readExecutionId(reader: ReturnType<typeof frameReader>): Promise<string> {
    for (;;) {
      const f = await reader.next();
      if (!f) return '';
      if (typeof f.executionId === 'string' && (f.executionId as string).length > 0) {
        return f.executionId as string;
      }
    }
  }

  it('C1 — CANCEL pendant l Agent UI (transport tenu) : ⏹ unique, CANCELLED, 1 appel agent, 0 appel direct', async () => {
    transport.streamCalls = [];
    transport.jsonCalls = [];
    transport.holds = { classify: false, closing: false, regen: false, agent: true };

    const projectId = await createProject('E41 C1 cancel pendant l Agent UI');
    const sessionId = await createSession(projectId);
    const res = await streamOn(projectId, sessionId, 'Crée un site de boulangerie');
    assert.equal(res.status, 200);
    const reader = frameReader(res);

    // L'Agent UI est EN COURS côté transport (appel tenu, signal porté).
    await waitFor(() => transport.jsonCalls.some((c) => c.kind === 'agent' && c.held === true), 20000);
    const agentCall = transport.jsonCalls.find((c) => c.kind === 'agent')!;
    assert.ok(agentCall.signal, 'PREUVE TRANSPORT : l appel de l Agent UI porte un AbortSignal (E4.1)');
    assert.equal(agentCall.signal?.aborted, false, 'signal NON armé avant l annulation');

    // L'annulation arrive PENDANT l'appel : CAS A accepté (aucune mutation) —
    // le watcher de la route arme l'abandon du tour (signal partagé).
    const executionId = await readExecutionId(reader);
    assert.ok(executionId, 'executionId reçu (frame enrichie)');

    const cancel = await cancelExecution(projectId, executionId);
    assert.equal(cancel.cancelled, true, 'CAS A : annulation acceptée pendant l Agent UI');

    await waitFor(() => agentCall.signal?.aborted === true, 5000);
    assert.equal(agentCall.signal!.aborted, true, 'PREUVE TRANSPORT : l annulation a coupé l appel de l Agent UI EN PLEIN APPEL');

    // Issue du tour : ⏹ unique (arbitrage E1), jamais done/error, et la
    // chaîne ne redémarre AUCUN travail (ni Backend/Sécurité, ni repli direct).
    const rest = await readUntilType(reader, 'cancelled');
    const cancelledFrames = rest.filter((f) => f.type === 'cancelled');
    assert.equal(cancelledFrames.length, 1, 'exactement UNE frame ⏹');
    assert.ok(!rest.some((f) => f.type === 'done'), 'aucun done après annulation');
    assert.ok(!rest.some((f) => f.type === 'error'), 'l abandon n est jamais une erreur LLM');

    await waitFor(() => persistedRecord(executionId)?.['status'] === 'CANCELLED', 5000);
    assert.equal(persistedRecord(executionId)!.status, 'CANCELLED', 'issue honnête : CANCELLED (user_cancel)');

    // PREUVES DE NON-PROPAGATION AU-DELÀ DE L'ABANDON :
    assert.equal(transport.jsonCalls.filter((c) => c.kind === 'agent').length, 1, 'EXACTEMENT UN appel d agent (Backend/Sécurité jamais lancés)');
    assert.equal(transport.jsonCalls.filter((c) => c.kind === 'closing').length, 0, 'aucun appel de clôture (le tour annulé n y arrive jamais)');
    assert.equal(transport.streamCalls.length, 0, 'AUCUN appel streaming de repli (le pré-check E3 a refusé le démarrage)');
  });

  it('C2 — chaîne NORMALE : 3 agents avec signal non armé, flux réinjecté (0 streaming), fichier écrit, COMPLETED', async () => {
    transport.streamCalls = [];
    transport.jsonCalls = [];
    transport.holds = { classify: false, closing: false, regen: false, agent: false };

    const projectId = await createProject('E41 C2 chaîne normale complète');
    const sessionId = await createSession(projectId);
    const res = await streamOn(projectId, sessionId, 'Crée un site de boulangerie');
    assert.equal(res.status, 200);
    const reader = frameReader(res);

    // La chaîne tourne : les TROIS agents répondent (même flux scripté).
    await waitFor(() => transport.jsonCalls.filter((c) => c.kind === 'agent').length === 3, 30000);
    const agentCalls = transport.jsonCalls.filter((c) => c.kind === 'agent');
    assert.equal(agentCalls.length, 3, 'les trois étapes (UI → Backend → Sécurité) ont appelé le transport');
    for (const call of agentCalls) {
      assert.ok(call.signal, 'chaque appel d agent porte un AbortSignal (E4.1)');
      assert.equal(call.signal?.aborted, false, 'aucun signal armé (aucune annulation demandée)');
      assert.equal(call.maxTokens, 8192, 'budget d agent réel (8192 tokens)');
    }

    // Fin du tour : tout lire jusqu'à la fermeture du flux.
    const frames: Array<Record<string, unknown>> = [];
    for (;;) {
      const f = await reader.next();
      if (!f) break;
      frames.push(f);
    }
    const doneFrame = frames.find((f) => f.type === 'done') as Record<string, unknown> | undefined;
    assert.ok(doneFrame, 'frame done reçue');
    assert.equal(doneFrame!['updated'], true, 'le fichier a été écrit (flux de la chaîne appliqué)');
    const closingFrame = frames.find((f) => f.type === 'closing') as Record<string, unknown> | undefined;
    assert.ok(closingFrame, 'frame closing reçue');
    assert.equal(closingFrame!['source'], 'llm', 'clôture LLM réelle');
    assert.ok(!frames.some((f) => f.type === 'cancelled'), 'aucun ⏹ (tour complet)');

    const executionFrame = frames.find((f) => typeof f.executionId === 'string') as Record<string, unknown> | undefined;
    const executionId = String(executionFrame?.executionId ?? '');
    assert.ok(executionId, 'executionId reçu');
    await waitFor(() => persistedRecord(executionId)?.['status'] === 'COMPLETED', 10000);
    assert.equal(persistedRecord(executionId)!.status, 'COMPLETED', 'record COMPLETED (persistance validée)');

    // Le fichier porte les sections de la chaîne (h1/h2 réels).
    const html = await fileContent(projectId);
    assert.ok(html.includes('Boulangerie du Coin'), 'section hero écrite (flux de la chaîne)');
    assert.ok(html.includes('Nos pains'), 'section menu écrite');
    assert.ok(html.includes('Contact'), 'section contact écrite');

    // PREUVE D'ARCHITECTURE : la chaîne qui réussit ne lance AUCUN appel
    // streaming direct (le texte de la chaîne est réinjecté comme source).
    assert.equal(transport.streamCalls.length, 0, 'AUCUN appel streaming (le flux vient de la chaîne)');
    assert.equal(transport.jsonCalls.filter((c) => c.kind === 'closing').length, 1, 'exactement UNE clôture');
  });

  it('C3 — DEUX tours séquentiels (même session) : ⏹ pour A, tour B complet, signaux DISTINCTS', async () => {
    transport.streamCalls = [];
    transport.jsonCalls = [];
    transport.holds = { classify: false, closing: false, regen: false, agent: true };

    const projectId = await createProject('E41 C3 deux tours signaux distincts');
    const sessionId = await createSession(projectId);

    // ---- Tour A : cancel pendant l Agent UI (transport tenu) -------------
    const resA = await streamOn(projectId, sessionId, 'Crée un site de boulangerie');
    assert.equal(resA.status, 200);
    const readerA = frameReader(resA);
    await waitFor(() => transport.jsonCalls.some((c) => c.kind === 'agent' && c.held === true), 20000);
    const agentCallA = transport.jsonCalls.find((c) => c.kind === 'agent')!;

    const executionIdA = await readExecutionId(readerA);
    assert.ok(executionIdA, 'tour A : executionId reçu');

    const cancelA = await cancelExecution(projectId, executionIdA);
    assert.equal(cancelA.cancelled, true, 'tour A : annulation acceptée');
    await waitFor(() => agentCallA.signal?.aborted === true, 5000);
    assert.equal(agentCallA.signal!.aborted, true, 'tour A : signal armé pendant l appel de l Agent UI');

    const restA = await readUntilType(readerA, 'cancelled');
    assert.equal(restA.filter((f) => f.type === 'cancelled').length, 1, 'tour A : ⏹ unique');
    assert.ok(!restA.some((f) => f.type === 'done'), 'tour A : aucun done après annulation');
    await waitFor(() => persistedRecord(executionIdA)?.['status'] === 'CANCELLED', 5000);
    assert.equal(persistedRecord(executionIdA)!.status, 'CANCELLED', 'tour A : record CANCELLED');
    assert.equal(transport.jsonCalls.filter((c) => c.kind === 'agent').length, 1, 'tour A : Backend/Sécurité jamais lancés');

    // ---- Tour B : la même session se poursuit INTÈGRE --------------------
    transport.holds = { classify: false, closing: false, regen: false, agent: false };
    const resB = await streamOn(projectId, sessionId, 'Crée un site de boulangerie');
    assert.equal(resB.status, 200, 'tour B : le flux démarre normalement après l annulation du tour A');
    const readerB = frameReader(resB);
    await waitFor(() => transport.jsonCalls.filter((c) => c.kind === 'agent').length === 4, 30000);
    const agentCallsB = transport.jsonCalls.filter((c) => c.kind === 'agent').slice(1);
    assert.equal(agentCallsB.length, 3, 'tour B : les trois agents tournent');

    // PREUVE D'ISOLEMENT : le signal du tour B est une AUTRE instance que
    // celui du tour A (aucun AbortController partagé entre tours), et il
    // n'a JAMAIS été armé.
    assert.notEqual(agentCallsB[0]!.signal, agentCallA.signal, 'les signaux des deux tours sont DISTINCTS (aucune autorité partagée)');
    for (const call of agentCallsB) {
      assert.equal(call.signal?.aborted, false, 'tour B : aucun signal armé (l abandon du tour A ne rejaillit pas)');
    }

    const framesB: Array<Record<string, unknown>> = [];
    for (;;) {
      const f = await readerB.next();
      if (!f) break;
      framesB.push(f);
    }
    const doneFrameB = framesB.find((f) => f.type === 'done') as Record<string, unknown> | undefined;
    assert.ok(doneFrameB, 'tour B : frame done reçue');
    assert.equal(doneFrameB!['updated'], true, 'tour B : fichier écrit');
    assert.ok(framesB.some((f) => f.type === 'closing'), 'tour B : clôture émise');
    assert.ok(!framesB.some((f) => f.type === 'cancelled'), 'tour B : aucun ⏹');

    const executionFrameB = framesB.find((f) => typeof f.executionId === 'string') as Record<string, unknown> | undefined;
    const executionIdB = String(executionFrameB?.executionId ?? '');
    assert.ok(executionIdB, 'tour B : executionId reçu');
    assert.notEqual(executionIdB, executionIdA, 'tour B : exécution DISTINCTE du tour A');
    await waitFor(() => persistedRecord(executionIdB)?.['status'] === 'COMPLETED', 10000);
    assert.equal(persistedRecord(executionIdB)!.status, 'COMPLETED', 'tour B : record COMPLETED');

    const htmlB = await fileContent(projectId);
    assert.ok(htmlB.includes('Boulangerie du Coin'), 'tour B : sections écrites (la session s est remise de l annulation)');
    assert.equal(transport.streamCalls.length, 0, 'AUCUN appel streaming sur les deux tours (le flux vient de la chaîne)');
  });
});
