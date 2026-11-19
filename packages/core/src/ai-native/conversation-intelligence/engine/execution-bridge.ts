/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Execution Bridge (AINT-007 / AINT-006 Delegation)
 *
 * É39 — connexion au MultiAgentScheduler (É37) : un plan comportant
 * PLUSIEURS étapes de mutation réellement exécutables est transformé en DAG
 * de MultiAgentTaskSpec et exécuté via executeBatch() — le MÊME registry et
 * le MÊME AgentExecutionService que le chemin mono-agent (aucun deuxième
 * runtime, aucune seconde source de vérité). Un plan à ≤1 étape de mutation
 * continue de passer par le routage historique (zéro régression).
 *
 * L'adaptateur ne fabrique RIEN :
 *   - taskId = `step-<stepIndex>` (dérivé du plan, stable et unique) ;
 *   - dépendances = `dependsOn` DÉCLARÉES uniquement (aucune implicite) ;
 *   - agents résolus par le Registry (source unique É34) ;
 *   - cibles = targetFiles réelles de l'étape (exactement un fichier/tâche) ;
 *   - tenant/projet/rôle = ceux de la session réelle.
 * Toute ambiguïté ou information manquante → refus explicite, jamais une
 * exécution approximative.
 */

import { ValidationError } from '../../../errors.js';
import type { Role } from '../../../identity/permissions.js';
import type { AgentRuntimeService } from '../../agent-runtime/service.js';
import type { MutationOrchestratorService } from '../../mutation-orchestrator/service.js';
import type { ConversationSession, ConversationState, EngineeringPlan, PlanStep } from '../types.js';
import {
  routeIntentToAgent,
  FILE_MUTATION_CAPABILITY,
  buildConversationContextBlock,
  type ConversationTaskContext
} from './intent-router.js';
import type { AgentRegistryService } from '../../ai-orchestrator/registry/agent-registry.js';
import type { AgentTask, TaskContextPayload, AgentCapability, AgentDomain } from '../../ai-orchestrator/types.js';
import { resolveDeclaredTargetDomain, detectDomainKeywords } from '../../ai-orchestrator/engine/task-decomposer.js';
import type { AgentExecutionOutcome } from '../../ai-orchestrator/execution/agent-execution.js';
import type {
  MultiAgentSchedulerOutcome,
  MultiAgentSchedulerRequest,
  MultiAgentTaskSpec
} from '../../ai-orchestrator/execution/multi-agent-scheduler.js';
import {
  superviseBatchExecution,
  supervisionMessageSuffixFor,
  type SupervisionReport
} from './supervisor.js';
import {
  composeExecutionReply,
  extractReplyFactsFromBatch,
  extractReplyFactsFromRouted,
  extractReplyFactsFromRefusal
} from './final-reply.js';

/** Opérations de plan qui MUTENT réellement des fichiers (exécutables par un agent). */
type MutationOperation = 'CREATE' | 'MODIFY' | 'DELETE';
const MUTATION_OPERATIONS: ReadonlySet<string> = new Set<MutationOperation>(['CREATE', 'MODIFY', 'DELETE']);

function isMutationStep(step: PlanStep): step is PlanStep & { readonly operation: MutationOperation } {
  return MUTATION_OPERATIONS.has(step.operation);
}

/**
 * ÉTAPE 33 — exécuteur d'agent (contrat É32) injectable. Type structurel
 * minimal : le serveur attache l'AgentExecutionService de l'orchestrateur
 * (source unique — aucun deuxième runtime ni registry).
 */
export interface ConversationAgentExecutor {
  /** ÉTAPE 34 — accès au Registry (source unique de résolution des agents). */
  getRegistry(): AgentRegistryService;
  execute(request: {
    executionId: string;
    agentId: string;
    task: AgentTask;
    context: TaskContextPayload;
    tenantId: string;
    projectId: string;
    userRole?: Role | undefined;
    requestId?: string | undefined;
    /**
     * É53 LOT E4.1 — CORRECTION B : signal de cancellation du tour
     * (optionnel, rétrocompatible). Transmis à AgentExecutionService
     * (points É35 BEFORE_AGENT / AGENT / BEFORE_MUTATION / AFTER_MUTATION).
     * Aucune nouvelle autorité d'annulation : le même signal observé.
     */
    signal?: AbortSignal | undefined;
  }): Promise<AgentExecutionOutcome>;
  /**
   * É39 — batch multi-agents OPTIONNEL (MultiAgentScheduler É37). Optionnel
   * pour rester compatible avec les exécuteurs existants qui n'exposent que
   * { execute, getRegistry } (tests É34, exécuteurs tiers) : un plan à ≥2
   * étapes de mutation adressé à un tel exécuteur est REFUSÉ explicitement
   * (EXECUTOR_BATCH_UNAVAILABLE), jamais réduit silencieusement à une seule
   * tâche. Le serveur le fournit depuis la MÊME instance orchestrator déjà
   * utilisée pour execute() — même registry, même moteur sécurisé.
   */
  executeBatch?(request: MultiAgentSchedulerRequest): Promise<MultiAgentSchedulerOutcome>;
}

