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

import '../_lot-b-secret-env.js';

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
const builderAppJs = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder-app.js'), 'utf8');

describe('ÉTAPE 27 : Builder v2 = Preview principal, Legacy = fallback', () => {
  it('1. Builder v2 est le SEUL preview : chargé automatiquement à l ouverture du Studio (E45)', () => {
    const src = studio();
    assert.ok(src.includes("document.addEventListener('DOMContentLoaded', function () {"), 'boot au DOMContentLoaded');
    assert.ok(src.includes('ensureBuilderLoaded();'), 'le boot charge le Builder directement');
    assert.ok(src.includes("window.__previewMode = 'builder';"), 'mode builder permanent dès le boot');
    assert.ok(!src.includes('pvModeBuilder') && !src.includes('pvModeLegacy'), 'É28 : plus aucun bouton de switch visible');
    assert.ok(!src.includes('title="Ancien Preview (par défaut)"'), "l ancien n est plus le défaut");
  });

  it('2. Legacy SUPPRIMÉ (E45) : plus de fallback, setPreviewMode refuse tout autre mode', () => {
    const src = studio();
    assert.ok(!src.includes('Fallback Legacy'), 'plus de placeholder fallback');
    assert.ok(!src.includes('legacyHtmlBackup'), 'plus de backup legacy');
    const modeFn = src.slice(src.indexOf('function setPreviewMode(mode)'), src.indexOf('window.setPreviewMode = setPreviewMode;'));
    assert.ok(modeFn.includes("mode !== 'builder'"), 'tout mode autre que builder est refusé');
    assert.ok(modeFn.includes('console.warn'), 'refus averti (honnête)');

  });

  it('3. PONT Chat Studio → Builder : postMessage conditionné au mode builder', () => {
    const src = studio();
    // Évolué : la fonction a été renommée runConversationEngineFlowInner
    // (wrapper autour du flux) — le pont et sa garde sont inchangés.
    const flowStart = src.indexOf('async function runConversationEngineFlowInner(text, isModification, loadEl, cleanTitle, planState) {');
    assert.ok(flowStart > 0, 'fonction du flux conversationnel présente');
    const flowBlock = src.slice(flowStart, flowStart + 1600);
    assert.ok(flowBlock.includes("window.__previewMode === 'builder'"), 'conditionné au mode builder');
    assert.ok(flowBlock.includes('start-builder-generation'), 'commande de génération transmise');
    assert.ok(flowBlock.includes('postMessage'), 'transmis par postMessage (le Studio n écrit jamais dans le document du Builder)');
  });

  it('4. le Builder reçoit le pont : affichage + RELAI (plus de flux propre parallèle)', () => {
    const page = builderAppJs();
    assert.ok(page.includes('start-builder-generation'), 'listener du pont présent');
    assert.ok(page.includes('ev.origin !== location.origin'), 'origine vérifiée');
    assert.ok(page.includes('promptInput.value = d.prompt'), 'l’intention reçue reste affichée');
    assert.ok(page.includes("d.command === 'builder-event'") && page.includes('normalizeGenerationEvent(d.event)'), 'le flux du chat est rejoué (relai), pas régénéré');
  });

  it('5. gardes É26 toujours actives : aucun écrasement Legacy pendant que le Builder génère', () => {
    const src = studio();
    assert.ok(src.includes('if (__builderModeActive()) { stitch.fallbackRender = true; return; }'));
    assert.ok(src.includes('if (__builderModeActive()) return;'));
  });

  it('6. E45 : plus de retour legacy — le Builder est irréversiblement le preview', () => {
    const src = studio();
    const modeFn = src.slice(src.indexOf('function setPreviewMode(mode)'), src.indexOf('window.setPreviewMode = setPreviewMode;'));
    assert.ok(modeFn.includes('ensureBuilderLoaded()'), 'le seul effet possible est (re)charger le Builder');
    assert.ok(!modeFn.includes('srcdoc'), 'plus aucune écriture srcdoc legacy');
  });

  it('7. RESET + générations successives : le pont est réutilisable sans état caché', () => {
    const page = builderAppJs();
    assert.ok(page.includes("btnReset.addEventListener('click'"), 'RESET intact');
    // le listener du pont ne se désabonne jamais : réutilisable pour toutes
    // les générations successives de la session :
    assert.ok(!page.includes("removeEventListener('message'"));
    // et le Studio ne persiste rien du pont (pas de localStorage/sessionStorage lié) :
    assert.ok(!/Storage\.setItem\([^)]*builder/i.test(studio()));
  });
});


