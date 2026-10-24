/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Agent Runtime Facade Service
 */

import { randomUUID } from 'node:crypto';
import { fileStore } from '../../file-explorer/index.js';
import { NotFoundError, ValidationError } from '../../errors.js';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { auditStore } from '../../observability/audit.js';
import type { CodeIntelligenceService } from '../understanding/service.js';
import type { ApplicationDNAService } from '../dna/service.js';
import type { ContextAssemblyService } from '../context/service.js';
import type { SemanticCodeGraphService } from '../semantic-graph/service.js';
import type { ImpactIntelligenceService } from '../impact-intelligence/service.js';
import type { MutationOrchestratorService } from '../mutation-orchestrator/service.js';
import {
  type AgentIntent,
  type AgentPlan,
  type AgentPlanPreview,
  type AgentRole,
  type AgentRun,
  type AgentState,
  type AgentAuditEvent,
  ConfirmationRequiredError,
  type ReasoningBudget,
  type ReasoningBudgetUsage,
  type RunMemory
} from './types.js';
import { AgentStateMachine } from './agent/state-machine.js';
import { AgentRegistry } from './agent/registry.js';
import { IntentEngine } from './intent/intent-engine.js';
import { ContextRequirementEngine } from './context/requirements.js';
import { ToolRegistry, type ToolExecutionContext } from './tools/registry.js';
import { ToolSelector } from './tools/selector.js';
import { AgentPlanner } from './planning/planner.js';
import { ConfirmationPolicy } from './planning/confirmation.js';
import { BudgetTracker } from './reasoning/budget.js';
import { AssumptionEngine } from './reasoning/assumptions.js';
import { VerificationEngine } from './execution/verification.js';
import { RepairEngine } from './execution/repair.js';
import { PlanExecutor } from './execution/executor.js';
import { RunMemoryStore } from './memory/run-memory.js';
import { AuditEventLog } from './audit/event-log.js';
import { AgentRuntimeLruCache } from './cache.js';
import type { LLMProvider } from './llm/provider.js';
import { logger } from '../../logger.js';
import { MockLLMProvider } from './llm/provider.js';

export interface StartRunOptions {
  readonly tenantId: string;
  readonly projectId: string;
  readonly userInput: string;
  readonly agentRole?: AgentRole | undefined;
  readonly agentId?: string | undefined;
  readonly budget?: Partial<ReasoningBudget> | undefined;
  readonly userRole?: Role | undefined;
  readonly requestId?: string | undefined;
  readonly autoExecutePlan?: boolean | undefined;
}

interface ActiveRunSession {
  readonly runId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly role: AgentRole;
  readonly stateMachine: AgentStateMachine;
  readonly memoryStore: RunMemoryStore;
  readonly auditLog: AuditEventLog;
  readonly budgetTracker: BudgetTracker;
  readonly assumptionEngine: AssumptionEngine;
  intent?: AgentIntent | undefined;
  plan?: AgentPlan | undefined;
  error?: string | undefined;
  confirmationRequested?: boolean | undefined;
  // P0-PROD — true si un humain a explicitement approuvé ce run
  // (continueRun(confirmation=true) ou appel direct à executePlan).
  // Transmis aux outils via ToolExecutionContext.highRiskApproved : sans
  // approbation, l'Impact Gate bloque HIGH/CRITICAL/BREAKING.
  humanApproved: boolean;
  readonly createdAt: number;
  updatedAt: number;
}

export interface AgentRuntimeConfig {
  readonly maxConcurrentRuns?: number | undefined;
  readonly cacheMaxEntries?: number | undefined;
  readonly autoConfirmLowRisk?: boolean | undefined;
}

export class AgentRuntimeService {
  private readonly config: AgentRuntimeConfig;
  private readonly agentRegistry: AgentRegistry;
  private readonly toolRegistry: ToolRegistry;
  private readonly toolSelector: ToolSelector;
  private readonly intentEngine: IntentEngine;
  private readonly contextReqEngine: ContextRequirementEngine;
  private readonly planner: AgentPlanner;
  private readonly confirmationPolicy: ConfirmationPolicy;
  private readonly verificationEngine: VerificationEngine;
  private readonly repairEngine: RepairEngine;
  private readonly executor: PlanExecutor;
  private readonly cache: AgentRuntimeLruCache<unknown>;
  private readonly runs = new Map<string, ActiveRunSession>();
  public readonly llmProvider: LLMProvider;

