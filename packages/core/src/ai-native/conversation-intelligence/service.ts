/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Conversation Intelligence Service Facade
 */

import { ValidationError } from '../../errors.js';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { auditStore } from '../../observability/audit.js';
import type { AgentRuntimeService } from '../agent-runtime/service.js';
import type { ApplicationUnderstandingService } from '../application-understanding/service.js';
import type { ImpactIntelligenceService } from '../impact-intelligence/service.js';
import type { MutationOrchestratorService } from '../mutation-orchestrator/service.js';
import { ConversationSessionLruCache } from './cache.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import { deepFreeze } from './engine/canonical.js';
import { ConversationAssumptionEngine } from './engine/assumption-engine.js';
import { ClarificationEngine } from './engine/clarification-engine.js';
import { ContradictionDetector } from './engine/contradiction-detector.js';
import { ConversationCompass } from './engine/conversation-compass.js';
import { ConversationEngine } from './engine/conversation-engine.js';
import { ExecutionBridge, type ExecutionResult } from './engine/execution-bridge.js';
import { ImpactBridge } from './engine/impact-bridge.js';
import { ConversationIntentEngine } from './engine/intent-engine.js';
import { MemoryManager } from './engine/memory-manager.js';
import { PlanGenerator } from './engine/plan-generator.js';
import { UnderstandingBridge } from './engine/understanding-bridge.js';
import { ConversationTraceCollector } from './observability/conversation-trace.js';
import { DefaultReasoningProvider } from './provider/reasoning-provider.js';
import type {
  ArchitecturalDecisionRecord,
  ConversationCacheMetrics,
  ConversationIntelligenceConfig,
  ConversationSession,
  ConversationTrace,
  ConversationTurn,
  ReasoningProvider
} from './types.js';

export const DEFAULT_CONVERSATION_CONFIG: ConversationIntelligenceConfig = {
  maxTurnsPerSession: 50,
  maxHistoryMessages: 10,
  cacheMaxEntries: 100,
  requireConfirmationForMediumRisk: false,
  defaultReasoningTimeoutMs: 30000
};

export class ConversationIntelligenceService {
  private readonly config: ConversationIntelligenceConfig;
  private readonly cache: ConversationSessionLruCache;
  private readonly traceCollector = new ConversationTraceCollector();
  private readonly defaultReasoningProvider: ReasoningProvider;

  private readonly compass: ConversationCompass;
  private readonly intentEngine: ConversationIntentEngine;
  private readonly clarificationEngine: ClarificationEngine;
  private readonly assumptionEngine: ConversationAssumptionEngine;
  private readonly planGenerator: PlanGenerator;
  private readonly contradictionDetector: ContradictionDetector;
  private readonly memoryManager: MemoryManager;
  private readonly understandingBridge: UnderstandingBridge;
  private readonly impactBridge: ImpactBridge;
  private readonly executionBridge: ExecutionBridge;
  private readonly engine: ConversationEngine;

  private totalTurnsProcessed = 0;
  // ÉTAPE 3 — sessions DURABLES : les sessions vivent dans la LRU cache mais
  // sont aussi persistées (SQLite via json-disk-cache). Une session évincée
  // de la LRU ou un redémarrage du serveur ne perd plus la conversation —
  // l'auto-réparation côté Studio devient un simple filet.
  private readonly durableSessionsFile = dataFilePath('conversation-sessions');
  private durableSessions: Record<string, ConversationSession> = {};
  private durableSessionsLoaded = false;

  private loadDurableSessions(): void {
    if (this.durableSessionsLoaded) return;
    const loaded = readJsonFile<Record<string, ConversationSession>>(this.durableSessionsFile, {});
    this.durableSessions = (loaded && typeof loaded === 'object') ? loaded : {};
    this.durableSessionsLoaded = true;
  }

  private persistSession(session: ConversationSession): void {
    this.loadDurableSessions();
    const key = ConversationSessionLruCache.buildKey(session.tenantId, session.projectId, session.sessionId);
    this.durableSessions[key] = session;
    try {
      writeJsonFileSync(this.durableSessionsFile, this.durableSessions);
    } catch {
      // La persistance ne doit jamais faire échouer le traitement
    }
  }

