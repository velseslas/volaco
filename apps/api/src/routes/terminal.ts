import type { IncomingMessage, ServerResponse } from 'node:http';
import { TerminalService } from '../../../../packages/core/src/terminal/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import type { RequestContext } from '../middleware/auth.js';

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', (err) => reject(err));
  });
}
