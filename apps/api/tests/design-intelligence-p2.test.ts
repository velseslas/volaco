/**
 * PHASE CORRECTIVE M-1/M-2 — suite ciblée des 3 anomalies P2 de l'audit
 * d'intégration (AUD-M1-01, AUD-M1-02, AUD-M2-02).
 *
 * Preuves exigées :
 *  M-1 causalité avec/sans override (+ fallback conservateur sans clés) ;
 *  M-1 couverture CDC §11 (hiérarchie + organisation présentes quand le
 *     contexte le permet, omises honnêtement sinon, payload ≤ 4 Ko) ;
 *  M-2 suppression d'override tracée (previous réel) + supersession
 *     conservant le why et les informations de création ;
 *  M-2 cohérence ledger ↔ auditStore SANS duplication (RESET uniquement) ;
 *  M-2 isolation tenant/projet (HTTP + unitaire) ;
 *  non-régression : phrases dérivées M-1 (rayon/palette/catalogue) intactes.
 *
 * Déterministe : stores injectés pour l'unitaire, serveur port 0 + audit
 * réel pour HTTP (données VOLACO_DATA_DIR du lanceur de tests).
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildDesignRationale } from '../../../packages/core/src/ai-native/ai-orchestrator/agents/ui-agent.js';
import { buildProjectDesignContext } from '../../../packages/core/src/ai-native/design-harmony/design-context.js';
import {
  buildDesignGovernanceLedger,
  type GovernanceAuditEventLike
} from '../../../packages/core/src/ai-native/design-harmony/design-governance.js';
import { auditStore } from '../../../packages/core/src/observability/audit.js';
import type { DesignHarmonyReport } from '../../../packages/core/src/ai-native/design-harmony/types.js';
import type { DesignMemoryDecision } from '../../../packages/core/src/ai-native/design-harmony/design-memory.js';

const TENANT = 'tenant_p2_fix';
const OTHER_TENANT = 'tenant_p2_other';
const PROJECT = 'proj_p2_fix';
const FIXED_AT = '2026-11-10T00:00:00.000Z';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'x-tenant-id': TENANT,
  'x-user-role': 'ENGINEER'
};

const CLEAN_HTML =
  '<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>P2</title></head>' +
  '<body style="background:#ffffff;color:#111827"><h1 style="color:#111827;background:#ffffff">Titre</h1>' +
  '<p style="color:#111827">Texte lisible sur fond clair.</p></body></html>';

function makeReport(tenantId = TENANT, projectId = PROJECT): DesignHarmonyReport {
  return {
    reportId: 'dhr-p2-0001',
    tenantId,
    projectId,
    analyzedRoutes: ['/', '/menu'],
    overallScore: 71,
    subScores: {
      colorHarmony: 70,
      typographyHarmony: 72,
      spacingHarmony: 75,
      shapeHarmony: 68,
      elevationHarmony: 66,
      componentHarmony: 69,
      crossPageHarmony: 74,
      responsiveA11yHarmony: 73
    },
    inferredDesignSystem: {
      colorTokens: {
        primary: '#b45309',
        secondary: '#1f2937',
        accent: '#d97706',
        background: '#ffffff',
        surface: '#f9fafb',
        foreground: '#111827',
        border: '#e5e7eb'
      },
      typographyTokens: {
        primaryFontFamily: 'Inter',
        fontFamilies: ['Inter'],
        detectedScale: ['14px', '16px', '24px'],
        dominantLineHeightRatio: 1.5
      },
      spacingTokens: { baseGridStep: 8, detectedScale: [8, 16, 24, 32], regularityRatio: 0.8 },
      shapeTokens: {
        primaryButtonRadius: '10px',
        primaryCardRadius: '16px',
        primaryInputRadius: '10px',
        detectedRadii: ['10px', '16px']
      },
      elevationTokens: { detectedLevelsCount: 2, shadowLevels: ['a', 'b'] },
      systemConfidence: 0.8,
      evidenceCount: 90
    },
    findings: [
      {
        id: 'f-p2-1',
        category: 'COLOR',
        severity: 'HIGH',
        confidence: 0.9,
        pageRoute: '/',
        property: 'contrast',
        observedValue: 3.1,
        recommendation: 'Renforcer le contraste du CTA principal',
        designDrift: true,
        evidence: [{ source: 'WCAG_CALCULATION', detail: 'contraste mesuré', pageRoute: '/', occurrences: 1 }]
      }
    ],
    driftSummary: { totalDrifts: 1, criticalDrifts: 0 },
    reportHash: 'hash-p2',
    generatedAt: '2026-10-18T09:30:00.000Z',
    durationMs: 30
  };
}

function makeDecision(overrides: Partial<DesignMemoryDecision> = {}): DesignMemoryDecision {
  return {
    id: 'dmem-p2-1',
    tenantId: TENANT,
    projectId: PROJECT,
    kind: 'DECISION',
    decision: 'Garder tables compactes',
    reason: 'Raison originale importante',
    source: 'HUMAN',
    status: 'ACTIVE',
    createdAt: '2026-10-01T10:00:00.000Z',
    recordedAt: '2026-10-01T10:00:00.000Z',
    ...overrides
  };
}

/** Fake NAÏF : renvoie tous les événements quel que soit le filtre — le code doit filtrer lui-même. */
function fakeAudit(events: readonly GovernanceAuditEventLike[]): {
  query: (
    tenantId: string,
    filter?: { action?: string; resourceType?: string }
  ) => readonly GovernanceAuditEventLike[];
} {
  return { query: () => events };
}

