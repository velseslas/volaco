/**
 * É39 — Execution Bridge → MultiAgentScheduler (contrat executeBatch)
 *
 * Tests unitaires : le VRAI ExecutionBridge avec un exécuteur factice
 * (contrat É39 avec/sans executeBatch) et un VRAI AgentRegistryService.
 * Tests d'intégration : la chaîne RÉELLE ConversationIntelligenceService →
 * ExecutionBridge → analyzePlanForBatch → AIOrchestratorService.executeBatch
 * (MultiAgentScheduler É37 — MÊME instance que server.ts) →
 * AgentExecutionService (É32→É36) → MutationBridge →
 * MutationOrchestratorService → FileSource.
 *
 * Garanties vérifiées : routage, DAG exact, dépendance respectée, agent
 * introuvable/incompatible, plan ambigu/incomplet refusé, PARTIAL jamais
 * présenté comme un succès complet, annulation/échec remontés, isolation
 * tenant/projet. Aucun agent.executeTask() direct : les tests d'intégration
 * prouvent que les tâches ne sont exécutées QUE via les vagues du scheduler
 * (taskIds `step-N`, séquencement des vagues, écritures via le pipeline de
 * mutation sécurisé uniquement).
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
  MutationBridge,
  AgentRegistryService,
  AIOrchestratorService,
  BaseSpecializedAgent,
  REFERENCE_AGENT_ID,
  ConversationIntelligenceService,
  ExecutionBridge,
  analyzePlanForBatch,
  computeEngineeringPlanHash,
  ValidationError,
  type AgentTask,
  type AgentResult,
  type AgentArtifact,
  type AgentExecutionOutcome,
  type MultiAgentSchedulerOutcome,
  type MultiAgentSchedulerRequest,
  type MultiAgentTaskRecord,
  type TaskContextPayload,
  type Role,
  type EngineeringPlan,
  type PlanStep,
  type IntentResult,
  type ConversationSession,
  type ConversationAgentExecutor,
  type ExecutionResult
} from '../../../src/index.js';

// ===========================================================================
// Helpers partagés
// ===========================================================================

let planSeq = 0;
let sessSeq = 0;
const TENANT = 'tenant-e39';
const PROJECT = 'proj-e39';

function makePlan(steps: readonly PlanStep[]): EngineeringPlan {
  planSeq += 1;
  const partial = {
    planId: `plan-e39-${planSeq}`,
    title: 'Plan É39',
    summary: `Plan de test É39 (${steps.length} étape(s))`,
    steps,
    status: 'APPROVED' as const
  };
  return { ...partial, planHash: computeEngineeringPlanHash(partial) };
}

function makeIntent(category: 'CREATE' | 'MODIFY' | 'DELETE', goal: string): IntentResult {
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

/** Session minimale (pattern établi Section J) — seuls les champs réellement
 * lus par executePlan sont peuplés honnêtement. */
function makeSession(
  params: {
    sessionId?: string;
    tenantId?: string;
    projectId?: string;
    activeIntent?: IntentResult | undefined;
    userMessage?: string | undefined;
  } = {}
): ConversationSession {
  sessSeq += 1;
  const sessionId = params.sessionId ?? `sess-e39-${sessSeq}`;
  const intent = params.activeIntent;
  const turns =
    params.userMessage === undefined || intent === undefined
      ? []
      : [
          {
            turnIndex: 1,
            turnId: `turn-${sessionId}-1`,
            userMessage: { id: 'msg-u1', sender: 'HUMAN', content: params.userMessage, timestamp: new Date().toISOString() },
            stateBefore: 'EXPLORING',
            stateAfter: 'WAITING_CONFIRMATION',
            intent,
            assumptions: [],
            decisions: [],
            agentResponse: { id: 'msg-a1', sender: 'AGENT', content: 'plan', timestamp: new Date().toISOString() },
            trace: {
              traceId: `tr-${sessionId}`,
              sessionId,
              turnId: `turn-${sessionId}-1`,
              stateBefore: 'EXPLORING',
              stateAfter: 'WAITING_CONFIRMATION',
              intentCategory: intent.category,
              contextHash: 'c',
              applicationHash: 'a',
              actionTaken: 'plan',
              confidence: intent.confidence,
              events: [],
              durationMs: 0
            }
          }
        ];
  return {
    sessionId,
    conversationId: `conv-${sessionId}`,
    tenantId: params.tenantId ?? TENANT,
    projectId: params.projectId ?? PROJECT,
    currentState: 'WAITING_CONFIRMATION',
    turns,
    activeIntent: intent,
    activeAssumptions: [],
    activeDecisions: [],
    applicationSnapshot: { treeHash: 't', graphHash: 'g', understandingHash: 'u' },
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
  } as unknown as ConversationSession;
}

const analyzeStep = (index: number): PlanStep => ({
  stepIndex: index,
  title: 'Analyse',
  description: 'Analyser la structure',
  operation: 'ANALYZE',
  requiresApproval: false
});

