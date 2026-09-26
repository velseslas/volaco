/**
 * Volaco Core - LOT 10 Dedicated Test Suite
 * Validation de la Carte Plan First et de l'Interface Interactive Studio
 *
 * Tests:
 * 1. Présence des boutons canoniques [Confirmer et exécuter], [Modifier le plan] et [Ignorer]
 * 2. Dépliage et soumission du conteneur de modification interactive du plan
 * 3. Écran d'attente informée "Plan First Gate" pour l'aperçu (createPlanFirstGateScreen)
 * 4. Activation visuelle du Conversation Compass (suppression du display:none)
 * 5. Parité binaire stricte 100% entre les fichiers HTML du Studio
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('LOT 10 — Carte Interactive Plan First Studio', () => {
  const indexPath = join(process.cwd(), 'apps', 'studio', 'index.html');
  const appVolacoStudioPath = join(process.cwd(), 'apps', 'studio', 'volaco_studio.html');
  const rootVolacoStudioPath = join(process.cwd(), 'volaco_studio.html');

  const indexContent = readFileSync(indexPath, 'utf8');

  it('1. renderVolacoPlanCard déclare les boutons de confirmation et de modification interactive', () => {
    assert.ok(indexContent.includes('confirmAndExecuteVolacoPlan'), 'Doit inclure confirmAndExecuteVolacoPlan');
    assert.ok(indexContent.includes('togglePlanModification'), 'Doit inclure togglePlanModification');
    assert.ok(indexContent.includes('submitPlanModification'), 'Doit inclure submitPlanModification');
    assert.ok(indexContent.includes('dismissVolacoPlan'), 'Doit inclure dismissVolacoPlan');
    assert.ok(indexContent.includes('Confirmer et exécuter'), 'Doit afficher le libellé Confirmer et exécuter');
    assert.ok(indexContent.includes('Modifier le plan'), 'Doit afficher le libellé Modifier le plan');
    assert.ok(indexContent.includes('Ignorer'), 'Doit afficher le libellé Ignorer');
  });

  it('2. Présence du conteneur repliable pour modification du plan', () => {
    assert.ok(indexContent.includes('planModifyContainer-'), 'Doit contenir planModifyContainer-');
    assert.ok(indexContent.includes('planModifyInput-'), 'Doit contenir planModifyInput-');
    assert.ok(indexContent.includes('Ajuster ce plan'), 'Doit permettre d ajuster le plan');
    assert.ok(indexContent.includes('Mettre à jour le plan'), 'Doit proposer le bouton Mettre à jour le plan');
  });

  it('3. Écran Plan First Gate dédié pour le Preview iframe', () => {
    assert.ok(indexContent.includes('function createPlanFirstGateScreen'), 'Doit déclarer createPlanFirstGateScreen');
    assert.ok(indexContent.includes('Volaco Plan First Gate'), 'Doit inclure le badge Plan First Gate');
    assert.ok(indexContent.includes('EN ATTENTE DE CONFIRMATION'), 'Doit expliciter l attente de confirmation');
    assert.ok(indexContent.includes('createPlanFirstGateScreen(plan, text)'), 'Doit appeler createPlanFirstGateScreen lors de la réception du plan');
  });

  it('4. Conversation Compass est actif et visible (non masqué)', () => {
    assert.ok(indexContent.includes('<div id="conversationCompassBar"'), 'Doit contenir conversationCompassBar');
    assert.ok(!indexContent.includes('<div id="conversationCompassBar" style="display:none !important;"'), 'Ne doit pas masquer conversationCompassBar');
  });

  it('5. Parité binaire stricte (100%) entre apps/studio/index.html, apps/studio/volaco_studio.html et volaco_studio.html', () => {
    const appVolacoContent = readFileSync(appVolacoStudioPath, 'utf8');
    const rootVolacoContent = readFileSync(rootVolacoStudioPath, 'utf8');

    assert.equal(indexContent.length, appVolacoContent.length, 'Taille identique avec apps/studio/volaco_studio.html');
    assert.equal(indexContent.length, rootVolacoContent.length, 'Taille identique avec volaco_studio.html');
    assert.equal(indexContent, appVolacoContent, 'Contenu strictement identique avec apps/studio/volaco_studio.html');
    assert.equal(indexContent, rootVolacoContent, 'Contenu strictement identique avec volaco_studio.html');
  });
});
