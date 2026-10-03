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
}

/**
 * P0 — clé API STABLE en production : dérivée de façon déterministe depuis
 * AUTH_SECRET (HMAC) au lieu d'un UUID éphémère. Avant ce correctif, la clé
 * changeait à CHAQUE redémarrage — tout client authentifié était déconnecté
 * et le serveur devenait injoignable pour ses intégrations. La dérivation ne
 * stocke jamais la clé en clair et n'expose pas AUTH_SECRET.
 */
export function deriveApiKeyFromSecret(authSecret: string): string {
  return createHmac('sha256', authSecret).update('volaco-api-key-v1').digest('hex').slice(0, 48);
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

  return {
    env,
    port: isNaN(port) ? 3000 : port,
    apiPrefix,
    logLevel,
    appName: 'VibeCode Studio Core',
    version: '0.1.0',
    corsAllowedOrigins,
    apiKey,
    ...overrides
  };
}
