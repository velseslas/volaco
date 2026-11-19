/**
 * É53 LOT B — COHÉRENCE STUDIO / SERVEUR (Correction 2).
 *
 * Le code Studio (apps/studio/index.html) est vérifié statiquement (même
 * pattern que lot10-studio-plan-card-ui.test.ts) : le succès ne peut plus
 * reposer sur la seule présence d'un `done`, la vérité serveur
 * (`event.updated === true`) conditionne chaque affichage, le partiel est
 * distingué, l'échec ne montre jamais de coquille verte, et le diff-guard
 * recharge l'état RÉELLEMENT persisté au lieu d'inventer un rollback local.
 */
import './_lot-b-legacy-env.js';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexContent = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');

describe('É53 LOT B — Studio : la vérité serveur conditionne l\u2019affichage', () => {
  it('le succès est conditionné à event.updated === true (jamais à la présence du done)', () => {
    assert.ok(
      indexContent.includes('const streamTruthOk = event.updated === true;'),
      'gate de vérité explicite dans le handler done'
    );
    // L'adoption du HTML serveur est gated par la vérité.
    assert.ok(
      indexContent.includes('if (streamTruthOk && event.html && event.html.length > 100) {'),
      'le html du done n\u2019est adopté que si updated === true'
    );
    // La branche de succès est gated par la vérité + un contenu exploitable.
    assert.ok(
      indexContent.includes('if (streamTruthOk && assembledHtml.length > 100) {'),
      'la carte de succès n\u2019est construite que sur une écriture vérifiée'
    );
  });

  it('un résultat partiel est visuellement distinct d\u2019un succès complet', () => {
    assert.ok(indexContent.includes('Application générée — partiel'), 'titre dédié au partiel');
    assert.ok(indexContent.includes('Modifications partiellement appliquées'), 'accordéon distinct du succès');
    assert.ok(indexContent.includes("activityFeed.advise('partial', 'Application partielle'"), 'canal advisory dédié au partiel');
    // Les motifs exacts du serveur sont affichés (partialReasons).
    assert.ok(indexContent.includes('event.partialReasons'), 'les motifs du serveur sont lus');
    // L'ancien titre unique (succès à chaque done) n'est plus inconditionnel.
    assert.ok(
      !indexContent.includes("titleEl.innerHTML = '<i class=\"fa-solid fa-circle-check text-sm\" style=\"color:#4ade80;\"></i><span style=\"color:#4ade80;\">Application générée</span>';"),
      'le titre de succès n\u2019est plus posé sans condition'
    );
  });

  it('un échec n\u2019affiche jamais « Application générée » ni « Modifications appliquées avec succès »', () => {
    assert.ok(indexContent.includes('Échec de la génération'), 'titre d\u2019échec honnête');
    assert.ok(indexContent.includes("a été persisté — ' + String(event.reason)"), 'la raison de non-persistance est affichée');
    assert.ok(indexContent.includes('Rien n'), 'le message de non-persistance est présent');
    assert.ok(indexContent.includes('aucun contenu exploitable reçu'), 'le contenu insuffisant est nommé');
    assert.ok(indexContent.includes("activityFeed.advise('truth', 'Aucune écriture'"), 'canal advisory dédié à l\u2019échec');
    // La branche d'échec couvre updated!==true ET un contenu insuffisant.
    assert.ok(
      indexContent.includes('} else if (!streamTruthOk || assembledHtml.length <= 100) {'),
      'toute issue non-succès tombe dans la branche honnête'
    );
    // La voie « réponse seule » (updated:false SANS raison) reste intacte.
    assert.ok(indexContent.includes('Réponse seule — aucun fichier modifié'), 'badge réponse seule conservé');
  });

  it('le diff-guard recharge l\u2019état serveur réellement persisté (aucun rollback local inventé)', () => {
    assert.ok(
      indexContent.includes("'/api/v1/projects/' + serverProjectId + '/files/content?path=index.html'"),
      'le guard fetch l\u2019état RÉEL du fichier sur le serveur'
    );
    assert.ok(indexContent.includes('état serveur réel rechargé'), 'le message dit la vérité (rechargement, pas rejet)');
    assert.ok(indexContent.includes('Conflit : des sections ont disparu'), 'l\u2019impossibilité de recharger est un conflit EXPLICITE');
    // L'ancien rollback local est parti.
    assert.ok(
      !indexContent.includes('Modification rejetée : des sections ont disparu'),
      'l\u2019ancien label de rollback local a disparu'
    );
    assert.ok(
      indexContent.includes('retour arrière : révisions'),
      'le retour arrière réel reste les révisions/Timeline'
    );
  });

  it('finishFromStream : un done updated:false n\u2019est jamais un « complete » vert', () => {
    // La vérification updated passe AVANT tout finish('complete').
    assert.ok(
      indexContent.includes('if (ev && ev.updated === false) {'),
      'le done updated:false est intercepté explicitement'
    );
    assert.ok(
      indexContent.includes("finish('fail', { error: 'Rien n"),
      'un échec avec raison → finish fail'
    );
    // L'ancien chemin (hide silencieux ou complete inconditionnel) est parti.
    assert.ok(
      !indexContent.includes("if (ev && ev.updated === false && !secs_.size && score === null) { finished = true; clearInterval(timer); el.style.display = 'none'; advisory.style.display = 'none'; return; }"),
      'l\u2019ancien hide silencieux est remplacé par la vérité'
    );
  });

  it('le comportement awaitingConfirmation (PlanFirst) reste intact', () => {
    assert.ok(indexContent.includes('if (event.awaitingConfirmation) {'), 'le branchement PlanFirst existe toujours');
    assert.ok(indexContent.includes('En attente de confirmation du plan ci-dessus'), 'statut PlanFirst inchangé');
    assert.ok(indexContent.includes("'✓ Approuver et générer'"), 'bouton d\u2019approbation inchangé');
    // Il est positionné AVANT le gate de vérité (le return PlanFirst prime).
    const awaitingPos = indexContent.indexOf('if (event.awaitingConfirmation) {');
    const truthPos = indexContent.indexOf('const streamTruthOk = event.updated === true;');
    assert.ok(awaitingPos > -1 && truthPos > awaitingPos, 'PlanFirst est traité avant le gate de vérité');
  });

  it('les frames mutation_refused / mutation_fallback sont surfacees (cohérence des frames)', () => {
    assert.ok(
      indexContent.includes("event.type === 'mutation_refused'"),
      'un refus métier est visible (canal advisory), pas absorbé en silence'
    );
    assert.ok(
      indexContent.includes("event.type === 'mutation_fallback'"),
      'le repli technique tracé est visible'
    );
    // Les frames existantes restent branchées (Studio ne gère file_created /
    // file_modified par type dédié — design préexistant : la vérité passe par
    // diff + done).
    assert.ok(indexContent.includes("event.type === 'diff'"), 'frame diff toujours gérée');
  });

  it('aucune écriture locale de fichier à partir du seul done (la vérité est serveur)', () => {
    // Studio peut RECHARGER le serveur (guard), mais ne fabrique plus d'état :
    // pas de new Blob/fichier écrit depuis le handler done.
    assert.ok(
      !indexContent.includes("ap2.code = window._preGenerationHtml"),
      'plus aucune réaffectation du HTML d\u2019avant génération'
    );
  });
});
