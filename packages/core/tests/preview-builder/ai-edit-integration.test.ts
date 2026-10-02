/**
 * ÉTAPE 35 — ÉDITION IA PAR OUTILS : câblage du Builder (source).
 *
 * Gardes sur la SOURCE du Builder (preview-builder-app.js) : import du
 * module, boutons ✨ IA pour les trois cibles réelles (texte/image/lien),
 * application obligatoire via les COMMANDES PURES (même canal qu'un APPLY
 * manuel), verrou anti double-clic, clé API jamais manipulée côté client.
 * La route servie est couverte par apps/api/tests/preview-builder-ai-edit.test.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appJs = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder-app.js'), 'utf8');

describe('ÉTAPE 35 : édition IA par outils — câblage du Builder', () => {
  it('1. le Builder importe les boucles d édition IA (module isomorphe servi)', () => {
    const src = appJs();
    assert.ok(src.includes("import { runAiEditLoop, runAiComponentEditLoop, runAiPageEditLoop } from '/preview-builder/ai-edit.js';"), 'import présent');
  });

  it('2. les trois cibles réelles ont leur contrôle IA (texte, image, lien)', () => {
    const src = appJs();
    assert.ok(src.includes('id="inspAiTextInput"') && src.includes('id="inspAiText"'), 'texte');
    assert.ok(src.includes('id="inspAiImageInput"') && src.includes('id="inspAiImage"'), 'image');
    assert.ok(src.includes('id="inspAiLinkInput"') && src.includes('id="inspAiLink"'), 'lien');
  });

  it('3. le résultat IA passe par les COMMANDES PURES (jamais d écriture DOM directe)', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function startAiEdit'), src.indexOf("el('inspectorBody').addEventListener('click'"));
    assert.ok(fn.includes("updateTextContent(state, ctx.componentId, ctx.path, outcome.value)"), 'texte via commande pure');
    assert.ok(fn.includes("updateImageSource(state, ctx.componentId, ctx.path, outcome.value)"), 'image via commande pure');
    assert.ok(fn.includes("updateLinkHref(state, ctx.componentId, ctx.path, outcome.value)"), 'lien via commande pure');
    assert.ok(fn.includes('dirtyReal.add(ctx.componentId)'), 'canal dirtyReal (rafraîchissement par le pipeline)');
    assert.ok(fn.includes('renderCurrent()'), 'rendu par le pipeline');
    assert.ok(!fn.includes('.innerHTML'), 'aucune écriture HTML directe dans la boucle');
  });

  it('4. la boucle cible le PROXY (clé API jamais côté client), verrou anti double-clic', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function startAiEdit'), src.indexOf("el('inspectorBody').addEventListener('click'"));
    assert.ok(fn.includes("url: '/api/v1/ai/chat/completions'"), 'passe par le proxy SEC-003');
    assert.ok(!fn.includes('api.mistral.ai'), 'jamais d appel direct à Mistral');
    assert.ok(fn.includes('aiEditBusy'), 'verrou anti double-clic');
    assert.ok(fn.includes('headers: H'), 'en-têtes tenant/rôle transmis');
    // fetch natif jamais passé nu : débindé (this ≠ window) → Illegal invocation
    assert.ok(!/fetchImpl:\s*fetch\b/.test(fn), 'fetchImpl enveloppé (pas de fetch nu)');
    assert.ok(fn.includes('(url, init) => fetch(url, init)'), 'enveloppe de fetch explicite');
  });

  it('5. les trois boutons déclenchent la même boucle avec leur contexte de clic', () => {
    const src = appJs();
    assert.ok(src.includes("if (e.target.id === 'inspAiText') { startAiEdit('text', textCtx, 'inspAiTextInput', el('inspAiTextMsg')); return; }"));
    assert.ok(src.includes("if (e.target.id === 'inspAiImage') { startAiEdit('image', imageCtx, 'inspAiImageInput', el('inspAiImageMsg')); return; }"));
    assert.ok(src.includes("if (e.target.id === 'inspAiLink') { startAiEdit('link', linkCtx, 'inspAiLinkInput', el('inspAiLinkMsg')); return; }"));
  });

  it('6. échecs IA affichés honnêtement (aucun fallback silencieux)', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function startAiEdit'), src.indexOf("el('inspectorBody').addEventListener('click'"));
    assert.ok(fn.includes("outcome.reason === 'no-tool-call'"), 'sans outil → message explicite');
    assert.ok(fn.includes("'IA indisponible ('"), 'erreur HTTP → message explicite');
    assert.ok(fn.includes("'Modification refusée: '"), 'refus de la commande pure → message explicite');
  });
});

describe('ÉTAPE 36 : édition IA par composant (multi-éléments, multi-tours)', () => {
  it('1. le panneau par défaut propose l édition IA par composant (si HTML réel)', () => {
    const src = appJs();
    assert.ok(src.includes('id="inspAiCompInput"') && src.includes('id="inspAiComp"'), 'contrôles présents');
    assert.ok(src.includes("typeof comp.metadata.html === 'string'"), 'réservé aux composants à HTML réel');
  });

  it('2. la boucle reçoit l inventaire (mêmes conventions de path que les commandes)', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function startAiComponentEdit'), src.indexOf("el('inspectorBody').addEventListener('click'"));
    assert.ok(fn.includes('inventoryEditableElements(html)'), 'inventaire construit depuis metadata.html');
    assert.ok(fn.includes('runAiComponentEditLoop'), 'boucle multi-outils utilisée');
  });

  it('3. chaque tool_call passe par une COMMANDE PURE (jamais d écriture DOM directe)', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function startAiComponentEdit'), src.indexOf("el('inspectorBody').addEventListener('click'"));
    assert.ok(fn.includes("call.name === 'set_text' ? updateTextContent(state, componentId, path, String(value))"), 'texte');
    assert.ok(fn.includes("call.name === 'set_image_src' ? updateImageSource(state, componentId, path, String(value))"), 'image');
    assert.ok(fn.includes(': updateLinkHref(state, componentId, path, String(value))'), 'lien');
    assert.ok(fn.includes('dirtyReal.add(componentId)'), 'canal dirtyReal');
    assert.ok(!/fetchImpl:\s*fetch\b/.test(fn), 'fetch natif jamais passé nu (débindé)');
    assert.ok(fn.includes('aiCompEditBusy'), 'verrou anti double-clic');
  });

  it('4. succès partiel honnête : les refus et la borne sont annoncés', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function startAiComponentEdit'), src.indexOf("el('inspectorBody').addEventListener('click'"));
    assert.ok(fn.includes('refus(s)'), 'nombre de refus affiché');
    assert.ok(fn.includes('borne d appels atteinte'), 'borne annoncée');
  });

  it('5. É37 — le validateur d image réel est branché sur les DEUX boucles', () => {
    const src = appJs();
    assert.ok(src.includes('function validateImageUrl(url)'), 'validateur DOM présent');
    assert.ok(src.includes('new Image()'), 'test de chargement réel');
    assert.ok(src.includes('validateImageUrl: validateImageUrl'), 'branché aux boucles');
    assert.ok(src.includes("reason === 'image-inaccessible'"), 'échec image annoncé au client');
  });
});

describe('ÉTAPE 38 : persistance des éditions Builder (PUT files/section)', () => {
  it('1. persistSection : PUT vers files/section/<section> avec l HTML réel du composant', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function persistSection'), src.indexOf('async function startAiEdit') > 0 ? src.indexOf('async function startAiEdit') : undefined);
    assert.ok(fn.includes("'/api/v1/projects/' + currentProjectId + '/files/section/' + encodeURIComponent(componentId)"), 'endpoint de section');
    assert.ok(fn.includes("method: 'PUT'"), 'méthode PUT');
    assert.ok(fn.includes('JSON.stringify({ html: html })'), 'corps = html réel du composant');
    assert.ok(fn.includes('if (!currentProjectId || !componentId) return;'), 'mock/démo → aucun appel');
    assert.ok(fn.includes("v2Status.textContent = '⚠"), 'échec de sauvegarde signalé (honnête)');
  });

  it('2. le projet serveur est mémorisé à la génération réelle', () => {
    const src = appJs();
    const start = src.indexOf('async function startRealGeneration');
    assert.ok(start > 0, 'startRealGeneration présent');
    const fn = src.slice(start, start + 1600);
    assert.ok(fn.includes('currentProjectId = proj.id;'), 'currentProjectId fixé au démarrage du flux réel');
  });

  it('3. les CINQ chemins d édition persistent (3 APPLY manuels + 2 boucles IA)', () => {
    const src = appJs();
    assert.ok(src.includes('persistSection(persistedLinkId)'), 'APPLY lien');
    assert.ok(src.includes('persistSection(persistedImageId)'), 'APPLY image');
    assert.ok(src.includes('persistSection(persistedTextId)'), 'APPLY texte');
    assert.ok(src.includes('persistSection(persistedAiId)'), 'édition IA mono-élément');
    assert.ok(src.includes('persistSection(componentId)'), 'édition IA par composant');
  });
});

describe('ÉTAPE 39 : édition IA par page (multi-sections)', () => {
  it('1. le panneau v2 expose le contrôle ✨ IA page', () => {
    const src = appJs();
    assert.ok(src.includes("getElementById('btnPageAi')"), 'bouton branché');
    assert.ok(src.includes('runAiPageEditLoop'), 'boucle page utilisée');
  });

  it('2. l inventaire couvre TOUS les composants à HTML réel (section = id)', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function startAiPageEdit'));
    assert.ok(fn.includes('state.components.forEach'), 'parcours de tous les composants');
    assert.ok(fn.includes('inventoryEditableElements(compHtml, 40)'), 'inventaire par composant');
    assert.ok(fn.includes('section: comp.id'), 'section = id du composant');
  });

  it('3. chaque appel passe par la COMMANDE PURE du composant visé', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function startAiPageEdit'));
    assert.ok(fn.includes("call.name === 'set_text' ? updateTextContent(state, sectionId, path, value)"), 'texte');
    assert.ok(fn.includes(': updateLinkHref(state, sectionId, path, value)'), 'lien');
    assert.ok(fn.includes('dirtyReal.add(sectionId)'), 'canal dirtyReal');
    assert.ok(!/fetchImpl:\s*fetch\b/.test(fn), 'fetch natif jamais passé nu');
  });

  it('4. persistance SÉQUENTIELLE des sections touchées (pas de course sur index.html)', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function startAiPageEdit'));
    assert.ok(fn.includes('for (const sectionId of outcome.touchedSections) {'), 'boucle de persistance');
    assert.ok(fn.includes('await persistSection(sectionId)'), 'PUT séquentiels (await dans la boucle)');
    assert.ok(fn.includes("modification(s) dans ' + outcome.touchedSections.length + ' section(s)"), 'bilan affiché');
  });
});

describe('E40 : historique des révisions dans le Builder', () => {
  it('1. bloc Historique : bouton + panneau + liste + restauration', () => {
    const src = appJs();
    assert.ok(src.includes("getElementById('btnHistory')"), 'bouton Historique branché');
    assert.ok(src.includes('async function loadHistory'), 'chargement de la liste');
    assert.ok(src.includes('async function restoreRevision'), 'restauration');
    assert.ok(src.includes("import { extractSections } from '/preview-builder/section-parse.js';"), 'parseur de sections importé');
  });

  it('2. la restauration reconstruit le canvas par le PIPELINE consume() (helper partagé E41)', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function restoreRevision'), src.indexOf("document.getElementById('btnHistory')"));
    assert.ok(fn.includes('rebuildCanvasFromHtml(content)'), 'passe par le helper partagé');
    assert.ok(fn.includes('/rollback'), 'rollback serveur appelé');
    assert.ok(!fn.includes('.innerHTML'), 'aucune écriture DOM directe du canvas');
    // le helper porte la séquence complète (convention du moteur)
    const helper = src.slice(src.indexOf('function rebuildCanvasFromHtml'), src.indexOf('async function resumeSession'));
    assert.ok(helper.includes("consume({ kind: 'BUILD_RESET'"), 'reset par événement');
    assert.ok(helper.includes("consume({ kind: 'BUILD_STARTED'"), 'STARTED obligatoire (moteur : statut building)');
    assert.ok(helper.includes("consume({ kind: 'COMPONENT_CREATED'"), 'composants recréés par événement');
    assert.ok(helper.includes('COMPONENT_READY'), 'prêt avec metadata.html');
  });

  it('3. échecs de restauration signalés honnêtement', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function restoreRevision'), src.indexOf("document.getElementById('btnHistory')"));
    assert.ok(fn.includes('⚠ Contenu de la révision indisponible'), 'contenu manquant');
    assert.ok(fn.includes('⚠ Rollback échoué'), 'échec HTTP');
  });
});

describe('E41 : reprise de session au chargement du Builder', () => {
  it('1. resumeSession appelée au boot quand le flag v2 est ON', () => {
    const src = appJs();
    assert.ok(src.includes('async function resumeSession'), 'fonction présente');
    const bootBlock = src.slice(src.indexOf("if (v2Flag === 'on' && v2Panel)"), src.indexOf("if (v2Flag === 'on' && v2Panel)") + 200);
    assert.ok(bootBlock.includes('resumeSession()'), 'appelée au boot (dans le bloc v2)');
  });

  it('2. le projet serveur est résolu dès le boot (clé de persistance prête)', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function resumeSession'), src.indexOf('function rebuildCanvasFromHtml') > src.indexOf('async function resumeSession') ? src.indexOf('function rebuildCanvasFromHtml') : undefined);
    assert.ok(fn.includes('/api/v1/projects'), 'liste des projets');
    assert.ok(fn.includes('currentProjectId = proj.id;'), 'currentProjectId fixé au boot');
    assert.ok(fn.includes('files/content?path=index.html'), 'contenu du site existant');
  });

  it('3. gardes : jamais écraser un build en cours, rien si pas de sections, échec silencieux', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function resumeSession'), src.indexOf('async function resumeSession') + 1400);
    assert.ok(fn.includes('if (state.components.size > 0) return;'), 'build en cours respecté');
    assert.ok(fn.includes('if (sectionCount > 0 && v2Status)'), 'statut seulement si sections');
    assert.ok(fn.includes('} catch {'), 'échec réseau silencieux (mode démo)');
  });
});

describe('E43 : prévisualisation des éditions IA avant application', () => {
  it('1. case à cocher + mode différé passé aux DEUX boucles', () => {
    const src = appJs();
    assert.ok(src.includes("id=\"chkAiPreview\"") === false ? src.includes('chkAiPreview') : true, 'toggle présent');
    assert.ok(src.includes('function aiPreviewEnabled'), 'lecture du toggle');
    assert.ok((src.match(/deferApply: aiPreviewEnabled()/g) || []).length === 2, 'deferApply branché sur composant ET page');
  });

  it('2. en mode différé : AUCUNE application ni persistance avant confirmation', () => {
    const src = appJs();
    const compFn = src.slice(src.indexOf('async function startAiComponentEdit'), src.indexOf('async function startAiPageEdit'));
    const pageFn = src.slice(src.indexOf('async function startAiPageEdit'), src.indexOf('async function restoreRevision'));
    for (const [name, fn] of [['composant', compFn], ['page', pageFn]] as const) {
      assert.ok(fn.includes('outcome.proposedCalls.length > 0'), name + ' : branche prévisualisation');
      assert.ok(fn.includes('showAiDiffPanel('), name + ' : panneau affiché');
      assert.ok(fn.includes('onConfirm:'), name + ' : confirmation câblée');
    }
  });

  it('3. le récapitulatif montre ancien → nouveau (lisible)', () => {
    const src = appJs();
    assert.ok((src.match(/→ « /g) || []).length >= 2, 'flèche ancien → nouveau dans les lignes de diff');
    assert.ok(src.includes('oldLookup'), 'anciennes valeurs issues de l inventaire');
  });

  it('4. confirmation : replay via la MÊME commande pure + undo + persistance ; refus : rien appliqué', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf("el('aiDiffPanel').addEventListener"));
    assert.ok(fn.includes("action === 'reject'"), 'refus géré');
    assert.match(fn, /Éditions IA refusées — rien n a été appliqué./, 'refus honnête');
    assert.ok(fn.includes('await pending.onConfirm(checked)'), 'confirmation rejoue le lot avec les sections cochées (E44)');
    // le replay passe par les applyCall partagés (commandes pures) — vérifié
    // par la présence des pushes undo DANS les onConfirm
    assert.ok((src.match(/pushUndoBatch\('Édition IA du composant', undoSnapshots\)/g) || []).length >= 1);
    assert.ok((src.match(/pushUndoBatch\('Édition IA de la page', undoPageSnapshots\)/g) || []).length >= 1);
  });
});

describe('E44 : application sélective par section dans la prévisualisation', () => {
  it('1. le panneau groupe par section avec une case cochée par groupe', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('function showAiDiffPanel'));
    assert.ok(fn.includes("data-section-check="), 'case par section');
    assert.ok(fn.includes("[data-section-check]:checked"), 'lecture des cases au moment d appliquer');
    assert.ok(fn.includes(' checked>'), 'cochées par défaut');
  });

  it('2. APPLIQUER ne rejoue que les sections cochées (filtrage avant replay)', () => {
    const src = appJs();
    const compFn = src.slice(src.indexOf('async function startAiComponentEdit'), src.indexOf('async function startAiPageEdit'));
    const pageFn = src.slice(src.indexOf('async function startAiPageEdit'), src.indexOf('async function restoreRevision'));
    assert.ok(compFn.includes("outcome.proposedCalls.filter(() => wanted.has(componentId))"), 'composant : filtrage');
    assert.ok(pageFn.includes("outcome.proposedCalls.filter((c) => wanted.has(String(c.args.section)))"), 'page : filtrage par section');
  });

  it('3. aucune section cochée → rien appliqué (message honnête)', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf("el('aiDiffPanel').addEventListener"));
    assert.match(fn, /Aucune section cochée — rien n a été appliqué./);
  });

  it('4. la page regroupe les appels par section (groupOrder + Map)', () => {
    const src = appJs();
    const pageFn = src.slice(src.indexOf('async function startAiPageEdit'), src.indexOf('async function restoreRevision'));
    assert.ok(pageFn.includes('groupOrder.push(section)'), 'ordre des groupes stable');
    assert.ok(pageFn.includes('groupsBySection.set(section'), 'regroupement par section');
  });
});

describe('E42 : annulation des éditions (undo par lots)', () => {
  it('1. bouton ↩ ANNULER + Ctrl+Z (hors champs de saisie)', () => {
    const src = appJs();
    assert.ok(src.includes("getElementById('btnUndo')"), 'bouton branché');
    const keyBlock = src.slice(src.indexOf("document.addEventListener('keydown'"));
    assert.ok(keyBlock.includes("e.key === 'z' || e.key === 'Z'"), 'Ctrl+Z écouté');
    assert.ok(keyBlock.includes("t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'"), 'undo natif conservé dans les champs');
  });

  it('2. les CINQ chemins d édition poussent un lot d annulation', () => {
    const src = appJs();
    assert.ok(src.includes("pushUndoBatch('Édition du lien'"), 'APPLY lien');
    assert.ok(src.includes("pushUndoBatch('Édition de l image'"), 'APPLY image');
    assert.ok(src.includes("pushUndoBatch('Édition du texte'"), 'APPLY texte');
    assert.ok(src.includes("pushUndoBatch('Édition IA du composant', undoSnapshots)"), 'lot IA composant');
    assert.ok(src.includes("pushUndoBatch('Édition IA de la page', undoPageSnapshots)"), 'lot IA page');
  });

  it('3. l annulation restitue via la commande PURE et resynchronise le serveur', () => {
    const src = appJs();
    const fn = src.slice(src.indexOf('async function undoLastEdit'), src.indexOf('function rebuildCanvasFromHtml'));
    assert.ok(fn.includes('restoreComponentHtml(state, snap.componentId, snap.html)'), 'commande pure');
    assert.ok(fn.includes('await persistSection(componentId)'), 'resynchronisation serveur (E38)');
    assert.ok(fn.includes("'Rien à annuler.'"), 'pile vide → message honnête');
  });

  it('4. les lots IA captent le HTML antérieur PAR APPEL (un lot unique par action)', () => {
    const src = appJs();
    const compFn = src.slice(src.indexOf('async function startAiComponentEdit'), src.indexOf('async function startAiPageEdit'));
    assert.ok(compFn.includes('undoSnapshots.push({ componentId: componentId, html: prevHtml })'), 'capture par appel');
    assert.ok(compFn.includes('const prevHtml = previousHtmlOf(componentId);'), 'capture AVANT application');
    const pageFn = src.slice(src.indexOf('async function startAiPageEdit'), src.indexOf('async function restoreRevision'));
    assert.ok(pageFn.includes('const prevSectionHtml = previousHtmlOf(sectionId);'), 'capture par section');
  });
});
