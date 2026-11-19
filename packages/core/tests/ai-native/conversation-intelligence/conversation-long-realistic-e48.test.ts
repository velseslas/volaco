/**
 * É48 — Conversations longues et réalistes : le parcours RÉEL de production
 * (Utilisateur → compréhension → continuité → clarification → planification →
 * sélection des agents → exécution sécurisée → supervision É46 → réponse É47 →
 * mémoire → tour suivant), éproué de bout en bout sur la MÊME session.
 *
 * Défauts démontrés par la sonde É48 (traces AVANT/APRÈS reproductibles,
 * parcours RÉEL ConversationIntelligenceService → ExecutionBridge →
 * MultiAgentScheduler É37 → AgentExecutionService É32→É36 → superviseur É46 →
 * réponse É47 — provider de capture DÉLÉGUANT au DefaultReasoningProvider de
 * production, agents réels UI/BACKEND/DATA) :
 *
 *   DÉFAUT 1 — ROUTAGE PAR PROVENANCE (execution-bridge.ts, chemin routé) :
 *     le routage lisait `session.activeIntent` + le message du DERNIER tour au
 *     lieu du tour qui a PORTÉ le plan. Un tour parasite (précision, rappel
 *     d'interdit, question) entre la planification et l'exécution rendait un
 *     plan APPROUVÉ inexécutable : refus `UNSUPPORTED_INTENT` (intent 'TEST'
 *     pour S1, 'EXPLORATION' pour S4) — mission perdue malgré l'approbation.
 *     AVANT : S1 « fichier réellement créé » ✘ ; S4 « mission VALIDATED » ✘ et
 *     « le service demandé existe » ✘. APRÈS : ✔ ✔ ✔.
 *
 *   DÉFAUT 2 — CLASSIFICATION PAR SOUS-CHAÎNE (intent-engine.ts, patterns
 *     TEST) : `/spec/i` matchait « re**spect**er » → la précision « doit
 *     respecter l'accessibilité » était classée TEST@0.85, ce qui bloquait la
 *     reprise É43 (elle exige EXPLORATION@≤0.5) : la précision était
 *     silencieusement perdue et `activeIntent` pollué (cause amont du DÉFAUT 1
 *     en S1). AVANT : S1 ✘. APRÈS : reprise É43 → intent CREATE combiné →
 *     NOUVEAU plan ciblant le fichier → exécution routée réussie.
 *
 * Corrections vérifiées ICI (parcours RÉEL, pattern É45/É46/É47 — aucun
 * agent.executeTask() direct hors contrat, MÊME AgentExecutionService que
 * server.ts, MÊME MultiAgentScheduler, MÊMES gates/rollback/supervision) :
 *   C1 — le routé s'ancre sur le tour qui a PORTÉ le plan (provenance
 *        `originTurn = turns.find(t => t.plan?.planId === plan.planId)`), avec
 *        repli historique (`activeIntent`/dernier tour) inchangé ;
 *        `fallbackTargetFile`/`planMutationStep` ne sont transmis au routeur
 *        que si AUCUN fichier n'est extrait du message d'origine — aucune
 *        cible inventée (O-B2 préservé, PlanGenerator inchangé) ;
 *   C2 — `/spec` borné à un DÉBUT DE MOT : « spec.ts », « la spec », « specs »
 *        restent TEST ; « respecter » ne l'est plus.
 *
 * Chaque scénario Ci réplique le scénario correspondant de la sonde É48
 * (messages IDENTIQUES) avec un calibrage corrigé :
 *   - S8 mission 1 : « rien d'écrit » est vérifié AVANT la mission 2 (la sonde
 *     l'évaluait après → artefact d'instrument, pas un défaut produit) ;
 *   - les réponses routées É47 (composeur gelé) annoncent les interdits
 *     uniquement sur REFUS et sur BATCH VALIDATED (« Vos interdits actifs ont
 *     été respectés ») — jamais dans une réponse ROUTED courte : les critères
 *     de sonde exigeant un token interne ('VALIDATED') ou le chemin de
 *     l'interdit dans une réponse ROUTED sont recalibrés sur des invariants
 *     stables (succès réel + interdit respecté prouvé par la mémoire et la
 *     source) ;
 *   - les limites documentées (plafond de 2 corrections atteint : D3
 *     sur-clarification CREATE sans entité, S10b demande elliptique traitée
 *     comme une nouvelle demande, S11 « cette partie » sans clarification) sont
 *     épinglées sur leurs invariants stables (aucune invention de cible,
 *     aucune fausse annonce, aucune mutation non autorisée), pas sur leur
 *     forme exacte — un correctif futur légitime reste vert.
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
  BaseSpecializedAgent,
  REFERENCE_AGENT_ID,
  ConversationIntelligenceService,
  DefaultReasoningProvider,
  computeEngineeringPlanHash,
  type AgentTask,
  type AgentResult,
  type AgentArtifact,
  type TaskContextPayload,
  type EngineeringPlan,
  type PlanStep,
  type IntentResult,
  type ConversationSession,
  type ReasoningProvider,
  type ReasoningRequest,
  type ReasoningResponse
} from '../../../src/index.js';

// ---------------------------------------------------------------------------
// Provider de capture DÉLÉGUANT au provider de production (pattern sonde É48 :
// le comportement observé est EXACTEMENT celui du service, aucune simulation).
// ---------------------------------------------------------------------------

interface CapturedTurn {
  readonly userMessage: string;
  readonly intentCategory: string | null;
  readonly historySize: number;
  readonly historyLast: string | null;
  readonly knownConstraints: readonly string[];
  readonly recentMessages: number;
  readonly nextAction: string | null;
  readonly reply: string;
}

function makeCaptureProviderE48(captured: CapturedTurn[]): ReasoningProvider {
  const inner = new DefaultReasoningProvider();
  return {
    async reason(request: ReasoningRequest): Promise<ReasoningResponse> {
      const res = await inner.reason(request);
      const history = request.history ?? [];
      const last = history.length > 0 ? history[history.length - 1] : undefined;
      captured.push({
        userMessage: request.userMessage,
        intentCategory: request.intent ? request.intent.category : null,
        historySize: history.length,
        historyLast: last ? `${last.sender}:«${last.content.slice(0, 60)}»` : null,
        knownConstraints: [...(request.memory.project.knownConstraints ?? [])],
        recentMessages: (request.memory.turn.recentMessages ?? []).length,
        nextAction: res.nextAction,
        reply: res.reply
      });
      return res;
    }
  };
}

// ---------------------------------------------------------------------------
// Fabriques de référence (pattern É39/É45/É46/É47)
// ---------------------------------------------------------------------------

let planSeq = 0;
let intentSeq = 0;

function makePlanE48(steps: readonly PlanStep[]): EngineeringPlan {
  planSeq += 1;
  const partial = {
    planId: `plan-e48-${planSeq}`,
    title: 'Plan É48',
    summary: `Plan de test É48 (${steps.length} étape(s))`,
    steps,
    status: 'APPROVED' as const
  };
  return { ...partial, planHash: computeEngineeringPlanHash(partial) };
}

function makeIntentE48(category: 'CREATE' | 'MODIFY' | 'DELETE', goal: string, entities: readonly string[] = []): IntentResult {
  intentSeq += 1;
  return {
    category,
    goal,
    requestedAction: category.toLowerCase(),
    entities: [...entities],
    constraints: [],
    urgency: 'NORMAL',
    confidence: 0.9,
    ambiguities: []
  };
}

interface StepOptions {
  readonly targetDomain?: string | undefined;
  readonly dependsOn?: readonly number[] | undefined;
}

const mutationStepE48 = (
  index: number,
  file: string,
  operation: 'CREATE' | 'MODIFY' | 'DELETE' = 'CREATE',
  options: StepOptions = {}
): PlanStep => ({
  stepIndex: index,
  title: `${operation} ${file}`,
  description: `${operation} du fichier ${file}`,
  targetFiles: [file],
  operation,
  requiresApproval: false,
  ...(options.targetDomain !== undefined ? { targetDomain: options.targetDomain } : {}),
  ...(options.dependsOn !== undefined ? { dependsOn: options.dependsOn } : {})
});

/** Étapes de MUTATION d'un plan (hors ANALYZE/VERIFY) — cibles réelles. */
const mutationTargetsOf = (plan: EngineeringPlan | null | undefined): readonly string[] =>
  (plan?.steps ?? [])
    .filter((s) => s.operation !== 'ANALYZE' && s.operation !== 'VERIFY')
    .flatMap((s) => [...(s.targetFiles ?? [])]);

