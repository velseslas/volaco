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
import { ConversationIntentEngine } from './intent-engine.js';
import { MemoryManager } from './memory-manager.js';
import { PlanGenerator } from './plan-generator.js';
import { UnderstandingBridge } from './understanding-bridge.js';
import type { Role } from '../../../identity/permissions.js';
import type {
  ClarificationItem,
  ConversationSession,
  ConversationTrace,
  ConversationTurn,
  EngineeringPlan,
  HumanAiMessage,
  IntentResult,
  PlanAssessment,
  ReasoningProvider
} from '../types.js';

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

    const turnIndex = session.turns.length + 1;
    const turnId = `turn-${session.sessionId}-${turnIndex}`;

    const cleanUserText = userMessageText.trim();
    const userMessage: HumanAiMessage = deepFreeze({
      id: `msg-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sender: 'HUMAN',
      content: cleanUserText,
      timestamp: new Date().toISOString()
    });

    const latestModel = this.understandingBridge.fetchUnderstanding(
      session.tenantId,
      session.projectId,
      userRole,
      requestId
    );
    const latestSnapshot = this.understandingBridge.computeSnapshot(latestModel);
    const isStale = this.understandingBridge.isContextStale(session.applicationSnapshot, latestSnapshot);

    const intent: IntentResult = await this.intentEngine.classifyIntent(cleanUserText, latestModel, session.tenantId, session.projectId);

    const contradictions = this.contradictionDetector.detectContradictions({
      newIntent: intent,
      projectMemory: session.projectMemory,
      activeDecisions: session.activeDecisions
    });

    const assumptions = this.assumptionEngine.synthesizeAssumptions({
      intent,
      projectMemory: session.projectMemory,
      semanticModel: latestModel
    });

    const clarifications = this.clarificationEngine.assessClarifications({
      intent,
      assumptions,
      contradictions
    });

    let plan: EngineeringPlan | undefined = session.activePlan;
    let planAssessment: PlanAssessment | undefined;

    const needsNewPlan =
      !plan ||
      intent.category === 'CREATE' ||
      intent.category === 'MODIFY' ||
      intent.category === 'DELETE' ||
      intent.category === 'REFACTOR' ||
      intent.category === 'DEBUG';

    if (needsNewPlan && intent.category !== 'QUESTION' && intent.category !== 'EXPLAIN' && intent.category !== 'EXPLORATION') {
      plan = this.planGenerator.generatePlan({
        intent,
        assumptions,
        semanticModel: latestModel
      });
      planAssessment = this.planGenerator.assessPlan(plan, latestModel);
    }

    if (plan) {
      const impact = this.impactBridge.assessPlanImpact(
        plan,
        session.tenantId,
        session.projectId,
        userRole,
        requestId
      );
      if (impact.requiresConfirmation) {
        plan = deepFreeze({
          ...plan,
          estimatedImpact: impact.blastRadiusSummary
        });
      }
    }

    let nextState = this.compass.determineNextState({
      currentState: session.currentState,
      intent,
      ambiguities: clarifications,
      assumptions,
      hasPlan: Boolean(plan),
      planAssessment,
      autoConfirmLowRisk
    });

    let replyText = '';
    let confidence = intent.confidence;

    let providerMetadata: Record<string, unknown> | undefined;
    // PHASE 5/6 - nextAction du LLM pour surcharger le Compass
    let llmNextAction: import('../types.js').NextActionKind | undefined;

    // ÉTAPE 30 — le contexte conversationnel borné (historique pertinent +
    // mémoire projet + décisions + contraintes) est construit UNE fois ici,
    // à l'unique point d'appel du provider, et transmis tel quel. Le pool
    // d'historique est l'historique COMPLET de la session (session.turns —
    // store existant) ; la sélection bornée est le travail du builder.
    const fullHistory: HumanAiMessage[] = session.turns.flatMap((t) => [t.userMessage, t.agentResponse]);
    const conversationContext = this.contextBuilder.build({
      userMessage: cleanUserText,
      history: fullHistory,
      projectMemory: session.projectMemory,
      turnMemory: session.turnMemory
    });

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

        // PHASE 6 - Utiliser le plan genere par le LLM a la place du plan rule-based
        if (providerRes.plan && providerRes.plan.steps && providerRes.plan.steps.length > 0) {
          plan = providerRes.plan;
          planAssessment = undefined;
          providerMetadata = { ...providerMetadata, planSource: 'llm', planSteps: providerRes.plan.steps.length };
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
    // ÉTAPE 30 — observabilité du contexte réellement transmis au provider.
    if (typeof conversationContext !== 'undefined') {
      traceEvents.push(
        `Context: ${conversationContext.stats.totalChars} chars, ${conversationContext.stats.historyIncluded}/${conversationContext.stats.historyTotal} messages, ${conversationContext.stats.decisionsIncluded} décision(s)`
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