const mutationStep = (
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

const verifyStep = (index: number): PlanStep => ({
  stepIndex: index,
  title: 'Vérifier',
  description: 'Vérifier zéro régression',
  operation: 'VERIFY',
  requiresApproval: false
});

/** Plan multi-mutations de référence : 2 CREATE (la 2ᵉ dépend de la 1ʳᵉ) + VERIFY. */
const multiMutationPlan = (): EngineeringPlan =>
  makePlan([
    mutationStep(1, 'src/e39-a.ts'),
    mutationStep(2, 'src/e39-b.ts', 'CREATE', [1]),
    verifyStep(3)
  ]);

// --- Agents de test --------------------------------------------------------

let stubSeq = 0;

function makeStubAgent(id: string, capabilities: readonly string[]): BaseSpecializedAgent {
  const stubId = id;
  stubSeq += 1;
  class StubAgent extends BaseSpecializedAgent {
    constructor() {
      super(
        {
          id: stubId,
          name: `Stub ${stubId}`,
          domain: 'ARCHITECTURE',
          capabilities: capabilities as never[],
          description: `agent de test É39 #${stubSeq}`,
          riskLevel: 'LOW',
          requiredProviderCapabilities: [],
          allowedTools: []
        },
        undefined
      );
    }
    public override async executeTask(params: { task: AgentTask }): Promise<AgentResult> {
      return {
        taskId: params.task.id,
        agentId: stubId,
        status: 'SUCCESS',
        degraded: false,
        artifacts: [],
        conflicts: [],
        tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 1
      };
    }
    protected buildArtifacts(): readonly [] {
      return [];
    }
  }
  return new StubAgent();
}

const RECORDER_ID = 'agent-recorder-e39';

/**
 * Agent d'intégration : produit un artefact PROPOSED_FILE_CHANGE réel (écrit
 * par le pipeline de mutation sécurisé) et journalise start/end + la présence
 * effective du fichier produit par sa dépendance (preuve d'ordre).
 *
 * NOTE É39 — le Registry gèle EN PROFONDEUR l'agent à l'enregistrement
 * (AgentRegistryService.register → deepFreeze({ ..., agent, ... }), récursif
 * sur TOUTES les propriétés d'instance) : un état mutable détenu comme
 * propriété d'instance (journal, source de fichiers, paramètres) devient
 * immuable et `.push()` sur le journal lève « Cannot add property 0, object
 * is not extensible ». L'état du recorder vit donc dans des CAPTURES
 * (closures de la fabrique, pattern identique à makeStubAgent ci-dessus) —
 * l'agent enregistré reste une instance sans propriété mutable, comme les
 * agents de production (ReferenceAgent est sans état).
 */
function makeRecordingAgent(options: {
  journal: string[];
  files: InMemoryMutableFileSource;
  tenantId: string;
  projectId: string;
  depFiles: ReadonlyMap<string, string>;
  failFor: ReadonlySet<string>;
}): BaseSpecializedAgent {
  const { journal, files, tenantId, projectId, depFiles, failFor } = options;
  class RecordingAgent extends BaseSpecializedAgent {
    constructor() {
      super(
        {
          id: RECORDER_ID,
          name: 'Recording É39',
          domain: 'ARCHITECTURE',
          capabilities: ['FILE_MUTATION'],
          description: 'agent de test É39 : artefact réel + journal + contrôle de dépendance',
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
          error: 'E39_RECORDER_NO_TARGET'
        };
      }
      journal.push(`start:${params.task.id}`);
      const depFile = depFiles.get(params.task.id);
      if (depFile) {
        const depContent = files.getFile(tenantId, projectId, depFile);
        journal.push(depContent !== null ? `dep-ok:${params.task.id}` : `dep-missing:${params.task.id}`);
      }
      journal.push(`end:${params.task.id}`);
      if (failFor.has(params.task.id)) {
        return {
          taskId: params.task.id,
          agentId: RECORDER_ID,
          status: 'FAILURE',
          artifacts: [],
          conflicts: [],
          tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 1,
          error: 'E39_SIMULATED_FAILURE'
        };
      }
      const content = `// ${RECORDER_ID} ${params.task.id}\nexport const e39 = '${params.task.id}:${targetFile}';\n`;
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
            payload: { filePath: targetFile, operation: 'CREATE', proposedContent: content, reason: 'É39 recording' },
            confidence: 1,
            hash: `hash-${RECORDER_ID}-${params.task.id}`,
            summary: 'É39'
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

// --- Exécuteurs factices (contrat É39) --------------------------------------

type ExecutorRequest = {
  executionId: string;
  agentId: string;
  task: AgentTask;
  context: TaskContextPayload;
  tenantId: string;
  projectId: string;
  userRole?: Role | undefined;
  requestId?: string | undefined;
};

type ScriptedTask = {
  status: MultiAgentTaskRecord['status'];
  outcomeStatus?: AgentExecutionOutcome['status'];
  outcomeError?: string;
  blockedReason?: string;
};

let outcomeSeq = 0;

function makeTaskOutcome(
  executionId: string,
  agentId: string,
  taskId: string,
  status: AgentExecutionOutcome['status'] = 'SUCCESS',
  error?: string,
  targetFiles?: readonly string[]
): AgentExecutionOutcome {
  outcomeSeq += 1;
  void outcomeSeq;
  const now = new Date().toISOString();
  const succeeded = status === 'SUCCESS' || status === 'DEGRADED';
  // É46 — fidélité au contrat É36 : un SUCCESS implique une mutation RÉELLEMENT
  // appliquée et vérifiée sur la source → les artifacts sont non vides (un
  // SUCCESS sans livrable est impossible dans le parcours réel, le scheduler
  // le transforme en FAILURE NO_EXPECTED_RESULT). Le fake simule désormais ce
  // contrat exactement : l'artifact porte la cible déclarée de la tâche.
  const committedArtifacts: readonly AgentArtifact[] =
    succeeded && targetFiles && targetFiles.length > 0
      ? targetFiles.map((filePath) => ({
          id: `art-fake-${taskId}-${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
          taskId,
          agentId,
          domain: 'ARCHITECTURE' as never,
          kind: 'PROPOSED_FILE_CHANGE' as const,
          targetFiles: [filePath],
          payload: {
            filePath,
            operation: 'CREATE',
            proposedContent: `// fake-e36 ${taskId} -> ${filePath}\n`,
            reason: 'É39 fake fidèle au contrat É36'
          },
          confidence: 1,
          hash: `hash-fake-${taskId}-${filePath}`
        }))
      : [];
  return {
    executionId,
    agentId,
    taskId,
    status,
    result: {
      taskId,
      agentId,
      status: succeeded ? 'SUCCESS' : 'FAILURE',
      ...(status === 'DEGRADED' ? { degraded: true } : {}),
      artifacts: committedArtifacts,
      conflicts: [],
      tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      durationMs: 1,
      ...(error !== undefined ? { error } : {})
    },
    artifacts: committedArtifacts,
    mutation: { requested: true, executed: succeeded, appliedCount: succeeded ? 1 : 0 },
    verification: { performed: succeeded, passed: succeeded, checks: [] },
    rollback: { performed: false, verified: false, restoredFiles: [] },
    cancellation: { requested: status === 'CANCELLED' },
    phases: [],
    startedAt: now,
    completedAt: now,
    durationMs: 1,
    ...(error !== undefined ? { error } : {})
  };
}

/** Verdict dérivé EXACTEMENT comme le scheduler (statuts réels → statut batch). */
function deriveBatchStatus(
  counts: { completed: number; failed: number; cancelled: number; total: number },
  cancelledObserved: boolean
): MultiAgentSchedulerOutcome['status'] {
  if (counts.failed > 0) return 'FAILED';
  if (cancelledObserved || counts.cancelled > 0) {
    return counts.completed > 0 ? 'PARTIAL' : 'CANCELLED';
  }
  if (counts.completed === counts.total) return 'COMPLETED';
  return 'PARTIAL';
}

function makeBatchOutcome(
  request: MultiAgentSchedulerRequest,
  perTask: ReadonlyMap<string, ScriptedTask>,
  cancelledObserved = false
): MultiAgentSchedulerOutcome {
  const now = new Date().toISOString();
  const tasks: MultiAgentTaskRecord[] = request.tasks.map((spec) => {
    const scripted = perTask.get(spec.taskId);
    const status = scripted?.status ?? 'COMPLETED';
    const wasExecuted = status !== 'PENDING' && status !== 'BLOCKED';
    const outcomeStatus =
      scripted?.outcomeStatus ?? (status === 'COMPLETED' ? 'SUCCESS' : 'FAILURE');
    return {
      spec,
      status,
      taskExecutionId: `${request.executionId}--${spec.taskId}`,
      ...(wasExecuted
        ? {
            outcome: makeTaskOutcome(
              `${request.executionId}--${spec.taskId}`,
              spec.agentId,
              spec.taskId,
              outcomeStatus,
              scripted?.outcomeError,
              spec.task.requiredContext.targetFiles
            )
          }
        : {}),
      ...(scripted?.blockedReason !== undefined ? { blockedReason: scripted.blockedReason } : {})
    };
  });
  const counts = {
    completed: tasks.filter((t) => t.status === 'COMPLETED').length,
    failed: tasks.filter((t) => t.status === 'FAILED').length,
    cancelled: tasks.filter((t) => t.status === 'CANCELLED').length,
    blocked: tasks.filter((t) => t.status === 'BLOCKED').length,
    pending: tasks.filter((t) => t.status === 'PENDING').length,
    total: tasks.length
  };
  return {
    executionId: request.executionId,
    status: deriveBatchStatus(counts, cancelledObserved),
    tasks,
    counts,
    phases: [],
    startedAt: now,
    completedAt: now,
    durationMs: 0
  };
}

class FakeBatchExecutor implements ConversationAgentExecutor {
  public executeRequests: ExecutorRequest[] = [];
  public batchRequests: MultiAgentSchedulerRequest[] = [];
  private responder?: ((request: MultiAgentSchedulerRequest) => MultiAgentSchedulerOutcome) | undefined;
  private failure?: Error | undefined;

  constructor(private readonly registry: AgentRegistryService) {}

  public respondWith(
    responder: (request: MultiAgentSchedulerRequest) => MultiAgentSchedulerOutcome
  ): void {
    this.responder = responder;
  }

  public failWith(error: Error): void {
    this.failure = error;
  }

  public getRegistry(): AgentRegistryService {
    return this.registry;
  }

  public async execute(request: ExecutorRequest): Promise<AgentExecutionOutcome> {
    this.executeRequests.push(request);
    return makeTaskOutcome(request.executionId, request.agentId, request.task.id, 'SUCCESS');
  }

  public async executeBatch(request: MultiAgentSchedulerRequest): Promise<MultiAgentSchedulerOutcome> {
    this.batchRequests.push(request);
    if (this.failure) throw this.failure;
    if (this.responder) return this.responder(request);
    return makeBatchOutcome(request, new Map());
  }
}

/** Exécuteur historique (contrat É33/É34) : SANS executeBatch. */
class FakeLegacyExecutor implements Omit<ConversationAgentExecutor, 'executeBatch'> {
  public executeRequests: ExecutorRequest[] = [];

  constructor(private readonly registry: AgentRegistryService) {}

  public getRegistry(): AgentRegistryService {
    return this.registry;
  }

  public async execute(request: ExecutorRequest): Promise<AgentExecutionOutcome> {
    this.executeRequests.push(request);
    return makeTaskOutcome(request.executionId, request.agentId, request.task.id, 'SUCCESS');
  }
}

// ===========================================================================
// SECTION A/B/C/D — unitaire : ExecutionBridge + exécuteur factice + registry réel
// ===========================================================================

describe('É39 — ExecutionBridge → MultiAgentScheduler (contrat executeBatch)', () => {
  let registry: AgentRegistryService;
  let fake: FakeBatchExecutor;
  let bridge: ExecutionBridge;

  beforeEach(() => {
    registry = new AgentRegistryService();
    registry.register(makeStubAgent('ref-e39', ['FILE_MUTATION']));
    fake = new FakeBatchExecutor(registry);
    bridge = new ExecutionBridge();
    bridge.setAgentExecutor(fake);
  });

  it('A1: plan à 1 étape de mutation → routage historique inchangé (executeBatch jamais appelé)', async () => {
    const plan = makePlan([analyzeStep(1), mutationStep(2, 'src/unique.ts', 'MODIFY'), verifyStep(3)]);
    const session = makeSession({
      activeIntent: makeIntent('MODIFY', 'modifier src/unique.ts'),
      userMessage: 'Modifie le fichier src/unique.ts'
    });

    const res = await bridge.executePlan(plan, session, 'OWNER', 'req-A1');

    assert.equal(fake.batchRequests.length, 0, 'aucun batch pour un plan mono-mutation');
    assert.equal(fake.executeRequests.length, 1);
    assert.equal(res.success, true);
    assert.equal(res.executedSteps, 1);
    assert.match(res.message, /ref-e39/);
    assert.match(res.message, /agx-/);
  });

  it('A2: plan à ≥2 mutations → executeBatch appelé avec le DAG exact (ids, deps, ordre, isolation)', async () => {
    const plan = multiMutationPlan();
    const session = makeSession();

    const res = await bridge.executePlan(plan, session, 'ENGINEER', 'req-A2');

    assert.equal(fake.executeRequests.length, 0, 'aucun appel mono-agent pour un plan multi-mutations');
    assert.equal(fake.batchRequests.length, 1);
    const request = fake.batchRequests[0]!;
    assert.equal(request.executionId, `agxb-${session.sessionId}-${plan.planId}`);
    assert.equal(request.tenantId, TENANT);
    assert.equal(request.projectId, PROJECT);
    assert.equal(request.userRole, 'ENGINEER');
    assert.equal(request.requestId, 'req-A2');
    // Rien d'inventé : pas de signal, pas de maxConcurrency, pas de repairPolicy.
    assert.equal(request.signal, undefined);
    assert.equal(request.maxConcurrency, undefined);
    assert.equal(request.repairPolicy, undefined);

    assert.equal(request.tasks.length, 2, 'seules les étapes de mutation deviennent des tâches');
    const [spec1, spec2] = request.tasks;
    assert.ok(spec1 && spec2);
    assert.equal(spec1.taskId, 'step-1');
    assert.equal(spec1.agentId, 'ref-e39');
    assert.equal(spec1.order, 1);
    assert.deepEqual([...spec1.dependencies], []);
    assert.equal(spec1.task.id, 'step-1');
    assert.equal(spec1.task.operation, 'CREATE');
    assert.equal(spec1.task.status, 'READY');
    assert.equal(spec1.task.priority, 1);
    assert.equal(spec1.task.retryCount, 0);
    assert.equal(spec1.task.maxRetries, 0);
    assert.deepEqual([...spec1.task.requiredCapabilities], ['FILE_MUTATION']);
    assert.deepEqual([...(spec1.task.requiredContext.targetFiles ?? [])], ['src/e39-a.ts']);
    assert.equal(spec1.task.domain, 'ARCHITECTURE');
    assert.equal(spec2.taskId, 'step-2');
    assert.deepEqual([...spec2.dependencies], ['step-1'], 'dépendance déclarée conservée, mappée en step-N');
    assert.equal(spec2.order, 2);
    assert.deepEqual([...(spec2.task.requiredContext.targetFiles ?? [])], ['src/e39-b.ts']);
    assert.ok(
      request.tasks.every((t) => t.task.operation !== 'ANALYZE' && t.task.operation !== 'VERIFY'),
      'ANALYZE/VERIFY ne deviennent jamais des tâches'
    );

    assert.equal(res.success, true);
    assert.equal(res.executedSteps, 2);
    assert.match(res.message, /agxb-/);
    assert.match(res.message, /2\/2/);
    assert.match(res.message, /step-1=COMPLETED, step-2=COMPLETED/);
    assert.match(res.message, /Étapes 3 \(1\) jamais envoyées à un agent/);
  });

  it('A2b: dépendances transitives conservées telles quelles, ordre déterministe (stepIndex croissant)', async () => {
    // Étapes déclarées en désordre : l'ordre des specs doit rester déterministe.
    const plan = makePlan([
      mutationStep(3, 'src/c.ts', 'CREATE', [2]),
      mutationStep(1, 'src/a.ts'),
      mutationStep(2, 'src/b.ts', 'CREATE', [1]),
      verifyStep(4)
    ]);

    const res = await bridge.executePlan(plan, makeSession());

    const request = fake.batchRequests[0]!;
    assert.deepEqual(
      request.tasks.map((t) => t.taskId),
      ['step-1', 'step-2', 'step-3'],
      'ordre déterministe (stepIndex croissant)'
    );
    assert.deepEqual(
      request.tasks.map((t) => [...t.dependencies]),
      [[], ['step-1'], ['step-2']],
      'dépendances déclarées uniquement (aucune fabriquée)'
    );
    assert.equal(res.success, true);
    assert.equal(res.executedSteps, 3);
    assert.match(res.message, /3\/3/);
    assert.match(res.message, /Étapes 4 \(1\) jamais envoyées/);
  });

  it('A3: verdict PARTIAL → JAMAIS présenté comme un succès complet', async () => {
    fake.respondWith((request) =>
      makeBatchOutcome(
        request,
        new Map([['step-2', { status: 'PENDING', blockedReason: 'arrêt après échec (fail-fast)' }]])
      )
    );

    const res = await bridge.executePlan(multiMutationPlan(), makeSession());

    assert.equal(res.success, false, 'PARTIAL n est pas un succès');
    assert.equal(res.executedSteps, 1, 'seules les tâches réellement complétées comptent');
    assert.equal(res.error, 'SCHEDULER_PARTIAL');
    assert.match(res.message, /statut PARTIAL/);
    assert.match(res.message, /1\/2/);
    assert.match(res.message, /step-2=PENDING/);
  });

  it('A4: verdict FAILED → échec remonté avec détails réels', async () => {
    fake.respondWith((request) =>
      makeBatchOutcome(
        request,
        new Map([
          ['step-2', { status: 'FAILED', outcomeStatus: 'FAILURE', outcomeError: 'E39_SIMULATED_FAILURE' }]
        ])
      )
    );

    const res = await bridge.executePlan(multiMutationPlan(), makeSession());

    assert.equal(res.success, false);
    assert.equal(res.executedSteps, 1);
    assert.equal(res.error, 'SCHEDULER_FAILED');
    assert.match(res.message, /statut FAILED/);
    assert.match(res.message, /step-2=FAILED \(E39_SIMULATED_FAILURE\)/);
  });

  it('A5: verdict CANCELLED → annulation remontée honnêtement (aucune tâche complétée)', async () => {
    fake.respondWith((request) =>
      makeBatchOutcome(
        request,
        new Map([
          ['step-1', { status: 'CANCELLED', outcomeStatus: 'CANCELLED' }],
          ['step-2', { status: 'PENDING', blockedReason: 'scheduler annulé avant démarrage' }]
        ]),
        true
      )
    );

    const res = await bridge.executePlan(multiMutationPlan(), makeSession());

    assert.equal(res.success, false);
    assert.equal(res.executedSteps, 0);
    assert.equal(res.error, 'SCHEDULER_CANCELLED');
    assert.match(res.message, /statut CANCELLED/);
  });

  it('A6: ValidationError du scheduler (DAG_INVALID) → refus explicite, aucune exécution', async () => {
    fake.failWith(new ValidationError('DAG_INVALID: cycle détecté entre [step-1, step-2] — rejet avant toute exécution'));

    const res = await bridge.executePlan(multiMutationPlan(), makeSession());

    assert.equal(res.success, false);
    assert.equal(res.executedSteps, 0);
    assert.match(res.error ?? '', /DAG_INVALID/);
    assert.match(res.message, /refusé avant toute exécution/);
    assert.equal(fake.executeRequests.length, 0);
  });

  it('A6b: AGENT_UNKNOWN du scheduler → refus explicite', async () => {
    fake.failWith(new ValidationError("AGENT_UNKNOWN: aucun agent 'agent-fantome' (tâche 'step-1')"));

    const res = await bridge.executePlan(multiMutationPlan(), makeSession());

    assert.equal(res.success, false);
    assert.equal(res.executedSteps, 0);
    assert.match(res.error ?? '', /AGENT_UNKNOWN/);
    assert.equal(fake.executeRequests.length, 0);
  });

  it('A6c: CAPABILITY_UNSUPPORTED du scheduler → refus explicite', async () => {
    fake.failWith(
      new ValidationError("CAPABILITY_UNSUPPORTED: l'agent 'ref-e39' ne possède pas [FILE_MUTATION] (tâche 'step-1')")
    );

    const res = await bridge.executePlan(multiMutationPlan(), makeSession());

    assert.equal(res.success, false);
    assert.equal(res.executedSteps, 0);
    assert.match(res.error ?? '', /CAPABILITY_UNSUPPORTED/);
    assert.equal(fake.executeRequests.length, 0);
  });

  it('A7: exécuteur SANS executeBatch + plan multi-mutations → EXECUTOR_BATCH_UNAVAILABLE (aucun fallback silencieux)', async () => {
    const legacyOnly = new FakeLegacyExecutor(registry);
    bridge.setAgentExecutor(legacyOnly);

    const res = await bridge.executePlan(multiMutationPlan(), makeSession());

    assert.equal(res.success, false);
    assert.match(res.error ?? '', /EXECUTOR_BATCH_UNAVAILABLE/);
    assert.equal(legacyOnly.executeRequests.length, 0, 'pas de réduction silencieuse à une seule tâche');
  });

  // =========================================================================
  // SECTION B — refus explicites (plan ambigu / incomplet / registry)
  // =========================================================================

  it('B1: deux étapes avec le même stepIndex → PLAN_STEP_INDEX_DUPLICATE, aucune exécution', async () => {
    const plan = makePlan([
      { stepIndex: 2, title: 'M1', description: '', targetFiles: ['src/a.ts'], operation: 'CREATE', requiresApproval: false },
      { stepIndex: 2, title: 'M2', description: '', targetFiles: ['src/b.ts'], operation: 'CREATE', requiresApproval: false }
    ]);

    const res = await bridge.executePlan(plan, makeSession());

    assert.equal(res.success, false);
    assert.match(res.error ?? '', /PLAN_STEP_INDEX_DUPLICATE/);
    assert.equal(fake.batchRequests.length, 0);
    assert.equal(fake.executeRequests.length, 0);
  });

  it('B2: dependsOn inconnue → PLAN_DEPENDENCY_UNKNOWN, aucune exécution', async () => {
    const plan = makePlan([mutationStep(1, 'src/a.ts'), mutationStep(2, 'src/b.ts', 'CREATE', [5]), verifyStep(3)]);

    const res = await bridge.executePlan(plan, makeSession());

    assert.equal(res.success, false);
    assert.match(res.error ?? '', /PLAN_DEPENDENCY_UNKNOWN/);
    assert.equal(fake.batchRequests.length, 0);
    assert.equal(fake.executeRequests.length, 0);
  });

  it('B3: dependsOn auto-référencée → PLAN_DEPENDENCY_SELF, aucune exécution', async () => {
    const plan = makePlan([mutationStep(1, 'src/a.ts'), mutationStep(2, 'src/b.ts', 'CREATE', [2]), verifyStep(3)]);

    const res = await bridge.executePlan(plan, makeSession());

    assert.equal(res.success, false);
    assert.match(res.error ?? '', /PLAN_DEPENDENCY_SELF/);
    assert.equal(fake.batchRequests.length, 0);
    assert.equal(fake.executeRequests.length, 0);
  });

  it('B4: dependsOn vers une étape non exécutable (VERIFY) → PLAN_DEPENDENCY_NON_EXECUTABLE', async () => {
    const plan = makePlan([
      mutationStep(1, 'src/a.ts'),
      mutationStep(2, 'src/b.ts', 'CREATE', [3]),
      verifyStep(3)
    ]);

    const res = await bridge.executePlan(plan, makeSession());

    assert.equal(res.success, false);
    assert.match(res.error ?? '', /PLAN_DEPENDENCY_NON_EXECUTABLE/);
    assert.equal(fake.batchRequests.length, 0);
    assert.equal(fake.executeRequests.length, 0);
  });

  it('B5: étape de mutation sans fichier cible → PLAN_STEP_INCOMPLETE, aucune exécution', async () => {
    const plan = makePlan([
      { stepIndex: 1, title: 'M', description: 'aucune cible', operation: 'CREATE', requiresApproval: false },
      mutationStep(2, 'src/b.ts'),
      verifyStep(3)
    ]);

    const res = await bridge.executePlan(plan, makeSession());

    assert.equal(res.success, false);
    assert.match(res.error ?? '', /PLAN_STEP_INCOMPLETE/);
    assert.equal(fake.batchRequests.length, 0);
    assert.equal(fake.executeRequests.length, 0);
  });

  it('B6: étape de mutation multi-fichiers → PLAN_STEP_AMBIGUOUS (pas d éclatement artificiel)', async () => {
    const plan = makePlan([
      { stepIndex: 1, title: 'M', description: 'deux cibles', targetFiles: ['src/a.ts', 'src/b.ts'], operation: 'CREATE', requiresApproval: false },
      mutationStep(2, 'src/c.ts'),
      verifyStep(3)
    ]);

    const res = await bridge.executePlan(plan, makeSession());

    assert.equal(res.success, false);
    assert.match(res.error ?? '', /PLAN_STEP_AMBIGUOUS/);
    assert.match(res.error ?? '', /src\/a\.ts/);
    assert.equal(fake.batchRequests.length, 0);
    assert.equal(fake.executeRequests.length, 0);
  });

  it('B7: aucun agent FILE_MUTATION dans le registry → UNSUPPORTED_AGENT_CAPABILITY', async () => {
    const emptyRegistry = new AgentRegistryService();
    emptyRegistry.register(makeStubAgent('no-mutation', ['SERVICE_LOGIC']));
    const fake2 = new FakeBatchExecutor(emptyRegistry);
    const bridge2 = new ExecutionBridge();
    bridge2.setAgentExecutor(fake2);

    const res = await bridge2.executePlan(multiMutationPlan(), makeSession());

    assert.equal(res.success, false);
    assert.match(res.error ?? '', /UNSUPPORTED_AGENT_CAPABILITY/);
    assert.equal(fake2.batchRequests.length, 0);
    assert.equal(fake2.executeRequests.length, 0);
  });

  it('B8: deux agents FILE_MUTATION → AMBIGUOUS_AGENT_ROUTE avec candidats listés', async () => {
    const doubleRegistry = new AgentRegistryService();
    doubleRegistry.register(makeStubAgent('ref-doub-a', ['FILE_MUTATION']));
    doubleRegistry.register(makeStubAgent('ref-doub-b', ['FILE_MUTATION']));
    const fake2 = new FakeBatchExecutor(doubleRegistry);
    const bridge2 = new ExecutionBridge();
    bridge2.setAgentExecutor(fake2);

    const res = await bridge2.executePlan(multiMutationPlan(), makeSession());

    assert.equal(res.success, false);
    assert.match(res.error ?? '', /AMBIGUOUS_AGENT_ROUTE/);
    assert.match(res.error ?? '', /ref-doub-a/);
    assert.match(res.error ?? '', /ref-doub-b/);
    assert.equal(fake2.batchRequests.length, 0);
    assert.equal(fake2.executeRequests.length, 0);
  });

  // =========================================================================
  // SECTION C — isolation tenant/projet
  // =========================================================================

  it('C: isolation — tenant/projet/rôle RÉELS de la session transmis au scheduler, cibles cloisonnées', async () => {
    const plan = multiMutationPlan();
    const session = makeSession({ tenantId: 'tenant-iso-A', projectId: 'proj-iso-A' });

    const res = await bridge.executePlan(plan, session, 'VIEWER', 'req-iso');

    assert.equal(res.success, true);
    const request = fake.batchRequests[0]!;
    assert.equal(request.tenantId, 'tenant-iso-A');
    assert.equal(request.projectId, 'proj-iso-A');
    assert.equal(request.userRole, 'VIEWER');
    assert.equal(request.requestId, 'req-iso');
    for (const spec of request.tasks) {
      assert.equal((spec.task.requiredContext.targetFiles ?? []).length, 1, 'une cible exacte par tâche');
      assert.ok(spec.agentId.length > 0);
    }
  });

  // =========================================================================
  // SECTION D — déterminisme de l'adaptateur
  // =========================================================================

  it('D: déterminisme — mêmes entrées → même analyse (batch comme refus)', () => {
    const plan = multiMutationPlan();
    const session = makeSession();

    const first = analyzePlanForBatch({ plan, session, registry });
    const second = analyzePlanForBatch({ plan, session, registry });
    assert.deepEqual(first, second);
    assert.ok(first.kind === 'batch' && first.specs.length === 2);

    const badPlan = makePlan([mutationStep(1, 'src/a.ts'), mutationStep(2, 'src/b.ts', 'CREATE', [5]), verifyStep(3)]);
    const refusal1 = analyzePlanForBatch({ plan: badPlan, session, registry });
    const refusal2 = analyzePlanForBatch({ plan: badPlan, session, registry });
    assert.ok(refusal1.kind === 'refuse' && refusal1.reason.length > 0);
    assert.deepEqual(refusal1, refusal2);
  });
});

// ===========================================================================
// SECTION I — intégration chaîne RÉELLE (MÊME wiring que apps/api/src/server.ts)
// ===========================================================================

describe('É39 — intégration chaîne réelle : Conversation → executeBatch (scheduler É37) → agents → mutations', () => {
  let fileSource: InMemoryMutableFileSource;
  let service: AIOrchestratorService;
  let svc: ConversationIntelligenceService;
  let events: string[];
  let runSeq = 0;
  const tenantId = 'tenant-e39-int';
  let projectId: string;

  function installRecorder(
    options: { depFiles?: ReadonlyMap<string, string>; failFor?: ReadonlySet<string> } = {}
  ): void {
    const registry = service.getExecutionAgentRegistry();
    registry.unregister(RECORDER_ID);
    registry.register(
      makeRecordingAgent({
        journal: events,
        files: fileSource,
        tenantId,
        projectId,
        depFiles: options.depFiles ?? new Map(),
        failFor: options.failFor ?? new Set()
      })
    );
  }

  beforeEach(() => {
    runSeq += 1;
    projectId = `proj-e39-int-${runSeq}`;
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

  async function runStagedPlan(params: {
    steps: readonly PlanStep[];
    userMessage: string;
    intent: IntentResult;
  }): Promise<{ session: ConversationSession; executionResult: ExecutionResult; plan: EngineeringPlan }> {
    const session = svc.createSession({ tenantId, projectId });
    const plan = makePlan(params.steps);
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

  it('I1: 2 mutations + dependsOn → vagues séquencées par le scheduler, fichiers réellement écrits, isolation', async () => {
    installRecorder({ depFiles: new Map([['step-2', 'src/e39-a.ts']]) });

    const exec = await runStagedPlan({
      steps: [mutationStep(1, 'src/e39-a.ts'), mutationStep(2, 'src/e39-b.ts', 'CREATE', [1]), verifyStep(3)],
      userMessage: 'Crée les modules src/e39-a.ts et src/e39-b.ts',
      intent: makeIntent('CREATE', 'créer deux modules')
    });

    assert.equal(exec.executionResult.success, true);
    assert.match(exec.executionResult.message ?? '', /agxb-/);
    assert.match(exec.executionResult.message ?? '', /step-1=COMPLETED, step-2=COMPLETED/);
    assert.match(exec.executionResult.message ?? '', /Étapes 3 \(1\) jamais envoyées à un agent/);

    // Dépendance respectée : vagues STRICTEMENT séquencées par le scheduler
    // (step-2 n'a démarré qu'après la complétion RÉELLE de step-1 — le
    // journal prouve que le fichier de la dépendance existait déjà).
    assert.deepEqual(events, ['start:step-1', 'end:step-1', 'start:step-2', 'dep-ok:step-2', 'end:step-2']);

    // Fichiers réellement écrits via le pipeline sécurisé (contenu = artefact).
    const fileA = fileSource.getFile(tenantId, projectId, 'src/e39-a.ts');
    const fileB = fileSource.getFile(tenantId, projectId, 'src/e39-b.ts');
    assert.ok(fileA && /step-1/.test(fileA.content));
    assert.ok(fileB && /step-2/.test(fileB.content));

    // Isolation tenant/projet (pattern L des tests É34).
    assert.equal(fileSource.getFile('tenant-autre', projectId, 'src/e39-a.ts'), null);
    assert.equal(fileSource.getFile(tenantId, 'proj-autre', 'src/e39-a.ts'), null);
    assert.equal(exec.session.currentState, 'VALIDATING');
  });

  it('I2: échec réel d une tâche → batch FAILED remonté, écriture uniquement pour la tâche réussie', async () => {
    installRecorder({
      failFor: new Set(['step-2']),
      depFiles: new Map([['step-2', 'src/e39-fa.ts']])
    });

    const exec = await runStagedPlan({
      steps: [mutationStep(1, 'src/e39-fa.ts'), mutationStep(2, 'src/e39-fb.ts', 'CREATE', [1]), verifyStep(3)],
      userMessage: 'Crée src/e39-fa.ts puis src/e39-fb.ts',
      intent: makeIntent('CREATE', 'créer deux modules')
    });

    assert.equal(exec.executionResult.success, false);
    assert.equal(exec.executionResult.error, 'SCHEDULER_FAILED');
    assert.equal(exec.executionResult.executedSteps, 1);
    assert.match(exec.executionResult.message ?? '', /step-2=FAILED/);
    assert.match(exec.executionResult.message ?? '', /E39_SIMULATED_FAILURE/);

    // La dépendance a été respectée PUIS la tâche a échoué (aucun fallback).
    assert.deepEqual(events, ['start:step-1', 'end:step-1', 'start:step-2', 'dep-ok:step-2', 'end:step-2']);

    assert.ok(fileSource.getFile(tenantId, projectId, 'src/e39-fa.ts'), 'la tâche réussie a bien écrit');
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/e39-fb.ts'), null, 'la tâche échouée n a rien écrit');
    assert.equal(exec.session.currentState, 'FAILED');
  });

  it('I3: plan multi-mutations incomplet (étape sans fichier cible) → refus explicite via le service réel', async () => {
    const exec = await runStagedPlan({
      steps: [
        mutationStep(1, 'src/e39-ga.ts'),
        { stepIndex: 2, title: 'Mutation sans cible', description: 'aucun fichier', operation: 'CREATE', requiresApproval: false },
        verifyStep(3)
      ],
      userMessage: 'Crée src/e39-ga.ts',
      intent: makeIntent('CREATE', 'créer')
    });

    assert.equal(exec.executionResult.success, false);
    assert.match(exec.executionResult.error ?? '', /PLAN_STEP_INCOMPLETE/);
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/e39-ga.ts'), null, 'aucune écriture avant refus');
    assert.equal(exec.session.currentState, 'FAILED');
  });

  it('I4: plan à 1 mutation → chemin historique inchangé (agx-, une seule tâche, aucun batch)', async () => {
    const exec = await runStagedPlan({
      steps: [analyzeStep(1), mutationStep(2, 'src/e39-l.ts'), verifyStep(3)],
      userMessage: 'Crée le fichier src/e39-l.ts module legacy',
      intent: makeIntent('CREATE', 'créer src/e39-l.ts')
    });

    assert.equal(exec.executionResult.success, true);
    assert.match(exec.executionResult.message ?? '', /executionId: agx-/);
    assert.match(exec.executionResult.message ?? '', /agent-recorder-e39/);
    assert.match(exec.executionResult.message ?? '', /COMMITTED/);

    // Une SEULE tâche, id dérivé du routage historique — pas de DAG, pas de
    // taskIds step-N.
    const expectedTaskId = `task-agx-${exec.session.sessionId}-${exec.plan.planId}`;
    assert.deepEqual(events, [`start:${expectedTaskId}`, `end:${expectedTaskId}`]);
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/e39-l.ts'));
  });
});