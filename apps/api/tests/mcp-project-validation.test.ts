/**
 * SEC-01 — traversée via projectId MCP : forme stricte (400) + projet du
 * registre (404 indiscernable), cas nominal atteignant l'exécution (200).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'OWNER' };

async function mcpCall(baseUrl: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/api/v1/mcp/call`, {
    method: 'POST', headers: H, body: JSON.stringify(payload)
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}

describe('SEC-01 : projectId MCP validé (traversée fermée)', () => {
  let server: Server;
  let baseUrl: string;
  let realProjectId: string;

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
    const created = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: 'SEC-01 MCP' })
    });
    assert.equal(created.status, 201);
    realProjectId = ((await created.json()) as { project: { id: string } }).project.id;
  });

  after(async () => {
    await fetch(`${baseUrl}/api/v1/projects/${realProjectId}`, { method: 'DELETE', headers: H });
    await new Promise<void>((resolve) => server.close(() => resolve()));
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

  it('3. projet réel : la validation passe, l’appel s’exécute (200)', async () => {
    const { status, body } = await mcpCall(baseUrl, { server: 'project', tool: '__outil_inexistant__', projectId: realProjectId, args: {} });
    assert.equal(status, 200, 'un projet existant doit franchir la validation');
    assert.ok(body && typeof body === 'object' && 'server' in (body as Record<string, unknown>));
  });

  it('4. handshake GET /mcp/servers : inchangé (200)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/mcp/servers`, { headers: H });
    assert.equal(res.status, 200);
  });
});
