/**
 * É53 LOT B — CLASSIFICATION DU REPLI (audit « mutation fallback »).
 *
 * Le pont `applyStreamFileMutation` classe désormais chaque refus :
 *   - stage 'engine' (indisponibilité TECHNIQUE, service non configuré)
 *     → `fallbackAllowed: true` — SEUL cas où l'appelant peut écrire en
 *     repli direct TRACÉ (avec validations obligatoires déjà courues et
 *     vérification post-écriture obligatoire) ;
 *   - stages 'contract' / 'plan' / 'validation' → `fallbackAllowed: false`
 *     — refus MÉTIER/SÉCURITÉ : JAMAIS contournés par fileStore.saveFile() ;
 *   - stage 'execution' → `fallbackAllowed: false` — l'écriture a été tentée
 *     puis annulée (rollback) : rejouer le contenu rejeté est interdit.
 *
 * Moteurs doubles construits autour du moteur RÉEL (même pattern que
 * lot-a-mutation-contract.test.ts) : chaque faux ne remplace qu'une étape.
 */
import './_lot-b-legacy-env.js';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStreamFileMutation,
  type StreamMutationEngine
} from '../src/routes/stream-mutation.js';
import {
  ApplicationDNAService,
  CodeIntelligenceService,
  FileStore,
  FileStoreAdapter,
  ImpactIntelligenceService,
  MutationOrchestratorService,
  SemanticCodeGraphService
} from '../../../packages/core/src/index.js';
import type {
  MutationPlan,
  PlanValidationResult
} from '../../../packages/core/src/ai-native/mutation-orchestrator/types.js';
import { buildMutationContract } from '../../../packages/core/src/ai-native/mutation-orchestrator/contract.js';

