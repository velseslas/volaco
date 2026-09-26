/**
 * Volaco Core - LOT 10 Dedicated Test Suite
 * Validation du câblage réel de l'interface Studio
 *
 * Tests:
 * 1. Flux de confirmation de plan câblé au serveur (confirmConversationPlan
 *    -> /confirm -> /execute -> mise à jour du preview avec le VRAI contenu)
 * 2. Consommation du stream SSE conversationnel (Accept event-stream,
 *    getReader, événements section_start/section_end)
 * 3. Terminal web câblé à la route réelle /terminal/execute
 * 4. Conversation Compass piloté dynamiquement (setCompassState)
 * 5. Handlers Features/Feedback câblés (plus de stubs no-op) + tenant unifié
 *
 * Les anciens tests 1-4 (boutons « Confirmer et exécuter », planModifyContainer,
 * createPlanFirstGateScreen, compass non masqué) portaient sur une itération
 * précédente de l'UI dont ces éléments ont disparu — ils ont été réécrits sur
 * l'interface actuelle pour redevenir des garde-fous réels.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('LOT 10 — Câblage réel de l\'interface Studio', () => {
  const indexPath = join(process.cwd(), 'apps', 'studio', 'index.html');

  const indexContent = readFileSync(indexPath, 'utf8');

  it('1. Le plan conversationnel est confirmé auprès du serveur puis exécuté pour de vrai', () => {
    assert.ok(
      indexContent.includes('async function confirmConversationPlan(planId, approved)'),
      'confirmConversationPlan doit être déclarée'
    );
    assert.ok(
      indexContent.includes('window.confirmConversationPlan = confirmConversationPlan'),
      'confirmConversationPlan doit être exposée globalement'
    );
    assert.ok(
      indexContent.includes('/conversation/sessions/${sessionId}/confirm'),
      'Doit appeler la route serveur /confirm'
    );
    assert.ok(
      indexContent.includes('/conversation/sessions/${sessionId}/execute'),
      'Doit enchaîner sur la route serveur /execute'
    );
    assert.ok(
      indexContent.includes('execData.fileUpdate && execData.fileUpdate.updated'),
      'Doit vérifier la MISE À JOUR RÉELLE du fichier renvoyée par le serveur (jamais un faux succès)'
    );
  });

  it('2. Le chat consomme le stream SSE (effet machine à écrire section par section)', () => {
    assert.ok(
      indexContent.includes("'Accept': 'text/event-stream'"),
      'La requête de stream doit négocier text/event-stream'
    );
    assert.ok(
      indexContent.includes('response.body.getReader()'),
      'Doit lire le corps en streaming (getReader)'
    );
    assert.ok(
      indexContent.includes("event.type === 'section_start'"),
      'Doit traiter les événements section_start'
    );
    assert.ok(
      indexContent.includes("event.type === 'section_end'"),
      'Doit traiter les événements section_end'
    );
  });

  it('3. Le terminal web est câblé à la route réelle /terminal/execute', () => {
    assert.ok(
      indexContent.includes('/terminal/execute'),
      'Doit appeler POST /api/v1/projects/:id/terminal/execute'
    );
  });

  it('4. Le Conversation Compass existe et est piloté dynamiquement', () => {
    assert.ok(indexContent.includes('id="conversationCompassBar"'), 'Doit contenir conversationCompassBar');
    assert.ok(
      indexContent.includes('function setCompassState(state, label, dotColor, badgeText)'),
      'setCompassState doit piloter les états du compass'
    );
    assert.ok(indexContent.includes('setCompassState("EXECUTING"'), 'État EXECUTING utilisé');
    assert.ok(indexContent.includes('setCompassState("VALIDATING"'), 'État VALIDATING utilisé');
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

  it('6. Les appels projets utilisent le vrai projet serveur (plus de fallback default-project mort)', () => {
    assert.ok(
      indexContent.includes('async function resolveServerProjectId()'),
      'resolveServerProjectId doit réutiliser/créer le vrai projet serveur'
    );
    assert.ok(
      indexContent.includes('await resolveServerProjectId()'),
      'Les appels API doivent passer par resolveServerProjectId'
    );
    assert.ok(
      !indexContent.includes("'default-project'"),
      "Le fallback 'default-project' (404 garanti : projet jamais créé côté serveur) doit avoir disparu"
    );
  });
});
