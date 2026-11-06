/**
 * BANCHA TTF (time-to-first-frame) — reproduit la mesure du test
 * conversation-question-planfirst #4 (P2-SIGNAUX) HORS node:test :
 * mock fetch AVANT createApiServer (même ordre), POST /projects,
 * POST /sessions, POST /stream → temps du premier `data:`.
 * Utilisé pour le diagnostic du 2026-11-03 (premier signal > 1 s).
 */
import './_lot-b-legacy-env.js';

import assert from 'node:assert/strict';

let sseBody = '';
process.env.MISTRAL_API_KEY = 'test-key-conv-audit';

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  return new Response(sseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
});

const { createApiServer } = await import('../src/server.js');

const instance = createApiServer({ port: 0 });
const server = instance.server;

// INSTRUMENTATION — mesure au plus près des persist avant/après 'start'
const storeMod = await import('../../../packages/core/src/ai-native/execution/store.js');
const store = storeMod.executionStore;
const stats = { persist: 0, persistMs: 0, start: 0, startMs: 0, ev: 0, evMs: 0 };
const origPersist = store.persist.bind(store);
store.persist = function () {
  const t = process.hrtime.bigint();
  const r = origPersist();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  stats.persist += 1; stats.persistMs += ms;
  return r;
};
const origStart = store.startExecution.bind(store);
store.startExecution = function (input) {
  const t = process.hrtime.bigint();
  const r = origStart(input);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  stats.start += 1; stats.startMs += ms;
  return r;
};
const origAppend = store.appendEvent.bind(store);
store.appendEvent = function (id, ev) {
  const t = process.hrtime.bigint();
  const r = origAppend(id, ev);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  stats.ev += 1; stats.evMs += ms;
  return r;
};
process.on('exit', () => {
  console.log(`STORE-PERF ${JSON.stringify(stats)}`);
});
await new Promise((resolve) => server.listen(0, resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'conv-reg-t1', 'x-user-role': 'OWNER' };

synchronizedCalls();
function synchronizedCalls() {
  sseBody = 'data: {"choices":[{"delta":{"content":"<SECTION name=\\"hero\\" mode=\\"create\\"><h1>Salut</h1></SECTION>"}}]}\n\n' + 'data: [DONE]\n\n';
}

async function run(name) {
  const p = await realFetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'conv-reg' }) });
  const pj = await p.json();
  const s = await realFetch(`${baseUrl}/api/v1/projects/${pj.project.id}/conversation/sessions`, { method: 'POST', headers: H, body: '{}' });
  const sj = await s.json();
  const sid = (sj.session && sj.session.sessionId) || sj.sessionId;
  assert.ok(sid, 'sessionId présent');
  const t0 = Date.now();
  const res = await realFetch(
    `${baseUrl}/api/v1/projects/${pj.project.id}/conversation/sessions/${sid}/stream`,
    { method: 'POST', headers: { ...H, Accept: 'text/event-stream' }, body: JSON.stringify({ message: 'Crée une page vitrine' }) }
  );
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let firstDataAt = 0;
  let firstType = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      if (!firstDataAt) {
        firstDataAt = Date.now();
        try { firstType = JSON.parse(trimmed.slice(5).trim()).type; } catch {}
      }
    }
    if (firstDataAt) break;
  }
  try { await reader.cancel(); } catch {}
  console.log(`${name}: firstSignal=${firstDataAt ? firstDataAt - t0 + ' ms' : 'AUCUN'} type=${firstType}`);
  return firstDataAt - t0;
}

setImmediate(async () => {
  const a = await run('PASSE-1');
  const b = await run('PASSE-2');
  server.close(() => {
    console.log(`RESULT passes=${a},${b}`);
    process.exit(0);
  });
});
