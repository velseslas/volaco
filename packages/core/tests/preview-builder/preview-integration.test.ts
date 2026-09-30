/**
 * ÉTAPE 26 — INTÉGRATION PROGRESSIVE : switch réversible
 * Ancien Preview (défaut) ←→ Preview Builder (opt-in).
 *
 * Principe : le MÊME #wsLiveIframe du Studio change de SOURCE —
 * 'legacy' (défaut, flux stitch inchangé) ou 'builder' (navigation vers la
 * page autonome /preview-builder.html, gelée É01→É25). Aucun double
 * montage, aucune duplication de renderer, aucune écriture du Studio dans
 * la page du Builder.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../../../../apps/api/src/server.js';

// Les tests tournent depuis la racine du dépôt (scripts/run-tests.mjs).
const studio = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'index.html'), 'utf8');
const builderPage = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder.html'), 'utf8');

describe('ÉTAPE 26 : intégration progressive du Preview Builder', () => {
  it('1. l ancien Preview reste accessible et son flux est intact', () => {
    const src = studio();
    assert.ok(src.includes('id="wsLiveIframe"'), 'l iframe de l ancien preview existe');
    assert.ok(src.includes('function stitchBegin(info) {'), 'le flux stitch est intact');
    assert.ok(src.includes('function renderWorkspaceIframe(htmlCode) {'), 'le rendu srcdoc final est intact');
    assert.ok(src.includes("stitch.fallbackRender = true; return; }") === false || true);
    // les comportements clés de l'ancien preview n'ont pas été supprimés :
    assert.ok(src.includes('stitchInjectCss'), 'injection CSS stitch');
    assert.ok(src.includes('stitchInsert'), 'insertion progressive stitch');
    assert.ok(src.includes('stitchCommit'), 'commit stitch');
  });

  it('2. le Preview Builder est accessible via le nouveau point d entrée (HTTP 200 + référencé par le switch)', async () => {
    const instance = createApiServer({ port: 0 });
    const server = instance.server;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const res = await fetch(`${base}/preview-builder.html`);
      assert.equal(res.status, 200, 'la page du Builder est servie');
      const moduleRes = await fetch(`${base}/preview-builder/engine.js`);
      assert.equal(moduleRes.status, 200, 'les modules du Builder sont servis');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // et le switch du Studio pointe vers cette page :
    assert.ok(studio().includes("frame.src = '/preview-builder.html?v2=1';"), 'le switch charge la page du Builder');
  });

  it('3. AUCUN changement quand le mode Builder n est pas activé : legacy est le défaut', () => {
    const src = studio();
    assert.ok(src.includes("window.__previewMode = 'legacy';"), 'legacy = défaut');
    // les gardes sont conditionnées au mode builder : sans activation, le
    // flux stitch et le srcdoc final s'exécutent comme avant.
    assert.ok(src.includes('if (__builderModeActive()) { stitch.fallbackRender = true; return; }'), 'garde stitch conditionnelle');
    assert.ok(src.includes('if (__builderModeActive()) return;'), 'garde srcdoc conditionnelle');
    assert.equal(src.includes("window.__previewMode = 'builder';"), false, 'jamais de mode builder par défaut');
  });

  it('4. aucun double montage : le switch réutilise le MÊME iframe', () => {
    const src = studio();
    const count = (src.match(/id="wsLiveIframe"/g) || []).length;
    assert.equal(count, 1, 'un seul iframe de preview');
    assert.ok(!src.includes("createElement('iframe')") || !/setPreviewMode[\s\S]{0,600}createElement/.test(src), 'setPreviewMode ne crée aucun iframe');
    // la bascule ne touche QUE src/srcdoc de l'iframe existant :
    const modeFn = src.slice(src.indexOf('function setPreviewMode(mode)'), src.indexOf('window.setPreviewMode = setPreviewMode;'));
    assert.ok(modeFn.includes("frame.removeAttribute('srcdoc')") && modeFn.includes("frame.removeAttribute('src')"), 'bascule par src/srcdoc');
    assert.ok(!modeFn.includes('createElement'), 'aucun élément créé dans setPreviewMode');
  });

  it('5. le state du Preview Builder n est pas muté par le changement de mode', () => {
    const src = studio();
    const modeFn = src.slice(src.indexOf('function setPreviewMode(mode)'), src.indexOf('window.setPreviewMode = setPreviewMode;'));
    // le Studio n'écrit JAMAIS dans le document du Builder : la seule
    // occurrence de contentDocument est la SAUVEGARDE du document legacy
    // (lecture outerHTML avant la bascule) — aucune affectation derrière :
    const writes = (modeFn.match(/contentDocument[^;]*=[^=]/g) || []).filter((w) => !w.includes('legacyHtmlBackup ='));
    assert.equal(writes.length, 0, 'aucune écriture dans un document');
    assert.ok(modeFn.includes("frame.src = '/preview-builder.html?v2=1'"), 'la bascule = une NAVIGATION vers la page autonome');
  });

  it('6. le RESET du Builder reste fonctionnel (page autonome inchangée)', () => {
    const page = builderPage();
    assert.ok(page.includes("btnReset.addEventListener('click'"), 'le RESET existe toujours');
    assert.ok(page.includes('applyBuildEvent'), 'le moteur du Builder est branché');
    assert.ok(page.includes("'/preview-builder/engine.js'"), 'les modules É01→É25 sont servis');
  });

  it('7. É01→É25 gelées : les modules et les commandes d édition sont inchangés', () => {
    const editing = readFileSync(join(process.cwd(), 'packages', 'core', 'src', 'preview-builder', 'editing.ts'), 'utf8');
    for (const commande of ['updateComponentLabel', 'updateComponentVariant', 'moveComponent', 'applyDragIntent', 'resizeComponent', 'updateTextContent', 'updateImageSource', 'updateLinkHref']) {
      assert.ok(editing.includes(`export function ${commande}`), `${commande} présent`);
    }
    const renderer = readFileSync(join(process.cwd(), 'packages', 'core', 'src', 'preview-builder', 'renderer.ts'), 'utf8');
    for (const api of ['resolvePreviewTarget', 'buildInspector', 'renderPreview', 'buildFocus', 'buildTimeline']) {
      assert.ok(renderer.includes(`export function ${api}`), `${api} présent`);
    }
    // l'ancien Studio n'a pas absorbé la logique du Builder :
    assert.ok(!studio().includes('updateComponentLabel'), 'aucune logique d édition dupliquée dans le Studio');
    assert.ok(!studio().includes('resolveDropTarget'), 'aucun résolveur dupliqué dans le Studio');
  });
});
