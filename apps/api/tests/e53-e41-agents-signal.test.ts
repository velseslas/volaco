/**
 * É53 LOT E4.1 — PROPAGATION DE L'ANNULATION AUX AGENTS (unitaire, sans serveur).
 *
 * Le signal du tour doit être propagé SANS DÉTOURNEMENT jusqu'aux agents :
 *   - U1  : le MÊME signal (même instance) atteint l'appel executeTask de
 *           l'agent — aucune nouvelle autorité d'annulation n'est créée ;
 *   - U2  : signal déjà armé → AUCUN appel agent (BEFORE_AGENT) ;
 *   - U3  : résultat TARDIF de l'agent (l'appel termine après l'abandon) →
 *           neutralisé : CANCELLED AFTER_AGENT, jamais appliqué ;
 *   - U4  : abandon PENDANT l'appel agent → CANCELLED 'AGENT' (jamais un
 *           échec ordinaire) ;
 *   - U5  : le vrai BaseSpecializedAgent transmet le signal jusqu'à
 *           l'adapter (identité prouvée) et rejette l'abandon (failover
 *           cassé, jamais relancé) ;
 *   - U6  : un TIMEOUT technique (sans signal) n'est JAMAIS classé
 *           CANCELLED — classification honnête (même protocole que E3) ;
 *   - U7  : scheduler É37 : les tâches PARALLÈLES reçoivent le MÊME signal ;
 *           annulées ENSEMBLE, jamais en échec ordinaire ;
 *   - U8  : maxConcurrency 1 : annulation pendant la tâche en vol →
 *           dépendant BLOCKED + indépendant PENDING (jamais démarrés) ;
 *   - U9  : signal pré-armé → AUCUN appel agent du scheduler (0 tâche
 *           démarrée, tout PENDING).
 *
 * Les tâches utilisées sont ANALYZE (jamais de mutation) : le MutationBridge
 * n'est jamais sollicité, la preuve reste la PROPAGATION DU SIGNAL elle-même.
 * L'arbitrage reste E1/E2/E3 — aucun nouvel AbortController n'est créé ici.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AgentExecutionService, NULL_FILE_OBSERVER } from '../../../packages/core/src/ai-native/ai-orchestrator/execution/agent-execution.js';
import type { AgentExecutionOutcome } from '../../../packages/core/src/ai-native/ai-orchestrator/execution/agent-execution.js';
import { AgentRegistryService } from '../../../packages/core/src/ai-native/ai-orchestrator/registry/agent-registry.js';
import { BaseSpecializedAgent } from '../../../packages/core/src/ai-native/ai-orchestrator/agents/base-agent.js';
import { MultiAgentScheduler } from '../../../packages/core/src/ai-native/ai-orchestrator/execution/multi-agent-scheduler.js';
import type { MultiAgentTaskSpec } from '../../../packages/core/src/ai-native/ai-orchestrator/execution/multi-agent-scheduler.js';
import { MutationBridge } from '../../../packages/core/src/ai-native/ai-orchestrator/engine/mutation-bridge.js';
import type {
  AgentArtifact,
  AgentResult,
  AgentTask,
  SpecializedAgentDefinition,
  TaskContextPayload
} from '../../../packages/core/src/ai-native/ai-orchestrator/types.js';
import type { AIProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import { AIProviderRegistry as ProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import type {
  AIProviderAdapter,
  AIProviderDescriptor,
  AIProviderGenerateRequest,
  AIProviderGenerateResponse
} from '../../../packages/core/src/ai/providers/types.js';

const TENANT = 'tenant-e41-u';
const PROJECT = 'proj-e41-u';

const EMPTY_CONTEXT: TaskContextPayload = {
  relevantFiles: {},
  relevantSymbols: [],
  decisions: [],
  constraints: [],
  recentHistory: []
};

function makeTask(id: string, targetFile: string): AgentTask {
  return {
    id,
    title: `Tâche ${id}`,
    description: 'Tâche ANALYZE de test E4.1 (jamais de mutation).',
    domain: 'ARCHITECTURE',
    priority: 1,
    dependencies: [],
    requiredContext: { targetFiles: [targetFile] },
    requiredCapabilities: [],
    status: 'READY',
    operation: 'ANALYZE',
    retryCount: 0,
    maxRetries: 0
  };
}

/**
 * Agent enregistreur : PROOF-OF-PROPAGATION. Chaque exécution note l'identité
 * du signal reçu (comparée à l'instance passée par le test) et peut simuler
 * trois comportements : 'none' (retour immédiat), 'late' (résultat TARDIF
 * après abandon), 'hang' (throw sur abandon pendant l'appel).
 *
 * É53 LOT E4.1 — ÉTAT HORS INSTANCE : AgentRegistryService.register() applique
 * deepFreeze(entry) qui TRAVERSE l'agent (canonical.ts) — tout état propre de
 * l'instance (tableau `seen`, resolveur de hold) serait gelé au moment du
 * register et `seen.push()` jetterait « Cannot add property 0, object is not
 * extensible ». L'état vit donc dans une Map module-level, INATTEIGNABLE depuis
 * les propriétés propres de l'agent (les Maps ne stockent rien en props
 * propres : deepFreeze ne la traverse jamais). Les accesseurs restent sur le
 * PROTOTYPE (deepFreeze ne gèle que l'instance) : les usages `agent.seen`,
 * `agent.mode`, `agent.release()` restent littéralement identiques.
 */
