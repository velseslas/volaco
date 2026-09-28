/**
 * LOT B — tests du normalisateur ActivityEvent (Live Agent Activity Stream).
 * Garanties : mapping des 19 types bruts, fallback OUVERT pour les types
 * futurs, rétro-compatibilité (record ancien sans champs), extraction du
 * fichier, ordre préservé — et aucune exception possible.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExecutionEvent, normalizeExecutionRecord } from '../../../src/ai-native/execution/activity.js';
import type { ExecutionEvent } from '../../../src/ai-native/execution/types.js';

function evt(partial: Partial<ExecutionEvent>): ExecutionEvent {
  return {
    id: 'evt_test',
    executionId: 'exec_test',
    seq: 1,
    ts: 1700000000000,
    phase: 'IMPLEMENT',
    type: 'FILE_READ',
    status: 'COMPLETED',
    title: 'Test',
    ...partial
  };
}

describe('LOT B : normalisation ExecutionEvent → ActivityEvent', () => {
  it('1. mapping des familles : file/plan/validation/repair/execution', () => {
    const cases: Array<[ExecutionEvent['type'], string, string]> = [
      ['FILE_READ', 'file', 'read'],
      ['FILE_CREATED', 'file', 'create'],
      ['FILE_MODIFIED', 'file', 'modify'],
      ['FILE_DELETED', 'file', 'delete'],
      ['DIFF_GENERATED', 'file', 'diff'],
      ['PLAN_CREATED', 'plan', 'create'],
      ['PLAN_APPROVED', 'plan', 'approve'],
      ['VALIDATION_COMPLETED', 'validation', 'validate'],
      ['VALIDATION_FAILED', 'validation', 'validate'],
      ['REPAIR_STARTED', 'repair', 'repair'],
      ['RETRY_STARTED', 'repair', 'retry'],
      ['EXECUTION_COMPLETED', 'execution', 'complete'],
      ['EXECUTION_FAILED', 'execution', 'fail'],
      ['EXECUTION_CANCELLED', 'execution', 'cancel'],
      ['SUMMARY_GENERATED', 'execution', 'summary'],
      ['EXECUTION_STARTED', 'execution', 'start'],
      ['PHASE_CHANGED', 'agent', 'phase']
    ];
    for (const [type, wantType, wantAction] of cases) {
      const a = normalizeExecutionEvent(evt({ type, status: 'COMPLETED' }));
      assert.equal(a.type, wantType, `type de ${type}`);
      assert.equal(a.action, wantAction, `action de ${type}`);
      assert.equal(a.raw, type, 'le brut est conservé (raw)');
    }
  });

  it('2. fallback OUVERT : un type futur se normalise sans refonte', () => {
    // Un type qui n'existe pas encore dans l'enum (transmis tel quel)
    const a = normalizeExecutionEvent(evt({ type: 'SEARCH_COMPLETED' as ExecutionEvent['type'], status: 'COMPLETED' }));
    assert.equal(a.type, 'event');
    assert.equal(a.action, 'search_completed');
    assert.equal(a.status, 'COMPLETED');
    assert.equal(a.raw, 'SEARCH_COMPLETED');
  });

  it('3. statuts : mapping complet + défaut rétro-compatible', () => {
    assert.equal(normalizeExecutionEvent(evt({ status: 'RUNNING' })).status, 'RUNNING');
    assert.equal(normalizeExecutionEvent(evt({ status: 'FAILED' })).status, 'FAILED');
    assert.equal(normalizeExecutionEvent(evt({ status: 'CANCELLED' })).status, 'CANCELLED');
    assert.equal(normalizeExecutionEvent(evt({ status: 'WAITING_USER' })).status, 'WAITING_USER');
    assert.equal(normalizeExecutionEvent(evt({ status: 'SKIPPED' as ExecutionEvent['status'] })).status, 'SKIPPED');
    // Un ancien record sans status exploitable → COMPLETED par défaut
    assert.equal(normalizeExecutionEvent(evt({ status: 'INCONNU' as ExecutionEvent['status'] })).status, 'COMPLETED');
  });

  it('4. timestamps : RUNNING porte startedAt, COMPLETED porte completedAt', () => {
    const running = normalizeExecutionEvent(evt({ status: 'RUNNING' }));
    assert.equal(running.startedAt, 1700000000000);
    assert.equal(running.completedAt, undefined);
    const done = normalizeExecutionEvent(evt({ status: 'COMPLETED' }));
    assert.equal(done.completedAt, 1700000000000);
    assert.equal(done.startedAt, undefined);
  });

  it('5. extraction du fichier : detail.path prioritaire, sinon detail.section', () => {
    const read = normalizeExecutionEvent(evt({ type: 'FILE_READ', detail: { path: 'index.html', chars: 100 } }));
    assert.equal(read.file, 'index.html');
    const section = normalizeExecutionEvent(evt({ type: 'FILE_MODIFIED', detail: { section: 'hero', mode: 'modify', chars: 800 } }));
    assert.equal(section.file, 'hero');
  });

  it('6. erreur transportée sans exception, metadata conservées', () => {
    const a = normalizeExecutionEvent(evt({
      type: 'EXECUTION_FAILED', status: 'FAILED',
      detail: { error: 'HTTP 401', mode: 'modify' }
    }));
    assert.equal(a.error, 'HTTP 401');
    assert.equal(a.metadata?.mode, 'modify');
  });

  it('7. rétro-compatibilité : un record ancien minimal ne lève jamais', () => {
    // Aucun detail fourni : la normalisation produit des défauts honnêtes
    const legacy = evt({ title: '' });
    const a = normalizeExecutionEvent(legacy);
    assert.equal(a.type, 'file');
    assert.equal(a.title, 'file read');
    assert.equal(a.file, undefined);
  });

  it('8. normalizeExecutionRecord : ordre et sequence préservés', () => {
    const events = [
      evt({ id: 'e1', seq: 1, type: 'EXECUTION_STARTED', status: 'RUNNING' }),
      evt({ id: 'e2', seq: 2, type: 'FILE_READ', status: 'COMPLETED', detail: { path: 'index.html' } }),
      evt({ id: 'e3', seq: 3, type: 'FILE_MODIFIED', status: 'COMPLETED', detail: { section: 'hero' } })
    ];
    const acts = normalizeExecutionRecord(events);
    assert.equal(acts.length, 3);
    assert.deepEqual(acts.map((a) => a.sequence), [1, 2, 3]);
    assert.equal(acts[0]!.type, 'execution');
    assert.equal(acts[1]!.file, 'index.html');
    assert.equal(acts[2]!.file, 'hero');
    // Rien n'est perdu : raw dispo pour chaque item
    assert.deepEqual(acts.map((a) => a.raw), ['EXECUTION_STARTED', 'FILE_READ', 'FILE_MODIFIED']);
  });

  it('9. record vide ou nul : liste vide, jamais de crash', () => {
    assert.deepEqual(normalizeExecutionRecord([]), []);
    assert.deepEqual(normalizeExecutionRecord(undefined as unknown as []), []);
  });
});
