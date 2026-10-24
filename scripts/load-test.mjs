#!/usr/bin/env node
/**
 * Test de charge CDC §47 — capacité réelle avant casse.
 * Zéro dépendance : fetch + performance.now. Rampe de concurrence par classe
 * d'endpoint (lecture, écriture), mesure RPS + p50/p95/p99 + taux d'erreur,
 * verdict « concurrence max sans dégradation ». Cleanup complet à la fin.
 *
 * Usage : node scripts/load-test.mjs [baseUrl]   (défaut http://localhost:3000)
 */

const BASE = process.argv[2] || 'http://localhost:3000';
const TENANT = 'tenant_loadtest';
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': TENANT, 'x-user-role': 'ENGINEER' };
const READ_STAGES = [1, 5, 10, 25, 50, 100, 200];
const WRITE_STAGES = [1, 5, 10, 25, 50];
const STAGE_MS = 4000;

const percentiles = (arr, p) => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

async function fire(path, method = 'GET', body = null) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: HEADERS,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000)
    });
    const ms = performance.now() - t0;
    if (res.method !== 'HEAD') await res.arrayBuffer().catch(() => {});
    return { ms, ok: res.status >= 200 && res.status < 400, status: res.status };
  } catch (err) {
    return { ms: performance.now() - t0, ok: false, status: err.name === 'TimeoutError' ? 'TIMEOUT' : 'ERR' };
  }
}

async function stage(path, concurrency, method, bodyFn, makeId) {
  const latencies = [];
  let ok = 0, fail = 0;
  const statuses = new Map();
  const endAt = performance.now() + STAGE_MS;
  const ids = [];

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < endAt) {
      const body = bodyFn ? bodyFn() : null;
      const r = await fire(typeof path === 'function' ? path(makeId) : path, method, body);
      latencies.push(r.ms);
      if (r.ok) { ok++; if (method === 'POST') { try { const j = JSON.parse(r.body ?? '{}'); } catch {} } }
      else { fail++; statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1); }
    }
  }));

  const total = ok + fail;
  const durationS = STAGE_MS / 1000;
  return {
    concurrency, total, rps: Math.round(total / durationS),
    errorRate: total ? Math.round((fail / total) * 1000) / 10 : 0,
    p50: Math.round(percentiles(latencies, 50)),
    p95: Math.round(percentiles(latencies, 95)),
    p99: Math.round(percentiles(latencies, 99)),
    statuses: Object.fromEntries(statuses)
  };
}

async function runClass(label, path, stages, method = 'GET', bodyFn = null) {
  console.log(`\n── ${label} (${method} ${typeof path === 'string' ? path : path()})`);
  const rows = [];
  for (const c of stages) {
    const r = await stage(path, c, method, bodyFn);
    rows.push(r);
    console.log(
      `   c=${String(r.concurrency).padStart(3)}  ${String(r.rps).padStart(5)} req/s  ` +
      `p50=${String(r.p50).padStart(5)}ms  p95=${String(r.p95).padStart(6)}ms  p99=${String(r.p99).padStart(6)}ms  ` +
      `err=${String(r.errorRate).padStart(4)}%  ${JSON.stringify(r.statuses)}`
    );
    const broken = r.errorRate > 1 || r.p95 > (method === 'GET' ? 500 : 1500);
    if (broken && r.concurrency === stages[0]) console.log('   ⚠ casse dès la première étape');
  }
  const survivors = rows.filter(r => r.errorRate <= 1 && r.p95 <= (method === 'GET' ? 500 : 1500));
  const max = survivors.length ? survivors[survivors.length - 1].concurrency : 0;
  console.log(`   ⇒ VERDICT ${label} : concurrence max saine ≈ ${max}`);
  return max;
}

const created = [];
async function main() {
  console.log(`TEST DE CHARGE — ${BASE} (tenant ${TENANT}, étapes de ${STAGE_MS / 1000}s)`);

  const health = await runClass('Health (référence event loop)', '/health', READ_STAGES);
  const list = await runClass('Liste des projets (SQLite)', '/api/v1/projects', READ_STAGES);

  const probe = await fetch(`${BASE}/api/v1/projects`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ name: 'load-probe-' + Date.now() }) });
  const probeJson = await probe.json();
  const pid = probeJson.project.id;
  created.push(pid);
  const detail = await runClass(`Détail projet (${pid})`, `/api/v1/projects/${pid}`, READ_STAGES);

  const writeMax = await runClass(
    'Création de projet (écriture SQLite)',
    () => '/api/v1/projects', WRITE_STAGES, 'POST',
    () => { return { name: 'load-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) }; }
  );

  // Récupérer les projets créés pendant l'écriture pour le cleanup
  const listRes = await fetch(`${BASE}/api/v1/projects`, { headers: HEADERS });
  const listJson = await listRes.json();
  const projects = Array.isArray(listJson.projects) ? listJson.projects : (Array.isArray(listJson) ? listJson : []);
  for (const p of projects) created.push(p.id);

  console.log('\n── CLEANUP');
  for (const id of [...new Set(created)]) {
    await fetch(`${BASE}/api/v1/projects/${id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
  }
  const erase = await fetch(`${BASE}/api/v1/gdpr/erase`, { method: 'DELETE', headers: HEADERS });
  console.log(`   erase tenant: HTTP ${erase.status}`);

  console.log('\n═══════════ SYNTHÈSE CAPACITÉ (cette machine) ═══════════');
  console.log(`   HTTP lecture (health)        : ≈ ${health} connexions simultanées saines`);
  console.log(`   HTTP lecture (SQLite list)   : ≈ ${list} connexions simultanées saines`);
  console.log(`   HTTP lecture (détail projet) : ≈ ${detail} connexions simultanées saines`);
  console.log(`   HTTP écriture (création)     : ≈ ${writeMax} connexions simultanées saines`);
  console.log(`
   Plafonds applicatifs (par design, hors HTTP) :
   - Générations IA simultanées : VOLACO_MAX_CONCURRENT_AI (défaut 3) — au-delà : 503 AI_BUSY + Retry-After
   - Rendus Chromium simultanés : sémaphore render dédié
   - Terminal : execFileSync bloque l'event loop pendant l'exécution (≤ timeout)
   ⇒ Nombre d'utilisateurs réels ≈ concurrence HTTP × (part sans IA) + 3 générations concurrentes max.
`);
}

main().catch((e) => { console.error('ÉCHEC TEST CHARGE :', e); process.exit(1); });