interface RecordingState {
  seen: Array<{ taskId: string; signal: AbortSignal | null; abortedAtStart: boolean }>;
  mode: 'none' | 'late' | 'hang';
  holdResolve: (() => void) | null;
}
const recordingStates = new Map<string, RecordingState>();
const recordingState = (id: string): RecordingState => {
  const st = recordingStates.get(id);
  if (!st) throw new Error(`RecordingAgent: aucun état pour '${id}' (constructor manquant ?)`);
  return st;
};

class RecordingAgent extends BaseSpecializedAgent {
  constructor(id: string) {
    super({
      id,
      name: `Recorder ${id}`,
      domain: 'ARCHITECTURE',
      capabilities: ['SERVICE_LOGIC'],
      description: 'Agent enregistreur E4.1 (propagation du signal).',
      riskLevel: 'LOW',
      requiredProviderCapabilities: [],
      allowedTools: []
    });
    recordingStates.set(id, { seen: [], mode: 'none', holdResolve: null });
  }

  // Accesseurs prototype : l'état réel vit dans la Map (hors gel).
  public get seen(): RecordingState['seen'] {
    return recordingState(this.definition.id).seen;
  }
  public get mode(): RecordingState['mode'] {
    return recordingState(this.definition.id).mode;
  }
  public set mode(value: RecordingState['mode']) {
    recordingState(this.definition.id).mode = value;
  }

  public release(): void {
    const st = recordingState(this.definition.id);
    const r = st.holdResolve;
    st.holdResolve = null;
    r?.();
  }

