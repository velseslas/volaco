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

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = (process.env.NODE_ENV as AppConfig['env']) || 'development';
  const port = parseInt(process.env.PORT || '3000', 10);
  const apiPrefix = process.env.API_PREFIX || '/api/v1';
  const logLevel = (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info';
  const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const apiKey = process.env.VOLACO_API_KEY || (env === 'production' ? '' : 'dev-key-change-me');

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
