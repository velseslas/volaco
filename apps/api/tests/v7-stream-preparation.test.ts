import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  configureStreamPreparation,
  isStreamPreparationEnabled,
  resolveStreamImpactTargets
} from '../src/routes/conversation.js';
import type { EngineeringPlan } from '../../../packages/core/src/ai-native/conversation-intelligence/types.js';

const source = readFileSync(
  resolve(process.cwd(), 'apps/api/src/routes/conversation.ts'),
  'utf8'
);

afterEach(() => {
  configureStreamPreparation(false);
});

describe('V7 — préparation moteur dans le flux stream', () => {
  it('le flag est désactivé par défaut et pilotable sans redémarrage', () => {
    configureStreamPreparation(false);
    assert.equal(isStreamPreparationEnabled(), false);
    configureStreamPreparation(true);
    assert.equal(isStreamPreparationEnabled(), true);
  });

  it('les cibles d’impact viennent des étapes du plan, sans doublon', () => {
    const plan: EngineeringPlan = {
      planId: 'plan-test',
      title: 'Plan test',
      summary: 'Vérifier les cibles',
      planHash: 'hash-test',
      status: 'DRAFT',
      steps: [
        {
          stepIndex: 1,
          title: 'Modifier la page',
          description: 'Modifier index.html',
          operation: 'MODIFY',
          requiresApproval: false,
          targetFiles: ['index.html', 'src/app.ts']
        },
        {
          stepIndex: 2,
          title: 'Vérifier le module',
          description: 'Vérifier src/app.ts',
          operation: 'VERIFY',
          requiresApproval: false,
          targetFiles: ['src/app.ts']
        }
      ]
    };

    assert.deepEqual(resolveStreamImpactTargets(plan), ['index.html', 'src/app.ts']);
    assert.deepEqual(resolveStreamImpactTargets(undefined), ['index.html']);
  });

  it('le flux appelle prepareTurn, utilise son plan et prévoit un repli explicite', () => {
    assert.ok(
      source.includes('conversationIntelligenceService.prepareTurn('),
      'le flux doit appeler la phase de préparation du moteur'
    );
    assert.ok(
      source.includes('preparedTurn?.plan ?? planGenerator.generatePlan'),
      'le plan préparé doit primer, avec repli local'
    );
    assert.ok(
      source.includes("emitNamed('on_preparation_fallback'"),
      'un échec de préparation doit être signalé'
    );
    assert.ok(
      source.includes('resolveStreamImpactTargets(plan)'),
      'l’impact doit utiliser les fichiers cibles du plan'
    );
    assert.ok(
      source.includes('preparation: preparationSummary'),
      'la provenance de la préparation doit être exposée dans done'
    );
    assert.ok(
      source.includes('targetFiles: [STREAM_MUTATION_PATH]'),
      'le plan préparé doit recevoir la cible réelle du flux'
    );
    assert.ok(
      source.includes('buildEngineeringBrief(preparedTurn)'),
      'la taille réelle du brief <engineering_context> doit être mesurée'
    );
    assert.ok(
      source.includes('briefChars: engineeringBrief.length'),
      'la mesure du brief doit être exposée dans la préparation et dans done'
    );
    assert.ok(
      source.includes('memory: preparedTurn?.projectMemory'),
      'la mémoire projet préparée doit alimenter la décision'
    );
    assert.ok(
      source.includes('memoryRisks: decisionSummary.memory?.matchedRisks.length'),
      'les signaux mémoire doivent être exposés dans la timeline'
    );
    const studio = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.ok(
      studio.includes('risque(s) mémoire') && studio.includes('contrainte(s) mémoire'),
      'le Studio doit rendre les signaux mémoire visibles dans l’avis de décision'
    );
  });
});