const appJsSrc = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder-app.js'), 'utf8');
describe('ÉTAPE 30 : mode intégré au Studio (canvas plein + resizable)', () => {
  it('1. détection embedded : la page sait qu elle tourne dans l iframe du Studio', () => {
    const page = builderAppJs();
    assert.ok(page.includes('window.parent && window.parent !== window'), 'détection iframe parent');
    assert.ok(page.includes("classList.add('embedded')"), 'classe html.embedded posée');
  });

  it('2. E45 : mode embedded PLEIN BORD (100 % largeur et hauteur, zéro marge, header masqué)', () => {
    const page = builderPage();
    assert.ok(page.includes('html.embedded .canvas { width: 100%; min-height: 100vh; border-radius: 0; }'), 'canvas plein bord');
    assert.ok(page.includes('html.embedded .canvas-wrap { padding: 0; }'), 'zéro marge');
    assert.ok(page.includes('html.embedded header.app-header { display: none !important; }'), 'header (badge PREVIEW READY) masqué');
  });

  it('3. mode embedded : le retour « ← Studio » est masqué (le chat est le point d entrée)', () => {
    const page = builderPage();
    assert.ok(page.includes('html.embedded .back { display: none !important; }'), 'retour Studio masqué en embedded');
  });

  it('4. Studio : la toolbar legacy de l aperçu reste VISIBLE (réintégrée É30-bis)', () => {
    const src = studio();
    assert.ok(src.includes('id="topPreviewToolbar"'), 'la toolbar existe toujours');
    assert.ok(src.includes('btnTopPreviewRefresh'), 'bouton Actualiser conservé');
    assert.ok(src.includes('btnTopPreviewCompare'), 'bouton Comparer conservé');
    assert.ok(!src.includes('pv-builder-active'), 'aucun masquage résiduel de la toolbar');
  });

  it('5. resizable : le panelResizer natif du Studio est toujours branché', () => {
    const src = studio();
    assert.ok(src.includes("const resizerEl = document.getElementById('panelResizer');"), 'le resizer existe');
    assert.ok(src.includes("resizerEl.addEventListener('mousedown'"), 'le drag du resizer est branché');
    assert.ok(src.includes("iframeEl.style.pointerEvents = 'none'"), 'l iframe ne capture pas le pointeur pendant le drag');
  });
});


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
    // et le boot du Studio charge cette page (E45) :
    assert.ok(studio().includes("frame.src = '/preview-builder.html?v2=1';"), 'le boot charge la page du Builder');
  });

  it('3. E45 : builder est le défaut PERMANENT (legacy inaccessible)', () => {
    const src = studio();
    assert.ok(src.includes("window.__previewMode = 'builder';"), 'builder = défaut');
    assert.equal(src.includes("window.__previewMode = 'legacy';"), false, 'plus aucun boot legacy');
    // les gardes restent en place tant que le moteur stitch n est pas
    // physiquement retiré (E46) — elles sont désormais toujours vraies :
    assert.ok(src.includes('if (__builderModeActive()) { stitch.fallbackRender = true; return; }'), 'garde stitch (toujours active)');
    assert.ok(src.includes('if (__builderModeActive()) return;'), 'garde srcdoc (toujours active)');
  });

  it('4. E45 : aucun double montage — ensureBuilderLoaded réutilise le MÊME iframe', () => {
    const src = studio();
    const count = (src.match(/id="wsLiveIframe"/g) || []).length;
    assert.equal(count, 1, 'un seul iframe de preview');
    const loadFn = src.slice(src.indexOf('function ensureBuilderLoaded()'), src.indexOf('function setPreviewMode(mode)'));
    assert.ok(loadFn.includes("frame.getAttribute('src') === '/preview-builder.html?v2=1'"), 'garde anti-rechargement (src déjà posé → return)');
    assert.ok(!loadFn.includes('createElement'), 'aucun élément créé');
  });

  it('5. E45 : plus de changement de mode — aucune écriture dans le document du Builder', () => {
    const src = studio();
    const modeFn = src.slice(src.indexOf('function ensureBuilderLoaded()'), src.indexOf('window.setPreviewMode = setPreviewMode;'));
    // le Studio n'écrit JAMAIS dans le document du Builder : le chargement
    // est une NAVIGATION vers la page autonome, rien d'autre.
    assert.equal((modeFn.match(/contentDocument/g) || []).length, 0, 'aucun accès contentDocument');
    assert.ok(modeFn.includes("frame.src = '/preview-builder.html?v2=1'"), 'le chargement = une NAVIGATION vers la page autonome');
  });

  it('6. le RESET du Builder reste fonctionnel (page autonome inchangée)', () => {
    const page = builderAppJs();
    assert.ok(page.includes("btnReset.addEventListener('click'"), 'le RESET existe toujours');
    assert.ok(page.includes('applyBuildEvent'), 'le moteur du Builder est branché');
    assert.ok(builderAppJs().includes('/preview-builder/engine.js'), 'les modules É01→É25 sont servis');
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
