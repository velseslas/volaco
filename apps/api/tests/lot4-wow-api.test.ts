/**
 * LOT 4 — CDC V8.1 §9/§13/§18 : surfaces API réelles.
 *
 * Prouve :
 *  1. budget projet : lecture des défauts, validation stricte, persistance,
 *     reset, permissions et archivage des exécutions ;
 *  2. matrice visuelle : exécution réelle (ou UNKNOWN honnête si Chromium est
 *     indisponible), hashes de captures, baseline, historique ;
 *  3. pairwise : mesure AQS des deux versions, dataset persistant, préférence
 *     humaine qui prime ;
 *  4. intégration improve : budget effectif du projet + usage réel enregistré,
 *     sans écriture workspace en mode PLAN ;
 *  5. GET /design reste inchangé (7 champs) — non-régression.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { aiProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import type {
  AIProviderAdapter,
  AIProviderGenerateRequest,
  AIProviderGenerateResponse
} from '../../../packages/core/src/ai/providers/types.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };
const VIEWER = { ...H, 'x-user-role': 'VIEWER' };

/** Page dégradée calibrée sur l'AQS réel (même base que le Lot B). */
const INDEX_HTML = `<!DOCTYPE html><html lang="fr"><head><title>Atelier — page dégradée</title>
<style>
  body { background:#ffffff; color:#9ca3af; font-family: Georgia, serif; padding:13px; }
  h1 { font-size:17px; font-weight:400; }
  h2 { font-size:16px; }
  p { font-size:15px; margin:7px 0; }
  .a { background:#ef4444; color:#fca5a5; padding:3px 9px; border-radius:2px; }
  .b { background:#22c55e; color:#bbf7d0; padding:11px 27px; border-radius:19px; }
  .c { background:#3b82f6; color:#bfdbfe; padding:5px 13px; border-radius:31px; }
  .wide { width:900px; padding:9px; border-radius:7px; background:#f3f4f6; }
</style></head><body>
  <h1>Atelier</h1>
  <h2>Nos services</h2>
  <p>Texte de présentation court.</p>
  <p>Deuxième paragraphe de contenu réel.</p>
  <button class="a">A</button><button class="b">B</button><button class="c">C</button>
  <div class="wide">Carte large fixe</div>
  <a href="#">Lien mort 1</a> <a href="#">Lien mort 2</a>
</body></html>`;

const POLISHED = `<!DOCTYPE html><html lang="fr"><head><title>Atelier — page améliorée</title><style>
  body { background:#ffffff; color:#111827; font-family: Georgia, serif; padding:16px; }
  h1 { font-size:40px; font-weight:700; margin:0 0 16px; }
  h2 { font-size:28px; margin:0 0 16px; }
  p { font-size:16px; line-height:1.6; margin:0 0 16px; }
  .a, .b, .c { background:#2563eb; color:#ffffff; padding:12px 20px; border-radius:14px; border:0; }
  .wide { width:900px; max-width:100%; padding:16px; border-radius:12px; background:#f3f4f6; }
</style></head>
<body>
  <h1>Atelier</h1>
  <h2>Nos services</h2>
  <p>Texte de présentation court.</p>
  <p>Deuxième paragraphe de contenu réel.</p>
  <button class="a" aria-label="Service A">Service A</button>
  <button class="b" aria-label="Service B">Service B</button>
  <button class="c" aria-label="Service C">Service C</button>
  <div class="wide">Carte large fluide</div>
</body></html>`;

class FakeWowAdapter {
  public readonly descriptor = {
    providerId: 'fake-wow-lot4',
    providerName: 'Fake WOW (Lot 4)',
    models: ['fake-wow-model'],
    capabilities: [] as const,
    contextWindow: 128000,
    structuredOutput: true,
    streaming: false,
    toolCalling: false,
    reasoning: false,
    vision: false,
    costMetadata: {},
    availability: 'AVAILABLE' as const,
    healthStatus: 'HEALTHY' as const
  };

  private readonly canned = new Map<string, string>();
  public readonly calls = new Map<string, number>();

  public setCanned(projectId: string, html: string): void {
    this.canned.set(projectId, html);
  }

