import type { AppConfig } from '../../../../packages/core/src/config.js';

export function getHealthResponse(config: AppConfig, requestId: string) {
  return {
    status: 'ok',
    service: config.appName,
    version: config.version,
    env: config.env,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    requestId
  };
}
