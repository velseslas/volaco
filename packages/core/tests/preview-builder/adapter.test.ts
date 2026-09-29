/**
 * ÉTAPE 08 — tests de l'AI GENERATION ADAPTER (frontière générateur ↔ moteur).
 * Garanties du brief : traduction 1:1 du flux réel, événements inconnus
 * ignorés, JSON/malformés rejetés proprement, ordre conservé, aucune
 * mutation d'entrée, Mock et SSE produisent le MÊME contrat, le moteur ne
 * sait rien du transport.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeSseFrame,
  MockBuildEventSource,
  normalizeGenerationEvent,
  normalizeGenerationEvents,
  SSEBuildEventSource
} from '../../src/preview-builder/adapter.js';
import { applyBuildEvents, createPreviewBuildState } from '../../src/preview-builder/engine.js';
import type { PreviewBuildEvent } from '../../src/preview-builder/engine.js';
import { renderPreview } from '../../src/preview-builder/renderer.js';
import { demoBuildScript, scriptToEvents } from '../../src/preview-builder/mocks.js';

describe('ÉTAPE 08 : normalisation du flux générateur', () => {
  it('1-2. start → BUILD_STARTED correctement normalisé', () => {
    const r = normalizeGenerationEvent({ type: 'start', isModification: false, timestamp: 42 });
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0]!.kind, 'BUILD_STARTED');
    assert.equal(r.rejected, 0);
    assert.equal(r.ignored, 0);
  });

  it('3. section_start → COMPONENT_CREATED + COMPONENT_BUILDING (dans cet ordre)', () => {
    const r = normalizeGenerationEvent({ type: 'section_start', name: 'card-01', mode: 'add', after: 'sidebar', timestamp: 7 });
    assert.equal(r.events.length, 2);
    assert.equal(r.events[0]!.kind, 'COMPONENT_CREATED');
    if (r.events[0]!.kind === 'COMPONENT_CREATED') {
      assert.equal(r.events[0]!.component.id, 'card-01');
      assert.equal(r.events[0]!.component.type, 'card-01');
      assert.equal(r.events[0]!.component.parentId, 'sidebar');
    }
    assert.equal(r.events[1]!.kind, 'COMPONENT_BUILDING');
    if (r.events[1]!.kind === 'COMPONENT_BUILDING') assert.equal(r.events[1]!.componentId, 'card-01');
  });

  it('4. metadata transportée : section_end.html et done.glace restent hors contrat (ignorés proprement)', () => {
    const end = normalizeGenerationEvent({ type: 'section_end', name: 'card-01', html: '<section>…</section>', timestamp: 8 });
    assert.equal(end.events.length, 1);
    assert.equal(end.events[0]!.kind, 'COMPONENT_READY');
    const done = normalizeGenerationEvent({ type: 'done', awaitingConfirmation: true, timestamp: 9 });
    assert.equal(done.events.length, 0, 'Plan First : hors contrat de build → ignoré');
    assert.equal(done.ignored, 1);
  });

  it('5. parentId correctement transporté ; sans id → rejeté', () => {
    const sansId = normalizeGenerationEvent({ type: 'section_start', timestamp: 1 });
    assert.equal(sansId.rejected, 1);
    assert.equal(sansId.events.length, 0);
    const avec = normalizeGenerationEvent({ type: 'section_start', name: 'footer', after: 'main', timestamp: 2 });
    const created = avec.events[0]!;
    assert.ok(created.kind === 'COMPONENT_CREATED' && created.component.parentId === 'main');
  });

  it('6. événements inconnus (chat, token, compass, AI_THINKING) ignorés sans planter', () => {
    for (const type of ['chat', 'token', 'compass', 'AI_THINKING', 'MODEL_PROGRESS']) {
      const r = normalizeGenerationEvent({ type, timestamp: 1 });
      assert.equal(r.events.length, 0, `${type} : rien d’injecté`);
      assert.equal(r.rejected, 0, `${type} : ignoré, pas rejeté`);
      assert.equal(r.ignored, 1);
    }
  });

  it('7. JSON invalide / payload non-objet : rejet propre, aucune exception', () => {
    const r1 = normalizeGenerationEvent('not an object');
    const r2 = normalizeGenerationEvent(null);
    const r3 = normalizeGenerationEvent(42);
    for (const r of [r1, r2, r3]) {
      assert.equal(r.events.length, 0);
      assert.equal(r.rejected, 1);
    }
  });

  it('8. section_start sans name → rejeté avec raison', () => {
    const r = normalizeGenerationEvent({ type: 'section_start' });
    assert.equal(r.rejected, 1);
    assert.ok(r.reason && r.reason.includes('name'));
  });

  it('9. l’ordre des événements est conservé (traducteur, pas réordonneur)', () => {
    const raws = [
      { type: 'start', timestamp: 1 },
      { type: 'section_start', name: 'header', timestamp: 2 },
      { type: 'section_end', name: 'header', timestamp: 3 },
      { type: 'section_start', name: 'sidebar', timestamp: 4 },
      { type: 'section_end', name: 'sidebar', timestamp: 5 },
      { type: 'done', timestamp: 6 }
    ];
    const r = normalizeGenerationEvents(raws);
    const kinds = r.events.map((e) => e.kind);
    assert.deepEqual(kinds, [
      'BUILD_STARTED',
      'COMPONENT_CREATED', 'COMPONENT_BUILDING', 'COMPONENT_READY',
      'COMPONENT_CREATED', 'COMPONENT_BUILDING', 'COMPONENT_READY',
      'BUILD_COMPLETED'
    ]);
    // Timestamps croissants (aucun réordonnancement)
    const ts = r.events.map((e) => e.timestamp);
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i]! >= ts[i - 1]!);
  });

  it('10. l’adaptateur ne mute pas son entrée', () => {
    const raw = { type: 'section_start', name: 'x', after: 'y', timestamp: 1, extra: 'intact' };
    const copy = JSON.parse(JSON.stringify(raw));
    normalizeGenerationEvent(raw);
    assert.deepEqual(raw, copy);
  });
});

describe('ÉTAPE 08 : BUILD_CANCELLED (extension additive du contrat)', () => {
  it('11. cancelled → BUILD_CANCELLED : ⏹ ≠ ❌ (état « cancelled », pas « error »)', () => {
    const r = normalizeGenerationEvent({ type: 'cancelled', reason: 'user', timestamp: 5 });
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0]!.kind, 'BUILD_CANCELLED');
    const s = applyBuildEvents(createPreviewBuildState(), r.events);
    assert.equal(s.status, 'cancelled', 'l’annulation n’est pas transformée en échec');
    assert.equal(s.error, undefined);
  });
});

describe('ÉTAPE 08 : Mock Source et SSE Source produisent le MÊME contrat', () => {
  it('12. Mock Source : délivre les événements du scénario dans l’ordre, stop() arrête', async () => {
    const events = scriptToEvents(demoBuildScript(), 1000);
    const source = new MockBuildEventSource({ events, intervalMs: 5 });
    const received: string[] = [];
    let donePromise: Promise<void> | null = null;
    const handle = source.subscribe((e) => {
      received.push(e.kind);
      if (e.kind === 'BUILD_COMPLETED' && donePromise === null) donePromise = Promise.resolve();
    });
    // Attend la complétion réelle (fenêtre max 2 s) — pas de fenêtre arbitraire
    for (let i = 0; i < 100 && received[received.length - 1] !== 'BUILD_COMPLETED'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    handle.stop();
    const afterStop = received.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(received.length, afterStop, 'stop() arrête la délivrance');
    assert.equal(received[0], 'BUILD_STARTED');
    assert.ok(received.includes('COMPONENT_READY'));
    assert.ok(received.includes('BUILD_COMPLETED'), 'tous les événements délivrés avant stop');
  });

  it('13. SSE Source : parse les frames data:, ignore le bruit, notifie via l’adaptateur', async () => {
    const frames = [
      'data: {"type":"start","timestamp":1}\n\n',
      'data: {invalid json}\n\n',                                   // malformé : ignoré
      'data: {"type":"AI_THINKING","timestamp":2}\n\n',             // inconnu : ignoré
      'data: {"type":"section_start","name":"header","timestamp":3}\n\n',
      'event: ping\ndata: keepalive\n\n',                           // sans data JSON : ignoré
      'data: {"type":"section_end","name":"header","timestamp":4}\n\n',
      'data: {"type":"done","timestamp":5}\n\n'
    ];
    const encoder = new TextEncoder();
    let i = 0;
    const fakeResponse = {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => (i < frames.length ? { done: false, value: encoder.encode(frames[i++]!) } : { done: true, value: undefined })
        })
      }
    };
    const received: string[] = [];
    const errors: string[] = [];
    const source = new SSEBuildEventSource({
      url: 'sse://simulated',
      fetchImpl: (async () => fakeResponse) as unknown as typeof fetch
    });
    await new Promise<void>((resolve) => {
      source.subscribe(
        (e) => { received.push(e.kind); if (e.kind === 'BUILD_COMPLETED') resolve(); },
        (m) => errors.push(m)
      );
      setTimeout(resolve, 1000);
    });
    assert.deepEqual(received, ['BUILD_STARTED', 'COMPONENT_CREATED', 'COMPONENT_BUILDING', 'COMPONENT_READY', 'BUILD_COMPLETED']);
    assert.ok(errors.some((m) => m.includes('JSON invalide')), 'le JSON invalide est signalé, pas fatal');
  });
});

describe('ÉTAPE 08 : intégration SSE → Adapter → Engine == Mock → Engine', () => {
  it('14. les deux chemins arrivent au MÊME state final pour le même scénario', () => {
    // Scénario exprimé dans le VOCABULAIRE du générateur réel (contrat SSE)
    const sseRaws = [
      { type: 'start', timestamp: 1 },
      { type: 'section_start', name: 'header', timestamp: 2 },
      { type: 'section_end', name: 'header', timestamp: 3 },
      { type: 'section_start', name: 'content', after: 'header', timestamp: 4 },
      { type: 'section_end', name: 'content', timestamp: 5 },
      { type: 'done', timestamp: 6 }
    ];
    const normalized = normalizeGenerationEvents(sseRaws);
    const stateFromSse = applyBuildEvents(createPreviewBuildState(), normalized.events);

    // Chemin MOCK : les MÊMES événements construits directement en contrat
    // Preview (ce que le mock produit sans transport)
    const directEvents: PreviewBuildEvent[] = [
      { kind: 'BUILD_STARTED', timestamp: 1001 },
      { kind: 'COMPONENT_CREATED', timestamp: 1002, component: { id: 'header', type: 'header', label: 'header' } },
      { kind: 'COMPONENT_BUILDING', timestamp: 1002, componentId: 'header' },
      { kind: 'COMPONENT_READY', timestamp: 1003, componentId: 'header' },
      { kind: 'COMPONENT_CREATED', timestamp: 1004, component: { id: 'content', type: 'content', label: 'content', parentId: 'header' } },
      { kind: 'COMPONENT_BUILDING', timestamp: 1004, componentId: 'content' },
      { kind: 'COMPONENT_READY', timestamp: 1005, componentId: 'content' },
      { kind: 'BUILD_COMPLETED', timestamp: 1006 }
    ];
    const stateFromDirect = applyBuildEvents(createPreviewBuildState(), directEvents);

    // Même composition finale via les deux chemins
    assert.deepEqual(
      [...stateFromSse.components.values()].map((c) => ({ id: c.id, status: c.status })),
      [...stateFromDirect.components.values()].map((c) => ({ id: c.id, status: c.status })),
      'même composition finale via SSE+adapter que via contrat direct'
    );
    assert.deepEqual(
      renderPreview(stateFromSse).flat.map((n) => ({ id: n.id, status: n.status })),
      renderPreview(stateFromDirect).flat.map((n) => ({ id: n.id, status: n.status })),
      'même rendu final'
    );
  });
});
