/**
 * ÉTAPE 41 Phase A — fondation du panneau Studio « Exécutions Agents ».
 *
 * Tests HTTP réels : le panneau consomme EXCLUSIVEMENT les routes GET
 * existantes (GET /agents, GET /agents/executions avec filtres). Ces tests
 * vérifient le comportement RÉEL des routes consommées par le panneau —
 * présence des données, filtres, état vide honnête, absence de fabrication.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { agentTraceStore } from '../../../packages/core/src/index.js';

describe('ÉTAPE 41 Phase A — panneau Agents (roster + liste exécutions)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_e41a';
  const studioHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

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
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers: studioHeaders, body: JSON.stringify({ name: 'E41 panneau agents' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // 1 — le panneau existe dans le Studio (HTML réel servi)
  it('1: le Studio servi contient le panneau Agents (container + onglet + refresh)', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.ok(served.includes('id="agentsPanelContainer"'), 'container du panneau présent');
    assert.ok(served.includes("switchHistorySubMode('agents')"), 'onglet Agents présent');
    assert.ok(served.includes('id="btnAgentsRefresh"'), 'bouton refresh manuel présent');
    assert.ok(served.includes('id="agentsFilterKind"') && served.includes('id="agentsFilterStatus"') && served.includes('id="agentsFilterAgentId"'), 'filtres présents');
  });

  // 2 — roster chargé depuis GET /agents (données réelles du Registry)
  it('2: GET /agents → roster réel (7 agents, champs réels, aucun champ fabriqué)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents`, { headers: getHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json() as { agents: Array<Record<string, unknown>>; count: number };
    assert.equal(body.count, 7);
    for (const a of body.agents) {
      assert.equal(a.model, undefined, 'aucun modèle inventé');
      assert.equal(a.provider, undefined, 'aucun provider inventé');
      assert.equal(a.agent, undefined, 'aucune instance sérialisée');
    }
  });

  // 3+4 — exécutions chargées depuis GET /agents/executions après exécution réelle
  it('3+4: exécution réelle via agent-code-specialist → visible dans GET /agents/executions', async () => {
    const eRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers: studioHeaders,
      body: JSON.stringify({ agentId: 'agent-code-specialist', executionId: 'agx-e41a-panel', task: { title: 'Panneau', operation: 'CREATE', targetFiles: ['src/panel.ts'], requiredCapabilities: ['SERVICE_LOGIC'] } })
    });
    assert.equal(eRes.status, 200);
    const list = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions?order=DESC&limit=50`, { headers: getHeaders() })).json() as { items: Array<{ executionId: string; kind: string; status: string; agentId?: string }> };
    const item = list.items.find((i) => i.executionId === 'agx-e41a-panel');
    assert.ok(item, 'l exécution réelle apparaît dans la liste');
    assert.equal(item.kind, 'TASK');
    // Verdict RÉEL : SUCCESS si une clé LLM est configurée dans l'env du
    // serveur, DEGRADED sinon (agent exécuté sans LLM — contenu structurel).
    // Les deux sont des verdicts réels du pipeline É32→É40.
    assert.ok(['SUCCESS', 'DEGRADED'].includes(item.status), 'verdict réel : ' + item.status);
    assert.equal(item.agentId, 'agent-code-specialist');
  });

  // 5/6/7 — filtres réels du backend consommés par le panneau
  it('5+6+7: filtres kind/status/agentId appliqués par le backend', async () => {
    const byKind = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions?kind=TASK`, { headers: getHeaders() })).json() as { items: Array<{ kind: string }> };
    assert.ok(byKind.items.length >= 1);
    assert.ok(byKind.items.every((i) => i.kind === 'TASK'));

    const byStatus = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions?status=SUCCESS`, { headers: getHeaders() })).json() as { items: Array<{ status: string }> };
    assert.ok(byStatus.items.every((i) => i.status === 'SUCCESS'));

    const byAgent = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions?agentId=agent-code-specialist`, { headers: getHeaders() })).json() as { items: Array<{ agentId?: string }> };
    assert.ok(byAgent.items.every((i) => i.agentId === 'agent-code-specialist'));
  });

  // 8 — état vide honnête (projet sans exécution)
  it('8: état vide honnête — projet sans exécution → items vides, aucune donnée fabriquée', async () => {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers: studioHeaders, body: JSON.stringify({ name: 'E41 vide' }) });
    const emptyProject = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    const res = await fetch(`${baseUrl}/api/v1/projects/${emptyProject}/agents/executions?order=DESC`, { headers: getHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json() as { items: unknown[]; count: number };
    assert.equal(body.count, 0);
    assert.deepEqual(body.items, []);
  });

  // 9 — refresh manuel : deux appels identiques → même contenu (hors requestId)
  it('9: refresh manuel — deux GET identiques → même liste (déterministe hors requestId)', async () => {
    const r1 = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions?order=DESC&limit=50`, { headers: getHeaders() })).json() as { items: Array<{ executionId: string }> };
    const r2 = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions?order=DESC&limit=50`, { headers: getHeaders() })).json() as { items: Array<{ executionId: string }> };
    assert.deepEqual(
      r1.items.map((i) => i.executionId),
      r2.items.map((i) => i.executionId)
    );
  });

  // 10 — aucune donnée fictive : aucune donnée "En cours"/simulée dans le HTML du panneau
  it('10: aucune donnée fictive — le panneau ne contient ni données de démo ni polling', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    const panelStart = served.indexOf('id="agentsPanelContainer"');
    const panelEnd = served.indexOf('id="revisionsListContainer"');
    const panel = served.slice(panelStart, panelEnd);
    assert.doesNotMatch(panel, /demo|mock|fake|Douceurs/i, 'aucune donnée de démonstration');
    assert.doesNotMatch(panel, /setInterval|setTimeout.*refresh|polling/i, 'aucun polling automatique');
    // Le rafraîchissement est déclenché par le bouton / les filtres uniquement
    assert.match(panel, /onclick="refreshAgentsPanel\(\)"/);
  });

  // 11 — non-régression backend : les traces TASK restent É38/É39
  it('11: non-régression — les traces TASK restent réelles dans le store (aucune trace UI fabriquée)', () => {
    const stored = agentTraceStore.query(tenant, projectId);
    assert.ok(stored.length >= 1);
    assert.ok(stored.every((t) => t.kind === 'TASK'));
    assert.ok(stored.every((t) => t.agentId === 'agent-code-specialist'));
  });

  function getHeaders(ten = tenant, role = 'ENGINEER'): Record<string, string> {
    return { 'x-tenant-id': ten, 'x-user-role': role };
  }
});
