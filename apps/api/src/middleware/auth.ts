import type { IncomingMessage } from 'node:http';
import type { Role } from '../../../../packages/core/src/identity/permissions.js';
import type { AppConfig } from '../../../../packages/core/src/config.js';
import { UnauthorizedError } from '../../../../packages/core/src/errors.js';
import { verifyToken } from '../../../../packages/core/src/identity/user-store.js';
import { sessionRevocationStore } from '../../../../packages/core/src/identity/session-store.js';
import { logger } from '../../../../packages/core/src/logger.js';

export interface RequestContext {
  tenantId: string;
  role: Role;
  authenticated: boolean;
  /**
   * C3.2-B (décision D7) — Identité fiable de l'appelant, UNIQUEMENT lorsque
   * elle provient d'un JWT signé (payload.sub). Jamais lue depuis un corps de
   * requête ni un en-tête client. Absente pour :
   *   - l'authentification par clé API (identité PARTAGÉE — une substitution
   *     silencieuse par un pseudo-utilisateur est interdite : les appels qui
   *     exigent une identité individuelle — confirmations d'outils — doivent
   *     REFUSER explicitement plutôt que se lier à une identité fabriquée) ;
   *   - le repli dev par en-têtes x-tenant-id/x-user-role (spoofables,
   *     aucune preuve de sécurité en production).
   */
  userId?: string | undefined;
  /** LOT B (décision 3) — identifiant unique du JWT (logout ciblé/révocation). */
  jti?: string | undefined;
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
    // userId volontairement ABSENT : la clé API est une identité partagée,
    // jamais une identité utilisateur individuelle fiable (D7).
  };
}

/**
 * Vérifie un JWT d'utilisateur (ÉTAPE 4) : le tenant et le rôle viennent du
 * TOKEN SIGNÉ — plus de confiance au header X-User-Role envoyé par le client
 * pour les requêtes authentifiées (CDC §35 RBAC).
 * C3.2-B (D7) : l'identité individuelle fiable (`sub`) est portée par le
 * contexte dès lors qu'un JWT est vérifié. verifyToken() garantit sub non
 * vide ; `usr_*` respecte le motif d'identifiant des couches store/confirmations.
 */
function verifyJwtRequest(req: IncomingMessage): RequestContext | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return null;
  const payload = verifyToken(authHeader.slice('Bearer '.length).trim());
  if (!payload) return null;
  // LOT B (Phase 2, décision 3) — la révocation est vérifiée CÔTÉ SERVEUR :
  // un JWT signé et non expiré ne passe plus après révocation (version de
  // session incrémentée au logout, ou JTI révoqué individuellement). Un jeton
  // SANS `sv` (émis avant la migration) est refusé.
  if (!sessionRevocationStore.isTokenStillValid(payload.sub, payload.sv, payload.jti)) {
    logger.warn('JWT rejeté : session révoquée', {
      component: 'auth', path: req.url, userId: payload.sub
    });
    return null;
  }
  const role: Role = payload.role === 'OWNER' || payload.role === 'ADMIN' || payload.role === 'ENGINEER' || payload.role === 'VIEWER'
    ? payload.role
    : 'VIEWER';
  return {
    tenantId: payload.tenantId,
    role,
    authenticated: true,
    userId: payload.sub,
    // émis au moment de la signature (logout ciblé côté serveur).
    jti: payload.jti
  };
}

/**
 * Surface publique minimale (commune production + mode strict dev) : le shell
 * du Studio (écran de connexion inclus), ses assets statiques et les routes
 * d'authentification. Sans cette exemption, poulet-œuf : impossible d'ouvrir
 * la page de login pour obtenir un premier jeton. Toute route /api hors /auth
 * (et /health) reste verrouillée sans Bearer valide.
 */
function isPublicRequestPath(rawPath: string): boolean {
  return rawPath === '/'
    || rawPath === '/index.html'
    || rawPath === '/shell'
    || rawPath === '/studio'
    || rawPath === '/volaco_studio.html'
    || rawPath.startsWith('/health')
    || rawPath.startsWith('/api/v1/auth/')
    || (!rawPath.startsWith('/api') && !rawPath.includes('..') && /\.[a-zA-Z0-9]+$/.test(rawPath));
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
      // Surface publique minimale : helper isPublicRequestPath (écran de
      // connexion inclus — voir sa doc). Toute route /api hors /auth et
      // /health reste verrouillée sans Bearer valide.
      const rawPath = (req.url || '/').split('?')[0] ?? '/';
      if (!isPublicRequestPath(rawPath)) {
        logger.warn('Requete sans Bearer valide en production - acces refuse', {
          component: 'auth', env: config.env, path: req.url, method: req.method
        });
        // Sécurité : en production, toute requête non publique sans Bearer
        // valide est refusée. Avant ce correctif, l'exécution continuait avec
        // un contexte fabriqué depuis les en-têtes client (rôle/tenant
        // spoofables) — l'API était ouverte même avec une clé configurée.
        throw new UnauthorizedError(
          'Authentification requise : fournissez un en-tête Authorization: Bearer <VOLACO_API_KEY>',
          requestId
        );
      }
    }
    // n°4 : bruit de routine (1 appel par requête en dev), pas un avertissement
    // — niveau info pour suivre le chemin async du logger, contenu inchangé.
    logger.info('Requete sans Bearer - en-tetes legacy (mode dev)', {
      component: 'auth', env: config.env || 'development', path: req.url
    });
  }

  // P0 — mode STRICT (LOT B, décision 1) : le repli dev (en-têtes
  // x-tenant-id / x-user-role spoofables) est désactivé par défaut.
  // Production : strict obligatoire (config.loadConfig l'assure).
  // Développement : strict actif sauf à `VOLACO_STRICT_AUTH='0'` explicite.
  // Toute valeur invalide, inconnue ou absente → mode strict + avertissement.
  const rawStrictPath = (req.url || '/').split('?')[0] ?? '/';
  const isStrictPublic = rawStrictPath.startsWith('/health')
    || rawStrictPath.startsWith('/api/v1/auth/')
    || isPublicRequestPath(rawStrictPath);
  const strictEnabled = config ? !!(config as { strictAuth?: boolean }).strictAuth : (process.env.VOLACO_STRICT_AUTH !== '0');
  if (strictEnabled && !isStrictPublic) {
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
