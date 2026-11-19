/**
 * É53 LOT B — CONTRAT DE VÉRITÉ DU FLUX /stream.
 *
 * La matrice d'audit (rapport e53-rapport-audit-verite.md §4) est prouvée au
 * niveau PUR : `computeStreamTruth` (autorité de vérité) et `buildFinalSynthesis`
 * (T7 structuré). Chaque entrée correspond à un scénario réel du parcours :
 *
 *   R1  création nominale persistée (orchestrée)            → success
 *   R2  zéro section fermée (LLM muet/coupé)                → failure
 *   R3  génération tronquée, partie persistée               → partial (motif)
 *   R4  modification partiellement appliquée (1 cible manquée) → partial
 *   R5  modification sans aucun changement réellement appliqué → failure
 *   R6  gate < seuil (fichier persisté)                     → updated true, gate distinct
 *   R7  gate indisponible                                   → gateUnavailable explicite
 *   R8  refus du contrat de préservation                    → failure
 *   R9  rollback post-écriture (invariant violé)            → failure
 *   R10 repli TECHNIQUE (moteur absent) écrit + relu        → success (canal fallback)
 *   R11 repli écrit mais non confirmé par lecture à rebours → failure
 *   R12 HTML long mais AUCUNE tentative de persistance      → failure (jamais déduit de la longueur)
 *   R13 modification « écho fidèle » uniquement (cibles trouvées, bytes identiques) → failure
 *   R14 gate < seuil ET tronqué ET persistance réelle       → partial (gate ≠ persistance)
 *
 * Les scénarios annulation/client parti/planFirst sont prouvés en e2e
 * (stream-truth-e2e) : ils n'atteignent pas `computeStreamTruth` (pas de done).
 */
import './_lot-b-legacy-env.js';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreamTruth, buildFinalSynthesis } from '../src/routes/conversation.js';

const BASE = {
  isModificationMode: false,
  attemptedPersistence: true,
  mutationApplied: true,
  fallbackWritten: false,
  persistedVerified: true,
  persistenceError: undefined,
  revisionCreated: true,
  truncatedGeneration: false,
  gateEligible: true,
  gateResult: { score: 96, passed: true },
  sections: [
    { name: 'header', mode: 'create', changed: true, delivered: true },
    { name: 'hero', mode: 'create', changed: true, delivered: true }
  ],
  hasExploitableChange: true
} as const;

