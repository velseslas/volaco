import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AlternativeGenerator } from '../../../src/ai-native/decision-engine/alternative-generator.js';
import { ConstraintRegistry } from '../../../src/ai-native/decision-engine/constraint-registry.js';
import { DecisionEngine } from '../../../src/ai-native/decision-engine/decision-engine.js';
import { DecisionLedger } from '../../../src/ai-native/decision-engine/decision-ledger.js';
import { matchMemorySignals } from '../../../src/ai-native/decision-engine/memory-signals.js';
import type { IntentResult, ProjectMemory } from '../../../src/ai-native/conversation-intelligence/types.js';

function emptyMemory(): ProjectMemory {
  return {
    architecturalDecisions: [],
    userPreferences: {},
    acceptedPlans: [],
    rejectedPlans: [],
    knownConstraints: [],
    knownConventions: [],
    knownRisks: []
  };
}

function intent(): IntentResult {
  return {
    category: 'MODIFY',
    goal: 'Modifier la page de paiement',
    requestedAction: 'modifier la page de paiement',
    entities: ['paiement'],
    constraints: [],
    urgency: 'NORMAL',
    confidence: 0.9,
    ambiguities: []
  };
}

function makeEngine(ledger: DecisionLedger): DecisionEngine {
  return new DecisionEngine({
    constraintRegistry: new ConstraintRegistry({ adrDir: '/nonexistent' }),
    decisionLedger: ledger,
    alternativeGenerator: new AlternativeGenerator()
  });
}

describe('V7 — mémoire projet dans le Decision Engine', () => {
  it('relie les risques et contraintes connus à l’intent par tokens significatifs', () => {
    const memory: ProjectMemory = {
      ...emptyMemory(),
      knownRisks: ['Ne pas casser le paiement'],
      knownConstraints: ['Utiliser Stripe pour le paiement'],
      architecturalDecisions: [
        {
          decisionId: 'dec-active',
          sessionId: 'sess',
          projectId: 'proj',
          statement: 'Le paiement reste côté serveur',
          reason: 'Sécurité',
          evidence: 'audit',
          confidence: 0.9,
          alternatives: [],
          selectedAlternative: 'server',
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        }
      ]
    };

    const signals = matchMemorySignals(intent(), memory);
    assert.deepEqual(signals.matchedRisks, ['Ne pas casser le paiement']);
    assert.deepEqual(signals.matchedConstraints, ['Utiliser Stripe pour le paiement']);
    assert.equal(signals.activeDecisions, 1);
  });

  it('exige une confirmation quand un risque mémoire touche une action mutante', async () => {
    const ledger = new DecisionLedger({
      fileName: `v7-memory-signals-${Date.now()}-${Math.random().toString(36).slice(2)}`
    });
    const engine = makeEngine(ledger);
    const memory: ProjectMemory = {
      ...emptyMemory(),
      knownRisks: ['Ne pas casser le paiement']
    };

    const decision = await engine.decide(
      {
        intent: intent(),
        projectId: 'proj_memory_signals',
        tenantId: 'tenant_memory_signals',
        sessionId: 'sess_memory_signals',
        memory,
        intelligenceRecommendations: []
      },
      { record: false }
    );

    assert.equal(decision.verdict, 'NEEDS_CONFIRMATION');
    assert.match(decision.rationale, /Mémoire projet/);
    assert.match(decision.rationale, /paiement/);
    assert.deepEqual(decision.memorySignals?.matchedRisks, ['Ne pas casser le paiement']);
    assert.equal(ledger.count(), 0, 'le mode consultatif ne doit rien persister');
  });

  it('laisse une décision READY sans signal mémoire', async () => {
    const ledger = new DecisionLedger({
      fileName: `v7-memory-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`
    });
    const engine = makeEngine(ledger);

    const decision = await engine.decide(
      {
        intent: intent(),
        projectId: 'proj_memory_empty',
        tenantId: 'tenant_memory_empty',
        sessionId: 'sess_memory_empty',
        memory: emptyMemory(),
        intelligenceRecommendations: []
      },
      { record: false }
    );

    assert.equal(decision.verdict, 'READY');
    assert.equal(decision.memorySignals?.matchedRisks.length, 0);
    assert.equal(decision.memorySignals?.matchedConstraints.length, 0);
    assert.equal(ledger.count(), 0);
  });
});
