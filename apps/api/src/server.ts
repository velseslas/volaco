import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, type AppConfig } from '../../../packages/core/src/config.js';
import { logger, generateRequestId } from '../../../packages/core/src/logger.js';
import { AppError, NotFoundError } from '../../../packages/core/src/errors.js';
import { metricsCollector } from '../../../packages/core/src/observability/metrics.js';
import { releaseAiSlot, tryAcquireAiSlot } from '../../../packages/core/src/observability/runtime-metrics.js';
import { auditStore } from '../../../packages/core/src/observability/audit.js';
import { getHealthResponse } from './routes/health.js';
import { extractRequestContext } from './middleware/auth.js';
import type { RequestContext } from './middleware/auth.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleProjectsRoutes } from './routes/projects.js';
import { handleDashboardRoutes } from './routes/dashboard.js';
import { handleFilesRoutes } from './routes/files.js';
import { handleTerminalRoutes } from './routes/terminal.js';
import { handlePreviewBuilderRoutes } from './routes/preview-builder.js';
import { handleAppGeneratorRoutes } from './routes/app-generator.js';
import { handleAppEditRoutes } from './routes/app-edit.js';
import { handleMcpRoutes } from './routes/mcp.js';
import { handleImageRoutes } from './routes/images.js';
import { handleExecutionRoutes } from './routes/executions.js';
import { handleSettingsRoutes } from './routes/settings.js';
import { handleRevisionsRoutes } from './routes/revisions.js';
import { handleObservabilityRoutes } from './routes/observability.js';
import { handleWorkspaceRoutes } from './routes/workspace.js';
import { handleProjectStateRoutes } from './routes/project-state.js';
import { handleStudioRoutes } from './routes/studio.js';
import { handleActivityRoutes } from './routes/activity.js';
import { handleAuditRoutes } from './routes/audit.js';
import { handleFeatureIntelligenceRoutes } from './routes/feature-intelligence.js';
import { handleFeedbackRoutes } from './routes/feedback.js';
import { handleStrategyRoutes } from './routes/strategy.js';
import { handleConversationRoutes, configureConversationIntelligenceService } from './routes/conversation.js';
import { handleRenderRoutes } from './routes/render.js';
import { handleAiProxyRoutes } from './routes/ai-proxy.js';
import { handleDecideRoutes, configureDecideRoute } from './routes/decide.js';
import { handleOrchestrateRoutes, configureOrchestratorService } from './routes/orchestrate.js';
import { handleAgentExecutionRoutes, configureAgentExecutionRoute } from './routes/agent-execution.js';
import { handleDnaRoutes, configureDnaRoute } from './routes/dna.js';
import { handleDecisionsRoutes, configureDecisionsRoute } from './routes/decisions.js';
import { handleRepairRoutes } from './routes/repair.js';
import { handleDesignRoutes } from './routes/design.js';
import { handleVisualRoutes } from './routes/visual.js';
import { ConversationIntelligenceService } from '../../../packages/core/src/ai-native/conversation-intelligence/service.js';
import { AgentRuntimeService } from '../../../packages/core/src/ai-native/agent-runtime/service.js';
import { aiProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import { GeminiProviderAdapter } from '../../../packages/core/src/ai/providers/gemini-adapter.js';
import { MistralProviderAdapter } from '../../../packages/core/src/ai/providers/mistral-adapter.js';
import { AIProviderRegistryLLMAdapter } from '../../../packages/core/src/ai-native/agent-runtime/llm/provider-bridge.js';
import { DefaultReasoningProvider } from '../../../packages/core/src/ai-native/conversation-intelligence/provider/reasoning-provider.js';
import { LLMReasoningProvider } from '../../../packages/core/src/ai-native/conversation-intelligence/provider/llm-reasoning-provider.js';
import { fileStore } from '../../../packages/core/src/file-explorer/store.js';
import { FileStoreAdapter } from '../../../packages/core/src/ai-native/mutation-orchestrator/filesystem/adapter.js';
import { CodeIntelligenceService } from '../../../packages/core/src/ai-native/understanding/service.js';
import { ApplicationDNAService } from '../../../packages/core/src/ai-native/dna/service.js';
import { ContextAssemblyService } from '../../../packages/core/src/ai-native/context/service.js';
import { SemanticCodeGraphService } from '../../../packages/core/src/ai-native/semantic-graph/service.js';
import { ImpactIntelligenceService } from '../../../packages/core/src/ai-native/impact-intelligence/service.js';
import { MutationOrchestratorService } from '../../../packages/core/src/ai-native/mutation-orchestrator/service.js';
import { DecisionEngine } from '../../../packages/core/src/ai-native/decision-engine/decision-engine.js';
import { ConstraintRegistry } from '../../../packages/core/src/ai-native/decision-engine/constraint-registry.js';
import { DecisionLedger } from '../../../packages/core/src/ai-native/decision-engine/decision-ledger.js';
import { AlternativeGenerator } from '../../../packages/core/src/ai-native/decision-engine/alternative-generator.js';
import { AnalystRegistry } from '../../../packages/core/src/ai-native/intelligence-pool/analysts/index.js';
import { AIOrchestratorService } from '../../../packages/core/src/ai-native/ai-orchestrator/service.js';
import { ApplicationUnderstandingService } from '../../../packages/core/src/ai-native/application-understanding/service.js';

/**
 * Branche le moteur conversationnel sur un vrai fournisseur IA (Gemini ou Mistral,
 * selon la clé API disponible dans l'environnement) au lieu du simulateur par
 * défaut. Si aucune clé n'est configurée, on garde volontairement le simulateur
 * (MockLLMProvider) — avec l'avertissement déjà en place dans AgentRuntimeService —
 * plutôt que de faire planter le serveur au démarrage.
 */
function bootstrapConversationEngine(): void {
  if (!aiProviderRegistry.get('gemini')) {
    aiProviderRegistry.register(new GeminiProviderAdapter());
  }
  if (!aiProviderRegistry.get('mistral')) {
    aiProviderRegistry.register(new MistralProviderAdapter());
  }

  const hasRealProvider = Boolean(process.env.GEMINI_API_KEY) || Boolean(process.env.MISTRAL_API_KEY);

  // CRITIQUE — Sans ce bloc, le constructeur de ConversationIntelligenceService
  // tombe sur `new DefaultReasoningProvider()` (réponses FR canned type
  // "Plan d'ingénierie structuré élaboré pour satisfaire l'objectif : X.").
  // L'utilisateur voyait ces réponses en dur malgré les 4s de latence /turns,
  // parce que le LLM n'était appelé QUE pour classifier l'intent (intent-engine)
  // mais PAS pour générer la reply. Avec ce bloc, le LLM (Mistral) devient le
  // cerveau du ReasoningProvider, avec repli automatique sur Default en cas
  // d'échec (timeout, JSON malformé, clé morte, etc.).
  let reasoningProvider: import('../../../packages/core/src/ai-native/conversation-intelligence/types.js').ReasoningProvider =
    new DefaultReasoningProvider();

  if (hasRealProvider) {
    const llmAdapter = new AIProviderRegistryLLMAdapter(aiProviderRegistry, {
      requirements: {
        preferredProviderId: process.env.MISTRAL_API_KEY ? 'mistral' : 'gemini'
      }
    });

    const callLLM = async (systemPrompt: string, userPrompt: string): Promise<string> => {
      const llmRequest = {
        messages: [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: userPrompt }
        ],
        maxTokens: 1024,
        temperature: 0.2,
        metadata: { requestId: 'req_llm_reasoning', tenantId: 'studio-local', userId: 'OWNER' }
      };
      const response = await llmAdapter.generate(llmRequest);
      return response.text || '';
    };

    reasoningProvider = new LLMReasoningProvider(callLLM, new DefaultReasoningProvider());
  }

  // LOT 1 — Brancher le cerveau : les services d'intelligence applicative
  // (Application Model, DNA, Impact, RAG…) existaient, étaient testés, mais
  // étaient injectés à `undefined` — donc inactifs dans le chemin réel.
  // Recette identique aux tests agent-runtime : FileStoreAdapter (le vrai
  // FileStore virtuel) alimente CodeIntelligence, dont découlent DNA, Context,
  // SemanticGraph, Impact et Mutation.
  const fileSource = new FileStoreAdapter(fileStore);
  const codeIntelService = new CodeIntelligenceService(fileSource);
  const dnaService = new ApplicationDNAService(codeIntelService);
  const contextService = new ContextAssemblyService(codeIntelService, dnaService, fileSource);
  const semanticGraphService = new SemanticCodeGraphService(codeIntelService, dnaService, fileSource);
  const impactService = new ImpactIntelligenceService(semanticGraphService);
  const mutationService = new MutationOrchestratorService(
    fileSource, codeIntelService, dnaService, semanticGraphService, impactService
  );

  const agentRuntime = new AgentRuntimeService(
    mutationService,
    codeIntelService,
    dnaService,
    contextService,
    semanticGraphService,
    impactService,
    hasRealProvider
      ? new AIProviderRegistryLLMAdapter(aiProviderRegistry, {
          // Même correctif qu'ailleurs : préférer explicitement le fournisseur
          // dont la clé est réellement configurée, plutôt que de laisser le
          // registre choisir arbitrairement (bug trouvé en testant : Gemini
          // pouvait être choisi sans clé alors que Mistral en avait une).
          requirements: {
            preferredProviderId: process.env.MISTRAL_API_KEY ? 'mistral' : 'gemini'
          }
        })
      : undefined
  );

  // 5e argument = reasoningProvider. Sans lui, le service utilise
  // DefaultReasoningProvider (canned strings). On passe le LLM câblé au-dessus.
  const conversationServiceInstance = new ConversationIntelligenceService(undefined, undefined, agentRuntime, undefined, reasoningProvider);
  configureConversationIntelligenceService(conversationServiceInstance);

  // LOT 1 — Decision Engine (Phase 9.5) et AI Orchestrator (Phase 9) : les
  // routes existaient mais n'étaient ni configurées ni montées. Le Decision
  // Engine devient l'autorité décisionnelle consultable, l'Orchestrator peut
  // orchestrer un plan avec les mêmes services d'intelligence.
  const decisionLedger = new DecisionLedger();
  const decisionEngine = new DecisionEngine({
    constraintRegistry: new ConstraintRegistry(),
    decisionLedger,
    alternativeGenerator: new AlternativeGenerator()
  });
  configureDecideRoute({ decisionEngine, analystRegistry: new AnalystRegistry(), fileStore });

  // ÉTAPE 5 — ADR réels exposés (GET /decisions) pour le panneau Décisions.
  configureDecisionsRoute(decisionLedger);

  const understandingService = new ApplicationUnderstandingService(
    semanticGraphService, dnaService, impactService, codeIntelService
  );
  // ÉTAPE 32 — le même service orchestrateur alimente la route d'exécution
  // unitaire d'agent (le reference-agent est enregistré dans son roster).
  const orchestratorInstance = new AIOrchestratorService(
    understandingService, impactService, mutationService, dnaService, semanticGraphService, aiProviderRegistry,
    undefined,
    fileSource // ÉTAPE 35 — observateur réel : vérification/rollback sur le FileStore
  );
  configureOrchestratorService(orchestratorInstance);
  configureAgentExecutionRoute(orchestratorInstance);

  // ÉTAPE 33 — pont Conversation → Agent : l'exécuteur d'agents du
  // orchestrateur (AgentExecutionService É32 — source unique) est attaché au
  // pont conversationnel. Les intentions supportées sont routées vers le
  // reference-agent (routage déterministe), les autres échouent honnêtement
  // (UNSUPPORTED_INTENT) au lieu du chemin Agent Runtime.
  conversationServiceInstance.attachAgentExecutor({
    execute: (request) => orchestratorInstance.executeAgent(request),
    getRegistry: () => orchestratorInstance.getExecutionAgentRegistry()
  });

  // LOT 3 — la DNA réelle devient consultable (GET /dna) au lieu du
  // manifeste fictif affiché par le Studio.
  configureDnaRoute(dnaService);

  if (!hasRealProvider) {
    logger.warn(
      "Aucune clé API IA (GEMINI_API_KEY / MISTRAL_API_KEY) trouvée — le moteur conversationnel utilisera le simulateur.",
      { component: 'server-bootstrap' }
    );
  }
}

