/**
 * LOT A (É53) — pont `/stream` × MUTATION CONTRACT.
 *
 * Preuves demandées par la mission, au niveau du chemin de production :
 *   - refus de préservation AVANT tout plan/écriture (stage 'contract'),
 *     fichier existant intact au caractère près ;
 *   - modification ciblée acceptée et réellement persistée ;
 *   - suppression explicitement autorisée acceptée ;
 *   - fichier hors périmètre refusé (contrat fourni) ;
 *   - contrat périmé refusé ;
 *   - reconstruction complète explicitement demandée acceptée ;
 *   - compatibilité du shape des options du pont (aucun repli caché).
 */

import './_lot-b-legacy-env.js';

import { describe, it, afterEach } from 'node:test';
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
import type { MutationContract } from '../../../packages/core/src/ai-native/mutation-orchestrator/types.js';
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

const INPUT_BASE = {
  tenantId: 'tenant-lot-a-bridge',
  projectId: 'proj-lot-a-bridge',
  requestId: 'req-lot-a-bridge',
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

function recordingEngine(store: FileStore): StreamMutationEngine & { calls: string[] } {
  const real = realEngine(store);
  const calls: string[] = [];
  const engine: StreamMutationEngine = {
    createPlan(request, role, requestId) {
      calls.push('createPlan');
      return real.createPlan(request, role, requestId);
    },
    validatePlan(plan, role, requestId) {
      calls.push('validatePlan');
      return real.validatePlan(plan, role, requestId);
    },
    executePlan(plan, options, role, requestId) {
      calls.push('executePlan');
      return real.executePlan(plan, options, role, requestId);
    }
  };
  return Object.assign(engine, { calls });
}

// ===========================================================================
describe('LOT A — pont /stream : refus de préservation avant toute écriture', () => {
  afterEach(() => { /* aucune configuration globale modifiée ici */ });

  it('suppression non autorisée d’une section : stage "contract", AUCUNE écriture, contenu intact', () => {
    const store = new FileStore();
    const tenantId = INPUT_BASE.tenantId;
    const projectId = INPUT_BASE.projectId;
    // Le FileStore initialise index.html par défaut : on le remplace.
    if (store.getFile(tenantId, projectId, 'index.html')) {
      store.deleteNode(tenantId, projectId, 'index.html');
    }
    store.createNode(tenantId, projectId, 'index.html', 'file', EXISTING_HTML);
    const engine = recordingEngine(store);

    // Génération « destructive » : le hero modifié ET la section tarifs disparaît.
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
      assert.equal(outcome.rolledBack, false, 'aucune écriture tentée : pas de rollback');
      assert.match(outcome.reason, /tarifs|pricing|section/i);
      assert.ok(outcome.contractViolations && outcome.contractViolations.length > 0);
    }
    assert.deepEqual(engine.calls, [], 'aucun plan créé : refus AVANT le moteur');
    assert.equal(
      store.getFile(tenantId, projectId, 'index.html')?.content,
      EXISTING_HTML,
      'le fichier existant est intact au caractère près'
    );
  });

  it('1+2. modification ciblée du titre : ACCEPTÉE, persistée, le reste intact', () => {
    const store = new FileStore();
    const tenantId = INPUT_BASE.tenantId;
    const projectId = INPUT_BASE.projectId;
    // Le FileStore initialise index.html par défaut : on le remplace.
    if (store.getFile(tenantId, projectId, 'index.html')) {
      store.deleteNode(tenantId, projectId, 'index.html');
    }
    store.createNode(tenantId, projectId, 'index.html', 'file', EXISTING_HTML);
    const engine = recordingEngine(store);

    const modified = EXISTING_HTML.replace('<h1>Studio Lumière</h1>', '<h1>Studio Photo Lyon</h1>');
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: modified,
      existingContent: EXISTING_HTML,
      userMessage: 'Change le titre principal en « Studio Photo Lyon »',
      intentCategory: 'MODIFY'
    });

    assert.equal(outcome.applied, true);
    assert.deepEqual(engine.calls, ['createPlan', 'validatePlan', 'executePlan']);
    assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, modified);
    // Préservations vérifiables dans le contenu persisté :
    const persisted = store.getFile(tenantId, projectId, 'index.html')?.content ?? '';
    assert.ok(persisted.includes('data-section="pricing"'), 'tarifs préservés');
    assert.ok(persisted.includes('data-section="testimonials"'), 'témoignages préservés');
    assert.ok(persisted.includes('<form'), 'formulaire préservé');
    assert.ok(persisted.includes('images/studio.jpg'), 'image préservée');
    assert.ok(persisted.includes('Réserver'), 'bouton préservé');
    assert.ok(persisted.includes('font-family'), 'police préservée');
    assert.ok(persisted.includes('<nav'), 'navigation préservée');
  });

  it('4. suppression explicitement demandée : ACCEPTÉE, seul le formulaire disparaît', () => {
    const store = new FileStore();
    const tenantId = INPUT_BASE.tenantId;
    const projectId = INPUT_BASE.projectId;
    // Le FileStore initialise index.html par défaut : on le remplace.
    if (store.getFile(tenantId, projectId, 'index.html')) {
      store.deleteNode(tenantId, projectId, 'index.html');
    }
    store.createNode(tenantId, projectId, 'index.html', 'file', EXISTING_HTML);
    const engine = recordingEngine(store);

    const modified = EXISTING_HTML.replace(/<form[\s\S]*?<\/form>\n?/, '');
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: modified,
      existingContent: EXISTING_HTML,
      userMessage: 'Supprime le formulaire de contact',
      intentCategory: 'DELETE'
    });

    assert.equal(outcome.applied, true, outcome.applied ? '' : JSON.stringify(outcome));
    const persisted = store.getFile(tenantId, projectId, 'index.html')?.content ?? '';
    assert.ok(!persisted.includes('<form'), 'formulaire supprimé (autorisation explicite)');
    assert.ok(persisted.includes('data-section="pricing"'), 'tarifs conservés');
    assert.ok(persisted.includes('data-section="testimonials"'), 'témoignages conservés');
    assert.ok(persisted.includes('images/studio.jpg'), 'image conservée');
    assert.ok(persisted.includes('Réserver'), 'bouton conservé');
  });

  it('5. mutation d’un fichier hors périmètre : REFUSÉE par le moteur (contrat transmis)', () => {
    const store = new FileStore();
    const tenantId = INPUT_BASE.tenantId;
    const projectId = INPUT_BASE.projectId;
    // Le FileStore initialise index.html par défaut : on le remplace.
    if (store.getFile(tenantId, projectId, 'index.html')) {
      store.deleteNode(tenantId, projectId, 'index.html');
    }
    store.createNode(tenantId, projectId, 'index.html', 'file', EXISTING_HTML);
    const engine = realEngine(store);

    const contract: MutationContract = buildMutationContract({
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
      assert.match(outcome.reason, /hors périmètre|périmètre/i);
    }
    assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, EXISTING_HTML);
  });

  it('7. contrat périmé (contenu changé entre-temps) : REFUSÉE avant écriture', () => {
    const store = new FileStore();
    const tenantId = INPUT_BASE.tenantId;
    const projectId = INPUT_BASE.projectId;
    // Le FileStore initialise index.html par défaut : on le remplace.
    if (store.getFile(tenantId, projectId, 'index.html')) {
      store.deleteNode(tenantId, projectId, 'index.html');
    }
    store.createNode(tenantId, projectId, 'index.html', 'file', EXISTING_HTML);
    const engine = realEngine(store);

    const contract: MutationContract = buildMutationContract({
      beforeHtml: EXISTING_HTML,
      userMessage: 'Change le titre principal',
      targetFiles: ['index.html'],
      mode: 'update'
    });
    // Le contenu existant change APRÈS la construction du contrat :
    // (simulation d'une modification externe réellement persistée)
    const drifted = EXISTING_HTML.replace('2010', '2015').replace('Photographe', 'Photographe senior');
    new FileStoreAdapter(store).updateFile(tenantId, projectId, 'index.html', drifted);
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: EXISTING_HTML.replace('<h1>Studio Lumière</h1>', '<h1>Studio Photo Lyon</h1>'),
      existingContent: drifted,
      userMessage: 'Change le titre principal',
      intentCategory: 'MODIFY',
      contract
    });
    assert.equal(outcome.applied, false);
    if (!outcome.applied) {
      assert.match(outcome.reason, /changé depuis la construction du contrat|périmé/i);
    }
    assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, drifted, 'le contenu réel (drifté) est intact');
  });

  it('reconstruction complète explicitement demandée : ACCEPTÉE et persistée', () => {
    const store = new FileStore();
    const tenantId = INPUT_BASE.tenantId;
    const projectId = INPUT_BASE.projectId;
    // Le FileStore initialise index.html par défaut : on le remplace.
    if (store.getFile(tenantId, projectId, 'index.html')) {
      store.deleteNode(tenantId, projectId, 'index.html');
    }
    store.createNode(tenantId, projectId, 'index.html', 'file', EXISTING_HTML);
    const engine = recordingEngine(store);

    const rebuilt = '<!DOCTYPE html><html lang="fr"><head><title>Nouveau site</title></head><body><div data-section="hero"><h1>Nouveau site</h1></div></body></html>';
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: rebuilt,
      existingContent: EXISTING_HTML,
      userMessage: 'Reconstruis tout le site à partir de zéro',
      intentCategory: 'CREATE'
    });
    assert.equal(outcome.applied, true, outcome.applied ? '' : JSON.stringify(outcome));
    assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, rebuilt);
  });

  // =========================================================================
  // LOT A-C1 (validation corrective) — le pont refuse « Remplace tout le
  // contenu de la page par juste un grand titre Bienvenue » avant le
  // correctif (PROTECTED_CONTENT_LOST) : la formulation doit être acceptée
  // comme full-rebuild, et « remplace … par … » ciblé ne doit PAS ouvrir
  // implicitement une reconstruction.
  // =========================================================================

  it('C1. remplacement total explicite (« …par juste un grand titre ») : ACCEPTÉ et persisté', () => {
    const store = new FileStore();
    const tenantId = INPUT_BASE.tenantId;
    const projectId = INPUT_BASE.projectId;
    // Le FileStore initialise index.html par défaut : on le remplace.
    if (store.getFile(tenantId, projectId, 'index.html')) {
      store.deleteNode(tenantId, projectId, 'index.html');
    }
    store.createNode(tenantId, projectId, 'index.html', 'file', EXISTING_HTML);
    const engine = recordingEngine(store);

    const rebuilt = '<!DOCTYPE html><html lang="fr"><head><title>Studio Photo Lyon</title></head><body><div data-section="hero"><h1>Bienvenue</h1></div></body></html>';
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: rebuilt,
      existingContent: EXISTING_HTML,
      userMessage: 'Remplace tout le contenu de la page par juste un grand titre Bienvenue',
      intentCategory: 'MODIFY'
    });
    assert.equal(outcome.applied, true, outcome.applied ? '' : JSON.stringify(outcome));
    assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, rebuilt);
  });

  it('C1. « remplace … par … » ciblé : PAS de reconstruction implicite, le reste protégé', () => {
    const store = new FileStore();
    const tenantId = INPUT_BASE.tenantId;
    const projectId = INPUT_BASE.projectId;
    // Le FileStore initialise index.html par défaut : on le remplace.
    if (store.getFile(tenantId, projectId, 'index.html')) {
      store.deleteNode(tenantId, projectId, 'index.html');
    }
    store.createNode(tenantId, projectId, 'index.html', 'file', EXISTING_HTML);
    const engine = recordingEngine(store);

    // La demande cible le bouton : le titre ET la section tarifs doivent
    // rester protégés (aucune autorisation implicite de reconstruction).
    const destructive = EXISTING_HTML
      .replace('<h1>Studio Lumière</h1>', '<h1>Studio Photo Lyon</h1>')
      .replace(/<div data-section="pricing">[\s\S]*?<\/div>\n?/, '');
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      content: destructive,
      existingContent: EXISTING_HTML,
      userMessage: 'Remplace le bouton Réserver par « Prendre rendez-vous »',
      intentCategory: 'MODIFY'
    });
    assert.equal(outcome.applied, false, 'le remplacement ciblé n’autorise pas la destruction du reste');
    if (!outcome.applied) {
      assert.equal(outcome.stage, 'contract');
      assert.match(outcome.reason, /tarifs|pricing|section|titre/i);
      assert.ok(outcome.contractViolations && outcome.contractViolations.length > 0);
    }
    assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, EXISTING_HTML, 'fichier intact');
  });

  it('mode create : contrat de création (protection vide), exécution normale', () => {
    const store = new FileStore();
    const tenantId = INPUT_BASE.tenantId;
    const projectId = INPUT_BASE.projectId;
    store.deleteNode(tenantId, projectId, 'index.html');
    const engine = recordingEngine(store);

    const html = '<!DOCTYPE html><html lang="fr"><head><title>Neuf</title></head><body><div data-section="hero"><h1>Neuf</h1></div></body></html>';
    const outcome = applyStreamFileMutation(engine, {
      ...INPUT_BASE,
      mode: 'create',
      content: html,
      userMessage: 'Crée un site de photographe',
      intentCategory: 'CREATE'
    });
    assert.equal(outcome.applied, true);
    assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, html);
  });
});
