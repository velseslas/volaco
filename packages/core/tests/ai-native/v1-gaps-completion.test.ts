/**
 * CDC V7 — complétion des 6 modules « incomplets pour leur périmètre V1 » :
 *   §22 RAG & Code Intelligence — searchCode (exact/lexical/semantic/metadata/dependency)
 *   §23 Tool System — coût déclaratif sur chaque outil
 *   §20 Agent Architecture — 5 agents CDC en lecture seule
 *   §14 Application Memory — confiance/provenance/statut/kind sur les observations
 *   §16 Assumption Engine — révisable + porte « demander l'utilisateur » + persistance
 *   §24 Execution Engine — troncature de sortie bornée
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CodeIntelligenceService,
  AssumptionEngine,
  RunMemoryStore,
  TOOL_DEFINITIONS,
  STANDARD_TOOL_NAMES,
  getCapabilitiesForRole,
  getAllowedOperationsForRole,
  truncateCommandOutput,
  TERMINAL_RESULT_OUTPUT_LIMIT
} from '../../src/index.js';
import type { IReadOnlyFileSource } from '../../src/index.js';

const FILES: Record<string, string> = {
  'src/auth-service.js': [
    '/** Service central d authentification. */',
    'export class AuthenticationService {',
    '  constructor(users) { this.users = users; }',
    '}'
  ].join('\n'),
  'src/cart.js': [
    "import { AuthenticationService } from './auth-service.js';",
    '/** Ajoute un article au panier. */',
    'export function addToCart(cart, item) {',
    '  cart.items.push(item);',
    '  return cart;',
    '}'
  ].join('\n')
};

const fileSource = {
  getFile: () => null,
  getAllProjectFiles: () => FILES
} as unknown as IReadOnlyFileSource;

