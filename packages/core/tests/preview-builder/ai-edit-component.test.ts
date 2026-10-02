/**
 * ÉTAPE 36 — BOUCLE D'ÉDITION IA PAR COMPOSANT (runAiComponentEditLoop).
 *
 * Multi-outils et multi-tours : chaque réponse du modèle peut contenir
 * PLUSIEURS tool_calls (set_text / set_image_src / set_link_href avec le
 * path de l'inventaire), exécutés par l'appelant via `apply`, résultats
 * renvoyés au modèle au format wire. Tous les scénarios sont rejoués avec
 * un fetchImpl factice (aucun réseau).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAiComponentEditLoop } from '../../src/preview-builder/ai-edit.js';
import type { EditableElementInfo } from '../../src/preview-builder/editing.js';

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

const toolCall = (id: string, name: string, args: string): unknown => ({
  function: { name, arguments: args }
});

const INVENTORY: EditableElementInfo[] = [
  { path: [0, 0], kind: 'text', tag: 'h1', value: 'Bienvenue' },
  { path: [0, 1], kind: 'image', tag: 'img', value: 'https://picsum.photos/1' },
  { path: [0, 2, 0], kind: 'link', tag: 'a', value: '#' }
];

describe('ÉTAPE 36 : boucle d édition IA par composant', () => {
  it('1. deux tool_calls dans le même tour, puis narration finale → 2 applications', async () => {
    const captured: Captured[] = [];
    const applied: string[] = [];
    const fetchImpl = fakeFetch([
      {
        body: {
          choices: [{
            message: {
              content: '',
              tool_calls: [
                toolCall('c1-0', 'set_text', '{"path":[0,0],"text":"Nouveau titre"}'),
                toolCall('c1-1', 'set_image_src', '{"path":[0,1],"src":"https://images.unsplash.com/photo-9"}')
              ]
            }
          }]
        }
      },
      { body: { choices: [{ message: { content: 'Voilà, j ai terminé !' } }] } }
    ], captured);
    const outcome = await runAiComponentEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'change le titre et l image',
      inventory: INVENTORY,
      apply: (call) => { applied.push(call.name + ':' + JSON.stringify(call.args.path)); return 'OK'; }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.appliedCount, 2);
    assert.equal(outcome.iterations, 2);
    assert.equal(outcome.limitReached, false);
    assert.equal(outcome.finalText, 'Voilà, j ai terminé !');
    assert.deepEqual(applied, ['set_text:[0,0]', 'set_image_src:[0,1]']);
    // le 2e tour porte l'historique : system, user, assistant(tool_calls), 2 résultats tool
    const turn2 = captured[1]?.body?.messages as Array<Record<string, unknown>>;
    assert.equal(turn2.length, 5);
    assert.equal(turn2[2]?.role, 'assistant');
    assert.equal(turn2[3]?.role, 'tool');
    assert.equal(turn2[3]?.tool_call_id, 'c1-0');
    assert.equal(turn2[4]?.role, 'tool');
    assert.equal(turn2[4]?.tool_call_id, 'c1-1');
  });

  it('2. path inventé (non valide) : erreur nourrie au modèle, apply NON appelé, le modèle corrige', async () => {
    const captured: Captured[] = [];
    const applied: string[] = [];
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [toolCall('c1-0', 'set_text', '{"path":"[0,0]","text":"X"}')] } }] } },
      { body: { choices: [{ message: { content: '', tool_calls: [toolCall('c2-0', 'set_text', '{"path":[0,0],"text":"Corrigé"}')] } }] } },
      { body: { choices: [{ message: { content: 'Fini.' } }] } }
    ], captured);
    const outcome = await runAiComponentEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'va',
      inventory: INVENTORY,
      apply: (call) => { applied.push(call.name); return 'OK'; }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.appliedCount, 1);
    assert.deepEqual(applied, ['set_text']);
    assert.equal(outcome.toolErrors.length, 1);
    assert.match(outcome.toolErrors[0] ?? '', /path invalide/);
    const turn3 = captured[2]?.body?.messages as Array<Record<string, unknown>>;
    const toolMsg = turn3.find((m) => m.role === 'tool') as { content: string } | undefined;
    assert.match(String(toolMsg?.content), /ERREUR: path invalide/);
  });

  it('3. outil inconnu : refusé sans appeler apply', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [toolCall('c1-0', 'delete_everything', '{}')] } }] } },
      { body: { choices: [{ message: { content: 'Compris, je m arrête.' } }] } }
    ], captured);
    const outcome = await runAiComponentEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'va',
      inventory: INVENTORY,
      apply: () => { assert.fail('apply ne doit pas être appelé pour un outil inconnu'); }
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.appliedCount, 0);
    assert.match(outcome.toolErrors[0] ?? '', /outil inconnu/);
  });

  it('4. refus de la commande pure (ERREUR) : compté dans toolErrors, la boucle continue', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [toolCall('c1-0', 'set_text', '{"path":[9,9],"text":"X"}')] } }] } },
      { body: { choices: [{ message: { content: 'Ok je m arrête.' } }] } }
    ], captured);
    const outcome = await runAiComponentEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'va',
      inventory: INVENTORY,
      apply: () => 'ERREUR: modification refusée (invalid-path)'
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.appliedCount, 0);
    assert.equal(outcome.toolErrors.length, 1);
    assert.match(outcome.toolErrors[0] ?? '', /invalid-path/);
  });

  it('5. borne maxModelCalls : le dernier tour part SANS outils, jamais de divergence', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [toolCall('cX', 'set_text', '{"path":[0,0],"text":"encore"}')] } }] } },
      { body: { choices: [{ message: { content: 'Terminé sans outil.' } }] } }
    ], captured);
    const outcome = await runAiComponentEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'va',
      inventory: INVENTORY,
      apply: () => 'OK',
      maxModelCalls: 2
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.iterations, 2);
    assert.equal(outcome.limitReached, false);
    // le 2e appel ne contient PAS de tools (le modèle doit conclure)
    assert.equal(captured[1]?.body?.tools, undefined);
    assert.equal((captured[0]?.body?.tools as unknown[]).length, 3);
  });

  it('6. consigne vide ou inventaire vide : échec immédiat, AUCUN appel réseau', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([], captured);
    const empty1 = await runAiComponentEditLoop({
      fetchImpl, url: '/proxy', instruction: '   ', inventory: INVENTORY, apply: () => 'OK'
    });
    const empty2 = await runAiComponentEditLoop({
      fetchImpl, url: '/proxy', instruction: 'ok', inventory: [], apply: () => 'OK'
    });
    assert.equal(empty1.reason, 'empty-instruction');
    assert.equal(empty2.reason, 'empty-inventory');
    assert.equal(captured.length, 0);
  });

  it('7. HTTP 500 : échec, mais les applications déjà faites restent rapportées', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [toolCall('c1-0', 'set_text', '{"path":[0,0],"text":"X"}')] } }] } },
      { body: { message: 'boom' }, status: 500 }
    ], captured);
    const outcome = await runAiComponentEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'va',
      inventory: INVENTORY,
      apply: () => 'OK'
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'http-error');
    assert.equal(outcome.appliedCount, 1, 'l édition déjà appliquée est conservée (succès partiel honnête)');
  });

  it('8. le corps de requête porte l inventaire et les 3 outils au format function', async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch([{ body: { choices: [{ message: { content: 'rien à faire' } }] } }], captured);
    await runAiComponentEditLoop({
      fetchImpl,
      url: '/proxy',
      instruction: 'mets à jour les prix',
      inventory: INVENTORY,
      headers: { 'x-tenant-id': 'studio-local' },
      apply: () => 'OK'
    });

    const body = captured[0]?.body as {
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ function: { name: string } }>;
    };
    assert.match(body.messages[1]?.content ?? '', /path=\[0,0\]/);
    assert.match(body.messages[1]?.content ?? '', /Bienvenue/);
    assert.match(body.messages[1]?.content ?? '', /mets à jour les prix/);
    assert.deepEqual(body.tools.map((t) => t.function.name), ['set_text', 'set_image_src', 'set_link_href']);
  });
});
