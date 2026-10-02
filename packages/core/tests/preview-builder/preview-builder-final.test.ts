/**
 * ÉTAPE 25 — GATE DE CLÔTURE DU PREVIEW BUILDER.
 *
 * Vérifie que TOUTES les capacités livrées (É01→É24) coexistent sans
 * régression, en réutilisant EXCLUSIVEMENT les APIs existantes : aucun
 * nouveau moteur, aucune duplication de logique.
 *
 * Partie 1 — GATE FONCTIONNEL : les 7 éditions combinées sur UN composant
 * (label É16, variant É17, structure É18, texte É22, image É23, lien É24,
 * resize É21) + sélection/inspector synchronisés + Build Focus indépendant.
 *
 * Partie 2 — GATE DE ROBUSTESSE UI : cycles de vie répétés (génération →
 * édition → RESET) sans fuite, et garanties de source de la page (handlers
 * non accumulés, poignées/indicateur/contexts nettoyés, aucune navigation,
 * aucun script injecté).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyBuildEvents,
  createPreviewBuildState,
  type PreviewBuildEvent,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import {
  updateComponentLabel,
  updateComponentVariant,
  resizeComponent,
  moveComponent,
  updateTextContent,
  updateImageSource,
  updateLinkHref,
  applyDragIntent
} from '../../src/preview-builder/editing.js';
import { renderPreview, buildInspector, buildTimeline, buildFocus } from '../../src/preview-builder/renderer.js';

const page = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder-app.js'), 'utf8');

/** Génère un dashboard : hero (avec contenu réel riche) + cartes + chart. */
function generation(richHtml = true): PreviewBuildState {
  const html = richHtml
    ? '<section class="stats"><h2>Ventes Totales</h2><p>Ce mois-ci</p><a href="/ventes">Voir</a><img src="graphique.png" alt="Courbe"><h3>Utilisateurs</h3></section>'
    : '<section class="stats"><h2>Cartes</h2></section>';
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'structure', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'hero', type: 'hero', label: 'Héros' }, timestamp: 2 },
    { kind: 'COMPONENT_BUILDING', componentId: 'hero', timestamp: 3 },
    { kind: 'COMPONENT_READY', componentId: 'hero', timestamp: 4 },
    { kind: 'COMPONENT_CREATED', component: { id: 'stats-cards', type: 'card', label: 'Cartes', metadata: { html } }, timestamp: 4 },
    { kind: 'COMPONENT_BUILDING', componentId: 'stats-cards', timestamp: 5 },
    { kind: 'COMPONENT_READY', componentId: 'stats-cards', timestamp: 6 },
    { kind: 'COMPONENT_CREATED', component: { id: 'chart', type: 'chart', label: 'Graphique' }, timestamp: 7 },
    { kind: 'COMPONENT_BUILDING', componentId: 'chart', timestamp: 8 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

describe('ÉTAPE 25 — GATE FONCTIONNEL GLOBAL', () => {
  it('1. les 7 éditions COMBINÉES sur un même composant coexistent sans se détruire', () => {
    let s = generation();
    const id = 'stats-cards';
    // L'ordre réel d'un utilisateur : label → variant → size → structure →
    // texte → image → lien (chaque commande via l'API existante)
    s = updateComponentLabel(s, id, 'Ma Carte de Ventes').state;
    s = updateComponentVariant(s, id, 'featured').state;
    s = resizeComponent(s, id, 600, 300).state;
    s = moveComponent(s, id, 'hero', 0).state;
    s = updateTextContent(s, id, [0, 0], 'Ventes du Mois').state;
    s = updateImageSource(s, id, [0, 3], 'nouvelle-courbe.png').state;
    s = updateLinkHref(s, id, [0, 2], '/rapport-complet').state;

    const c = s.components.get(id)!;
    // Toutes les valeurs coexistent :
    assert.equal(c.label, 'Ma Carte de Ventes', 'É16');
    assert.equal(c.variant, 'featured', 'É17');
    assert.deepEqual(c.size, { width: 600, height: 300 }, 'É21');
    assert.equal(c.parentId, 'hero', 'É18');
    const html = String(c.metadata!.html);
    assert.ok(html.includes('<h2>Ventes du Mois</h2>'), 'É22 texte');
    assert.ok(html.includes('src="nouvelle-courbe.png"'), 'É23 image');
    assert.ok(html.includes('href="/rapport-complet"'), 'É24 lien');
    // Le HTML reste une seule structure cohérente :
    assert.ok(html.includes('<section class="stats">') && html.includes('</section>'), 'structure racine intacte');
    assert.equal(html.includes('<h3>Utilisateurs</h3>'), true, 'contenu non édité intact');
  });

  it('2. chaîne d éditions immuable : chaque étape produit un nouvel état, l original reste intact', () => {
    const original = generation();
    const snapshot = renderPreview(original);
    let s = original;
    s = updateComponentLabel(s, 'stats-cards', 'A').state;
    s = updateComponentVariant(s, 'stats-cards', 'compact').state;
    s = resizeComponent(s, 'stats-cards', 400, 200).state;
    s = moveComponent(s, 'stats-cards', 'hero', 0).state;
    s = updateTextContent(s, 'stats-cards', [0, 0], 'B').state;
    s = updateImageSource(s, 'stats-cards', [0, 3], 'c.png').state;
    const last = updateLinkHref(s, 'stats-cards', [0, 2], '/d');
    // L'état ORIGINAL n'a pas bougé :
    assert.deepEqual(renderPreview(original), snapshot);
    assert.equal(original.components.get('stats-cards')!.label, 'Cartes');
    assert.equal(last.applied, true);
    assert.equal(last.state.components.get('stats-cards')!.label, 'A');
    assert.notEqual(last.state, original);
  });

  it('3. data-pv-id stable à travers TOUTES les éditions', () => {
    let s = generation();
    const idsAvant = renderPreview(s).flat.map((n) => n.id).sort().join(',');
    s = updateComponentLabel(s, 'hero', 'X').state;
    s = updateComponentVariant(s, 'stats-cards', 'wide').state;
    s = resizeComponent(s, 'hero', 300, 150).state;
    s = moveComponent(s, 'chart', 'hero', 0).state;
    s = updateTextContent(s, 'stats-cards', [0, 0], 'Y').state;
    s = updateImageSource(s, 'stats-cards', [0, 3], 'z.png').state;
    s = updateLinkHref(s, 'stats-cards', [0, 2], '/z').state;
    assert.equal(renderPreview(s).flat.map((n) => n.id).sort().join(','), idsAvant);
  });

  it('4. metadata.html cohérent : chaque édition ne touche que son fragment', () => {
    let s = generation();
    s = updateTextContent(s, 'stats-cards', [0, 0], 'Ventes FINAL').state;
    s = updateImageSource(s, 'stats-cards', [0, 3], 'img FINAL.png').state;
    const html = String(s.components.get('stats-cards')!.metadata!.html);
    assert.ok(html.includes('<h2>Ventes FINAL</h2>'));
    assert.ok(html.includes('src="img FINAL.png"'));
    assert.ok(html.includes('<p>Ce mois-ci</p>'), 'fragment non édité intact');
    assert.ok(html.includes('href="/ventes"'), 'lien non édité intact');
    assert.equal(html.match(/<section/g)!.length, 1, 'aucune duplication de structure');
  });

  it('5. sélection + Tree + Canvas + Inspector synchronisés après édition', () => {
    let s = generation();
    s = moveComponent(s, 'stats-cards', 'hero', 0).state;
    s = updateComponentLabel(s, 'stats-cards', 'Cartes Éditées').state;
    s = updateLinkHref(s, 'stats-cards', [0, 2], '/rapport').state;
    const model = renderPreview(s, { selectedId: 'stats-cards' });
    // Canvas et Tree = le même flat :
    const selected = model.flat.filter((n) => n.isUserSelected);
    assert.equal(selected.length, 1);
    assert.equal(model.canvas.find((n) => n.id === 'stats-cards'), model.flat.find((n) => n.id === 'stats-cards'));
    // Inspector = le même composant :
    const inspector = buildInspector(s, 'stats-cards')!;
    assert.equal(inspector.id, 'stats-cards', 'l inspector lit le même state que le renderer');
    assert.equal(inspector.label, 'Cartes Éditées');
    assert.equal(inspector.parentId, 'hero');
  });

  it('6. Build Focus INDÉPENDANT des éditions et de la sélection', () => {
    let s = generation(); // chart est en construction (focus)
    const focusAvant = buildFocus(s)!.id;
    assert.equal(focusAvant, 'chart');
    s = updateComponentLabel(s, 'stats-cards', 'Édité').state;
    s = updateLinkHref(s, 'stats-cards', [0, 2], '/x').state;
    s = moveComponent(s, 'stats-cards', 'hero', 0).state;
    assert.equal(buildFocus(s)!.id, 'chart', 'le focus IA ne bouge pas');
    // sélection ≠ focus : les deux coexistent dans le modèle
    const model = renderPreview(s, { selectedId: 'stats-cards' });
    assert.equal(model.focusId, 'chart');
    assert.ok(model.flat.find((n) => n.isUserSelected)!.id === 'stats-cards');
    assert.ok(model.flat.find((n) => n.isBuildFocus)!.id === 'chart');
    assert.equal(buildTimeline(s).filter((t) => t.status === 'active').length >= 1, true);
  });

  it('7. zéro doublon DOM (modèle) après déplacement + éditions croisées', () => {
    let s = generation();
    s = moveComponent(s, 'stats-cards', 'hero', 0).state;
    s = moveComponent(s, 'chart', 'hero', 1).state;
    s = updateTextContent(s, 'stats-cards', [0, 0], 'A').state;
    s = updateImageSource(s, 'stats-cards', [0, 3], 'b.png').state;
    s = updateLinkHref(s, 'stats-cards', [0, 2], '/c').state;
    const ids = renderPreview(s).flat.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, 'ids uniques');
    assert.deepEqual([...ids].sort(), ['chart', 'hero', 'stats-cards'], 'tous présents');
  });
});

