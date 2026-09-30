/**
 * ÉTAPE 19 — RÉSOLVEUR DOM : resolveDropTarget(element, geometry, componentId).
 *
 * Lecture seule : remontée data-pv-id (É13) + géométrie → bord de dépose.
 * Aucun index comme identité, aucune écriture, aucun déplacement DOM,
 * drag NON activé dans la page. Doublures structurelles sans dépendance DOM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDropTarget, resolvePreviewTarget, type DropProbeElement } from '../../src/preview-builder/renderer.js';

interface FakeEl extends DropProbeElement {
  attrs: Record<string, string>;
  rect: { top: number; left: number; bottom: number; right: number };
  parent?: FakeEl;
  reads: number;
}
function fakeEl(attrs: Record<string, string>, rect: FakeEl['rect'], parent?: FakeEl): FakeEl {
  const el: FakeEl = {
    attrs,
    rect,
    ...(parent ? { parent } : {}),
    reads: 0,
    closest(selectors: string): FakeEl | null {
      el.reads += 1;
      let cur: FakeEl | undefined = el;
      while (cur) {
        if (selectors === '[data-pv-id]' && cur.attrs['data-pv-id'] !== undefined) return cur;
        cur = cur.parent;
      }
      return null;
    },
    getAttribute(name: string): string | null {
      el.reads += 1;
      return el.attrs[name] ?? null;
    },
    getBoundingClientRect(): FakeEl['rect'] {
      el.reads += 1;
      return el.rect;
    }
  };
  return el;
}

/** Hôte vertical 100×300 dont le haut est à y=0, gauche x=0. */
function verticalHost(id: string, inner?: FakeEl): FakeEl {
  return fakeEl({ 'data-pv-id': id }, { top: 0, left: 0, bottom: 300, right: 100 });
}

describe('ÉTAPE 19 : resolveDropTarget (lecture seule, non activé)', () => {
  it('1. bords de dépose : tiers avant/milieu/après selon la géométrie', () => {
    const host = verticalHost('card');
    const inner = fakeEl({}, host.rect, host);
    const x = 50;
    assert.equal(resolveDropTarget(inner, { x, y: 40 }, 'hero')!.edge, 'before', 'tiers haut → before');
    assert.equal(resolveDropTarget(inner, { x, y: 150 }, 'hero')!.edge, 'inside', 'milieu → inside');
    assert.equal(resolveDropTarget(inner, { x, y: 270 }, 'hero')!.edge, 'after', 'tiers bas → after');
  });

  it('2. hôte horizontal : la géométrie suit l axe dominant', () => {
    const host = fakeEl({ 'data-pv-id': 'chart' }, { top: 0, left: 0, bottom: 80, right: 300 });
    const inner = fakeEl({}, host.rect, host);
    const y = 40;
    assert.equal(resolveDropTarget(inner, { x: 40, y }, 'hero')!.edge, 'before');
    assert.equal(resolveDropTarget(inner, { x: 150, y }, 'hero')!.edge, 'inside');
    assert.equal(resolveDropTarget(inner, { x: 280, y }, 'hero')!.edge, 'after');
  });

  it('3. identité = data-pv-id (remontée É13), jamais un index DOM', () => {
    // Deux hôtes identiques ; l'identité suit l'ATTRIBUT, pas la position
    const first = verticalHost('card-01');
    const inner1 = fakeEl({}, first.rect, first);
    const second = verticalHost('card-02');
    const inner2 = fakeEl({}, second.rect, second);
    assert.equal(resolveDropTarget(inner1, { x: 50, y: 150 }, 'hero')!.hoveredId, 'card-01');
    assert.equal(resolveDropTarget(inner2, { x: 50, y: 150 }, 'hero')!.hoveredId, 'card-02');
  });

  it('4. hors preview → null (et élément null → null)', () => {
    const outside = fakeEl({ class: 'panel-build' }, { top: 0, left: 0, bottom: 10, right: 10 });
    const inner = fakeEl({}, outside.rect, outside);
    assert.equal(resolveDropTarget(inner, { x: 5, y: 5 }, 'hero'), null);
    assert.equal(resolveDropTarget(null, { x: 5, y: 5 }, 'hero'), null);
  });

  it('5. pureté : lecture seule, déterministe, data-pv-id inchangé', () => {
    const host = verticalHost('sidebar');
    const inner = fakeEl({}, host.rect, host);
    const a = resolveDropTarget(inner, { x: 50, y: 150 }, 'hero');
    const b = resolveDropTarget(inner, { x: 50, y: 150 }, 'hero');
    assert.deepEqual(a, b);
    assert.equal(inner.attrs['data-pv-id'], undefined, 'aucun attribut écrit par le résolveur');
    assert.deepEqual(host.attrs, { 'data-pv-id': 'sidebar' }, 'l hôte n est pas modifié');
    // Cohérence avec la fondation É13 : le même hôte résout le même id
    assert.equal(resolvePreviewTarget(inner), 'sidebar');
  });

  it('6. le drag reste NON activé dans la page (aucun écouteur, aucun attribut)', () => {
    const page = readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder.html'), 'utf8');
    for (const forbidden of ['dragstart', 'dragover', 'drop=', 'draggable', 'ondrop']) {
      assert.ok(!page.includes(forbidden), `${forbidden} interdit tant que le drag n est pas activé`);
    }
  });
});
