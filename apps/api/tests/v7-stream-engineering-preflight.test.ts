import './_lot-b-legacy-env.js';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runEngineeringPreflight } from '../../../packages/core/src/ai-native/validation/engineering-preflight.js';

const validHtml = [
  '<!DOCTYPE html>',
  '<html lang="fr"><head><meta charset="UTF-8"><title>Préflight flux</title></head>',
  '<body><main><h1>Flux V7</h1><p>Le contenu candidat est complet et vérifiable avant écriture.</p></main></body>',
  '</html>'
].join('\n');

describe('V7-LOT5 — préflight d’ingénierie branché avant la mutation', () => {
  it('le préflight passe sur le document complet et échoue sur un fragment', () => {
    const passed = runEngineeringPreflight(validHtml, 'index.html');
    assert.equal(passed.verdict, 'PASS');
    assert.equal(passed.passed, true);

    const failed = runEngineeringPreflight(
      '<div>' + 'Fragment sans enveloppe. '.repeat(20) + '</div>',
      'index.html'
    );
    assert.equal(failed.verdict, 'FAIL');
    assert.equal(failed.passed, false);
    assert.ok(failed.blockers.length > 0);
  });

  it('le flux exécute le préflight AVANT applyStreamFileMutationWithStreamEngine', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'apps/api/src/routes/conversation.ts'),
      'utf8'
    );
    const preflightIndex = source.indexOf('runEngineeringPreflight(assembledHtml');
    const mutationIndex = source.indexOf('applyStreamFileMutationWithStreamEngine({');

    assert.ok(preflightIndex > -1, 'le flux doit appeler le préflight sur le contenu candidat');
    assert.ok(mutationIndex > -1, 'le flux doit appeler la mutation réelle');
    assert.ok(
      preflightIndex < mutationIndex,
      'le préflight doit précéder la mutation, pas la suivre'
    );
    assert.ok(
      source.includes("emitNamed('on_engineering_validated'"),
      'le verdict du préflight doit être exposé au Studio'
    );
    assert.ok(
      source.includes("persistenceError = `Préflight d'ingénierie refusé"),
      'un FAIL doit interdire l’écriture avec une raison explicite'
    );
    assert.ok(
      source.includes('...(engineeringValidation ? { engineeringValidation } : {})'),
      'le rapport complet doit partir dans done.engineeringValidation'
    );
  });

  it('le Studio rend le préflight visible dans le canal consultatif', () => {
    const studio = readFileSync(
      resolve(process.cwd(), 'apps/studio/index.html'),
      'utf8'
    );
    assert.ok(
      studio.includes("event.type === 'on_engineering_validated'"),
      'la frame de préflight doit être consommée'
    );
    assert.ok(
      studio.includes("activityFeed.advise('validation', 'Préflight'"),
      'le préflight doit alimenter l’avis Validation'
    );
    assert.ok(
      studio.includes('Préflight : '),
      'le libellé du préflight doit être lisible'
    );
  });
});
