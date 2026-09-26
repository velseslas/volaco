/**
 * Volaco Core - LOT 10 Dedicated Test Suite
 * Validation de la Carte Plan First et de l'Interface Interactive Studio
 *
 * Tests:
 * 1. Présence des boutons canoniques [Confirmer et exécuter], [Modifier le plan] et [Ignorer]
 * 2. Dépliage et soumission du conteneur de modification interactive du plan
 * 3. Écran d'attente informée "Plan First Gate" pour l'aperçu (createPlanFirstGateScreen)
 * 4. Activation visuelle du Conversation Compass (suppression du display:none)
 *
 * L'ancien test 5 (« parité binaire » avec volaco_studio.html) a été retiré :
 * les duplicatas obsolètes du Studio ont été supprimés — apps/studio/index.html
 * est désormais l'unique source de vérité de l'interface.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('LOT 10 — Carte Interactive Plan First Studio', () => {
  const indexPath = join(process.cwd(), 'apps', 'studio', 'index.html');

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

  it('5. Handlers Features/Feedback câblés (plus de stubs no-op)', () => {
    assert.ok(!indexContent.includes('window.runFeaturesDiscovery = function() {}'), 'Le stub no-op runFeaturesDiscovery doit avoir disparu');
    assert.ok(!indexContent.includes('window.runFeedbackAnalysis = function() {}'), 'Le stub no-op runFeedbackAnalysis doit avoir disparu');
    assert.ok(indexContent.includes('async function runFeaturesDiscovery()'), 'runFeaturesDiscovery doit être réellement définie');
    assert.ok(indexContent.includes('async function runFeedbackAnalysis()'), 'runFeedbackAnalysis doit être réellement définie');
    assert.ok(indexContent.includes('function exportFeaturesReport()'), 'exportFeaturesReport doit être définie');
    assert.ok(indexContent.includes('function exportFeedbackReport()'), 'exportFeedbackReport doit être définie');
    assert.ok(indexContent.includes('function setFeedbackFilter('), 'setFeedbackFilter doit être définie');
    assert.ok(indexContent.includes('function filterFeedbackProblems()'), 'filterFeedbackProblems doit être définie');
    assert.ok(indexContent.includes('function closeSimulateSignalModal()'), 'closeSimulateSignalModal doit être définie');
    assert.ok(indexContent.includes('async function submitSimulatedSignal()'), 'submitSimulatedSignal doit être définie');
    assert.ok(!indexContent.includes("'tenant_default'"), 'Le tenant incohérent tenant_default doit avoir disparu');
  });
});