  constructor(
    private readonly mutationService?: MutationOrchestratorService | undefined,
    private readonly codeIntelService?: CodeIntelligenceService | undefined,
    private readonly dnaService?: ApplicationDNAService | undefined,
    private readonly contextService?: ContextAssemblyService | undefined,
    private readonly semanticGraphService?: SemanticCodeGraphService | undefined,
    private readonly impactService?: ImpactIntelligenceService | undefined,
    llmProvider?: LLMProvider | undefined,
    config?: AgentRuntimeConfig | undefined
  ) {
    this.config = {
      maxConcurrentRuns: 100,
      cacheMaxEntries: 200,
      autoConfirmLowRisk: true,
      ...config
    };

    if (llmProvider) {
      this.llmProvider = llmProvider;
    } else {
      // Aucun moteur IA réel fourni : on utilise un simulateur de secours.
      // Avertissement volontairement visible pour ne jamais tomber dessus
      // sans s'en rendre compte en production.
      logger.warn(
        'AgentRuntimeService démarré SANS moteur IA réel — utilisation du simulateur MockLLMProvider (réponses factices).',
        { component: 'agent-runtime', reason: 'no-llm-provider-configured' }
      );
      this.llmProvider = new MockLLMProvider();
    }
    this.agentRegistry = new AgentRegistry();
    this.toolRegistry = new ToolRegistry();
    this.toolSelector = new ToolSelector(this.toolRegistry);
    this.intentEngine = new IntentEngine();
    this.contextReqEngine = new ContextRequirementEngine(this.contextService);
    this.confirmationPolicy = new ConfirmationPolicy({
      autoConfirmLowRisk: this.config.autoConfirmLowRisk
    });
    this.planner = new AgentPlanner(this.toolRegistry, this.confirmationPolicy);
    this.verificationEngine = new VerificationEngine(this.codeIntelService);
    this.repairEngine = new RepairEngine(this.mutationService);
    this.executor = new PlanExecutor(
      this.toolRegistry,
      this.verificationEngine,
      this.repairEngine,
      this.mutationService,
      this.semanticGraphService
    );
    this.cache = new AgentRuntimeLruCache<unknown>(this.config.cacheMaxEntries);

    this.bindInternalTools();
  }

  private bindInternalTools(): void {
    // Bind AINT-005 Impact Analysis tool if service is available
    if (this.impactService) {
      this.toolRegistry.registerHandler('analyze_impact', async (input, ctx) => {
        const targetFiles = (input.targetFiles as string[]) ?? [];
        const targetSymbols = (input.targetSymbols as string[]) ?? [];
        return this.impactService?.analyzeImpact(
          {
            tenantId: ctx.tenantId,
            projectId: ctx.projectId,
            targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
            targetSymbols: targetSymbols.length > 0 ? targetSymbols : undefined
          },
          ctx.userRole,
          ctx.requestId
        );
      });
    }

    // P2 — READ_FILE RÉEL : lit le FileStore du projet. Un fichier absent
    // est une LECTURE réussie qui rapporte exists:false (information utile
    // pour un agent) — seules les MUTATIONS échouent sur un fichier absent.
    this.toolRegistry.registerHandler('read_file', async (input, ctx) => {
      const path = String(input.path ?? 'index.html');
      const file = fileStore.getFile(ctx.tenantId, ctx.projectId, path);
      return {
        exists: !!file,
        path,
        content: file?.content ?? null,
        size: file?.content ? file.content.length : 0
      };
    });

    // P2-e — RUN_TYPECHECK RÉEL : analyse du code ciblé par le plan via
    // CodeIntelligence (parse TS réel). Erreurs de syntaxe/structure =
    // échec honnête de l'étape de vérification.
    if (this.codeIntelService) {
      this.toolRegistry.registerHandler('run_typecheck', async (input, ctx) => {
        const all = fileStore.getAllProjectFiles(ctx.tenantId, ctx.projectId);
        const targetFiles = (input.targetFiles as string[]) ?? Object.keys(all);
        const errors: Array<{ file: string; message: string }> = [];
        for (const path of targetFiles) {
          const content = all[path];
          if (typeof content !== 'string' || !/.(ts|tsx)$/.test(path)) continue;
          try {
            const codeIntel = this.codeIntelService;
            if (!codeIntel) return { passed: false, checked: 0, errors: [{ file: path, message: 'service indisponible' }] };
            codeIntel.analyzeSource(content, path, { tenantId: ctx.tenantId, projectId: ctx.projectId });
          } catch (err) {
            errors.push({ file: path, message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) });
          }
        }
        return {
          passed: errors.length === 0,
          checked: targetFiles.length,
          errors
        };
      });
    }