describe('É53 LOT B — computeStreamTruth (matrice d\u2019audit)', () => {
  it('R1 — création nominale orchestrée : success + committedFiles réels', () => {
    const t = computeStreamTruth(BASE);
    assert.equal(t.updated, true);
    assert.equal(t.verdict, 'success');
    assert.equal(t.partial, false);
    assert.deepEqual(t.partialReasons, []);
    assert.equal(t.reason, null);
    assert.equal(t.gateUnavailable, false);
    assert.deepEqual([...t.committedFiles], [{ taskId: 'stream', files: ['index.html'] }]);
    assert.deepEqual([...t.unmetFiles], []);
  });

  it('R2 — zéro section fermée : failure explicite, rien de persisté', () => {
    const t = computeStreamTruth({
      ...BASE,
      attemptedPersistence: false,
      mutationApplied: false,
      persistedVerified: false,
      gateEligible: false,
      gateResult: null,
      revisionCreated: false,
      sections: [],
      hasExploitableChange: false
    });
    assert.equal(t.updated, false);
    assert.equal(t.verdict, 'failure');
    assert.match(t.reason ?? '', /aucune section exploitable générée/);
    assert.deepEqual([...t.committedFiles], []);
    assert.deepEqual([...t.unmetFiles], [{ taskId: 'stream', files: ['index.html'] }]);
  });

  it('R3 — génération tronquée avec partie persistée : partial (motif exact)', () => {
    const t = computeStreamTruth({
      ...BASE,
      truncatedGeneration: true,
      sections: [{ name: 'hero', mode: 'create', changed: true, delivered: true }]
    });
    assert.equal(t.updated, true);
    assert.equal(t.verdict, 'partial');
    assert.equal(t.partial, true);
    assert.equal(t.partialReasons.length, 1);
    assert.match(t.partialReasons[0] ?? '', /tronquée/);
    assert.ok((t.partialReasons[0] ?? '').includes('n\'a pas été persistée'));
    assert.deepEqual([...t.committedFiles], [{ taskId: 'stream', files: ['index.html'] }]);
  });

  it('R4 — modification partiellement appliquée (1 cible introuvable) : partial', () => {
    const t = computeStreamTruth({
      ...BASE,
      isModificationMode: true,
      sections: [
        { name: 'hero', mode: 'modify', changed: true, delivered: true },
        { name: 'galerie', mode: 'modify', changed: false, delivered: false }
      ]
    });
    assert.equal(t.updated, true);
    assert.equal(t.verdict, 'partial');
    assert.match(t.partialReasons.join(' | '), /galerie/);
    assert.match(t.partialReasons.join(' | '), /non appliquée/);
  });

  it('R5 — modification sans aucun changement réellement appliqué : pas de succès', () => {
    const t = computeStreamTruth({
      ...BASE,
      isModificationMode: true,
      attemptedPersistence: false,
      mutationApplied: false,
      persistedVerified: false,
      gateEligible: false,
      gateResult: null,
      revisionCreated: false,
      sections: [{ name: 'galerie', mode: 'modify', changed: false, delivered: false }],
      hasExploitableChange: false
    });
    assert.equal(t.updated, false);
    assert.equal(t.verdict, 'failure');
    assert.match(t.reason ?? '', /aucune modification réellement appliquée/);
  });

  it('R6 — gate < seuil : persistance et qualité RESTENT distincts (updated true)', () => {
    const t = computeStreamTruth({
      ...BASE,
      gateResult: { score: 74, passed: false }
    });
    assert.equal(t.updated, true, 'un gate insuffisant ne retire pas le succès de persistance');
    assert.equal(t.verdict, 'success', 'un gate insuffisant ne crée pas de partiel de persistance');
    assert.equal(t.gateUnavailable, false);
  });

  it('R7 — gate indisponible : signal explicite, persistance réelle conservée', () => {
    const t = computeStreamTruth({
      ...BASE,
      gateResult: null
    });
    assert.equal(t.updated, true);
    assert.equal(t.gateUnavailable, true);
  });

  it('R8 — refus du contrat de préservation : failure (aucun succès fictif)', () => {
    const t = computeStreamTruth({
      ...BASE,
      mutationApplied: false,
      persistedVerified: false,
      revisionCreated: false,
      persistenceError: 'Modification refusée par le contrat de préservation : perte de contenu protégé'
    });
    assert.equal(t.updated, false);
    assert.equal(t.verdict, 'failure');
    assert.match(t.reason ?? '', /contrat de préservation/);
    assert.deepEqual([...t.unmetFiles], [{ taskId: 'stream', files: ['index.html'] }]);
  });

  it('R9 — rollback post-écriture : failure', () => {
    const t = computeStreamTruth({
      ...BASE,
      mutationApplied: false,
      persistedVerified: false,
      revisionCreated: false,
      persistenceError: 'La mutation de index.html a été annulée : invariant violé'
    });
    assert.equal(t.updated, false);
    assert.equal(t.verdict, 'failure');
    assert.match(t.reason ?? '', /annulée/);
  });

  it('R10 — repli TECHNIQUE (moteur absent) écrit et relu : succès réel, jamais du seul drapeau', () => {
    const t = computeStreamTruth({
      ...BASE,
      mutationApplied: false,
      fallbackWritten: true
    });
    assert.equal(t.updated, true, 'l\u2019écriture relue est la preuve — pas viaFallback');
    assert.equal(t.verdict, 'success');
  });

  it('R11 — repli écrit mais NON confirmé par la lecture à rebours : failure', () => {
    const t = computeStreamTruth({
      ...BASE,
      mutationApplied: false,
      fallbackWritten: true,
      persistedVerified: false,
      persistenceError: 'vérification post-écriture en échec : le fichier relu ne correspond pas au contenu généré'
    });
    assert.equal(t.updated, false);
    assert.equal(t.verdict, 'failure');
  });

  it('R12 — HTML long mais AUCUNE tentative : failure (jamais déduit de la longueur)', () => {
    const t = computeStreamTruth({
      ...BASE,
      attemptedPersistence: false,
      mutationApplied: false,
      persistedVerified: false,
      gateEligible: false,
      gateResult: null,
      revisionCreated: false,
      sections: [],
      hasExploitableChange: false
    });
    assert.equal(t.updated, false, 'un assembledHtml > 100 ne prouve RIEN');
    assert.equal(t.verdict, 'failure');
  });

  it('R13 — modification 100 % écho fidèle (cibles trouvées, bytes identiques) : failure', () => {
    const t = computeStreamTruth({
      ...BASE,
      isModificationMode: true,
      attemptedPersistence: false,
      mutationApplied: false,
      persistedVerified: false,
      gateEligible: false,
      gateResult: null,
      revisionCreated: false,
      sections: [{ name: 'hero', mode: 'modify', changed: false, delivered: true }],
      hasExploitableChange: false
    });
    assert.equal(t.updated, false, 'aucun changement de bytes = pas de succès (règle 2 du contrat)');
    assert.match(t.reason ?? '', /aucune modification réellement appliquée/);
  });

  it('R14 — gate < seuil + tronqué + persistance réelle : partial, signaux distincts', () => {
    const t = computeStreamTruth({
      ...BASE,
      truncatedGeneration: true,
      gateResult: { score: 68, passed: false },
      sections: [{ name: 'hero', mode: 'create', changed: true, delivered: true }]
    });
    assert.equal(t.updated, true);
    assert.equal(t.partial, true);
    assert.match(t.partialReasons.join(' | '), /tronquée/);
    assert.ok(!t.partialReasons.join(' | ').includes('74'), 'le score du gate ne devient jamais un motif de persistance');
    assert.deepEqual([...t.committedFiles], [{ taskId: 'stream', files: ['index.html'] }]);
  });

  it('aucune exigence non satisfaite n\u2019est listée quand tout est livré (parité E47)', () => {
    const t = computeStreamTruth({
      ...BASE,
      isModificationMode: true,
      sections: [
        { name: 'hero', mode: 'modify', changed: true, delivered: true },
        { name: 'header', mode: 'delete', changed: true, delivered: true }
      ]
    });
    assert.deepEqual([...t.partialReasons], []);
    assert.deepEqual([...t.unmetFiles], []);
  });
});

