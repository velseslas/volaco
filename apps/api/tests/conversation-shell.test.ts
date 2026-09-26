/**
 * Tests du shell HTML complet (audit preview 26/09/2026)
 *
 * Avant correctif : en création, le serveur sauvegardait et renvoyait des
 * fragments bruts (<div data-section>...) sans <head> — l'éditeur, le preview
 * headless et les tours suivants travailaient sur un document incomplet ; et
 * le client ré-emballait systématiquement le HTML reçu dans son template,
 * produisant un document imbriqué (DOCTYPE dans <body>) dès le mode
 * modification. Convention établie : le serveur envoie TOUJOURS un document
 * complet, le client ne ré-emballe que s'il ne détecte pas de DOCTYPE/<html>.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudioShell } from '../src/routes/conversation.js';

describe('conversation : shell HTML complet', () => {
  const fragments = '<div data-section="header"><header>Menu</header></div>\n<div data-section="hero"><section><h1>Bienvenue</h1></section></div>';

  it('1. enveloppe les fragments dans un document complet', () => {
    const doc = buildStudioShell(fragments);
    assert.match(doc, /^<!DOCTYPE html>/i, 'Le document doit commencer par un DOCTYPE');
    assert.ok(doc.includes('<html'), 'Doit contenir <html>');
    assert.ok(doc.includes('</body>'), 'Doit fermer le body');
    assert.ok(doc.includes('cdn.tailwindcss.com'), 'Doit charger Tailwind (sinon preview sans styles)');
    assert.ok(doc.includes(fragments), 'Les sections doivent être présentes telles quelles dans le body');
  });

  it('2. place les sections dans le <body>, pas dans le <head>', () => {
    const doc = buildStudioShell(fragments);
    const bodyStart = doc.indexOf('<body>');
    const headEnd = doc.indexOf('</head>');
    assert.ok(bodyStart > headEnd, 'Le <body> doit venir après le </head>');
    assert.ok(doc.indexOf('data-section') > bodyStart, 'Les sections doivent être dans le body');
  });

  it('3. la détection de document complet (garde anti double-emballage) reconnaît la sortie du shell', () => {
    const doc = buildStudioShell(fragments);
    // Même regex que le client (handler done) et que le serveur (garde) :
    assert.ok(/<!DOCTYPE|<html[\s>]/i.test(doc), 'Un document shell-wrappé doit être détecté comme complet');
    assert.ok(!/<!DOCTYPE|<html[\s>]/i.test(fragments), 'Des fragments bruts ne doivent PAS être détectés comme un document complet');
  });
});
