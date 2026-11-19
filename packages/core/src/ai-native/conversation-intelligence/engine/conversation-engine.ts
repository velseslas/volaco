/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Central Conversation Engine - Control Plane & Turn Orchestrator
 */

import { computeConversationStateHash, computeTraceId, deepFreeze } from './canonical.js';
import { ConversationAssumptionEngine } from './assumption-engine.js';
import { ClarificationEngine } from './clarification-engine.js';
import { ContradictionDetector } from './contradiction-detector.js';
import { ConversationCompass } from './conversation-compass.js';
import { ConversationContextBuilder } from './context-builder.js';
import { ExecutionBridge } from './execution-bridge.js';
import { ImpactBridge } from './impact-bridge.js';
import { ConversationIntentEngine, NEGATION_IMPERATIVE_PATTERN } from './intent-engine.js';
import { MemoryManager, extractUserPreference } from './memory-manager.js';
import { PlanGenerator } from './plan-generator.js';
import { buildReferenceAssumption, detectConversationReference, resolveConversationReferents } from './reference-resolver.js';
import { extractSourceFiles } from './intent-router.js';
import { validatePlanStructure } from './plan-validation.js';
import { UnderstandingBridge } from './understanding-bridge.js';
import { logger } from '../../../logger.js';
import type { Role } from '../../../identity/permissions.js';
import type {
  ClarificationItem,
  ConversationAssumption,
  ConversationSession,
  ConversationTrace,
  ConversationTurn,
  EngineeringPlan,
  HumanAiMessage,
  IntentResult,
  PlanAssessment,
  PreparedImpact,
  PreparedTurn,
  ReasoningProvider
} from '../types.js';

/**
 * É43 — tronque un texte pour l'insertion dans un libellé de dialogue.
 */
