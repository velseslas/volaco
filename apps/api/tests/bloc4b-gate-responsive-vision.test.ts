/**
 * B4-gate — RESPONSIVE MESURÉ + PERTINENCE IMAGES SANS VISION.
 *
 * - mobileOverflowFinding : finding MEDIUM (-6) uniquement sur mesure réelle
 *   à 390 px, jamais deviné (null = pas de mesure = pas de finding) ;
 * - genericImageFindings : alt absent + picsum génériques majoritaires sur
 *   page à thème, agrégés (jamais une pénalité par image).
 *
 * Pur et déterministe : aucun Chromium, aucun réseau.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCriticScore,
  genericImageFindings,
  mobileOverflowFinding,
} from '../src/routes/visual.js';

describe('B4-gate — débordement mobile mesuré', () => {
  it('null sans mesure, null sans débordement', () => {
    assert.equal(mobileOverflowFinding(null), null);
    assert.equal(mobileOverflowFinding({ overflowX: false, wideElements: 0 }), null);
  });

  it('MEDIUM (-6) quand le débordement est mesuré', () => {
    const f = mobileOverflowFinding({ overflowX: true, wideElements: 3 });
    assert.ok(f);
    assert.equal(f.severity, 'MEDIUM');
    assert.match(f.title, /mobile/);
    assert.equal(computeCriticScore([f]), 94);
  });
});

describe('B4-gate — pertinence images sans vision', () => {
  it('signale les alt absents (agrégé, LOW)', () => {
    const html = '<img src="https://picsum.photos/seed/a-1/800/520" alt="Fournil"><img src="https://picsum.photos/seed/b-2/800/520">';
    const fs = genericImageFindings(html, 'VibeCode Studio');
    assert.equal(fs.length, 1);
    const f0 = fs[0]!;
    assert.match(f0.title, /alternatif/);
    assert.equal(f0.severity, 'LOW');
  });

  it('signale les picsum majoritaires sur page à thème, pas sur page générique', () => {
    const html = '<img src="https://picsum.photos/seed/a-1/800/520" alt="x"><img src="https://picsum.photos/seed/b-2/800/520" alt="y">';
    const themed = genericImageFindings(html, 'Bella Italia — Pizzeria');
    assert.ok(themed.some((f) => /génériques/.test(f.title)));
    const genericPage = genericImageFindings(html, 'VibeCode Studio');
    assert.ok(!genericPage.some((f) => /génériques/.test(f.title)));
  });

  it('page aux photos à sujet : aucun finding', () => {
    const html = '<img src="https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&q=80" alt="Plat du fournil">';
    assert.deepEqual(genericImageFindings(html, 'Boulangerie Martin'), []);
  });

  it('aucune image : aucun finding', () => {
    assert.deepEqual(genericImageFindings('<p>texte seul</p>', 'Boulangerie Martin'), []);
  });
});
