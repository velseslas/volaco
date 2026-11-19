/**
 * É41 — Qualité conversationnelle RÉELLE (scénarios bout-en-bout).
 *
 * Chaque scénario exécute le VRAI parcours déterministe de production
 * (ConversationEngine + moteur d'intention + générateur de plans + clarifications),
 * sans LLM : même chemin que la sonde réelle. Les assertions portent sur les
 * DÉCISIONS réelles (catégorie, cibles de plan, niveaux de clarification,
 * hypothèses tracées, mémoire multi-tours), pas sur des mots-clés isolés.
 *
 * Couverture des 11 types demandés :
 *   1. demande simple (G1) ;
 *   2. demande complexe (G2) ;
 *   3. demande ambiguë (G3) ;
 *   4. conversation multi-tours / mémoire (G4, G4b) ;
 *   5. modification d'une demande précédente (G5) ;
 *   6. changement de sujet (G6) ;
 *   7. correction apportée par l'utilisateur (G7, G7b) ;
 *   8. informations contradictoires (G8) ;
 *   9. demande nécessitant une clarification (G9) ;
 *  10. demande hors périmètre / non prise en charge (G10) ;
 *  11. création nécessitant plusieurs agents (G2 — ≥2 étapes de mutation).
 *
 * Plus les deux corrections É41 :
 *  - C1 : résolution des références (« modifie-le », « cette page ») ;
 *  - C2 : question de méthode (« Comment … ? ») ≠ commande.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClarificationEngine,
  ContradictionDetector,
  ConversationAssumptionEngine,
  ConversationCompass,
  ConversationEngine,
  ConversationIntentEngine,
  ExecutionBridge,
  ImpactBridge,
  MemoryManager,
  PlanGenerator,
  UnderstandingBridge,
  buildReferenceAssumption,
  detectConversationReference,
  isPluralReference,
  resolveConversationReferents,
  type ConversationSession,
  type ConversationTurn,
  type EngineeringPlan
} from '../../../src/index.js';

function makeEngine(): ConversationEngine {
  return new ConversationEngine(
    new ConversationIntentEngine(),
    new ClarificationEngine(),
    new ConversationAssumptionEngine(),
    new ConversationCompass(),
    new PlanGenerator(),
    new ContradictionDetector(),
    new MemoryManager(),
    new UnderstandingBridge(),
    new ImpactBridge(),
    new ExecutionBridge()
  );
}

let sessionCounter = 0;

function makeSession(): ConversationSession {
  sessionCounter += 1;
  return {
    sessionId: `sess-e41-${sessionCounter}`,
    conversationId: `conv-e41-${sessionCounter}`,
    tenantId: 'tenant-e41',
    projectId: 'proj-e41',
    currentState: 'EXPLORING',
    turns: [],
    activeAssumptions: [],
    activeDecisions: [],
    applicationSnapshot: {
      treeHash: 'tree:e41',
      graphHash: 'graph:e41',
      understandingHash: 'understanding:e41'
    },
    turnMemory: {
      recentMessages: [],
      currentAssumptions: []
    },
    projectMemory: {
      architecturalDecisions: [],
      userPreferences: {},
      acceptedPlans: [],
      rejectedPlans: [],
      knownConstraints: [],
      knownConventions: [],
      knownRisks: []
    }
  };
}

async function speak(
  engine: ConversationEngine,
  session: ConversationSession,
  message: string
): Promise<{ session: ConversationSession; turn: ConversationTurn }> {
  const result = await engine.processTurn({
    session,
    userMessageText: message,
    userRole: 'OWNER',
    requestId: `req-e41-${session.turns.length + 1}`
  });
  return { session: result.updatedSession, turn: result.turn };
}

/** Étapes de MUTATION réelles d'un plan (CREATE/MODIFY/DELETE). */
function mutationSteps(turn: ConversationTurn): EngineeringPlan['steps'] {
  return (turn.plan?.steps ?? []).filter(
    (step) => step.operation === 'CREATE' || step.operation === 'MODIFY' || step.operation === 'DELETE'
  );
}

