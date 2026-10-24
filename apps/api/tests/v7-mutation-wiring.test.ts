/**
 * V7-WIRE-2 — MUTATION ORCHESTRATOR DANS LE FLUX :
 *  - plan CREATE_FILE / UPDATE_FILE, validation, exécution atomique ;
 *  - repli explicite si le moteur est absent ou refuse AVANT écriture ;
 *  - aucune reprise directe après un rollback (le contenu rejeté ne fuit pas) ;
 *  - registre de transactions borné (pas de fuite mémoire par génération).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyStreamFileMutation,
  STREAM_MUTATION_PATH,
  type StreamMutationEngine
} from '../src/routes/stream-mutation.js';
import {
  applyStreamFileMutationWithStreamEngine,
  configureStreamMutationEngine
} from '../src/routes/conversation.js';
import {
  ApplicationDNAService,
  CodeIntelligenceService,
  FileStore,
  FileStoreAdapter,
  ImpactIntelligenceService,
  MutationOrchestratorService,
  SemanticCodeGraphService
} from '../../../packages/core/src/index.js';
import type {
  MutationPlan,
  PlanValidationResult,
  SingleMutation
} from '../../../packages/core/src/ai-native/mutation-orchestrator/types.js';

const BASE_INPUT = {
  tenantId: 'studio-local',
  projectId: 'proj_v7_mutation',
  requestId: 'req_v7_mutation',
  role: 'ENGINEER' as const,
  content: '<!DOCTYPE html><html><body><h1>V7</h1></body></html>',
  mode: 'create' as const
};

function fakePlan(request: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly mutations: readonly SingleMutation[];
}): MutationPlan {
  return {
    schemaVersion: '1.0.0',
    planId: 'plan-fake',
    tenantId: request.tenantId,
    projectId: request.projectId,
    createdAt: new Date(0).toISOString(),
    baseGraphHash: 'graph-fake',
    mutations: request.mutations,
    expectedChanges: [],
    riskLevel: 'LOW',
    validationStatus: 'PENDING',
    planHash: 'a'.repeat(64)
  };
}

interface FakeEngineOptions {
  readonly valid?: boolean;
  readonly blockers?: readonly string[];
  readonly executeError?: Error;
}

type InstrumentedEngine = StreamMutationEngine & { readonly calls: string[] };

function makeFakeEngine(options: FakeEngineOptions = {}): InstrumentedEngine {
  const calls: string[] = [];
  const engine: StreamMutationEngine = {
    createPlan(request) {
      calls.push('createPlan');
      return fakePlan(request);
    },
    validatePlan(plan): PlanValidationResult {
      calls.push('validatePlan');
      return {
        planId: plan.planId,
        valid: options.valid ?? true,
        riskLevel: 'LOW',
        blockers: options.blockers ?? [],
        warnings: ['preuve absente (attendu pour du HTML généré)']
      };
    },
    executePlan(plan) {
      calls.push('executePlan');
      if (options.executeError) throw options.executeError;
      const diff = {
        filePath: STREAM_MUTATION_PATH,
        operation: 'CREATE_FILE' as const,
        beforeContent: null,
        afterContent: 'x',
        addedLines: 4,
        removedLines: 1
      };
      return {
        success: true,
        dryRun: false,
        transaction: {
          transactionId: 'tx-fake',
          planId: plan.planId,
          tenantId: plan.tenantId,
          projectId: plan.projectId,
          status: 'COMMITTED',
          appliedMutations: plan.mutations,
          diffs: [diff],
          snapshot: {
            snapshotId: 'snap-fake',
            tenantId: plan.tenantId,
            projectId: plan.projectId,
            createdAt: new Date(0).toISOString(),
            files: {},
            originalTreeHash: 'tree-before'
          },
          durationMs: 7,
          transactionHash: 'b'.repeat(64),
          createdAt: new Date(0).toISOString()
        },
        diffs: [diff],
        resultingTreeHash: 'tree-after'
      };
    }
  };
  return Object.assign(engine, { calls });
}

afterEach(() => {
  configureStreamMutationEngine(undefined);
});

describe('V7-WIRE-2 — pont flux → Mutation Orchestrator', () => {
  it('sans moteur : aucun succès fabriqué, repli décidé par l’appelant', () => {
    const outcome = applyStreamFileMutation(undefined, BASE_INPUT);
    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'engine');
      assert.equal(outcome.reason, 'service-non-configure');
      assert.equal(outcome.rolledBack, false);
    }
  });

  it('création : plan CREATE_FILE avec précondition FILE_NOT_EXISTS, exécution consultative', () => {
    let capturedMutation: SingleMutation | undefined;
    let capturedOptions: unknown;
    const engine = makeFakeEngine();
    const wrapped: StreamMutationEngine = {
      ...engine,
      createPlan(request, role, requestId) {
        capturedMutation = request.mutations[0];
        assert.equal(request.baseGraphHash, '', 'le hash réel est résolu par le service');
        assert.equal(request.riskLevel, 'MEDIUM');
        assert.equal(role, 'ENGINEER');
        assert.equal(requestId, BASE_INPUT.requestId);
        return engine.createPlan(request, role, requestId);
      },
      executePlan(plan, options, role, requestId) {
        capturedOptions = options;
        return engine.executePlan(plan, options, role, requestId);
      }
    };

    const outcome = applyStreamFileMutation(wrapped, { ...BASE_INPUT, riskLevel: 'MEDIUM' });

    assert.equal(outcome.applied, true);
    if (outcome.applied) {
      assert.equal(outcome.mode, 'create');
      assert.equal(outcome.planId, 'plan-fake');
      assert.equal(outcome.transactionId, 'tx-fake');
      assert.equal(outcome.addedLines, 4);
      assert.equal(outcome.removedLines, 1);
      assert.equal(outcome.durationMs, 7);
    }
    assert.equal(capturedMutation?.kind, 'CREATE_FILE');
    assert.equal(capturedMutation?.operation.path, STREAM_MUTATION_PATH);
    assert.equal(capturedMutation?.preconditions[0]?.kind, 'FILE_NOT_EXISTS');
    assert.deepEqual(capturedOptions, {
      allowHighRisk: true,
      allowBreaking: true,
      skipImpactCheck: true
    });
  });

  it('mise à jour : plan UPDATE_FILE avec précondition FILE_EXISTS', () => {
    let capturedMutation: SingleMutation | undefined;
    const engine = makeFakeEngine();
    const outcome = applyStreamFileMutation(
      {
        ...engine,
        createPlan(request, role, requestId) {
          capturedMutation = request.mutations[0];
          return engine.createPlan(request, role, requestId);
        }
      },
      { ...BASE_INPUT, mode: 'update' }
    );

    assert.equal(outcome.applied, true);
    assert.equal(capturedMutation?.kind, 'UPDATE_FILE');
    assert.equal(capturedMutation?.preconditions[0]?.kind, 'FILE_EXISTS');
  });

  it('validation refusée : arrêt AVANT écriture, blockers remontés', () => {
    const engine = makeFakeEngine({ valid: false, blockers: ['risque trop élevé', 'preuve manquante'] });
    const outcome = applyStreamFileMutation(engine, BASE_INPUT);

    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'validation');
      assert.match(outcome.reason, /risque trop élevé/);
      assert.equal(outcome.rolledBack, false);
    }
    assert.deepEqual(engine.calls, ['createPlan', 'validatePlan']);
  });

  it('échec d’exécution : rollback signalé, aucune reprise directe possible', () => {
    const engine = makeFakeEngine({ executeError: new Error('vérification post-mutation échouée') });
    const outcome = applyStreamFileMutation(engine, BASE_INPUT);

    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'execution');
      assert.match(outcome.reason, /vérification post-mutation/);
      assert.equal(outcome.rolledBack, true);
    }
    assert.deepEqual(engine.calls, ['createPlan', 'validatePlan', 'executePlan']);
  });

  it('configuration serveur : le pont utilise l’instance injectée', () => {
    const engine = makeFakeEngine();
    configureStreamMutationEngine(engine);

    const outcome = applyStreamFileMutationWithStreamEngine(BASE_INPUT);

    assert.equal(outcome.applied, true);
    assert.deepEqual(engine.calls, ['createPlan', 'validatePlan', 'executePlan']);
  });

  it('moteur réel : CREATE puis UPDATE persistés, transaction restaurable', () => {
    const store = new FileStore();
    const tenantId = 'tenant-v7-wire2';
    const projectId = 'proj-v7-wire2';
    // Le FileStore initialise index.html par défaut : on part d'un projet vide
    // pour exercer réellement le chemin CREATE_FILE. Un second fichier vérifie
    // que le plan HTML ne touche QUE la cible (projet multi-fichiers).
    store.deleteNode(tenantId, projectId, 'index.html');
    store.createNode(tenantId, projectId, 'styles.css', 'file', 'body { margin: 0; }');

    const fileSource = new FileStoreAdapter(store);
    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const semanticGraph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impact = new ImpactIntelligenceService(semanticGraph);
    const engine = new MutationOrchestratorService(
      fileSource,
      codeIntel,
      dna,
      semanticGraph,
      impact
    );

    const htmlV1 = '<!DOCTYPE html><html><head><title>V7</title></head><body><h1>Un</h1></body></html>';
    const htmlV2 = '<!DOCTYPE html><html><head><title>V7</title></head><body><h1>Deux</h1></body></html>';

    const created = applyStreamFileMutation(engine, {
      ...BASE_INPUT,
      tenantId,
      projectId,
      mode: 'create',
      content: htmlV1
    });
    assert.equal(created.applied, true);
    assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, htmlV1);
    assert.equal(store.getFile(tenantId, projectId, 'styles.css')?.content, 'body { margin: 0; }');

    const updated = applyStreamFileMutation(engine, {
      ...BASE_INPUT,
      tenantId,
      projectId,
      mode: 'update',
      content: htmlV2
    });
    assert.equal(updated.applied, true);
    assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, htmlV2);
    assert.equal(store.getFile(tenantId, projectId, 'styles.css')?.content, 'body { margin: 0; }');

    // La transaction UPDATE est réellement enregistrée et restaurable.
    if (updated.applied) {
      const rb = engine.rollback(updated.transactionId, 'ENGINEER');
      assert.equal(rb.success, true);
      assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, htmlV1);
    }
  });

  it('garde d’intégration : la route utilise le pont et trace les replis', () => {
    const src = readFileSync(resolve(process.cwd(), 'apps/api/src/routes/conversation.ts'), 'utf8');
    assert.ok(src.includes('applyStreamFileMutationWithStreamEngine'), 'le flux appelle le pont AINT-006');
    assert.ok(src.includes("type: 'MUTATION_FALLBACK'"), 'le repli direct est persisté et tracé');
    assert.ok(src.includes("type: 'MUTATION_ROLLED_BACK'"), 'un rollback est persisté et tracé');
    assert.ok(src.includes("type: 'mutation_fallback'"), 'le repli possède une frame SSE dédiée');
    assert.ok(src.includes("type: 'mutation_rolled_back'"), 'le rollback possède une frame SSE dédiée');
    assert.ok(src.includes('configureStreamMutationEngine'), 'le moteur est injectable au bootstrap');

    // Le panneau Live Activity du Studio consomme la vue normalisée fournie par
    // le serveur : les nouvelles frames y apparaissent sans code spécifique.
    const studio = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.ok(studio.includes('event.activity && activityFeed'), 'le Studio rend event.activity');
    assert.ok(studio.includes('FILE_CREATED'), 'icône fichier créé présente');
    assert.ok(studio.includes('FILE_MODIFIED'), 'icône fichier modifié présente');
  });
});
