/**
 * LOT B — CDC V8 §17-§21 : boucle d'amélioration RÉELLE exposée par l'API.
 *
 * Prouve, avec Chromium réel et un adaptateur IA factice (aucune clé) :
 *  1. mode PLAN (défaut) : la boucle mesure l'AQS réel, produit le plan §21
 *     (WHY/WHAT/IMPACT/RISKS), la comparaison §20 et les garde-fous §19 —
 *     SANS JAMAIS écrire dans le workspace (contrôle humain) ;
 *  2. APPLY sans `approvedBy` => 400 (aucune modification silencieuse) ;
 *  3. APPLY approuvé => HTML écrit + checkpoint AVANT + révision ; le
 *     Rollback via la route révisions restaure réellement l'état initial ;
 *  4. un patch esthétiquement meilleur mais qui CASSE le fonctionnel
 *     (erreur runtime) est refusé par le garde-fou §19 : aucune écriture ;
 *  5. sans fournisseur IA => 503 honnête ; projet inconnu => 404.
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

/** Page RÉELLEMENT dégradée : hiérarchie plate, espacements arbitraires,
 *  composants hétérogènes, contraste faible, carte fixe 900px (overflow). */
const DEGRADED = `<!DOCTYPE html><html><head><title>Atelier — page dégradée</title>
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

/**
 * Page AMÉLIORÉE : mêmes contenus que DEGRADED, corrections ciblées mesurées
 * (hiérarchie 40/28/16, espacements sur grille, composants unifiés, contraste
 * conforme, carte fluide). Calibrée sur l'AQS réel : +25 pts SANS aucune
 * dimension en régression (balance +1, densité −1 dans la tolérance).
 */
const POLISHED = `<!DOCTYPE html><html><head><title>Atelier — page améliorée</title><style>
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

/** Patch esthétique parfait... mais qui casse le runtime (§19 functional). */
const BROKEN_POLISHED = POLISHED.replace('</body>', '<script>throw new Error("LOT-B-RUNTIME-CASSE");</script></body>');