function truncateForDialogue(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

/**
 * É43 — hypothèse de REPRISE après clarification (axe 2) : la réponse de
 * l'utilisateur à une clarification bloquante est intégrée à l'objectif en
 * cours. La réponse n'est JAMAIS transformée en ordre d'exécution ni en
 * décision : l'intégration reste une hypothèse TRACÉE, réversible et non
 * confirmée (même contrat que l'hypothèse de référence É41).
 */
function buildClarificationResumeAssumption(answer: string, previousGoal: string): ConversationAssumption {
  return deepFreeze({
    id: 'assump_clarification_resume',
    statement: `La réponse « ${truncateForDialogue(answer, 80)} » précise l'objectif « ${truncateForDialogue(previousGoal, 80)} » — hypothèse de reprise après clarification, réversible et non confirmée.`,
    confidence: 0.6,
    evidence: "La session était en CLARIFYING et le message ne contient aucune instruction d'action : traité comme la réponse à la clarification posée au tour précédent.",
    risk: 'LOW' as const,
    reversible: true,
    requiresConfirmation: false,
    status: 'PROPOSED' as const
  });
}

export class ConversationEngine {
  // ÉTAPE 30 — source unique du contexte conversationnel transmis au provider.
  // Instance sans état (fonction pure) : aucune mémoire globale.
  private readonly contextBuilder = new ConversationContextBuilder();

  constructor(
    private readonly intentEngine: ConversationIntentEngine,
    private readonly clarificationEngine: ClarificationEngine,
    private readonly assumptionEngine: ConversationAssumptionEngine,
    private readonly compass: ConversationCompass,
    private readonly planGenerator: PlanGenerator,
    private readonly contradictionDetector: ContradictionDetector,
    private readonly memoryManager: MemoryManager,
    private readonly understandingBridge: UnderstandingBridge,
    private readonly impactBridge: ImpactBridge,
    private readonly executionBridge: ExecutionBridge
  ) {}

  /**
   * Phase de préparation pure d'un tour : compréhension, hypothèses,
   * contradictions, plan, impact, état suivant et contexte borné.
   *
   * Aucun appel provider, aucune écriture de session, aucun audit.
   * `processTurn` l'utilise puis ajoute la génération et la persistance ;
   * le flux SSE peut l'utiliser pour piloter sa génération sans dupliquer
   * la logique du moteur conversationnel.
   */
  public async prepareTurn(params: {
    session: ConversationSession;
    userMessageText: string;
    intent?: IntentResult | undefined;
    targetFiles?: readonly string[] | undefined;
    autoConfirmLowRisk?: boolean | undefined;
    userRole?: Role | undefined;
    requestId?: string | undefined;
  }): Promise<PreparedTurn> {
    const {
      session,
      userMessageText,
      autoConfirmLowRisk = true,
      userRole = 'OWNER',
      requestId
    } = params;

    const cleanUserText = userMessageText.trim();

    const latestModel = this.understandingBridge.fetchUnderstanding(
      session.tenantId,
      session.projectId,
      userRole,
      requestId
    );
    const latestSnapshot = this.understandingBridge.computeSnapshot(latestModel);
    const isStale = this.understandingBridge.isContextStale(session.applicationSnapshot, latestSnapshot);

    // É42 — signaux de REMPLACEMENT de demande : réutilisés par la purge du
    // plan actif plus bas et par l'exclusion de la reprise après clarification.
    const DEMAND_REPLACEMENT_PATTERN = /\b(?:en fait|plut[ôo]t|au lieu|annule|oublie|abandonne)\b/i;

    let intent: IntentResult = params.intent
      ?? await this.intentEngine.classifyIntent(cleanUserText, latestModel, session.tenantId, session.projectId);

    // É43 — REPRISE après clarification (axe 2). Quand une clarification
    // bloquante a été POSÉE (état CLARIFYING) et que le message suivant est
    // une RÉPONSE — aucun verbe d'action (classification EXPLORATION à
    // confiance de repli), pas une question, pas une interdiction (É42),
    // pas un remplacement de demande (É42), pas une contrainte explicite,
    // pas un désaccord ni une décision de continuité (« garde … ») — la
    // réponse est INTÉGRÉE : l'objectif du tour précédent est repris,
    // enrichi de la réponse, et re-classifié. La réponse n'est JAMAIS
    // transformée en ordre d'exécution ni en décision : une hypothèse de
    // reprise est tracée (réversible, non confirmée).
    let clarificationResume: { answer: string; previousGoal: string } | undefined;
    if (
      session.currentState === 'CLARIFYING' &&
      session.turns.length > 0 &&
      intent.category === 'EXPLORATION' &&
      intent.confidence <= 0.5 &&
      !/\?\s*$/.test(cleanUserText) &&
      !NEGATION_IMPERATIVE_PATTERN.test(cleanUserText) &&
      !DEMAND_REPLACEMENT_PATTERN.test(cleanUserText) &&
      !/uniquement|obligatoire|strictement/i.test(cleanUserText) &&
      !/^(?:non|si)\b/i.test(cleanUserText) &&
      !/garde|garder|conserve|conserv/i.test(cleanUserText)
    ) {
      const previousGoal = session.turns[session.turns.length - 1]!.userMessage.content;
      const combined = `${previousGoal} ${cleanUserText}`.trim();
      const resumed = await this.intentEngine.classifyIntent(combined, latestModel, session.tenantId, session.projectId);
      // Les contraintes du message RÉEL restent extraites (contrat É42) —
      // union sans doublon avec celles du message combiné.
      const mergedConstraints = [...resumed.constraints];
      for (const constraint of intent.constraints) {
        if (!mergedConstraints.includes(constraint)) mergedConstraints.push(constraint);
      }
      intent = deepFreeze({ ...resumed, constraints: mergedConstraints });
      clarificationResume = { answer: cleanUserText, previousGoal };
    }

    // É41 — résolution des références conversationnelles (« modifie-le »,
    // « ajoute aussi une carte dans cette page », « le même fichier »).
    // Uniquement sur le chemin conversationnel RÉEL : l'appelant ne fournit
    // NI intention pré-classifiée NI cibles explicites (le flux Studio
    // épinglé est intouché), le message ne nomme AUCUN fichier, un motif de
    // référence est détecté ET la session contient des référents concrets.
    // Sinon : incomplétude honnête inchangée — aucun référent n'est inventé.
    let workingIntent: IntentResult = intent;
    let referenceAssumption: ConversationAssumption | undefined;
    if (!params.intent && !params.targetFiles && extractSourceFiles(cleanUserText).length === 0) {
      if (detectConversationReference(cleanUserText)) {
        const referents = resolveConversationReferents(cleanUserText, session);
        if (referents.length > 0) {
          workingIntent = deepFreeze({ ...intent, entities: [...intent.entities, ...referents] });
          referenceAssumption = buildReferenceAssumption(cleanUserText, referents);
        }
      }
    }

    const contradictions = this.contradictionDetector.detectContradictions({
      newIntent: workingIntent,
      projectMemory: session.projectMemory,
      activeDecisions: session.activeDecisions
    });

    const derivedAssumptions = this.assumptionEngine.synthesizeAssumptions({
      intent: workingIntent,
      projectMemory: session.projectMemory,
      semanticModel: latestModel
    });
    // É41 — l'hypothèse de référence (anaphore résolue) est TRACÉE en tête
    // de liste : la résolution est une hypothèse documentée, jamais invisible.
    // É43 — l'hypothèse de REPRISE (réponse à clarification intégrée) est
    // TRACÉE en tête de liste : la réponse est entendue, jamais transformée
    // en décision silencieuse.
    const resumeAssumption = clarificationResume
      ? buildClarificationResumeAssumption(clarificationResume.answer, clarificationResume.previousGoal)
      : undefined;
    const assumptionHeads = [referenceAssumption, resumeAssumption].filter(
      (a): a is ConversationAssumption => Boolean(a)
    );
    const assumptions: readonly ConversationAssumption[] =
      assumptionHeads.length > 0 ? [...assumptionHeads, ...derivedAssumptions] : derivedAssumptions;

    let clarifications = this.clarificationEngine.assessClarifications({
      intent,
      assumptions,
      contradictions
    });

    // É43 — si la reprise reste vague (aucune cible extractable), la
    // clarification est REFORMULÉE : la réponse déjà donnée est reconnue et
    // la question porte désormais sur la cible concrète (fichier ou page) —
    // jamais la même question reposée comme si la réponse n'avait pas été
    // entendue (axe 2 : tenir compte des réponses déjà données).
    if (clarificationResume) {
      const stillVague = clarifications.find((c) => c.id === 'clarif_missing_entity');
      if (stillVague) {
        const reformulatedQuestion = `Je note ta réponse (${truncateForDialogue(clarificationResume.answer, 90)}). Pour créer cela, où veux-tu l'intégrer — dans quel fichier ou quelle page ?`;
        clarifications = clarifications.map((c) =>
          c.id === 'clarif_missing_entity'
            ? {
                ...c,
                question: reformulatedQuestion,
                reason: 'Réponse à la clarification enregistrée ; la cible concrète (fichier ou page) manque encore.'
              }
            : c
        );
      }
    }

    // É42 — prévention de la réutilisation accidentelle d'un ancien plan.
    // Un message qui remplace/abandonne la demande en cours (« en fait »,
    // « plutôt », « au lieu », « annule », « oublie », « abandonne ») rend le
    // plan actif OBSOLÈTE : il n'est plus porté par ce tour, ni réutilisé,
    // ni confirmable (activePlan est purgé à l'écriture du tour). Les tours
    // d'information neutres (question, clarification, contrainte, « garde la
    // première version ») CONSERVENT le plan actif — la continuité est
    // préservée, seule la demande remplacée invalide le plan.
    const demandReplaced =
      DEMAND_REPLACEMENT_PATTERN.test(cleanUserText) && extractSourceFiles(cleanUserText).length === 0;
    let plan: EngineeringPlan | undefined = demandReplaced ? undefined : session.activePlan;
    let planAssessment: PlanAssessment | undefined;

    const needsNewPlan =
      !plan ||
      intent.category === 'CREATE' ||
      intent.category === 'MODIFY' ||
      intent.category === 'DELETE' ||
      intent.category === 'REFACTOR' ||
      intent.category === 'DEBUG';

    if (needsNewPlan && workingIntent.category !== 'QUESTION' && workingIntent.category !== 'EXPLAIN' && workingIntent.category !== 'EXPLORATION') {
      plan = this.planGenerator.generatePlan({
        intent: workingIntent,
        assumptions,
        semanticModel: latestModel,
        defaultTargetFiles: params.targetFiles
      });
      planAssessment = this.planGenerator.assessPlan(plan, latestModel);
    }

    let impact: PreparedImpact | undefined;
    if (plan) {
      const rawImpact = this.impactBridge.assessPlanImpact(
        plan,
        session.tenantId,
        session.projectId,
        userRole,
        requestId
      );
      impact = {
        riskLevel: rawImpact.riskLevel,
        affectedFiles: rawImpact.affectedFiles,
        requiresConfirmation: rawImpact.requiresConfirmation,
        blastRadiusSummary: rawImpact.blastRadiusSummary
      };
      if (rawImpact.requiresConfirmation) {
        plan = deepFreeze({
          ...plan,
          estimatedImpact: rawImpact.blastRadiusSummary
        });
      }
    }

    const nextState = this.compass.determineNextState({
      currentState: session.currentState,
      intent: workingIntent,
      ambiguities: clarifications,
      assumptions,
      hasPlan: Boolean(plan),
      planAssessment,
      autoConfirmLowRisk
    });

    // ÉTAPE 30 — le contexte conversationnel borné (historique pertinent +
    // mémoire projet + décisions + contraintes) est construit UNE fois ici,
    // à l'unique point d'appel du provider, et transmis tel quel. Le pool
    // d'historique est l'historique COMPLET de la session (session.turns —
    // store existant) ; la sélection bornée est le travail du builder.
    const fullHistory: HumanAiMessage[] = session.turns.flatMap((t) => [t.userMessage, t.agentResponse]);
    const context = this.contextBuilder.build({
      userMessage: cleanUserText,
      history: fullHistory,
      projectMemory: session.projectMemory,
      turnMemory: session.turnMemory
    });

    return {
      cleanUserText,
      latestModel,
      latestSnapshot,
      isStale,
      intent: workingIntent,
      contradictions,
      assumptions,
      clarifications,
      plan,
      planAssessment,
      impact,
      nextState,
      context,
      projectMemory: session.projectMemory
    };
  }

  public async processTurn(params: {
    session: ConversationSession;
    userMessageText: string;
    reasoningProvider?: ReasoningProvider | undefined;
    autoConfirmLowRisk?: boolean | undefined;
    userRole?: Role | undefined;
    requestId?: string | undefined;
  }): Promise<{ updatedSession: ConversationSession; turn: ConversationTurn }> {
    const startTime = Date.now();
    const { session, userMessageText, reasoningProvider, autoConfirmLowRisk = true, userRole = 'OWNER', requestId } = params;

    const prepared = await this.prepareTurn({
      session,
      userMessageText,
      autoConfirmLowRisk,
      userRole,
      requestId
    });

    const {
      cleanUserText,
      latestModel,
      latestSnapshot,
      isStale,
      intent,
      contradictions,
      assumptions,
      clarifications,
      context: conversationContext
    } = prepared;

    let plan = prepared.plan;
    let planAssessment = prepared.planAssessment;
    let nextState = prepared.nextState;

    const turnIndex = session.turns.length + 1;
    const turnId = `turn-${session.sessionId}-${turnIndex}`;

    const userMessage: HumanAiMessage = deepFreeze({
      id: `msg-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sender: 'HUMAN',
      content: cleanUserText,
      timestamp: new Date().toISOString()
    });

    let replyText = '';
    let confidence = intent.confidence;

    let providerMetadata: Record<string, unknown> | undefined;
    // PHASE 5/6 - nextAction du LLM pour surcharger le Compass
    let llmNextAction: import('../types.js').NextActionKind | undefined;

    if (reasoningProvider) {
      try {
        const timeoutMs = 60000;
        let timeoutTimer: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => reject(new Error(`ReasoningProvider timeout (${timeoutMs}ms)`)), timeoutMs);
        });

        const providerRes = await Promise.race([
          reasoningProvider.reason({
            userMessage: cleanUserText,
            history: session.turnMemory.recentMessages,
            intent,
            applicationModel: latestModel,
            memory: {
              project: session.projectMemory,
              turn: session.turnMemory
            },
            context: conversationContext
          }),
          timeoutPromise
        ]).finally(() => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
        });

        if (providerRes && typeof providerRes.reply === 'string' && providerRes.reply.trim().length > 0) {
          replyText = providerRes.reply;
        } else {
          replyText = `Instruction analysée : ${intent.goal}.`;
        }

        if (providerRes && typeof providerRes.confidence === 'number' && Number.isFinite(providerRes.confidence)) {
          confidence = Math.min(1, Math.max(0, providerRes.confidence));
        }

        if (providerRes?.metadata) {
          providerMetadata = providerRes.metadata as Record<string, unknown>;
        }

        // PHASE 5 - Surcharger le Compass avec le nextAction du LLM
        if (providerRes.nextAction) {
          llmNextAction = providerRes.nextAction;
          nextState = this.compass.determineNextStateFromAction(session.currentState, providerRes.nextAction);
        }

        // É43 — la DÉCISION de clarification prime sur l'action d'exécution
        // du provider. Quand le compass a calculé une clarification BLOCKING
        // ou NEEDS_CONFIRMATION, un provider qui répond PRESENT_PLAN ou
        // EXECUTE_PLAN ne doit PAS écraser l'état de clarification ni
        // remplacer la question par une annonce de plan (jamais présenter un
        // plan quand une précision est requise, jamais inventer l'information
        // manquante). Le provider reste libre pour ASK_QUESTION,
        // REQUEST_UNDERSTANDING, REQUEST_CONFIRMATION et RESPOND_DIRECTLY
        // (une réponse honnête du provider est bienvenue).
        const blockingClarifications = clarifications.filter(
          (c) => c.level === 'BLOCKING' || c.level === 'NEEDS_CONFIRMATION'
        );
        if (
          blockingClarifications.length > 0 &&
          (llmNextAction === 'PRESENT_PLAN' || llmNextAction === 'EXECUTE_PLAN')
        ) {
          nextState = prepared.nextState;
          replyText = `Pour progresser en toute sécurité, une clarification est requise : ${blockingClarifications[0]!.question}`;
        }

        // PHASE 6 - Utiliser le plan genere par le LLM a la place du plan rule-based.
        // É40 — UNIQUEMENT s'il passe la validation structurelle partagée
        // (mêmes codes que l'adaptateur multi-agents É39) : un plan LLM incomplet
        // (mutation sans cible), ambigu (multi-fichiers) ou portant une
        // dépendance invalide est REFUSÉ explicitement — le plan rule-based est
        // conservé et les codes de refus sont tracés dans les metadata.
        if (providerRes.plan && providerRes.plan.steps && providerRes.plan.steps.length > 0) {
          const planStructure = validatePlanStructure(providerRes.plan.steps);
          if (planStructure.valid) {
            plan = providerRes.plan;
            planAssessment = undefined;
            providerMetadata = { ...providerMetadata, planSource: 'llm', planSteps: providerRes.plan.steps.length };
          } else {
            const rejectedCodes = planStructure.issues.map((issue) => issue.code);
            providerMetadata = {
              ...providerMetadata,
              planSource: 'rule-based',
              llmPlanRejected: rejectedCodes
            };
            logger.warn('ConversationEngine - plan du provider refusé (structure invalide), plan rule-based conservé', {
              component: 'conversation-engine',
              issues: planStructure.issues.map((issue) => `${issue.code}: ${issue.message}`)
            });
          }
        }
      } catch (err: unknown) {
        const rawErrMsg = err instanceof Error ? err.message : String(err);
        const safeReason = rawErrMsg.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***').replace(/key=[a-zA-Z0-9_-]+/gi, 'key=***');
        replyText = `Instruction prise en compte pour ${intent.requestedAction}. (Repli résilient: ${safeReason})`;
        providerMetadata = { fallbackUsed: true, error: safeReason };
      }
    } else {
      if (clarifications.length > 0 && clarifications.some((c: ClarificationItem) => c.level === 'BLOCKING' || c.level === 'NEEDS_CONFIRMATION')) {
        const topClarification = clarifications[0]!;
        replyText = `Pour progresser en toute sécurité, une clarification est requise : ${topClarification.question}`;
      } else if (contradictions.length > 0) {
        replyText = `Attention, un conflit a été détecté : ${contradictions[0]!.explanation}`;
      } else if (plan && nextState === 'WAITING_CONFIRMATION') {
        replyText = `Un plan d'ingénierie a été préparé (${plan.title}). Veuillez confirmer l'exécution : ${plan.summary}`;
      } else if (plan && nextState === 'PLANNING') {
        replyText = `Plan d'ingénierie établi : ${plan.title} (${plan.steps.length} étapes).`;
      } else if (intent.category === 'QUESTION' || intent.category === 'EXPLAIN') {
        replyText = `Réponse à votre question concernant ${intent.entities.join(', ') || intent.goal}.`;
      } else {
        replyText = `Instruction prise en compte pour ${intent.requestedAction}.`;
      }
    }

    if (isStale) {
      replyText += " (Note: Le contexte de l'application a évolué et a été synchronisé).";
    }

    const agentResponse: HumanAiMessage = deepFreeze({
      id: `msg-agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sender: 'AGENT',
      content: replyText,
      timestamp: new Date().toISOString()
    });

    const traceEvents: string[] = [
      `Intent: ${intent.category}`,
      `Confidence: ${confidence}`,
      `Clarifications: ${clarifications.length}`,
      `Assumptions: ${assumptions.length}`,
      `Contradictions: ${contradictions.length}`
    ];
    // PHASE 5.5 - thinking_steps pour affichage progressif
    if (providerMetadata && Array.isArray(providerMetadata['thinkingSteps'])) {
      for (const step of providerMetadata['thinkingSteps'] as readonly unknown[]) {
        if (typeof step === 'string' && step.trim().length > 0) {
          traceEvents.push(`Thinking: ${step}`);
        }
      }
    }
    if (plan) traceEvents.push(`Plan: ${plan.planId}`);
    if (providerMetadata && typeof providerMetadata['providerId'] === 'string') {
      traceEvents.push(`Provider: ${providerMetadata['providerId']}`);
    }
    if (providerMetadata && Boolean(providerMetadata['fallbackUsed'])) {
      traceEvents.push(`Fallback: true`);
    }
    // ÉTAPE 30/31 — observabilité du contexte réellement transmis au provider.
    if (typeof conversationContext !== 'undefined') {
      traceEvents.push(
        `Context: ${conversationContext.stats.totalChars} chars, ${conversationContext.stats.historyIncluded}/${conversationContext.stats.historyTotal} messages, ${conversationContext.stats.preferencesIncluded} préférence(s), ${conversationContext.stats.decisionsIncluded} décision(s), sections: ${conversationContext.sections.map((s) => s.id).join(',') || 'aucune'}`
      );
    }

    const trace: ConversationTrace = deepFreeze({
      traceId: computeTraceId(session.sessionId, turnId),
      sessionId: session.sessionId,
      turnId,
      stateBefore: session.currentState,
      stateAfter: nextState,
      intentCategory: intent.category,
      contextHash: computeConversationStateHash(session.currentState, cleanUserText, intent.category),
      applicationHash: latestSnapshot.understandingHash,
      actionTaken: `Transition ${session.currentState} -> ${nextState}`,
      confidence,
      events: traceEvents,
      durationMs: Date.now() - startTime
    });

    const turn: ConversationTurn = deepFreeze({
      turnIndex,
      turnId,
      userMessage,
      stateBefore: session.currentState,
      stateAfter: nextState,
      intent,
      assumptions,
      decisions: session.activeDecisions,
      plan,
      agentResponse,
      trace
    });

    const updatedTurnMemory = this.memoryManager.updateTurnMemory(session.turnMemory, turn);
    let updatedProjectMemory = session.projectMemory;

    if (intent.constraints.length > 0) {
      for (const constraint of intent.constraints) {
        updatedProjectMemory = this.memoryManager.addConstraint(updatedProjectMemory, constraint);
      }
    }

    // ÉTAPE 31 — préférence utilisateur exprimée → API existante
    // setUserPreference → stockage existant (ProjectMemory.userPreferences,
    // persisté avec la session). Détection déterministe, formes négatives
    // exclues (ce sont des contraintes).
    const expressedPreference = extractUserPreference(cleanUserText);
    if (expressedPreference) {
      updatedProjectMemory = this.memoryManager.setUserPreference(
        updatedProjectMemory,
        expressedPreference.key,
        expressedPreference.value
      );
    }

    const updatedSession: ConversationSession = deepFreeze({
      ...session,
      currentState: nextState,
      turns: [...session.turns, turn],
      activeIntent: intent,
      activePlan: plan,
      activeAssumptions: assumptions,
      applicationSnapshot: latestSnapshot,
      turnMemory: updatedTurnMemory,
      projectMemory: updatedProjectMemory
    });

    return { updatedSession, turn };
  }
}
