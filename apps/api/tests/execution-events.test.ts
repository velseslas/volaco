/**
 * T1 — EXECUTION TRANSPARENCY (CDC Transparency Engine) : les frames SSE
 * « milestone » portent executionId/seq/phase/status, et chaque action réelle
 * est persistée dans l'ExecutionEventStore (ordre fiable, statuts honnêtes).
 *
 * Aucun LLM n'est appelé : les clés sont retirées du process (les tests ne
 * chargent jamais .env — voir server.ts isMain), donc le flux standard se
 * termine par l'erreur fournisseur déterministe, et le mode planFirst
 * s'arrête AVANT la génération (garde-fou Human Control).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { executionStore, ExecutionEventStore, MAX_EVENTS_PER_EXECUTION, MAX_EXECUTIONS_PER_PROJECT } from '../../../packages/core/src/ai-native/execution/store.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

interface SSEEvent {
  type: string;
  executionId?: string;
  seq?: number;
  phase?: string;
  status?: string;
  awaitingConfirmation?: boolean;
  error?: string;
  name?: string;
  mode?: string;
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

describe('T1 : Execution Transparency — événements typés et persistés', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;

  before(async () => {
    // Hermetique : aucun fournisseur LLM réel, même si l'environnement du
    // shell en exportait une — le flux standard doit échouer déterministe.
    delete process.env.MISTRAL_API_KEY;
    delete process.env.GEMINI_API_KEY;
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
      body: JSON.stringify({ name: 'T1 Execution Events' })
    });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. frames enrichies : start unique, porte executionId/phase/status ; plan porte seq', async () => {
    const events = await streamEvents(baseUrl, projectId, {
      message: 'Crée une page de présentation',
      isModification: false,
      planFirst: true
    });
    const startFrames = events.filter((e) => e.type === 'start');
    assert.equal(startFrames.length, 1, 'start doit être émis UNE seule fois (doublon supprimé)');
    assert.ok(startFrames[0]!.executionId, 'start doit porter un executionId');
    assert.equal(startFrames[0]!.phase, 'UNDERSTAND');
    assert.equal(startFrames[0]!.status, 'RUNNING');

    const planFrame = events.find((e) => e.type === 'plan');
    assert.ok(planFrame && planFrame.executionId, 'plan doit porter le même executionId');
    assert.ok(typeof planFrame!.seq === 'number' && planFrame!.seq >= 2, 'plan doit porter un seq >= 2 (EXECUTION_STARTED est seq 1)');
    assert.equal(planFrame!.phase, 'PLAN');
  });

  it('2. persistance : exécution WAITING_USER, événements ordonnés et statuts honnêtes', async () => {
    const events = await streamEvents(baseUrl, projectId, {
      message: 'Crée une page portfolio',
      isModification: false,
      planFirst: true
    });
    const executionId = events.find((e) => e.type === 'start')!.executionId!;
    const record = executionStore.getExecution(executionId);
    assert.ok(record, 'l\'exécution doit être persistée dans le store');
    assert.equal(record!.status, 'WAITING_USER', 'planFirst sans confirmation = WAITING_USER');
    assert.equal(record!.mode, 'create');

    const types = record!.events.map((e) => e.type);
    assert.equal(types[0], 'EXECUTION_STARTED', 'le premier événement est toujours EXECUTION_STARTED');
    assert.ok(types.includes('PLAN_CREATED'), 'PLAN_CREATED doit être persisté');
    assert.ok(types.includes('PHASE_CHANGED'), 'l\'attente de confirmation doit être tracée');
    assert.equal(record!.events.find((e) => e.type === 'PLAN_CREATED')!.status, 'COMPLETED');
    assert.equal(record!.events.find((e) => e.type === 'PHASE_CHANGED')!.status, 'WAITING_USER');

    const seqs = record!.events.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      assert.ok(seqs[i]! > seqs[i - 1]!, `seq strictement croissante (${seqs.join(',')})`);
    }
  });

  it('3. FILE_READ tracé quand index.html existe réellement', async () => {
    const html = '<!DOCTYPE html><html><body><h1>Portfolio T1</h1>' + '<p>x</p>'.repeat(40) + '</body></html>';
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path: 'index.html', content: html })
    });
    const events = await streamEvents(baseUrl, projectId, {
      message: 'Change le titre',
      isModification: true,
      planFirst: true
    });
    const executionId = events.find((e) => e.type === 'start')!.executionId!;
    const record = executionStore.getExecution(executionId)!;
    const fileRead = record.events.find((e) => e.type === 'FILE_READ');
    assert.ok(fileRead, 'la lecture réelle du fichier doit être tracée');
    assert.equal((fileRead!.detail as { chars: number }).chars, html.length);
    assert.equal(fileRead!.phase, 'INSPECT');
  });

  it('4. sans LLM : échec honnête — EXECUTION_FAILED persisté, frame error enrichie', async () => {
    const events = await streamEvents(baseUrl, projectId, {
      message: 'Crée une landing page',
      isModification: false
    });
    const errorFrame = events.find((e) => e.type === 'error');
    assert.ok(errorFrame && errorFrame.error, 'le flux doit se terminer par l\'erreur fournisseur déterministe');
    assert.ok(errorFrame!.executionId, 'la frame error porte l\'executionId');

    const record = executionStore.getExecution(errorFrame!.executionId!)!;
    assert.equal(record.status, 'FAILED');
    const failed = record.events.find((e) => e.type === 'EXECUTION_FAILED');
    assert.ok(failed, 'EXECUTION_FAILED doit être persisté');
    assert.equal(failed!.status, 'FAILED');
    assert.ok(record.summary?.error, 'le bilan porte l\'erreur');
  });

  it('5. plan confirmé : PLAN_APPROVED enregistré avant la génération', async () => {
    const events = await streamEvents(baseUrl, projectId, {
      message: 'Crée une page contact',
      isModification: false,
      planFirst: true,
      confirmedPlan: true
    });
    const executionId = events.find((e) => e.type === 'start')!.executionId!;
    const record = executionStore.getExecution(executionId)!;
    const approved = record.events.find((e) => e.type === 'PLAN_APPROVED');
    assert.ok(approved, 'l\'approbation humaine du plan doit être tracée (CDC §21)');
    assert.ok(record.events.find((e) => e.type === 'EXECUTION_STARTED')!.seq! < approved!.seq!, 'PLAN_APPROVED vient après le démarrage');
  });

  it('6. GET /executions : liste légère (méta, sans events) + latest complète + 404 + isolation tenant', async () => {
    // Produit une exécution connue via le stream planFirst
    const events = await streamEvents(baseUrl, projectId, {
      message: 'Crée une une page vitrine',
      isModification: false,
      planFirst: true
    });
    const executionId = events.find((e) => e.type === 'start')!.executionId!;

    // Liste : méta seulement
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/executions`, { headers: H });
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as { executions: Array<Record<string, unknown>> };
    assert.ok(list.executions.length >= 1, 'au moins une exécution listée');
    const mine = list.executions.find((e) => e.executionId === executionId);
    assert.ok(mine, 'l\'exécution du stream est listée');
    assert.ok(!('events' in (mine || {})), 'la liste ne porte pas les événements (volume)');
    assert.equal(mine!.eventsCount, executionStore.getExecution(executionId)!.events.length, 'eventsCount reflète le réel');

    // Latest : enregistrement complet avec événements
    const latestRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/executions/latest`, { headers: H });
    assert.equal(latestRes.status, 200);
    const latest = (await latestRes.json()) as { execution: { executionId: string; events: unknown[] } };
    assert.equal(latest.execution.executionId, executionId, 'latest = exécution la plus récente');
    assert.ok(Array.isArray(latest.execution.events) && latest.execution.events.length > 0, 'latest porte les événements');

    // Détail par id inconnu : 404
    const missingRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/executions/inexistant`, { headers: H });
    assert.equal(missingRes.status, 404);

    // Isolation tenant : un autre tenant ne voit NI la liste NI l'exécution
    const otherH = { ...H, 'x-tenant-id': 'autre-tenant' };
    const otherProjectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: otherH, body: JSON.stringify({ name: 'Autre projet' })
    });
    const otherProjectId = ((await otherProjectRes.json()) as { project: { id: string } }).project.id;
    const crossRes = await fetch(`${baseUrl}/api/v1/projects/${otherProjectId}/executions`, { headers: otherH });
    const cross = (await crossRes.json()) as { executions: unknown[] };
    assert.equal(cross.executions.length, 0, 'aucune exécution ne fuit entre tenants');
    const crossDetail = await fetch(`${baseUrl}/api/v1/projects/${projectId}/executions/${executionId}`, { headers: otherH });
    // Le projet n'appartient pas à ce tenant : projet introuvable pour lui
    assert.equal(crossDetail.status, 404);
  });
});

describe('T1 : ExecutionEventStore — invariants unitaires', () => {
  it('6. seq ordonnée, plafond d\'événements, rétention par projet, idempotence, refus après clôture', () => {
    const store = new ExecutionEventStore(); // en mémoire : isolation totale

    // Idempotence de startExecution (aucun événement ajouté par le store :
    // EXECUTION_STARTED est émis par l'appelant avec la frame start)
    const first = store.startExecution({ executionId: 'u-1', tenantId: 't', projectId: 'p', mode: 'create', prompt: 'demo' });
    const again = store.startExecution({ executionId: 'u-1', tenantId: 't', projectId: 'p', mode: 'create', prompt: 'demo' });
    assert.equal(again.executionId, first.executionId);
    assert.equal(store.getExecution('u-1')!.events.length, 0, 'startExecution est muet : pas de doublon possible');

    // Plafond : MAX+10 événements → MAX conservés, seq inchangées
    for (let i = 0; i < MAX_EVENTS_PER_EXECUTION + 10; i++) {
      store.appendEvent('u-1', { type: 'PHASE_CHANGED', phase: 'IMPLEMENT', status: 'RUNNING', title: 'x', detail: { i } });
    }
    const capped = store.getExecution('u-1')!;
    assert.equal(capped.events.length, MAX_EVENTS_PER_EXECUTION);
    assert.equal(capped.events[0]!.seq, 11, 'les plus anciens sortent, les seq restent fiables');
    assert.equal(capped.events[capped.events.length - 1]!.seq, MAX_EVENTS_PER_EXECUTION + 10);

    // Refus après clôture
    store.completeExecution('u-1', { htmlChars: 42 });
    assert.throws(() => store.appendEvent('u-1', { type: 'PLAN_CREATED', phase: 'PLAN', status: 'COMPLETED', title: 'x' }));
    assert.equal(store.getExecution('u-1')!.summary?.htmlChars, 42);

    // Annulation : ⏹ une seule fois
    store.startExecution({ executionId: 'u-2', tenantId: 't', projectId: 'p', mode: 'modify', prompt: 'demo' });
    store.cancelExecution('u-2', 'client_gone');
    store.cancelExecution('u-2', 'client_gone');
    assert.equal(store.getExecution('u-2')!.events.filter((e) => e.type === 'EXECUTION_CANCELLED').length, 1);

    // Rétention : 22 exécutions → 20 gardées, les plus anciennes sortent
    for (let i = 0; i < MAX_EXECUTIONS_PER_PROJECT + 2; i++) {
      store.startExecution({ executionId: `r-${i}`, tenantId: 't', projectId: 'retention', mode: 'create', prompt: `p${i}` });
    }
    const kept = store.listExecutions('t', 'retention');
    assert.equal(kept.length, MAX_EXECUTIONS_PER_PROJECT);
    assert.ok(!store.getExecution('r-0'), 'la plus ancienne exécution est purgée');
    assert.ok(store.getExecution(`r-${MAX_EXECUTIONS_PER_PROJECT + 1}`), 'la plus récente est gardée');

    // Transition de phase : no-op si déjà courante
    store.startExecution({ executionId: 'u-3', tenantId: 't', projectId: 'p', mode: 'create', prompt: 'demo' });
    assert.ok(store.transitionPhase('u-3', 'IMPLEMENT'), 'première transition enregistrée');
    assert.equal(store.transitionPhase('u-3', 'IMPLEMENT'), null, 'pas de PHASE_CHANGED en double');
  });

  it('7. persistance : un nouveau store relit les exécutions écrites', () => {
    const writer = new ExecutionEventStore({ persist: true });
    writer.startExecution({ executionId: 'rt-1', tenantId: 'rt-tenant', projectId: 'rt-project', mode: 'create', prompt: 'roundtrip' });
    writer.appendEvent('rt-1', { type: 'PLAN_CREATED', phase: 'PLAN', status: 'COMPLETED', title: 'Plan créé' });

    const reader = new ExecutionEventStore({ persist: true });
    const record = reader.getExecution('rt-1');
    assert.ok(record, 'l\'exécution doit survivre à une réinstanciation');
    assert.equal(record!.status, 'RUNNING');
    assert.equal(record!.events.length, 1);
    assert.equal(record!.events[0]!.type, 'PLAN_CREATED');
  });
});

describe('T4 : diff réel de lignes (countLineDelta)', () => {
  it('8. delta multiset honnête : ajouts, retraits, mixte, vide', async () => {
    const { countLineDelta } = await import('../src/routes/conversation.js');
    // Tout ajouté
    assert.deepEqual(countLineDelta('', '<div>a\n<div>b'), { added: 2, removed: 0 });
    // Tout retiré
    assert.deepEqual(countLineDelta('x\ny\ny', ''), { added: 0, removed: 3 });
    // Mixte avec doublons : une ligne gardée ne compte pas
    assert.deepEqual(countLineDelta('gardé\nancien', 'gardé\nnouveau'), { added: 1, removed: 1 });
    // Identique
    assert.deepEqual(countLineDelta('a\nb', 'a\nb'), { added: 0, removed: 0 });
    // Lignes vides / espaces ignorés
    assert.deepEqual(countLineDelta('a\n   \n', 'a'), { added: 0, removed: 0 });
  });
});