describe('É53 LOT B — buildFinalSynthesis (T7 structuré)', () => {
  it('failure : texte honnête avec la raison, verdict failure', () => {
    const r = buildFinalSynthesis({
      verdict: 'failure',
      failureReason: 'aucune section exploitable générée',
      sections: [],
      sectionDiffs: [],
      gateScore: null,
      gateAvailable: false,
      durationSec: 7
    });
    assert.equal(r.verdict, 'failure');
    assert.match(r.text, /Aucune écriture persistée/);
    assert.match(r.text, /aucune section exploitable générée/);
  });

  it('partial : motif exact dans le texte, compteurs limités au RÉELLEMENT changé', () => {
    const r = buildFinalSynthesis({
      verdict: 'partial',
      partialReasons: ['section « galerie » (mode modify) demandée mais non appliquée'],
      sections: [
        { name: 'hero', mode: 'modify', changed: true },
        { name: 'galerie', mode: 'modify', changed: false }
      ],
      sectionDiffs: [
        { applied: true, added: 12, removed: 3 },
        { applied: false, added: 0, removed: 0 }
      ],
      gateScore: 91,
      gateAvailable: true,
      durationSec: 9
    });
    assert.equal(r.verdict, 'partial');
    assert.match(r.text, /1 modifiée/);
    assert.ok(!r.text.includes('2 modifiée'), 'la section non appliquée n\u2019est jamais annoncée');
    assert.match(r.text, /PARTIEL : section « galerie »/);
    assert.match(r.text, /\+12 −3 lignes/);
    assert.match(r.text, /Quality Gate 91\/100/);
  });

  it('success : format historique conservé, gate non évalué explicitement si absent', () => {
    const ok = buildFinalSynthesis({
      verdict: 'success',
      sections: [{ name: 'header', mode: 'create', changed: true }, { name: 'hero', mode: 'create', changed: true }],
      sectionDiffs: [{ applied: true, added: 30, removed: 0 }, { applied: true, added: 5, removed: 0 }],
      gateScore: 96,
      gateAvailable: true,
      durationSec: 12
    });
    assert.equal(ok.verdict, 'success');
    assert.match(ok.text, /2 sections construites/);
    assert.match(ok.text, /\+35 −0 lignes/);
    assert.match(ok.text, /Quality Gate 96\/100/);

    const noGate = buildFinalSynthesis({
      verdict: 'success',
      sections: [{ name: 'header', mode: 'create', changed: true }],
      sectionDiffs: [{ applied: true, added: 10, removed: 0 }],
      gateScore: null,
      gateAvailable: false,
      durationSec: 4
    });
    assert.match(noGate.text, /Quality Gate non évalué/, 'un gate absent n\u2019est jamais tu');
  });
});