    // P2 — SEARCH_CODE RÉEL : grep sur tous les fichiers du projet.
    this.toolRegistry.registerHandler('search_code', async (input, ctx) => {
      const query = String(input.query ?? '').toLowerCase();
      if (query.length === 0) return { matches: [], total: 0 };
      const all = fileStore.getAllProjectFiles(ctx.tenantId, ctx.projectId);
      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const [path, content] of Object.entries(all) as Array<[string, string]>) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && matches.length < 50; i++) {
          const lineText = lines[i] ?? '';
          if (lineText.toLowerCase().includes(query)) {
            matches.push({ path, line: i + 1, text: lineText.trim().slice(0, 120) });
          }
        }
      }
      return { matches, total: matches.length };
    });

    // Bind AINT-003 Context Assembly tool if service is available
    if (this.contextService) {
      this.toolRegistry.registerHandler('build_context', async (input, ctx) => {
        const taskDescription = (input.userIntent as string) ?? 'General context request';
        const focusFiles = (input.focusFiles as string[]) ?? [];
        return this.contextService?.assembleContext(
          {
            tenantId: ctx.tenantId,
            projectId: ctx.projectId,
            taskDescription,
            targetFiles: focusFiles.length > 0 ? focusFiles : undefined
          },
          ctx.userRole,
          ctx.requestId
        );
      });
    }

    // Bind AINT-006 Preview Mutation if service is available
    if (this.mutationService) {
      this.toolRegistry.registerHandler('preview_mutation', async (input, ctx) => {
        const plan = input.plan as import('../mutation-orchestrator/types.js').MutationPlan | undefined;
        if (!plan || !plan.mutations || plan.mutations.length === 0) {
          throw new Error('MUTATION_UNSUPPORTED: le plan ne contient aucune modification de fichier concrète — le contenu doit être fourni par le plan');
        }

        return this.mutationService!.previewPlan(
          plan,
          { dryRun: true, allowBreaking: true, allowHighRisk: true },
          ctx.userRole,
          ctx.requestId
        );
      });

      // Bind AINT-006 Execute Mutation
      this.toolRegistry.registerHandler('execute_mutation', async (input, ctx) => {
        const plan = input.plan as import('../mutation-orchestrator/types.js').MutationPlan | undefined;
        if (!plan || !plan.mutations || plan.mutations.length === 0) {
          throw new Error('MUTATION_UNSUPPORTED: le plan ne contient aucune modification de fichier concrète — le contenu doit être fourni par le plan');
        }

        return this.mutationService!.executePlan(
          plan,
          // P0-PROD — plus de `allowHighRisk/allowBreaking: true` en dur :
          // levés uniquement sur approbation humaine du run (fail-closed).
          {
            dryRun: false,
            allowBreaking: ctx.highRiskApproved === true,
            allowHighRisk: ctx.highRiskApproved === true
          },
          ctx.userRole,
          ctx.requestId
        );
      });
    }
  }

  /**
   * Starts a new autonomous agent run.
   */
  public async startRun(options: StartRunOptions): Promise<AgentRun> {
    const userRole = options.userRole ?? 'OWNER';
    assertPermission(userRole, 'PROJECT_READ', options.requestId);

    if (!options.tenantId || typeof options.tenantId !== 'string' || options.tenantId.trim().length === 0) {
      throw new ValidationError('tenantId est obligatoire pour demarrer un run');
    }
    if (!options.projectId || typeof options.projectId !== 'string' || options.projectId.trim().length === 0) {
      throw new ValidationError('projectId est obligatoire pour demarrer un run');
    }
    if (!options.userInput || typeof options.userInput !== 'string' || options.userInput.trim().length === 0) {
      throw new ValidationError('userInput est obligatoire pour demarrer un run');
    }

    const runId = `run-${randomUUID().substring(0, 8)}`;
    const role: AgentRole = options.agentRole ?? 'GENERALIST';
    const agentDef = this.agentRegistry.get(role) ?? this.agentRegistry.get('GENERALIST')!;

    const stateMachine = new AgentStateMachine(runId, 'IDLE');
    const memoryStore = new RunMemoryStore(runId, options.tenantId, options.projectId);
    const auditLog = new AuditEventLog(runId, options.tenantId, options.projectId);
    const budgetTracker = new BudgetTracker(options.budget);
    const assumptionEngine = new AssumptionEngine();

    const session: ActiveRunSession = {
      runId,
      tenantId: options.tenantId,
      projectId: options.projectId,
      agentId: options.agentId ?? agentDef.identity?.id ?? agentDef.agentId,
      role,
      stateMachine,
      memoryStore,
      auditLog,
      budgetTracker,
      assumptionEngine,
      humanApproved: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.runs.set(runId, session);

    // 1. Transition: IDLE -> RECEIVING
    stateMachine.transition('RECEIVING', 'Reception de la demande utilisateur');
    auditLog.append('RUN_STARTED', { userInput: options.userInput, role });
    memoryStore.addMessage('user', options.userInput);

    // 2. Transition: RECEIVING -> UNDERSTANDING
    stateMachine.transition('UNDERSTANDING', 'Analyse semantique et detection d intention');
    const intent = this.intentEngine.parseIntent(options.userInput);
    session.intent = intent;
    auditLog.append('INTENT_DETECTED', { intent });

    // Request & assemble context if available
    auditLog.append('CONTEXT_REQUESTED', { goal: intent.goal, entities: intent.entities });
    const contextPack = this.contextReqEngine.assembleRequiredContext(
      intent,
      options.tenantId,
      options.projectId,
      userRole
    );
    if (contextPack) {
      auditLog.append('CONTEXT_ASSEMBLED', {
        tokens: contextPack.budgetUsage.totalTokens,
        itemsCount: contextPack.files.length + contextPack.symbols.length
      });
    }

    // 3. Transition: UNDERSTANDING -> PLANNING
    stateMachine.transition('PLANNING', 'Generation du plan d action');
    let impactAnalysisResult: unknown = undefined;
    if (intent.requiresMutation && this.impactService) {
      const targetFiles = intent.entities.filter((e) => e.includes('.'));
      if (targetFiles.length > 0) {
        try {
          impactAnalysisResult = this.impactService.analyzeImpact(
            {
              tenantId: options.tenantId,
              projectId: options.projectId,
              targetFiles
            },
            userRole,
            options.requestId
          );
          auditLog.append('IMPACT_ANALYZED', { impact: impactAnalysisResult });
        } catch {
          // Impact analysis fallback
        }
      }
    }

    const plan = this.planner.createPlan(
      intent,
      assumptionEngine.getAssumptions(),
      impactAnalysisResult
    );
    session.plan = plan;
    auditLog.append('PLAN_CREATED', {
      planId: plan.id,
      stepsCount: plan.steps.length,
      confirmationRequired: plan.confirmationRequired
    });

    // Check confirmation policy
    if (plan.confirmationRequired) {
      stateMachine.transition('WAITING_CONFIRMATION', 'Confirmation utilisateur requise pour cette operation');
      session.confirmationRequested = true;
      auditLog.append('CONFIRMATION_REQUESTED', {
        reason: 'Operation a haut risque ou destructrice'
      });
      return this.formatRun(session);
    }

    // If auto-execution is requested and no confirmation is needed
    if (options.autoExecutePlan) {
      return this.executePlanInternal(session, userRole, options.requestId);
    }

    return this.formatRun(session);
  }

  /**
   * Continues a run after user response or confirmation.
   */
  public async continueRun(
    runId: string,
    input?: string | undefined,
    confirmation?: boolean | undefined,
    userRole: Role = 'OWNER',
    tenantId?: string | undefined,
    projectId?: string | undefined
  ): Promise<AgentRun> {
    const session = this.getSession(runId, tenantId, projectId);

    if (confirmation !== undefined) {
      if (confirmation === false) {
        if (!session.stateMachine.isTerminal()) {
          session.stateMachine.transition('CANCELLED', 'Confirmation refusee ou annulation par l utilisateur');
          session.auditLog.append('RUN_CANCELLED', { reason: 'Refus utilisateur' });
          return this.formatRun(session);
        }
      } else if (confirmation === true) {
        // P0-PROD — approbation humaine explicite : les gates HIGH/CRITICAL
        // sont levés pour CE run (tracé dans l'audit ci-dessous).
        session.humanApproved = true;
        session.auditLog.append('HUMAN_APPROVAL_GRANTED', { reason: 'Confirmation utilisateur explicite' });
        return this.executePlanInternal(session, userRole);
      }
    }

    if (input) {
      session.memoryStore.addMessage('user', input);
      if (session.stateMachine.getState() === 'WAITING_CONFIRMATION') {
        session.stateMachine.transition('CANCELLED', 'Nouvelle instruction utilisateur annulant le plan precedent');
      }
    }

    return this.formatRun(session);
  }

  /**
   * Explicitly executes a validated plan.
   */
  public async executePlan(
    runId: string,
    userRole: Role = 'OWNER',
    tenantId?: string | undefined,
    projectId?: string | undefined
  ): Promise<AgentRun> {
    const session = this.getSession(runId, tenantId, projectId);
    // P0-PROD — appel explicite = action humaine volontaire : les gates
    // HIGH/CRITICAL sont levés pour CE run (tracé dans l'audit).
    session.humanApproved = true;
    session.auditLog.append('HUMAN_APPROVAL_GRANTED', { reason: 'Exécution explicite du plan validé' });
    return this.executePlanInternal(session, userRole);
  }

  private async executePlanInternal(
    session: ActiveRunSession,
    userRole: Role,
    requestId?: string
  ): Promise<AgentRun> {
    const plan = session.plan;
    if (!plan) {
      throw new ValidationError('Aucun plan disponible a executer');
    }

    const hasMutation = plan.steps.some((s) => s.tool === 'execute_mutation');
    if (hasMutation) {
      assertPermission(userRole, 'PROJECT_MUTATE', requestId);
    }

    // Transition to EXECUTING
    session.stateMachine.transition('EXECUTING', 'Demarrage de l execution du plan');
    session.auditLog.append('MUTATION_STARTED', { planId: plan.id });

    const context: ToolExecutionContext = {
      tenantId: session.tenantId,
      projectId: session.projectId,
      runId: session.runId,
      userRole,
      requestId,
      highRiskApproved: session.humanApproved === true
    };

    const outcome = await this.executor.executePlan(plan, session.budgetTracker, context);

    if (!outcome.success) {
      session.stateMachine.transition('FAILED', outcome.error ?? 'Echec lors de l execution du plan');
      session.error = outcome.error;
      session.auditLog.append('RUN_FAILED', { error: outcome.error });
      return this.formatRun(session);
    }

    session.auditLog.append('MUTATION_COMPLETED', {
      transactionId: outcome.transactionId,
      stepsExecuted: outcome.executedSteps.length
    });

    // Verification
    session.stateMachine.transition('VERIFYING', 'Demarrage de la verification post-mutation');
    session.auditLog.append('VERIFICATION_STARTED', {});

    if (outcome.verification && !outcome.verification.passed) {
      session.stateMachine.transition('FAILED', 'La verification a echoue');
      session.error = outcome.verification.errors.join('; ');
      session.auditLog.append('RUN_FAILED', { error: session.error });
      return this.formatRun(session);
    }

    session.auditLog.append('VERIFICATION_COMPLETED', { passed: true });

    // Completed successfully
    session.stateMachine.transition('COMPLETED', 'Plan execute et verifie avec succes');
    session.auditLog.append('RUN_COMPLETED', {
      totalIterations: session.budgetTracker.getUsage().currentIterations,
      totalToolCalls: session.budgetTracker.getUsage().currentToolCalls
    });

    return this.formatRun(session);
  }

  /**
   * Previews a plan without mutating files (dry run diffs).
   */
  public async previewPlan(
    runId: string,
    tenantId?: string | undefined,
    projectId?: string | undefined
  ): Promise<AgentPlanPreview> {
    const session = this.getSession(runId, tenantId, projectId);
    if (!session.plan) {
      throw new ValidationError('Aucun plan disponible a previsualiser');
    }

    return {
      runId: session.runId,
      plan: session.plan,
      impactRisk: (session.plan.impactAnalysis as { overallRisk?: string } | undefined)?.overallRisk,
      confirmationRequired: session.plan.confirmationRequired
    };
  }

  /**
   * Cancels an ongoing run.
   */
  public async cancelRun(
    runId: string,
    reason: string,
    userRole: Role = 'VIEWER',
    tenantId?: string | undefined,
    projectId?: string | undefined
  ): Promise<AgentRun> {
    assertPermission(userRole, 'PROJECT_READ');
    const session = this.getSession(runId, tenantId, projectId);

    if (!session.stateMachine.isTerminal()) {
      session.stateMachine.transition('CANCELLED', reason);
      session.auditLog.append('RUN_CANCELLED', { reason });
    }

    return this.formatRun(session);
  }

  /**
   * Retrieves an agent run by id, with strict multi-tenancy verification.
   */
  public getRun(
    runId: string,
    tenantId?: string | undefined,
    projectId?: string | undefined
  ): AgentRun | undefined {
    const session = this.runs.get(runId);
    if (!session) return undefined;

    if (tenantId && session.tenantId !== tenantId) {
      throw new NotFoundError(`AgentRun '${runId}'`);
    }
    if (projectId && session.projectId !== projectId) {
      throw new NotFoundError(`AgentRun '${runId}'`);
    }

    return this.formatRun(session);
  }

  /**
   * Retrieves all immutable audit events for a run.
   */
  public getRunEvents(
    runId: string,
    tenantId?: string | undefined,
    projectId?: string | undefined
  ): readonly AgentAuditEvent[] {
    const session = this.getSession(runId, tenantId, projectId);
    return session.auditLog.getEvents();
  }

  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  public getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }

  private getSession(
    runId: string,
    tenantId?: string | undefined,
    projectId?: string | undefined
  ): ActiveRunSession {
    const session = this.runs.get(runId);
    if (!session) {
      throw new NotFoundError(`AgentRun '${runId}'`);
    }

    if (tenantId && session.tenantId !== tenantId) {
      throw new NotFoundError(`AgentRun '${runId}'`);
    }
    if (projectId && session.projectId !== projectId) {
      throw new NotFoundError(`AgentRun '${runId}'`);
    }

    return session;
  }

  private formatRun(session: ActiveRunSession): AgentRun {
    session.updatedAt = Date.now();
    const stablePayload: Record<string, unknown> = {
      tenantId: session.tenantId,
      projectId: session.projectId,
      agentId: session.agentId,
      role: session.role,
      state: session.stateMachine.getState(),
      intent: session.intent,
      plan: session.plan
    };
    const runHash = AuditEventLog.computeRunHash(stablePayload);

    return {
      id: session.runId,
      tenantId: session.tenantId,
      projectId: session.projectId,
      agentId: session.agentId,
      role: session.role,
      state: session.stateMachine.getState(),
      intent: session.intent,
      plan: session.plan,
      budget: session.budgetTracker.getBudget(),
      budgetUsage: session.budgetTracker.getUsage(),
      memory: session.memoryStore.getSnapshot(),
      events: session.auditLog.getEvents(),
      runHash,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      error: session.error,
      confirmationRequested: session.confirmationRequested ?? false
    };
  }
}
