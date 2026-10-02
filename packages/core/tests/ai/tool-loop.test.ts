/**
 * ÉTAPE 33 — BOUCLE D'EXÉCUTION D'OUTILS (agentic loop).
 *
 * É32 a posé le protocole (envoi des tools, lecture des tool_calls).
 * É33 exécute : le modèle demande un outil → runToolLoop exécute le
 * handler → renvoie le résultat en message 'tool' → le modèle répond.
 *
 * Tous les scénarios sont rejoués avec un adaptateur factice SCRIPTÉ
 * (aucun appel réseau) : réponse texte directe, un appel d'outil, deux
 * tours successifs, outil inconnu, handler qui échoue, arguments JSON
 * invalides, borne d'itérations, troncature de résultat, et intégrité
 * de l'historique multi-tours envoyé à l'adaptateur.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runToolLoop, parseToolArguments } from '../../src/ai/tool-loop.js';
import type {
  AIProviderAdapter,
  AIProviderGenerateRequest,
  AIProviderGenerateResponse,
  AIProviderMessage,
  AIProviderTool,
  AIProviderToolCall
} from '../../src/ai/providers/types.js';

// ---------------------------------------------------------------- adaptateur factice

interface ScriptedTurn {
  readonly text?: string;
  readonly toolCalls?: readonly AIProviderToolCall[];
}

/** Répond tour par tour selon un script ; enregistre chaque requête reçue. */
class ScriptedAdapter implements AIProviderAdapter {
  public readonly descriptor = {
    providerId: 'scripted',
    providerName: 'Scripted',
    models: ['script-1'],
    capabilities: [] as const,
    contextWindow: 128000,
    structuredOutput: true,
    streaming: false,
    toolCalling: true,
    reasoning: false,
    vision: false,
    costMetadata: {},
    availability: 'AVAILABLE' as const,
    healthStatus: 'HEALTHY' as const
  };

  public readonly requests: AIProviderGenerateRequest[] = [];

  constructor(private readonly turns: readonly ScriptedTurn[]) {}

