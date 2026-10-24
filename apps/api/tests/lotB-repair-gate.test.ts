/**
 * LOT B — CDC V8 §19 : le gate AQS de la réparation (migration des gates
 * design vers l'AQS).
 *
 * Prouve que la boucle Self-Repair existante conserve son gate fonctionnel
 * legacy, mais refuse désormais un patch qui corrige les erreurs runtime en
 * CASSANT le design au-delà de la tolérance :
 *  1. patch correctif qui détruit le design => patch-rolled-back, HTML initial
 *     restauré, raison AQS_REGRESSION (AQS avant/après exposés) ;
 *  2. patch correctif qui préserve le design => patch-applied (aucun
 *     sur-blocage : le gate ne pénalise pas une correction saine) ;
 *  3. page déjà saine => no-repair-needed (comportement historique intact).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { aiProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import type {
  AIProviderGenerateRequest,
  AIProviderGenerateResponse
} from '../../../packages/core/src/ai/providers/types.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

const DESIGNED = `<!DOCTYPE html><html><head><title>Atelier — design réel</title><style>
  body { background-color: #ffffff; color: #111827; font-family: Inter, sans-serif; padding: 24px; }
  h1 { font-size: 40px; font-weight: 700; margin: 0 0 16px; }
  p { font-size: 16px; color: #374151; margin: 0 0 16px; }
  .btn { background-color: #2563eb; color: #ffffff; border-radius: 14px; padding: 12px 20px; }
  .wrap { max-width: 1024px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
</style></head><body>
  <h1>Titre principal</h1>
  <p>Paragraphe de contenu réel pour la mesure du design.</p>
  <button class="btn" aria-label="Agir">Agir</button>
  <div class="wrap"><div class="card">Carte A</div><div class="card">Carte B</div></div>
</body></html>`;

const POISONED = DESIGNED.replace(
  '</body>',
  "<script>throw new Error('LOT-B-REPAIR-1');</script>" +
  "<script>throw new Error('LOT-B-REPAIR-2');</script>" +
  "<script>throw new Error('LOT-B-REPAIR-3');</script></body>"
);

/** Patch « correctif » qui supprime TOUT le design (page nue). */
const BARE = `<!DOCTYPE html><html><head><title>Atelier — corrigé</title></head><body><h1>Corrigé</h1><p>Version minimale sans design.</p></body></html>`;

class ScriptedRepairAdapter {
  public readonly descriptor = {
    providerId: 'fake-repair-lotb',
    providerName: 'Fake Repair (Lot B)',
    models: ['fake-repair-model'],
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

  public setCanned(projectId: string, html: string): void {
    this.canned.set(projectId, html);
  }

  public async generate(request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> {
    return {
      text: '```html\n' + (this.canned.get(request.projectId) ?? '') + '\n```',
      providerId: 'fake-repair-lotb',
      modelId: 'fake-repair-model',
      latencyMs: 1,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      costUsd: 0
    };
  }
}

interface RepairResponse {
  repaired: boolean;
  initialScore: number;
  finalScore: number;
  iterations: {
    action: string;
    guard?: string;
    aqsBefore?: number | null;
    aqsAfter?: number | null;
  }[];
}

describe('CDC V8 Lot B — gate AQS de la réparation (§19)', () => {
  const scripted = new ScriptedRepairAdapter();
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

  it('1. patch correctif qui détruit le design => rollback AQS, HTML initial restauré', async () => {
    const projectId = await createProject('Lot B — repair gate rollback', POISONED);
    scripted.setCanned(projectId, BARE);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/repair`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 1 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as RepairResponse;
    const iteration = body.iterations[0]!;
    assert.equal(iteration.action, 'patch-rolled-back');
    assert.equal(iteration.guard, 'AQS_REGRESSION');
    assert.ok(iteration.aqsBefore !== null && iteration.aqsAfter !== null, 'AQS mesuré des deux côtés');
    // Le score fonctionnel legacy était bien meilleur (erreurs supprimées) :
    // c'est donc bien le gate DESIGN qui a refusé le patch.
    assert.ok(body.finalScore >= body.initialScore);
    assert.equal(await readIndex(projectId), POISONED, 'le design réel est restauré intact');
  });

  it('2. patch correctif qui préserve le design => appliqué (pas de sur-blocage)', async () => {
    const projectId = await createProject('Lot B — repair gate propre', POISONED);
    scripted.setCanned(projectId, DESIGNED);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/repair`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 1 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as RepairResponse;
    const iteration = body.iterations[0]!;
    assert.equal(iteration.action, 'patch-applied');
    assert.equal(iteration.guard, undefined, 'aucun garde déclenché');
    assert.ok(iteration.aqsBefore !== null && iteration.aqsAfter !== null);
    assert.ok(Math.abs(iteration.aqsAfter! - iteration.aqsBefore!) <= 5, 'design préservé (±5 pts)');

    const saved = await readIndex(projectId);
    assert.ok(!saved.includes('LOT-B-REPAIR-1'), 'les erreurs runtime sont réellement corrigées');
    assert.ok(saved.includes("font-family: Inter"), 'le design est conservé');
  });

  it('3. page déjà saine => no-repair-needed (comportement historique intact)', async () => {
    const projectId = await createProject('Lot B — repair sans erreur', DESIGNED);
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/repair`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 2 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as RepairResponse;
    assert.equal(body.iterations[0]!.action, 'no-repair-needed');
    assert.equal(body.finalScore, body.initialScore);
  });
});
