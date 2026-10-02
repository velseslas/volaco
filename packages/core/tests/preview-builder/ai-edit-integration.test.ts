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
  it('1. le Builder importe la boucle d édition IA (module isomorphe servi)', () => {
    const src = appJs();
    assert.ok(src.includes("import { runAiEditLoop } from '/preview-builder/ai-edit.js';"), 'import présent');
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
