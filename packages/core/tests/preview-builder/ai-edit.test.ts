/**
 * ÉTAPE 35 — BOUCLE D'ÉDITION IA PAR OUTILS (module isomorphe ai-edit.ts).
 *
 * Le modèle doit répondre EXCLUSIVEMENT par un appel d'outil structuré
 * (set_text / set_image_src / set_link_href) ; la valeur extraite sera
 * appliquée par les commandes PURES du Builder. Tous les scénarios sont
 * rejoués avec un fetchImpl factice (aucun réseau) : appel direct, relance
 * après texte libre, relance après arguments invalides, borne d'appels,
 * erreur HTTP, consigne vide, et conformité du corps envoyé au proxy.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAiEditLoop } from '../../src/preview-builder/ai-edit.js';

interface FakeStep {
  readonly body: unknown;
  readonly status?: number;
}

interface Captured {
  readonly url: string;
  readonly body: Record<string, unknown> | null;
  readonly headers: Record<string, unknown> | undefined;
}

const toolCallBody = (name: string, args: string): unknown => ({
  choices: [{ message: { content: null, tool_calls: [{ function: { name: name, arguments: args } }] } }]
});
const textBody = (text: string): unknown => ({ choices: [{ message: { content: text } }] });

/** fetchImpl factice : rejoue un script de réponses et capture les appels. */
function fakeFetch(script: FakeStep[], captured: Captured[]): typeof fetch {
  let i = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      headers: init?.headers as Record<string, unknown> | undefined
    });
    const step: FakeStep = script[Math.min(i, script.length - 1)] ?? { body: null };
    i += 1;
    return new Response(JSON.stringify(step.body), {
      status: step.status ?? 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
}

describe('ÉTAPE 35 : boucle d édition IA par outils (runAiEditLoop)', () => {
  it('1. texte : tool call set_text immédiat → valeur extraite, 1 appel', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([{ body: toolCallBody('set_text', '{"text":"Un titre qui vend du rêve"}') }], captured);
    const outcome = await runAiEditLoop({
      fetchImpl,
      url: '/api/v1/ai/chat/completions',
      request: { kind: 'text', instruction: 'rends ce titre percutant', currentValue: 'Titre' }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.value, 'Un titre qui vend du rêve');
    assert.equal(outcome.iterations, 1);
    assert.equal(captured.length, 1);
  });

  it('2. image : outil set_image_src → src extrait', async () => {
    const captured: Captured[] = [];
    const src = 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4';
    const fetchImpl = fakeFetch([{ body: toolCallBody('set_image_src', JSON.stringify({ src })) }], captured);
    const outcome = await runAiEditLoop({
      fetchImpl,
      url: '/proxy',
      request: { kind: 'image', instruction: 'une vraie photo de restaurant', currentValue: 'https://picsum.photos/1' }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.value, src);
  });

  it('3. lien : outil set_link_href → href extrait', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([{ body: toolCallBody('set_link_href', '{"href":"#reservation"}') }], captured);
    const outcome = await runAiEditLoop({
      fetchImpl,
      url: '/proxy',
      request: { kind: 'link', instruction: 'pointe vers la section réservation', currentValue: '#' }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.value, '#reservation');
  });

  it('4. texte libre d abord → relance avec rappel → tool call accepté (2 appels)', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([
      { body: textBody('Bien sûr ! Je propose : « Un titre en or ».') },
      { body: toolCallBody('set_text', '{"text":"Un titre en or"}') }
    ], captured);
    const outcome = await runAiEditLoop({
      fetchImpl,
      url: '/proxy',
      request: { kind: 'text', instruction: 'améliore le titre', currentValue: 'Titre' }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.value, 'Un titre en or');
    assert.equal(outcome.iterations, 2);
    // le 2e appel porte le rappel ferme en 3e message
    const messages = captured[1]?.body?.messages as Array<{ role: string; content: string }>;
    assert.equal(messages.length, 3);
    assert.match(messages[2]?.content ?? '', /outil "set_text"/);
  });

  it('5. arguments JSON invalides → relance → tool call valide accepté', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([
      { body: toolCallBody('set_text', '{"text": tronqué') },
      { body: toolCallBody('set_text', '{"text":"Texte réparé"}') }
    ], captured);
    const outcome = await runAiEditLoop({
      fetchImpl,
      url: '/proxy',
      request: { kind: 'text', instruction: 'corrige le texte', currentValue: 'Texte' }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.value, 'Texte réparé');
    assert.equal(outcome.iterations, 2);
  });

  it('6. borne d appels : jamais d outil → échec honnête no-tool-call', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([{ body: textBody('Je préfère expliquer en texte.') }], captured);
    const outcome = await runAiEditLoop({
      fetchImpl,
      url: '/proxy',
      request: { kind: 'text', instruction: 'tâche impossible', currentValue: 'x' },
      maxModelCalls: 3
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'no-tool-call');
    assert.equal(outcome.iterations, 3);
    assert.equal(captured.length, 3);
  });

  it('7. HTTP 500 → échec http-error avec statut, 1 seul appel', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([{ body: { message: 'boom' }, status: 500 }], captured);
    const outcome = await runAiEditLoop({
      fetchImpl,
      url: '/proxy',
      request: { kind: 'text', instruction: 'ok', currentValue: 'x' }
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'http-error');
    assert.equal(outcome.detail, 'HTTP 500');
    assert.equal(outcome.iterations, 1);
    assert.equal(captured.length, 1);
  });

  it('8. consigne vide → échec immédiat, AUCUN appel réseau', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([], captured);
    const outcome = await runAiEditLoop({
      fetchImpl,
      url: '/proxy',
      request: { kind: 'text', instruction: '   ', currentValue: 'x' }
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'empty-instruction');
    assert.equal(outcome.iterations, 0);
    assert.equal(captured.length, 0);
  });

  it('9. corps de requête conforme : tools au format function, messages system+user, en-têtes fusionnés', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([{ body: toolCallBody('set_text', '{"text":"ok"}') }], captured);
    await runAiEditLoop({
      fetchImpl,
      url: '/api/v1/ai/chat/completions',
      request: { kind: 'text', instruction: 'va', currentValue: 'ancien' },
      headers: { 'x-tenant-id': 'studio-local' }
    });

    const body = captured[0]?.body as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ type: string; function: { name: string; parameters: Record<string, unknown> } }>;
    };
    assert.equal(body.model, 'codestral-latest');
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0]?.role, 'system');
    assert.match(body.messages[1]?.content ?? '', /ancien/);
    assert.match(body.messages[1]?.content ?? '', /va/);
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0]?.type, 'function');
    assert.equal(body.tools[0]?.function.name, 'set_text');
    assert.deepEqual(body.tools[0]?.function.parameters.required, ['text']);
    const headers = captured[0]?.headers as Record<string, unknown>;
    assert.equal(headers['x-tenant-id'], 'studio-local');
    assert.equal(headers['Content-Type'], 'application/json');
  });

  it('10. hygiene : valeur trimée et tronquée à 8000 caractères', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([{ body: toolCallBody('set_text', JSON.stringify({ text: '  ' + 'x'.repeat(9000) + '  ' })) }], captured);
    const outcome = await runAiEditLoop({
      fetchImpl,
      url: '/proxy',
      request: { kind: 'text', instruction: 'ok', currentValue: 'x' }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.value?.length, 8000);
  });

  it('11. outil au nom inattendu → traité comme no-tool-call (relance possible)', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([
      { body: toolCallBody('delete_everything', '{}') },
      { body: toolCallBody('set_text', '{"text":"Conforme"}') }
    ], captured);
    const outcome = await runAiEditLoop({
      fetchImpl,
      url: '/proxy',
      request: { kind: 'text', instruction: 'ok', currentValue: 'x' }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.value, 'Conforme');
    assert.equal(outcome.iterations, 2);
  });
});
