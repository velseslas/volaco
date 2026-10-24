/**
 * V7 — BRANCHEMENTS DU FLUX RÉEL :
 *  - Impact Intelligence est consultée avant une modification (résultat réel
 *    ou indisponibilité explicite, jamais de faux score) ;
 *  - l'Application Model est rafraîchi après une mutation persistée, et un
 *    échec de rafraîchissement ne casse jamais la génération.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assessStreamImpact,
  assessStreamDecision,
  assessConfiguredStreamDecision,
  configureApplicationModelRefresher,
  configureStreamDecisionAdvisor,
  refreshApplicationModelAfterMutation,
  type StreamDecisionInput,
  type StreamDecisionSummary
} from '../src/routes/conversation.js';
import {
  configureValidationRoute,
  runValidationChain
} from '../src/routes/validation.js';
import {
  configureDecideRoute,
  produceAdvisoryDecision
} from '../src/routes/decide.js';
import { fileStore } from '../../../packages/core/src/file-explorer/index.js';
import { CodeIntelligenceService } from '../../../packages/core/src/ai-native/understanding/service.js';
import { FileStoreAdapter } from '../../../packages/core/src/ai-native/mutation-orchestrator/filesystem/adapter.js';
import { DecisionEngine } from '../../../packages/core/src/ai-native/decision-engine/decision-engine.js';
import { ConstraintRegistry } from '../../../packages/core/src/ai-native/decision-engine/constraint-registry.js';
import { DecisionLedger } from '../../../packages/core/src/ai-native/decision-engine/decision-ledger.js';
import { AlternativeGenerator } from '../../../packages/core/src/ai-native/decision-engine/alternative-generator.js';
import { AnalystRegistry } from '../../../packages/core/src/ai-native/intelligence-pool/analysts/index.js';

const impactRequest = {
  tenantId: 'studio-local',
  projectId: 'proj_v7_wiring',
  targetFiles: ['index.html']
};

describe('V7 — Impact Intelligence sur le flux principal', () => {
  it('sans service configuré : indisponible, aucun résultat fabriqué', () => {
    const outcome = assessStreamImpact(undefined, impactRequest, 'ENGINEER', 'req_test');
    assert.equal(outcome.available, false);
    if (!outcome.available) {
      assert.equal(outcome.reason, 'service-non-configure');
    }
  });

  it('analyse réelle : risque, nœuds impactés et politique de confirmation', () => {
    const outcome = assessStreamImpact(
      {
        analyzeImpact: () => ({
          overallRisk: 'HIGH',
          impactedNodes: [{}, {}],
          durationMs: 12,
          metrics: {
            totalImpactedNodes: 2,
            breakingCount: 1,
            routesAffectedCount: 0,
            layersCrossedCount: 1
          }
        })
      },
      impactRequest,
      'ENGINEER',
      'req_test'
    );

    assert.equal(outcome.available, true);
    if (outcome.available) {
      assert.equal(outcome.summary.riskLevel, 'HIGH');
      assert.equal(outcome.summary.requiresConfirmation, true);
      assert.equal(outcome.summary.totalImpactedNodes, 2);
      assert.equal(outcome.summary.breakingCount, 1);
      assert.equal(outcome.summary.durationMs, 12);
      assert.deepEqual(outcome.summary.targetFiles, ['index.html']);
    }
  });

  it('échec du moteur : indisponible avec la raison, jamais d’exception', () => {
    const outcome = assessStreamImpact(
      {
        analyzeImpact: () => {
          throw new Error('graphe indisponible');
        }
      },
      impactRequest,
      'ENGINEER',
      'req_test'
    );

    assert.equal(outcome.available, false);
    if (!outcome.available) {
      assert.match(outcome.reason, /graphe indisponible/);
    }
  });
});

describe('V7 — Application Model rafraîchi après mutation', () => {
  it('appelle le rafraîchisseur avec le contexte exact', () => {
    const received: unknown[] = [];
    configureApplicationModelRefresher((input) => {
      received.push(input);
    });

    const result = refreshApplicationModelAfterMutation({
      tenantId: 'studio-local',
      projectId: 'proj_v7_wiring',
      role: 'ENGINEER',
      requestId: 'req_test'
    });

    assert.deepEqual(result, { refreshed: true });
    assert.deepEqual(received, [{
      tenantId: 'studio-local',
      projectId: 'proj_v7_wiring',
      role: 'ENGINEER',
      requestId: 'req_test'
    }]);
  });

  it('un rafraîchissement en échec est signalé mais ne jette pas', () => {
    configureApplicationModelRefresher(() => {
      throw new Error('sources indisponibles');
    });

    const result = refreshApplicationModelAfterMutation({
      tenantId: 'studio-local',
      projectId: 'proj_v7_wiring',
      role: 'ENGINEER',
      requestId: 'req_test'
    });

    assert.equal(result.refreshed, false);
    assert.match(result.reason ?? '', /sources indisponibles/);
  });
});

describe('V7-WIRE-3 — Validation Chain sur l’action d’ingénierie', () => {
  const tenantId = 'studio-local';
  const projectId = 'proj_v7_validation';
  const html = [
    '<!DOCTYPE html>',
    '<html lang="fr"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Validation V7</title></head>',
    '<body style="background:#0f172a;color:#f8fafc;font-family:system-ui">',
    '<main><h1>Bienvenue V7</h1>',
    '<p>Une page lisible avec un contraste suffisant et une action explicite.</p>',
    '<button type="button" style="min-height:44px;padding:12px 20px">Commencer</button>',
    '</main></body></html>'
  ].join('\n');

  it('la chaîne réelle valide le HTML persisté (5 étapes, verdict PASS)', async () => {
    fileStore.saveFile(tenantId, projectId, 'index.html', html);
    configureValidationRoute({
      codeIntelService: new CodeIntelligenceService(new FileStoreAdapter(fileStore))
    });

    const report = await runValidationChain(
      { tenantId, projectId, entryFile: 'index.html' },
      'ENGINEER',
      'req_v7_validation'
    );

    assert.equal(report.verdict, 'PASS');
    assert.equal(report.stages.length, 5);
    assert.deepEqual(
      report.stages.map((stage) => stage.id),
      ['files', 'syntax', 'a11y', 'design', 'tests']
    );
    assert.equal(report.stages[0]?.status, 'PASS');
    assert.equal(report.entryFile, 'index.html');
    assert.match(report.reportHash, /^[a-f0-9]{64}$/);
  });

  it('le flux branche la chaîne après persistance et expose done.validation', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'apps/api/src/routes/conversation.ts'),
      'utf8'
    );
    assert.ok(src.includes('runValidationChain'), 'le flux exécute la chaîne réelle');
    assert.ok(src.includes('validationChainSummary'), 'le verdict est synthétisé');
    assert.ok(
      src.includes('validation: validationChainSummary'),
      'le verdict part dans done.validation'
    );
  });

  it('le Studio affiche l’impact réel dans la carte d’exécution', () => {
    const studio = readFileSync(
      resolve(process.cwd(), 'apps/studio/index.html'),
      'utf8'
    );
    assert.ok(
      studio.includes("event.type === 'on_impact_assessed'"),
      'la frame d’impact est consommée'
    );
    assert.ok(studio.includes('Analyse d’impact'), 'le libellé est explicite');
    assert.ok(studio.includes('vl-advisory'), 'un canal visible survit à la ligne de progression');
    assert.ok(studio.includes("activityFeed.advise('impact'"), 'l’impact alimente ce canal');
    assert.ok(studio.includes("activityFeed.advise('validation'"), 'la validation alimente ce canal');
  });
});

describe('V7-WIRE-3 — Decision Engine consultatif dans le flux', () => {
  const summary: StreamDecisionSummary = {
    decisionId: 'dec-test',
    verdict: 'READY',
    intentCategory: 'MODIFY',
    alternatives: 2,
    viableAlternatives: 2,
    chosenAlternative: {
      label: 'Mettre à jour le titre',
      riskScore: 10,
      reversible: true,
      estimatedEffort: 'LOW'
    },
    requiredClarifications: [],
    contradictingDecisions: 0,
    rationale: 'Aucune contrainte HARD violée.',
    recorded: false
  };

  const input: StreamDecisionInput = {
    tenantId: 'studio-local',
    projectId: 'proj_v7_decision',
    sessionId: 'sess_v7_decision',
    intent: {
      category: 'MODIFY',
      goal: 'modifier le titre principal',
      requestedAction: 'modify',
      entities: [],
      constraints: [],
      urgency: 'NORMAL',
      confidence: 0.9,
      ambiguities: []
    }
  };

  it('sans conseiller : indisponible, aucune décision fabriquée', async () => {
    const outcome = await assessStreamDecision(undefined, input);
    assert.equal(outcome.available, false);
    if (!outcome.available) {
      assert.equal(outcome.reason, 'service-non-configure');
    }
  });

  it('conseiller réel : contexte exact, verdict et alternative remontés', async () => {
    const received: StreamDecisionInput[] = [];
    const outcome = await assessStreamDecision(async (context) => {
      received.push(context);
      return summary;
    }, input);

    assert.equal(outcome.available, true);
    if (outcome.available) {
      assert.equal(outcome.summary.verdict, 'READY');
      assert.equal(outcome.summary.chosenAlternative?.label, 'Mettre à jour le titre');
      assert.equal(outcome.summary.recorded, false);
    }
    assert.deepEqual(received, [input]);
  });

  it('échec du moteur : indisponible avec la raison, jamais d’exception', async () => {
    const outcome = await assessStreamDecision(async () => {
      throw new Error('contraintes illisibles');
    }, input);

    assert.equal(outcome.available, false);
    if (!outcome.available) {
      assert.match(outcome.reason, /contraintes illisibles/);
    }
  });

  it('configuration serveur : la variante branchée utilise le conseiller injecté', async () => {
    configureStreamDecisionAdvisor(async () => summary);
    const outcome = await assessConfiguredStreamDecision(input);
    assert.equal(outcome.available, true);
    if (outcome.available) {
      assert.equal(outcome.summary.decisionId, 'dec-test');
    }
    configureStreamDecisionAdvisor(undefined);
  });

  it('décision réelle : verdict calculé, Decision Ledger INCHANGÉ (record:false)', async () => {
    const ledger = new DecisionLedger({
      fileName: `v7-decisions-${Date.now()}-${Math.random().toString(36).slice(2)}`
    });
    configureDecideRoute({
      decisionEngine: new DecisionEngine({
        constraintRegistry: new ConstraintRegistry({ adrDir: '/nonexistent' }),
        decisionLedger: ledger,
        alternativeGenerator: new AlternativeGenerator()
      }),
      analystRegistry: new AnalystRegistry(),
      fileStore
    });

    const before = ledger.count();
    const real = await produceAdvisoryDecision(input);

    assert.ok(real, 'la décision consultative doit être produite');
    assert.equal(real.recorded, false);
    assert.equal(ledger.count(), before, 'le ledger ne doit pas grossir');
    assert.ok(
      ['READY', 'NEEDS_CONFIRMATION', 'BLOCKED', 'DEFERRED'].includes(real.verdict),
      `verdict inattendu : ${real.verdict}`
    );
    assert.equal(real.intentCategory, 'MODIFY');
    assert.ok(real.alternatives >= 1);
  });

  it('le flux branche la décision avant le plan et le Studio l’affiche', () => {
    const conversation = readFileSync(
      resolve(process.cwd(), 'apps/api/src/routes/conversation.ts'),
      'utf8'
    );
    assert.ok(conversation.includes('assessConfiguredStreamDecision'), 'le flux évalue la décision');
    assert.ok(conversation.includes("type: 'DECISION_ASSESSED'"), 'la décision est persistée');
    assert.ok(conversation.includes('decision: decisionSummary'), 'done.decision est exposé');

    const studio = readFileSync(
      resolve(process.cwd(), 'apps/studio/index.html'),
      'utf8'
    );
    assert.ok(
      studio.includes("event.type === 'on_decision_assessed'"),
      'la frame de décision est consommée'
    );
    assert.ok(studio.includes('Décision d’ingénierie'), 'le libellé est explicite');
    assert.ok(studio.includes("activityFeed.advise('decision'"), 'la décision alimente le canal visible');
  });
});
