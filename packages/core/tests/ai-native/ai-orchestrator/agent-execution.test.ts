/**
 * ÉTAPE 32 — Contrat réel d'exécution d'agent (Agent Execution Contract)
 *
 * Les tests traversent le VRAI pipeline : AgentExecutionService → agent réel
 * (reference-agent déterministe) → MutationBridge → MutationOrchestratorService
 * → InMemoryMutableFileSource. Aucun mock de succès, aucune fausse transaction :
 * un fichier écrit est vérifié dans la source, un échec remonte FAILED.
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
  AgentExecutionService,
  MutationBridge,
  AgentRegistryService,
  BaseSpecializedAgent,
  ReferenceAgent,
  REFERENCE_AGENT_ID,
  auditStore,
  type AgentTask,
  type AgentResult
} from '../../../src/index.js';
import type { AIProviderRegistry } from '../../../src/index.js';

describe('ÉTAPE 32 — Contrat réel d exécution d agent', () => {
  let fileSource: InMemoryMutableFileSource;
  let service: AIOrchestratorService;
  let tenantId: string;
  let projectId: string;
  let runSeq = 0;

  beforeEach(() => {
    runSeq += 1;
    tenantId = 'tenant-e32';
    projectId = `proj-e32-${runSeq}`;
    fileSource = new InMemoryMutableFileSource({
      [`${tenantId}:${projectId}`]: {
        'src/existing.ts': 'export const existing = true;\n'
      }
    });
    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    service = new AIOrchestratorService(
      undefined, // understanding
      undefined, // impact
      mutationOrchestrator, // mutation — RÉEL (single writer)
      undefined, // dna
      undefined, // graph
      undefined, // provider
      undefined,
      fileSource // ÉTAPE 35 — observateur réel de la source
    );
  });

  /** Construit une tâche de mutation de fichier (type existant AgentTask). */
  function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
      id: `task-e32-${runSeq}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Créer le module de démonstration',
      description: 'Tâche de démonstration du contrat É32',
      domain: 'ARCHITECTURE',
      priority: 1,
      dependencies: [],
      requiredContext: { targetFiles: ['src/demo.ts'] },
      requiredCapabilities: ['SERVICE_LOGIC'],
      status: 'READY',
      operation: 'CREATE',
      retryCount: 0,
      maxRetries: 0,
      ...overrides
    };
  }

  function makeContext() {
    return { relevantFiles: {}, relevantSymbols: [], decisions: [], constraints: [], recentHistory: [] };
  }

  // =========================================================================
  // A / B — résolution d'agent
  // =========================================================================
  it('A: agent enregistré → résolution réelle (reference-agent + 5 agents de domaine)', () => {
    assert.equal(service.hasExecutionAgent(REFERENCE_AGENT_ID), true, 'reference-agent résolu par ID');
    const ids = service.listExecutionAgents();
    assert.ok(ids.includes('reference-agent'));
    for (const domainAgent of ['agent-ui-specialist', 'agent-backend-specialist', 'agent-data-specialist', 'agent-security-specialist', 'agent-test-specialist']) {
      assert.ok(ids.includes(domainAgent), `${domainAgent} dans le roster (mêmes instances que le scheduler)`);
    }
  });

  it('B: agent inconnu → JAMAIS success, échec réel explicite', async () => {
    const outcome = await service.executeAgent({
      executionId: 'agx-unknown-1',
      agentId: 'agent-qui-n-existe-pas',
      task: makeTask(),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILURE');
    assert.equal(outcome.mutation.executed, false);
    assert.match(outcome.error ?? '', /AGENT_UNKNOWN/);
    assert.match(outcome.result.error ?? '', /AGENT_UNKNOWN/);
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/demo.ts'), null, 'aucun fichier écrit');
  });

  // =========================================================================
  // C → G — exécution réelle complète (agent → artifact → mutation → fichier)
  // =========================================================================
  it('C→G: tâche valide → agent exécuté → artifact → mutation COMMITTED → fichier réellement écrit', async () => {
    const outcome = await service.executeAgent({
      executionId: 'agx-happy-1',
      agentId: REFERENCE_AGENT_ID,
      task: makeTask(),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    // C — agent exécuté réellement
    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.result.status, 'SUCCESS');
    assert.equal(outcome.agentId, REFERENCE_AGENT_ID);
    assert.equal(outcome.result.degraded, false, 'agent déterministe : non dégradé');
    assert.equal(outcome.result.tokensUsed.totalTokens, 0, 'aucun LLM : 0 token');

    // D — résultat agent réellement transmis au runtime (contrat)
    assert.equal(outcome.result.taskId, outcome.taskId);

    // E — artifact réellement produit
    assert.equal(outcome.artifacts.length, 1);
    const artifact = outcome.artifacts[0]!;
    assert.equal(artifact.kind, 'PROPOSED_FILE_CHANGE');
    assert.equal(artifact.taskId, outcome.taskId);
    assert.ok(artifact.hash.length > 0, 'artifact hashé (traçable)');

    // F — mutation réellement exécutée (transaction réelle, pas mock)
    assert.equal(outcome.mutation.requested, true);
    assert.equal(outcome.mutation.executed, true);
    assert.ok(outcome.mutation.transactionId, 'transactionId réel présent');
    assert.equal(outcome.mutation.appliedCount, 1);

    // G — fichier réellement écrit avec le contenu de l'artifact
    const written = fileSource.getFile(tenantId, projectId, 'src/demo.ts');
    assert.ok(written, 'le fichier existe dans la source après exécution');
    const payload = artifact.payload as { proposedContent?: string };
    assert.equal(written.content, payload.proposedContent, 'le contenu écrit = le contenu de l artifact (aucun contournement)');
    assert.match(written.content, /reference-agent/);
    assert.match(written.content, /REFERENCE_TASK_TITLE/);
  });

  // =========================================================================
  // H / J — mutation refusée / aucun faux succès
  // =========================================================================
  it('H: mutation refusée (CREATE sur fichier existant) → FAILED réel, fichier intact', async () => {
    const before = fileSource.getFile(tenantId, projectId, 'src/existing.ts')!.content;
    const outcome = await service.executeAgent({
      executionId: 'agx-refused-1',
      agentId: REFERENCE_AGENT_ID,
      task: makeTask({ requiredContext: { targetFiles: ['src/existing.ts'] }, operation: 'CREATE' }),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILURE', 'la mutation refusée ne doit JAMAIS être un succès');
    assert.equal(outcome.mutation.executed, false);
    assert.ok(outcome.error, 'erreur réelle propagée');
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/existing.ts')!.content, before, 'fichier inchangé');
  });

  it('I: exception agent → FAILED + erreur propagée, jamais success', async () => {
    class ThrowingAgent extends BaseSpecializedAgent {
      constructor() {
        super(
          {
            id: 'throwing-agent',
            name: 'Throwing Agent',
            domain: 'ARCHITECTURE',
            capabilities: ['SERVICE_LOGIC'],
            description: 'agent qui échoue systématiquement (test du contrat d échec)',
            riskLevel: 'LOW',
            requiredProviderCapabilities: [],
            allowedTools: []
          },
          undefined
        );
      }
      public override async executeTask(): Promise<AgentResult> {
        throw new Error('BOOM_AGENT_EXCEPTION: échec volontaire du test');
      }
      protected buildArtifacts(): readonly [] {
        return [];
      }
    }

    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    const throwingRegistry = new AgentRegistryService();
    throwingRegistry.register(new ThrowingAgent());
    const directExecutor = new AgentExecutionService(throwingRegistry, new MutationBridge(mutationOrchestrator), fileSource);

    const outcome = await directExecutor.execute({
      executionId: 'agx-throw-1',
      agentId: 'throwing-agent',
      task: makeTask(),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILURE');
    assert.match(outcome.error ?? '', /BOOM_AGENT_EXCEPTION/);
    assert.equal(outcome.mutation.executed, false);
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/demo.ts'), null);
  });

  it('I-bis: agent sans résultat attendu (SUCCESS sans artifact sur tâche de mutation) → JAMAIS success artificiel', async () => {
    class EmptyAgent extends BaseSpecializedAgent {
      constructor() {
        super(
          {
            id: 'empty-agent',
            name: 'Empty Agent',
            domain: 'ARCHITECTURE',
            capabilities: ['SERVICE_LOGIC'],
            description: 'agent qui déclare un succès sans produire d artifact',
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
          agentId: 'empty-agent',
          status: 'SUCCESS',
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

    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    const emptyRegistry = new AgentRegistryService();
    emptyRegistry.register(new EmptyAgent());
    const directExecutor = new AgentExecutionService(emptyRegistry, new MutationBridge(mutationOrchestrator), fileSource);

    const outcome = await directExecutor.execute({
      executionId: 'agx-empty-1',
      agentId: 'empty-agent',
      task: makeTask(),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILURE', 'un succès sans artifact de mutation est un échec réel');
    assert.match(outcome.error ?? '', /NO_EXPECTED_RESULT/);
    assert.equal(outcome.mutation.executed, false);
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/demo.ts'), null);
  });

  it('I-ter: artifact invalide (payload malformé) → FAILED', async () => {
    class MalformedAgent extends BaseSpecializedAgent {
      constructor() {
        super(
          {
            id: 'malformed-agent',
            name: 'Malformed Agent',
            domain: 'ARCHITECTURE',
            capabilities: ['SERVICE_LOGIC'],
            description: 'agent produisant un artifact invalide',
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
          agentId: 'malformed-agent',
          status: 'SUCCESS',
          artifacts: [
            {
              id: 'art-bad',
              taskId: params.task.id,
              agentId: 'malformed-agent',
              domain: 'ARCHITECTURE',
              kind: 'PROPOSED_FILE_CHANGE',
              targetFiles: ['src/demo.ts'],
              payload: { operation: 'CREATE' }, // filePath manquant
              confidence: 1,
              hash: 'h',
              summary: 'artifact invalide'
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

    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(fileSource, codeIntel, dna, graph, impact);
    const malformedRegistry = new AgentRegistryService();
    malformedRegistry.register(new MalformedAgent());
    const directExecutor = new AgentExecutionService(malformedRegistry, new MutationBridge(mutationOrchestrator), fileSource);

    const outcome = await directExecutor.execute({
      executionId: 'agx-bad-1',
      agentId: 'malformed-agent',
      task: makeTask(),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILURE');
    assert.match(outcome.error ?? '', /INVALID_ARTIFACT/);
    assert.equal(outcome.mutation.executed, false);
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/demo.ts'), null);
  });

  // =========================================================================
  // K — traçabilité de bout en bout
  // =========================================================================
  it('K: executionId conservé du début à la fin + événement d audit AGENT_EXECUTED', async () => {
    const outcome = await service.executeAgent({
      executionId: 'agx-trace-42',
      agentId: REFERENCE_AGENT_ID,
      task: makeTask(),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    assert.equal(outcome.executionId, 'agx-trace-42');
    assert.equal(outcome.result.taskId, outcome.taskId);
    assert.ok(outcome.startedAt <= outcome.completedAt);
    assert.ok(outcome.durationMs >= 0);

    // Observabilité : "quel agent a réellement travaillé ?"
    const events = auditStore.query(tenantId, { action: 'AGENT_EXECUTED' });
    const audit = events.find((e) => e.resourceId === 'agx-trace-42');
    assert.ok(audit, 'événement AGENT_EXECUTED présent dans le store d audit');
    assert.equal(audit.resourceType, 'AGENT_EXECUTION');
    assert.equal(audit.status, 'SUCCESS');
    const metadata = audit.metadata as Record<string, unknown>;
    assert.equal(metadata['agentId'], REFERENCE_AGENT_ID);
    assert.equal(metadata['mutationExecuted'], true);
    assert.equal(metadata['appliedCount'], 1);
  });

  // =========================================================================
  // L — isolation tenant/projet
  // =========================================================================
  it('L: isolation tenant/projet — le fichier est écrit pour CE tenant/projet uniquement', async () => {
    const outcome = await service.executeAgent({
      executionId: 'agx-iso-1',
      agentId: REFERENCE_AGENT_ID,
      task: makeTask(),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'SUCCESS');
    assert.ok(fileSource.getFile(tenantId, projectId, 'src/demo.ts'), 'fichier visible pour le tenant/projet cible');
    assert.equal(fileSource.getFile('tenant-autre', projectId, 'src/demo.ts'), null, 'invisible pour un autre tenant');
    assert.equal(fileSource.getFile(tenantId, 'proj-autre', 'src/demo.ts'), null, 'invisible pour un autre projet');
  });

  // =========================================================================
  // M — capability non possédée
  // =========================================================================
  it('M: capability non supportée → JAMAIS success, aucun fichier écrit', async () => {
    const outcome = await service.executeAgent({
      executionId: 'agx-cap-1',
      agentId: REFERENCE_AGENT_ID,
      task: makeTask({ requiredCapabilities: ['VULNERABILITY_SCAN', 'E2E_SCENARIO'] }),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILURE');
    assert.match(outcome.error ?? '', /CAPABILITY_UNSUPPORTED/);
    assert.match(outcome.error ?? '', /VULNERABILITY_SCAN/);
    assert.equal(outcome.mutation.executed, false);
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/demo.ts'), null);
  });

  // =========================================================================
  // N — déterminisme
  // =========================================================================
  it('N: reference-agent déterministe — même tâche → mêmes octets, sur des projets frais', async () => {
    const sharedTask = makeTask();
    const outcome1 = await service.executeAgent({
      executionId: 'agx-det-1',
      agentId: REFERENCE_AGENT_ID,
      task: sharedTask,
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    // Deuxième projet frais (même tenant) : MÊME tâche → même contenu.
    const projectId2 = `${projectId}-det2`;
    const outcome2 = await service.executeAgent({
      executionId: 'agx-det-2',
      agentId: REFERENCE_AGENT_ID,
      task: sharedTask,
      context: makeContext(),
      tenantId,
      projectId: projectId2,
      userRole: 'OWNER'
    });

    assert.equal(outcome1.status, 'SUCCESS');
    assert.equal(outcome2.status, 'SUCCESS');
    const content1 = fileSource.getFile(tenantId, projectId, 'src/demo.ts')!.content;
    const content2 = fileSource.getFile(tenantId, projectId2, 'src/demo.ts')!.content;
    assert.equal(content1, content2, 'même tâche → mêmes octets (déterministe)');
    assert.match(content1, /REFERENCE_TASK_ID/);
  });

  // =========================================================================
  // O — aucun contournement du single writer
  // =========================================================================
  it('O: la mutation passe obligatoirement par MutationOrchestratorService (transaction réelle, contenu exact)', async () => {
    const outcome = await service.executeAgent({
      executionId: 'agx-sw-1',
      agentId: REFERENCE_AGENT_ID,
      task: makeTask({ requiredContext: { targetFiles: ['src/existing2.ts'] }, operation: 'CREATE' }),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'SUCCESS');
    // La transaction est réelle (AINT-006), l'applicationCount correspond,
    // et le contenu écrit provient EXACTEMENT de l'artifact de l'agent.
    assert.ok(outcome.mutation.transactionId);
    const artifact = outcome.artifacts[0]!;
    const payload = artifact.payload as { proposedContent?: string; filePath?: string };
    const written = fileSource.getFile(tenantId, projectId, payload.filePath!)!;
    assert.equal(written.content, payload.proposedContent);
    assert.match(outcome.mutation.transactionId ?? '', /^(tx|mut|plan)-|^tx/, 'transactionId au format AINT-006');
  });

  // =========================================================================
  // Agent de référence : registre + doublon + ANALYZE sans mutation
  // =========================================================================
  it('P: registerAgent refuse les doublons; tâche ANALYZE → succès sans mutation', async () => {
    const exec = (service as unknown as { agentExecution: AgentExecutionService }).agentExecution;
    assert.throws(() => exec.registerAgent(new ReferenceAgent()), /déjà enregistré/);

    const outcome = await service.executeAgent({
      executionId: 'agx-analyze-1',
      agentId: REFERENCE_AGENT_ID,
      task: makeTask({ operation: 'ANALYZE', requiredContext: { targetFiles: ['src/analyse.ts'] } }),
      context: makeContext(),
      tenantId,
      projectId,
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.mutation.requested, false, 'ANALYZE ne demande pas de mutation');
    assert.equal(outcome.mutation.executed, false);
    assert.equal(fileSource.getFile(tenantId, projectId, 'src/analyse.ts'), null, 'aucune écriture');
  });
});
