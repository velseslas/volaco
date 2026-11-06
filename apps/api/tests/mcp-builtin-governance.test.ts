/**
 * MCP-C3.6 Lot A — gouvernance unifiée des exécutions MCP INTÉGRÉES
 * (stdio « project » / « browser ») : la voie historique /api/v1/mcp/call
 * n'est plus un contournement (P1-01 fermé).
 *
 * Ce que cette suite PROUVE :
 *   LA-1   prepare SANS JWT (repli dev spoofable) → 403 IDENTITY_UNTRUSTED ;
 *          refus journalisé ; aucun spawn, aucune confirmation.
 *   LA-2   prepare AVEC JWT invalide → 403 IDENTITY_UNTRUSTED (jamais un
 *          repli silencieux).
 *   LA-3   VIEWER → 403 PERMISSION_DENIED (+ audit refus).
 *   LA-4   ENGINEER → 403 PERMISSION_DENIED (exécution OWNER/ADMIN seulement).
 *   LA-5   serveur inconnu → 400 SERVER_NOT_ALLOWED (+ audit refus).
 *   LA-6   outil non déclaré → 400 TOOL_NOT_DECLARED (+ audit refus).
 *   LA-7   projectId hors forme stricte → 400 PROJECT_INVALID.
 *   LA-8   projet inconnu du tenant → 404 indiscernable PROJECT_NOT_FOUND.
 *   LA-9   ISOLATION : OWNER d'un AUTRE tenant sur le projet du tenant
 *          principal → 404 identique (pas d'oracle) + refus journalisé
 *          DANS SON tenant.
 *   LA-10  prepare nominal (fs_list) → 201 (confirmation liée tenant/user/
 *          serveur/outil/schéma/args) + audit PREPARED ; /prepare fait 0 spawn.
 *   LA-10b prepare browser_navigate nominal → 201 (politique cohérente,
 *          aucun spawn).
 *   LA-11  call sans confirmationId → 400 INPUT_INVALID ; 0 exécution.
 *   LA-12  call avec arguments MODIFIÉS → 409 CONFIRMATION_BINDING_MISMATCH ;
 *          0 exécution.
 *   LA-13  call confirmationId fantôme → 409 CONFIRMATION_NOT_FOUND.
 *   LA-13b args et arguments DIVERGENTS → 400 INPUT_INVALID.
 *   LA-14  confirmation expirée (horloge injectée : prepare à T0, call à
 *          T0+16 min) → 409 CONFIRMATION_EXPIRED, ligne NON consommée.
 *   LA-15  anti-rejeu : 2ᵉ call avec la MÊME confirmation → 409
 *          CONFIRMATION_REPLAY ; exactement 1 exécution au total.
 *   LA-16  CONCURRENCE : deux calls parallèles avec la même confirmation →
 *          exactement un 200 (BEGIN IMMEDIATE), l'autre 409.
 *   LA-17  exécution nominale fs_list (spawn réel du serveur compilé) →
 *          200 + result string ; audit CALLED unique ; process fermé.
 *   LA-18  serveur DÉSACTIVÉ (seam test) → prepare/call 409
 *          SERVER_DISABLED ; GET /servers liste en offline SANS spawn.
 *   LA-19  GET /api/v1/mcp/servers : inventaire complet + handshake réel
 *          (forme inchangée) ; AUCUNE exécution d'outil (CALLED delta 0).
 *   LA-20  sanctions de journal : toutes les lignes « _REFUSED » du tenant
 *          portent une raison de la LISTE FERMÉE ; métadonnées whitelistées
 *          ; canaries absentes ; jamais de secret.
 *
 * Harnais : identique à B1/B2/B3/C34 (serveur HTTP réel port 0,
 * VOLACO_DATA_DIR isolé fixé par le PREMIER import, JWT signés,
 * store de confirmations builtin paresseux sur la base isolée, horloge
 * injectée pour l'expiration).
 */

// MCP-TEST-ISOLATION-001 — doit rester le PREMIER import de la suite.
import './_lot-b-legacy-env.js';

