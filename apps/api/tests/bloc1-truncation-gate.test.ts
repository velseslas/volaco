/**
 * B1 — TRONCATURE + SEUIL GATE.
 *
 * Une génération terminée avec une section ouverte jamais refermée
 * (sortie LLM coupée à maxTokens ou marqueur </SECTION> manquant)
 * produit une page incomplète : le gate doit la sanctionner en CRITICAL
 * (-25) pour qu'elle ne passe jamais le seuil de 90.
 *
 * Pur et déterministe : aucun serveur, aucun Chromium, aucun réseau.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCriticScore, truncationFinding } from '../src/routes/visual.js';

describe('B1 — finding de troncature', () => {
  it('est CRITICAL avec un titre explicite et un conseil de relance', () => {
    const f = truncationFinding();
    assert.equal(f.severity, 'CRITICAL');
    assert.match(f.title, /tronquée/);
    assert.match(f.detail, /Relancez/);
  });

  it('seul, il fait tomber une page parfaite à 75/100 (sous le seuil 90)', () => {
    assert.equal(computeCriticScore([truncationFinding()]), 75);
  });

  it('cumulé à des doublons (2 HIGH), le score tombe à 51/100', () => {
    const dupes = [
      { severity: 'HIGH' as const, source: 'DESIGN' as const, title: 'Sections dupliquées', detail: '' },
      { severity: 'HIGH' as const, source: 'DESIGN' as const, title: 'Structure dupliquée', detail: '' },
    ];
    assert.equal(computeCriticScore([...dupes, truncationFinding()]), 51);
  });

  it('sans troncature, une page propre reste à 100/100 (seuil passé)', () => {
    const score = computeCriticScore([]);
    assert.equal(score, 100);
    assert.ok(score >= 90);
  });
});
