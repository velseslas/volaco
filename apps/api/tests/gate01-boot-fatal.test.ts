/**
 * GATE-01 (audit maître backend) — démarrage FATAL observable.
 *
 * Anomalie d'origine : `loadConfig()` refuse de démarrer sans `VOLACO_JWT_SECRET`
 * valide, mais le handler `process.on('uncaughtException')` de `server.ts`
 * absorbait ce refus → journal trompeur « le serveur continue de fonctionner »
 * alors que `listen()` n'avait jamais été appelé : processus zombie sans port.
 *
 * Correctif vérifié ici (apps/api/src/server.ts) :
 *   - AVANT le bind, toute erreur (config incluse) → `fatalBoot` : bloc FATAL +
 *     « Le service N'EST PAS en ecoute. Arret (code 1). » + `process.exit(1)` ;
 *   - APRÈS le bind, le filet d'origine est conservé (erreur non fatale = log).
 *
 * Ce fichier couvre, SANS jamais toucher au `.env` réel ni à la base réelle :
 *   1. refus unitaire de `loadConfig` (secret absent / court / non canonique /
 *      tous zéros / identique à VOLACO_API_KEY, strict désactivé en production) ;
 *   2. processus complet : secret absent → exit 1 + FATAL + AUCUN port lié ;
 *   3. processus complet : secret invalide → idem ;
 *   4. processus complet : port occupé → exit 1 FATAL (EADDRINUSE) ;
 *   5. contre-épreuve : configuration valide → démarrage réel + health 200 ;
 *   6. refus de config en production → exit 1 FATAL (jamais de mode permissif).
 *
 * Environnement : cwd temporaire sans `.env`, `VOLACO_DATA_DIR` temporaire,
 * ports éphémères. Le serveur réel (port 3000) n'est jamais contacté.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../../packages/core/src/index.js';

const SERVER_JS = resolve(fileURLToPath(new URL('../src/server.js', import.meta.url)));
const VALID_SECRET = randomBytes(32).toString('base64'); // dédié au test, jamais un secret réel

/** Sauvegarde/restauration d'un jeu de variables d'environnement. */
function withEnv(keys: string[], fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const k of keys) saved.set(k, process.env[k]);
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function setJwt(value: string | undefined): void {
  if (value === undefined) delete process.env.VOLACO_JWT_SECRET;
  else process.env.VOLACO_JWT_SECRET = value;
}

/** Environnement minimal, isolé (dossier de données + cwd temporaires). */
function childEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('VOLACO_MCP_REMOTE_')) continue; // keyring non requis ici
    env[k] = v;
  }
  delete env['VOLACO_JWT_SECRET'];
  delete env['AUTH_SECRET'];
  delete env['VOLACO_API_KEY'];
  delete env['NODE_ENV'];
  env['PORT'] = '0'; // remplacé par un port libre par l'appelant
  env['VOLACO_BIND_HOST'] = '127.0.0.1';
  env['VOLACO_STRICT_AUTH'] = '0';
  env['VOLACO_AGENT_CHAIN'] = '0';
  env['VOLACO_DATA_DIR'] = dataDir;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

let dataDir = '';
let cwdDir = '';

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  out: string;
  timedOut: boolean;
}

/** Lance le serveur compilé et attend sa mort (ou un délai max). */
function runToExit(env: Record<string, string>, timeoutMs = 25000): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [SERVER_JS], { cwd: cwdDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    const collect = (b: Buffer) => { out += b.toString('utf8'); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, out, timedOut });
    });
  });
}

/** Port libre éphémère (ouverture puis fermeture immédiate). */
async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolvePort(port));
    });
    s.on('error', reject);
  });
}

