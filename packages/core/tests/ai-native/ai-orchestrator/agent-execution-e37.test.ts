/**
 * ÉTAPE 37 — Multi-Agent Scheduler / parallélisme réel
 *
 * Tous les tests traversent le VRAI pipeline : MultiAgentScheduler →
 * AgentExecutionService (É32→É36 complet : Gate/Repair/rollback/cancellation)
 * → MutationBridge → MutationOrchestratorService → FileStore.
 * Le parallélisme réel est PROUVÉ par chevauchement des intervalles
 * d'exécution mesurés (agents de test instrumentés), jamais par le simple
 * nombre de succès.
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
  MultiAgentScheduler,
  BaseSpecializedAgent,
  ReferenceAgent,
  type AgentTask,
  type AgentResult,
  type IMutableFileSource
} from '../../../src/index.js';

/** Agent lent instrumenté : enregistre ses intervalles réels [start, end]. */
class SlowAgent extends BaseSpecializedAgent {
  public static intervals: Array<{ agentId: string; start: number; end: number }> = [];
  public static reset(): void { SlowAgent.intervals = []; }

  constructor(
    id: string,
    private readonly delayMs: number,
    private readonly fail: boolean = false,
    private readonly throwException: boolean = false
  ) {
    super(
      {
        id, name: `Slow ${id}`, domain: 'ARCHITECTURE',
        capabilities: ['FILE_MUTATION'],
        description: `agent lent É37 ${id}`,
        riskLevel: 'LOW', requiredProviderCapabilities: [], allowedTools: []
      },
      undefined
    );
  }
  public override async executeTask(params: { task: AgentTask }): Promise<AgentResult> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, this.delayMs));
    const end = Date.now();
    SlowAgent.intervals.push({ agentId: this.definition.id, start, end });
    if (this.throwException) throw new Error('BOOM_E37_AGENT_EXCEPTION');
    const targetFile = params.task.requiredContext.targetFiles?.[0];
    if (this.fail || !targetFile) {
      return {
        taskId: params.task.id, agentId: this.definition.id, status: 'FAILURE', artifacts: [], conflicts: [],
        tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: end - start,
        error: this.fail ? 'E37_AGENT_FAILURE_VOLONTAIRE' : 'E37_NO_TARGET'
      };
    }
    const content = `// ${this.definition.id}\nexport const task = ${JSON.stringify(params.task.title)};\n`;
    return {
      taskId: params.task.id, agentId: this.definition.id, status: 'SUCCESS', degraded: false,
      artifacts: [
        {
          id: `art-${params.task.id}`, taskId: params.task.id, agentId: this.definition.id,
          domain: 'ARCHITECTURE', kind: 'PROPOSED_FILE_CHANGE', targetFiles: [targetFile],
          payload: { filePath: targetFile, operation: 'CREATE', proposedContent: content, reason: 'e37' },
          confidence: 1, hash: `h-${params.task.id}`, summary: 'e37'
        }
      ],
      conflicts: [], tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: end - start
    };
  }
  protected buildArtifacts(): readonly [] { return []; }
}

