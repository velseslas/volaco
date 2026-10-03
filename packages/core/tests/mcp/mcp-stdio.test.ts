/**
 * P3 — TESTS MCP : serveurs stdio réels + client réel, zéro réseau.
 *
 * Le client spawn les serveurs compilés (dist) et parle le protocole MCP
 * JSON-RPC 2.0 newline-delimited : handshake initialize, notifications/
 * initialized, tools/list, tools/call. Les outils projet sont confinés au
 * workspace de test.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { McpStdioClient } from '../../src/mcp/client.js';

const TEST_PROJECT = 'test-mcp-01';
const TENANT = 'tenant_mcp_01';

function serverPath(name: string): string {
  // dist/packages/core/src/mcp/<name>.js — calculé depuis dist/ du présent test
  return join(process.cwd(), 'dist', 'packages', 'core', 'src', 'mcp', name);
}

describe('P3 : MCP — serveurs stdio réels + client', () => {
  after(() => {
    const ws = join(process.cwd(), 'workspace', TEST_PROJECT);
    if (existsSync(ws)) rmSync(ws, { recursive: true, force: true });
    const marker = join(process.cwd(), 'workspace', TEST_PROJECT + '.format.json');
    if (existsSync(marker)) rmSync(marker, { force: true });
  });

  it('1. projet-server : handshake initialize + tools/list (4 outils)', async () => {
    const client = new McpStdioClient({
      command: process.execPath,
      args: [serverPath('project-server.js'), TENANT, TEST_PROJECT],
      timeoutMs: 15000
    });
    try {
      const init = await client.connect();
      assert.ok(String((init.serverInfo as { name?: string }).name) === 'volaco-project', 'serverInfo présent');
      const tools = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, ['app_build', 'fs_list', 'fs_read', 'fs_write']);
    } finally {
      client.close();
    }
  });

  it('2. fs_write puis fs_read : écriture et lecture réelles confinées', async () => {
    const client = new McpStdioClient({
      command: process.execPath,
      args: [serverPath('project-server.js'), TENANT, TEST_PROJECT],
      timeoutMs: 15000
    });
    try {
      await client.connect();
      const write = await client.callTool('fs_write', { path: 'src/components/Mcp.tsx', content: 'export const MCP = true;\n' });
      assert.match(write, /écrit et persisté/);
      const read = await client.callTool('fs_read', { path: 'src/components/Mcp.tsx' });
      assert.equal(read, 'export const MCP = true;\n');
      // confinement : hors src/ refusé
      await assert.rejects(
        () => client.callTool('fs_write', { path: '../evasion.ts', content: 'x' }, 5000),
        /path-(hors-workspace|non-autorise)/
      );
    } finally {
      client.close();
    }
  });

  it('3. app_build : build vite réel du projet MCP', async () => {
    const client = new McpStdioClient({
      command: process.execPath,
      args: [serverPath('project-server.js'), TENANT, TEST_PROJECT],
      timeoutMs: 60000
    });
    try {
      await client.connect();
      const out = await client.callTool('app_build', {}, 60000);
      assert.match(out, /Build réussi/);
    } finally {
      client.close();
    }
  });

  it('4. browser-server : handshake + tools/list (2 outils)', async () => {
    const client = new McpStdioClient({
      command: process.execPath,
      args: [serverPath('browser-server.js')],
      timeoutMs: 30000
    });
    try {
      await client.connect();
      const tools = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ['browser_navigate', 'browser_screenshot']);
    } finally {
      client.close();
    }
  });

  it('5. browser_navigate + screenshot réels (Playwright)', async () => {
    const client = new McpStdioClient({
      command: process.execPath,
      args: [serverPath('browser-server.js')],
      timeoutMs: 60000
    });
    try {
      await client.connect();
      const nav = await client.callTool('browser_navigate', { url: 'data:text/html,<h1>MCP Browser</h1>' }, 30000);
      assert.match(nav, /Page chargée/);
      const shot = await client.callTool('browser_screenshot', {}, 30000);
      assert.match(shot, /^PNG:/);
      assert.ok(shot.length > 1000, 'la capture PNG est substantielle');
      // URL non autorisée → refus honnête
      await assert.rejects(
        () => client.callTool('browser_navigate', { url: 'file:///etc/passwd' }, 5000),
        /seule une URL/
      );
    } finally {
      client.close();
    }
  });
});