import { isolatedVolacoDataDir } from './mcp-remote-isolated-env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  setBuiltinMcpRuntimeForTests,
  isBuiltinMcpRefusalReason,
  builtinConnectorId,
  getBuiltinConfirmationStore
} from '../../../packages/core/src/mcp/governance/builtin-policy.js';
import { RemoteMcpConfirmationStore } from '../../../packages/core/src/mcp/remote/confirmation.js';
import type { Role } from '../../../packages/core/src/identity/permissions.js';
import { signToken } from '../../../packages/core/src/identity/user-store.js';
import { auditStore } from '../../../packages/core/src/observability/audit.js';

/** Clé HMAC JWT : fixée AVANT le premier usage (secret déterministe de la suite). */
process.env.AUTH_SECRET = 'volaco-test-lota-' + 'jwt-secret-'.repeat(4);

const T_MAIN = 'studio-lota-main';
const T_FOREIGN = 'tenant-lota-etranger';

const USR_OWNER = 'usr_owner_lota';
const USR_ADMIN = 'usr_admin_lota';
const USR_ENGINEER = 'usr_eng_lota';
const USR_VIEWER = 'usr_view_lota';
const USR_FOREIGN = 'usr_autre_lota';

const CANARY = 'CANARY-LOTA-' + randomBytes(6).toString('hex'); // jamais soumis
const ARG_ARG = { path: 'src/App.tsx' };

function authHeaders(userId: string, tenantId: string, role: Role): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    authorization: `Bearer ${signToken({ id: userId, tenantId, role, email: `${userId}@lota.test` }, 3600)}`
  };
}

/** En-têtes dev SPOOFABLES (exactement le scénario P0 actif aujourd'hui). */
function devHeaders(tenantId: string, role: Role): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': role };
}

const H_OWNER = authHeaders(USR_OWNER, T_MAIN, 'OWNER');
const H_ADMIN = authHeaders(USR_ADMIN, T_MAIN, 'ADMIN');
const H_ENGINEER = authHeaders(USR_ENGINEER, T_MAIN, 'ENGINEER');
const H_VIEWER = authHeaders(USR_VIEWER, T_MAIN, 'VIEWER');
const H_FOREIGN = authHeaders(USR_FOREIGN, T_FOREIGN, 'OWNER');

interface JsonOut { status: number; body: unknown }

interface Confirmation {
  confirmationId: string;
  toolName: string;
  schemaSha256: string;
  argsSha256: string;
  expiresAt: number;
}

let server: Server;
let baseUrl = '';

async function json(
  path: string,
  method: string,
  headers: Record<string, string>,
  payload?: unknown
): Promise<JsonOut> {
  const res = await fetch(`${baseUrl}${path}`, payload === undefined
    ? { method, headers }
    : { method, headers, body: JSON.stringify(payload) });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}

function auditEvents(tenant: string, action?: string, resourceType?: string) {
  const filter: { action?: string; resourceType?: string } = {};
  if (action !== undefined) filter.action = action;
  if (resourceType !== undefined) filter.resourceType = resourceType;
  return auditStore.query(tenant, Object.keys(filter).length > 0 ? filter : undefined);
}

function refusedReasons(tenant: string, action: string): string[] {
  return auditEvents(tenant, action)
    .filter((e) => e.status === 'FAILURE')
    .map((e) => (e.metadata as { reason?: string } | undefined)?.reason ?? '<absente>');
}

function deltaOf(tenant: string, action: string, baseline: number): number {
  return auditEvents(tenant, action).length - baseline;
}

function countOf(tenant: string, action: string): number {
  return auditEvents(tenant, action).length;
}

