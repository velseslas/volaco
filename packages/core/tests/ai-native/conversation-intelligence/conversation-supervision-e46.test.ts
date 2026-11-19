/**
 * É46 — Supervision, vérification et correction intelligente des résultats
 * d'agents : une DÉCLARATION de réussite (statut SUCCESS d'un agent) n'est
 * JAMAIS une PREUVE de réussite.
 *
 * Défauts démontrés par la sonde É46 (traces AVANT/APRÈS, parcours RÉEL
 * ConversationIntelligenceService → ExecutionBridge → MultiAgentScheduler É37
 * → AgentExecutionService É32→É36 → MutationBridge → FileSource) :
 *   #1 EXIGENCES/INTERDITS — les livrables réellement produits n'étaient
 *      JAMAIS confrontés aux exigences du plan (cibles déclarées
 *      targetFiles) ni aux interdits É44 : un agent livrant un AUTRE fichier
 *      que celui exigé, ou mutant un fichier INTERDIT, obtenait
 *      SUCCESS → batch COMPLETED → « mission réussie ».
 *   #2 COHÉRENCE GLOBALE — aucun raisonnement multi-agents : un agent pouvait
 *      muter la cible déclarée d'un autre agent (l'invalider) sans dépendance
 *      déclarée ; le batch restait COMPLETED, l'invalidation invisible.
 *
 * Corrections vérifiées ICI (pipeline RÉEL, pattern É39/É44/É45 — aucun
 * agent.executeTask() direct, MÊME AgentExecutionService que server.ts) :
 *   A — exigences du plan vs livrables réels (cibles déclarées produites ;
 *       livrables produits ⊆ exigences) + interdits É44 (contraintes
 *       interdictives actives → chemins protégés, extraction É40 partagée) ;
 *   B — correction ciblée BORNÉE : OPT-IN (refus sans autorisation), budget
 *       plafonné (2 max, anti-boucle), TOUJOURS via le pipeline sécurisé
 *       existant (executor.execute = AgentExecutionService É32→É36 : gates,
 *       isolation, single-writer, rollback), RE-VÉRIFICATION réelle après
 *       chaque tentative, résidus tracés — jamais de faux succès ;
 *   C — cohérence GLOBALE multi-agents (invalidation croisée sans dépendance
 *       directe, chemins hors exigence mutés par 2 tâches), statuts
 *       honnêtes (VALIDATED / NEEDS_CORRECTION / BLOCKED / PARTIAL),
 *       réponse finale fidèle au résultat partiel, chemin routé historique
 *       préservé (≤1 étape : aucune supervision), rapport gelé.
 *
 * Correspondance scénarios obligatoires (sonde É46 = S1–S15) :
 *   S1  = A1 (agent réussi, livrable vérifiable) ;
 *   S2  = A2 (SUCCESS déclaré SANS livrable → jamais compté) ;
 *   S5  = A3 (livrable non conforme — DÉFAUT 1a) ;
 *   S14 = A4 (mission entièrement validée) ;
 *   S6  = B1 (contrainte utilisateur non respectée — DÉFAUT 1b) ;
 *   S7  = B2 (élément interdit modifié) ;
 *   S11 = B3 (défaut détecté puis correction ciblée autorisée) ;
 *   S12 = B4 (correction refusée faute d'autorisation) ;
 *   S13 = B5 (échec de la seconde vérification) ;
 *   S3  = C1 (agents FAILED) ;
 *   S4  = C2 (tâches BLOCKED) ;
 *   S9  = C3 (dépendance non satisfaite) ;
 *   S8  = C4 (2 agents incompatibles / invalidation croisée — DÉFAUT 2) ;
 *   S10 = C5 (mission partiellement réussie) ;
 *   S15 = C6 (réponse finale fidèle à un résultat partiel).
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
// Fabriques de référence (pattern É39/É44/É45)
// ---------------------------------------------------------------------------

let planSeq = 0;
let intentSeq = 0;

function makePlanE46(steps: readonly PlanStep[]): EngineeringPlan {
  planSeq += 1;
  const partial = {
    planId: `plan-e46-${planSeq}`,
    title: 'Plan É46',
    summary: `Plan de test É46 (${steps.length} étape(s))`,
    steps,
    status: 'APPROVED' as const
  };
  return { ...partial, planHash: computeEngineeringPlanHash(partial) };
}

function makeIntentE46(category: 'CREATE' | 'MODIFY' | 'DELETE', goal: string): IntentResult {
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
  readonly title?: string | undefined;
  readonly description?: string | undefined;
}

const mutationStepE46 = (
  index: number,
  file: string,
  operation: 'CREATE' | 'MODIFY' | 'DELETE' = 'CREATE',
  options: StepOptions = {}
): PlanStep => ({
  stepIndex: index,
  title: options.title ?? `${operation} ${file}`,
  description: options.description ?? `${operation} du fichier ${file}`,
  targetFiles: [file],
  operation,
  requiresApproval: false,
  ...(options.targetDomain !== undefined ? { targetDomain: options.targetDomain } : {}),
  ...(options.dependsOn !== undefined ? { dependsOn: options.dependsOn } : {})
});

// ---------------------------------------------------------------------------
// Agents de capture (pattern É39/É45 — état dans des closures, JAMAIS l'instance)
// ---------------------------------------------------------------------------

type CaptureRecord = {
  readonly taskId: string;
  readonly agentId: string;
  readonly agentDomain: string;
  readonly declaredStatus: string | null;
  readonly targetFiles: readonly string[];
};

/** Capabilities RÉELLES des agents de production (pattern É45). */
const REAL_CAPS: Record<string, readonly string[]> = {
  UI: ['PAGE_GENERATION', 'COMPONENT_STYLING', 'RESPONSIVE_LAYOUT'],
  BACKEND: ['API_DESIGN', 'SERVICE_LOGIC'],
  DATA: ['SCHEMA_MODELING', 'DATA_INTEGRITY'],
  SECURITY: ['AUTH_RBAC', 'VULNERABILITY_SCAN'],
  TEST: ['UNIT_TEST_GEN', 'INTEGRATION_TEST', 'E2E_SCENARIO'],
  ARCHITECTURE: ['SERVICE_LOGIC', 'SCHEMA_MODELING']
};

