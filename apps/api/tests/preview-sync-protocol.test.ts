/**
 * SOURCE UNIQUE panneau=onglet : le pont transporte le projet actif et le
 * Builder le suit (génération ciblée + rechargement explicite).
 * Garde source (le messaging iframe ne se teste pas en HTTP).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('SOURCE UNIQUE : panneau et onglet suivent le projet actif', () => {
  const studio = readFileSync(join(process.cwd(), 'apps/studio/index.html'), 'utf8');
  const builder = readFileSync(join(process.cwd(), 'apps/studio/preview-builder-app.js'), 'utf8');

  it('1. le pont envoie le projectId (plus de prompt seul)', () => {
    assert.ok(
      studio.includes("command: 'start-builder-generation', prompt:") && studio.includes('projectId: knownPid'),
      'start-builder-generation transporte le projet actif'
    );
  });

  it('2. fin de génération → ordre sync-project au Builder', () => {
    assert.ok(studio.includes("command: 'sync-project', projectId: serverProjectId"), 'done resynchronise le panneau');
  });

  it('3. le Builder suit le projet (cible + recharge explicite)', () => {
    assert.ok(builder.includes('let builderProjectId = null'), 'projet suivi mémorisé');
    assert.ok(builder.includes("d.command === 'sync-project'"), 'commande sync-project traitée');
    assert.ok(builder.includes('resumeSession(builderProjectId || undefined)'), 'rechargement du projet suivi');
    assert.ok(builder.includes('builderProjectId && list.find'), 'génération manuelle ciblée sur le projet suivi');
    assert.ok(builder.includes('async function resumeSession(explicitProjectId)'), 'reprise paramétrable');
  });

  it('4. UNE SEULE génération : le pont ne déclenche plus de flux, le relai rejoue', () => {
    // Côté Studio : chaque frame du flux chat est relayée telle quelle.
    assert.ok(studio.includes("command: 'builder-event'"), 'relai des frames vers le Builder');
    // Côté Builder : le pont AFFICHE seulement (pas de realBtn.click).
    const bridge = builder.slice(builder.indexOf("d.command !== 'start-builder-generation'"));
    assert.ok(!bridge.slice(0, 800).includes('realBtn.click'), 'fini le 2e flux parallèle');
    assert.ok(builder.includes("d.command === 'builder-event'"), 'branche de relai présente');
    assert.ok(builder.includes('normalizeGenerationEvent(d.event)'), 'frames normalisées avant consommation');
    assert.ok(builder.includes('if (realSource) return;'), 'relai ignoré pendant une génération manuelle');
  });
});
