/**
 * ÉTAPE 32 — TOOL-CALLING MISTRAL : support des outils dans l'adaptateur.
 *
 * Le tool-calling est la brique qui manquait pour permettre à l'IA de
 * « travailler » (lire des fichiers, exécuter des outils, etc.). Cette
 * étape ne branche PAS la boucle sur le flux conversationnel — elle ajoute
 * uniquement le support du protocole dans l'adaptateur, testé avec
 * mockFetch (réponses simulées : texte seul, 1 outil, plusieurs outils).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MistralProviderAdapter } from '../../src/ai/providers/mistral-adapter.js';
import type { AIProviderGenerateRequest, AIProviderTool } from '../../src/ai/providers/types.js';

const CREDENTIALS = { tenantId: 't', projectId: 'p', providerId: 'mistral', apiKey: 'test-key' };

const baseRequest = (tools?: AIProviderTool[]): AIProviderGenerateRequest => ({
  tenantId: 't',
  projectId: 'p',
  prompt: 'Test prompt',
  ...(tools !== undefined ? { tools } : {})
});

const TOOL_1: AIProviderTool = {
  name: 'read_file',
  description: 'Lit un fichier',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
};

const TOOL_2: AIProviderTool = {
  name: 'write_file',
  description: 'Écrit un fichier',
  parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }
};

describe('ÉTAPE 32 : tool-calling Mistral', () => {
  it('1. sans tools : le corps de requête ne contient PAS de tools', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const adapter = new MistralProviderAdapter(async (url, init) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'réponse' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200 });
    });
    const result = await adapter.generate(baseRequest(undefined), CREDENTIALS);
    assert.equal(result.toolCalls, undefined, 'aucun toolCall sans tools');
    assert.ok(capturedBody && !('tools' in capturedBody), 'aucun tools dans la requête');
  });

  it('2. avec 1 outil : le corps contient tools au format OpenAI/Mistral', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const adapter = new MistralProviderAdapter(async (url, init) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({
        choices: [{ message: { content: null, tool_calls: [{ id: 'tc_1', function: { name: 'read_file', arguments: '{"path":"/a.txt"}' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200 });
    });
    const result = await adapter.generate(baseRequest([TOOL_1]), CREDENTIALS);
    assert.ok(capturedBody, 'corps capturé');
    const tools = (capturedBody as unknown as Record<string, unknown> & { tools?: unknown[] }).tools as unknown[];
    assert.equal(tools?.length, 1);
    assert.deepEqual(tools?.[0], { type: 'function', function: { name: TOOL_1.name, description: TOOL_1.description, parameters: TOOL_1.parameters } }, 'format function conforme');
    assert.equal(result.toolCalls?.[0]?.name, 'read_file');
    assert.equal(result.toolCalls?.[0]?.arguments, '{"path":"/a.txt"}');
  });

  it('3. avec plusieurs outils : tous transmis dans le corps', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const adapter = new MistralProviderAdapter(async (url, init) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200 });
    });
    await adapter.generate(baseRequest([TOOL_1, TOOL_2]), CREDENTIALS);
    const tools = (capturedBody as unknown as Record<string, unknown> & { tools?: unknown[] }).tools as unknown[];
    assert.equal(tools?.length, 2);
  });

  it('4. réponse texte seul : aucun toolCall extrait', async () => {
    const adapter = new MistralProviderAdapter(async (url, init) => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'réponse texte simple' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200 });
    });
    const result = await adapter.generate(baseRequest([TOOL_1]), CREDENTIALS);
    assert.equal(result.toolCalls, undefined);
    assert.equal(result.text, 'réponse texte simple');
  });

  it('5. réponse avec content null + tool_calls : text vide et toolCalls extraits', async () => {
    const adapter = new MistralProviderAdapter(async (url, init) => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: null, tool_calls: [
          { id: 'tc_1', function: { name: 'write_file', arguments: '{"path":"/b.txt","content":"Contenu"}' } }
        ] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200 });
    });
    const result = await adapter.generate(baseRequest([TOOL_1]), CREDENTIALS);
    assert.equal(result.text, '');
    assert.equal(result.toolCalls?.[0]?.name, 'write_file');
    assert.equal(result.toolCalls?.[0]?.arguments, '{"path":"/b.txt","content":"Contenu"}');
  });

  it('6. tool_calls vides ou manquants → toolCalls undefined', async () => {
    const adapter1 = new MistralProviderAdapter(async (url, init) => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'texte', tool_calls: [] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200 });
    });
    const result1 = await adapter1.generate(baseRequest([TOOL_1]), CREDENTIALS);
    assert.equal(result1.toolCalls, undefined);
    const adapter2 = new MistralProviderAdapter(async (url, init) => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'texte' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200 });
    });
    const result2 = await adapter2.generate(baseRequest([TOOL_1]), CREDENTIALS);
    assert.equal(result2.toolCalls, undefined);
  });

  it('7. tool_calls avec arguments vides → arguments = {}', async () => {
    const adapter = new MistralProviderAdapter(async (url, init) => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: null, tool_calls: [
          { id: 'tc_1', function: { name: 'read_file', arguments: '' } }
        ] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200 });
    });
    const result = await adapter.generate(baseRequest([TOOL_1]), CREDENTIALS);
    assert.equal(result.toolCalls?.[0]?.arguments, '{}', 'arguments vides remplacés par {}');
  });
});
