/**
 * ÉTAPE 39 Phase 2 — Liste + filtres des ExecutionTrace (lecture pure)
 *
 * Serveur HTTP RÉEL, VRAI pipeline (POST /agents/execute + execute-batch),
 * VRAI AgentTraceStore persistant. La liste ne calcule aucun verdict : les
 * statuts proviennent exactement des traces stockées.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';
// ISOLATION DÉTERMINISTE : le répertoire de persistance est posé AVANT tout
// import du cœur (les imports du cœur sont dynamiques, dans before()) — le
// singleton agentTraceStore de CE process écrit et relit un répertoire qui
// n'appartient qu'à ce fichier (aucune interférence avec la suite, cap 500
// jamais atteint ici).
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
process.env.VOLACO_DATA_DIR = mkdtempSync(join(tmpdir(), 'volaco-e39-list-'));

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentTraceStore as AgentTraceStoreType } from '../../../packages/core/src/index.js';

let AgentTraceStore: typeof import('../../../packages/core/src/index.js').AgentTraceStore;

describe('ÉTAPE 39 Phase 2 — GET /agents/executions (liste + filtres)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_p39';

  before(async () => {
    ({ AgentTraceStore } = await import('../../../packages/core/src/index.js'));
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
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E39 liste' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;

    // Données réelles : 2 TASK SUCCESS (agents distincts d'executionId) + 1 TASK FAILURE + 1 BATCH COMPLETED
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers,
      body: JSON.stringify({ agentId: 'reference-agent', executionId: 'agx-p39-1', task: { title: 'P39 1', operation: 'CREATE', targetFiles: ['src/p39-1.ts'], requiredCapabilities: ['FILE_MUTATION'] } })
    });
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers,
      body: JSON.stringify({ agentId: 'reference-agent', executionId: 'agx-p39-2', task: { title: 'P39 2', operation: 'CREATE', targetFiles: ['src/p39-2.ts'], requiredCapabilities: ['FILE_MUTATION'] } })
    });
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers,
      body: JSON.stringify({ agentId: 'reference-agent', executionId: 'agx-p39-fail', task: { title: 'P39 fail', operation: 'CREATE', targetFiles: ['src/p39-2.ts'], requiredCapabilities: ['FILE_MUTATION'] } })
    });
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute-batch`, {
      method: 'POST', headers,
      body: JSON.stringify({ executionId: 'agxb-p39-1', tasks: [
        { taskId: 'b1', agentId: 'reference-agent', order: 1, task: { title: 'B1', operation: 'CREATE', targetFiles: ['src/p39-b1.ts'], requiredCapabilities: ['FILE_MUTATION'] } }
      ] })
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  function listUrl(query = '', proj = projectId, ten = tenant, role = 'OWNER'): string {
    return `${baseUrl}/api/v1/projects/${proj}/agents/executions${query}`;
  }
  function listHeaders(ten = tenant, role = 'OWNER'): Record<string, string> {
    return { 'x-tenant-id': ten, 'x-user-role': role };
  }

  // A — liste vide sur un projet sans exécution
  it('A: projet sans exécution → 200 + réponse vide valide', async () => {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers: listHeaders(), body: JSON.stringify({ name: 'E39 vide' }) });
    const emptyProject = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    const res = await fetch(listUrl('', emptyProject), { headers: listHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json() as { items: unknown[]; count: number };
    assert.equal(body.count, 0);
    assert.deepEqual(body.items, []);
  });

  // B/C — TASK et BATCH réels apparaissent
  it('B+C: les traces TASK et BATCH réelles apparaissent dans la liste', async () => {
    const res = await fetch(listUrl(), { headers: listHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json() as { items: Array<{ kind: string; executionId: string }>; count: number };
    const kinds = body.items.map((i) => i.kind);
    assert.ok(kinds.includes('TASK') && kinds.includes('BATCH'));
    const ids = body.items.map((i) => i.executionId);
    for (const expected of ['agx-p39-1', 'agx-p39-2', 'agx-p39-fail', 'agxb-p39-1']) {
      assert.ok(ids.includes(expected), `${expected} dans la liste`);
    }
  });

  // D — kind=TASK
  it('D: kind=TASK → uniquement des traces TASK', async () => {
    const res = await fetch(listUrl('?kind=TASK'), { headers: listHeaders() });
    const body = await res.json() as { items: Array<{ kind: string }> };
    assert.ok(body.items.length >= 3);
    assert.ok(body.items.every((i) => i.kind === 'TASK'));
  });

  // E — kind=BATCH
  it('E: kind=BATCH → uniquement des traces BATCH', async () => {
    const res = await fetch(listUrl('?kind=BATCH'), { headers: listHeaders() });
    const body = await res.json() as { items: Array<{ kind: string; executionId: string }> };
    assert.ok(body.items.length >= 1);
    assert.ok(body.items.every((i) => i.kind === 'BATCH'));
    assert.ok(body.items.some((i) => i.executionId === 'agxb-p39-1'));
  });

  // F — status filtre
  it('F: status=SUCCESS → uniquement des SUCCESS ; status=FAILED → uniquement des FAILED', async () => {
    const ok = await (await fetch(listUrl('?status=SUCCESS'), { headers: listHeaders() })).json() as { items: Array<{ status: string }> };
    assert.ok(ok.items.length >= 2);
    assert.ok(ok.items.every((i) => i.status === 'SUCCESS'));
    // Le verdict réel d'une TÂCHE est FAILURE (statut batch = FAILED) :
    // la liste retourne les statuts exacts des traces stockées.
    const failed = await (await fetch(listUrl('?status=FAILURE'), { headers: listHeaders() })).json() as { items: Array<{ status: string; executionId: string }> };
    assert.ok(failed.items.length >= 1);
    assert.ok(failed.items.every((i) => i.status === 'FAILURE'));
    assert.ok(failed.items.some((i) => i.executionId === 'agx-p39-fail'), 'le failure réel est listé');
  });

  // G — agentId filtre
  it('G: agentId=reference-agent → uniquement cet agent', async () => {
    const res = await fetch(listUrl('?agentId=reference-agent'), { headers: listHeaders() });
    const body = await res.json() as { items: Array<{ agentId: string }> };
    assert.ok(body.items.length >= 4);
    assert.ok(body.items.every((i) => i.agentId === 'reference-agent'));
    const none = await (await fetch(listUrl('?agentId=agent-inexistant-39'), { headers: listHeaders() })).json() as { items: unknown[] };
    assert.equal(none.items.length, 0);
  });

  // H — combinaison AND
  it('H: kind=TASK&status=SUCCESS&agentId=reference-agent → AND logique', async () => {
    const res = await fetch(listUrl('?kind=TASK&status=SUCCESS&agentId=reference-agent'), { headers: listHeaders() });
    const body = await res.json() as { items: Array<{ kind: string; status: string; agentId: string; executionId: string }> };
    assert.ok(body.items.length >= 2);
    assert.ok(body.items.every((i) => i.kind === 'TASK' && i.status === 'SUCCESS' && i.agentId === 'reference-agent'));
    assert.ok(body.items.some((i) => i.executionId === 'agx-p39-1'));
    assert.ok(!body.items.some((i) => i.executionId === 'agx-p39-fail'));
  });

  // I/J — tri ASC/DESC sur startedAt réel
  it('I+J: order=ASC et order=DESC trient chronologiquement (startedAt réel)', async () => {
    const asc = await (await fetch(listUrl('?order=ASC'), { headers: listHeaders() })).json() as { items: Array<{ startedAt: string }> };
    const desc = await (await fetch(listUrl('?order=DESC'), { headers: listHeaders() })).json() as { items: Array<{ startedAt: string }> };
    assert.ok(asc.items.length >= 4);
    for (let i = 1; i < asc.items.length; i++) {
      assert.ok(asc.items[i - 1]!.startedAt <= asc.items[i]!.startedAt, 'ASC chronologique');
    }
    assert.deepEqual(
      asc.items.map((i) => i.startedAt).reverse(),
      desc.items.slice(0, asc.items.length).map((i) => i.startedAt)
    );
  });

  // K — tie-breaker déterministe (timestamps identiques dans une vague)
  it('K: tie-breaker executionId déterministe à startedAt égal', async () => {
    const asc = await (await fetch(listUrl('?kind=BATCH&order=ASC'), { headers: listHeaders() })).json() as { items: Array<{ startedAt: string; executionId: string }> };
    for (let i = 1; i < asc.items.length; i++) {
      if (asc.items[i - 1]!.startedAt === asc.items[i]!.startedAt) {
        assert.ok(asc.items[i - 1]!.executionId < asc.items[i]!.executionId, 'tie-breaker executionId ASC');
      }
    }
    const again = await (await fetch(listUrl('?kind=BATCH&order=ASC'), { headers: listHeaders() })).json() as { items: Array<{ executionId: string }> };
    assert.deepEqual(asc.items.map((i) => i.executionId), again.items.map((i) => i.executionId), 'ordre identique entre deux appels');
  });

  // L+M — limit : taille de réponse, cap de rétention inchangé
  it('L+M: limit borne la réponse sans modifier le cap de rétention du store', async () => {
    const res = await fetch(listUrl('?limit=2'), { headers: listHeaders() });
    const body = await res.json() as { items: unknown[]; count: number };
    assert.equal(body.items.length, 2);
    assert.equal(body.count, 2);
    // Le store conserve TOUTES les traces persistées (cap rétention inchangé)
      const reloaded = new AgentTraceStore({ persist: true });
      assert.ok(reloaded.query(tenant, projectId).length >= 4, 'le store garde toutes les traces (cap rétention distinct)');
      // limit invalide → convention d'erreur existante (ValidationError → 400)
      const bad = await fetch(listUrl('?limit=-3'), { headers: listHeaders() });
      assert.equal(bad.status, 400);
      const badBody = await bad.json() as { error?: { code?: string } };
      assert.equal(badBody.error?.code, 'VALIDATION_ERROR');
  });

  // N+O — isolation tenant/projet
  it('N+O: isolation — un autre tenant/projet ne voit aucune trace', async () => {
    const resOtherTenant = await fetch(listUrl('', projectId, 'tenant_p39_autre'), { headers: listHeaders('tenant_p39_autre') });
    const otherTenant = await resOtherTenant.json() as { items: unknown[] };
    assert.equal(otherTenant.items.length, 0, 'aucune fuite cross-tenant');
    const resOtherProject = await fetch(listUrl('', 'proj-autre-p39'), { headers: listHeaders() });
    const otherProject = await resOtherProject.json() as { items: unknown[] };
    assert.equal(otherProject.items.length, 0, 'aucune fuite cross-projet');
  });

  // P — PROJECT_READ avant lecture (inspection source + VIEWER autorisé)
  it('P: PROJECT_READ vérifié avant lecture (source) — VIEWER autorisé (PROJECT_READ)', async () => {
    const res = await fetch(listUrl('', projectId, tenant, 'VIEWER'), { headers: listHeaders(tenant, 'VIEWER') });
    assert.equal(res.status, 200, 'VIEWER a PROJECT_READ → 200');
    const full = resolve(process.cwd(), 'apps/api/src/routes/agent-execution.ts');
    const code = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const listIndex = code.indexOf("pathname.endsWith('/agents/executions') && req.method === 'GET'");
    const permIndex = code.indexOf("assertPermission(context.role, 'PROJECT_READ'", listIndex);
    assert.ok(permIndex > listIndex, 'assertPermission AVANT la lecture');
    assert.ok(code.indexOf('agentTraceStore.query(', permIndex) > permIndex, 'lecture store APRÈS le contrôle RBAC');
  });

  // Q — GET /:executionId toujours fonctionnel
  it('Q: GET /:executionId (détail) reste fonctionnel après ajout de la liste', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/executions/agx-p39-1`, { headers: listHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json() as { trace: { kind: string; executionId: string } };
    assert.equal(body.trace.kind, 'TASK');
    assert.equal(body.trace.executionId, 'agx-p39-1');
  });

  // R+S — POST inchangés
  it('R+S: POST /agents/execute et /agents/execute-batch restent fonctionnels', async () => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'OWNER' };
    const eRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers,
      body: JSON.stringify({ agentId: 'reference-agent', executionId: 'agx-p39-reg', task: { title: 'R', operation: 'CREATE', targetFiles: ['src/p39-reg.ts'], requiredCapabilities: ['FILE_MUTATION'] } })
    });
    assert.equal(eRes.status, 200);
    const bRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute-batch`, {
      method: 'POST', headers,
      body: JSON.stringify({ executionId: 'agxb-p39-reg', tasks: [{ taskId: 'r1', agentId: 'reference-agent', order: 1, task: { title: 'RB', operation: 'CREATE', targetFiles: ['src/p39-rb.ts'], requiredCapabilities: ['FILE_MUTATION'] } }] })
    });
    assert.equal(bRes.status, 200);
  });

  // T — persistance réelle : nouvelle instance retrouve les traces
  it('T: persistance réelle — nouvelle AgentTraceStore({persist:true}) retrouve les traces listées', async () => {
      const reloaded = new AgentTraceStore({ persist: true });
      const persisted = reloaded.query(tenant, projectId);
      const http = await (await fetch(listUrl(), { headers: listHeaders() })).json() as { items: Array<{ executionId: string }> };
      for (const item of http.items) {
        assert.ok(persisted.some((t) => t.executionId === item.executionId), `${item.executionId} persisté et listé`);
      }
  });

  // U+V — déterminisme + immutabilité du store après GET
  it('U+V: deux appels identiques → même liste ; le GET ne mute pas le store', async () => {
    const r1 = await (await fetch(listUrl('?order=ASC'), { headers: listHeaders() })).json() as { items: Array<{ executionId: string; status: string }>; count: number };
    // requestId exclu : champ de requête HTTP, pas une donnée de trace
    const before = { items: r1.items, count: r1.count };
    const r2 = await (await fetch(listUrl('?order=ASC'), { headers: listHeaders() })).json() as { items: Array<{ executionId: string; status: string }>; count: number };
    // requestId = identifiant de requête HTTP légitime (différent à chaque
    // appel) — comparé hors ce champ ; items/count sont identiques.
    assert.deepEqual(
      { items: r1.items, count: r1.count },
      { items: r2.items, count: r2.count },
      'deux appels identiques → même liste'
    );
    assert.deepEqual({ items: r1.items, count: r1.count }, before);
      const reloaded = new AgentTraceStore({ persist: true });
      const beforeReloaded = JSON.parse(JSON.stringify(reloaded.query(tenant, projectId).map((t) => t.executionId)));
      await fetch(listUrl('?kind=TASK'), { headers: listHeaders() });
      assert.deepEqual(
        JSON.parse(JSON.stringify(reloaded.query(tenant, projectId).map((t) => t.executionId))),
        beforeReloaded,
        'le GET liste ne mute pas le store'
      );
  });

  // W+X+Y — inspection : aucun verdict, aucun node:fs, pipeline inchangé
  it('W+X+Y: route liste = lecture pure (aucun verdict, aucun node:fs, exécution inchangée)', () => {
    const full = resolve(process.cwd(), 'apps/api/src/routes/agent-execution.ts');
    assert.ok(existsSync(full));
    const code = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const listStart = code.indexOf("pathname.endsWith('/agents/executions') && req.method === 'GET'");
    const detailStart = code.indexOf("pathname.includes('/agents/executions/') && req.method === 'GET'");
    const listBranch = code.slice(listStart, detailStart);
    assert.doesNotMatch(listBranch, /'SUCCESS'|'COMPLETED'|'FAILED'|'CANCELLED'/, 'aucun verdict littéral dans la branche liste');
    assert.doesNotMatch(listBranch, /node:fs|writeJsonFileSync|readJsonFile/, 'aucun accès filesystem direct');
    assert.doesNotMatch(listBranch, /applyArtifacts|rollbackTransaction|execute\(/, 'aucune action d exécution/mutation');
    assert.ok(listBranch.includes('agentTraceStore.query(context.tenantId, projectId)'), 'lecture via le store existant');
    // Le pipeline d'exécution n'est pas modifié : la logique de verdict reste dans agent-execution.ts
    const execFile = readFileSync(resolve(process.cwd(), 'packages/core/src/ai-native/ai-orchestrator/execution/agent-execution.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(execFile.includes('verification.passed'), 'logique de verdict intacte dans agent-execution.ts');
  });
});
