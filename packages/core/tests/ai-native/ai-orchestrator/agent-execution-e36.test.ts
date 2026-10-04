/**
 * ÉTAPE 36 — GATE → REPAIR (cycle de réparation contrôlée)
 *
 * Toutes les exécutions traversent le VRAI pipeline : Registry → agent →
 * artifact → MutationBridge → MutationOrchestratorService → FileStore.
 * Le repair est OPT-IN (repairPolicy) — É35 inchangé par défaut.
 * Anti-boucle structurelle : UNE seule tentative (pas de récursion).
 *
 * Sources instrumentées (divergence RÉELLE store/artifact, jamais simulée
 * par un booléen) :
 * - CorruptOnceSource : la PREMIÈRE écriture diverge, les suivantes sont
 *   conformes → repair → réapplication propre → re-Gate PASS ;
 * - CorruptAlwaysSource : TOUTE écriture diverge → repair → re-Gate FAIL →
 *   STOP (anti-boucle) ;
 * - PhantomDeleteSource : deleteFile ne supprime pas (divergence DELETE
 *   réelle) → cas non supporté → REPAIR_UNSUPPORTED.
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
  buildRepairPlan,
  classifyGateFailure,
  FileRepairService,
  type AgentTask,
  type AgentResult,
  type IMutableFileSource
} from '../../../src/index.js';

class CorruptOnceSource extends InMemoryMutableFileSource {
  public writes = 0;
  public override createFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    this.writes += 1;
    if (this.writes === 1) {
      super.createFile(tenantId, projectId, filePath, content + '\n// CORRUPTED-FIRST-WRITE\n');
      return;
    }
    super.createFile(tenantId, projectId, filePath, content);
  }
}

class CorruptAlwaysSource extends InMemoryMutableFileSource {
  public writes = 0;
  public override createFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    this.writes += 1;
    super.createFile(tenantId, projectId, filePath, content + '\n// CORRUPTED-ALWAYS\n');
  }
}

class PhantomDeleteSource extends InMemoryMutableFileSource {
  public override deleteFile(tenantId: string, projectId: string, filePath: string): boolean {
    // Ne supprime PAS : divergence DELETE réelle (fichier toujours présent).
    return true;
  }
}

describe('ÉTAPE 36 — GATE → REPAIR (réparation contrôlée)', () => {
  let tenantId: string;
  let projectId: string;
  let seq = 0;

  beforeEach(() => {
    seq += 1;
    tenantId = 'tenant-e36';
    projectId = `proj-e36-${seq}`;
  });

  function makeChain(source: IMutableFileSource, bridge?: MutationBridge) {
    const codeIntel = new CodeIntelligenceService(source);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, source);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(source, codeIntel, dna, graph, impact);
    const registry = new AgentRegistryService();
    registry.register(new ReferenceAgent());
    const executor = new AgentExecutionService(
      registry,
      bridge ?? new MutationBridge(mutationOrchestrator),
      source
    );
    return { source, registry, executor };
  }

  function task(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
      id: `task-e36-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Tâche É36', description: '', domain: 'ARCHITECTURE', priority: 1,
      dependencies: [], requiredContext: { targetFiles: ['src/target.ts'] },
      requiredCapabilities: ['FILE_MUTATION'], status: 'READY', operation: 'CREATE',
      retryCount: 0, maxRetries: 0, ...overrides
    };
  }

  const ctx = { relevantFiles: {}, relevantSymbols: [], decisions: [], constraints: [], recentHistory: [] };
  const POLICY = { enabled: true, maxAttempts: 1 };

  // =========================================================================
  // A → E : Gate PASS sur chaque opération réelle
  // =========================================================================
  it('A: Gate PASS sur CREATE réel (gate exposé dans le résultat)', async () => {
    const { source, executor } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await executor.execute({
      executionId: 'agx-e36-a', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });
    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.gate?.passed, true);
    assert.equal(outcome.gate?.gateId, 'FILE_MUTATION_GATE');
    assert.equal(outcome.gate?.executionId, 'agx-e36-a');
    assert.ok(source.getFile(tenantId, projectId, 'src/target.ts'));
  });

  it('B: Gate PASS sur UPDATE réel', async () => {
    const base = new InMemoryMutableFileSource({});
    base.createFile(tenantId, projectId, 'src/target.ts', 'export const old = 1;\n');
    const { source, executor } = makeChain(base);
    const outcome = await executor.execute({
      executionId: 'agx-e36-b', agentId: 'reference-agent', task: task({ operation: 'MODIFY' }),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });
    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.gate?.passed, true);
    assert.match(source.getFile(tenantId, projectId, 'src/target.ts')!.content, /reference-agent/);
  });

  it('C: Gate PASS sur DELETE réel', async () => {
    const base = new InMemoryMutableFileSource({});
    base.createFile(tenantId, projectId, 'src/target.ts', 'export const doomed = 1;\n');
    const { source, executor } = makeChain(base);
    const outcome = await executor.execute({
      executionId: 'agx-e36-c', agentId: 'reference-agent', task: task({ operation: 'DELETE' }),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });
    assert.equal(outcome.status, 'SUCCESS');
    assert.equal(outcome.gate?.passed, true);
    assert.equal(source.getFile(tenantId, projectId, 'src/target.ts'), null);
  });

  it('D+E: Gate PASS sur RENAME et MOVE réels', async () => {
    // RENAME
    const baseRename = new InMemoryMutableFileSource({});
    baseRename.createFile(tenantId, projectId, 'src/old.ts', 'export const kept = 1;\n');
    const { registry: regR, executor: execR } = makeChain(baseRename);
    regR.register(new StubArtifactAgent('stub-rename', () => ({ filePath: 'src/old.ts', operation: 'RENAME', newPath: 'src/new.ts' })));
    const outcomeR = await execR.execute({
      executionId: 'agx-e36-d', agentId: 'stub-rename',
      task: task({ requiredContext: { targetFiles: ['src/old.ts'] } }),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });
    assert.equal(outcomeR.status, 'SUCCESS');
    assert.equal(outcomeR.gate?.passed, true);
    assert.equal(baseRename.getFile(tenantId, projectId, 'src/old.ts'), null);
    assert.equal(baseRename.getFile(tenantId, projectId, 'src/new.ts')!.content, 'export const kept = 1;\n');

    // MOVE
    const baseMove = new InMemoryMutableFileSource({});
    baseMove.createFile(tenantId, projectId, 'src/here.ts', 'export const moved = 2;\n');
    const { registry: regM, executor: execM } = makeChain(baseMove);
    regM.register(new StubArtifactAgent('stub-move', () => ({ filePath: 'src/here.ts', operation: 'MOVE', newPath: 'lib/there.ts' })));
    const outcomeM = await execM.execute({
      executionId: 'agx-e36-e', agentId: 'stub-move',
      task: task({ requiredContext: { targetFiles: ['src/here.ts'] } }),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });
    assert.equal(outcomeM.status, 'SUCCESS');
    assert.equal(outcomeM.gate?.passed, true);
    assert.equal(baseMove.getFile(tenantId, projectId, 'lib/there.ts')!.content, 'export const moved = 2;\n');
  });

  // =========================================================================
  // F → K : divergence réelle → Gate FAIL → réparation → re-Gate → COMMITTED
  // =========================================================================
  it('F→K: divergence réelle → Gate FAIL → RepairPlan → réparation → re-Gate PASS → COMMITTED réel', async () => {
    const corruptOnce = new CorruptOnceSource();
    const { source, executor } = makeChain(corruptOnce);

    const outcome = await executor.execute({
      executionId: 'agx-e36-fk', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });

    // H — classification correcte
    assert.equal(outcome.repair?.reason, 'VERIFICATION_FAILED');
    // I — RepairPlan généré (déterministe)
    assert.equal(outcome.repair?.repairId, 'rep-agx-e36-fk-1');
    assert.equal(outcome.repair?.planned, true);
    // J/K — réparation déterministe réussie → Gate PASS → COMMITTED réel
    assert.equal(outcome.repair?.attempted, true);
    assert.equal(outcome.repair?.attemptsUsed, 1);
    assert.equal(outcome.repair?.gateAfterPassed, true);
    assert.equal(outcome.status, 'SUCCESS', 'réparation + Gate PASS = succès réel');
    assert.equal(outcome.gate?.passed, true);
    assert.equal(outcome.gate?.gateId, 'FILE_MUTATION_GATE');
    // Le fichier persisté contient EXACTEMENT le contenu de l'artifact (pas la version corrompue)
    const payload = outcome.artifacts[0]!.payload as { proposedContent?: string };
    assert.equal(source.getFile(tenantId, projectId, 'src/target.ts')!.content, payload.proposedContent);
    assert.doesNotMatch(source.getFile(tenantId, projectId, 'src/target.ts')!.content, /CORRUPTED/);
    // Timeline complète É36
    const phases = outcome.phases.map((p) => p.phase);
    for (const expected of ['GATE_FAILED', 'REPAIR_PLANNED', 'REPAIR_STARTED', 'REPAIR_COMPLETED', 'FINAL_SUCCESS']) {
      assert.ok(phases.includes(expected), `phase ${expected} attendue`);
    }
  });

  it('G: Gate FAIL ne peut JAMAIS produire de succès sans réparation (É35 inchangé par défaut)', async () => {
    const corruptAlways = new CorruptAlwaysSource();
    const { executor } = makeChain(corruptAlways);
    // SANS repairPolicy → comportement É35 exact
    const outcome = await executor.execute({
      executionId: 'agx-e36-g', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER'
    });
    assert.equal(outcome.status, 'ROLLED_BACK');
    assert.equal(outcome.repair, undefined, 'aucune réparation sans politique');
    assert.equal(outcome.gate?.passed, false);
  });

  // =========================================================================
  // L + anti-boucle : réparation échoue → rollback réel → STOP (1 seule fois)
  // =========================================================================
  it('L+anti-boucle: réparation échoue (divergence persistante) → rollback réel → ROLLED_BACK, UNE seule tentative', async () => {
    const corruptAlways = new CorruptAlwaysSource();
    const { executor } = makeChain(corruptAlways);

    const outcome = await executor.execute({
      executionId: 'agx-e36-loop', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });

    // Gate FAIL après réparation → STOP définitif, pas de boucle
    assert.equal(outcome.repair?.attempted, true);
    assert.equal(outcome.repair?.attemptsUsed, 1, 'UNE seule tentative (maxAttempts=1)');
    assert.equal(outcome.repair?.gateAfterPassed, false, 'le re-Gate échoue (divergence persistante)');
    assert.equal(outcome.status, 'ROLLED_BACK');
    assert.equal(outcome.rollback.performed, true);
    assert.equal(outcome.rollback.verified, true);
    assert.equal(corruptAlways.getFile(tenantId, projectId, 'src/target.ts'), null, 'état initial restauré');

    // ANTI-BOUCLE : exactement un REPAIR_STARTED, aucun second
    const repairStarts = outcome.phases.filter((p) => p.phase === 'REPAIR_STARTED');
    assert.equal(repairStarts.length, 1, 'une seule tentative de réparation — jamais Repair→Repair');
    const phaseNames = outcome.phases.map((p) => p.phase);
    assert.ok(phaseNames.includes('REPAIR_FAILED'));
    assert.ok(phaseNames.includes('FINAL_ROLLED_BACK'));
  });

  it('M+N: maxAttempts=1 respecté et deuxième réparation interdite (structurellement)', async () => {
    const corruptAlways = new CorruptAlwaysSource();
    const { executor } = makeChain(corruptAlways);
    const outcome = await executor.execute({
      executionId: 'agx-e36-mn', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });
    assert.equal(outcome.repair?.attemptsUsed, 1);
    // Le cycle est linéaire : aucune phase REPAIR_STARTED au-delà de la première
    assert.equal(outcome.phases.filter((p) => p.phase === 'REPAIR_PLANNED').length, 1);
  });

  it('O: cas non supporté (DELETE divergent) → REPAIR_UNSUPPORTED, aucune mutation supplémentaire', async () => {
    const phantom = new PhantomDeleteSource();
    phantom.createFile(tenantId, projectId, 'src/target.ts', 'export const ghost = 1;\n');
    const { source, executor } = makeChain(phantom);

    const outcome = await executor.execute({
      executionId: 'agx-e36-o', agentId: 'reference-agent', task: task({ operation: 'DELETE' }),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });

    // La mutation "réussit" (COMMITTED) mais le fichier est toujours présent (divergence réelle)
    assert.equal(outcome.mutation.executed, true);
    assert.equal(outcome.gate?.passed, false);
    assert.equal(outcome.repair?.planned, true);
    assert.equal(outcome.repair?.attempted, false, 'aucune réparation tentée (cas non supporté)');
    assert.equal(outcome.status, 'ROLLED_BACK');
    assert.ok(source.getFile(tenantId, projectId, 'src/target.ts'), 'fichier toujours présent (état réel)');
  });

  it('P+Q+R: safety gate — mauvais executionId / tenant / artifact invalide → aucune réparation', () => {
    const repairService = new FileRepairService(new MutationBridge(undefined as never));
    const plan = buildRepairPlan({
      executionId: 'agx-original', attempt: 1, reason: 'VERIFICATION_FAILED',
      detail: 'x', targetPaths: ['src/a.ts'], maxAttempts: 1
    });
    const artifacts = [{
      id: 'a1', taskId: 't1', agentId: 'ref', domain: 'ARCHITECTURE', kind: 'PROPOSED_FILE_CHANGE',
      targetFiles: ['src/a.ts'], payload: { filePath: 'src/a.ts', operation: 'CREATE', proposedContent: 'x', reason: 'r' },
      confidence: 1, hash: 'h'
    } as never];

    // Q — mauvais executionId
    assert.match(
      repairService.safetyCheck({ plan, executionId: 'agx-autre', tenantId: 't', projectId: 'p', attempt: 0, fileChanges: artifacts, resolvedAgentCapabilities: ['FILE_MUTATION'] }) ?? '',
      /executionId/
    );
    // Le tenant/projet sont vérifiés au moment du rollback (isolation AINT-006) ;
    // le safety check porte sur la cohérence du plan :
    // P — capability non autorisée
    assert.match(
      repairService.safetyCheck({ plan, executionId: 'agx-original', tenantId: 't', projectId: 'p', attempt: 0, fileChanges: artifacts, resolvedAgentCapabilities: ['OTHER'] }) ?? '',
      /FILE_MUTATION/
    );
    // R — artifact invalide
    const badArtifacts = [{
      id: 'a1', taskId: 't1', agentId: 'ref', domain: 'ARCHITECTURE', kind: 'PROPOSED_FILE_CHANGE',
      targetFiles: [], payload: { operation: 'CREATE' }, confidence: 1, hash: 'h'
    } as never];
    assert.match(
      repairService.safetyCheck({ plan, executionId: 'agx-original', tenantId: 't', projectId: 'p', attempt: 0, fileChanges: badArtifacts, resolvedAgentCapabilities: ['FILE_MUTATION'] }) ?? '',
      /artifact invalide/
    );
    // maxAttempts atteint
    assert.match(
      repairService.safetyCheck({ plan, executionId: 'agx-original', tenantId: 't', projectId: 'p', attempt: 1, fileChanges: artifacts, resolvedAgentCapabilities: ['FILE_MUTATION'] }) ?? '',
      /limite d attempts/
    );
  });

  it('S: cancellation pendant la réparation → restauration conservée, CANCELLED, aucune réapplication', async () => {
    const corruptOnce = new CorruptOnceSource();
    const codeIntel = new CodeIntelligenceService(corruptOnce);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, corruptOnce);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(corruptOnce, codeIntel, dna, graph, impact);
    const controller = new AbortController();
    // Le bridge annule le contrôleur APRÈS la restauration réelle du rollback
    // de réparation (fait réel observé au point de contrôle du repair).
    class CancelAfterRollbackBridge extends MutationBridge {
      public override rollbackTransaction(params: Parameters<MutationBridge['rollbackTransaction']>[0]) {
        const res = super.rollbackTransaction(params);
        controller.abort();
        return res;
      }
    }
    const registry = new AgentRegistryService();
    registry.register(new ReferenceAgent());
    const executor = new AgentExecutionService(
      registry,
      new CancelAfterRollbackBridge(mutationOrchestrator),
      corruptOnce
    );

    const outcome = await executor.execute({
      executionId: 'agx-e36-s', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER',
      repairPolicy: POLICY, signal: controller.signal
    });

    assert.equal(outcome.status, 'CANCELLED');
    assert.equal(outcome.cancellation.at, 'AFTER_MUTATION');
    assert.equal(outcome.repair?.cancelled, true, 'cancellation observée PENDANT la réparation');
    assert.equal(outcome.repair?.attempted, true);
    assert.equal(outcome.rollback.verified, true, 'état restauré');
    assert.equal(corruptOnce.getFile(tenantId, projectId, 'src/target.ts'), null, 'aucune réapplication, état initial');
  });

  it('T+U: single-writer respecté et aucun node:fs dans le code É36', async () => {
    const corruptOnce = new CorruptOnceSource();
    const { source, executor } = makeChain(corruptOnce);
    const outcome = await executor.execute({
      executionId: 'agx-e36-t', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });
    assert.equal(outcome.status, 'SUCCESS');
    const payload = outcome.artifacts[0]!.payload as { proposedContent?: string; filePath?: string };
    assert.equal(source.getFile(tenantId, projectId, payload.filePath!)!.content, payload.proposedContent);

    for (const rel of [
      'packages/core/src/ai-native/ai-orchestrator/execution/gate.ts',
      'packages/core/src/ai-native/ai-orchestrator/execution/repair.ts',
      'packages/core/src/ai-native/ai-orchestrator/execution/agent-execution.ts'
    ]) {
      const full = resolve(process.cwd(), rel);
      assert.ok(existsSync(full));
      const content = readFileSync(full, 'utf8');
      assert.doesNotMatch(content, /from 'node:fs'/, `${rel} n importe pas node:fs`);
      assert.doesNotMatch(content, /writeFileSync/, `${rel} n écrit pas directement`);
    }
  });

  it('V: audit timeline É36 — GATE_FAILED/REPAIR_* avec executionId, tenant, raison', async () => {
    const corruptOnce = new CorruptOnceSource();
    const { executor } = makeChain(corruptOnce);
    await executor.execute({
      executionId: 'agx-e36-v', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });
    const events = auditStore.query(tenantId, { action: 'AGENT_EXECUTED' });
    const audit = events.find((e) => e.resourceId === 'agx-e36-v');
    assert.ok(audit);
    const metadata = audit.metadata as Record<string, unknown>;
    const phases = metadata['phases'] as string[];
    for (const expected of ['GATE_FAILED', 'REPAIR_PLANNED', 'REPAIR_STARTED', 'REPAIR_COMPLETED', 'FINAL_SUCCESS']) {
      assert.ok(phases.includes(expected), `phase auditée ${expected}`);
    }
    assert.equal(metadata['agentId'], 'reference-agent');
  });

  it('W: déterminisme — même état + même failure → même classification, même RepairPlan, même résultat', async () => {
    const sharedTask = task();
    const results: Array<{ reason: string | undefined; repairId: string | undefined; status: string; content: string | undefined }> = [];
    for (const suffix of ['w1', 'w2']) {
      const proj = `proj-e36-${suffix}-${seq}`;
      const corruptOnce = new CorruptOnceSource();
      const { source, executor } = makeChain(corruptOnce);
      const outcome = await executor.execute({
        executionId: `agx-e36-w-${suffix}`, agentId: 'reference-agent', task: sharedTask,
        context: ctx, tenantId, projectId: proj, userRole: 'OWNER', repairPolicy: POLICY
      });
      results.push({
        reason: outcome.repair?.reason,
        repairId: outcome.repair?.repairId,
        status: outcome.status,
        content: source.getFile(tenantId, proj, 'src/target.ts')?.content
      });
    }
    assert.equal(results[0]!.reason, results[1]!.reason);
    assert.equal(results[0]!.status, results[1]!.status);
    assert.equal(results[0]!.content, results[1]!.content);
    // Classification + plan déterministes (classification pure)
    assert.equal(
      classifyGateFailure({ gate: { passed: false, gateId: 'g', severity: 'BLOCKING', checks: [], executionId: 'x' }, mutationExecuted: true, cancelled: false }),
      classifyGateFailure({ gate: { passed: false, gateId: 'g', severity: 'BLOCKING', checks: [], executionId: 'x' }, mutationExecuted: true, cancelled: false })
    );
    const p1 = buildRepairPlan({ executionId: 'agx-x', attempt: 1, reason: 'VERIFICATION_FAILED', detail: 'd', targetPaths: ['src/a.ts'] });
    const p2 = buildRepairPlan({ executionId: 'agx-x', attempt: 1, reason: 'VERIFICATION_FAILED', detail: 'd', targetPaths: ['src/a.ts'] });
    assert.deepEqual(p1, p2, 'même entrée → même RepairPlan');
  });

  it('Isolation: la réparation ne traverse jamais les tenant/projet', async () => {
    const corruptOnce = new CorruptOnceSource();
    const { source, executor } = makeChain(corruptOnce);
    const outcome = await executor.execute({
      executionId: 'agx-e36-iso', agentId: 'reference-agent', task: task(),
      context: ctx, tenantId, projectId, userRole: 'OWNER', repairPolicy: POLICY
    });
    assert.equal(outcome.status, 'SUCCESS');
    // Le repair a écrit dans CE tenant/projet uniquement
    assert.ok(source.getFile(tenantId, projectId, 'src/target.ts'));
    assert.equal(source.getFile('tenant-autre', projectId, 'src/target.ts'), null);
    assert.equal(source.getFile(tenantId, 'proj-autre', 'src/target.ts'), null);
  });
});

/** Agent stub É36 (artifact paramétrable). */
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
        description: `agent stub É36 ${id}`,
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
            reason: `stub É36 ${this.definition.id}`
          },
          confidence: 1, hash: `h-${this.definition.id}-${params.task.id}`, summary: 'stub É36'
        }
      ],
      conflicts: [], tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 1
    };
  }
  protected buildArtifacts(): readonly [] { return []; }
}
