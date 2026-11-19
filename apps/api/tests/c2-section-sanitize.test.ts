/**
 * LOT A-C2 (validation corrective) — sanitizeSectionHtml au point de parse.
 *
 * Constat T2 : les balises Markdown (« ``` ») émises par le LLM survivaient
 * dans le HTML persisté — une en fin de contenu de chaque section en
 * création, puis des jonctions « \n```</div> » en modification, IMITÉES par
 * le LLM tour après tour. L'ancien unwrap `…</div>$` coupait une fermeture
 * utile quand le contenu se terminait par une balise. Ces tests prouvent :
 *   - aucune balise Markdown ne survit (isolée, avec langage, en jonction) ;
 *   - le motif exact du scénario T2 est nettoyé, HTML équilibré ;
 *   - une SEULE fermeture en excès est retirée (équilibre div confirmé) ;
 *   - le HTML sain transite INCHANGÉ (idempotence, pas de réécriture) ;
 *   - un unwrap incertain est refusé (fail-closed).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSectionOrderBlocks, dedupeSectionBlocks, sanitizeSectionHtml } from '../src/routes/conversation.js';

const countFences = (html: string): number => (html.match(/```/g) ?? []).length;
const divBalance = (html: string): number =>
  (html.match(/<\/div\b/gi)?.length ?? 0) - (html.match(/<div\b/gi)?.length ?? 0);

describe('LOT A-C2 — sanitizeSectionHtml (point de parse unique)', () => {
  it('1. balise Markdown isolée en fin de contenu : supprimée, HTML intact', () => {
    const out = sanitizeSectionHtml('navigation', '<nav class="x">Accueil</nav>\n```');
    assert.equal(countFences(out), 0, 'aucune balise Markdown persistée');
    assert.equal(out, '<nav class="x">Accueil</nav>');
    assert.equal(divBalance(out), 0);
  });

  it('2. bloc ```html complet autour de la section : retiré des deux côtés', () => {
    const out = sanitizeSectionHtml('accueil', '```html\n<section id="accueil"><h1>Bienvenue</h1></section>\n```');
    assert.equal(countFences(out), 0);
    assert.equal(out, '<section id="accueil"><h1>Bienvenue</h1></section>');
    assert.equal(divBalance(out), 0);
  });

  it('3. motif exact T2 (enveloppe + balise en jonction) : enveloppe retirée, HTML équilibré', () => {
    const raw = '<div data-section="accueil"><section id="accueil">'
      + '<div class="container mx-auto"><h1>Bienvenue</h1></div>'
      + '</section>\n```</div>';
    const out = sanitizeSectionHtml('accueil', raw);
    assert.equal(countFences(out), 0);
    assert.equal(divBalance(out), 0, 'aucune fermeture orpheline');
    assert.equal(out, '<section id="accueil"><div class="container mx-auto"><h1>Bienvenue</h1></div></section>');
  });

  it('4. double jonction R2 (« ```</div> » ×2) : une seule enveloppe, équilibre exact', () => {
    const raw = '<div data-section="galerie"><section id="galerie">'
      + '<div class="grid"><img src="a.jpg"></div>'
      + '</section>\n```</div>\n```</div>';
    const out = sanitizeSectionHtml('galerie', raw);
    assert.equal(countFences(out), 0);
    assert.equal(divBalance(out), 0);
    assert.equal(out, '<section id="galerie"><div class="grid"><img src="a.jpg"></div></section>');
  });

  it('5. fermeture en excès sans enveloppe : UN </div> retiré, équilibre restauré', () => {
    const out = sanitizeSectionHtml('tarifs', '<section id="tarifs"><div class="prix">29 €</div></div>');
    assert.equal(divBalance(out), 0);
    assert.equal(out, '<section id="tarifs"><div class="prix">29 €</div>');
  });

  it('6. deux fermetures en excès : rien n’est retiré (bounded, pas de chirurgie hasardeuse)', () => {
    const raw = '<div data-section="x"><div>a</div></div></div></div>';
    const out = sanitizeSectionHtml('x', raw);
    assert.equal(divBalance(out), 2, 'équilibre ≠ 1 : aucun retrait (fail-closed)');
    assert.ok(out.includes('data-section="x"'), 'enveloppe conservée');
  });

  it('7. HTML sain : transit INCHANGÉ (idempotence)', () => {
    const clean = '<section id="contact"><form action="/contact"><button>Envoyer</button></form></section>';
    const once = sanitizeSectionHtml('contact', clean);
    assert.equal(once, clean, 'aucune réécriture du contenu sain');
    assert.equal(sanitizeSectionHtml('contact', once), once, 'second passage sans effet');
  });

  it('8. enveloppe émise par le LLM (avec le nom de la section) : unwrap historique conservé', () => {
    const raw = '<div class="vibe-stitched" data-section="hero"><div class="hero"><h1>Studio</h1></div></div>';
    const out = sanitizeSectionHtml('hero', raw);
    assert.equal(out, '<div class="hero"><h1>Studio</h1></div>');
    assert.equal(divBalance(out), 0);
  });

  it('9. fermeture appariée NON finale : unwrap refusé (fail-closed)', () => {
    const raw = '<div data-section="x"></div>texte<div class="b"></div>';
    const out = sanitizeSectionHtml('x', raw);
    assert.ok(out.includes('data-section="x"'), 'l’ancien unwrap aveugle aurait produit « </div>texte<div class="b"> »');
    assert.equal(divBalance(out), 0);
  });

  it('10. entrée vide ou balises seules : chaîne vide', () => {
    assert.equal(sanitizeSectionHtml('x', ''), '');
    assert.equal(sanitizeSectionHtml('x', '```\n```'), '');
    assert.equal(sanitizeSectionHtml('x', '```html\n```'), '');
  });

  it('11. contenu réel du scénario Studio : balises en jonction entre blocs éliminées', () => {
    // Fin de bloc telle qu'observée dans e53-rev2-bouton.html :
    // « …</section>\n```</div> » — le marqueur part, la fermeture utile reste.
    const raw = '<section id="tarifs" class="py-16"><div class="container mx-auto">'
      + '<h2>Nos formules</h2></div></section>\n```</div>';
    const out = sanitizeSectionHtml('tarifs', raw);
    assert.equal(countFences(out), 0);
    assert.equal(out, '<section id="tarifs" class="py-16"><div class="container mx-auto"><h2>Nos formules</h2></div></section>');
    assert.equal(divBalance(out), 0);
  });
});

/**
 * LOT A-C2 (validation corrective, suite) — gardien de replis du modify.
 *
 * Constat T2 de la campagne corrective : un écho FIDÈLE du LLM (section
 * inchangée réémise à l'identique) rendait le replace data-section
 * byte-identique ; le gardien `modifiedHtml === before` le confondait avec
 * « section introuvable » et enclenchait les replis à tort :
 *   - id-path (`<section id="…">`) → double-emboîtement, puis éviction du
 *     wrapper externe par dedupe → UN `</div>` en excès par bloc (+4 en
 *     campagne) ;
 *   - repli P3 « nom inexistant » → doublon inséré avant </body>, éviction
 *     → résidu `\n` dans le squelette.
 * Correctif : le gardien teste l'EXISTENCE de la cible (dataMatch), pas
 * l'identité du fichier. Reproduction exacte du T2 réel par la boucle
 * verbatim : byte-identique avant correctif, PROPRE (= page + seule la
 * modification demandée) après.
 */
