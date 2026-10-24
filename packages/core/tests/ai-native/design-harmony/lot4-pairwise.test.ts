/**
 * CDC V8.1 WOW §9 — ÉVALUATION PAIRWISE : preuves réelles.
 *
 * Prouve :
 *  - une préférence système déterministe fondée sur les AQS mesurés ;
 *  - l'absence de préférence inventée quand la couverture est insuffisante ;
 *  - la préférence humaine qui prime et transforme le statut du dataset ;
 *  - la persistance isolée par projet, l'idempotence et la confirmation humaine.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignEvaluationDatasetStore,
  PAIRWISE_CRITERIA,
  evaluatePairwiseVisual,
  withHumanPreference,
  type PairwiseEvaluation
} from '../../../src/ai-native/design-harmony/pairwise-evaluation.js';
import type { AestheticQualityScore, AqsDimensionId } from '../../../src/ai-native/design-harmony/types.js';

function aqs(values: Partial<Record<AqsDimensionId, number | null>>, overall: number | null, coverage = 1): AestheticQualityScore {
  return {
    version: '8.0',
    determinism: 'DETERMINISTIC',
    overall,
    coverage,
    computedCount: PAIRWISE_CRITERIA.filter((criterion) => values[criterion.id] !== null && values[criterion.id] !== undefined).length,
    unknownCount: PAIRWISE_CRITERIA.filter((criterion) => values[criterion.id] === null || values[criterion.id] === undefined).length,
    subScores: PAIRWISE_CRITERIA.map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      value: values[criterion.id] ?? null,
      confidence: 0.9,
      evidence: [`mesure test ${criterion.id}`],
      ...(values[criterion.id] === null ? { unknownReason: 'preuve absente dans le test' } : {})
    }))
  };
}

const ALL_70 = Object.fromEntries(PAIRWISE_CRITERIA.map((criterion) => [criterion.id, 70])) as Record<AqsDimensionId, number>;
const ALL_80 = Object.fromEntries(PAIRWISE_CRITERIA.map((criterion) => [criterion.id, 80])) as Record<AqsDimensionId, number>;
const ALL_NULL = Object.fromEntries(PAIRWISE_CRITERIA.map((criterion) => [criterion.id, null])) as Record<AqsDimensionId, null>;

describe('CDC V8.1 Lot 4 — évaluation pairwise §9', () => {
  it('1. système : B progresse réellement, conclusion au format CDC + avertissement humain', () => {
    const evaluation = evaluatePairwiseVisual({
      tenantId: 'tenant-a',
      projectId: 'project-1',
      beforeVersionId: 'rev-a',
      afterVersionId: 'rev-b',
      before: aqs(ALL_70, 70),
      after: aqs(ALL_80, 80),
      evaluatedAt: '2026-10-21T10:00:00.000Z'
    });
    assert.equal(evaluation.systemPreference, 'B');
    assert.equal(evaluation.finalPreference, 'B');
    assert.equal(evaluation.referenceStatus, 'SYSTEM_ONLY');
    assert.equal(evaluation.overallDelta, 10);
    assert.equal(evaluation.comparableCriteria, 12);
    assert.equal(evaluation.coverage, 1);
    assert.ok(evaluation.improvements.length >= 3);
    assert.match(evaluation.conclusion, /Version B améliore/);
    assert.match(evaluation.conclusion, /ACCEPT/);
    assert.match(evaluation.selfGradingWarning ?? '', /confirmer/);
    assert.ok(evaluation.evaluationId.startsWith('pw-'));
    assert.equal(evaluation.evaluationId.length, 19);
  });

  it('2. préférence humaine : prime sur le système, dataset confirmé, warning supprimé', () => {
    const system = evaluatePairwiseVisual({
      tenantId: 'tenant-a',
      projectId: 'project-1',
      beforeVersionId: 'rev-a',
      afterVersionId: 'rev-b',
      before: aqs(ALL_70, 70),
      after: aqs(ALL_80, 80)
    });
    const human = withHumanPreference(system, 'A', 'client-lot4', '2026-10-21T10:05:00.000Z');
    assert.equal(human.systemPreference, 'B');
    assert.equal(human.humanPreference, 'A');
    assert.equal(human.finalPreference, 'A');
    assert.equal(human.referenceStatus, 'HUMAN_CONFIRMED');
    assert.equal(human.selfGradingWarning, null);
    assert.equal(human.evaluatorId, 'client-lot4');
    assert.match(human.conclusion, /Préférence humaine : A/);
  });

  it('3. couverture insuffisante : UNKNOWN, aucune recommandation fabriquée', () => {
    const evaluation = evaluatePairwiseVisual({
      tenantId: 'tenant-a',
      projectId: 'project-1',
      beforeVersionId: 'rev-a',
      afterVersionId: 'rev-b',
      before: aqs(ALL_NULL, null, 0),
      after: aqs(ALL_NULL, null, 0)
    });
    assert.equal(evaluation.systemPreference, 'UNKNOWN');
    assert.equal(evaluation.overallDelta, null);
    assert.equal(evaluation.comparableCriteria, 0);
    assert.match(evaluation.conclusion, /indéterminée/);
    assert.ok(evaluation.criteria.every((criterion) => criterion.delta === null));
  });

  it('4. une préférence humaine sans identité est refusée', () => {
    assert.throws(
      () =>
        evaluatePairwiseVisual({
          tenantId: 'tenant-a',
          projectId: 'project-1',
          beforeVersionId: 'rev-a',
          afterVersionId: 'rev-b',
          before: aqs(ALL_70, 70),
          after: aqs(ALL_80, 80),
          humanPreference: 'A'
        }),
      /evaluatorId/
    );
    assert.throws(
      () =>
        evaluatePairwiseVisual({
          tenantId: 'tenant-a',
          projectId: 'project-1',
          beforeVersionId: 'rev-a',
          afterVersionId: 'rev-b',
          before: aqs(ALL_70, 70),
          after: aqs(ALL_80, 80),
          humanPreference: 'C' as never,
          evaluatorId: 'client-lot4'
        }),
      /humanPreference/
    );
  });

  it('5. dataset : idempotence, isolation, confirmation humaine et statistiques', () => {
    const store = new DesignEvaluationDatasetStore();
    const evaluation = evaluatePairwiseVisual({
      tenantId: 'tenant-a',
      projectId: 'project-1',
      beforeVersionId: 'rev-a',
      afterVersionId: 'rev-b',
      before: aqs(ALL_70, 70),
      after: aqs(ALL_80, 80),
      evaluatedAt: '2026-10-21T10:00:00.000Z'
    });
    assert.equal(store.record(evaluation).created, true);
    assert.equal(store.record(evaluation).created, false);
    assert.equal(store.list('tenant-a', 'project-1').length, 1);
    assert.equal(store.list('tenant-a', 'project-2').length, 0);
    assert.deepEqual(store.stats('tenant-a', 'project-1'), {
      total: 1,
      humanConfirmed: 0,
      systemOnly: 1
    });

    // Rejouer la MÊME paire avec une préférence humaine doit compléter le
    // dataset SYSTEM_ONLY, pas être ignoré par l'idempotence.
    const humanEvaluation = evaluatePairwiseVisual({
      tenantId: 'tenant-a',
      projectId: 'project-1',
      beforeVersionId: 'rev-a',
      afterVersionId: 'rev-b',
      before: aqs(ALL_70, 70),
      after: aqs(ALL_80, 80),
      humanPreference: 'B',
      evaluatorId: 'client-lot4',
      evaluatedAt: '2026-10-21T10:07:00.000Z'
    });
    assert.equal(humanEvaluation.evaluationId, evaluation.evaluationId);
    const upgraded = store.record(humanEvaluation);
    assert.equal(upgraded.created, false);
    assert.equal(upgraded.evaluation.referenceStatus, 'HUMAN_CONFIRMED');
    assert.deepEqual(store.stats('tenant-a', 'project-1'), {
      total: 1,
      humanConfirmed: 1,
      systemOnly: 0
    });

    const updated = store.setHumanPreference({
      tenantId: 'tenant-a',
      projectId: 'project-1',
      evaluationId: evaluation.evaluationId,
      preference: 'EQUIVALENT',
      evaluatorId: 'client-lot4',
      evaluatedAt: '2026-10-21T10:10:00.000Z'
    });
    assert.ok(updated instanceof Object);
    assert.equal((updated as PairwiseEvaluation).finalPreference, 'EQUIVALENT');
    assert.deepEqual(store.stats('tenant-a', 'project-1'), {
      total: 1,
      humanConfirmed: 1,
      systemOnly: 0
    });
    assert.equal(
      store.setHumanPreference({
        tenantId: 'tenant-a',
        projectId: 'project-1',
        evaluationId: 'pw-inconnu',
        preference: 'A',
        evaluatorId: 'client-lot4',
        evaluatedAt: '2026-10-21T10:10:00.000Z'
      }),
      undefined
    );
    store.clear();
    assert.equal(store.list('tenant-a', 'project-1').length, 0);
  });
});
