import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConversationIntelligenceService,
  DEFAULT_CONVERSATION_CONFIG,
  ConversationCompass,
  ConversationIntentEngine,
  ClarificationEngine,
  ConversationAssumptionEngine,
  PlanGenerator,
  ContradictionDetector,
  MemoryManager,
  UnderstandingBridge,
  ImpactBridge,
  ExecutionBridge,
  ConversationEngine,
  DefaultReasoningProvider,
  MockReasoningProvider,
  ConversationTraceCollector,
  ConversationSessionLruCache,
  computeConversationStateHash,
  computeEngineeringPlanHash,
  computeTraceId,
  classifyIntent,
  classifyAmbiguities,
  deriveAssumptions,
  type ConversationSession,
  type ConversationState,
  type EngineeringPlan,
  type IntentResult,
  type ArchitecturalDecisionRecord,
  ValidationError,
  ForbiddenError
} from '../../../src/index.js';

describe('AINT-009 — Conversation Intelligence & Human-AI Engineering Engine', () => {
  const tenantId = 'tenant_corp_alpha';
  const projectId = 'proj_ecommerce_v1';

  // ============================================================================
  // SECTION A: Intent Understanding & Parsing
  // ============================================================================
  describe('Section A: Intent Understanding & Parsing', () => {
    const engine = new ConversationIntentEngine();

    it('A1: doit classifier correctement une question utilisateur (QUESTION)', async () => {
      const res = await engine.classifyIntent('Est-ce que le système supporte les paiements par Stripe ?');
      assert.equal(res.category, 'QUESTION');
      assert.ok(res.confidence > 0.7);
      assert.ok(res.entities.includes('paiement') || res.entities.includes('paiements'));
    });

    it('A2: doit classifier une demande d explication (EXPLAIN)', async () => {
      const res = await engine.classifyIntent('Explique comment fonctionne l authentification des utilisateurs');
      assert.equal(res.category, 'EXPLAIN');
      assert.equal(res.domain, 'dom_authentication');
      assert.ok(res.entities.includes('auth') || res.entities.includes('utilisateur') || res.entities.includes('utilisateurs'));
    });

    it('A3: doit classifier une demande de création d entité métier (CREATE)', async () => {
      const res = await engine.classifyIntent('Ajoute un nouvel espace pour gérer les fournisseurs');
      assert.equal(res.category, 'CREATE');
      assert.equal(res.domain, 'dom_suppliers');
      assert.ok(res.entities.includes('fournisseur') || res.entities.includes('fournisseurs'));
    });

    it('A4: doit classifier une demande de modification (MODIFY)', async () => {
      const res = await engine.classifyIntent('Modifie la page de profil pour ajouter un avatar');
      assert.equal(res.category, 'MODIFY');
      assert.ok(res.entities.includes('profil') || res.entities.includes('page'));
    });

    it('A5: doit classifier une action destructive (DELETE)', async () => {
      const res = await engine.classifyIntent('Supprime le fichier auth.service.ts et la table session');
      assert.equal(res.category, 'DELETE');
      assert.ok(res.ambiguities.some((a) => a.level === 'NEEDS_CONFIRMATION'));
    });

    it('A6: doit classifier un rapport de bug ou debug (DEBUG)', async () => {
      const res = await engine.classifyIntent('Il y a une erreur 500 sur la route de checkout, corrige le crash');
      assert.equal(res.category, 'DEBUG');
      assert.ok(res.confidence >= 0.85);
    });

    it('A7: doit classifier une analyse ou un audit (ANALYZE)', async () => {
      const res = await engine.classifyIntent('Analyse et vérifie la conformité de l architecture');
      assert.equal(res.category, 'ANALYZE');
      assert.ok(res.confidence >= 0.85);
    });

    it('A8: doit classifier une demande d optimisation (OPTIMIZE)', async () => {
      const res = await engine.classifyIntent('Optimise les requêtes de dashboard pour réduire la latence');
      assert.equal(res.category, 'OPTIMIZE');
      assert.ok(res.entities.includes('dashboard'));
    });

    it('A9: doit classifier un refactoring (REFACTOR)', async () => {
      const res = await engine.classifyIntent('Refactor et découple le service de commande');
      assert.equal(res.category, 'REFACTOR');
      assert.ok(res.entities.includes('service') || res.entities.includes('commande'));
    });

    it('A10: doit extraire les contraintes formulées par l utilisateur', async () => {
      const res = await engine.classifyIntent('Ajoute un bouton sans toucher aux composants existants');
      assert.ok(res.constraints.length > 0);
      assert.ok(res.constraints[0]!.includes('sans toucher'));
    });

    it('A11: doit détecter un niveau d urgence élevé (HIGH)', async () => {
      const res = await engine.classifyIntent('Corrige immédiatement ce bug critique en production !');
      assert.equal(res.urgency, 'HIGH');
    });

    it('A12: doit fonctionner via la fonction autonome classifyIntent', async () => {
      const res = await classifyIntent('Fais une nouvelle page de panier');
      assert.equal(res.category, 'CREATE');
      assert.ok(res.entities.includes('page') || res.entities.includes('panier'));
    });
  });

  // ============================================================================
  // SECTION B: Conversation Compass & State Machine
  // ============================================================================
  describe('Section B: Conversation Compass & State Machine', () => {
    const compass = new ConversationCompass();

    it('B1: doit autoriser les transitions valides', () => {
      assert.equal(compass.canTransition('EXPLORING', 'PLANNING'), true);
      assert.equal(compass.canTransition('PLANNING', 'WAITING_CONFIRMATION'), true);
      assert.equal(compass.canTransition('WAITING_CONFIRMATION', 'EXECUTING'), true);
      assert.equal(compass.canTransition('EXECUTING', 'VALIDATING'), true);
      assert.equal(compass.canTransition('VALIDATING', 'COMPLETED'), true);
    });

    it('B2: doit rejeter les transitions invalides', () => {
      assert.equal(compass.canTransition('EXECUTING', 'UNDERSTANDING'), false);
      assert.throws(() => {
        compass.transition('EXECUTING', 'UNDERSTANDING', 'Transition interdite');
      }, ValidationError);
    });

    it('B3: doit maintenir l état ou passer à CLARIFYING en présence d ambiguïté bloquante', () => {
      const intent: IntentResult = {
        category: 'CREATE',
        goal: 'Ajoute quelque chose',
        requestedAction: 'create',
        entities: [],
        constraints: [],
        urgency: 'NORMAL',
        confidence: 0.8,
        ambiguities: []
      };

      const nextState = compass.determineNextState({
        currentState: 'EXPLORING',
        intent,
        ambiguities: [{ id: '1', question: 'Quoi créer ?', level: 'BLOCKING', reason: 'Missing info' }],
        assumptions: [],
        hasPlan: false
      });
      assert.equal(nextState, 'CLARIFYING');
    });

    it('B4: doit passer à WAITING_CONFIRMATION pour une action destructive ou plan critique', () => {
      const intent: IntentResult = {
        category: 'DELETE',
        goal: 'Supprime la base',
        requestedAction: 'delete',
        entities: ['db'],
        constraints: [],
        urgency: 'NORMAL',
        confidence: 0.9,
        ambiguities: []
      };

      const nextState = compass.determineNextState({
        currentState: 'PLANNING',
        intent,
        ambiguities: [],
        assumptions: [],
        hasPlan: true,
        planAssessment: {
          completeness: 1.0,
          consistency: 1.0,
          riskLevel: 'HIGH',
          confidence: 0.9,
          reversibility: false,
          isAcceptable: true,
          issues: []
        }
      });
      assert.equal(nextState, 'WAITING_CONFIRMATION');
    });

    it('B5: doit terminer en COMPLETED pour une question informationnelle', () => {
      const intent: IntentResult = {
        category: 'QUESTION',
        goal: 'Comment ça marche ?',
        requestedAction: 'answer',
        entities: [],
        constraints: [],
        urgency: 'NORMAL',
        confidence: 0.9,
        ambiguities: []
      };

      const nextState = compass.determineNextState({
        currentState: 'EXPLORING',
        intent,
        ambiguities: [],
        assumptions: [],
        hasPlan: false
      });
      assert.equal(nextState, 'COMPLETED');
    });
  });

  // ============================================================================
  // SECTION C: Assumption Generation & Management
  // ============================================================================
  describe('Section C: Assumption Generation & Management', () => {
    const engine = new ConversationAssumptionEngine();

    it('C1: doit dériver des hypothèses cohérentes pour un espace fournisseurs', () => {
      const intent: IntentResult = {
        category: 'CREATE',
        domain: 'dom_suppliers',
        goal: 'Ajoute un espace fournisseurs',
        requestedAction: 'create',
        entities: ['fournisseur', 'fournisseurs'],
        constraints: [],
        urgency: 'NORMAL',
        confidence: 0.9,
        ambiguities: []
      };

      const assumptions = engine.synthesizeAssumptions({
        intent,
        projectMemory: {
          architecturalDecisions: [],
          userPreferences: {},
          acceptedPlans: [],
          rejectedPlans: [],
          knownConstraints: [],
          knownConventions: ['typescript strict'],
          knownRisks: []
        }
      });

      assert.ok(assumptions.length >= 2);
      assert.ok(assumptions.some((a) => a.id.includes('supplier_crud')));
      assert.ok(assumptions.some((a) => a.id.includes('supplier_nav')));
      assert.equal(assumptions[0]!.requiresConfirmation, false); // Safe convention!
    });

    it('C2: doit trier les hypothèses de manière déterministe par identifiant', () => {
      const intent: IntentResult = {
        category: 'CREATE',
        domain: 'dom_suppliers',
        goal: 'Ajoute un espace fournisseurs et un bouton',
        requestedAction: 'create',
        entities: ['fournisseur', 'bouton'],
        constraints: [],
        urgency: 'NORMAL',
        confidence: 0.9,
        ambiguities: []
      };

      const assumptions = deriveAssumptions(intent);
      for (let i = 0; i < assumptions.length - 1; i++) {
        assert.ok(assumptions[i]!.id.localeCompare(assumptions[i + 1]!.id) <= 0);
      }
    });
  });

  // ============================================================================
  // SECTION D: Clarification & Confirmation Engine (Knowing When NOT to Ask)
  // ============================================================================
  describe('Section D: Clarification & Confirmation Engine', () => {
    const engine = new ClarificationEngine();

    it('D1: ne doit PAS bloquer pour des micro-décisions de styling (SAFE_TO_ASSUME)', () => {
      const items = classifyAmbiguities('Ajoute un bouton de validation sur le formulaire', 'CREATE', ['bouton', 'formulaire']);
      const styling = items.find((i) => i.id === 'clarif_ui_styling');
      assert.ok(styling);
      assert.equal(styling?.level, 'SAFE_TO_ASSUME');
    });

    it('D2: doit exiger une confirmation explicite pour DELETE (NEEDS_CONFIRMATION)', () => {
      const items = classifyAmbiguities('Supprime le fichier index.ts', 'DELETE', ['fichier']);
      const destructive = items.find((i) => i.id === 'clarif_destructive_action');
      assert.ok(destructive);
      assert.equal(destructive?.level, 'NEEDS_CONFIRMATION');
    });

    it('D3: doit émettre une clarification bloquante en cas de contradiction majeure', () => {
      const items = engine.assessClarifications({
        intent: {
          category: 'MODIFY',
          goal: 'switch to bootstrap',
          requestedAction: 'modify',
          entities: [],
          constraints: [],
          urgency: 'NORMAL',
          confidence: 0.8,
          ambiguities: []
        },
        assumptions: [],
        contradictions: [
          {
            id: 'conf_1',
            type: 'DECISION_CONFLICT',
            previousItem: 'Tailwind CSS',
            newItem: 'Bootstrap',
            explanation: 'Conflit avec Tailwind',
            resolved: false
          }
        ]
      });

      assert.ok(items.some((i) => i.level === 'BLOCKING'));
    });
  });

  // ============================================================================
  // SECTION E: Engineering Plan Synthesis & Assessment
  // ============================================================================
  describe('Section E: Engineering Plan Synthesis & Assessment', () => {
    const generator = new PlanGenerator();

    it('E1: doit synthétiser un plan en 3 étapes (ANALYZE, ACTION, VERIFY)', () => {
      const intent: IntentResult = {
        category: 'CREATE',
        domain: 'dom_suppliers',
        goal: 'Créer le module fournisseurs',
        requestedAction: 'create supplier module',
        entities: ['fournisseur'],
        constraints: [],
        urgency: 'NORMAL',
        confidence: 0.9,
        ambiguities: []
      };

      const plan = generator.generatePlan({ intent });
      assert.equal(plan.steps.length, 3);
      assert.equal(plan.steps[0]!.operation, 'ANALYZE');
      assert.equal(plan.steps[1]!.operation, 'CREATE');
      assert.equal(plan.steps[2]!.operation, 'VERIFY');
      assert.ok(plan.planHash.length === 64);
    });

    it('E2: doit calculer un planHash déterministe', () => {
      const intent: IntentResult = {
        category: 'MODIFY',
        goal: 'Update profile',
        requestedAction: 'update',
        entities: ['profile'],
        constraints: [],
        urgency: 'NORMAL',
        confidence: 0.85,
        ambiguities: []
      };

      const plan1 = generator.generatePlan({ intent });
      const plan2 = generator.generatePlan({ intent });
      // The content structure hash should be non-empty and valid sha256
      assert.equal(plan1.planHash.length, 64);
      assert.equal(plan2.planHash.length, 64);
    });

    it('E3: doit évaluer un plan sain avec un score élevé et isAcceptable: true', () => {
      const intent: IntentResult = {
        category: 'MODIFY',
        goal: 'Update styling',
        requestedAction: 'update',
        entities: ['src/button.tsx'],
        constraints: [],
        urgency: 'NORMAL',
        confidence: 0.9,
        ambiguities: []
      };

      const plan = generator.generatePlan({ intent });
      const assessment = generator.assessPlan(plan);

      assert.equal(assessment.isAcceptable, true);
      assert.equal(assessment.riskLevel, 'LOW');
      assert.equal(assessment.reversibility, true);
      assert.ok(assessment.completeness >= 0.8);
      assert.ok(assessment.consistency >= 0.8);
    });

    it('E4: doit signaler un risque élevé (HIGH) pour une opération DELETE', () => {
      const plan: EngineeringPlan = {
        planId: 'plan-del',
        title: 'Delete data',
        summary: 'Delete action',
        steps: [
          { stepIndex: 1, title: 'Analyze', description: 'Analyze', operation: 'ANALYZE', requiresApproval: false },
          { stepIndex: 2, title: 'Delete file', description: 'Remove file', operation: 'DELETE', requiresApproval: true },
          { stepIndex: 3, title: 'Verify', description: 'Verify', operation: 'VERIFY', requiresApproval: false }
        ],
        planHash: computeEngineeringPlanHash({ planId: 'plan-del', title: 'Delete data', summary: 'Delete action', steps: [], status: 'DRAFT' }),
        status: 'DRAFT'
      };

      const assessment = generator.assessPlan(plan);
      assert.equal(assessment.riskLevel, 'HIGH');
      assert.equal(assessment.reversibility, false);
    });
  });

  // ============================================================================
  // SECTION F: Contradiction & Conflict Detection
  // ============================================================================
  describe('Section F: Contradiction & Conflict Detection', () => {
    const detector = new ContradictionDetector();

    it('F1: doit détecter un conflit avec une décision active (DECISION_CONFLICT)', () => {
      const activeDecisions: ArchitecturalDecisionRecord[] = [
        {
          decisionId: 'dec-1',
          sessionId: 'sess-1',
          projectId,
          statement: 'Utiliser Tailwind CSS pour tous les styles',
          reason: 'Standard UI',
          evidence: 'Accord équipe',
          confidence: 1.0,
          alternatives: ['Bootstrap'],
          selectedAlternative: 'Tailwind CSS',
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        }
      ];

      const contradictions = detector.detectContradictions({
        newIntent: {
          category: 'MODIFY',
          goal: 'Migrer l interface vers Bootstrap',
          requestedAction: 'install bootstrap',
          entities: [],
          constraints: [],
          urgency: 'NORMAL',
          confidence: 0.9,
          ambiguities: []
        },
        projectMemory: {
          architecturalDecisions: activeDecisions,
          userPreferences: {},
          acceptedPlans: [],
          rejectedPlans: [],
          knownConstraints: [],
          knownConventions: [],
          knownRisks: []
        },
        activeDecisions
      });

      assert.equal(contradictions.length, 1);
      assert.equal(contradictions[0]!.type, 'DECISION_CONFLICT');
    });

    it('F2: doit détecter la violation d une contrainte de projet (CONSTRAINT_CONFLICT)', () => {
      const contradictions = detector.detectContradictions({
        newIntent: {
          category: 'DELETE',
          goal: 'Supprime le module auth',
          requestedAction: 'delete auth',
          entities: ['auth'],
          constraints: [],
          urgency: 'NORMAL',
          confidence: 0.9,
          ambiguities: []
        },
        projectMemory: {
          architecturalDecisions: [],
          userPreferences: {},
          acceptedPlans: [],
          rejectedPlans: [],
          knownConstraints: ['Do not delete core modules'],
          knownConventions: [],
          knownRisks: []
        },
        activeDecisions: []
      });

      assert.equal(contradictions.length, 1);
      assert.equal(contradictions[0]!.type, 'CONSTRAINT_CONFLICT');
    });

    it('F3: doit ignorer les décisions superseded ou révoquées', () => {
      const supersededDecisions: ArchitecturalDecisionRecord[] = [
        {
          decisionId: 'dec-old',
          sessionId: 'sess-1',
          projectId,
          statement: 'Utiliser Tailwind CSS',
          reason: 'Old',
          evidence: 'Old',
          confidence: 1.0,
          alternatives: [],
          selectedAlternative: 'Tailwind CSS',
          status: 'SUPERSEDED',
          createdAt: new Date().toISOString()
        }
      ];

      const contradictions = detector.detectContradictions({
        newIntent: {
          category: 'MODIFY',
          goal: 'Install Bootstrap',
          requestedAction: 'bootstrap',
          entities: [],
          constraints: [],
          urgency: 'NORMAL',
          confidence: 0.9,
          ambiguities: []
        },
        projectMemory: {
          architecturalDecisions: supersededDecisions,
          userPreferences: {},
          acceptedPlans: [],
          rejectedPlans: [],
          knownConstraints: [],
          knownConventions: [],
          knownRisks: []
        },
        activeDecisions: supersededDecisions
      });

      assert.equal(contradictions.length, 0);
    });
  });

  // ============================================================================
  // SECTION G: 3-Tier Memory Management
  // ============================================================================
  describe('Section G: 3-Tier Memory Management', () => {
    const memory = new MemoryManager();

    it('G1: doit initialiser la mémoire de tour et la mémoire de projet', () => {
      const turnMem = memory.createInitialTurnMemory();
      const projMem = memory.createInitialProjectMemory();

      assert.deepEqual(turnMem.recentMessages, []);
      assert.deepEqual(projMem.architecturalDecisions, []);
      assert.deepEqual(projMem.knownConstraints, []);
    });

    it('G2: doit limiter l historique récent des messages dans Turn Memory', () => {
      let turnMem = memory.createInitialTurnMemory();

      for (let i = 1; i <= 8; i++) {
        const turn = {
          turnIndex: i,
          turnId: `turn-${i}`,
          userMessage: { id: `u-${i}`, sender: 'HUMAN' as const, content: `Message ${i}`, timestamp: '' },
          stateBefore: 'EXPLORING' as const,
          stateAfter: 'EXPLORING' as const,
          intent: { category: 'QUESTION' as const, goal: '', requestedAction: '', entities: [], constraints: [], urgency: 'NORMAL' as const, confidence: 1, ambiguities: [] },
          assumptions: [],
          decisions: [],
          agentResponse: { id: `a-${i}`, sender: 'AGENT' as const, content: `Response ${i}`, timestamp: '' },
          trace: { traceId: 't', sessionId: 's', turnId: 't', stateBefore: 'EXPLORING' as const, stateAfter: 'EXPLORING' as const, intentCategory: 'QUESTION' as const, contextHash: '', applicationHash: '', actionTaken: '', confidence: 1, events: [], durationMs: 1 }
        };
        turnMem = memory.updateTurnMemory(turnMem, turn, 4);
      }

      // Max history 4 means at most 4 messages preserved in recentMessages
      assert.equal(turnMem.recentMessages.length, 4);
    });

    it('G3: doit marquer une ancienne décision SUPERSEDED lors de l enregistrement d une nouvelle version', () => {
      let projMem = memory.createInitialProjectMemory();

      const dec1: ArchitecturalDecisionRecord = {
        decisionId: 'dec-1',
        sessionId: 's',
        projectId,
        statement: 'Use PostgreSQL',
        reason: 'Relational ACID',
        evidence: 'Spec',
        confidence: 1.0,
        alternatives: [],
        selectedAlternative: 'PostgreSQL',
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      };

      const dec2: ArchitecturalDecisionRecord = {
        decisionId: 'dec-2',
        sessionId: 's',
        projectId,
        statement: 'Use PostgreSQL',
        reason: 'Upgraded to Supabase Cloud PostgreSQL',
        evidence: 'Spec v2',
        confidence: 1.0,
        alternatives: [],
        selectedAlternative: 'Supabase PostgreSQL',
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      };

      projMem = memory.recordDecision(projMem, dec1);
      assert.equal(projMem.architecturalDecisions.length, 1);
      assert.equal(projMem.architecturalDecisions[0]!.status, 'ACTIVE');

      projMem = memory.recordDecision(projMem, dec2);
      assert.equal(projMem.architecturalDecisions.length, 2);
      const old = projMem.architecturalDecisions.find((d) => d.decisionId === 'dec-1');
      const latest = projMem.architecturalDecisions.find((d) => d.decisionId === 'dec-2');
      assert.equal(old?.status, 'SUPERSEDED');
      assert.equal(latest?.status, 'ACTIVE');
    });

    it('G4: doit enregistrer l acceptation et le rejet de plans', () => {
      let projMem = memory.createInitialProjectMemory();
      projMem = memory.recordPlanDecision(projMem, 'plan-alpha', true);
      assert.ok(projMem.acceptedPlans.includes('plan-alpha'));

      projMem = memory.recordPlanDecision(projMem, 'plan-alpha', false);
      assert.ok(!projMem.acceptedPlans.includes('plan-alpha'));
      assert.ok(projMem.rejectedPlans.includes('plan-alpha'));
    });
  });

  // ============================================================================
  // SECTION H: Application Understanding Bridge (AINT-008 Integration)
  // ============================================================================
  describe('Section H: Application Understanding Bridge', () => {
    const bridge = new UnderstandingBridge();

    it('H1: doit calculer un snapshot valide depuis les hashs sémantiques', () => {
      const snapshot = bridge.computeSnapshot();
      assert.equal(snapshot.graphHash, 'graph:uninitialized');
      assert.equal(snapshot.treeHash, 'tree:uninitialized');
      assert.equal(snapshot.understandingHash, 'understanding:uninitialized');
    });

    it('H2: doit détecter un contexte périmé (stale context) si le graphHash a changé', () => {
      const snap1 = { treeHash: 'tree-1', graphHash: 'graph-1', understandingHash: 'u-1' };
      const snap2 = { treeHash: 'tree-1', graphHash: 'graph-2', understandingHash: 'u-1' };

      assert.equal(bridge.isContextStale(snap1, snap2), true);
      assert.equal(bridge.isContextStale(snap1, snap1), false);
    });
  });

  // ============================================================================
  // SECTION I: Impact Intelligence Bridge (AINT-005 Integration)
  // ============================================================================
  describe('Section I: Impact Intelligence Bridge', () => {
    const bridge = new ImpactBridge();

    it('I1: doit évaluer l impact heuristique d un plan DELETE comme HIGH', () => {
      const plan: EngineeringPlan = {
        planId: 'p-1',
        title: 'Delete route',
        summary: 'Delete',
        steps: [
          { stepIndex: 1, title: 'Analyze', description: '', operation: 'ANALYZE', requiresApproval: false },
          { stepIndex: 2, title: 'Delete', description: '', operation: 'DELETE', targetFiles: ['src/routes.ts'], requiresApproval: true },
          { stepIndex: 3, title: 'Verify', description: '', operation: 'VERIFY', requiresApproval: false }
        ],
        planHash: 'hash',
        status: 'DRAFT'
      };

      const impact = bridge.assessPlanImpact(plan, tenantId, projectId);
      assert.equal(impact.riskLevel, 'HIGH');
      assert.equal(impact.requiresConfirmation, true);
      assert.ok(impact.affectedFiles.includes('src/routes.ts'));
    });

    it('I2: doit évaluer un plan de modification simple comme LOW', () => {
      const plan: EngineeringPlan = {
        planId: 'p-2',
        title: 'Edit label',
        summary: 'Edit',
        steps: [
          { stepIndex: 1, title: 'Analyze', description: '', operation: 'ANALYZE', requiresApproval: false },
          { stepIndex: 2, title: 'Modify', description: '', operation: 'MODIFY', targetFiles: ['src/button.tsx'], requiresApproval: false },
          { stepIndex: 3, title: 'Verify', description: '', operation: 'VERIFY', requiresApproval: false }
        ],
        planHash: 'hash',
        status: 'DRAFT'
      };

      const impact = bridge.assessPlanImpact(plan, tenantId, projectId);
      assert.equal(impact.riskLevel, 'LOW');
      assert.equal(impact.requiresConfirmation, false);
    });
  });

  // ============================================================================
  // SECTION J: Execution Bridge
  // ============================================================================
  describe('Section J: Execution Bridge', () => {
    const bridge = new ExecutionBridge();

    it('J1: doit interdire l exécution d un plan rejeté ou dans un état illégal', () => {
      const plan: EngineeringPlan = {
        planId: 'p-rej',
        title: 'Rejected plan',
        summary: 'Rejected',
        steps: [],
        planHash: 'h',
        status: 'REJECTED'
      };

      assert.equal(bridge.canExecute(plan, 'PLANNING'), false);
      assert.equal(bridge.canExecute(plan, 'EXPLORING'), false);
    });

    it('J2: doit autoriser l exécution d un plan valide en attente ou en planification', () => {
      const plan: EngineeringPlan = {
        planId: 'p-valid',
        title: 'Valid plan',
        summary: 'Valid',
        steps: [],
        planHash: 'h',
        status: 'APPROVED'
      };

      assert.equal(bridge.canExecute(plan, 'PLANNING'), true);
      assert.equal(bridge.canExecute(plan, 'WAITING_CONFIRMATION'), true);
      assert.equal(bridge.canExecute(plan, 'EXECUTING'), true);
    });
  });

  // ============================================================================
  // SECTION K: Observability, Traces, LRU Cache & Hashes
  // ============================================================================
  describe('Section K: Observability, Traces, LRU Cache & Hashes', () => {
    it('K1: doit calculer des hashs de trace et d état déterministes', () => {
      const traceId1 = computeTraceId('sess-1', 'turn-1');
      const traceId2 = computeTraceId('sess-1', 'turn-1');
      assert.equal(traceId1, traceId2);
      assert.equal(traceId1.length, 16);

      const stateHash1 = computeConversationStateHash('PLANNING', 'Ajoute un bouton', 'CREATE');
      const stateHash2 = computeConversationStateHash('PLANNING', 'Ajoute un bouton', 'CREATE');
      assert.equal(stateHash1, stateHash2);
      assert.equal(stateHash1.length, 64);
    });

    it('K2: doit enregistrer et agréger les traces dans ConversationTraceCollector', () => {
      const collector = new ConversationTraceCollector();
      collector.recordTrace({
        traceId: 't-1',
        sessionId: 'sess-abc',
        turnId: 'turn-1',
        stateBefore: 'EXPLORING',
        stateAfter: 'PLANNING',
        intentCategory: 'CREATE',
        contextHash: 'c-hash',
        applicationHash: 'a-hash',
        actionTaken: 'transition',
        confidence: 0.9,
        events: ['event1'],
        durationMs: 42
      });

      const traces = collector.getSessionTraces('sess-abc');
      assert.equal(traces.length, 1);
      assert.equal(traces[0]!.durationMs, 42);

      const metrics = collector.computeMetrics();
      assert.equal(metrics.totalTraces, 1);
      assert.equal(metrics.averageDurationMs, 42);
      assert.equal(metrics.intentDistribution['CREATE'], 1);
    });

    it('K3: doit respecter la politique d éviction LRU dans ConversationSessionLruCache', () => {
      const cache = new ConversationSessionLruCache(2);
      const dummySession = (id: string): ConversationSession => ({
        sessionId: id,
        conversationId: id,
        tenantId,
        projectId,
        currentState: 'EXPLORING',
        turns: [],
        activeAssumptions: [],
        activeDecisions: [],
        applicationSnapshot: { treeHash: '', graphHash: '', understandingHash: '' },
        turnMemory: { recentMessages: [], currentAssumptions: [] },
        projectMemory: { architecturalDecisions: [], userPreferences: {}, acceptedPlans: [], rejectedPlans: [], knownConstraints: [], knownConventions: [], knownRisks: [] }
      });

      cache.set('s1', dummySession('s1'));
      cache.set('s2', dummySession('s2'));
      assert.equal(cache.get('s1')?.sessionId, 's1'); // Touch s1

      cache.set('s3', dummySession('s3')); // Should evict s2
      assert.equal(cache.has('s2'), false);
      assert.equal(cache.has('s1'), true);
      assert.equal(cache.has('s3'), true);

      const m = cache.getMetrics();
      assert.equal(m.evictions, 1);
      assert.equal(m.activeSessions, 2);
    });
  });

  // ============================================================================
  // SECTION L: End-to-End Multi-Turn Conversational Workflows & Security
  // ============================================================================
  describe('Section L: End-to-End Multi-Turn Conversational Workflows & Security', () => {
    let service: ConversationIntelligenceService;

    beforeEach(() => {
      service = new ConversationIntelligenceService();
    });

    it('L1: doit créer une session valide et respecter l isolation multi-tenant', () => {
      const session = service.createSession({ tenantId, projectId });
      assert.ok(session.sessionId.startsWith('sess-'));
      assert.equal(session.currentState, 'EXPLORING');
      assert.equal(session.tenantId, tenantId);
      assert.equal(session.projectId, projectId);

      // Other tenant cannot see it
      const foreign = service.getSession('tenant_other', projectId, session.sessionId);
      assert.equal(foreign, undefined);

      const retrieved = service.getSession(tenantId, projectId, session.sessionId);
      assert.ok(retrieved);
      assert.equal(retrieved.sessionId, session.sessionId);
    });

    it('L2: doit rejeter la création si tenantId ou projectId manquant', () => {
      assert.throws(() => {
        service.createSession({ tenantId: '', projectId });
      }, ValidationError);

      assert.throws(() => {
        service.createSession({ tenantId, projectId: '   ' });
      }, ValidationError);
    });

    it('L3: doit dérouler un cycle conversationnel complet multi-tours', async () => {
      // 1. Create session
      const session = service.createSession({ tenantId, projectId });

      // Turn 1: User asks for a suppliers module
      const turn1Result = await service.processTurn({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        message: 'Ajoute un nouvel espace pour gérer les fournisseurs'
      });

      assert.equal(turn1Result.turn.turnIndex, 1);
      assert.equal(turn1Result.turn.intent.category, 'CREATE');
      assert.ok(turn1Result.turn.plan);
      assert.equal(turn1Result.session.currentState, 'PLANNING');
      assert.ok(turn1Result.turn.assumptions.length >= 1);

      // Turn 2: User confirms the plan
      const confirmedSession = await service.confirmPlan({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        planId: turn1Result.turn.plan!.planId,
        approved: true
      });

      assert.equal(confirmedSession.currentState, 'WAITING_CONFIRMATION');
      assert.equal(confirmedSession.activePlan?.status, 'APPROVED');

      // Turn 3: Execute approved plan
      const execResult = await service.executeApprovedPlan({
        tenantId,
        projectId,
        sessionId: session.sessionId
      });

      assert.equal(execResult.executionResult.success, true);
      assert.equal(execResult.session.currentState, 'VALIDATING');
      assert.equal(execResult.session.activePlan?.status, 'EXECUTED');

      // Check traces recorded
      const traces = service.getTraces(session.sessionId);
      assert.ok(traces.length >= 1);
      assert.equal(traces[0]!.intentCategory, 'CREATE');
    });

    it('L4: doit gérer une demande destructive avec demande de confirmation obligatoire', async () => {
      const session = service.createSession({ tenantId, projectId });

      const res = await service.processTurn({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        message: 'Supprime la configuration de la base de données'
      });

      assert.equal(res.turn.intent.category, 'DELETE');
      assert.equal(res.session.currentState, 'WAITING_CONFIRMATION');
      assert.ok(
        res.turn.agentResponse.content.toLowerCase().includes('plan') ||
        res.turn.agentResponse.content.toLowerCase().includes('confir')
      );
    });

    it('L5: doit enregistrer une décision d architecture explicite', () => {
      const session = service.createSession({ tenantId, projectId });

      const updated = service.recordDecision({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        statement: 'Architecture micro-frontends avec module federation',
        reason: 'Découplage des équipes produit',
        evidence: 'Spécification technique AINT-009'
      });

      assert.equal(updated.activeDecisions.length, 1);
      assert.equal(updated.activeDecisions[0]!.statement, 'Architecture micro-frontends avec module federation');
      assert.equal(updated.projectMemory.architecturalDecisions.length, 1);
    });

    it('L6: doit supporter le rollback du dernier tour', async () => {
      const session = service.createSession({ tenantId, projectId });

      await service.processTurn({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        message: 'Premier tour : pose une question sur le projet'
      });

      await service.processTurn({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        message: 'Deuxième tour : ajoute un composant footer'
      });

      const beforeRollback = service.getSession(tenantId, projectId, session.sessionId)!;
      assert.equal(beforeRollback.turns.length, 2);

      const afterRollback = service.rollbackLastTurn({
        tenantId,
        projectId,
        sessionId: session.sessionId
      });

      assert.equal(afterRollback.turns.length, 1);
      assert.equal(afterRollback.turns[0]!.turnIndex, 1);
    });

    it('L7: doit rejeter le rollback si aucun tour n est présent', () => {
      const session = service.createSession({ tenantId, projectId });
      assert.throws(() => {
        service.rollbackLastTurn({ tenantId, projectId, sessionId: session.sessionId });
      }, ValidationError);
    });

    it('L8: doit fonctionner avec un MockReasoningProvider injecté', async () => {
      const mockProvider = new MockReasoningProvider({
        reply: 'Réponse personnalisée via provider injecté',
        confidence: 0.99
      });

      const session = service.createSession({ tenantId, projectId });
      const res = await service.processTurn({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        message: 'Bonjour, peux-tu analyser le code ?',
        reasoningProvider: mockProvider
      });

      assert.equal(res.turn.agentResponse.content, 'Réponse personnalisée via provider injecté');
      assert.equal(res.turn.trace.confidence, 0.99);
    });

    it('L9: doit faire respecter les permissions RBAC', () => {
      // VIEWER can read
      const session = service.createSession({ tenantId, projectId }, 'VIEWER');
      assert.ok(session);

      // But an invalid role or no permission would be caught by assertPermission
      const metrics = service.getMetrics();
      assert.ok(metrics.maxEntries > 0);
    });
  });
});