export interface ExecutionResult {
  readonly success: boolean;
  readonly executedSteps: number;
  readonly message: string;
  readonly error?: string | undefined;
  /**
   * É46 — rapport de supervision du résultat GLOBAL (batch multi-agents) :
   * décision VALIDATED / NEEDS_CORRECTION / BLOCKED / PARTIAL avec preuves
   * réelles (exigences du plan, interdits É44, cohérence multi-agents) et
   * trace de correction ciblée éventuelle. Absent sur le chemin routé
   * historique (≤1 étape, contrat É32/É36).
   */
  readonly supervision?: SupervisionReport | undefined;
  /**
   * É47 — réponse conversationnelle finale, composée déterministe depuis les
   * FAITS VÉRIFIÉS (livrables réellement commis, exigences non satisfaites,
   * interdits, conflits, corrections réelles, limites de vérification).
   * Le message technique `message` reste inchangé (contrats gelés É39–É46) ;
   * `userReply` est la réponse présentée à l'utilisateur. Absent sur le chemin
   * Agent Runtime historique (contrat É29/É31 inchangé).
   */
  readonly userReply?: string | undefined;
}

// ===========================================================================
// É39 — Adaptateur plan conversationnel → DAG MultiAgentScheduler (É37)
// ===========================================================================

/** Analyse d'un plan : ≤1 mutation → 'legacy' ; ≥2 → 'batch' ; défauts → 'refuse'. */
export type PlanBatchAnalysis =
  | { readonly kind: 'legacy' }
  | { readonly kind: 'refuse'; readonly reason: string }
  | {
      readonly kind: 'batch';
      readonly executionId: string;
      /**
       * Agent désigné pour la PREMIÈRE étape de mutation (tri stepIndex) —
       * l'agent UNIQUE du DAG quand toutes les étapes partagent le même
       * agent (comportement É39), l'agent de la première étape sinon (É45 :
       * un agent est désigné PAR étape, voir specs[].agentId).
       */
      readonly agentId: string;
      readonly specs: readonly MultiAgentTaskSpec[];
      /** Étapes ANALYZE/VERIFY — jamais envoyées à un agent (notées au résultat). */
      readonly nonExecutableStepIndexes: readonly number[];
    };

/** Champs de session réellement lus par l'adaptateur (pureté explicite). */
export type PlanBatchAnalysisSession = Pick<
  ConversationSession,
  'sessionId' | 'tenantId' | 'projectId'
>;

/**
 * É44 — contexte conversationnel RÉEL de la session, prêt à être tracé dans
 * les tâches (batch ET routé). Lecture pure et explicite des champs de
 * session ; aucune transformation sémantique :
 *   - contraintes = mémoire de session BRUTE (préfixe É42 conservé) ;
 *   - décisions = statements des enregistrements au statut ACTIVE uniquement
 *     (SUPERSEDED / REJECTED / REVERTED = annulées, jamais transmises) ;
 *   - hypothèses = non rejetées, STATUT conservé (PROPOSED ≠ décision).
 */
export function buildConversationTaskContext(
  session: Pick<
    ConversationSession,
    'projectMemory' | 'activeDecisions' | 'activeAssumptions'
  >
): ConversationTaskContext {
  return {
    constraints: session.projectMemory.knownConstraints ?? [],
    decisions: session.activeDecisions
      .filter((d) => d.status === 'ACTIVE')
      .map((d) => d.statement),
    assumptions: session.activeAssumptions.filter((a) => a.status !== 'REJECTED')
  };
}

/**
 * É39 — analyse PURE d'un plan conversationnel. Mêmes entrées → même
 * analyse. Elle ne fabrique aucune dépendance, ne choisit aucun agent en
 * dur et n'éclate jamais une étape en plusieurs tâches :
 *
 *   ≤1 étape de mutation  → { kind:'legacy' }   (chemin historique inchangé)
 *   information manquante, dépendance inconnue/auto-référencée/non
 *   exécutable, étape multi-fichiers, 0 ou >1 agent FILE_MUTATION
 *                         → { kind:'refuse', reason }
 *   plan complet          → { kind:'batch', specs }  (DAG pour le scheduler)
 */
