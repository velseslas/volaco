import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  context?: Record<string, unknown>;
}

export class StructuredLogger {
  private defaultContext: Record<string, unknown>;

  constructor(defaultContext: Record<string, unknown> = {}) {
    this.defaultContext = defaultContext;
  }

  public createEntry(level: LogLevel, message: string, context?: Record<string, unknown>, requestId?: string): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(requestId ? { requestId } : {}),
      context: { ...this.defaultContext, ...(context || {}) }
    };
  }

  public log(level: LogLevel, message: string, context?: Record<string, unknown>, requestId?: string): LogEntry {
    const entry = this.createEntry(level, message, context, requestId);
    const json = JSON.stringify(entry);
    if (level === 'error') {
      console.error(json);
    } else if (level === 'warn') {
      console.warn(json);
    } else {
      console.log(json);
    }
    return entry;
  }

  public info(message: string, context?: Record<string, unknown>, requestId?: string): LogEntry {
    return this.log('info', message, context, requestId);
  }

  public warn(message: string, context?: Record<string, unknown>, requestId?: string): LogEntry {
    return this.log('warn', message, context, requestId);
  }

  public error(message: string, context?: Record<string, unknown>, requestId?: string): LogEntry {
    return this.log('error', message, context, requestId);
  }

  public debug(message: string, context?: Record<string, unknown>, requestId?: string): LogEntry {
    return this.log('debug', message, context, requestId);
  }
}

export const logger = new StructuredLogger({ service: 'volaco-core' });

export function generateRequestId(): string {
  return 'req_' + randomUUID().replace(/-/g, '').slice(0, 16);
}