class ScriptedImproveAdapter {
  public readonly descriptor = {
    providerId: 'fake-improve-lotb',
    providerName: 'Fake Improve (Lot B)',
    models: ['fake-improve-model'],
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

  private canned = new Map<string, string>();
  private calls = new Map<string, number>();

  public setCanned(projectId: string, html: string): void {
    this.canned.set(projectId, html);
  }

  public callsFor(projectId: string): number {
    return this.calls.get(projectId) ?? 0;
  }

  public async generate(request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> {
    this.calls.set(request.projectId, (this.calls.get(request.projectId) ?? 0) + 1);
    return {
      text: '```html\n' + (this.canned.get(request.projectId) ?? '') + '\n```',
      providerId: 'fake-improve-lotb',
      modelId: 'fake-improve-model',
      latencyMs: 1,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      costUsd: 0
    };
  }
}

interface ImproveResponse {
  modified: boolean;
  applyRequested: boolean;
  approvedBy: string | null;
  improved: boolean;
  initialAqs: number | null;
  finalAqs: number | null;
  totalDelta: number | null;
  target: number;
  targetReached: boolean;
  stopReason: string;
  iterations: {
    iteration: number;
    plan: { planId: string; weaknesses: { dimension: string }[]; proposals: { why: string; what: string; impact: string; risks: string[] }[] };
    aqsBefore: number | null;
    aqsAfter: number | null;
    delta: number | null;
    accepted: boolean;
    guardVerdict: string | null;
    guards: { guard: string; status: string }[];
    comparison: { recommendation: string; noRegressionDetected: boolean; improvements: string[]; conclusion: string } | null;
    report: { why: string[]; what: string[]; impact: string; before: number | null; after: number | null; scoreDelta: number | null; risks: string[] };
  }[];
  comparison: { recommendation: string; conclusion: string } | null;
  actions: { accept: string | null; reject: string; compare: string; rollback: string };
  revisionId?: string;
  rollbackRevisionId?: string;
}

describe('CDC V8 Lot B — boucle design amélioration §17-§21 (API réelle)', () => {
  const scripted = new ScriptedImproveAdapter();
  let server: Server;
  let baseUrl: string;

  before(async () => {
    for (const descriptor of aiProviderRegistry.list()) aiProviderRegistry.unregister(descriptor.providerId);
    aiProviderRegistry.register(scripted as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function createProject(name: string, html: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name })
    });
    assert.equal(res.status, 201);
    const projectId = ((await res.json()) as { project: { id: string } }).project.id;
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path: 'index.html', content: html })
    });
    assert.equal(put.status, 200);
    return projectId;
  }

  async function readIndex(projectId: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, { headers: H });
    assert.equal(res.status, 200);
    return ((await res.json()) as { file: { content: string } }).file.content;
  }

  it('1. PLAN : la boucle mesure, planifie et compare — sans écrire dans le workspace', async () => {
    const projectId = await createProject('Lot B — PLAN', DEGRADED);
    scripted.setCanned(projectId, POLISHED);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/improve`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 1 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as ImproveResponse;

    assert.equal(body.modified, false, 'mode PLAN : aucune écriture');
    assert.equal(body.applyRequested, false);
    assert.equal(body.approvedBy, null);
    assert.equal(
      body.improved,
      true,
      'une amélioration a été trouvée et acceptée en mémoire — ' + JSON.stringify({
        initial: body.initialAqs,
        final: body.finalAqs,
        stopReason: body.stopReason,
        delta: body.iterations[0]?.delta,
        guards: body.iterations[0]?.guards,
        comparison: body.iterations[0]?.comparison
      })
    );
    assert.ok(body.initialAqs !== null && body.finalAqs !== null);
    assert.ok(body.finalAqs! > body.initialAqs!, 'l’AQS réel progresse réellement');
    assert.ok(body.totalDelta! > 0);
    assert.equal(body.iterations.length, 1);

    const iteration = body.iterations[0]!;
    // §17/§21 — plan WHY / WHAT / IMPACT / RISKS dérivé des faiblesses mesurées.
    assert.ok(iteration.plan.planId.startsWith('imp-1-'));
    assert.ok(iteration.plan.weaknesses.length >= 1, 'au moins une faiblesse mesurée');
    assert.ok(iteration.plan.proposals.length >= 1);
    assert.ok(iteration.plan.proposals[0]!.why.length > 10);
    assert.ok(iteration.plan.proposals[0]!.what.length > 10);
    assert.ok(iteration.plan.proposals[0]!.impact.includes('+'));
    assert.ok(iteration.plan.proposals[0]!.risks.length >= 1);
    assert.ok(iteration.report.why.length >= 1 && iteration.report.risks.length >= 1);
    assert.equal(iteration.report.before, iteration.aqsBefore);
    assert.equal(iteration.report.after, iteration.aqsAfter);
    assert.equal(iteration.report.scoreDelta, iteration.delta);

    // §20 — comparaison A/B + verdict automatique.
    assert.ok(iteration.comparison, 'comparaison A/B présente');
    assert.equal(iteration.comparison!.noRegressionDetected, true);
    assert.equal(iteration.comparison!.recommendation, 'ACCEPT');
    assert.ok(iteration.comparison!.improvements.length >= 1);
    assert.ok(iteration.comparison!.conclusion.includes('Recommendation: ACCEPT.'));
    assert.equal(iteration.accepted, true);

    // §19 — les garde-fous réels sont exposés.
    assert.equal(iteration.guardVerdict, 'APPROVE');
    assert.deepEqual(iteration.guards.map((g) => g.guard), ['FUNCTIONAL', 'ACCESSIBILITY', 'SECURITY', 'RESPONSIVE', 'REGRESSION']);

    // §21 — Accept possible ; le workspace est resté INTACT.
    assert.ok(body.actions.accept && body.actions.accept.includes('"apply": true'));
    assert.equal(await readIndex(projectId), DEGRADED, 'aucune modification silencieuse en mode PLAN');
  });

  it('2. APPLY sans approvedBy => 400 : le contrôle humain est obligatoire', async () => {
    const projectId = await createProject('Lot B — sans approbation', DEGRADED);
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/improve`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ apply: true, maxIterations: 1 })
    });
    assert.equal(res.status, 400);
    assert.equal(scripted.callsFor(projectId), 0, 'aucun appel LLM avant approbation');
    assert.equal(await readIndex(projectId), DEGRADED);
  });

  it('3. APPLY approuvé : écriture + checkpoint + Rollback réel vers l’état initial', async () => {
    const projectId = await createProject('Lot B — APPLY approuvé', DEGRADED);
    scripted.setCanned(projectId, POLISHED);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/improve`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ apply: true, approvedBy: 'faycal', maxIterations: 1 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as ImproveResponse;
    assert.equal(
      body.modified,
      true,
      'APPLY doit écrire après approbation — ' + JSON.stringify({
        initial: body.initialAqs,
        final: body.finalAqs,
        stopReason: body.stopReason,
        guards: body.iterations[0]?.guards,
        comparison: body.iterations[0]?.comparison
      })
    );
    assert.equal(body.approvedBy, 'faycal');
    assert.ok(body.revisionId, 'révision de l’amélioration enregistrée');
    assert.ok(body.rollbackRevisionId, 'checkpoint AVANT enregistré');
    assert.ok(body.actions.rollback.includes('/rollback'));

    const saved = await readIndex(projectId);
    assert.ok(saved.includes('Carte large fluide'), 'le HTML amélioré est réellement écrit');
    assert.ok(!saved.includes('Carte large fixe'), 'le HTML d’origine (dégradé) a bien été remplacé');
    assert.ok(saved.includes('font-size:40px'), 'les corrections mesurées sont présentes');

    const rollback = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/revisions/${body.rollbackRevisionId}/rollback`,
      { method: 'POST', headers: H, body: JSON.stringify({}) }
    );
    assert.equal(rollback.status, 200);
    assert.equal(await readIndex(projectId), DEGRADED, 'Rollback §21 restaure EXACTEMENT l’état initial');
  });

  it('4. un patch meilleur esthétiquement mais cassé fonctionnellement est REFUSÉ (§19)', async () => {
    const projectId = await createProject('Lot B — garde-fou fonctionnel', DEGRADED);
    scripted.setCanned(projectId, BROKEN_POLISHED);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/improve`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ apply: true, approvedBy: 'faycal', maxIterations: 1 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as ImproveResponse;
    assert.equal(body.improved, false);
    assert.equal(body.modified, false, 'rollback : rien n’est écrit');
    assert.equal(body.stopReason, 'REGRESSION_PROTECTED');
    const iteration = body.iterations[0]!;
    assert.ok(iteration.aqsAfter !== null && iteration.aqsBefore !== null);
    assert.ok(iteration.aqsAfter! > iteration.aqsBefore!, 'le patch était bien meilleur esthétiquement');
    assert.equal(iteration.guardVerdict, 'ROLLBACK');
    assert.equal(iteration.guards.find((g) => g.guard === 'FUNCTIONAL')!.status, 'FAIL');
    assert.equal(iteration.accepted, false);
    assert.equal(await readIndex(projectId), DEGRADED, 'le HTML cassé n’a jamais été persisté');
  });

  it('5. sans fournisseur IA => 503 ; projet inconnu => 404', async () => {
    const projectId = await createProject('Lot B — sans fournisseur', DEGRADED);
    for (const descriptor of aiProviderRegistry.list()) aiProviderRegistry.unregister(descriptor.providerId);
    try {
      const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/improve`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ maxIterations: 1 })
      });
      assert.equal(res.status, 503);
      assert.equal(await readIndex(projectId), DEGRADED);
    } finally {
      aiProviderRegistry.register(scripted as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    }

    const missing = await fetch(`${baseUrl}/api/v1/projects/proj_lot_b_absent/design/improve`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({})
    });
    assert.equal(missing.status, 404);
  });
});
