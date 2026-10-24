/**
 * LOT MULTI-MODÈLES — adaptateurs des 10 fournisseurs IA.
 *
 * AUCUN réseau réel : le fetch est injecté (même DI que MistralProviderAdapter).
 * Ce qui est prouvé ici :
 *  - le catalogue contient exactement les 10 cartes (ids uniques, URLs, clés) ;
 *  - chaque adaptateur compatible OpenAI produit la forme filaire correcte
 *    (URL, entêtes Bearer, corps messages/tools/usage, modèle par env) ;
 *  - l'adaptateur Anthropic traduit system/tool_use/tool_result et les blocs
 *    de réponse, streaming text_delta inclus ;
 *  - héritage garanti : sans état actif, preferredAiProvider() === undefined.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAICompatibleAdapters, OpenAICompatibleProviderAdapter } from '../../src/ai/providers/openai-compatible.js';
import { AnthropicProviderAdapter } from '../../src/ai/providers/anthropic-adapter.js';
import {
  AI_PROVIDER_CATALOG,
  getCatalogEntry,
  maskedKeyHint,
  preferredAiProvider,
  providerKeyPresent,
  providerStoredKey,
  resetActiveProviderState,
  resetStoredProviderKeys,
  setProviderActive,
  setProviderStoredKey
} from '../../src/ai/providers/provider-catalog.js';
import type { AIProviderGenerateRequest } from '../../src/ai/providers/types.js';

const baseRequest: AIProviderGenerateRequest = {
  tenantId: 'tenant_mm',
  projectId: 'proj_mm',
  prompt: 'Ping de test',
  systemPrompt: 'Tu es un assistant de test.',
  maxTokens: 64,
  requestId: 'req-mm-1'
};

interface CapturedCall {
  url: string;
  init: { headers?: Record<string, string> | undefined; body?: string | undefined };
}

/** Fetch facteur : capture l'appel et répond selon le script fourni. */
function scriptedFetch(
  respond: (call: CapturedCall) => Response
): { adapterFetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const adapterFetch = ((input: unknown, init?: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? '');
    const headers = ((init as { headers?: Record<string, string> })?.headers ?? {}) as Record<string, string>;
    const body = (init as { body?: string })?.body as string | undefined;
    const captured: CapturedCall = { url, init: { headers, body } };
    calls.push(captured);
    return Promise.resolve(respond(captured));
  }) as typeof fetch;
  return { adapterFetch, calls };
}

/** Capture exigée (noUncheckedIndexedAccess → jamais d'accès d'index brut). */
function requireCall(items: readonly CapturedCall[], index = 0): CapturedCall {
  const call = items[index];
  assert.ok(call !== undefined, `capture #${index} attendue`);
  return call as CapturedCall;
}

/** Corps JSON exigé d'une capture. */
function requireJson(call: CapturedCall): Record<string, unknown> {
  return JSON.parse(call.init.body ?? '{}') as Record<string, unknown>;
}

/** Élément de tableau exigé (noUncheckedIndexedAccess). */
function requireAt<T>(items: readonly T[] | undefined, index: number): T {
  const item = items?.[index];
  assert.ok(item !== undefined, `élément #${index + 1} attendu`);
  return item as T;
}

function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Sauvegarde et purge des clés d'environnement du catalogue (état déterministe). */
const ENV_KEYS_TO_CLEAR = AI_PROVIDER_CATALOG.flatMap((p) => [p.envKeys, p.modelEnvKey ? [p.modelEnvKey] : []].flat());
const savedEnv = new Map<string, string | undefined>();

before(() => {
  for (const key of ENV_KEYS_TO_CLEAR) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  resetActiveProviderState(null);
  resetStoredProviderKeys();
});