function emptyStores() {
  return {
    directionStore: { get: () => undefined },
    memoryStore: { list: () => [] as readonly DesignMemoryDecision[] },
    revisionStore: { listRevisions: () => [] },
    componentStore: { list: () => [] }
  };
}

// ---------------------------------------------------------------------------
// M-1 — AUD-M1-01 (§11) + AUD-M1-02 (causalité)
// ---------------------------------------------------------------------------
describe('M-1 — CDC §11 et causalité de l explication', () => {
  it('1. sans override : dérivation tokens → conséquences conservée, §11 complet, bornes respectées', () => {
    const ctx = buildProjectDesignContext(makeReport());
    assert.equal(ctx.directionSource, 'derived');
    assert.equal(ctx.directionOverrideKeys, undefined, 'aucune clé d override sans override');

    const rationale = buildDesignRationale(ctx);
    assert.equal(rationale.directionSource, 'derived');
    const text = JSON.stringify(rationale).toLowerCase();

    // §11 (AUD-M1-01) : les 4 exigences présentes.
    assert.ok(text.includes('hiérarchie'), 'hiérarchie expliquée (§11)');
    assert.ok(text.includes('organisation'), 'organisation expliquée (§11)');
    assert.ok(text.includes('espacement'), 'espacement expliqué (§11)');
    assert.ok(text.includes('composants'), 'composant expliqué (§11)');
    assert.ok(
      rationale.reasons.some((r) => r.includes('un seul H1 par page')),
      'hiérarchie = règle réelle appliquée (structure.semantics)'
    );
    assert.ok(
      rationale.reasons.some((r) => r.includes('page(s) analysée(s)') && r.includes('structure.semantics')),
      'organisation = routes réelles + règle citée'
    );

    // Non-régression M-1 : phrases dérivées historiques exactes.
    assert.ok(rationale.reasons.some((r) => r.includes('rayon dominant 10px')));
    assert.ok(rationale.reasons.some((r) => r.includes('#b45309')));
    assert.ok(rationale.reasons.some((r) => r.includes('catalogue 1.0.0')));
    assert.ok(!text.includes('override projet §6'), 'aucune mention d override sans override');

    // Bornes : payload ≤ 4 Ko, chaque raison ≤ 180 car.
    const size = Buffer.byteLength(JSON.stringify(rationale), 'utf8');
    assert.ok(size <= 4096, `payload rationale ${size} octets > 4096`);
    for (const reason of rationale.reasons) {
      assert.ok(reason.length <= 180, `raison > 180 car. : ${reason.length}`);
    }

    // Déterminisme (§16).
    const again = buildDesignRationale(buildProjectDesignContext(makeReport()));
    assert.deepEqual(again.reasons, rationale.reasons);
  });

  it('2. avec override : provenance par clé, aucune causalité fausse, dimensions non fixées toujours dérivées', () => {
    const ctx = buildProjectDesignContext(makeReport(), undefined, {
      directionOverride: { style: 'Sharp & Technical', density: 'Dense' }
    });
    assert.equal(ctx.directionSource, 'override');
    assert.deepEqual(ctx.directionOverrideKeys ?? [], ['density', 'style'], 'clés triées (déterminisme)');

    const rationale = buildDesignRationale(ctx);
    const reasons = rationale.reasons;

    // Phrase de provenance explicite en tête (M-3 / préférence utilisateur).
    assert.ok(reasons[0]?.includes('Provenance : override projet §6'), reasons[0] ?? 'vide');
    assert.ok(reasons[0]?.includes('dimensions fixées : density, style'), reasons[0] ?? 'vide');

    // AUD-M1-02 : plus AUCUNE phrase ne relie une mesure de token au style fixé.
    assert.ok(!reasons.some((r) => r.includes('rayon dominant')), 'jamais « rayon dominant → style » en override');
    assert.ok(!reasons.some((r) => r.includes('→ style')), 'jamais de lien causal token → style fixé');
    assert.ok(
      reasons.some((r) => r.includes('Style « Sharp & Technical »') && r.includes('override projet §6')),
      'style attribué à l override projet §6 (catalogue M-3, préférence utilisateur)'
    );
    assert.ok(
      reasons.some((r) => r.includes('pas dérivée de la grille')),
      'densité fixée : grille citée comme mesure, PAS comme cause'
    );

    // Dimensions NON fixées : la vraie dérivation est conservée.
    assert.ok(reasons.some((r) => r.includes('→ partition «')), 'personality toujours dérivée de la police');
    assert.ok(reasons.some((r) => r.includes('→ énergie visuelle')), 'visualEnergy toujours dérivée de la palette');

    // Bornes en mode override.
    const size = Buffer.byteLength(JSON.stringify(rationale), 'utf8');
    assert.ok(size <= 4096, `payload override ${size} octets > 4096`);
    for (const reason of reasons) {
      assert.ok(reason.length <= 180, `raison > 180 car. : ${reason.length}`);
    }
    // Déterminisme.
    assert.deepEqual(
      buildDesignRationale(
        buildProjectDesignContext(makeReport(), undefined, {
          directionOverride: { style: 'Sharp & Technical', density: 'Dense' }
        })
      ).reasons,
      reasons
    );
  });

  it('3. override sans clés (contexte ancien) : fallback conservateur — AUCUNE dimension présentée comme dérivée', () => {
    const ctx = buildProjectDesignContext(makeReport(), undefined, {
      directionOverride: { style: 'Sharp & Technical' }
    });
    const stripped = { ...ctx, directionOverrideKeys: undefined };
    assert.equal(stripped.directionSource, 'override');

    const rationale = buildDesignRationale(stripped);
    const reasons = rationale.reasons;
    assert.ok(!reasons.some((r) => r.includes('rayon dominant')), 'pas de causalité fausse sur le style');
    assert.ok(!reasons.some((r) => r.includes('→ partition')), 'pas de causalité fausse sur la personnalité');
    assert.ok(!reasons.some((r) => r.includes('→ énergie visuelle')), 'pas de causalité fausse sur l énergie');
    assert.ok(!reasons.some((r) => r.includes('→ densité')), 'pas de causalité fausse sur la densité');
    assert.ok(!reasons.some((r) => r.includes('→ style')), 'pas de lien → style');
    assert.ok(
      reasons[0]?.includes('entièrement fixée par l’override projet §6'),
      'provenance conservatrice explicite'
    );
  });

  it('4. §24 : origine des décisions distinguée (HUMAN/AGENT), jamais inventée sans source', () => {
    const ctx = buildProjectDesignContext(makeReport(), undefined, {
      decisions: [
        makeDecision({ id: 'dmem-p2-h', decision: 'Compact', source: 'HUMAN' }),
        makeDecision({ id: 'dmem-p2-a', decision: 'Contrastes AA', source: 'AGENT' })
      ]
    });
    const rationale = buildDesignRationale(ctx);
    assert.ok(
      rationale.reasons.some((r) => r.includes('(origine : HUMAN 1, AGENT 1)')),
      'provenance HUMAN/AGENT distinguée'
    );

    const bare = buildDesignRationale(buildProjectDesignContext(makeReport()));
    assert.ok(!bare.reasons.some((r) => r.includes('origine :')), 'aucune origine inventée sans décision');
  });

  it('5. §11 honnêteté : sans la règle structure, hiérarchie/organisation omises (jamais inventées)', () => {
    const ctx = buildProjectDesignContext(makeReport());
    const withoutStructure = { ...ctx, rules: ctx.rules.filter((rule) => rule.id !== 'structure.semantics') };
    const rationale = buildDesignRationale(withoutStructure);
    const text = JSON.stringify(rationale).toLowerCase();
    assert.ok(!text.includes('hiérarchie'), 'hiérarchie omise faute de preuve');
    assert.ok(!text.includes('organisation'), 'organisation omise faute de preuve');
    assert.ok(text.includes('espacement'), 'le reste du §11 est conservé');
    assert.ok(rationale.reasons.some((r) => r.includes('rayon dominant 10px')), 'dérivation intacte');
  });
});

