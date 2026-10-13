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

// SEC-03 — anti-bruteforce login : compteur d'échecs par IP + email. Après
// LOGIN_MAX_FAILURES échecs dans la fenêtre, toute nouvelle tentative est
// refusée 429 + Retry-Until jusqu'à la fin de la fenêtre (succès = remise à zéro).
const LOGIN_FAILURE_WINDOW_MS = 60_000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map<string, { count: number; windowStart: number }>();

function loginFailureKey(req: IncomingMessage, email: string): string {
  const ip = req.socket.remoteAddress || 'unknown';
  return `${ip}:${email.trim().toLowerCase()}`;
}

function checkLoginLockout(req: IncomingMessage, email: string): number | null {
  const key = loginFailureKey(req, email);
  const failure = loginFailures.get(key);
  if (!failure) return null;
  if (Date.now() - failure.windowStart >= LOGIN_FAILURE_WINDOW_MS) {
    loginFailures.delete(key);
    return null;
  }
  if (failure.count >= LOGIN_MAX_FAILURES) {
    return Math.max(1, Math.ceil((LOGIN_FAILURE_WINDOW_MS - (Date.now() - failure.windowStart)) / 1000));
  }
  return null;
}

function recordLoginFailure(req: IncomingMessage, email: string): void {
  const key = loginFailureKey(req, email);
  const now = Date.now();
  const failure = loginFailures.get(key);
  if (!failure || now - failure.windowStart >= LOGIN_FAILURE_WINDOW_MS) {
    loginFailures.set(key, { count: 1, windowStart: now });
    return;
  }
  loginFailures.set(key, { count: failure.count + 1, windowStart: failure.windowStart });
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
      const user = await userStore.createUser(body.email || '', body.password || '', body.name);
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
    const email = body.email || '';
    const lockoutRetryAfterSec = checkLoginLockout(req, email);
    if (lockoutRetryAfterSec !== null) {
      res.statusCode = 429;
      res.setHeader('Retry-After', String(lockoutRetryAfterSec));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: {
          code: 'TOO_MANY_ATTEMPTS',
          message: `Trop de tentatives de connexion — réessayez dans ${lockoutRetryAfterSec}s.`,
          statusCode: 429
        },
        requestId
      }));
      return true;
    }
    const user = await userStore.verifyCredentials(email, body.password || '');
    if (!user) {
      recordLoginFailure(req, email);
      sendJson(res, 401, { message: 'Email ou mot de passe incorrect.', requestId });
      return true;
    }
    loginFailures.delete(loginFailureKey(req, email));
    const token = signToken(user);
    sendJson(res, 200, { token, user: publicUser(user), requestId });
    return true;
  }

  return false;
}
