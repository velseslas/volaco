/**
 * É44 — Fidélité de transmission du contexte conversationnel aux agents.
 *
 * Garantie vérifiée : la demande RÉELLE de l'utilisateur (contraintes actives,
 * interdits, décisions actives, hypothèses marquées comme telles) parvient à
 * l'agent exécutant — par le pipeline RÉEL (ConversationIntelligenceService →
 * ExecutionBridge → MultiAgentScheduler É37 / routage É33-É34 →
 * AgentExecutionService É32→É36 → MutationBridge → FileSource). Aucun
 * agent.executeTask() direct : les agents de test surchargent executeTask et
 * sont exécutés VIA le scheduler réel (pattern É39).
 *
 * Correspondance scénarios obligatoires (sonde É44 = traces AVANT/APRÈS) :
 *   S1  = demande simple 1 agent (routé) — contexte transmis tâche+payload ;
 *   S2  = projet complexe multi-agents (batch) — contexte dans chaque tâche ;
 *   S3  = conversation longue (contraintes + décisions) — tout est transmis ;
 *   S4  = modification après plan — ancienne demande ABSENTE des tâches ;
 *   S5  = contrainte globale — MÊME contrainte pour CHAQUE tâche du batch ;
 *   S6  = élément interdit — l'interdiction est transmise telle quelle ;
 *   S7  = hypothèse ≠ décision — labels distincts dans la tâche ;
 *   S8  = changement de cible — ancienne cible absente ;
 *   S9  = 2 tâches dépendantes — ordre + contexte ;
 *   S10 = cohérence entre tâches d'un batch ;
 *   S11 = 2 projets distincts — AUCUN mélange de contexte ;
 *   S12 = résultat vérifié vs demande initiale — fichier écrit + agent informé.
 *   U*  = unitaires (bloc de contexte, constructeur session, routage, batch) ;
 *   P*  = prompt RÉEL de production (agent sans surcharge + provider capture).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryMutableFileSource,
  CodeIntelligenceService,
  ApplicationDNAService,
  SemanticCodeGraphService,
  ImpactIntelligenceService,
  MutationOrchestratorService,
  AIOrchestratorService,
  BaseSpecializedAgent,
  REFERENCE_AGENT_ID,
  ConversationIntelligenceService,
  aiProviderRegistry,
  computeEngineeringPlanHash,
  analyzePlanForBatch,
  routeIntentToAgent,
  buildConversationContextBlock,
  buildConversationTaskContext,
  AgentRegistryService,
  type AgentTask,
  type AgentResult,
  type AgentArtifact,
  type TaskContextPayload,
  type EngineeringPlan,
  type PlanStep,
  type IntentResult,
  type ConversationSession,
  type ConversationAssumption,
  type ExecutionResult
} from '../../../src/index.js';

// ---------------------------------------------------------------------------
// Fabriques de référence (pattern É39)
// ---------------------------------------------------------------------------

let planSeq = 0;
let intentSeq = 0;

function makePlanE44(steps: readonly PlanStep[]): EngineeringPlan {
  planSeq += 1;
  const partial = {
    planId: `plan-e44-${planSeq}`,
    title: 'Plan É44',
    summary: `Plan de test É44 (${steps.length} étape(s))`,
    steps,
    status: 'APPROVED' as const
  };
  return { ...partial, planHash: computeEngineeringPlanHash(partial) };
}

function makeIntentE44(category: 'CREATE' | 'MODIFY' | 'DELETE', goal: string): IntentResult {
  intentSeq += 1;
  return {
    category,
    goal,
    requestedAction: category.toLowerCase(),
    entities: [],
    constraints: [],
    urgency: 'NORMAL',
    confidence: 0.9,
    ambiguities: []
  };
}

const mutationStepE44 = (
  index: number,
  file: string,
  operation: 'CREATE' | 'MODIFY' | 'DELETE' = 'CREATE',
  dependsOn?: readonly number[]
): PlanStep => ({
  stepIndex: index,
  title: `${operation} ${file}`,
  description: `${operation} du fichier ${file}`,
  targetFiles: [file],
  operation,
  requiresApproval: false,
  ...(dependsOn !== undefined ? { dependsOn } : {})
});

function makeAssumptionE44(id: string, statement: string, status: ConversationAssumption['status']): ConversationAssumption {
  return {
    id,
    statement,
    confidence: 0.8,
    evidence: 'test É44',
    risk: 'LOW',
    reversible: true,
    requiresConfirmation: status === 'PROPOSED',
    status
  };
}

// ===========================================================================
// SECTION U — unitaire : bloc de contexte, constructeur, routage, batch
// ===========================================================================

describe('É44 — unitaire : bloc de contexte conversationnel', () => {
  it('U1: rien à transmettre → chaîne vide (description IDENTIQUE à l historique)', () => {
    assert.equal(buildConversationContextBlock(undefined), '');
    assert.equal(buildConversationContextBlock(null), '');
    assert.equal(buildConversationContextBlock({ constraints: [], decisions: [], assumptions: [] }), '');
  });

  it('U1b: contraintes/décisions/hypothèses → lignes étiquetées, hypothèse ≠ décision, déterminisme', () => {
    const conversation = {
      constraints: ['Extracted constraint: Utilise uniquement des couleurs sobres'],
      decisions: ['Le catalogue est organisé par catégories'],
      assumptions: [
        makeAssumptionE44('a1', 'Le bouton utilisera la palette existante', 'PROPOSED'),
        makeAssumptionE44('a2', 'Le pied de page sera sombre', 'CONFIRMED'),
        makeAssumptionE44('a3', 'Hypothèse annulée par l utilisateur', 'REJECTED')
      ]
    };

    const block = buildConversationContextBlock(conversation);

    assert.ok(block.startsWith('\n'), 'le bloc est précédé d un saut de ligne');
    assert.ok(block.includes('Contexte conversationnel à respecter (demande active de l utilisateur) :'));
    assert.ok(
      block.includes('Contraintes actives (OBLIGATOIRES) : «Extracted constraint: Utilise uniquement des couleurs sobres»')
    );
    assert.ok(block.includes('Décisions actives (à appliquer) : «Le catalogue est organisé par catégories»'));
    // Hypothèse PROPOSED : étiquetée NON confirmée, jamais présentée comme une décision.
    assert.ok(block.includes('Hypothèses NON confirmées (à ne PAS traiter comme des décisions'));
    assert.ok(block.includes('«Le bouton utilisera la palette existante»'));
    // Hypothèse CONFIRMED : étiquetée confirmée.
    assert.ok(block.includes('Hypothèses confirmées : «Le pied de page sera sombre»'));
    // Hypothèse REJECTED : annulée → JAMAIS transmise.
    assert.ok(!block.includes('Hypothèse annulée'), 'une hypothèse rejetée est annulée, jamais transmise');

    // Déterminisme : mêmes entrées → mêmes octets.
    assert.equal(buildConversationContextBlock(conversation), block);
  });

  it('U1c: déduplication des contraintes/décisions (ordre de conversation préservé)', () => {
    const block = buildConversationContextBlock({
      constraints: ['C1', 'C2', 'C1'],
      decisions: ['D1', 'D1'],
      assumptions: []
    });
    assert.equal((block.match(/«C1»/g) ?? []).length, 1);
    assert.equal((block.match(/«C2»/g) ?? []).length, 1);
    assert.equal((block.match(/«D1»/g) ?? []).length, 1);
    assert.ok(block.indexOf('«C1»') < block.indexOf('«C2»'));
  });

  it('U2: buildConversationTaskContext — décisions ACTIVE seules, hypothèses non rejetées, contraintes brutes', () => {
    const session = {
      projectMemory: { knownConstraints: ['Extracted constraint: couleurs sobres'] },
      activeDecisions: [
        { statement: 'D-active', status: 'ACTIVE' },
        { statement: 'D-rejected', status: 'REJECTED' },
        { statement: 'D-superseded', status: 'SUPERSEDED' },
        { statement: 'D-reverted', status: 'REVERTED' }
      ],
      activeAssumptions: [
        makeAssumptionE44('h1', 'H-proposée', 'PROPOSED'),
        makeAssumptionE44('h2', 'H-confirmée', 'CONFIRMED'),
        makeAssumptionE44('h3', 'H-rejetée', 'REJECTED')
      ]
    } as unknown as ConversationSession;

    const context = buildConversationTaskContext(session);

    assert.deepEqual([...context.constraints], ['Extracted constraint: couleurs sobres']);
    assert.deepEqual([...context.decisions], ['D-active'], 'seules les décisions ACTIVE sont transmises');
    assert.deepEqual(
      context.assumptions.map((a) => `${a.statement}:${a.status}`),
      ['H-proposée:PROPOSED', 'H-confirmée:CONFIRMED'],
      'une hypothèse rejetée est annulée, jamais transmise'
    );
  });
});

describe('É44 — unitaire : routage mono-agent (chemin É33/É34)', () => {
  let registry: AgentRegistryService;

  beforeEach(() => {
    registry = new AgentRegistryService();
    registry.register(
      makeCaptureAgent([], { id: 'agent-e44-route-unit', name: 'E44 Route Unit' })
    );
  });

  it('U3: SANS conversation → tâche et contexte STRICTEMENT identiques à l historique', () => {
    const intent = makeIntentE44('CREATE', 'créer src/e44-u3.ts');
    const route = routeIntentToAgent({
      intent,
      userMessage: 'Crée la page src/e44-u3.ts',
      sessionId: 'sess-u3',
      planId: 'plan-u3',
      registry
    });

    assert.equal(route.supported, true);
    assert.equal(route.task?.description, 'Crée la page src/e44-u3.ts', 'aucun bloc ajouté');
    assert.deepEqual([...route.context?.constraints ?? []], [], 'contexte vide comme avant É44');
    assert.deepEqual([...route.context?.decisions ?? []], []);
  });

  it('U3b: contraintes de l intention du tour → TaskContextPayload (défaut avant É44 = ignorées)', () => {
    const intent: IntentResult = {
      ...makeIntentE44('CREATE', 'créer src/e44-u3b.ts'),
      constraints: ['Contrainte du tour courant']
    };
    const route = routeIntentToAgent({
      intent,
      userMessage: 'Crée la page src/e44-u3b.ts',
      sessionId: 'sess-u3b',
      planId: 'plan-u3b',
      registry
    });

    assert.deepEqual([...route.context?.constraints ?? []], ['Contrainte du tour courant']);
  });

  it('U3c: AVEC conversation → description enrichie du bloc + payload rempli (session + tour, dédupliqué)', () => {
    const intent: IntentResult = {
      ...makeIntentE44('CREATE', 'créer src/e44-u3c.ts'),
      constraints: ['Contrainte du tour courant']
    };
    const route = routeIntentToAgent({
      intent,
      userMessage: 'Crée la page src/e44-u3c.ts',
      sessionId: 'sess-u3c',
      planId: 'plan-u3c',
      registry,
      conversation: {
        constraints: ['Extracted constraint: couleurs sobres', 'Contrainte du tour courant'],
        decisions: ['Le catalogue est organisé par catégories'],
        assumptions: [makeAssumptionE44('h1', 'H-proposée', 'PROPOSED')]
      }
    });

    assert.equal(route.supported, true);
    const description = route.task?.description ?? '';
    assert.ok(description.startsWith('Crée la page src/e44-u3c.ts'), 'la demande active reste le début');
    assert.ok(description.includes('Contraintes actives (OBLIGATOIRES)'));
    assert.ok(description.includes('«Extracted constraint: couleurs sobres»'));
    assert.ok(description.includes('Décisions actives (à appliquer) : «Le catalogue est organisé par catégories»'));
    assert.ok(description.includes('Hypothèses NON confirmées'), 'l hypothèse est étiquetée comme telle');
    assert.equal((description.match(/Contrainte du tour courant/g) ?? []).length, 1, 'dédupliqué dans le bloc (tour + mémoire = une seule occurrence)');

    assert.deepEqual(
      [...route.context?.constraints ?? []],
      ['Contrainte du tour courant', 'Extracted constraint: couleurs sobres'],
      'ordre : tour courant puis mémoire, dédupliqué'
    );
    assert.deepEqual([...route.context?.decisions ?? []], ['Le catalogue est organisé par catégories']);
  });
});

describe('É44 — unitaire : analyse batch (adaptateur É39 étendu)', () => {
  let registry: AgentRegistryService;

  beforeEach(() => {
    registry = new AgentRegistryService();
    registry.register(makeCaptureAgent([], { id: 'agent-e44-batch-unit', name: 'E44 Batch Unit' }));
  });

  it('U4: SANS conversation → descriptions STRICTEMENT identiques à l historique', () => {
    const plan = makePlanE44([mutationStepE44(1, 'src/e44-u4a.ts'), mutationStepE44(2, 'src/e44-u4b.ts')]);
    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'batch');
    for (const spec of analysis.specs) {
      assert.equal(spec.task.description, `${spec.task.operation} du fichier ${(spec.task.requiredContext.targetFiles ?? [])[0]}`);
      assert.ok(!spec.task.description.includes('Contexte conversationnel'));
    }
  });

  it('U4b: AVEC conversation → CHAQUE tâche du DAG porte le bloc de contexte tracé', () => {
    const plan = makePlanE44([mutationStepE44(1, 'src/e44-u4a.ts'), mutationStepE44(2, 'src/e44-u4b.ts', 'CREATE', [1])]);
    const conversation = {
      constraints: ['Extracted constraint: Ne jamais stocker de données bancaires'],
      decisions: ['D1'],
      assumptions: []
    };
    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's', tenantId: 't', projectId: 'p' },
      registry,
      conversation
    });

    assert.ok(analysis.kind === 'batch');
    for (const spec of analysis.specs) {
      assert.ok(spec.task.description.includes('Contexte conversationnel à respecter'), 'bloc présent');
      assert.ok(
        spec.task.description.includes('«Extracted constraint: Ne jamais stocker de données bancaires»'),
        'l interdiction est transmise telle quelle'
      );
      assert.ok(spec.task.description.includes('«D1»'));
      // Le canal batch est la description (scheduler É37 gelé : contexte vide) —
      // la tâche ne porte AUCUN autre champ inventé.
      assert.deepEqual([...spec.task.requiredContext.targetFiles ?? []], [spec.task.requiredContext.targetFiles?.[0]]);
    }
  });
});

// ===========================================================================
// Agents de capture (pattern É39 — état dans des closures, JAMAIS l'instance)
// ===========================================================================

type CaptureRecord = {
  readonly taskId: string;
  readonly title: string;
  readonly description: string;
  readonly targetFiles: readonly string[];
  readonly context: TaskContextPayload;
};

const CAPTURE_AGENT_ID = 'agent-e44-capture';

function makeCaptureAgent(
  journal: CaptureRecord[],
  overrides: { id: string; name: string } = { id: CAPTURE_AGENT_ID, name: 'E44 Capture' }
): BaseSpecializedAgent {
  const id = overrides.id;
  class CaptureAgent extends BaseSpecializedAgent {
    constructor() {
      super(
        {
          id,
          name: overrides.name,
          domain: 'ARCHITECTURE' as never,
          capabilities: ['FILE_MUTATION', 'SERVICE_LOGIC'] as never[],
          description: 'agent de capture É44 : enregistre la tâche et le contexte reçus du pipeline réel',
          riskLevel: 'LOW' as never,
          requiredProviderCapabilities: [],
          allowedTools: []
        },
        undefined
      );
    }
    public override async executeTask(params: { task: AgentTask; context: TaskContextPayload }): Promise<AgentResult> {
      journal.push({
        taskId: params.task.id,
        title: params.task.title,
        description: params.task.description,
        targetFiles: [...(params.task.requiredContext.targetFiles ?? [])],
        context: params.context
      });
      const targetFile = params.task.requiredContext.targetFiles?.[0];
      if (!targetFile) {
        return {
          taskId: params.task.id,
          agentId: id,
          status: 'FAILURE' as const,
          artifacts: [],
          conflicts: [],
          tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 1,
          error: 'E44_CAPTURE_NO_TARGET'
        };
      }
      const content = `// e44-capture ${params.task.id} -> ${targetFile}\n`;
      const artifact: AgentArtifact = {
        id: `art-${params.task.id}`,
        taskId: params.task.id,
        agentId: id,
        domain: 'ARCHITECTURE' as never,
        kind: 'PROPOSED_FILE_CHANGE',
        targetFiles: [targetFile],
        payload: {
          filePath: targetFile,
          operation: params.task.operation === 'DELETE' ? 'DELETE' : 'CREATE',
          proposedContent: content,
          reason: 'É44 capture'
        },
        confidence: 1,
        hash: `hash-e44-${params.task.id}`,
        summary: 'É44'
      };
      return {
        taskId: params.task.id,
        agentId: id,
        status: 'SUCCESS' as const,
        degraded: false,
        artifacts: [artifact],
        conflicts: [],
        tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 1
      };
    }
    protected buildArtifacts(): readonly [] {
      return [];
    }
  }
  return new CaptureAgent();
}

// ===========================================================================
// SECTION S — intégration chaîne RÉELLE (wiring identique à apps/api/src/server.ts)
// ===========================================================================

describe('É44 — intégration chaîne réelle : contexte conversationnel → agents', () => {
  let fileSource: InMemoryMutableFileSource;
  let orchestrator: AIOrchestratorService;
  let svc: ConversationIntelligenceService;
  let captures: CaptureRecord[];
  let runSeq = 0;
  const tenantId = 'tenant-e44-int';
  let projectId: string;

  beforeEach(() => {
    runSeq += 1;
    projectId = `proj-e44-int-${runSeq}`;
    captures = [];
    fileSource = new InMemoryMutableFileSource({});
    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    orchestrator = new AIOrchestratorService(
      undefined,
      undefined,
      mutationOrchestrator,
      undefined,
      undefined,
      undefined,
      undefined,
      fileSource
    );
    const registry = orchestrator.getExecutionAgentRegistry();
    registry.unregister(REFERENCE_AGENT_ID);
    registry.unregister(CAPTURE_AGENT_ID);
    registry.register(makeCaptureAgent(captures));

    svc = new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
    svc.attachAgentExecutor({
      execute: (request) => orchestrator.executeAgent(request),
      getRegistry: () => orchestrator.getExecutionAgentRegistry(),
      executeBatch: (request) => orchestrator.executeBatch(request)
    });
  });

  /** Session immuable : chaque tour retourne une NOUVELLE session. */
  async function conversationWith(params: {
    turns: readonly string[];
    decision?: string;
  }): Promise<ConversationSession> {
    let session = svc.createSession({ tenantId, projectId });
    for (const message of params.turns) {
      session = (
        await svc.processTurn({ tenantId, projectId, sessionId: session.sessionId, message })
      ).session;
    }
    if (params.decision !== undefined) {
      svc.recordDecision({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        statement: params.decision,
        reason: 'décision explicite (test É44)'
      });
    }
    return session;
  }

  async function confirmAndExecute(session: ConversationSession): Promise<ExecutionResult> {
    await svc.confirmPlan({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      planId: session.activePlan!.planId,
      approved: true
    });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });
    return result.executionResult;
  }

  it('S1+S12 — demande simple routée : contrainte+décision transmises (tâche+payload), fichier écrit', async () => {
    const session = await conversationWith({
      turns: ['Crée un site vitrine', 'Utilise uniquement des couleurs sobres', 'Crée la page src/e44-s1.ts'],
      decision: 'Le catalogue est organisé par catégories'
    });

    const res = await confirmAndExecute(session);

    assert.equal(res.success, true, res.message);
    assert.equal(captures.length, 1, 'une seule tâche (≤1 mutation → routé)');
    const capture = captures[0]!;
    assert.ok(capture.description.includes('Contexte conversationnel à respecter'), 'bloc de contexte tracé');
    assert.ok(
      capture.description.includes('«Extracted constraint: Utilise uniquement des couleurs sobres»'),
      'la contrainte active est transmise dans la tâche'
    );
    assert.ok(
      capture.description.includes('«Le catalogue est organisé par catégories»'),
      'la décision active est transmise dans la tâche'
    );
    assert.deepEqual(
      [...capture.context.constraints],
      ['Extracted constraint: Utilise uniquement des couleurs sobres'],
      'le payload routé porte la contrainte'
    );
    assert.deepEqual([...capture.context.decisions], ['Le catalogue est organisé par catégories']);
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/e44-s1.ts'), 'fichier réellement écrit');
  });

  it('S2+S5+S10 — batch multi-mutations : la MÊME contrainte globale pour CHAQUE tâche', async () => {
    const session = await conversationWith({
      turns: ['Crée un site vitrine', 'Utilise uniquement des couleurs sobres', 'Crée les pages src/e44-s2a.ts et src/e44-s2b.ts']
    });

    const res = await confirmAndExecute(session);

    assert.equal(res.success, true, res.message);
    assert.equal(captures.length, 2, '2 tâches de mutation exécutées');
    for (const capture of captures) {
      assert.ok(
        capture.description.includes('«Extracted constraint: Utilise uniquement des couleurs sobres»'),
        `la contrainte globale est dans la tâche ${capture.taskId}`
      );
      assert.ok(capture.description.includes('Contexte conversationnel à respecter'));
    }
    // Cohérence : les deux tâches portent la MÊME contrainte (aucune tâche oubliée).
    const withConstraint = captures.filter((c) => c.description.includes('couleurs sobres'));
    assert.equal(withConstraint.length, captures.length);
  });

  it('S3+S6 — conversation longue : contraintes, interdits et décisions successives transmis', async () => {
    const session = await conversationWith({
      turns: [
        'Crée un site vitrine pour une boutique',
        'Utilise uniquement des couleurs sobres',
        'Ne jamais stocker de données bancaires',
        'Crée les pages src/e44-s3a.ts et src/e44-s3b.ts'
      ],
      decision: 'Le catalogue est organisé par catégories'
    });

    const res = await confirmAndExecute(session);

    assert.equal(res.success, true, res.message);
    assert.equal(captures.length, 2);
    for (const capture of captures) {
      assert.ok(capture.description.includes('«Extracted constraint: Utilise uniquement des couleurs sobres»'));
      assert.ok(
        capture.description.includes('«Extracted constraint: Ne jamais stocker de données bancaires»'),
        'l interdiction est transmise telle quelle (l agent ne peut pas l interpréter comme une suggestion)'
      );
      assert.ok(capture.description.includes('«Le catalogue est organisé par catégories»'));
    }
  });

  it('S4+S8 — modification après plan / changement de cible : ancienne demande ABSENTE des tâches', async () => {
    const session = await conversationWith({
      turns: [
        'Crée la page src/e44-s4panier.ts',
        'En fait je voudrais une page tarifs plutôt',
        'Crée la page src/e44-s4tarifs.ts'
      ]
    });

    const res = await confirmAndExecute(session);

    assert.equal(res.success, true, res.message);
    assert.equal(captures.length, 1);
    assert.ok(captures[0]!.description.includes('src/e44-s4tarifs.ts'), 'la cible ACTIVE est transmise');
    assert.ok(
      !captures[0]!.description.includes('panier'),
      'l ANCIENNE demande (remplacée) n est jamais transmise à l agent'
    );
    assert.ok(!fileSource.getFile(tenantId, projectId, 'src/e44-s4panier.ts'), 'aucune écriture de l ancienne cible');
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/e44-s4tarifs.ts'), 'la cible active est écrite');
  });

  it('S7 — hypothèse NON confirmée ≠ décision : labels distincts dans la tâche reçue', async () => {
    const session = await conversationWith({
      turns: ['Crée une page src/e44-s7.ts avec un bouton commander'],
      decision: 'Le bouton commander ouvre la page panier'
    });

    const res = await confirmAndExecute(session);

    assert.equal(res.success, true, res.message);
    const description = captures[0]!.description;
    assert.ok(description.includes('Décisions actives (à appliquer) : «Le bouton commander ouvre la page panier»'));
    // Si le moteur a dérivé une hypothèse active, elle est étiquetée comme
    // telle — JAMAIS présentée comme une décision.
    const decisionIndex = description.indexOf('Décisions actives (à appliquer)');
    const hypothesisIndex = description.indexOf('Hypothèses NON confirmées');
    if (hypothesisIndex !== -1) {
      assert.ok(
        hypothesisIndex > decisionIndex,
        'l hypothèse est distincte de la décision dans le bloc'
      );
      assert.ok(description.includes('ne rien inventer'), 'la règle anti-invention est explicite');
    }
  });

  it('S9 — 2 tâches dépendantes dans l ordre, contexte transmis, sans dépendance inventée', async () => {
    let session = svc.createSession({ tenantId, projectId });
    const stepA = mutationStepE44(1, 'src/e44-s9a.ts');
    const stepB = mutationStepE44(2, 'src/e44-s9b.ts', 'CREATE', [1]);
    const plan = makePlanE44([stepA, stepB]);
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage: 'Crée src/e44-s9a.ts puis src/e44-s9b.ts',
      intent: makeIntentE44('CREATE', 'créer panier dépendant des données'),
      plan
    });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });

    assert.equal(result.executionResult.success, true, result.executionResult.message);
    assert.deepEqual(captures.map((c) => c.taskId), ['step-1', 'step-2'], 'ordre des dépendances respecté');
    // Session SANS contexte conversationnel → descriptions historiques (aucun bloc inventé).
    assert.ok(!captures[0]!.description.includes('Contexte conversationnel'));
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/e44-s9a.ts'));
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/e44-s9b.ts'));
  });

  it('S11 — deux projets distincts : AUCUN mélange de contexte conversationnel', async () => {
    // Projet A : contrainte active.
    let sessA = svc.createSession({ tenantId, projectId });
    sessA = (await svc.processTurn({ tenantId, projectId, sessionId: sessA.sessionId, message: 'Crée un site vitrine' })).session;
    sessA = (await svc.processTurn({ tenantId, projectId, sessionId: sessA.sessionId, message: 'Utilise uniquement des couleurs sobres' })).session;
    sessA = (await svc.processTurn({ tenantId, projectId, sessionId: sessA.sessionId, message: 'Crée les pages src/e44-s11a1.ts et src/e44-s11a2.ts' })).session;
    await svc.confirmPlan({ tenantId, projectId, sessionId: sessA.sessionId, planId: sessA.activePlan!.planId, approved: true });

    // Projet B : aucune contrainte.
    let sessB = svc.createSession({ tenantId, projectId: `${projectId}-b` });
    sessB = (await svc.processTurn({ tenantId, projectId: `${projectId}-b`, sessionId: sessB.sessionId, message: 'Crée les pages src/e44-s11b1.ts et src/e44-s11b2.ts' })).session;
    await svc.confirmPlan({ tenantId, projectId: `${projectId}-b`, sessionId: sessB.sessionId, planId: sessB.activePlan!.planId, approved: true });

    const resA = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: sessA.sessionId });
    assert.equal(resA.executionResult.success, true, resA.executionResult.message);
    const capturesA = captures.slice();
    captures.length = 0;

    const resB = await svc.executeApprovedPlan({ tenantId, projectId: `${projectId}-b`, sessionId: sessB.sessionId });
    assert.equal(resB.executionResult.success, true, resB.executionResult.message);
    const capturesB = captures.slice();

    assert.equal(capturesA.length, 2);
    assert.equal(capturesB.length, 2);
    assert.ok(
      capturesA.every((c) => c.description.includes('couleurs sobres')),
      'le projet A reçoit SA contrainte'
    );
    assert.ok(
      capturesB.every((c) => !c.description.includes('couleurs sobres') && !c.description.includes('vitrine')),
      'le projet B ne reçoit AUCUN élément du projet A'
    );
  });

  it('NR — plan direct sans contexte : descriptions et payload IDENTIQUES à l historique (rétrocompatibilité)', async () => {
    let session = svc.createSession({ tenantId, projectId });
    const plan = makePlanE44([mutationStepE44(1, 'src/e44-nr.ts')]);
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage: 'Crée la page src/e44-nr.ts',
      intent: makeIntentE44('CREATE', 'créer src/e44-nr.ts'),
      plan
    });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });

    assert.equal(result.executionResult.success, true, result.executionResult.message);
    assert.ok(!captures[0]!.description.includes('Contexte conversationnel'), 'aucun bloc inventé');
    assert.deepEqual([...captures[0]!.context.constraints], [], 'payload routé vide comme avant É44');
    assert.deepEqual([...captures[0]!.context.decisions], []);
  });
});