// ---------------------------------------------------------------------------
// M-2 — AUD-M2-02 : historique du ledger (unitaire, stores injectés)
// ---------------------------------------------------------------------------
describe('M-2 — historique du ledger : suppression, supersession, audit', () => {
  it('6. supersession : why = raison originale + date/source de création préservées', () => {
    const superseded = makeDecision({
      id: 'dmem-p2-sup',
      status: 'SUPERSEDED',
      recordedAt: '2026-10-01T10:00:00.000Z',
      supersededAt: '2026-10-05T10:00:00.000Z',
      supersededBy: 'user-2'
    });
    const ledger = buildDesignGovernanceLedger({
      tenantId: TENANT,
      projectId: PROJECT,
      generatedAt: FIXED_AT,
      ...emptyStores(),
      memoryStore: { list: () => [superseded] },
      auditStore: fakeAudit([])
    });
    const event = ledger.events.find((e) => e.id === 'gov:memory:dmem-p2-sup:supersede');
    assert.ok(event, 'événement de supersession présent');
    assert.equal(event.why, 'Raison originale importante', 'why de la décision conservé');
    assert.ok(event.what.includes('créée le 2026-10-01T10:00:00.000Z'), 'date de création préservée');
    assert.ok(event.what.includes('HUMAN'), 'source de création préservée');
    assert.equal(event.at, '2026-10-05T10:00:00.000Z', 'When = supersession');
    assert.equal(event.who, 'user-2');
    assert.equal(event.previous, 'ACTIVE');
    assert.equal(event.new, 'SUPERSEDED');
  });

  it('7. suppression direction : RESET ingéré avec previous réel ; UPDATED/autres projets JAMAIS dupliqués', () => {
    const directionReset: GovernanceAuditEventLike = {
      id: 'aud-p2-1',
      action: 'DESIGN_DIRECTION_RESET',
      resourceType: 'design_direction',
      resourceId: PROJECT,
      userId: 'system',
      metadata: { resetBy: 'alice', previousOverride: { style: 'Soft & Rounded' } },
      timestamp: '2026-11-09T10:00:00.000Z'
    };
    const directionUpdate: GovernanceAuditEventLike = {
      id: 'aud-p2-0',
      action: 'DESIGN_DIRECTION_UPDATED',
      resourceType: 'design_direction',
      resourceId: PROJECT,
      userId: 'system',
      metadata: { approvedBy: 'bob' },
      timestamp: '2026-11-08T10:00:00.000Z'
    };
    const memorySuperseded: GovernanceAuditEventLike = {
      id: 'aud-p2-2',
      action: 'DESIGN_MEMORY_SUPERSEDED',
      resourceType: 'design_memory',
      resourceId: 'dmem-x',
      userId: 'system',
      metadata: {},
      timestamp: '2026-11-08T11:00:00.000Z'
    };
    const foreignReset: GovernanceAuditEventLike = {
      id: 'aud-p2-3',
      action: 'DESIGN_DIRECTION_RESET',
      resourceType: 'design_direction',
      resourceId: 'another-project',
      userId: 'system',
      metadata: { resetBy: 'bob' },
      timestamp: '2026-11-08T12:00:00.000Z'
    };

    const ledger = buildDesignGovernanceLedger({
      tenantId: TENANT,
      projectId: PROJECT,
      generatedAt: FIXED_AT,
      ...emptyStores(), // état APRÈS suppression : le store ne renvoie plus l override
      auditStore: fakeAudit([directionReset, directionUpdate, memorySuperseded, foreignReset])
    });

    const directionEvents = ledger.events.filter((e) => e.source === 'design-direction');
    assert.equal(directionEvents.length, 1, 'exactement un événement direction (anti-duplication)');
    const event = directionEvents[0]!;
    assert.equal(event.id, 'gov:direction:reset:aud-p2-1');
    assert.equal(event.status, 'SUPERSEDED');
    assert.equal(event.previous, 'style=Soft & Rounded', 'previous = override réellement effacé');
    assert.equal(event.new, 'aucun override persistant');
    assert.equal(event.who, 'alice');
    assert.equal(event.at, '2026-11-09T10:00:00.000Z');

    assert.ok(!ledger.events.some((e) => e.id.includes('aud-p2-0')), 'UPDATED jamais ingéré (état couvert)');
    assert.ok(
      !ledger.events.some((e) => e.source === 'design-memory'),
      'supersession d audit jamais ingérée (état couvert)'
    );
    assert.ok(!ledger.events.some((e) => e.id.includes('aud-p2-3')), 'reset d un autre projet exclu');
    assert.equal(ledger.sources.audit, true);
    assert.equal(ledger.counts.directionOverride, 1);
    assert.equal(ledger.counts.total, ledger.events.length, 'counts cohérents');
  });

  it('8. suppression composant : previous statut/raison réels + isolation projet', () => {
    const componentReset: GovernanceAuditEventLike = {
      id: 'aud-p2-10',
      action: 'DESIGN_COMPONENT_OVERRIDE_RESET',
      resourceType: 'design_component',
      resourceId: 'button',
      userId: 'system',
      metadata: { projectId: PROJECT, by: 'carla', previousStatus: 'DEPRECATED', previousReason: 'Remplacé par action-v2' },
      timestamp: '2026-11-09T11:00:00.000Z'
    };
    const foreignComponentReset: GovernanceAuditEventLike = {
      id: 'aud-p2-11',
      action: 'DESIGN_COMPONENT_OVERRIDE_RESET',
      resourceType: 'design_component',
      resourceId: 'button',
      userId: 'system',
      metadata: { projectId: 'another-project', by: 'mallory', previousStatus: 'DISABLED' },
      timestamp: '2026-11-09T11:30:00.000Z'
    };
    const ledger = buildDesignGovernanceLedger({
      tenantId: TENANT,
      projectId: PROJECT,
      generatedAt: FIXED_AT,
      ...emptyStores(),
      auditStore: fakeAudit([componentReset, foreignComponentReset])
    });
    const componentEvents = ledger.events.filter((e) => e.source === 'design-component');
    assert.equal(componentEvents.length, 1, 'reset d un autre projet exclu');
    const event = componentEvents[0]!;
    assert.equal(event.id, 'gov:component:reset:aud-p2-10');
    assert.equal(event.status, 'SUPERSEDED');
    assert.equal(event.previous, 'DEPRECATED — raison : Remplacé par action-v2', 'previous = état réel effacé');
    assert.equal(event.new, 'aucun override persistant');
    assert.equal(event.who, 'carla');
    assert.equal(event.why, null, 'aucune raison de suppression inventée');
  });

  it('9. événements d audit antérieurs (sans métadonnées previous) : previous=null honnête — AUCUNE migration', () => {
    const legacyDirection: GovernanceAuditEventLike = {
      id: 'aud-p2-20',
      action: 'DESIGN_DIRECTION_RESET',
      resourceType: 'design_direction',
      resourceId: PROJECT,
      userId: 'system',
      metadata: { resetBy: 'studio-user' },
      timestamp: '2026-01-01T00:00:00.000Z'
    };
    const legacyComponent: GovernanceAuditEventLike = {
      id: 'aud-p2-21',
      action: 'DESIGN_COMPONENT_OVERRIDE_RESET',
      resourceType: 'design_component',
      resourceId: 'button',
      userId: 'system',
      metadata: { projectId: PROJECT, by: 'studio-user' },
      timestamp: '2026-01-01T00:00:01.000Z'
    };
    const ledger = buildDesignGovernanceLedger({
      tenantId: TENANT,
      projectId: PROJECT,
      generatedAt: FIXED_AT,
      ...emptyStores(),
      auditStore: fakeAudit([legacyDirection, legacyComponent])
    });
    const directionEvent = ledger.events.find((e) => e.id === 'gov:direction:reset:aud-p2-20');
    const componentEvent = ledger.events.find((e) => e.id === 'gov:component:reset:aud-p2-21');
    assert.ok(directionEvent && componentEvent);
    assert.equal(directionEvent.previous, null, 'métadonnée absente → previous null (pas de migration)');
    assert.equal(componentEvent.previous, null, 'métadonnée absente → previous null (pas de migration)');
    assert.equal(directionEvent.who, 'studio-user', 'acteur réel conservé');
  });

  it('10. audit défaillant (throw) : sources.audit=false, ledger utilisable, autres sources intactes', () => {
    const ledger = buildDesignGovernanceLedger({
      tenantId: TENANT,
      projectId: PROJECT,
      generatedAt: FIXED_AT,
      ...emptyStores(),
      auditStore: {
        query: () => {
          throw new Error('audit indisponible');
        }
      }
    });
    assert.equal(ledger.sources.audit, false, 'source défaillante signalée');
    assert.equal(ledger.sources.direction, true);
    assert.equal(ledger.sources.memory, true);
    assert.equal(ledger.sources.revisions, true);
    assert.equal(ledger.sources.components, true);
    assert.equal(ledger.events.length, 0, 'aucun événement fabriqué');
  });
});

