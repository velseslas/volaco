/**
 * É45 — Sélection des agents spécialisés : par le TRAVAIL RÉEL (spécialité
 * déclarée + capabilities), jamais par un nom, jamais un choix arbitraire.
 *
 * Défauts démontrés par la sonde É45 (traces AVANT/APRÈS) :
 *   #1 SÉLECTION — capability-only, domaine ignoré : dès que ≥2 agents
 *      FILE_MUTATION coexistent, TOUTE demande (mono ET batch) était refusée
 *      AMBIGUOUS_AGENT_ROUTE même quand chaque étape relevait sans ambiguïté
 *      d'une spécialité ; le domaine métier d'É44/É40 n'était jamais converti
 *      en spécialité d'agent.
 *   #2 DOUBLON — deux étapes ciblant le même fichier avec la même opération
 *      n'étaient pas détectées : le second CREATE échouait systématiquement
 *      en précondition (« il existe déjà ») → batch FAILED auto-infligé.
 *
 * Corrections vérifiées ICI (pipeline RÉEL, pattern É39/É44 — aucun
 * agent.executeTask() direct, MÊME AgentExecutionService que server.ts) :
 *   A — routeur mono-agent : désambiguïsation par spécialité déclarée
 *       (>1 candidat uniquement ; refus historique conservé sans signal) ;
 *   B — adaptateur batch : désignation d'un agent PAR ÉTAPE
 *       (targetDomain admissible OU mots-clés du travail sur titre+cible),
 *       PLAN_STEP_DUPLICATE, SELECTION_DOMAIN_MISMATCH, union des
 *       requiredCapabilities déclarées ;
 *   C — chaîne réelle ConversationIntelligenceService → ExecutionBridge →
 *       MultiAgentScheduler É37 → AgentExecutionService É32→É36 →
 *       MutationBridge → FileSource : mapping spécialité↔agent par scénario,
 *       dépendances/parallélisme, conflits de cibles, contexte É44 transmis à
 *       CHAQUE agent, isolation, routage historique préservé.
 *
 * Correspondance scénarios obligatoires (sonde É45 = S1–S17) :
 *   S1  = C1b (question → 0 agent ; demande simple → EXACTEMENT 1 agent) ;
 *   S2–S5 = A1/B10/C1 (UI, BACKEND, DATA, SECURITY→A1b, TEST→A3) ;
 *   S6  = C1 (4 spécialités, même vague) ;
 *   S7  = C3 (dépendances séquentielles) ;
 *   S8  = C4 (parallélisme même vague) ;
 *   S9  = C2 (agents inutiles jamais activés) ;
 *   S10 = A3/B5 (spécialité sans FILE_MUTATION → refus nommant le manque) ;
 *   S11 = B8/C5 (même cible, 2 spécialités, séquencées) ;
 *   S11b= B7/C6 (doublon → PLAN_STEP_DUPLICATE avant toute écriture) ;
 *   S12 = C7 (échec → dépendante BLOCKED, jamais exécutée) ;
 *   S14 = A6/B11/C8 (contexte É44 transmis à CHAQUE agent) ;
 *   S15 = C9 (isolation 2 projets) ;
 *   S16 = C10 (registry de production par défaut : routage inchangé) ;
 *   S17 = B3 (registre à agent unique : comportement É39 préservé).
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
// Fabriques de référence (pattern É39/É44)
// ---------------------------------------------------------------------------

let planSeq = 0;
let intentSeq = 0;

function makePlanE45(steps: readonly PlanStep[]): EngineeringPlan {
  planSeq += 1;
  const partial = {
    planId: `plan-e45-${planSeq}`,
    title: 'Plan É45',
    summary: `Plan de test É45 (${steps.length} étape(s))`,
    steps,
    status: 'APPROVED' as const
  };
  return { ...partial, planHash: computeEngineeringPlanHash(partial) };
}

function makeIntentE45(category: 'CREATE' | 'MODIFY' | 'DELETE', goal: string): IntentResult {
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

interface StepOptions {
  readonly targetDomain?: string | undefined;
  readonly dependsOn?: readonly number[] | undefined;
  readonly requiredCapabilities?: readonly string[] | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
}

const mutationStepE45 = (
  index: number,
  file: string,
  operation: 'CREATE' | 'MODIFY' | 'DELETE' = 'CREATE',
  options: StepOptions = {}
): PlanStep => ({
  stepIndex: index,
  title: options.title ?? `${operation} ${file}`,
  description: options.description ?? `${operation} du fichier ${file}`,
  targetFiles: [file],
  operation,
  requiresApproval: false,
  ...(options.targetDomain !== undefined ? { targetDomain: options.targetDomain } : {}),
  ...(options.dependsOn !== undefined ? { dependsOn: options.dependsOn } : {}),
  ...(options.requiredCapabilities !== undefined ? { requiredCapabilities: options.requiredCapabilities } : {})
});

function makeAssumptionE45(id: string, statement: string, status: ConversationAssumption['status']): ConversationAssumption {
  return {
    id,
    statement,
    confidence: 0.8,
    evidence: 'test É45',
    risk: 'LOW',
    reversible: true,
    requiresConfirmation: status === 'PROPOSED',
    status
  };
}

// ---------------------------------------------------------------------------
// Agents de capture (pattern É39 — état dans des closures, JAMAIS l'instance)
// ---------------------------------------------------------------------------

type JournalEvent = {
  readonly event: 'start' | 'end';
  readonly taskId: string;
  readonly agentId: string;
  readonly ts: number;
};

type CaptureRecord = {
  readonly taskId: string;
  readonly agentId: string;
  readonly agentDomain: string;
  readonly taskDomain: string;
  readonly title: string;
  readonly description: string;
  readonly targetFiles: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly context: TaskContextPayload;
};

/**
 * Capabilities RÉELLES des agents de production (audit É45 : montage
 * service.ts + agents/*.ts) — rien n'est inventé : les agents de test portent
 * exactement les capabilities de leur spécialité, plus FILE_MUTATION.
 */
