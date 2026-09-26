import type { IncomingMessage } from 'node:http';
import type { Role } from '../../../../packages/core/src/identity/permissions.js';
import type { AppConfig } from '../../../../packages/core/src/config.js';
import { UnauthorizedError } from '../../../../packages/core/src/errors.js';
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

export function extractRequestContext(req: IncomingMessage, config?: AppConfig, requestId?: string): RequestContext {
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
    logger.warn('Requete sans Bearer - en-tetes legacy (mode dev)', {
      component: 'auth', env: config.env || 'development', path: req.url
    });
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
