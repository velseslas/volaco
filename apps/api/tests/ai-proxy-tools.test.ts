/**
 * ÉTAPE 34 — PROXY IA : transmission des outils (tool-calling).
 *
 * Le Studio ne doit jamais appeler Mistral directement (SEC-003) : tout le
 * trafic LLM passe par /api/v1/ai/chat/completions. É32/É33 ont ajouté le
 * tool-calling côté adaptateur core ; É34 fait en sorte que le proxy
 * relaie le champ `tools` du client vers Mistral et retourne les
 * `tool_calls` de la réponse sans altération — condition nécessaire pour
 * qu'un client (ex. Builder) exécute des outils via ce proxy.
 *
 * Le fetch global est remplacé par un double qui capture le corps envoyé à
 * l'upstream et renvoie une réponse Mistral simulée : aucun appel réseau.
 * Les requêtes CLIENT du test utilisent le fetch réel sauvegardé AVANT le
 * remplacement — seul l'appel serveur → Mistral traverse le double.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

interface CapturedUpstream {
  readonly url: string;
  readonly body: Record<string, unknown> | null;
}

describe('CORE-API É34 : proxy IA — transmission des outils', () => {
  let server: Server;
  let baseUrl: string;
  let captured: CapturedUpstream | null = null;
  let cannedResponse: Record<string, unknown> = {};

  // Le fetch RÉEL est sauvegardé avant tout remplacement : les requêtes du
  // test vers le serveur local doivent passer par le vrai réseau local.
  const realFetch = globalThis.fetch;

  before(async () => {
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      captured = {
        url: String(input),
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
      };
      return new Response(JSON.stringify(cannedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const post = (body: unknown): Promise<Response> =>
    realFetch(`${baseUrl}/api/v1/ai/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mistral-api-key': 'test-key-proxy'
      },
      body: JSON.stringify(body)
    });

  it('0. NON-RÉGRESSION bouton Studio : model explicite + max_tokens:5 acceptés (P0 #400)', async () => {
    // Le bouton "Tester la connexion" du Studio envoie TOUJOURS un model
    // explicite. Un validateur trop strict ici casse 100 % des appels réels
    // alors que la suite restait verte (les tests existants omettaient model).
    cannedResponse = { choices: [{ message: { content: 'OK' } }] };
    const res = await post({ model: 'codestral-latest', messages: [{ role: 'user', content: 'OK' }], max_tokens: 5 });
    assert.equal(res.status, 200);
    assert.equal(captured?.body?.model, 'codestral-latest');
    assert.equal(captured?.body?.max_tokens, 5);
  });

  it('1. sans tools : la requête upstream ne contient PAS de clé tools (comportement inchangé)', async () => {
    cannedResponse = { choices: [{ message: { content: 'Bonjour !' } }] };
    const res = await post({ messages: [{ role: 'user', content: 'salut' }] });
    assert.equal(res.status, 200);

    assert.ok(captured);
    assert.match(captured.url, /api\.mistral\.ai/);
    assert.equal(captured.body?.tools, undefined);
    const upstreamMessages = captured.body?.messages as unknown[] | undefined;
    assert.equal(upstreamMessages?.length, 1);

    const clientBody = (await res.json()) as { choices?: unknown[] };
    assert.deepEqual(clientBody.choices, [{ message: { content: 'Bonjour !' } }]);
  });

  it('2. avec tools : le tableau est relayé INCHANGÉ à l upstream', async () => {
    cannedResponse = { choices: [{ message: { content: 'ok' } }] };
    const tools = [
      {
        type: 'function',
        function: {
          name: 'set_text',
          description: 'Change le texte d un composant',
          parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
        }
      }
    ];
    const res = await post({ messages: [{ role: 'user', content: 'change le titre' }], tools });
    assert.equal(res.status, 200);

    assert.ok(captured);
    assert.deepEqual(captured.body?.tools, tools);
  });

  it('3. réponse upstream avec tool_calls : retournée intacte au client (content null conservé)', async () => {
    const toolCallsResponse = {
      id: 'resp-1',
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call-9',
                type: 'function',
                function: { name: 'set_text', arguments: '{"text":"Bonjour"}' }
              }
            ]
          }
        }
      ]
    };
    cannedResponse = toolCallsResponse;
    const res = await post({
      messages: [{ role: 'user', content: 'change le titre' }],
      tools: [{ type: 'function', function: { name: 'set_text', description: '', parameters: {} } }]
    });
    assert.equal(res.status, 200);

    const clientBody = (await res.json()) as typeof toolCallsResponse;
    assert.equal(clientBody.choices[0]?.message?.content, null);
    assert.equal(clientBody.choices[0]?.message?.tool_calls?.[0]?.id, 'call-9');
    assert.equal(clientBody.choices[0]?.message?.tool_calls?.[0]?.function.name, 'set_text');
    assert.equal(clientBody.choices[0]?.message?.tool_calls?.[0]?.function.arguments, '{"text":"Bonjour"}');
  });

  it('4. tools non-array : 400 explicite, AUCUN appel upstream', async () => {
    captured = null;
    const res = await post({ messages: [{ role: 'user', content: 'salut' }], tools: 'not-an-array' });
    assert.equal(res.status, 400);
    const err = (await res.json()) as { error?: { message?: string } };
    assert.match(String(err.error?.message), /tableau/i);
    assert.equal(captured, null);
  });
});