const REAL_CAPS: Record<string, readonly string[]> = {
  UI: ['PAGE_GENERATION', 'COMPONENT_STYLING', 'RESPONSIVE_LAYOUT'],
  BACKEND: ['API_DESIGN', 'SERVICE_LOGIC'],
  DATA: ['SCHEMA_MODELING', 'DATA_INTEGRITY'],
  SECURITY: ['AUTH_RBAC', 'VULNERABILITY_SCAN'],
  TEST: ['UNIT_TEST_GEN', 'INTEGRATION_TEST', 'E2E_SCENARIO'],
  ARCHITECTURE: ['SERVICE_LOGIC', 'SCHEMA_MODELING']
};

const ZERO_TOKENS = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function makeSpecialistE45(
  journal: JournalEvent[],
  captures: CaptureRecord[],
  id: string,
  domain: string,
  options: { withMutation?: boolean; failFor?: ReadonlySet<string> } = {}
): BaseSpecializedAgent {
  const caps = [...(REAL_CAPS[domain] ?? [])];
  if (options.withMutation !== false) caps.push('FILE_MUTATION');
  class SpecialistAgent extends BaseSpecializedAgent {
    constructor() {
      super(
        {
          id,
          name: `E45 ${domain}`,
          domain: domain as never,
          capabilities: caps as never[],
          description: `agent de test É45 : spécialité ${domain} (capabilities réelles de production)`,
          riskLevel: 'LOW' as never,
          requiredProviderCapabilities: [],
          allowedTools: []
        },
        undefined
      );
    }
    public override async executeTask(params: { task: AgentTask; context: TaskContextPayload }): Promise<AgentResult> {
      journal.push({ event: 'start', taskId: params.task.id, agentId: id, ts: Date.now() });
      captures.push({
        taskId: params.task.id,
        agentId: id,
        agentDomain: domain,
        taskDomain: params.task.domain,
        title: params.task.title,
        description: params.task.description,
        targetFiles: [...(params.task.requiredContext.targetFiles ?? [])],
        requiredCapabilities: [...(params.task.requiredCapabilities ?? [])],
        context: params.context
      });
      await sleep(45);
      journal.push({ event: 'end', taskId: params.task.id, agentId: id, ts: Date.now() });
      const targetFile = params.task.requiredContext.targetFiles?.[0];
      if (!targetFile || options.failFor?.has(targetFile)) {
        return {
          taskId: params.task.id,
          agentId: id,
          status: 'FAILURE' as const,
          artifacts: [],
          conflicts: [],
          tokensUsed: ZERO_TOKENS,
          durationMs: 1,
          error: options.failFor?.has(targetFile ?? '') ? 'E45_FAIL_INJECTE' : 'E45_CAPTURE_NO_TARGET'
        };
      }
      // Mapping d'opération des artefacts (pattern É44) : MODIFY → 'UPDATE'
      // (un CREATE sur un fichier existant échouerait en précondition).
      const payloadOperation =
        params.task.operation === 'DELETE' ? 'DELETE' : params.task.operation === 'MODIFY' ? 'UPDATE' : 'CREATE';
      const artifact: AgentArtifact = {
        id: `art-${params.task.id}`,
        taskId: params.task.id,
        agentId: id,
        domain: domain as never,
        kind: 'PROPOSED_FILE_CHANGE',
        targetFiles: [targetFile],
        payload: {
          filePath: targetFile,
          operation: payloadOperation,
          proposedContent: `// e45 ${id} ${params.task.id} -> ${targetFile}\n`,
          reason: 'É45 capture'
        },
        confidence: 1,
        hash: `hash-e45-${params.task.id}`,
        summary: 'É45'
      };
      return {
        taskId: params.task.id,
        agentId: id,
        status: 'SUCCESS' as const,
        degraded: false,
        artifacts: [artifact],
        conflicts: [],
        tokensUsed: ZERO_TOKENS,
        durationMs: 45
      };
    }
    protected buildArtifacts(): readonly [] {
      return [];
    }
  }
  return new SpecialistAgent();
}

/** Vagues : deux tâches se CHEVAUCHENT (exécutées en parallèle) ou non. */
function tasksOverlap(journal: readonly JournalEvent[], taskIdA: string, taskIdB: string): boolean {
  const startA = journal.find((e) => e.event === 'start' && e.taskId === taskIdA);
  const endA = journal.find((e) => e.event === 'end' && e.taskId === taskIdA);
  const startB = journal.find((e) => e.event === 'start' && e.taskId === taskIdB);
  const endB = journal.find((e) => e.event === 'end' && e.taskId === taskIdB);
  if (!startA || !endA || !startB || !endB) return false;
  return startA.ts < endB.ts && startB.ts < endA.ts;
}

/** Vagues : B démarre APRÈS la fin réelle de A (strictement séquentiel). */
function strictlyAfter(journal: readonly JournalEvent[], taskIdA: string, taskIdB: string): boolean {
  const endA = journal.find((e) => e.event === 'end' && e.taskId === taskIdA);
  const startB = journal.find((e) => e.event === 'start' && e.taskId === taskIdB);
  if (!endA || !startB) return false;
  return startB.ts >= endA.ts;
}

// ===========================================================================
// SECTION A — routeur mono-agent : désambiguïsation par spécialité déclarée
// (>1 candidat FILE_MUTATION uniquement ; refus historique conservé sinon)
// ===========================================================================