describe('LOT A-C2 — écho fidèle : prémisse byte du replace identité', () => {
  const galerieBlock = '<div class="vibe-stitched" data-section="galerie">'
    + '<section id="galerie"><div class="grid"><img src="a.jpg" alt="1"></div></section></div>';
  const navigationBlock = '<div class="vibe-stitched" data-section="navigation">'
    + '<nav><a href="#accueil">Accueil</a></nav></div>';

  it('M1. écho fidèle avec <section id> : inner rendu EXACT (replace identité possible)', () => {
    const inner = '<section id="galerie"><div class="grid"><img src="a.jpg" alt="1"></div></section>';
    assert.equal(sanitizeSectionHtml('galerie', galerieBlock), inner);
    assert.equal(divBalance(sanitizeSectionHtml('galerie', galerieBlock)), 0);
  });

  it('M2. écho fidèle sans <section id> (navigation) : inner rendu EXACT', () => {
    const inner = '<nav><a href="#accueil">Accueil</a></nav>';
    assert.equal(sanitizeSectionHtml('navigation', navigationBlock), inner);
  });
});

describe('LOT A-C2 — contrat modify : écho fidèle = no-op, replis préservés', () => {
  // Sémantique du contrat route (cible trouvée → replace, JAMAIS de repli ;
  // cible absente → id-path puis repli P3 avant </body>). Chemin balise
  // (header/footer/nav) non exercé ici.
  const applyModify = (html: string, name: string, echo: string): { html: string; path: 'data' | 'id' | 'P3' } => {
    const clean = sanitizeSectionHtml(name, echo);
    const dataRe = new RegExp(`<div[^>]*data-section="${name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'g');
    const found = dataRe.exec(html) !== null;
    const before = html;
    let out = html.replace(new RegExp(dataRe.source, 'g'), `<div class="vibe-stitched" data-section="${name}">${clean}</div>`);
    if (found) return { html: out, path: 'data' };
    const idRe = new RegExp(`<section[^>]*id="${name}"[^>]*>[\\s\\S]*?<\\/section>`, 'g');
    out = out.replace(new RegExp(idRe.source, 'g'), `<div class="vibe-stitched" data-section="${name}">${clean}</div>`);
    if (out !== before) return { html: out, path: 'id' };
    const bodyClose = out.lastIndexOf('</body>');
    if (bodyClose !== -1) {
      out = out.slice(0, bodyClose) + `\n<div class="vibe-stitched" data-section="${name}">${clean}</div>\n` + out.slice(bodyClose);
      return { html: out, path: 'P3' };
    }
    return { html: out, path: 'data' };
  };

  // Document soudé (convention Studio : blocs collés, séparateur absent) —
  // la forme exacte sur laquelle le T2 réel a produit +4 / squelette modifié.
  const WELDED = '<!DOCTYPE html><html><body><h1>Hello</h1></body>\n</html>'
    + '<div class="vibe-stitched" data-section="navigation"><nav><a href="#accueil">Accueil</a></nav></div>'
    + '<div class="vibe-stitched" data-section="accueil"><section><h1>Bienvenue</h1></section></div>'
    + '<div class="vibe-stitched" data-section="galerie"><section id="galerie"><div class="grid"><img src="a.jpg"></div></section></div>';

  it('M3. échos fidèles (avec et sans <section id>) : fichier inchangé, div équilibré', () => {
    const navigationEcho = '<div class="vibe-stitched" data-section="navigation"><nav><a href="#accueil">Accueil</a></nav></div>';
    const galerieEcho = '<div class="vibe-stitched" data-section="galerie"><section id="galerie"><div class="grid"><img src="a.jpg"></div></section></div>';
    let out = applyModify(WELDED, 'navigation', navigationEcho).html;
    out = applyModify(out, 'galerie', galerieEcho).html;
    assert.equal(out, WELDED, 'un écho fidèle ne doit RIEN changer (ni double-emboîtement, ni doublon P3)');
    out = canonicalSectionOrderBlocks(out);
    out = dedupeSectionBlocks(out);
    assert.equal(out, WELDED, 'canonisation + déduplication sans effet sur un fichier propre');
    assert.equal(divBalance(out), 0);
  });

  it('M4. nom inexistant : repli P3 PRÉSERVÉ (insertion avant </body>)', () => {
    const { html, path } = applyModify(WELDED, 'faq', '<section id="faq"><p>Questions</p></section>');
    assert.equal(path, 'P3');
    const bodyClose = html.lastIndexOf('</body>');
    assert.ok(bodyClose !== -1);
    assert.ok(html.slice(0, bodyClose).includes('<div class="vibe-stitched" data-section="faq"><section id="faq"><p>Questions</p></section></div>'), 'insertion avant </body>');
    assert.equal((html.match(/data-section="faq"/g) ?? []).length, 1, 'une seule occurrence faq (pas de doublon fantôme)');
  });

  it('M5. section présente via <section id> seul : id-path PRÉSERVÉ (wrapper stitch)', () => {
    const legacy = '<!DOCTYPE html><html><body><h1>Hello</h1><section id="faq"><p>Questions</p></section></body></html>';
    const { html, path } = applyModify(legacy, 'faq', '<section id="faq"><p>Questions</p></section>');
    assert.equal(path, 'id');
    assert.ok(html.includes('<div class="vibe-stitched" data-section="faq"><section id="faq"><p>Questions</p></section></div>'), 'wrapper data-section porté par la section insérée');
    assert.ok(!html.includes('\n<div class="vibe-stitched" data-section="faq">'), 'pas de doublon P3 additionnel');
  });

  it('M6. garde source : le gardien teste la cible (dataMatch), pas l\'identité du fichier', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'apps/api/src/routes/conversation.ts'), 'utf8');
    assert.ok(src.includes('const foundByData = dataMatch !== null;'), 'existence de la cible capturée avant le replace');
    assert.ok(src.includes('if (!foundByData) {'), 'replis (id/tag/P3) conditionnés à l\'ABSENCE de cible data-section');
    assert.ok(src.includes("LOT A-C2 — le gardien teste l'existence de la cible"), 'marqueur correctif présent');
  });
});
