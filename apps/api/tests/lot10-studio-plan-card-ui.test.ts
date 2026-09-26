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

  it('7. Le preview n\'est plus cassé en modification (pas de double-emballage du document)', () => {
    assert.ok(
      indexContent.includes('const isFullDoc = /<!DOCTYPE|<html[\\s>]/i.test(assembledHtml);'),
      'Le handler done doit détecter un document complet avant de choisir d\'emballer ou non'
    );
    assert.ok(
      indexContent.includes('currentAppHtml = isFullDoc ? assembledHtml : buildHtmlDoc(assembledHtml);'),
      'Un document complet doit être utilisé tel quel (jamais ré-emballé)'
    );
    assert.ok(
      indexContent.includes('applySectionToDoc'),
      'applySectionToDoc doit exister (modification appliquée sur le document existant en live)'
    );
    assert.ok(
      indexContent.includes('modWorkingDoc'),
      'Le mode modification doit travailler sur le document existant (modWorkingDoc)'
    );
  });

  it('8. Explorer, Timeline et Terminal réels (plus de données fictives en dur)', () => {
    // Explorer : arbre dynamique depuis GET /files (plus d'arbre statique)
    assert.ok(indexContent.includes('function loadFileTree()'), 'loadFileTree doit être définie');
    assert.ok(indexContent.includes("fetch(`/api/v1/projects/${pid}/files`"), 'L\'arbre doit venir de GET /files');
    assert.ok(!indexContent.includes("selectCodeFile('Header.jsx')"), 'L\'arbre statique (Header.jsx) doit avoir disparu');
    // Timeline : révisions et activité réelles
    assert.ok(indexContent.includes('async function loadServerHistoryData()'), 'loadServerHistoryData doit être définie');
    assert.ok(indexContent.includes('/revisions`'), 'Les révisions doivent venir de GET /revisions');
    assert.ok(indexContent.includes('/activity`'), 'L\'activité doit venir de GET /activity');
    assert.ok(!indexContent.includes("id: 'rev-001'"), 'Les révisions fictives doivent avoir disparu');
    assert.ok(!indexContent.includes("id: 'act_1'"), 'Les activités fictives doivent avoir disparu');
    assert.ok(indexContent.includes('async function executeRollback(revId)'), 'executeRollback doit appeler l\'API serveur');
    // Terminal : plus de sorties fictives ni d'eval client
    assert.ok(!indexContent.includes('94 passed (94)'), 'La fausse sortie "94 tests passed" doit avoir disparu');
    assert.ok(!indexContent.includes('commit 7f3b89a'), 'Les faux commits git doivent avoir disparu');
    assert.ok(!indexContent.includes('String(eval(expr))'), 'L\'eval arbitraire côté client doit avoir disparu');
    assert.ok(indexContent.includes('le backend n\'a pas répondu'), 'Le fallback terminal doit être honnête');
  });

  it('9. Rendu réel branché + Compass 9 états (§11 CDC)', () => {
    // Rendu réel Chromium branché au preview
    assert.ok(indexContent.includes('async function runRealRender()'), 'runRealRender doit être définie');
    assert.ok(indexContent.includes('/render/preview`'), 'Doit appeler POST /render/preview (réel Chromium)');
    assert.ok(indexContent.includes('id="realRenderModal"'), 'La modale de rendu réel doit exister');
    assert.ok(indexContent.includes('screenshotBase64'), 'La capture doit être affichée');
    // Compass : les 9 états du CDC gérés côté client
    for (const state of ['EXPLORING', 'UNDERSTANDING', 'CLARIFYING', 'WAITING_CONFIRMATION', 'PLANNING', 'EXECUTING', 'REPAIRING', 'VALIDATING', 'COMPLETED']) {
      assert.ok(indexContent.includes(`${state}:`), `L'état Compass ${state} doit être géré côté client`);
    }
    assert.ok(indexContent.includes("event.type === 'compass'"), 'Les événements compass du stream doivent être traités');
  });

  it('10. Plan First : carte de plan réelle + toggle confirmation humaine (§17/§3.9 CDC)', () => {
    assert.ok(indexContent.includes('function planFirstEnabled()'), 'planFirstEnabled doit être définie');
    assert.ok(indexContent.includes('function togglePlanFirstMode()'), 'togglePlanFirstMode doit être définie');
    assert.ok(indexContent.includes('function renderPlanFirstCard('), 'renderPlanFirstCard doit être définie');
    assert.ok(indexContent.includes('function approvePlanFirstCard('), 'approvePlanFirstCard doit être définie');
    assert.ok(indexContent.includes('function rejectPlanFirstCard('), 'rejectPlanFirstCard doit être définie');
    assert.ok(indexContent.includes('id="btnPlanFirstToggle"'), 'Le toggle Plan First doit exister dans la barre de chat');
    assert.ok(indexContent.includes('planFirst: planFirstEnabled()'), 'Le flag planFirst doit être envoyé au serveur');
    assert.ok(indexContent.includes('event.awaitingConfirmation'), 'Le done d\'attente de confirmation doit être traité');
    assert.ok(indexContent.includes('Approuver et générer'), 'Le bouton d\'approbation doit exister');
  });
});