describe('É45 — SECTION A : routage mono-agent par spécialité du travail', () => {
  let registry: AgentRegistryService;

  beforeEach(() => {
    registry = new AgentRegistryService();
  });

  it('A1: 2 candidats FILE_MUTATION → le TRAVAIL désigne la spécialité (composant→UI, service→BACKEND), jamais un nom', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-a1-ui', 'UI'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-a1-backend', 'BACKEND'));

    const uiRoute = routeIntentToAgent({
      intent: makeIntentE45('MODIFY', 'modifier src/components/Button.tsx'),
      userMessage: 'Modifie le composant src/components/Button.tsx',
      sessionId: 'sess-a1-ui',
      planId: 'plan-a1-ui',
      registry
    });
    assert.equal(uiRoute.supported, true);
    assert.equal(uiRoute.agentId, 'agent-e45-a1-ui', 'le composant relève de la spécialité UI');
    assert.equal(uiRoute.task?.domain, 'UI');
    assert.equal(uiRoute.task?.operation, 'MODIFY');
    assert.deepEqual([...(uiRoute.task?.requiredContext.targetFiles ?? [])], ['src/components/Button.tsx']);
    assert.deepEqual([...(uiRoute.requiredCapabilities ?? [])], ['FILE_MUTATION']);

    const backendRoute = routeIntentToAgent({
      intent: makeIntentE45('CREATE', 'créer src/services/orders.service.ts'),
      userMessage: 'Ajoute un endpoint dans le service src/services/orders.service.ts',
      sessionId: 'sess-a1-be',
      planId: 'plan-a1-be',
      registry
    });
    assert.equal(backendRoute.supported, true);
    assert.equal(backendRoute.agentId, 'agent-e45-a1-backend', 'le service relève de la spécialité BACKEND');
    assert.equal(backendRoute.task?.domain, 'BACKEND');
  });

  it('A2: 2 candidats + AUCUN signal de spécialité → refus historique AMBIGUOUS_AGENT_ROUTE (candidats listés, inchangé)', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-a2-ui', 'UI'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-a2-backend', 'BACKEND'));

    const route = routeIntentToAgent({
      intent: makeIntentE45('CREATE', 'créer src/e45-a2.ts'),
      userMessage: 'Crée le fichier src/e45-a2.ts',
      sessionId: 'sess-a2',
      planId: 'plan-a2',
      registry
    });

    assert.equal(route.supported, false);
    assert.equal(route.agentId, undefined, 'aucun agent inventé');
    assert.match(route.reason ?? '', /AMBIGUOUS_AGENT_ROUTE/);
    assert.match(route.reason ?? '', /agent-e45-a2-ui/);
    assert.match(route.reason ?? '', /agent-e45-a2-backend/);
  });

  it('A3: spécialité du travail non couverte par le registry → UNSUPPORTED_AGENT_CAPABILITY_DOMAIN (le manque est nommé)', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-a3-ui', 'UI'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-a3-data', 'DATA'));

    const route = routeIntentToAgent({
      intent: makeIntentE45('MODIFY', 'modifier src/tests/e45-a3.spec.ts'),
      userMessage: 'Corrige le test src/tests/e45-a3.spec.ts',
      sessionId: 'sess-a3',
      planId: 'plan-a3',
      registry
    });

    assert.equal(route.supported, false);
    assert.equal(route.agentId, undefined, 'la spécialité TEST manquante ne bascule JAMAIS sur un autre agent');
    assert.match(route.reason ?? '', /UNSUPPORTED_AGENT_CAPABILITY_DOMAIN/);
    assert.match(route.reason ?? '', /'TEST'/);
  });

  it('A4: 2 agents de la MÊME spécialité → AMBIGUOUS_AGENT_ROUTE in-domaine (aucun choix arbitraire)', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-a4-b1', 'BACKEND'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-a4-b2', 'BACKEND'));

    const route = routeIntentToAgent({
      intent: makeIntentE45('CREATE', 'créer src/e45-a4.service.ts'),
      userMessage: 'Ajoute un endpoint dans le service src/e45-a4.service.ts',
      sessionId: 'sess-a4',
      planId: 'plan-a4',
      registry
    });

    assert.equal(route.supported, false);
    assert.match(route.reason ?? '', /AMBIGUOUS_AGENT_ROUTE/);
    assert.match(route.reason ?? '', /2 agents du domaine 'BACKEND'/);
    assert.match(route.reason ?? '', /agent-e45-a4-b1/);
    assert.match(route.reason ?? '', /agent-e45-a4-b2/);
  });

  it('A5: candidat UNIQUE → routage historique inchangé (aucun scan exigé, aucun refus inventé)', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-a5-sole', 'ARCHITECTURE'));

    // Message SANS signal de spécialité : l'unique candidat FILE_MUTATION est
    // désigné exactement comme avant É45 (comportement É33/É34 préservé).
    const silentRoute = routeIntentToAgent({
      intent: makeIntentE45('CREATE', 'créer src/e45-a5.ts'),
      userMessage: 'Crée le fichier src/e45-a5.ts',
      sessionId: 'sess-a5-a',
      planId: 'plan-a5-a',
      registry
    });
    assert.equal(silentRoute.supported, true);
    assert.equal(silentRoute.agentId, 'agent-e45-a5-sole');
    assert.equal(silentRoute.task?.domain, 'ARCHITECTURE');

    // Message AVEC signal : l'unique candidat reste désigné (la désambiguïsation
    // ne peut jamais RETIRER le seul agent possible).
    const flaggedRoute = routeIntentToAgent({
      intent: makeIntentE45('CREATE', 'créer src/components/e45-a5b.tsx'),
      userMessage: 'Crée la page src/components/e45-a5b.tsx',
      sessionId: 'sess-a5-b',
      planId: 'plan-a5-b',
      registry
    });
    assert.equal(flaggedRoute.supported, true);
    assert.equal(flaggedRoute.agentId, 'agent-e45-a5-sole');
  });

  it('A6: désambiguïsation active → le contexte É44 reste TOUJOURS transmis (bloc + payload)', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-a6-ui', 'UI'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-a6-backend', 'BACKEND'));

    const route = routeIntentToAgent({
      intent: { ...makeIntentE45('CREATE', 'créer src/components/e45-a6.tsx'), constraints: ['Contrainte du tour courant'] },
      userMessage: 'Crée le composant src/components/e45-a6.tsx',
      sessionId: 'sess-a6',
      planId: 'plan-a6',
      registry,
      conversation: {
        constraints: ['Extracted constraint: couleurs sobres'],
        decisions: ['D1'],
        assumptions: [makeAssumptionE45('h1', 'H-proposée', 'PROPOSED')]
      }
    });

    assert.equal(route.supported, true);
    assert.equal(route.agentId, 'agent-e45-a6-ui');
    const description = route.task?.description ?? '';
    assert.ok(description.startsWith('Crée le composant src/components/e45-a6.tsx'), 'la demande reste le début');
    assert.ok(description.includes('Contraintes actives (OBLIGATOIRES)'));
    assert.ok(description.includes('«Extracted constraint: couleurs sobres»'));
    assert.ok(description.includes('Décisions actives (à appliquer) : «D1»'));
    assert.ok(description.includes('Hypothèses NON confirmées'), "l'hypothèse est étiquetée comme telle");
    assert.deepEqual(
      [...route.context?.constraints ?? []],
      ['Contrainte du tour courant', 'Extracted constraint: couleurs sobres'],
      'ordre : tour courant puis mémoire, dédupliqué'
    );
    assert.deepEqual([...route.context?.decisions ?? []], ['D1']);
  });

  it('A7: domaine MÉTIER de l intention (dom_*) jamais une spécialité d agent — le TRAVAIL décide', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-a7-ui', 'UI'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-a7-data', 'DATA'));

    const route = routeIntentToAgent({
      intent: { ...makeIntentE45('CREATE', 'créer src/db/e45-a7.schema.ts'), domain: 'dom_billing' },
      userMessage: 'Crée le schema src/db/e45-a7.schema.ts',
      sessionId: 'sess-a7',
      planId: 'plan-a7',
      registry
    });

    assert.equal(route.supported, true, "un domaine métier n'est jamais un motif de refus ni de routage");
    assert.equal(route.agentId, 'agent-e45-a7-data', "le mot du TRAVAIL («schema») désigne la spécialité DATA");
    assert.equal(route.task?.domain, 'DATA');
    assert.notEqual(route.agentId, 'dom_billing', "aucun agent 'dom_*' n'est jamais inventé");
  });
});

