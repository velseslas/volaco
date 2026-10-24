/**
 * VibeCode Core — CDC V8 §11 : UI Agent design-aware (preuves d intégration).
 *
 * Preuves :
 *  - ContextOrchestrator : `includeDna` réellement CONSOMMÉ (avant ce
 *    correctif, le flag était déclaré mais jamais lu) — le Design DNA réel du
 *    projet (rapport Design Harmony persisté) est attaché au contexte de la
 *    tâche UI ; sans rapport : aucune clé ajoutée (non-régression stricte) ;
 *    une tâche sans includeDna ne déclenche AUCUNE lecture du store ;
 *  - BaseSpecializedAgent / UiAgent : le bloc Design DNA est injecté dans le
 *    prompt réellement envoyé au provider, et les artifacts UI tracent le
 *    Design DNA appliqué (payload historique inchangé sinon) ;
 *  - TaskDecomposer : les tâches UI (DAG standard ET plans à étapes) portent
 *    includeDna ;
 *  - MultiAgentScheduler : le contexte batch des tâches includeDna charge le
 *    Design DNA depuis le rapport persisté (même chargeur que le scheduler).
 *
 * Déterministe : provider IA factice injecté (aucun réseau), stores isolés
 * (VOLACO_DATA_DIR du lanceur de tests).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIProviderRegistry,
  ContextOrchestrator,
  MultiAgentScheduler,
  TaskDecomposer,
  UiAgent,
  buildProjectDesignContext,
  buildDesignSystemArtifact,
  deriveDesignDirection,
  designReportStore,
  type AgentExecutionService,
  type AgentTask,
  type AIProviderAdapter,
  type AIProviderGenerateRequest,
  type EngineeringPlan,
  type DesignHarmonyReport,
  type TaskContextPayload
} from '../../../src/index.js';

const TENANT = 'tenant-ui-dna-e53';
const PROJECT = 'proj-ui-dna-e53';

function makeReport(tenantId = TENANT, projectId = PROJECT): DesignHarmonyReport {
  return {
    reportId: 'dhr-ui-agent-0001',
    tenantId,
    projectId,
    analyzedRoutes: ['/'],
    overallScore: 71,
    subScores: {
      colorHarmony: 70,
      typographyHarmony: 72,
      spacingHarmony: 75,
      shapeHarmony: 68,
      elevationHarmony: 66,
      componentHarmony: 69,
      crossPageHarmony: 74,
      responsiveA11yHarmony: 73
    },
    inferredDesignSystem: {
      colorTokens: {
        primary: '#b45309',
        secondary: '#1f2937',
        accent: '#d97706',
        background: '#ffffff',
        surface: '#f9fafb',
        foreground: '#111827',
        border: '#e5e7eb'
      },
      typographyTokens: {
        primaryFontFamily: 'Inter',
        fontFamilies: ['Inter'],
        detectedScale: ['14px', '16px', '24px'],
        dominantLineHeightRatio: 1.5
      },
      spacingTokens: { baseGridStep: 8, detectedScale: [8, 16, 24, 32], regularityRatio: 0.8 },
      shapeTokens: {
        primaryButtonRadius: '10px',
        primaryCardRadius: '16px',
        primaryInputRadius: '10px',
        detectedRadii: ['10px', '16px']
      },
      elevationTokens: { detectedLevelsCount: 2, shadowLevels: ['a', 'b'] },
      systemConfidence: 0.8,
      evidenceCount: 90
    },
    findings: [
      {
        id: 'f-e53-1',
        category: 'COLOR',
        severity: 'HIGH',
        confidence: 0.9,
        pageRoute: '/',
        property: 'contrast',
        observedValue: 3.1,
        recommendation: 'Renforcer le contraste du CTA principal',
        designDrift: true,
        evidence: [{ source: 'WCAG_CALCULATION', detail: 'contraste mesuré', pageRoute: '/', occurrences: 1 }]
      }
    ],
    driftSummary: { totalDrifts: 1, criticalDrifts: 0 },
    reportHash: 'hash-ui-e53',
    generatedAt: '2026-10-18T09:30:00.000Z',
    durationMs: 30
  };
}

function makeUiTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-ui-e53',
    title: 'Refonte de la page d accueil',
    description: 'Modifier le hero et les cartes de services',
    domain: 'UI',
    priority: 6,
    dependencies: [],
    requiredContext: { targetFiles: ['src/pages/Home.tsx'], includeDna: true },
    requiredCapabilities: ['PAGE_GENERATION'],
    status: 'QUEUED',
    operation: 'MODIFY',
    retryCount: 0,
    maxRetries: 3,
    ...overrides
  };
}

class FakeDesignStore {
  public calls = 0;
  constructor(private readonly report?: DesignHarmonyReport | undefined) {}
  public get(tenantId: string, projectId: string): DesignHarmonyReport | undefined {
    this.calls += 1;
    if (!this.report) return undefined;
    return this.report.tenantId === tenantId && this.report.projectId === projectId ? this.report : undefined;
  }
}

class FakeAdapter implements AIProviderAdapter {
  public readonly prompts: string[] = [];
  public readonly descriptor = {
    providerId: 'fake-e53',
    providerName: 'Fake Provider (tests)',
    models: ['fake-1'],
    capabilities: ['CODE_GENERATION', 'FAST'] as const,
    contextWindow: 32768,
    structuredOutput: false,
    streaming: false,
    toolCalling: false,
    reasoning: false,
    vision: false,
    costMetadata: {},
    availability: 'AVAILABLE' as const,
    healthStatus: 'HEALTHY' as const
  };
  public async generate(request: AIProviderGenerateRequest) {
    this.prompts.push(request.prompt);
    return {
      text: '<section class="bg-white text-gray-900">contenu proposé</section>',
      providerId: 'fake-e53',
      modelId: 'fake-1',
      latencyMs: 1,
      usage: { inputTokens: 42, outputTokens: 7, totalTokens: 49 },
      costUsd: 0
    };
  }
}

describe('CDC V8 §11 — ContextOrchestrator consomme includeDna (Design DNA réel)', () => {
  it('1. tâche UI avec includeDna + rapport persisté → designContext attaché (tokens/direction/règles)', () => {
    const store = new FakeDesignStore(makeReport());
    const orchestrator = new ContextOrchestrator(undefined, undefined, undefined, store);

    const ctx = orchestrator.assembleTaskContext({
      tenantId: TENANT,
      projectId: PROJECT,
      task: makeUiTask()
    });

    assert.ok(ctx.designContext, 'designContext présent');
    assert.equal(ctx.designContext!.reportId, 'dhr-ui-agent-0001');
    assert.equal(ctx.designContext!.direction.style, 'Balanced Modern');
    assert.deepEqual(ctx.designContext!.tokens.palette[0], { role: 'primary', value: '#b45309' });
    assert.ok(ctx.designContext!.promptBlock.includes('CONTEXTE DESIGN OBLIGATOIRE'));
    assert.ok(ctx.designContext!.promptBlock.includes('dhr-ui-agent-0001'));
    // LOT 1 — catalogue versionné cité par le contexte.
    assert.equal(ctx.designContext!.rulesCatalogVersion, '1.0.0');
    assert.equal(store.calls, 1);
  });

  it('2. tâche UI avec includeDna mais AUCUN rapport → aucune clé designContext (non-régression stricte)', () => {
    const store = new FakeDesignStore(undefined);
    const orchestrator = new ContextOrchestrator(undefined, undefined, undefined, store);

    const ctx = orchestrator.assembleTaskContext({
      tenantId: TENANT,
      projectId: PROJECT,
      task: makeUiTask()
    });

    assert.equal('designContext' in ctx, false);
    assert.equal(store.calls, 1, 'le store a été consulté (aucun rapport)');
  });

  it('3. tâche SANS includeDna → le store Design n est jamais lu', () => {
    const store = new FakeDesignStore(makeReport());
    const orchestrator = new ContextOrchestrator(undefined, undefined, undefined, store);

    const ctx = orchestrator.assembleTaskContext({
      tenantId: TENANT,
      projectId: PROJECT,
      task: makeUiTask({
        domain: 'BACKEND',
        requiredContext: { targetFiles: ['src/server.ts'] }
      })
    });

    assert.equal('designContext' in ctx, false);
    assert.equal(store.calls, 0);
  });

  it('4. isolation : un rapport d un autre projet ne peut pas alimenter le contexte', () => {
    const store = new FakeDesignStore(makeReport('tenant-other', 'proj-other'));
    const orchestrator = new ContextOrchestrator(undefined, undefined, undefined, store);

    const ctx = orchestrator.assembleTaskContext({
      tenantId: TENANT,
      projectId: PROJECT,
      task: makeUiTask()
    });

    assert.equal('designContext' in ctx, false);
  });
});

describe('CDC V8 §11 — UiAgent : prompt + artifacts guidés par le Design DNA', () => {
  it('5. le prompt RÉEL envoyé au provider contient le bloc Design DNA borné', async () => {
    const adapter = new FakeAdapter();
    const registry = new AIProviderRegistry();
    registry.register(adapter);
    const agent = new UiAgent(registry);
    const context: TaskContextPayload = {
      relevantFiles: {},
      relevantSymbols: [],
      decisions: [],
      constraints: [],
      recentHistory: [],
      designContext: buildProjectDesignContext(makeReport())
    };

    const result = await agent.executeTask({
      task: makeUiTask(),
      context,
      tenantId: TENANT,
      projectId: PROJECT
    });

    assert.equal(result.degraded, false, 'provider factice réellement appelé');
    assert.equal(adapter.prompts.length, 1);
    const prompt = adapter.prompts[0]!;
    assert.ok(prompt.includes('CONTEXTE DESIGN OBLIGATOIRE'));
    assert.ok(prompt.includes('dhr-ui-agent-0001'));
    assert.ok(prompt.includes('Balanced Modern'));
    assert.ok(prompt.includes('primary #b45309'));
    assert.ok(prompt.includes('explique tes choix'));
  });

  it('6. artifacts UI : trace du Design DNA appliqué (UI_SPEC + raison du changement)', async () => {
    const adapter = new FakeAdapter();
    const registry = new AIProviderRegistry();
    registry.register(adapter);
    const agent = new UiAgent(registry);
    const context: TaskContextPayload = {
      relevantFiles: {},
      relevantSymbols: [],
      decisions: [],
      constraints: [],
      recentHistory: [],
      designContext: buildProjectDesignContext(makeReport())
    };

    const result = await agent.executeTask({
      task: makeUiTask(),
      context,
      tenantId: TENANT,
      projectId: PROJECT
    });

    const spec = result.artifacts.find((a) => a.kind === 'UI_SPEC');
    assert.ok(spec);
    const payload = spec.payload as {
      designAware?: boolean;
      designContextSource?: { reportId?: string; overallScore?: number };
      designDirection?: { style?: string };
      designDirectionSource?: string;
      designRulesApplied?: number;
      designRulesCatalogVersion?: string;
    };
    assert.equal(payload.designAware, true);
    assert.equal(payload.designContextSource?.reportId, 'dhr-ui-agent-0001');
    assert.equal(payload.designContextSource?.overallScore, 71);
    assert.equal(payload.designDirection?.style, 'Balanced Modern');
    assert.ok((payload.designRulesApplied ?? 0) >= 6);
    // LOT 1 — provenance de la direction + version du catalogue tracées.
    assert.equal(payload.designDirectionSource, 'derived');
    assert.equal(payload.designRulesCatalogVersion, '1.0.0');

    const change = result.artifacts.find((a) => a.kind === 'PROPOSED_FILE_CHANGE');
    assert.ok(change);
    const changePayload = change.payload as { reason?: string };
    assert.ok(changePayload.reason?.includes('design-aware'));
  });

  it('7. SANS designContext : prompt et artifacts STRICTEMENT historiques (non-régression)', async () => {
    const adapter = new FakeAdapter();
    const registry = new AIProviderRegistry();
    registry.register(adapter);
    const agent = new UiAgent(registry);
    const context: TaskContextPayload = {
      relevantFiles: {},
      relevantSymbols: [],
      decisions: [],
      constraints: [],
      recentHistory: []
    };

    const result = await agent.executeTask({
      task: makeUiTask(),
      context,
      tenantId: TENANT,
      projectId: PROJECT
    });

    assert.ok(!adapter.prompts[0]!.includes('CONTEXTE DESIGN OBLIGATOIRE'));
    const spec = result.artifacts.find((a) => a.kind === 'UI_SPEC');
    assert.ok(spec);
    const payload = spec.payload as Record<string, unknown>;
    assert.equal('designAware' in payload, false);
    assert.equal('designContextSource' in payload, false);
    const change = result.artifacts.find((a) => a.kind === 'PROPOSED_FILE_CHANGE');
    const changePayload = change!.payload as { reason?: string };
    assert.equal(changePayload.reason, 'Mise à jour d\'interface réalisée par UI & Layout Specialist');
  });
});

describe('CDC V8 §11 — TaskDecomposer : les tâches UI portent includeDna', () => {
  const basePlan = (steps: EngineeringPlan['steps']): EngineeringPlan => ({
    planId: 'plan-e53',
    title: 'Plan design-aware',
    summary: 'Vérification du flag includeDna sur les tâches UI',
    planHash: 'hash-plan-e53',
    status: 'APPROVED',
    steps
  });

  it('8. plan à étapes : l étape UI porte includeDna, les autres non', () => {
    const graph = new TaskDecomposer().decomposePlan(
      basePlan([
        {
          stepIndex: 0,
          title: 'Implémenter le service backend',
          description: 'Endpoints api du catalogue',
          targetDomain: 'BACKEND',
          targetFiles: ['src/server.ts'],
          operation: 'CREATE',
          requiresApproval: false
        },
        {
          stepIndex: 1,
          title: 'Composant interface catalogue',
          description: 'Concevoir la vue utilisateur et interface du catalogue',
          targetDomain: 'UI',
          targetFiles: ['src/components/Catalog.tsx'],
          operation: 'CREATE',
          requiresApproval: false
        }
      ])
    );

    const uiTask = graph.tasks.find((t) => t.domain === 'UI');
    const backendTask = graph.tasks.find((t) => t.domain === 'BACKEND');
    assert.ok(uiTask);
    assert.equal(uiTask.requiredContext.includeDna, true);
    assert.ok(backendTask);
    assert.equal('includeDna' in backendTask.requiredContext, false);
  });

  it('9. DAG standard (sans étapes) : la tâche UI porte toujours includeDna', () => {
    const graph = new TaskDecomposer().decomposePlan(
      basePlan([]),
      {
        category: 'CREATE',
        goal: 'Site vitrine du studio',
        requestedAction: 'Créer les pages',
        entities: [],
        constraints: [],
        urgency: 'NORMAL',
        confidence: 0.9,
        ambiguities: []
      }
    );

    const uiTask = graph.tasks.find((t) => t.domain === 'UI');
    assert.ok(uiTask);
    assert.equal(uiTask.requiredContext.includeDna, true);
    const dataTask = graph.tasks.find((t) => t.domain === 'DATA');
    assert.ok(dataTask);
    assert.equal('includeDna' in dataTask.requiredContext, false);
  });
});

describe('CDC V8 §11 — MultiAgentScheduler : contexte batch design-aware', () => {
  // Accès unitaire au constructeur de contexte (le pipeline d exécution
  // complet — gate/rollback — est déjà prouvé par les suites É32→É38).
  type SchedulerInternals = {
    buildContext(task: AgentTask, tenantId: string, projectId: string): TaskContextPayload;
  };

  it('10. tâche includeDna + rapport réellement persisté → designContext dans le contexte batch', () => {
    // Rapport réellement enregistré dans le store partagé (couple unique de
    // test — aucun impact sur les projets réels).
    designReportStore.record(makeReport());

    const scheduler = new MultiAgentScheduler(undefined as unknown as AgentExecutionService);
    const ctx = (scheduler as unknown as SchedulerInternals).buildContext(makeUiTask(), TENANT, PROJECT);

    assert.ok(ctx.designContext);
    assert.equal(ctx.designContext!.reportId, 'dhr-ui-agent-0001');
  });

  it('11. tâche sans includeDna → contexte minimal historique (aucune clé ajoutée)', () => {
    const scheduler = new MultiAgentScheduler(undefined as unknown as AgentExecutionService);
    const ctx = (scheduler as unknown as SchedulerInternals).buildContext(
      makeUiTask({ requiredContext: { targetFiles: ['src/pages/Home.tsx'] } }),
      TENANT,
      PROJECT
    );

    assert.equal('designContext' in ctx, false);
    assert.deepEqual(ctx.relevantFiles, {});
    assert.deepEqual(ctx.recentHistory, []);
  });
});

describe('CDC V8 §11 Lot 1 — artefact Design System consommé par l orchestrateur', () => {
  it('12. rapport + artefact frais injectés → direction PERSISTÉE dans le contexte de tâche', () => {
    const report = makeReport();
    const applied = deriveDesignDirection(report.inferredDesignSystem, {
      extractedColorCount: 6,
      extractedFonts: ['Inter'],
      interactiveElementsCount: 30,
      totalElementsCount: 400
    });
    const artifact = buildDesignSystemArtifact({
      report,
      direction: applied,
      dqi: 80,
      recordedAt: '2026-10-18T09:35:00.000Z'
    });
    const orchestrator = new ContextOrchestrator(
      undefined,
      undefined,
      undefined,
      new FakeDesignStore(report),
      { get: () => artifact }
    );

    const ctx = orchestrator.assembleTaskContext({
      tenantId: TENANT,
      projectId: PROJECT,
      task: makeUiTask()
    });

    assert.ok(ctx.designContext);
    assert.equal(ctx.designContext!.directionSource, 'persisted');
    assert.deepEqual(ctx.designContext!.direction, applied);
    assert.equal('density' in ctx.designContext!.direction, true, 'densité réelle de la route reprise');
  });
});
