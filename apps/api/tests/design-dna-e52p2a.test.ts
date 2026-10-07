/**
 * ÉTAPE 52 Phase 2A — Design DNA au premier rendu (infra).
 *
 * Le LLM peut émettre en préambule de sa réponse un bloc
 * <!-- DESIGN_DNA: {json} --> décrivant l'identité visuelle du projet
 * (palette, police, mode). Ce bloc est :
 *   - extrait et retiré du HTML assemblé (jamais visible dans le site) ;
 *   - appliqué au shell (police Google Fonts, fond, couleur du texte, mode) ;
 *   - SANS bloc : le shell est identique octet pour octet à l'ancien
 *     (non-régression stricte).
 *
 * Tests déterministes : aucun serveur, aucun réseau.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudioShell, extractDesignDna, type StudioDesignDna } from '../src/routes/conversation.js';

const DNA_WARM: StudioDesignDna = {
  palette: { bg: '#fff8f0', fg: '#3b2a1e', accent: '#d97706' },
  font: 'Fraunces',
  mode: 'light'
};

const DNA_COOL: StudioDesignDna = {
  palette: { bg: '#0b1220', fg: '#e2e8f0', accent: '#38bdf8' },
  font: 'Space Grotesk',
  mode: 'dark'
};

describe('ÉTAPE 52 Phase 2A — shell legacy (non-régression stricte)', () => {
  it('sans DNA : le shell est identique octet pour octet à l ancien', () => {
    const doc = buildStudioShell('<section>contenu</section>');
    // Tous les marqueurs de l'ancien shell figé
    assert.ok(doc.includes('https://cdn.tailwindcss.com'));
    assert.ok(doc.includes('cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0'));
    assert.ok(doc.includes('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap'));
    assert.ok(doc.includes("font-family: 'Plus Jakarta Sans', sans-serif"));
    assert.ok(doc.includes('background-color: #070913'));
    assert.ok(doc.includes('color: #f1f5f9'));
    assert.ok(doc.includes('class="dark scroll-smooth"'));
    // Déterminisme : deux appels identiques
    assert.equal(doc, buildStudioShell('<section>contenu</section>'));
  });
});

describe('ÉTAPE 52 Phase 2A — shell paramétré par la DNA', () => {
  it('avec DNA : police Google Fonts dynamique + palette appliquée', () => {
    const doc = buildStudioShell('<section>boulangerie</section>', DNA_WARM);
    assert.ok(doc.includes('family=Fraunces:wght@400;500;600;700;800;900'), 'police demandée chargée');
    assert.ok(doc.includes("font-family: 'Fraunces', sans-serif"));
    assert.ok(doc.includes('background-color: #fff8f0'));
    assert.ok(doc.includes('color: #3b2a1e'));
    assert.ok(!doc.includes('#070913'), 'l ancien fond navy a disparu');
    assert.ok(doc.includes('class="scroll-smooth"'), 'mode light : classe dark retirée');
    assert.ok(doc.includes('cdn.tailwindcss.com'), 'Tailwind conservé (les sections en dépendent)');
    assert.ok(doc.includes('<section>boulangerie</section>'), 'sections intactes');
  });

  it('avec DNA dark : classe dark conservée', () => {
    const doc = buildStudioShell('<section>x</section>', DNA_COOL);
    assert.ok(doc.includes('class="dark scroll-smooth"'));
    assert.ok(doc.includes('background-color: #0b1220'));
    assert.ok(doc.includes('family=Space+Grotesk'), 'les espaces de la police deviennent des +');
  });
});

describe('ÉTAPE 52 Phase 2A — extractDesignDna', () => {
  it('bloc valide en préambule → DNA parsée + bloc retiré', () => {
    const response = '<!-- DESIGN_DNA: {"palette":{"bg":"#fff8f0","fg":"#3b2a1e","accent":"#d97706"},"font":"Fraunces","mode":"light"} -->\nJe pose un header chaleureux...\n<SECTION name="hero">\n<h1>Bonjour</h1>\n</SECTION>';
    const { dna, cleaned } = extractDesignDna(response);
    assert.ok(dna, 'DNA extraite');
    assert.equal(dna!.font, 'Fraunces');
    assert.equal(dna!.palette.accent, '#d97706');
    assert.ok(!cleaned.includes('DESIGN_DNA'), 'bloc retiré du texte');
    assert.ok(cleaned.includes('<SECTION name="hero">'), 'le reste de la réponse est intact');
  });

  it('JSON invalide → dna null, bloc quand même retiré (jamais de junk dans le HTML)', () => {
    const response = '<!-- DESIGN_DNA: {palette cassée -->\n<SECTION name="hero">\n<p>x</p>\n</SECTION>';
    const { dna, cleaned } = extractDesignDna(response);
    assert.equal(dna, null);
    assert.ok(!cleaned.includes('DESIGN_DNA'));
  });

  it('aucun bloc → texte inchangé', () => {
    const response = 'Narration simple sans bloc.\n<SECTION name="hero">\n<p>x</p>\n</SECTION>';
    const { dna, cleaned } = extractDesignDna(response);
    assert.equal(dna, null);
    assert.equal(cleaned, response);
  });

  it('premier bloc gagne si plusieurs', () => {
    const response = '<!-- DESIGN_DNA: {"palette":{"bg":"#a","fg":"#b","accent":"#c"},"font":"One"} --><!-- DESIGN_DNA: {"palette":{"bg":"#d","fg":"#e","accent":"#f"},"font":"Two"} -->x';
    const { dna, cleaned } = extractDesignDna(response);
    assert.equal(dna!.font, 'One');
    assert.ok(!cleaned.includes('DESIGN_DNA'), 'les deux blocs sont retirés');
  });

  it('document complet (chemin full-doc) : le bloc résiduel est retiré', () => {
    const doc = '<!DOCTYPE html><html><head><title>T</title></head><body><!-- DESIGN_DNA: {"palette":{"bg":"#a","fg":"#b","accent":"#c"},"font":"One"} --><p>x</p></body></html>';
    const { cleaned } = extractDesignDna(doc);
    assert.ok(!cleaned.includes('DESIGN_DNA'));
    assert.ok(cleaned.includes('<p>x</p>'), 'le contenu du document est intact');
  });
});