export function analyzePlanForBatch(params: {
  plan: EngineeringPlan;
  session: PlanBatchAnalysisSession;
  registry: AgentRegistryService;
  /**
   * É44 — contexte conversationnel de la session (OPTIONNEL, rétrocompatible
   * : absent → descriptions STRICTEMENT identiques à l'historique). Présent →
   * chaque tâche du DAG porte le bloc de contexte tracé dans sa description
   * (le scheduler É37 ne transmet aucun contexte conversationnel).
   */
  conversation?: ConversationTaskContext | undefined;
}): PlanBatchAnalysis {
  const { plan, session, registry, conversation } = params;
  const steps = plan.steps;
  const mutationSteps = steps.filter(isMutationStep);

  // ≤1 étape de mutation → routage mono-agent historique INCHANGÉ (les plans
  // rule-based ANALYZE / 1 mutation / VERIFY et tous les tests É33/É34 y
  // restent). Aucune transformation artificielle d'une demande mono-agent.
  if (mutationSteps.length <= 1) {
    return { kind: 'legacy' };
  }

  const refuse = (reason: string): PlanBatchAnalysis => ({ kind: 'refuse', reason });

  // 1. stepIndex dupliqué → taskId non unique, DAG non construisable.
  const seenIndexes = new Set<number>();
  for (const step of steps) {
    if (seenIndexes.has(step.stepIndex)) {
      return refuse(
        `PLAN_STEP_INDEX_DUPLICATE: deux étapes du plan '${plan.planId}' portent le stepIndex ${step.stepIndex} — taskId non unique, DAG refusé`
      );
    }
    seenIndexes.add(step.stepIndex);
  }

  // 2. Dépendances EXPLICITES uniquement (dependsOn, É39) — validées sur
  //    TOUTES les étapes : inconnue, auto-référencée ou visant une étape
  //    jamais exécutée par un agent (ANALYZE/VERIFY) = sémantique non
  //    tenable → refus (aucune dépendance implicite fabriquée).
  const stepsByIndex = new Map<number, PlanStep>();
  for (const step of steps) stepsByIndex.set(step.stepIndex, step);
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (dep === step.stepIndex) {
        return refuse(
          `PLAN_DEPENDENCY_SELF: l'étape ${step.stepIndex} du plan '${plan.planId}' dépend d'elle-même`
        );
      }
      const depStep = stepsByIndex.get(dep);
      if (!depStep) {
        return refuse(
          `PLAN_DEPENDENCY_UNKNOWN: l'étape ${step.stepIndex} du plan '${plan.planId}' dépend de l'étape ${dep} qui n'existe pas`
        );
      }
      if (!isMutationStep(depStep)) {
        return refuse(
          `PLAN_DEPENDENCY_NON_EXECUTABLE: l'étape ${step.stepIndex} du plan '${plan.planId}' dépend de l'étape ${dep} (${depStep.operation}) qui n'est jamais exécutée par un agent`
        );
      }
    }
  }

  // 3. Résolution d'agent PAR LE REGISTRY (source unique É34) : la mutation
  //    de fichier exige FILE_MUTATION ; 0 candidat → unsupported.
  //    É45 — la désambiguïsation n'est plus un refus global : elle est
  //    résolue PAR ÉTAPE en section 5 (spécialité déclarée).
  const candidates = registry.resolveByCapability(FILE_MUTATION_CAPABILITY);
  if (candidates.length === 0) {
    return refuse(
      `UNSUPPORTED_AGENT_CAPABILITY: aucun agent du registry ne possède la capability '${FILE_MUTATION_CAPABILITY}' requise par les ${mutationSteps.length} étapes de mutation du plan '${plan.planId}'`
    );
  }

  // 4. Chaque étape de mutation doit être injectable en tâche SANS éclatement
  //    artificiel : exactement UN fichier cible.
  for (const step of mutationSteps) {
    const files = step.targetFiles ?? [];
    if (files.length === 0) {
      return refuse(
        `PLAN_STEP_INCOMPLETE: l'étape ${step.stepIndex} (${step.operation}) du plan '${plan.planId}' ne déclare aucun fichier cible — aucune tâche honnête constructible`
      );
    }
    if (files.length > 1) {
      return refuse(
        `PLAN_STEP_AMBIGUOUS: l'étape ${step.stepIndex} (${step.operation}) du plan '${plan.planId}' cible ${files.length} fichiers [${files.join(', ')}] — pas d'éclatement artificiel en tâches`
      );
    }
  }

  // 4bis. É45 — DOUBLONS DE CIBLE : deux étapes de mutation ciblant le MÊME
  //    fichier avec la MÊME opération = le même travail deux fois (travail
  //    redondant et inutile ; le second CREATE échouerait systématiquement
  //    en précondition « il existe déjà » et dégraderait le verdict du batch
  //    entier par un échec auto-infligé). Une étape ne porte aucun contenu
  //    distinct : une seconde opération identique sur un même fichier ne
  //    peut jamais rien apporter → refus AVANT toute exécution,
  //    indépendamment des agents désignés et des dépendances déclarées.
  const seenOperations = new Map<string, number>();
  for (const step of [...mutationSteps].sort((a, b) => a.stepIndex - b.stepIndex)) {
    const targetFile = step.targetFiles![0]!;
    const key = `${step.operation}::${targetFile}`;
    const firstIndex = seenOperations.get(key);
    if (firstIndex !== undefined) {
      return refuse(
        `PLAN_STEP_DUPLICATE: les étapes ${firstIndex} et ${step.stepIndex} du plan '${plan.planId}' ciblent toutes deux '${targetFile}' avec la même opération ${step.operation} — travail redondant, DAG refusé avant toute exécution`
      );
    }
    seenOperations.set(key, step.stepIndex);
  }

  // 5. Désignation d'un agent PAR ÉTAPE (É45 — sélection par capability +
  //    spécialité DÉCLARÉE, sans jamais deviner) :
  //    - UN SEUL candidat FILE_MUTATION → il est désigné pour toutes les
  //      étapes (comportement É39 exactement préservé), SAUF si une étape
  //      déclare explicitement une spécialité que cet unique agent ne porte
  //      pas (l'intégrité de la déclaration du générateur prime) ;
  //    - ≥2 candidats → chaque étape doit relever d'une spécialité
  //      résolvable (targetDomain admissible, ou mots-clés du travail sur
  //      titre + cible — taxonomie partagée AINT-010/É45, SANS fallback) et
  //      cette spécialité doit désigner EXACTEMENT UN agent FILE_MUTATION ;
  //      toute étape sans spécialité résolvable → refus historique
  //      AMBIGUOUS_AGENT_ROUTE (candidats listés) inchangé.
  const sortedMutationSteps = [...mutationSteps].sort((a, b) => a.stepIndex - b.stepIndex);
  const assignments = new Map<number, { readonly agentId: string; readonly domain: AgentDomain }>();
  let firstAgentId: string | undefined;
  if (candidates.length === 1) {
    const sole = candidates[0]!;
    for (const step of sortedMutationSteps) {
      const declared = resolveDeclaredTargetDomain(step.targetDomain);
      if (declared && declared !== sole.domain) {
        return refuse(
          `SELECTION_DOMAIN_MISMATCH: l'étape ${step.stepIndex} du plan '${plan.planId}' déclare la spécialité '${declared}' mais l'unique agent '${FILE_MUTATION_CAPABILITY}' du registry est '${sole.id}' (domaine '${sole.domain}') — la spécialité déclarée ne peut pas être ignorée, DAG refusé`
        );
      }
      assignments.set(step.stepIndex, { agentId: sole.id, domain: sole.domain });
    }
    firstAgentId = sole.id;
  } else {
    for (const step of sortedMutationSteps) {
      const declared = resolveDeclaredTargetDomain(step.targetDomain);
      const domain = declared ?? detectDomainKeywords(`${step.title} ${step.targetFiles![0]!}`);
      if (!domain) {
        return refuse(
          `AMBIGUOUS_AGENT_ROUTE: ${candidates.length} agents compatibles '${FILE_MUTATION_CAPABILITY}' [${candidates.map((c) => c.id).join(', ')}] — aucun choix arbitraire pour un DAG de ${mutationSteps.length} mutations (l'étape ${step.stepIndex} ne déclare aucune spécialité résolvable)`
        );
      }
      const domainCandidates = candidates.filter((c) => c.domain === domain);
      if (domainCandidates.length === 0) {
        return refuse(
          `UNSUPPORTED_AGENT_CAPABILITY_DOMAIN: l'étape ${step.stepIndex} du plan '${plan.planId}' relève de la spécialité '${domain}' mais AUCUN agent de ce domaine ne possède '${FILE_MUTATION_CAPABILITY}' (candidats FILE_MUTATION : [${candidates.map((c) => c.id).join(', ')}])`
        );
      }
      if (domainCandidates.length > 1) {
        return refuse(
          `AMBIGUOUS_AGENT_ROUTE: ${domainCandidates.length} agents du domaine '${domain}' compatibles '${FILE_MUTATION_CAPABILITY}' [${domainCandidates.map((c) => c.id).join(', ')}] pour l'étape ${step.stepIndex} du plan '${plan.planId}' — aucun choix arbitraire`
        );
      }
      const selected = domainCandidates[0]!;
      assignments.set(step.stepIndex, { agentId: selected.id, domain: selected.domain });
      if (firstAgentId === undefined) firstAgentId = selected.id;
    }
  }

  // 6. Construction du DAG (déterministe : specs triées par stepIndex,
  //    order = stepIndex ; taskId = AgentTask.id = `step-<stepIndex>` ;
  //    dépendances = dependsOn déclarées uniquement, mappées en `step-N` ;
  //    É45 — agent désigné PAR ÉTAPE, domaine = celui de l'agent réellement
  //    désigné, capabilities requises = FILE_MUTATION ∪ celles DÉCLARÉES par
  //    l'étape (É40 honorié : un agent ne possédant pas tout → refus
  //    explicite CAPABILITY_UNSUPPORTED du scheduler, jamais une exécution
  //    approximative).
  const executionId = `agxb-${session.sessionId}-${plan.planId}`;
  const specs: MultiAgentTaskSpec[] = sortedMutationSteps
    .map((step) => {
      const taskId = `step-${step.stepIndex}`;
      const dependencies = (step.dependsOn ?? []).map((dep) => `step-${dep}`);
      const assigned = assignments.get(step.stepIndex)!;
      const requiredCapabilities = Array.from(
        new Set<string>([FILE_MUTATION_CAPABILITY, ...(step.requiredCapabilities ?? [])])
      ) as AgentCapability[];
      const task: AgentTask = {
        id: taskId,
        title: step.title,
        // É44 — description enrichie du bloc de contexte conversationnel
        // (bloc vide → description IDENTIQUE au comportement historique).
        description:
          (step.description.length > 0 ? step.description : step.title) +
          buildConversationContextBlock(conversation),
        domain: assigned.domain,
        priority: 1,
        dependencies,
        requiredContext: { targetFiles: [step.targetFiles![0]!] },
        requiredCapabilities,
        status: 'READY',
        operation: step.operation,
        retryCount: 0,
        maxRetries: 0
      };
      return { taskId, agentId: assigned.agentId, task, dependencies, order: step.stepIndex };
    });

  return {
    kind: 'batch',
    executionId,
    agentId: firstAgentId!,
    specs,
    nonExecutableStepIndexes: steps
      .filter((s) => !isMutationStep(s))
      .map((s) => s.stepIndex)
  };
}

