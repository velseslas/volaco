#!/usr/bin/env node
/**
 * Test de charge CDC §47 — capacité réelle avant casse.
 * Zéro dépendance : fetch + performance.now. Rampe de concurrence par classe
 * d'endpoint (lecture, écriture), mesure RPS + p50/p95/p99 + taux d'erreur,
 * verdict « concurrence max sans dégradation ». Cleanup complet à la fin.
 *
 * CAP-02 (audit maître backend) — CORRECTIF MAJEUR : l'ancienne version
 * comptait les 429 (rate limiter) comme des ÉCHECS. Comme le limiteur frappe
 * bien avant la capacité réelle (2 000/min/IP statique ≈ 33 req/s), le banc
 * déclarait « concurrence max saine ≈ 0 » sur TOUS les endpoints dès la
 * 1ʳ étape — il ne mesurait donc jamais la capacité du serveur.
 * Désormais :
 *   - les 429 sont isolés (`limitedRate`) et n'entrent pas dans `errorRate` ;
 *   - les percentiles ne sont calculés que sur les réponses SERVIES ;
 *   - si le limiteur sature, le verdict le dit et donne la marche à suivre ;
 *   - la capacité brute se mesure avec un serveur de banc qui relève les
 *     plafonds (voir VOLACO_RATE_LIMIT_* dans apps/api/src/server.ts) :
 *       VOLACO_RATE_LIMIT_API_MAX=10000000 VOLACO_RATE_LIMIT_STATIC_MAX=10000000 \
 *       node --env-file=.env dist/apps/api/src/server.js
 *
 * Usage : node scripts/load-test.mjs [baseUrl]   (défaut http://localhost:3000)
 */

const BASE = process.argv[2] || 'http://localhost:3000';
const TENANT = 'tenant_loadtest';
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': TENANT, 'x-user-role': 'ENGINEER' };
const READ_STAGES = [1, 5, 10, 25, 50, 100, 200];
const WRITE_STAGES = [1, 5, 10, 25, 50];
const STAGE_MS = 4000;
// Seuils de dégradation (identiques à l'ancienne version).
const GET_P95_MAX = 500;
const POST_P95_MAX = 1500;

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
    await res.arrayBuffer().catch(() => {});
    return {
      ms,
      status: res.status,
      served: res.status !== 429, // 429 = rate limiter, pas une défaillance serveur
      ok: res.status >= 200 && res.status < 400
    };
  } catch (err) {
    // TIMEOUT / ERR : vraie défaillance (saturation, refus de connexion…).
    return { ms: performance.now() - t0, status: err.name === 'TimeoutError' ? 'TIMEOUT' : 'ERR', served: false, ok: false, hard: true };
  }
}

async function stage(path, concurrency, method, bodyFn) {
  const servedLatencies = [];
  const statuses = new Map();
  let total = 0, ok = 0, limited = 0, hardFail = 0;
  const endAt = performance.now() + STAGE_MS;

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < endAt) {
      const body = bodyFn ? bodyFn() : null;
      const r = await fire(typeof path === 'function' ? path() : path, method, body);
      total++;
      if (r.status === 429) {
        limited++;
      } else if (r.hard || !r.ok) {
        hardFail++;
      } else {
        ok++;
        servedLatencies.push(r.ms);
      }
      statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
    }
  }));

  const durationS = STAGE_MS / 1000;
  // errorRate = vraies défaillances (5xx, timeouts, refus) — SANS les 429.
  const errorRate = total ? Math.round((hardFail / total) * 1000) / 10 : 0;
  const limitedRate = total ? Math.round((limited / total) * 1000) / 10 : 0;
  return {
    concurrency, total,
    rps: Math.round(total / durationS),
    servedRps: Math.round((total - limited) / durationS),
    errorRate, limitedRate,
    p50: Math.round(percentiles(servedLatencies, 50)),
    p95: Math.round(percentiles(servedLatencies, 95)),
    p99: Math.round(percentiles(servedLatencies, 99)),
    statuses: Object.fromEntries(statuses)
  };
}