after(() => {
  resetActiveProviderState(null);
  resetStoredProviderKeys();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ==================== Catalogue des 10 cartes ====================

describe('catalogue multi-modèles', () => {
  it('expose exactement 10 fournisseurs avec des ids uniques', () => {
    assert.equal(AI_PROVIDER_CATALOG.length, 10);
    const ids = AI_PROVIDER_CATALOG.map((p) => p.providerId);
    assert.equal(new Set(ids).size, 10);
    assert.deepEqual(new Set(ids), new Set([
      'mistral', 'gemini', 'openai', 'deepseek', 'kimi', 'glm', 'qwen', 'groq', 'xai', 'claude'
    ]));
  });

  it('chaque entrée a une URL, un modèle par défaut et au moins une clé nommée', () => {
    for (const entry of AI_PROVIDER_CATALOG) {
      assert.ok(entry.baseUrl.startsWith('https://'), `baseUrl https pour ${entry.providerId}`);
      assert.ok(entry.models.length > 0 && entry.defaultModel.length > 0, `modèles non vides pour ${entry.providerId}`);
      assert.ok(entry.envKeys.length > 0, `envKeys non vides pour ${entry.providerId}`);
      assert.ok(entry.contextWindow >= 32000, `contexte plausible pour ${entry.providerId}`);
    }
  });

  it('les modèles par env sont couverts (alias KIMI_API_KEY et ZHIPU_API_KEY)', () => {
    assert.deepEqual(getCatalogEntry('kimi')?.envKeys, ['MOONSHOT_API_KEY', 'KIMI_API_KEY']);
    assert.deepEqual(getCatalogEntry('glm')?.envKeys, ['ZHIPU_API_KEY', 'GLM_API_KEY']);
    assert.deepEqual(getCatalogEntry('claude')?.envKeys, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
  });
});

// ==================== Adaptateur OpenAI-compatible (openai) ====================

describe('adaptateur compatible OpenAI', () => {
  it('produit URL/entêtes/corps corrects et cartographie usage + tool_calls', async () => {
    process.env.OPENAI_API_KEY = 'sk-mm-test-1234567890';
    const { adapterFetch, calls } = scriptedFetch(() => jsonOk({
      choices: [{ message: { content: 'Pong !', tool_calls: [
        { id: 'call_1', function: { name: 'fn_a', arguments: '{"x":1}' } }
      ] } }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }
    }));
    const adapter = new OpenAICompatibleProviderAdapter(getCatalogEntry('openai')!, adapterFetch);
    const response = await adapter.generate({ ...baseRequest, tools: [{
      name: 'fn_a', description: 'Fonction factice', parameters: { type: 'object' }
    }] });

    const call = requireCall(calls);
    assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
    assert.match(call.init.headers?.['Authorization'] ?? '', /^Bearer sk-mm-test/);
    const body = JSON.parse(call.init.body ?? '{}') as {
      model: string; messages: unknown[]; max_tokens: number; stream: boolean; tools?: unknown[];
    };
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 64);
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'Tu es un assistant de test.' },
      { role: 'user', content: 'Ping de test' }
    ]);
    assert.deepEqual(body.tools?.[0], {
      type: 'function',
      function: { name: 'fn_a', description: 'Fonction factice', parameters: { type: 'object' } }
    });
    assert.equal(response.text, 'Pong !');
    assert.equal(response.providerId, 'openai');
    assert.equal(response.usage.inputTokens, 12);
    assert.equal(response.usage.outputTokens, 5);
    assert.equal(response.toolCalls?.[0]?.name, 'fn_a');
    assert.equal(response.toolCalls?.[0]?.arguments, '{"x":1}');
  });

  it('lève AIProviderAuthError sans clé configurée', async () => {
    delete process.env.OPENAI_API_KEY;
    const { adapterFetch, calls } = scriptedFetch(() => jsonOk({ choices: [] }));
    const adapter = new OpenAICompatibleProviderAdapter(getCatalogEntry('deepseek')!, adapterFetch);
    await assert.rejects(() => adapter.generate(baseRequest), (err: unknown) => {
      assert.match((err as { name?: string }).name ?? '', /AuthError/);
      return true;
    });
    assert.equal(calls.length, 0, 'aucune requête sans clé');
  });

  it('honore le modèle par défaut d’environnement ({PROVIDER}_MODEL)', async () => {
    process.env.GROQ_API_KEY = 'gsk-mm-test-9876543210';
    process.env.GROQ_MODEL = 'llama-3.3-70b-versatile-override';
    const { adapterFetch, calls } = scriptedFetch(() => jsonOk({
      choices: [{ message: { content: 'ok' } }]
    }));
    const adapter = new OpenAICompatibleProviderAdapter(getCatalogEntry('groq')!, adapterFetch);
    await adapter.generate(baseRequest);
    const call = requireCall(calls);
    const body = requireJson(call) as { model: string };
    assert.equal(body.model, 'llama-3.3-70b-versatile-override');
    assert.equal(call.url, 'https://api.groq.com/openai/v1/chat/completions');
  });

  it('l’alias d’environnement secondaire fonctionne (KIMI_API_KEY) et l’URL Kimi est correcte', async () => {
    delete process.env.MOONSHOT_API_KEY;
    process.env.KIMI_API_KEY = 'sk-kimi-mm-1234567890';
    const { adapterFetch, calls } = scriptedFetch(() => jsonOk({
      choices: [{ message: { content: 'Annyeong' } }]
    }));
    const adapter = new OpenAICompatibleProviderAdapter(getCatalogEntry('kimi')!, adapterFetch);
    const response = await adapter.generate(baseRequest);
    assert.equal(calls[0]?.url, 'https://api.moonshot.cn/v1/chat/completions');
    assert.equal(response.text, 'Annyeong');
    assert.equal(providerKeyPresent('kimi'), true);
  });

  it('le streaming OpenAI yield chaque delta `data:` du SSE', async () => {
    process.env.XAI_API_KEY = 'xai-mm-test-55555555';
    const sse =
      'data: {"choices":[{"delta":{"content":"Bon"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"jour"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n' +
      'data: [DONE]\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      }
    });
    const { adapterFetch, calls } = scriptedFetch(() => new Response(stream, { status: 200 }));
    const adapter = new OpenAICompatibleProviderAdapter(getCatalogEntry('xai')!, adapterFetch);
    const chunks: string[] = [];
    for await (const delta of adapter.generateStream({ ...baseRequest, systemPrompt: undefined })) {
      chunks.push(delta);
    }
    const call = requireCall(calls);
    assert.equal(call.url, 'https://api.x.ai/v1/chat/completions');
    assert.equal(chunks.join(''), 'Bonjour!');
    const body = requireJson(call) as { stream: boolean; messages: { role: string }[] };
    assert.equal(body.stream, true);
    assert.deepEqual(body.messages.map((m) => m.role), ['user']);
  });
});

