/**
 * É42 — Continuité et mémoire conversationnelle RÉELLES (12 scénarios).
 *
 * Chaque scénario exécute le VRAI parcours de production (ConversationEngine
 * ou ConversationIntelligenceService, chemin déterministe sans LLM). Les
 * assertions portent sur les DÉCISIONS réelles : intention, plan actif et son
 * état, mémoire projet (contraintes, décisions, hypothèses), mémoire de tour,
 * isolation des contextes.
 *
 * Correspondance scénarios obligatoires :
 *   E1 = conversation de 3 tours sur un même objectif (cas essentiel de la
 *        mission, avec la contrainte finale « ne modifie pas … ») ;
 *   E2 = conversation longue avec plusieurs contraintes + priorité récentes ;
 *   E3 = modification successive d'une demande ;
 *   E4 = annulation d'une décision précédente ;
 *   E5 = changement complet de sujet ;
 *   E6 = retour à un sujet précédent ;
 *   E7 = référence à une décision ancienne ;
 *   E8 = contradiction entre ancienne et nouvelle instruction ;
 *   E9 = plan devenu obsolète après modification de la demande (réutilisation
 *        accidentelle interdite) ;
 *   E10 = deux sessions indépendantes (zéro fuite, y compris le résolveur É41) ;
 *   E11 = deux projets distincts (mémoire cloisonnée) ;
 *   E12 = hypothèse non confirmée qui ne devient JAMAIS une décision.
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
  ConversationIntelligenceService,
  ExecutionBridge,
  ImpactBridge,
  MemoryManager,
  PlanGenerator,
  UnderstandingBridge,
  type ConversationSession,
  type ConversationTurn
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
    sessionId: `sess-e42-${sessionCounter}`,
    conversationId: `conv-e42-${sessionCounter}`,
    tenantId: 'tenant-e42',
    projectId: 'proj-e42',
    currentState: 'EXPLORING',
    turns: [],
    activeAssumptions: [],
    activeDecisions: [],
    applicationSnapshot: {
      treeHash: 'tree:e42',
      graphHash: 'graph:e42',
      understandingHash: 'understanding:e42'
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
    requestId: `req-e42-${session.turns.length + 1}`
  });
  return { session: result.updatedSession, turn: result.turn };
}

let campaignCounter = 0;
const freshTag = () => `e42c${(campaignCounter += 1)}${Math.random().toString(36).slice(2, 8)}`;

function makeService(): ConversationIntelligenceService {
  return new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
}

const TAILWIND_DECISION = {
  decisionId: 'dec-e42-tailwind',
  sessionId: 'sess-e42-decision',
  projectId: 'proj-e42',
  statement: 'Utiliser Tailwind CSS pour tous les styles',
  reason: 'Cohérence de l équipe',
  evidence: 'Décision validée au cours d un tour précédent',
  confidence: 0.95,
  alternatives: ['Bootstrap'],
  selectedAlternative: 'Tailwind CSS',
  status: 'ACTIVE' as const,
  createdAt: new Date().toISOString()
};

describe('É42 — continuité et état de conversation (axe 1)', () => {
  it('E1 — cas essentiel : objectif conservé, complément intégré, interdiction respectée SANS mutation', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Crée une application de gestion commerciale');
    const second = await speak(engine, first.session, 'Ajoute la gestion des stocks');
    const third = await speak(engine, second.session, 'Finalement, ne modifie pas la partie facturation');

    // T1/T2 : l'objectif initial et la demande complémentaire produisent bien
    // des plans distincts (la continuité n écrase pas l'historique).
    assert.equal(first.turn.intent.category, 'CREATE');
    assert.equal(second.turn.intent.category, 'CREATE');
    assert.notEqual(second.turn.plan?.planId, first.turn.plan?.planId);

    // T3 : l'INTERDICTION n'est pas une commande de modification (É42).
    assert.equal(
      third.turn.intent.category,
      'EXPLORATION',
      '« ne modifie pas » est une contrainte, pas une commande MODIFY'
    );
    // Aucun NOUVEAU plan de mutation pour l'interdiction : s'il existe, c'est
    // le plan actif de la conversation (continuité), jamais un plan de
    // mutation porté par l'objectif « ne modifie pas » (comportement AVANT :
    // un plan MODIFY 0.89 était CRÉÉ pour l'interdiction elle-même).
    assert.ok(
      !third.turn.plan || third.turn.plan.planId === second.turn.plan?.planId,
      'l interdiction ne doit pas générer de plan de mutation nouveau'
    );
    assert.ok(
      third.turn.intent.constraints.some((c) => c.includes('ne modifie pas')),
      'la contrainte explicite doit être extraite'
    );
    assert.ok(
      third.session.projectMemory.knownConstraints.some((c) => c.includes('ne modifie pas')),
      'la contrainte doit être conservée en mémoire projet'
    );

    // Sans repartir de zéro : l'objectif initial ET la complémentaire restent
    // en mémoire de tour.
    const memory = third.session.turnMemory.recentMessages.map((m) => m.content).join(' | ');
    assert.ok(memory.includes('gestion commerciale'), 'l objectif initial doit rester en mémoire');
    assert.ok(memory.includes('gestion des stocks'), 'la demande complémentaire doit rester en mémoire');
  });

  it('E2 — conversation longue : contraintes multiples conservées, priorité aux messages récents', async () => {
    const engine = makeEngine();
    let state = await speak(engine, makeSession(), 'Crée un site vitrine');
    state = await speak(engine, state.session, 'Utilise uniquement des couleurs sobres');
    state = await speak(engine, state.session, 'Ne jamais stocker de données bancaires');
    state = await speak(engine, state.session, 'Crée la page src/pages/prix.html');
    state = await speak(engine, state.session, 'Quel est le nom du projet ?');
    state = await speak(engine, state.session, 'Crée la page src/pages/mentions.html');

    const constraints = state.session.projectMemory.knownConstraints;
    assert.ok(constraints.some((c) => c.includes('couleurs sobres')), 'contrainte 1 conservée');
    assert.ok(constraints.some((c) => c.includes('données bancaires')), 'contrainte 2 conservée');

    // Fenêtre de tour bornée (cap 10 messages) : les PLUS ANCIENS sortent
    // d'abord, la priorité reste aux informations récentes.
    const recent = state.session.turnMemory.recentMessages;
    assert.ok(recent.length <= 10, 'la fenêtre de tour doit rester bornée');
    assert.equal(recent[0]?.content, 'Utilise uniquement des couleurs sobres', 'le message le plus ancien (T1) sort d abord');
    assert.ok(
      recent.some((m) => m.content.includes('mentions.html')),
      'le message le plus récent est conservé dans la fenêtre'
    );
  });

  it('E3 — modifications successives : chaque demande produit un plan distinct, aucune confusion', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Crée la page src/pages/contact.html avec un titre');
    const second = await speak(engine, first.session, 'Modifie-la pour ajouter un formulaire');
    const third = await speak(engine, second.session, 'Modifie-la encore pour ajouter un bouton envoyer');

    assert.equal(second.turn.intent.category, 'MODIFY');
    assert.equal(third.turn.intent.category, 'MODIFY');
    // Chaque modification génère un plan NOUVEAU (l'ancien n'est pas confondu
    // avec le nouveau) — les cibles restent le même fichier explicite.
    assert.ok(second.turn.plan && third.turn.plan);
    assert.notEqual(second.turn.plan.planId, first.turn.plan?.planId);
    assert.notEqual(third.turn.plan.planId, second.turn.plan.planId);
    assert.deepEqual(third.turn.plan.steps[1]?.targetFiles, ['src/pages/contact.html']);
    // La mémoire de tour pointe toujours vers le plan le plus récent.
    assert.equal(third.session.turnMemory.currentPlan?.planId, third.turn.plan.planId);
  });

  it('E4 — annulation d une décision : demande comprise sans mutation, décision intacte (limite documentée)', async () => {
    const engine = makeEngine();
    const seeded: ConversationSession = { ...makeSession(), activeDecisions: [TAILWIND_DECISION] };
    const { turn, session } = await speak(engine, seeded, 'Finalement annule la décision d utiliser Tailwind');

    // Aucune mutation lancée : l'annulation n'est pas exécutée comme une action.
    assert.ok(!['CREATE', 'MODIFY', 'DELETE', 'DEBUG'].includes(turn.intent.category));
    assert.ok(!turn.plan, 'aucun plan de mutation pour une demande d annulation');
    // LIMITE documentée (É42) : l'annulation n'est PAS appliquée à la décision
    // enregistrée — aucune promotion/retrait silencieux, l'état reste lisible.
    assert.equal(session.activeDecisions[0]?.status, 'ACTIVE');
  });

  it('E5 — changement complet de sujet : ancien plan non exécuté, continuité gardée en mémoire', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Crée la page src/pages/garage.html');
    const second = await speak(engine, first.session, 'Ouvre le tableau de bord des statistiques');

    assert.equal(second.turn.intent.category, 'NAVIGATION');
    // Le plan du sujet précédent reste à l'état DRAFT : il n'est PAS exécuté
    // automatiquement (aucune mutation sur un simple changement de sujet).
    assert.equal(second.turn.plan?.status, 'DRAFT');
    assert.equal(second.session.turnMemory.currentPlan?.planId, first.turn.plan?.planId);
  });

  it('E6 — retour au sujet précédent : la référence « modifie-la » résout la cible connue', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Crée la page src/pages/contact.html');
    const second = await speak(engine, first.session, 'Explique la structure du projet');
    const third = await speak(engine, second.session, 'Revenons à la page contact : modifie-la pour ajouter un horaire');

    assert.equal(third.turn.intent.category, 'MODIFY');
    assert.ok(
      third.turn.intent.entities.includes('src/pages/contact.html'),
      'le retour au sujet doit résoudre la cible du tour initial'
    );
    assert.deepEqual(third.turn.plan?.steps[1]?.targetFiles, ['src/pages/contact.html']);
    assert.equal(third.turn.assumptions[0]?.id, 'assump_conversation_reference');
  });

  it('E7 — référence à une décision ancienne : cohérence, aucune contradiction inventée', async () => {
    const engine = makeEngine();
    const seeded: ConversationSession = { ...makeSession(), activeDecisions: [TAILWIND_DECISION] };
    const prepared = await engine.prepareTurn({
      session: seeded,
      userMessageText: 'Comme décidé, crée la page src/pages/style-guide.html avec Tailwind',
      userRole: 'OWNER',
      requestId: 'req-e42-e7'
    });

    assert.equal(prepared.intent.category, 'CREATE');
    assert.equal(prepared.contradictions.length, 0, 'citer une décision ne doit pas créer un conflit');
    assert.deepEqual(prepared.plan?.steps[1]?.targetFiles, ['src/pages/style-guide.html']);
  });

  it('E8 — contradiction entre ancienne et nouvelle instruction : conflit détecté et visible', async () => {
    const engine = makeEngine();
    const seeded: ConversationSession = { ...makeSession(), activeDecisions: [TAILWIND_DECISION] };
    const prepared = await engine.prepareTurn({
      session: seeded,
      userMessageText: 'Modifie l interface pour migrer vers Bootstrap',
      userRole: 'OWNER',
      requestId: 'req-e42-e8'
    });

    assert.equal(prepared.intent.category, 'MODIFY');
    assert.ok(prepared.contradictions.length > 0, 'la contradiction avec la décision active doit être détectée');
    assert.equal(prepared.contradictions[0]?.type, 'DECISION_CONFLICT');
  });
});

describe('É42 — mémoire, récupération et isolation (axe 2)', () => {
  it('E9 — plan obsolète : après changement de demande, l ancien plan n est plus confirmable (réutilisation accidentelle interdite)', async () => {
    const service = makeService();
    const tenant = freshTag();
    const project = freshTag();
    const sess = service.createSession({ tenantId: tenant, projectId: project });
    const P = (message: string) => ({ tenantId: tenant, projectId: project, sessionId: sess.sessionId, message });

    const r1 = await service.processTurn(P('Crée la page src/pages/contact.html avec un formulaire'));
    const oldPlanId = r1.turn.plan!.planId;

    const r2 = await service.processTurn(P('En fait je voudrais une page à propos plutôt'));
    assert.ok(!r2.turn.plan, 'le tour de changement de demande ne porte plus l ancien plan');
    assert.ok(!r2.session.activePlan, 'le plan obsolète doit être purgé de la session');

    // La réutilisation accidentelle est REFUSÉE explicitement.
    await assert.rejects(
      () => service.confirmPlan({ tenantId: tenant, projectId: project, sessionId: sess.sessionId, planId: oldPlanId, approved: true }),
      /introuvable ou non actif/,
      'confirmer un plan obsolète après un changement de demande doit échouer'
    );
  });

  it('E10 — isolation de deux sessions : zéro fuite de tours, de plan ou de références É41', async () => {
    const engine = makeEngine();
    const sessionA = makeSession();
    const sessionB = makeSession();

    const a = await speak(engine, sessionA, 'Crée le fichier src/a-specifique-a.ts');
    const b1 = await speak(engine, sessionB, 'Ajoute une page d accueil');
    const b2 = await speak(engine, b1.session, 'Modifie-le pour corriger le titre');

    // Les tours de B ne contiennent RIEN de A.
    assert.equal(b2.session.turns.length, 2, 'la session B ne doit pas hériter des tours de A');
    assert.ok(
      !b2.session.turns.some((t) => t.userMessage.content.includes('a-specifique-a')),
      'le message de A ne doit pas apparaître dans B'
    );
    // Le résolveur É41 ne traverse PAS les sessions : « Modifie-le » en B ne
    // résout JAMAIS vers le fichier créé en A.
    assert.ok(
      !b2.turn.intent.entities.some((e) => e.includes('a-specifique-a')),
      'une référence de B ne doit pas résoudre une cible de A'
    );
    assert.ok(
      !(b2.turn.plan?.steps ?? []).some((s) => (s.targetFiles ?? []).some((f) => f.includes('a-specifique-a'))),
      'aucun plan de B ne doit cibler un fichier de A'
    );
    // La session A n'a pas bougé.
    assert.equal(a.session.turns.length, 1);
  });

  it('E11 — isolation de deux projets : la mémoire projet est cloisonnée par tenant:projet', async () => {
    const service = makeService();
    const tenant = freshTag();
    const project1 = freshTag();
    const project2 = freshTag();

    const sess1 = service.createSession({ tenantId: tenant, projectId: project1 });
    service.createSession({ tenantId: tenant, projectId: project2 });
    await service.processTurn({ tenantId: tenant, projectId: project1, sessionId: sess1.sessionId, message: 'Décision : utiliser Bootstrap pour le projet 1' });
    service.recordDecision({ tenantId: tenant, projectId: project1, sessionId: sess1.sessionId, statement: 'Utiliser Bootstrap pour le projet 1', reason: 'Projet 1' });

    const memP1 = service.getLatestProjectMemory(tenant, project1);
    const memP2 = service.getLatestProjectMemory(tenant, project2);

    assert.ok(
      (memP1?.architecturalDecisions ?? []).some((d) => d.status === 'ACTIVE'),
      'la mémoire du projet 1 contient sa décision'
    );
    assert.ok(
      (memP2?.architecturalDecisions ?? []).length === 0,
      'la mémoire du projet 2 ne doit contenir AUCUNE décision du projet 1'
    );
    // Une NOUVELLE session du projet 2 ne récupère pas la mémoire du projet 1.
    const freshInP2 = service.createSession({ tenantId: tenant, projectId: project2 });
    assert.ok(
      (freshInP2.projectMemory.architecturalDecisions ?? []).length === 0,
      'aucune mémoire d un autre projet ne doit fuiter dans une nouvelle session'
    );
  });

  it('E12 — hypothèse ≠ décision : jamais de promotion automatique, verdict explicite uniquement', async () => {
    const engine = makeEngine();
    const first = await speak(engine, makeSession(), 'Ajoute un nouvel espace pour gérer les fournisseurs');

    // L'hypothèse est PROPOSÉE, jamais confirmée automatiquement.
    const assumption = first.turn.assumptions.find((a) => a.id === 'assump_supplier_crud');
    assert.ok(assumption, 'l hypothèse métier doit être proposée');
    assert.equal(assumption.status, 'PROPOSED');
    assert.equal(assumption.requiresConfirmation, false);

    const second = await speak(engine, first.session, 'Ajoute la liste des factures aussi');
    const after = second.session;
    assert.equal(after.projectMemory.architecturalDecisions.length, 0, 'aucune décision ne doit être créée automatiquement');
    assert.equal(after.projectMemory.knownConventions.length, 0, 'aucune convention ne doit être créée automatiquement');
    assert.ok(
      !after.projectMemory.acceptedPlans.length && !after.projectMemory.rejectedPlans.length,
      'aucun plan accepté/rejeté sans confirmation explicite'
    );

    // Le SEUL chemin de promotion est le verdict EXPLICITE de l opérateur.
    const service = makeService();
    const tenant = freshTag();
    const project = freshTag();
    const sess = service.createSession({ tenantId: tenant, projectId: project });
    const updated = service.recordAssumptionVerdicts({
      tenantId: tenant,
      projectId: project,
      sessionId: sess.sessionId,
      verdicts: [{ id: 'assump_supplier_crud', statement: 'Le module fournisseurs nécessite les opérations CRUD de base.', verdict: 'CONFIRMED' }]
    });
    assert.equal(
      updated?.activeAssumptions.find((a) => a.id === 'assump_supplier_crud')?.status,
      'CONFIRMED',
      'la promotion n existe QUE via un verdict explicite'
    );
  });

  it('E13 — interdiction : formes multiples reconnues, verbe hors négation préservé (unitaire)', async () => {
    const engine = makeEngine();

    // « ne pas + verbe »
    const a = await speak(engine, makeSession(), 'Ne pas supprimer le fichier auth.service.ts');
    assert.equal(a.turn.intent.category, 'EXPLORATION', '« ne pas supprimer » est une contrainte');
    assert.ok(!a.turn.plan);
    assert.ok(a.turn.intent.constraints.some((c) => c.includes('Ne pas supprimer')));

    // « n' + verbe + pas » (élision)
    const b = await speak(engine, makeSession(), 'N\'utilise pas le cache pour la page de paiement');
    assert.equal(b.turn.intent.category, 'EXPLORATION', '« N utilise pas » est une contrainte');
    assert.ok(!b.turn.plan);

    // Message MIXTE : le verbe hors négation empêche la silenciation du tour
    // (l'interdiction n'éteint PAS toute action) — classification préexistante
    // à poids le plus élevé, plan présent, et l'interdiction reste tracée.
    const c = await speak(engine, makeSession(), 'Ne modifie pas la facturation mais crée une page stocks');
    assert.ok(
      ['CREATE', 'MODIFY'].includes(c.turn.intent.category),
      'un verbe hors clause négative garde une classification d action'
    );
    assert.ok(c.turn.plan, 'la partie action reste exécutable');
    assert.ok(
      c.turn.intent.constraints.some((con) => con.includes('Ne modifie pas')),
      'l interdiction du message mixte reste extraite comme contrainte'
    );

    // « Finalement garde la première version » : continuité conservée (pas un
    // abandon de demande — l ancien plan reste actif pour la référence É41).
    const engine2 = makeEngine();
    const first = await speak(engine2, makeSession(), 'Crée src/utils/version.ts avec deux variantes');
    const second = await speak(engine2, first.session, 'Finalement garde la première version');
    assert.equal(second.session.activePlan?.planId, first.turn.plan?.planId, 'une continuité (« garde ») ne purge PAS le plan actif');
  });
});