async function runClass(label, path, stages, method = 'GET', bodyFn = null) {
  console.log(`\n── ${label} (${method} ${typeof path === 'string' ? path : '<dynamique>'})`);
  const rows = [];
  const p95Max = method === 'GET' ? GET_P95_MAX : POST_P95_MAX;
  let limiterHit = false;

  for (const c of stages) {
    const r = await stage(path, c, method, bodyFn);
    rows.push(r);
    const degraded = r.errorRate > 1 || r.p95 > p95Max;
    const mark = degraded ? ' ⚠' : (r.limitedRate > 50 ? ' (429)' : '');
    console.log(
      `   c=${String(r.concurrency).padStart(3)}  ${String(r.servedRps).padStart(5)} req/s servis  ` +
      `p50=${String(r.p50).padStart(5)}ms  p95=${String(r.p95).padStart(6)}ms  p99=${String(r.p99).padStart(6)}ms  ` +
      `err=${String(r.errorRate).padStart(5)}%  429=${String(r.limitedRate).padStart(5)}%${mark}  ${JSON.stringify(r.statuses)}`
    );
    if (degraded && r.concurrency === stages[0]) console.log('   ⚠ casse dès la première étape');
    if (r.limitedRate > 50) limiterHit = true;
  }

  const survivors = rows.filter(r => r.errorRate <= 1 && r.p95 <= p95Max);
  const max = survivors.length ? survivors[survivors.length - 1].concurrency : 0;
  const peakRps = rows.reduce((m, r) => Math.max(m, r.servedRps), 0);
  console.log(`   ⇒ VERDICT ${label} : concurrence max saine ≈ ${max}  (pic de débit servi ≈ ${peakRps} req/s)`);
  if (limiterHit) {
    console.log('   ℹ  Le rate limiter du serveur sature avant sa capacité réelle (429 majoritaires).');
    console.log('      Pour mesurer la capacité brute : relancez un serveur de banc avec');
    console.log('      VOLACO_RATE_LIMIT_API_MAX / VOLACO_RATE_LIMIT_STATIC_MAX relevés (voir l\'en-tête du script).');
  }
  return { max, peakRps, limiterHit };
}

async function main() {
  console.log(`TEST DE CHARGE — ${BASE} (tenant ${TENANT}, étapes de ${STAGE_MS / 1000}s)`);
  console.log('Note : les 429 (rate limiter) sont exclus du taux d\'erreur — voir en-tête du script.');

  const results = {};
  results.health = await runClass('Health (référence event loop)', '/health', READ_STAGES);
  results.list = await runClass('Liste des projets (SQLite)', '/api/v1/projects', READ_STAGES);

  const probe = await fetch(`${BASE}/api/v1/projects`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ name: 'load-probe-' + Date.now() }) });
  const probeJson = await probe.json().catch(() => ({}));
  const pid = probeJson?.project?.id;
  if (!pid) {
    console.log('\n⚠ Impossible de créer le projet sonde — vérifiez l\'authentification du serveur cible.');
    return;
  }
  results.detail = await runClass(`Détail projet (${pid})`, `/api/v1/projects/${pid}`, READ_STAGES);

  results.write = await runClass(
    'Création de projet (écriture SQLite)',
    () => '/api/v1/projects', WRITE_STAGES, 'POST',
    () => ({ name: 'load-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) })
  );

  // Récupérer les projets créés pendant l'écriture pour le cleanup
  const listRes = await fetch(`${BASE}/api/v1/projects`, { headers: HEADERS });
  const listJson = await listRes.json().catch(() => ({}));
  const projects = Array.isArray(listJson?.projects) ? listJson.projects : (Array.isArray(listJson) ? listJson : []);
  const created = [pid, ...projects.map((p) => p.id)];

  console.log('\n── CLEANUP');
  for (const id of [...new Set(created)]) {
    await fetch(`${BASE}/api/v1/projects/${id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
  }
  const erase = await fetch(`${BASE}/api/v1/gdpr/erase`, { method: 'DELETE', headers: HEADERS });
  console.log(`   erase tenant: HTTP ${erase.status}`);

  const anyLimiter = Object.values(results).some((r) => r.limiterHit);
  console.log('\n═══════════ SYNTHÈSE CAPACITÉ (cette machine) ═══════════');
  console.log(`   HTTP lecture (health)        : ≈ ${results.health.max} connexions simultanées saines (pic ${results.health.peakRps} req/s)`);
  console.log(`   HTTP lecture (SQLite list)   : ≈ ${results.list.max} connexions simultanées saines (pic ${results.list.peakRps} req/s)`);
  console.log(`   HTTP lecture (détail projet) : ≈ ${results.detail.max} connexions simultanées saines (pic ${results.detail.peakRps} req/s)`);
  console.log(`   HTTP écriture (création)     : ≈ ${results.write.max} connexions simultanées saines (pic ${results.write.peakRps} req/s)`);
  if (anyLimiter) {
    console.log(`
   ⚠ Plusieurs classes ont été limitées par le rate limiter : les valeurs
   ci-dessus sont un PLAFOND du limiteur, pas la capacité du serveur.
   Relancez un serveur de banc (VOLACO_RATE_LIMIT_* relevés) pour mesurer
   la capacité brute.`);
  }
  console.log(`
   Plafonds applicatifs (par design, hors HTTP) :
   - Générations IA simultanées : VOLACO_MAX_CONCURRENT_AI (défaut 3) — au-delà : 503 AI_BUSY + Retry-After
   - Rendus Chromium simultanés : sémaphore render dédié
   - Terminal : execFileSync bloque l'event loop pendant l'exécution (≤ timeout)
   ⇒ Nombre d'utilisateurs réels ≈ concurrence HTTP × (part sans IA) + 3 générations concurrentes max.
`);
}

main().catch((e) => { console.error('ÉCHEC TEST CHARGE :', e); process.exit(1); });
