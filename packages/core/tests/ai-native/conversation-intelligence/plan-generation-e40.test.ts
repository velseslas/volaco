/**
 * É40 — Production & validation des plans conversationnels
 *
 * AXE 1 (production structurée) :
 *   - G  : le générateur rule-based produit une étape de mutation PAR fichier
 *          explicitement demandé (ordre d'énoncé), les capacités nécessaires
 *          (FILE_MUTATION), AUCUN fichier inventé (indices sémantiques sur
 *          l'analyse uniquement) et AUCUNE dépendance fabriquée ;
 *   - P  : le plan LLM préserve les fichiers cibles et dépendances déclarées,
 *          porte les capacités sur ses mutations, porte un VRAI planHash et
 *          est REFUSÉ explicitement quand il est structurellement invalide
 *          (repli rule-based) ;
 *   - X  : preuve d'exécution RÉELLE — un plan produit par le générateur est
 *          transformé en DAG É39 (2 fichiers), exécuté par la chaîne réelle
 *          (scheduler → agents → pipeline de mutation sécurisé), ou routé
 *          mono-agent (1 fichier), ou refusé explicitement (sans fichier).
 *
 * AXE 2 (qualité/validation) :
 *   - V  : validatePlanStructure — mêmes codes que l'adaptateur multi-agents
 *          É39 ; les plans d'analyse (ANALYZE/VERIFY sans cible) restent
 *          pleinement valides ; l'évaluation intègre la validation
 *          (complétude/cohérence dégradées → plan inacceptable).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentRegistryService,
  AIOrchestratorService,
  ApplicationDNAService,
  BaseSpecializedAgent,
  ClarificationEngine,
  CodeIntelligenceService,
  ConversationAssumptionEngine,
  ConversationCompass,
  ConversationEngine,
  ConversationIntentEngine,
  ConversationIntelligenceService,
  ContradictionDetector,
  DefaultReasoningProvider,
  ExecutionBridge,
  ImpactBridge,
  ImpactIntelligenceService,
  InMemoryMutableFileSource,
  MemoryManager,
  MutationOrchestratorService,
  PlanGenerator,
  REFERENCE_AGENT_ID,
  SemanticCodeGraphService,
  UnderstandingBridge,
  analyzePlanForBatch,
  computeEngineeringPlanHash,
  extractSourceFiles,
  validatePlanStructure,
  type AgentResult,
  type AgentTask,
  type ApplicationSnapshot,
  type EngineeringPlan,
  type ExecutionResult,
  type IntentResult,
  type PlanStep,
  type ReasoningProvider,
  type ReasoningRequest
} from '../../../src/index.js';
import {
  LLMReasoningProvider,
  buildEngineeringPlanFromLLM
} from '../../../src/ai-native/conversation-intelligence/provider/llm-reasoning-provider.js';
import type { ApplicationSemanticModel } from '../../../src/ai-native/application-understanding/types.js';

// ===========================================================================
// Helpers partagés
// ===========================================================================

function makeIntent(category: IntentResult['category'], goal: string, domain?: string): IntentResult {
  return {
    category,
    ...(domain !== undefined ? { domain } : {}),
    goal,
    requestedAction: category.toLowerCase(),
    entities: [],
    constraints: [],
    urgency: 'NORMAL',
    confidence: 0.9,
    ambiguities: []
  };
}

let planSeq = 0;

function makePlanE40(steps: readonly PlanStep[]): EngineeringPlan {
  planSeq += 1;
  const partial = {
    planId: `plan-e40-${planSeq}`,
    title: 'Plan É40',
    summary: `Plan de test É40 (${steps.length} étape(s))`,
    steps,
    status: 'APPROVED' as const
  };
  return { ...partial, planHash: computeEngineeringPlanHash(partial) };
}

const analyzeStep = (index: number): PlanStep => ({
  stepIndex: index,
  title: 'Analyse',
  description: '',
  operation: 'ANALYZE',
  requiresApproval: false
});

const mutationStep = (index: number, file: string, dependsOn?: readonly number[]): PlanStep => ({
  stepIndex: index,
  title: 'Mutation',
  description: '',
  targetFiles: [file],
  operation: 'CREATE',
  requiresApproval: false,
  ...(dependsOn !== undefined ? { dependsOn } : {})
});

const verifyStep = (index: number): PlanStep => ({
  stepIndex: index,
  title: 'Vérifier',
  description: '',
  operation: 'VERIFY',
  requiresApproval: false
});

function makeSemanticModel(): ApplicationSemanticModel {
  return {
    domains: [
      {
        name: 'dom_suppliers',
        relatedFiles: ['src/sup/list.ts', 'src/sup/form.ts', 'src/sup/api.ts', 'src/sup/extra.ts']
      }
    ],
    summary: { highestRiskAreas: ['dom_suppliers'] }
  } as unknown as ApplicationSemanticModel;
}

function makeEngineSession(sessionId: string): Parameters<ConversationEngine['processTurn']>[0]['session'] {
  return {
    sessionId,
    conversationId: `conv-${sessionId}`,
    tenantId: 'tenant-e40',
    projectId: 'proj-e40',
    currentState: 'EXPLORING',
    turns: [],
    activeAssumptions: [],
    activeDecisions: [],
    applicationSnapshot: {
      treeHash: 'tree:e40',
      graphHash: 'graph:e40',
      understandingHash: 'understanding:e40'
    } satisfies ApplicationSnapshot,
    turnMemory: { recentMessages: [], currentAssumptions: [] },
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

// ===========================================================================
// SECTION G — générateur rule-based : plans structurés, rien d'inventé
// ===========================================================================

describe('É40 — Générateur : une étape de mutation par fichier demandé, rien d inventé', () => {
  const generator = new PlanGenerator();

  it('G1: 2 fichiers nommés → ANALYZE + 1 étape de mutation PAR fichier + VERIFY, capacités déclarées, aucune dépendance fabriquée', () => {
    const plan = generator.generatePlan({
      intent: makeIntent('CREATE', 'Crée les modules src/e40-a.ts et src/e40-b.ts')
    });

    assert.equal(plan.steps.length, 4);
    assert.equal(plan.steps[0]!.operation, 'ANALYZE');
    assert.deepEqual([...(plan.steps[1]!.targetFiles ?? [])], ['src/e40-a.ts']);
    assert.deepEqual([...(plan.steps[2]!.targetFiles ?? [])], ['src/e40-b.ts']);
    assert.equal(plan.steps[3]!.operation, 'VERIFY');
    assert.deepEqual([...(plan.steps[3]!.targetFiles ?? [])], ['src/e40-a.ts', 'src/e40-b.ts']);

    // Capacités : ['FILE_MUTATION'] sur les mutations, JAMAIS sur analyse/vérif
    assert.deepEqual([...(plan.steps[1]!.requiredCapabilities ?? [])], ['FILE_MUTATION']);
    assert.deepEqual([...(plan.steps[2]!.requiredCapabilities ?? [])], ['FILE_MUTATION']);
    assert.equal(plan.steps[0]!.requiredCapabilities, undefined);
    assert.equal(plan.steps[3]!.requiredCapabilities, undefined);

    // AUCUNE dépendance fabriquée : un générateur rule-based ne peut pas
    // déduire une relation technique entre deux fichiers indépendants.
    assert.ok(plan.steps.every((step) => step.dependsOn === undefined));

    // Structurellement valide (compatible DAG É39) + VRAI hash canonique
    assert.equal(validatePlanStructure(plan.steps).valid, true);
    assert.match(plan.planHash, /^[0-9a-f]{64}$/);
  });

  it('G2: ordre d énoncé préservé (le premier fichier nommé est la première mutation)', () => {
    const plan = generator.generatePlan({
      intent: makeIntent('MODIFY', 'Modifie src/e40-b.ts puis src/e40-a.ts')
    });

    assert.deepEqual([...(plan.steps[1]!.targetFiles ?? [])], ['src/e40-b.ts']);
    assert.deepEqual([...(plan.steps[2]!.targetFiles ?? [])], ['src/e40-a.ts']);
  });

  it('G3: entités file-like de l intention servent de cibles explicites', () => {
    const intent = makeIntent('MODIFY', 'Update styling');
    const withEntities: IntentResult = { ...intent, entities: ['src/button.tsx'] };
    const plan = generator.generatePlan({ intent: withEntities });

    assert.deepEqual([...(plan.steps[1]!.targetFiles ?? [])], ['src/button.tsx']);
    assert.deepEqual([...(plan.steps[2]!.targetFiles ?? [])], ['src/button.tsx']);
    assert.equal(validatePlanStructure(plan.steps).valid, true);
  });

  it('G4: aucun fichier nommé → étape de mutation honnêtement SANS cible, évaluée inacceptable (jamais de fichier inventé)', () => {
    const plan = generator.generatePlan({
      intent: makeIntent('CREATE', 'Crée un module fournisseurs')
    });

    assert.equal(plan.steps.length, 3);
    assert.equal(plan.steps[1]!.targetFiles, undefined, 'aucune cible inventée pour la mutation');
    assert.deepEqual([...(plan.steps[1]!.requiredCapabilities ?? [])], ['FILE_MUTATION']);
    assert.equal(plan.steps[0]!.targetFiles, undefined);
    assert.equal(plan.steps[2]!.targetFiles, undefined);

    // Évaluation : l'incomplétude est signalée et rend le plan inacceptable
    // AVANT confirmation (refus explicite, pas d'exécution devinée).
    const assessment = generator.assessPlan(plan);
    assert.equal(assessment.isAcceptable, false);
    assert.ok(assessment.issues.some((issue) => issue.startsWith('PLAN_STEP_INCOMPLETE')));
    assert.ok(assessment.completeness <= 0.5);
  });

  it('G5: defaultTargetFiles utilisé SEULEMENT si rien n est explicite', () => {
    const withExplicit = generator.generatePlan({
      intent: makeIntent('MODIFY', 'Modifie src/e40-a.ts'),
      defaultTargetFiles: ['index.html']
    });
    assert.ok(
      withExplicit.steps.every((step) => !(step.targetFiles ?? []).includes('index.html')),
      'une cible explicite écarte la cible par défaut'
    );
    assert.deepEqual([...(withExplicit.steps[1]!.targetFiles ?? [])], ['src/e40-a.ts']);

    const withDefault = generator.generatePlan({
      intent: makeIntent('MODIFY', 'Modifie la page'),
      defaultTargetFiles: ['index.html']
    });
    assert.deepEqual([...(withDefault.steps[1]!.targetFiles ?? [])], ['index.html']);
    assert.deepEqual([...(withDefault.steps[2]!.targetFiles ?? [])], ['index.html']);
    assert.equal(validatePlanStructure(withDefault.steps).valid, true);
  });

  it('G6: indices sémantiques UNIQUEMENT sur l étape ANALYZE (lecture seule), jamais sur une mutation', () => {
    const plan = generator.generatePlan({
      intent: makeIntent('MODIFY', 'Améliore le module fournisseurs', 'dom_suppliers'),
      semanticModel: makeSemanticModel()
    });

    assert.deepEqual(
      [...(plan.steps[0]!.targetFiles ?? [])],
      ['src/sup/list.ts', 'src/sup/form.ts', 'src/sup/api.ts'],
      'au plus 3 indices, portés par l analyse'
    );
    assert.equal(plan.steps[1]!.targetFiles, undefined, 'aucune cible de mutation déduite du modèle sémantique');
    assert.equal(plan.steps[2]!.targetFiles, undefined);
  });

  it('G7: DELETE → étape destructive avec approbation requise, risque HIGH et réversibilité false', () => {
    const plan = generator.generatePlan({
      intent: makeIntent('DELETE', 'Supprime src/e40-old.ts')
    });

    assert.equal(plan.steps[1]!.operation, 'DELETE');
    assert.equal(plan.steps[1]!.requiresApproval, true);

    const assessment = generator.assessPlan(plan);
    assert.equal(assessment.riskLevel, 'HIGH');
    assert.equal(assessment.reversibility, false);
  });

  it('G8: extractSourceFiles — même pattern que le routage É33/É34, ordre d énoncé, déduplication', () => {
    assert.deepEqual(
      [...extractSourceFiles('Modifie src/a.ts et b.json puis c.tsx, encore src/a.ts')],
      ['src/a.ts', 'b.json', 'c.tsx']
    );
    assert.deepEqual([...extractSourceFiles('aucun fichier nommé ici')], []);
  });
});

// ===========================================================================
// SECTION V — validateur structurel partagé (codes alignés adaptateur É39)
// ===========================================================================

describe('É40 — validatePlanStructure : refus explicites et plans d analyse valides', () => {
  it('V1: plan vide → PLAN_EMPTY', () => {
    const structure = validatePlanStructure([]);
    assert.equal(structure.valid, false);
    assert.deepEqual(structure.issues.map((issue) => issue.code), ['PLAN_EMPTY']);
  });

  it('V2: stepIndex dupliqué → PLAN_STEP_INDEX_DUPLICATE + cohérence dégradée dans l évaluation', () => {
    const plan = makePlanE40([
      { stepIndex: 2, title: 'M1', description: '', targetFiles: ['src/a.ts'], operation: 'CREATE', requiresApproval: false },
      { stepIndex: 2, title: 'M2', description: '', targetFiles: ['src/b.ts'], operation: 'CREATE', requiresApproval: false }
    ]);
    const structure = validatePlanStructure(plan.steps);
    assert.equal(structure.valid, false);
    assert.ok(structure.issues.some((issue) => issue.code === 'PLAN_STEP_INDEX_DUPLICATE'));

    const generator = new PlanGenerator();
    const assessment = generator.assessPlan(plan);
    assert.ok(assessment.issues.some((issue) => issue.startsWith('PLAN_STEP_INDEX_DUPLICATE')));
    assert.ok(assessment.consistency <= 0.4);
  });

  it('V3: mutation sans cible → PLAN_STEP_INCOMPLETE', () => {
    const structure = validatePlanStructure([
      { stepIndex: 1, title: 'M', description: '', operation: 'CREATE', requiresApproval: false }
    ]);
    assert.equal(structure.valid, false);
    assert.deepEqual(structure.issues.map((issue) => issue.code), ['PLAN_STEP_INCOMPLETE']);
  });

  it('V4: mutation multi-fichiers → PLAN_STEP_AMBIGUOUS (pas d éclatement artificiel)', () => {
    const structure = validatePlanStructure([
      { stepIndex: 1, title: 'M', description: '', targetFiles: ['src/a.ts', 'src/b.ts'], operation: 'MODIFY', requiresApproval: false }
    ]);
    assert.equal(structure.valid, false);
    assert.deepEqual(structure.issues.map((issue) => issue.code), ['PLAN_STEP_AMBIGUOUS']);
  });

  it('V5: dépendance inconnue → PLAN_DEPENDENCY_UNKNOWN', () => {
    const structure = validatePlanStructure([mutationStep(1, 'src/a.ts'), mutationStep(2, 'src/b.ts', [5]), verifyStep(3)]);
    assert.equal(structure.valid, false);
    assert.deepEqual(structure.issues.map((issue) => issue.code), ['PLAN_DEPENDENCY_UNKNOWN']);
  });

  it('V6: auto-dépendance → PLAN_DEPENDENCY_SELF', () => {
    const structure = validatePlanStructure([mutationStep(1, 'src/a.ts'), mutationStep(2, 'src/b.ts', [2]), verifyStep(3)]);
    assert.equal(structure.valid, false);
    assert.deepEqual(structure.issues.map((issue) => issue.code), ['PLAN_DEPENDENCY_SELF']);
  });

  it('V7: dépendance vers une étape non exécutable (VERIFY) → PLAN_DEPENDENCY_NON_EXECUTABLE', () => {
    const structure = validatePlanStructure([
      mutationStep(1, 'src/a.ts'),
      mutationStep(2, 'src/b.ts', [3]),
      verifyStep(3)
    ]);
    assert.equal(structure.valid, false);
    assert.deepEqual(structure.issues.map((issue) => issue.code), ['PLAN_DEPENDENCY_NON_EXECUTABLE']);
  });

  it('V8: plans d analyse EXÉCUTABLES sans targetFiles (ANALYZE/VERIFY ne demandent aucune cible)', () => {
    const analysisOnly = validatePlanStructure([analyzeStep(1), verifyStep(2)]);
    assert.deepEqual(analysisOnly, { valid: true, issues: [] });

    const mixed = validatePlanStructure([analyzeStep(1), mutationStep(2, 'src/x.ts'), verifyStep(3)]);
    assert.deepEqual(mixed, { valid: true, issues: [] });
  });

  it('V9: dépendance RÉELLE déclarée → plan valide (les vraies relations passent)', () => {
    const structure = validatePlanStructure([
      mutationStep(1, 'src/a.ts'),
      mutationStep(2, 'src/b.ts', [1]),
      verifyStep(3)
    ]);
    assert.deepEqual(structure, { valid: true, issues: [] });
  });
});

// ===========================================================================
// SECTION P — plans LLM : fichiers/dépendances préservés, refus explicites,
// vrai planHash, repli rule-based
// ===========================================================================

function makeReasoningRequest(userMessage: string): ReasoningRequest {
  return {
    userMessage,
    history: [],
    intent: makeIntent('CREATE', userMessage),
    memory: {
      project: {
        architecturalDecisions: [],
        userPreferences: {},
        acceptedPlans: [],
        rejectedPlans: [],
        knownConstraints: [],
        knownConventions: [],
        knownRisks: []
      },
      turn: { recentMessages: [], currentAssumptions: [] }
    }
  };
}

describe('É40 — plans LLM : structure préservée, planHash réel, repli sur plan invalide', () => {
  function makeProvider(payload: unknown, fallback: ReasoningProvider = new DefaultReasoningProvider()): LLMReasoningProvider {
    const caller = (async (): Promise<string> => JSON.stringify(payload)) as never;
    return new LLMReasoningProvider(caller, fallback);
  }

  it('P1: targetFiles + dependsOn déclarés par le LLM sont PRÉSERVÉS, capacités portées, planHash SHA-256', async () => {
    const provider = makeProvider({
      interpretation: 'Créer deux modules liés',
      intent: { category: 'CREATE', goal: 'créer les modules e40', confidence: 0.8 },
      reply: 'Voici mon plan structuré.',
      confidence: 0.9,
      nextAction: 'PRESENT_PLAN',
      plan: {
        title: 'Plan modules e40',
        summary: 'Créer src/e40-a.ts puis src/e40-b.ts qui en dépend.',
        steps: [
          { title: 'Analyser la structure', description: 'Analyse', operation: 'ANALYZE' },
          { title: 'Créer le module A', description: 'Création de src/e40-a.ts', operation: 'CREATE', targetFiles: ['src/e40-a.ts'] },
          { title: 'Créer le module B', description: 'Création de src/e40-b.ts (importe A)', operation: 'CREATE', targetFiles: ['src/e40-b.ts'], dependsOn: [2] },
          { title: 'Vérifier', description: 'Vérification', operation: 'VERIFY' }
        ]
      }
    });

    const res = await provider.reason(makeReasoningRequest('Crée les modules src/e40-a.ts et src/e40-b.ts'));

    assert.ok(res.plan, 'un plan valide du LLM doit être accepté');
    const steps = res.plan.steps;
    assert.equal(steps.length, 4);
    assert.deepEqual([...(steps[1]!.targetFiles ?? [])], ['src/e40-a.ts']);
    assert.deepEqual([...(steps[2]!.targetFiles ?? [])], ['src/e40-b.ts']);
    assert.deepEqual([...(steps[2]!.dependsOn ?? [])], [2], 'dépendance réelle déclarée conservée');
    assert.deepEqual([...(steps[1]!.requiredCapabilities ?? [])], ['FILE_MUTATION']);
    assert.deepEqual([...(steps[2]!.requiredCapabilities ?? [])], ['FILE_MUTATION']);
    assert.equal(steps[0]!.requiredCapabilities, undefined);
    assert.equal(steps[3]!.requiredCapabilities, undefined);
    assert.match(res.plan.planHash, /^[0-9a-f]{64}$/, 'VRAI hash canonique (plus de llm-<timestamp>)');
    assert.equal(validatePlanStructure(steps).valid, true, 'compatible DAG É39');
    assert.equal(res.metadata, undefined, 'aucun refus quand le plan est valide');
  });

  it('P2: mutation SANS fichier déclaré → plan REFUSÉ (PLAN_STEP_INCOMPLETE), codes tracés', async () => {
    const provider = makeProvider({
      interpretation: 'x',
      intent: { category: 'CREATE', goal: 'créer un module', confidence: 0.8 },
      reply: 'Un plan sans cible.',
      confidence: 0.9,
      nextAction: 'PRESENT_PLAN',
      plan: {
        title: 'Plan incomplet',
        summary: 'Aucun fichier nommé par l utilisateur.',
        steps: [
          { title: 'Créer le module', description: '', operation: 'CREATE' },
          { title: 'Vérifier', description: '', operation: 'VERIFY' }
        ]
      }
    });

    const res = await provider.reason(makeReasoningRequest('Crée un module fournisseurs'));

    assert.equal(res.plan, undefined, 'plan incomplet refusé, pas de fichier inventé');
    const rejected = (res.metadata as { llmPlanRejected?: readonly string[] } | undefined)?.llmPlanRejected;
    assert.ok(Array.isArray(rejected));
    assert.ok(rejected!.includes('PLAN_STEP_INCOMPLETE'));
  });

  it('P3: deux fichiers dans UNE étape de mutation → refusé (PLAN_STEP_AMBIGUOUS)', async () => {
    const provider = makeProvider({
      interpretation: 'x',
      intent: { category: 'CREATE', goal: 'deux modules', confidence: 0.8 },
      reply: 'Plan entassé.',
      confidence: 0.9,
      nextAction: 'PRESENT_PLAN',
      plan: {
        title: 'Plan entassé',
        summary: 'Toutes les cibles dans une seule étape.',
        steps: [
          { title: 'Tout créer', description: '', operation: 'CREATE', targetFiles: ['src/a.ts', 'src/b.ts'] },
          { title: 'Vérifier', description: '', operation: 'VERIFY' }
        ]
      }
    });

    const res = await provider.reason(makeReasoningRequest('Crée src/a.ts et src/b.ts'));

    assert.equal(res.plan, undefined);
    const rejected = (res.metadata as { llmPlanRejected?: readonly string[] } | undefined)?.llmPlanRejected;
    assert.ok(rejected!.includes('PLAN_STEP_AMBIGUOUS'));
  });

  it('P4: dépendance vers une étape non exécutable → refusé (PLAN_DEPENDENCY_NON_EXECUTABLE)', async () => {
    const provider = makeProvider({
      interpretation: 'x',
      intent: { category: 'CREATE', goal: 'modules', confidence: 0.8 },
      reply: 'Plan mal dépendu.',
      confidence: 0.9,
      nextAction: 'PRESENT_PLAN',
      plan: {
        title: 'Plan mal dépendu',
        summary: 'Dépendance vers la vérification.',
        steps: [
          { title: 'Créer A', description: '', operation: 'CREATE', targetFiles: ['src/a.ts'] },
          { title: 'Créer B', description: '', operation: 'CREATE', targetFiles: ['src/b.ts'], dependsOn: [3] },
          { title: 'Vérifier', description: '', operation: 'VERIFY' }
        ]
      }
    });

    const res = await provider.reason(makeReasoningRequest('Crée src/a.ts puis src/b.ts'));

    assert.equal(res.plan, undefined);
    const rejected = (res.metadata as { llmPlanRejected?: readonly string[] } | undefined)?.llmPlanRejected;
    assert.ok(rejected!.includes('PLAN_DEPENDENCY_NON_EXECUTABLE'));
  });

  it('P5: question sans plan → pas de plan, PAS de refus (repli rule-based sans bruit)', async () => {
    const provider = makeProvider({
      interpretation: 'Une question',
      intent: { category: 'QUESTION', goal: 'quoi de neuf', confidence: 0.9 },
      reply: 'Réponse directe.',
      confidence: 0.95,
      nextAction: 'RESPOND_DIRECTLY'
    });

    const res = await provider.reason(makeReasoningRequest('Question sans plan'));

    assert.equal(res.plan, undefined);
    assert.equal(res.metadata, undefined);
    assert.equal(res.reply, 'Réponse directe.');
  });

  it('P6: LLM indisponible → fallback utilisé (aucun plan, jamais de crash)', async () => {
    const fallback: ReasoningProvider = {
      reason: async () => ({
        interpretation: 'via fallback',
        intent: makeIntent('CREATE', 'Crée un module'),
        assumptions: [],
        clarifications: [],
        reply: 'REPONSE_FALLBACK',
        confidence: 0.4,
        nextAction: 'RESPOND_DIRECTLY'
      })
    };
    const provider = new LLMReasoningProvider(
      async (): Promise<string> => 'réponse sans aucun JSON',
      fallback
    );

    const res = await provider.reason(makeReasoningRequest('Crée un module'));

    assert.equal(res.plan, undefined);
    assert.equal(res.reply, 'REPONSE_FALLBACK', 'le fallback fournit la réponse');
  });

  it('P7: builder direct — dépendance RÉELLE entre mutations acceptée et hashée canoniquement', () => {
    const built = buildEngineeringPlanFromLLM(
      {
        title: 'Plan chaîné',
        summary: 'B dépend de A.',
        steps: [
          { title: 'Créer A', description: '', operation: 'CREATE', targetFiles: ['src/a.ts'] },
          { title: 'Créer B', description: '', operation: 'CREATE', targetFiles: ['src/b.ts'], dependsOn: [1] },
          { title: 'Vérifier', description: '', operation: 'VERIFY' }
        ]
      },
      makeIntent('CREATE', 'Crée src/a.ts puis src/b.ts')
    );

    assert.ok(built.plan);
    assert.deepEqual([...(built.plan.steps[1]!.dependsOn ?? [])], [1]);
    assert.match(built.plan.planHash, /^[0-9a-f]{64}$/);
    assert.equal(built.rejectedCodes, undefined);
  });
});

// ===========================================================================
// SECTION P2 — garde PHASE 6 du moteur : seul un plan STRUCTURELLEMENT valide
// remplace le plan rule-based
// ===========================================================================

describe('É40 — garde PHASE 6 du moteur conversationnel', () => {
  function makeProviderStub(plan: EngineeringPlan | undefined): ReasoningProvider {
    return {
      reason: async () => ({
        interpretation: 'via provider',
        intent: makeIntent('CREATE', 'Crée un module fournisseurs'),
        assumptions: [],
        clarifications: [],
        reply: 'Plan du provider',
        confidence: 0.95,
        nextAction: 'PRESENT_PLAN',
        plan
      })
    };
  }

  it('P8: plan provider INVALIDE → plan rule-based conservé (le provider est quand même utilisé pour la réponse)', async () => {
    const engine = makeEngine();
    const invalidPlan = makePlanE40([
      analyzeStep(1),
      { stepIndex: 2, title: 'M sans cible', description: '', operation: 'CREATE', requiresApproval: false },
      verifyStep(3)
    ]);

    const result = await engine.processTurn({
      session: makeEngineSession('sess-e40-p8'),
      userMessageText: 'Crée un module fournisseurs',
      reasoningProvider: makeProviderStub(invalidPlan),
      userRole: 'OWNER',
      requestId: 'req-e40-p8'
    });

    assert.notEqual(result.turn.plan, invalidPlan, 'le plan invalide du provider ne remplace JAMAIS le plan');
    assert.ok(result.turn.plan?.steps[0]?.title.startsWith('Inspect'), 'plan rule-based conservé');
    assert.match(
      result.turn.agentResponse.content,
      /^Plan du provider/,
      'la réponse du provider reste utilisée'
    );
  });

  it('P9: plan provider VALIDE → il remplace le plan rule-based (même référence)', async () => {
    const engine = makeEngine();
    const validPlan = makePlanE40([mutationStep(1, 'src/e40-lm.ts'), verifyStep(2)]);

    const result = await engine.processTurn({
      session: makeEngineSession('sess-e40-p9'),
      userMessageText: 'Crée un module fournisseurs',
      reasoningProvider: makeProviderStub(validPlan),
      userRole: 'OWNER',
      requestId: 'req-e40-p9'
    });

    assert.equal(result.turn.plan, validPlan, 'un plan validé par la structure partagée est accepté tel quel');
  });
});

// ===========================================================================
// SECTION X — intégration chaîne RÉELLE : plans du générateur exécutés par
// le moteur É39 (scheduler → agents → pipeline de mutation sécurisé)
// ===========================================================================

const RECORDER_ID = 'agent-recorder-e40';

function makeRecordingAgent(options: {
  journal: string[];
  files: InMemoryMutableFileSource;
  tenantId: string;
  projectId: string;
}): BaseSpecializedAgent {
  const { journal, files, tenantId, projectId } = options;
  class RecordingAgent extends BaseSpecializedAgent {
    constructor() {
      super(
        {
          id: RECORDER_ID,
          name: 'Recording É40',
          domain: 'ARCHITECTURE',
          capabilities: ['FILE_MUTATION'],
          description: 'agent de test É40 : artefact réel + journal (état en closures — Registry deepFreeze)',
          riskLevel: 'LOW',
          requiredProviderCapabilities: [],
          allowedTools: []
        },
        undefined
      );
    }

    public override async executeTask(params: { task: AgentTask }): Promise<AgentResult> {
      const targetFile = params.task.requiredContext.targetFiles?.[0];
      if (!targetFile) {
        return {
          taskId: params.task.id,
          agentId: RECORDER_ID,
          status: 'FAILURE',
          artifacts: [],
          conflicts: [],
          tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 1,
          error: 'E40_RECORDER_NO_TARGET'
        };
      }
      journal.push(`start:${params.task.id}`);
      journal.push(`end:${params.task.id}`);
      const content = `// ${RECORDER_ID} ${params.task.id}\nexport const e40 = '${params.task.id}:${targetFile}';\n`;
      return {
        taskId: params.task.id,
        agentId: RECORDER_ID,
        status: 'SUCCESS',
        degraded: false,
        artifacts: [
          {
            id: `art-${params.task.id}`,
            taskId: params.task.id,
            agentId: RECORDER_ID,
            domain: 'ARCHITECTURE',
            kind: 'PROPOSED_FILE_CHANGE',
            targetFiles: [targetFile],
            payload: { filePath: targetFile, operation: 'CREATE', proposedContent: content, reason: 'É40 recording' },
            confidence: 1,
            hash: `hash-${RECORDER_ID}-${params.task.id}`,
            summary: 'É40'
          }
        ],
        conflicts: [],
        tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 1
      };
    }

    protected buildArtifacts(): readonly [] {
      return [];
    }
  }
  return new RecordingAgent();
}

describe('É40 — intégration chaîne réelle : plans GÉNÉRÉS exécutés par le moteur É39', () => {
  let fileSource: InMemoryMutableFileSource;
  let service: AIOrchestratorService;
  let svc: ConversationIntelligenceService;
  let events: string[];
  let runSeq = 0;
  const tenantId = 'tenant-e40-int';
  let projectId: string;
  const generator = new PlanGenerator();

  function installRecorder(): void {
    const registry = service.getExecutionAgentRegistry();
    registry.unregister(RECORDER_ID);
    registry.register(
      makeRecordingAgent({ journal: events, files: fileSource, tenantId, projectId })
    );
  }

  beforeEach(() => {
    runSeq += 1;
    projectId = `proj-e40-int-${runSeq}`;
    events = [];
    fileSource = new InMemoryMutableFileSource({});
    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    service = new AIOrchestratorService(
      undefined,
      undefined,
      mutationOrchestrator,
      undefined,
      undefined,
      undefined,
      undefined,
      fileSource
    );
    const registry = service.getExecutionAgentRegistry();
    // Le RecordingAgent doit être le SEUL agent FILE_MUTATION (aucune ambiguïté).
    registry.unregister(REFERENCE_AGENT_ID);
    installRecorder();

    svc = new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
    // Wiring identique à apps/api/src/server.ts : MÊME instance orchestrator.
    svc.attachAgentExecutor({
      execute: (request) => service.executeAgent(request),
      getRegistry: () => service.getExecutionAgentRegistry(),
      executeBatch: (request) => service.executeBatch(request)
    });
  });

  async function runGeneratedPlan(params: {
    intent: IntentResult;
    userMessage: string;
  }): Promise<{ session: ReturnType<ConversationIntelligenceService['createSession']>; executionResult: ExecutionResult; plan: EngineeringPlan }> {
    const plan = generator.generatePlan({ intent: params.intent });
    const session = svc.createSession({ tenantId, projectId });
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage: params.userMessage,
      intent: params.intent,
      plan
    });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });
    return { ...result, plan };
  }

  it('X1: plan générateur à 2 fichiers → DAG É39 exploitable (2 specs, cibles exactes, AUCUNE dépendance fabriquée)', () => {
    const plan = generator.generatePlan({
      intent: makeIntent('CREATE', 'Crée les modules src/e40-a.ts et src/e40-b.ts')
    });
    const session = svc.createSession({ tenantId, projectId });

    const analysis = analyzePlanForBatch({ plan, session, registry: service.getExecutionAgentRegistry() });
    assert.ok(analysis.kind === 'batch', `analyse: ${JSON.stringify(analysis)}`);
    if (analysis.kind !== 'batch') return;

    assert.equal(analysis.specs.length, 2, 'seules les mutations deviennent des tâches');
    assert.deepEqual(analysis.specs.map((spec) => spec.taskId), ['step-2', 'step-3']);
    assert.deepEqual(
      analysis.specs.map((spec) => [...spec.dependencies]),
      [[], []],
      'aucune dépendance fabriquée entre fichiers indépendants'
    );
    assert.deepEqual(
      analysis.specs.map((spec) => [...(spec.task.requiredContext.targetFiles ?? [])]),
      [['src/e40-a.ts'], ['src/e40-b.ts']]
    );
    assert.ok(analysis.specs.every((spec) => spec.task.operation === 'CREATE'));
  });

  it('X2: plan générateur à 2 fichiers s exécute RÉELLEMENT (batch, écritures, intégrité par tâche)', async () => {
    const exec = await runGeneratedPlan({
      intent: makeIntent('CREATE', 'Crée les modules src/e40-a.ts et src/e40-b.ts'),
      userMessage: 'Crée les modules src/e40-a.ts et src/e40-b.ts'
    });

    assert.equal(exec.executionResult.success, true);
    assert.match(exec.executionResult.message ?? '', /agxb-/);
    assert.match(exec.executionResult.message ?? '', /2\/2/);
    assert.match(exec.executionResult.message ?? '', /step-2=COMPLETED, step-3=COMPLETED/);
    assert.match(
      exec.executionResult.message ?? '',
      /Étapes 1, 4 \(2\) jamais envoyées à un agent/,
      'ANALYZE (1) et VERIFY (4) ne deviennent jamais des tâches'
    );

    // Pas de dépendance déclarée → les 2 tâches partagent la même vague :
    // l'ordre GLOBAL du journal n'est PAS déterministe, l'intégrité est
    // vérifiée PAR tâche (start avant end, chaque paire présente exactement).
    assert.equal(events.length, 4, `journal: ${events.join(' | ')}`);
    for (const taskId of ['step-2', 'step-3']) {
      const start = events.indexOf(`start:${taskId}`);
      const end = events.indexOf(`end:${taskId}`);
      assert.ok(start >= 0 && end >= 0 && start < end, `journal incohérent pour ${taskId}: ${events.join(' | ')}`);
    }

    // Fichiers réellement écrits via le pipeline de mutation sécurisé.
    const fileA = fileSource.getFile(tenantId, projectId, 'src/e40-a.ts');
    const fileB = fileSource.getFile(tenantId, projectId, 'src/e40-b.ts');
    assert.ok(fileA && /step-2/.test(fileA.content));
    assert.ok(fileB && /step-3/.test(fileB.content));
    assert.equal(exec.session.currentState, 'VALIDATING');
  });

  it('X3: plan générateur à 1 fichier → chemin mono-agent historique (agx-, écriture réelle)', async () => {
    const exec = await runGeneratedPlan({
      intent: makeIntent('CREATE', 'Crée le fichier src/e40-l.ts'),
      userMessage: 'Crée le fichier src/e40-l.ts'
    });

    assert.equal(exec.executionResult.success, true);
    assert.match(exec.executionResult.message ?? '', /executionId: agx-/);
    assert.match(exec.executionResult.message ?? '', /agent-recorder-e40/);
    assert.match(exec.executionResult.message ?? '', /COMMITTED/);

    const expectedTaskId = `task-agx-${exec.session.sessionId}-${exec.plan.planId}`;
    assert.deepEqual(events, [`start:${expectedTaskId}`, `end:${expectedTaskId}`]);
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/e40-l.ts'));
  });

  it('X4: plan générateur sans fichier → refus explicite AVANT toute exécution (aucun fichier nommé, aucune écriture)', async () => {
    const exec = await runGeneratedPlan({
      intent: makeIntent('CREATE', 'Crée un module fournisseurs'),
      userMessage: 'Crée un module fournisseurs'
    });

    // Le plan est honnêtement incomplet (aucune cible inventée)...
    assert.equal(exec.plan.steps[1]!.targetFiles, undefined);
    assert.ok(
      validatePlanStructure(exec.plan.steps).issues.some((issue) => issue.code === 'PLAN_STEP_INCOMPLETE')
    );
    // ...et la chaîne réelle le refuse explicitement : le contrat de routage
    // É33/É34 refuse d'abord toute demande sans fichier nommé
    // (UNSUPPORTED_INTENT), donc aucune tâche n'est jamais exécutée.
    assert.equal(exec.executionResult.success, false);
    assert.match(exec.executionResult.error ?? '', /UNSUPPORTED_INTENT/);
    assert.equal(events.length, 0, 'aucune tâche exécutée avant refus');
    assert.equal(exec.session.currentState, 'FAILED');
  });
});