/**
 * En-têtes de sécurité de base (CDC Annexe F — Security Baseline), appliqués
 * à TOUTES les réponses. Additifs et non cassants.
 *
 * EXCEPTION DOCUMENTÉE (Annexe F : « toute exception doit être documentée et
 * limitée ») : la Content-Security-Policy stricte n'est PAS appliquée à la
 * page Studio tant que le preview utilise un iframe srcdoc — un document
 * srcdoc hérite de la CSP de son parent, et les applications générées
 * chargent des CDNs arbitraires (Tailwind, FontAwesome, chart.js…) : une
 * CSP parente les casserait. La CSP sera introduite à l'étape « fichiers
 * matérialisés sur disque », quand les previews seront servis comme vrais
 * documents HTTP avec leur propre CSP. Exception temporaire, tracée ici.
 */
function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

/**
 * Applique les en-têtes CORS. Si `CORS_ALLOWED_ORIGINS` n'est pas défini (comportement
 * historique), tous les sites sont autorisés (comme avant). Si elle est définie, seuls
 * les sites listés (ou '*' explicite dans la liste) sont acceptés.
 */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse, config: AppConfig): void {
  const requestOrigin = req.headers['origin'];
  const allowList = config.corsAllowedOrigins;

  // Défaut fermé : sans CORS_ALLOWED_ORIGINS, AUCUNE en-tête ACAO n'est émise.
  // Les requêtes same-origin du Studio (servi par ce même serveur) continuent
  // de fonctionner — CORS ne s'applique qu'aux origines croisées. Avant ce
  // correctif, le défaut était '*' : n'importe quel site web visité par
  // l'utilisateur pouvait appeler l'API locale (consommation de la clé IA,
  // écriture de fichiers projets, etc.).
  if (allowList.length === 0) {
    return;
  }

  if (allowList.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (typeof requestOrigin === 'string' && allowList.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
  }
  // Sinon : aucun en-tête Access-Control-Allow-Origin -> le navigateur du site
  // non autorisé bloquera lui-même la requête cross-origin.

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id, X-Tenant-Id, X-User-Role, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
}

// --- Rate limiting en mémoire (par IP + catégorie de route) -----------------
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_API_MAX = 600;   // requêtes /api génériques / minute / IP
const RATE_LIMIT_AI_MAX = 60;     // appels proxy IA / minute / IP (quota Mistral)

const rateBuckets = new Map<string, { count: number; windowStart: number }>();

/**
 * Fenêtre glissante simplifiée (compteur par minute). Retourne false si la
 * limite est dépassée. Le bucket est purgé périodiquement pour éviter toute
 * fuite mémoire face à des IPs usurpées.
 */
function checkRateLimit(req: IncomingMessage, pathname: string): boolean {
  const isAiRoute = pathname.startsWith('/api/v1/ai/');
  const ip = req.socket.remoteAddress || 'unknown';
  const key = `${ip}:${isAiRoute ? 'ai' : 'api'}`;
  const max = isAiRoute ? RATE_LIMIT_AI_MAX : RATE_LIMIT_API_MAX;
  const now = Date.now();

  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    if (rateBuckets.size > 10_000) {
      for (const [k, b] of rateBuckets) {
        if (now - b.windowStart >= RATE_LIMIT_WINDOW_MS) {
          rateBuckets.delete(k);
        }
      }
    }
    rateBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

// --- Mini-routeur : table de routes API déclarative --------------------------
// ÉTAPE 2 : remplace la longue chaîne if-return. L'ordre des entrées est une
// priorité STRICTE (la première qui répond true termine la requête). Pour
// ajouter une route : une entrée ici, c'est tout.
type RouteHandler = (
  req: IncomingMessage, res: ServerResponse, pathname: string,
  context: RequestContext, requestId: string
) => Promise<boolean> | boolean;

interface RouteEntry {
  readonly name: string;
  readonly handler: RouteHandler;
}

// Enrobe les handlers avec effet d'audit lié au POST (comportement historique
// du dispatcher conservé à l'identique).
const projectsWithAudit: RouteHandler = async (req, res, pathname, context, requestId) => {
  const handled = await handleProjectsRoutes(req, res, pathname, context, requestId);
  if (handled && req.method === 'POST') {
    auditStore.record({
      tenantId: context.tenantId,
      userId: context.role,
      action: 'PROJECT_CREATE',
      resourceType: 'PROJECT',
      resourceId: 'new',
      status: 'SUCCESS',
      requestId
    });
  }
  return handled;
};

const revisionsWithAudit: RouteHandler = async (req, res, pathname, context, requestId) => {
  const handled = await handleRevisionsRoutes(req, res, pathname, context, requestId);
  if (handled && req.method === 'POST') {
    auditStore.record({
      tenantId: context.tenantId,
      userId: context.role,
      action: pathname.endsWith('/rollback') ? 'ROLLBACK_TRIGGERED' : 'REVISION_CREATE',
      resourceType: 'REVISION',
      resourceId: 'action',
      status: 'SUCCESS',
      requestId
    });
  }
  return handled;
};

const API_ROUTES: readonly RouteEntry[] = [
  { name: 'auth (JWT)', handler: handleAuthRoutes },
  { name: 'observability (FND-005)', handler: handleObservabilityRoutes },
  { name: 'dashboard (CORE-002)', handler: handleDashboardRoutes },
  { name: 'workspace (CAPP-001)', handler: handleWorkspaceRoutes },
  { name: 'project-state (CAPP-004)', handler: handleProjectStateRoutes },
  { name: 'studio-shell (CAPP-005)', handler: handleStudioRoutes },
  { name: 'activity/history (CAPP-007)', handler: handleActivityRoutes },
  { name: 'application-audit (AINT-013)', handler: handleAuditRoutes },
  { name: 'feature-intelligence (AINT-014)', handler: handleFeatureIntelligenceRoutes },
  { name: 'user-feedback (AINT-015)', handler: handleFeedbackRoutes },
  { name: 'ai-strategy (AINT-016)', handler: handleStrategyRoutes },
  { name: 'conversation (SSE)', handler: handleConversationRoutes },
  { name: 'decide (Phase 9.5)', handler: handleDecideRoutes },
  { name: 'orchestrate (Phase 9)', handler: handleOrchestrateRoutes },
  { name: 'agents/execute (ÉTAPE 32)', handler: handleAgentExecutionRoutes },
  { name: 'render (headless)', handler: handleRenderRoutes },
  { name: 'dna (AINT-002)', handler: handleDnaRoutes },
  { name: 'decisions (ADR)', handler: handleDecisionsRoutes },
  { name: 'visual-critic (AINT-012)', handler: handleVisualRoutes },
  { name: 'design-intelligence (V8)', handler: handleDesignRoutes },
  { name: 'self-repair (ÉTAPE 7)', handler: handleRepairRoutes },
  { name: 'ai-proxy', handler: handleAiProxyRoutes },
  { name: 'files (CORE-003/004)', handler: handleFilesRoutes },
  { name: 'terminal (CORE-005)', handler: handleTerminalRoutes },
  { name: 'executions (Transparency)', handler: handleExecutionRoutes },
  { name: 'preview-builder (NOUVEAU preview)', handler: handlePreviewBuilderRoutes },
  { name: 'app-generator (P1/P2 — React réel)', handler: handleAppGeneratorRoutes },
  { name: 'app-edit (P3 — édition IA par fichiers)', handler: handleAppEditRoutes },
  { name: 'mcp (P3 — Model Context Protocol)', handler: handleMcpRoutes },
  { name: 'images (P4 — génération d images)', handler: handleImageRoutes },
  { name: 'settings (CORE-006)', handler: handleSettingsRoutes },
  { name: 'projects (FND-003)', handler: projectsWithAudit },
  { name: 'revisions (FND-004)', handler: revisionsWithAudit }
];

export function createApiServer(configOverride: Partial<AppConfig> = {}) {
  const config = loadConfig(configOverride);
  bootstrapConversationEngine();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const startTime = performance.now();

    const incomingReqId = req.headers['x-request-id'];
    const requestId = typeof incomingReqId === 'string' && incomingReqId.trim().length > 0
      ? incomingReqId.trim()
      : generateRequestId();

    res.setHeader('X-Request-Id', requestId);
    setCorsHeaders(req, res, config);
    setSecurityHeaders(res);

    res.on('finish', () => {
      const durationMs = Math.round(performance.now() - startTime);
      metricsCollector.recordRequest(res.statusCode, durationMs);
    });

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const host = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = parsedUrl.pathname;

    try {
      // 0bis. Endpoints d'observation volontairement publics (monitoring,
      // lanceur) : traités AVANT le contrôle d'accès, qui s'applique à tout
      // le reste.
      if (req.method === 'GET' && (pathname === '/health' || pathname === `${config.apiPrefix}/health`)) {
        const payload = getHealthResponse(config, requestId);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify(payload));
        return;
      }
      if (req.method === 'GET' && (pathname === '/status' || pathname === `${config.apiPrefix}/status`)) {
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({
          status: 'ready',
          phase: 'PHASE-2',
          architecture: 'MODULAR_MONOLITH',
          requestId
        }));
        return;
      }

      // Contexte d'authentification — DOIT recevoir la config : sans elle, la
      // vérification du Bearer n'était jamais exécutée et toutes les routes
      // répondaient sans authentification. Peut lever UnauthorizedError (401)
      // en production sans token valide, d'où sa place dans le try.
      const context = extractRequestContext(req, config, requestId);
      // P5 — SEMAPHORE DE CONCURRENCE IA : les opérations lourdes (LLM,
      // builds, images) sont bornées (VOLACO_MAX_CONCURRENT_AI, défaut 3).
      // Au-delà : 503 + Retry-After — jamais de surcharge du process.
      const isAiHeavy = req.method === 'POST' && (
        /\/app\/(generate|edit|apply-edits)$/.test(pathname) ||
        /\/images\/generate$/.test(pathname) ||
        /\/stream$/.test(pathname)
      );
      if (isAiHeavy && !tryAcquireAiSlot()) {
        res.statusCode = 503;
        res.setHeader('Retry-After', '15');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          error: {
            code: 'AI_BUSY',
            message: 'Une génération IA est déjà en cours — réessayez dans quelques instants.',
            statusCode: 503,
            requestId
          }
        }));
        return;
      }
      if (isAiHeavy) {
        res.on('close', () => releaseAiSlot());
        res.on('finish', () => releaseAiSlot());
      }

      logger.info(
        'RequÃªte HTTP',
        { method: req.method, path: pathname, tenantId: context.tenantId, role: context.role },
        requestId
      );

      // Rate limiting minimal en mémoire (anti-martèlement / anti-DoS simple).
      // Le proxy IA a une limite plus stricte : chaque appel consomme le quota
      // de la clé Mistral du serveur.
      if (pathname.startsWith('/api') && !checkRateLimit(req, pathname)) {
        res.statusCode = 429;
        res.setHeader('Retry-After', '60');
        res.end(JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Trop de requêtes — réessayez dans une minute.',
            statusCode: 429,
            requestId
          }
        }));
        return;
      }

      // 0. Distribution Statique du Workspace Studio et de ses Ressources
      if (req.method === 'GET') {
        if (pathname === '/' || pathname === '/index.html' || pathname === '/volaco_studio.html' || pathname === '/shell' || pathname === '/studio') {
          const candidatePaths = [
            join(process.cwd(), 'apps/studio/index.html')
          ];
          for (const p of candidatePaths) {
            if (existsSync(p)) {
              const html = readFileSync(p, 'utf8');
              // Le Studio évolue à chaque correctif : jamais de cache navigateur
              // (sinon l'usager reste sur une page périmée après un restart).
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.statusCode = 200;
              res.end(html);
              return;
            }
          }
        }
        // Fichiers statiques annexes du Studio (html2canvas, client.js, etc.)
        const staticStudioFile = pathname.replace(/^\//, '');
        if (staticStudioFile && !staticStudioFile.includes('..') && !pathname.startsWith('/api')) {
          const candidateAssetPaths = [
            join(process.cwd(), 'apps/studio', staticStudioFile)
          ];
          for (const ap of candidateAssetPaths) {
            if (existsSync(ap) && statSync(ap).isFile()) {
              const ext = staticStudioFile.split('.').pop()?.toLowerCase();
              const mimeMap: Record<string, string> = {
                'js': 'application/javascript; charset=utf-8',
                'css': 'text/css; charset=utf-8',
                'html': 'text/html; charset=utf-8',
                'json': 'application/json; charset=utf-8',
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'svg': 'image/svg+xml'
              };
              res.setHeader('Content-Type', mimeMap[ext || ''] || 'application/octet-stream');
              res.statusCode = 200;
              res.end(readFileSync(ap));
              return;
            }
          }
        }
      }

      // 1-2. /health et /status sont traités plus haut (endpoints publics).

      // 3+. Routes API — table déclarative, ordre de priorité STRICT
      // (la première entrée qui répond true termine la requête).
      res.setHeader('Content-Type', 'application/json');
      for (const route of API_ROUTES) {
        const handled = await route.handler(req, res, pathname, context, requestId);
        if (handled) return;
      }

      // Route non trouvée
      throw new NotFoundError(pathname, requestId);
    } catch (err: unknown) {
      res.setHeader('Content-Type', 'application/json');
      if (err instanceof AppError) {
        res.statusCode = err.statusCode;
        res.end(JSON.stringify(err.toJSON()));
      } else {
        const message = err instanceof Error ? err.message : 'Erreur inconnue';
        const errObj = new AppError('Erreur interne du serveur', 'INTERNAL_ERROR', 500, { original: message }, requestId);
        res.statusCode = 500;
        res.end(JSON.stringify(errObj.toJSON()));
      }
    }
  });

  return { server, config };
}

