/**
 * Tests — narration ancrée (buildPageContext, ÉTAPE waw)
 * L'IA doit parler des éléments RÉELS de la page de l'utilisateur.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageContext } from '../src/routes/conversation.js';

describe('buildPageContext : grounding de la narration', () => {
  const sample = '<!DOCTYPE html><html><head><title>Bella Italia</title></head><body>'
    + '<div data-section="header"><h1>Bella Italia</h1></div>'
    + '<div data-section="menu"><h2>Nos pâtes</h2><button>Réserver</button></div>'
    + '<div style="color:#ef4444;background:#0f172a">x</div>'
    + '</body></html>';

  it('1. extrait titre, sections, titres, boutons et couleurs', () => {
    const ctx = buildPageContext(sample);
    assert.ok(ctx.includes('Bella Italia'), 'Le titre réel doit apparaître');
    assert.ok(ctx.includes('header') && ctx.includes('menu'), 'Les sections réelles doivent apparaître');
    assert.ok(ctx.includes('Nos pâtes'), 'Les titres visibles doivent apparaître');
    assert.ok(ctx.includes('Réserver'), 'Les boutons doivent apparaître');
    assert.ok(ctx.includes('#ef4444'), 'Les couleurs réelles doivent apparaître');
  });

  it('2. renvoie une chaîne vide pour un HTML trivial (pas de contexte inventé)', () => {
    assert.equal(buildPageContext('x'), '');
    assert.equal(buildPageContext('<p>x</p>'), '');
  });
});
