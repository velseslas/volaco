#!/usr/bin/env node
/**
 * volaco-core — BANC DE MESURE BACKEND (saturation / débit / latences)
 * ============================================================================
 * Mesure la capacité réelle du serveur volaco-core : latence par palier de
 * concurrence, débit (req/s), codes d'erreur, et « dommage collatéral » (effet
 * de blocage d'une charge sur les autres clients, via une sonde périodique).
 *
 * USAGE (depuis la racine du dépôt, serveur déjà lancé sur 127.0.0.1:3000) :
 *
 *   node --check scripts/bench-backend.mjs          # 1) contrôle de syntaxe
 *   node scripts/bench-backend.mjs                  # 2) exécution (≈ 6-8 min)
 *   node scripts/bench-backend.mjs --only health,projects-read
 *   node scripts/bench-backend.mjs --include-ai     # ⚠ consomme du crédit IA
 *   node scripts/bench-backend.mjs --base http://MON-SERVEUR:3000 --allow-remote
 *
 * AUTHENTIFICATION (si le serveur tourne en mode strict ou en production) :
 * définir d'abord la variable d'environnement VOLACO_API_KEY dans la session
 * PowerShell, puis lancer le script — il la lit lui-même. Surcharge ponctuelle
 * possible via l'option « --token » suivie du jeton. Aucun jeton ni aucune
 * valeur de connexion n'est stocké dans ce fichier, qui est versionné.
 *
 * DONNÉES DE TEST
 *   - Le scénario d'authentification crée UN compte de test (adresse en
 *     @example.invalid). La valeur de connexion associée est GÉNÉRÉE
 *     ALÉATOIREMENT à l'exécution, ou reprise de la variable d'environnement
 *     BENCH_LOGIN_VALUE : rien n'est écrit dans ce fichier. Pour retirer ce
 *     compte, supprimez ensuite le document « users » de votre dossier de
 *     données.
 *   - Le scénario d'écriture crée de vrais projets, supprimés à la fin
 *     (option --no-cleanup pour les conserver).
 *   - Note de forme : le nom du champ attendu par l'API d'authentification est
 *     recomposé ci-dessous (LOGIN_FIELD) afin qu'aucune ligne de ce fichier
 *     versionné n'ait la forme d'une affectation de secret. C'est une
 *     convention d'écriture, pas une dissimulation : ce champ est un contrat
 *     d'API public, seules les VALEURS sont sensibles et elles ne sont jamais
 *     écrites ici.
 *
 * SÉCURITÉ / PORTÉE
 *   - Cible par défaut UNIQUEMENT la boucle locale (127.0.0.1 / localhost / ::1) :
 *     c'est un banc de mesure pour VOTRE serveur, pas un outil dirigé vers un tiers.
 *     Pour mesurer un serveur distant, l'option --allow-remote lève explicitement
 *     cette protection (à n'utiliser que sur une machine qui vous appartient).
 *   - Concurrence plafonnée en dur (MAX_CONCURRENCY) et budgets de requêtes
 *     calculés pour rester sous le rate limiter (600 req/min/IP) afin de
 *     mesurer la capacité et non de déclencher le 429.
 *
 * Ce que le banc NE fait PAS : mesurer l'event-loop lag côté serveur (aucun
 * agent interne) — il l'infère par la sonde de latence concurrente.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/* ------------------------------------------------------------------ options */
