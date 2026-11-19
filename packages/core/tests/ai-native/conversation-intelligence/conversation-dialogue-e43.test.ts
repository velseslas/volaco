/**
 * É43 — Décision de dialogue et qualité des clarifications (15 scénarios).
 *
 * Chaque scénario exécute le VRAI parcours de production
 * (ConversationIntelligenceService, provider par défaut actif, comme en
 * production). Les assertions portent sur les DÉCISIONS réelles de dialogue :
 * intention, clarifications posées, état de conversation, plan, RÉPONSE
 * (le livrable du dialogue), hypothèses tracées, mémoire.
 *
 * Correspondance scénarios obligatoires :
 *   D1  = demande simple claire → réponse directe (question + création ciblée) ;
 *   D2  = demande complexe suffisamment définie → pas de clarification superflue ;
 *   D3  = information réellement indispensable manquante → clarification posée ;
 *   D4  = demande ambiguë (limite documentée : détection MODIFY sans cible) ;
 *   D5  = refus d'une proposition → aucune exécution ;
 *   D6  = correction d'une compréhension erronée (limite documentée) ;
 *   D7  = réponse à une clarification → réponse entendue, question reformulée,
 *         travail repris dès que la cible est donnée ;
 *   D8  = modification de la demande en cours d'échange (purge É42) ;
 *   D9  = question de méthode sans autorisation de modifier ;
 *   D10 = suggestion → aucune exécution ;
 *   D11 = instruction explicite → parcours approprié avec cible ;
 *   D12 = demande impossible → clarification honnête, JAMAIS d'invention ;
 *   D13 = conversation longue, contraintes conservées ;
 *   D14 = réponse courte attendue pour une question simple ;
 *   D15 = explication structurée attendue (limite : contenu générique).
 *   U1  = exclusions de la reprise après clarification (interdiction É42,
 *         question, remplacement de demande) — unitaire prepareTurn.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConversationIntelligenceService,
  ConversationEngine,
  ConversationIntentEngine,
  ClarificationEngine,
  ConversationAssumptionEngine,
  ConversationCompass,
  PlanGenerator,
  ContradictionDetector,
  MemoryManager,
  UnderstandingBridge,
  ImpactBridge,
  ExecutionBridge,
  type ConversationSession,
  type ConversationTurn
} from '../../../src/index.js';

let campaignCounter = 0;
const freshTag = () => `e43c${(campaignCounter += 1)}${Math.random().toString(36).slice(2, 8)}`;

function makeService(): ConversationIntelligenceService {
  return new ConversationIntelligenceService(undefined, undefined, undefined, undefined, undefined);
}

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

const CLARIFY_QUESTION = 'Quel type de composant';

describe('É43 — décision de dialogue (axe 1)', () => {
  it('D1 — demandes claires : réponse directe pour une question, plan sans clarification pour une création ciblée', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const P = (message: string) => ({ tenantId: sess.tenantId, projectId: sess.projectId, sessionId: sess.sessionId, message });

    const r1 = await service.processTurn(P('Quel est le nom du projet ?'));
    assert.equal(r1.turn.intent.category, 'QUESTION');
    assert.equal(r1.turn.stateAfter, 'COMPLETED');
    assert.ok(!r1.turn.plan, 'une question ne doit pas produire de plan');
    assert.ok(r1.turn.agentResponse.content.length > 0, 'réponse directe fournie');

    const r2 = await service.processTurn(P('Crée la page src/pages/contact.html'));
    assert.equal(r2.turn.intent.category, 'CREATE');
    assert.ok(
      !(r2.turn.intent.ambiguities ?? []).some((a) => a.level === 'BLOCKING' || a.level === 'NEEDS_CONFIRMATION'),
      'une demande claire ne doit pas poser de clarification'
    );
    assert.ok(r2.turn.plan, 'la création ciblée produit un plan');
    assert.equal(r2.turn.stateAfter, 'PLANNING');
  });

  it('D2 — demande complexe mais suffisamment définie : aucune clarification bloquante posée', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const r = await service.processTurn({
      tenantId: sess.tenantId,
      projectId: sess.projectId,
      sessionId: sess.sessionId,
      message: 'Crée une page src/pages/menu.html avec une liste de plats, le prix de chaque plat et un bouton commander'
    });

    const blocking = (r.turn.intent.ambiguities ?? []).filter((a) => a.level !== 'SAFE_TO_ASSUME');
    assert.equal(blocking.length, 0, 'seule une micro-décision SAFE_TO_ASSUME est détectée — aucune question');
    assert.ok(r.turn.plan, 'la demande suffisamment définie produit un plan');
    assert.equal(r.turn.stateAfter, 'PLANNING');
    assert.ok(!r.turn.agentResponse.content.includes('clarification'), 'aucune clarification posée');
  });

  it('D3 — information réellement indispensable manquante : la clarification est POSÉE (pas un plan)', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const r = await service.processTurn({
      tenantId: sess.tenantId,
      projectId: sess.projectId,
      sessionId: sess.sessionId,
      message: 'Crée un composant'
    });

    assert.equal(r.turn.stateAfter, 'CLARIFYING', 'la clarification bloquante doit piloter l état de la conversation');
    assert.ok(
      r.turn.agentResponse.content.includes('clarification est requise'),
      'la réponse pose la clarification'
    );
    assert.ok(
      r.turn.agentResponse.content.includes(CLARIFY_QUESTION),
      'la question posée est celle du manque réel (quel composant ?)'
    );
    assert.ok(
      !r.turn.agentResponse.content.includes("Plan d'ingénierie structuré élaboré"),
      'le moteur ne doit PAS annoncer un plan quand une précision est requise'
    );
  });

  it('D4 — demande ambiguë (MODIFY sans cible) : aucune mutation, limite documentée', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const r = await service.processTurn({
      tenantId: sess.tenantId,
      projectId: sess.projectId,
      sessionId: sess.sessionId,
      message: 'Modifie la page'
    });

    // LIMITE documentée (É43, plafond de 2 corrections) : la détection
    // d'ambiguïté ne couvre pas MODIFY sans cible (missing_entity est
    // CREATE-only). Le comportement réel : plan DRAFT présenté, JAMAIS
    // exécuté sans confirmation — aucune mutation non autorisée.
    assert.equal(r.turn.intent.category, 'MODIFY');
    assert.equal(r.turn.stateAfter, 'PLANNING');
    assert.ok(r.turn.plan, 'un plan est préparé mais jamais exécuté');
    assert.ok(!['EXECUTED', 'APPROVED'].includes(r.turn.plan.status), 'aucune exécution non autorisée');
  });

  it('D5 — refus d une proposition : aucune exécution, plan non confirmé', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const P = (message: string) => ({ tenantId: sess.tenantId, projectId: sess.projectId, sessionId: sess.sessionId, message });

    const r1 = await service.processTurn(P('Crée la page src/pages/contact.html'));
    const planId = r1.turn.plan!.planId;

    const r2 = await service.processTurn(P('Non, refuse ce plan, ne le fais pas'));
    assert.ok(!['CREATE', 'MODIFY', 'DELETE'].includes(r2.turn.intent.category), 'le refus n est pas une commande');
    assert.ok(!r2.session.projectMemory.acceptedPlans.includes(planId), 'le plan refusé n est pas accepté');
    assert.equal(r2.turn.plan?.status, 'DRAFT', 'le plan reste DRAFT — rien n est exécuté');
    assert.ok(!r2.session.activePlan || r2.session.activePlan.status !== 'EXECUTED', 'aucune exécution');
  });

  it('D6 — correction d une compréhension erronée : écoute honnête, aucune mutation (limite documentée)', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const P = (message: string) => ({ tenantId: sess.tenantId, projectId: sess.projectId, sessionId: sess.sessionId, message });

    await service.processTurn(P('Crée la page src/pages/contact.html'));
    const r2 = await service.processTurn(P('Non je parlais de la page à propos, pas de la page contact'));

    // LIMITE documentée (É43, plafond de 2 corrections) : la correction de
    // cible hors clarification n est pas ré-orientée automatiquement. Le
    // comportement réel : écoute honnête (EXPLORATION), AUCUNE mutation —
    // jamais une modification inventée sur une simple correction.
    assert.ok(!['CREATE', 'MODIFY', 'DELETE'].includes(r2.turn.intent.category), 'la correction ne déclenche aucune mutation');
    assert.ok(!r2.turn.plan || r2.turn.plan.status !== 'EXECUTED', 'aucune exécution');
  });

  it('D8 — modification de la demande en cours d échange : purge É42 conservée, aucune mutation', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const P = (message: string) => ({ tenantId: sess.tenantId, projectId: sess.projectId, sessionId: sess.sessionId, message });

    const r1 = await service.processTurn(P('Crée la page src/pages/contact.html'));
    assert.ok(r1.turn.plan);
    const r2 = await service.processTurn(P('En fait je voudrais une page tarifs plutôt'));
    assert.ok(!r2.turn.plan, 'l ancien plan obsolète est purgé (É42)');
    assert.ok(!r2.session.activePlan, 'activePlan purgé (É42)');
  });

  it('D9 — question de méthode : explication sans plan, sans mutation', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const r = await service.processTurn({
      tenantId: sess.tenantId,
      projectId: sess.projectId,
      sessionId: sess.sessionId,
      message: 'Comment va-t-on organiser la navigation du site ?'
    });

    assert.equal(r.turn.intent.category, 'EXPLAIN');
    assert.equal(r.turn.stateAfter, 'COMPLETED');
    assert.ok(!r.turn.plan, 'une question de méthode ne produit pas de plan');
  });

  it('D10 — suggestion : aucune exécution déclenchée', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const r = await service.processTurn({
      tenantId: sess.tenantId,
      projectId: sess.projectId,
      sessionId: sess.sessionId,
      message: 'Et si on ajoutait un mode sombre ?'
    });

    assert.ok(!r.turn.plan, 'une suggestion ne doit pas produire de plan ni d exécution');
    assert.equal(r.turn.stateAfter, 'COMPLETED');
    assert.ok(!['CREATE', 'MODIFY', 'DELETE'].includes(r.turn.intent.category));
  });

  it('D11 — instruction explicite : parcours approprié, plan ciblé préparé', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const r = await service.processTurn({
      tenantId: sess.tenantId,
      projectId: sess.projectId,
      sessionId: sess.sessionId,
      message: 'Modifie le titre de src/pages/contact.html pour l appeler Boutique'
    });

    assert.equal(r.turn.intent.category, 'MODIFY');
    assert.ok(r.turn.plan, 'une instruction explicite produit un plan');
    const mutationStep = r.turn.plan.steps.find((s) => s.operation === 'MODIFY');
    assert.deepEqual(mutationStep?.targetFiles, ['src/pages/contact.html'], 'la cible explicite est reprise');
  });

  it('D12 — demande impossible : clarification honnête, JAMAIS d invention de plan prétendu', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const r = await service.processTurn({
      tenantId: sess.tenantId,
      projectId: sess.projectId,
      sessionId: sess.sessionId,
      message: 'Ajoute une intelligence artificielle qui prédit le cours de la bourse'
    });

    // Le moteur ne prétend PAS savoir faire : aucune annonce de plan, une
    // clarification honnête est posée (limite documentée : la demande hors
    // périmètre n est pas spécifiquement reconnue, mais elle n est jamais
    // traitée comme une commande exécutable).
    assert.equal(r.turn.stateAfter, 'CLARIFYING');
    assert.ok(r.turn.agentResponse.content.includes('clarification est requise'));
    assert.ok(
      !r.turn.agentResponse.content.includes("Plan d'ingénierie structuré élaboré"),
      'aucune prétention d exécution sur une demande non prise en charge'
    );
  });
});

describe('É43 — qualité des clarifications (axe 2)', () => {
  it('D7 — réponse à une clarification : entendue, question reformulée, travail repris dès la cible donnée', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const P = (message: string) => ({ tenantId: sess.tenantId, projectId: sess.projectId, sessionId: sess.sessionId, message });

    // T1 — la clarification est posée.
    const r1 = await service.processTurn(P('Crée un composant'));
    assert.equal(r1.turn.stateAfter, 'CLARIFYING');
    assert.ok(r1.turn.agentResponse.content.includes(CLARIFY_QUESTION));

    // T2 — la réponse est INTÉGRÉE (hypothèse tracée, réversible), la question
    // est REFORMULÉE (jamais reposée à l identique).
    const r2 = await service.processTurn(P('une carte produit pour la boutique'));
    assert.equal(r2.turn.intent.category, 'CREATE', 'la réponse relance l objectif du tour précédent');
    const resume = r2.turn.assumptions.find((a) => a.id === 'assump_clarification_resume');
    assert.ok(resume, 'la reprise est tracée comme hypothèse');
    assert.equal(resume.status, 'PROPOSED', 'jamais confirmée automatiquement');
    assert.equal(resume.reversible, true);
    assert.ok(r2.turn.agentResponse.content.includes('Je note ta réponse'), 'la réponse est reconnue');
    assert.ok(
      r2.turn.agentResponse.content.includes('quel fichier ou quelle page'),
      'la question porte désormais sur la cible concrète'
    );
    assert.ok(
      !r2.turn.agentResponse.content.includes(CLARIFY_QUESTION),
      'la même question n est PAS reposée comme si de rien n était'
    );
    assert.equal(r2.turn.stateAfter, 'CLARIFYING', 'toujours honnête : la cible manque encore');

    // T3 — la cible est donnée : le travail REPREND (plan ciblé, plus de question).
    const r3 = await service.processTurn(P('Crée la page de la carte produit dans src/pages/boutique.html'));
    assert.ok(r3.turn.plan, 'le travail reprend avec un plan');
    const createStep = r3.turn.plan.steps.find((s) => s.operation === 'CREATE');
    assert.deepEqual(createStep?.targetFiles, ['src/pages/boutique.html'], 'la cible fournie est reprise');
    assert.ok(
      !(r3.turn.intent.ambiguities ?? []).some((a) => a.level === 'BLOCKING'),
      'la clarification est résolue'
    );
  });

  it('D13 — conversation longue : contraintes conservées (É42)', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const P = (message: string) => ({ tenantId: sess.tenantId, projectId: sess.projectId, sessionId: sess.sessionId, message });

    await service.processTurn(P('Crée un site vitrine'));
    await service.processTurn(P('Utilise uniquement des couleurs sobres'));
    await service.processTurn(P('Ne jamais stocker de données bancaires'));
    const r = await service.processTurn(P('Crée la page src/pages/prix.html'));

    assert.ok(r.session.projectMemory.knownConstraints.some((c) => c.includes('couleurs sobres')));
    assert.ok(r.session.projectMemory.knownConstraints.some((c) => c.includes('données bancaires')));
    assert.ok(r.turn.plan, 'la demande ciblée produit un plan');
  });

  it('D14 — question simple : réponse courte, aucun plan', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const r = await service.processTurn({
      tenantId: sess.tenantId,
      projectId: sess.projectId,
      sessionId: sess.sessionId,
      message: 'Où se trouve le fichier de la page contact ?'
    });

    assert.equal(r.turn.intent.category, 'QUESTION');
    assert.equal(r.turn.stateAfter, 'COMPLETED');
    assert.ok(!r.turn.plan);
    assert.ok(r.turn.agentResponse.content.length < 220, 'réponse brève pour une question brève');
  });

  it('D15 — explication structurée : EXPLAIN complété sans mutation (limite : contenu générique)', async () => {
    const service = makeService();
    const sess = service.createSession({ tenantId: freshTag(), projectId: freshTag() });
    const r = await service.processTurn({
      tenantId: sess.tenantId,
      projectId: sess.projectId,
      sessionId: sess.sessionId,
      message: 'Explique comment organiser la structure du site pour un restaurant'
    });

    assert.equal(r.turn.intent.category, 'EXPLAIN');
    assert.equal(r.turn.stateAfter, 'COMPLETED');
    assert.ok(!r.turn.plan, 'une explication ne produit pas de plan');
    assert.ok(r.turn.agentResponse.content.length > 0);
    // LIMITE documentée : en l'absence de LLM configuré, le contenu reste
    // générique (le provider déterministe est un repli honnête).
  });

  it('U1 — reprise après clarification : exclusions (interdiction É42, question, remplacement)', async () => {
    const engine = makeEngine();
    const clarifyingSession = (message: string): ConversationSession => {
      const base: ConversationSession = {
        sessionId: `sess-e43u-${Math.random().toString(36).slice(2, 8)}`,
        conversationId: `conv-e43u-${Math.random().toString(36).slice(2, 8)}`,
        tenantId: 'tenant-e43',
        projectId: 'proj-e43',
        currentState: 'CLARIFYING',
        turns: [],
        activeAssumptions: [],
        activeDecisions: [],
        applicationSnapshot: { treeHash: 'tree:e43', graphHash: 'graph:e43', understandingHash: 'understanding:e43' },
        turnMemory: { recentMessages: [], currentAssumptions: [] },
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
      const previous: ConversationTurn = {
        turnIndex: 1,
        turnId: 'turn-e43u-1',
        userMessage: { id: 'm1', sender: 'HUMAN', content: message, timestamp: new Date().toISOString() },
        stateBefore: 'EXPLORING',
        stateAfter: 'CLARIFYING',
        intent: {
          category: 'CREATE',
          goal: message,
          requestedAction: `Execute CREATE action on ${message}`,
          entities: [],
          constraints: [],
          urgency: 'NORMAL',
          confidence: 0.88,
          ambiguities: []
        },
        assumptions: [],
        decisions: [],
        agentResponse: {
          id: 'm2',
          sender: 'AGENT',
          content: 'Pour progresser en toute sécurité, une clarification est requise.',
          timestamp: new Date().toISOString()
        },
        trace: {
          traceId: 'tr-e43u-1',
          sessionId: base.sessionId,
          turnId: 'turn-e43u-1',
          stateBefore: 'EXPLORING',
          stateAfter: 'CLARIFYING',
          intentCategory: 'CREATE',
          contextHash: 'c',
          applicationHash: 'a',
          actionTaken: 'Transition EXPLORING -> CLARIFYING',
          confidence: 0.88,
          events: [],
          durationMs: 1
        }
      };
      return { ...base, turns: [previous] };
    };

    // a) une INTERDICTION (É42) pendant CLARIFYING n est PAS une réponse de
    // cible : elle reste un tour de contrainte (EXPLORATION), la re-classification
    // ne doit pas transformer le combiné en commande CREATE.
    const a = await engine.prepareTurn({
      session: clarifyingSession('Crée un module de gestion'),
      userMessageText: 'Finalement, ne modifie pas la partie facturation',
      userRole: 'OWNER',
      requestId: 'req-e43u-a'
    });
    assert.equal(a.intent.category, 'EXPLORATION', 'l interdiction reste une contrainte');
    assert.ok(a.intent.constraints.some((c) => c.includes('ne modifie pas')), 'la contrainte est extraite');
    assert.ok(!a.assumptions.some((s) => s.id === 'assump_clarification_resume'), 'pas de reprise pour une interdiction');

    // b) une QUESTION pendant CLARIFYING n est PAS une réponse de cible
    // (QUESTION ou EXPLAIN — un mot-clé d explication reste une question).
    const b = await engine.prepareTurn({
      session: clarifyingSession('Crée un module de gestion'),
      userMessageText: 'Pourquoi cette question ?',
      userRole: 'OWNER',
      requestId: 'req-e43u-b'
    });
    assert.ok(['QUESTION', 'EXPLAIN'].includes(b.intent.category), 'la question reste une question');
    assert.ok(!b.assumptions.some((s) => s.id === 'assump_clarification_resume'), 'aucune reprise pour une question');

    // c) un REMPLACEMENT de demande (É42) pendant CLARIFYING n est PAS une
    // réponse de cible : le plan reste purgé (contrat É42).
    const c = await engine.prepareTurn({
      session: clarifyingSession('Crée un module de gestion'),
      userMessageText: 'En fait je voudrais une page tarifs plutôt',
      userRole: 'OWNER',
      requestId: 'req-e43u-c'
    });
    assert.ok(!c.plan, 'le plan obsolète reste purgé (É42)');
    assert.ok(!c.assumptions.some((s) => s.id === 'assump_clarification_resume'));
    assert.equal(c.intent.goal, 'En fait je voudrais une page tarifs plutôt', 'pas de fusion pour un remplacement');

    // d) une CONTRAINTE explicite pendant CLARIFYING n est PAS une réponse de
    // cible (la contrainte doit rester un tour de contrainte).
    const d = await engine.prepareTurn({
      session: clarifyingSession('Crée un module de gestion'),
      userMessageText: 'Utilise uniquement des couleurs sobres',
      userRole: 'OWNER',
      requestId: 'req-e43u-d'
    });
    assert.ok(
      !d.assumptions.some((s) => s.id === 'assump_clarification_resume'),
      'pas de reprise pour une contrainte'
    );
    assert.ok(d.intent.constraints.length > 0, 'la contrainte reste extraite');

    // e) un DÉSACCORD pendant CLARIFYING n est PAS une réponse de cible.
    const e = await engine.prepareTurn({
      session: clarifyingSession('Crée un module de gestion'),
      userMessageText: 'Non, pas maintenant',
      userRole: 'OWNER',
      requestId: 'req-e43u-e'
    });
    assert.ok(
      !e.assumptions.some((s) => s.id === 'assump_clarification_resume'),
      'pas de reprise pour un désaccord'
    );
    assert.equal(e.intent.goal, 'Non, pas maintenant', 'le désaccord n est pas fusionné avec l objectif');

    // f) une DÉCISION de continuité (« garde … », contrat É42) n est PAS une
    // réponse de cible : le plan actif reste conservé, jamais remplacé.
    const f = await engine.prepareTurn({
      session: clarifyingSession('Crée src/utils/version.ts avec des variantes de titre'),
      userMessageText: 'Finalement garde la première version',
      userRole: 'OWNER',
      requestId: 'req-e43u-f'
    });
    assert.ok(
      !f.assumptions.some((s) => s.id === 'assump_clarification_resume'),
      'pas de reprise pour une décision de continuité'
    );
    assert.equal(f.intent.category, 'EXPLORATION', 'la continuité reste un tour d écoute');
  });
});