const ZERO_TOKENS = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

interface AgentBehaviorE46 {
  /** Échec RÉEL (statut FAILURE) pour les tâches ciblant ces fichiers. */
  readonly failFor?: ReadonlySet<string>;
  /** Défaut TRANSITOIRE : échec à la 1re invocation du taskId, succès ensuite. */
  readonly failFirstFor?: ReadonlySet<string>;
  /** L'agent DÉCLARE SUCCESS mais ne produit AUCUN artifact. */
  readonly noArtifactFor?: ReadonlySet<string>;
  /** Livrable livré sur un AUTRE chemin que l'exigence du plan (DÉFAUT 1a). */
  readonly wrongPathFor?: Readonly<Record<string, string>>;
  /** L'agent mute un fichier INTERDIT É44 (DÉFAUT 1b). */
  readonly forbiddenFor?: Readonly<Record<string, string>>;
  /** Artifact en PLUS (UPDATE) sur un chemin déclaré par une autre tâche. */
  readonly extraArtifactFor?: Readonly<Record<string, string>>;
}

function makeSpecialistE46(
  captures: CaptureRecord[],
  id: string,
  domain: string,
  behavior: AgentBehaviorE46 = {}
): BaseSpecializedAgent {
  const caps = [...(REAL_CAPS[domain] ?? [])];
  caps.push('FILE_MUTATION');
  const callCounts = new Map<string, number>();
  class SpecialistAgent extends BaseSpecializedAgent {
    constructor() {
      super(
        {
          id,
          name: `E46 ${domain}`,
          domain: domain as never,
          capabilities: caps as never[],
          description: `agent de test É46 : spécialité ${domain} (capabilities réelles de production)`,
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
        agentDomain: domain,
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
              ? 'E46_FAIL_INJECTE'
              : 'E46_FAIL_PREMIERE_TENTATIVE'
        };
      }
      if (behavior.noArtifactFor?.has(key)) {
        // DÉCLARATION de réussite SANS aucun livrable (preuve exigée, pas la déclaration).
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
      let note = 'conforme';
      if (behavior.wrongPathFor?.[key]) {
        filePath = behavior.wrongPathFor[key]!;
        note = 'HORS EXIGENCE';
      }
      if (behavior.forbiddenFor?.[key]) {
        filePath = behavior.forbiddenFor[key]!;
        note = 'INTERDIT MUTÉ';
      }
      const operation =
        params.task.operation === 'DELETE' ? 'DELETE' : params.task.operation === 'MODIFY' ? 'UPDATE' : 'CREATE';
      const artifact = (path: string, op: string, artifactNote: string): AgentArtifact => ({
        id: `art-${params.task.id}-${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        taskId: params.task.id,
        agentId: id,
        domain: domain as never,
        kind: 'PROPOSED_FILE_CHANGE',
        targetFiles: [path],
        payload: {
          filePath: path,
          operation: op,
          proposedContent: `// e46-${id} ${params.task.id} -> ${path} [${artifactNote}]\n`,
          reason: `É46 ${artifactNote}`
        },
        confidence: 1,
        hash: `hash-e46-${params.task.id}-${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        summary: 'É46'
      });
      const artifacts: AgentArtifact[] = [artifact(filePath, operation, note)];
      const extra = behavior.extraArtifactFor?.[key];
      if (extra) {
        // Mutation NON DÉCLARÉE sur un chemin déjà existant (écrit par une tâche antérieure).
        artifacts.push(artifact(extra, 'UPDATE', 'MUTATION NON DÉCLARÉE'));
      }
      return {
        taskId: params.task.id,
        agentId: id,
        status: 'SUCCESS' as const,
        degraded: false,
        artifacts,
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

// ===========================================================================
// Chaîne RÉELLE (wiring identique à apps/api/src/server.ts — pattern É45)
// ===========================================================================

describe('É46 — supervision des résultats sur le parcours réel (batch É37 → É36)', () => {
  let fileSource: InMemoryMutableFileSource;
  let orchestrator: AIOrchestratorService;
  let svc: ConversationIntelligenceService;
  let captures: CaptureRecord[];
  let runSeq = 0;
  const tenantId = 'tenant-e46-int';
  let projectId: string;

  interface StackOptions {
    readonly ui?: AgentBehaviorE46;
    readonly backend?: AgentBehaviorE46;
    readonly data?: AgentBehaviorE46;
  }

  function buildStack(options: StackOptions = {}): void {
    runSeq += 1;
    projectId = `proj-e46-int-${runSeq}`;
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
    registry.register(makeSpecialistE46(captures, 'agent-e46-ui', 'UI', options.ui ?? {}));
    registry.register(makeSpecialistE46(captures, 'agent-e46-backend', 'BACKEND', options.backend ?? {}));
    registry.register(makeSpecialistE46(captures, 'agent-e46-data', 'DATA', options.data ?? {}));
    svc = new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
    svc.attachAgentExecutor({
      execute: (request) => orchestrator.executeAgent(request),
      getRegistry: () => orchestrator.getExecutionAgentRegistry(),
      executeBatch: (request) => orchestrator.executeBatch(request)
    });
  }

  function stageAndConfirm(
    steps: readonly PlanStep[],
    userMessage: string
  ): Promise<ConversationSession> {
    const session = svc.createSession({ tenantId, projectId });
    const plan = makePlanE46(steps);
    svc.stagePlanForConfirmation({
      tenantId,
      projectId,
      sessionId: session.sessionId,
      userMessage,
      intent: makeIntentE46('CREATE', 'demande É46'),
      plan
    });
    return svc
      .confirmPlan({ tenantId, projectId, sessionId: session.sessionId, planId: plan.planId, approved: true })
      .then(() => session);
  }

  async function executeWithOptions(
    session: ConversationSession,
    options?: { readonly supervisionRepair?: { readonly enabled: boolean; readonly maxAttempts?: number } }
  ): Promise<{
    success: boolean;
    message: string;
    error?: string;
    supervision?: {
      readonly decision: string;
      readonly initialDecision: string;
      readonly batchStatus: string;
      readonly counts: { readonly completed: number; readonly failed: number; readonly blocked: number; readonly pending: number; readonly cancelled: number; readonly total: number };
      readonly checks: readonly { readonly check: string; readonly passed: boolean; readonly detail?: string }[];
      readonly findings: readonly { readonly kind: string; readonly taskId: string; readonly detail: string; readonly repairable: boolean }[];
      readonly repair: {
        readonly authorized: boolean;
        readonly attempted: boolean;
        readonly attemptsUsed: number;
        readonly maxAttempts: number;
        readonly attempts: readonly { readonly taskId: string; readonly executionId: string; readonly outcomeStatus: string; readonly error?: string }[];
        readonly refusalReason?: string;
      };
    };
  }> {
    const result = await svc.executeApprovedPlan(
      { tenantId, projectId, sessionId: session.sessionId },
      'OWNER',
      undefined,
      options
    );
    const raw = result.executionResult as {
      success: boolean;
      message: string;
      error?: string;
      supervision?: unknown;
    };
    return {
      success: raw.success,
      message: raw.message,
      ...(raw.error !== undefined ? { error: raw.error } : {}),
      supervision: raw.supervision as never
    };
  }

  // =========================================================================
  // SECTION A — exigences du plan vs livrables RÉELS (DÉFAUT 1a)
  // =========================================================================

  describe('SECTION A : exigences du plan confrontées aux livrables réels', () => {
    beforeEach(() => {
      buildStack();
    });

    it('A1 (S1): agent réussi avec livrable VÉRIFIABLE → VALIDATED avec preuves réelles', async () => {
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/components/e46-a1.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE46(2, 'src/api/e46-a1.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e46-a1.tsx et src/api/e46-a1.service.ts'
      );
      const res = await executeWithOptions(session);

      assert.equal(res.success, true, res.message);
      const sup = res.supervision!;
      assert.equal(sup.decision, 'VALIDATED');
      assert.equal(sup.initialDecision, 'VALIDATED');
      assert.equal(sup.batchStatus, 'COMPLETED');
      assert.deepEqual({ ...sup.counts }, { completed: 2, failed: 0, cancelled: 0, blocked: 0, pending: 0, total: 2 });
      assert.equal(sup.findings.length, 0, 'aucun défaut sur un batch sain');
      assert.equal(sup.repair.attempted, false);
      // Preuves RÉELLES : la source de vérité contient exactement les livrables exigés.
      const ui = fileSource.getFile(tenantId, projectId, 'src/components/e46-a1.tsx');
      const backend = fileSource.getFile(tenantId, projectId, 'src/api/e46-a1.service.ts');
      assert.ok(ui && ui.content.includes('[conforme]'), 'livrable UI réellement écrit');
      assert.ok(backend && backend.content.includes('[conforme]'), 'livrable BACKEND réellement écrit');
      // Contrôles de supervision : exigences du plan + conformité + interdits.
      assert.ok(sup.checks.some((c) => c.passed && c.check.includes('exigence du plan step-1')));
      assert.ok(sup.checks.some((c) => c.passed && c.check.includes('interdits É44')));
      assert.match(res.message ?? '', /Supervision É46 : VALIDATED/);
    });

    it('A2 (S2): agent DÉCLARE SUCCESS sans livrable → JAMAIS compté (déclaration ≠ preuve)', async () => {
      buildStack({
        ui: { noArtifactFor: new Set(['src/components/e46-a2.tsx']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/components/e46-a2.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE46(2, 'src/api/e46-a2.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e46-a2.tsx et src/api/e46-a2.service.ts'
      );
      const res = await executeWithOptions(session);

      // L'agent a DÉCLARÉ SUCCESS sans livrable → l'exécution É36 prouve l'échec.
      const uiCapture = captures.find((c) => c.taskId === 'step-1')!;
      assert.match(uiCapture.declaredStatus ?? '', /SUCCESS/, 'l agent a DÉCLARÉ SUCCESS');
      assert.match(res.message ?? '', /step-1=FAILED/, 'le verdict réel est FAILURE (NO_EXPECTED_RESULT)');
      assert.match(res.message ?? '', /NO_EXPECTED_RESULT/);
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/components/e46-a2.tsx'), null, 'aucun livrable réel');
      const sup = res.supervision!;
      assert.equal(sup.decision, 'PARTIAL', '1/2 seulement — jamais présenté comme complet');
      assert.equal(sup.counts.completed, 1);
      assert.equal(sup.counts.failed, 1);
      assert.equal(res.success, false);
    });

    it('A3 (S5): livrable NON CONFORME (autre fichier que l exigence) → NEEDS_CORRECTION, JAMAIS annoncé réussi [DÉFAUT 1a]', async () => {
      buildStack({
        ui: { wrongPathFor: { 'src/components/e46-a3.tsx': 'src/components/e46-a3-WRONG.tsx' } }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/components/e46-a3.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE46(2, 'src/api/e46-a3.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e46-a3.tsx et src/api/e46-a3.service.ts'
      );
      const res = await executeWithOptions(session);

      // AVANT correction : ce batch était annoncé success=true (2/2 COMPLETED)
      // alors que l'exigence du plan (src/components/e46-a3.tsx) n'était PAS produite.
      const sup = res.supervision!;
      assert.equal(sup.decision, 'NEEDS_CORRECTION');
      assert.equal(sup.batchStatus, 'COMPLETED', 'le verdict BRUT du scheduler est conservé tel quel');
      assert.equal(res.success, false, 'le superviseur refuse de valider un livrable hors exigence');
      const missing = sup.findings.filter((f) => f.kind === 'TARGET_MISMATCH' && f.repairable);
      assert.equal(missing.length, 1, 'exigence du plan non satisfaite (précise et corrigeable)');
      assert.match(missing[0]!.detail, /devait produire \[src\/components\/e46-a3\.tsx\]/);
      assert.match(missing[0]!.detail, /exigence du plan n'est pas satisfaite/);
      const residual = sup.findings.filter((f) => f.kind === 'TARGET_MISMATCH' && !f.repairable);
      assert.equal(residual.length, 1, 'mutation hors exigence tracée comme résidu (jamais auto-correctible)');
      assert.match(residual[0]!.detail, /e46-a3-WRONG\.tsx/);
      // Preuves réelles : le mauvais fichier existe, l'exigence est ABSENTE.
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e46-a3-WRONG.tsx'));
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/components/e46-a3.tsx'), null);
    });

    it('A4 (S14): mission ENTIÈREMENT validée → VALIDATED (chaîne 3 spécialités, dépendances réelles)', async () => {
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/db/e46-a4.schema.ts', 'CREATE', { targetDomain: 'DATA' }),
          mutationStepE46(2, 'src/api/e46-a4.service.ts', 'CREATE', { targetDomain: 'BACKEND', dependsOn: [1] }),
          mutationStepE46(3, 'src/components/e46-a4.tsx', 'CREATE', { targetDomain: 'UI', dependsOn: [2] })
        ],
        'Crée le schema, le service puis la page'
      );
      const res = await executeWithOptions(session);

      assert.equal(res.success, true, res.message);
      const sup = res.supervision!;
      assert.equal(sup.decision, 'VALIDATED');
      assert.deepEqual({ ...sup.counts }, { completed: 3, failed: 0, cancelled: 0, blocked: 0, pending: 0, total: 3 });
      assert.equal(sup.findings.length, 0);
      for (const path of ['src/db/e46-a4.schema.ts', 'src/api/e46-a4.service.ts', 'src/components/e46-a4.tsx']) {
        assert.ok(fileSource.getFile(tenantId, projectId, path), `${path} réellement écrit`);
      }
      assert.match(res.message ?? '', /3\/3/);
      assert.match(res.message ?? '', /VALIDATED/);
    });
  });

  // =========================================================================
  // SECTION B — interdits É44 + correction ciblée BORNÉE (DÉFAUT 1b)
  // =========================================================================

  describe('SECTION B : interdits É44 et correction ciblée bornée', () => {
    it('B1 (S6): contrainte «ne modifie pas X» ENFREINTE → FORBIDDEN_PATH_MUTATED, jamais validé [DÉFAUT 1b]', async () => {
      buildStack({
        ui: { forbiddenFor: { 'src/components/e46-b1.tsx': 'src/legacy/config.ts' } }
      });
      let session = svc.createSession({ tenantId, projectId });
      session = (await svc.processTurn({
        tenantId, projectId, sessionId: session.sessionId, message: 'ne modifie pas src/legacy/config.ts'
      })).session;
      session = (await svc.processTurn({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        message: 'Crée le composant src/components/e46-b1.tsx et le service src/api/e46-b1.service.ts'
      })).session;
      assert.ok(session.activePlan, 'le plan conversationnel est actif');
      await svc.confirmPlan({
        tenantId, projectId, sessionId: session.sessionId, planId: session.activePlan.planId, approved: true
      });
      const res = await executeWithOptions(session);

      const sup = res.supervision!;
      assert.equal(sup.decision, 'NEEDS_CORRECTION');
      assert.equal(res.success, false, 'un interdit enfreint n est JAMAIS une mission validée');
      const forbidden = sup.findings.find((f) => f.kind === 'FORBIDDEN_PATH_MUTATED');
      assert.ok(forbidden, 'l interdit enfreint est détecté');
      assert.match(forbidden!.detail, /ne modifie pas src\/legacy\/config\.ts/);
      assert.equal(forbidden!.repairable, false, 'jamais de correction automatique d un interdit');
      // Preuve réelle : le fichier interdit a été muté sur la source.
      const forbiddenFile = fileSource.getFile(tenantId, projectId, 'src/legacy/config.ts');
      assert.ok(forbiddenFile, 'la mutation interdite a bien eu lieu (preuve, pas supposition)');
      assert.match(forbiddenFile!.content, /INTERDIT MUTÉ/);
    });

    it('B2 (S7): interdit «Ne jamais modifier X» muté → FORBIDDEN_PATH_MUTATED (2e formulation)', async () => {
      buildStack({
        ui: { forbiddenFor: { 'src/components/e46-b2.tsx': 'src/legacy/config.ts' } }
      });
      let session = svc.createSession({ tenantId, projectId });
      session = (await svc.processTurn({
        tenantId, projectId, sessionId: session.sessionId, message: 'Ne jamais modifier src/legacy/config.ts'
      })).session;
      session = (await svc.processTurn({
        tenantId,
        projectId,
        sessionId: session.sessionId,
        message: 'Crée le composant src/components/e46-b2.tsx et le schema src/db/e46-b2.schema.ts'
      })).session;
      assert.ok(session.activePlan);
      await svc.confirmPlan({
        tenantId, projectId, sessionId: session.sessionId, planId: session.activePlan.planId, approved: true
      });
      const res = await executeWithOptions(session);

      const sup = res.supervision!;
      const forbidden = sup.findings.find((f) => f.kind === 'FORBIDDEN_PATH_MUTATED');
      assert.ok(forbidden);
      assert.match(forbidden!.detail, /Ne jamais modifier src\/legacy\/config\.ts/);
      assert.equal(sup.decision, 'NEEDS_CORRECTION');
      assert.equal(res.success, false);
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/legacy/config.ts'));
    });

    it('B3 (S11): défaut détecté puis CORRECTION CIBLÉE autorisée via le pipeline sécurisé → VALIDATED avec trace', async () => {
      buildStack({
        ui: { failFirstFor: new Set(['src/components/e46-b3.tsx']) },
        backend: { failFirstFor: new Set(['src/api/e46-b3.service.ts']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/components/e46-b3.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE46(2, 'src/api/e46-b3.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e46-b3.tsx et src/api/e46-b3.service.ts'
      );
      const res = await executeWithOptions(session, {
        supervisionRepair: { enabled: true, maxAttempts: 2 }
      });

      assert.equal(res.success, true, res.message);
      const sup = res.supervision!;
      assert.equal(sup.initialDecision, 'NEEDS_CORRECTION', 'le défaut initial est détecté');
      assert.equal(sup.decision, 'VALIDATED', 'la correction ciblée réelle produit un verdict honnête');
      assert.equal(sup.repair.authorized, true);
      assert.equal(sup.repair.attempted, true);
      assert.equal(sup.repair.attemptsUsed, 2);
      assert.equal(sup.repair.maxAttempts, 2);
      assert.ok(sup.repair.attempts.every((a) => a.outcomeStatus === 'SUCCESS'), 'chaque correction passe par É36 (statut réel)');
      // PREUVE du pipeline sécurisé : chaque correction ré-invoque le MÊME
      // AgentExecutionService (captures supplémentaires, JAMAIS executeTask direct).
      assert.equal(captures.filter((c) => c.taskId === 'step-1').length, 2, '1 tentative initiale + 1 correction sécurisée');
      assert.equal(captures.filter((c) => c.taskId === 'step-2').length, 2);
      for (const attempt of sup.repair.attempts) {
        assert.match(attempt.executionId, /--sup-repair-\d$/, 'executionId de correction traçable');
      }
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e46-b3.tsx'));
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/api/e46-b3.service.ts'));
      assert.match(res.message ?? '', /VALIDATED après 2 correction\(s\) ciblée\(s\)/);
    });

    it('B4 (S12): correction ciblée REFUSÉE faute d autorisation (aucune politique activée)', async () => {
      buildStack({
        ui: { failFirstFor: new Set(['src/components/e46-b4.tsx']) },
        backend: { failFirstFor: new Set(['src/api/e46-b4.service.ts']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/components/e46-b4.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE46(2, 'src/api/e46-b4.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e46-b4.tsx et src/api/e46-b4.service.ts'
      );
      // AUCUNE option supervisionRepair → correction possible mais REFUSÉE.
      const res = await executeWithOptions(session);

      const sup = res.supervision!;
      assert.equal(sup.decision, 'NEEDS_CORRECTION');
      assert.equal(res.success, false);
      assert.equal(sup.repair.authorized, false);
      assert.equal(sup.repair.attempted, false);
      assert.equal(sup.repair.attemptsUsed, 0, 'AUCUNE re-exécution sans autorisation explicite');
      assert.match(sup.repair.refusalReason ?? '', /aucune politique de correction ciblée activée/);
      assert.equal(captures.filter((c) => c.taskId === 'step-1').length, 1, 'aucune tentative cachée');
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/components/e46-b4.tsx'), null);
    });

    it('B5 (S13): correction tentée mais la RE-VÉRIFICATION échoue → NEEDS_CORRECTION, JAMAIS de faux succès', async () => {
      buildStack({
        backend: { failFirstFor: new Set(['src/api/e46-b5.service.ts']) }
      });
      const session = await stageAndConfirm(
        [
          // MODIFY sur un fichier inexistant : précondition de mutation impossible (déterministe).
          mutationStepE46(1, 'src/db/e46-b5-missing.schema.ts', 'MODIFY', { targetDomain: 'DATA' }),
          mutationStepE46(2, 'src/api/e46-b5.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Modifie le schema puis crée le service'
      );
      const res = await executeWithOptions(session, {
        supervisionRepair: { enabled: true, maxAttempts: 1 }
      });

      const sup = res.supervision!;
      assert.equal(res.success, false, 'aucun faux succès : la re-vérification a échoué');
      assert.equal(sup.decision, 'NEEDS_CORRECTION');
      assert.equal(sup.repair.attempted, true);
      assert.equal(sup.repair.attemptsUsed, 1);
      assert.equal(sup.repair.maxAttempts, 1, 'budget strict : la 2e tâche échouée n est JAMAIS relancée');
      const repairAttempt = sup.repair.attempts[0]!;
      assert.equal(repairAttempt.outcomeStatus, 'FAILURE', 'statut É36 RÉEL de la tentative de correction');
      assert.match(repairAttempt.error ?? '', /Précondition échouée/);
      assert.match(res.message ?? '', /re-vérification en échec ou partielle — aucun faux succès/);
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/db/e46-b5-missing.schema.ts'), null);
    });

    it('B6: budget de correction PLAFONNÉ (maxAttempts clampé à 2 — anti-boucle stricte)', async () => {
      buildStack({
        ui: { failFor: new Set(['src/components/e46-b6.tsx']) },
        backend: { failFor: new Set(['src/api/e46-b6.service.ts']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/components/e46-b6.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE46(2, 'src/api/e46-b6.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e46-b6.tsx et src/api/e46-b6.service.ts'
      );
      const res = await executeWithOptions(session, {
        supervisionRepair: { enabled: true, maxAttempts: 99 }
      });

      const sup = res.supervision!;
      assert.equal(sup.repair.maxAttempts, 2, 'le budget demandé est clampé au plafond');
      assert.equal(sup.repair.attemptsUsed, 2, 'exactement 2 tentatives, jamais une boucle infinie');
      assert.ok(sup.repair.attempts.every((a) => a.outcomeStatus === 'FAILURE'));
      assert.equal(sup.decision, 'NEEDS_CORRECTION');
      assert.equal(res.success, false);
    });
  });

  // =========================================================================
  // SECTION C — cohérence GLOBALE multi-agents + statuts honnêtes (DÉFAUT 2)
  // =========================================================================

  describe('SECTION C : cohérence multi-agents et statuts honnêtes', () => {
    beforeEach(() => {
      buildStack();
    });

    it('C1 (S3): agents FAILED ×2 → NEEDS_CORRECTION avec preuves réelles', async () => {
      buildStack({
        ui: { failFor: new Set(['src/components/e46-c1.tsx']) },
        backend: { failFor: new Set(['src/api/e46-c1.service.ts']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/components/e46-c1.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE46(2, 'src/api/e46-c1.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e46-c1.tsx et src/api/e46-c1.service.ts'
      );
      const res = await executeWithOptions(session);

      const sup = res.supervision!;
      assert.equal(sup.decision, 'NEEDS_CORRECTION');
      assert.deepEqual({ ...sup.counts }, { completed: 0, failed: 2, cancelled: 0, blocked: 0, pending: 0, total: 2 });
      assert.match(res.message ?? '', /step-1=FAILED/);
      assert.match(res.message ?? '', /step-2=FAILED/);
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/components/e46-c1.tsx'), null);
    });

    it('C2 (S4): chaîne A→B→C avec A en échec → BLOCKED (B et C jamais exécutées, aucune partie inventée)', async () => {
      buildStack({
        data: { failFor: new Set(['src/db/e46-c2.schema.ts']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/db/e46-c2.schema.ts', 'CREATE', { targetDomain: 'DATA' }),
          mutationStepE46(2, 'src/api/e46-c2.service.ts', 'CREATE', { targetDomain: 'BACKEND', dependsOn: [1] }),
          mutationStepE46(3, 'src/components/e46-c2.tsx', 'CREATE', { targetDomain: 'UI', dependsOn: [2] })
        ],
        'Crée le schema, le service puis la page'
      );
      const res = await executeWithOptions(session);

      const sup = res.supervision!;
      assert.equal(sup.decision, 'BLOCKED');
      assert.deepEqual({ ...sup.counts }, { completed: 0, failed: 1, cancelled: 0, blocked: 2, pending: 0, total: 3 });
      assert.equal(sup.findings.length, 0, 'aucun défaut de supervision : l état est un blocage réel');
      assert.match(res.message ?? '', /Supervision É46 : BLOCKED/);
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/api/e46-c2.service.ts'), null);
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/components/e46-c2.tsx'), null);
    });

    it('C3 (S9): dépendance non satisfaite (A échoue → B BLOCKED) → BLOCKED avec preuve', async () => {
      buildStack({
        data: { failFor: new Set(['src/db/e46-c3.schema.ts']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/db/e46-c3.schema.ts', 'CREATE', { targetDomain: 'DATA' }),
          mutationStepE46(2, 'src/api/e46-c3.service.ts', 'CREATE', { targetDomain: 'BACKEND', dependsOn: [1] })
        ],
        'Crée le schema puis le service'
      );
      const res = await executeWithOptions(session);

      const sup = res.supervision!;
      assert.equal(sup.decision, 'BLOCKED');
      assert.equal(sup.counts.blocked, 1);
      assert.match(res.message ?? '', /step-2=BLOCKED/);
      assert.equal(captures.filter((c) => c.taskId === 'step-2').length, 0, 'la dépendante ne démarre jamais');
    });

    it('C4 (S8): invalidation CROISÉE (step-3 mute la cible déclarée de step-1, sans dépendance directe) → NEEDS_CORRECTION [DÉFAUT 2]', async () => {
      buildStack({
        backend: { extraArtifactFor: { 'src/api/e46-c4.service.ts': 'src/db/e46-c4.config.ts' } }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/db/e46-c4.config.ts', 'CREATE', { targetDomain: 'DATA' }),
          mutationStepE46(2, 'src/api/e46-c4.mid.ts', 'CREATE', { targetDomain: 'BACKEND', dependsOn: [1] }),
          mutationStepE46(3, 'src/api/e46-c4.service.ts', 'CREATE', { targetDomain: 'BACKEND', dependsOn: [2], title: 'Branchement c4' })
        ],
        'Crée le config, le mid puis le service'
      );
      const res = await executeWithOptions(session);

      // AVANT correction : batch COMPLETED 3/3 annoncé success=true alors que
      // le livrable de step-1 était écrasé par step-3 sans dépendance directe.
      const sup = res.supervision!;
      assert.equal(sup.batchStatus, 'COMPLETED');
      assert.equal(res.success, false, 'le superviseur refuse de valider une incohérence globale');
      const cross = sup.findings.find((f) => f.kind === 'CROSS_AGENT_INVALIDATION');
      assert.ok(cross, 'l invalidation croisée est détectée');
      assert.equal(cross!.taskId, 'step-3');
      assert.match(cross!.detail, /a réellement muté src\/db\/e46-c4\.config\.ts qui est la cible déclarée de step-1/);
      assert.equal(cross!.repairable, false, 'jamais de correction automatique d une incohérence globale');
      assert.ok(
        sup.findings.some((f) => f.kind === 'TARGET_MISMATCH' && f.detail.includes('e46-c4.config.ts')),
        'la mutation hors exigence de step-3 est aussi tracée'
      );
      // PREUVE réelle de l invalidation : le contenu final n est plus celui de step-1.
      const config = fileSource.getFile(tenantId, projectId, 'src/db/e46-c4.config.ts');
      assert.ok(config);
      assert.match(config!.content, /step-3/, 'le livrable de step-1 a été écrasé par step-3');
    });

    it('C5 (S10): mission partiellement réussie (1/3) → PARTIAL, jamais présenté comme complet', async () => {
      buildStack({
        backend: { failFor: new Set(['src/api/e46-c5.service.ts']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/components/e46-c5.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE46(2, 'src/api/e46-c5.service.ts', 'CREATE', { targetDomain: 'BACKEND' }),
          mutationStepE46(3, 'src/db/e46-c5.schema.ts', 'CREATE', { targetDomain: 'DATA', dependsOn: [2] })
        ],
        'Crée le composant, le service puis le schema'
      );
      const res = await executeWithOptions(session);

      const sup = res.supervision!;
      assert.equal(sup.decision, 'PARTIAL');
      assert.deepEqual({ ...sup.counts }, { completed: 1, failed: 1, cancelled: 0, blocked: 1, pending: 0, total: 3 });
      assert.equal(res.success, false);
      assert.match(res.message ?? '', /1\/3/);
      assert.match(res.message ?? '', /PARTIAL/);
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e46-c5.tsx'));
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/api/e46-c5.service.ts'), null);
    });

    it('C6 (S15): réponse finale FIDÈLE au résultat partiel (2/3, livrable échoué réellement ABSENT)', async () => {
      buildStack({
        backend: { failFor: new Set(['src/api/e46-c6.service.ts']) }
      });
      const session = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/components/e46-c6.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE46(2, 'src/api/e46-c6.service.ts', 'CREATE', { targetDomain: 'BACKEND' }),
          mutationStepE46(3, 'src/db/e46-c6.schema.ts', 'CREATE', { targetDomain: 'DATA' })
        ],
        'Crée le composant, le service et le schema'
      );
      const res = await executeWithOptions(session);

      const sup = res.supervision!;
      assert.equal(sup.decision, 'PARTIAL');
      assert.equal(sup.counts.completed, 2);
      assert.equal(sup.counts.failed, 1);
      // Fidélité : les compteurs du message reflètent l état RÉEL de la source.
      assert.match(res.message ?? '', /2\/3 complétée\(s\)/);
      assert.match(res.message ?? '', /step-2=FAILED/);
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e46-c6.tsx'));
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/db/e46-c6.schema.ts'));
      assert.equal(fileSource.getFile(tenantId, projectId, 'src/api/e46-c6.service.ts'), null);
      assert.equal(res.success, false, 'un partiel n est jamais un succès');
    });

    it('C7: chemin routé historique (≤1 étape de mutation) → AUCUNE supervision, comportement É32/É39 préservé', async () => {
      const session = await stageAndConfirm(
        [mutationStepE46(1, 'src/components/e46-c7.tsx', 'CREATE', { targetDomain: 'UI' })],
        'Crée src/components/e46-c7.tsx'
      );
      const res = await executeWithOptions(session);

      assert.equal(res.success, true, res.message);
      assert.equal(res.supervision, undefined, 'le chemin routé reste sous contrat É32/É36 (aucun double système)');
      assert.equal(captures.length, 1);
      assert.ok(fileSource.getFile(tenantId, projectId, 'src/components/e46-c7.tsx'));
    });

    it('C8: rapport de supervision GELÉ + isolation : la contrainte d une session ne contamine pas une autre', async () => {
      // Projet A : interdit enfreint.
      buildStack({
        ui: { forbiddenFor: { 'src/components/e46-c8a.tsx': 'src/legacy/config.ts' } }
      });
      let sessionA = svc.createSession({ tenantId, projectId });
      sessionA = (await svc.processTurn({
        tenantId, projectId, sessionId: sessionA.sessionId, message: 'ne modifie pas src/legacy/config.ts'
      })).session;
      sessionA = (await svc.processTurn({
        tenantId,
        projectId,
        sessionId: sessionA.sessionId,
        message: 'Crée le composant src/components/e46-c8a.tsx et le service src/api/e46-c8a.service.ts'
      })).session;
      assert.ok(sessionA.activePlan);
      await svc.confirmPlan({
        tenantId, projectId, sessionId: sessionA.sessionId, planId: sessionA.activePlan.planId, approved: true
      });
      const resA = await executeWithOptions(sessionA);
      const supA = resA.supervision!;
      assert.equal(supA.decision, 'NEEDS_CORRECTION');
      assert.ok(supA.findings.some((f) => f.kind === 'FORBIDDEN_PATH_MUTATED'));
      assert.equal(Object.isFrozen(supA), true, 'le rapport est gelé');
      assert.equal(Object.isFrozen(supA.findings), true);
      assert.equal(Object.isFrozen(supA.repair), true);

      // Projet B (même stack, autre session) : AUCUNE contrainte d interdiction
      // → le MÊME nom de fichier muté N est PAS signalé (isolation réelle).
      buildStack();
      const sessionB = await stageAndConfirm(
        [
          mutationStepE46(1, 'src/components/e46-c8b.tsx', 'CREATE', { targetDomain: 'UI' }),
          mutationStepE46(2, 'src/api/e46-c8b.service.ts', 'CREATE', { targetDomain: 'BACKEND' })
        ],
        'Crée src/components/e46-c8b.tsx et src/api/e46-c8b.service.ts'
      );
      const resB = await executeWithOptions(sessionB);
      const supB = resB.supervision!;
      assert.equal(supB.decision, 'VALIDATED', 'aucune contamination de la contrainte du projet A');
      assert.equal(supB.findings.length, 0);
    });
  });
});
