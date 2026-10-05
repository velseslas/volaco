/**
 * ÉTAPE 40 Phase 2 — GET /agents : exposition honnête du Registry réel (É34)
 *
 * Serveur HTTP RÉEL + Registry RÉEL (aucun mock). La réponse est la
 * projection des agents réellement enregistrés — aucun agent CDC fabriqué.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

describe('ÉTAPE 40 Phase 2 — GET /agents (Registry réel)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_p40';
  const REAL_IDS = [
    'agent-ui-specialist',
    'agent-backend-specialist',
    'agent-data-specialist',
    'agent-security-specialist',
    'agent-test-specialist',
    'reference-agent',
    'agent-code-specialist'
  ];
  const FAKE_CDC_IDS = ['intent-agent', 'application-analyst', 'impact-agent', 'planner', 'code-agent', 'database-agent', 'validator-agent', 'repair-agent'];

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
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'OWNER' };
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E40 registry' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  function agentsUrl(proj = projectId): string {
    return `${baseUrl}/api/v1/projects/${proj}/agents`;
  }
  function getHeaders(ten = tenant, role = 'OWNER'): Record<string, string> {
    return { 'x-tenant-id': ten, 'x-user-role': role };
  }

  // A — la liste retourne exactement les agents réellement enregistrés
  it('A: GET /agents → 200 + les agents réellement enregistrés (projection Registry)', async () => {
    const res = await fetch(agentsUrl(), { headers: getHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json() as { agents: Array<Record<string, unknown>>; count: number; requestId: string };
    assert.equal(body.count, body.agents.length);
    assert.equal(body.agents.length, 7, '7 agents réels (5 domaine + reference + code)');
    for (const agent of body.agents) {
      assert.ok(agent.agentId, 'agentId présent');
      assert.ok(agent.name, 'name réel');
      assert.ok(agent.domain, 'domain réel');
      assert.ok(Array.isArray(agent.capabilities) && agent.capabilities.length > 0, 'capabilities réelles');
      assert.ok(typeof agent.description === 'string' && agent.description.length > 0, 'description réelle');
      assert.ok(Array.isArray(agent.requiresProviderCapabilities), 'dépendances provider réelles');
      // Aucune donnée fabriquée : pas d'instance, pas de modèle inventé
      assert.equal(agent.agent, undefined);
      assert.equal(agent.model, undefined);
      assert.equal(agent.provider, undefined);
    }
  });

  // B — les 6 IDs réels présents
  it('B: les 6 IDs réels du Registry sont présents', async () => {
    const body = await (await fetch(agentsUrl(), { headers: getHeaders() })).json() as { agents: Array<{ agentId: string }> };
    const ids = body.agents.map((a) => a.agentId).sort();
    for (const expected of REAL_IDS) {
      assert.ok(ids.includes(expected), `${expected} enregistré`);
    }
    assert.equal(ids.length, 7);
  });

  // C — aucun faux agent CDC fabriqué
  it('C: aucun faux agent CDC (intent/analyst/impact/planner/code/validator/repair) fabriqué', async () => {
    const body = await (await fetch(agentsUrl(), { headers: getHeaders() })).json() as { agents: Array<{ agentId: string }> };
    const ids = body.agents.map((a) => a.agentId);
    for (const fake of FAKE_CDC_IDS) {
      assert.ok(!ids.includes(fake), `aucun faux agent '${fake}'`);
    }
  });

  // D — RBAC avant lecture
  it('D: RBAC — PROJECT_READ vérifié avant la lecture (source) ; rôles standard autorisés', async () => {
    for (const role of ['OWNER', 'ENGINEER', 'VIEWER']) {
      const res = await fetch(agentsUrl(), { headers: getHeaders(tenant, role) });
      assert.equal(res.status, 200, `rôle ${role} a PROJECT_READ → 200`);
    }
    const full = resolve(process.cwd(), 'apps/api/src/routes/agent-execution.ts');
    assert.ok(existsSync(full));
    const code = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const branchStart = code.indexOf("pathname.endsWith('/agents') && req.method === 'GET'");
    const permIndex = code.indexOf("assertPermission(context.role, 'PROJECT_READ'", branchStart);
    assert.ok(permIndex > branchStart, 'assertPermission AVANT la lecture');
    assert.ok(code.indexOf('getExecutionAgentRegistry()', permIndex) > permIndex, 'lecture Registry APRÈS le RBAC');
  });

  // E — lecture pure (inspection de la branche)
  it('E: lecture pure — aucun record(), aucune exécution, aucune écriture dans la branche', () => {
    const full = resolve(process.cwd(), 'apps/api/src/routes/agent-execution.ts');
    const code = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const branchStart = code.indexOf("pathname.endsWith('/agents') && req.method === 'GET'");
    const listStart = code.indexOf("pathname.endsWith('/agents/executions') && req.method === 'GET'");
    const branch = code.slice(branchStart, listStart);
    assert.doesNotMatch(branch, /\.record\(|applyArtifacts|rollbackTransaction|execute\(/, 'aucune action');
    assert.doesNotMatch(branch, /node:fs|writeJsonFileSync|readJsonFile/, 'aucun accès filesystem direct');
    assert.doesNotMatch(branch, /buildTaskTrace|buildBatchTrace/, 'aucune reconstruction');
  });

  // F — les routes É39/É38 restent intactes
  it('F: routes É39/É38 intactes (exécutions, détail, tasks, POST execute/execute-batch)', async () => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'OWNER' };

    // GET liste exécutions (vide = 200 valide)
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions`, { headers: getHeaders() });
    assert.equal(listRes.status, 200);

    // POST execute réel → trace TASK + GET détail
    const eRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers,
      body: JSON.stringify({ agentId: 'reference-agent', executionId: 'agx-p40-f', task: { title: 'P40 F', operation: 'CREATE', targetFiles: ['src/p40-f.ts'], requiredCapabilities: ['FILE_MUTATION'] } })
    });
    assert.equal(eRes.status, 200);

    const dRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions/agx-p40-f`, { headers: getHeaders() });
    assert.equal(dRes.status, 200);
    const dBody = await dRes.json() as { trace: { kind?: string; status?: string } };
    assert.equal(dBody.trace.kind, 'TASK');
    assert.equal(dBody.trace.status, 'SUCCESS');

    // GET /tasks sur un batch réel
    const bRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute-batch`, {
      method: 'POST', headers,
      body: JSON.stringify({ executionId: 'agxb-p40-f', tasks: [{ taskId: 'b1', agentId: 'reference-agent', order: 1, task: { title: 'B1', operation: 'CREATE', targetFiles: ['src/p40-b1.ts'], requiredCapabilities: ['FILE_MUTATION'] } }] })
    });
    assert.equal(bRes.status, 200);
    const tRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions/agxb-p40-f/tasks`, { headers: getHeaders() });
    assert.equal(tRes.status, 200);
    const tBody = await tRes.json() as { batch: { status?: string }; taskTraces: unknown[] };
    assert.equal(tBody.batch.status, 'COMPLETED');
    assert.equal(tBody.taskTraces.length, 1);
  });

  // G — conventions auth/tenant : le roster est global (É34), l'URL suit la convention projet
  it('G: conventions — le roster est global (É34), l URL projet est la convention existante', async () => {
    // Deux projets du même tenant voient le MÊME roster (Registry global É34)
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'OWNER' };
    const pres2 = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E40 registry 2' }) });
    const project2 = ((await pres2.json()) as { project?: { id?: string } }).project!.id!;
    const r1 = await (await fetch(agentsUrl(projectId), { headers: getHeaders() })).json() as { agents: Array<{ agentId: string }> };
    const r2 = await (await fetch(agentsUrl(project2), { headers: getHeaders() })).json() as { agents: Array<{ agentId: string }> };
    assert.deepEqual(r1.agents.map((a) => a.agentId).sort(), r2.agents.map((a) => a.agentId).sort(), 'même Registry global');
  });
});
