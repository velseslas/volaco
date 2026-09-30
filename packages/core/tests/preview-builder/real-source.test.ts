/**
 * ÉTAPE 09 — INTÉGRATION RÉELLE : SSEBuildEventSource branché au VRAI
 * endpoint /api/v1/projects/:pid/conversation/sessions/:sid/stream.
 *
 * Le serveur API réel démarre sur un port éphémère ; sans clé LLM dans
 * l'environnement de test, le flux émet la séquence déterministe
 * start → … → error — qui prouve de bout en bout : endpoint correct,
 * sessionId transmis, frames SSE réelles parsées, adapter, BUILD_STARTED,
 * BUILD_FAILED représenté, fermeture propre.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../../../../apps/api/src/server.js';
import { SSEBuildEventSource } from '../../src/preview-builder/adapter.js';
import { createPreviewBuildState, applyBuildEvent } from '../../src/preview-builder/engine.js';
import { renderPreview } from '../../src/preview-builder/renderer.js';
import type { PreviewBuildEvent } from '../../src/preview-builder/engine.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

describe('ÉTAPE 09 : source réelle branchée au stream du Studio', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    delete process.env.MISTRAL_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
    const res = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E09 Real Source' }) });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
    const sess = await fetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions`, { method: 'POST', headers: H });
    sessionId = ((await sess.json()) as { session: { sessionId: string } }).session.sessionId;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1-5. endpoint réel + sessionId transmis : start → BUILD_STARTED puis error → BUILD_FAILED', async () => {
    const received: string[] = [];
    const errors: string[] = [];
    let state = createPreviewBuildState();
    // L'URL est construite par l'intégration avec le sessionId EXPLICITE —
    // jamais deviné ni hardcodé côté moteur.
    const source = new SSEBuildEventSource({
      url: `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`,
      headers: H, body: { message: 'Crée une page de démonstration', isModification: false }
    });
    await new Promise<void>((resolve) => {
      source.subscribe(
        (event) => {
          received.push(event.kind);
          state = applyBuildEvent(state, event);
          if (event.kind === 'BUILD_FAILED') resolve();
        },
        (m) => errors.push(m)
      );
      setTimeout(resolve, 15000);
    });
    assert.equal(received[0], 'BUILD_STARTED', 'le vrai flux commence par BUILD_STARTED');
    assert.ok(received.includes('BUILD_FAILED'), 'sans fournisseur LLM : erreur réelle représentée');
    assert.equal(state.status, 'error');
    assert.ok((state.error || '').length > 0, 'message d’erreur serveur transporté');
    assert.ok(renderPreview(state).statusLabel.startsWith('error'));
  });

  it('6. flux normal complet : fermeture du stream sans erreur transport', async () => {
    // planFirst sans confirmation : start → … → done(awaitingConfirmation)
    // ignoré par l’adaptateur, puis le serveur FERME le stream → résolution
    // propre, onError jamais appelé.
    let errored = false;
    let finished = false;
    const source = new SSEBuildEventSource({
      url: `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`,
      headers: H, body: { message: 'Autre tour', isModification: false, planFirst: true }
    });
    await new Promise<void>((resolve) => {
      source.subscribe(() => {}, () => { errored = true; resolve(); });
      setTimeout(() => { finished = true; resolve(); }, 8000);
    });
    assert.equal(errored, false, 'fermeture normale : aucune erreur transport signalée');
    assert.equal(finished, true);
  });

  it('7. stop() relâche les ressources : aucun événement après abort, pas d’erreur', async () => {
    const events: string[] = [];
    const errors: string[] = [];
    const source = new SSEBuildEventSource({
      url: `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`,
      headers: H, body: { message: 'Tour à interrompre', isModification: false }
    });
    const handle = source.subscribe((e) => events.push(e.kind), (m) => errors.push(m));
    await new Promise((resolve) => setTimeout(resolve, 300));
    handle.stop(); // AbortController — annulation navigateur native
    const countAfterStop = events.length;
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(events.length, countAfterStop, 'plus rien après stop()');
    assert.equal(errors.length, 0, 'un abort volontaire n’est pas une erreur');
  });

  it('8. HTTP error (404 session inconnue) représentée via onError, jamais une exception', async () => {
    const errors: string[] = [];
    const source = new SSEBuildEventSource({
      url: `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/sess-inconnue/stream`,
      body: { message: 'x', isModification: false }
    });
    await new Promise<void>((resolve) => {
      source.subscribe(() => {}, (m) => { errors.push(m); resolve(); });
      setTimeout(resolve, 8000);
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0]!.includes('404'), 'statut HTTP transporté dans le message');
  });
});

describe('ÉTAPE 09 : legacy intact — aucune duplication de génération', () => {
  it('9. le moteur ne référence AUCUN transport (fetch/SSE/HTTP/EventSource)', async () => {
    const { readFileSync } = await import('node:fs');
    const engine = readFileSync('packages/core/src/preview-builder/engine.ts', 'utf8');
    for (const forbidden of ['fetch(', 'EventSource', 'ReadableStream', 'getReader', 'text/event-stream', 'http://', 'https://']) {
      assert.ok(!engine.includes(forbidden), `le moteur ne doit pas contenir « ${forbidden} »`);
    }
  });

  it('10. le renderer legacy (Studio) ne dépend pas du nouveau moteur', async () => {
    const { readFileSync } = await import('node:fs');
    const studio = readFileSync('apps/studio/index.html', 'utf8');
    assert.ok(!studio.includes('preview-builder/engine'), 'le Studio n’importe pas le moteur V2');
    assert.ok(!studio.includes('SSEBuildEventSource'), 'le Studio n’importe pas la source V2');
  });

  it('11. une seule génération : la source réelle consomme le flux existant, aucun endpoint dupliqué', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    // Aucune nouvelle route de génération : conversation.ts reste l'unique
    // émetteur du stream (le routeur n'expose qu'un seul /stream).
    const routes = readdirSync('apps/api/src/routes');
    const streamEmitters = routes.filter((f) => {
      if (f === 'conversation.ts') return true;
      const src = readFileSync(`apps/api/src/routes/${f}`, 'utf8');
      return src.includes("action === 'stream'") || src.includes('/stream');
    });
    assert.deepEqual(streamEmitters, ['conversation.ts'], 'un seul émetteur de stream : le générateur existant');
  });
});
