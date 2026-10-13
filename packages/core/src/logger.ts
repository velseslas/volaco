import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  context?: Record<string, unknown>;
}

const LOG_QUEUE_MAX = 5_000;

function logSyncEnabled(): boolean {
  return process.env.VOLACO_LOG_SYNC === '1';
}

export class StructuredLogger {
  private defaultContext: Record<string, unknown>;
  // n°4 — JOURNALISATION HORS CHEMIN CRITIQUE : info/debug (1 à 2 par
  // requête, dont le `logger.info` systématique du serveur) sont coalescés
  // en UNE écriture par tick (setImmediate) au lieu d'un write synchrone
  // chacun. warn/error restent synchrones : un diagnostic ne doit jamais se
  // perdre dans une queue (crash, refusal d'accès). Ordre relatif info/warn
  // non garanti — l'horodatage de chaque entrée fait foi. Repli opérateur :
  // VOLACO_LOG_SYNC=1 restaure l'écriture synchrone historique.
  private queue: string[] = [];
  private flushScheduled = false;
  private dropped = 0;

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

  /** Vide la queue (no-op si vide). Exposé pour les tests et l'arrêt propre. */
  public flush(): void {
    if (this.queue.length === 0 && this.dropped === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.flushScheduled = false;
    if (this.dropped > 0) {
      batch.push(JSON.stringify(this.createEntry('info', `journal : ${this.dropped} entrée(s) écartée(s) (queue saturée)`)));
      this.dropped = 0;
    }
    console.log(batch.join('\n'));
  }

  public log(level: LogLevel, message: string, context?: Record<string, unknown>, requestId?: string): LogEntry {
    const entry = this.createEntry(level, message, context, requestId);
    const json = JSON.stringify(entry);
    if (level === 'error') {
      console.error(json);
    } else if (level === 'warn') {
      console.warn(json);
    } else if (logSyncEnabled()) {
      console.log(json);
    } else {
      if (this.queue.length >= LOG_QUEUE_MAX) {
        this.queue.shift();
        this.dropped += 1;
      }
      this.queue.push(json);
      if (!this.flushScheduled) {
        this.flushScheduled = true;
        setImmediate(() => this.flush());
      }
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
