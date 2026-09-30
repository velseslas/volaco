/**
 * ÉTAPE 09 — tests du FEATURE FLAG centralisé PREVIEW_BUILDER_V2.
 * Brief : flag OFF → ancien chemin conservé ; flag ON → nouveau Preview
 * activé. Résolution : query ?v2= prioritaire > localStorage > défaut OFF.
 * Un seul module lit ces sources — rien d'autre ne décide.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FLAG_STORAGE_KEY, resolvePreviewBuilderV2 } from '../../src/preview-builder/flags.js';

describe('ÉTAPE 09 : feature flag PREVIEW_BUILDER_V2 (centralisé)', () => {
  it('1. défaut OFF — sans query ni storage, l’ancien chemin est conservé', () => {
    assert.equal(resolvePreviewBuilderV2({ search: '' }), 'off');
    assert.equal(resolvePreviewBuilderV2({ search: '', storageGet: () => null }), 'off');
    assert.equal(resolvePreviewBuilderV2({ search: '', storageGet: () => '0' }), 'off');
    assert.equal(resolvePreviewBuilderV2({ search: '?foo=1' }), 'off');
  });

  it('2. query ?v2=1 → ON (active le nouveau Preview), ?v2=0 → OFF même si storage ON', () => {
    assert.equal(resolvePreviewBuilderV2({ search: '?v2=1' }), 'on');
    assert.equal(resolvePreviewBuilderV2({ search: '?other=2&v2=1' }), 'on');
    // La query ÉCRASE le storage : démonstration sans persistance durable
    assert.equal(resolvePreviewBuilderV2({ search: '?v2=0', storageGet: () => '1' }), 'off');
  });

  it('3. storage PREVIEW_BUILDER_V2=1 → ON persistant', () => {
    const store: Record<string, string> = { [FLAG_STORAGE_KEY]: '1' };
    assert.equal(resolvePreviewBuilderV2({ search: '', storageGet: (k) => store[k] ?? null }), 'on');
  });

  it('4. valeurs hostiles traitées comme OFF (jamais d’activation implicite)', () => {
    assert.equal(resolvePreviewBuilderV2({ search: '?v2=yes' }), 'off');
    assert.equal(resolvePreviewBuilderV2({ search: '?v2=true' }), 'off');
    assert.equal(resolvePreviewBuilderV2({ search: '', storageGet: () => 'on' }), 'off');
    assert.equal(resolvePreviewBuilderV2({ search: '', storageGet: () => 'garbage' }), 'off');
  });
});
