/**
 * ÉTAPE 38 Phase 6 — GET de consultation des ExecutionTrace
 *
 * Serveur HTTP RÉEL (createApiServer), VRAI pipeline (POST /agents/execute +
 * /agents/execute-batch), VRAI store persistant (agentTraceStore singleton).
 * Le GET est une lecture pure : la réponse doit être EXACTEMENT la trace
 * stockée (deepEqual), aucun verdict recalculé, aucune fuite cross-tenant.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';
// ISOLATION (infra de test) : répertoire de persistance NEUF — sinon le
// singleton persist:true partage le répertoire de toute la suite et le cap
// 500 évince des traces selon l'ordre des fichiers (les tests D/E de
// reconstruction deviennent non déterministes). Assertions inchangées.
// ÉTAPE 38 Phase 6 — reconstruction : le singleton agentTraceStore a figé
// son chemin de persistance À L'IMPORT (répertoire de la suite) ; les tests
// de reconstruction épinglent donc ce répertoire-là, pas un autre.
const singletonDataDir = process.env.VOLACO_DATA_DIR;
function pinDataDir(): () => void {
  const previous = process.env.VOLACO_DATA_DIR;
  process.env.VOLACO_DATA_DIR = singletonDataDir;
  return () => { process.env.VOLACO_DATA_DIR = previous; };
}

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  AgentTraceStore,
  assertPermission,
  agentTraceStore,
  ForbiddenError
} from '../../../packages/core/src/index.js';

describe('ÉTAPE 38 Phase 6 — GET /agents/executions/:executionId', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_p6';

  let taskExecutionId = '';
  let batchExecutionId = '';

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

    // Projet réel
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E38 Phase 6' }) });
    const pdata = await pres.json() as { project?: { id?: string } };
    projectId = pdata.project!.id!;

    // TASK réelle via POST /agents/execute
    const tRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers,
      body: JSON.stringify({
        agentId: 'reference-agent', executionId: 'agx-p6-task',
        task: { title: 'Tâche P6', description: '', operation: 'CREATE', targetFiles: ['src/p6.ts'], requiredCapabilities: ['FILE_MUTATION'] }
      })
    });
    assert.equal(tRes.status, 200, 'POST /agents/execute reste fonctionnel (L)');
    const tData = await tRes.json() as { outcome?: { status?: string } };
    assert.equal(tData.outcome?.status, 'SUCCESS');
    taskExecutionId = 'agx-p6-task';

    // BATCH réel via POST /agents/execute-batch
    const bRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute-batch`, {
      method: 'POST', headers,
      body: JSON.stringify({
        executionId: 'agxb-p6-batch', repair: true,
        tasks: [
          { taskId: 'p6a', agentId: 'reference-agent', order: 1, task: { title: 'P6 alpha', operation: 'CREATE', targetFiles: ['src/p6a.ts'], requiredCapabilities: ['FILE_MUTATION'] } },
          { taskId: 'p6b', agentId: 'reference-agent', order: 2, task: { title: 'P6 beta', operation: 'CREATE', targetFiles: ['src/p6b.ts'], requiredCapabilities: ['FILE_MUTATION'] } }
        ]
      })
    });
    assert.equal(bRes.status, 200, 'POST /agents/execute-batch reste fonctionnel (M)');
    const bData = await bRes.json() as { outcome?: { status?: string } };
    assert.equal(bData.outcome?.status, 'COMPLETED');
    batchExecutionId = 'agxb-p6-batch';
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  function getUrl(executionId: string, proj = projectId, ten = tenant, role = 'OWNER'): string {
    return `${baseUrl}/api/v1/projects/${proj}/agents/executions/${encodeURIComponent(executionId)}`;
  }

  function getHeaders(ten = tenant, role = 'OWNER'): Record<string, string> {
    return { 'x-tenant-id': ten, 'x-user-role': role };
  }

  // A/B — GET TASK 200 / GET BATCH 200
  it('A: GET TASK existante → 200 + trace exacte', async () => {
    const res = await fetch(getUrl(taskExecutionId), { headers: getHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json() as { trace: Record<string, unknown> };
    assert.equal(body.trace.executionId, taskExecutionId);
    assert.equal(body.trace.kind, 'TASK');
    assert.equal(body.trace.status, 'SUCCESS');
    assert.equal(body.trace.agentId, 'reference-agent');
  });

  it('B: GET BATCH existant → 200 + trace exacte', async () => {
    const res = await fetch(getUrl(batchExecutionId), { headers: getHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json() as { trace: Record<string, unknown> };
    assert.equal(body.trace.kind, 'BATCH');
    assert.equal(body.trace.status, 'COMPLETED');
    assert.equal((body.trace.counts as { completed: number }).completed, 2);
  });

  // C+O — trace exacte, aucune transformation
  it('C+O: réponse deepEqual à la trace stockée (aucune transformation, aucun champ ajouté)', async () => {
    const res = await fetch(getUrl(taskExecutionId), { headers: getHeaders() });
    const body = await res.json() as { trace: Record<string, unknown> };
    const stored = agentTraceStore.get(tenant, projectId, taskExecutionId)!;
    // Round-trip JSON des deux côtés (la sérialisation HTTP supprime les clés
    // undefined — les deux côtés sont comparés après le même passage).
    assert.deepEqual(JSON.parse(JSON.stringify(body.trace)), JSON.parse(JSON.stringify(stored)));
  });

  // D — TASK persistant (le GET reflète le store persistant)
  it('D: reconstruction du store persistant → la trace reste consultable et identique', async () => {
    // Nouvelle instance sur le MÊME répertoire de données (persistance réelle)
    const restore = pinDataDir();
    try {
      const reloaded = new AgentTraceStore({ persist: true });
      const reloadedTrace = reloaded.get(tenant, projectId, taskExecutionId);
      assert.ok(reloadedTrace, 'trace persistée retrouvée après reconstruction');
      const res = await fetch(getUrl(taskExecutionId), { headers: getHeaders() });
      const body = await res.json() as { trace: Record<string, unknown> };
      assert.deepEqual(
        JSON.parse(JSON.stringify(body.trace)),
        JSON.parse(JSON.stringify(reloadedTrace)),
        'GET = contenu du store persistant reconstruit'
      );
    } finally {
      restore();
    }
  });

  // E — BATCH persistant
  it('E: trace BATCH persistante retrouvée après reconstruction', async () => {
    const restore = pinDataDir();
    try {
      const reloaded = new AgentTraceStore({ persist: true });
      const reloadedBatch = reloaded.get(tenant, projectId, batchExecutionId);
      assert.ok(reloadedBatch);
      assert.equal(reloadedBatch.kind, 'BATCH');
      assert.equal(reloadedBatch.tasks?.length, 2);
    } finally {
      restore();
    }
  });

  // F — exécution inexistante → 404
  it('F: executionId inexistante → 404 NOT_FOUND', async () => {
    const res = await fetch(getUrl('agx-inexistante-p6'), { headers: getHeaders() });
    assert.equal(res.status, 404);
    const body = await res.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, 'NOT_FOUND');
  });

  // G — autre tenant → 404 (même executionId existe chez tenant_p6)
  it('G: autre tenant → 404 canonique, aucune fuite', async () => {
    const res = await fetch(getUrl(taskExecutionId, projectId, 'tenant_p6_autre'), { headers: getHeaders('tenant_p6_autre') });
    assert.equal(res.status, 404);
    const body = await res.json() as { error?: { code?: string; message?: string } };
    assert.equal(body.error?.code, 'NOT_FOUND');
    // Aucune information de la trace ne fuit dans l'erreur
    assert.doesNotMatch(body.error?.message ?? '', /reference-agent|SUCCESS|COMPLETED/);
  });

  // H — autre projet (même tenant) → 404
  it('H: autre projet → 404 canonique', async () => {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ name: 'P6 autre projet' }) });
    const pdata = await pres.json() as { project?: { id?: string } };
    const otherProject = pdata.project!.id!;
    const res = await fetch(getUrl(taskExecutionId, otherProject), { headers: getHeaders() });
    assert.equal(res.status, 404);
  });

  // I — RBAC autorisé (OWNER, ENGINEER, VIEWER : tous ont PROJECT_READ)
  it('I: RBAC — rôles standard autorisés → 200', async () => {
    for (const role of ['OWNER', 'ADMIN', 'ENGINEER', 'VIEWER']) {
      const res = await fetch(getUrl(taskExecutionId), { headers: getHeaders(tenant, role) });
      assert.equal(res.status, 200, `rôle ${role} autorisé (PROJECT_READ)`);
    }
  });

  // J — RBAC refusé : le mécanisme existant refuse quand la permission manque
  it('J: RBAC — le mécanisme existant refuse lorsque la permission manque (aucune nouvelle politique)', async () => {
    // La matrice RBAC actuelle : tous les rôles standard ont PROJECT_READ —
    // aucun 403 n est donc produisible sur cette route sans inventer un rôle
    // (documenté). Le mécanisme de refus est celui d assertPermission :
    assert.throws(() => assertPermission('VIEWER', 'PROJECT_MUTATE'), ForbiddenError);
    // La route GET utilise EXACTEMENT cette assertion (inspection source, test N)
    const full = resolve(process.cwd(), 'apps/api/src/routes/agent-execution.ts');
    assert.ok(existsSync(full));
    const code = readFileSync(full, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const getIndex = code.indexOf("pathname.includes('/agents/executions/') && req.method === 'GET'");
    const permissionIndex = code.indexOf("assertPermission(context.role, 'PROJECT_READ'", getIndex);
    assert.ok(permissionIndex > getIndex, 'la branche GET appelle assertPermission(PROJECT_READ)');
    assert.ok(code.indexOf('agentTraceStore.get(', permissionIndex) > permissionIndex, 'lecture store APRÈS le contrôle RBAC');
  });

  // K — routage : GET prioritaire, non capturé par /agents/execute
  it('K: routage — GET /agents/executions/:id fonctionne malgré le préfixe /agents/execute', async () => {
    // Si le POST générique capturait la route, le GET tomberait en 404 central
    // (route non trouvée) au lieu de retourner la trace.
    const res = await fetch(getUrl(taskExecutionId), { headers: getHeaders() });
    assert.equal(res.status, 200);
  });

  // L/M — POST existants inchangés (couverts dans before(), re-vérifiés)
  it('L+M: POST /agents/execute et POST /agents/execute-batch restent fonctionnels', async () => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'OWNER' };
    const eRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute`, {
      method: 'POST', headers,
      body: JSON.stringify({ agentId: 'reference-agent', executionId: 'agx-p6-lm', task: { title: 'LM', operation: 'CREATE', targetFiles: ['src/lm.ts'], requiredCapabilities: ['FILE_MUTATION'] } })
    });
    assert.equal(eRes.status, 200);
    const bRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/execute-batch`, {
      method: 'POST', headers,
      body: JSON.stringify({ executionId: 'agxb-p6-lm', tasks: [{ taskId: 'lm1', agentId: 'reference-agent', order: 1, task: { title: 'LM batch', operation: 'CREATE', targetFiles: ['src/lmb.ts'], requiredCapabilities: ['FILE_MUTATION'] } }] })
    });
    assert.equal(bRes.status, 200);
    // Les nouvelles exécutions produisent leurs traces (corrélation exacte)
    assert.ok(agentTraceStore.get(tenant, projectId, 'agx-p6-lm'));
    assert.ok(agentTraceStore.get(tenant, projectId, 'agxb-p6-lm'));
  });

  // N — immutabilité : le GET ne modifie pas le store
  it('N: immutabilité — après GET, la trace stockée reste inchangée', async () => {
    const before = agentTraceStore.get(tenant, projectId, taskExecutionId)!;
    const beforeSnapshot = JSON.parse(JSON.stringify(before));
    await fetch(getUrl(taskExecutionId), { headers: getHeaders() });
    const after = agentTraceStore.get(tenant, projectId, taskExecutionId)!;
    assert.deepEqual(JSON.parse(JSON.stringify(after)), beforeSnapshot, 'store inchangé par le GET');
  });

  // P — 404 sans fuite (couvert en G) + S — isolation après reconstruction
  it('S: isolation après reconstruction du store persistant', async () => {
    const restore = pinDataDir();
    try {
      const reloaded = new AgentTraceStore({ persist: true });
      // Le tenant voisin ne voit rien
      assert.equal(reloaded.get('tenant_p6_autre', projectId, taskExecutionId), undefined);
      assert.equal(reloaded.query('tenant_p6_autre', projectId).length, 0);
      // Le tenant légitime voit ses traces (TASK + BATCH)
      // Le test L+M a exécuté un second batch sur le même tenant/projet :
      // au moins 1 trace BATCH, chacune retrouvée par executionId.
      assert.ok(reloaded.query(tenant, projectId).filter((t) => t.kind === 'BATCH').length >= 1);
      assert.equal(reloaded.query(tenant, projectId).filter((t) => t.executionId === taskExecutionId).length, 1);
    } finally {
      restore();
    }
  });

  // Inspection : lecture pure, aucun verdict fabriqué, aucun node:fs dans la branche GET
  it('Inspection: branche GET = lecture pure (aucun verdict, aucun node:fs, aucun recalcul)', () => {
    const full = resolve(process.cwd(), 'apps/api/src/routes/agent-execution.ts');
    assert.ok(existsSync(full));
    const code = readFileSync(full, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const getStart = code.indexOf("pathname.includes('/agents/executions/') && req.method === 'GET'");
    const batchStart = code.indexOf("pathname.includes('/agents/execute-batch') && req.method === 'POST'");
    const getBranch = code.slice(getStart, batchStart);
    assert.doesNotMatch(getBranch, /buildTaskTrace|buildBatchTrace/, 'aucune reconstruction de trace');
    assert.doesNotMatch(getBranch, /'SUCCESS'|'COMPLETED'|'FAILURE'|'ROLLED_BACK'|'CANCELLED'/, 'aucun verdict dans la branche GET');
    assert.doesNotMatch(getBranch, /node:fs|writeJsonFileSync|readJsonFile/, 'aucun accès filesystem direct');
    assert.doesNotMatch(getBranch, /applyArtifacts|rollbackTransaction/, 'aucune mutation déclenchée');
    assert.ok(getBranch.includes("agentTraceStore.get(context.tenantId, projectId, executionId)"), 'lecture pure via agentTraceStore.get');
  });
});