// Démarrage autonome si exécuté directement
const isMain = process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server.ts'));
if (isMain) {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile();
    } catch {
      // Ignorer si .env est absent
    }
  }

  // FILET DE SÉCURITÉ CRITIQUE — corrige un bug réel signalé par un
  // utilisateur : sans ceci, une seule erreur imprévue survenant en dehors
  // du traitement direct d'une requête (une promesse rejetée sans .catch
  // quelque part dans le code) arrête TOUT le processus Node.js en silence.
  // Le serveur semble alors avoir "planté sans raison" et toutes les
  // requêtes suivantes échouent en ERR_CONNECTION_REFUSED, même la simple
  // page d'accueil. On journalise l'erreur au lieu de laisser le serveur
  // mourir silencieusement.
  process.on('uncaughtException', (err) => {
    logger.warn('Exception non interceptée — le serveur continue de fonctionner', {
      component: 'process-safety-net',
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
  });
  process.on('unhandledRejection', (reason) => {
    logger.warn('Promesse rejetée sans gestion — le serveur continue de fonctionner', {
      component: 'process-safety-net',
      error: reason instanceof Error ? reason.message : String(reason)
    });
  });

  const { server, config } = createApiServer();
  server.listen(config.port, () => {
    console.log(`==================================================`);
    console.log(`ðŸš€ VIBECODE STUDIO CORE DÃ‰MARRÃ‰ SUR LE PORT ${config.port}`);
    console.log(`ðŸ–¥ï¸  Interface Studio : http://127.0.0.1:${config.port}/`);
    console.log(`ðŸ©º Healthcheck API   : http://127.0.0.1:${config.port}/health`);
    console.log(`==================================================`);
  });
}
