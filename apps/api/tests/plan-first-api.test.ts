/**
 * Tests Lot 4 — Plan First (§17 CDC) : plan d'ingénierie émis dans le flux
 * SSE et confirmation humaine avant génération en mode planFirst.
 *
 * Ces tests n'appellent JAMAIS le LLM : en mode planFirst le serveur doit
 * s'arrêter AVANT la génération (c'est le but du garde-fou Human Control).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

interface SSEEvent {
  type: string;
  plan?: { planId: string; steps: unknown[]; summary?: string };
  awaitingConfirmation?: boolean;
  state?: string;
}

async function streamEvents(baseUrl: string, projectId: string, body: Record<string, unknown>): Promise<SSEEvent[]> {
  const sessionRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions`, {
    method: 'POST',
    headers: H
  });
  const sessionId = ((await sessionRes.json()) as { session: { sessionId: string } }).session.sessionId;
  const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`, {
    method: 'POST',
    headers: { ...H, Accept: 'text/event-stream' },
    body: JSON.stringify(body)
  });
  const events: SSEEvent[] = [];
  for (const line of (await res.text()).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    try { events.push(JSON.parse(t.slice(5).trim())); } catch { /* ignore */ }
  }
  return events;
}

describe('Lot 4 : Plan First — plan émis et confirmation humaine', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;

  before(async () => {
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'Lot4 PlanFirst' })
    });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. mode planFirst : plan émis puis done(awaitingConfirmation) SANS génération', async () => {
    const events = await streamEvents(baseUrl, projectId, {
      message: 'Crée une page de présentation',
      isModification: false,
      planFirst: true
    });
    const planEvent = events.find((e) => e.type === 'plan');
    assert.ok(planEvent && planEvent.plan, 'Un événement plan structuré doit être émis');
    assert.ok(planEvent.plan!.planId.startsWith('plan-'));
    assert.ok(Array.isArray(planEvent.plan!.steps) && planEvent.plan!.steps.length > 0, 'Le plan doit contenir des étapes');

    const doneEvent = events.find((e) => e.type === 'done');
    assert.ok(doneEvent && doneEvent.awaitingConfirmation === true, 'Le done doit porter awaitingConfirmation=true');

    assert.ok(
      events.some((e) => e.type === 'compass' && e.state === 'WAITING_CONFIRMATION'),
      'Le Compass doit passer en WAITING_CONFIRMATION'
    );
    assert.ok(
      !events.some((e) => e.type === 'section_start'),
      'AUCUNE génération ne doit démarrer avant confirmation (No Silent Changes)'
    );
  });

  it('2. mode standard : le plan informatif est aussi émis (traçabilité)', async () => {
    const events = await streamEvents(baseUrl, projectId, {
      message: 'Modifie la couleur du titre',
      isModification: false
    });
    const planEvent = events.find((e) => e.type === 'plan');
    assert.ok(planEvent && planEvent.plan, 'Le plan informatif doit être émis même sans Plan First');
    // Sans confirmation, le flux ne doit PAS s'arrêter en attente. Sans clé
    // LLM dans l'environnement de test, le flux se termine par une erreur
    // fournisseur (aucun done) — les deux cas sont acceptés ici.
    const doneEvent = events.find((e) => e.type === 'done');
    assert.ok(
      !doneEvent || doneEvent.awaitingConfirmation !== true,
      'Sans planFirst, pas d\'attente de confirmation'
    );
  });
});