/** Démarre le serveur et attend /health (contre-épreuve boot valide). */
async function bootHealthy(env: Record<string, string>): Promise<{ child: ChildProcess; out: () => string }> {
  const child = spawn(process.execPath, [SERVER_JS], { cwd: cwdDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (b: Buffer) => { out += b.toString('utf8'); });
  child.stderr.on('data', (b: Buffer) => { out += b.toString('utf8'); });
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`http://127.0.0.1:${env['PORT']}/health`);
      if (res.status === 200) return { child, out: () => out };
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill('SIGKILL');
  throw new Error(`serveur non sain (exit=${child.exitCode}) — journal : ${out.slice(-800)}`);
}

/** Assert d'un échec de démarrage OBSERVABLE (le cœur de GATE-01). */
function assertFatalBoot(res: RunResult, label: string): void {
  assert.equal(res.timedOut, false, `${label} : le processus doit s'arrêter seul (pas de zombie)`);
  assert.equal(res.code, 1, `${label} : code de sortie attendu 1, obtenu ${res.code} (signal=${res.signal})\n${res.out.slice(-600)}`);
  assert.ok(res.out.includes('FATAL - echec de demarrage'), `${label} : bloc FATAL absent\n${res.out.slice(-600)}`);
  assert.ok(res.out.includes("N'EST PAS en ecoute"), `${label} : mention « pas en écoute » absente`);
  assert.ok(!res.out.includes('DÉMARRÉ SUR LE PORT'), `${label} : ne doit PAS annoncer un démarrage réussi`);
}

