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
import { addImageFallbacks, buildStudioShell, deriveFallbackTitle, extractPageTitle } from '../src/routes/conversation.js';
import { THEME_IMAGE_RESOURCES } from '../../../packages/core/src/image/theme.js';

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

  it('4. titre réel du commerce (PAGE_TITLE), jamais générique, échappé', () => {
    assert.match(buildStudioShell(fragments), /<title>VibeCode Studio<\/title>/, 'défaut conservé sans marqueur');
    const withTitle = buildStudioShell(fragments, undefined, 'Bella Italia — Pizzeria');
    assert.match(withTitle, /<title>Bella Italia — Pizzeria<\/title>/, 'le vrai nom est posé');
    const evil = buildStudioShell(fragments, undefined, '<script>alert(1)</script>');
    assert.ok(!evil.includes('<script>alert'), 'balises neutralisées');
    assert.match(evil, /&lt;script&gt;/, 'échappement HTML');
  });

  it('5b. deriveFallbackTitle : H1 puis H2, balises retirées, null si vide', () => {
    assert.equal(deriveFallbackTitle('<section><h1>Pain frais, <span>Boulangerie</span></h1></section>'), 'Pain frais, Boulangerie');
    assert.equal(deriveFallbackTitle('<section><h2>Nos formules</h2></section>'), 'Nos formules');
    assert.equal(deriveFallbackTitle('<section><h1>AB</h1><h2>Formules et tarifs du Fournil</h2></section>'), 'Formules et tarifs du Fournil', 'H1 trop court → H2');
    assert.equal(deriveFallbackTitle('<div>sans titre</div>'), null);
  });

  it('5. extractPageTitle : premier bloc gagne, nettoyé du HTML', () => {
    const src = '<!-- PAGE_TITLE: Ma Boulangerie --><div>...</div><!-- PAGE_TITLE: Second -->';
    const { title, cleaned } = extractPageTitle(src);
    assert.equal(title, 'Ma Boulangerie');
    assert.ok(!cleaned.includes('PAGE_TITLE'), 'marqueur retiré');
    assert.deepEqual(extractPageTitle('<div>sans marqueur</div>').title, null);
    assert.deepEqual(extractPageTitle('<!-- PAGE_TITLE: <b>X</b> -->').title, 'X', 'balises retirées');
  });

  it('6b. garde source : brief visuel par thème câblé aux deux prompts (P0 images)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'apps/api/src/routes/conversation.ts'), 'utf8');
    const theme = readFileSync(join(process.cwd(), 'packages/core/src/image/theme.ts'), 'utf8');
    // Câblage : les deux prompts consomment le brief serveur (fini le paragraphe statique)
    // (UNSPLASH-DYN : 4e argument optionnel possible — la garde vérifie la tête d'appel seedée)
    assert.ok(src.includes("buildImageBrief(imageTheme, 'create', imageSeed"), 'prompt création briefé par thème (rotation seedée)');
    assert.ok(src.includes("buildImageBrief(imageTheme, 'modify', imageSeed"), 'prompt modification briefé + préservation (rotation seedée)');
    assert.ok(src.includes('sanitizeImageSources(assembledHtml, imageTheme, imageSeed, dynamicImages)'), 'sanitizer final nourri par la source réelle quand la clé usager est fournie');
    assert.ok(src.includes('const imageSeed = poolRotationSeed(requestId)'), 'seed de rotation déterministe par génération');
    assert.ok(src.includes('detectImageTheme(body.message'), 'thème détecté côté serveur depuis la demande');
    // Réservoir : vit désormais dans le module thème (source unique)
    assert.ok(theme.includes('RÉSERVOIR vérifié'), 'réservoir imposé dans le brief');
    assert.ok(theme.includes('photo-1513104890138-7c749659a591'), 'IDs vérifiés présents');
    assert.ok(theme.includes("jamais d'autre adresse inventée de mémoire") || theme.includes("inventée de mémoire"), 'invention interdite');
    // Bugs historiques toujours bannis du code serveur
    assert.ok(!src.includes('loremflickr.com/1200/800/'), 'loremflickr retiré (panne 500 constatée)');
  });

  it('6. addImageFallbacks : onerror ajouté aux http(s) sans gestionnaire, le reste intact', () => {
    const html = '<p>ok</p>'
      + '<img src="https://images.unsplash.com/photo-1" alt="pizza">'
      + '<img src="https://x.test/a.png" alt="a > b">'
      + '<img src="https://y.test/b.png" onerror="custom()">';
    const out = addImageFallbacks(html);
    assert.ok(out.includes('<p>ok</p>'), 'non-images intactes');
    const withFallback = (out.match(/onerror="this\.onerror=null/g) || []).length;
    assert.equal(withFallback, 2, 'exactement les 2 http(s) sans onerror équipées');
    assert.ok(out.includes('onerror="custom()"'), 'gestionnaire existant conservé');
    assert.ok(out.includes('alt="a > b"'), '`>` dans alt préservé (tag non corrompu)');
    const fb = [...out.matchAll(/onerror="this\.onerror=null;this\.src='([^']+)'/g)].map((m) => m[1] ?? '');
    assert.equal(fb.length, 2, '2 replis émis');
    const fbIds = fb.map((s) => /photo-[0-9a-z-]+/.exec(s)?.[0] ?? '');
    for (const id of fbIds) assert.ok(THEME_IMAGE_RESOURCES.autre.unsplash.includes(id), 'repli T0.5 : ' + id);
    assert.ok(new Set(fbIds).size === 2, 'replis distincts');
    assert.equal(addImageFallbacks('<img src="data:image/png;base64,xx">'), '<img src="data:image/png;base64,xx">', 'data: ignoré');
  });
});
