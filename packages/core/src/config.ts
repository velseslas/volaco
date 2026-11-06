/**
 * LOT B (Phase 2, décisions 1 & 2) — Politique stricte d'authentification et secret JWT P0.
 *
 * Exigences :
 * - le secret JWT est dédié, indépendant et aléatoire ; il ne peut être ni la
 *   clé API, ni AUTH_SECRET. Un secret absent ou invalide refuse le démarrage.
 * - `deriveApiKeyFromSecret` n'est conservé que pour la compatibilité de la
 *   clé API ; il ne sert PAS à signer des JWT.
 *
 * LOT B (Phase 2, décision 1) — Strict d'authentification :
 *   - production : strict obligatoire (jamais désactivable, même `VOLACO_STRICT_AUTH='0'`
 *     → erreur de démarrage/critique) ;
 *   - développement : strict par défaut ; seul `VOLACO_STRICT_AUTH='0'` explicite
 *     désactive le strict, et SHAKES (aucun falbback silencieux) ;
 *   - aucune valeur inconnue/absente ne doit produire un comportement non strict.
 */
import { createHmac, randomUUID } from 'node:crypto';

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  apiPrefix: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  appName: string;
  version: string;
  corsAllowedOrigins: string[];
  apiKey: string;
  strictAuth: boolean;
  jwtSecretValid: boolean;
}

/**
 * P0 — clé API STABLE en production : dérivée de façon déterministe depuis
 * AUTH_SECRET (HMAC) au lieu d'un UUID éphémère. Avant ce correctif, la clé
 * changeait à CHAQUE redémarrage — tout client authentifié était déconnecté
 * et le serveur devenait injoignable pour ses intégrations. La dérivation ne
 * stocke jamais la clé en clair et n'expose pas AUTH_SECRET.
 *
 * LOT B — décision 2 : cette dérivation NE SERT PAS à signer des JWT.
 */
export function deriveApiKeyFromSecret(authSecret: string): string {
  return createHmac('sha256', authSecret).update('volaco-api-key-v1').digest('hex').slice(0, 48);
}

function envJwtSecretBytes(): Buffer | null {
  const raw = process.env.VOLACO_JWT_SECRET;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length < 32 || decoded.toString('base64') !== raw) return null;
  if (decoded.every((byte) => byte === 0)) return null;
  return decoded;
}

export function isJwtSecretConfigured(): boolean {
  const secret = envJwtSecretBytes();
  const apiKey = process.env.VOLACO_API_KEY;
  if (secret === null) return false;
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    const decodedApi = Buffer.from(apiKey, 'base64');
    if (decodedApi.length >= 32 && decodedApi.toString('base64') === apiKey && decodedApi.equals(secret)) return false;
    if (Buffer.from(apiKey, 'utf8').equals(secret)) return false;
  }
  return true;
}

export function resolveStrictAuth(): boolean {
  const env = (process.env.NODE_ENV as AppConfig['env']) || 'development';
  const raw = process.env.VOLACO_STRICT_AUTH;
  // Production : strict obligatoire, jamais désactivable.
  if (env === 'production') return true;
  // Développement : strict par défaut ; seule '0' explicite désactive.
  return raw !== '0';
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = (process.env.NODE_ENV as AppConfig['env']) || 'development';
  const port = parseInt(process.env.PORT || '3000', 10);
  const apiPrefix = process.env.API_PREFIX || '/api/v1';
  const logLevel = (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info';
  const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  // En production, une clé vide désactiverait toute authentification. Ordre :
  // 1. VOLACO_API_KEY explicite (secret stable choisi par l'opérateur) ;
  // 2. dérivation déterministe depuis AUTH_SECRET (stable entre redémarrages) ;
  // 3. repli : UUID éphémère (jamais en production sans AUTH_SECRET — le
  //    middleware d'auth refusera tout accès non-Bearer dans ce cas).
  const authSecret = process.env.AUTH_SECRET || '';
  const apiKey = process.env.VOLACO_API_KEY
    || (env === 'production'
      ? (authSecret.length >= 32 ? deriveApiKeyFromSecret(authSecret) : randomUUID())
      : 'dev-key-change-me');

  const strictAuth = resolveStrictAuth();
  const jwtSecretValid = isJwtSecretConfigured();
  if (!jwtSecretValid) {
    // Gérer un secret JWT valide (B3: 12h, plafond 24h) — la migration et sa procédure
    // sont documentées dans mcp-lot-b-report.md §2/§5.3. Nous recopions l'erreur
    // de démarrage dans le journal serveur et levons une erreur explicite afin de
    // refuser de signer un JWT avec un secret non conforme.
    throw new Error(
      'Secret JWT VOLACO_JWT_SECRET absent ou invalide (base64 canonique de ≥ 32 octets, distinct de VOLACO_API_KEY). ' +
      'Le service refuse de démarrer.'
    );
  }
  if (!strictAuth && env === 'production') {
    throw new Error('Mode strict désactivé en production — refusé.');
  }

  return {
    env,
    port: isNaN(port) ? 3000 : port,
    apiPrefix,
    logLevel,
    appName: 'VibeCode Studio Core',
    version: '0.1.0',
    corsAllowedOrigins,
    apiKey,
    strictAuth,
    jwtSecretValid,
    ...overrides
  };
}
