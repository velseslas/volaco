/**
 * VibeCode Core — Evolution (AINT-017)
 * CDC §31 LOT 2 — EvolutionService : le moteur `evolution/*` ORPHELIN devient
 * branché, alimenté par des sources réelles. Preuves :
 *
 *  - NO EVIDENCE → NO CLAIM : sans source, zéro évidence, zéro proposition ;
 *  - les propositions générées sont toutes adossées à au moins une évidence ;
 *  - déterministe : mêmes sources → même reportHash / même id ;
 *  - cache multi-tenant (clé tenant::project::hash) + forceRecompute ;
 *  - advisory : aucune mutation (le service ne touche à rien).
 *
 * Déterministe : aucun réseau, aucune horloge réelle (hors createdAt).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EvolutionService } from '../../../src/index.js';

const TENANT = 'tenant-evo';
const PROJECT = 'project-evo';

const AUDIT_SOURCES = {
  auditReport: {
    findings: [
      { id: 'aaf-1', description: 'Contraste insuffisant sur les CTA', severity: 'HIGH', dimension: 'ACCESSIBILITY' },
      { id: 'aaf-2', description: 'Absence de gestion d erreur réseau', severity: 'MEDIUM', dimension: 'RELIABILITY' }
    ]
  }
};

const FEATURE_SOURCES = {
  featureReport: {
    opportunities: [
      { id: 'fo-1', title: 'Ajouter un mode sombre', description: 'Mode sombre demandé', demandScore: 80 }
    ]
  }
};

function analyze(sources: Record<string, unknown>) {
  const service = new EvolutionService();
  return service.analyze({ tenantId: TENANT, projectId: PROJECT, callerRole: 'ENGINEER', sources });
}

describe('§31 EvolutionService — moteur branché sur sources réelles', () => {
  it('1. aucune source → aucune évidence, aucune proposition (NO EVIDENCE → NO CLAIM)', () => {
    const report = analyze({});
    assert.equal(report.totalEvidenceEvaluated, 0);
    assert.equal(report.proposals.length, 0);
    assert.equal(report.overallConfidence, 0);
    assert.equal(report.readinessStatus, 'UNKNOWN', 'état incomplet (sources absentes) → UNKNOWN, jamais inventé');
    assert.match(report.id, /^evr:[0-9a-f]{16}$/);
    assert.match(report.reportHash, /^[0-9a-f]{64}$/);
  });

  it('2. audit réel → propositions TOUTES adossées à de l évidence', () => {
    const report = analyze(AUDIT_SOURCES);
    assert.equal(report.totalEvidenceEvaluated, 2);
    assert.ok(report.proposals.length >= 1, 'les findings d audit produisent au moins une proposition');
    for (const proposal of report.proposals) {
      assert.ok(proposal.evidence.length > 0, `proposal ${proposal.id} sans évidence`);
      assert.equal(proposal.tenantId, TENANT);
      assert.equal(proposal.projectId, PROJECT);
      assert.ok(proposal.id.length > 0);
      assert.ok(proposal.category.length > 0);
    }
  });

  it('3. opportunités produit → évidence CORRELATION reprise par le moteur', () => {
    const report = analyze(FEATURE_SOURCES);
    assert.equal(report.totalEvidenceEvaluated, 1);
    assert.ok(report.proposals.length >= 1);
  });

  it('4. déterminisme strict : deux instances, mêmes sources → même id / reportHash', () => {
    const first = analyze(AUDIT_SOURCES);
    const second = analyze(AUDIT_SOURCES);
    assert.equal(first.id, second.id);
    assert.equal(first.reportHash, second.reportHash);
    assert.deepEqual(
      first.proposals.map((p) => p.id),
      second.proposals.map((p) => p.id)
    );
    assert.equal(first.applicationState.stateHash, second.applicationState.stateHash);
  });

  it('5. cache : second appel identique → même instance de rapport ; forceRecompute → recalcul', () => {
    const service = new EvolutionService();
    const input = { tenantId: TENANT, projectId: PROJECT, callerRole: 'ENGINEER' as const, sources: AUDIT_SOURCES };
    const first = service.analyze(input);
    const second = service.analyze(input);
    assert.equal(first, second, 'le cache retourne la même instance');

    const recomputed = service.analyze({ ...input, options: { forceRecompute: true } });
    assert.notEqual(first, recomputed, 'forceRecompute recalcule');
    assert.equal(first.reportHash, recomputed.reportHash, 'mêmes sources → même identité de contenu');
    const metrics = service.getCacheMetrics();
    assert.ok(metrics.sets >= 2);
    assert.ok(metrics.hits >= 1);
  });

  it('6. maxProposals respecté', () => {
    const service = new EvolutionService();
    const report = service.analyze({
      tenantId: TENANT,
      projectId: PROJECT,
      callerRole: 'ENGINEER',
      sources: AUDIT_SOURCES,
      options: { maxProposals: 1 }
    });
    assert.ok(report.proposals.length <= 1);
  });

  it('7. isolation multi-tenant : même projet, tenants différents → identités différentes', () => {
    const serviceA = new EvolutionService().analyze({ tenantId: 'tenant-a', projectId: PROJECT, callerRole: 'ENGINEER', sources: AUDIT_SOURCES });
    const serviceB = new EvolutionService().analyze({ tenantId: 'tenant-b', projectId: PROJECT, callerRole: 'ENGINEER', sources: AUDIT_SOURCES });
    assert.notEqual(serviceA.id, serviceB.id);
    assert.ok(serviceA.proposals.every((p) => p.tenantId === 'tenant-a'));
    assert.ok(serviceB.proposals.every((p) => p.tenantId === 'tenant-b'));
  });

  it('8. identité : tenant/projet obligatoires', () => {
    const service = new EvolutionService();
    assert.throws(() => service.analyze({ tenantId: '', projectId: PROJECT, callerRole: 'ENGINEER', sources: {} }));
    assert.throws(() => service.analyze({ tenantId: TENANT, projectId: '  ', callerRole: 'ENGINEER', sources: {} }));
  });

  it('9. rapport complet gelé (santé produit + état + propositions)', () => {
    const report = analyze(AUDIT_SOURCES);
    assert.ok(Object.isFrozen(report));
    assert.ok(Object.isFrozen(report.proposals));
    assert.ok(report.healthScore.overall >= 0 && report.healthScore.overall <= 100);
    assert.equal(report.applicationState.tenantId, TENANT);
    assert.equal(report.applicationState.projectId, PROJECT);
    assert.ok(['BLOCKED', 'UNKNOWN', 'READY', 'READY_WITH_RISK', 'NOT_READY'].includes(report.readinessStatus));
  });
});
