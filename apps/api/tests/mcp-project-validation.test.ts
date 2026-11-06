/**
 * SEC-01 — traversée via projectId MCP : forme stricte (400) + projet du
 * registre (404 indiscernable), cas nominal atteignant l'exécution.
 *
 * Lot A (gouvernance unifiée) : la suite passe par le Chemin réel de la
 * gouvernance — préparation (/api/v1/mcp/prepare, confirmation 201) puis
 * exécution avec confirmation consommée (/api/v1/mcp/call). Les scénarios
 * invalides sont refusés au niveau préparation (aucun spawn, mêmes statuts
 * historiques) ; l'outil inconnu est désormais REFUSÉ AVANT exécution
 * (gouvernance) — le cas « validation passe » reste prouvé via un outil
 * déclaré (fs_list).
 */

// MCP-TEST-ISOLATION-001 — Doit rester le PREMIER import de la suite (cf.
// ./mcp-remote-isolated-env.ts). Base SQLite isolée, jamais .volaco-data.
import './_lot-b-secret-env.js';

import { isolatedVolacoDataDir } from './mcp-remote-isolated-env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { signToken } from '../../../packages/core/src/identity/user-store.js';

/** Clé HMAC JWT : fixée AVANT le premier usage (Lot A — identité individuelle). */
process.env.AUTH_SECRET = 'volaco-test-lota-' + 'jwt-secret-'.repeat(4);

const USR_SEC01 = 'usr_sec01_lota';
const H = {
  'Content-Type': 'application/json',
  authorization: `Bearer ${signToken({ id: USR_SEC01, tenantId: 'studio-local', role: 'OWNER', email: 'sec01@lota.test' }, 3600)}`
};

interface JsonOut { status: number; body: unknown }

async function mcpPrepare(baseUrl: string, payload: unknown): Promise<JsonOut> {
  const res = await fetch(`${baseUrl}/api/v1/mcp/prepare`, {
    method: 'POST', headers: H, body: JSON.stringify(payload)
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}

/**
 * Contrat gouverné : PRÉPARATION puis exécution liée. Les refus de
 * préparation (400/403/404/409) sont propagés tels quels — les scénarios
 * SEC-01 continuent d'observer les MÊMES statuts qu'avec la voie
 * historique (refus avant toute exécution).
 */
async function mcpCall(baseUrl: string, payload: unknown): Promise<JsonOut> {
  const prep = await mcpPrepare(baseUrl, payload);
  if (prep.status !== 201) return prep;
  const confirmationId = ((prep.body as { confirmation?: { confirmationId?: string } }).confirmation ?? {}).confirmationId ?? '';
  const res = await fetch(`${baseUrl}/api/v1/mcp/call`, {
    method: 'POST', headers: H, body: JSON.stringify({ ...(payload as Record<string, unknown>), confirmationId })
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}

describe('SEC-01 : projectId MCP validé (traversée fermée, voie gouvernée)', () => {
  let server: Server;
  let baseUrl: string;
  let realProjectId: string;

  before(async () => {
    const mod = (await import('../src/server.js')) as unknown as {
      createApiServer: (options: { port: number }) => { server: Server };
    };
    const instance = mod.createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const created = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: 'SEC-01 MCP' })
    });
    assert.equal(created.status, 201);
    realProjectId = ((await created.json()) as { project: { id: string } }).project.id;
  });

  after(async () => {
    await fetch(`${baseUrl}/api/v1/projects/${realProjectId}`, { method: 'DELETE', headers: H });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      rmSync(isolatedVolacoDataDir, { recursive: true, force: true });
    } catch {
      // Windows : SQLite encore ouvert — répertoire temporaire OS (motif C34).
    }
  });

  it('1. projectId ".." / "../.." : 400 sans exécution', async () => {
    for (const evil of ['..', '../..', '..\\..\\..', '/etc', 'a/b', '', 'x'.repeat(65)]) {
      const { status } = await mcpCall(baseUrl, { server: 'project', tool: 'fs_read', projectId: evil, args: { path: 'index.html' } });
      assert.equal(status, 400, `projectId ${JSON.stringify(evil)} doit être rejeté 400`);
    }
  });

  it('2. projectId bien formé mais inconnu : 404 (pas d’oracle)', async () => {
    const { status } = await mcpCall(baseUrl, { server: 'project', tool: 'fs_read', projectId: 'proj_inconnu_abc123', args: {} });
    assert.equal(status, 404);
  });

  it('3. projet réel : la validation passe (Lot A : outil inconnu refusé AVANT exécution → 400)', async () => {
    const unknownTool = await mcpCall(baseUrl, { server: 'project', tool: '__outil_inexistant__', projectId: realProjectId, args: {} });
    assert.equal(unknownTool.status, 400, 'un outil non déclaré est refusé avant exécution (gouvernance Lot A)');
    const knownTool = await mcpPrepare(baseUrl, { server: 'project', tool: 'fs_list', projectId: realProjectId, args: {} });
    assert.equal(knownTool.status, 201, 'un projet existant franchit la validation (préparation 201)');
  });

  it('4. handshake GET /mcp/servers : inchangé (200)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/mcp/servers`, { headers: H });
    assert.equal(res.status, 200);
  });

  it('5. SEC-12 : corps > 1 Mo refusé 413 (plus d’accumulateur sans borne)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/mcp/call`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ server: 'project', tool: 'fs_read', projectId: 'x', args: { blob: 'A'.repeat(1_100_000) } })
    });
    assert.equal(res.status, 413);
    const data = (await res.json()) as { error?: { code?: string } };
    assert.equal(data.error?.code, 'PAYLOAD_TOO_LARGE');
  });
});