  public override async executeTask(params: {
    task: AgentTask;
    context: TaskContextPayload;
    tenantId: string;
    projectId: string;
    requestId?: string | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<AgentResult> {
    const st = recordingState(this.definition.id);
    st.seen.push({
      taskId: params.task.id,
      signal: params.signal ?? null,
      abortedAtStart: params.signal?.aborted === true
    });
    if (st.mode !== 'none') {
      await new Promise<void>((resolve) => {
        st.holdResolve = resolve;
        params.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      if (st.mode === 'hang') {
        throw new Error('AGENT_ABORTED: abandon simulé pendant l appel agent.');
      }
      // mode 'late' : le résultat REVIENT après l'abandon (tardif).
    }
    return {
      taskId: params.task.id,
      agentId: this.definition.id,
      status: 'SUCCESS',
      degraded: false,
      artifacts: [],
      conflicts: [],
      tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      durationMs: 1
    };
  }

  protected buildArtifacts(_params: {
    task: AgentTask;
    context: TaskContextPayload;
    generatedText: string;
  }): readonly AgentArtifact[] {
    return [];
  }
}

/**
 * Adapter contrôlé pour U5/U6 : le VRAI BaseSpecializedAgent appelle un
 * adapter réel. 'hang'/'late' tiennent l'appel jusqu'au signal (ou jusqu'à
 * release) ; 'timeout' jette immédiatement une erreur technique SANS signal.
 */
class ControlledAdapter implements AIProviderAdapter {
  public readonly descriptor: AIProviderDescriptor;
  public readonly calls: Array<{ request: AIProviderGenerateRequest }> = [];
  public mode: 'hang' | 'late' | 'timeout' = 'hang';
  private holdResolve: (() => void) | null = null;

  constructor() {
    this.descriptor = {
      providerId: 'fake-e41',
      providerName: 'Fake E41',
      models: ['fake-e41-1'],
      capabilities: ['FAST', 'CODE_GENERATION'],
      contextWindow: 8000,
      structuredOutput: false,
      streaming: false,
      toolCalling: false,
      reasoning: false,
      vision: false,
      costMetadata: {},
      availability: 'AVAILABLE',
      healthStatus: 'HEALTHY'
    };
  }

  public release(): void {
    const r = this.holdResolve;
    this.holdResolve = null;
    r?.();
  }

  public async generate(
    request: AIProviderGenerateRequest,
    _credentials?: unknown
  ): Promise<AIProviderGenerateResponse> {
    this.calls.push({ request });
    if (this.mode === 'timeout') {
      throw new Error('FakeTimeoutError: délai dépassé (AUCUN signal impliqué).');
    }
    await new Promise<void>((resolve) => {
      this.holdResolve = resolve;
      request.signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    if (this.mode === 'late') {
      return {
        text: 'résultat tardif de l adapter (après abandon)',
        providerId: this.descriptor.providerId,
        modelId: this.descriptor.models[0] ?? 'fake-e41-1',
        latencyMs: 1,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        costUsd: 0
      };
    }
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  }
}

function makeAgentChain(agents: BaseSpecializedAgent[]): {
  agentExecution: AgentExecutionService;
  scheduler: MultiAgentScheduler;
} {
  const registry = new AgentRegistryService();
  for (const a of agents) registry.register(a);
  const agentExecution = new AgentExecutionService(registry, new MutationBridge(undefined), NULL_FILE_OBSERVER);
  return { agentExecution, scheduler: new MultiAgentScheduler(agentExecution) };
}

function makeSpec(taskId: string, agentId: string, order: number, dependencies: readonly string[] = []): MultiAgentTaskSpec {
  return {
    taskId,
    agentId,
    dependencies,
    order,
    task: makeTask(taskId, `src/${taskId}.ts`)
  };
}

/** Attend qu'une condition devienne vraie (fenêtre bornée). */
async function waitFor(condition: () => boolean, timeoutMs = 3000, stepMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor : délai dépassé');
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

describe('É53 LOT E4.1 — U. propagation du signal aux agents (unitaire)', () => {
  it('U1 — le MÊME signal (même instance) atteint executeTask de l agent', async () => {
    const agent = new RecordingAgent('agent-u1');
    const { agentExecution } = makeAgentChain([agent]);
    const external = new AbortController();
    const outcome = await agentExecution.execute({
      executionId: 'e41-u1',
      agentId: 'agent-u1',
      task: makeTask('t-u1', 'src/u1.ts'),
      context: EMPTY_CONTEXT,
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'OWNER',
      signal: external.signal
    });
    assert.equal(outcome.status, 'SUCCESS', 'tâche ANALYZE sans annulation → SUCCESS');
    assert.equal(outcome.cancellation.requested, false);
    assert.equal(agent.seen.length, 1, 'l agent a été appelé exactement une fois');
    assert.ok(agent.seen[0]!.signal, 'le signal a été TRANSMIS à l agent');
    assert.equal(agent.seen[0]!.signal, external.signal, 'PREUVE D IDENTITÉ : le MÊME signal (même instance), pas une copie');
    assert.equal(agent.seen[0]!.abortedAtStart, false);
  });

  it('U2 — signal pré-armé → AUCUN appel agent (BEFORE_AGENT)', async () => {
    const agent = new RecordingAgent('agent-u2');
    const { agentExecution } = makeAgentChain([agent]);
    const external = new AbortController();
    external.abort(); // annulation DÉJÀ armée avant l'exécution
    const outcome = await agentExecution.execute({
      executionId: 'e41-u2',
      agentId: 'agent-u2',
      task: makeTask('t-u2', 'src/u2.ts'),
      context: EMPTY_CONTEXT,
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'OWNER',
      signal: external.signal
    });
    assert.equal(outcome.status, 'CANCELLED', 'jamais un échec ordinaire : CANCELLED');
    assert.equal(outcome.cancellation.requested, true);
    assert.equal(outcome.cancellation.at, 'BEFORE_AGENT', 'point É35 : avant tout démarrage');
    assert.ok(outcome.phases.some((p) => p.phase === 'CANCELLED_BEFORE_AGENT'), 'phase CANCELLED_BEFORE_AGENT tracée');
    assert.equal(agent.seen.length, 0, 'PREUVE : AUCUN appel agent ne démarre après annulation');
  });

  it('U3 — résultat TARDIF neutralisé : CANCELLED AFTER_AGENT, jamais appliqué', async () => {
    const agent = new RecordingAgent('agent-u3');
    agent.mode = 'late';
    const { agentExecution } = makeAgentChain([agent]);
    const external = new AbortController();
    const pending = agentExecution.execute({
      executionId: 'e41-u3',
      agentId: 'agent-u3',
      task: makeTask('t-u3', 'src/u3.ts'),
      context: EMPTY_CONTEXT,
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'OWNER',
      signal: external.signal
    });
    await waitFor(() => agent.seen.length === 1);
    external.abort(); // l'annulation gagne PENDANT l'appel
    agent.release(); // l'appel agent TERMINE ensuite (résultat tardif SUCCESS)
    const outcome = await pending;
    assert.equal(outcome.status, 'CANCELLED', 'le résultat tardif n est jamais intégré');
    assert.equal(outcome.cancellation.at, 'AFTER_AGENT', 'point É4.1 : observé APRÈS l appel agent');
    assert.ok(outcome.phases.some((p) => p.phase === 'CANCELLED_AFTER_AGENT'), 'phase CANCELLED_AFTER_AGENT tracée');
    assert.equal(outcome.mutation.executed, false, 'AUCUNE mutation ne peut suivre ce retour');
    assert.equal(agent.seen[0]!.signal, external.signal, 'identité du signal préservée');
  });

  it('U4 — abandon PENDANT l appel agent → CANCELLED AGENT (jamais un échec ordinaire)', async () => {
    const agent = new RecordingAgent('agent-u4');
    agent.mode = 'hang';
    const { agentExecution } = makeAgentChain([agent]);
    const external = new AbortController();
    const pending = agentExecution.execute({
      executionId: 'e41-u4',
      agentId: 'agent-u4',
      task: makeTask('t-u4', 'src/u4.ts'),
      context: EMPTY_CONTEXT,
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'OWNER',
      signal: external.signal
    });
    await waitFor(() => agent.seen.length === 1);
    external.abort();
    const outcome = await pending;
    assert.equal(outcome.status, 'CANCELLED');
    assert.equal(outcome.cancellation.at, 'AGENT', 'point É4.1 : abandon observé PENDANT l appel');
    assert.equal(outcome.mutation.executed, false);
    assert.ok(String(outcome.error ?? '').length > 0, 'l erreur d abandon est rapportée honnêtement');
  });

  it('U5 — le VRAI BaseSpecializedAgent transmet le signal à l adapter et rejette l abandon', async () => {
    const adapter = new ControlledAdapter();
    adapter.mode = 'hang';
    const providerRegistry: AIProviderRegistry = new ProviderRegistry();
    providerRegistry.register(adapter);
    class HangingBaseAgent extends BaseSpecializedAgent {
      constructor() {
        super(
          {
            id: 'agent-u5-base',
            name: 'Base real (E4.1)',
            domain: 'CODE',
            capabilities: ['SERVICE_LOGIC'],
            description: 'Agent de base réel (E4.1) — failover, signal, transport.',
            riskLevel: 'LOW',
            requiredProviderCapabilities: [],
            allowedTools: []
          },
          providerRegistry
        );
      }
      protected buildArtifacts(_params: {
        task: AgentTask;
        context: TaskContextPayload;
        generatedText: string;
      }): readonly AgentArtifact[] {
        return [];
      }
    }
    const agent = new HangingBaseAgent();
    const { agentExecution } = makeAgentChain([agent]);
    const external = new AbortController();
    const pending = agentExecution.execute({
      executionId: 'e41-u5',
      agentId: 'agent-u5-base',
      task: makeTask('t-u5', 'src/u5.ts'),
      context: EMPTY_CONTEXT,
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'OWNER',
      signal: external.signal
    });
    await waitFor(() => adapter.calls.length === 1);
    assert.ok(adapter.calls[0]!.request.signal, 'le vrai base-agent transmet un signal à l adapter');
    assert.equal(adapter.calls[0]!.request.signal, external.signal, 'PREUVE D IDENTITÉ (base-agent → adapter) : le MÊME signal');
    external.abort();
    const outcome = await pending;
    assert.equal(outcome.status, 'CANCELLED', 'l abandon du transport est classé CANCELLED (jamais FAILURE)');
    assert.equal(outcome.cancellation.at, 'AGENT');
    assert.equal(adapter.calls.length, 1, 'PREUVE FAILOVER : AUCUN nouvel appel après abandon');
  });

  it('U6 — TIMEOUT technique sans signal ≠ CANCELLED : DEGRADED honnête, AUCUN abandon', async () => {
    const adapter = new ControlledAdapter();
    adapter.mode = 'timeout';
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(adapter);
    class TimeoutBaseAgent extends BaseSpecializedAgent {
      constructor() {
        super(
          {
            id: 'agent-u6-base',
            name: 'Base timeout (E4.1)',
            domain: 'CODE',
            capabilities: ['SERVICE_LOGIC'],
            description: 'Agent de base réel (E4.1) — classification honnête des échecs.',
            riskLevel: 'LOW',
            requiredProviderCapabilities: [],
            allowedTools: []
          },
          providerRegistry
        );
      }
      protected buildArtifacts(_params: {
        task: AgentTask;
        context: TaskContextPayload;
        generatedText: string;
      }): readonly AgentArtifact[] {
        return [];
      }
    }
    const agent = new TimeoutBaseAgent();
    const { agentExecution } = makeAgentChain([agent]);
    const outcome = await agentExecution.execute({
      executionId: 'e41-u6',
      agentId: 'agent-u6-base',
      task: makeTask('t-u6', 'src/u6.ts'),
      context: EMPTY_CONTEXT,
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'OWNER'
      // AUCUN signal : un échec technique n'est jamais une annulation.
    });
    assert.notEqual(outcome.status, 'CANCELLED', 'un timeout n est JAMAIS classé annulation (classification honnête E3/E4.1)');
    assert.equal(outcome.status, 'DEGRADED', 'contenu non-LLM → DEGRADED, le rapport dit la vérité');
    assert.equal(outcome.cancellation.requested, false, 'aucune cancellation rapportée');
  });

  it('U7 — scheduler : tâches PARALLÈLES reçoivent le MÊME signal et sont annulées ENSEMBLE', async () => {
    const agentA = new RecordingAgent('agent-u7-a');
    const agentB = new RecordingAgent('agent-u7-b');
    agentA.mode = 'hang';
    agentB.mode = 'hang';
    const { scheduler } = makeAgentChain([agentA, agentB]);
    const external = new AbortController();
    const pending = scheduler.execute({
      executionId: 'e41-u7',
      tenantId: TENANT,
      projectId: PROJECT,
      tasks: [makeSpec('t7a', 'agent-u7-a', 1), makeSpec('t7b', 'agent-u7-b', 2)],
      userRole: 'OWNER',
      signal: external.signal
    });
    await waitFor(() => agentA.seen.length === 1 && agentB.seen.length === 1);
    external.abort();
    const outcome = await pending;
    assert.equal(outcome.status, 'CANCELLED', 'annulation pendant la vague → batch CANCELLED');
    assert.equal(outcome.counts.cancelled, 2, 'les DEUX tâches en vol sont CANCELLED');
    assert.equal(outcome.counts.failed, 0, 'aucune tâche transformée en échec ordinaire');
    for (const record of outcome.tasks) {
      assert.equal(record.status, 'CANCELLED', `tâche ${record.spec.taskId} : CANCELLED`);
    }
    assert.equal(agentA.seen[0]!.signal, external.signal, 'agent A : le MÊME signal du scheduler');
    assert.equal(agentB.seen[0]!.signal, external.signal, 'agent B : le MÊME signal du scheduler (partagé, pas une copie)');
  });

  it('U8 — maxConcurrency 1 : annulation pendant la tâche en vol → dépendant BLOCKED + indépendant PENDING', async () => {
    const agentA = new RecordingAgent('agent-u8-a');
    const agentB = new RecordingAgent('agent-u8-b');
    const agentC = new RecordingAgent('agent-u8-c');
    agentA.mode = 'hang';
    agentB.mode = 'none';
    agentC.mode = 'none';
    const { scheduler } = makeAgentChain([agentA, agentB, agentC]);
    const external = new AbortController();
    const pending = scheduler.execute({
      executionId: 'e41-u8',
      tenantId: TENANT,
      projectId: PROJECT,
      tasks: [
        makeSpec('t8a', 'agent-u8-a', 1),
        makeSpec('t8b', 'agent-u8-b', 2),
        makeSpec('t8c', 'agent-u8-c', 3, ['t8a'])
      ],
      maxConcurrency: 1,
      userRole: 'OWNER',
      signal: external.signal
    });
    await waitFor(() => agentA.seen.length === 1); // vague 1 : A seule (capacité 1)
    external.abort();
    const outcome = await pending;
    assert.equal(outcome.status, 'CANCELLED');
    const byId = new Map(outcome.tasks.map((t) => [t.spec.taskId, t]));
    assert.equal(byId.get('t8a')!.status, 'CANCELLED', 'la tâche en vol est CANCELLED');
    assert.equal(byId.get('t8b')!.status, 'PENDING', 'l indépendante jamais démarrée → PENDING (honnête)');
    assert.equal(byId.get('t8c')!.status, 'BLOCKED', 'la dépendante de la tâche annulée → BLOCKED');
    assert.equal(agentB.seen.length, 0, 'B : AUCUN appel (les travaux en attente ne démarrent jamais)');
    assert.equal(agentC.seen.length, 0, 'C : AUCUN appel');
  });

  it('U9 — signal pré-armé au scheduler → AUCUN appel agent, tout PENDING', async () => {
    const agentA = new RecordingAgent('agent-u9-a');
    const agentB = new RecordingAgent('agent-u9-b');
    const { scheduler } = makeAgentChain([agentA, agentB]);
    const external = new AbortController();
    external.abort();
    const outcome = await scheduler.execute({
      executionId: 'e41-u9',
      tenantId: TENANT,
      projectId: PROJECT,
      tasks: [makeSpec('t9a', 'agent-u9-a', 1), makeSpec('t9b', 'agent-u9-b', 2)],
      userRole: 'OWNER',
      signal: external.signal
    });
    assert.equal(outcome.status, 'CANCELLED', 'batch pré-annulé : CANCELLED honnête');
    assert.equal(outcome.counts.completed, 0);
    assert.equal(outcome.counts.cancelled, 0, 'aucune tâche en vol à annuler');
    for (const record of outcome.tasks) {
      assert.equal(record.status, 'PENDING', `tâche ${record.spec.taskId} : jamais démarrée → PENDING`);
    }
    assert.equal(agentA.seen.length, 0, 'PREUVE : zéro appel agent');
    assert.equal(agentB.seen.length, 0, 'PREUVE : zéro appel agent');
  });
});