describe('GATE-01 : un refus de configuration est un échec de démarrage observable', () => {
  before(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'volaco-gate01-data-'));
    cwdDir = mkdtempSync(join(tmpdir(), 'volaco-gate01-cwd-'));
    mkdirSync(join(cwdDir, 'empty'), { recursive: true });
  });

  after(() => {
    for (const d of [dataDir, cwdDir]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  // ── 1. Refus unitaire de loadConfig : jamais de mode permissif ──────────
  it('1. loadConfig refuse (throw) secret absent, court, non canonique, nul ou identique à VOLACO_API_KEY', () => {
    const cases: Array<{ label: string; jwt?: string | undefined }> = [
      { label: 'secret absent', jwt: undefined },
      { label: 'secret vide', jwt: '' },
      { label: 'secret court (< 32 octets)', jwt: Buffer.alloc(16, 7).toString('base64') },
      { label: 'secret non base64 canonique', jwt: randomBytes(32).toString('base64').replace(/=+$/, '') + '!' },
      { label: 'secret tous zéros', jwt: Buffer.alloc(32, 0).toString('base64') },
      { label: 'secret identique à VOLACO_API_KEY', jwt: randomBytes(32).toString('base64') }
    ];
    withEnv(['VOLACO_JWT_SECRET', 'VOLACO_API_KEY'], () => {
      for (const c of cases) {
        setJwt(c.jwt);
        if (c.label.startsWith('secret identique')) {
          process.env.VOLACO_JWT_SECRET = randomBytes(32).toString('base64');
          process.env.VOLACO_API_KEY = process.env.VOLACO_JWT_SECRET; // même valeur
        }
        assert.throws(
          () => loadConfig(),
          (err: unknown) => err instanceof Error && err.message.includes('refuse de démarrer'),
          `loadConfig doit refuser : ${c.label}`
        );
      }
    });
  });

  it('2. loadConfig ne bascule JAMAIS en mode permissif malgré VOLACO_STRICT_AUTH=0 en production', () => {
    withEnv(['VOLACO_JWT_SECRET', 'VOLACO_STRICT_AUTH', 'NODE_ENV'], () => {
      process.env.VOLACO_JWT_SECRET = VALID_SECRET;
      process.env.NODE_ENV = 'production';
      process.env.VOLACO_STRICT_AUTH = '0'; // doit être IGNORÉ : strict obligatoire en production
      const cfg = loadConfig();
      assert.equal(cfg.strictAuth, true, 'le mode non strict ne doit jamais s\'activer en production');
      assert.equal(cfg.env, 'production');
    });
  });

  it('3. loadConfig accepte un secret valide (contre-épreuve du refus sélectif)', () => {
    withEnv(['VOLACO_JWT_SECRET', 'VOLACO_API_KEY'], () => {
      setJwt(VALID_SECRET);
      delete process.env.VOLACO_API_KEY;
      const cfg = loadConfig();
      assert.equal(typeof cfg.port, 'number');
    });
  });

  // ── 2-4. Processus complet : le refus doit tuER le process (GATE-01) ────
  it('4. PROCESSUS COMPLET : secret JWT absent → exit 1 + FATAL + aucun port lié', async () => {
    const port = await freePort();
    const env = childEnv({ VOLACO_JWT_SECRET: undefined, PORT: String(port) });
    const res = await runToExit(env);
    assertFatalBoot(res, 'secret absent');
    assert.ok(
      res.out.includes('VOLACO_JWT_SECRET') || res.out.includes('Secret JWT'),
      `la cause (secret JWT) doit être lisible dans le journal\n${res.out.slice(-600)}`
    );
    // Aucune écoute résiduelle sur le port visé.
    const listening = await new Promise<boolean>((r) => {
      const probe = createServer();
      probe.once('error', () => r(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => r(true)));
    });
    assert.equal(listening, true, 'le port ne doit PAS rester lié après l\'échec');
  });

  it('5. PROCESSUS COMPLET : secret JWT invalide → exit 1 + FATAL', async () => {
    const port = await freePort();
    const env = childEnv({ VOLACO_JWT_SECRET: 'pas-du-base64-valide', PORT: String(port) });
    const res = await runToExit(env);
    assertFatalBoot(res, 'secret invalide');
    assert.ok(res.out.includes('Secret JWT') || res.out.includes('VOLACO_JWT_SECRET'), 'cause lisible');
  });

  it('6. PROCESSUS COMPLET : port occupé → exit 1 + FATAL (EADDRINUSE observable)', async () => {
    const blocker: Server = createServer();
    const port = await freePort();
    await new Promise<void>((r) => blocker.listen(port, '127.0.0.1', r));
    try {
      const env = childEnv({ VOLACO_JWT_SECRET: VALID_SECRET, PORT: String(port) });
      const res = await runToExit(env);
      assertFatalBoot(res, 'port occupé');
      assert.ok(/ecoute du port|EADDRINUSE/i.test(res.out), `code EADDRINUSE attendu\n${res.out.slice(-500)}`);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });

  // ── 5-6. Contre-épreuves : la validité de la config ne casse rien ────────
  it('7. PROCESSUS COMPLET : configuration valide → démarrage réel + health 200', async () => {
    const port = await freePort();
    const env = childEnv({ VOLACO_JWT_SECRET: VALID_SECRET, PORT: String(port) });
    const { child, out } = await bootHealthy(env);
    try {
      const journal = out();
      assert.ok(!journal.includes('FATAL - echec de demarrage'), 'aucun FATAL attendu');
      assert.ok(journal.includes('DÉMARRÉ SUR LE PORT'), 'annonce de démarrage attendue');
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });

  it('8. PROCESSUS COMPLET : dev + interface exposée (strict 0) → exit 1 + FATAL (SEC-01 fail-fast)', async () => {
    const port = await freePort();
    const env = childEnv({
      VOLACO_JWT_SECRET: VALID_SECRET,
      NODE_ENV: 'development',
      VOLACO_STRICT_AUTH: '0',
      VOLACO_BIND_HOST: '0.0.0.0',
      VOLACO_ALLOW_INSECURE_DEV: undefined,
      PORT: String(port)
    });
    const res = await runToExit(env);
    assertFatalBoot(res, 'strict désactivé sur interface exposée');
    assert.ok(/strict/i.test(res.out), 'le refus de mode non strict doit être nommé');
    assert.ok(/expos|interface/i.test(res.out), 'la cause (interface exposée) doit être lisible');
  });
});