// ===========================================================================
// SECTION P — prompt RÉEL de production (agent SANS surcharge + provider capture)
// ===========================================================================

const promptCaptures: Array<{ prompt: string; systemPrompt: string }> = [];

function installCaptureProvider(): void {
  aiProviderRegistry.register({
    descriptor: {
      providerId: 'e44-capture',
      providerName: 'É44 Prompt Capture',
      models: ['e44-capture-model'],
      capabilities: ['FAST', 'CODE_GENERATION'] as never[],
      contextWindow: 128000,
      structuredOutput: false,
      streaming: false,
      toolCalling: false,
      reasoning: false,
      vision: false,
      costMetadata: {},
      availability: 'AVAILABLE',
      healthStatus: 'HEALTHY'
    },
    async generate(request) {
      promptCaptures.push({ prompt: request.prompt, systemPrompt: request.systemPrompt ?? '' });
      return {
        text: '// e44-capture : contenu produit pour la tâche\n',
        providerId: 'e44-capture',
        modelId: 'e44-capture-model',
        latencyMs: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        costUsd: 0
      };
    }
  });
}

/** Agent PROD-LIKE : BaseSpecializedAgent.executeTask de production (aucune surcharge). */
function makeProdLikeAgent(): BaseSpecializedAgent {
  const id = 'agent-e44-prod';
  class ProdLikeAgent extends BaseSpecializedAgent {
    constructor() {
      super(
        {
          id,
          name: 'E44 Prod-like',
          domain: 'ARCHITECTURE' as never,
          capabilities: ['FILE_MUTATION', 'SERVICE_LOGIC'] as never[],
          description: 'agent É44 : executeTask de production SANS surcharge (prompt réel)',
          riskLevel: 'LOW' as never,
          requiredProviderCapabilities: [],
          allowedTools: []
        },
        undefined
      );
    }
    protected buildArtifacts(params: {
      task: AgentTask;
      context: TaskContextPayload;
      generatedText: string;
    }): readonly AgentArtifact[] {
      const task = params.task;
      const targetFile = task.requiredContext.targetFiles?.[0] ?? 'src/e44-fallback.ts';
      return [
        this.createArtifact({
          id: `art-prod-${task.id}`,
          taskId: task.id,
          kind: 'PROPOSED_FILE_CHANGE',
          targetFiles: [targetFile],
          payload: {
            filePath: targetFile,
            operation: task.operation === 'DELETE' ? 'DELETE' : 'CREATE',
            proposedContent: params.generatedText,
            reason: 'É44 prod-like'
          },
          confidence: 1,
          summary: 'É44 prod-like'
        })
      ];
    }
  }
  return new ProdLikeAgent();
}

