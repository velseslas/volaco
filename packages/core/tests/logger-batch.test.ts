/**
 * n°4 — journalisation hors chemin critique : info/debug différés et
 * coalescés (1 write/tick), warn/error synchrones, flush() explicite.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StructuredLogger } from '../src/logger.js';

describe('n°4 : logger batché', () => {
  it('1. info différé (pas écrit sync), flush() écrit en une fois', async () => {
    const written: string[] = [];
    const origLog = console.log;
    console.log = ((...args: unknown[]) => { written.push(args.map(String).join(' ')); }) as typeof console.log;
    try {
      const logger = new StructuredLogger({ service: 'test' });
      logger.info('premier', { n: 1 }, 'req-1');
      logger.info('second', { n: 2 }, 'req-2');
      assert.equal(written.length, 0, 'info ne doit rien écrire synchroniquement');
      logger.flush();
      assert.equal(written.length, 1, 'flush() coalesce en UNE écriture');
      assert.ok(written[0]!.includes('premier') && written[0]!.includes('second'), 'les 2 entrées sont présentes');
      // setImmediate programmé avant flush() ne doit pas réécrire (queue vide).
      await new Promise((r) => setImmediate(r));
      assert.equal(written.length, 1, 'pas de double écriture au tick suivant');
    } finally {
      console.log = origLog;
    }
  });

  it('2. warn/error restent synchrones (diagnostic jamais en queue)', () => {
    const logged: string[] = [];
    const warned: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = ((...a: unknown[]) => { logged.push(a.map(String).join(' ')); }) as typeof console.log;
    console.warn = ((...a: unknown[]) => { warned.push(a.map(String).join(' ')); }) as typeof console.warn;
    console.error = ((...a: unknown[]) => { warned.push(a.map(String).join(' ')); }) as typeof console.error;
    try {
      const logger = new StructuredLogger({});
      logger.warn('refus-acces', {}, 'req-w');
      logger.error('panne', {}, 'req-e');
      assert.equal(warned.length, 2, 'warn+error écrits aussitôt');
      assert.equal(logged.length, 0, 'rien en queue info');
      logger.flush();
      assert.equal(logged.length, 0, 'flush() ne rejoue pas les warn/error');
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
  });

  it('3. VOLACO_LOG_SYNC=1 restaure l’écriture synchrone', () => {
    const written: string[] = [];
    const origLog = console.log;
    console.log = ((...a: unknown[]) => { written.push(a.map(String).join(' ')); }) as typeof console.log;
    const prev = process.env.VOLACO_LOG_SYNC;
    process.env.VOLACO_LOG_SYNC = '1';
    try {
      const logger = new StructuredLogger({});
      logger.info('sync-check');
      assert.equal(written.length, 1, 'info écrit aussitôt en mode sync');
    } finally {
      if (prev === undefined) delete process.env.VOLACO_LOG_SYNC;
      else process.env.VOLACO_LOG_SYNC = prev;
      console.log = origLog;
    }
  });
});