  constructor(
    private readonly understandingService?: ApplicationUnderstandingService | undefined,
    private readonly impactService?: ImpactIntelligenceService | undefined,
    private readonly agentRuntime?: AgentRuntimeService | undefined,
    private readonly mutationService?: MutationOrchestratorService | undefined,
    defaultReasoningProvider?: ReasoningProvider | undefined,
    config?: Partial<ConversationIntelligenceConfig> | undefined
  ) {
    this.config = {
      ...DEFAULT_CONVERSATION_CONFIG,
      ...config
    };

    this.cache = new ConversationSessionLruCache(this.config.cacheMaxEntries);
    this.defaultReasoningProvider = defaultReasoningProvider ?? new DefaultReasoningProvider();

    this.compass = new ConversationCompass();
    this.intentEngine = new ConversationIntentEngine();
    this.clarificationEngine = new ClarificationEngine();
    this.assumptionEngine = new ConversationAssumptionEngine();
    this.planGenerator = new PlanGenerator();
    this.contradictionDetector = new ContradictionDetector();
    this.memoryManager = new MemoryManager();
    this.understandingBridge = new UnderstandingBridge(this.understandingService);
    this.impactBridge = new ImpactBridge(this.impactService);
    this.executionBridge = new ExecutionBridge(this.agentRuntime, this.mutationService);

    this.engine = new ConversationEngine(
      this.intentEngine,
      this.clarificationEngine,
      this.assumptionEngine,
      this.compass,
      this.planGenerator,
      this.contradictionDetector,
      this.memoryManager,
      this.understandingBridge,
      this.impactBridge,
      this.executionBridge
    );
  }

  public createSession(
    params: {
      tenantId: string;
      projectId: string;
      conversationId?: string | undefined;
    },
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): ConversationSession {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    if (!params.tenantId || typeof params.tenantId !== 'string' || params.tenantId.trim().length === 0) {
      throw new ValidationError('tenantId est obligatoire pour créer une session de conversation');
    }
    if (!params.projectId || typeof params.projectId !== 'string' || params.projectId.trim().length === 0) {
      throw new ValidationError('projectId est obligatoire pour créer une session de conversation');
    }

    const tenantId = params.tenantId.trim();
    const projectId = params.projectId.trim();
    const sessionId = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const conversationId = params.conversationId?.trim() || `conv-${Date.now().toString(36)}`;

    const initialSnapshot = this.understandingBridge.computeSnapshot(
      this.understandingBridge.fetchUnderstanding(tenantId, projectId, userRole, requestId)
    );

    const session: ConversationSession = deepFreeze({
      sessionId,
      conversationId,
      tenantId,
      projectId,
      currentState: 'EXPLORING',
      turns: [],
      activeAssumptions: [],
      activeDecisions: [],
      applicationSnapshot: initialSnapshot,
      turnMemory: this.memoryManager.createInitialTurnMemory(),
      projectMemory: this.memoryManager.createInitialProjectMemory()
    });

    const cacheKey = ConversationSessionLruCache.buildKey(tenantId, projectId, sessionId);
    this.cache.set(cacheKey, session);
    this.persistSession(session);

    auditStore.record({
      tenantId,
      userId: userRole,
      action: 'CONVERSATION_SESSION_CREATED',
      resourceType: 'CONVERSATION_SESSION',
      resourceId: sessionId,
      status: 'SUCCESS',
      metadata: { conversationId, projectId },
      requestId: requestId || 'req_conv_create'
    });

    return session;
  }

  public getSession(
    tenantId: string,
    projectId: string,
    sessionId: string,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): ConversationSession | undefined {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const cacheKey = ConversationSessionLruCache.buildKey(tenantId.trim(), projectId.trim(), sessionId.trim());
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    // ÉTAPE 3 — cache miss (éviction LRU ou redémarrage) -> rechargement
    // depuis la persistance durable
    this.loadDurableSessions();
    const durable = this.durableSessions[cacheKey];
    if (durable) {
      this.cache.set(cacheKey, durable);
      return durable;
    }
    return undefined;
  }

  /**
   * ÉTAPE 5 — Mémoire projet réelle (§14 CDC) : ProjectMemory de la session
   * la plus récente du projet (décisions, préférences, contraintes, plans
   * acceptés/rejetés). Exposé au panneau Mémoire du Studio.
   */
  public getLatestProjectMemory(
    tenantId: string,
    projectId: string,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): ConversationSession['projectMemory'] | null {
    assertPermission(userRole, 'PROJECT_READ', requestId);
    this.loadDurableSessions();
    const prefix = `${tenantId.trim()}:${projectId.trim()}:`;
    let latest: ConversationSession | null = null;
    for (const [key, session] of Object.entries(this.durableSessions)) {
      if (!key.startsWith(prefix)) continue;
      if (!latest || session.sessionId > latest.sessionId) latest = session;
    }
    if (!latest) {
      return null;
    }
    return latest.projectMemory ?? null;
  }