const EXISTING_HTML = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>Studio Lumière</title>
<style>body { font-family: 'Inter', sans-serif; }</style></head>
<body>
<nav><a href="#accueil">Accueil</a></nav>
<div data-section="hero"><h1>Studio Lumière</h1><p>Photographe à Lyon.</p><button>Réserver</button></div>
<div data-section="pricing"><h2>Nos tarifs</h2><p>Formules dès 290 euros.</p></div>
<div data-section="testimonials"><h2>Témoignages</h2><p>Superbe travail, merci !</p></div>
<form action="/contact"><input name="email" type="email"><button>Envoyer</button></form>
<img src="images/studio.jpg" alt="Studio">
</body>
</html>`;

const MODIFIED = EXISTING_HTML.replace('<h1>Studio Lumière</h1>', '<h1>Studio Photo Lyon</h1>');
const INPUT_BASE = {
  tenantId: 'tenant-lot-b-class',
  projectId: 'proj-lot-b-class',
  requestId: 'req-lot-b-class',
  role: 'ENGINEER' as const,
  mode: 'update' as const
};

function realEngine(store: FileStore): MutationOrchestratorService {
  const fileSource = new FileStoreAdapter(store);
  const codeIntel = new CodeIntelligenceService(fileSource);
  const dna = new ApplicationDNAService(codeIntel);
  const semanticGraph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
  const impact = new ImpactIntelligenceService(semanticGraph);
  return new MutationOrchestratorService(fileSource, codeIntel, dna, semanticGraph, impact);
}

function freshStoreWithSite(store: FileStore): void {
  // Le FileStore initialise index.html par défaut : on le remplace.
  if (store.getFile(INPUT_BASE.tenantId, INPUT_BASE.projectId, 'index.html')) {
    store.deleteNode(INPUT_BASE.tenantId, INPUT_BASE.projectId, 'index.html');
  }
  store.createNode(INPUT_BASE.tenantId, INPUT_BASE.projectId, 'index.html', 'file', EXISTING_HTML);
}

describe('É53 LOT B — classification des stages du pont /stream', () => {
  it('moteur non injecté : stage "engine", SEUL cas fallbackAllowed:true (indisponibilité technique)', () => {
    const outcome = applyStreamFileMutation(undefined, {
      ...INPUT_BASE,
      content: MODIFIED,
      existingContent: EXISTING_HTML,
      userMessage: 'Change le titre principal',
      intentCategory: 'MODIFY'
    });
    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'engine');
      assert.equal(outcome.fallbackAllowed, true, 'sans moteur, le repli direct reste possible chez l\u2019appelant');
      assert.equal(outcome.rolledBack, false);
      assert.match(outcome.reason, /non-configure|non configuré/i);
    }
  });

  it('createPlan échoue : stage "plan", fallback interdit (fail-closed, refus métier)', () => {
    const store = new FileStore();
    freshStoreWithSite(store);
    const engine: StreamMutationEngine = {
      createPlan() {
        throw new Error('graphe sémantique indisponible (test)');
      },
      validatePlan() {
        throw new Error('ne doit jamais être appelé après un échec de planification');
      },
      executePlan() {
        throw new Error('ne doit jamais être appelé après un échec de planification');
      }
    };
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: MODIFIED,
      existingContent: EXISTING_HTML,
      userMessage: 'Change le titre principal',
      intentCategory: 'MODIFY'
    });
    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'plan');
      assert.equal(outcome.fallbackAllowed, false, 'un plan non approuvé n\u2019autorise AUCUNE écriture directe');
      assert.match(outcome.reason, /graphe sémantique/);
      assert.equal(outcome.rolledBack, false);
    }
    assert.equal(store.getFile(INPUT_BASE.tenantId, INPUT_BASE.projectId, 'index.html')?.content, EXISTING_HTML);
  });

  it('validatePlan refuse : stage "validation", fallback interdit (refus métier EXPLICITE)', () => {
    const store = new FileStore();
    freshStoreWithSite(store);
    const real = realEngine(store);
    const engine: StreamMutationEngine = {
      createPlan(request, role, requestId) {
        return real.createPlan(request, role, requestId);
      },
      validatePlan(plan: MutationPlan, role, requestId): PlanValidationResult {
        return {
          planId: plan.planId,
          valid: false,
          riskLevel: plan.riskLevel,
          blockers: ['risque de régression non couvert (test)'],
          warnings: []
        };
      },
      executePlan() {
        throw new Error('ne doit jamais être appelé après un refus de validation');
      }
    };
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: MODIFIED,
      existingContent: EXISTING_HTML,
      userMessage: 'Change le titre principal',
      intentCategory: 'MODIFY'
    });
    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'validation');
      assert.equal(outcome.fallbackAllowed, false, 'un refus de validation n\u2019est JAMAIS contourné par saveFile()');
      assert.match(outcome.reason, /risque de régression/);
      assert.equal(outcome.rolledBack, false);
    }
    assert.equal(store.getFile(INPUT_BASE.tenantId, INPUT_BASE.projectId, 'index.html')?.content, EXISTING_HTML);
  });

  it('executePlan lève : stage "execution", rolledBack:true, fallback interdit', () => {
    const store = new FileStore();
    freshStoreWithSite(store);
    const real = realEngine(store);
    const engine: StreamMutationEngine = {
      createPlan(request, role, requestId) {
        return real.createPlan(request, role, requestId);
      },
      validatePlan(plan, role, requestId) {
        return real.validatePlan(plan, role, requestId);
      },
      executePlan() {
        throw new Error('snapshot restauré avant levée (test)');
      }
    };
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: MODIFIED,
      existingContent: EXISTING_HTML,
      userMessage: 'Change le titre principal',
      intentCategory: 'MODIFY'
    });
    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'execution');
      assert.equal(outcome.fallbackAllowed, false, 'le contenu rejeté par l\u2019exécution ne doit pas être rejoué en repli');
      assert.equal(outcome.rolledBack, true);
      assert.match(outcome.reason, /snapshot restauré/);
    }
  });

  it('executePlan non confirmé (success:false) : stage "execution", fallback interdit', () => {
    const store = new FileStore();
    freshStoreWithSite(store);
    const real = realEngine(store);
    const engine: StreamMutationEngine = {
      createPlan(request, role, requestId) {
        return real.createPlan(request, role, requestId);
      },
      validatePlan(plan, role, requestId) {
        return real.validatePlan(plan, role, requestId);
      },
      executePlan(plan, options, role, requestId) {
        const result = real.executePlan(plan, options, role, requestId);
        // Double : l'exécution réelle a eu lieu mais n'est PAS confirmée —
        // exactement la sémantique « non confirmée » du pont.
        return { ...result, success: false };
      }
    };
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: MODIFIED,
      existingContent: EXISTING_HTML,
      userMessage: 'Change le titre principal',
      intentCategory: 'MODIFY'
    });
    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'execution');
      assert.equal(outcome.fallbackAllowed, false);
      assert.equal(outcome.rolledBack, true);
    }
  });

  it('refus du contrat de préservation : stage "contract", fallback interdit (Lot A confirmé)', () => {
    const store = new FileStore();
    freshStoreWithSite(store);
    const engine = realEngine(store);
    // Génération destructive : le hero modifié ET la section tarifs disparaît.
    const destructive = EXISTING_HTML
      .replace('<h1>Studio Lumière</h1>', '<h1>Studio Photo Lyon</h1>')
      .replace(/<div data-section="pricing">[\s\S]*?<\/div>\n?/, '');
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: destructive,
      existingContent: EXISTING_HTML,
      userMessage: 'Change le titre principal',
      intentCategory: 'MODIFY'
    });
    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'contract');
      assert.equal(outcome.fallbackAllowed, false, 'un refus de préservation/sécurité n\u2019est jamais contourné');
      assert.ok(outcome.contractViolations && outcome.contractViolations.length > 0);
    }
    assert.equal(store.getFile(INPUT_BASE.tenantId, INPUT_BASE.projectId, 'index.html')?.content, EXISTING_HTML);
  });

  it('update sans contenu existant (préservation invérifiable) : stage "contract", fallback interdit', () => {
    const store = new FileStore();
    freshStoreWithSite(store);
    const engine = realEngine(store);
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: MODIFIED,
      // existingContent ABSENT : refus prudent fail-closed.
      userMessage: 'Change le titre principal',
      intentCategory: 'MODIFY'
    });
    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'contract');
      assert.equal(outcome.fallbackAllowed, false);
      assert.match(outcome.reason, /Préservation impossible|refus prudent/i);
    }
    assert.equal(store.getFile(INPUT_BASE.tenantId, INPUT_BASE.projectId, 'index.html')?.content, EXISTING_HTML);
  });

  it('chemin nominal (moteur réel) : applied:true — aucun champ de classification de refus', () => {
    const store = new FileStore();
    freshStoreWithSite(store);
    const engine = realEngine(store);
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: MODIFIED,
      existingContent: EXISTING_HTML,
      userMessage: 'Change le titre principal en « Studio Photo Lyon »',
      intentCategory: 'MODIFY'
    });
    assert.equal(outcome.applied, true);
    if (outcome.applied) {
      assert.equal(store.getFile(INPUT_BASE.tenantId, INPUT_BASE.projectId, 'index.html')?.content, MODIFIED);
    }
  });

  it('contrat hors périmètre fourni par l\u2019appelant : stage "contract", fallback interdit', () => {
    const store = new FileStore();
    freshStoreWithSite(store);
    const engine = realEngine(store);
    const contract = buildMutationContract({
      beforeHtml: EXISTING_HTML,
      userMessage: 'Change le titre principal',
      targetFiles: ['index.html'],
      mode: 'update'
    });
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      path: 'app/styles.css',
      content: 'body { color: red; }',
      contract
    });
    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'contract');
      assert.equal(outcome.fallbackAllowed, false);
      assert.match(outcome.reason, /hors périmètre/);
    }
    assert.equal(store.getFile(INPUT_BASE.tenantId, INPUT_BASE.projectId, 'index.html')?.content, EXISTING_HTML);
  });
});