// ===========================================================================
// SECTION B — adaptateur batch : désignation PAR ÉTAPE, doublons, déclarations
// ===========================================================================

describe('É45 — SECTION B : adaptateur multi-agents (analyzePlanForBatch)', () => {
  let registry: AgentRegistryService;

  beforeEach(() => {
    registry = new AgentRegistryService();
  });

  it('B1: DAG multi-spécialités — targetDomain déclarée désigne UN agent PAR étape', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b1-ui', 'UI'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-b1-backend', 'BACKEND'));

    // Titres et cibles SANS mot-clé de spécialité : seule la targetDomain
    // DÉCLARÉE porte la décision (aucune devine possible).
    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-b1a.ts', 'CREATE', { targetDomain: 'UI', title: 'Module a' }),
      mutationStepE45(2, 'src/e45-b1b.ts', 'CREATE', { targetDomain: 'BACKEND', title: 'Module b', dependsOn: [1] })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b1', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'batch');
    assert.equal(analysis.agentId, 'agent-e45-b1-ui', "l'agent de la première étape est exposé");
    assert.equal(analysis.specs.length, 2);
    assert.equal(analysis.specs[0]!.agentId, 'agent-e45-b1-ui');
    assert.equal(analysis.specs[0]!.task.domain, 'UI');
    assert.equal(analysis.specs[1]!.agentId, 'agent-e45-b1-backend');
    assert.equal(analysis.specs[1]!.task.domain, 'BACKEND');
    assert.deepEqual([...analysis.specs[1]!.dependencies], ['step-1'], 'dépendance déclarée conservée');
    assert.deepEqual([...analysis.specs[0]!.task.requiredCapabilities], ['FILE_MUTATION']);
    assert.deepEqual([...analysis.specs[1]!.task.requiredCapabilities], ['FILE_MUTATION']);
  });

  it('B2: 2 candidats + aucune spécialité résolvable → refus historique AMBIGUOUS_AGENT_ROUTE (inchangé)', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b2-ui', 'UI'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-b2-backend', 'BACKEND'));

    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-b2a.ts', 'CREATE', { title: 'Module a' }),
      mutationStepE45(2, 'src/e45-b2b.ts', 'CREATE', { title: 'Module b' })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b2', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'refuse');
    assert.match(analysis.reason, /AMBIGUOUS_AGENT_ROUTE/);
    assert.match(analysis.reason, /agent-e45-b2-ui/);
    assert.match(analysis.reason, /agent-e45-b2-backend/);
  });

  it('B3: candidat UNIQUE → comportement É39 STRICTEMENT préservé (même agent, caps historiques, descriptions sans bloc)', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b3-sole', 'ARCHITECTURE'));

    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-b3a.ts'),
      mutationStepE45(2, 'src/e45-b3b.ts', 'CREATE', { dependsOn: [1] })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b3', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'batch');
    assert.ok(analysis.specs.every((spec) => spec.agentId === 'agent-e45-b3-sole'), 'un seul agent pour tout le DAG');
    assert.ok(analysis.specs.every((spec) => spec.task.domain === 'ARCHITECTURE'));
    assert.equal(analysis.agentId, 'agent-e45-b3-sole');
    assert.deepEqual([...analysis.specs[0]!.task.requiredCapabilities], ['FILE_MUTATION']);
    assert.ok(
      analysis.specs.every((spec) => !spec.task.description.includes('Contexte conversationnel')),
      'sans conversation → descriptions historiques (pattern É44)'
    );
  });

  it('B4: candidat unique + targetDomain déclarée ≠ domaine de l agent → SELECTION_DOMAIN_MISMATCH', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b4-sole', 'ARCHITECTURE'));

    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-b4a.tsx', 'CREATE', { targetDomain: 'UI', title: 'Module u' }),
      mutationStepE45(2, 'src/e45-b4b.tsx', 'CREATE', { targetDomain: 'UI', title: 'Module u2' })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b4', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'refuse');
    assert.match(analysis.reason, /SELECTION_DOMAIN_MISMATCH/);
    assert.match(analysis.reason, /'UI'/);
    assert.match(analysis.reason, /agent-e45-b4-sole/);
  });

  it('B5: spécialité déclarée dont AUCUN agent (même du domaine) ne possède FILE_MUTATION → UNSUPPORTED_AGENT_CAPABILITY_DOMAIN', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b5-ui', 'UI'));
    // L'agent DATA existe dans le registry mais NE POSSÈDE PAS FILE_MUTATION
    // (capabilities réelles des agents DATA de production) : la spécialité
    // déclarée n'est couverte par AUCUN candidat FILE_MUTATION.
    registry.register(makeSpecialistE45([], [], 'agent-e45-b5-data', 'DATA', { withMutation: false }));
    registry.register(makeSpecialistE45([], [], 'agent-e45-b5-arch', 'ARCHITECTURE'));

    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-b5a.tsx', 'CREATE', { targetDomain: 'UI', title: 'Module u' }),
      mutationStepE45(2, 'src/e45-b5b.ts', 'CREATE', { targetDomain: 'DATA', title: 'Module d' })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b5', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'refuse');
    assert.match(analysis.reason, /UNSUPPORTED_AGENT_CAPABILITY_DOMAIN/);
    assert.match(analysis.reason, /'DATA'/, 'la spécialité non couverte est nommée');
    assert.match(analysis.reason, /FILE_MUTATION/);
  });

  it('B6: 2 agents de la spécialité déclarée → AMBIGUOUS_AGENT_ROUTE (aucun choix arbitraire)', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b6-b1', 'BACKEND'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-b6-b2', 'BACKEND'));

    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-b6a.ts', 'CREATE', { targetDomain: 'BACKEND', title: 'Module s1' }),
      mutationStepE45(2, 'src/e45-b6b.ts', 'CREATE', { targetDomain: 'BACKEND', title: 'Module s2' })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b6', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'refuse');
    assert.match(analysis.reason, /AMBIGUOUS_AGENT_ROUTE/);
    assert.match(analysis.reason, /du domaine 'BACKEND'/);
  });

  it('B7: DOUBLON de cible (même fichier + même opération) → PLAN_STEP_DUPLICATE avant toute exécution', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b7-sole', 'ARCHITECTURE'));

    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-b7.ts', 'CREATE', { title: 'Module x' }),
      mutationStepE45(2, 'src/e45-b7.ts', 'CREATE', { title: 'Module x bis' })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b7', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'refuse');
    assert.match(analysis.reason, /PLAN_STEP_DUPLICATE/);
    assert.match(analysis.reason, /1 et 2/);
    assert.match(analysis.reason, /src\/e45-b7\.ts/);
    assert.match(analysis.reason, /CREATE/);
  });

  it('B8: opérations DIFFÉRENTES sur le même fichier → acceptées (2 spécialités distinctes désignées)', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b8-ui', 'UI'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-b8-backend', 'BACKEND'));

    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-b8.ts', 'CREATE', { targetDomain: 'UI', title: 'Coquille' }),
      mutationStepE45(2, 'src/e45-b8.ts', 'MODIFY', { targetDomain: 'BACKEND', title: 'Branchement' })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b8', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'batch', 'CREATE puis MODIFY sur le même fichier = 2 travaux distincts');
    assert.equal(analysis.specs.length, 2);
    assert.equal(analysis.specs[0]!.agentId, 'agent-e45-b8-ui');
    assert.equal(analysis.specs[1]!.agentId, 'agent-e45-b8-backend');
  });

  it('B9: requiredCapabilities DÉCLARÉES honorées (union avec FILE_MUTATION, dédupliquée, ordre préservé)', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b9-sole', 'ARCHITECTURE'));

    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-b9a.ts', 'CREATE', {
        requiredCapabilities: ['FILE_MUTATION', 'SERVICE_LOGIC']
      }),
      mutationStepE45(2, 'src/e45-b9b.ts', 'CREATE', {
        requiredCapabilities: ['FILE_MUTATION', 'SERVICE_LOGIC'],
        dependsOn: [1]
      })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b9', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'batch');
    for (const spec of analysis.specs) {
      assert.deepEqual(
        [...spec.task.requiredCapabilities],
        ['FILE_MUTATION', 'SERVICE_LOGIC'],
        'la déclaration É40 est transmise au scheduler (capacité manquante → refus explicite, jamais une exécution approximative)'
      );
    }
  });

  it('B10: targetDomain MÉTIER (dom_*) ne franchit jamais la gate — les mots-clés du TRAVAIL décident', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b10-ui', 'UI'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-b10-data', 'DATA'));

    // Forme EXACTE des plans générés en production (É40/É44) : targetDomain =
    // domaine métier ('dom_*'), la spécialité se lit dans le fichier cible.
    const plan = makePlanE45([
      mutationStepE45(1, 'src/db/e45-b10.schema.ts', 'CREATE', { targetDomain: 'dom_billing' }),
      mutationStepE45(2, 'src/components/e45-b10.tsx', 'CREATE', { targetDomain: 'dom_analytics' })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b10', tenantId: 't', projectId: 'p' },
      registry
    });

    assert.ok(analysis.kind === 'batch');
    assert.equal(analysis.specs[0]!.agentId, 'agent-e45-b10-data', '«schema» → spécialité DATA');
    assert.equal(analysis.specs[0]!.task.domain, 'DATA');
    assert.equal(analysis.specs[1]!.agentId, 'agent-e45-b10-ui', '«components» → spécialité UI');
    assert.equal(analysis.specs[1]!.task.domain, 'UI');
  });

  it('B11: DAG multi-spécialités → le contexte É44 est porté par CHAQUE tâche', () => {
    registry.register(makeSpecialistE45([], [], 'agent-e45-b11-ui', 'UI'));
    registry.register(makeSpecialistE45([], [], 'agent-e45-b11-backend', 'BACKEND'));

    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-b11a.tsx', 'CREATE', { targetDomain: 'UI', title: 'Module u' }),
      mutationStepE45(2, 'src/e45-b11b.ts', 'CREATE', { targetDomain: 'BACKEND', title: 'Module s' })
    ]);

    const analysis = analyzePlanForBatch({
      plan,
      session: { sessionId: 's-b11', tenantId: 't', projectId: 'p' },
      registry,
      conversation: {
        constraints: ['Extracted constraint: Ne jamais stocker de données bancaires'],
        decisions: ['D1'],
        assumptions: []
      }
    });

    assert.ok(analysis.kind === 'batch');
    for (const spec of analysis.specs) {
      assert.ok(spec.task.description.includes('Contexte conversationnel à respecter'), 'bloc présent');
      assert.ok(
        spec.task.description.includes('«Extracted constraint: Ne jamais stocker de données bancaires»'),
        `l'interdiction est transmise telle quelle à ${spec.taskId}`
      );
      assert.ok(spec.task.description.includes('«D1»'));
    }
  });
});