function agentPrompts(): readonly string[] {
  // Les appels provider du MOTEUR conversationnel (message pur) sont distingués
  // des prompts AGENT (format « Tâche : … » de BaseSpecializedAgent).
  return promptCaptures.filter((p) => p.prompt.startsWith('Tâche : ')).map((p) => p.prompt);
}

describe('É44 — prompt RÉEL de production (correction #2 : injection dans le prompt LLM)', () => {
  let fileSource: InMemoryMutableFileSource;
  let orchestrator: AIOrchestratorService;
  let svc: ConversationIntelligenceService;
  let runSeq = 0;
  const tenantId = 'tenant-e44-prompt';
  let projectId: string;

  beforeEach(() => {
    runSeq += 1;
    projectId = `proj-e44-prompt-${runSeq}`;
    promptCaptures.length = 0;
    installCaptureProvider();
    fileSource = new InMemoryMutableFileSource({});
    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    orchestrator = new AIOrchestratorService(
      undefined,
      undefined,
      mutationOrchestrator,
      undefined,
      undefined,
      undefined,
      undefined,
      fileSource
    );
    const registry = orchestrator.getExecutionAgentRegistry();
    registry.unregister(REFERENCE_AGENT_ID);
    registry.unregister('agent-e44-prod');
    registry.register(makeProdLikeAgent());
    svc = new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
    svc.attachAgentExecutor({
      execute: (request) => orchestrator.executeAgent(request),
      getRegistry: () => orchestrator.getExecutionAgentRegistry(),
      executeBatch: (request) => orchestrator.executeBatch(request)
    });
  });

  it('P1 — batch : le prompt RÉEL envoyé au LLM contient contraintes, interdits et décisions', async () => {
    let session = svc.createSession({ tenantId, projectId });
    for (const message of [
      'Crée un site vitrine',
      'Utilise uniquement des couleurs sobres',
      'Ne jamais stocker de données bancaires'
    ]) {
      session = (await svc.processTurn({ tenantId, projectId, sessionId: session.sessionId, message })).session;
    }
    svc.recordDecision({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      statement: 'Le catalogue est organisé par catégories',
      reason: 'décision explicite (test É44)'
    });
    session = (await svc.processTurn({ tenantId, projectId, sessionId: session.sessionId, message: 'Crée les pages src/e44-p1a.ts et src/e44-p1b.ts' })).session;

    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: session.activePlan!.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });
    assert.equal(result.executionResult.success, true, result.executionResult.message);

    const prompts = agentPrompts();
    assert.ok(prompts.length >= 2, 'chaque tâche du batch a produit un prompt agent réel');
    for (const prompt of prompts) {
      assert.ok(prompt.includes('«Extracted constraint: Utilise uniquement des couleurs sobres»'), 'contrainte dans le prompt');
      assert.ok(prompt.includes('«Extracted constraint: Ne jamais stocker de données bancaires»'), 'interdit dans le prompt');
      assert.ok(prompt.includes('«Le catalogue est organisé par catégories»'), 'décision dans le prompt');
      assert.ok(prompt.includes('Tâche : '), 'format de prompt agent réel');
    }
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/e44-p1a.ts'), 'fichier écrit via le pipeline');
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/e44-p1b.ts'), 'fichier écrit via le pipeline');
  });

  it('P2 — routé : le prompt RÉEL contient les sections Contraintes/Décisions injectées par BaseSpecializedAgent', async () => {
    let session = svc.createSession({ tenantId, projectId });
    session = (await svc.processTurn({ tenantId, projectId, sessionId: session.sessionId, message: 'Crée un site vitrine' })).session;
    session = (await svc.processTurn({ tenantId, projectId, sessionId: session.sessionId, message: 'Utilise uniquement des couleurs sobres' })).session;
    svc.recordDecision({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      statement: 'Le catalogue est organisé par catégories',
      reason: 'décision explicite (test É44)'
    });
    session = (await svc.processTurn({ tenantId, projectId, sessionId: session.sessionId, message: 'Crée la page src/e44-p2.ts' })).session;

    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: session.activePlan!.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });
    assert.equal(result.executionResult.success, true, result.executionResult.message);

    const prompts = agentPrompts();
    assert.equal(prompts.length, 1, 'une seule tâche routée → un prompt agent');
    const prompt = prompts[0]!;
    // Correction #2 : le TaskContextPayload REMPLI est injecté dans le prompt.
    assert.ok(prompt.includes('Contraintes à respecter (OBLIGATOIRES) :'), 'section contraintes injectée');
    assert.ok(prompt.includes('- Extracted constraint: Utilise uniquement des couleurs sobres'));
    assert.ok(prompt.includes('Décisions actives à appliquer :'), 'section décisions injectée');
    assert.ok(prompt.includes('- Le catalogue est organisé par catégories'));
  });

  it('P3 — sans contexte : prompt de production IDENTIQUE à l historique (aucune section inventée)', async () => {
    let session = svc.createSession({ tenantId, projectId });
    const plan = makePlanE44([mutationStepE44(1, 'src/e44-p3.ts')]);
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage: 'Crée la page src/e44-p3.ts',
      intent: makeIntentE44('CREATE', 'créer src/e44-p3.ts'),
      plan
    });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });
    assert.equal(result.executionResult.success, true, result.executionResult.message);

    const prompts = agentPrompts();
    assert.equal(prompts.length, 1);
    const prompt = prompts[0]!;
    assert.ok(!prompt.includes('Contraintes à respecter'), 'aucune section contraintes inventée');
    assert.ok(!prompt.includes('Décisions actives'), 'aucune section décisions inventée');
    assert.ok(!prompt.includes('Contexte conversationnel'), 'aucun bloc inventé');
    assert.ok(prompt.includes('Description : Crée la page src/e44-p3.ts'), 'description routée = demande active');
  });
});