// ---------------------------------------------------------------------------
// M-1/M-2 — HTTP réel : auditStore ↔ ledger, isolation tenant/projet
// ---------------------------------------------------------------------------
describe('M-1/M-2 — HTTP isolé : cohérence ledger/auditStore et isolation', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;
  let otherProjectId: string;

  before(async () => {
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const pres = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'P2 correction' })
    });
    assert.equal(pres.status, 201);
    const project = (await pres.json()) as { project?: { id?: string }; id?: string };
    projectId = String(project.project?.id ?? project.id);
    const pfres = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: CLEAN_HTML })
    });
    assert.ok(pfres.ok, 'index.html écrit');
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  async function getLedger(id: string, extraHeaders: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}/api/v1/projects/${id}/design/governance`, {
      headers: { ...headers, ...extraHeaders }
    });
    const body = (await res.json()) as {
      ledger?: {
        counts: Record<string, number>;
        sources: Record<string, boolean>;
        events: Array<{ id: string; source: string; status: string; at: string; who: string; what: string; why: string | null; previous: string | null; new: string; impact: string | null; approval: string | null }>;
      };
    };
    return { status: res.status, body };
  }

  it('11. PUT §6 : ledger trace l override actif, l UPDATED d audit n est PAS dupliqué', async () => {
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/direction`, {
      method: 'PUT', headers,
      body: JSON.stringify({ override: { style: 'Soft & Rounded', motion: 'Subtle' }, approvedBy: 'p2-approver' })
    });
    assert.equal(put.status, 200);

    const { status, body } = await getLedger(projectId);
    assert.equal(status, 200);
    const ledger = body.ledger!;
    const directionEvents = ledger.events.filter((e) => e.source === 'design-direction');
    assert.equal(directionEvents.length, 1, 'un seul événement direction (état actif)');
    assert.equal(directionEvents[0]!.status, 'ACTIVE');
    assert.equal(directionEvents[0]!.previous, null);
    assert.equal(directionEvents[0]!.approval, 'p2-approver');
    assert.ok(directionEvents[0]!.what.includes('style=Soft & Rounded'));

    // L audit contient bien l UPDATE — le ledger ne l ingère jamais.
    const updates = auditStore.query(TENANT, { action: 'DESIGN_DIRECTION_UPDATED' });
    assert.ok(updates.length >= 1, 'UPDATE bien journalisé côté audit');
    assert.equal(directionEvents.length, 1, 'pas de doublon ledger pour un UPDATE');

    // Source audit exposée (M-2).
    assert.equal(ledger.sources.audit, true);
    assert.equal(ledger.counts.total, ledger.events.length);
  });

  it('12. DELETE direction : suppression tracée avec previous réel, couplage exact ledger ↔ auditStore, pas de doublon', async () => {
    const del = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/direction?by=alice`, {
      method: 'DELETE', headers
    });
    assert.equal(del.status, 200);
    const delBody = (await del.json()) as { removed: boolean };
    assert.equal(delBody.removed, true);

    const { body } = await getLedger(projectId);
    const ledger = body.ledger!;
    const directionEvents = ledger.events.filter((e) => e.source === 'design-direction');
    assert.equal(directionEvents.length, 1, 'l état actuel (supprimé) remplace l événement actif');
    const event = directionEvents[0]!;
    assert.ok(event.id.startsWith('gov:direction:reset:'), event.id);
    assert.equal(event.status, 'SUPERSEDED');
    assert.equal(event.previous, 'style=Soft & Rounded, motion=Subtle', 'previous = override réel effacé');
    assert.equal(event.new, 'aucun override persistant');
    assert.equal(event.who, 'alice');
    assert.equal(event.why, null, 'aucune raison de suppression inventée');

    // Cohérence ledger ↔ auditStore : 1 RESET dans l audit ↔ 1 événement, id exact.
    const resets = auditStore.query(TENANT, { action: 'DESIGN_DIRECTION_RESET' });
    assert.equal(resets.length, 1, 'exactement un RESET journalisé');
    assert.equal(event.id, `gov:direction:reset:${resets[0]!.id}`, 'couplage exact ledger/auditStore');
    assert.equal(resets[0]!.resourceId, projectId);

    // Seconde suppression : removed=false → ni audit ni ledger supplémentaire.
    const del2 = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/direction?by=alice`, {
      method: 'DELETE', headers
    });
    const del2Body = (await del2.json()) as { removed: boolean };
    assert.equal(del2Body.removed, false);
    assert.equal(auditStore.query(TENANT, { action: 'DESIGN_DIRECTION_RESET' }).length, 1, 'pas de second RESET');
    const after = await getLedger(projectId);
    assert.equal(
      after.body.ledger!.events.filter((e) => e.source === 'design-direction').length,
      1,
      'pas de doublon ledger'
    );
  });

  it('13. DELETE composant : previous statut/raison réels tracés', async () => {
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/button`, {
      method: 'PUT', headers,
      body: JSON.stringify({ status: 'DISABLED', reason: 'Raison P2 du correctif', approvedBy: 'p2-approver' })
    });
    assert.equal(put.status, 200);

    const { body: beforeDel } = await getLedger(projectId);
    const activeComponent = beforeDel.ledger!.events.filter(
      (e) => e.source === 'design-component' && e.status === 'ACTIVE'
    );
    assert.equal(activeComponent.length, 1, 'override composant actif tracé (état)');
    assert.equal(activeComponent[0]!.why, 'Raison P2 du correctif');

    const del = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/button?by=carla`, {
      method: 'DELETE', headers
    });
    assert.equal(del.status, 200);

    const { body } = await getLedger(projectId);
    const componentEvents = body.ledger!.events.filter((e) => e.source === 'design-component');
    assert.equal(componentEvents.length, 1, 'état après suppression : le reset remplace l actif');
    const event = componentEvents[0]!;
    assert.ok(event.id.startsWith('gov:component:reset:'), event.id);
    assert.equal(event.status, 'SUPERSEDED');
    assert.equal(event.previous, 'DISABLED — raison : Raison P2 du correctif', 'previous = état réel effacé');
    assert.equal(event.who, 'carla');
    assert.equal(event.new, 'aucun override persistant');

    const resets = auditStore.query(TENANT, { action: 'DESIGN_COMPONENT_OVERRIDE_RESET' }).filter(
      (e) => e.resourceId === 'button' && (e.metadata as { projectId?: string } | undefined)?.projectId === projectId
    );
    assert.equal(resets.length, 1, 'un seul RESET composant pour ce projet');
    assert.equal(event.id, `gov:component:reset:${resets[0]!.id}`, 'couplage exact ledger/auditStore');
  });

  it('14. isolation tenant/projet : tenant étranger → 404 ; reset projet 2 absent du ledger projet 1', async () => {
    // Tenant B : même projectId → 404, aucun ledger.
    const foreign = await getLedger(projectId, { 'x-tenant-id': OTHER_TENANT });
    assert.equal(foreign.status, 404, 'projet du tenant A introuvable pour le tenant B');
    assert.equal(foreign.body.ledger, undefined, 'aucun ledger renvoyé');

    // Projet 2 (même tenant) : override + suppression → événement propre au projet 2.
    const pres = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'P2 projet 2' })
    });
    assert.equal(pres.status, 201);
    const project2 = (await pres.json()) as { project?: { id?: string }; id?: string };
    otherProjectId = String(project2.project?.id ?? project2.id);
    const put2 = await fetch(`${baseUrl}/api/v1/projects/${otherProjectId}/design/direction`, {
      method: 'PUT', headers,
      body: JSON.stringify({ override: { motion: 'None' }, approvedBy: 'p2-approver' })
    });
    assert.equal(put2.status, 200);
    const del2 = await fetch(`${baseUrl}/api/v1/projects/${otherProjectId}/design/direction?by=carla`, {
      method: 'DELETE', headers
    });
    assert.equal(del2.status, 200);

    const resets2 = auditStore
      .query(TENANT, { action: 'DESIGN_DIRECTION_RESET' })
      .filter((e) => e.resourceId === otherProjectId);
    assert.equal(resets2.length, 1, 'reset du projet 2 journalisé');

    const { body: ledger1 } = await getLedger(projectId);
    assert.ok(
      !ledger1.ledger!.events.some((e) => e.id === `gov:direction:reset:${resets2[0]!.id}`),
      'le reset du projet 2 n apparaît pas dans le ledger du projet 1'
    );

    const { body: ledger2 } = await getLedger(otherProjectId);
    const directionEvents2 = ledger2.ledger!.events.filter((e) => e.source === 'design-direction');
    assert.equal(directionEvents2.length, 1, 'ledger du projet 2 : son propre reset');
    assert.equal(directionEvents2[0]!.id, `gov:direction:reset:${resets2[0]!.id}`);
    assert.equal(directionEvents2[0]!.previous, 'motion=None', 'previous propre au projet 2');

    const resets1 = auditStore
      .query(TENANT, { action: 'DESIGN_DIRECTION_RESET' })
      .filter((e) => e.resourceId === projectId);
    assert.equal(resets1.length, 1, 'reset du projet 1 journalisé');
    assert.ok(
      !ledger2.ledger!.events.some((e) => e.id === `gov:direction:reset:${resets1[0]!.id}`),
      'le reset du projet 1 n apparaît pas dans le ledger du projet 2'
    );
  });
});