  public async generate(request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> {
    this.requests.push(request);
    const turn: ScriptedTurn = this.turns[Math.min(this.requests.length - 1, this.turns.length - 1)] ?? { text: '' };
    return {
      text: turn.text ?? '',
      providerId: 'scripted',
      modelId: 'script-1',
      latencyMs: 1,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      costUsd: 0.001,
      ...(turn.toolCalls && turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {})
    };
  }
}

const baseRequest = (): AIProviderGenerateRequest => ({
  tenantId: 't',
  projectId: 'p',
  prompt: 'Question utilisateur',
  systemPrompt: 'Tu es un assistant outillé.'
});

const TOOL_READ: AIProviderTool = {
  name: 'read_file',
  description: 'Lit un fichier',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
};

const toolCall = (overrides: Partial<AIProviderToolCall>): AIProviderToolCall => ({
  id: 'call-1',
  name: 'read_file',
  arguments: '{"path":"src/index.ts"}',
  ...overrides
});

// ---------------------------------------------------------------- tests

describe('ÉTAPE 33 : boucle d exécution d outils (runToolLoop)', () => {
  it('1. réponse sans tool call : un seul appel modèle, aucun handler exécuté', async () => {
    const adapter = new ScriptedAdapter([{ text: 'Réponse directe.' }]);
    const executed: string[] = [];
    const result = await runToolLoop(adapter, baseRequest(), [TOOL_READ], {
      handlers: { read_file: () => { executed.push('read_file'); return 'contenu'; } }
    });

    assert.equal(result.text, 'Réponse directe.');
    assert.equal(result.iterations, 1);
    assert.equal(result.stoppedByToolLimit, false);
    assert.equal(result.trace.length, 0);
    assert.equal(executed.length, 0);
    assert.equal(adapter.requests.length, 1);
  });

  it('2. un tool call : handler exécuté avec les arguments parsés, résultat renvoyé au modèle', async () => {
    const adapter = new ScriptedAdapter([
      { text: 'Je lis le fichier.', toolCalls: [toolCall({})] },
      { text: 'Le fichier contient la fonction main.' }
    ]);
    const receivedArgs: Record<string, unknown>[] = [];
    const result = await runToolLoop(adapter, baseRequest(), [TOOL_READ], {
      handlers: { read_file: (args) => { receivedArgs.push(args); return 'export const main = ...'; } }
    });

    assert.equal(result.text, 'Le fichier contient la fonction main.');
    assert.equal(result.iterations, 2);
    assert.deepEqual(receivedArgs[0], { path: 'src/index.ts' });
    assert.equal(result.trace.length, 1);
    assert.equal(result.trace[0]?.ok, true);
    assert.equal(result.trace[0]?.toolName, 'read_file');
    // le tour 2 porte l'historique complet : system, user, assistant(toolCalls), tool
    const secondCall = adapter.requests[1]!;
    const messages2 = secondCall.messages ?? [];
    assert.equal(messages2.length, 4);
    assert.equal(messages2[1]?.role, 'user');
    assert.equal(messages2[2]?.role, 'assistant');
    assert.equal(messages2[3]?.role, 'tool');
    assert.equal(messages2[3]?.content, 'export const main = ...');
    // usage cumulé sur les deux appels
    assert.equal(result.usage.totalTokens, 30);
    assert.ok(Math.abs(result.costUsd - 0.002) < 1e-9);
  });

  it('3. deux tours d outils successifs : les deux handlers sont enchaînés puis réponse finale', async () => {
    const adapter = new ScriptedAdapter([
      { text: '', toolCalls: [toolCall({ id: 'call-a', arguments: '{"path":"a.ts"}' })] },
      { text: '', toolCalls: [toolCall({ id: 'call-b', arguments: '{"path":"b.ts"}' })] },
      { text: 'Voilà les deux fichiers.' }
    ]);
    const paths: string[] = [];
    const result = await runToolLoop(adapter, baseRequest(), [TOOL_READ], {
      handlers: { read_file: (args) => { paths.push(String(args.path)); return `contenu de ${String(args.path)}`; } }
    });

    assert.deepEqual(paths, ['a.ts', 'b.ts']);
    assert.equal(result.text, 'Voilà les deux fichiers.');
    assert.equal(result.iterations, 3);
    assert.equal(result.trace.length, 2);
    // le 3e appel reçoit 6 messages : system, user, assistant(a), tool(a), assistant(b), tool(b)
    assert.equal(adapter.requests[2]?.messages?.length, 6);
  });

  it('4. outil inconnu : le modèle reçoit une erreur exploitable (pas d exception), la boucle continue', async () => {
    const adapter = new ScriptedAdapter([
      { text: '', toolCalls: [toolCall({ name: 'delete_everything' })] },
      { text: 'Pardon, je corrige avec read_file.' }
    ]);
    const result = await runToolLoop(adapter, baseRequest(), [TOOL_READ], {
      handlers: { read_file: () => 'ok' }
    });

    assert.equal(result.text, 'Pardon, je corrige avec read_file.');
    const toolMsg = adapter.requests[1]?.messages?.find((m) => m.role === 'tool');
    assert.ok(toolMsg);
    assert.match(toolMsg.content, /outil inconnu "delete_everything"/);
    assert.match(toolMsg.content, /read_file/);
    assert.equal(result.trace[0]?.ok, false);
  });

  it('5. handler qui échoue : l erreur est renvoyée au modèle comme résultat d outil', async () => {
    const adapter = new ScriptedAdapter([
      { text: '', toolCalls: [toolCall({})] },
      { text: 'Je gère l échec et je réponds.' }
    ]);
    const result = await runToolLoop(adapter, baseRequest(), [TOOL_READ], {
      handlers: { read_file: () => { throw new Error('fichier introuvable'); } }
    });

    assert.equal(result.text, 'Je gère l échec et je réponds.');
    const toolMsg = adapter.requests[1]?.messages?.find((m) => m.role === 'tool');
    assert.match(String(toolMsg?.content), /a échoué: fichier introuvable/);
    assert.equal(result.trace[0]?.ok, false);
  });

  it('6. arguments JSON invalides : signalés au modèle, pas d exception', async () => {
    const adapter = new ScriptedAdapter([
      { text: '', toolCalls: [toolCall({ arguments: '{"path": ' })] },
      { text: 'Réessayé avec un JSON valide.' }
    ]);
    const result = await runToolLoop(adapter, baseRequest(), [TOOL_READ], {
      handlers: { read_file: () => 'ok' }
    });

    assert.equal(result.text, 'Réessayé avec un JSON valide.');
    const toolMsg = adapter.requests[1]?.messages?.find((m) => m.role === 'tool');
    assert.match(String(toolMsg?.content), /arguments JSON invalides/);
    assert.equal(result.trace[0]?.ok, false);
  });

  it('7. borne d itérations : le dernier appel est SANS outils, la boucle termine toujours', async () => {
    // Le modèle demande un outil à CHAQUE tour : sans borne, boucle infinie.
    const adapter = new ScriptedAdapter([
      { text: '', toolCalls: [toolCall({})] },
      { text: '', toolCalls: [toolCall({})] },
      { text: 'Réponse forcée (plus d outils disponibles).' }
    ]);
    let executions = 0;
    const result = await runToolLoop(adapter, baseRequest(), [TOOL_READ], {
      handlers: { read_file: () => { executions += 1; return 'ok'; } },
      maxIterations: 3
    });

    // 3 appels modèle max ; au 3e, tools est retiré → le script ne peut
    // plus demander d'outil et la réponse texte clôt la boucle.
    assert.equal(adapter.requests.length, 3);
    assert.equal(result.iterations, 3);
    assert.equal(result.text, 'Réponse forcée (plus d outils disponibles).');
    assert.equal(executions, 2);
    // le dernier appel ne contient PAS de tools
    assert.equal(adapter.requests[2]?.tools, undefined);
    // mais les deux premiers oui
    assert.equal(adapter.requests[0]?.tools?.length, 1);
    assert.equal(adapter.requests[1]?.tools?.length, 1);
  });

  it('8. résultat trop long : tronqué à maxToolResultLength avec marqueur', async () => {
    const adapter = new ScriptedAdapter([
      { text: '', toolCalls: [toolCall({})] },
      { text: 'Résumé du gros fichier.' }
    ]);
    const result = await runToolLoop(adapter, baseRequest(), [TOOL_READ], {
      handlers: { read_file: () => 'x'.repeat(500) },
      maxToolResultLength: 100
    });

    const toolMsg = adapter.requests[1]?.messages?.find((m) => m.role === 'tool');
    const content = String(toolMsg?.content);
    assert.ok(content.startsWith('x'.repeat(100)));
    assert.match(content, /tronqué à 100 caractères/);
    assert.ok(content.length < 500);
    assert.equal(result.trace[0]?.ok, true);
  });

  it('9. intégrité du format multi-tours : assistant porte toolCalls, tool porte toolCallId + name', async () => {
    const adapter = new ScriptedAdapter([
      { text: '', toolCalls: [toolCall({ id: 'call-x' })] },
      { text: 'Fini.' }
    ]);
    await runToolLoop(adapter, baseRequest(), [TOOL_READ], {
      handlers: { read_file: () => 'contenu' }
    });

    const secondCall = adapter.requests[1];
    const assistantMsg = secondCall?.messages?.find((m) => m.role === 'assistant') as AIProviderMessage;
    assert.ok(assistantMsg.toolCalls);
    assert.equal(assistantMsg.toolCalls[0]?.id, 'call-x');
    assert.equal(assistantMsg.toolCalls[0]?.name, 'read_file');
    const toolMsg = secondCall?.messages?.find((m) => m.role === 'tool') as AIProviderMessage;
    assert.equal(toolMsg.toolCallId, 'call-x');
    assert.equal(toolMsg.name, 'read_file');
  });
});

describe('ÉTAPE 33 : parseToolArguments', () => {
  it('arguments vides ou blancs → objet vide, ok', () => {
    assert.deepEqual(parseToolArguments(''), { ok: true, args: {} });
    assert.deepEqual(parseToolArguments('   '), { ok: true, args: {} });
  });

  it('objet JSON valide → parsé tel quel', () => {
    assert.deepEqual(parseToolArguments('{"a":1,"b":"x"}'), { ok: true, args: { a: 1, b: 'x' } });
  });

  it('scalaire JSON → enveloppé sous { value }', () => {
    assert.deepEqual(parseToolArguments('42'), { ok: true, args: { value: 42 } });
    assert.deepEqual(parseToolArguments('"txt"'), { ok: true, args: { value: 'txt' } });
  });

  it('JSON invalide → ok:false avec message d erreur', () => {
    const parsed = parseToolArguments('{oops');
    assert.equal(parsed.ok, false);
    assert.ok(parsed.error && parsed.error.length > 0);
  });
});
