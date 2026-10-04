/**
 * ÉTAPE 35 — Exécution réelle, vérification, rollback, cancellation
 *
 * Toutes les exécutions traversent le VRAI pipeline : Registry → agent →
 * artifact → MutationBridge → MutationOrchestratorService (single writer) →
 * FileStore. La vérification observe la source réelle ; le rollback passe
 * par le MutationOrchestratorService ; la cancellation est un fait observé
 * aux points de contrôle du cycle. Aucun mock de succès.
 *
 * Deux sources de test instrumentées (le pipeline reste réel) :
 * - CorruptWriteSource : écrit un contenu divergent de l'artifact →
 *   simule une divergence RÉELLE entre l'artifact et le store, détectée par
 *   la vérification (jamais par le retour du mutateur).
 * - FailingDeleteSource : la restauration échoue → FAILED_ROLLBACK honnête.
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
  BaseSpecializedAgent,
  ReferenceAgent,
  auditStore,
  type AgentTask,
  type AgentResult,
  type IMutableFileSource
} from '../../../src/index.js';

/** Source dont l'écriture CORROMPT le contenu (divergence réelle artifact/store). */
class CorruptWriteSource extends InMemoryMutableFileSource {
  public corrupted = 0;
  public override createFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    this.corrupted += 1;
    super.createFile(tenantId, projectId, filePath, content + '\n// CORRUPTED-BY-STORE\n');
  }
}

/** Source dont la suppression échoue (restauration impossible). */
class FailingDeleteSource extends InMemoryMutableFileSource {
  public failDelete = false;
  public override deleteFile(tenantId: string, projectId: string, filePath: string): boolean {
    if (this.failDelete) throw new Error('DELETE_FAILED: suppression impossible (source défaillante)');
    return super.deleteFile(tenantId, projectId, filePath);
  }
}

/** Agent stub émettant l'artifact demandé (RENAME/MOVE/CORRUPT CREATE). */
class StubArtifactAgent extends BaseSpecializedAgent {
  constructor(
    id: string,
    private readonly artifactFactory: (taskId: string) => {
      filePath: string;
      operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME' | 'MOVE';
      proposedContent?: string;
      newPath?: string;
    }
  ) {
    super(
      {
        id, name: `Stub ${id}`, domain: 'ARCHITECTURE',
        capabilities: ['FILE_MUTATION'],
        description: `agent stub É35 ${id}`,
        riskLevel: 'LOW', requiredProviderCapabilities: [], allowedTools: []
      },
      undefined
    );
  }
  public override async executeTask(params: { task: AgentTask }): Promise<AgentResult> {
    const spec = this.artifactFactory(params.task.id);
    return {
      taskId: params.task.id, agentId: this.definition.id, status: 'SUCCESS', degraded: false,
      artifacts: [
        {
          id: `art-${params.task.id}`, taskId: params.task.id, agentId: this.definition.id,
          domain: 'ARCHITECTURE', kind: 'PROPOSED_FILE_CHANGE', targetFiles: [spec.filePath],
          payload: {
            filePath: spec.filePath, operation: spec.operation,
            ...(spec.proposedContent !== undefined ? { proposedContent: spec.proposedContent } : {}),
            ...(spec.newPath !== undefined ? { newPath: spec.newPath } : {}),
            reason: `stub É35 ${this.definition.id}`
          },
          confidence: 1, hash: `h-${this.definition.id}-${params.task.id}`, summary: 'stub É35'
        }
      ],
      conflicts: [], tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 1
    };
  }
  protected buildArtifacts(): readonly [] { return []; }
}

