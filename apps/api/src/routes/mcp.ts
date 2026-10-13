/**
 * VibeCode Core - API Tier
 * MCP Routes (P3) — expose les serveurs MCP de la plateforme.
 *
 * GET /api/v1/mcp/servers  : liste les serveurs MCP connus + leurs outils
 *                            (handshake réel via le client stdio)
 * POST /api/v1/mcp/call    : appelle un outil sur un serveur (PROJECT_UPDATE)
 *
 * Les serveurs sont des processus réels (stdio JSON-RPC 2.0) spawnés par le
 * client ; l'appel est stateless (connect → call → close).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { isSafeProjectId } from '../../../../packages/core/src/app-pipeline.js';
import { McpStdioClient } from '../../../../packages/core/src/mcp/client.js';
import type { RequestContext } from '../middleware/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
// dist/apps/api/src/routes → racine du dépôt (5 niveaux)
const repoRoot = join(here, '..', '..', '..', '..', '..');
const mcpDist = join(repoRoot, 'dist', 'packages', 'core', 'src', 'mcp');

/** Serveurs MCP connus de la plateforme. */
export const KNOWN_MCP_SERVERS: ReadonlyArray<{ id: string; description: string; script: string; args: string[] }> = [
  {
    id: 'project',
    description: 'Fichiers du projet React généré (fs_list / fs_read / fs_write / app_build) — confiné au workspace du projet.',
    script: join(mcpDist, 'project-server.js'),
    args: []
  },
  {
    id: 'browser',
    description: 'Navigateur Chromium headless (browser_navigate / browser_screenshot) via Playwright.',
    script: join(mcpDist, 'browser-server.js'),
    args: []
  }
];

export async function handleMcpRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // 1. GET /api/v1/mcp/servers : handshake réel + outils découverts
  if (pathname === '/api/v1/mcp/servers' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const servers = [];
    for (const def of KNOWN_MCP_SERVERS) {
      const client = new McpStdioClient({
        command: process.execPath,
        args: [def.script, ...(def.id === 'project' ? [context.tenantId, (pathname.split('/')[4] ?? 'default-project')] : [])],
        timeoutMs: 15000
      });
      try {
        await client.connect();
        const tools = await client.listTools();
        servers.push({ id: def.id, description: def.description, online: true, tools: tools.map((t) => t.name) });
      } catch (err) {
        servers.push({ id: def.id, description: def.description, online: false, error: err instanceof Error ? err.message.slice(0, 120) : String(err) });
      } finally {
        client.close();
      }
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ servers, requestId }));
    return true;
  }

  // 2. POST /api/v1/mcp/call : appelle un outil sur un serveur
  if (pathname === '/api/v1/mcp/call' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const bodyText = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => resolve(data));
    });
    let body: { server?: string; tool?: string; args?: Record<string, unknown>; projectId?: string; timeoutMs?: number };
    try {
      body = bodyText ? (JSON.parse(bodyText) as typeof body) : {};
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }
    const def = KNOWN_MCP_SERVERS.find((s2) => s2.id === body.server);
    if (!def) {
      throw new ValidationError('Serveur MCP inconnu : ' + String(body.server), undefined, requestId);
    }
    const tool = String(body.tool ?? '');
    if (tool.length === 0) {
      throw new ValidationError('Le champ "tool" est obligatoire', undefined, requestId);
    }

    // args du serveur project : tenant + projet (le projet doit exister)
    const args = [...def.args];
    if (def.id === 'project') {
      // SEC-01 — l'identifiant client devenait un segment de chemin du
      // processus enfant (`..` → lecture/écriture hors workspace, dont .env).
      // Forme stricte + résolution par le registre (404 indiscernable si
      // inconnu ou d'un autre tenant : pas d'oracle d'existence).
      const rawId = String(body.projectId ?? 'default-project');
      if (!isSafeProjectId(rawId)) {
        throw new ValidationError('Identifiant de projet invalide', undefined, requestId);
      }
      const known = projectStore.getProject(context.tenantId, rawId);
      if (!known) {
        throw new NotFoundError(`Projet ${rawId}`, requestId);
      }
      args.unshift(context.tenantId, rawId);
    }

    const client = new McpStdioClient({
      command: process.execPath,
      args: [def.script, ...args],
      timeoutMs: Math.min(Math.max(body.timeoutMs ?? 30000, 5000), 120000)
    });

    try {
      await client.connect();
      const result = await client.callTool(tool, body.args ?? {}, body.timeoutMs);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ server: def.id, tool, result, requestId }));
    } catch (err) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        server: def.id,
        tool,
        error: err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400),
        requestId
      }));
    } finally {
      client.close();
    }
    return true;
  }

  return false;
}