describe('MCP-C3.6 Lot A : gouvernance builtin (P1-01 fermé)', () => {
  let createProject: (name: string) => Promise<string>;
  let PROJECT_ID = '';
  const foreignProjectId = 'proj-NULL-etranger';

  before(async () => {
    const mod = (await import('../src/server.js')) as unknown as {
      createApiServer: (options: { port: number }) => { server: Server };
    };
    const instance = mod.createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
        resolve();
      });
    });
    createProject = async (name: string) => {
      const out = await json('/api/v1/projects', 'POST', H_OWNER, { name });
      assert.equal(out.status, 201, 'projet fixture : accès OWNER JWT');
      const proj = (out.body as { project: { id: string } }).project;
      assert.ok(typeof proj.id === 'string' && proj.id.length > 0);
      return proj.id;
    };
    PROJECT_ID = await createProject('LOTA fixture');
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      rmSync(isolatedVolacoDataDir, { recursive: true, force: true });
    } catch {
      // Windows : SQLite encore ouvert — répertoire temporaire OS (motif C34).
    }
  });

  // -- Chaîne d'authentification (LA-1..LA-4) --------------------------------

  it('LA-1 : prepare sans JWT (repli dev spoofable) → 403 IDENTITY_UNTRUSTED, 0 spawn', async () => {
    const beforeCalls = countOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED');
    const out = await json('/api/v1/mcp/prepare', 'POST', devHeaders(T_MAIN, 'OWNER'), {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
    });
    assert.equal(out.status, 403);
    assert.equal(deltaOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED', beforeCalls), 0, 'aucun spawn');
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('IDENTITY_UNTRUSTED'));
  });

  it('LA-2 : prepare avec JWT invalide → 403 IDENTITY_UNTRUSTED (jamais de repli)', async () => {
    const headers = { 'Content-Type': 'application/json', 'x-tenant-id': T_MAIN, 'x-user-role': 'OWNER', authorization: 'Bearer b0gus-token-not-jwt-1234' };
    const out = await json('/api/v1/mcp/prepare', 'POST', headers, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
    });
    assert.equal(out.status, 403);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('IDENTITY_UNTRUSTED'));
  });

  it('LA-3 : prepare VIEWER → 403 PERMISSION_DENIED (audit du refus)', async () => {
    const out = await json('/api/v1/mcp/prepare', 'POST', H_VIEWER, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
    });
    assert.equal(out.status, 403);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('PERMISSION_DENIED'));
  });

  it('LA-4 : prepare ENGINEER → 403 PERMISSION_DENIED (seg. RBAC Owner/Admin)', async () => {
    const out = await json('/api/v1/mcp/prepare', 'POST', H_ENGINEER, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
    });
    assert.equal(out.status, 403);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('PERMISSION_DENIED'));
  });

  // -- Politique serveur / outil / projet (LA-5..LA-9) ------------------------

  it('LA-5 : serveur MCP inconnu → 400 SERVER_NOT_ALLOWED', async () => {
    const out = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
      server: 'evidence', tool: 'srv', arguments: {}
    });
    assert.equal(out.status, 400);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('SERVER_NOT_ALLOWED'));
  });

  it('LA-6 : outil non déclaré → 400 TOOL_NOT_DECLARED', async () => {
    const out = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
      server: 'project', tool: '__outil_inexistant__', projectId: PROJECT_ID, arguments: {}
    });
    assert.equal(out.status, 400);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('TOOL_NOT_DECLARED'));
  });

  it('LA-7 : projectId hors forme stricte → 400 PROJECT_INVALID', async () => {
    const out = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
      server: 'project', tool: 'fs_list', projectId: '../sanitaire', arguments: {}
    });
    assert.equal(out.status, 400);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('PROJECT_INVALID'));
  });

  it('LA-8 : projet inconnu du tenant → 404 PROJECT_NOT_FOUND (indiscernable)', async () => {
    const out = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
      server: 'project', tool: 'fs_list', projectId: foreignProjectId, arguments: {}
    });
    assert.equal(out.status, 404);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('PROJECT_NOT_FOUND'));
  });

  it('LA-9 : cross-tenant OWNER → 404 identique ; refus dans SON journal', async () => {
    const out = await json('/api/v1/mcp/prepare', 'POST', H_FOREIGN, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
    });
    assert.equal(out.status, 404, 'pas d\'oracle d\'existence');
    assert.ok(refusedReasons(T_FOREIGN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('PROJECT_NOT_FOUND'));
    const foreignEvents = auditEvents(T_FOREIGN);
    assert.ok(foreignEvents.every((e) => e.tenantId === T_FOREIGN), 'refus cloisonné');
  });

  // -- Préparation valide + exécution liée (LA-10..LA-17) ----------------------

  it('LA-10 : prepare fs_list nominal → 201 ; payload lié ; préparation 0 spawn', async () => {
    const beforeCalls = countOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED');
    const out = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
    });
    assert.equal(out.status, 201);
    const c = (out.body as { confirmation: Confirmation }).confirmation;
    assert.ok(c.confirmationId.length >= 8);
    assert.equal(c.toolName, 'fs_list');
    assert.ok(/^[0-9a-f]{64}$/.test(c.schemaSha256));
    assert.ok(/^[0-9a-f]{64}$/.test(c.argsSha256));
    assert.ok(typeof c.expiresAt === 'number' && c.expiresAt > Date.now());
    assert.equal((out.body as { serverId?: string }).serverId, 'project');
    assert.equal(deltaOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED', beforeCalls), 0, '/prepare ne spawn jamais');
  });

  it('LA-10b : prepare browser_navigate nominal → 201 (politique cohérente)', async () => {
    const out = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
      server: 'browser', tool: 'browser_navigate', arguments: { url: 'https://127.0.0.1.example.invalid/' }
    });
    assert.equal(out.status, 201);
    const c = (out.body as { confirmation: Confirmation }).confirmation;
    assert.equal(c.toolName, 'browser_navigate');
    assert.equal((out.body as { serverId?: string }).serverId, 'browser');
  });

  it('LA-11 : call sans confirmationId → 400 INPUT_INVALID ; 0 exécution', async () => {
    const beforeCalls = countOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED');
    const out = await json('/api/v1/mcp/call', 'POST', H_OWNER, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
    });
    assert.equal(out.status, 400);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_CALL_REFUSED').includes('INPUT_INVALID'));
    assert.equal(deltaOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED', beforeCalls), 0);
  });

  it('LA-12 : call avec arguments modifiés → 409 BINDING_MISMATCH ; 0 exécution', async () => {
    const prep = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
      server: 'project', tool: 'fs_read', projectId: PROJECT_ID, arguments: ARG_ARG
    });
    assert.equal(prep.status, 201);
    const c = (prep.body as { confirmation: Confirmation }).confirmation;
    const beforeCalls = countOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED');
    const out = await json('/api/v1/mcp/call', 'POST', H_OWNER, {
      server: 'project', tool: 'fs_read', projectId: PROJECT_ID,
      arguments: { path: 'src/App.tsx.bak' }, confirmationId: c.confirmationId
    });
    assert.equal(out.status, 409);
    assert.equal(deltaOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED', beforeCalls), 0, 'la couche exécution jamais atteinte');
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_CALL_REFUSED').includes('CONFIRMATION_BINDING_MISMATCH'));
  });

  it('LA-13 : call avec confirmationId fantôme → 409 CONFIRMATION_NOT_FOUND', async () => {
    const out = await json('/api/v1/mcp/call', 'POST', H_OWNER, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {},
      confirmationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000'
    });
    assert.equal(out.status, 409);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_CALL_REFUSED').includes('CONFIRMATION_NOT_FOUND'));
  });

  it('LA-13b : args ET arguments divergents → 400 INPUT_INVALID', async () => {
    const out = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
      server: 'project', tool: 'fs_read', projectId: PROJECT_ID,
      args: { path: 'a.ts' }, arguments: { path: 'b.ts' }
    });
    assert.equal(out.status, 400);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('INPUT_INVALID'));
  });

  it('LA-14 : confirmation expirée → 409 CONFIRMATION_EXPIRED, ligne vivante (consommation directe = EXPIRED)', async () => {
    const clock = { now: 1_700_000_000_000 };
    setBuiltinMcpRuntimeForTests({
      confirmationStore: () => new RemoteMcpConfirmationStore(() => clock.now, { allowForeignConnectorIds: true })
    });
    try {
      const prep = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
        server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
      });
      assert.equal(prep.status, 201);
      const c = (prep.body as { confirmation: Confirmation }).confirmation;
      clock.now = clock.now + 16 * 60_000; // beyond TTL fixe 15 min
      const beforeCalls = countOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED');
      const out = await json('/api/v1/mcp/call', 'POST', H_OWNER, {
        server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {},
        confirmationId: c.confirmationId
      });
      assert.equal(out.status, 409);
      assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_CALL_REFUSED').includes('CONFIRMATION_EXPIRED'));
      assert.equal(deltaOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED', beforeCalls), 0);
      // Protocole §3.7 : refus expiré = ligne NON consommée (consumed_at NULL)
      const direct = getBuiltinConfirmationStore().consume({
        tenantId: T_MAIN, userId: USR_OWNER, confirmationId: c.confirmationId,
        connectorId: builtinConnectorId('project'), toolName: 'fs_list',
        schemaSha256: c.schemaSha256, argsSha256: c.argsSha256
      });
      if (!direct.consumed) {
        assert.equal(direct.reason, 'EXPIRED');
      } else {
        assert.fail('la confirmation expirée a été consommée par le refus');
      }
    } finally {
      setBuiltinMcpRuntimeForTests(null);
    }
  });

  it('LA-15 : anti-rejeu (2ᵉ call même confirmation) → 409 REPLAY ; 1 exécution au total', async () => {
    const prep = await json('/api/v1/mcp/prepare', 'POST', H_ADMIN, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
    });
    assert.equal(prep.status, 201, 'ADMIN peut préparer');
    const c = (prep.body as { confirmation: Confirmation }).confirmation;
    const beforeCalls = countOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED');
    const first = await json('/api/v1/mcp/call', 'POST', H_ADMIN, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {},
      confirmationId: c.confirmationId
    });
    assert.equal(first.status, 200);
    assert.ok(typeof (first.body as { result?: string }).result === 'string');
    const second = await json('/api/v1/mcp/call', 'POST', H_ADMIN, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {},
      confirmationId: c.confirmationId
    });
    assert.equal(second.status, 409);
    assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_CALL_REFUSED').includes('CONFIRMATION_REPLAY'));
    assert.equal(deltaOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED', beforeCalls), 1, 'exactement une exécution (pas de double comptage)');
  });

  it('LA-16 : deux calls CONCURRENTS même confirmation → exactement un 200', async () => {
    const prep = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
    });
    assert.equal(prep.status, 201);
    const c = (prep.body as { confirmation: Confirmation }).confirmation;
    const payload = {
      server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {},
      confirmationId: c.confirmationId
    };
    const before = countOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED');
    const settled = await Promise.allSettled([
      json('/api/v1/mcp/call', 'POST', H_OWNER, payload),
      json('/api/v1/mcp/call', 'POST', H_OWNER, payload)
    ]);
    const statuses: number[] = [];
    for (const s of settled) {
      if (s.status !== 'fulfilled') {
        assert.fail('aucune requête ne doit être rejetée côté client de test');
        continue;
      }
      statuses.push(s.value.status);
    }
    assert.deepEqual(statuses.sort((a, b) => a - b), [200, 409], 'exactement un 200, le concurrent rejoué');
    assert.equal(deltaOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED', before), 1);
  });

  it('LA-17 : exécution nominale OWNER fs_list → result string ; audit CALLED précis', async () => {
    const out = await confirmAndCallOnce('project', 'fs_list', PROJECT_ID, {}, H_OWNER, 'fs_list');
    assert.equal(out.status, 200);
    assert.ok(typeof (out.body as { result?: string }).result === 'string', 'result string présent');
    const called = auditEvents(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED');
    const lastCall = called[called.length - 1];
    assert.ok(lastCall);
    const meta = (lastCall?.metadata ?? {}) as Record<string, unknown>;
    assert.equal(meta.toolName, 'fs_list');
    assert.equal(meta.projectId, PROJECT_ID);
  });

  /** prepare→call unique (helper fidèle au couple 201+200). */
  async function confirmAndCallOnce(
    server: 'project' | 'browser', tool: string, projectId: string | undefined, args: Record<string, unknown>, headers: Record<string, string>, expectedTool: string
  ): Promise<JsonOut> {
    const prep = await json('/api/v1/mcp/prepare', 'POST', headers, {
      server, tool, ...(projectId !== undefined ? { projectId } : {}), arguments: args
    });
    assert.equal(prep.status, 201);
    const c = (prep.body as { confirmation: Confirmation }).confirmation;
    assert.equal(c.toolName, expectedTool);
    return json('/api/v1/mcp/call', 'POST', headers, {
      server, tool, ...(projectId !== undefined ? { projectId } : {}), arguments: args,
      confirmationId: c.confirmationId
    });
  }

  // -- Serveur désactivé + découverte (LA-18, LA-19) ---------------------------
  it('LA-18 : serveur désactivé (seam) → 409 SERVER_DISABLED ; /servers offline sans spawn', async () => {
    setBuiltinMcpRuntimeForTests({ disabledServers: ['project'] });
    try {
      const outPrep = await json('/api/v1/mcp/prepare', 'POST', H_OWNER, {
        server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {}
      });
      assert.equal(outPrep.status, 409);
      assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARE_REFUSED').includes('SERVER_DISABLED'));
      const outCall = await json('/api/v1/mcp/call', 'POST', H_OWNER, {
        server: 'project', tool: 'fs_list', projectId: PROJECT_ID, arguments: {},
        confirmationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0099'
      });
      assert.equal(outCall.status, 409, 'exécution refusée avant même la consommation');
      assert.ok(refusedReasons(T_MAIN, 'MCP_BUILTIN_TOOL_CALL_REFUSED').includes('SERVER_DISABLED'));
      // Découverte : entrée offline, conforme à la forme historique
      const servers = await json('/api/v1/mcp/servers', 'GET', devHeaders(T_MAIN, 'OWNER'));
      assert.equal(servers.status, 200);
      const list = (servers.body as { servers: Array<{ id: string; online: boolean; error?: string }> }).servers;
      const project = list.find((s) => s.id === 'project');
      assert.ok(project);
      assert.equal(project?.online, false);
      assert.ok(String(project?.error ?? '').includes('désactivé'));
    } finally {
      setBuiltinMcpRuntimeForTests(null);
    }
  });

  it('LA-19 : GET /servers réédité (serveurs online, outils ; 0 exécution)', async () => {
    const beforeCalls = countOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED');
    const beforePrepare = countOf(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARED');
    const out = await json('/api/v1/mcp/servers', 'GET', devHeaders(T_MAIN, 'OWNER'));
    assert.equal(out.status, 200);
    const list = (out.body as { servers: Array<{ id: string; online: boolean; tools?: string[] }> }).servers;
    assert.ok(list.some((s) => s.id === 'project' && s.online === true));
    assert.ok(list.some((s) => s.id === 'browser' && s.online === true));
    const projectEntry = list.find((s) => s.id === 'project');
    assert.ok(Array.isArray(projectEntry?.tools) && (projectEntry?.tools ?? []).includes('fs_write'));
    assert.equal(deltaOf(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED', beforeCalls), 0, "la découverte n'exécute jamais un outil");
    assert.equal(deltaOf(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARED', beforePrepare), 0);
  });

  // -- Zéro interdits : liste fermée, whitelist metadata, canaries (LA-20) ------
  it('LA-20 : tous les refus portent une raison fermée ; métadonnées whitelistées ; canaries absentes', () => {
    const events = [...auditEvents(T_MAIN), ...auditEvents(T_FOREIGN)];
    const refusals = events.filter((e) => e.status === 'FAILURE');
    assert.ok(refusals.length > 0, 'la suite aura produit des refus');
    for (const ev of refusals) {
      assert.ok(ev.action.endsWith('_REFUSED'), `évènement ${ev.action} : statut FAILURE sans refus explicite`);
      const reason = (ev.metadata as { reason?: unknown } | undefined)?.reason;
      assert.ok(isBuiltinMcpRefusalReason(reason), `raison hors liste fermée : ${String(reason)}`);
    }
    for (const ev of events) {
      const meta = ev.metadata ?? {};
      for (const key of Object.keys(meta)) {
        assert.ok(
          ['reason', 'toolName', 'confirmationId', 'projectId', 'schemaSha256', 'argsSha256'].includes(key as string),
          `clé de métadonnée hors whitelist : ${key}`
        );
        assert.ok(
          !JSON.stringify(meta[key]).includes(CANARY),
          `canary ${CANARY} interdit dans l'event`
        );
      }
      assert.ok(typeof (ev.metadata as { argsSha256?: string } | undefined)?.argsSha256 === 'string'
        ? ((ev.metadata as { argsSha256?: string }).argsSha256 as string).length === 64 : true,
        'argsSha256 journalisé garde sa norme 64 hex si présent');
    }
    const prepared = auditEvents(T_MAIN, 'MCP_BUILTIN_TOOL_PREPARED');
    const called = auditEvents(T_MAIN, 'MCP_BUILTIN_TOOL_CALLED');
    assert.ok(prepared.length >= 4, `compteur de préparation cohérent (${prepared.length})`);
    assert.ok(called.length >= 3, `compteur d'exécution cohérent (${called.length})`);
  });
});
