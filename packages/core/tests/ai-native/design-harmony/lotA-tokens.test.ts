/**
 * LOT A — CDC V8 §7 : Design Tokens Engine (preuves).
 *
 * Prouve que :
 *  1. les blocs <style> du document sont réellement lus (variables CSS,
 *     media queries filtrées par viewport, sélecteurs descendants) ;
 *  2. les tokens MOTION (§7.6) proviennent de durées/easings/transitions
 *     RÉELLEMENT observés (styles calculés ou CSS) — listes vides sinon ;
 *  3. les tokens LAYOUT (§7.7) proviennent des max-width/grilles/gutters/
 *     breakpoints réellement déclarés ;
 *  4. l'inférence reste DÉTERMINISTE (deux passes => même objet).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VisualIntelligenceService,
  TokenInferer,
  StyleComputer,
  extractDocumentCss,
  parseCss,
  type VisualSnapshot
} from '../../../src/index.js';

const TENANT = 'tenant_lot_a';
const PROJECT = 'proj_lot_a_tokens';

const CSS = `
  :root { --brand: #2563eb; --ink: #111827; }
  body { background-color: #ffffff; color: var(--ink); font-family: Inter, sans-serif; padding: 24px; }
  .btn-primary {
    background-color: var(--brand);
    color: #ffffff;
    border-radius: 8px;
    padding: 12px 20px;
    transition: background-color 240ms ease-in-out;
  }
  .btn-secondary { background-color: #0e7490; color: #ffffff; border-radius: 8px; padding: 12px 20px; }
  .btn-primary:hover { background-color: #1d4ed8; transition: transform 120ms ease; }
  .card { background-color: #f8fafc; border-radius: 12px; padding: 16px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); }
  .container {
    max-width: 1024px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
    margin: 0 auto;
  }
  .hero { animation: fade-in 300ms ease-out; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2); }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
  @media (min-width: 768px) { .container { padding: 32px; } }
  .container .card { border: 1px solid #e2e8f0; }
`;

const HTML = `<!DOCTYPE html>
<html><head><style>${CSS}</style></head>
<body>
  <h1 class="hero" style="font-size: 40px; font-weight: 700; letter-spacing: 0.02em">Titre principal</h1>
  <h2 style="font-size: 28px">Sous-titre</h2>
  <p style="font-size: 16px">Premier paragraphe de contenu réel.</p>
  <p style="font-size: 16px">Deuxième paragraphe de contenu réel.</p>
  <p style="font-size: 14px">Mention secondaire.</p>
  <button class="btn-primary" aria-label="Action principale">Agir</button>
  <button class="btn-secondary" aria-label="Action secondaire">Autre</button>
  <div class="container">
    <div class="card">Carte A</div>
    <div class="card">Carte B</div>
  </div>
  <span class="badge-success" style="background-color: #16a34a">OK</span>
  <span class="badge-warning" style="background-color: #f59e0b">Attention</span>
  <span class="badge-error" style="background-color: #dc2626">Erreur</span>
  <span class="badge-info" style="background-color: #0284c7">Info</span>
</body></html>`;

const service = new VisualIntelligenceService();
let routeCounter = 0;

async function snapshotOf(html: string, extraCss = ''): Promise<VisualSnapshot> {
  const result = await service.analyzeVisuals({
    tenantId: TENANT,
    projectId: PROJECT,
    pageRoute: `/lot-a-${++routeCounter}`,
    htmlContent: html,
    cssContent: extraCss
  });
  return result.snapshot;
}

describe('LOT A §7 — Design Tokens (motion, layout, styles documentaires)', () => {
  it('extrait réellement les blocs <style> et les variables CSS', () => {
    const css = extractDocumentCss(HTML);
    assert.ok(css.includes(':root'), 'bloc <style> extrait');
    assert.ok(css.includes('@keyframes fade-in'), 'keyframes extraits');

    const parsed = parseCss(css);
    assert.equal(parsed.variables['--brand'], '#2563eb');
    assert.equal(parsed.variables['--ink'], '#111827');
    assert.ok(parsed.breakpoints.includes('768px'), 'breakpoint 768px observé');
    assert.ok(parsed.keyframes.includes('fade-in'));
  });

  it('applique les media queries selon le viewport réel (et pas en dessous)', () => {
    const parsed = parseCss(CSS);
    const context = { tagName: 'div', id: '', classes: ['container'], ancestors: [] };
    const sc = new StyleComputer();
    const mobile = sc.resolveStylesForClasses(['container'], '', CSS, '', 'div', undefined, undefined, {
      parsed,
      context,
      viewportWidth: 375
    });
    const desktop = sc.resolveStylesForClasses(['container'], '', CSS, '', 'div', undefined, undefined, {
      parsed,
      context,
      viewportWidth: 1280
    });
    assert.equal(mobile.padding, '0px', 'padding média NON appliqué à 375px');
    assert.equal(desktop.padding, '32px', 'padding média appliqué à 1280px');
  });

  it('applique les sélecteurs descendants et les variables CSS', async () => {
    const snap = await snapshotOf(HTML, CSS);
    const walk = (n: VisualSnapshot['rootNode']): VisualSnapshot['rootNode'][] => [n, ...n.children.flatMap(walk)];
    const card = walk(snap.rootNode).find((n) => n.classes.includes('card'));
    assert.ok(card, 'carte présente');
    assert.equal(card!.styles.borderColor, '#e2e8f0', 'règle .container .card appliquée');
    assert.equal(card!.styles.borderWidth, '1px');
  });

  it('infère les couleurs de rôle et les couleurs d’état réellement présentes', async () => {
    const snap = await snapshotOf(HTML, CSS);
    const t = new TokenInferer().inferDesignSystem([snap], { cssContent: CSS });
    assert.equal(t.colorTokens.primary, '#2563eb', 'primaire = fond du bouton principal (var résolue)');
    assert.equal(t.colorTokens.success, '#16a34a');
    assert.equal(t.colorTokens.warning, '#f59e0b');
    assert.equal(t.colorTokens.error, '#dc2626');
    assert.equal(t.colorTokens.info, '#0284c7');
    assert.notEqual(t.colorTokens.secondary, t.colorTokens.success, 'jamais une couleur d’état comme secondaire');
  });

  it('expose l’échelle typographique, les graisses et l’interlettrage observés', async () => {
    const snap = await snapshotOf(HTML, CSS);
    const t = new TokenInferer().inferDesignSystem([snap], { cssContent: CSS });
    assert.equal(t.typographyTokens.styleScale?.h1, '40px');
    assert.equal(t.typographyTokens.styleScale?.h2, '28px');
    assert.equal(t.typographyTokens.styleScale?.body, '16px');
    assert.equal(t.typographyTokens.styleScale?.caption, '14px');
    assert.ok(t.typographyTokens.fontWeights?.includes('700'), 'graisse 700 observée');
    assert.ok(t.typographyTokens.letterSpacings?.includes('0.02em'), 'letter-spacing observé');
  });

  it('expose l’échelle de rayons et les niveaux d’élévation nommés', async () => {
    const snap = await snapshotOf(HTML, CSS);
    const t = new TokenInferer().inferDesignSystem([snap], { cssContent: CSS });
    assert.ok(t.shapeTokens.detectedRadii.includes('8px'));
    assert.ok(t.shapeTokens.detectedRadii.includes('12px'));
    assert.equal(t.shapeTokens.radiusScale?.xs, '8px');
    assert.equal(t.shapeTokens.radiusScale?.xl, '12px');

    const levels = t.elevationTokens.levels ?? [];
    assert.ok(levels.some((l) => l.level === 'NONE'), 'niveau NONE observé');
    assert.ok(levels.some((l) => l.level === 'SUBTLE'), 'ombre douce (flou 2px)');
    assert.ok(levels.some((l) => l.level === 'STRONG'), 'ombre forte (flou 32px)');
  });

  it('infère les tokens MOTION §7.6 depuis les transitions/animations réelles', async () => {
    const snap = await snapshotOf(HTML, CSS);
    const t = new TokenInferer().inferDesignSystem([snap], { cssContent: CSS });
    const motion = t.motionTokens!;
    assert.ok(motion.durations.includes('240ms'), 'durée de transition observée');
    assert.ok(motion.durations.includes('300ms'), 'durée d’animation observée');
    assert.ok(motion.durations.includes('120ms'), 'durée de la règle :hover observée');
    assert.ok(motion.easings.includes('ease-in-out'));
    assert.ok(motion.transitions.includes('background-color'));
    assert.ok(motion.hover.includes('transform'), 'transition :hover isolée des styles de base');
    assert.ok(motion.entrance.includes('fade-in'), 'animation d’entrée réelle');
    assert.deepEqual(motion.exit, [], 'aucune animation de sortie inventée');
    assert.ok(motion.evidenceCount > 0);
  });

  it('infère les tokens LAYOUT §7.7 (conteneur, grille, gutters, breakpoints, densité)', async () => {
    const snap = await snapshotOf(HTML, CSS);
    const t = new TokenInferer().inferDesignSystem([snap], { cssContent: CSS });
    const layout = t.layoutTokens!;
    assert.equal(layout.containerWidth, '1024px');
    assert.ok(layout.gridTemplateColumns.some((g) => g.startsWith('repeat(2')), 'grille 2 colonnes');
    assert.ok(layout.gutters.includes('24px'), 'gouttière réelle');
    assert.ok(layout.breakpoints.includes('768px'));
    assert.ok(layout.density === 'COMPACT' || layout.density === 'BALANCED' || layout.density === 'SPACIOUS');
    assert.ok(layout.evidenceCount > 0);
  });

  it('n’invente AUCUN token motion/layout sans preuve (listes vides)', async () => {
    const plain = await snapshotOf('<div><p>Texte simple</p></div>', '');
    const t = new TokenInferer().inferDesignSystem([plain], { cssContent: '' });
    assert.deepEqual(t.motionTokens?.durations, []);
    assert.deepEqual(t.motionTokens?.easings, []);
    assert.deepEqual(t.motionTokens?.hover, []);
    assert.deepEqual(t.motionTokens?.entrance, []);
    assert.deepEqual(t.layoutTokens?.breakpoints, []);
    assert.deepEqual(t.layoutTokens?.gridTemplateColumns, []);
    assert.equal(t.layoutTokens?.containerWidth, undefined);
  });

  it('est déterministe : deux inférences identiques => même objet', async () => {
    const snap = await snapshotOf(HTML, CSS);
    const inferer = new TokenInferer();
    const a = inferer.inferDesignSystem([snap], { cssContent: CSS });
    const b = inferer.inferDesignSystem([snap], { cssContent: CSS });
    assert.deepEqual(a, b);
  });
});
