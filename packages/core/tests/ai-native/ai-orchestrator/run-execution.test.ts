/**
 * V7-LOT6 — Sandbox dry-run & application confirmée d'un run AINT-010.
 *
 * Ces tests ne simulent pas le moteur de mutation : ils vérifient que le
 * service d'orchestration :
 *  - refuse tout run dégradé, conflit BLOCKING, artefact invalide ou HTML FAIL ;
 *  - n'écrit jamais en preview (dryRun=true) ;
 *  - exige confirm + acceptRisk/acceptBreaking selon les gates ;
 *  - ne délègue l'écriture qu'au MutationBridge (single writer) ;
 *  - produit un run COMPLETED/FAILED honnête et traçable.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AIOrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG } from '../../../src/ai-native/ai-orchestrator/service.js';
import type {
  AgentArtifact,
  OrchestrationRun
} from '../../../src/ai-native/ai-orchestrator/types.js';
import type { MutationOrchestratorService } from '../../../src/ai-native/mutation-orchestrator/service.js';
import type { ImpactIntelligenceService } from '../../../src/ai-native/impact-intelligence/service.js';
import type {
  BrowserSandboxReport,
  BrowserSandboxRunner
} from '../../../src/ai-native/validation/browser-sandbox.js';
import type { BrowserFunctionalTestsReport } from '../../../src/ai-native/validation/functional-tests.js';
import { auditStore } from '../../../src/observability/audit.js';

const TENANT = 'tenant-lot6';
const PROJECT = 'project-lot6';

const VALID_HTML = `<!DOCTYPE html>
<html lang="fr">
  <head><meta charset="utf-8"><title>Preuve sandbox</title></head>
  <body>
    <main>
      <h1>Preuve sandbox V7</h1>
      <p>Ce document est volontairement assez long pour passer le préflight déterministe et prouver une écriture contrôlée.</p>
    </main>
  </body>
</html>
`;

interface FakeCall {
  readonly plan: Record<string, unknown>;
  readonly options: Record<string, unknown>;
}

class FakeMutationService {
  public readonly calls: FakeCall[] = [];
  public readonly files = new Map<string, string>();

  public createPlan(request: Record<string, unknown>): Record<string, unknown> {
    return {
      planId: 'plan-lot6-test',
      tenantId: request.tenantId,
      projectId: request.projectId,
      mutations: request.mutations
    };
  }

  public executePlan(
    plan: Record<string, unknown>,
    options: Record<string, unknown>
  ): Record<string, unknown> {
    this.calls.push({ plan, options });
    const mutations = (plan.mutations as Array<{ operation: { path: string; content?: string } }>) ?? [];
    const dryRun = options.dryRun === true;
    if (!dryRun) {
      for (const mutation of mutations) {
        this.files.set(mutation.operation.path, mutation.operation.content ?? '');
      }
    }
    const diffs = mutations.map((mutation) => ({
      filePath: mutation.operation.path,
      operation: 'UPDATE_FILE',
      beforeContent: null,
      afterContent: mutation.operation.content ?? '',
      addedLines: 1,
      removedLines: 0
    }));
    return {
      success: true,
      dryRun,
      transaction: {
        transactionId: 'tx-lot6-test',
        planId: 'plan-lot6-test',
        tenantId: plan.tenantId,
        projectId: plan.projectId,
        status: 'COMMITTED',
        appliedMutations: mutations,
        diffs,
        snapshot: {
          snapshotId: 'snap-lot6',
          tenantId: plan.tenantId,
          projectId: plan.projectId,
          createdAt: new Date().toISOString(),
          files: {},
          originalTreeHash: 'tree-before'
        },
        durationMs: 1,
        transactionHash: 'tx-hash-lot6',
        createdAt: new Date().toISOString()
      },
      diffs
    };
  }
}

function makeArtifact(overrides?: Partial<AgentArtifact>): AgentArtifact {
  return {
    id: 'art-lot6-1',
    taskId: 'task-lot6-1',
    agentId: 'agent-ui-specialist',
    domain: 'UI',
    kind: 'PROPOSED_FILE_CHANGE',
    targetFiles: ['sandbox/lot6.html'],
    payload: {
      filePath: 'sandbox/lot6.html',
      operation: 'CREATE',
      proposedContent: VALID_HTML,
      reason: 'Preuve sandbox'
    },
    confidence: 0.95,
    summary: 'Artefact sandbox',
    hash: 'artifact-hash-lot6',
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function makeRun(overrides?: Partial<OrchestrationRun>): OrchestrationRun {
  return {
    orchestrationId: 'orch-lot6test00001',
    tenantId: TENANT,
    projectId: PROJECT,
    planId: 'plan-lot6-test',
    state: 'WAITING_HUMAN_APPROVAL',
    taskGraph: {
      graphId: 'graph-lot6',
      planId: 'plan-lot6-test',
      tasks: [],
      rootTaskIds: [],
      graphHash: 'graph-hash-lot6',
      isAcyclic: true
    },
    completedTaskIds: [],
    artifacts: [makeArtifact()],
    conflicts: [],
    traces: [],
    totalCostUsd: 0,
    totalTokens: 0,
    degradedCount: 0,
    repairCycles: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeService(options?: {
  impactService?: ImpactIntelligenceService | undefined;
  mutationService?: FakeMutationService | undefined;
  browserSandbox?: BrowserSandboxRunner | undefined;
}): { service: AIOrchestratorService; mutations: FakeMutationService } {
  const mutations = options?.mutationService ?? new FakeMutationService();
  const service = new AIOrchestratorService(
    undefined,
    options?.impactService,
    mutations as unknown as MutationOrchestratorService,
    undefined,
    undefined,
    undefined,
    DEFAULT_ORCHESTRATOR_CONFIG,
    undefined,
    options?.browserSandbox ?? passingSandbox()
  );
  return { service, mutations };
}

function sandboxReport(overrides?: Partial<BrowserSandboxReport>): BrowserSandboxReport {
  return {
    schemaVersion: '1.0.0',
    path: 'sandbox/lot6.html',
    verdict: 'PASS',
    passed: true,
    blocking: false,
    contentHash: 'a'.repeat(64),
    durationMs: 12,
    viewport: { width: 1280, height: 720 },
    title: 'Preuve sandbox',
    metrics: {
      domNodes: 10,
      interactiveElements: 1,
      visibleTextLength: 120,
      bodyElementCount: 2,
      documentWidth: 1280,
      horizontalOverflow: false,
      externalRequestsBlocked: 0,
      externalScriptsBlocked: 0,
      screenshotBytes: 1024,
      screenshotSha256: 'b'.repeat(64)
    },
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    blockers: [],
    warnings: [],
    checkedAt: new Date().toISOString(),
    ...overrides
  };
}

function passingSandbox(): BrowserSandboxRunner {
  return { run: async () => sandboxReport() };
}

function functionalReport(
  overrides?: Partial<BrowserFunctionalTestsReport>
): BrowserFunctionalTestsReport {
  return {
    schemaVersion: '1.0.0',
    verdict: 'PASS',
    passed: true,
    blocking: false,
    total: 3,
    passedCount: 3,
    failedCount: 0,
    warningCount: 0,
    skippedCount: 0,
    durationMs: 25,
    scenarios: [
      { id: 'load', name: 'Chargement', kind: 'LOAD', status: 'PASS', blocking: false, durationMs: 1 },
      { id: 'a11y', name: 'Noms accessibles', kind: 'A11Y', status: 'PASS', blocking: false, durationMs: 1 },
      { id: 'click-0', name: 'Clic sur Action', kind: 'INTERACTION', status: 'PASS', blocking: false, durationMs: 1 }
    ],
    notes: ['Scénarios générés à partir du DOM.'],
    plan: { buttons: 1, forms: 0, requiredForms: 0, interactiveElements: 2, missingNames: 0 },
    generatedFrom: 'DOM',
    checkedAt: new Date().toISOString(),
    ...overrides
  };
}

function highRiskImpact(): ImpactIntelligenceService {
  return {
    analyzeImpact: () => ({
      overallRisk: 'HIGH',
      metrics: { breakingCount: 0 }
    })
  } as unknown as ImpactIntelligenceService;
}

function breakingImpact(): ImpactIntelligenceService {
  return {
    analyzeImpact: () => ({
      overallRisk: 'LOW',
      metrics: { breakingCount: 2 }
    })
  } as unknown as ImpactIntelligenceService;
}

describe('V7-LOT6 — exécution sandbox et application confirmée AINT-010', () => {
  it('1. preview valide : dryRun réel, aucune écriture, diffs restitués', async () => {
    const { service, mutations } = makeService();
    const run = makeRun();

    const outcome = await service.previewRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      requestId: 'req-lot6-preview'
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.dryRun, true);
    assert.equal(outcome.transaction.status, 'COMMITTED');
    assert.equal(outcome.appliedCount, 1);
    assert.equal(outcome.diffs.length, 1);
    assert.equal(outcome.preflight.length, 1);
    assert.equal(outcome.preflight[0]?.report.passed, true);
    assert.equal(outcome.runtime.length, 1);
    assert.equal(outcome.runtime[0]?.report.passed, true);
    assert.equal(outcome.runtime[0]?.report.blocking, false);
    assert.equal(outcome.runtimeSkipped, 0);
    assert.equal(mutations.calls.length, 1);
    assert.equal(mutations.calls[0]?.options.dryRun, true);
    assert.equal(mutations.calls[0]?.options.allowHighRisk, true);
    assert.equal(mutations.calls[0]?.options.allowBreaking, true);
    assert.equal(mutations.files.size, 0, 'le sandbox ne doit rien écrire');
  });

  it('2. apply sans confirm : refus, aucune transaction', async () => {
    const { service, mutations } = makeService();
    const outcome = await service.applyRun(makeRun(), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      requestId: 'req-lot6-noconfirm'
    });

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, 'CONFIRMATION_REQUIRED');
    assert.equal(mutations.calls.length, 0);
  });

  it('3. apply confirmé : écriture réelle via le bridge, run COMPLETED et tracé', async () => {
    const { service, mutations } = makeService();
    const outcome = await service.applyRun(makeRun(), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      requestId: 'req-lot6-apply',
      confirm: true
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.dryRun, false);
    assert.equal(outcome.run.state, 'COMPLETED');
    assert.equal(outcome.run.mutationTransactionId, 'tx-lot6-test');
    assert.equal(outcome.appliedCount, 1);
    assert.equal(mutations.files.get('sandbox/lot6.html'), VALID_HTML);
    assert.equal(mutations.calls.length, 1);
    assert.equal(mutations.calls[0]?.options.dryRun, false);
    assert.equal(mutations.calls[0]?.options.allowBreaking, false);
    assert.ok(outcome.run.traces.some((trace) => trace.stateAfter === 'MUTATING'));
    assert.ok(outcome.run.traces.some((trace) => trace.stateAfter === 'COMPLETED'));
    assert.equal(Object.isFrozen(outcome.run), true);
  });

  it('4. run dégradé : refus avant toute transaction', async () => {
    const { service, mutations } = makeService();
    const outcome = await service.previewRun(makeRun({ degradedCount: 1 }), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER'
    });

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, 'DEGRADED_ARTIFACTS');
    assert.equal(mutations.calls.length, 0);
  });

  it('5. contenu dégradé résiduel : refus même si degradedCount est absent', async () => {
    const { service, mutations } = makeService();
    const artifact = makeArtifact({
      payload: {
        filePath: 'sandbox/lot6.html',
        operation: 'UPDATE',
        proposedContent: '[Mode Dégradé] aucun provider',
        reason: 'dégradé'
      }
    });
    const outcome = await service.previewRun(makeRun({ degradedCount: undefined, artifacts: [artifact] }), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER'
    });

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, 'DEGRADED_ARTIFACTS');
    assert.equal(mutations.calls.length, 0);
  });

  it('6. HTML invalide : préflight FAIL, aucun appel de mutation', async () => {
    const { service, mutations } = makeService();
    const artifact = makeArtifact({
      payload: {
        filePath: 'sandbox/lot6.html',
        operation: 'CREATE',
        proposedContent: '<div>trop court</div>',
        reason: 'invalide'
      }
    });
    const outcome = await service.applyRun(makeRun({ artifacts: [artifact] }), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      confirm: true
    });

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, 'PREFLIGHT_FAILED');
    assert.equal(outcome.preflight?.length, 1);
    assert.equal(outcome.preflight?.[0]?.report.passed, false);
    assert.equal(mutations.calls.length, 0);
  });

  it('7. risque HIGH : acceptRisk obligatoire, puis application', async () => {
    const { service, mutations } = makeService({ impactService: highRiskImpact() });
    const run = makeRun();

    const refused = await service.applyRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      confirm: true
    });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.code, 'RISK_ACCEPTANCE_REQUIRED');
    assert.equal(mutations.calls.length, 0);

    const applied = await service.applyRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      confirm: true,
      acceptRisk: true
    });
    assert.equal(applied.ok, true);
    assert.equal(mutations.calls.length, 1);
  });

  it('8. changement BREAKING : acceptBreaking obligatoire et propagé au bridge', async () => {
    const { service, mutations } = makeService({ impactService: breakingImpact() });
    const run = makeRun();

    const refused = await service.applyRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      confirm: true,
      acceptRisk: true
    });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.code, 'BREAKING_ACCEPTANCE_REQUIRED');
    assert.equal(mutations.calls.length, 0);

    const applied = await service.applyRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      confirm: true,
      acceptBreaking: true
    });
    assert.equal(applied.ok, true);
    assert.equal(mutations.calls[0]?.options.allowBreaking, true);
  });

  it('9. conflit BLOCKING et run déjà appliqué : refus explicites', async () => {
    const { service, mutations } = makeService();
    const conflict = {
      conflictId: 'c1',
      involvedAgents: ['a', 'b'],
      affectedFiles: ['sandbox/lot6.html'],
      description: 'Deux agents écrivent le même fichier',
      severity: 'BLOCKING' as const,
      requiresHumanIntervention: true
    };
    const blocked = await service.previewRun(makeRun({ conflicts: [conflict] }), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER'
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, 'BLOCKING_CONFLICTS');

    const already = await service.previewRun(makeRun({ mutationTransactionId: 'tx-old' }), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER'
    });
    assert.equal(already.ok, false);
    if (!already.ok) assert.equal(already.code, 'RUN_ALREADY_EXECUTED');
    assert.equal(mutations.calls.length, 0);
  });

  it('10. chemin interdit : refus de sécurité avant la ValidationGate', async () => {
    const { service, mutations } = makeService();
    const artifact = makeArtifact({
      targetFiles: ['../secret.html'],
      payload: {
        filePath: '../secret.html',
        operation: 'CREATE',
        proposedContent: VALID_HTML,
        reason: 'traversée'
      }
    });
    const outcome = await service.previewRun(makeRun({ artifacts: [artifact] }), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER'
    });

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, 'INVALID_ARTIFACTS');
    assert.equal(mutations.calls.length, 0);
  });

  it('11. mauvais tenant : refus sans révéler le run', async () => {
    const { service, mutations } = makeService();
    const outcome = await service.previewRun(makeRun(), {
      tenantId: 'other-tenant',
      projectId: PROJECT,
      userRole: 'ENGINEER'
    });

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, 'RUN_NOT_FOUND');
    assert.equal(mutations.calls.length, 0);
  });

  it('12. échec dur du sandbox navigateur : preview ET apply refusés, aucune écriture', async () => {
    const failingSandbox: BrowserSandboxRunner = {
      run: async () => sandboxReport({
        verdict: 'FAIL',
        passed: false,
        blocking: true,
        blockers: ['Erreur JavaScript : Error: boom-lot7'],
        pageErrors: ['Error: boom-lot7']
      })
    };
    const { service, mutations } = makeService({ browserSandbox: failingSandbox });
    const run = makeRun({ orchestrationId: 'orch-lot7runtimefail01' });

    const preview = await service.previewRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER'
    });
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.code, 'RUNTIME_FAILED');
    assert.equal(preview.runtime?.length, 1);
    assert.equal(preview.runtime?.[0]?.report.blocking, true);
    assert.match(preview.message, /boom-lot7/);

    const runtimeAudit = auditStore
      .query(TENANT, { action: 'AI_ORCHESTRATION_RUNTIME_CHECKED' })
      .filter((event) => event.resourceId === run.orchestrationId);
    assert.ok(runtimeAudit.length >= 1, 'le verdict runtime doit être audité');
    assert.equal(runtimeAudit[0]?.status, 'FAILURE');
    assert.match(JSON.stringify(runtimeAudit[0]?.metadata ?? {}), /"verdict":"FAIL"/);

    const apply = await service.applyRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      confirm: true
    });
    assert.equal(apply.ok, false);
    if (apply.ok) return;
    assert.equal(apply.code, 'RUNTIME_FAILED');
    assert.equal(mutations.calls.length, 0, 'le bridge ne doit jamais être appelé');
    assert.equal(mutations.files.size, 0);
  });

  it('13. avertissements runtime : consultatifs, l’apply reste possible', async () => {
    const warningSandbox: BrowserSandboxRunner = {
      run: async () => sandboxReport({
        verdict: 'PASS_WITH_WARNINGS',
        passed: true,
        blocking: false,
        warnings: ['2 requête(s) externe(s) bloquée(s).']
      })
    };
    const { service, mutations } = makeService({ browserSandbox: warningSandbox });

    const outcome = await service.applyRun(makeRun(), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      confirm: true
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.runtime[0]?.report.verdict, 'PASS_WITH_WARNINGS');
    assert.equal(outcome.run.state, 'COMPLETED');
    assert.equal(mutations.files.get('sandbox/lot6.html'), VALID_HTML);
  });

  it('14. plus de 3 documents HTML : borne explicite et compteur de pages non exécutées', async () => {
    const artifacts = [0, 1, 2, 3].map((index) => {
      const path = `sandbox/multi-${index}.html`;
      return makeArtifact({
        id: `art-multi-${index}`,
        targetFiles: [path],
        payload: {
          filePath: path,
          operation: 'CREATE',
          proposedContent: VALID_HTML,
          reason: 'Preuve borne sandbox'
        }
      });
    });
    let calls = 0;
    const countingSandbox: BrowserSandboxRunner = {
      run: async (_html, options) => {
        calls += 1;
        return sandboxReport({ path: options?.path ?? 'sandbox/unknown.html' });
      }
    };
    const { service } = makeService({ browserSandbox: countingSandbox });

    const outcome = await service.previewRun(makeRun({
      orchestrationId: 'orch-lot7skip0001',
      artifacts
    }), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER'
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(calls, 3, 'seuls 3 documents sont exécutés');
    assert.equal(outcome.runtime.length, 3);
    assert.equal(outcome.runtimeSkipped, 1, 'la 4e page est comptée, pas ignorée silencieusement');
  });

  it('15. tests fonctionnels PASS : exposés et audités pour chaque preview', async () => {
    const functionalSandbox: BrowserSandboxRunner = {
      run: async () => sandboxReport({ functionalTests: functionalReport() })
    };
    const { service, mutations } = makeService({ browserSandbox: functionalSandbox });
    const run = makeRun({ orchestrationId: 'orch-lot8functionalpass01' });

    const outcome = await service.previewRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      requestId: 'req-lot8-functional-pass'
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.functionalTests.verdict, 'PASS');
    assert.equal(outcome.functionalTests.blocking, false);
    assert.equal(outcome.functionalTests.total, 3);
    assert.equal(outcome.functionalTests.documents.length, 1);
    assert.equal(outcome.functionalTests.documents[0]?.path, 'sandbox/lot6.html');
    assert.equal(mutations.calls.length, 1);
    assert.equal(mutations.calls[0]?.options.dryRun, true);

    const functionalAudit = auditStore
      .query(TENANT, { action: 'AI_ORCHESTRATION_FUNCTIONAL_TESTS_CHECKED' })
      .filter((event) => event.resourceId === run.orchestrationId);
    assert.ok(functionalAudit.length >= 1, 'le verdict fonctionnel doit être audité');
    assert.equal(functionalAudit[0]?.status, 'SUCCESS');
    assert.match(JSON.stringify(functionalAudit[0]?.metadata ?? {}), /"verdict":"PASS"/);
  });

  it('16. tests fonctionnels FAIL : preview ET apply refusés, aucune écriture', async () => {
    const functionalTests = functionalReport({
      verdict: 'FAIL',
      passed: false,
      blocking: true,
      failedCount: 1,
      passedCount: 2,
      scenarios: [
        { id: 'load', name: 'Chargement', kind: 'LOAD', status: 'PASS', blocking: false, durationMs: 1 },
        { id: 'a11y', name: 'Noms accessibles', kind: 'A11Y', status: 'PASS', blocking: false, durationMs: 1 },
        {
          id: 'click-0',
          name: 'Clic sur Action',
          kind: 'INTERACTION',
          status: 'FAIL',
          blocking: true,
          durationMs: 5,
          message: 'Erreur JavaScript après clic : Error: functional-test-boom'
        }
      ]
    });
    const functionalSandbox: BrowserSandboxRunner = {
      run: async () => sandboxReport({ functionalTests })
    };
    const { service, mutations } = makeService({ browserSandbox: functionalSandbox });
    const run = makeRun({ orchestrationId: 'orch-lot8functionalfail01' });

    const preview = await service.previewRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      requestId: 'req-lot8-functional-fail-preview'
    });
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.code, 'FUNCTIONAL_TESTS_FAILED');
    assert.match(preview.message, /functional-test-boom/);
    assert.equal(preview.functionalTests?.blocking, true);
    assert.equal(preview.functionalTests?.verdict, 'FAIL');
    assert.equal(preview.runtime?.[0]?.report.verdict, 'PASS', 'le runtime de chargement reste sain');
    assert.equal(mutations.calls.length, 0);

    const functionalAudit = auditStore
      .query(TENANT, { action: 'AI_ORCHESTRATION_FUNCTIONAL_TESTS_CHECKED' })
      .filter((event) => event.resourceId === run.orchestrationId);
    assert.ok(functionalAudit.length >= 1);
    assert.equal(functionalAudit[0]?.status, 'FAILURE');
    assert.match(JSON.stringify(functionalAudit[0]?.metadata ?? {}), /"verdict":"FAIL"/);

    const apply = await service.applyRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      confirm: true
    });
    assert.equal(apply.ok, false);
    if (apply.ok) return;
    assert.equal(apply.code, 'FUNCTIONAL_TESTS_FAILED');
    assert.equal(mutations.calls.length, 0, 'le bridge ne doit jamais être appelé');
    assert.equal(mutations.files.size, 0);
  });

  it('17. tests fonctionnels avec WARN : non bloquants, tracés dans la mutation', async () => {
    const functionalTests = functionalReport({
      verdict: 'PASS_WITH_WARNINGS',
      warningCount: 1,
      passedCount: 2,
      scenarios: [
        { id: 'load', name: 'Chargement', kind: 'LOAD', status: 'PASS', blocking: false, durationMs: 1 },
        { id: 'a11y', name: 'Noms accessibles', kind: 'A11Y', status: 'WARN', blocking: false, durationMs: 1, message: '1 élément sans nom accessible' },
        { id: 'click-0', name: 'Clic sur Action', kind: 'INTERACTION', status: 'PASS', blocking: false, durationMs: 1 }
      ]
    });
    const functionalSandbox: BrowserSandboxRunner = {
      run: async () => sandboxReport({ functionalTests })
    };
    const { service, mutations } = makeService({ browserSandbox: functionalSandbox });

    const outcome = await service.applyRun(makeRun(), {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      confirm: true,
      requestId: 'req-lot8-functional-warn'
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.functionalTests.verdict, 'PASS_WITH_WARNINGS');
    assert.equal(outcome.functionalTests.blocking, false);
    assert.equal(outcome.run.state, 'COMPLETED');
    assert.equal(mutations.files.get('sandbox/lot6.html'), VALID_HTML);
    const mutatingTrace = outcome.run.traces.find((trace) => trace.stateAfter === 'MUTATING');
    assert.ok(mutatingTrace);
    assert.match(JSON.stringify(mutatingTrace?.metadata ?? {}), /"functionalTests"/);
    assert.match(JSON.stringify(mutatingTrace?.metadata ?? {}), /"PASS_WITH_WARNINGS"/);
  });

  it('18. Chromium indisponible : UNAVAILABLE explicite et non bloquant', async () => {
    const unavailableSandbox: BrowserSandboxRunner = {
      run: async () => sandboxReport({
        verdict: 'UNAVAILABLE',
        passed: false,
        blocking: false,
        warnings: ['Chromium introuvable : aucun test fonctionnel exécuté.']
      })
    };
    const { service, mutations } = makeService({ browserSandbox: unavailableSandbox });
    const run = makeRun({ orchestrationId: 'orch-lot8unavailable01' });

    const preview = await service.previewRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      requestId: 'req-lot8-unavailable-preview'
    });
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.equal(preview.runtime[0]?.report.verdict, 'UNAVAILABLE');
    assert.equal(preview.functionalTests.verdict, 'UNAVAILABLE');
    assert.equal(preview.functionalTests.blocking, false);
    assert.equal(preview.functionalTests.documents.length, 0);

    const apply = await service.applyRun(run, {
      tenantId: TENANT,
      projectId: PROJECT,
      userRole: 'ENGINEER',
      confirm: true,
      requestId: 'req-lot8-unavailable-apply'
    });
    assert.equal(apply.ok, true);
    if (!apply.ok) return;
    assert.equal(apply.functionalTests.verdict, 'UNAVAILABLE');
    assert.equal(apply.functionalTests.blocking, false);
    assert.equal(apply.run.state, 'COMPLETED');
    assert.equal(mutations.files.get('sandbox/lot6.html'), VALID_HTML);
  });
});
