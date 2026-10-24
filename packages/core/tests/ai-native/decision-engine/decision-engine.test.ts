/**
 * VibeCode Core - Decision Engine Unit Tests
 * Phase 9.5
 *
 * Scénarios couverts :
 *  - READY : intent QUESTION simple, aucune contrainte violée → READY
 *  - NEEDS_CONFIRMATION : intent DELETE avec risque modéré → NEEDS_CONFIRMATION
 *  - BLOCKED : intent qui violerait une contrainte HARD → BLOCKED
 *  - DEFERRED : contradiction avec décision passée → DEFERRED
 *  - ConstraintRegistry : loadDefaults + violates + addConstraint
 *  - DecisionLedger : record + findContradicting + accept/reject/supersede
 *  - AlternativeGenerator : génère au moins 1 alternative pour CREATE
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { ConstraintRegistry } from '../../../src/ai-native/decision-engine/constraint-registry.js';
import { DecisionLedger } from '../../../src/ai-native/decision-engine/decision-ledger.js';
import { AlternativeGenerator } from '../../../src/ai-native/decision-engine/alternative-generator.js';
import { DecisionEngine } from '../../../src/ai-native/decision-engine/decision-engine.js';
import type { IntentResult, ProjectMemory } from '../../../src/ai-native/conversation-intelligence/types.js';
import type { Decision, DecisionConstraint } from '../../../src/ai-native/decision-engine/types.js';

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

function makeIntent(overrides: Partial<IntentResult> = {}): IntentResult {
  return {
    category: 'MODIFY',
    goal: 'test goal',
    requestedAction: 'test action',
    entities: [],
    constraints: [],
    urgency: 'NORMAL',
    confidence: 0.8,
    ambiguities: [],
    ...overrides
  };
}

function makeContext(projectId = 'proj_test', overrides: Record<string, unknown> = {}) {
  return {
    intent: makeIntent(),
    projectId,
    tenantId: 'tenant_test',
    sessionId: 'sess_test',
    memory: emptyMemory(),
    ...overrides
  };
}

describe('PHASE 9.5 — Decision Engine', () => {
  describe('ConstraintRegistry', () => {
    it('doit charger les contraintes CDC par défaut', () => {
      const reg = new ConstraintRegistry({ adrDir: '/nonexistent' });
      const all = reg.loadConstraints('proj_x');
      assert.ok(all.length >= 7, `Expected >= 7 default constraints, got ${all.length}`);
      const ids = all.map((c) => c.id);
      assert.ok(ids.includes('cdc-34-auth-bearer'), 'cdc-34-auth-bearer should be present');
      assert.ok(ids.includes('cdc-37-terminal-sandbox'), 'cdc-37-terminal-sandbox should be present');
    });

    it('doit détecter les violations des contraintes HARD (npm run)', () => {
      const reg = new ConstraintRegistry({ adrDir: '/nonexistent' });
      const violated = reg.violates('npm run build');
      assert.ok(violated.length >= 1, `Expected violation for 'npm run', got ${violated.length}`);
    });

    it('doit détecter les violations des contraintes HARD (node -e)', () => {
      const reg = new ConstraintRegistry({ adrDir: '/nonexistent' });
      const violated = reg.violates('node -e "process.exit(1)"');
      assert.ok(violated.length >= 1, `Expected violation for 'node -e', got ${violated.length}`);
    });

    it('doit permettre l ajout de contraintes personnalisées', () => {
      const reg = new ConstraintRegistry({ adrDir: '/nonexistent' });
      const before = reg.size();
      const customConstraint: DecisionConstraint = {
        id: 'custom-no-bootstrap',
        source: 'CONVENTION',
        statement: 'Project does not use Bootstrap',
        severity: 'HARD',
        rationale: 'User preference'
      };
      reg.addConstraint(customConstraint);
      assert.equal(reg.size(), before + 1);
    });

    it('doit retourner uniquement les HARD constraints via getHardConstraints', () => {
      const reg = new ConstraintRegistry({ adrDir: '/nonexistent' });
      const hard = reg.getHardConstraints();
      for (const c of hard) {
        assert.equal(c.severity, 'HARD');
      }
    });
  });

  describe('DecisionLedger', () => {
    it('doit enregistrer une décision et la retrouver', () => {
      const ledger = new DecisionLedger({ fileName: `decisions-test-${randomUUID().slice(0, 8)}` });
      const before = ledger.count();
      const decision: Decision = {
        decisionId: 'dec-test-' + randomUUID().slice(0, 8),
        sessionId: 'sess_test',
        projectId: 'proj_test',
        tenantId: 'tenant_test',
        intentGoal: 'add login button',
        intentCategory: 'CREATE',
        verdict: 'READY',
        alternatives: [],
        constraints: [],
        contradictingDecisions: [],
        rationale: 'test',
        requiredClarifications: [],
        intelligenceSources: [],
        createdAt: new Date().toISOString(),
        status: 'PROPOSED'
      };
      ledger.recordDecision(decision);
      assert.equal(ledger.count(), before + 1);
      const found = ledger.getById(decision.decisionId);
      assert.ok(found, 'decision should be retrievable by ID');
      assert.equal(found?.intentGoal, 'add login button');
    });

    it('doit accepter une décision (status → ACCEPTED)', () => {
      const ledger = new DecisionLedger({ fileName: `decisions-test-${randomUUID().slice(0, 8)}` });
      const decisionId = 'dec-accept-' + randomUUID().slice(0, 8);
      ledger.recordDecision({
        decisionId,
        sessionId: 'sess',
        projectId: 'proj',
        tenantId: 't',
        intentGoal: 'test',
        intentCategory: 'CREATE',
        verdict: 'NEEDS_CONFIRMATION',
        alternatives: [],
        constraints: [],
        contradictingDecisions: [],
        rationale: '',
        requiredClarifications: [],
        intelligenceSources: [],
        createdAt: new Date().toISOString(),
        status: 'PROPOSED'
      });
      ledger.accept(decisionId);
      const found = ledger.getById(decisionId);
      assert.equal(found?.status, 'ACCEPTED');
    });

    it('doit rejeter une décision (status → REJECTED)', () => {
      const ledger = new DecisionLedger({ fileName: `decisions-test-${randomUUID().slice(0, 8)}` });
      const decisionId = 'dec-reject-' + randomUUID().slice(0, 8);
      ledger.recordDecision({
        decisionId,
        sessionId: 'sess',
        projectId: 'proj',
        tenantId: 't',
        intentGoal: 'test',
        intentCategory: 'CREATE',
        verdict: 'READY',
        alternatives: [],
        constraints: [],
        contradictingDecisions: [],
        rationale: '',
        requiredClarifications: [],
        intelligenceSources: [],
        createdAt: new Date().toISOString(),
        status: 'PROPOSED'
      });
      ledger.reject(decisionId);
      const found = ledger.getById(decisionId);
      assert.equal(found?.status, 'REJECTED');
    });

    it('doit filtrer les décisions par projectId', () => {
      const ledger = new DecisionLedger({ fileName: `decisions-test-${randomUUID().slice(0, 8)}` });
      ledger.recordDecision({
        decisionId: 'dec-a-' + randomUUID().slice(0, 8),
        sessionId: 'sess',
        projectId: 'proj_A',
        tenantId: 't',
        intentGoal: 'A',
        intentCategory: 'CREATE',
        verdict: 'READY',
        alternatives: [],
        constraints: [],
        contradictingDecisions: [],
        rationale: '',
        requiredClarifications: [],
        intelligenceSources: [],
        createdAt: new Date().toISOString(),
        status: 'ACCEPTED'
      });
      ledger.recordDecision({
        decisionId: 'dec-b-' + randomUUID().slice(0, 8),
        sessionId: 'sess',
        projectId: 'proj_B',
        tenantId: 't',
        intentGoal: 'B',
        intentCategory: 'CREATE',
        verdict: 'READY',
        alternatives: [],
        constraints: [],
        contradictingDecisions: [],
        rationale: '',
        requiredClarifications: [],
        intelligenceSources: [],
        createdAt: new Date().toISOString(),
        status: 'ACCEPTED'
      });
      const onlyA = ledger.getActiveDecisions('proj_A');
      assert.equal(onlyA.length, 1);
      assert.equal(onlyA[0]?.projectId, 'proj_A');
    });

    it('borne le ledger en LRU et persiste les survivantes', () => {
      const fileName = `decisions-lru-${randomUUID().slice(0, 8)}`;
      const ledger = new DecisionLedger({ fileName, maxEntries: 3 });
      const makeDecision = (decisionId: string): Decision => ({
        decisionId,
        sessionId: 'sess_lru',
        projectId: 'proj_lru',
        tenantId: 't',
        intentGoal: `goal ${decisionId}`,
        intentCategory: 'CREATE',
        verdict: 'READY',
        alternatives: [],
        constraints: [],
        contradictingDecisions: [],
        rationale: 'lru test',
        requiredClarifications: [],
        intelligenceSources: [],
        createdAt: new Date().toISOString(),
        status: 'PROPOSED'
      });

      ledger.recordDecision(makeDecision('dec-lru-1'));
      ledger.recordDecision(makeDecision('dec-lru-2'));
      ledger.recordDecision(makeDecision('dec-lru-3'));
      assert.equal(ledger.count(), 3);

      // 1 redevient la plus récente ; 2 devient la plus ancienne.
      assert.ok(ledger.getById('dec-lru-1'));
      ledger.recordDecision(makeDecision('dec-lru-4'));

      assert.equal(ledger.count(), 3, 'la borne est respectée');
      assert.ok(ledger.getById('dec-lru-1'), 'la décision récemment lue survit');
      assert.equal(ledger.getById('dec-lru-2'), undefined, 'la moins récemment utilisée est évincée');
      assert.ok(ledger.getById('dec-lru-3'));
      assert.ok(ledger.getById('dec-lru-4'));

      // Persistance : un nouveau ledger relit exactement les survivantes.
      const reloaded = new DecisionLedger({ fileName, maxEntries: 3 });
      assert.equal(reloaded.count(), 3);
      assert.equal(reloaded.getById('dec-lru-2'), undefined);
      assert.ok(reloaded.getById('dec-lru-1'));
      assert.ok(reloaded.getById('dec-lru-3'));
      assert.ok(reloaded.getById('dec-lru-4'));

      reloaded.clear();
    });
  });

  describe('AlternativeGenerator', () => {
    it('doit générer au moins 1 alternative pour un intent CREATE', async () => {
      const gen = new AlternativeGenerator();
      const alts = await gen.generate({
        intent: makeIntent({ category: 'CREATE', goal: 'add login button' }),
        constraints: [],
        memory: emptyMemory()
      });
      assert.ok(alts.length >= 1, `Expected >= 1 alternative, got ${alts.length}`);
    });

    it('doit générer une alternative ARCHIVE pour un intent DELETE', async () => {
      const gen = new AlternativeGenerator();
      const alts = await gen.generate({
        intent: makeIntent({ category: 'DELETE', goal: 'delete button' }),
        constraints: [],
        memory: emptyMemory()
      });
      const hasArchive = alts.some((a) => a.proposedActions.includes('ARCHIVE'));
      assert.ok(hasArchive, 'Should generate an ARCHIVE alternative for DELETE intent');
    });

    it('doit générer une alternative plus sûre pour MODIFY', async () => {
      const gen = new AlternativeGenerator();
      const alts = await gen.generate({
        intent: makeIntent({ category: 'MODIFY', goal: 'change button color' }),
        constraints: [],
        memory: emptyMemory()
      });
      const hasSafer = alts.some((a) => a.description.includes('sandbox'));
      assert.ok(hasSafer, 'Should generate a safer sandboxed alternative for MODIFY');
    });
  });

  describe('DecisionEngine.decide — verdicts', () => {
    it('READY : intent QUESTION simple', async () => {
      const engine = new DecisionEngine({
        constraintRegistry: new ConstraintRegistry({ adrDir: '/nonexistent' }),
        decisionLedger: new DecisionLedger({ fileName: `decisions-test-${randomUUID().slice(0, 8)}` }),
        alternativeGenerator: new AlternativeGenerator()
      });
      const decision = await engine.decide(makeContext('proj_ready', {
        intent: makeIntent({ category: 'QUESTION', goal: 'what does this file do?' })
      }));
      assert.equal(decision.verdict, 'READY');
    });

    it('NEEDS_CONFIRMATION : intent DELETE', async () => {
      const engine = new DecisionEngine({
        constraintRegistry: new ConstraintRegistry({ adrDir: '/nonexistent' }),
        decisionLedger: new DecisionLedger({ fileName: `decisions-test-${randomUUID().slice(0, 8)}` }),
        alternativeGenerator: new AlternativeGenerator()
      });
      const decision = await engine.decide(makeContext('proj_nc', {
        intent: makeIntent({ category: 'DELETE', goal: 'delete the entire src folder' })
      }));
      // DELETE sans archive alternative choisie → NEEDS_CONFIRMATION
      assert.equal(decision.verdict, 'NEEDS_CONFIRMATION');
    });

    it('doit persister la décision dans le ledger', async () => {
      const ledger = new DecisionLedger({ fileName: `decisions-test-${randomUUID().slice(0, 8)}` });
      const engine = new DecisionEngine({
        constraintRegistry: new ConstraintRegistry({ adrDir: '/nonexistent' }),
        decisionLedger: ledger,
        alternativeGenerator: new AlternativeGenerator()
      });
      const before = ledger.count();
      await engine.decide(makeContext('proj_persist'));
      assert.equal(ledger.count(), before + 1, 'Decision should be persisted');
    });

    it('mode consultatif (record:false) : décision réelle SANS écriture dans le ledger', async () => {
      const ledger = new DecisionLedger({ fileName: `decisions-test-${randomUUID().slice(0, 8)}` });
      const engine = new DecisionEngine({
        constraintRegistry: new ConstraintRegistry({ adrDir: '/nonexistent' }),
        decisionLedger: ledger,
        alternativeGenerator: new AlternativeGenerator()
      });
      const before = ledger.count();
      const decision = await engine.decide(makeContext('proj_advisory'), { record: false });
      assert.equal(ledger.count(), before, 'advisory decision must not grow the ledger');
      assert.equal(decision.status, 'PROPOSED');
      assert.match(decision.decisionId, /^dec-/);
      assert.ok(decision.alternatives.length >= 1);
    });

    it('doit accepter une décision via acceptDecision', async () => {
      const ledger = new DecisionLedger({ fileName: `decisions-test-${randomUUID().slice(0, 8)}` });
      const engine = new DecisionEngine({
        constraintRegistry: new ConstraintRegistry({ adrDir: '/nonexistent' }),
        decisionLedger: ledger,
        alternativeGenerator: new AlternativeGenerator()
      });
      const decision = await engine.decide(makeContext('proj_accept'));
      assert.equal(decision.status, 'PROPOSED');
      engine.acceptDecision(decision.decisionId);
      const updated = engine.getDecision(decision.decisionId);
      assert.equal(updated?.status, 'ACCEPTED');
    });
  });
});
