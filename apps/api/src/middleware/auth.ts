import type { IncomingMessage } from 'node:http';
import type { Role } from '../../../../packages/core/src/identity/permissions.js';
import type { AppConfig } from '../../../../packages/core/src/config.js';
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

export function extractRequestContext(req: IncomingMessage, config?: AppConfig): RequestContext {
  if (config && config.apiKey) {
    const authContext = verifyAuthToken(req, config);
    if (authContext) {
      return authContext;
    }
    const env = config.env;
    if (env === 'production') {
      logger.warn('Requete sans Bearer valide en production - acces refuse', {
        component: 'auth', env, path: req.url, method: req.method
      });
    } else {
      logger.warn('Requete sans Bearer - en-tetes legacy (mode dev)', {
        component: 'auth', env: env || 'development', path: req.url
      });
    }
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
