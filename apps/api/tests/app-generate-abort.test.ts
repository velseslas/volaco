/**
 * P0-masse n°3 — E2E : le client qui raccroche en pleine génération stoppe
 * la boucle LLM (aucun nouvel appel facturé après l'abandon).
 *
 * Protocole déterministe (pas de fenêtre de temps) : faux provider Mistral
 * dont le 1er appel reste BLOQUÉ sur une porte jusqu'à libération manuelle.
 * Le client avorte après le 1er chunk reçu ; on libère la porte ; on
 * constate qu'aucun 2e appel modèle n'a lieu (la boucle est morte).
 */
process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import type {
  AIProviderGenerateRequest,
  AIProviderGenerateResponse
} from '../../../packages/core/src/ai/providers/types.js';

let releaseFirstCall: () => void = () => {};
let firstCallGate: Promise<void> = Promise.resolve();
let generateCalls = 0;

class GatedMistralAdapter {
  public readonly descriptor = {
    providerId: 'mistral',
    providerName: 'Gated Mistral (P0-3)',
    models: ['codestral-latest'],
    capabilities: [] as const,
    contextWindow: 128000,
    structuredOutput: true,
    streaming: true,
    toolCalling: true,
    reasoning: false,
    vision: false,
    costMetadata: {},
    availability: 'AVAILABLE' as const,
    healthStatus: 'HEALTHY' as const
  };

  public async generate(request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> {
    generateCalls++;
    // Comme le vrai adaptateur : le signal coupe l'attente.
    if (request.signal) {
      if (request.signal.aborted) {
        const err = new Error('interrompu');
        err.name = 'AbortError';
        throw err;
      }
      await Promise.race([
        firstCallGate,
        new Promise<void>((_, reject) => request.signal!.addEventListener('abort', () => {
          const err = new Error('interrompu');
          err.name = 'AbortError';
          reject(err);
        }, { once: true }))
      ]);
    } else {
      await firstCallGate;
    }
    return {
      text: '',
      providerId: 'mistral',
      modelId: 'codestral-latest',
      latencyMs: 1,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      costUsd: 0.001,
      toolCalls: [{ id: 'call-1', name: 'create_file', arguments: JSON.stringify({ path: 'src/App.tsx', content: 'export default function App() { return null; }' }) }]
    };
  }
}

describe('P0-masse n°3 : abandon client stoppe la boucle LLM (E2E)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'ten_abort_01', 'x-user-role': 'OWNER' };

  before(async () => {
    firstCallGate = new Promise<void>((resolve) => { releaseFirstCall = resolve; });
    generateCalls = 0;
    aiProviderRegistry.register(new GatedMistralAdapter() as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
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
      method: 'POST', headers: H, body: JSON.stringify({ name: 'Abort P0-3' })
    });
    assert.equal(pres.status, 201);
    projectId = ((await pres.json()) as { project: { id: string } }).project.id;
  });

  after(async () => {
    releaseFirstCall();
    await fetch(`${baseUrl}/api/v1/projects/${projectId}`, { method: 'DELETE', headers: H });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. client qui raccroche → aucun 2e appel modèle après libération', async () => {
    const controller = new AbortController();
    const reqPromise = fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST',
      headers: { ...H, Accept: 'text/event-stream' },
      body: JSON.stringify({ prompt: 'un site vitrine avec une section hero' }),
      signal: controller.signal
    });
    // Attend que le 1er appel modèle soit réellement parti (bloqué sur la porte)…
    for (let i = 0; i < 200 && generateCalls === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(generateCalls, 1, 'le 1er appel modèle est en vol');
    // …puis le client raccroche (onglet fermé) AVANT la réponse du modèle…
    controller.abort();
    await reqPromise.catch(() => undefined);
    // Laisse le FIN arriver au serveur (sans quoi la porte libérée aussitôt
    // laisserait la fausse boucle — immédiate — finir ses 12 tours avant que
    // le serveur ne constate la déconnexion : course du test, pas du code).
    await new Promise((r) => setTimeout(r, 1500));
    // …on libère le modèle : s’il enchaînait, le 2e appel partirait.
    releaseFirstCall();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(generateCalls, 1, 'aucun 2e appel modèle après abandon (boucle morte, crédit sauf)');
  });
});