// ===========================================================================
// SECTION C — chaîne RÉELLE (wiring identique à apps/api/src/server.ts)
// ===========================================================================

describe('É45 — intégration chaîne réelle : sélection multi-spécialités sur le pipeline É37→É36', () => {
  let fileSource: InMemoryMutableFileSource;
  let orchestrator: AIOrchestratorService;
  let svc: ConversationIntelligenceService;
  let registry: AgentRegistryService;
  let journal: JournalEvent[];
  let captures: CaptureRecord[];
  let runSeq = 0;
  const tenantId = 'tenant-e45-int';
  let projectId: string;

  function buildStack(): { fileSource: InMemoryMutableFileSource; orchestrator: AIOrchestratorService } {
    const stackFileSource = new InMemoryMutableFileSource({});
    const codeIntel = new CodeIntelligenceService(stackFileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, stackFileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(stackFileSource, codeIntel, dna, graph, impact);
    const stackOrchestrator = new AIOrchestratorService(
      undefined,
      undefined,
      mutationOrchestrator,
      undefined,
      undefined,
      undefined,
      undefined,
      stackFileSource
    );
    return { fileSource: stackFileSource, orchestrator: stackOrchestrator };
  }

  beforeEach(() => {
    runSeq += 1;
    projectId = `proj-e45-int-${runSeq}`;
    journal = [];
    captures = [];
    const stack = buildStack();
    fileSource = stack.fileSource;
    orchestrator = stack.orchestrator;
    registry = orchestrator.getExecutionAgentRegistry();
    registry.unregister(REFERENCE_AGENT_ID);
    registry.register(makeSpecialistE45(journal, captures, 'agent-e45-ui', 'UI'));
    registry.register(makeSpecialistE45(journal, captures, 'agent-e45-backend', 'BACKEND'));
    registry.register(makeSpecialistE45(journal, captures, 'agent-e45-data', 'DATA'));
    registry.register(makeSpecialistE45(journal, captures, 'agent-e45-security', 'SECURITY'));
    registry.register(makeSpecialistE45(journal, captures, 'agent-e45-test', 'TEST'));

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
        reason: 'décision explicite (test É45)'
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

  it('C1 (S6): fonctionnalité complète → 4 spécialités désignées, UNE par domaine du travail, même vague', async () => {
    const session = await conversationWith({
      turns: [
        'Crée le composant src/components/e45-c1.tsx, le service src/api/e45-c1.service.ts, le schema src/db/e45-c1.schema.ts et le test src/tests/e45-c1.spec.ts'
      ]
    });

    const res = await confirmAndExecute(session);

    assert.equal(res.success, true, res.message);
    assert.equal(captures.length, 4, 'ANALYZE (1) et VERIFY (6) ne deviennent jamais des tâches');
    assert.deepEqual(
      captures.map((c) => c.taskId).sort(),
      ['step-2', 'step-3', 'step-4', 'step-5']
    );
    assert.equal(new Set(captures.map((c) => c.agentId)).size, 4, '4 agents DISTINCTS (aucun agent multi-rôles)');
    const byFile = (needle: string): CaptureRecord => captures.find((c) => c.targetFiles[0]!.includes(needle))!;
    assert.equal(byFile('components').agentDomain, 'UI');
    assert.equal(byFile('api').agentDomain, 'BACKEND');
    assert.equal(byFile('db').agentDomain, 'DATA');
    assert.equal(byFile('spec').agentDomain, 'TEST');
    assert.ok(
      captures.every((c) => c.requiredCapabilities.includes('FILE_MUTATION')),
      'chaque tâche exige FILE_MUTATION'
    );
    // Aucune dépendance déclarée entre fichiers → les 4 tâches partagent la
    // même vague (parallélisme réel du scheduler É37).
    for (const pair of [['step-2', 'step-3'], ['step-2', 'step-4'], ['step-2', 'step-5'], ['step-3', 'step-4'], ['step-3', 'step-5'], ['step-4', 'step-5']] as const) {
      assert.ok(tasksOverlap(journal, pair[0], pair[1]), `${pair[0]} et ${pair[1]} exécutés en parallèle`);
    }
    assert.match(res.message ?? '', /4\/4/);
    assert.match(
      res.message ?? '',
      /agents: agent-e45-ui, agent-e45-backend, agent-e45-data, agent-e45-test/,
      'le résultat nomme TOUS les agents réellement exécutés (traçabilité)'
    );
  });

  it('C1b (S1): question → AUCUN agent activé ; demande simple → EXACTEMENT un agent (le bon)', async () => {
    let session = svc.createSession({ tenantId, projectId });
    session = (await svc.processTurn({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      message: 'Qu est-ce que le composant src/components/e45-c1b.tsx ?'
    })).session;
    assert.equal(session.activeIntent?.category, 'QUESTION');
    assert.equal(captures.length, 0, 'une question n active JAMAIS un agent');

    session = (await svc.processTurn({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      message: 'Crée le composant src/components/e45-c1b.tsx'
    })).session;
    const res = await confirmAndExecute(session);

    assert.equal(res.success, true, res.message);
    assert.equal(captures.length, 1, 'une demande simple → exactement une exécution');
    assert.equal(captures[0]!.agentDomain, 'UI');
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e45-c1b.tsx'), 'fichier réellement écrit');

    // S2 — modification front-end : le fichier EXISTE désormais, la demande
    // MODIFY est routée vers la MÊME spécialité UI et réussit (un UPDATE sur
    // un fichier inexistant échoue honnêtement en précondition).
    session = (await svc.processTurn({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      message: 'Corrige le composant src/components/e45-c1b.tsx'
    })).session;
    const resModify = await confirmAndExecute(session);
    assert.equal(resModify.success, true, resModify.message);
    assert.equal(captures.length, 2);
    assert.equal(captures[1]!.agentDomain, 'UI', 'la modification front-end est routée vers la spécialité UI');
    assert.ok(captures[1]!.description.includes('Corrige le composant'), 'la demande active est transmise');
  });

  it('C2 (S9): agents inutiles JAMAIS activés (UI + BACKEND demandés, DATA/SECURITY/TEST silencieux)', async () => {
    const session = await conversationWith({
      turns: ['Crée le composant src/components/e45-c2.tsx et le service src/api/e45-c2.service.ts']
    });

    const res = await confirmAndExecute(session);

    assert.equal(res.success, true, res.message);
    assert.equal(captures.length, 2);
    assert.deepEqual(
      Array.from(new Set(captures.map((c) => c.agentDomain))).sort(),
      ['BACKEND', 'UI'],
      'aucune exécution superflue'
    );
  });

  it('C3 (S7): dépendances déclarées → ordre séquentiel strict entre 2 spécialités, fichiers écrits', async () => {
    const session = svc.createSession({ tenantId, projectId });
    const plan = makePlanE45([
      mutationStepE45(1, 'src/db/e45-c3.schema.ts', 'CREATE', { targetDomain: 'DATA' }),
      mutationStepE45(2, 'src/services/e45-c3.service.ts', 'CREATE', { targetDomain: 'BACKEND', dependsOn: [1] })
    ]);
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage: 'Crée src/db/e45-c3.schema.ts puis src/services/e45-c3.service.ts',
      intent: makeIntentE45('CREATE', 'créer le service dépendant du schema'),
      plan
    });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });

    assert.equal(result.executionResult.success, true, result.executionResult.message);
    assert.deepEqual(captures.map((c) => c.taskId), ['step-1', 'step-2'], 'ordre des dépendances respecté');
    assert.deepEqual(captures.map((c) => c.agentDomain), ['DATA', 'BACKEND']);
    assert.ok(strictlyAfter(journal, 'step-1', 'step-2'), 'la dépendante démarre APRÈS la fin réelle de la première');
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/db/e45-c3.schema.ts'));
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/services/e45-c3.service.ts'));
  });

  it('C4 (S8): tâches indépendantes → MÊME vague (parallélisme réel du scheduler É37)', async () => {
    const session = svc.createSession({ tenantId, projectId });
    const plan = makePlanE45([
      mutationStepE45(1, 'src/components/e45-c4a.tsx', 'CREATE', { targetDomain: 'UI' }),
      mutationStepE45(2, 'src/components/e45-c4b.tsx', 'CREATE', { targetDomain: 'UI' })
    ]);
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage: 'Crée src/components/e45-c4a.tsx et src/components/e45-c4b.tsx',
      intent: makeIntentE45('CREATE', 'header et footer indépendants'),
      plan
    });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });

    assert.equal(result.executionResult.success, true, result.executionResult.message);
    assert.equal(captures.length, 2);
    assert.ok(captures.every((c) => c.agentDomain === 'UI'));
    assert.ok(tasksOverlap(journal, 'step-1', 'step-2'), '2 tâches indépendantes → même vague');
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e45-c4a.tsx'));
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e45-c4b.tsx'));
  });

  it('C5 (S11): même cible, 2 spécialités → séquencées par le scheduler, JAMAIS parallèles, 2/2', async () => {
    const session = svc.createSession({ tenantId, projectId });
    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-c5.ts', 'CREATE', { targetDomain: 'UI', title: 'Coquille' }),
      mutationStepE45(2, 'src/e45-c5.ts', 'MODIFY', { targetDomain: 'BACKEND', title: 'Branchement' })
    ]);
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage: 'Crée src/e45-c5.ts puis branche le service',
      intent: makeIntentE45('CREATE', 'app partagée entre 2 spécialités'),
      plan
    });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });

    assert.equal(result.executionResult.success, true, result.executionResult.message);
    assert.match(result.executionResult.message ?? '', /2\/2/);
    assert.deepEqual(captures.map((c) => c.taskId), ['step-1', 'step-2']);
    assert.deepEqual(Array.from(new Set(captures.map((c) => c.agentDomain))).sort(), ['BACKEND', 'UI']);
    assert.ok(
      strictlyAfter(journal, 'step-1', 'step-2'),
      'cibles qui s intersectent → jamais dans la même vague (règle É37)'
    );
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/e45-c5.ts'), 'la cible commune est écrite (2/2)');
  });

  it('C6 (S11b): DOUBLON de cible → PLAN_STEP_DUPLICATE avant toute exécution (0 agent, 0 écriture)', async () => {
    const session = svc.createSession({ tenantId, projectId });
    const plan = makePlanE45([
      mutationStepE45(1, 'src/e45-c6.ts', 'CREATE', { title: 'Module x' }),
      mutationStepE45(2, 'src/e45-c6.ts', 'CREATE', { title: 'Module x bis' })
    ]);
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage: 'Crée src/e45-c6.ts (deux fois)',
      intent: makeIntentE45('CREATE', 'doublon de cible'),
      plan
    });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });

    assert.equal(result.executionResult.success, false, 'le DAG redondant est refusé');
    assert.match(result.executionResult.error ?? '', /PLAN_STEP_DUPLICATE/);
    assert.match(result.executionResult.message ?? '', /refusé avant toute exécution/);
    assert.equal(captures.length, 0, 'AUCUN agent exécuté (plus jamais un échec auto-infligé)');
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/e45-c6.ts'), null, 'aucune écriture');
  });

  it('C7 (S12): échec injecté → la dépendante est BLOCKED, JAMAIS exécutée', async () => {
    registry.unregister('agent-e45-backend');
    registry.register(
      makeSpecialistE45(journal, captures, 'agent-e45-backend', 'BACKEND', {
        failFor: new Set(['src/api/e45-c7.service.ts'])
      })
    );

    const session = svc.createSession({ tenantId, projectId });
    const plan = makePlanE45([
      mutationStepE45(1, 'src/api/e45-c7.service.ts', 'CREATE', { targetDomain: 'BACKEND' }),
      mutationStepE45(2, 'src/db/e45-c7.schema.ts', 'CREATE', { targetDomain: 'DATA', dependsOn: [1] })
    ]);
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage: 'Crée src/api/e45-c7.service.ts puis src/db/e45-c7.schema.ts',
      intent: makeIntentE45('CREATE', 'échec injecté sur la première étape'),
      plan
    });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
    const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });

    assert.equal(result.executionResult.success, false);
    assert.match(result.executionResult.message ?? '', /step-1=FAILED/);
    assert.match(result.executionResult.message ?? '', /step-2=BLOCKED/, 'la dépendante est bloquée, pas exécutée');
    assert.deepEqual(captures.map((c) => c.taskId), ['step-1'], 'la dépendante ne démarre jamais');
    assert.equal(captures[0]!.agentDomain, 'BACKEND');
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/db/e45-c7.schema.ts'), null);
  });

  it('C8 (S14): MÊME contrainte + interdit + décision transmis à CHAQUE spécialité du DAG', async () => {
    const session = await conversationWith({
      turns: [
        'Crée un site vitrine',
        'Utilise uniquement des couleurs sobres',
        'Ne jamais stocker de données bancaires',
        'Crée le composant src/components/e45-c8.tsx et le schema src/db/e45-c8.schema.ts'
      ],
      decision: 'Le catalogue est organisé par catégories'
    });

    const res = await confirmAndExecute(session);

    assert.equal(res.success, true, res.message);
    assert.equal(captures.length, 2);
    assert.deepEqual(
      Array.from(new Set(captures.map((c) => c.agentDomain))).sort(),
      ['DATA', 'UI'],
      'le contexte («données bancaires») n influence JAMAIS la sélection : le TRAVAIL décide'
    );
    for (const capture of captures) {
      assert.ok(capture.description.includes('«Extracted constraint: Utilise uniquement des couleurs sobres»'));
      assert.ok(
        capture.description.includes('«Extracted constraint: Ne jamais stocker de données bancaires»'),
        `l'interdiction est transmise telle quelle à ${capture.taskId}`
      );
      assert.ok(capture.description.includes('«Le catalogue est organisé par catégories»'));
    }
  });

  it('C9 (S15): deux projets distincts → AUCUN mélange de contexte ni de spécialité', async () => {
    const sessA = await conversationWith({
      turns: [
        'Crée un site vitrine',
        'Utilise uniquement des couleurs sobres',
        'Crée le composant src/components/e45-c9a.tsx'
      ]
    });
    await svc.confirmPlan({
      tenantId,
      projectId,
      sessionId: sessA.sessionId,
      planId: sessA.activePlan!.planId,
      approved: true
    });

    let sessB = svc.createSession({ tenantId, projectId: `${projectId}-b` });
    sessB = (await svc.processTurn({
      tenantId,
      projectId: `${projectId}-b`,
      sessionId: sessB.sessionId,
      message: 'Crée le service src/api/e45-c9b.service.ts'
    })).session;
    await svc.confirmPlan({
      tenantId,
      projectId: `${projectId}-b`,
      sessionId: sessB.sessionId,
      planId: sessB.activePlan!.planId,
      approved: true
    });

    const resA = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: sessA.sessionId });
    assert.equal(resA.executionResult.success, true, resA.executionResult.message);
    const capturesA = captures.slice();
    captures.length = 0;

    const resB = await svc.executeApprovedPlan({ tenantId, projectId: `${projectId}-b`, sessionId: sessB.sessionId });
    assert.equal(resB.executionResult.success, true, resB.executionResult.message);
    const capturesB = captures.slice();

    assert.equal(capturesA.length, 1);
    assert.equal(capturesA[0]!.agentDomain, 'UI');
    assert.ok(capturesA[0]!.description.includes('couleurs sobres'), 'le projet A reçoit SA contrainte');
    assert.equal(capturesB.length, 1);
    assert.equal(capturesB[0]!.agentDomain, 'BACKEND');
    assert.ok(
      capturesB[0]!.description.includes('src/api/e45-c9b.service.ts') &&
        !capturesB[0]!.description.includes('couleurs sobres') &&
        !capturesB[0]!.description.includes('vitrine'),
      'le projet B ne reçoit AUCUN élément du projet A'
    );
  });

  it('C10 (S16): registry de PRODUCTION par défaut → routage historique reference-agent inchangé', async () => {
    // Montage SANS désenregistrement : les 7 agents de production (seul
    // reference-agent possède FILE_MUTATION).
    const prodStack = buildStack();
    const prodSvc = new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
    prodSvc.attachAgentExecutor({
      execute: (request) => prodStack.orchestrator.executeAgent(request),
      getRegistry: () => prodStack.orchestrator.getExecutionAgentRegistry(),
      executeBatch: (request) => prodStack.orchestrator.executeBatch(request)
    });
    installCaptureProvider();

    let session = prodSvc.createSession({ tenantId, projectId: `${projectId}-default` });
    session = (await prodSvc.processTurn({
      tenantId,
      projectId: `${projectId}-default`,
      sessionId: session.sessionId,
      message: 'Crée le fichier src/e45-c10.ts'
    })).session;
    await prodSvc.confirmPlan({
      tenantId,
      projectId: `${projectId}-default`,
      sessionId: session.sessionId,
      planId: session.activePlan!.planId,
      approved: true
    });
    const result = await prodSvc.executeApprovedPlan({
      tenantId,
      projectId: `${projectId}-default`,
      sessionId: session.sessionId
    });

    assert.equal(result.executionResult.success, true, result.executionResult.message);
    assert.match(result.executionResult.message ?? '', /reference-agent/, 'le résultat nomme l agent réellement exécuté');
    assert.ok(
      prodStack.fileSource.getFile(tenantId, `${projectId}-default`, 'src/e45-c10.ts'),
      'fichier réellement écrit via le pipeline de mutation sécurisé'
    );
  });
});

// ---------------------------------------------------------------------------
// Provider de capture (pour les agents PROD-LIKE sans surcharge — C10)
// ---------------------------------------------------------------------------

function installCaptureProvider(): void {
  if (aiProviderRegistry.list().some((descriptor) => descriptor.providerId === 'e45-capture')) return;
  aiProviderRegistry.register({
    descriptor: {
      providerId: 'e45-capture',
      providerName: 'É45 Prompt Capture',
      models: ['e45-capture-model'],
      capabilities: ['FAST', 'CODE_GENERATION', 'FAST_CONVERSATION', 'DEEP_REASONING'] as never[],
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
      return {
        text: '// e45-capture : contenu produit pour la tâche\n',
        providerId: 'e45-capture',
        modelId: 'e45-capture-model',
        latencyMs: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        costUsd: 0
      };
    }
  });
}
