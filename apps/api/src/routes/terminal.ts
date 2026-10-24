import type { IncomingMessage, ServerResponse } from 'node:http';
import { TerminalService } from '../../../../packages/core/src/terminal/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
export const terminalService = new TerminalService(projectStore, auditStore);

export async function handleTerminalRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // Format attendu : /api/v1/projects/:projectId/terminal/execute
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix)) {
    return false;
  }

  const afterPrefix = pathname.substring(prefix.length);
  const parts = afterPrefix.split('/');
  const projectId = parts[0];
  const subRoute = parts[1];
  const action = parts[2];

  if (!projectId || subRoute !== 'terminal' || action !== 'execute') {
    return false;
  }

  // POST /api/v1/projects/:projectId/terminal/execute
  if (req.method === 'POST') {
    // Défense en profondeur : TerminalService applique déjà le RBAC (un VIEWER
    // reçoit 403 — prouvé par terminal-api.test.ts) ainsi que la liste blanche
    // de commandes et le rejet d'injection shell. Le contrôle est répété ici
    // pour que la sécurité de la route ne dépende pas d'un seul point : si le
    // service est un jour remplacé ou appelé autrement, l'autorisation reste
    // appliquée au point d'entrée.
    assertPermission(context.role, 'PROJECT_MUTATE', requestId);
    const bodyText = await readBody(req);
    let payload: { command?: string; timeoutMs?: number };
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }

    if (!payload.command) {
      throw new ValidationError('Le champ "command" est obligatoire', undefined, requestId);
    }

    const result = terminalService.executeCommand(
      context.tenantId,
      projectId,
      { command: payload.command, timeoutMs: payload.timeoutMs },
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ result, requestId }));
    return true;
  }

  return false;
}