/**
 * É39 — conversion du verdict RÉEL du scheduler en ExecutionResult.
 * COMPLETED seul = succès ; PARTIAL / FAILED / CANCELLED ne sont JAMAIS
 * présentés comme un succès complet (executedSteps = comptage réel des
 * tâches complétées, code SCHEDULER_* explicite, détails des tâches non
 * abouties). Les étapes ANALYZE/VERIFY (jamais envoyées à un agent) et les
 * tâches DEGRADED (complétées mais dégradées) sont signalées honnêtement.
 */
function mapBatchOutcomeToExecutionResult(
  outcome: MultiAgentSchedulerOutcome,
  analysis: Extract<PlanBatchAnalysis, { kind: 'batch' }>,
  supervision?: SupervisionReport | undefined,
  conversation?: ConversationTaskContext | undefined
): ExecutionResult {
  const { counts } = outcome;
  const degradedCount = outcome.tasks.filter((t) => t.outcome?.status === 'DEGRADED').length;
  const degradedNote = degradedCount > 0 ? `, dont ${degradedCount} complétée(s) avec contenu dégradé (DEGRADED)` : '';
  const nonExecutable = analysis.nonExecutableStepIndexes;
  // É45 — un DAG multi-spécialités désigne UN agent PAR étape : le message
  // liste les agents réellement désignés (agent unique quand le DAG est
  // uniforme — texte strictement identique à l'historique).
  const distinctAgents = Array.from(new Set(analysis.specs.map((spec) => spec.agentId)));
  const agentLabel =
    distinctAgents.length === 1 ? `agent: ${distinctAgents[0]}` : `agents: ${distinctAgents.join(', ')}`;
  const nonExecutableNote =
    nonExecutable.length > 0
      ? ` Étapes ${nonExecutable.join(', ')} (${nonExecutable.length}) jamais envoyées à un agent (ANALYZE/VERIFY restent du ressort du moteur conversationnel).`
      : '';
  const taskSummary = outcome.tasks
    .slice(0, 8)
    .map((t) => `${t.spec.taskId}=${t.status}`)
    .join(', ');

  const base: ExecutionResult =
    outcome.status === 'COMPLETED'
      ? {
          success: true,
          executedSteps: counts.completed,
          message:
            `Plan multi-agents exécuté via le MultiAgentScheduler (executionId: ${outcome.executionId}, ${agentLabel}) : ` +
            `${counts.completed}/${counts.total} tâche(s) complétée(s)${degradedNote} [${taskSummary}].${nonExecutableNote}`
        }
      : (() => {
          const failureDetails = outcome.tasks
            .filter((t) => t.status === 'FAILED' || t.status === 'CANCELLED')
            .slice(0, 5)
            .map((t) =>
              `${t.spec.taskId}=${t.status}${t.outcome?.error ? ` (${t.outcome.error})` : t.blockedReason ? ` (${t.blockedReason})` : ''}`
            )
            .join(' ; ');
          return {
            success: false,
            executedSteps: counts.completed,
            message:
              `Le batch multi-agents s'est terminé avec le statut ${outcome.status} (executionId: ${outcome.executionId}) : ` +
              `${counts.completed}/${counts.total} complétée(s), ${counts.failed} échec(s), ${counts.cancelled} annulée(s), ` +
              `${counts.blocked} bloquée(s), ${counts.pending} en attente${degradedNote} [${taskSummary}].` +
              `${failureDetails ? ` Détails : ${failureDetails}.` : ''}${nonExecutableNote}`,
            error: `SCHEDULER_${outcome.status}`
          };
        })();

  // É46 — la supervision raisonne sur le résultat GLOBAL : un batch brut
  // « COMPLETED » avec un livrable hors exigence, un interdit É44 enfreint ou
  // une invalidation croisée n'est JAMAIS annoncé comme une mission réussie ;
  // inversement, une correction ciblée réellement exécutée et re-vérifiée
  // (pipeline sécurisé É32→É36) peut produire un VALIDATED honnête avec trace.
  if (!supervision) {
    // É47 — réponse conversationnelle fidèle même sans rapport de supervision
    // (cas défensif) : livrables issus des outcomes réels, jamais des déclarations.
    const facts = extractReplyFactsFromBatch(outcome, undefined, conversation);
    const userReply = composeExecutionReply(facts);
    return { ...base, ...(userReply.length > 0 ? { userReply } : {}) };
  }
  const success = supervision.decision === 'VALIDATED';
  const facts = extractReplyFactsFromBatch(outcome, supervision, conversation);
  const userReply = composeExecutionReply(facts);
  return {
    success,
    executedSteps: supervision.counts.completed,
    message: base.message + supervisionMessageSuffixFor(supervision),
    ...(success ? {} : { error: base.error }),
    supervision,
    ...(userReply.length > 0 ? { userReply } : {})
  };
}

