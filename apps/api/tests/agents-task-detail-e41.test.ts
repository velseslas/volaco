/**
 * ÉTAPE 41 Phase B — détail d'une exécution TASK dans le panneau Agents.
 *
 * La route consommée est EXCLUSIVEMENT GET /agents/executions/:id (réponse
 * réelle du backend, rendue telle quelle). Ces tests vérifient que le détail
 * servi correspond EXACTEMENT à la trace stockée (deepEqual), champs absents
 * compris — et que le HTML du panneau n'invente rien.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { agentTraceStore } from '../../../packages/core/src/index.js';

describe('ÉTAPE 41 Phase B — détail TASK (GET /agents/executions/:id)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_e41b';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };
  let taskExecId = 'agx-e41b-task';

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
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E41 PB détail' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;

    // Exécution TASK réelle via le pipeline (agent-code-specialist)
    const eRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers,
      body: JSON.stringify({ agentId: 'agent-code-specialist', executionId: taskExecId, task: { title: 'Détail P41B', operation: 'CREATE', targetFiles: ['src/detail.ts'], requiredCapabilities: ['SERVICE_LOGIC'] } })
    });
    assert.equal(eRes.status, 200);
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  function detailUrl(id = taskExecId): string {
    return `${baseUrl}/api/v1/projects/${projectId}/agents/executions/${encodeURIComponent(id)}`;
  }

  // 1+2 — la TASK est sélectionnable depuis la liste (clic → détail via GET /:id)
  it('1+2: la TASK est listée (clic possible) et GET /:id sert le détail réel', async () => {
    const list = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions?order=DESC`, { headers })).json() as { items: Array<{ executionId: string; kind: string }> };
    const listed = list.items.find((i) => i.executionId === taskExecId);
    assert.ok(listed, 'la TASK apparaît dans la liste (cliquable)');
    assert.equal(listed.kind, 'TASK');

    const res = await fetch(detailUrl(), { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { trace: Record<string, unknown> };
    assert.ok(body.trace, 'le détail est servi par GET /:id');
  });

  // 3+4+5 — executionId, agentId, status identiques à la trace stockée
  it('3+4+5: executionId/agentId/status identiques à la trace stockée', async () => {
    const body = await (await fetch(detailUrl(), { headers })).json() as { trace: { executionId: string; agentId: string; status: string } };
    const stored = agentTraceStore.get(tenant, projectId, taskExecId)!;
    assert.equal(body.trace.executionId, stored.executionId);
    assert.equal(body.trace.agentId, stored.agentId);
    assert.equal(body.trace.status, stored.status);
  });

  // 6 — phases identiques à la trace stockée (ordre backend)
  it('6: phases identiques à la trace stockée (ordre backend, timestamps inclus)', async () => {
    const body = await (await fetch(detailUrl(), { headers })).json() as { trace: { phases: Array<Record<string, unknown>> } };
    const stored = agentTraceStore.get(tenant, projectId, taskExecId)!;
    assert.deepEqual(body.trace.phases, stored.phases, 'projection exacte des phases réelles');
    // Phases réelles attendues pour une exécution TASK
    const names = stored.phases.map((p) => p.phase);
    // Sans clé LLM dans l'env de test, le Code Agent tourne en DEGRADED :
    // la phase finale réelle est FINAL_DEGRADED (verdict réel du pipeline).
    assert.ok(names.includes('AGENT_STARTED') && names.includes('FINAL_DEGRADED'));
  });

  // 7 — Gate identique à la trace (présent car opération CREATE mutée)
  it('7: Gate identique à la trace stockée (PASS réel, jamais fabriqué)', async () => {
    const body = await (await fetch(detailUrl(), { headers })).json() as { trace: { gate: Record<string, unknown> | null } };
    const stored = agentTraceStore.get(tenant, projectId, taskExecId)!;
    assert.deepEqual(body.trace.gate, stored.gate, 'Gate = projection exacte');
    assert.equal(body.trace.gate?.passed, true);
    assert.equal(body.trace.gate?.gateId, 'FILE_MUTATION_GATE');
  });

  // 8 — artifacts identiques à la trace
  it('8: artifacts identiques à la trace stockée (résumés réels)', async () => {
    const body = await (await fetch(detailUrl(), { headers })).json() as { trace: { artifacts: Array<Record<string, unknown>> } };
    const stored = agentTraceStore.get(tenant, projectId, taskExecId)!;
    assert.deepEqual(body.trace.artifacts, stored.artifacts);
    assert.equal(body.trace.artifacts[0]!.kind, 'PROPOSED_FILE_CHANGE');
  });

  // 9 — mutation identique à la trace (transactionId réel)
  it('9: mutation identique à la trace stockée (transactionId réel tx-…)', async () => {
    const body = await (await fetch(detailUrl(), { headers })).json() as { trace: { mutation: Record<string, unknown> } };
    const stored = agentTraceStore.get(tenant, projectId, taskExecId)!;
    assert.deepEqual(body.trace.mutation, stored.mutation);
    assert.match(String(body.trace.mutation.transactionId), /^tx-/);
    assert.equal(body.trace.mutation.executed, true);
  });

  // 12 — champs absents restent absents (aucune fabrication)
  it('12: champs absents restent absents (repair/cancellation non fabriqués pour un succès simple)', async () => {
    const body = await (await fetch(detailUrl(), { headers })).json() as { trace: Record<string, unknown> };
    const stored = agentTraceStore.get(tenant, projectId, taskExecId)!;
    // Le repair n'existe pas sans politique : il doit rester absent dans la trace
    assert.equal(stored.repair, undefined, 'aucun repair réel pour ce scénario');
    assert.equal(body.trace.repair, undefined);
    // cancellation non demandée
    assert.equal((body.trace.cancellation as { requested?: boolean })?.requested, false);
  });

  // 14 — retour vers la liste (côté panneau, structure HTML)
  it('14: navigation — bouton retour présent dans le rendu du panneau (source)', () => {
    const full = resolve(process.cwd(), 'apps/studio/index.html');
    const served = readFileSync(full, 'utf8');
    assert.match(served, /function closeAgentsTaskDetail\(\)/, 'fonction retour présente');
    assert.match(served, /openAgentsTaskDetail\(/, 'ouverture détail présente');
    // GET détail reste fonctionnel après ouverture (re-vérification)
    return fetch(detailUrl(), { headers }).then((r) => assert.equal(r.status, 200));
  });

  // 15 — aucune régression Phase A : liste toujours fonctionnelle
  it('15: non-régression Phase A — la liste reste fonctionnelle après Phase B', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions?order=DESC&limit=50`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { items: Array<{ executionId: string }>; count: number };
    assert.equal(body.count, 1);
    assert.equal(body.items[0]!.executionId, taskExecId);
  });

  // 13 — échappement HTML dans le détail (rendu panneau)
  it('13: échappement HTML — le rendu du panneau échappe les valeurs (agentId, error)', () => {
    const full = resolve(process.cwd(), 'apps/studio/index.html');
    const served = readFileSync(full, 'utf8');
    assert.match(served, /function agentsPanelEscape\(/, 'fonction échappement présente');
    // Le détail utilise agentsPanelEscape pour les valeurs injectées
    const detailFn = served.slice(served.indexOf('async function openAgentsTaskDetail'), served.indexOf('function closeAgentsTaskDetail'));
    // L'échappement des valeurs passe par agentsDetailRow → agentsPanelEscape
    assert.ok(detailFn.includes("agentsDetailRow('agentId', trace.agentId)"));
    assert.ok(detailFn.includes("agentsDetailRow('erreur', trace.error)"));
    assert.ok(detailFn.includes("agentsPanelEscape(p.phase)"), 'phases échappées');
    assert.doesNotMatch(detailFn, /innerHTML\s*\+=[^;]*trace\.(agentId|error|executionId)[^;]*;/, 'aucune injection brute des valeurs');
  });

  // 11 — aucune donnée fictive : le détail n'existe que si le store le possède
  it('11: aucune donnée fictive — le détail sert uniquement ce que le store possède', async () => {
    const stored = agentTraceStore.get(tenant, projectId, taskExecId)!;
    const body = await (await fetch(detailUrl(), { headers })).json() as { trace: Record<string, unknown> };
    // Chaque clé présente dans le détail doit exister dans la trace stockée
    for (const key of Object.keys(body.trace)) {
      assert.ok(key in stored, `clé '${key}' provient de la trace stockée (aucune fabrication)`);
    }
    // Et les valeurs sont identiques (deepEqual complet, hors référence)
    assert.deepEqual(JSON.parse(JSON.stringify(body.trace)), JSON.parse(JSON.stringify(stored)));
  });

  // 10 — pas de polling : le panneau ne contient aucun setInterval
  it('10: pas de polling — aucun setInterval dans le panneau Agents (source)', () => {
    const full = resolve(process.cwd(), 'apps/studio/index.html');
    const served = readFileSync(full, 'utf8');
    const panelCode = served.slice(served.indexOf('function refreshAgentsPanel'), served.indexOf('function addProjectActivity'));
    assert.doesNotMatch(panelCode, /setInterval/, 'aucun polling');
    assert.match(panelCode, /async function openAgentsTaskDetail/, 'le détail est un fetch à la demande');
  });
});
