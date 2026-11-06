import './_lot-b-legacy-env.js';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { configureDecideRoute, produceAdvisoryDecision } from '../src/routes/decide.js';
import { DecisionEngine } from '../../../packages/core/src/ai-native/decision-engine/decision-engine.js';
import { ConstraintRegistry } from '../../../packages/core/src/ai-native/decision-engine/constraint-registry.js';
import { DecisionLedger } from '../../../packages/core/src/ai-native/decision-engine/decision-ledger.js';
import { AlternativeGenerator } from '../../../packages/core/src/ai-native/decision-engine/alternative-generator.js';
import { AnalystRegistry } from '../../../packages/core/src/ai-native/intelligence-pool/analysts/index.js';
import { fileStore } from '../../../packages/core/src/file-explorer/index.js';
import type { IntentResult, ProjectMemory } from '../../../packages/core/src/ai-native/conversation-intelligence/types.js';

function memory(): ProjectMemory {
  return {
    architecturalDecisions: [],
    userPreferences: {},
    acceptedPlans: [],
    rejectedPlans: [],
    knownConstraints: [],
    knownConventions: [],
    knownRisks: ['Ne pas casser le paiement']
  };
}

const intent: IntentResult = {
  category: 'MODIFY',
  goal: 'Modifier la page de paiement',
  requestedAction: 'modifier la page de paiement',
  entities: ['paiement'],
  constraints: [],
  urgency: 'NORMAL',
  confidence: 0.9,
  ambiguities: []
};

describe('V7 — décision consultative du flux avec mémoire projet', () => {
  it('transmet la mémoire réelle au moteur, expose les signaux et ne persiste rien', async () => {
    const ledger = new DecisionLedger({
      fileName: `v7-stream-decision-memory-${Date.now()}-${Math.random().toString(36).slice(2)}`
    });
    configureDecideRoute({
      decisionEngine: new DecisionEngine({
        constraintRegistry: new ConstraintRegistry({ adrDir: '/nonexistent' }),
        decisionLedger: ledger,
        alternativeGenerator: new AlternativeGenerator()
      }),
      analystRegistry: new AnalystRegistry(),
      fileStore
    });

    const before = ledger.count();
    const decision = await produceAdvisoryDecision({
      tenantId: 'studio-local',
      projectId: 'proj_v7_decision_memory',
      sessionId: 'sess_v7_decision_memory',
      intent,
      memory: memory()
    });

    assert.ok(decision, 'la décision consultative doit être produite');
    assert.equal(decision.recorded, false);
    assert.equal(decision.verdict, 'NEEDS_CONFIRMATION');
    assert.deepEqual(decision.memory.matchedRisks, ['Ne pas casser le paiement']);
    assert.match(decision.rationale, /Mémoire projet/);
    assert.equal(ledger.count(), before, 'le Decision Ledger ne doit pas grossir');
  });
});
