/**
 * Ordre canonique des sections (footer en haut constaté en prod, rév. #54) :
 * le serveur n'ordonne plus aveuglément dans l'ordre d'émission du modèle.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSectionOrder, sectionRank } from '../src/routes/conversation.js';

const sec = (name: string) => ({ name });

describe('ordre canonique des sections', () => {
  it('1. footer émis 2e termine dernier (cas prod #54)', () => {
    const input = ['header', 'footer', 'hero', 'menu', 'reservation'].map(sec);
    assert.deepEqual(
      canonicalSectionOrder(input).map((s) => s.name),
      ['header', 'hero', 'menu', 'reservation', 'footer']
    );
  });

  it('2. stable : inconnus gardent leur ordre relatif, contact avant footer', () => {
    const input = ['header', 'nos-thés', 'salon-de-dégustation', 'avis-clients', 'contact', 'footer'].map(sec);
    assert.deepEqual(
      canonicalSectionOrder(input).map((s) => s.name),
      ['header', 'nos-thés', 'salon-de-dégustation', 'avis-clients', 'contact', 'footer']
    );
  });

  it('3. déjà ordonné : inchangé (idempotent)', () => {
    const input = ['header', 'hero', 'menu', 'footer'].map(sec);
    assert.deepEqual(canonicalSectionOrder(input).map((s) => s.name), ['header', 'hero', 'menu', 'footer']);
  });

  it('4. rangs : header 0, hero 10, contenu 20, fermeture 30, footer 100', () => {
    assert.equal(sectionRank('header'), 0);
    assert.equal(sectionRank('nav'), 0);
    assert.equal(sectionRank('hero'), 10);
    assert.equal(sectionRank('nos-pains'), 20);
    assert.equal(sectionRank('contact'), 30);
    assert.equal(sectionRank('avis-clients'), 30);
    assert.equal(sectionRank('footer'), 100);
  });
});