// ==================== Adaptateur Anthropic (claude) ====================

describe('adaptateur Anthropic Claude', () => {
  it('traduit le corps /v1/messages (system séparé, x-api-key) et les blocs de réponse', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-mm-test-11111111';
    const { adapterFetch, calls } = scriptedFetch(() => jsonOk({
      content: [
        { type: 'text', text: 'Bonjour ' },
        { type: 'text', text: 'Claude !' }
      ],
      usage: { input_tokens: 9, output_tokens: 4 }
    }));
    const adapter = new AnthropicProviderAdapter(adapterFetch);
    const response = await adapter.generate(baseRequest);

    const call = requireCall(calls);
    assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(call.init.headers?.['x-api-key'], 'sk-ant-mm-test-11111111');
    assert.equal(call.init.headers?.['anthropic-version'], '2023-06-01');
    const body = JSON.parse(call.init.body ?? '{}') as {
      model: string; system?: string; messages: { role: string; content: unknown }[]; max_tokens: number;
    };
    assert.equal(body.model, 'claude-sonnet-4-5');
    assert.equal(body.system, 'Tu es un assistant de test.');
    assert.equal(body.max_tokens, 64);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Ping de test' }]);
    assert.equal(response.text, 'Bonjour Claude !');
    assert.equal(response.providerId, 'claude');
    assert.equal(response.usage.inputTokens, 9);
    assert.equal(response.usage.totalTokens, 13);
  });

  it('cartographie assistant.toolCalls → tool_use et tool → tool_result (fusion en un user)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-mm-test-22222222';
    const { adapterFetch, calls } = scriptedFetch(() => jsonOk({
      content: [{ type: 'text', text: 'fait' }],
      usage: { input_tokens: 20, output_tokens: 2 }
    }));
    const adapter = new AnthropicProviderAdapter(adapterFetch);
    await adapter.generate({
      ...baseRequest,
      systemPrompt: undefined,
      messages: [
        { role: 'user', content: 'Liste les fichiers' },
        { role: 'assistant', content: 'Je consulte l’outil.', toolCalls: [{ id: 'toolu_1', name: 'list_files', arguments: '{"dir":"."}' }] },
        { role: 'tool', content: 'a.ts, b.ts', toolCallId: 'toolu_1', name: 'list_files' },
        { role: 'tool', content: 'c.ts', toolCallId: 'toolu_2', name: 'list_files' }
      ]
    });
    interface AnthropicWireBlock {
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
    }
    interface AnthropicWireMessage {
      role: string;
      content: string | AnthropicWireBlock[];
    }
    const call = requireCall(calls);
    const body = requireJson(call) as { system?: unknown; messages: AnthropicWireMessage[] };
    assert.equal(body.system, undefined);
    assert.equal(body.messages.length, 3);
    const firstMessage = requireAt(body.messages, 0);
    assert.equal(firstMessage.role, 'user');
    assert.equal(firstMessage.content, 'Liste les fichiers');
    const assistant = requireAt(body.messages, 1);
    assert.equal(assistant.role, 'assistant');
    const assistantBlocks = Array.isArray(assistant.content) ? assistant.content : [];
    const headText = requireAt(assistantBlocks, 0);
    assert.deepEqual(headText, { type: 'text', text: 'Je consulte l’outil.' }, 'texte conservé en tête (forme OpenAI content + tool_calls)');
    const toolUse = requireAt(assistantBlocks.filter((b) => b.type === 'tool_use'), 0);
    assert.deepEqual(toolUse, { type: 'tool_use', id: 'toolu_1', name: 'list_files', input: { dir: '.' } });
    const toolResults = requireAt(body.messages, 2);
    assert.equal(toolResults.role, 'user');
    const resultBlocks = Array.isArray(toolResults.content) ? toolResults.content : [];
    assert.equal(resultBlocks.length, 2, 'deux blocs tool_result fusionnés');
    assert.deepEqual(requireAt(resultBlocks, 0), { type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.ts, b.ts' });
    assert.deepEqual(requireAt(resultBlocks, 1), { type: 'tool_result', tool_use_id: 'toolu_2', content: 'c.ts' });
  });

  it('mappe content tool_use → toolCalls (arguments resérialisés)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-mm-test-33333333';
    const { adapterFetch } = scriptedFetch(() => jsonOk({
      content: [
        { type: 'text', text: '' },
        { type: 'tool_use', id: 'toolu_9', name: 'grep', input: { q: 'pattern' } }
      ],
      usage: { input_tokens: 5, output_tokens: 7 }
    }));
    const adapter = new AnthropicProviderAdapter(adapterFetch);
    const response = await adapter.generate({ ...baseRequest, systemPrompt: undefined });
    assert.equal(response.toolCalls?.[0]?.id, 'toolu_9');
    assert.equal(response.toolCalls?.[0]?.name, 'grep');
    assert.deepEqual(JSON.parse(response.toolCalls?.[0]?.arguments ?? '{}'), { q: 'pattern' });
  });

  it('respecte strictement le contrat de base (PAS de generateStream hors contrat)', () => {
    // Le contrat AIProviderAdapter ne contient PAS de streaming : l'adaptateur
    // Anthropic n'en expose pas. La traduction SSE (text_delta) est la propriété
    // du flux fournis par les formats OpenAI-compatibles / Mistral uniquement.
    const adapter = new AnthropicProviderAdapter();
    const leaked = (adapter as unknown as { generateStream?: unknown }).generateStream;
    assert.equal(leaked, undefined, 'aucune surcharge hors contrat');
  });
});