// ---------------------------------------------------------------------------
// Agents de capture (pattern É45/É46/É47 — état dans des closures, JAMAIS
// l'instance ; capabilities réelles de production + FILE_MUTATION).
// ---------------------------------------------------------------------------

type CaptureRecord = {
  readonly taskId: string;
  readonly agentId: string;
  readonly targetFiles: readonly string[];
};

/** Capabilities RÉELLES des agents de production (pattern É45). */
const REAL_CAPS: Record<string, readonly string[]> = {
  UI: ['PAGE_GENERATION', 'COMPONENT_STYLING', 'RESPONSIVE_LAYOUT'],
  BACKEND: ['API_DESIGN', 'SERVICE_LOGIC'],
  DATA: ['SCHEMA_MODELING', 'DATA_INTEGRITY']
};

const ZERO_TOKENS = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

interface AgentBehaviorE48 {
  readonly failFor?: ReadonlySet<string>;
}

function makeSpecialistE48(
  captures: CaptureRecord[],
  id: string,
  domain: string,
  behavior: AgentBehaviorE48 = {}
): BaseSpecializedAgent {
  const caps = [...(REAL_CAPS[domain] ?? [])];
  caps.push('FILE_MUTATION');
  class SpecialistAgent extends BaseSpecializedAgent {
    constructor() {
      super(
        {
          id,
          name: `E48 ${domain}`,
          domain: domain as never,
          capabilities: caps as never[],
          description: `agent de test É48 : spécialité ${domain} (capabilities réelles de production)`,
          riskLevel: 'LOW' as never,
          requiredProviderCapabilities: [],
          allowedTools: []
        },
        undefined
      );
    }
    public override async executeTask(params: { task: AgentTask; context: TaskContextPayload }): Promise<AgentResult> {
      const targetFile = params.task.requiredContext.targetFiles?.[0];
      const key = targetFile ?? '';
      captures.push({
        taskId: params.task.id,
        agentId: id,
        targetFiles: [...(params.task.requiredContext.targetFiles ?? [])]
      });
      if (!targetFile || (behavior.failFor?.has(key) ?? false)) {
        return {
          taskId: params.task.id,
          agentId: id,
          status: 'FAILURE' as const,
          artifacts: [],
          conflicts: [],
          tokensUsed: ZERO_TOKENS,
          durationMs: 1,
          error: 'E48_FAIL_INJECTE'
        };
      }
      const operation =
        params.task.operation === 'DELETE' ? 'DELETE' : params.task.operation === 'MODIFY' ? 'UPDATE' : 'CREATE';
      const artifact = (path: string, op: string): AgentArtifact => ({
        id: `art-${params.task.id}-${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        taskId: params.task.id,
        agentId: id,
        domain: domain as never,
        kind: 'PROPOSED_FILE_CHANGE',
        targetFiles: [path],
        payload: {
          filePath: path,
          operation: op,
          proposedContent: `// e48 ${params.task.id} -> ${path}\n`,
          reason: 'É48'
        },
        confidence: 1,
        hash: `hash-e48-${params.task.id}-${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        summary: 'É48'
      });
      return {
        taskId: params.task.id,
        agentId: id,
        status: 'SUCCESS' as const,
        degraded: false,
        artifacts: [artifact(targetFile, operation)],
        conflicts: [],
        tokensUsed: ZERO_TOKENS,
        durationMs: 1
      };
    }
    protected buildArtifacts(): readonly [] {
      return [];
    }
  }
  return new SpecialistAgent();
}

// ---------------------------------------------------------------------------
// Chaîne RÉELLE (wiring identique à apps/api/src/server.ts — pattern É45/É46/É47)
// ---------------------------------------------------------------------------

interface ExecOutcomeE48 {
  success: boolean;
  message: string;
  userReply?: string;
  error?: string;
  supervision?: { readonly decision?: string } & Record<string, unknown>;
  session: ConversationSession;
  plan: EngineeringPlan | null;
}

describe('É48 — conversations longues et réalistes : parcours réel de production', () => {
  let fileSource: InMemoryMutableFileSource;
  let svc: ConversationIntelligenceService;
  let captures: CaptureRecord[];
  let capTurns: CapturedTurn[];
  let runSeq = 0;
  const tenantId = 'tenant-e48-conv';
  let projectId: string;

  interface StackOptions {
    readonly ui?: AgentBehaviorE48;
    readonly backend?: AgentBehaviorE48;
    readonly data?: AgentBehaviorE48;
  }

  function buildStack(options: StackOptions = {}): void {
    runSeq += 1;
    projectId = `proj-e48-conv-${runSeq}`;
    captures = [];
    capTurns = [];
    const stackFileSource = new InMemoryMutableFileSource({});
    const codeIntel = new CodeIntelligenceService(stackFileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, stackFileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(stackFileSource, codeIntel, dna, graph, impact);
    const orchestrator = new AIOrchestratorService(
      undefined,
      undefined,
      mutationOrchestrator,
      undefined,
      undefined,
      undefined,
      undefined,
      stackFileSource
    );
    fileSource = stackFileSource;
    const registry = orchestrator.getExecutionAgentRegistry();
    registry.unregister(REFERENCE_AGENT_ID);
    registry.register(makeSpecialistE48(captures, 'agent-e48-ui', 'UI', options.ui ?? {}));
    registry.register(makeSpecialistE48(captures, 'agent-e48-backend', 'BACKEND', options.backend ?? {}));
    registry.register(makeSpecialistE48(captures, 'agent-e48-data', 'DATA', options.data ?? {}));
    svc = new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
    svc.attachAgentExecutor({
      execute: (request) => orchestrator.executeAgent(request),
      getRegistry: () => orchestrator.getExecutionAgentRegistry(),
      executeBatch: (request) => orchestrator.executeBatch(request)
    });
  }

  function providerE48(): ReasoningProvider {
    return makeCaptureProviderE48(capTurns) as ReasoningProvider;
  }

  /** Un tour RÉEL de la conversation (compréhension → continuité → plan). */
  async function turn(
    session: ConversationSession,
    message: string
  ): Promise<{ session: ConversationSession; turnContent: string }> {
    const res = await svc.processTurn({
      tenantId: session.tenantId,
      projectId: session.projectId,
      sessionId: session.sessionId,
      message,
      reasoningProvider: providerE48()
    });
    return { session: res.session, turnContent: res.turn.agentResponse.content };
  }

  async function confirmAndExecute(
    session: ConversationSession,
    options?: { readonly supervisionRepair?: { readonly enabled: boolean; readonly maxAttempts?: number } }
  ): Promise<ExecOutcomeE48> {
    const cur = svc.getSession(session.tenantId, session.projectId, session.sessionId, 'OWNER', undefined) ?? session;
    assert.ok(cur.activePlan, `un plan actif doit être présent pour l'exécution (${cur.currentState})`);
    const plan = cur.activePlan;
    await svc.confirmPlan({
      tenantId: session.tenantId,
      projectId: session.projectId,
      sessionId: session.sessionId,
      planId: plan.planId,
      approved: true
    });
    const result = await svc.executeApprovedPlan(
      { tenantId: session.tenantId, projectId: session.projectId, sessionId: session.sessionId },
      'OWNER',
      undefined,
      options
    );
    const raw = result.executionResult as unknown as {
      success: boolean;
      message: string;
      userReply?: string;
      error?: string;
      supervision?: { decision?: string } & Record<string, unknown>;
    };
    return {
      success: raw.success,
      message: raw.message,
      ...(raw.userReply !== undefined ? { userReply: raw.userReply } : {}),
      ...(raw.error !== undefined ? { error: raw.error } : {}),
      ...(raw.supervision !== undefined ? { supervision: raw.supervision } : {}),
      session: result.session,
      plan
    };
  }

  function snapshot(tenant: string, project: string, paths: readonly string[]): Record<string, string | null> {
    const snap: Record<string, string | null> = {};
    for (const p of paths) {
      const f = fileSource.getFile(tenant, project, p);
      snap[p] = f ? f.content : null;
    }
    return snap;
  }
  const sameSnap = (a: Record<string, string | null>, b: Record<string, string | null>): boolean =>
    JSON.stringify(a) === JSON.stringify(b);

  const lastCapture = (): CapturedTurn => {
    assert.ok(capTurns.length > 0, 'au moins un tour capturé');
    return capTurns[capTurns.length - 1]!;
  };

  beforeEach(() => {
    buildStack();
  });

  // =========================================================================
  // SECTION A — Correction 1 : routage par PROVENANCE (le tour qui a porté
  // le plan) + contrats routés gelés (aucune cible inventée).
  // =========================================================================
  describe('SECTION A : le plan approuvé survit aux tours parasites (routage par provenance)', () => {
    it('A1: rappel d interdit entre planification et exécution → mission réussie (AVANT : UNSUPPORTED_INTENT)', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le service src/api/e48-a1.service.ts');
      assert.ok(mutationTargetsOf(t1.session.activePlan).includes('src/api/e48-a1.service.ts'), 'le plan t1 vise le fichier demandé');
      // Tour PARASITE : ni une demande, ni une mutation — un simple rappel.
      const t2 = await turn(t1.session, 'N oublie pas : src/legacy/e48-a1.ts doit rester intact');
      const cap2 = lastCapture();
      assert.notEqual(cap2.intentCategory, 'CREATE', 'le rappel n est pas compris comme une nouvelle demande de création');
      const ex = await confirmAndExecute(t2.session);
      assert.equal(ex.success, true, `le plan approuvé reste exécutable après le tour parasite (${ex.error ?? ex.message})`);
      assert.ok(!(ex.error ?? '').includes('UNSUPPORTED_INTENT'), 'aucun refus de routage : la mission n est pas perdue');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/api/e48-a1.service.ts'), 'le service demandé est réellement créé');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/legacy/e48-a1.ts'), null, 'le fichier interdit n est jamais créé');
    });

    it('A2: message d origine sans fichier → la cible vient du PLAN (fallback), jamais inventée', async () => {
      const session = svc.createSession({ tenantId, projectId });
      const plan = makePlanE48([mutationStepE48(1, 'src/api/e48-a2.service.ts', 'CREATE', { targetDomain: 'BACKEND' })]);
      svc.stagePlanForConfirmation({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        userMessage: 'Crée le service demandé',
        intent: makeIntentE48('CREATE', 'le service demandé É48 A2'),
        plan
      });
      await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
      const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId }, 'OWNER', undefined);
      const raw = result.executionResult as { success: boolean; message: string; error?: string };
      assert.equal(raw.success, true, `le fallback cible le fichier DU plan (${raw.error ?? raw.message})`);
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/api/e48-a2.service.ts'), 'le fichier du plan est créé');
      assert.match(raw.message, /agx-/, 'contrat gelé : executionId agx-<sessionId> dans le message');
      assert.match(raw.message, /COMMITTED/, 'contrat gelé : mutation réellement commise');
    });

    it('A3 (O-B2 préservé): demande générique sans fichier → UNSUPPORTED_INTENT, aucun agent, aucun fichier', async () => {
      const session = svc.createSession({ tenantId, projectId });
      const t1 = await turn(session, 'Crée une page dashboard magnifique');
      assert.ok(t1.session.activePlan, 'un plan est bien généré (aucune cible inventée à la génération)');
      const targets = mutationTargetsOf(t1.session.activePlan);
      assert.equal(targets.filter((t) => t.length > 0).length, 0, 'aucun fichier inventé à la planification');
      await svc.confirmPlan({
        tenantId, projectId, sessionId: session.sessionId,
        planId: t1.session.activePlan!.planId, approved: true
      });
      const result = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: session.sessionId }, 'OWNER', undefined);
      const raw = result.executionResult as { success: boolean; error?: string };
      assert.equal(raw.success, false, 'aucune exécution sans cible réelle');
      assert.match(raw.error ?? '', /UNSUPPORTED_INTENT/, 'refus explicite, jamais une cible fabriquée');
      assert.equal(result.session.currentState, 'FAILED', 'état honnête');
      assert.equal(captures.length, 0, 'aucun agent exécuté');
    });
  });

  // =========================================================================
  // SECTION B — Correction 2 : « spec » borné à un début de mot.
  // =========================================================================
  describe('SECTION B : la précision « respecter » n est plus classée TEST', () => {
    it('B1: « doit respecter l accessibilité » → reprise É43 → précision conservée → exécution réussie', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-b1.tsx');
      assert.ok(mutationTargetsOf(t1.session.activePlan).includes('src/components/e48-b1.tsx'), 'le plan t1 vise le fichier demandé');
      const t2 = await turn(t1.session, 'Le composant doit respecter l accessibilité AA');
      const cap2 = lastCapture();
      assert.notEqual(cap2.intentCategory, 'TEST', 'AVANT : TEST@0.85 par sous-chaîne « respecter » — corrige par /\b spec/');
      assert.equal(cap2.intentCategory, 'CREATE', 'la reprise É43 combine la demande initiale et la précision');
      assert.ok(t2.turnContent.includes('Le composant doit respecter l accessibilité AA'), 'la précision est reprise mot pour mot (pas perdue)');
      assert.ok(
        mutationTargetsOf(t2.session.activePlan).includes('src/components/e48-b1.tsx'),
        'un NOUVEAU plan actif vise toujours le fichier demandé (reprise, pas abandon)'
      );
      const ex = await confirmAndExecute(t2.session);
      assert.equal(ex.success, true, `la précision n empêche plus l exécution (${ex.error ?? ex.message})`);
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e48-b1.tsx'), 'le fichier est réellement créé');
    });

    it('B2: « spec » en DÉBUT de mot reste TEST (non-régression de la classification TEST)', async () => {
      const session = svc.createSession({ tenantId, projectId });
      await turn(session, 'La spec src/auth/e48-b2.spec.ts doit être vérifiée');
      const cap1 = lastCapture();
      assert.equal(cap1.intentCategory, 'TEST', '« spec.ts » / « la spec » continuent de classifier TEST');
    });
  });

  // =========================================================================
  // SECTION C — Essentiel des 15 scénarios de la sonde (messages identiques).
  // =========================================================================
  describe('SECTION C : conversations longues et réalistes (sonde É48 S1→S15 + S10b)', () => {
    it('C1 (S1): conversation longue — demande, précision, réalisation, suivi sans mutation', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-s1.tsx');
      assert.ok(mutationTargetsOf(t1.session.activePlan).includes('src/components/e48-s1.tsx'), 'compréhension t1 : le plan vise le fichier demandé');
      await turn(t1.session, 'Le composant doit respecter l accessibilité AA');
      const ex = await confirmAndExecute((await svc.getSession(tenantId, projectId, s1.sessionId, 'OWNER', undefined))!);
      assert.equal(ex.success, true, 'le fichier est créé après la précision');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e48-s1.tsx'), 'fichier réellement créé');
      const snapBefore = snapshot(tenantId, projectId, ['src/components/e48-s1.tsx']);
      const t4 = await turn(ex.session, 'Où en est-on ?');
      const cap4 = lastCapture();
      const snapAfter = snapshot(tenantId, projectId, ['src/components/e48-s1.tsx']);
      assert.ok(sameSnap(snapBefore, snapAfter), 'le suivi t4 ne mute RIEN');
      assert.equal(cap4.intentCategory, 'QUESTION', 'la question de suivi est comprise comme une question');
      assert.ok(cap4.historyLast?.startsWith('AGENT'), 'le provider t4 voit la réponse d exécution dans l historique');
      assert.ok(cap4.historyLast?.includes("C'est fait"), 'la réponse d exécution réelle est bien la dernière entrée d historique');
      assert.ok(t4.turnContent.length > 0, 'réponse naturelle au suivi');
    });

    it('C2 (S2): changement d avis (« en fait, plutôt… ») → nouveau plan, ancien jamais exécuté', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-s2.tsx');
      const t2 = await turn(t1.session, 'En fait, crée plutôt le service src/api/e48-s2.service.ts');
      const targets = mutationTargetsOf(t2.session.activePlan);
      assert.ok(targets.length > 0 && targets.every((t) => t === 'src/api/e48-s2.service.ts'), 'le plan actif après changement vise le NOUVEAU fichier uniquement');
      const ex = await confirmAndExecute(t2.session);
      assert.equal(ex.success, true, ex.message);
      assert.match(ex.message, /agx-/, 'contrat gelé : executionId conservé');
      assert.match(ex.message, /COMMITTED/, 'contrat gelé : mutation COMMITTED');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/api/e48-s2.service.ts'), 'service créé');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/components/e48-s2.tsx'), null, 'ancien composant NON créé (plan obsolète non exécuté)');
    });

    it('C3 (S3): modification d une seule partie — une seule étape de mutation, le reste intact', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-s3.tsx et le service src/api/e48-s3.service.ts');
      const ex1 = await confirmAndExecute(t1.session);
      assert.equal(ex1.success, true, 'les deux fichiers créés');
      const before = snapshot(tenantId, projectId, ['src/api/e48-s3.service.ts', 'src/components/e48-s3.tsx']);
      const t2 = await turn(ex1.session, 'Modifie seulement le composant src/components/e48-s3.tsx');
      const targets = mutationTargetsOf(t2.session.activePlan);
      assert.equal(targets.length, 1, 'une seule étape de mutation');
      assert.deepEqual([...targets], ['src/components/e48-s3.tsx'], 'le composant uniquement');
      const ex2 = await confirmAndExecute(t2.session);
      assert.equal(ex2.success, true, 'la modification réussit');
      const after = snapshot(tenantId, projectId, ['src/api/e48-s3.service.ts', 'src/components/e48-s3.tsx']);
      assert.equal(after['src/api/e48-s3.service.ts'], before['src/api/e48-s3.service.ts'], 'le service est resté INTACT (contenu identique)');
      assert.notEqual(after['src/components/e48-s3.tsx'], before['src/components/e48-s3.tsx'], 'le composant a été réellement modifié (contenu changé)');
    });

    it('C4 (S4): interdiction au début, rappelée plus tard, respectée à l exécution', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      await turn(s1, 'ne modifie pas src/legacy/e48-s4.ts');
      const t2 = await turn((await svc.getSession(tenantId, projectId, s1.sessionId, 'OWNER', undefined))!, 'Crée le service src/api/e48-s4.service.ts');
      const t3 = await turn(t2.session, 'N oublie pas : src/legacy/e48-s4.ts doit rester intact');
      const cap3 = lastCapture();
      assert.ok(cap3.knownConstraints.some((c) => c.includes('src/legacy/e48-s4.ts')), 'l interdiction est en mémoire AU TOUR DU RAPPEL (t3)');
      const ex = await confirmAndExecute(t3.session);
      assert.equal(ex.success, true, `la mission aboutit malgré le rappel tardif (${ex.error ?? ex.message})`);
      assert.ok(
        (ex.session.projectMemory.knownConstraints ?? []).join(' ').includes('src/legacy/e48-s4.ts'),
        'l interdiction est toujours en mémoire à l exécution'
      );
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/legacy/e48-s4.ts'), null, 'le fichier interdit n a JAMAIS été créé');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/api/e48-s4.service.ts'), 'le service demandé existe');
    });

    it('C5 (S5): décision tracée (plan accepté) puis changement d approche exécuté', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-s5.tsx');
      await svc.confirmPlan({ tenantId, projectId, sessionId: s1.sessionId, planId: t1.session.activePlan!.planId, approved: true });
      const afterConfirm = (await svc.getSession(tenantId, projectId, s1.sessionId, 'OWNER', undefined))!;
      assert.ok(
        (afterConfirm.projectMemory.acceptedPlans ?? []).length > 0,
        'la décision (plan accepté) est tracée en mémoire'
      );
      const t2 = await turn(afterConfirm, 'En fait, annule : crée le service src/api/e48-s5.service.ts à la place');
      const targets = mutationTargetsOf(t2.session.activePlan);
      assert.ok(targets.length > 0 && targets.every((t) => t === 'src/api/e48-s5.service.ts'), 'la correction est prise en compte (nouveau plan = service)');
      const ex = await confirmAndExecute(t2.session);
      assert.equal(ex.success, true, ex.message);
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/api/e48-s5.service.ts'), 'service créé');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/components/e48-s5.tsx'), null, 'ancien composant absent');
    });

    it('C6 (S6): hypothèse jamais confirmée ≠ décision, aucune mutation déclenchée', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      await turn(s1, 'Crée le composant src/components/e48-s6.tsx');
      const t2 = await turn((await svc.getSession(tenantId, projectId, s1.sessionId, 'OWNER', undefined))!, 'Peut-être qu une carte résumé serait utile aussi');
      const t3 = await turn(t2.session, 'Au fait, comment est organisé le projet ?');
      const final = t3.session;
      const decisions = final.projectMemory.architecturalDecisions ?? [];
      assert.equal(decisions.length, 0, 'aucune décision enregistrée (hypothèses jamais promues)');
      const tracedStatuses = final.turns.flatMap((t) => [...(t.assumptions ?? [])]).map((a) => a.status);
      assert.ok(tracedStatuses.length > 0, 'des hypothèses sont bien tracées dans les tours');
      assert.ok(tracedStatuses.every((s) => s !== 'CONFIRMED'), 'aucune hypothèse tracée n est jamais CONFIRMED');
      assert.ok(
        (t2.session.turns[t2.session.turns.length - 1]?.assumptions ?? []).some((a) => a.status === 'PROPOSED'),
        'l hypothèse t2 était PROPOSED (tracée, réversible)'
      );
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/components/e48-s6.tsx'), null, 'aucune mutation déclenchée par les hypothèses');
    });

    it('C7 (S7): mission PARTIAL honnête puis question — rien ne mute, résultat réel dans l historique', async () => {
      buildStack({ backend: { failFor: new Set(['src/api/e48-s7.service.ts']) } });
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-s7.tsx et le service src/api/e48-s7.service.ts');
      const ex = await confirmAndExecute(t1.session);
      assert.equal(ex.success, false, 'la mission échoue honnêtement (un agent a échoué)');
      assert.equal((ex.supervision?.decision as string | undefined) ?? '', 'PARTIAL', 'statut réel PARTIAL');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e48-s7.tsx'), 'composant présent');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/api/e48-s7.service.ts'), null, 'service absent (échec réel)');
      const snapBefore = snapshot(tenantId, projectId, ['src/components/e48-s7.tsx', 'src/api/e48-s7.service.ts']);
      const t2 = await turn(ex.session, 'Qu est-ce qui a réellement été réalisé ?');
      const cap2 = lastCapture();
      const snapAfter = snapshot(tenantId, projectId, ['src/components/e48-s7.tsx', 'src/api/e48-s7.service.ts']);
      assert.ok(sameSnap(snapBefore, snapAfter), 'la question ne mute RIEN');
      assert.ok(cap2.historyLast?.startsWith('AGENT') && (cap2.historyLast ?? '').toLowerCase().includes('partial'), 'le provider voit le résultat PARTIAL réel dans l historique');
      assert.doesNotMatch(t2.turnContent, /agxb-|executionId/, 'réponse naturelle (pas un rapport technique)');
    });

    it('C8 (S8): BLOCKED réel (RIEN d écrit, vérifié avant la suite) puis récupération VALIDATED', async () => {
      buildStack({ data: { failFor: new Set(['src/db/e48-s8.schema.ts']) } });
      const s1 = svc.createSession({ tenantId, projectId });
      await turn(s1, 'Crée le schema src/db/e48-s8.schema.ts puis le service src/api/e48-s8.service.ts');
      const plan = makePlanE48([
        mutationStepE48(1, 'src/db/e48-s8.schema.ts', 'CREATE', { targetDomain: 'DATA' }),
        mutationStepE48(2, 'src/api/e48-s8.service.ts', 'CREATE', { targetDomain: 'BACKEND', dependsOn: [1] })
      ]);
      svc.stagePlanForConfirmation({
        tenantId, projectId, sessionId: s1.sessionId,
        userMessage: 'Crée le schema puis le service',
        intent: makeIntentE48('CREATE', 'schema puis service É48 S8', ['service']),
        plan
      });
      await svc.confirmPlan({ tenantId, projectId, sessionId: s1.sessionId, planId: plan.planId, approved: true });
      const r1 = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: s1.sessionId }, 'OWNER', undefined);
      const raw1 = r1.executionResult as { success: boolean; supervision?: { decision?: string }; userReply?: string };
      assert.equal(raw1.success, false, 'mission 1 échoue (schema impossible)');
      assert.equal(raw1.supervision?.decision ?? '', 'BLOCKED', 'mission 1 réellement BLOCKED');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/db/e48-s8.schema.ts'), null, 'schema absent (mission 1)');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/api/e48-s8.service.ts'), null, 'RIEN d écrit par la mission 1 (le service dépend du schema, jamais démarré)');
      const cur = (await svc.getSession(tenantId, projectId, s1.sessionId, 'OWNER', undefined))!;
      const t2 = await turn(cur, 'Crée seulement le service src/api/e48-s8.service.ts');
      const ex2 = await confirmAndExecute(t2.session);
      assert.equal(ex2.success, true, 'récupération : mission 2 VALIDATED');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/api/e48-s8.service.ts'), 'service créé par la récupération');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/db/e48-s8.schema.ts'), null, 'le schema reste honnêtement absent');
      assert.ok((ex2.userReply ?? '').includes('src/api/e48-s8.service.ts'), 'la réponse 2 nomme le livrable réel');
      assert.ok(!(ex2.userReply ?? '').includes('e48-s8.schema.ts'), 'aucune fausse annonce sur le schema jamais produit');
    });

    it('C9 (S9): échec réel d un agent — aucune réussite fictive, mémoire honnête', async () => {
      buildStack({ ui: { failFor: new Set(['src/components/e48-s9.tsx']) } });
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-s9.tsx');
      const ex = await confirmAndExecute(t1.session);
      assert.equal(ex.success, false, 'échec honnête (success=false)');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/components/e48-s9.tsx'), null, 'aucun fichier écrit');
      assert.ok((ex.userReply ?? '').includes("pas abouti"), 'la réponse annonce l échec');
      assert.ok(!(ex.userReply ?? '').includes("C'est fait"), 'aucune annonce de réussite');
      const messages = ex.session.turnMemory.recentMessages;
      const last = messages[messages.length - 1];
      assert.equal(last?.sender, 'AGENT', 'm mémoire : le dernier message vient de l agent');
      assert.ok((last?.content ?? '').includes("pas abouti"), 'm mémoire : le dernier message = réponse honnête');
    });

    it('C10 (S10): trois demandes successives — plans indépendants, 3 fichiers, historique riche', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-s10a.tsx');
      const ex1 = await confirmAndExecute(t1.session);
      assert.equal(ex1.success, true, 'demande 1 réalisée');
      const t2 = await turn(ex1.session, 'Crée maintenant le service src/api/e48-s10b.service.ts');
      assert.deepEqual([...mutationTargetsOf(t2.session.activePlan)], ['src/api/e48-s10b.service.ts'], 'plan 2 = service uniquement');
      const ex2 = await confirmAndExecute(t2.session);
      assert.equal(ex2.success, true, 'demande 2 réalisée');
      const t3 = await turn(ex2.session, 'Crée enfin le schema src/db/e48-s10c.schema.ts');
      assert.deepEqual([...mutationTargetsOf(t3.session.activePlan)], ['src/db/e48-s10c.schema.ts'], 'plan 3 = schema uniquement');
      const ex3 = await confirmAndExecute(t3.session);
      assert.equal(ex3.success, true, 'demande 3 réalisée');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e48-s10a.tsx'), 'fichier 1 réel');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/api/e48-s10b.service.ts'), 'fichier 2 réel');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/db/e48-s10c.schema.ts'), 'fichier 3 réel');
      assert.ok(ex3.session.turnMemory.recentMessages.length >= 6, 'm mémoire finale : historique riche (3 exécutions réinjectées)');
    });

    it('C11 (S12): explication après exécution — aucune mutation, planId inchangé', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-s12.tsx');
      const ex = await confirmAndExecute(t1.session);
      const snapBefore = snapshot(tenantId, projectId, ['src/components/e48-s12.tsx']);
      const planIdBefore = ex.session.activePlan?.planId ?? null;
      const t2 = await turn(ex.session, 'Pourquoi l avoir créé de cette façon ?');
      const cap2 = lastCapture();
      const snapAfter = snapshot(tenantId, projectId, ['src/components/e48-s12.tsx']);
      const planIdAfter = t2.session.activePlan?.planId ?? null;
      assert.ok(cap2.intentCategory === 'QUESTION' || cap2.intentCategory === 'EXPLAIN', 'intent d explication, pas une mutation');
      assert.ok(planIdBefore !== null && planIdBefore === planIdAfter, 'AUCUN nouveau plan généré par la question (planId inchangé)');
      assert.ok(sameSnap(snapBefore, snapAfter), 'fichier STRICTEMENT identique (aucune réécriture)');
    });

    it('C12 (S13): nouvelle demande sans rapport — nouveau plan cohérent sur le NOUVEAU fichier', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-s13.tsx');
      const t2 = await turn(t1.session, 'Autre sujet : crée le service de sauvegarde src/api/e48-s13-backup.service.ts');
      assert.deepEqual([...mutationTargetsOf(t2.session.activePlan)], ['src/api/e48-s13-backup.service.ts'], 'le nouveau plan vise le NOUVEAU fichier (pas l ancien)');
      const ex = await confirmAndExecute(t2.session);
      assert.equal(ex.success, true, ex.message);
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/api/e48-s13-backup.service.ts'), 'le nouveau fichier existe');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/components/e48-s13.tsx'), null, 'l ancien composant n a pas été créé en douceur');
    });

    it('C13 (S14): deux conversations distinctes (tenants différents) — aucune fuite de contexte', async () => {
      const tenantA = 'tenant-e48-s14a';
      const projectA = 'proj-e48-s14a';
      const tenantB = 'tenant-e48-s14b';
      const projectB = 'proj-e48-s14b';
      const sessA = svc.createSession({ tenantId: tenantA, projectId: projectA });
      await turn(sessA, 'ne modifie pas src/legacy/a-secret.ts');
      const rA2 = await turn((await svc.getSession(tenantA, projectA, sessA.sessionId, 'OWNER', undefined))!, 'Crée le composant src/components/e48-s14a.tsx');
      const exA = await confirmAndExecute(rA2.session);
      assert.equal(exA.success, true, 'A : mission exécutée dans SON tenant');
      assert.ok(fileSource.getFile(tenantA, projectA, 'src/components/e48-s14a.tsx'), 'A : composant réel dans SON tenant');
      const sessB = svc.createSession({ tenantId: tenantB, projectId: projectB });
      const rB1 = await turn(sessB, 'Crée le service src/api/e48-s14b.service.ts');
      const capB = lastCapture();
      assert.equal(capB.historySize, 0, 'B : AUCUN message de A dans l historique (premier tour, historique vide)');
      assert.ok(!capB.knownConstraints.some((c) => c.includes('a-secret')), 'B : AUCUNE contrainte de A dans la mémoire du provider');
      const exB = await confirmAndExecute(rB1.session);
      assert.equal(exB.success, true, 'B exécute sa propre mission');
      assert.ok(fileSource.getFile(tenantB, projectB, 'src/api/e48-s14b.service.ts'), 'B : service réel dans SON tenant');
      assert.equal(fileSource.getFile(tenantB, projectB, 'src/components/e48-s14a.tsx'), null, 'isolation fichiers : le fichier de A est invisible pour B');
      assert.equal(fileSource.getFile(tenantA, projectA, 'src/api/e48-s14b.service.ts'), null, 'isolation fichiers : le fichier de B est invisible pour A');
    });

    it('C14 (S15): chaîne dépendante 3 agents — ordre respecté, VALIDATED, interdits respectés annoncés', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      await turn(s1, 'ne modifie pas src/legacy/e48-s15.ts');
      await turn((await svc.getSession(tenantId, projectId, s1.sessionId, 'OWNER', undefined))!, 'Crée la page src/pages/e48-s15.tsx, le service src/api/e48-s15.service.ts et le schema src/db/e48-s15.schema.ts');
      const plan = makePlanE48([
        mutationStepE48(1, 'src/db/e48-s15.schema.ts', 'CREATE', { targetDomain: 'DATA' }),
        mutationStepE48(2, 'src/api/e48-s15.service.ts', 'CREATE', { targetDomain: 'BACKEND', dependsOn: [1] }),
        mutationStepE48(3, 'src/pages/e48-s15.tsx', 'CREATE', { targetDomain: 'UI', dependsOn: [2] })
      ]);
      svc.stagePlanForConfirmation({
        tenantId, projectId, sessionId: s1.sessionId,
        userMessage: 'Chaîne dépendante É48 : schema, service, page',
        intent: makeIntentE48('CREATE', 'chaîne dépendante É48 S15'),
        plan
      });
      await svc.confirmPlan({ tenantId, projectId, sessionId: s1.sessionId, planId: plan.planId, approved: true });
      const r1 = await svc.executeApprovedPlan({ tenantId, projectId, sessionId: s1.sessionId }, 'OWNER', undefined);
      const raw1 = r1.executionResult as { success: boolean; supervision?: { decision?: string }; userReply?: string };
      assert.equal(raw1.success, true, 'la chaîne complète aboutit');
      assert.equal(raw1.supervision?.decision ?? '', 'VALIDATED', 'supervision É46 : VALIDATED');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/db/e48-s15.schema.ts'), 'schema réel');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/api/e48-s15.service.ts'), 'service réel');
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/pages/e48-s15.tsx'), 'page réelle');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/legacy/e48-s15.ts'), null, 'le fichier interdit n existe pas');
      const indexOf = (file: string): number => captures.findIndex((c) => c.targetFiles.includes(file));
      const iSchema = indexOf('src/db/e48-s15.schema.ts');
      const iService = indexOf('src/api/e48-s15.service.ts');
      const iPage = indexOf('src/pages/e48-s15.tsx');
      assert.ok(iSchema >= 0 && iService >= 0 && iPage >= 0, 'les 3 agents ont bien été exécutés via le scheduler');
      assert.ok(iSchema < iService && iService < iPage, 'ordre respecté (schema → service → page), aucune perte de dépendance');
      assert.ok((raw1.userReply ?? '').includes('Mission terminée (VALIDATED)'), 'réponse É47 batch : statut nommé');
      assert.ok((raw1.userReply ?? '').includes('Vos interdits actifs ont été respectés'), 'contrat gelé É47 batch : interdit actif rappelé');
      assert.ok((raw1.userReply ?? '').includes('src/legacy/e48-s15.ts'), 'le chemin protégé est nommé');
    });

    it('C15 (S10b, limite documentée): demande elliptique — aucune fausse annonce, aucune mutation', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée le composant src/components/e48-s10b.tsx');
      const ex1 = await confirmAndExecute(t1.session);
      assert.equal(ex1.success, true, 'mission 1 réalisée');
      const t2 = await turn(ex1.session, 'Maintenant le service src/api/e48-s10b.service.ts');
      const cap2 = lastCapture();
      // LIMITE DOCUMENTÉE (plafond de 2 corrections atteint) : l'intention
      // elliptique sans verbe n'est pas résolue en CREATE — elle est traitée
      // comme une exploration. Les invariants STABLES (valables sous la limite
      // ET sous un correctif futur légitime) sont épinglés ici :
      assert.ok(!t2.turnContent.includes("C'est fait"), 'aucune fausse annonce : rien n est déclaré réalisé');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/api/e48-s10b.service.ts'), null, 'aucune mutation non demandée formellement n est exécutée en douceur');
      assert.ok(t2.turnContent.length > 0, 'l utilisateur reçoit une réponse (pas un silence système)');
      assert.ok(cap2.userMessage === 'Maintenant le service src/api/e48-s10b.service.ts', 'trace : la demande elliptique est bien celle testée');
    });

    it('C16 (S11, limite documentée): références ambiguës — aucune invention de cible, référence résolue tracée', async () => {
      const s1 = svc.createSession({ tenantId, projectId });
      const t1 = await turn(s1, 'Crée la page src/pages/e48-s11.tsx et le composant src/components/e48-s11-card.tsx');
      const known = ['src/pages/e48-s11.tsx', 'src/components/e48-s11-card.tsx'];
      const snapBefore = snapshot(tenantId, projectId, known);
      const t2 = await turn(t1.session, 'Modifie cette partie');
      const invented = mutationTargetsOf(t2.session.activePlan).filter((t) => t.length > 0 && !known.includes(t));
      assert.equal(invented.length, 0, '« cette partie » : AUCUNE invention de cible');
      const snapAfterT2 = snapshot(tenantId, projectId, known);
      assert.ok(sameSnap(snapBefore, snapAfterT2), '« cette partie » : aucune mutation (rien n est exécuté sans cible claire)');
      const t3 = await turn(t2.session, 'Modifie cette page');
      const refAssumption = (t3.session.activeAssumptions ?? []).find(
        (a) => a.id.includes('reference') || a.statement.includes('src/pages/e48-s11.tsx')
      );
      assert.ok(refAssumption !== undefined, '« cette page » : résolue vers la page réelle (hypothèse tracée, pas une décision)');
      const t4 = await turn(t3.session, 'Non, reviens à la première version');
      const snapAfterT4 = snapshot(tenantId, projectId, known);
      assert.ok(sameSnap(snapBefore, snapAfterT4), '« première version » : traitée sans fausse mémoire ni mutation cachée');
      assert.ok(t4.turnContent.length > 0, 'réponse naturelle à la référence temporelle');
    });
  });
});