describe('CDC V7 — complétion V1 des 6 modules', () => {
  it('§22 searchCode — mode exact trouve le symbole', () => {
    const service = new CodeIntelligenceService(fileSource);
    const result = service.searchCode('tenant_t', 'proj_t', 'addToCart', {}, 'ENGINEER');
    assert.ok(result.totalHits >= 1, 'au moins un hit');
    const top = result.hits[0];
    assert.equal(top?.symbolName, 'addToCart');
    assert.ok(top?.matchedBy.includes('exact'), 'matché par exact');
  });

  it('§22 searchCode — mode semantic (expansion) et metadata (filtre kind)', () => {
    const service = new CodeIntelligenceService(fileSource);
    const semantic = service.searchCode('tenant_t', 'proj_t', 'auth', {}, 'ENGINEER');
    assert.ok(
      semantic.hits.some((h) => h.symbolName === 'AuthenticationService' && h.matchedBy.includes('semantic')),
      'auth → AuthenticationService via expansion sémantique'
    );
    const metadata = service.searchCode('tenant_t', 'proj_t', 'addToCart', { kind: 'function' }, 'ENGINEER');
    assert.ok(metadata.hits.every((h) => h.kind === 'function' || h.matchedBy.includes('dependency')), 'filtre kind');
  });

  it('§22 searchCode — dependency-aware booste le fichier importé', () => {
    const service = new CodeIntelligenceService(fileSource);
    const result = service.searchCode('tenant_t', 'proj_t', 'addToCart', {}, 'ENGINEER');
    const depHit = result.hits.find((h) => h.filePath === 'src/auth-service.js');
    assert.ok(depHit, 'auth-service.js remonté via le graphe de dépendances');
    assert.ok(depHit?.matchedBy.includes('dependency'), 'matché par dependency');
  });

  it('§23 chaque outil standard déclare son coût (CDC : permissions/inputs/outputs/timeout/risque/coût)', () => {
    for (const name of STANDARD_TOOL_NAMES) {
      const def = TOOL_DEFINITIONS[name];
      assert.ok(def, `définition présente pour ${name}`);
      assert.ok(def.cost, `coût déclaré pour ${name}`);
      assert.ok(def.permissions.length > 0, `permissions présentes pour ${name}`);
      assert.ok(typeof def.timeoutMs === 'number' && def.timeoutMs > 0, `timeout présent pour ${name}`);
    }
    assert.equal(TOOL_DEFINITIONS['EXECUTE_MUTATION']?.cost, 'HIGH', 'mutation exécutée = coût HIGH');
    assert.equal(TOOL_DEFINITIONS['READ_FILE']?.cost, 'FREE', 'lecture = coût FREE');
  });

  it('§20 les 5 agents CDC existent et sont en lecture seule (DENY mutations)', () => {
    for (const role of ['VISUAL_AGENT', 'PERFORMANCE_AGENT', 'ACCESSIBILITY_AGENT', 'AUDIT_AGENT', 'PRODUCT_INTELLIGENCE_AGENT'] as const) {
      const caps = getCapabilitiesForRole(role);
      assert.equal(caps.canExecuteMutations, false, `${role} ne mute pas`);
      assert.equal(caps.canPlanMutations, false, `${role} ne planifie pas de mutation`);
      assert.equal(caps.canReadFiles, true, `${role} lit les fichiers`);
      const ops = getAllowedOperationsForRole(role);
      assert.ok(ops.includes('read_file'), `${role} a read_file`);
      assert.ok(!ops.includes('execute_mutation'), `${role} n'a PAS execute_mutation`);
    }
  });

  it('§14 observations avec confiance/provenance/statut/kind + supersede traçable', () => {
    const memory = new RunMemoryStore('run-1', 'tenant_t', 'proj_t');
    const obs = memory.addObservationWithMetadata('Le site est une boutique de mode', 'conversation', {
      confidence: 0.92,
      kind: 'conversation',
      provenance: 'session:abc'
    });
    assert.equal(obs.confidence, 0.92);
    assert.equal(obs.kind, 'conversation');
    assert.equal(obs.status, 'ACTIVE');
    assert.equal(obs.provenance, 'session:abc');

    const superseded = memory.supersedeObservation(obs.id);
    assert.equal(superseded?.status, 'SUPERSEDED');
    assert.equal(memory.listObservations().length, 1, 'rien n est effacé (traçable)');

    const exec = memory.addObservationWithMetadata('build ok', 'terminal', { kind: 'execution' });
    assert.equal(memory.listObservations('execution').length, 1);
    assert.equal(memory.listObservations('execution')[0]?.id, exec.id);
  });

  it('§16 hypothèses révisables + porte utilisateur + persistance JSON', () => {
    const engine = new AssumptionEngine();
    const a = engine.addAssumption('Utiliser le système existant', 0.94, ['ev-1']);
    assert.equal(engine.requiresUserInput(a.id), false, 'confiance haute → pas de question');

    const risky = engine.addAssumption('Paiement CB', 0.4, []);
    assert.equal(engine.requiresUserInput(risky.id), true, 'confiance basse → question');
    assert.equal(engine.requiresUserInput(a.id, { risky: true }), true, 'risque élevé → question');

    const revised = engine.revise(a.id, 'Utiliser le nouveau module', 'changement de périmètre', 0.8);
    assert.ok(revised, 'révision créée');
    assert.equal(engine.get(a.id)?.status, 'SUPERSEDED', 'ancienne version traçable');
    assert.equal(revised?.revisedFrom, a.id);
    assert.equal(revised?.revisionReason, 'changement de périmètre');

    const restored = AssumptionEngine.fromJSON(engine.toJSON());
    assert.equal(restored.get(revised?.id ?? '')?.statement, 'Utiliser le nouveau module');
    assert.equal(restored.get(a.id)?.status, 'SUPERSEDED');
  });

  it('§24 sortie terminal tronquée avec marqueur honnête au-delà du plafond', () => {
    const small = 'ok';
    assert.equal(truncateCommandOutput(small), small, 'petite sortie intacte');

    const huge = 'x'.repeat(TERMINAL_RESULT_OUTPUT_LIMIT + 1000);
    const truncated = truncateCommandOutput(huge);
    assert.ok(truncated.length < huge.length, 'sortie réduite');
    assert.ok(truncated.includes('sortie tronquée'), 'marqueur de troncature présent');
  });
});
