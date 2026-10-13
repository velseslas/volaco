import type { IncomingMessage } from 'node:http';
import type { Role } from '../../../../packages/core/src/identity/permissions.js';
import type { AppConfig } from '../../../../packages/core/src/config.js';
import { UnauthorizedError } from '../../../../packages/core/src/errors.js';
import { verifyToken } from '../../../../packages/core/src/identity/user-store.js';
import { logger } from '../../../../packages/core/src/logger.js';

export interface RequestContext {
  tenantId: string;
  role: Role;
  authenticated: boolean;
}

export function verifyAuthToken(req: IncomingMessage, config: AppConfig): RequestContext | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token.length < 8) {
    return null;
  }
  if (!config.apiKey || token !== config.apiKey) {
    return null;
  }
  return {
    tenantId: 'studio-local',
    role: 'OWNER',
    authenticated: true
  };
}

/**
 * Vérifie un JWT d'utilisateur (ÉTAPE 4) : le tenant et le rôle viennent du
 * TOKEN SIGNÉ — plus de confiance au header X-User-Role envoyé par le client
 * pour les requêtes authentifiées (CDC §35 RBAC).
 */
function verifyJwtRequest(req: IncomingMessage): RequestContext | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return null;
  const payload = verifyToken(authHeader.slice('Bearer '.length).trim());
  if (!payload) return null;
  const role: Role = payload.role === 'OWNER' || payload.role === 'ADMIN' || payload.role === 'ENGINEER' || payload.role === 'VIEWER'
    ? payload.role
    : 'VIEWER';
  return { tenantId: payload.tenantId, role, authenticated: true };
}

export function extractRequestContext(req: IncomingMessage, config?: AppConfig, requestId?: string): RequestContext {
  // 1. JWT utilisateur (prioritaire sur le fallback dev : un utilisateur
  //    connecté est authentifié même si une clé admin est configurée).
  const jwtContext = verifyJwtRequest(req);
  if (jwtContext) return jwtContext;

  if (config && config.apiKey) {
    const authContext = verifyAuthToken(req, config);
    if (authContext) {
      return authContext;
    }
    if (config.env === 'production') {
      logger.warn('Requete sans Bearer valide en production - acces refuse', {
        component: 'auth', env: config.env, path: req.url, method: req.method
      });
      // Sécurité : en production, toute requête sans Bearer valide est refusée.
      // Avant ce correctif, l'exécution continuait avec un contexte fabriqué
      // depuis les en-têtes client (rôle/tenant spoofables) — l'API était
      // ouverte même avec une clé configurée.
      throw new UnauthorizedError(
        'Authentification requise : fournissez un en-tête Authorization: Bearer <VOLACO_API_KEY>',
        requestId
      );
    }
    // n°4 : bruit de routine (1 appel par requête en dev), pas un avertissement
    // — niveau info pour suivre le chemin async du logger, contenu inchangé.
    logger.info('Requete sans Bearer - en-tetes legacy (mode dev)', {
      component: 'auth', env: config.env || 'development', path: req.url
    });
  }

  // P0 — mode STRICT (VOLACO_STRICT_AUTH=1) : le repli dev (en-têtes
  // x-tenant-id / x-user-role spoofables) est désactivé même en
  // développement. Toute requête sans Bearer valide est refusée — SAUF les
  // routes d'authentification elles-mêmes (signup/login : sinon poulet-œuf,
  // impossible d'obtenir un premier jeton) et la santé.
  const isAuthRoute = typeof req.url === 'string'
    && (req.url.startsWith('/api/v1/auth/') || req.url.startsWith('/health'));
  if (process.env.VOLACO_STRICT_AUTH === '1' && !isAuthRoute) {
    logger.warn('Mode strict : accès refusé sans Bearer valide', {
      component: 'auth', path: req.url, method: req.method
    });
    throw new UnauthorizedError(
      'Mode strict : fournissez un en-tête Authorization: Bearer <JWT ou VOLACO_API_KEY>',
      requestId
    );
  }

  const tenantHeader = req.headers['x-tenant-id'];
  const roleHeader = req.headers['x-user-role'];
  const tenantId = typeof tenantHeader === 'string' && tenantHeader.trim().length > 0
    ? tenantHeader.trim() : 'default-tenant';
  let role: Role = 'ENGINEER';
  if (roleHeader === 'OWNER' || roleHeader === 'ADMIN' || roleHeader === 'ENGINEER' || roleHeader === 'VIEWER') {
    role = roleHeader;
  }
  return { tenantId, role, authenticated: false };
}
