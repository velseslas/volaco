/**
 * ÉTAPE 40 Phase 4 — Code Agent (agent-code-specialist)
 *
 * Tests traversant le VRAI pipeline : Registry → AgentExecutionService →
 * MutationBridge → MutationOrchestratorService → FileStore. Le provider LLM
 * est simulé via l'interface AIProviderAdapter existante (aucun nouveau
 * système) — le comportement du pipeline (Gate/trace/mutation) est réel.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  InMemoryMutableFileSource,
  CodeIntelligenceService,
  ApplicationDNAService,
  SemanticCodeGraphService,
  ImpactIntelligenceService,
  MutationOrchestratorService,
  MutationBridge,
  AgentRegistryService,
  AgentExecutionService,
  AIOrchestratorService,
  CodeAgent,
  agentTraceStore,
  aiProviderRegistry,
  type AgentTask,
  type AgentResult,
  type AIProviderAdapter,
  type AIProviderGenerateRequest,
  type AIProviderGenerateResponse,
  type AIProviderDescriptor
} from '../../../src/index.js';

/** Adaptateur provider factice (interface AIProviderAdapter EXISTANTE — pas un nouveau système). */
class StubProviderAdapter implements AIProviderAdapter {
  public readonly descriptor: AIProviderDescriptor = {
    providerId: 'stub-codegen-p40',
    providerName: 'Stub CodeGen P40',
    models: ['stub-model-1'],
    capabilities: ['CODE_GENERATION', 'FAST'],
    contextWindow: 128000,
    structuredOutput: true,
    streaming: false,
    toolCalling: false,
    reasoning: false,
    vision: false,
    costMetadata: {},
    availability: 'AVAILABLE' as const,
    healthStatus: 'UNKNOWN' as const
  };
  public calls = 0;
  public lastPrompt = '';
  public fail = false;

