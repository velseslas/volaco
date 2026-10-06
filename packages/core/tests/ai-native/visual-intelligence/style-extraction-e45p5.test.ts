/**
 * ÉTAPE 45 Phase 5 (F1) — extraction des styles : fin des valeurs fantômes.
 *
 * Avant correction, la couleur (#0f172a) et la police (sans-serif) par défaut
 * du nœud racine étaient comptées dans extractedColors/extractedFonts comme
 * des observations réelles — produisant une pénalité DQI indue à 8 couleurs
 * réelles et un faux finding « Trop de polices distinctes » à 3 polices
 * réelles. Seules les valeurs explicitement fournies (inline, classes, CSS)
 * — et leurs héritages — sont désormais extraites. La RÉSOLUTION des styles
 * reste inchangée (le modèle computed-style garde ses valeurs par défaut).
 *
 * Tests déterministes : aucun serveur, aucun navigateur, aucun réseau.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VisualIntelligenceService } from '../../../src/index.js';

const request = (html: string) => ({
  tenantId: 't_e45p5',
  projectId: 'p_e45p5',
  htmlContent: html,
  requestId: 'req_e45p5'
});

describe('ÉTAPE 45 Phase 5 — extraction sans valeurs fantômes (F1)', () => {
  const svc = new VisualIntelligenceService();

  it('A: document sans aucun style → 0 couleur et 0 police extraites (plus de fantômes)', async () => {
    const r = await svc.analyzeVisuals(request('<!DOCTYPE html><html><head><title>A</title></head><body><p>hello</p></body></html>'), 'ENGINEER');
    assert.deepEqual(r.snapshot.extractedColors, [], 'aucune couleur fantôme #0f172a');
    assert.deepEqual(r.snapshot.extractedFonts, [], 'aucune police fantôme sans-serif');
  });

  it('B: la résolution des styles reste inchangée (modèle computed-style avec défauts)', async () => {
    const r = await svc.analyzeVisuals(request('<!DOCTYPE html><html><head><title>B</title></head><body><p>hello</p></body></html>'), 'ENGINEER');
    // Les styles calculés du nœud portent toujours la valeur par défaut
    // (seule l'EXTRACTION change, pas la résolution).
    assert.equal(r.snapshot.rootNode.styles.color, '#0f172a');
    assert.equal(r.snapshot.rootNode.styles.fontFamily, 'sans-serif');
  });

  it('C: une couleur #0f172a EXPLICITE reste comptée', async () => {
    const r = await svc.analyzeVisuals(
      request('<!DOCTYPE html><html><body style="color:#0f172a;background:#f8fafc"><p>Texte.</p></body></html>'),
      'ENGINEER'
    );
    assert.ok(r.snapshot.extractedColors.includes('#0f172a'), 'couleur explicite = observation réelle');
    assert.ok(r.snapshot.extractedColors.includes('#f8fafc'));
    assert.equal(r.snapshot.extractedColors.length, 2);
  });

  it('D: héritage explicite — la couleur du body est comptée une seule fois via ses enfants', async () => {
    const r = await svc.analyzeVisuals(
      request('<!DOCTYPE html><html><body style="color:#f8fafc"><p>Un</p><p>Deux</p><p>Trois</p></body></html>'),
      'ENGINEER'
    );
    assert.deepEqual(r.snapshot.extractedColors, ['#f8fafc'], 'héritage explicite compté, fantôme absent');
  });

  it('E: 3 polices explicites → exactement 3 (plus de police fantôme)', async () => {
    const r = await svc.analyzeVisuals(
      request('<!DOCTYPE html><html><body style="background:#0b1220;color:#f1f5f9"><h1 style="font-family:Georgia, serif">T</h1><p style="font-family:Arial, sans-serif">P</p><code style="font-family:monospace">C</code></body></html>'),
      'ENGINEER'
    );
    assert.deepEqual(
      [...r.snapshot.extractedFonts].sort(),
      ['Arial, sans-serif', 'Georgia, serif', 'monospace'],
      'les 3 polices réelles, sans le fantôme sans-serif'
    );
  });
});