export class ExecutionBridge {
  private agentExecutor?: ConversationAgentExecutor | undefined;

  constructor(
    private readonly agentRuntime?: AgentRuntimeService | undefined,
    private readonly mutationService?: MutationOrchestratorService | undefined
  ) {}

  /**
   * ÉTAPE 33 — attache l'exécuteur d'agents (AgentExecutionService É32).
   * Une fois attaché, l'exécution d'un plan approuvé passe par le routage
   * déterministe intention → agent ; sans exécuteur, le chemin historique
   * (Agent Runtime, contrat É29/É31) est conservé à l'identique.
   */
  public setAgentExecutor(executor: ConversationAgentExecutor): void {
    this.agentExecutor = executor;
  }

  public canExecute(plan: EngineeringPlan, state: ConversationState): boolean {
    if (plan.status === 'REJECTED' || plan.status === 'FAILED') {
      return false;
    }
    const validStates: ConversationState[] = ['PLANNING', 'WAITING_CONFIRMATION', 'EXECUTING'];
    return validStates.includes(state);
  }

  public async executePlan(
    plan: EngineeringPlan,
    session: ConversationSession,
    userRole: Role = 'OWNER',
    requestId?: string | undefined,
    /**
     * É46 — options de supervision. `supervisionRepair` active la correction
     * ciblée BORNÉE (OPT-IN : absente = correction refusée, aucune
     * re-exécution). La supervision elle-même est toujours active sur le
     * chemin batch.
     */
    options?: { readonly supervisionRepair?: { readonly enabled: boolean; readonly maxAttempts?: number | undefined } } | undefined,
    /**
     * É53 LOT E4.1 — CORRECTION B : signal de cancellation du tour
     * (optionnel, rétrocompatible). Transmis à executeBatch (scheduler É37)
     * ET à l'execute routé mono-agent — chaque agent reçoit le MÊME signal ;
     * les travaux en attente ne démarrent pas, les résultats tardifs ne sont
     * ni intégrés ni appliqués.
     */
    signal?: AbortSignal | undefined
  ): Promise<ExecutionResult> {
    if (!this.canExecute(plan, session.currentState)) {
      throw new ValidationError(
        `Impossible d'exécuter le plan '${plan.planId}' dans l'état '${session.currentState}' (Statut plan: '${plan.status}')`
      );
    }

    if (this.agentExecutor) {
      // É39 — analyse du plan AVANT toute exécution : ≤1 étape de mutation →
      // routage mono-agent historique (inchangé, plus bas) ; ≥2 étapes
      // réellement exécutables → DAG MultiAgentTaskSpec exécuté par le
      // scheduler É37 via executeBatch() ; toute information manquante ou
      // ambiguë → refus explicite (aucune exécution approximative).
      // É44 — le contexte conversationnel RÉEL de la session (contraintes
      // actives, décisions actives, hypothèses avec statut) est construit UNE
      // fois et transmis aux deux chemins : batch (analyse) ET routé.
      const conversation = buildConversationTaskContext(session);
      const analysis = analyzePlanForBatch({
        plan,
        session: { sessionId: session.sessionId, tenantId: session.tenantId, projectId: session.projectId },
        registry: this.agentExecutor.getRegistry(),
        conversation
      });

      if (analysis.kind === 'refuse') {
        return {
          success: false,
          executedSteps: 0,
          message: `Plan '${plan.planId}' refusé avant toute exécution — ${analysis.reason}`,
          error: analysis.reason,
          userReply: composeExecutionReply(extractReplyFactsFromRefusal(analysis.reason, conversation))
        };
      }

      if (analysis.kind === 'batch') {
        if (!this.agentExecutor.executeBatch) {
          const reason =
            `EXECUTOR_BATCH_UNAVAILABLE: le plan '${plan.planId}' comporte ${analysis.specs.length} étapes de mutation ` +
            `(${analysis.specs.map((s) => s.taskId).join(', ')}) mais l'exécuteur attaché n'expose pas executeBatch() — ` +
            `le réduire à une seule tâche serait approximatif, exécution refusée`;
          return {
            success: false,
            executedSteps: 0,
            message: `Plan '${plan.planId}' refusé avant toute exécution — ${reason}`,
            error: reason,
            userReply: composeExecutionReply(extractReplyFactsFromRefusal(reason, conversation))
          };
        }

        let outcome: MultiAgentSchedulerOutcome;
        try {
          outcome = await this.agentExecutor.executeBatch({
            executionId: analysis.executionId,
            tenantId: session.tenantId,
            projectId: session.projectId,
            tasks: analysis.specs,
            userRole,
            requestId,
            // É53 LOT E4.1 — CORRECTION B : le scheduler É37 reçoit le signal
            // du tour (chaque agent de chaque vague ; vagues suivantes
            // stoppées ; pending → BLOCKED honnête).
            ...(signal !== undefined ? { signal } : {})
          });
        } catch (err: unknown) {
          // ValidationError du scheduler (DAG_INVALID / AGENT_UNKNOWN /
          // CAPABILITY_UNSUPPORTED / …) = validation PRÉ-exécution → aucune
          // écriture effectuée ; refus explicite, jamais un succès.
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            executedSteps: 0,
            message: `Batch multi-agents refusé avant toute exécution (executionId: ${analysis.executionId}) — ${msg}`,
            error: msg,
            userReply: composeExecutionReply(extractReplyFactsFromRefusal(msg, conversation))
          };
        }
        // É46 — supervision du résultat GLOBAL AVANT toute annonce : les
        // livrables réels sont confrontés aux exigences du plan (cibles
        // déclarées), aux interdits É44 et à la cohérence multi-agents ;
        // correction ciblée bornée UNIQUEMENT si autorisée (OPT-IN), toujours
        // via le pipeline sécurisé existant (executor.execute = AgentExecutionService).
        const supervision = await superviseBatchExecution({
          planId: plan.planId,
          outcome,
          conversation,
          tenantId: session.tenantId,
          projectId: session.projectId,
          ...(userRole !== undefined ? { userRole } : {}),
          ...(requestId !== undefined ? { requestId } : {}),
          // É53 LOT E4.2 — CORRECTION F2 (audit G2) : la supervision É46 reçoit
          // le MÊME signal que le batch (aucune nouvelle autorité) : annulation
          // gagnante → aucune tentative de correction ciblée, aucune
          // reclassification d'un résultat annulé, rapport final honnête.
          ...(signal !== undefined ? { signal } : {}),
          ...(options?.supervisionRepair !== undefined ? { repair: options.supervisionRepair } : {}),
          repairExecutor: (request) => this.agentExecutor!.execute({
            ...request,
            // É53 LOT E4.1 — CORRECTION B : la supervision/repair reçoit aussi
            // le signal (un abandon n'ouvre jamais une réparation nouvelle).
            ...(signal !== undefined ? { signal } : {})
          })
        });
        return mapBatchOutcomeToExecutionResult(outcome, analysis, supervision, conversation);
      }

      // ÉTAPE 33 — chemin ROUTÉ : intention → agentId → AgentExecutionService
      // (contrat É32 honnête). Utilisé UNIQUEMENT quand un exécuteur est
      // attaché (serveur / tests dédiés) ET que le plan a ≤1 étape de
      // mutation (É39) ; sinon chemin Agent Runtime ci-dessous.
      // É48 — RÉANCRAGE SUR LE TOUR D'ORIGINE DU PLAN : le routage lit
      // l'intention et le message du tour qui a PORTÉ ce plan
      // (turn.plan.planId === plan.planId), pas ceux du DERNIER tour. Traces
      // É48 (sonde production) : une précision classée TEST (S1) ou un rappel
      // d'interdiction classé EXPLORATION (S4) après la planification rendait
      // un plan CREATE approuvé INEXÉCUTABLE (refus UNSUPPORTED_INTENT alors
      // que rien n'a été retiré à la demande). Repli : comportement
      // historique (dernier tour) si aucun tour d'origine n'est retrouvé ;
      // et la cible déclarée par le PLAN approuvé n'est utilisée QUE si le
      // message d'origine n'en nomme aucune (jamais de substitution à un
      // fichier nommé, jamais de cible inventée — le plan ne porte que des
      // fichiers extraits de son propre goal).
      const lastTurn = session.turns[session.turns.length - 1];
      const originTurn = session.turns.find((t) => t.plan?.planId === plan.planId);
      const mutationStepsOfPlan = plan.steps.filter(isMutationStep);
      const mutationTargets = [
        ...new Set(mutationStepsOfPlan.flatMap((s) => s.targetFiles ?? []))
      ];
      const soleMutationStep =
        mutationStepsOfPlan.length === 1 && mutationTargets.length === 1
          ? mutationStepsOfPlan[0]
          : undefined;
      const route = routeIntentToAgent({
        intent: originTurn?.intent ?? session.activeIntent,
        userMessage: originTurn?.userMessage.content ?? lastTurn?.userMessage.content ?? '',
        fallbackTargetFile: mutationTargets.length === 1 ? mutationTargets[0] : undefined,
        planMutationStep: soleMutationStep
          ? {
              title: soleMutationStep.title,
              targetFile: mutationTargets[0]!,
              ...(soleMutationStep.targetDomain !== undefined
                ? { targetDomain: soleMutationStep.targetDomain }
                : {})
            }
          : undefined,
        sessionId: session.sessionId,
        planId: plan.planId,
        registry: this.agentExecutor.getRegistry(),
        conversation
      });

      if (!route.supported) {
        const reason = route.reason ?? 'UNSUPPORTED_INTENT';
        return {
          success: false,
          executedSteps: 0,
          message: reason,
          error: `${reason}: intention non routable vers un agent`,
          userReply: composeExecutionReply(extractReplyFactsFromRefusal(reason, conversation))
        };
      }

      try {
        const outcome = await this.agentExecutor.execute({
          executionId: route.executionId,
          agentId: route.agentId!,
          task: route.task!,
          context: route.context!,
          tenantId: session.tenantId,
          projectId: session.projectId,
          userRole,
          requestId,
          // É53 LOT E4.1 — CORRECTION B : le MÊME signal atteint l'agent
          // routé (points É35 ; résultat tardif jamais appliqué).
          ...(signal !== undefined ? { signal } : {})
        });

        if (outcome.status === 'SUCCESS' || outcome.status === 'DEGRADED') {
          // Le contrat É32 garantit : mutation réellement COMMITTED (ou tâche
          // sans mutation), artifacts réels. Le statut DEGRADED reste marqué.
          return {
            success: true,
            executedSteps: 1,
            message:
              `Plan exécuté via l'agent '${outcome.agentId}' (executionId: ${outcome.executionId}, ` +
              `mutation: ${outcome.mutation.executed ? `COMMITTED tx=${outcome.mutation.transactionId ?? 'n/a'} applied=${outcome.mutation.appliedCount}` : 'non requise'}` +
              `${outcome.status === 'DEGRADED' ? ', contenu dégradé' : ''}).`,
            userReply: composeExecutionReply(extractReplyFactsFromRouted(outcome, conversation))
          };
        }
        return {
          success: false,
          executedSteps: 0,
          message: `L'agent '${outcome.agentId}' a échoué (executionId: ${outcome.executionId}).`,
          error: outcome.error ?? `AGENT_EXECUTION_${outcome.status}`,
          userReply: composeExecutionReply(extractReplyFactsFromRouted(outcome, conversation))
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          executedSteps: 0,
          message: `Échec de l'exécution de l'agent (executionId: ${route.executionId}).`,
          error: msg,
          // É47 — honnêteté stricte : une exception en cours d'exécution ne
          // permet NI d'annoncer un résultat NI d'affirmer qu'aucun fichier
          // n'a été écrit ; la réponse dit exactement cette incertitude.
          userReply:
            `L'exécution a échoué avant d'avoir pu être menée à terme (raison : ${msg}). ` +
            `Je ne peux confirmer l'état d'aucun fichier demandé — dites-moi si vous voulez que je retente.`
        };
      }
    }

