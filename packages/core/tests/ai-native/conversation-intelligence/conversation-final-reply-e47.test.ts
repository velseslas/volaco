/**
 * É47 — Intelligence et qualité de la réponse finale : la réponse présentée
 * à l'utilisateur est construite depuis la demande réelle, le contexte
 * conversationnel et les résultats VÉRIFIÉS du superviseur É46 — jamais
 * depuis un rapport technique brut ni depuis une déclaration d'agent.
 *
 * Défauts démontrés par la sonde É47 (traces AVANT/APRÈS, parcours RÉEL
 * ConversationIntelligenceService → ExecutionBridge → MultiAgentScheduler É37
 * → AgentExecutionService É32→É36 → superviseur É46 → réponse finale) :
 *   #1 PRÉSENTATION — la réponse d'exécution était un rapport technique brut
 *      (jargon `agxb-`/`executionId`/`step-N=`/`tx=`, MultiAgentScheduler),
 *      sans AUCUNE mention des livrables réels (0/N fichiers), sans rappel
 *      des interdits actifs, sans limite de vérification explicite.
 *   #2 CONTINUITÉ — le résultat d'exécution n'entrait JAMAIS dans la mémoire
 *      conversationnelle : le tour suivant (correction utilisateur, explication,
 *      changement de sujet) ignorait ce qui venait d'être fait → risque de
 *      fausse déclaration ou d'invention.
 *
 * Corrections vérifiées ICI (pipeline RÉEL, pattern É45/É46 — aucun
 * agent.executeTask() direct, MÊME AgentExecutionService que server.ts) :
 *   A — FIDÉLITÉ : `userReply` composé déterministe depuis les faits vérifiés
 *       (statut du superviseur nommé, livrables réellement commis via le trail
 *       fusionné, exigences non satisfaites, tâches jamais exécutées, écarts
 *       hors exigence, interdits, corrections honnêtes, limites de
 *       vérification) ; le message technique `message` reste EXACTEMENT
 *       inchangé (contrats gelés É39–É46) ;
 *   B — QUALITÉ : zéro identifiant interne dans la réponse conversationnelle,
 *       réponse courte pour le chemin routé, structure adaptée au statut,
 *       aucune répétition de template générique, aucune fausse annonce ;
 *   C — CONTINUITÉ : le `userReply` entre dans turnMemory comme message AGENT
 *       (SANS tour factice : `turns` inchangé) et le provider du tour suivant
 *       reçoit le résultat réel dans `history`.
 *
 * Correspondance scénarios obligatoires (sonde É47 = S1–S15) :
 *   S4  = A1 (mission multi-agents VALIDATED) ;
 *   S5  = A2 (mission PARTIAL : en place + échec + jamais exécuté) ;
 *   S6  = A3 (mission BLOCKED : rien mis en place) ;
 *   S7  = A4 (NEEDS_CORRECTION : livrable hors exigence) ;
 *   S8  = A5 (correction ciblée réussie et revérifiée) ;
 *   S9  = A6 (correction tentée mais échouée) ;
 *   S10 = A7 (SUCCESS déclaré sans preuve → jamais annoncé comme livré) ;
 *   S11 = A8 (contraintes initiales rappelées dans la réponse) ;
 *   —   = A9 (refus avant toute exécution : aucune annonce d'exécution) ;
 *   S3  = A10 (mission mono-agent routée réussie, réponse courte) ;
 *   —   = A11 (mission mono-agent routée échouée : rien n'a été écrit) ;
 *   S12/S13/S14/S15 = C1/C2 (continuité post-exécution sur la MÊME session).
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
  computeEngineeringPlanHash,
  type AgentTask,
  type AgentResult,
  type AgentArtifact,
  type TaskContextPayload,
  type EngineeringPlan,
  type PlanStep,
  type IntentResult,
  type ConversationSession
} from '../../../src/index.js';

// ---------------------------------------------------------------------------
// Fabriques de référence (pattern É39/É45/É46)
// ---------------------------------------------------------------------------

let planSeq = 0;
let intentSeq = 0;

function makePlanE47(steps: readonly PlanStep[]): EngineeringPlan {
  planSeq += 1;
  const partial = {
    planId: `plan-e47-${planSeq}`,
    title: 'Plan É47',
    summary: `Plan de test É47 (${steps.length} étape(s))`,
    steps,
    status: 'APPROVED' as const
  };
  return { ...partial, planHash: computeEngineeringPlanHash(partial) };
}

function makeIntentE47(category: 'CREATE' | 'MODIFY' | 'DELETE', goal: string): IntentResult {
  intentSeq += 1;
  return {
    category,
    goal,
    requestedAction: category.toLowerCase(),
    entities: [],
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

const mutationStepE47 = (
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

// ---------------------------------------------------------------------------
// Agents de capture (pattern É45/É46 — état dans des closures, JAMAIS l'instance)
// ---------------------------------------------------------------------------

type CaptureRecord = {
  readonly taskId: string;
  readonly agentId: string;
  readonly declaredStatus: string | null;
  readonly targetFiles: readonly string[];
};

/** Capabilities RÉELLES des agents de production (pattern É45). */
const REAL_CAPS: Record<string, readonly string[]> = {
  UI: ['PAGE_GENERATION', 'COMPONENT_STYLING', 'RESPONSIVE_LAYOUT'],
  BACKEND: ['API_DESIGN', 'SERVICE_LOGIC'],
  DATA: ['SCHEMA_MODELING', 'DATA_INTEGRITY']
};

