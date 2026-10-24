/**
 * CDC V8.1 WOW §18 — QUALITY BUDGETS : preuves réelles.
 *
 * Prouve :
 *  - les défauts et bornes documentés ;
 *  - l'acceptation des alias snake_case du CDC et la base persistée ;
 *  - le refus strict d'une valeur hors bornes (aucune correction silencieuse) ;
 *  - le gate d'exécution (itérations, tokens, calcul, changements visuels,
 *    fichiers, latence) avec des usages mesurés ;
 *  - l'isolation du store par couple tenant+projet et l'idempotence des
 *    exécutions archivées.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_QUALITY_BUDGET,
  QUALITY_BUDGET_VERSION,
  QualityBudgetTracker,
  QualityBudgetValidationError,
  budgetToLoopOptions,
  evaluateQualityBudgetUsage,
  normalizeQualityBudget,
  type QualityBudget,
  type QualityBudgetUsage
} from '../../../src/ai-native/design-harmony/quality-budget.js';
import { QualityBudgetStore } from '../../../src/ai-native/design-harmony/quality-budget-store.js';

const BUDGET: QualityBudget = {
  version: QUALITY_BUDGET_VERSION,
  maxIterations: 2,
  maxTokens: 1_000,
  maxComputeMs: 10_000,
  maxVisualChanges: 1,
  maxFilesChanged: 1,
  maxLatencyMs: 5_000,
  qualityTarget: 90,
  minimumImprovementDelta: 2
};

describe('CDC V8.1 Lot 4 — quality budgets §18', () => {
  it('1. défauts documentés et mapping vers la boucle §17', () => {
    assert.equal(DEFAULT_QUALITY_BUDGET.version, '8.1');
    assert.equal(DEFAULT_QUALITY_BUDGET.maxIterations, 2);
    assert.equal(DEFAULT_QUALITY_BUDGET.maxFilesChanged, 1);
    assert.deepEqual(budgetToLoopOptions(DEFAULT_QUALITY_BUDGET), {
      maxIterations: 2,
      target: 90,
      deltaThreshold: 2
    });
  });

  it('2. alias CDC snake_case + base persistée sans écraser les champs absents', () => {
    const normalized = normalizeQualityBudget(
      {
        max_iterations: 3,
        max_tokens: 4_000,
        max_compute_ms: 20_000,
        max_visual_changes: 2,
        max_files_changed: 2,
        max_latency_ms: 8_000,
        quality_target: 95,
        minimum_improvement_delta: 3
      },
      { base: BUDGET }
    );
    assert.equal(normalized.maxIterations, 3);
    assert.equal(normalized.maxTokens, 4_000);
    assert.equal(normalized.qualityTarget, 95);
    assert.equal(normalized.minimumImprovementDelta, 3);

    const partial = normalizeQualityBudget({ max_tokens: 2_000 }, { base: BUDGET });
    assert.equal(partial.maxTokens, 2_000);
    assert.equal(partial.maxIterations, BUDGET.maxIterations);
    assert.equal(partial.qualityTarget, BUDGET.qualityTarget);
  });

  it('3. mode tolérant = bornes ; mode strict = refus explicite', () => {
    const clamped = normalizeQualityBudget({ maxIterations: 99, maxTokens: 1 });
    assert.equal(clamped.maxIterations, 4);
    assert.equal(clamped.maxTokens, 64);

    assert.throws(
      () => normalizeQualityBudget({ maxIterations: 99 }, { strict: true }),
      (error: unknown) =>
        error instanceof QualityBudgetValidationError &&
        error.field === 'maxIterations' &&
        /entre 1 et 4/.test(error.message)
    );
    assert.throws(
      () => normalizeQualityBudget({ maxTokens: 'beaucoup' }, { strict: true }),
      (error: unknown) => error instanceof QualityBudgetValidationError && error.field === 'maxTokens'
    );
  });

  it('4. gate réel : changements visuels, tokens, calcul et latence', () => {
    let now = 1_000;
    const tracker = new QualityBudgetTracker(BUDGET, { now: () => now });
    assert.equal(tracker.canStartIteration().allowed, true);

    tracker.recordIterationStarted();
    tracker.recordLlmCall(400, 1_200);
    tracker.recordIterationCompleted();
    tracker.recordVisualChange(1);
    const blocked = tracker.canStartIteration();
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.exhaustedBy.includes('maxVisualChanges'));
    assert.equal(tracker.status().usage.tokensUsed, 400);
    assert.equal(tracker.status().usage.maxCallLatencyMs, 1_200);
    assert.equal(tracker.nextCallMaxTokens(), 600);
    assert.equal(tracker.nextCallTimeoutMs(), 5_000);

    const tokenTracker = new QualityBudgetTracker(BUDGET, { now: () => now });
    tokenTracker.recordLlmCall(1_000, 10);
    assert.ok(tokenTracker.canStartIteration().exhaustedBy.includes('maxTokens'));

    now = 1_000;
    const computeTracker = new QualityBudgetTracker(BUDGET, { now: () => now });
    now = 12_000;
    assert.ok(computeTracker.canStartIteration().exhaustedBy.includes('maxComputeMs'));
  });

  it('5. statut final calculé depuis un usage réel (fichiers inclus)', () => {
    const usage: QualityBudgetUsage = {
      iterationsStarted: 2,
      iterationsCompleted: 2,
      tokensUsed: 900,
      computeMs: 9_999,
      visualChanges: 1,
      filesChanged: 1,
      maxCallLatencyMs: 4_000
    };
    const status = evaluateQualityBudgetUsage(BUDGET, usage);
    assert.equal(status.exhausted, true);
    assert.ok(status.exhaustedBy.includes('maxIterations'));
    assert.ok(status.exhaustedBy.includes('maxVisualChanges'));
    assert.ok(!status.exhaustedBy.includes('maxTokens'));
    assert.equal(status.usage.filesChanged, 1);
  });

  it('6. store : isolation projet, exécution idempotente, reset du budget', () => {
    const store = new QualityBudgetStore();
    const saved = store.setConfig({
      tenantId: 'tenant-a',
      projectId: 'project-1',
      budget: { ...BUDGET, maxIterations: 1 },
      updatedBy: 'lot4-test',
      updatedAt: '2026-10-21T10:00:00.000Z'
    });
    assert.equal(saved.budget.maxIterations, 1);
    assert.equal(store.getEffective('tenant-a', 'project-1').maxIterations, 1);
    assert.equal(store.getEffective('tenant-a', 'project-2').maxIterations, DEFAULT_QUALITY_BUDGET.maxIterations);

    const execution = {
      executionId: 'qbx-fixed',
      tenantId: 'tenant-a',
      projectId: 'project-1',
      startedAt: '2026-10-21T10:00:00.000Z',
      finishedAt: '2026-10-21T10:00:01.000Z',
      budget: saved.budget,
      usage: {
        iterationsStarted: 1,
        iterationsCompleted: 1,
        tokensUsed: 10,
        computeMs: 500,
        visualChanges: 1,
        filesChanged: 0,
        maxCallLatencyMs: 400
      },
      status: evaluateQualityBudgetUsage(saved.budget, {
        iterationsStarted: 1,
        iterationsCompleted: 1,
        tokensUsed: 10,
        computeMs: 500,
        visualChanges: 1,
        filesChanged: 0,
        maxCallLatencyMs: 400
      }),
      stopReason: 'TARGET_REACHED',
      applyRequested: false,
      modified: false
    } as const;
    assert.equal(store.recordExecution(execution).created, true);
    assert.equal(store.recordExecution(execution).created, false);
    assert.equal(store.listExecutions('tenant-a', 'project-1').length, 1);
    assert.equal(store.listExecutions('tenant-a', 'project-2').length, 0);

    assert.equal(store.clearConfig('tenant-a', 'project-1'), true);
    assert.equal(store.getEffective('tenant-a', 'project-1').maxIterations, DEFAULT_QUALITY_BUDGET.maxIterations);
    store.clear();
    assert.equal(store.listExecutions('tenant-a', 'project-1').length, 0);
  });
});