describe('ÉTAPE 25 — GATE DE ROBUSTESSE UI (cycles de vie)', () => {
  it('8. trois générations avec éditions complètes : AUCUNE fuite inter-générations', () => {
    let s = createPreviewBuildState();
    for (let cycle = 0; cycle < 3; cycle++) {
      // nouvelle génération (BUILD_STARTED efface tout)
      s = applyBuildEvents(s, generationEvents('cycle' + cycle));
      const model = renderPreview(s);
      assert.ok(model.flat.length > 0, 'cycle ' + cycle + ' : composants présents');
      // éditions complètes sur le composant riche
      s = updateComponentLabel(s, 'stats-cards', 'Édition ' + cycle).state;
      s = updateComponentVariant(s, 'stats-cards', 'featured').state;
      s = resizeComponent(s, 'stats-cards', 500, 250).state;
      s = moveComponent(s, 'stats-cards', 'hero', 0).state;
      s = updateTextContent(s, 'stats-cards', [0, 0], 'Texte ' + cycle).state;
      s = updateImageSource(s, 'stats-cards', [0, 3], 'img-' + cycle + '.png').state;
      s = updateLinkHref(s, 'stats-cards', [0, 2], '/lien-' + cycle).state;
      assert.equal(s.components.get('stats-cards')!.label, 'Édition ' + cycle);
      // RESET (nouvelle génération suivante) : vérifié en tête de boucle
    }
    // après le cycle 2, une NOUVELLE génération vierge :
    s = applyBuildEvents(s, generationEvents('final'));
    const c = s.components.get('stats-cards')!;
    assert.equal(c.label, 'Cartes', 'label initial, pas Édition 2');
    assert.equal(c.variant, undefined, 'aucun variant résiduel');
    assert.equal(c.size, undefined, 'aucune taille résiduelle');
    const html = String(c.metadata!.html);
    assert.ok(html.includes('<h2>Ventes final</h2>'), 'contenu de la génération finale');
    assert.ok(!html.includes('Texte 2') && !html.includes('img-2.png') && !html.includes('/lien-2'), 'aucune fuite de contenu édité');
  });

  it('9. RESET : le state revient exactement vierge (aucun champ résiduel)', () => {
    let s = generation();
    s = updateComponentLabel(s, 'hero', 'X').state;
    s = resizeComponent(s, 'hero', 400, 200).state;
    s = applyBuildEvents(s, [{ kind: 'BUILD_RESET', timestamp: 99 }]);
    const vierge = createPreviewBuildState();
    assert.deepEqual(renderPreview(s), renderPreview(vierge), 'identique à un state neuf');
  });

  it('10. handlers NON accumulés : tous les addEventListener sont au niveau module (une fois par chargement)', () => {
    const source = page();
    // extract du corps de render() et consume() : aucun addEventListener dedans
    const renderStart = source.indexOf('function render(model)');
    const consumeStart = source.indexOf('function consume(event)');
    const renderBlock = source.slice(renderStart, consumeStart);
    // le seul listener autorisé dans render() est l animationend PAR-NŒUD
    // (once:true, É06 — il ne s accumule jamais au niveau global) :
    const globalListeners = (renderBlock.match(/(document|window|el('canvas')|el('inspectorBody')).addEventListener/g) || []);
    assert.equal(globalListeners.length, 0, 'render() n enregistre aucun listener GLOBAL');
    // consume + les machines (resize/dnd/inspector) déclarent leurs listeners
    // au TOP-LEVEL du module — comptés une seule fois par chargement de page.
    // Borne ajustée É39 (bouton ✨ IA page, lui aussi au niveau module) :
    // l'intention reste « fixe et raisonnable », jamais d'accumulation.
    const topListenerCount = (source.match(/addEventListener\(/g) || []).length;
    assert.ok(topListenerCount >= 8 && topListenerCount <= 24, 'nombre de listeners fixe et raisonnable: ' + topListenerCount);
    // et renderInspector (appelé à chaque rendu) n'en registre aucun :
    const inspStart = source.indexOf('function renderInspector');
    const inspEnd = source.indexOf("el('inspectorBody').addEventListener('change'", inspStart);
    assert.ok(!source.slice(inspStart, inspEnd).includes('addEventListener'), 'renderInspector sans listener');
  });

  it('11. aucune poignée orpheline ni indicateur DnD résiduel (garanties de source)', () => {
    const source = page();
    // poignées : retirées à CHAQUE rendu avant recréation conditionnelle
    assert.ok(source.includes("document.querySelectorAll('.pv-resize-handle').forEach((h) => h.remove());"));
    // création gardée par la sélection :
    const selBlock = source.slice(source.indexOf('if (model.selectedId)'), source.indexOf('É21 — poignées') > 0 ? source.indexOf('É21 — poignées') + 400 : source.length);
    assert.ok(selBlock.includes("['e', 's', 'se'].forEach"), 'poignées créées seulement si sélection');
    // indicateur : masqué au pointerup ET au pointercancel
    const upBlock = source.slice(source.indexOf("document.addEventListener('pointerup'"), source.indexOf("document.addEventListener('pointercancel'"));
    assert.ok(upBlock.includes('hideDropIndicator()'));
    const cancelBlock = source.slice(source.indexOf("document.addEventListener('pointercancel'"));
    assert.ok(cancelBlock.includes('hideDropIndicator()'));
    // pointerdown DnD ignoré quand la source est une poignée de resize :
    const resizeDown = source.indexOf("document.addEventListener('pointerdown'", source.indexOf('ÉTAPE 21'));
    assert.ok(source.slice(resizeDown, resizeDown + 700).includes('stopPropagation'));
  });

  it('12. aucune sélection fantôme ni champ Inspector obsolète (RESET nettoie tout)', () => {
    const source = page();
    // RESET → sélection vidée (donc inspector vide + poignées retirées au rendu)
    const resetIdx = source.indexOf("btnReset.addEventListener('click'");
    const resetBlock = source.slice(resetIdx, resetIdx + 400);
    assert.ok(resetBlock.includes('selectedComponentId = null'), 'RESET vide la sélection');
    // renderInspector(null) → panneau vide :
    assert.ok(source.includes("if (!inspector) {"), 'inspector gère le cas null');
    // contexts texte/image/lien vidés aux bons endroits :
    assert.ok(source.includes('textCtx = null;') && source.includes('imageCtx = null;') && source.includes('linkCtx = null;'));
  });

  it('13. aucune ancienne valeur réinjectée : les champs sont reconstruits DU MODÈLE', () => {
    const source = page();
    for (const [champ, modele] of [['inspLabelInput', 'canonicalize(inspector.label)'], ['inspContentInput', 'canonicalize(textCtx.text)'], ['inspImageInput', 'canonicalize(imageCtx.src)'], ['inspLinkInput', 'canonicalize(linkCtx.href)']]) {
      assert.ok(source.includes('value="' + ' + ' + modele) || source.includes('value="\' + ' + modele), `${champ} est initialisé depuis le modèle (${modele})`);
    }
  });

  it('14. aucune navigation involontaire via les liens (preventDefault de source)', () => {
    const source = page();
    assert.ok(source.includes("e.target.closest('.pvz-real a')) e.preventDefault()"), 'preventDefault sur les liens du contenu réel');
  });

  it('15. aucun script injectable : les 3 éditions de contenu échappent', () => {
    let s = generation();
    s = updateTextContent(s, 'stats-cards', [0, 0], '<script>alert(1)</script>').state;
    s = updateImageSource(s, 'stats-cards', [0, 3], '" onerror="alert(1)').state;
    s = updateLinkHref(s, 'stats-cards', [0, 2], '/c" onclick="alert(1)').state;
    const html = String(s.components.get('stats-cards')!.metadata!.html);
    assert.ok(!html.includes('<script>'), 'aucun script réel');
    assert.ok(html.includes('&lt;script&gt;'), 'script échappé en texte');
    // le onerror/hostile reste DANS une valeur d attribut échappée :
    const imgTag = html.match(/<img[^>]*>/)![0];
    assert.ok(imgTag.startsWith('<img src="&quot;'), 'linjection image reste dans la VALEUR de src');
    assert.ok(!/src="[^"]*"\s+onerror=/.test(html), 'onerror n est jamais un attribut réel');
    const aTag = html.match(/<a href="\/c[^>]*>/)![0];
    assert.ok(aTag.includes('&quot;'), 'linjection lien reste dans la VALEUR de href');
    assert.ok(!/href="[^"]*"\s+onclick=/.test(html), 'onclick n est jamais un attribut réel');
  });

  it('16. viewports : aucun état de viewport dans le modèle (présentation pure)', () => {
    const s = generation();
    const model = renderPreview(s, { selectedId: 'stats-cards' });
    assert.ok(!('viewport' in model), 'aucun champ viewport dans le modèle');
    const source = page();
    const vpIdx = source.indexOf("document.querySelectorAll('.vp-btn')");
    const vpBlock = source.slice(vpIdx, vpIdx + 600);
    assert.ok(vpBlock.includes('classList') && !vpBlock.includes('dataset.pvId'), 'bascule viewport = classes CSS uniquement');
  });

  it('17. state = la seule vérité : Pipeline complet final (génération → 7 éditions → RESET → régénération)', () => {
    // Cycle complet demandé par le brief, en une passe vérifiable :
    let s = applyBuildEvents(createPreviewBuildState(), generationEvents('gate'));
    // sélection (modèle) pendant qu'un composant construit :
    let model = renderPreview(s, { selectedId: 'stats-cards' });
    assert.equal(model.focusId, 'chart');
    // éditions
    s = updateComponentLabel(s, 'stats-cards', 'Gate').state;
    s = updateComponentVariant(s, 'stats-cards', 'featured').state;
    s = resizeComponent(s, 'stats-cards', 480, 240).state;
    s = moveComponent(s, 'stats-cards', 'hero', 0).state;
    s = updateTextContent(s, 'stats-cards', [0, 0], 'Gate Texte').state;
    s = updateImageSource(s, 'stats-cards', [0, 3], 'gate.png').state;
    s = updateLinkHref(s, 'stats-cards', [0, 2], '/gate').state;
    // DnD (fondation É19/20 : compute + apply délègue à moveComponent)
    s = applyDragIntent(s, { componentId: 'chart', hoveredId: 'stats-cards', edge: 'inside' }).state;
    model = renderPreview(s, { selectedId: 'stats-cards' });
    assert.equal(s.components.get('chart')!.parentId, 'stats-cards', 'DnD réel appliqué');
    assert.ok(model.flat.find((n) => n.isUserSelected)!.id === 'stats-cards');
    assert.equal(model.focusId, 'chart', 'focus toujours indépendant');
    // RESET + nouvelle génération : rien ne fuit (valeurs éditées exactes —
    // le tag 'gate' seul chevaucherait les noms générés courbe-apres-gate.png)
    s = applyBuildEvents(s, generationEvents('apres-gate'));
    const html = String(s.components.get('stats-cards')!.metadata!.html);
    assert.ok(!html.includes('src="gate.png"'), 'aucune fuite: src édité');
    assert.ok(!html.includes('Gate Texte'), 'aucune fuite: texte édité');
    assert.ok(!html.includes('href="/gate"'), 'aucune fuite: href édité');
    assert.equal(s.components.get('chart')!.parentId, undefined, 'structure fraîche');
    assert.equal(renderPreview(s).flat.length > 0, true);
  });
});

/** Événements d'une génération paramétrée (contenu riche pour le gate). */
function generationEvents(tag: string): PreviewBuildEvent[] {
  const html = '<section class="stats"><h2>Ventes ' + tag + '</h2><p>Ce mois-ci</p><a href="/ventes-' + tag + '">Voir</a><img src="courbe-' + tag + '.png" alt="Courbe"><h3>Utilisateurs</h3></section>';
  return [
    { kind: 'BUILD_STARTED', stage: 'structure', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'hero', type: 'hero', label: 'Héros' }, timestamp: 2 },
    { kind: 'COMPONENT_BUILDING', componentId: 'hero', timestamp: 3 },
    { kind: 'COMPONENT_READY', componentId: 'hero', timestamp: 4 },
    { kind: 'COMPONENT_READY', componentId: 'hero', timestamp: 4 },
    { kind: 'COMPONENT_CREATED', component: { id: 'stats-cards', type: 'card', label: 'Cartes', metadata: { html: html } }, timestamp: 5 },
    { kind: 'COMPONENT_BUILDING', componentId: 'stats-cards', timestamp: 6 },
    { kind: 'COMPONENT_READY', componentId: 'stats-cards', timestamp: 7 },
    { kind: 'COMPONENT_CREATED', component: { id: 'chart', type: 'chart', label: 'Graphique' }, timestamp: 8 },
    { kind: 'COMPONENT_BUILDING', componentId: 'chart', timestamp: 9 },
    { kind: 'BUILD_COMPLETED', timestamp: 10 }
  ];
}