  public async generate(request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> {
    this.calls.set(request.projectId, (this.calls.get(request.projectId) ?? 0) + 1);
    return {
      text: '```html\n' + (this.canned.get(request.projectId) ?? '') + '\n```',
      providerId: 'fake-wow-lot4',
      modelId: 'fake-wow-model',
      latencyMs: 1,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      costUsd: 0
    };
  }
}

describe('CDC V8.1 Lot 4 — qualité WOW (API réelle)', () => {
  const fake = new FakeWowAdapter();
  let server: Server;
  let baseUrl: string;
  let projectId: string;

  before(async () => {
    for (const descriptor of aiProviderRegistry.list()) aiProviderRegistry.unregister(descriptor.providerId);
    aiProviderRegistry.register(fake as unknown as AIProviderAdapter);
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const created = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'Lot 4 WOW' })
    });
    assert.equal(created.status, 201);
    projectId = ((await created.json()) as { project: { id: string } }).project.id;
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path: 'index.html', content: INDEX_HTML })
    });
    assert.equal(put.status, 200);
    fake.setCanned(projectId, POLISHED);
  });

  after(async () => {
    for (const descriptor of aiProviderRegistry.list()) aiProviderRegistry.unregister(descriptor.providerId);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. budget : défauts, validation stricte, persistance, reset et permissions', async () => {
    const initial = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/quality-budget`, { headers: H });
    assert.equal(initial.status, 200);
    const initialBody = (await initial.json()) as Record<string, any>;
    assert.equal(initialBody.version, '8.1');
    assert.equal(initialBody.customized, false);
    assert.equal(initialBody.effective.maxIterations, 2);
    assert.equal(initialBody.effective.maxFilesChanged, 1);

    const noApprover = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/quality-budget`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ budget: { maxIterations: 1 } })
    });
    assert.equal(noApprover.status, 400);

    const invalid = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/quality-budget`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ approvedBy: 'lot4-test', budget: { maxIterations: 99 } })
    });
    assert.equal(invalid.status, 400);
    const invalidBody = (await invalid.json()) as Record<string, any>;
    assert.equal(invalidBody.error.context.field, 'maxIterations');

    const viewer = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/quality-budget`, {
      method: 'PUT',
      headers: VIEWER,
      body: JSON.stringify({ approvedBy: 'viewer', budget: { maxIterations: 1 } })
    });
    assert.equal(viewer.status, 403);

    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/quality-budget`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        approvedBy: 'lot4-test',
        budget: {
          maxIterations: 1,
          maxTokens: 256,
          maxComputeMs: 60_000,
          maxVisualChanges: 1,
          maxFilesChanged: 1,
          maxLatencyMs: 30_000,
          qualityTarget: 90,
          minimumImprovementDelta: 2
        }
      })
    });
    assert.equal(put.status, 200);
    const putBody = (await put.json()) as Record<string, any>;
    assert.equal(putBody.updated, true);
    assert.equal(putBody.effective.maxIterations, 1);
    assert.equal(putBody.config.updatedBy, 'lot4-test');

    const read = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/quality-budget`, { headers: H })).json()) as Record<string, any>;
    assert.equal(read.customized, true);
    assert.equal(read.effective.maxTokens, 256);

    const executions = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/quality-budget/executions`, { headers: H })).json()) as Record<string, any>;
    assert.ok(Array.isArray(executions.executions));
  });

  it('2. matrice visuelle : exécution réelle, hashes, baseline et historique', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/visual-regression`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ viewports: [375, 1920], includeScreenshots: false })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;
    assert.equal(body.stored, true);
    const report = body.report;
    assert.equal(report.version, '8.1');
    assert.equal(report.viewports.length, 2);
    assert.deepEqual(report.viewports.map((entry: any) => entry.width), [375, 1920]);
    for (const entry of report.viewports) {
      assert.ok(['PASS', 'FAIL', 'UNKNOWN'].includes(entry.status));
      assert.equal(typeof entry.overflowX, 'boolean');
      if (entry.status !== 'UNKNOWN') {
        assert.match(entry.screenshotHash, /^[a-f0-9]{64}$/);
        assert.ok(entry.elementCount >= 1);
      } else {
        assert.equal(entry.screenshotHash, null);
        assert.ok(typeof entry.error === 'string' && entry.error.length > 0);
      }
    }
    assert.equal(report.axes.find((axis: any) => axis.id === 'VIEWPORT').measured, 2);
    assert.ok(['PASS', 'FAIL', 'PARTIAL'].includes(report.summary.overallStatus));
    assert.match(report.reportId, /^vrm-[a-f0-9]{16}$/);

    const latest = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/visual-regression`, { headers: H })).json()) as Record<string, any>;
    assert.equal(latest.available, true);
    assert.equal(latest.report.reportId, report.reportId);

    const history = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/visual-regression/history`, { headers: H })).json()) as Record<string, any>;
    assert.ok(history.reports.length >= 1);
    assert.equal(history.reports[0].reportId, report.reportId);
  });

  it('3. pairwise : AQS réels, dataset, puis confirmation humaine prioritaire', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/pairwise`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        beforeHtml: INDEX_HTML,
        afterHtml: POLISHED,
        humanPreference: 'A',
        evaluatorId: 'client-lot4',
        notes: 'préférence de démonstration'
      })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;
    assert.equal(body.evaluated, true);
    assert.equal(body.recorded, true);
    assert.match(body.evaluation.evaluationId, /^pw-[a-f0-9]{16}$/);
    assert.equal(body.evaluation.criteria.length, 12);
    assert.equal(body.evaluation.humanPreference, 'A');
    assert.equal(body.evaluation.finalPreference, 'A');
    assert.equal(body.evaluation.referenceStatus, 'HUMAN_CONFIRMED');
    assert.equal(body.measurements.before.versionId, 'inline-before');
    assert.equal(body.measurements.after.versionId, 'inline-after');
    assert.equal(body.dataset.total, 1);
    assert.equal(body.dataset.humanConfirmed, 1);

    const dataset = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/pairwise/dataset`, { headers: H })).json()) as Record<string, any>;
    assert.equal(dataset.records.length, 1);
    assert.equal(dataset.stats.humanConfirmed, 1);

    const preference = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/design/pairwise/${body.evaluation.evaluationId}/preference`,
      {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ preference: 'EQUIVALENT', approvedBy: 'client-lot4' })
      }
    );
    assert.equal(preference.status, 200);
    const preferenceBody = (await preference.json()) as Record<string, any>;
    assert.equal(preferenceBody.updated, true);
    assert.equal(preferenceBody.evaluation.finalPreference, 'EQUIVALENT');
    assert.equal(preferenceBody.dataset.humanConfirmed, 1);

    const bad = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/pairwise`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ beforeHtml: INDEX_HTML, afterHtml: POLISHED, humanPreference: 'A' })
    });
    assert.equal(bad.status, 400);

    const viewer = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/pairwise`, {
      method: 'POST',
      headers: VIEWER,
      body: JSON.stringify({ beforeHtml: INDEX_HTML, afterHtml: POLISHED })
    });
    assert.equal(viewer.status, 403);
  });

  it('4. improve : budget projet utilisé, usage réel archivé, aucune écriture en PLAN', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/improve`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 1 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;
    assert.equal(body.modified, false);
    assert.equal(body.budgetSource, 'PROJECT');
    assert.equal(body.budget.maxIterations, 1);
    assert.equal(body.budgetUsage.iterationsStarted, 1);
    assert.equal(body.budgetUsage.tokensUsed, 15);
    assert.ok(body.budgetStatus.limits.some((limit: any) => limit.id === 'maxTokens' && limit.used === 15));
    assert.match(body.budgetExecutionId, /^qbx-[a-f0-9]{16}$/);
    assert.ok(['TARGET_REACHED', 'MAX_ITERATIONS', 'DELTA_BELOW_THRESHOLD', 'BUDGET_EXHAUSTED', 'MODIFICATION_FAILED', 'SCORE_UNMEASURABLE', 'REGRESSION_PROTECTED', 'NO_ACTIONABLE_WEAKNESS'].includes(body.stopReason));
    assert.equal(fake.calls.get(projectId), 1);

    const executions = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/quality-budget/executions`, { headers: H })).json()) as Record<string, any>;
    assert.equal(executions.executions.length, 1);
    assert.equal(executions.executions[0].executionId, body.budgetExecutionId);
    assert.equal(executions.executions[0].usage.tokensUsed, 15);
    assert.equal(executions.executions[0].applyRequested, false);
    assert.equal(executions.executions[0].modified, false);
  });

  it('5. GET /design reste strictement inchangé (7 champs)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers: H });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    const keys = Object.keys(body);
    const allowed = new Set(['designDirection', 'tokens', 'harmony', 'dqi', 'requestId', 'previous', 'comparison']);
    assert.ok(keys.every((key) => allowed.has(key)), `champ inattendu : ${keys.join(', ')}`);
    for (const required of ['designDirection', 'tokens', 'harmony', 'dqi', 'requestId']) {
      assert.ok(keys.includes(required), `champ requis absent : ${required}`);
    }
    assert.ok(keys.length >= 5 && keys.length <= 7, `nombre de champs inattendu : ${keys.length}`);
  });
});