  public async processTurn(
    params: {
      tenantId: string;
      projectId: string;
      sessionId: string;
      message: string;
      reasoningProvider?: ReasoningProvider | undefined;
      autoConfirmLowRisk?: boolean | undefined;
    },
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): Promise<{ session: ConversationSession; turn: ConversationTurn }> {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const { tenantId, projectId, sessionId, message, reasoningProvider, autoConfirmLowRisk } = params;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new ValidationError('Le message utilisateur ne peut pas être vide');
    }

    const session = this.getSession(tenantId, projectId, sessionId, userRole, requestId);
    if (!session) {
      throw new ValidationError(`Session de conversation '${sessionId}' introuvable pour ce projet`);
    }

    if (session.turns.length >= this.config.maxTurnsPerSession) {
      throw new ValidationError(`Nombre maximum de tours (${this.config.maxTurnsPerSession}) atteint pour cette session`);
    }

    const { updatedSession, turn } = await this.engine.processTurn({
      session,
      userMessageText: message,
      reasoningProvider: reasoningProvider ?? this.defaultReasoningProvider,
      autoConfirmLowRisk: autoConfirmLowRisk ?? !this.config.requireConfirmationForMediumRisk,
      userRole,
      requestId
    });

    const cacheKey = ConversationSessionLruCache.buildKey(tenantId.trim(), projectId.trim(), sessionId.trim());
    this.cache.set(cacheKey, updatedSession);
    this.persistSession(updatedSession);

    this.traceCollector.recordTrace(turn.trace);
    this.totalTurnsProcessed++;

    auditStore.record({
      tenantId: session.tenantId,
      userId: userRole,
      action: 'CONVERSATION_TURN_PROCESSED',
      resourceType: 'CONVERSATION_SESSION',
      resourceId: sessionId,
      status: 'SUCCESS',
      metadata: {
        turnIndex: turn.turnIndex,
        stateBefore: turn.stateBefore,
        stateAfter: turn.stateAfter,
        intentCategory: turn.intent.category
      },
      requestId: requestId || 'req_conv_turn'
    });

