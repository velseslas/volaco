/**
 * VibeCode Core - AI Provider Architecture Unit & Integration Tests
 * Comprehensive validation of multi-provider abstraction, registry, adapters,
 * intelligent routing, multi-tenant isolation, resilience, and security.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIProviderRegistry,
  MistralProviderAdapter,
  GeminiProviderAdapter,
  ReasoningOrchestrator,
  AIProviderAuthError,
  AIProviderError,
  AIProviderTimeoutError,
  type AIProviderAdapter,
  ConversationIntelligenceService,
  aiUsageTracker,
  DefaultReasoningProvider,
  classifyIntent,
  type TurnMemory,
  type ProjectMemory
} from '../../src/index.js';

const emptyTurnMemory: TurnMemory = {
  recentMessages: [],
  currentAssumptions: []
};

const emptyProjectMemory: ProjectMemory = {
  architecturalDecisions: [],
  userPreferences: {},
  acceptedPlans: [],
  rejectedPlans: [],
  knownConstraints: [],
  knownConventions: [],
  knownRisks: []
};

describe('AI Provider Abstraction & Multi-Provider Architecture Tests', () => {
  let registry: AIProviderRegistry;
  const tenantA = 'tenant-alpha';
  const tenantB = 'tenant-beta';
  const projectId = 'proj-core-test';

  beforeEach(() => {
    registry = new AIProviderRegistry();
    aiUsageTracker.clear();
  });

  // ==========================================
  // 1. REGISTRY & INTELLIGENT ROUTING
  // ==========================================
  describe('1. AIProviderRegistry & Capability Routing', () => {
    it('doit enregistrer, lister et supprimer des adaptateurs', () => {
      const mistral = new MistralProviderAdapter();
      const gemini = new GeminiProviderAdapter();

      registry.register(mistral);
      registry.register(gemini);

      const list = registry.list();
      assert.equal(list.length, 2);
      assert.ok(list.some((d) => d.providerId === 'mistral'));
      assert.ok(list.some((d) => d.providerId === 'gemini'));

      assert.equal(registry.get('mistral')?.descriptor.providerName, 'Mistral AI');
      assert.equal(registry.get('gemini')?.descriptor.providerName, 'Google Gemini');

      const deleted = registry.unregister('mistral');
      assert.equal(deleted, true);
      assert.equal(registry.get('mistral'), undefined);
      assert.equal(registry.list().length, 1);
    });

    it('doit router vers le provider de génération de code pour taskKind CODE_GENERATION', () => {
      registry.register(new MistralProviderAdapter());
      registry.register(new GeminiProviderAdapter());

      const resolved = registry.resolve({ taskKind: 'CODE_GENERATION' });
      assert.ok(resolved);
      assert.equal(resolved.descriptor.providerId, 'mistral');
      assert.ok(resolved.descriptor.capabilities.includes('CODE_GENERATION'));
    });

    it('doit router vers le provider à large contexte pour taskKind LARGE_CONTEXT', () => {
      registry.register(new MistralProviderAdapter()); // contextWindow: 131072
      registry.register(new GeminiProviderAdapter());  // contextWindow: 1048576

      const resolved = registry.resolve({ taskKind: 'LARGE_CONTEXT' });
      assert.ok(resolved);
      assert.equal(resolved.descriptor.providerId, 'gemini');
      assert.equal(resolved.descriptor.contextWindow, 1048576);
    });

    it('doit respecter le preferredProviderId s il est disponible', () => {
      registry.register(new MistralProviderAdapter());
      registry.register(new GeminiProviderAdapter());

      const resolved = registry.resolve({ preferredProviderId: 'gemini', taskKind: 'CODE_GENERATION' });
      assert.ok(resolved);
      assert.equal(resolved.descriptor.providerId, 'gemini');
    });

    it('doit filtrer selon le minContextWindow exigé', () => {
      registry.register(new MistralProviderAdapter()); // 131072
      registry.register(new GeminiProviderAdapter());  // 1048576

      const resolved = registry.resolve({ minContextWindow: 500000 });
      assert.ok(resolved);
      assert.equal(resolved.descriptor.providerId, 'gemini');
    });

    it('doit retourner undefined si aucun provider n est disponible ou enregistré', () => {
      const resolved = registry.resolve({ taskKind: 'CODE_GENERATION' });
      assert.equal(resolved, undefined);
    });
  });

  // ==========================================
  // 2. MISTRAL ADAPTER (PRODUCTION BACKEND)
  // ==========================================
  describe('2. MistralProviderAdapter Tests', () => {
    it('doit rejeter avec AIProviderAuthError si aucune clé API n est fournie', async () => {
      const originalEnv = process.env.MISTRAL_API_KEY;
      delete process.env.MISTRAL_API_KEY;

      try {
        const adapter = new MistralProviderAdapter();
        await assert.rejects(
          async () => {
            await adapter.generate({
              tenantId: tenantA,
              projectId,
              prompt: 'Bonjour'
            });
          },
          (err: unknown) => {
            assert.ok(err instanceof AIProviderAuthError);
            assert.equal(err.providerId, 'mistral');
            assert.equal(err.statusCode, 401);
            return true;
          }
        );
      } finally {
        if (originalEnv) process.env.MISTRAL_API_KEY = originalEnv;
      }
    });

    it('doit appeler l API Mistral et formater correctement la réponse avec calcul de tokens et coût', async () => {
      let interceptedHeaders: unknown;
      let interceptedBody: string | undefined;

      const mockFetch: typeof fetch = async (_url, init) => {
        interceptedHeaders = init?.headers;
        interceptedBody = init?.body as string;

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '```html\n<div>Application de test générée</div>\n```'
                }
              }
            ],
            usage: {
              prompt_tokens: 150,
              completion_tokens: 80,
              total_tokens: 230
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      };

      const adapter = new MistralProviderAdapter(mockFetch);
      const res = await adapter.generate(
        {
          tenantId: tenantA,
          projectId,
          prompt: 'Crée un CRM pour PME',
          model: 'codestral-latest',
          temperature: 0.1
        },
        {
          tenantId: tenantA,
          providerId: 'mistral',
          apiKey: 'mock-test-secret-key-12345'
        }
      );

      assert.equal(res.providerId, 'mistral');
      assert.equal(res.modelId, 'codestral-latest');
      assert.ok(res.text.includes('Application de test générée'));
      assert.equal(res.usage.inputTokens, 150);
      assert.equal(res.usage.outputTokens, 80);
      assert.equal(res.usage.totalTokens, 230);
      assert.ok(res.costUsd > 0);

      // Verify request payload
      assert.ok(interceptedHeaders);
      assert.equal((interceptedHeaders as Record<string, string>)['Authorization'], 'Bearer mock-test-secret-key-12345');
      const parsedBody = JSON.parse(interceptedBody!);
      assert.equal(parsedBody.model, 'codestral-latest');
      assert.equal(parsedBody.temperature, 0.1);
      assert.equal(parsedBody.messages[parsedBody.messages.length - 1].content, 'Crée un CRM pour PME');

      // Verify usage tracker recorded the cost
      // É48 P4 — 1 appel = 2 événements (START coût 0 + SUCCESS coût réel) ;
      // les tokens/coût totaux ne comptent que le réel (230, inchangé).
      const summary = aiUsageTracker.getUsageSummary(tenantA, projectId);
      assert.equal(summary.recordCount, 2);
      assert.equal(summary.totalTokens, 230);
    });

    it('doit déclencher AIProviderTimeoutError en cas de timeout dépassé', async () => {
      const slowFetch: typeof fetch = async (_url, init) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              const abortErr = new Error('The operation was aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          }
        });
      };

      const adapter = new MistralProviderAdapter(slowFetch);
      await assert.rejects(
        async () => {
          await adapter.generate(
            {
              tenantId: tenantA,
              projectId,
              prompt: 'Recherche lente',
              timeoutMs: 20
            },
            {
              tenantId: tenantA,
              providerId: 'mistral',
              apiKey: 'mock-key'
            }
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof AIProviderTimeoutError);
          assert.equal(err.providerId, 'mistral');
          assert.equal(err.timeoutMs, 20);
          return true;
        }
      );
    });

    it('doit masquer tout token dans les erreurs retournées par l API', async () => {
      const errorFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            message: 'Invalid key Bearer secret_live_key_99999 provided to Mistral API'
          }),
          { status: 401 }
        );
      };

      const adapter = new MistralProviderAdapter(errorFetch);
      await assert.rejects(
        async () => {
          await adapter.generate(
            {
              tenantId: tenantA,
              projectId,
              prompt: 'Test secret leakage'
            },
            {
              tenantId: tenantA,
              providerId: 'mistral',
              apiKey: 'secret_live_key_99999'
            }
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof AIProviderError);
          assert.equal(err.message.includes('secret_live_key_99999'), false);
          assert.ok(err.message.includes('Bearer ***'));
          return true;
        }
      );
    });
  });

  // ==========================================
  // 3. GEMINI ADAPTER TESTS
  // ==========================================
  describe('3. GeminiProviderAdapter Tests', () => {
    it('doit formater les requêtes au format Google Gemini et extraire la réponse', async () => {
      let interceptedHeaders: unknown;
      let interceptedBody: string | undefined;

      const mockFetch: typeof fetch = async (_url, init) => {
        interceptedHeaders = init?.headers;
        interceptedBody = init?.body as string;

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Architecture système modulaire validée par Gemini.' }]
                }
              }
            ],
            usageMetadata: {
              promptTokenCount: 120,
              candidatesTokenCount: 65,
              totalTokenCount: 185
            }
          }),
          { status: 200 }
        );
      };

      const adapter = new GeminiProviderAdapter(mockFetch);
      const res = await adapter.generate(
        {
          tenantId: tenantA,
          projectId,
          prompt: 'Analyse la cohérence du graphe',
          model: 'gemini-1.5-pro'
        },
        {
          tenantId: tenantA,
          providerId: 'gemini',
          apiKey: 'gemini-secret-api-key'
        }
      );

      assert.equal(res.providerId, 'gemini');
      assert.equal(res.modelId, 'gemini-1.5-pro');
      assert.equal(res.text, 'Architecture système modulaire validée par Gemini.');
      assert.equal(res.usage.totalTokens, 185);

      // Verify Google Gemini specific header
      assert.equal((interceptedHeaders as Record<string, string>)['x-goog-api-key'], 'gemini-secret-api-key');
      const body = JSON.parse(interceptedBody!);
      assert.ok(body.contents);
      assert.equal(body.contents[0].parts[0].text, 'Analyse la cohérence du graphe');
    });

    it('doit streamer les deltas SSE Gemini et compter l’usage final', async () => {
      let interceptedUrl = '';
      let interceptedHeaders: Record<string, string> = {};
      let interceptedBody: string | undefined;
      const sse = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Bon"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"jour"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":" !"}]}}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":3,"totalTokenCount":15}}\n\n'
      ].join('');

      const mockFetch: typeof fetch = async (url, init) => {
        interceptedUrl = String(url);
        interceptedHeaders = (init?.headers ?? {}) as Record<string, string>;
        interceptedBody = init?.body as string;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sse));
            controller.close();
          }
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        });
      };

      const adapter = new GeminiProviderAdapter(mockFetch);
      const chunks: string[] = [];
      for await (const delta of adapter.generateStream(
        {
          tenantId: tenantA,
          projectId,
          prompt: 'Crée une page vitrine',
          systemPrompt: 'Tu es un assistant concis.',
          model: 'gemini-2.5-flash',
          temperature: 0.2,
          maxTokens: 128,
          requestId: 'req-gemini-stream-1'
        },
        {
          tenantId: tenantA,
          providerId: 'gemini',
          apiKey: 'gemini-secret-stream-key'
        }
      )) {
        chunks.push(delta);
      }

      assert.equal(chunks.join(''), 'Bonjour !');
      assert.equal(
        interceptedUrl,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
      );
      assert.equal(interceptedHeaders['x-goog-api-key'], 'gemini-secret-stream-key');
      assert.equal(interceptedHeaders['Accept'], 'text/event-stream');

      const body = JSON.parse(interceptedBody!);
      assert.equal(body.contents[0].role, 'user');
      assert.equal(body.contents[0].parts[0].text, 'Crée une page vitrine');
      assert.equal(body.systemInstruction.parts[0].text, 'Tu es un assistant concis.');
      assert.equal(body.generationConfig.maxOutputTokens, 128);

      // START + SUCCESS réel : les tokens transmis par Gemini sont comptés.
      const summary = aiUsageTracker.getUsageSummary(tenantA, projectId);
      assert.equal(summary.recordCount, 2);
      assert.equal(summary.totalTokens, 15);
    });

    it('refuse le streaming Gemini sans clé, sans appel réseau', async () => {
      const previousKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      try {
        let called = false;
        const adapter = new GeminiProviderAdapter(async () => {
          called = true;
          throw new Error('network must not be called');
        });

        await assert.rejects(
          async () => {
            for await (const _delta of adapter.generateStream({
              tenantId: tenantA,
              projectId,
              prompt: 'Bonjour'
            })) {
              // Aucun delta ne doit arriver sans clé.
            }
          },
          (err: unknown) => {
            assert.ok(err instanceof AIProviderAuthError);
            assert.equal(err.providerId, 'gemini');
            return true;
          }
        );
        assert.equal(called, false);
      } finally {
        if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousKey;
      }
    });
  });

  // ==========================================
  // 4. MULTI-TENANT ISOLATION
  // ==========================================
  describe('4. Multi-Tenant Credentials & Isolation', () => {
    it('doit garantir une étanchéité absolue des credentials entre tenants', () => {
      registry.setTenantCredentials(tenantA, 'mistral', {
        tenantId: tenantA,
        providerId: 'mistral',
        apiKey: 'key-tenant-alpha-exclusive'
      });

      registry.setTenantCredentials(tenantB, 'mistral', {
        tenantId: tenantB,
        providerId: 'mistral',
        apiKey: 'key-tenant-beta-exclusive'
      });

      const credsA = registry.getTenantCredentials(tenantA, 'mistral');
      const credsB = registry.getTenantCredentials(tenantB, 'mistral');

      assert.equal(credsA?.apiKey, 'key-tenant-alpha-exclusive');
      assert.equal(credsB?.apiKey, 'key-tenant-beta-exclusive');

      // Tenant A cannot retrieve Tenant B's credentials
      assert.notEqual(credsA?.apiKey, credsB?.apiKey);

      // A third unknown tenant gets undefined
      assert.equal(registry.getTenantCredentials('tenant-stranger', 'mistral'), undefined);

      // Deleting Tenant A credentials leaves Tenant B untouched
      registry.deleteTenantCredentials(tenantA);
      assert.equal(registry.getTenantCredentials(tenantA, 'mistral'), undefined);
      assert.equal(registry.getTenantCredentials(tenantB, 'mistral')?.apiKey, 'key-tenant-beta-exclusive');
    });
  });

  // ==========================================
  // 5. REASONING ORCHESTRATOR & RESILIENT FALLBACK
  // ==========================================
  describe('5. ReasoningOrchestrator & Fallback Mechanism', () => {
    it('doit déléguer avec succès au provider adapter résolu', async () => {
      const mockAdapter: AIProviderAdapter = {
        descriptor: {
          providerId: 'mock-coder',
          providerName: 'Mock Coder AI',
          models: ['mock-code-v1'],
          capabilities: ['CODE_GENERATION', 'FAST'],
          contextWindow: 65536,
          structuredOutput: true,
          streaming: true,
          toolCalling: true,
          reasoning: true,
          vision: false,
          costMetadata: {},
          availability: 'AVAILABLE',
          healthStatus: 'HEALTHY'
        },
        generate: async () => ({
          text: 'Raisonnement mock réussi pour code.',
          providerId: 'mock-coder',
          modelId: 'mock-code-v1',
          latencyMs: 12,
          usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
          costUsd: 0.0001
        })
      };

      registry.register(mockAdapter);

      const orchestrator = new ReasoningOrchestrator(registry);
      const res = await orchestrator.reason({
        userMessage: 'Crée un bouton bleu',
        history: [],
        intent: await classifyIntent('Crée un bouton bleu'),
        memory: {
          project: emptyProjectMemory,
          turn: emptyTurnMemory
        }
      });

      assert.equal(res.reply, 'Raisonnement mock réussi pour code.');
      assert.equal(res.nextAction, 'PRESENT_PLAN');
      assert.equal(res.metadata?.providerId, 'mock-coder');
      assert.equal(res.metadata?.fallbackUsed, false);
    });

    it('doit basculer vers le DefaultReasoningProvider si le provider primaire échoue (Fallback)', async () => {
      const failingAdapter: AIProviderAdapter = {
        descriptor: {
          providerId: 'failing-provider',
          providerName: 'Failing Provider',
          models: ['fail-model'],
          capabilities: ['CODE_GENERATION'],
          contextWindow: 32000,
          structuredOutput: true,
          streaming: false,
          toolCalling: false,
          reasoning: false,
          vision: false,
          costMetadata: {},
          availability: 'AVAILABLE',
          healthStatus: 'HEALTHY'
        },
        generate: async () => {
          throw new Error('503 Service Unavailable (Quota Exceeded)');
        }
      };

      registry.register(failingAdapter);

      const orchestrator = new ReasoningOrchestrator(registry, new DefaultReasoningProvider(), {
        enableFallback: true
      });

      const res = await orchestrator.reason({
        userMessage: 'Ajoute une route API',
        history: [],
        intent: await classifyIntent('Ajoute une route API'),
        memory: {
          project: emptyProjectMemory,
          turn: emptyTurnMemory
        }
      });

      // Verification: The user request did NOT crash! Fallback answered.
      assert.ok(res.reply.includes("Plan d'ingénierie structuré élaboré"));
      assert.equal(res.nextAction, 'PRESENT_PLAN');
      assert.equal(res.metadata?.fallbackUsed, true);
      assert.ok((res.metadata?.fallbackReason as string).includes('503 Service Unavailable'));
    });

    it('doit utiliser le fallback déterministe hors-ligne si aucun provider n est enregistré', async () => {
      // Empty registry
      const orchestrator = new ReasoningOrchestrator(registry);
      const res = await orchestrator.reason({
        userMessage: 'Explique le fonctionnement du système',
        history: [],
        intent: await classifyIntent('Explique le fonctionnement du système'),
        memory: {
          project: emptyProjectMemory,
          turn: emptyTurnMemory
        }
      });

      assert.ok(res.reply.includes("Explication détaillée"));
      assert.equal(res.metadata?.fallbackUsed, true);
      assert.equal(res.metadata?.providerId, 'offline-default');
    });
  });

  // ==========================================
  // 6. END-TO-END CONVERSATION SERVICE WITH ORCHESTRATOR
  // ==========================================
  describe('6. End-to-End Conversation Intelligence with Provider Orchestrator', () => {
    it('doit traiter un tour complet de conversation avec le ReasoningOrchestrator injecté', async () => {
      const mockAdapter: AIProviderAdapter = {
        descriptor: {
          providerId: 'fast-chat',
          providerName: 'Fast Chat AI',
          models: ['fast-chat-v1'],
          capabilities: ['FAST', 'CODE_GENERATION'],
          contextWindow: 32000,
          structuredOutput: true,
          streaming: false,
          toolCalling: false,
          reasoning: false,
          vision: false,
          costMetadata: {},
          availability: 'AVAILABLE',
          healthStatus: 'HEALTHY'
        },
        generate: async () => ({
          text: 'Analyse conversationnelle effectuée par Fast Chat AI.',
          providerId: 'fast-chat',
          modelId: 'fast-chat-v1',
          latencyMs: 15,
          usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
          costUsd: 0.00005
        })
      };

      registry.register(mockAdapter);
      const orchestrator = new ReasoningOrchestrator(registry);

      const service = new ConversationIntelligenceService(
        undefined,
        undefined,
        undefined,
        undefined,
        orchestrator
      );

      const session = service.createSession({ tenantId: tenantA, projectId });
      const res = await service.processTurn({
        tenantId: tenantA,
        projectId,
        sessionId: session.sessionId,
        message: 'Construis une nouvelle interface'
      });

      assert.equal(res.turn.agentResponse.content, 'Analyse conversationnelle effectuée par Fast Chat AI.');
      assert.ok(res.turn.trace.events.some((e) => e.includes('fast-chat')));
      assert.equal(res.session.turns.length, 1);
    });

    it('doit protéger la session si un provider injecté lève une exception inattendue', async () => {
      const crashingProvider = {
        reason: async () => {
          throw new Error('Fatal socket failure');
        }
      };

      const service = new ConversationIntelligenceService();
      const session = service.createSession({ tenantId: tenantA, projectId });

      const res = await service.processTurn({
        tenantId: tenantA,
        projectId,
        sessionId: session.sessionId,
        message: 'Supprime le fichier index.ts',
        reasoningProvider: crashingProvider
      });

      // Session stays intact, graceful resilient fallback reply generated
      assert.ok(res.turn.agentResponse.content.includes('Instruction prise en compte'));
      assert.ok(res.turn.agentResponse.content.includes('Repli résilient'));
      assert.ok(res.turn.trace.events.some((e) => e.includes('Fallback: true')));
    });
  });
});