describe('É41 — qualité conversationnelle réelle (11 scénarios + corrections)', () => {
  it('G1 — demande simple : décision claire, plan proposé, aucune question inutile', async () => {
    const engine = makeEngine();
    const { turn } = await speak(engine, makeSession(), 'Ajoute un bouton de validation à la page checkout');

    assert.equal(turn.intent.category, 'CREATE');
    assert.ok(turn.intent.confidence >= 0.8, 'une demande claire doit être classée avec confiance');
    assert.ok(turn.plan, 'une demande claire doit produire un plan');
    assert.ok(mutationSteps(turn).length >= 1);
    // Pas de question inutile : aucune clarification BLOQUANTE sur une demande claire.
    assert.ok(
      !turn.assumptions.some((a) => a.requiresConfirmation),
      'aucune hypothèse ne doit exiger une confirmation sur une demande claire'
    );
    assert.ok(turn.agentResponse.content.length > 0);
  });

  it('G2 — demande complexe multi-fichiers : un plan exécutable, une cible par étape (multi-agents É39)', async () => {
    const engine = makeEngine();
    const { turn } = await speak(engine, makeSession(), 'Crée les modules src/orders/api.ts et src/orders/ui.ts');

    assert.equal(turn.intent.category, 'CREATE');
    const steps = mutationSteps(turn);
    assert.equal(steps.length, 2, 'deux fichiers explicitement demandés = deux étapes de mutation');
    assert.deepEqual(steps[0]?.targetFiles, ['src/orders/api.ts']);
    assert.deepEqual(steps[1]?.targetFiles, ['src/orders/ui.ts']);
    // La vérification porte sur les fichiers réellement mutés.
    assert.deepEqual(
      turn.plan?.steps[turn.plan.steps.length - 1]?.targetFiles,
      ['src/orders/api.ts', 'src/orders/ui.ts']
    );
  });

  it('G3 — demande ambiguë (« Améliore le formulaire ») : aucune mutation lancée, réponse honnête', async () => {
    const engine = makeEngine();
    const { turn } = await speak(engine, makeSession(), 'Améliore le formulaire');

    assert.ok(
      !['CREATE', 'MODIFY', 'DELETE', 'DEBUG'].includes(turn.intent.category),
      `catégorie de mutation sur une demande vague : ${turn.intent.category}`
    );
    assert.ok(!turn.plan, 'aucun plan de mutation ne doit être proposé sur une demande vague');
    assert.ok(turn.agentResponse.content.length > 0);
  });

  it('G4 — multi-tours : « Modifie-le » résout l objet du tour précédent (anaphore, correction É41)', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Crée le fichier src/utils/format.ts avec des helpers de dates');
    assert.deepEqual(mutationSteps(first.turn)[0]?.targetFiles, ['src/utils/format.ts']);

    const second = await speak(engine, first.session, 'Modifie-le pour ajouter une fonction de formatage ISO');

    // La mémoire du tour précédent est préservée : la cible n est PAS perdue.
    assert.equal(second.turn.intent.category, 'MODIFY');
    assert.ok(
      second.turn.intent.entities.includes('src/utils/format.ts'),
      'la référence « -le » doit être résolue vers le fichier créé au tour précédent'
    );
    assert.deepEqual(
      mutationSteps(second.turn)[0]?.targetFiles,
      ['src/utils/format.ts'],
      'le plan de modification doit cibler le fichier du tour précédent'
    );
    // L hypothèse de référence est TRACÉE en tête, sans confirmation requise.
    assert.equal(second.turn.assumptions[0]?.id, 'assump_conversation_reference');
    assert.equal(second.turn.assumptions[0]?.requiresConfirmation, false);
    assert.equal(second.turn.assumptions[0]?.risk, 'LOW');
  });

  it('G4b — multi-tours : « une carte dans cette page » résout « cette page »', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Crée la page src/pages/contact.html avec un formulaire');
    const second = await speak(engine, first.session, 'Ajoute aussi une carte dans cette page');

    assert.ok(
      second.turn.intent.entities.includes('src/pages/contact.html'),
      'la référence « cette page » doit être résolue'
    );
    const steps = mutationSteps(second.turn);
    assert.ok(steps.length >= 1, 'un plan ciblé doit être préparé');
    assert.deepEqual(steps[0]?.targetFiles, ['src/pages/contact.html']);
  });

  it('G5 — modification d une demande précédente : plan obsolète purgé (É42), aucune mutation lancée', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Crée une page contact avec un formulaire');
    const second = await speak(engine, first.session, 'En fait je voudrais une page à propos plutôt');

    assert.equal(second.turn.intent.category, 'EXPLORATION');
    // É42 — la demande a CHANGÉ (« en fait … plutôt ») : l'ancien plan n'est
    // plus porté par ce tour, ni réutilisé, ni confirmable (aucune mutation
    // accidentelle de l'ancien plan possible).
    assert.ok(!second.turn.plan, 'un changement de demande ne doit pas porter l ancien plan');
    assert.ok(!second.session.activePlan, 'l ancien plan obsolète doit être purgé de la session');
    assert.ok(second.turn.agentResponse.content.length > 0);
  });

  it('G6 — changement de sujet : nouvelle demande autonome, pas de pollution d entités', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Ajoute un module fournisseurs avec une liste et un formulaire');
    const second = await speak(engine, first.session, 'Maintenant occupe-toi du panier : ajoute une page de checkout');

    assert.equal(second.turn.intent.category, 'CREATE');
    assert.ok(second.turn.intent.entities.includes('panier'), 'la nouvelle demande doit porter ses propres entités');
    assert.ok(
      !second.turn.intent.entities.includes('fournisseur'),
      'un changement de sujet ne doit pas hériter des entités du sujet précédent'
    );
    assert.ok(second.turn.plan, 'un nouveau plan doit être préparé');
    assert.notEqual(second.turn.plan?.planId, first.turn.plan?.planId, 'un nouveau sujet = un nouveau plan');
  });

  it('G7 — correction utilisateur (« garde la première version ») : référence tracée, aucune mutation lancée', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Crée src/utils/version.ts avec deux variantes de titre');
    const second = await speak(engine, first.session, 'Non finalement garde la première version');

    // La référence « la première version » est comprise et résolue.
    assert.ok(second.turn.intent.entities.includes('src/utils/version.ts'));
    assert.equal(second.turn.assumptions[0]?.id, 'assump_conversation_reference');
    // Aucune mutation lancée : la catégorie n est pas une action exécutable.
    assert.ok(
      !['CREATE', 'MODIFY', 'DELETE', 'DEBUG'].includes(second.turn.intent.category),
      `une correction doit d abord être comprise, pas exécutée : ${second.turn.intent.category}`
    );
  });

  it('G7b — correction SANS référent résolvable : aucun référent inventé (honnêteté)', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Crée une page de titre Bienvenue');
    const second = await speak(engine, first.session, 'Non finalement garde la première version');

    // Détection présente mais AUCUN fichier résolvable dans la session :
    // aucune hypothèse de référence ne doit être fabriquée.
    assert.ok(
      !second.turn.assumptions.some((a) => a.id === 'assump_conversation_reference'),
      'aucun référent ne doit être inventé quand la session n en contient pas'
    );
    assert.ok(
      !second.turn.intent.entities.some((entity) => entity.includes('.') || entity.includes('/')),
      'aucun chemin de fichier ne doit être inventé'
    );
  });

  it('G8 — informations contradictoires : le conflit antérieur est détecté (mémoire projet)', async () => {
    const engine = makeEngine();
    // Décision ACTIVE enregistrée dans la session (état réel d'une conversation
    // où l'utilisateur a déjà tranché — cf. épinglé F1).
    const session: ConversationSession = {
      ...makeSession(),
      activeDecisions: [
        {
          decisionId: 'dec-e41-tailwind',
          sessionId: 'sess-e41-g8',
          projectId: 'proj-e41',
          statement: 'Utiliser Tailwind CSS pour tous les styles',
          reason: 'Cohérence de l équipe',
          evidence: 'Décision enregistrée au tour précédent',
          confidence: 0.95,
          alternatives: ['Bootstrap'],
          selectedAlternative: 'Tailwind CSS',
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        }
      ]
    };
    const prepared = await engine.prepareTurn({
      session,
      userMessageText: 'Modifie l interface pour migrer vers Bootstrap',
      userRole: 'OWNER',
      requestId: 'req-e41-g8'
    });

    assert.ok(
      prepared.contradictions.length > 0,
      'la contradiction avec la décision Tailwind enregistrée doit être détectée'
    );
    assert.equal(prepared.contradictions[0]?.type, 'DECISION_CONFLICT');
    assert.equal(prepared.intent.category, 'MODIFY');
  });

  it('G9 — demande bruitée : clarification bloquante, plan incomplet signalé, aucune cible inventée', async () => {
    const engine = makeEngine();
    const prepared = await engine.prepareTurn({
      session: makeSession(),
      userMessageText: 'Crée un site fdfdfdfdf',
      userRole: 'OWNER',
      requestId: 'req-e41-g9'
    });

    assert.equal(prepared.intent.category, 'CREATE');
    const blocking = prepared.clarifications.filter((c) => c.level === 'BLOCKING');
    assert.ok(blocking.length > 0, 'une demande illisible doit déclencher une clarification BLOQUANTE');
    const steps = (prepared.plan?.steps ?? []).filter(
      (step) => step.operation === 'CREATE' || step.operation === 'MODIFY' || step.operation === 'DELETE'
    );
    if (steps.length > 0) {
      assert.ok(
        steps.every((step) => !step.targetFiles || step.targetFiles.length === 0),
        'aucune cible ne doit être inventée pour une demande illisible'
      );
      assert.equal(prepared.planAssessment?.isAcceptable, false, 'le plan incomplet doit être évalué non acceptable');
    }
  });

  it('G10 — hors périmètre (« envoie un email ») : pas de plan, pas de mutation, réponse honnête', async () => {
    const engine = makeEngine();
    const { turn } = await speak(engine, makeSession(), 'Envoie un email promotionnel à tous les clients');

    assert.ok(!turn.plan, 'aucun plan ne doit être fabriqué pour une demande hors périmètre');
    assert.ok(
      !['CREATE', 'MODIFY', 'DELETE', 'DEBUG'].includes(turn.intent.category),
      `mutation lancée sur une demande non prise en charge : ${turn.intent.category}`
    );
    assert.ok(turn.agentResponse.content.length > 0, 'la réponse doit rester explicite, pas un refus muet');
  });

  it('C2 — question de méthode (« Comment ajouter un footer ? ») : EXPLAIN, aucune mutation proposée', async () => {
    const engine = makeEngine();
    const { turn } = await speak(engine, makeSession(), 'Comment ajouter un footer à la page d accueil ?');

    assert.equal(turn.intent.category, 'EXPLAIN', 'une question de méthode n est pas une commande');
    assert.ok(!turn.plan, 'aucun plan de mutation ne doit être présenté pour une question de méthode');
    assert.ok(mutationSteps(turn).length === 0);
    assert.ok(turn.agentResponse.content.length > 0);
  });

  it('C2 — politesse + action préservée (« Peux-tu créer une page contact ? ») : CREATE', async () => {
    const engine = makeEngine();
    const { turn } = await speak(engine, makeSession(), 'Peux-tu créer une page contact ?');

    assert.equal(turn.intent.category, 'CREATE', 'une demande polie reste une demande d action');
    assert.ok(turn.plan, 'un plan doit être préparé pour une demande d action claire');
  });

  it('C2 — « Comment fonctionne… ? » reste EXPLAIN (aucune régression sur la règle existante)', async () => {
    const engine = makeEngine();
    const { turn } = await speak(engine, makeSession(), 'Comment fonctionne la facturation ?');
    assert.equal(turn.intent.category, 'EXPLAIN');
    assert.ok(!turn.plan);
  });
});