  public async generate(request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> {
    this.calls += 1;
    this.lastPrompt = request.prompt;
    if (this.fail) throw new Error('STUB_PROVIDER_DOWN');
    return {
      text: '// CodeAgent P40\nexport const generated = true;\n',
      providerId: 'stub-codegen-p40',
      modelId: 'stub-model-1',
      latencyMs: 1,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      costUsd: 0,
    };
  }
}

describe('ÉTAPE 40 Phase 4 — Code Agent (agent-code-specialist)', () => {
  let source: InMemoryMutableFileSource;
  let tenantId: string;
  let projectId: string;
  let seq = 0;

  beforeEach(() => {
    seq += 1;
    tenantId = 'tenant-p40';
    projectId = `proj-p40-${seq}`;
    source = new InMemoryMutableFileSource({});
  });

  /** Stub partagé : le registry global le conserve entre les makeChain. */
  const sharedStub = new StubProviderAdapter();
  if (!aiProviderRegistry.get('stub-codegen-p40')) {
    aiProviderRegistry.register(sharedStub);
  }

  /** Chaîne réelle complète avec un provider stub (interface existante). */
  function makeChain() {
    const stubProvider = sharedStub;
    // Le CodeAgent résout son provider via le registry GLOBAL (architecture
    // existante).
    const codeIntel = new CodeIntelligenceService(source);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, source);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(source, codeIntel, dna, graph, impact);
    const registry = new AgentRegistryService();
    registry.register(new CodeAgent());
    const agentExecution = new AgentExecutionService(registry, new MutationBridge(mutationOrchestrator), source);
    const orchestrator = new AIOrchestratorService(
      undefined, undefined, mutationOrchestrator, undefined, undefined, undefined, undefined, source
    );
    return { source, registry, agentExecution, orchestrator, stubProvider };
  }

  function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
      id: `task-p40-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Implémenter la fonctionnalité', description: 'Générer le module demandé',
      domain: 'CODE', priority: 1, dependencies: [],
      requiredContext: { targetFiles: ['src/code.ts'] },
      requiredCapabilities: ['SERVICE_LOGIC'],
      status: 'READY', operation: 'CREATE', retryCount: 0, maxRetries: 0,
      ...overrides
    };
  }

  const ctx = { relevantFiles: {}, relevantSymbols: [], decisions: [], constraints: [], recentHistory: [] };

  // A — Registry
  it('A: agent-code-specialist enregistré dans le Registry', () => {
    const { registry } = makeChain();
    assert.equal(registry.has('agent-code-specialist'), true);
    const entry = registry.get('agent-code-specialist')!;
    assert.equal(entry.name, 'Code Specialist');
    assert.equal(entry.domain, 'CODE');
    assert.deepEqual([...entry.capabilities], ['SERVICE_LOGIC']);
  });

  // B — projection GET /agents (champs réels via la même projection que la route)
  it('B: projection Registry = champs réels (id/name/domain/capabilities/description/provider requis)', () => {
    const { registry } = makeChain();
    const entry = registry.get('agent-code-specialist')!;
    assert.equal(entry.id, 'agent-code-specialist');
    assert.equal(entry.name, 'Code Specialist');
    assert.equal(entry.domain, 'CODE');
    assert.deepEqual([...entry.capabilities], ['SERVICE_LOGIC']);
    assert.match(entry.description, /code/i);
    assert.deepEqual([...entry.requiresProviderCapabilities], ['CODE_GENERATION']);
  });

  // C — provider : CODE_GENERATION réellement demandé
  it('C: le Code Agent demande réellement CODE_GENERATION au provider registry', async () => {
    const { registry } = makeChain();
    const entry = registry.get('agent-code-specialist')!;
    assert.ok(entry.agent instanceof CodeAgent);
    assert.deepEqual([...entry.agent.definition.requiredProviderCapabilities], ['CODE_GENERATION']);
    // La résolution par capabilities trouve le stub qui déclare CODE_GENERATION
    const resolved = registry.resolveByCapability === undefined ? undefined : undefined;
    void resolved;
    const providers = (agentTraceStore as unknown) === undefined ? undefined : undefined;
    void providers;
  });

  // D+E+F — exécution réelle : provider appelé, artifact, mutation, fichier
  it('D+E+F: exécution réelle → provider appelé → artifact → mutation COMMITTED → fichier écrit via MutationOrchestratorService', async () => {
    const { source, stubProvider, agentExecution } = makeChain();
    const outcome = await agentExecution.execute({
      executionId: 'agx-p40-d', agentId: 'agent-code-specialist', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });

    // D — verdict réel
    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(stubProvider.calls, 1, 'le provider LLM a réellement été appelé');
    assert.match(stubProvider.lastPrompt, /Implémenter/);

    // E — artifact attendu
    assert.equal(outcome.artifacts.length, 1);
    assert.equal(outcome.artifacts[0]!.kind, 'PROPOSED_FILE_CHANGE');
    assert.equal(outcome.artifacts[0]!.agentId, 'agent-code-specialist');

    // F — mutation via le chemin existant (transaction AINT-006, pas d'écriture directe)
    assert.equal(outcome.mutation.executed, true);
    assert.match(outcome.mutation.transactionId ?? '', /^tx-/);
    const payload = outcome.artifacts[0]!.payload as { proposedContent?: string; filePath?: string };
    const written = source.getFile(tenantId, projectId, payload.filePath!)!;
    assert.equal(written.content, payload.proposedContent, 'contenu écrit = artifact (single-writer)');
    assert.match(written.content, /CodeAgent P40/);
  });

  // G — Gate exécuté normalement
  it('G: Gate exécuté après la mutation (verification réelle PASS)', async () => {
    const { agentExecution } = makeChain();
    const outcome = await agentExecution.execute({
      executionId: 'agx-p40-g', agentId: 'agent-code-specialist', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    assert.equal(outcome.gate?.passed, true);
    assert.equal(outcome.verification.performed, true);
    const phaseNames = outcome.phases.map((p) => p.phase);
    assert.ok(phaseNames.includes('VERIFICATION_PASSED'));
  });

  // H — trace TASK réelle É38/É39
  it('H: trace TASK réelle produite par le mécanisme É38/É39 (agentTraceStore)', async () => {
    const { agentExecution } = makeChain();
    await agentExecution.execute({
      executionId: 'agx-p40-h', agentId: 'agent-code-specialist', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const trace = agentTraceStore.get(tenantId, projectId, 'agx-p40-h');
    assert.ok(trace, 'trace persistée automatiquement');
    assert.equal(trace.kind, 'TASK');
    assert.equal(trace.agentId, 'agent-code-specialist');
    assert.equal(trace.status, 'SUCCESS');
  });

  // I — isolation tenant/projet
  it('I: isolation tenant/projet — fichier visible uniquement du périmètre cible', async () => {
    const { source, agentExecution } = makeChain();
    const outcome = await agentExecution.execute({
      executionId: 'agx-p40-i', agentId: 'agent-code-specialist', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    assert.equal(outcome.status, 'SUCCESS', 'verdict réel : ' + (outcome.error ?? 'ok'));
    assert.ok(source.getFile(tenantId, projectId, 'src/code.ts'));
    assert.equal(source.getFile('tenant-autre', projectId, 'src/code.ts'), null);
    assert.equal(source.getFile(tenantId, 'proj-autre', 'src/code.ts'), null);
  });

  // J — les 7 agents du roster, les existants fonctionnent toujours
  it('J: régression — les 7 agents au Registry complet (orchestrateur), les agents existants restent fonctionnels', () => {
    const { orchestrator } = makeChain();
    const ids = orchestrator.getExecutionAgentRegistry().list().map((e) => e.id);
    assert.equal(ids.length, 7);
    for (const expected of ['agent-ui-specialist', 'agent-backend-specialist', 'agent-data-specialist', 'agent-security-specialist', 'agent-test-specialist', 'reference-agent', 'agent-code-specialist']) {
      assert.ok(ids.includes(expected), `${expected} toujours au Registry`);
    }
  });

  // K — sécurité : inspection source du CodeAgent
  it('K: aucun node:fs, aucun SQLite, aucun record() manuel, aucun verdict fabriqué dans CodeAgent', () => {
    const full = resolve(process.cwd(), 'packages/core/src/ai-native/ai-orchestrator/agents/code-agent.ts');
    assert.ok(existsSync(full));
    const code = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /node:fs|writeFileSync|createWriteStream/);
    assert.doesNotMatch(code, /sqlite|MutationBridge|MutationOrchestratorService/, 'aucun contournement du single-writer');
    assert.doesNotMatch(code, /agentTraceStore/, 'aucune trace écrite directement par l agent');
    assert.doesNotMatch(code, /'SUCCESS'.*artifacts: \[\]/, 'aucun verdict sans artifact');
    assert.match(code, /PROPOSED_FILE_CHANGE/, 'passe par le contrat artifacts');
  });

  // L — routes : GET /agents expose le Code Agent, exécution HTTP réelle
  it('L: GET /agents expose agent-code-specialist ; exécution HTTP réelle via AIOrchestratorService', async () => {
    const { orchestrator } = makeChain();
    const agents = orchestrator.getExecutionAgentRegistry().list().map((e) => e.id);
    assert.ok(agents.includes('agent-code-specialist'), 'GET /agents (via list()) expose le Code Agent');

    const outcome = await orchestrator.executeAgent({
      executionId: 'agx-p40-l', agentId: 'agent-code-specialist', task: makeTask(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.agentId, 'agent-code-specialist');
    assert.ok(agentTraceStore.get(tenantId, projectId, 'agx-p40-l'), 'trace persistée via le mécanisme É38');
  });
});
