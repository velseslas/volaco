/**
 * ÉTAPE 39 — BOUCLE D'ÉDITION IA PAR PAGE (runAiPageEditLoop).
 *
 * Généralisation multi-sections de la boucle composant : l'inventaire porte
 * des sections, les outils exigent section+path, et les sections touchées
 * sont rapportées pour la persistance (É38, séquentielle côté Builder).
 * Tous les scénarios sont rejoués avec un fetchImpl factice.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAiPageEditLoop } from '../../src/preview-builder/ai-edit.js';
import type { PageEditableElement } from '../../src/preview-builder/ai-edit.js';

interface FakeStep {
  readonly body: unknown;
  readonly status?: number;
}

interface Captured {
  readonly body: Record<string, unknown> | null;
}

function fakeFetch(script: FakeStep[], captured: Captured[]): typeof fetch {
  let i = 0;
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    captured.push({ body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null });
    const step: FakeStep = script[Math.min(i, script.length - 1)] ?? { body: null };
    i += 1;
    return new Response(JSON.stringify(step.body), { status: step.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const call = (name: string, args: Record<string, unknown>): unknown => ({
  function: { name, arguments: JSON.stringify(args) }
});

const INVENTORY: PageEditableElement[] = [
  { section: 'header', path: [0, 0], kind: 'text', tag: 'span', value: 'Logo' },
  { section: 'hero', path: [0, 0], kind: 'text', tag: 'h1', value: 'Bienvenue' },
  { section: 'hero', path: [0, 1], kind: 'image', tag: 'img', value: 'https://picsum.photos/1' },
  { section: 'footer', path: [0, 2, 0], kind: 'link', tag: 'a', value: '#' }
];

describe('ÉTAPE 39 : boucle d édition IA par page (multi-sections)', () => {
  it('1. modifications dans DEUX sections au même tour → touchedSections déduites', async () => {
    const captured: Captured[] = [];
    const applied: string[] = [];
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [
        call('set_text', { section: 'hero', path: [0, 0], text: 'Nouveau titre' }),
        call('set_text', { section: 'header', path: [0, 0], text: 'Maison' })
      ] } }] } },
      { body: { choices: [{ message: { content: 'Page mise à jour !' } }] } }
    ], captured);
    const outcome = await runAiPageEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'change le titre et le logo',
      inventory: INVENTORY,
      apply: (c) => { applied.push(String(c.args.section) + ':' + c.name); return 'OK'; }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.appliedCount, 2);
    assert.deepEqual([...outcome.touchedSections].sort(), ['header', 'hero']);
    assert.deepEqual(applied, ['hero:set_text', 'header:set_text']);
    assert.equal(outcome.finalText, 'Page mise à jour !');
  });

  it('2. section manquante : refusée avant apply, le modèle corrige au tour suivant', async () => {
    const captured: Captured[] = [];
    const applied: string[] = [];
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [call('set_text', { path: [0, 0], text: 'X' })] } }] } },
      { body: { choices: [{ message: { content: '', tool_calls: [call('set_text', { section: 'hero', path: [0, 0], text: 'X' })] } }] } },
      { body: { choices: [{ message: { content: 'Fini.' } }] } }
    ], captured);
    const outcome = await runAiPageEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'va',
      inventory: INVENTORY,
      apply: (c) => { applied.push(String(c.args.section)); return 'OK'; }
    });

    assert.equal(outcome.appliedCount, 1);
    assert.deepEqual(applied, ['hero']);
    assert.match(outcome.toolErrors[0] ?? '', /section manquante/);
    const turn3 = captured[2]?.body?.messages as Array<Record<string, unknown>>;
    const toolMsg = turn3.find((m) => m.role === 'tool') as { content: string } | undefined;
    assert.match(String(toolMsg?.content), /ERREUR: section manquante/);
  });

  it('3. section inconnue : apply est appelé, son refus est nourri au modèle', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [call('set_text', { section: 'mars', path: [0], text: 'X' })] } }] } },
      { body: { choices: [{ message: { content: 'Ok.' } }] } }
    ], captured);
    const outcome = await runAiPageEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'va',
      inventory: INVENTORY,
      apply: () => 'ERREUR: modification refusée (unknown-component) — vérifie section et path de l inventaire'
    });

    assert.equal(outcome.appliedCount, 0);
    assert.equal(outcome.touchedSections.length, 0);
    assert.match(outcome.toolErrors[0] ?? '', /unknown-component/);
  });

  it('4. borne maxModelCalls : le dernier tour part SANS outils', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [call('set_text', { section: 'hero', path: [0, 0], text: 'encore' })] } }] } },
      { body: { choices: [{ message: { content: 'Conclusion.' } }] } }
    ], captured);
    const outcome = await runAiPageEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'va',
      inventory: INVENTORY,
      apply: () => 'OK',
      maxModelCalls: 2
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.limitReached, false);
    assert.equal(captured[1]?.body?.tools, undefined);
  });

  it('5. image cassée : refusée avant apply, la section n est PAS marquée touchée', async () => {
    const captured: Captured[] = [];
    const goodUrl = 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4';
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [call('set_image_src', { section: 'hero', path: [0, 1], src: 'https://x/broken.jpg' })] } }] } },
      { body: { choices: [{ message: { content: '', tool_calls: [call('set_image_src', { section: 'hero', path: [0, 1], src: goodUrl })] } }] } },
      { body: { choices: [{ message: { content: 'Image ok.' } }] } }
    ], captured);
    const outcome = await runAiPageEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'change l image',
      inventory: INVENTORY,
      validateImageUrl: (url) => Promise.resolve(url === goodUrl ? null : 'image introuvable'),
      apply: () => 'OK'
    });

    assert.equal(outcome.appliedCount, 1);
    assert.deepEqual([...outcome.touchedSections], ['hero']);
    assert.match(outcome.toolErrors[0] ?? '', /image inaccessible/);
  });

  it('6. consigne vide ou inventaire vide : échec immédiat, AUCUN appel réseau', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([], captured);
    const e1 = await runAiPageEditLoop({ fetchImpl, url: '/p', instruction: '  ', inventory: INVENTORY, apply: () => 'OK' });
    const e2 = await runAiPageEditLoop({ fetchImpl, url: '/p', instruction: 'ok', inventory: [], apply: () => 'OK' });
    assert.equal(e1.reason, 'empty-instruction');
    assert.equal(e2.reason, 'empty-inventory');
    assert.equal(captured.length, 0);
  });

  it('7. le corps de requête porte les outils AVEC section obligatoire et l inventaire multi-sections', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([{ body: { choices: [{ message: { content: 'rien à faire' } }] } }], captured);
    await runAiPageEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'mets à jour la page',
      inventory: INVENTORY,
      headers: { 'x-tenant-id': 'studio-local' },
      apply: () => 'OK'
    });

    const body = captured[0]?.body as {
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ function: { name: string; parameters: { required: string[] } } }>;
    };
    assert.match(body.messages[1]?.content ?? '', /section=hero/);
    assert.match(body.messages[1]?.content ?? '', /section=footer/);
    for (const tool of body.tools) {
      assert.ok(tool.function.parameters.required.includes('section'), tool.function.name + ' exige section');
      assert.ok(tool.function.parameters.required.includes('path'), tool.function.name + ' exige path');
    }
  });

  it('8. échec HTTP après des applications : succès partiel rapporté avec sections touchées', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [call('set_link_href', { section: 'footer', path: [0, 2, 0], href: '#contact' })] } }] } },
      { body: { message: 'boom' }, status: 500 }
    ], captured);
    const outcome = await runAiPageEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'va',
      inventory: INVENTORY,
      apply: () => 'OK'
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.appliedCount, 1);
    assert.deepEqual([...outcome.touchedSections], ['footer']);
  });
});