describe('ÉTAPE 35 — Exécution réelle, vérification, rollback, cancellation', () => {
  let tenantId: string;
  let projectId: string;
  let seq = 0;

  beforeEach(() => {
    seq += 1;
    tenantId = 'tenant-e35';
    projectId = `proj-e35-${seq}`;
  });

  /** Monte la vraie chaîne : Registry + bridge + MutationOrchestrator + observateur. */
  function makeChain(source: IMutableFileSource) {
    const codeIntel = new CodeIntelligenceService(source);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, source);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(source, codeIntel, dna, graph, impact);
    const registry = new AgentRegistryService();
    registry.register(new ReferenceAgent());
    const executor = new AgentExecutionService(registry, new MutationBridge(mutationOrchestrator), source);
    return { source, registry, executor, mutationOrchestrator };
  }

  function task(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
      id: `task-e35-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Tâche É35', description: '', domain: 'ARCHITECTURE', priority: 1,
      dependencies: [], requiredContext: { targetFiles: ['src/target.ts'] },
      requiredCapabilities: ['FILE_MUTATION'], status: 'READY', operation: 'CREATE',
      retryCount: 0, maxRetries: 0, ...overrides
    };
  }

  const ctx = { relevantFiles: {}, relevantSymbols: [], decisions: [], constraints: [], recentHistory: [] };

  it('A: CREATE réelle + vérification des contrôles → SUCCESS avec timeline complète', async () => {
    const { source, executor } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await executor.execute({
      executionId: 'agx-e35-a', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.mutation.executed, true);
    assert.equal(outcome.verification.performed, true);
    assert.equal(outcome.verification.passed, true, 'vérification RÉELLE de la source');
    // Contrôles concrets du CREATE
    const labels = outcome.verification.checks.map((c) => c.check);
    assert.ok(labels.some((l) => l.includes('absent avant')));
    assert.ok(labels.some((l) => l.includes('présent après')));
    assert.ok(labels.some((l) => l.includes('contenu identique')));
    // Timeline observable (P)
    const phaseNames = outcome.phases.map((p) => p.phase);
    for (const expected of ['AGENT_STARTED', 'ARTIFACT_PRODUCED', 'SNAPSHOT_TAKEN', 'MUTATION_STARTED', 'MUTATION_APPLIED', 'VERIFICATION_STARTED', 'VERIFICATION_PASSED', 'FINAL_SUCCESS']) {
      assert.ok(phaseNames.includes(expected), `phase ${expected} attendue`);
    }
    // O — executionId conservé
    assert.equal(outcome.executionId, 'agx-e35-a');
    assert.ok(outcome.mutation.transactionId);
  });

  it('B: UPDATE réelle + contenu vérifié (avant présent, contenu = artifact)', async () => {
    const base = new InMemoryMutableFileSource({});
    base.createFile(tenantId, projectId, 'src/target.ts', 'export const old = 1;\n');
    const { executor } = makeChain(base);

    const outcome = await executor.execute({
      executionId: 'agx-e35-b', agentId: 'reference-agent',
      task: task({ operation: 'MODIFY' }),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.verification.passed, true);
    const written = base.getFile(tenantId, projectId, 'src/target.ts')!;
    assert.notEqual(written.content, 'export const old = 1;\n');
    assert.match(written.content, /reference-agent/);
  });

  it('C: DELETE réelle + absence vérifiée', async () => {
    const base = new InMemoryMutableFileSource({});
    base.createFile(tenantId, projectId, 'src/target.ts', 'export const doomed = 1;\n');
    const { executor } = makeChain(base);

    const outcome = await executor.execute({
      executionId: 'agx-e35-c', agentId: 'reference-agent',
      task: task({ operation: 'DELETE' }),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.verification.passed, true);
    assert.equal(base.getFile(tenantId, projectId, 'src/target.ts'), null, 'fichier réellement supprimé');
  });

  it('D: RENAME réelle — ancienne absente, nouvelle présente, contenu conservé', async () => {
    const base = new InMemoryMutableFileSource({});
    base.createFile(tenantId, projectId, 'src/old-name.ts', 'export const kept = true;\n');
    const { executor, registry } = makeChain(base);
    registry.register(new StubArtifactAgent('stub-rename', () => ({
      filePath: 'src/old-name.ts', operation: 'RENAME', newPath: 'src/new-name.ts'
    })));

    const outcome = await executor.execute({
      executionId: 'agx-e35-d', agentId: 'stub-rename',
      task: task({ requiredContext: { targetFiles: ['src/old-name.ts'] } }),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.verification.passed, true, JSON.stringify(outcome.verification.checks));
    assert.equal(base.getFile(tenantId, projectId, 'src/old-name.ts'), null);
    assert.equal(base.getFile(tenantId, projectId, 'src/new-name.ts')!.content, 'export const kept = true;\n');
  });

  it('E: MOVE réelle — ancienne localisation absente, nouvelle présente, contenu conservé', async () => {
    const base = new InMemoryMutableFileSource({});
    base.createFile(tenantId, projectId, 'src/here.ts', 'export const moved = 42;\n');
    const { executor, registry } = makeChain(base);
    registry.register(new StubArtifactAgent('stub-move', () => ({
      filePath: 'src/here.ts', operation: 'MOVE', newPath: 'lib/there.ts'
    })));

    const outcome = await executor.execute({
      executionId: 'agx-e35-e', agentId: 'stub-move',
      task: task({ requiredContext: { targetFiles: ['src/here.ts'] } }),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.verification.passed, true);
    assert.equal(base.getFile(tenantId, projectId, 'src/here.ts'), null);
    assert.equal(base.getFile(tenantId, projectId, 'lib/there.ts')!.content, 'export const moved = 42;\n');
  });

  it('F+G+H: divergence réelle après mutation → jamais SUCCESS → ROLLBACK réel → état initial exact', async () => {
    // La source corrompt l'écriture : le store ne contient PAS le contenu de
    // l'artifact — la vérification (qui observe la source) le détecte.
    const corrupt = new CorruptWriteSource();
    const { executor } = makeChain(corrupt);

    const outcome = await executor.execute({
      executionId: 'agx-e35-fgh', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });

    // F — jamais SUCCESS malgré une mutation exécutée
    assert.equal(outcome.mutation.executed, true, 'la mutation a réellement eu lieu');
    assert.notEqual(outcome.status, 'SUCCESS');
    assert.equal(outcome.status, 'ROLLED_BACK');
    assert.equal(outcome.verification.passed, false, 'la divergence est détectée');
    assert.ok(outcome.verification.checks.some((c) => !c.passed && c.check.includes('contenu identique')));

    // G+H — rollback RÉEL exécuté et vérifié : retour exact à l'état initial
    assert.equal(outcome.rollback.performed, true);
    assert.equal(outcome.rollback.verified, true);
    assert.equal(corrupt.getFile(tenantId, projectId, 'src/target.ts'), null, 'état initial restauré (fichier absent)');
    assert.ok(corrupt.corrupted >= 1, 'la source a réellement écrit (divergence réelle, pas simulée)');

    // Timeline du rollback
    const phaseNames = outcome.phases.map((p) => p.phase);
    assert.ok(phaseNames.includes('VERIFICATION_FAILED'));
    assert.ok(phaseNames.includes('FINAL_ROLLED_BACK'));
  });

  it('I: rollback impossible → FAILED_ROLLBACK honnête (jamais SUCCESS ni ROLLED_BACK)', async () => {
    // Divergence réelle (corruption) + restauration impossible (delete échoue).
    class CorruptAndFailingDelete extends CorruptWriteSource {
      public override deleteFile(t: string, p: string, f: string): boolean {
        throw new Error('DELETE_FAILED: restauration impossible');
      }
    }
    const failing = new CorruptAndFailingDelete();
    const { executor } = makeChain(failing);

    const outcome = await executor.execute({
      executionId: 'agx-e35-i', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILED_ROLLBACK');
    assert.equal(outcome.mutation.executed, true);
    assert.equal(outcome.verification.passed, false);
    assert.equal(outcome.rollback.verified, false);
    assert.match(outcome.error ?? '', /FAILED_ROLLBACK/);
  });

  it('J: cancellation AVANT l agent → CANCELLED, aucun agent exécuté, aucune mutation', async () => {
    const { source, executor } = makeChain(new InMemoryMutableFileSource({}));
    const controller = new AbortController();
    controller.abort();

    const outcome = await executor.execute({
      executionId: 'agx-e35-j', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', signal: controller.signal
    });

    assert.equal(outcome.status, 'CANCELLED');
    assert.equal(outcome.cancellation.at, 'BEFORE_AGENT');
    assert.equal(outcome.mutation.executed, false);
    assert.equal(source.getFile(tenantId, projectId, 'src/target.ts'), null);
    assert.equal(outcome.result.status, 'FAILURE', 'aucun agent n a réellement travaillé');
  });

  it('K: cancellation entre agent et mutation → CANCELLED, artifacts produits mais AUCUNE écriture', async () => {
    const { source, executor, registry } = makeChain(new InMemoryMutableFileSource({}));
    // Agent qui annule le contrôleur APRÈS avoir produit son artifact :
    // la cancellation devient un fait observable au point de contrôle C.
    class CancelAfterArtifactAgent extends StubArtifactAgent {
      constructor(private readonly controller: AbortController) {
        super('stub-cancel-c', () => ({ filePath: 'src/target.ts', operation: 'CREATE', proposedContent: '// x\n' }));
      }
      public override async executeTask(params: { task: AgentTask }): Promise<AgentResult> {
        const res = await super.executeTask(params);
        this.controller.abort();
        return res;
      }
    }
    const controller = new AbortController();
    registry.register(new CancelAfterArtifactAgent(controller));

    const outcome = await executor.execute({
      executionId: 'agx-e35-k', agentId: 'stub-cancel-c', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', signal: controller.signal
    });

    assert.equal(outcome.status, 'CANCELLED');
    assert.equal(outcome.cancellation.at, 'BEFORE_MUTATION');
    assert.equal(outcome.artifacts.length, 1, 'l artifact a bien été produit (agent réel)');
    assert.equal(outcome.mutation.executed, false, 'aucune mutation');
    assert.equal(source.getFile(tenantId, projectId, 'src/target.ts'), null, 'aucun fichier écrit');
  });

  it('L: cancellation APRÈS mutation → rollback réel vérifié → CANCELLED sans fausse déclaration', async () => {
    const { source, executor, registry } = makeChain(new InMemoryMutableFileSource({}));
    class CancelAfterMutationBridge extends MutationBridge {
      public constructor(service: MutationOrchestratorService, private readonly controller: AbortController) {
        super(service);
      }
      public override applyArtifacts(params: Parameters<MutationBridge['applyArtifacts']>[0]) {
        const res = super.applyArtifacts(params);
        this.controller.abort();
        return res;
      }
    }
    const controller = new AbortController();
    // Chaîne dédiée avec le bridge qui déclenche la cancellation juste après
    // la mutation appliquée (la mutation est RÉELLEMENT passée).
    const codeIntel = new CodeIntelligenceService(source);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, source);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(source, codeIntel, dna, graph, impact);
    const registryL = new AgentRegistryService();
    registryL.register(new ReferenceAgent());
    const executorL = new AgentExecutionService(
      registryL,
      new CancelAfterMutationBridge(mutationOrchestrator, controller),
      source
    );

    const outcome = await executorL.execute({
      executionId: 'agx-e35-l', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', signal: controller.signal
    });

    // La mutation a réellement été appliquée : on ne prétend PAS l'annuler sans rollback.
    assert.equal(outcome.mutation.executed, true);
    assert.equal(outcome.cancellation.at, 'AFTER_MUTATION');
    assert.equal(outcome.rollback.performed, true, 'rollback réel déclenché');
    assert.equal(outcome.rollback.verified, true, 'restauration vérifiée');
    assert.equal(outcome.status, 'CANCELLED', 'CANCELLED seulement parce que le rollback est vérifié');
    assert.equal(source.getFile(tenantId, projectId, 'src/target.ts'), null, 'état initial restauré');
  });

  it('M: isolation tenant/projet — aucune lecture ni restauration croisée', async () => {
    const { source, executor } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await executor.execute({
      executionId: 'agx-e35-m', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    assert.equal(outcome.status, 'SUCCESS');
    assert.ok(source.getFile(tenantId, projectId, 'src/target.ts'));
    assert.equal(source.getFile('tenant-autre', projectId, 'src/target.ts'), null);
    assert.equal(source.getFile(tenantId, 'proj-autre', 'src/target.ts'), null);
  });

  it('N: single-writer — le contenu écrit traverse exactement le payload de l artifact (via AINT-006)', async () => {
    const { source, executor } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await executor.execute({
      executionId: 'agx-e35-n', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    assert.equal(outcome.status, 'SUCCESS');
    const payload = outcome.artifacts[0]!.payload as { proposedContent?: string; filePath?: string };
    const written = source.getFile(tenantId, projectId, payload.filePath!)!;
    assert.equal(written.content, payload.proposedContent, 'aucun contournement du single writer');
    assert.match(outcome.mutation.transactionId ?? '', /^tx-/, 'transaction AINT-006 réelle');
  });

  it('P: audit timeline — événement AGENT_EXECUTED avec phases complètes', async () => {
    const { executor } = makeChain(new InMemoryMutableFileSource({}));
    await executor.execute({
      executionId: 'agx-e35-p', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    const events = auditStore.query(tenantId, { action: 'AGENT_EXECUTED' });
    const audit = events.find((e) => e.resourceId === 'agx-e35-p');
    assert.ok(audit, 'événement présent');
    const metadata = audit.metadata as Record<string, unknown>;
    assert.equal(metadata['agentId'], 'reference-agent');
    assert.equal(metadata['verificationPassed'], true);
    const phases = metadata['phases'] as string[];
    for (const expected of ['AGENT_STARTED', 'ARTIFACT_PRODUCED', 'MUTATION_STARTED', 'MUTATION_APPLIED', 'VERIFICATION_PASSED', 'FINAL_SUCCESS']) {
      assert.ok(phases.includes(expected), `phase auditée ${expected}`);
    }
  });

  it('Q: aucun node:fs ni écriture directe dans le code de production É35', () => {
    const files = [
      'packages/core/src/ai-native/ai-orchestrator/execution/agent-execution.ts',
      'packages/core/src/ai-native/ai-orchestrator/engine/mutation-bridge.ts',
      'packages/core/src/ai-native/ai-orchestrator/registry/agent-registry.ts'
    ];
    for (const rel of files) {
      const full = resolve(process.cwd(), rel);
      assert.ok(existsSync(full), `${rel} accessible`);
      const content = readFileSync(full, 'utf8');
      assert.doesNotMatch(content, /from 'node:fs'/, `${rel} n importe pas node:fs`);
      assert.doesNotMatch(content, /writeFileSync|writeFile\(/, `${rel} n écrit pas directement`);
    }
  });

  it('Sécurité: sans observateur réel (NULL_FILE_OBSERVER), une mutation ne peut JAMAIS être SUCCESS', async () => {
    // Un orchestrateur câblé sans fileObserver : la vérification est
    // structurellement impossible → tout succès de mutation est interdit.
    const { NULL_FILE_OBSERVER, AIOrchestratorService } = await import('../../../src/index.js');
    const base = new InMemoryMutableFileSource({});
    const codeIntel = new CodeIntelligenceService(base);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, base);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(base, codeIntel, dna, graph, impact);
    const svc = new AIOrchestratorService(undefined, undefined, mutationOrchestrator, undefined, undefined, undefined, undefined);

    const outcome = await svc.executeAgent({
      executionId: 'agx-e35-null', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });

    assert.notEqual(outcome.status, 'SUCCESS', 'sans observateur, aucun succès de mutation déclarable');
    assert.equal(outcome.verification.performed, true);
    assert.equal(outcome.verification.passed, false);
    assert.ok(['ROLLED_BACK', 'FAILED_ROLLBACK', 'FAILURE'].includes(outcome.status));
    assert.equal(NULL_FILE_OBSERVER.getFile('x', 'y', 'z'), null);
  });
});