describe('ÉTAPE 37 — Multi-Agent Scheduler / parallélisme réel', () => {
  let tenantId: string;
  let projectId: string;
  let seq = 0;

  beforeEach(() => {
    seq += 1;
    tenantId = 'tenant-e37';
    projectId = `proj-e37-${seq}`;
    SlowAgent.reset();
  });

  /** Chaîne réelle complète + scheduler (le MÊME AgentExecutionService). */
  function makeChain(source: IMutableFileSource) {
    const codeIntel = new CodeIntelligenceService(source);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, source);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(source, codeIntel, dna, graph, impact);
    const registry = new AgentRegistryService();
    registry.register(new ReferenceAgent());
    const agentExecution = new AgentExecutionService(registry, new MutationBridge(mutationOrchestrator), source);
    const scheduler = new MultiAgentScheduler(agentExecution);
    return { source, registry, agentExecution, scheduler };
  }

  function makeSpec(taskId: string, agentId: string, order: number, targetFile: string, dependencies: string[] = []) {
    return {
      taskId, agentId, dependencies, order,
      task: {
        id: taskId, title: `Tâche ${taskId}`, description: '', domain: 'ARCHITECTURE' as const,
        priority: 1, dependencies,
        requiredContext: { targetFiles: [targetFile] },
        requiredCapabilities: ['FILE_MUTATION'] as never[],
        status: 'READY' as const, operation: 'CREATE' as const, retryCount: 0, maxRetries: 0
      }
    };
  }

  // =========================================================================
  // A — mono-tâche = É36
  // =========================================================================
  it('A: une seule tâche → comportement É36 complet (gate, vérification, fichier réel)', async () => {
    const { source, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await scheduler.execute({
      executionId: 'agx-e37-a', tenantId, projectId,
      tasks: [makeSpec('t1', 'reference-agent', 1, 'src/a.ts')],
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'COMPLETED');
    assert.equal(outcome.counts.total, 1);
    assert.equal(outcome.counts.completed, 1);
    const record = outcome.tasks[0]!;
    assert.equal(record.status, 'COMPLETED');
    assert.equal(record.taskExecutionId, 'agx-e37-a--t1');
    assert.equal(record.outcome?.status, 'SUCCESS');
    assert.equal(record.outcome?.gate?.passed, true, 'Gate É36 exécuté');
    assert.equal(record.outcome?.verification.performed, true);
    assert.ok(source.getFile(tenantId, projectId, 'src/a.ts'));
  });

  // =========================================================================
  // B/F — deux tâches indépendantes : parallélisme RÉEL (chevauchement mesuré)
  // =========================================================================
  it('B+F: deux tâches indépendantes (fichiers différents) → chevauchement réel mesuré', async () => {
    const { source, registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    registry.register(new SlowAgent('slow-b1', 90));
    registry.register(new SlowAgent('slow-b2', 90));

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-b', tenantId, projectId,
      tasks: [makeSpec('t1', 'slow-b1', 1, 'src/b1.ts'), makeSpec('t2', 'slow-b2', 2, 'src/b2.ts')],
      maxConcurrency: 4, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'COMPLETED');
    assert.equal(outcome.counts.completed, 2);

    // PREUVE de parallélisme réel : les deux intervalles se chevauchent.
    assert.equal(SlowAgent.intervals.length, 2);
    const [i1, i2] = SlowAgent.intervals;
    const overlap = Math.min(i1!.end, i2!.end) - Math.max(i1!.start, i2!.start);
    assert.ok(overlap > 20, `chevauchement réel attendu (>20ms), mesuré: ${overlap}ms`);

    // Mutations réelles des deux fichiers
    assert.ok(source.getFile(tenantId, projectId, 'src/b1.ts'));
    assert.ok(source.getFile(tenantId, projectId, 'src/b2.ts'));
    assert.ok(source.getFile(tenantId, projectId, 'src/b1.ts')!.content.includes('slow-b1'));
  });

  // =========================================================================
  // C — dépendance → séquencement réel
  // =========================================================================
  it('C: deux tâches dépendantes → B démarre APRÈS la fin réelle de A', async () => {
    const { registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    registry.register(new SlowAgent('slow-c1', 80));
    registry.register(new SlowAgent('slow-c2', 40));

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-c', tenantId, projectId,
      tasks: [
        makeSpec('a', 'slow-c1', 1, 'src/c1.ts'),
        makeSpec('b', 'slow-c2', 2, 'src/c2.ts', ['a'])
      ],
      maxConcurrency: 4, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'COMPLETED');
    assert.equal(SlowAgent.intervals.length, 2);
    const first = SlowAgent.intervals.find((i) => i.agentId === 'slow-c1')!;
    const second = SlowAgent.intervals.find((i) => i.agentId === 'slow-c2')!;
    assert.ok(second.start >= first.end, `B doit démarrer après la FIN réelle de A (A finit ${first.end}, B démarre ${second.start})`);
  });

  // =========================================================================
  // D — DAG losange : D attend B ET C
  // =========================================================================
  it('D: DAG losange A→(B,C)→D — D attend le succès réel de B ET C ; B/C parallèles', async () => {
    const { source, registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    registry.register(new SlowAgent('slow-top', 40));
    registry.register(new SlowAgent('slow-left', 80));
    registry.register(new SlowAgent('slow-right', 80));
    registry.register(new SlowAgent('slow-bottom', 40));

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-d', tenantId, projectId,
      tasks: [
        makeSpec('a', 'slow-top', 1, 'src/a.ts'),
        makeSpec('b', 'slow-left', 2, 'src/b.ts', ['a']),
        makeSpec('c', 'slow-right', 3, 'src/c.ts', ['a']),
        makeSpec('d', 'slow-bottom', 4, 'src/d.ts', ['b', 'c'])
      ],
      maxConcurrency: 4, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'COMPLETED');
    assert.equal(outcome.counts.completed, 4);

    const top = SlowAgent.intervals.find((i) => i.agentId === 'slow-top')!;
    const left = SlowAgent.intervals.find((i) => i.agentId === 'slow-left')!;
    const right = SlowAgent.intervals.find((i) => i.agentId === 'slow-right')!;
    const bottom = SlowAgent.intervals.find((i) => i.agentId === 'slow-bottom')!;
    // B et C démarrent après A et se chevauchent (parallèles)
    assert.ok(left.start >= top.end && right.start >= top.end);
    const bcOverlap = Math.min(left.end, right.end) - Math.max(left.start, right.start);
    assert.ok(bcOverlap > 20, `B et C doivent être parallèles (chevauchement ${bcOverlap}ms)`);
    // D démarre après la FIN réelle de B ET de C
    assert.ok(bottom.start >= left.end && bottom.start >= right.end);
    assert.ok(source.getFile(tenantId, projectId, 'src/d.ts'));
  });

  // =========================================================================
  // E — même fichier → pas de parallélisme
  // =========================================================================
  it('E: deux tâches sur le MÊME fichier → séquencement (aucun chevauchement)', async () => {
    const { source, registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    registry.register(new SlowAgent('slow-e1', 80));
    registry.register(new SlowAgent('slow-e2', 80));

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-e', tenantId, projectId,
      tasks: [
        makeSpec('e1', 'slow-e1', 1, 'src/same.ts'),
        makeSpec('e2', 'slow-e2', 2, 'src/same.ts')
      ],
      maxConcurrency: 4, userRole: 'OWNER'
    });

    assert.equal(SlowAgent.intervals.length, 2);
    const [i1, i2] = SlowAgent.intervals;
    const overlap = Math.min(i1!.end, i2!.end) - Math.max(i1!.start, i2!.start);
    assert.ok(overlap <= 5, `aucun chevauchement attendu (mesuré ${overlap}ms) — cohérence du store`);
    // Les deux CREATE successifs : le second échoue (fichier existant) → verdict réel
    const statuses = outcome.tasks.map((t) => t.status);
    assert.ok(statuses.includes('COMPLETED'));
    assert.ok(statuses.includes('FAILED'), 'le second CREATE sur le même fichier échoue réellement (single-writer)');
    assert.equal(outcome.status, 'FAILED', 'verdict global honnête (un échec réel)');
  });

  // =========================================================================
  // G/H — FAILURE réel / exception réelle → verdict global honnête
  // =========================================================================
  it('G: agent FAILURE → verdict global FAILED, aucune transformation en succès', async () => {
    const { source, registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    registry.register(new SlowAgent('slow-fail', 20, true));

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-g', tenantId, projectId,
      tasks: [makeSpec('g1', 'slow-fail', 1, 'src/g.ts')],
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILED');
    assert.equal(outcome.tasks[0]!.status, 'FAILED');
    assert.equal(outcome.tasks[0]!.outcome?.status, 'FAILURE');
    assert.match(outcome.tasks[0]!.outcome?.error ?? '', /E37_AGENT_FAILURE_VOLONTAIRE/);
    assert.equal(source.getFile(tenantId, projectId, 'src/g.ts'), null, 'aucune mutation');
  });

  it('H: exception agent → propagation réelle, verdict FAILED', async () => {
    const { source, registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    registry.register(new SlowAgent('slow-throw', 20, false, true));

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-h', tenantId, projectId,
      tasks: [makeSpec('h1', 'slow-throw', 1, 'src/h.ts')],
      userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILED');
    assert.match(outcome.tasks[0]!.outcome?.error ?? '', /BOOM_E37_AGENT_EXCEPTION/);
    assert.equal(source.getFile(tenantId, projectId, 'src/h.ts'), null);
  });

  // =========================================================================
  // I/J — cancellation réelle
  // =========================================================================
  it('I: cancellation AVANT démarrage → CANCELLED, aucune tâche exécutée, aucune mutation', async () => {
    const { source, registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    registry.register(new SlowAgent('slow-i', 20));
    const controller = new AbortController();
    controller.abort();

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-i', tenantId, projectId,
      tasks: [makeSpec('i1', 'slow-i', 1, 'src/i.ts')],
      userRole: 'OWNER', signal: controller.signal
    });

    assert.equal(outcome.status, 'CANCELLED');
    assert.equal(outcome.tasks[0]!.status, 'PENDING', 'jamais démarrée');
    assert.equal(outcome.tasks[0]!.outcome, undefined, 'aucun outcome — aucun agent exécuté');
    assert.equal(SlowAgent.intervals.length, 0);
    assert.equal(source.getFile(tenantId, projectId, 'src/i.ts'), null);
  });

  it('J: cancellation pendant exécution → verdicts RÉELS des tâches en vol, jamais prétendus', async () => {
    const { source, registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const controller = new AbortController();
    // L'agent annule le contrôleur PENDANT son exécution (fait réel) ;
    // le MÊME signal est celui de la requête → É36 l'observe au point
    // AFTER_MUTATION → rollback vérifié → CANCELLED réel.
    class CancelDuringRunAgent extends BaseSpecializedAgent {
      constructor() {
        super(
          {
            id: 'slow-j-cancel', name: 'Cancel J', domain: 'ARCHITECTURE',
            capabilities: ['FILE_MUTATION'], description: 'annule pendant son exécution',
            riskLevel: 'LOW', requiredProviderCapabilities: [], allowedTools: []
          },
          undefined
        );
      }
      public override async executeTask(params: { task: AgentTask }): Promise<AgentResult> {
        const start = Date.now();
        await new Promise((r) => setTimeout(r, 10));
        controller.abort();
        const content = '// slow-j-cancel\nexport const j = 1;\n';
        SlowAgent.intervals.push({ agentId: this.definition.id, start, end: Date.now() });
        return {
          taskId: params.task.id, agentId: this.definition.id, status: 'SUCCESS', degraded: false,
          artifacts: [
            {
              id: `art-${params.task.id}`, taskId: params.task.id, agentId: this.definition.id,
              domain: 'ARCHITECTURE', kind: 'PROPOSED_FILE_CHANGE', targetFiles: ['src/j.ts'],
              payload: { filePath: 'src/j.ts', operation: 'CREATE', proposedContent: content, reason: 'e37' },
              confidence: 1, hash: 'h-j', summary: 'e37'
            }
          ],
          conflicts: [], tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: Date.now() - start
        };
      }
      protected buildArtifacts(): readonly [] { return []; }
    }
    registry.register(new CancelDuringRunAgent());

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-j', tenantId, projectId,
      tasks: [makeSpec('j1', 'slow-j-cancel', 1, 'src/j.ts')],
      maxConcurrency: 4, userRole: 'OWNER', signal: controller.signal
    });

    // Le verdict de la tâche vient de É36 : l'abort survient PENDANT l'agent
    // (avant toute mutation) → point BEFORE_MUTATION → CANCELLED réel,
    // aucune écriture, aucun rollback nécessaire (rien n'a été appliqué).
    assert.equal(outcome.tasks[0]!.outcome?.status, 'CANCELLED');
    assert.equal(outcome.tasks[0]!.outcome?.cancellation.at, 'BEFORE_MUTATION');
    assert.equal(outcome.tasks[0]!.outcome?.mutation.executed, false, 'aucune mutation appliquée');
    assert.equal(outcome.status, 'CANCELLED');
    assert.equal(source.getFile(tenantId, projectId, 'src/j.ts'), null, 'aucun fichier écrit');
  });

  // =========================================================================
  // K — dépendance d'une tâche échouée → BLOCKED
  // =========================================================================
  it('K: A FAILURE → B dépendante BLOCKED, jamais exécutée, aucune mutation de B', async () => {
    const { source, registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    registry.register(new SlowAgent('slow-kfail', 20, true));
    registry.register(new SlowAgent('slow-kok', 20));

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-k', tenantId, projectId,
      tasks: [
        makeSpec('a', 'slow-kfail', 1, 'src/a.ts'),
        makeSpec('b', 'slow-kok', 2, 'src/b.ts', ['a'])
      ],
      maxConcurrency: 4, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILED');
    const a = outcome.tasks.find((t) => t.spec.taskId === 'a')!;
    const b = outcome.tasks.find((t) => t.spec.taskId === 'b')!;
    assert.equal(a.status, 'FAILED');
    assert.equal(b.status, 'BLOCKED');
    assert.equal(b.outcome, undefined, 'B jamais exécutée');
    assert.match(b.blockedReason ?? '', /dépendance/);
    assert.equal(source.getFile(tenantId, projectId, 'src/b.ts'), null, 'aucune mutation de B');
  });

  // =========================================================================
  // L/M — capability inconnue / agent inconnu → rejet avant exécution
  // =========================================================================
  it('L: capability inconnue → rejet avant TOUTE exécution (aucune mutation)', async () => {
    const { source, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const spec = makeSpec('l1', 'reference-agent', 1, 'src/l.ts');
    (spec.task.requiredCapabilities as string[]).push('CAPACITE_INCONNUE_37');

    await assert.rejects(
      () => scheduler.execute({ executionId: 'agx-e37-l', tenantId, projectId, tasks: [spec], userRole: 'OWNER' }),
      /CAPABILITY_UNSUPPORTED/
    );
    assert.equal(source.getFile(tenantId, projectId, 'src/l.ts'), null);
  });

  it('M: agent inconnu → rejet avant exécution', async () => {
    const { scheduler } = makeChain(new InMemoryMutableFileSource({}));
    await assert.rejects(
      () => scheduler.execute({ executionId: 'agx-e37-m', tenantId, projectId, tasks: [makeSpec('m1', 'agent-fantome-37', 1, 'src/m.ts')], userRole: 'OWNER' }),
      /AGENT_UNKNOWN/
    );
  });

  it('N: cycle DAG → rejet AVANT toute exécution (aucun agent, aucune mutation)', async () => {
    const { source, registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    registry.register(new SlowAgent('slow-n', 20));

    await assert.rejects(
      () => scheduler.execute({
        executionId: 'agx-e37-n', tenantId, projectId,
        tasks: [
          makeSpec('x', 'slow-n', 1, 'src/x.ts', ['y']),
          makeSpec('y', 'slow-n', 2, 'src/y.ts', ['x'])
        ],
        userRole: 'OWNER'
      }),
      /DAG_INVALID: cycle détecté/
    );
    assert.equal(SlowAgent.intervals.length, 0, 'aucun agent exécuté');
    assert.equal(source.getFile(tenantId, projectId, 'src/x.ts'), null);
    assert.equal(source.getFile(tenantId, projectId, 'src/y.ts'), null);
  });

  // =========================================================================
  // O — maxConcurrency réellement respecté
  // =========================================================================
  it('O: maxConcurrency=2 avec 4 tâches indépendantes → au plus 2 en parallèle (mesuré)', async () => {
    const { registry, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    for (const id of ['s1', 's2', 's3', 's4']) registry.register(new SlowAgent(`slow-${id}`, 70));

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-o', tenantId, projectId,
      tasks: [
        makeSpec('t1', 'slow-s1', 1, 'src/o1.ts'),
        makeSpec('t2', 'slow-s2', 2, 'src/o2.ts'),
        makeSpec('t3', 'slow-s3', 3, 'src/o3.ts'),
        makeSpec('t4', 'slow-s4', 4, 'src/o4.ts')
      ],
      maxConcurrency: 2, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'COMPLETED');
    assert.equal(outcome.counts.completed, 4);
    // Mesure : chevauchement maximal simultané ≤ 2
    const events: Array<{ t: number; delta: number }> = [];
    for (const i of SlowAgent.intervals) {
      events.push({ t: i.start, delta: 1 }, { t: i.end, delta: -1 });
    }
    events.sort((a, b) => a.t - b.t || b.delta - a.delta);
    let concurrent = 0;
    let maxConcurrent = 0;
    for (const e of events) {
      concurrent += e.delta;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
    }
    assert.ok(maxConcurrent <= 2, `maxConcurrency respecté (mesuré ${maxConcurrent})`);
    assert.ok(maxConcurrent >= 2, 'parallélisme réel présent (2 simultanés au moins une fois)');
    assert.ok(outcome.phases.some((p) => p.phase === 'WAVE_STARTED' && (p.detail ?? '').includes('2 tâche(s)')));
  });

  // =========================================================================
  // P/Q/R/S — isolation, single-writer, Gate, Repair
  // =========================================================================
  it('P+Q: isolation tenant/projet + single-writer (contenu = artifacts réels)', async () => {
    const { source, scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await scheduler.execute({
      executionId: 'agx-e37-p', tenantId, projectId,
      tasks: [makeSpec('p1', 'reference-agent', 1, 'src/p.ts'), makeSpec('p2', 'reference-agent', 2, 'src/q.ts')],
      maxConcurrency: 4, userRole: 'OWNER'
    });
    assert.equal(outcome.status, 'COMPLETED');
    assert.ok(source.getFile(tenantId, projectId, 'src/p.ts'));
    assert.ok(source.getFile(tenantId, projectId, 'src/q.ts'));
    assert.equal(source.getFile('tenant-autre', projectId, 'src/p.ts'), null);
    for (const record of outcome.tasks) {
      const payload = record.outcome!.artifacts[0]!.payload as { proposedContent?: string; filePath?: string };
      assert.equal(source.getFile(tenantId, projectId, payload.filePath!)!.content, payload.proposedContent);
    }
  });

  it('R+S: Gate É36 actif par tâche + Repair É36 actif quand la politique est passée', async () => {
    // Source dont la PREMIÈRE écriture diverge → Gate FAIL → repair (politique) → re-Gate PASS
    class CorruptOnceSource extends InMemoryMutableFileSource {
      public writes = 0;
      public override createFile(t: string, p: string, f: string, c: string): void {
        this.writes += 1;
        super.createFile(t, p, f, this.writes === 1 ? c + '\n// CORRUPTED\n' : c);
      }
    }
    const corruptOnce = new CorruptOnceSource();
    const { source, scheduler } = makeChain(corruptOnce);

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-rs', tenantId, projectId,
      tasks: [makeSpec('rs1', 'reference-agent', 1, 'src/rs.ts')],
      userRole: 'OWNER', repairPolicy: { enabled: true, maxAttempts: 1 }
    });

    assert.equal(outcome.status, 'COMPLETED');
    const record = outcome.tasks[0]!;
    assert.equal(record.outcome?.repair?.attempted, true, 'Repair É36 exécuté via le scheduler');
    assert.equal(record.outcome?.repair?.gateAfterPassed, true);
    assert.equal(record.outcome?.gate?.passed, true, 'Gate final PASS');
    assert.doesNotMatch(source.getFile(tenantId, projectId, 'src/rs.ts')!.content, /CORRUPTED/);
  });

  it('T: rollback É36 intact via le scheduler (mutation refusée → FAILED réel par tâche)', async () => {
    const base = new InMemoryMutableFileSource({});
    base.createFile(tenantId, projectId, 'src/dup.ts', 'export const original = 1;\n');
    const { source, scheduler } = makeChain(base);
    const outcome = await scheduler.execute({
      executionId: 'agx-e37-t', tenantId, projectId,
      tasks: [makeSpec('t1', 'reference-agent', 1, 'src/dup.ts')],
      userRole: 'OWNER'
    });
    assert.equal(outcome.status, 'FAILED');
    assert.equal(outcome.tasks[0]!.outcome?.status, 'FAILURE');
    assert.equal(source.getFile(tenantId, projectId, 'src/dup.ts')!.content, 'export const original = 1;\n', 'fichier intact (rollback/refus É36)');
  });

  // =========================================================================
  // U/V/W/X/Y — déterminisme, executionId, timeline, anti-faux-succès, fs
  // =========================================================================
  it('U+V: déterminisme + executionIds dérivés de manière déterministe', async () => {
    const runOnce = async (tag: string) => {
      const { source, scheduler } = makeChain(new InMemoryMutableFileSource({}));
      const outcome = await scheduler.execute({
        executionId: `agx-e37-u-${tag}`, tenantId, projectId: `proj-u-${tag}`,
        tasks: [
          makeSpec('b', 'reference-agent', 2, 'src/b.ts', ['a']),
          makeSpec('a', 'reference-agent', 1, 'src/a.ts')
        ],
        maxConcurrency: 4, userRole: 'OWNER'
      });
      return {
        status: outcome.status,
        ids: outcome.tasks.map((t) => `${t.spec.taskId}:${t.taskExecutionId}:${t.status}`).sort(),
        contents: ['src/a.ts', 'src/b.ts'].map((f) => source.getFile(tenantId, `proj-u-${tag}`, f)?.content)
      };
    };
    const r1 = await runOnce('w1');
    const r2 = await runOnce('w2');
    assert.equal(r1.status, r2.status);
    // Structure déterministe : taskId → status identiques, executionIds
    // dérivés déterministes du batch (<batchId>--<taskId>).
    assert.deepEqual(
      r1.ids.map((x) => x.replace(/agx-e37-u-[a-z0-9]+--/, '<batch>--')),
      r2.ids.map((x) => x.replace(/agx-e37-u-[a-z0-9]+--/, '<batch>--'))
    );
    assert.deepEqual(r1.contents, r2.contents);
    assert.ok(r1.ids.every((id) => id.includes('agx-e37-u-w1--')), 'executionId batch → tâche tracé');
  });

  it('W: timeline complète du scheduler (SCHEDULER_*/TASK_*)', async () => {
    const { scheduler } = makeChain(new InMemoryMutableFileSource({}));
    const outcome = await scheduler.execute({
      executionId: 'agx-e37-w', tenantId, projectId,
      tasks: [makeSpec('w1', 'reference-agent', 1, 'src/w.ts')],
      userRole: 'OWNER'
    });
    const phases = outcome.phases.map((p) => p.phase);
    for (const expected of ['SCHEDULER_STARTED', 'TASK_READY', 'TASK_STARTED', 'TASK_COMPLETED', 'SCHEDULER_COMPLETED']) {
      assert.ok(phases.includes(expected), `phase ${expected} attendue`);
    }
    // Timeline É36 conservée par tâche (pas de fusion destructive)
    assert.ok(outcome.tasks[0]!.outcome!.phases.some((p) => p.phase === 'VERIFICATION_PASSED'));
  });

  it('X: anti-faux-succès — le verdict global suit EXCLUSIVEMENT les outcomes réels', async () => {
    const { scheduler } = makeChain(new InMemoryMutableFileSource({}));
    // Tâche qui échoue + tâche indépendante qui réussit → FAILED global
    // (jamais COMPLETED parce que des promises ont résolu).
    const { registry } = { registry: (scheduler as unknown as { agentExecution: AgentExecutionService }).agentExecution.getRegistry() };
    registry.register(new SlowAgent('slow-x-fail', 30, true));
    registry.register(new SlowAgent('slow-x-ok', 30));

    const outcome = await scheduler.execute({
      executionId: 'agx-e37-x', tenantId, projectId,
      tasks: [
        makeSpec('xok', 'slow-x-ok', 1, 'src/x-ok.ts'),
        makeSpec('xfail', 'slow-x-fail', 2, 'src/x-fail.ts')
      ],
      maxConcurrency: 4, userRole: 'OWNER'
    });

    assert.equal(outcome.status, 'FAILED');
    assert.equal(outcome.counts.completed, 1, 'un succès réel compté');
    assert.equal(outcome.counts.failed, 1, 'un échec réel compté');
    // Chaque statut COMPLETED provient d'un outcome É36 SUCCESS avec gate PASS
    for (const record of outcome.tasks) {
      if (record.status === 'COMPLETED') {
        assert.equal(record.outcome?.status, 'SUCCESS');
        assert.equal(record.outcome?.gate?.passed, true);
      }
    }
  });

  it('Y: aucun node:fs dans le scheduler', () => {
    const full = resolve(process.cwd(), 'packages/core/src/ai-native/ai-orchestrator/execution/multi-agent-scheduler.ts');
    assert.ok(existsSync(full));
    const content = readFileSync(full, 'utf8');
    assert.doesNotMatch(content, /node:fs/);
    assert.doesNotMatch(content, /writeFileSync/);
    const codeOnly = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(codeOnly, /executeTask\(/, 'aucun appel direct executeTask dans le scheduler');
  });

  function outcomeIdsDeterministic(ids: string[]): boolean {
    return ids.every((id) => id.includes(':'));
  }
});
