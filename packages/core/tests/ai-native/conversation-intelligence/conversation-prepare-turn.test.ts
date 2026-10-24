import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClarificationEngine,
  ContradictionDetector,
  ConversationAssumptionEngine,
  ConversationCompass,
  ConversationEngine,
  ConversationIntentEngine,
  ExecutionBridge,
  ImpactBridge,
  MemoryManager,
  PlanGenerator,
  UnderstandingBridge,
  type ConversationSession,
  type IntentResult
} from '../../../src/index.js';

function makeEngine(): ConversationEngine {
  return new ConversationEngine(
    new ConversationIntentEngine(),
    new ClarificationEngine(),
    new ConversationAssumptionEngine(),
    new ConversationCompass(),
    new PlanGenerator(),
    new ContradictionDetector(),
    new MemoryManager(),
    new UnderstandingBridge(),
    new ImpactBridge(),
    new ExecutionBridge()
  );
}

function makeSession(): ConversationSession {
  return {
    sessionId: 'sess-prepare-test',
    conversationId: 'conv-prepare-test',
    tenantId: 'tenant-prepare',
    projectId: 'proj-prepare',
    currentState: 'EXPLORING',
    turns: [],
    activeAssumptions: [],
    activeDecisions: [],
    applicationSnapshot: {
      treeHash: 'tree:test',
      graphHash: 'graph:test',
      understandingHash: 'understanding:test'
    },
    turnMemory: {
      recentMessages: [],
      currentAssumptions: []
    },
    projectMemory: {
      architecturalDecisions: [],
      userPreferences: {},
      acceptedPlans: [],
      rejectedPlans: [],
      knownConstraints: [],
      knownConventions: [],
      knownRisks: []
    }
  };
}

describe('AINT-009 — prepareTurn (phase de préparation pure)', () => {
  it('prépare intention, plan et contexte sans modifier la session', async () => {
    const engine = makeEngine();
    const session = makeSession();
    const before = JSON.stringify(session);

    const prepared = await engine.prepareTurn({
      session,
      userMessageText: 'Crée une page dashboard avec un bouton de validation',
      userRole: 'OWNER',
      requestId: 'req_prepare_test'
    });

    assert.equal(prepared.intent.category, 'CREATE');
    assert.ok(prepared.plan, 'un plan doit être préparé pour une création');
    assert.ok((prepared.plan?.steps.length ?? 0) > 0);
    assert.ok(
      prepared.nextState === 'PLANNING' || prepared.nextState === 'WAITING_CONFIRMATION',
      `état de préparation inattendu: ${prepared.nextState}`
    );
    assert.ok(prepared.context, 'le contexte borné doit être construit');
    assert.equal(prepared.context.currentMessage, 'Crée une page dashboard avec un bouton de validation');

    assert.equal(JSON.stringify(session), before, 'prepareTurn ne doit rien écrire dans la session');
    assert.equal(session.turns.length, 0);
  });

  it('propage les fichiers cibles explicites et la mémoire projet', async () => {
    const engine = makeEngine();
    const session = makeSession();
    const memory = {
      ...session.projectMemory,
      knownRisks: ['Ne pas casser le paiement']
    };
    const sessionWithMemory: ConversationSession = { ...session, projectMemory: memory };

    const prepared = await engine.prepareTurn({
      session: sessionWithMemory,
      userMessageText: 'Modifie la page de paiement',
      targetFiles: ['index.html'],
      userRole: 'OWNER',
      requestId: 'req_prepare_targets'
    });

    assert.ok(prepared.plan, 'un plan doit être préparé');
    assert.deepEqual(prepared.plan?.steps[1]?.targetFiles, ['index.html']);
    assert.deepEqual(prepared.plan?.steps[2]?.targetFiles, ['index.html']);
    assert.equal(prepared.projectMemory, memory, 'la mémoire projet doit être exposée sans copie ni mutation');
    assert.deepEqual(prepared.projectMemory.knownRisks, ['Ne pas casser le paiement']);
  });

  it('réutilise une intention pré-classifiée sans relancer la classification', async () => {
    const engine = makeEngine();
    const session = makeSession();
    const suppliedIntent: IntentResult = {
      category: 'QUESTION',
      goal: 'Quel est le nom du projet ?',
      requestedAction: 'answer',
      entities: ['projet'],
      constraints: [],
      urgency: 'NORMAL',
      confidence: 0.42,
      ambiguities: []
    };

    const prepared = await engine.prepareTurn({
      session,
      userMessageText: 'Ce texte ne doit pas être reclassifié',
      intent: suppliedIntent,
      userRole: 'OWNER',
      requestId: 'req_prepare_intent'
    });

    assert.equal(prepared.intent, suppliedIntent, 'l’intention fournie doit être utilisée telle quelle');
    assert.equal(prepared.intent.category, 'QUESTION');
    assert.equal(prepared.plan, undefined, 'une question sans plan actif ne doit pas créer de plan');
  });

  it('processTurn continue de produire un tour complet après extraction', async () => {
    const engine = makeEngine();
    const session = makeSession();

    const result = await engine.processTurn({
      session,
      userMessageText: 'Crée une page contact',
      userRole: 'OWNER',
      requestId: 'req_process_parity'
    });

    assert.equal(result.updatedSession.turns.length, 1);
    assert.equal(result.turn.intent.category, 'CREATE');
    assert.equal(result.turn.stateBefore, 'EXPLORING');
    assert.ok(result.turn.agentResponse.content.length > 0);
    assert.equal(result.updatedSession.turns[0]?.turnId, result.turn.turnId);
  });
});