const ZERO_TOKENS = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

interface AgentBehaviorE47 {
  readonly failFor?: ReadonlySet<string>;
  readonly failFirstFor?: ReadonlySet<string>;
  readonly noArtifactFor?: ReadonlySet<string>;
  readonly wrongPathFor?: Readonly<Record<string, string>>;
}

function makeSpecialistE47(
  captures: CaptureRecord[],
  id: string,
  domain: string,
  behavior: AgentBehaviorE47 = {}
): BaseSpecializedAgent {
  const caps = [...(REAL_CAPS[domain] ?? [])];
  caps.push('FILE_MUTATION');
  const callCounts = new Map<string, number>();
  class SpecialistAgent extends BaseSpecializedAgent {
    constructor() {
      super(
        {
          id,
          name: `E47 ${domain}`,
          domain: domain as never,
          capabilities: caps as never[],
          description: `agent de test É47 : spécialité ${domain} (capabilities réelles de production)`,
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
      const attemptNo = (callCounts.get(params.task.id) ?? 0) + 1;
      callCounts.set(params.task.id, attemptNo);
      const failNow =
        (behavior.failFor?.has(key) ?? false) ||
        ((behavior.failFirstFor?.has(key) ?? false) && attemptNo === 1);
      const declaredStatus = !targetFile || failNow
        ? 'FAILURE'
        : behavior.noArtifactFor?.has(key)
          ? 'SUCCESS (0 artifact)'
          : 'SUCCESS';
      captures.push({
        taskId: params.task.id,
        agentId: id,
        declaredStatus,
        targetFiles: [...(params.task.requiredContext.targetFiles ?? [])]
      });
      if (!targetFile || failNow) {
        return {
          taskId: params.task.id,
          agentId: id,
          status: 'FAILURE' as const,
          artifacts: [],
          conflicts: [],
          tokensUsed: ZERO_TOKENS,
          durationMs: 1,
          error:
            behavior.failFor?.has(key) ?? false
              ? 'E47_FAIL_INJECTE'
              : 'E47_FAIL_PREMIERE_TENTATIVE'
        };
      }
      if (behavior.noArtifactFor?.has(key)) {
        // DÉCLARATION de réussite SANS aucun livrable (la réponse finale ne
        // doit JAMAIS annoncer ce fichier comme livré).
        return {
          taskId: params.task.id,
          agentId: id,
          status: 'SUCCESS' as const,
          degraded: false,
          artifacts: [],
          conflicts: [],
          tokensUsed: ZERO_TOKENS,
          durationMs: 1
        };
      }
      let filePath = targetFile;
      if (behavior.wrongPathFor?.[key]) {
        filePath = behavior.wrongPathFor[key]!;
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
          proposedContent: `// e47-${id} ${params.task.id} -> ${path}\n`,
          reason: 'É47'
        },
        confidence: 1,
        hash: `hash-e47-${params.task.id}-${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        summary: 'É47'
      });
      return {
        taskId: params.task.id,
        agentId: id,
        status: 'SUCCESS' as const,
        degraded: false,
        artifacts: [artifact(filePath, operation)],
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
// Provider conversationnel de capture (ce que le service construit et transmet)
// ---------------------------------------------------------------------------

interface CapturedRequestE47 {
  readonly userMessage: string;
  readonly history: readonly { readonly sender: string; readonly content: string }[];
}

function makeCaptureProviderE47(captured: CapturedRequestE47[]): unknown {
  return {
    async reason(request: {
      userMessage: string;
      history?: readonly { readonly sender: string; readonly content: string }[];
    }) {
      captured.push({
        userMessage: request.userMessage,
        history: [...(request.history ?? [])]
      });
      return {
        interpretation: request.userMessage,
        intent: {
          category: 'QUESTION',
          goal: request.userMessage,
          requestedAction: 'explain',
          entities: [],
          constraints: [],
          urgency: 'NORMAL',
          confidence: 0.85,
          ambiguities: []
        },
        assumptions: [],
        clarifications: [],
        reply: 'Réponse conversationnelle du provider de capture É47.',
        confidence: 0.85,
        nextAction: 'RESPOND_DIRECTLY'
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Chaîne RÉELLE (wiring identique à apps/api/src/server.ts — pattern É45/É46)
// ---------------------------------------------------------------------------

/** Jargon interne interdit dans une réponse conversationnelle (DÉFAUT 1). */
const JARGON_E47 = /agxb-|agx-|executionId|MultiAgentScheduler|Agent Runtime|Run ID|step-\d|tx=/;

interface ExecOutcomeE47 {
  success: boolean;
  message: string;
  userReply?: string;
  error?: string;
  supervision?: {
    readonly decision: string;
    readonly initialDecision: string;
    readonly batchStatus: string;
    readonly counts: {
      readonly completed: number;
      readonly failed: number;
      readonly blocked: number;
      readonly pending: number;
      readonly cancelled: number;
      readonly total: number;
    };
    readonly findings: readonly { readonly kind: string; readonly taskId: string; readonly detail: string }[];
    readonly committedFiles: readonly { readonly taskId: string; readonly files: readonly string[] }[];
    readonly unmetFiles: readonly { readonly taskId: string; readonly files: readonly string[] }[];
    readonly repair: {
      readonly attempted: boolean;
      readonly attemptsUsed: number;
      readonly maxAttempts: number;
      readonly attempts: readonly { readonly taskId: string; readonly outcomeStatus: string }[];
      readonly refusalReason?: string;
    };
  };
  session: ConversationSession;
}

describe('É47 — réponse finale fidèle, conversationnelle et continue (parcours réel)', () => {
  let fileSource: InMemoryMutableFileSource;
  let orchestrator: AIOrchestratorService;
  let svc: ConversationIntelligenceService;
  let captures: CaptureRecord[];
  let runSeq = 0;
  const tenantId = 'tenant-e47-int';
  let projectId: string;

  interface StackOptions {
    readonly ui?: AgentBehaviorE47;
    readonly backend?: AgentBehaviorE47;
    readonly data?: AgentBehaviorE47;
  }

  function buildStack(options: StackOptions = {}): void {
    runSeq += 1;
    projectId = `proj-e47-int-${runSeq}`;
    captures = [];
    const stackFileSource = new InMemoryMutableFileSource({});
    const codeIntel = new CodeIntelligenceService(stackFileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const graph = new SemanticCodeGraphService(codeIntel, dna, stackFileSource);
    const impact = new ImpactIntelligenceService(graph);
    const mutationOrchestrator = new MutationOrchestratorService(stackFileSource, codeIntel, dna, graph, impact);
    const stackOrchestrator = new AIOrchestratorService(
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
    orchestrator = stackOrchestrator;
    const registry = orchestrator.getExecutionAgentRegistry();
    registry.unregister(REFERENCE_AGENT_ID);
    registry.register(makeSpecialistE47(captures, 'agent-e47-ui', 'UI', options.ui ?? {}));
    registry.register(makeSpecialistE47(captures, 'agent-e47-backend', 'BACKEND', options.backend ?? {}));
    registry.register(makeSpecialistE47(captures, 'agent-e47-data', 'DATA', options.data ?? {}));
    svc = new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
    svc.attachAgentExecutor({
      execute: (request) => orchestrator.executeAgent(request),
      getRegistry: () => orchestrator.getExecutionAgentRegistry(),
      executeBatch: (request) => orchestrator.executeBatch(request)
    });
  }

  function stageAndConfirm(
    steps: readonly PlanStep[],
    userMessage: string,
    existing?: ConversationSession
  ): Promise<ConversationSession> {
    const session = existing ?? svc.createSession({ tenantId, projectId });
    const plan = makePlanE47(steps);
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage,
      intent: makeIntentE47('CREATE', 'demande É47'),
      plan
    });
    return svc
      .confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true })
      .then(() => session);
  }

  async function executeWithOptions(
    session: ConversationSession,
    options?: { readonly supervisionRepair?: { readonly enabled: boolean; readonly maxAttempts?: number } }
  ): Promise<ExecOutcomeE47> {
    const result = await svc.executeApprovedPlan(
      { tenantId, projectId, sessionId: session.sessionId },
      'OWNER',
      undefined,
      options
    );
    const raw = result.executionResult as {
      success: boolean;
      message: string;
      userReply?: string;
      error?: string;
      supervision?: unknown;
    };
    return {
      success: raw.success,
      message: raw.message,
      ...(raw.userReply !== undefined ? { userReply: raw.userReply } : {}),
      ...(raw.error !== undefined ? { error: raw.error } : {}),
      ...(raw.supervision !== undefined
        ? { supervision: raw.supervision as NonNullable<ExecOutcomeE47['supervision']> }
        : {}),
      session: result.session
    };
  }

  /** La réponse conversationnelle existe, est non vide et SANS jargon interne. */
  function assertConversationalE47(reply: string | undefined, label: string): string {
    assert.ok(reply !== undefined && reply.length > 0, `${label} : userReply présent`);
    assert.doesNotMatch(reply, JARGON_E47, `${label} : aucun identifiant interne dans la réponse`);
    return reply;
  }

  // =========================================================================
  // SECTION A — fidélité au superviseur É46 (axe 1)
  // =========================================================================

  describe('SECTION A : fidélité de la réponse finale aux résultats vérifiés', () => {
    beforeEach(() => {
      buildStack();
    });

    it('A1 (S4): mission multi-agents VALIDATED → réponse nominative (fichiers réels), limites explicites, message technique gelé intact', async () => {
      const session = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-a1.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-a1.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e47-a1.tsx et src/api/e47-a1.service.ts'
      );
      const res = await executeWithOptions(session);

      assert.equal(res.success, true, res.message);
      assert.equal(res.supervision!.decision, 'VALIDATED');
      const reply = assertConversationalE47(res.userReply, 'A1');
      // Statut réel nommé + livrables RÉELS (trail vérifié, pas des déclarations).
      assert.ok(reply.includes('VALIDATED'), 'le statut du superviseur est nommé');
      assert.ok(reply.includes('src/components/e47-a1.tsx'), 'livrable UI réel nommé');
      assert.ok(reply.includes('src/api/e47-a1.service.ts'), 'livrable BACKEND réel nommé');
      assert.ok(reply.includes('La vérification porte sur la présence réelle'), 'limite de vérification explicite');
      // Message technique : EXACTEMENT le contrat gelé É39/É46 (jargon conservé ICI).
      assert.match(res.message, /MultiAgentScheduler/);
      assert.match(res.message, /agxb-/);
      assert.match(res.message, /Supervision É46 : VALIDATED/);
      // Extension additive É47 : faits exposés par le superviseur.
      const committed = res.supervision!.committedFiles.flatMap((c) => c.files);
      assert.ok(committed.includes('src/components/e47-a1.tsx'), 'committedFiles expose le trail réel');
      assert.equal(res.supervision!.unmetFiles.length, 0, 'aucune exigence non satisfaite');
    });

    it('A2 (S5): mission PARTIAL → distinction explicite en place / échec / jamais exécuté, aucune annonce complète', async () => {
      buildStack({ backend: { failFor: new Set(['src/api/e47-a2.service.ts']) } });
      const session = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-a2.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-a2.service.ts', 'CREATE', { targetDomain: 'BACKEND' }),
          mutationStepE47(3, 'src/db/e47-a2.schema.ts', 'CREATE', { targetDomain: 'DATA', dependsOn: [2] })
        ],
        'Crée les 3 fichiers e47-a2'
      );
      const res = await executeWithOptions(session);

      assert.equal(res.success, false, 'un PARTIAL n est jamais success');
      assert.equal(res.supervision!.decision, 'PARTIAL');
      const reply = assertConversationalE47(res.userReply, 'A2');
      assert.ok(reply.includes('PARTIAL'), 'statut réel nommé');
      assert.ok(reply.includes('partiellement'), 'mission présentée comme partielle');
      assert.ok(reply.includes('src/components/e47-a2.tsx'), 'le fichier réellement en place est nommé');
      assert.ok(reply.includes('Non abouti'), 'échec réel signalé');
      assert.ok(reply.includes('Jamais exécuté'), 'tâche jamais exécutée signalée');
      assert.ok(reply.includes('src/api/e47-a2.service.ts'), 'exigence manquante nommée');
      assert.ok(reply.includes('src/db/e47-a2.schema.ts'), 'exigence dépendante non satisfaite nommée');
      assert.ok(!reply.includes('tout ce qui était exigé'), 'AUCUNE annonce de mission complète');
      const unmet = res.supervision!.unmetFiles.flatMap((u) => u.files);
      assert.ok(unmet.includes('src/api/e47-a2.service.ts'), 'unmetFiles expose les exigences non satisfaites');
      assert.ok(unmet.includes('src/db/e47-a2.schema.ts'));
    });

    it('A3 (S6): mission BLOCKED → rien n est annoncé en place, vérification impossible explicite', async () => {
      buildStack({ data: { failFor: new Set(['src/db/e47-a3.schema.ts']) } });
      const session = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/db/e47-a3.schema.ts', 'CREATE', { targetDomain: 'DATA' }),
          mutationStepE47(2, 'src/api/e47-a3.service.ts', 'CREATE', { targetDomain: 'BACKEND', dependsOn: [1] })
        ],
        'Crée le schema puis le service e47-a3'
      );
      const res = await executeWithOptions(session);

      assert.equal(res.success, false);
      assert.equal(res.supervision!.decision, 'BLOCKED');
      const reply = assertConversationalE47(res.userReply, 'A3');
      assert.ok(reply.includes('BLOCKED'), 'statut réel nommé');
      assert.ok(reply.includes('aucune écriture n a été commise'), 'aucun livrable inventé');
      assert.ok(reply.includes('Jamais exécuté'), 'la tâche jamais exécutée est nommée');
      assert.ok(!reply.includes('En place, vérifié'), 'AUCUN livrable annoncé en place');
      assert.ok(!reply.includes('VALIDATED'), 'aucune transformation du statut');
    });

    it('A4 (S7): NEEDS_CORRECTION (livrable hors exigence) → écart réel nommé, résidu laissé sans suppression', async () => {
      buildStack({ ui: { wrongPathFor: { 'src/components/e47-a4.tsx': 'src/components/e47-a4-WRONG.tsx' } } });
      const session = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-a4.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-a4.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e47-a4.tsx et src/api/e47-a4.service.ts'
      );
      const res = await executeWithOptions(session);

      assert.equal(res.success, false);
      assert.equal(res.supervision!.decision, 'NEEDS_CORRECTION');
      const reply = assertConversationalE47(res.userReply, 'A4');
      assert.ok(reply.includes('NEEDS_CORRECTION'), 'statut réel nommé');
      assert.ok(reply.includes("n'est pas utilisable en l'état"), 'le verdict honnête est dit');
      assert.ok(reply.includes('Exigences non satisfaites : src/components/e47-a4.tsx'), 'exigence non satisfaite nommée');
      assert.ok(reply.includes('src/components/e47-a4-WRONG.tsx'), 'le livrable RÉEL (mauvais chemin) est nommé');
      assert.ok(reply.includes('Livrés hors exigence'), 'écart hors exigence signalé');
      assert.ok(reply.includes('je ne supprime rien sans votre accord'), 'aucune suppression silencieuse');
    });

    it('A5 (S8): correction ciblée RÉUSSIE et revérifiée → VALIDATED honnête, corrections décrites, cadrage première passe', async () => {
      buildStack({
        ui: { failFirstFor: new Set(['src/components/e47-a5.tsx']) },
        backend: { failFirstFor: new Set(['src/api/e47-a5.service.ts']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-a5.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-a5.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e47-a5.tsx et src/api/e47-a5.service.ts'
      );
      const res = await executeWithOptions(session, { supervisionRepair: { enabled: true, maxAttempts: 2 } });

      assert.equal(res.success, true, res.message);
      assert.equal(res.supervision!.decision, 'VALIDATED');
      assert.equal(res.supervision!.initialDecision, 'NEEDS_CORRECTION');
      assert.equal(res.supervision!.repair.attemptsUsed, 2);
      const reply = assertConversationalE47(res.userReply, 'A5');
      assert.ok(reply.includes('VALIDATED'), 'statut final honnête');
      assert.ok(reply.includes('Correction ciblée effectuée'), 'correction décrite');
      assert.ok(reply.includes('re-vérification réussie'), 're-vérification réelle signalée');
      assert.ok(reply.includes('Première passe'), 'les échecs initiaux restent dits');
      assert.ok(reply.includes('src/components/e47-a5.tsx') && reply.includes('src/api/e47-a5.service.ts'), 'livrables finaux nommés');
      const committed = res.supervision!.committedFiles.flatMap((c) => c.files);
      assert.ok(committed.includes('src/components/e47-a5.tsx'), 'trail fusionné expose les livrables des corrections');
      assert.ok(committed.includes('src/api/e47-a5.service.ts'));
    });

    it('A6 (S9): correction tentée mais ÉCHOUÉE → aucun succès annoncé, échec final assumé', async () => {
      buildStack({
        data: { failFor: new Set(['src/db/e47-a6-missing.schema.ts']) },
        backend: { failFor: new Set(['src/api/e47-a6.service.ts']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/db/e47-a6-missing.schema.ts', 'MODIFY', { targetDomain: 'DATA' }),
          mutationStepE47(2, 'src/api/e47-a6.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Modifie le schema manquant et crée le service e47-a6'
      );
      const res = await executeWithOptions(session, { supervisionRepair: { enabled: true, maxAttempts: 1 } });

      assert.equal(res.success, false);
      assert.equal(res.supervision!.decision, 'NEEDS_CORRECTION');
      assert.equal(res.supervision!.repair.attempted, true);
      const reply = assertConversationalE47(res.userReply, 'A6');
      assert.ok(reply.includes('NEEDS_CORRECTION'), 'statut réel nommé');
      assert.ok(reply.includes('La mission a échoué'), 'échec final assumé');
      assert.ok(reply.includes('Correction ciblée tentée'), 'la correction tentée est dite');
      assert.ok(reply.includes("je n'annonce donc aucun succès"), 'explicitement aucun faux succès');
      assert.ok(!reply.includes('VALIDATED'), 'aucune transformation du statut');
      assert.ok(!reply.includes('En place, vérifié'), 'aucun livrable annoncé (aucun commis)');
    });

    it('A7 (S10): SUCCESS déclaré SANS livrable → le fichier jamais annoncé comme en place (déclaration ≠ preuve)', async () => {
      buildStack({ ui: { noArtifactFor: new Set(['src/components/e47-a7.tsx']) } });
      const session = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-a7.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-a7.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e47-a7.tsx et src/api/e47-a7.service.ts'
      );
      const res = await executeWithOptions(session);

      assert.equal(res.success, false);
      assert.equal(res.supervision!.decision, 'PARTIAL');
      const reply = assertConversationalE47(res.userReply, 'A7');
      assert.ok(reply.includes('PARTIAL'), 'statut réel nommé');
      assert.ok(reply.includes('src/api/e47-a7.service.ts'), 'le livrable VÉRIFIÉ est nommé');
      assert.ok(reply.includes('Exigences non satisfaites : src/components/e47-a7.tsx'), 'le fichier déclaré-mais-absent est signalé');
      assert.ok(!/En place[^.]*e47-a7\.tsx/.test(reply), 'le fichier SANS preuve n est JAMAIS annoncé en place');
    });

    it('A8 (S11): contraintes initiales (interdits) → rappelées dans la réponse, sans artefact interne', async () => {
      let session = svc.createSession({ tenantId, projectId });
      session = (await svc.processTurn({
        tenantId, projectId, sessionId: session.sessionId, message: 'ne modifie pas src/legacy/e47-a8.ts'
      })).session;
      const plan = makePlanE47([
        mutationStepE47(1, 'src/components/e47-a8.tsx', 'CREATE', { targetDomain: 'UI' }),
        mutationStepE47(2, 'src/api/e47-a8.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
      ]);
      svc.stagePlanForConfirmation({
        tenantId, projectId, sessionId: session.sessionId,
        userMessage: 'Crée le composant et le service e47-a8',
        intent: makeIntentE47('CREATE', 'demande É47'), plan
      });
      await svc.confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true });
      const res = await executeWithOptions(session);

      assert.equal(res.success, true, res.message);
      assert.equal(res.supervision!.decision, 'VALIDATED');
      const reply = assertConversationalE47(res.userReply, 'A8');
      assert.ok(reply.includes('Vos interdits actifs ont été respectés'), 'l interdit actif est rappelé');
      assert.ok(reply.includes('src/legacy/e47-a8.ts'), 'le chemin protégé est nommé');
      assert.ok(!reply.includes('Extracted constraint:'), 'aucun artefact interne d extraction dans la réponse');
    });

    it('A9: refus avant toute exécution → « je n ai rien exécuté », raison réelle, aucune annonce', async () => {
      // stepIndex dupliqué → analyse É39 : DAG non constructible → REFUS.
      const session = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-a9.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(1, 'src/api/e47-a9.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Plan volontairement incohérent (stepIndex dupliqué)'
      );
      const res = await executeWithOptions(session);

      assert.equal(res.success, false);
      const reply = assertConversationalE47(res.userReply, 'A9');
      assert.ok(reply.includes("Je n'ai rien exécuté"), 'aucune exécution = aucune annonce d exécution');
      assert.ok(reply.includes('PLAN_STEP_INDEX_DUPLICATE'), 'la raison réelle du refus est dite');
      assert.ok(!reply.includes('En place'), 'aucun livrable annoncé');
    });

    it('A10 (S3): mission mono-agent ROUTÉE réussie → réponse courte nominative (fichier réel vérifié)', async () => {
      const captured: CapturedRequestE47[] = [];
      const providerE47 = makeCaptureProviderE47(captured);
      const session = svc.createSession({ tenantId, projectId });
      await svc.processTurn({
        tenantId, projectId, sessionId: session.sessionId,
        message: 'Crée le composant src/components/e47-a10.tsx',
        reasoningProvider: providerE47 as never
      });
      const confirmed = await stageAndConfirm(
        [mutationStepE47(1, 'src/components/e47-a10.tsx', 'CREATE', { targetDomain: 'UI' })],
        'Crée src/components/e47-a10.tsx',
        session
      );
      const res = await executeWithOptions(confirmed);

      assert.equal(res.success, true, res.message);
      const reply = assertConversationalE47(res.userReply, 'A10');
      assert.ok(reply.includes("C'est fait"), 'ton conversationnel direct');
      assert.ok(reply.includes('src/components/e47-a10.tsx'), 'fichier réel nommé');
      assert.ok(reply.includes('écriture vérifiée'), 'preuve réelle nommée');
      assert.ok(reply.length < 400, `réponse courte pour une mission simple (longueur ${reply.length})`);
      // Message technique : contrat gelé É32/É39 intouché.
      assert.match(res.message, /Plan exécuté via l'agent/);
      assert.match(res.message, /agx-/);
      assert.match(res.message, /COMMITTED/);
      // Le fichier est RÉELLEMENT sur la source (preuve, pas déclaration).
      const file = fileSource.getFile(tenantId, projectId, 'src/components/e47-a10.tsx');
      assert.ok(file, 'livrable réellement écrit');
    });

    it('A11: mission mono-agent ROUTÉE échouée → échec honnête, rien n a été écrit, retente proposée', async () => {
      buildStack({ ui: { failFor: new Set(['src/components/e47-a11.tsx']) } });
      const captured: CapturedRequestE47[] = [];
      const providerE47 = makeCaptureProviderE47(captured);
      const session = svc.createSession({ tenantId, projectId });
      await svc.processTurn({
        tenantId, projectId, sessionId: session.sessionId,
        message: 'Crée le composant src/components/e47-a11.tsx',
        reasoningProvider: providerE47 as never
      });
      const confirmed = await stageAndConfirm(
        [mutationStepE47(1, 'src/components/e47-a11.tsx', 'CREATE', { targetDomain: 'UI' })],
        'Crée src/components/e47-a11.tsx',
        session
      );
      const res = await executeWithOptions(confirmed);

      assert.equal(res.success, false);
      const reply = assertConversationalE47(res.userReply, 'A11');
      assert.ok(reply.includes("n'a pas abouti"), 'échec dit tel quel');
      assert.ok(reply.includes("Rien n'a été écrit"), 'aucun livrable inventé');
      assert.ok(reply.includes('retenter'), 'prochaine étape proposée');
      const file = fileSource.getFile(tenantId, projectId, 'src/components/e47-a11.tsx');
      assert.ok(!file, 'aucun fichier écrit (cohérence réponse/état réel)');
    });
  });

  // =========================================================================
  // SECTION B — qualité conversationnelle (axe 2)
  // =========================================================================

  describe('SECTION B : qualité conversationnelle sans sacrifier la précision', () => {
    beforeEach(() => {
      buildStack();
    });

    it('B1: AUCUN identifiant interne dans les réponses conversationnelles (tous statuts)', async () => {
      // Batch VALIDATED.
      const s1 = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-b1.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-b1.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée les fichiers e47-b1'
      );
      const r1 = await executeWithOptions(s1);
      assertConversationalE47(r1.userReply, 'B1/VALIDATED');
      // Batch PARTIAL.
      buildStack({ backend: { failFor: new Set(['src/api/e47-b1.service.ts']) } });
      const s2 = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-b1b.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-b1.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée les fichiers e47-b1b'
      );
      const r2 = await executeWithOptions(s2);
      assertConversationalE47(r2.userReply, 'B1/PARTIAL');
      // Routé échoué.
      buildStack({ ui: { failFor: new Set(['src/components/e47-b1c.tsx']) } });
      const providerE47 = makeCaptureProviderE47([]);
      const s3 = svc.createSession({ tenantId, projectId });
      await svc.processTurn({
        tenantId, projectId, sessionId: s3.sessionId,
        message: 'Crée le composant src/components/e47-b1c.tsx',
        reasoningProvider: providerE47 as never
      });
      const confirmed = await stageAndConfirm(
        [mutationStepE47(1, 'src/components/e47-b1c.tsx', 'CREATE', { targetDomain: 'UI' })],
        'Crée src/components/e47-b1c.tsx',
        s3
      );
      const r3 = await executeWithOptions(confirmed);
      assertConversationalE47(r3.userReply, 'B1/routé-échec');
    });

    it('B2: réponse COURTE pour une mission simple (routé) vs structure adaptée pour une mission complexe', async () => {
      const captured: CapturedRequestE47[] = [];
      const providerE47 = makeCaptureProviderE47(captured);
      const session = svc.createSession({ tenantId, projectId });
      await svc.processTurn({
        tenantId, projectId, sessionId: session.sessionId,
        message: 'Crée le composant src/components/e47-b2.tsx',
        reasoningProvider: providerE47 as never
      });
      const confirmed = await stageAndConfirm(
        [mutationStepE47(1, 'src/components/e47-b2.tsx', 'CREATE', { targetDomain: 'UI' })],
        'Crée src/components/e47-b2.tsx',
        session
      );
      const routed = await executeWithOptions(confirmed);
      const simple = assertConversationalE47(routed.userReply, 'B2/routé');
      const sentences = simple.split('. ').length;
      assert.ok(sentences <= 3, `réponse simple = peu de phrases (${sentences})`);

      const complexSession = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-b2c.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-b2c.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée les fichiers e47-b2c'
      );
      const complex = await executeWithOptions(complexSession);
      const detailed = assertConversationalE47(complex.userReply, 'B2/batch');
      assert.ok(detailed.includes('En place'), 'mission complexe : livrables détaillés');
      assert.ok(detailed.includes('La vérification porte'), 'mission complexe : limites explicitées');
      assert.ok(detailed.length > simple.length, 'adaptation à la complexité (plus structurée)');
    });

    it('B3: pas de template générique répété — chaque statut a SA formulation propre', async () => {
      buildStack({ data: { failFor: new Set(['src/db/e47-b3.schema.ts']) } });
      const blockedSession = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/db/e47-b3.schema.ts', 'CREATE', { targetDomain: 'DATA' }),
          mutationStepE47(2, 'src/api/e47-b3.service.ts', 'CREATE', { targetDomain: 'BACKEND', dependsOn: [1] })
        ],
        'Crée le schema puis le service e47-b3'
      );
      const blocked = await executeWithOptions(blockedSession);
      const blockedReply = assertConversationalE47(blocked.userReply, 'B3/BLOCKED');

      buildStack({ backend: { failFor: new Set(['src/api/e47-b3p.service.ts']) } });
      const partialSession = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-b3p.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-b3p.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée les fichiers e47-b3p'
      );
      const partial = await executeWithOptions(partialSession);
      const partialReply = assertConversationalE47(partial.userReply, 'B3/PARTIAL');

      assert.ok(blockedReply.startsWith('Mission arrêtée (BLOCKED)'), 'ouverture propre au statut BLOCKED');
      assert.ok(partialReply.startsWith('Mission partiellement terminée (PARTIAL)'), 'ouverture propre au statut PARTIAL');
      assert.notEqual(blockedReply, partialReply, 'deux statuts différents ≠ même texte générique');
    });
  });

  // =========================================================================
  // SECTION C — continuité conversationnelle + chaîne réelle (axe 3)
  // =========================================================================

  describe('SECTION C : le résultat réel entre dans la mémoire conversationnelle', () => {
    beforeEach(() => {
      buildStack();
    });

    it('C1 (S12): après une exécution PARTIAL, turnMemory contient la réponse réelle (message AGENT, AUCUN tour factice)', async () => {
      buildStack({ backend: { failFor: new Set(['src/api/e47-c1.service.ts']) } });
      const captured: CapturedRequestE47[] = [];
      const providerE47 = makeCaptureProviderE47(captured);
      const session = svc.createSession({ tenantId, projectId });
      await svc.processTurn({
        tenantId, projectId, sessionId: session.sessionId,
        message: 'Crée le composant src/components/e47-c1.tsx et le service src/api/e47-c1.service.ts',
        reasoningProvider: providerE47 as never
      });
      const confirmed = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-c1.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-c1.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée les fichiers e47-c1',
        session
      );
      // Nombre de tours JUSTE avant l'exécution (stagePlanForConfirmation en
      // ajoute un lui-même — FIX-PLANFIRST) ; l'invariant É47 est que
      // l'EXÉCUTION n'en ajoute aucun.
      const turnsBefore = svc.getSession(tenantId, projectId, session.sessionId, 'OWNER', undefined)!.turns.length;
      const res = await executeWithOptions(confirmed);
      assert.equal(res.supervision!.decision, 'PARTIAL');
      const reply = assertConversationalE47(res.userReply, 'C1');

      const memory = res.session.turnMemory;
      assert.equal(memory.recentMessages.length, 3, 'user + agent + réponse d exécution');
      const last = memory.recentMessages[memory.recentMessages.length - 1]!;
      assert.equal(last.sender, 'AGENT', 'le résultat entre comme message AGENT');
      assert.equal(last.content, reply, 'EXACTEMENT la réponse composée depuis les faits vérifiés');
      assert.ok(memory.lastMessage !== undefined && memory.lastMessage.content === reply, 'lastMessage mis à jour');
      // AUCUN tour factice : l exécution n ajoute pas de ConversationTurn.
      assert.equal(res.session.turns.length, turnsBefore, 'turns inchangé par l exécution (pas de tour factice)');
      // Le reste de la mémoire est préservé (contrats É42 intacts).
      assert.ok(memory.activeIntent !== undefined, 'activeIntent préservé');
    });

    it('C2 (S15): au tour suivant, le provider reçoit le résultat réel dans history (continuité démontrée)', async () => {
      buildStack({ backend: { failFor: new Set(['src/api/e47-c2.service.ts']) } });
      const captured: CapturedRequestE47[] = [];
      const providerE47 = makeCaptureProviderE47(captured);
      const session = svc.createSession({ tenantId, projectId });
      await svc.processTurn({
        tenantId, projectId, sessionId: session.sessionId,
        message: 'Crée le composant src/components/e47-c2.tsx et le service src/api/e47-c2.service.ts',
        reasoningProvider: providerE47 as never
      });
      const confirmed = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-c2.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-c2.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée les fichiers e47-c2',
        session
      );
      const res = await executeWithOptions(confirmed);
      assert.equal(res.supervision!.decision, 'PARTIAL');

      await svc.processTurn({
        tenantId, projectId, sessionId: session.sessionId,
        message: 'Alors, qu est-ce que tu as réellement créé et pourquoi le service manque-t-il ?',
        reasoningProvider: providerE47 as never
      });
      assert.equal(captured.length, 2, 'deux tours capturés');
      const followup = captured[1]!;
      assert.equal(followup.history.length, 3, 'historique : user + agent + résultat d exécution');
      const lastEntry = followup.history[followup.history.length - 1]!;
      assert.equal(lastEntry.sender, 'AGENT', 'le résultat est le dernier message AGENT');
      assert.ok(
        lastEntry.content.includes('Mission partiellement terminée (PARTIAL)'),
        'le statut réel de la mission précédente est dans l historique'
      );
      assert.ok(
        lastEntry.content.includes('src/api/e47-c2.service.ts'),
        'le nom réel du fichier manquant est dans l historique (le provider peut expliquer sans inventer)'
      );
    });

    it('C3: message technique gelé EXACTEMENT inchangé (contrats É39–É46) ; userReply en est la couche conversationnelle', async () => {
      // Batch VALIDATED — le message garde son contrat (jargon, suffixe É46).
      const batchSession = await stageAndConfirm(
        [
          mutationStepE47(1, 'src/components/e47-c3.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE47(2, 'src/api/e47-c3.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée les fichiers e47-c3'
      );
      const batch = await executeWithOptions(batchSession);
      assert.match(batch.message, /Plan multi-agents exécuté via le MultiAgentScheduler/);
      assert.match(batch.message, /agxb-/);
      assert.match(batch.message, /step-1=COMPLETED, step-2=COMPLETED/);
      assert.match(batch.message, /Supervision É46 : VALIDATED/);
      const batchReply = assertConversationalE47(batch.userReply, 'C3/batch');
      assert.notEqual(batchReply, batch.message, 'userReply = couche conversationnelle distincte');

      // Routé — contrat gelé É32/É39 intouché.
      const captured: CapturedRequestE47[] = [];
      const providerE47 = makeCaptureProviderE47(captured);
      const session = svc.createSession({ tenantId, projectId });
      await svc.processTurn({
        tenantId, projectId, sessionId: session.sessionId,
        message: 'Crée le composant src/components/e47-c3b.tsx',
        reasoningProvider: providerE47 as never
      });
      const routedSession = await stageAndConfirm(
        [mutationStepE47(1, 'src/components/e47-c3b.tsx', 'CREATE', { targetDomain: 'UI' })],
        'Crée src/components/e47-c3b.tsx',
        session
      );
      const routed = await executeWithOptions(routedSession);
      assert.match(routed.message, /Plan exécuté via l'agent 'agent-e47-ui'/);
      assert.match(routed.message, /executionId: agx-/);
      assert.match(routed.message, /COMMITTED/);
      assertConversationalE47(routed.userReply, 'C3/routé');
    });
  });
});
