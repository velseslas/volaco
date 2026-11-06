/**
 * VibeCode Core - API Tier
 * Auth Routes (ÉTAPE 4) — signup / login JWT / GET auth/me.
 *
 * Le token contient tenantId + rôle : le serveur ne fait PLUS confiance au
 * header X-User-Role pour les requêtes authentifiées (CDC §35 RBAC).
 * GET /api/v1/auth/me (Espace utilisateur) : identité réelle UNIQUEMENT issue
 * d'un JWT vérifié — clé API partagée et replis header anonymes REFUSÉS (D7).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { userStore, signToken } from '../../../../packages/core/src/identity/user-store.js';
import { sessionRevocationStore } from '../../../../packages/core/src/identity/session-store.js';
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
  jti?: string;
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

// LOT B (décision 5) — protection anti-abus du SIGNUP : limite les créations
// de compte par IP (une IP ne peut pas créer un nombre illimité de comptes en
// rafale). N'affecte jamais un compte existant (ne permet donc pas de bloquer
// arbitrairement les comptes d'autres utilisateurs).
const SIGNUP_WINDOW_MS = 60_000;
const SIGNUP_MAX_PER_IP = 10;
const signupAttempts = new Map<string, { count: number; windowStart: number }>();

function signupIpKey(req: IncomingMessage): string {
  return `signup:${req.socket.remoteAddress || 'unknown'}`;
}

function checkSignupRate(req: IncomingMessage): number | null {
  const key = signupIpKey(req);
  const now = Date.now();
  const entry = signupAttempts.get(key);
  if (!entry || now - entry.windowStart >= SIGNUP_WINDOW_MS) {
    signupAttempts.set(key, { count: 1, windowStart: now });
    return null;
  }
  entry.count += 1;
  if (entry.count > SIGNUP_MAX_PER_IP) {
    return Math.max(1, Math.ceil((SIGNUP_WINDOW_MS - (now - entry.windowStart)) / 1000));
  }
  return null;
}

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
  if (!pathname.startsWith('/api/v1/auth/') || (req.method !== 'POST' && req.method !== 'GET')) {
    return false;
  }

  // Espace utilisateur — GET /api/v1/auth/me : identité RÉELLE de l'appelant
  // (id/email/name/role/tenant). L'identité vient EXCLUSIVEMENT d'un JWT
  // vérifié (payload.sub, cf. D7) :
  //   - la clé API partagée n'a PAS d'identité individuelle → refus explicite
  //     (jamais de pseudo-utilisateur fabriqué) ;
  //   - tout contexte anonyme (repli dev) est refusé — même en développement,
  //     - en mode non strict (LOT B décision 1), la résolution d'identité passe
  //       par le même point de lecture centralisé (config.strictAuth).
  //     /me ne construit jamais une identité depuis les headers.
  if (req.method === 'GET' && pathname === '/api/v1/auth/me') {
    if (_context.authenticated === true && !_context.userId) {
      sendJson(res, 401, {
        message: 'Identité individuelle indisponible : la clé API est partagée (D7). Connectez-vous avec un jeton utilisateur.',
        requestId
      });
      return true;
    }
    if (_context.authenticated !== true || !_context.userId) {
      sendJson(res, 401, { message: 'Authentification requise : fournissez un en-tête Authorization: Bearer <JWT>.', requestId });
      return true;
    }
    const user = userStore.findById(_context.userId);
    if (!user) {
      sendJson(res, 401, { message: 'Session invalide : le compte référencé par ce jeton n\'existe plus.', requestId });
      return true;
    }
    sendJson(res, 200, { user: publicUser(user), requestId });
    return true;
  }

  if (req.method !== 'POST') {
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
    const signupRetry = checkSignupRate(req);
    if (signupRetry !== null) {
      res.statusCode = 429;
      res.setHeader('Retry-After', String(signupRetry));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: {
          code: 'TOO_MANY_ATTEMPTS',
          message: `Trop de créations de compte — réessayez dans ${signupRetry}s.`,
          statusCode: 429
        },
        requestId
      }));
      return true;
    }
    try {
      const user = await userStore.createUser(body.email || '', body.password || '', body.name);
      const token = signToken(user, undefined, sessionRevocationStore.currentVersion(user.id));
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
    const token = signToken(user, undefined, sessionRevocationStore.currentVersion(user.id));
    sendJson(res, 200, { token, user: publicUser(user), requestId });
    return true;
  }

  // POST /api/v1/auth/logout — (LOT B, décision 3) révocation EFFECTIVE :
  // sans corps, révoque TOUTES les sessions de l'utilisateur (version de
  // session incrémentée) ; avec `{ jti }`, révoque uniquement ce jeton.
  // L'endpoint est idempotent et exige une identité JWT signée.
  // NOTE : le corps a DÉJÀ été lu plus haut (variable `body`) — ne jamais
  // relire le flux ici (il est épuisé : un second readBody pendrait).
  if (pathname === '/api/v1/auth/logout') {
    if (_context.authenticated !== true || !_context.userId) {
      sendJson(res, 401, { message: 'Authentification requise : fournissez un en-tête Authorization: Bearer <JWT>.', requestId });
      return true;
    }
    const rawJti = (body as { jti?: unknown })?.jti;
    const revokeJti = typeof rawJti === 'string' && rawJti.length > 0 ? rawJti : undefined;
    if (revokeJti !== undefined) {
      sessionRevocationStore.revokeJti(revokeJti);
      sendJson(res, 200, { revoked: 'session', jti: revokeJti, requestId });
      return true;
    }
    const nextVersion = sessionRevocationStore.revokeUser(_context.userId);
    sendJson(res, 200, {
      revoked: 'all-sessions',
      userId: _context.userId,
      sessionVersion: nextVersion,
      requestId
    });
    return true;
  }

  return false;
}