describe('É41 — résolveur de références (détection déterministe, zéro faux positif)', () => {
  it('détecte les références réelles', () => {
    assert.equal(detectConversationReference('Modifie-le pour ajouter une fonction'), true);
    assert.equal(detectConversationReference('Ajoute-les à la liste'), true);
    assert.equal(detectConversationReference('Mets-les-moi à jour'), true, 'chaîne postverbale réelle');
    assert.equal(detectConversationReference('Ajoute une carte dans cette page'), true);
    assert.equal(detectConversationReference('Reprends ce fichier'), true);
    assert.equal(detectConversationReference('Garde le même composant'), true);
    assert.equal(detectConversationReference('Reprends le même'), true);
    assert.equal(detectConversationReference('Non finalement garde la première version'), true);
    assert.equal(detectConversationReference('Update it and keep this file'), true);
  });

  it('ne détecte RIEN sur les mots composés lexicaux et la mémoire projet', () => {
    assert.equal(detectConversationReference('week-end à Paris'), false, 'week-end ne doit pas matcher');
    assert.equal(detectConversationReference('un module e-learning'), false, 'e-learning ne doit pas matcher');
    assert.equal(detectConversationReference('un titre arc-en-ciel'), false, 'arc-en-ciel ne doit pas matcher');
    assert.equal(detectConversationReference('Applique maintenant cette préférence au dashboard'), false);
    assert.equal(detectConversationReference('Je préfère les interfaces sombres'), false);
    assert.equal(detectConversationReference('Le projet s appelle Atlas'), false);
    assert.equal(detectConversationReference('Ajoute une page de contact'), false);
  });

  it('distingue singulier et pluriel', () => {
    assert.equal(isPluralReference('Ajoute-les à la liste'), true);
    assert.equal(isPluralReference('Modifie ces composants'), true);
    assert.equal(isPluralReference('Modifie ce composant'), false);
    assert.equal(isPluralReference('Modifie-le'), false);
  });

  it('résout les référents depuis l état de session (plan actif → tours → messages)', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Crée le fichier src/utils/format.ts avec des helpers de dates');
    const session = first.session;

    assert.deepEqual(
      resolveConversationReferents('Modifie-le pour ajouter une fonction', session),
      ['src/utils/format.ts'],
      'référence singulière = dernière étape de mutation du plan actif'
    );

    const multi = await speak(
      engine,
      makeSession(),
      'Crée les modules src/orders/api.ts et src/orders/ui.ts'
    );
    assert.deepEqual(
      resolveConversationReferents('Ajoute-les au panier', multi.session),
      ['src/orders/api.ts', 'src/orders/ui.ts'],
      'référence plurielle = toutes les cibles de mutation du plan actif'
    );

    assert.deepEqual(
      resolveConversationReferents('Modifie-le', makeSession()),
      [],
      'aucun référent ne doit être inventé hors d un état de session réel'
    );
  });

  it('l hypothèse de référence est documentée, LOW risk et sans confirmation', () => {
    const assumption = buildReferenceAssumption('Modifie-le pour ajouter une fonction ISO', ['src/utils/format.ts']);
    assert.equal(assumption.id, 'assump_conversation_reference');
    assert.equal(assumption.confidence, 0.8);
    assert.equal(assumption.risk, 'LOW');
    assert.equal(assumption.reversible, true);
    assert.equal(assumption.requiresConfirmation, false);
    assert.match(assumption.statement, /src\/utils\/format\.ts/);
  });
});