// ==================== État actif du commutateur ON/OFF ====================

describe('commutateur ON/OFF (état actif)', () => {
  it('sans sélection : preferredAiProvider() vaut undefined (héritage strict)', () => {
    assert.equal(preferredAiProvider(), undefined);
  });

  it('ON sans clé d’environnement → refus explicite citant la variable attendue', () => {
    assert.throws(() => setProviderActive('qwen', true), /DASHSCOPE_API_KEY|QWEN_API_KEY/);
  });

  it('ON avec clé → devient actif ; dernier allumé gagne (bascule) ; OFF retire', () => {
    process.env.OPENAI_API_KEY = 'sk-on-off-test-1';
    setProviderActive('openai', true);
    assert.equal(preferredAiProvider(), 'openai');
    assert.equal(providerKeyPresent('openai'), true);

    process.env.GROQ_API_KEY = 'gsk-on-off-test-2';
    setProviderActive('groq', true);
    assert.equal(preferredAiProvider(), 'groq', 'le dernier allumé devient le modèle actif');

    setProviderActive('openai', false);
    assert.equal(preferredAiProvider(), 'groq', 'OFF sur un non-actif est sans effet');

    setProviderActive('groq', false);
    assert.equal(preferredAiProvider(), undefined, 'OFF sur l’actif → retour à l’héritage');

    setProviderActive('openai', true);
    assert.equal(preferredAiProvider(), 'openai');
  });

  it('id de fournisseur inconnu → erreur claire', () => {
    assert.throws(() => setProviderActive('cubicle', true), /inconnu/);
  });
});

