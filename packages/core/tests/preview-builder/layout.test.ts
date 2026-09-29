/**
 * ÉTAPE 07 — tests du LAYOUT COMPOSITION ENGINE (couche renderer, pur).
 * Garanties du brief : parent/child composé, row, column, grid, fallback
 * générique, composant inconnu toujours rendu, pureté (state jamais muté).
 * Le responsive est un mode d'affichage : la composition ne prend AUCUN
 * paramètre de viewport — le même state produit le même arbre partout.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeRoots,
  compositionFor,
  layoutTree
} from '../../src/preview-builder/layout.js';
import { renderPreview } from '../../src/preview-builder/renderer.js';
import {
  applyBuildEvent,
  createPreviewBuildState
} from '../../src/preview-builder/engine.js';
import type { AnyStage, ComponentState, PreviewBuildState } from '../../src/preview-builder/engine.js';

function component(id: string, type: string, label: string, status: ComponentState['status'] = 'completed', parentId?: string, metadata?: Record<string, unknown>): ComponentState {
  return { id, type, label, status, stage: 'components' as AnyStage, order: 0, ...(parentId !== undefined ? { parentId } : {}), ...(metadata !== undefined ? { metadata } : {}) };
}

function pageWith(components: ComponentState[]): PreviewBuildState {
  let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
  for (const c of components) {
    s = applyBuildEvent(s, {
      kind: 'COMPONENT_CREATED',
      component: {
        id: c.id,
        type: c.type,
        ...(c.label !== undefined ? { label: c.label } : {}),
        ...(c.parentId !== undefined ? { parentId: c.parentId } : {}),
        ...(c.metadata !== undefined ? { metadata: c.metadata } : {})
      },
      timestamp: 2
    });
    s = applyBuildEvent(s, { kind: c.status === 'completed' ? 'COMPONENT_READY' : 'COMPONENT_BUILDING', componentId: c.id, timestamp: 3 });
  }
  return s;
}

describe('ÉTAPE 07 : Layout Composition Engine (pur)', () => {
  it('1. composition racine : parent/child correctement composés (Header / row[Sidebar, Main] / Footer)', () => {
    const groups = composeRoots([
      component('header', 'header', 'Header'),
      component('sidebar', 'sidebar', 'Sidebar'),
      component('main', 'content', 'Main'),
      component('footer', 'footer', 'Footer')
    ]);
    assert.equal(groups.length, 3);
    assert.equal(groups[0]!.kind, 'column');
    assert.equal(groups[0]!.components[0]!.type, 'header');
    assert.equal(groups[1]!.kind, 'row');
    assert.deepEqual(groups[1]!.components.map((c) => c.type), ['sidebar', 'content']);
    assert.equal(groups[2]!.kind, 'column');
    assert.equal(groups[2]!.components[0]!.type, 'footer');
  });

  it('2. row correctement représentée : la première zone latérale ouvre la rangée avec tout ce qui suit', () => {
    const groups = composeRoots([
      component('nav', 'nav', 'Nav'),
      component('hero', 'hero', 'Hero'),
      component('main', 'content', 'Main')
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.kind, 'row');
    assert.deepEqual(groups[0]!.components.map((c) => c.type), ['nav', 'hero', 'content']);
  });

  it('3. column correctement représentée (parent navigation verticale)', () => {
    const parent = component('side', 'sidebar', 'Side');
    const spec = compositionFor(parent, [
      component('i1', 'nav-item', 'Un', 'completed', 'side'),
      component('i2', 'nav-item', 'Deux', 'completed', 'side'),
      component('i3', 'nav-item', 'Trois', 'completed', 'side')
    ]);
    assert.equal(spec.kind, 'column');
    assert.equal(spec.columns, 1);
  });

  it('4. grid correctement représentée : content + ≥2 blocs enfants → 2 colonnes', () => {
    const parent = component('main', 'content', 'Main');
    const spec = compositionFor(parent, [
      component('a', 'card', 'A'),
      component('b', 'card', 'B'),
      component('c', 'chart', 'C')
    ]);
    assert.equal(spec.kind, 'grid');
    assert.equal(spec.columns, 2);
  });

  it('5. stack pour les superpositions (overlay/modal)', () => {
    const parent = component('ov', 'overlay', 'Overlay');
    const spec = compositionFor(parent, [
      component('l1', 'card', 'L1'),
      component('l2', 'card', 'L2')
    ]);
    assert.equal(spec.kind, 'stack');
  });

  it('6. fallback générique : type de parent inconnu → column, AUCUN composant perdu', () => {
    const parent = component('myst', 'mystique', 'Mystique');
    const children = [component('x', 'widget', 'X'), component('y', 'widget', 'Y')];
    const spec = compositionFor(parent, children);
    assert.equal(spec.kind, 'column');
    const tree = layoutTree(pageWith([parent, ...children]));
    const ids = tree.groups.flatMap((g) => g.nodes.map((n) => n.component.id));
    for (const c of [parent, ...children]) assert.ok(ids.includes(c.id), `${c.id} toujours rendu`);
  });

  it('7. PUR : le même state produit le même arbre, le state n’est jamais muté', () => {
    const s = pageWith([
      component('header', 'header', 'Header'),
      component('sidebar', 'sidebar', 'Sidebar'),
      component('card', 'card', 'Carte', 'building', 'sidebar', { title: 'T' })
    ]);
    const before = JSON.stringify([...s.components.entries()]);
    const a = JSON.stringify(layoutTree(s));
    const b = JSON.stringify(layoutTree(s));
    assert.equal(a, b, 'déterministe');
    assert.equal(JSON.stringify([...s.components.entries()]), before, 'state intact');
  });

  it('8. layout dérivé par parent : content → grid, sidebar → column (dans layoutTree)', () => {
    const s = pageWith([
      component('header', 'header', 'Header'),
      component('sidebar', 'sidebar', 'Sidebar'),
      component('content', 'content', 'Content'),
      component('card1', 'card', 'Carte 1', 'completed', 'content'),
      component('card2', 'card', 'Carte 2', 'completed', 'content')
    ]);
    const tree = layoutTree(s);
    const all = tree.groups.flatMap((g) => g.nodes);
    const content = all.find((n) => n.component.id === 'content')!;
    const sidebar = all.find((n) => n.component.id === 'sidebar')!;
    assert.equal(content.layout.kind, 'grid', 'content ≥2 enfants → grid');
    assert.equal(sidebar.layout.kind, 'column', 'navigation verticale');
  });
});

describe('ÉTAPE 07 : Responsive (dérivation indépendante du viewport)', () => {
  it('9. Desktop / Tablet / Mobile : le MÊME state produit la MÊME composition (le viewport est un mode d’affichage)', () => {
    const s = pageWith([
      component('header', 'header', 'Header'),
      component('sidebar', 'sidebar', 'Sidebar'),
      component('main', 'content', 'Main'),
      component('card', 'card', 'Carte', 'building', 'main')
    ]);
    // La composition ne prend AUCUN paramètre de viewport : trois appels
    // « modes » simulés produisent le même arbre — seul le CSS de la page adapte.
    const a = JSON.stringify(layoutTree(s));
    const b = JSON.stringify(layoutTree(s));
    assert.equal(a, b);
    assert.equal(renderPreview(s).focusId, 'card', 'focus inchangé quel que soit le mode');
  });

  it('10. RESET dans chaque état : retour idle complet (dérivation intégrale)', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c', type: 'card', label: 'C' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'BUILD_RESET', timestamp: 3 });
    const tree = layoutTree(s);
    assert.equal(tree.groups.length, 1);
    assert.equal(tree.groups[0]!.nodes.length, 0, 'aucun composant résiduel');
    assert.equal(renderPreview(s).flat.length, 0);
  });
});