    return { session: updatedSession, turn };
  }

  public async confirmPlan(
    params: {
      tenantId: string;
      projectId: string;
      sessionId: string;
      planId: string;
      approved: boolean;
    },
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): Promise<ConversationSession> {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const session = this.getSession(params.tenantId, params.projectId, params.sessionId, userRole, requestId);
    if (!session) {
      throw new ValidationError(`Session de conversation '${params.sessionId}' introuvable`);
    }

    if (!session.activePlan || session.activePlan.planId !== params.planId) {
      throw new ValidationError(`Plan '${params.planId}' introuvable ou non actif dans cette session`);
    }

    const nextState = params.approved ? 'WAITING_CONFIRMATION' : 'PLANNING';
    const updatedPlan = deepFreeze({
      ...session.activePlan,
      status: params.approved ? ('APPROVED' as const) : ('REJECTED' as const)
    });

    const updatedProjectMemory = this.memoryManager.recordPlanDecision(
      session.projectMemory,
      params.planId,
      params.approved
    );

    const updatedSession: ConversationSession = deepFreeze({
      ...session,
      currentState: nextState,
      activePlan: updatedPlan,
      projectMemory: updatedProjectMemory
    });

    const cacheKey = ConversationSessionLruCache.buildKey(params.tenantId.trim(), params.projectId.trim(), params.sessionId.trim());
    this.cache.set(cacheKey, updatedSession);
    this.persistSession(updatedSession);

    auditStore.record({
      tenantId: params.tenantId,
      userId: userRole,
      action: params.approved ? 'ENGINEERING_PLAN_APPROVED' : 'ENGINEERING_PLAN_REJECTED',
      resourceType: 'ENGINEERING_PLAN',
      resourceId: params.planId,
      status: 'SUCCESS',
      metadata: { approved: params.approved, sessionId: params.sessionId },
      requestId: requestId || 'req_conv_confirm'
    });

    return updatedSession;
  }

  public async executeApprovedPlan(
    params: {
      tenantId: string;
      projectId: string;
      sessionId: string;
    },
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): Promise<{ session: ConversationSession; executionResult: ExecutionResult }> {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const session = this.getSession(params.tenantId, params.projectId, params.sessionId, userRole, requestId);
    if (!session) {
      throw new ValidationError(`Session de conversation '${params.sessionId}' introuvable`);
    }

    if (!session.activePlan) {
      throw new ValidationError('Aucun plan actif à exécuter pour cette session');
    }

    const executionResult = await this.executionBridge.executePlan(
      session.activePlan,
      session,
      userRole,
      requestId
    );

    const nextState = executionResult.success ? 'VALIDATING' : 'FAILED';
    const updatedPlan = deepFreeze({
      ...session.activePlan,
      status: executionResult.success ? ('EXECUTED' as const) : ('FAILED' as const)
    });

    const updatedSession: ConversationSession = deepFreeze({
      ...session,
      currentState: nextState,
      activePlan: updatedPlan
    });

    const cacheKey = ConversationSessionLruCache.buildKey(params.tenantId.trim(), params.projectId.trim(), params.sessionId.trim());
    this.cache.set(cacheKey, updatedSession);
    this.persistSession(updatedSession);

    return { session: updatedSession, executionResult };
  }

  public recordDecision(
    params: {
      tenantId: string;
      projectId: string;
      sessionId: string;
      statement: string;
      reason: string;
      evidence?: string | undefined;
      confidence?: number | undefined;
      alternatives?: readonly string[] | undefined;
      selectedAlternative?: string | undefined;
    },
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): ConversationSession {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const session = this.getSession(params.tenantId, params.projectId, params.sessionId, userRole, requestId);
    if (!session) {
      throw new ValidationError(`Session de conversation '${params.sessionId}' introuvable`);
    }

    const decisionRecord: ArchitecturalDecisionRecord = deepFreeze({
      decisionId: `dec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId: params.sessionId,
      projectId: params.projectId,
      statement: params.statement.trim(),
      reason: params.reason.trim(),
      evidence: params.evidence?.trim() || 'Explicitement formulé par l\'utilisateur',
      confidence: params.confidence ?? 1.0,
      alternatives: params.alternatives ?? [],
      selectedAlternative: params.selectedAlternative ?? params.statement,
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    });

    const updatedProjectMemory = this.memoryManager.recordDecision(session.projectMemory, decisionRecord);
    const updatedDecisions = [...session.activeDecisions, decisionRecord];

    const updatedSession: ConversationSession = deepFreeze({
      ...session,
      activeDecisions: updatedDecisions,
      projectMemory: updatedProjectMemory
    });

    const cacheKey = ConversationSessionLruCache.buildKey(params.tenantId.trim(), params.projectId.trim(), params.sessionId.trim());
    this.cache.set(cacheKey, updatedSession);
    this.persistSession(updatedSession);

    auditStore.record({
      tenantId: params.tenantId,
      userId: userRole,
      action: 'ARCHITECTURAL_DECISION_RECORDED',
      resourceType: 'DECISION_RECORD',
      resourceId: decisionRecord.decisionId,
      status: 'SUCCESS',
      metadata: { statement: decisionRecord.statement },
      requestId: requestId || 'req_conv_decision'
    });

    return updatedSession;
  }

  public rollbackLastTurn(
    params: {
      tenantId: string;
      projectId: string;
      sessionId: string;
    },
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): ConversationSession {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const session = this.getSession(params.tenantId, params.projectId, params.sessionId, userRole, requestId);
    if (!session) {
      throw new ValidationError(`Session de conversation '${params.sessionId}' introuvable`);
    }

    if (session.turns.length === 0) {
      throw new ValidationError('Aucun tour à annuler dans cette session');
    }

    const updatedTurns = session.turns.slice(0, -1);
    const lastTurn = updatedTurns[updatedTurns.length - 1];

    const updatedSession: ConversationSession = deepFreeze({
      ...session,
      currentState: lastTurn ? lastTurn.stateAfter : 'EXPLORING',
      turns: updatedTurns,
      activeIntent: lastTurn?.intent,
      activePlan: lastTurn?.plan
    });

    const cacheKey = ConversationSessionLruCache.buildKey(params.tenantId.trim(), params.projectId.trim(), params.sessionId.trim());
    this.cache.set(cacheKey, updatedSession);
    this.persistSession(updatedSession);

    return updatedSession;
  }

  public getTraces(sessionId: string): readonly ConversationTrace[] {
    return this.traceCollector.getSessionTraces(sessionId);
  }

  public getMetrics(): ConversationCacheMetrics & { totalTurnsProcessed: number } {
    return {
      ...this.cache.getMetrics(),
      totalTurnsProcessed: this.totalTurnsProcessed
    };
  }
}