    if (this.agentRuntime) {
      // P2 — EXÉCUTION RÉELLE (fin de la délégation simulée) : le plan est
      // exécuté par le runtime (autoExecutePlan), et le résultat rapporté
      // EST celui du run — plus jamais un succès déclaratif. Un run non
      // COMPLETED = success:false avec la raison du run.
      try {
        const run = await this.agentRuntime.startRun({
          tenantId: session.tenantId,
          projectId: session.projectId,
          userInput: plan.summary,
          userRole,
          requestId,
          autoExecutePlan: true
        });
        const runState = run.state;
        const executed = run.plan?.steps.length ?? 0;

        // É29/PROBLÈME B — le statut du run ne vaut succès du plan que si les
        // opérations sur fichiers demandées par le plan ont RÉELLEMENT été
        // exécutées. Un run « COMPLETED » qui n'a exécuté aucune mutation
        // alors que le plan demande des créations/modifications/suppressions
        // de fichiers est un faux succès (le runtime a replanifié son propre
        // plan template, sans les écritures demandées) → échec explicite.
        const planRequiresFileOps = plan.steps.some(
          (s) => s.operation !== 'ANALYZE' && Array.isArray(s.targetFiles) && s.targetFiles.length > 0
        );
        const mutationExecuted = (run.plan?.steps ?? []).some(
          (st) => st.tool === 'execute_mutation' && st.status === 'COMPLETED'
        );

        if (runState === 'COMPLETED') {
          if (planRequiresFileOps && !mutationExecuted) {
            const requestedOps = plan.steps.filter(
              (s) => s.operation !== 'ANALYZE' && Array.isArray(s.targetFiles) && s.targetFiles.length > 0
            ).length;
            return {
              success: false,
              executedSteps: executed,
              message: `MUTATION_UNSUPPORTED: le run '${run.id}' s'est terminé sans exécuter la moindre mutation de fichier alors que le plan '${plan.planId}' en demande ${requestedOps} — aucune écriture effectuée.`,
              error: 'MUTATION_UNSUPPORTED: opérations sur fichiers demandées par le plan non exécutées (aucune mutation exécutée par le run)'
            };
          }
          return {
            success: true,
            executedSteps: executed,
            message: `Plan exécuté par l'Agent Runtime (${executed} étape(s), Run ID: ${run.id}).`
          };
        }
        return {
          success: false,
          executedSteps: executed,
          message: `Le run de l'Agent Runtime s'est arrêté à l'état ${runState}.`,
          error: run.error
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          executedSteps: 0,
          message: `Échec de l'exécution du plan via Agent Runtime.`,
          error: msg
        };
      }
    }

    // É29/PROBLÈME B — plus de succès déclaratif : sans Agent Runtime, rien
    // n'a été exécuté → échec explicite (unsupported).
    return {
      success: false,
      executedSteps: 0,
      message: `MUTATION_UNSUPPORTED: Agent Runtime non configuré — le plan '${plan.planId}' n'a pas été exécuté.`,
      error: 'MUTATION_UNSUPPORTED: Agent Runtime non configuré'
    };
  }
}