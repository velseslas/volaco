/**
 * FIDÉLITÉ BUILDER = ONGLET : le canvas rejouait les corps de sections sans
 * le <head> (polices + <style>), retombant sur ses bases sombres (.pvz-real :
 * titres blancs, liens violets invisibles sur fond clair).
 *
 * refreshPageStyles extrait polices + styles du HTML sauvegardé et les
 * injecte SCOPÉS au canvas (jamais de fuite dans l'UI Builder).
 * Gardes source (le DOM iframe ne se teste pas en HTTP).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('FIDÉLITÉ : le Builder rejoue le <head> scopé au canvas', () => {
  const builder = readFileSync(join(process.cwd(), 'apps/studio/preview-builder-app.js'), 'utf8');

  it('1. scopeur présent (sélecteurs préfixés, body/html/:root remappés)', () => {
    assert.ok(builder.includes('function scopeBuilderSelector'), 'remappage des sélecteurs');
    assert.ok(builder.includes('function scopeBuilderCss'), 'parseur avec @media récursif');
    assert.ok(builder.includes('keyframes, font-face'), 'keyframes/font-face intacts');
  });

  it('2. injection scopée + remplacée (jamais d’empilement ni de <script>)', () => {
    assert.ok(builder.includes('function refreshPageStyles'), 'extracteur head');
    assert.ok(builder.includes('vibe-page-styles'), 'style remplacé, pas empilé');
    assert.ok(builder.includes('data-vibe-font'), 'polices dédupliquées');
    assert.ok(!builder.includes('vibe-page-script'), 'aucun script injecté (CSP)');
  });

  it('3. branché au rechargement du HTML sauvegardé (resumeSession)', () => {
    const resume = builder.slice(builder.indexOf('async function resumeSession'));
    assert.ok(resume.slice(0, 6000).includes('refreshPageStyles(content)'), 'styles rafraîchis au reload');
  });

  it('4. resumeSession intacte après la greffe (pas de ligne mangée)', () => {
    assert.ok(builder.includes('async function resumeSession(explicitProjectId) {'), 'déclaration présente');
    assert.ok(builder.includes('rebuildCanvasFromHtml(content)'), 'reconstruction conservée');
  });

  it('5. bases .pvz-real en spécificité 0 (:where) — le design page gagne', () => {
    const html = readFileSync(join(process.cwd(), 'apps/studio/preview-builder.html'), 'utf8');
    assert.ok(html.includes(':where(.pvz-real) a {'), 'liens : la page gagne sur la base');
    assert.ok(html.includes(':where(.pvz-real) button {'), 'boutons : la page gagne sur la base');
    assert.ok(!html.includes('.pvz-real a {'), 'plus de base liens en haute spécificité');
    assert.ok(!html.includes('.pvz-real button {'), 'plus de base boutons en haute spécificité');
    assert.ok(html.includes('.pvz-real { animation:'), 'bloc de base (fallback) intact');
  });

  it('6. live-paint+ : cascade, suivi, fondu images, compteur (que des ajouts)', () => {    assert.ok(builder.includes('cascadeIdx'), 'délai +80ms par élément');
    assert.ok(builder.includes('scrollIntoView'), 'suivi de construction');
    assert.ok(builder.includes('pvl-img-ok'), 'fondu des images au chargement');
    assert.ok(builder.includes('pvl-counter'), 'compteur vivant section · N éléments');
    assert.ok(builder.includes('prefers-reduced-motion'), 'motion réduite respectée');
    assert.ok(builder.includes('window.__pvlStats'), 'stats de diagnostic exposées');
    assert.ok(!builder.includes('livePaint.isMod'), 'peinture active en création comme en modification');
    assert.ok(builder.includes('vibe_live_paint_ms'), 'throttle de peinture réglable');
    assert.ok(builder.includes('vibe_live_paint_cascade'), 'pas de cascade réglable');
  });

  it('7. neutraliseur typographique : bases revert avant styles page', () => {
    assert.ok(builder.includes('const PVZ_NEUTRALIZER ='), 'neutraliseur défini');
    assert.ok(builder.includes('PVZ_NEUTRALIZER + scoped'), 'neutraliseur placé avant les styles page');
    assert.ok(builder.includes("scoped.trim() ? PVZ_NEUTRALIZER + scoped : ''"), 'fallback intact sans styles page');
    assert.ok(builder.includes('font-size:revert'), 'taille de police vérité-onglet');
  });
});
