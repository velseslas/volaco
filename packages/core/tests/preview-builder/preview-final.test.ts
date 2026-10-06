/**
 * ÉTAPE 28 — PAGE PREVIEW FINALE : canvas maximal, UI Builder retirée de
 * l'interface VISIBLE (la logique É01→É27 reste vivante dans le chrome
 * masqué #builderChrome). Aucune API retirée, aucun second système.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../../../../apps/api/src/server.js';

const page = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder.html'), 'utf8').replace(/\r\n/g, '\n');
const appJs = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder-app.js'), 'utf8').replace(/\r\n/g, '\n');
const studio = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'index.html'), 'utf8');
/** La zone VISIBLE = le body SANS le chrome Builder masqué (le CSS en tête est ignoré). */
const body = (): string => {
  const src = page();
  const start = src.indexOf('<body>');
  const chrome = src.indexOf('<div id="builderChrome" hidden>');
  // zone visible = body SANS chrome ET SANS le contenu des balises <script>
  // (les commentaires du module ne sont pas de l UI) — scanner sans regex :
  let out = '';
  let pos = start;
  for (;;) {
    const open = src.indexOf('<script', pos);
    if (open < 0 || open >= chrome) { out += src.slice(pos, chrome); break; }
    out += src.slice(pos, open);
    const close = src.indexOf('</' + 'script>', open);
    if (close < 0) break;
    pos = close + 9;
  }
  return out;
};