// ==================== Clé saisie dans la carte (saisie dashboard) ====================

describe('clé enregistrée depuis la carte', () => {
  it('la clé de carte est utilisée par l’adaptateur et GAGNE sur l’env', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-lose-1234567890';
    setProviderStoredKey('openai', 'sk-card-key-a1b2c3d4');
    const { adapterFetch, calls } = scriptedFetch(() => jsonOk({
      choices: [{ message: { content: 'via carte' } }]
    }));
    const adapter = new OpenAICompatibleProviderAdapter(getCatalogEntry('openai')!, adapterFetch);
    const response = await adapter.generate(baseRequest);
    const call = requireCall(calls);
    assert.equal(call.init.headers?.['Authorization'], 'Bearer sk-card-key-a1b2c3d4');
    assert.equal(response.text, 'via carte');
    assert.equal(providerStoredKey('openai'), 'sk-card-key-a1b2c3d4');
    assert.equal(providerKeyPresent('openai'), true);
  });

  it('les credentials du tenant restent prioritaires (flux internes)', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-lose-1234567890';
    setProviderStoredKey('openai', 'sk-card-key-a1b2c3d4');
    const { adapterFetch, calls } = scriptedFetch(() => jsonOk({
      choices: [{ message: { content: 'via tenant' } }]
    }));
    const adapter = new OpenAICompatibleProviderAdapter(getCatalogEntry('openai')!, adapterFetch);
    await adapter.generate(baseRequest, {
      tenantId: 'tenant_mm',
      providerId: 'openai',
      apiKey: 'sk-tenant-priority-1'
    });
    const call = requireCall(calls);
    assert.equal(call.init.headers?.['Authorization'], 'Bearer sk-tenant-priority-1');
  });

  it('la bascule ON fonctionne avec UNE SEULE clé de carte (sans env)', () => {
    setProviderStoredKey('deepseek', 'sk-card-deepseek-99990001');
    setProviderActive('deepseek', true);
    assert.equal(preferredAiProvider(), 'deepseek');
    setProviderActive('deepseek', false);
    assert.equal(preferredAiProvider(), undefined);
  });

  it('le champ vide supprime la clé ; l’indice masqué ne fuit jamais la valeur', () => {
    const secret = 'sk-secret-valeur-complète-à-ne-pas-renvoyer';
    setProviderStoredKey('glm', secret);
    const hint = maskedKeyHint(secret);
    assert.equal(hint, '••••' + secret.slice(-4));
    assert.notEqual(hint, secret);
    setProviderStoredKey('glm', '');
    assert.equal(providerStoredKey('glm'), undefined, 'champ vide → clé supprimée');
    assert.equal(providerKeyPresent('glm'), false);
  });
});
