/**
 * VibeCode Core - API Tier
 * Auth Routes (ÉTAPE 4) — signup / login JWT.
 *
 * Le token contient tenantId + rôle : le serveur ne fait PLUS confiance au
 * header X-User-Role pour les requêtes authentifiées (CDC §35 RBAC).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { userStore, signToken } from '../../../../packages/core/src/identity/user-store.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { readBody } from '../middleware/body.js';
import type { RequestContext } from '../middleware/auth.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

interface AuthBody {
  email?: string;
  password?: string;
  name?: string;
}

function publicUser(user: { id: string; email: string; name: string; tenantId: string; role: string }) {
  return { id: user.id, email: user.email, name: user.name, tenantId: user.tenantId, role: user.role };
}

export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _context: RequestContext,
  requestId: string
): Promise<boolean> {
  if (!pathname.startsWith('/api/v1/auth/') || req.method !== 'POST') {
    return false;
  }

  let body: AuthBody;
  try {
    body = (await readBody(req) || '{}') as unknown as AuthBody;
    if (typeof body === 'string') body = JSON.parse(body) as AuthBody;
  } catch {
    throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
  }

  // POST /api/v1/auth/signup
  if (pathname === '/api/v1/auth/signup') {
    try {
      const user = userStore.createUser(body.email || '', body.password || '', body.name);
      const token = signToken(user);
      sendJson(res, 201, { token, user: publicUser(user), requestId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, { message, requestId });
    }
    return true;
  }

  // POST /api/v1/auth/login
  if (pathname === '/api/v1/auth/login') {
    const user = userStore.verifyCredentials(body.email || '', body.password || '');
    if (!user) {
      sendJson(res, 401, { message: 'Email ou mot de passe incorrect.', requestId });
      return true;
    }
    const token = signToken(user);
    sendJson(res, 200, { token, user: publicUser(user), requestId });
    return true;
  }

  return false;
}