describe('ÉTAPE 28 : page Preview finale (canvas maximal)', () => {
  it('1. BUILD/INSPECTOR/Timeline/Progress/Tree retirés de l interface VISIBLE', () => {
    const visible = body();
    for (const interdit of ['panel-build', 'panel-inspect', 'id="stageLadder"', 'id="progressBar"', 'id="compTree"', 'id="v2Panel"', 'statusbar']) {
      assert.ok(!visible.includes(interdit), `${interdit} absent de l interface visible`);
    }
    const src = page();
    const chromeStart = src.indexOf('<div id="builderChrome" hidden>');
    const chrome = src.slice(chromeStart);
    assert.ok(chrome.includes('panel-build') && chrome.includes('panel-inspect') && chrome.includes('statusbar'), 'logique conservée dans le chrome');
  });

  it('2. les textes d outil (BUILD, Inspector, Tree…) ne s affichent plus', () => {
    const visible = body();
    for (const texte of ['>Build</h2>', 'Component Tree', 'Real AI Generation', 'Live Preview', '>RESET</button>', 'GÉNÉRER (flux réel)']) {
      assert.ok(!visible.includes(texte), `"${texte}" absent de l interface visible`);
    }
    const chrome = page().slice(page().indexOf('<div id="builderChrome" hidden>'));
    assert.ok(chrome.includes('GÉNÉRER (flux réel)') && chrome.includes('btnReset'), 'logique de génération conservée');
  });

  it('3. aucune colonne latérale : le layout est une seule zone canvas', () => {
    const src = page();
    assert.ok(src.includes('.layout { display: flex; flex-direction: column; flex: 1; min-height: 0; }'), 'layout une colonne');
    assert.ok(!src.includes('grid-template-columns: 300px 1fr 280px'), 'plus de grille 3 colonnes');
    const layoutBlock = src.slice(src.indexOf('<div class="layout">'), src.indexOf('<section class="canvas-panel"'));
    assert.ok(!layoutBlock.includes('<aside'), 'aucun aside dans le layout');
  });

  it('4. canvas présent et maximisé (P5-ter : PLEIN BORD, comme le bundle React)', () => {
    const src = page();
    assert.ok(src.includes('<div class="canvas" id="canvas"></div>'), 'canvas présent');
    assert.ok(src.includes('width: 100%; min-height: 100vh;'), 'canvas 100 % plein bord');
    assert.ok(src.includes('.canvas-panel { display: flex; flex-direction: column; min-width: 0; flex: 1; min-height: 0; }'), 'le canvas prend tout l espace disponible (borné — É46 : une seule barre de défilement)');
    assert.ok(!src.includes('width: min(1400px, 100%)'), 'plus de plafonnement carte démo');
    assert.ok(!src.includes('<h2>Live Preview</h2>'), 'aucun titre d outil au-dessus du canvas');
  });

  it('5. É30 : les boutons viewport sont supprimés du header (Desktop reste le rendu)', () => {
    const visible = body();
    assert.ok(!visible.includes('vp-switch'), 'aucun bouton Desktop/Tablet/Mobile visible');
    assert.ok(!visible.includes('data-vp='), 'aucun contrôle de viewport dans la page finale');
    // le CSS viewport (vp-tablet/vp-mobile) reste fonctionnel techniquement :
    assert.ok(page().includes('.canvas.vp-tablet') && page().includes('.canvas.vp-mobile'), 'CSS viewport conservé');
    // le handler viewport vit dans le module app.js :
    assert.ok(appJs().includes("document.querySelectorAll('.vp-btn')"), 'le handler viewport reste dans le code (sans bouton)');
  });

  it('6. le pont Chat Studio → Builder reste fonctionnel (éléments conservés)', () => {
    const src = appJs();
    assert.ok(src.includes("d.command !== 'start-builder-generation'"), 'listener du pont présent');
    assert.ok(page().includes('id="v2Prompt"') && page().includes('id="btnReal"'), 'v2Prompt + btnReal conservés (dans le chrome)');
    assert.ok(src.includes("promptInput.value = d.prompt") && src.includes('realBtn.click()'), 'le pont déclenche toujours le flux réel');
  });

  it('7. PREVIEW READY fonctionne toujours (statusBadge conservé, visible dans le header)', () => {
    const visible = body();
    assert.ok(visible.includes('id="statusBadge"'), 'statusBadge visible dans le header de la page');
    assert.ok(appJs().includes("el('statusBadge')"), 'le pipeline écrit toujours l état via le modèle');
  });

  it('8. la logique d édition É16→É24 reste dans le code (invisible en final)', () => {
    const src = appJs();
    assert.ok(src.includes('updateComponentLabel') && src.includes('updateTextContent') && src.includes('updateImageSource') && src.includes('updateLinkHref'), 'éditions importées');
    assert.ok(src.includes("el('inspectorBody')"), 'renderInspector continue d écrire (dans le chrome masqué)');
  });

  it('9. E45 : le pont reçoit du chat, les gardes et le boot direct du Builder', () => {
    const studioSrc = studio();
    assert.ok(studioSrc.includes("command: 'start-builder-generation'"), 'pont côté Studio');
    assert.ok(studioSrc.includes("document.addEventListener('DOMContentLoaded'") && studioSrc.includes('ensureBuilderLoaded();'), 'boot Builder (E45) côté Studio');
  });

  it('10. E45 : legacy SUPPRIMÉ de l UI (stitch encore présent mais inert, purge E46)', () => {
    const src = studio();
    assert.ok(!src.includes('Fallback Legacy'), 'plus de placeholder fallback');
    assert.ok(!src.includes("legacyHtmlBackup"), 'plus de backup legacy');
    assert.ok(src.includes("mode !== 'builder'"), 'setPreviewMode refuse tout mode non-builder');
    assert.ok(src.includes('function stitchBegin(info) {'), 'moteur stitch encore présent (inert — purge E46)');
  });

  it('11. un seul iframe côté Studio (aucun second système)', () => {
    const src = studio();
    const count = (src.match(/id="wsLiveIframe"/g) || []).length;
    assert.equal(count, 1);
  });
});

describe('ÉTAPE 28 : page servie (HTTP)', () => {
  it('12. la page finale est servie avec ses modules', async () => {
    const instance = createApiServer({ port: 0 });
    const server = instance.server;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const path of ['/preview-builder.html', '/preview-builder/engine.js', '/preview-builder/renderer.js', '/preview-builder/editing.js']) {
        const res = await fetch(base + path);
        assert.equal(res.status, 200, `${path} servi`);
      }
      const html = await fetch(base + '/preview-builder.html').then((r) => r.text());
      assert.ok(html.includes('builderChrome'), 'chrome masqué servi');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
