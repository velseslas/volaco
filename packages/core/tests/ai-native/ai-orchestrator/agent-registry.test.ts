/**
 * ÉTAPE 34 — Agent Registry + routage multi-agents
 *
 * Les tests traversent le VRAI pipeline : AIOrchestratorService réel
 * (Registry unique → scheduler + exécuteur) et, pour le pont conversationnel,
 * la vraie chaîne ExecutionBridge → routeur (Registry) → AgentExecutionService
 * → MutationBridge → MutationOrchestratorService → FileStore.
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
  AgentExecutionService,
  AIOrchestratorService,
  BaseSpecializedAgent,
  ReferenceAgent,
  REFERENCE_AGENT_ID,
  routeIntentToAgent,
  FILE_MUTATION_CAPABILITY,
  ConversationIntelligenceService,
  type AgentTask,
  type AgentResult
} from '../../../src/index.js';

describe('ÉTAPE 34 — Agent Registry & routage multi-agents', () => {
  let fileSource: InMemoryMutableFileSource;
  let service: AIOrchestratorService;
  let tenantId: string;
  let projectId: string;
  let runSeq = 0;

  beforeEach(() => {
    runSeq += 1;
    tenantId = 'tenant-e34';
    projectId = `proj-e34-${runSeq}`;
    fileSource = new InMemoryMutableFileSource({});
    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    service = new AIOrchestratorService(
      undefined, undefined, mutationOrchestrator, undefined, undefined, undefined, undefined
    );
  });

  function makeStubAgent(id: string, capabilities: readonly string[], domain: 'ARCHITECTURE' = 'ARCHITECTURE'): BaseSpecializedAgent {
    class StubAgent extends BaseSpecializedAgent {
      constructor() {
        super(
          {
            id, name: `Stub ${id}`, domain,
            capabilities: capabilities as never[],
            description: `agent de test ${id}`,
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
            taskId: params.task.id, agentId: id, status: 'FAILURE', artifacts: [], conflicts: [],
            tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 1,
            error: 'STUB_INVALID_TASK'
          };
        }
        const content = `// stub ${id}\nexport const stubTask = ${JSON.stringify(params.task.title)};\n`;
        return {
          taskId: params.task.id, agentId: id, status: 'SUCCESS', degraded: false,
          artifacts: [
            {
              id: `art-${params.task.id}`, taskId: params.task.id, agentId: id, domain: 'ARCHITECTURE',
              kind: 'PROPOSED_FILE_CHANGE', targetFiles: [targetFile],
              payload: { filePath: targetFile, operation: 'CREATE', proposedContent: content, reason: 'stub É34' },
              confidence: 1, hash: `hash-${id}-${params.task.id}`, summary: 'stub'
            }
          ],
          conflicts: [], tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 1
        };
      }
      protected buildArtifacts(): readonly [] { return []; }
    }
    return new StubAgent();
  }

  // =========================================================================
  // A / B / C — register / get / unknown / list / unregister
  // =========================================================================
  it('A: register → get (entrée descriptive, agent = instance réelle)', () => {
    const registry = service.getExecutionAgentRegistry();
    const stub = makeStubAgent('stub-a1', ['SERVICE_LOGIC']);
    const entry = registry.register(stub);

    assert.equal(entry.id, 'stub-a1');
    assert.equal(entry.name, 'Stub stub-a1');
    assert.equal(entry.domain, 'ARCHITECTURE');
    assert.deepEqual([...entry.capabilities], ['SERVICE_LOGIC']);
    assert.ok(entry.description.length > 0);
    assert.equal(entry.agent, stub, 'entry.agent est l INSTANCE réelle, pas une copie');
    assert.deepEqual([...entry.requiresProviderCapabilities], [], 'dépendances provider exposées');

    const fetched = registry.get('stub-a1');
    assert.ok(fetched);
    assert.equal(fetched.agent, stub);
    assert.equal(registry.has('stub-a1'), true);
  });

  it('B: agent inconnu → registry.get undefined + exécution → AGENT_UNKNOWN, aucune mutation', async () => {
    const registry = service.getExecutionAgentRegistry();
    assert.equal(registry.get('agent-fantome'), undefined);

    const outcome = await service.executeAgent({
      executionId: 'agx-e34-b',
      agentId: 'agent-fantome',
      task: {
        id: 'task-e34-b', title: 'Tâche', description: '', domain: 'ARCHITECTURE', priority: 1,
        dependencies: [], requiredContext: { targetFiles: ['src/x.ts'] }, requiredCapabilities: ['SERVICE_LOGIC'],
        status: 'READY', operation: 'CREATE', retryCount: 0, maxRetries: 0
      },
      context: { relevantFiles: {}, relevantSymbols: [], decisions: [], constraints: [], recentHistory: [] },
      tenantId, projectId, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILURE');
    assert.match(outcome.error ?? '', /AGENT_UNKNOWN/);
    assert.equal(outcome.mutation.executed, false);
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/x.ts'), null);
  });

  it('C: list + unregister (6 agents du roster, doublon refusé)', () => {
    const registry = service.getExecutionAgentRegistry();
    const ids = registry.list().map((e) => e.id);
    assert.equal(ids.length, 6, '5 agents de domaine + reference-agent');
    for (const expected of ['reference-agent', 'agent-ui-specialist', 'agent-backend-specialist', 'agent-data-specialist', 'agent-security-specialist', 'agent-test-specialist']) {
      assert.ok(ids.includes(expected), `${expected} enregistré`);
    }
    assert.throws(() => registry.register(makeStubAgent('reference-agent', ['SERVICE_LOGIC'])), /déjà enregistré/);

    assert.equal(registry.unregister('reference-agent'), true);
    assert.equal(registry.has('reference-agent'), false);
    assert.equal(registry.list().length, 5);
    assert.equal(registry.unregister('reference-agent'), false, 'unregister idempotent');
    registry.register(new ReferenceAgent());
    assert.equal(registry.list().length, 6, 'ré-enregistré');
  });

  // =========================================================================
  // D / E / F — résolution par capability et par domaine
  // =========================================================================
  it('D: résolution par capability — FILE_MUTATION → reference-agent uniquement', () => {
    const registry = service.getExecutionAgentRegistry();
    const candidates = registry.resolveByCapability(FILE_MUTATION_CAPABILITY);
    assert.equal(candidates.length, 1, 'un seul candidat FILE_MUTATION (pas d ambiguïté par défaut)');
    assert.equal(candidates[0]!.id, REFERENCE_AGENT_ID);
    // Une capability partagée (SERVICE_LOGIC : reference + backend) retourne TOUS les candidats.
    const shared = registry.resolveByCapability('SERVICE_LOGIC');
    assert.equal(shared.length, 2, 'resolveByCapability retourne TOUS les candidats (le routeur refuse l ambiguïté)');
  });

  it('E: résolution par domaine + vue scheduler dérivée', () => {
    const registry = service.getExecutionAgentRegistry();
    assert.equal(registry.resolveByDomain('UI')?.id, 'agent-ui-specialist');
    assert.equal(registry.resolveByDomain('ARCHITECTURE')?.id, 'reference-agent');
    assert.equal(registry.resolveByDomain('BACKEND')?.id, 'agent-backend-specialist');

    const domainMap = registry.domainMap();
    assert.equal(domainMap.size, 6, '6 domaines uniques (5 + ARCHITECTURE)');
    assert.equal(domainMap.get('TEST')?.definition.id, 'agent-test-specialist');
  });

  // =========================================================================
  // SOURCE UNIQUE
  // =========================================================================
  it('SOURCE UNIQUE: scheduler, exécuteur et registry partagent LES MÊMES instances', () => {
    const registry = service.getExecutionAgentRegistry();
    // La vue domaine du scheduler EST le registry
    assert.equal(service.getSpecializedAgent('UI'), registry.get('agent-ui-specialist')!.agent);
    assert.equal(service.getSpecializedAgent('SECURITY'), registry.get('agent-security-specialist')!.agent);
    // L'exécuteur liste exactement le registry
    const executorIds = service.listExecutionAgents();
    assert.deepEqual(executorIds, registry.list().map((e) => e.id));
    // Le registry exposé par l'exécuteur est le MÊME objet
    const viaFacade = (service as unknown as { agentExecution: AgentExecutionService }).agentExecution.getRegistry();
    assert.equal(viaFacade, registry, 'aucun deuxième registry');
  });

  // =========================================================================
  // F / G — routage : capability absente / ambiguïté
  // =========================================================================
  it('F: aucun agent avec la capability requise → UNSUPPORTED_AGENT_CAPABILITY (pipeline réel, aucun fichier)', async () => {
    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    // Registry SANS le reference-agent : la capability FILE_MUTATION n est possédée par personne.
    const registry = new AgentRegistryService();
    registry.register(new ReferenceAgent());
    registry.unregister('reference-agent');
    const executor = new AgentExecutionService(registry, new MutationBridge(mutationOrchestrator));
    const svc = new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
    svc.attachAgentExecutor({
      execute: (request) => executor.execute(request),
      getRegistry: () => executor.getRegistry()
    });

    const session = svc.createSession({ tenantId, projectId });
    const turn1 = await svc.processTurn({ tenantId, projectId, sessionId: session.sessionId, message: 'Crée le fichier src/absent.ts module' });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: turn1.turn.plan!.planId, approved: true });
    const exec = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });

    assert.equal(exec.executionResult.success, false);
    assert.match(exec.executionResult.error ?? '', /UNSUPPORTED_AGENT_CAPABILITY/);
    assert.equal(exec.session.currentState, 'FAILED');
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/absent.ts'), null);
  });

  it('G: deux agents compatibles → AMBIGUOUS_AGENT_ROUTE avec candidats, aucun choix arbitraire', async () => {
    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    const registry = new AgentRegistryService();
    registry.register(makeStubAgent('ref-double-a', ['FILE_MUTATION']));
    registry.register(makeStubAgent('ref-double-b', ['FILE_MUTATION']));
    const executor = new AgentExecutionService(registry, new MutationBridge(mutationOrchestrator));
    const svc = new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
    svc.attachAgentExecutor({
      execute: (request) => executor.execute(request),
      getRegistry: () => executor.getRegistry()
    });

    const session = svc.createSession({ tenantId, projectId });
    const turn1 = await svc.processTurn({ tenantId, projectId, sessionId: session.sessionId, message: 'Crée le fichier src/ambigu.ts module' });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: turn1.turn.plan!.planId, approved: true });
    const exec = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });

    assert.equal(exec.executionResult.success, false);
    assert.match(exec.executionResult.error ?? '', /AMBIGUOUS_AGENT_ROUTE/);
    assert.match(exec.executionResult.error ?? '', /ref-double-a/);
    assert.match(exec.executionResult.error ?? '', /ref-double-b/);
    assert.equal(exec.session.currentState, 'FAILED');
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/ambigu.ts'), null, 'aucune écriture en cas d ambiguïté');
  });

  // =========================================================================
  // H → K / M / N / O — conversation → Registry → agent → mutation → fichier
  // =========================================================================
  it('H→O: conversation → Registry → reference-agent → artifact → mutation COMMITTED → fichier persisté', async () => {
    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    const registry = new AgentRegistryService();
    registry.register(new ReferenceAgent());
    const executor = new AgentExecutionService(registry, new MutationBridge(mutationOrchestrator));
    const svc = new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
    svc.attachAgentExecutor({
      execute: (request) => executor.execute(request),
      getRegistry: () => executor.getRegistry()
    });

    const session = svc.createSession({ tenantId, projectId });
    const turn1 = await svc.processTurn({ tenantId, projectId, sessionId: session.sessionId, message: 'Crée le fichier src/registry-e34.ts module pont registre' });
    await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: turn1.turn.plan!.planId, approved: true });
    const exec = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId });

    // H — le routage passe par le Registry et résout le reference-agent
    assert.match(exec.executionResult.message ?? '', /reference-agent/);
    assert.equal(exec.executionResult.success, true);
    // I/J — artifact réel + mutation réelle (transaction COMMITTED)
    assert.match(exec.executionResult.message ?? '', /COMMITTED/);
    // K — fichier réellement persisté
    const written = fileSource.getFile(tenantId, projectId, 'src/registry-e34.ts');
    assert.ok(written);
    assert.match(written.content, /reference-agent/);
    assert.match(written.content, /module pont registre/);
    // M/N — agentId + executionId conservés jusqu'au résultat
    assert.match(exec.executionResult.message ?? '', /executionId: agx-/);
    assert.equal(exec.session.currentState, 'VALIDATING');

    // L — isolation tenant/projet
    assert.equal(fileSource.getFile('tenant-autre', projectId, 'src/registry-e34.ts'), null);
    assert.equal(fileSource.getFile(tenantId, 'proj-autre', 'src/registry-e34.ts'), null);

    // O — single writer : le contenu écrit = l'artifact, transaction réelle
    assert.match(exec.executionResult.message ?? '', /tx=/);
  });

  // =========================================================================
  // Routing direct déterministe
  // =========================================================================
  it('Routage direct: routeIntentToAgent résout via le registry (déterministe, capability en dur supprimée)', () => {
    const registry = service.getExecutionAgentRegistry();
    const intent = { category: 'CREATE', goal: 'créer un fichier', confidence: 0.9 } as never;

    const route = routeIntentToAgent({
      intent,
      userMessage: 'Crée le fichier src/route.ts module',
      sessionId: 'sess-x',
      planId: 'plan-x',
      registry
    });

    assert.equal(route.supported, true);
    assert.equal(route.agentId, 'reference-agent', 'résolu PAR LE REGISTRY (capability FILE_MUTATION), plus en dur');
    assert.deepEqual([...(route.requiredCapabilities ?? [])], ['FILE_MUTATION']);
    assert.equal(route.task?.requiredContext.targetFiles?.[0], 'src/route.ts');
    assert.equal(route.executionId, 'agx-sess-x-plan-x');

    // Même entrée → même route
    const again = routeIntentToAgent({ intent, userMessage: 'Crée le fichier src/route.ts module', sessionId: 'sess-x', planId: 'plan-x', registry });
    assert.equal(again.agentId, route.agentId);
    assert.deepEqual(again.task, route.task);
  });
});
