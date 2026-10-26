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

  it('2. fin de génération → ordre sync-project vers le projet ACTIF', () => {
    // BLOC 4 : resync vers le projet actif au done (avant : celui de la
    // génération, dépassé après un switch mid-gen), avec repli.
    assert.ok(studio.includes("command: 'sync-project', projectId: activePidNow"), 'done resynchronise le panneau');
    assert.ok(studio.includes('userProjects.find(p => p.id === activeProjectId)'), 'résolution du projet actif');
    assert.ok(studio.includes('|| serverProjectId'), 'repli sur le projet de la génération');
  });

  it('3. le Builder suit le projet (cible + recharge explicite)', () => {
    assert.ok(builder.includes('let builderProjectId = null'), 'projet suivi mémorisé');
    assert.ok(builder.includes("d.command === 'sync-project'"), 'commande sync-project traitée');
    assert.ok(builder.includes('resumeSession(builderProjectId || undefined)'), 'rechargement du projet suivi');
    assert.ok(builder.includes('builderProjectId && list.find'), 'génération manuelle ciblée sur le projet suivi');
    assert.ok(builder.includes('async function resumeSession(explicitProjectId)'), 'reprise paramétrable');
  });

  it('4b. chargement : le Builder s’annonce, le Studio répond avec le projet actif', () => {
    assert.ok(builder.includes("command: 'builder-ready'"), 'le Builder annonce son chargement');
    assert.ok(builder.includes('window.parent.postMessage'), 'annonce au parent (intégré uniquement)');
    assert.ok(studio.includes('function postBuilderSync()'), 'helper de synchro (visible partout)');
    assert.ok(studio.includes("rd.command === 'builder-ready'"), 'le Studio écoute l’annonce');
    const openFn = studio.slice(studio.indexOf('function openProject(id, opts = {})'));
    assert.ok(openFn.slice(0, 2500).includes('postBuilderSync()'), 'changement de projet → panneau resynchronisé');
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

  it('5. BLOC 4 : suivi de projet PENDANT la génération (anti-mélange)', () => {
    // Chaque frame relayée porte le projet (avant : start seul).
    assert.ok(studio.includes("command: 'builder-event', event,"), 'relai des frames vers le Builder');
    assert.ok(studio.includes('projectId: serverProjectId'), 'projectId sur chaque frame relayée');
    // Le Builder mémorise le projet en construction et ignore les frames
    // d'un autre projet (switch mid-gen) au lieu de mélanger deux builds.
    assert.ok(builder.includes('let relayBuildingProjectId = null'), 'projet en construction suivi');
    assert.ok(builder.includes('relayPid !== relayBuildingProjectId'), 'frames d’un autre projet ignorées');
    assert.ok(builder.includes("builderProjectId !== relayBuildingProjectId"), 'sync vers un autre projet admise');
  });
});