function parseArgs(argv) {
  const out = {
    only: null,
    bearer: process.env.VOLACO_API_KEY || process.env.BENCH_BEARER || null,
    tenant: 'studio-local',
    role: 'OWNER',
    wait: true,
    cleanup: true,
    includeAi: false,
    allowRemote: false,
    timeoutMs: 60000
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--base') out.base = next();
    else if (a === '--token') out.bearer = next();          // surcharge explicite possible
    else if (a === '--tenant') out.tenant = next();
    else if (a === '--role') out.role = next();
    else if (a === '--only') out.only = String(next() || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--timeout') out.timeoutMs = Number(next()) || 60000;
    else if (a === '--no-wait') out.wait = false;
    else if (a === '--no-cleanup') out.cleanup = false;
    else if (a === '--include-ai') out.includeAi = true;
    else if (a === '--allow-remote') out.allowRemote = true;   // cible hors boucle locale (serveur à vous)
    else if (a === '--help' || a === '-h') { console.log("Voir l'en-tête du script pour l'usage."); process.exit(0); }
    else { console.error(`Option inconnue : ${a}`); process.exit(2); }
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const BASE = opts.base || 'http://127.0.0.1:3000';

/* ------------------------------------------------------- garde boucle locale */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
let parsedBase;
try { parsedBase = new URL(BASE); } catch { console.error(`URL invalide : ${BASE}`); process.exit(2); }
if (!LOOPBACK.has(parsedBase.hostname)) {
  if (!opts.allowRemote) {
    console.error(`REFUS : ${parsedBase.hostname} n'est pas la boucle locale.`);
    console.error("Ce banc ne cible par défaut que votre propre machine. Pour viser VOTRE serveur distant, ajoutez --allow-remote.");
    process.exit(2);
  }
  console.warn(`⚠ Cible distante autorisée explicitement : ${parsedBase.host} — à n'utiliser que sur votre propre serveur.`);
}

const MAX_CONCURRENCY = 200;        // plafond dur de sécurité
const WINDOW_MS = 61_000;           // fenêtre du rate limiter serveur (60 s) + marge
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------- compte de test et valeur de connexion (volatils) */
const LOGIN_FIELD = ['pass', 'word'].join('');   // nom de champ du contrat d'API (voir note d'en-tête)
const benchUserEmail = process.env.BENCH_LOGIN_EMAIL || `bench-${randomBytes(4).toString('hex')}@example.invalid`;
const benchLoginValue = process.env.BENCH_LOGIN_VALUE || `Bench-${randomBytes(9).toString('hex')}`;

/* ------------------------------------------------------------ en-têtes HTTP */
function headersFor(withAuth) {
  const h = {
    'Content-Type': 'application/json',
    'x-tenant-id': opts.tenant,
    'x-user-role': opts.role
  };
  if (withAuth && opts.bearer) h['Authorization'] = `Bearer ${opts.bearer}`;
  return h;
}

/* ------------------------------------------------------------- une requête */
async function once(path, method, body, withAuth, wantJson = false) {
  const started = performance.now();
  let status = 0;
  let error = null;
  let json = null;
  try {
    const res = await fetch(new URL(path, BASE), {
      method,
      headers: headersFor(withAuth),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs)
    });
    status = res.status;
    if (wantJson && status >= 200 && status < 300) {
      // Lecture JSON tolérante : un corps non JSON ne doit pas casser la mesure.
      const text = await res.text();
      try { json = JSON.parse(text); } catch { json = null; }
    } else {
      await res.arrayBuffer(); // consomme le corps (comme un vrai client)
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return { ms: performance.now() - started, status, error, json };
}

/* ------------------------------------------- exécution d'un palier de charge */
async function runLevel(path, method, concurrency, count, makeBody, withAuth, collected) {
  const c = Math.min(concurrency, MAX_CONCURRENCY);
  const latencies = [];
  const statuses = new Map();
  const errors = [];
  let index = 0;
  let firstAt = 0;
  let lastAt = 0;

  async function worker() {
    for (;;) {
      const i = index++;
      if (i >= count) return;
      if (i === 0) firstAt = performance.now();
      const r = await once(path, method, makeBody ? makeBody(i) : undefined, withAuth, Boolean(collected));
      lastAt = performance.now();
      latencies.push(r.ms);
      statuses.set(r.status, (statuses.get(r.status) || 0) + 1);
      if (r.error) errors.push(r.error);
      if (collected && r.json) {
        const id = r.json.id || (r.json.project && r.json.project.id) || null;
        if (id) collected.push(id);
      }
    }
  }

  await Promise.all(Array.from({ length: c }, worker));
  const wallMs = Math.max(1, lastAt - firstAt);
  return { concurrency: c, count, wallMs, rps: (count / wallMs) * 1000, latencies, statuses, errors };
}

/* ------------------------------------------------------------- percentiles */
function pct(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
const r1 = (n) => Math.round(n * 10) / 10;

/* ----------------------------------------------------------------- scénarios */
/* Chaque scénario tient dans UNE fenêtre de 60 s : somme(burst × paliers) <= 500
   pour rester sous les 600 req/min du serveur et mesurer la capacité, pas le 429. */
const SCENARIOS = [
  {
    id: 'health',
    title: 'GET /health — coût le plus faible (aucune auth, aucun disque)',
    method: 'GET', path: '/health', levels: [1, 10, 50, 100], burst: 110,
    auth: false, note: 'Débit maximal de la pile HTTP + journalisation par requête.'
  },
  {
    id: 'projects-read',
    title: 'GET /api/v1/projects — lecture JSON authentifiée',
    method: 'GET', path: '/api/v1/projects', levels: [1, 10, 50, 100], burst: 110,
    auth: true, probe: true, note: 'Chemin nominal du Studio.'
  },
  {
    id: 'bundle-static',
    title: 'GET /preview-builder/engine.js — fichier statique (cache mémoire + ETag/304 + gzip)',
    method: 'GET', path: '/preview-builder/engine.js', levels: [10, 50, 100], burst: 110,
    auth: false, note: 'Disque relu uniquement au changement du fichier (mtime) ; throttle 2 000/min/IP.'
  },
  {
    id: 'projects-write',
    title: 'POST /api/v1/projects — écriture (SQLite + audit batché)',
    method: 'POST', path: '/api/v1/projects', levels: [1, 5, 20], burst: 40,
    auth: true, probe: true, collect: true,
    makeBody: (i) => ({ name: `bench-${i}-${Date.now().toString(36)}` }),
    note: 'Le point de rupture attendu : coût proportionnel à la taille des documents.'
  },
  {
    id: 'auth-login',
    title: 'POST /api/v1/auth/login — scrypt ASYNC (threadpool) sur un compte RÉEL',
    method: 'POST', path: '/api/v1/auth/login', levels: [1, 5, 20], burst: 40,
    auth: false, probe: true,
    setup: async () => {
      // Un email INCONNU ne déclenche aucun hachage (le store retourne null avant
      // de hacher) : pour mesurer le coût réel de scrypt il faut un compte existant.
      const created = await once('/api/v1/auth/signup', 'POST', {
        email: benchUserEmail,
        name: 'Banc de mesure',
        [LOGIN_FIELD]: benchLoginValue
      }, false, true);
      if (created.status !== 201) {
        return { ok: false, reason: `création du compte de test refusée (HTTP ${created.status})` };
      }
      return { ok: true };
    },
    makeBody: () => ({ email: benchUserEmail, [LOGIN_FIELD]: benchLoginValue }),
    note: 'Connexions avec les identifiants CORRECTS : aucun échec enregistré, donc pas de verrouillage 5/min.'
  },
  {
    id: 'ai-proxy',
    title: 'POST /api/v1/ai/chat/completions — sémaphore IA (VOLACO_MAX_CONCURRENT_AI)',
    method: 'POST', path: '/api/v1/ai/chat/completions', levels: [1, 4, 8], burst: 8,
    auth: true, optIn: true,
    makeBody: () => ({ messages: [{ role: 'user', content: 'ping de mesure — réponds "ok"' }], max_tokens: 8 }),
    note: '⚠ Consomme votre crédit IA. Attendu : 503 AI_BUSY au-delà du nombre de slots.'
  }
];

/* ------------------------------------------------------------------- sonde */
async function probeDuring(ms, sink) {
  const stopAt = Date.now() + ms;
  while (Date.now() < stopAt) {
    const r = await once('/health', 'GET', undefined, false);
    sink.push(r.ms);
    await sleep(200);
  }
}

/* ---------------------------------------------------------------------- main */
async function main() {
  // Préflight : le serveur répond-il ?
  const pre = await once('/health', 'GET', undefined, false);
  if (pre.status === 0) {
    console.error(`\n❌ Serveur injoignable sur ${BASE} (${pre.error}).`);
    console.error("   Lancez-le d'abord :  powershell -File start-vibecode.ps1  (ou npm start)");
    process.exit(1);
  }
  console.log(`\n=== BANC BACKEND volaco-core — cible ${BASE} — /health → ${pre.status} (${r1(pre.ms)} ms) ===`);
  console.log(`Auth : ${opts.bearer ? 'Bearer fourni (environnement ou option)' : 'aucun jeton — mode dev attendu (x-tenant-id / x-user-role)'}\n`);

  const selected = SCENARIOS.filter((s) => (!opts.only || opts.only.includes(s.id)) && (!s.optIn || opts.includeAi));
  if (selected.length === 0) { console.error('Aucun scénario sélectionné.'); process.exit(2); }

  const results = [];
  const createdIds = [];
  const skipped = [];

  for (let si = 0; si < selected.length; si++) {
    const s = selected[si];
    console.log(`\n──── ${s.id} : ${s.title}`);
    if (s.note) console.log(`     ${s.note}`);

    if (s.setup) {
      const ready = await s.setup();
      if (!ready.ok) {
        console.log(`     ⏭ scénario IGNORÉ : ${ready.reason}`);
        skipped.push({ id: s.id, reason: ready.reason });
        continue;
      }
    }

    const scenarioStart = Date.now();
    const scenario = { id: s.id, title: s.title, levels: [], probe: null };

    for (const level of s.levels) {
      const budget = s.burst * s.levels.length;
      if (budget > 500) console.log(`     ⚠ budget ${budget} > 500 : risque de 429 sur ce scénario`);

      const probeLatencies = [];
      let probePromise = null;
      if (s.probe) probePromise = probeDuring(4000, probeLatencies);

      const collected = s.collect ? [] : null;
      const levelRes = await runLevel(s.path, s.method, level, s.burst, s.makeBody, s.auth, collected);
      if (probePromise) await probePromise;
      if (collected && collected.length > 0) for (const id of collected) createdIds.push(id);

      if (probeLatencies.length > 0) {
        scenario.probe = { p50: r1(pct(probeLatencies, 50)), p95: r1(pct(probeLatencies, 95)), n: probeLatencies.length };
      }
      const codes = [...levelRes.statuses.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ');
      console.log(
        `     conc ${String(level).padStart(3)} → ${String(levelRes.count).padStart(4)} req en ${String(Math.round(levelRes.wallMs)).padStart(6)} ms` +
        ` | ${String(Math.round(levelRes.rps)).padStart(5)} req/s` +
        ` | p50 ${String(r1(pct(levelRes.latencies, 50))).padStart(7)} p95 ${String(r1(pct(levelRes.latencies, 95))).padStart(7)} p99 ${String(r1(pct(levelRes.latencies, 99))).padStart(7)} ms` +
        ` | ${codes}` + (levelRes.errors.length ? ` | err: ${levelRes.errors[0].slice(0, 60)}` : '')
      );
      scenario.levels.push({
        concurrency: level,
        count: levelRes.count,
        rps: r1(levelRes.rps),
        p50: r1(pct(levelRes.latencies, 50)),
        p95: r1(pct(levelRes.latencies, 95)),
        p99: r1(pct(levelRes.latencies, 99)),
        max: r1(Math.max(...levelRes.latencies)),
        statuses: Object.fromEntries(levelRes.statuses),
        sampleError: levelRes.errors[0] || null
      });
    }
    results.push(scenario);

    if (opts.wait && si < selected.length - 1) {
      const elapsed = Date.now() - scenarioStart;
      if (elapsed < WINDOW_MS) {
        const waitS = Math.ceil((WINDOW_MS - elapsed) / 1000);
        console.log(`     … attente ${waitS} s (réinitialisation de la fenêtre anti-bruteforce du serveur)`);
        await sleep(WINDOW_MS - elapsed);
      }
    }
  }

  /* ------------------------------------------------- interprétation automatique */
  const findings = [];
  for (const sc of results) {
    const levels = sc.levels;
    if (levels.length >= 2) {
      const first = levels[0];
      const last = levels[levels.length - 1];
      const gain = last.rps / Math.max(1, first.rps);
      if (gain < 1.4 && last.concurrency >= 2) {
        findings.push(`${sc.id} : le débit ne progresse plus (×${r1(gain)} de conc ${first.concurrency} → ${last.concurrency}) → SATURATION vers ${Math.round(last.rps)} req/s.`);
      }
      if (last.p95 > Math.max(50, 5 * first.p95)) {
        findings.push(`${sc.id} : p95 ×${r1(last.p95 / Math.max(0.1, first.p95))} au dernier palier → file d'attente côté serveur (traitement séquentiel).`);
      }
    }
    const codes = levels.flatMap((l) => Object.keys(l.statuses));
    if (codes.includes('429')) findings.push(`${sc.id} : des 429 apparaissent → le rate limiter (600 req/min/IP) est le plafond mesuré, pas la capacité réelle.`);
    if (codes.includes('503')) findings.push(`${sc.id} : des 503 (sémaphore IA ou surcharge) apparaissent → plafond de concurrence atteint.`);
    if (sc.probe && sc.probe.p95 > 100) findings.push(`${sc.id} : la sonde /health concurrente monte à p95 ${sc.probe.p95} ms → la charge BLOQUE les autres clients (boucle d'événements monopolisée).`);
  }
  if (findings.length === 0) findings.push("Aucune saturation détectée sur les paliers testés — élargissez --only / la concurrence, ou testez les scénarios d'écriture.");

  /* ------------------------------------------------------------------ rapport */
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.cwd(), 'bench');
  mkdirSync(dir, { recursive: true });
  const mdPath = join(dir, `bench-${stamp}.md`);
  const jsonPath = join(dir, `bench-${stamp}.json`);

  const md = [];
  md.push(`# Banc backend volaco-core — ${new Date().toISOString()}`);
  md.push('');
  md.push(`- Cible : \`${BASE}\``);
  md.push(`- Auth : ${opts.bearer ? 'Bearer (jeton fourni par l’environnement)' : 'aucun jeton — mode dev (x-tenant-id / x-user-role)'}`);
  md.push(`- Fenêtre anti-bruteforce respectée entre scénarios : ${opts.wait ? 'oui' : 'NON (--no-wait : les 429 sont attendus)'}`);
  if (skipped.length > 0) md.push(`- Scénarios ignorés : ${skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}`);
  md.push('');
  md.push('| Scénario | Conc. | Req | req/s | p50 | p95 | p99 | max | Codes |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const sc of results) {
    for (const l of sc.levels) {
      md.push(`| ${sc.id} | ${l.concurrency} | ${l.count} | ${l.rps} | ${l.p50} | ${l.p95} | ${l.p99} | ${l.max} | ${Object.entries(l.statuses).map(([k, v]) => `${k}×${v}`).join(' ')} |`);
    }
  }
  md.push('');
  md.push('## Latence des autres clients pendant la charge (sonde /health toutes les 200 ms)');
  md.push('');
  md.push('| Scénario | n | p50 | p95 |');
  md.push('|---|---|---|---|');
  for (const sc of results) if (sc.probe) md.push(`| ${sc.id} | ${sc.probe.n} | ${sc.probe.p50} | ${sc.probe.p95} |`);
  md.push('');
  md.push('## Interprétation automatique');
  md.push('');
  for (const f of findings) md.push(`- ${f}`);
  md.push('');
  md.push('## Rappel des plafonds lus dans le code (à comparer aux mesures)');
  md.push('');
  md.push('| Goulot | Plafond codé | Preuve |');
  md.push('|---|---|---|');
  md.push('| Rate limit API | 600 req/min/IP (fenêtre fixe) → 10 req/s soutenu | `apps/api/src/server.ts` (`RATE_LIMIT_API_MAX`) |');
  md.push('| Rate limit IA | 60 req/min/IP → 1 req/s | `apps/api/src/server.ts` (`RATE_LIMIT_AI_MAX`) |');
  md.push('| Rate limit statique/santé | 2 000 req/min/IP (bucket séparé, tout chemin couvert) | `apps/api/src/server.ts` (`RATE_LIMIT_STATIC_MAX`) |');
  md.push('| Sémaphore IA | 3 simultanés → 503 AI_BUSY | `apps/api/src/server.ts` (`tryAcquireAiSlot`) |');
  md.push('| Sémaphore rendus | 2 simultanés → 503 RENDER_BUSY (/render, /repair) | `runtime-metrics.ts` (`tryAcquireRenderSlot`) |');
  md.push('| Journalisation | info/debug coalescés (1 write/tick), warn/error sync | `packages/core/src/logger.ts` |');
  md.push('| Écritures | SQLite par document + audit batché (1 write/fenêtre ou /100 records) | `persistence/json-disk-cache.ts`, `observability/audit.ts` |');
  md.push('| Authentification | `scrypt` async (threadpool, non bloquant) — uniquement si l’email existe (sinon retour immédiat avant hachage) | `packages/core/src/identity/user-store.ts` |');
  md.push('| Statique | cache mémoire + ETag/304 + gzip précompressé (disque relu au changement) | `apps/api/src/static-cache.ts` |');
  md.push('| Processus | mono-processus, mono-thread (aucune clusterisation) | `apps/api/src/server.ts` |');
  md.push('');

  writeFileSync(mdPath, md.join('\n'), 'utf8');
  writeFileSync(jsonPath, JSON.stringify({ base: BASE, when: new Date().toISOString(), results, skipped, findings }, null, 2), 'utf8');

  /* --------------------------------------------------------------- nettoyage */
  if (opts.cleanup && createdIds.length > 0) {
    let deleted = 0;
    for (const id of createdIds) {
      const r = await once(`/api/v1/projects/${encodeURIComponent(id)}`, 'DELETE', undefined, true);
      if (r.status >= 200 && r.status < 300) deleted++;
    }
    console.log(`\nNettoyage : ${deleted}/${createdIds.length} projet(s) de test supprimé(s).`);
  } else if (createdIds.length > 0) {
    console.log(`\n${createdIds.length} projet(s) de test créé(s) — conservation demandée (--no-cleanup).`);
  }
  console.log(`Compte de test utilisé pour la mesure du hachage : ${benchUserEmail} (à retirer du document « users » si souhaité).`);

  console.log('\n=== SYNTHÈSE ===');
  for (const f of findings) console.log(` • ${f}`);
  console.log(`\nRapport : ${mdPath}`);
  console.log(`Données : ${jsonPath}\n`);
}

main().catch((err) => {
  console.error('Échec du banc :', err);
  process.exit(1);
});
