/**
 * VibeCode Core — Application Model (§12)
 * CDC §12 LOT 2 — Racine unifiée persistée. Preuves :
 *
 *  - fusion par RÉFÉRENCES réelles (compréhension + DNA + révisions + mémoire) ;
 *  - refus honnête : ni compréhension ni DNA → pas de racine (undefined) ;
 *  - identité déterministe : builtAt EXCLU du hash — mêmes sources, même id ;
 *  - incohérence tenant/projet d'une source → erreur (pas de modèle mélangé) ;
 *  - store : upsert par couple, isolation, clear, gel en profondeur.
 *
 * Déterministe : aucun réseau, aucune horloge réelle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApplicationModelStore,
  buildApplicationModel,
  computeApplicationModelHash,
  APPLICATION_MODEL_SCHEMA_VERSION,
  type ApplicationDNA,
  type ApplicationRevision,
  type ApplicationSemanticModel,
  type ProjectMemory
} from '../../../src/index.js';
import type { DesignMemoryDecision } from '../../../src/ai-native/design-harmony/design-memory.js';

const TENANT = 'tenant-am';
const PROJECT = 'project-am';

function fakeUnderstanding(overrides?: Partial<ApplicationSemanticModel>): ApplicationSemanticModel {
  return {
    tenantId: TENANT,
    projectId: PROJECT,
    understandingHash: 'u'.repeat(64),
    treeHash: 'tree-1',
    graphHash: 'graph-1',
    features: [{}, {}],
    domains: [{}],
    workflows: [],
    apis: [{}, {}, {}],
    ...overrides
  } as unknown as ApplicationSemanticModel;
}

function fakeDNA(overrides?: Partial<ApplicationDNA>): ApplicationDNA {
  return {
    tenantId: TENANT,
    projectId: PROJECT,
    dnaHash: 'd'.repeat(64),
    treeHash: 'tree-1',
    summary: {
      totalFiles: 3,
      analyzedFiles: 3,
      diagnosticsCount: 0,
      overallHealth: 'HEALTHY',
      primaryLanguage: 'HTML',
      primaryFramework: 'Aucun'
    },
    stack: {
      language: { name: 'HTML' },
      framework: { name: 'Aucun' }
    },
    ...overrides
  } as unknown as ApplicationDNA;
}

function fakeRevision(number: number): ApplicationRevision {
  return {
    id: `rev-${number}`,
    tenantId: TENANT,
    projectId: PROJECT,
    revisionNumber: number,
    message: `révision ${number}`,
    author: 'tester',
    createdAt: new Date('2026-01-0' + number + 'T00:00:00.000Z'),
    files: {},
    decisions: [],
    provenance: { source: 'USER' }
  } as unknown as ApplicationRevision;
}

function fakeMemory(): ProjectMemory {
  return {
    architecturalDecisions: [{}, {}],
    userPreferences: {},
    acceptedPlans: ['p1'],
    rejectedPlans: [],
    knownConstraints: ['c1', 'c2'],
    knownConventions: [],
    knownRisks: ['r1']
  } as unknown as ProjectMemory;
}

function fakeDesignDecision(overrides?: Partial<DesignMemoryDecision>): DesignMemoryDecision {
  return {
    id: 'dmem:0000000000000001',
    tenantId: TENANT,
    projectId: PROJECT,
    kind: 'DECISION',
    decision: 'Utiliser des tableaux compacts',
    reason: 'Application destinée à des utilisateurs professionnels',
    source: 'HUMAN',
    status: 'ACTIVE',
    createdAt: '2026-01-02T00:00:00.000Z',
    recordedAt: '2026-01-02T00:00:00.000Z',
    ...overrides
  } as DesignMemoryDecision;
}

const BUILT_AT = '2026-01-10T00:00:00.000Z';

describe('§12 Application Model — racine unifiée persistée', () => {
  it('1. compréhension seule → racine avec source understanding (sourceCount 1)', () => {
    const model = buildApplicationModel({
      tenantId: TENANT,
      projectId: PROJECT,
      builtAt: BUILT_AT,
      understanding: fakeUnderstanding()
    })!;
    assert.ok(model);
    assert.equal(model.schemaVersion, APPLICATION_MODEL_SCHEMA_VERSION);
    assert.match(model.modelId, /^am:[0-9a-f]{16}$/);
    assert.match(model.modelHash, /^[0-9a-f]{64}$/);
    assert.equal(model.sourceCount, 1);
    assert.equal(model.sources.understanding!.features, 2);
    assert.equal(model.sources.understanding!.apis, 3);
    assert.equal(model.sources.dna, undefined);
  });

  it('2. DNA seule → racine avec source dna (langage/framework réels)', () => {
    const model = buildApplicationModel({
      tenantId: TENANT,
      projectId: PROJECT,
      builtAt: BUILT_AT,
      dna: fakeDNA()
    })!;
    assert.ok(model);
    assert.equal(model.sourceCount, 1);
    assert.equal(model.sources.dna!.primaryLanguage, 'HTML');
    assert.equal(model.sources.dna!.summary.totalFiles, 3);
  });

  it('3. ni compréhension ni DNA → undefined (aucune racine fabriquée)', () => {
    const model = buildApplicationModel({
      tenantId: TENANT,
      projectId: PROJECT,
      builtAt: BUILT_AT
    });
    assert.equal(model, undefined);
  });

  it('4. fusion complète : 4 sources + dernière révision par numéro + compteurs mémoire', () => {
    const model = buildApplicationModel({
      tenantId: TENANT,
      projectId: PROJECT,
      builtAt: BUILT_AT,
      understanding: fakeUnderstanding(),
      dna: fakeDNA(),
      revisions: [fakeRevision(1), fakeRevision(3), fakeRevision(2)],
      memory: fakeMemory()
    })!;
    assert.ok(model);
    assert.equal(model.sourceCount, 4);
    assert.equal(model.sources.revisions!.count, 3);
    assert.equal(model.sources.revisions!.latestRevisionId, 'rev-3');
    assert.equal(model.sources.revisions!.latestRevisionNumber, 3);
    assert.equal(model.sources.revisions!.latestCreatedAt, '2026-01-03T00:00:00.000Z');
    assert.equal(model.sources.memory!.architecturalDecisions, 2);
    assert.equal(model.sources.memory!.acceptedPlans, 1);
    assert.equal(model.sources.memory!.knownConstraints, 2);
    assert.equal(model.sources.memory!.knownRisks, 1);
  });

  it('4bis. P0 §23 — décisions design rattachées au modèle (références, statuts, entrées étrangères ignorées)', () => {
    const model = buildApplicationModel({
      tenantId: TENANT,
      projectId: PROJECT,
      builtAt: BUILT_AT,
      dna: fakeDNA(),
      designDecisions: [
        fakeDesignDecision(),
        fakeDesignDecision({
          id: 'dmem:0000000000000002',
          kind: 'IGNORE_OPPORTUNITY',
          status: 'SUPERSEDED',
          recordedAt: '2026-01-03T00:00:00.000Z'
        }),
        fakeDesignDecision({ id: 'dmem:0000000000000003', tenantId: 'autre-tenant' })
      ]
    })!;
    assert.ok(model);
    assert.equal(model.sourceCount, 2, 'dna + designMemory');
    assert.equal(model.sources.designMemory!.totalCount, 2, 'entrée étrangère ignorée');
    assert.equal(model.sources.designMemory!.activeCount, 1);
    assert.equal(model.sources.designMemory!.ignoredOpportunities, 0);
    assert.equal(model.sources.designMemory!.latestDecisionId, 'dmem:0000000000000002');
    assert.equal(model.sources.designMemory!.latestRecordedAt, '2026-01-03T00:00:00.000Z');

    // Non-régression : sans décisions design, la source reste ABSENTE et
    // l'identité du modèle est celle d'avant (mêmes sources → même hash).
    const without = buildApplicationModel({
      tenantId: TENANT,
      projectId: PROJECT,
      builtAt: BUILT_AT,
      dna: fakeDNA()
    })!;
    assert.equal(without.sources.designMemory, undefined);
    assert.equal(without.sourceCount, 1);
    assert.notEqual(without.modelHash, model.modelHash, 'les décisions design changent l identité réelle du modèle');
  });

  it('5. identité déterministe : builtAt exclu ; contenu changé → id changé', () => {
    const base = {
      tenantId: TENANT,
      projectId: PROJECT,
      understanding: fakeUnderstanding(),
      dna: fakeDNA()
    };
    const first = buildApplicationModel({ ...base, builtAt: '2026-01-10T00:00:00.000Z' })!;
    const later = buildApplicationModel({ ...base, builtAt: '2026-06-01T12:00:00.000Z' })!;
    assert.equal(first.modelId, later.modelId, 'builtAt n entre pas dans l identité');

    const changed = buildApplicationModel({
      ...base,
      builtAt: BUILT_AT,
      understanding: fakeUnderstanding({ understandingHash: 'v'.repeat(64) })
    })!;
    assert.notEqual(first.modelId, changed.modelId);

    const hashDirect = computeApplicationModelHash({
      tenantId: TENANT,
      projectId: PROJECT,
      sources: first.sources
    });
    assert.equal(hashDirect, first.modelHash);
  });

  it('6. source incohérente (autre projet) → erreur, pas de modèle mélangé', () => {
    assert.throws(() =>
      buildApplicationModel({
        tenantId: TENANT,
        projectId: PROJECT,
        builtAt: BUILT_AT,
        understanding: fakeUnderstanding({ projectId: 'autre-projet' })
      })
    );
    assert.throws(() =>
      buildApplicationModel({
        tenantId: TENANT,
        projectId: PROJECT,
        builtAt: BUILT_AT,
        dna: fakeDNA({ tenantId: 'autre-tenant' })
      })
    );
  });

  it('7. racine gelée en profondeur', () => {
    const model = buildApplicationModel({
      tenantId: TENANT,
      projectId: PROJECT,
      builtAt: BUILT_AT,
      understanding: fakeUnderstanding()
    })!;
    assert.ok(Object.isFrozen(model));
    assert.ok(Object.isFrozen(model.sources));
    assert.ok(Object.isFrozen(model.sources.understanding));
  });

  it('8. store : record/get/has/clear + isolation par couple tenant/projet', () => {
    const store = new ApplicationModelStore();
    assert.equal(store.has(TENANT, PROJECT), false);
    const model = buildApplicationModel({
      tenantId: TENANT,
      projectId: PROJECT,
      builtAt: BUILT_AT,
      understanding: fakeUnderstanding()
    })!;
    store.record(model);
    assert.equal(store.has(TENANT, PROJECT), true);
    assert.equal(store.get(TENANT, PROJECT)!.modelId, model.modelId);
    assert.equal(store.get(TENANT, 'autre-projet'), undefined);
    assert.equal(store.get('autre-tenant', PROJECT), undefined);

    // Upsert : un nouveau modèle remplace le précédent.
    const updated = buildApplicationModel({
      tenantId: TENANT,
      projectId: PROJECT,
      builtAt: '2026-02-01T00:00:00.000Z',
      understanding: fakeUnderstanding({ understandingHash: 'w'.repeat(64) })
    })!;
    store.record(updated);
    assert.equal(store.get(TENANT, PROJECT)!.modelId, updated.modelId);

    store.clear();
    assert.equal(store.has(TENANT, PROJECT), false);
  });

  it('9. store passif : la copie enregistrée est isolée de l objet source', () => {
    const store = new ApplicationModelStore();
    const model = buildApplicationModel({
      tenantId: TENANT,
      projectId: PROJECT,
      builtAt: BUILT_AT,
      understanding: fakeUnderstanding()
    })!;
    store.record(model);
    const stored = store.get(TENANT, PROJECT)!;
    assert.equal(stored.modelId, model.modelId);
    assert.notEqual(stored, model, 'copie (structuredClone) — pas la même référence');
  });
});
