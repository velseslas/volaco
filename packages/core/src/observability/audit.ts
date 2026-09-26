import { randomUUID } from 'node:crypto';
import { sanitizePayload } from '../security/secrets.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';

export interface AuditEvent {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  status: 'SUCCESS' | 'FAILURE';
  metadata?: Record<string, unknown> | undefined;
  requestId: string;
  timestamp: Date;
}

const AUDIT_MAX_EVENTS = 5_000; // garde-fou mémoire/disque (append-only borné)

/**
 * ÉTAPE 3 — Audit persistant : les événements survivent aux redémarrages via
 * la couche de persistance (SQLite). Le fichier hérité est migré
 * automatiquement au premier chargement.
 *
 * La persistance est OPT-IN (options.persist) : le singleton de production
 * (`auditStore`) persiste, tandis que les instances construites directement
 * (tests, services isolés) restent en mémoire avec une sémantique identique
 * à l'ancien comportement — instance neuve = store vide.
 */
export class AuditStore {
  private events: AuditEvent[] = [];
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath('audit-events');
    if (this.persistent) {
      const loaded = readJsonFile<AuditEvent[]>(this.filePath, []);
      if (Array.isArray(loaded)) {
        // Les timestamps sont sérialisés en ISO : les re-dater
        this.events = loaded.map((e) => ({ ...e, timestamp: new Date(e.timestamp) }));
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.events.slice(-AUDIT_MAX_EVENTS));
    } catch {
      // L'audit ne doit jamais faire échouer la requête qui le déclenche
    }
  }

  public record(input: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
    const event: AuditEvent = {
      id: 'aud_' + randomUUID().replace(/-/g, '').slice(0, 16),
      tenantId: input.tenantId,
      userId: input.userId || 'system',
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      status: input.status,
      ...(input.metadata ? { metadata: sanitizePayload(input.metadata) } : {}),
      requestId: input.requestId,
      timestamp: new Date()
    };

    this.events.push(event);
    this.persist();
    return event;
  }

  public query(tenantId: string, filter?: { action?: string; resourceType?: string }): AuditEvent[] {
    return this.events.filter(e => {
      if (e.tenantId !== tenantId) return false;
      if (filter?.action && e.action !== filter.action) return false;
      if (filter?.resourceType && e.resourceType !== filter.resourceType) return false;
      return true;
    });
  }

  public clear(): void {
    this.events = [];
    this.persist();
  }
}

export const auditStore = new AuditStore({ persist: true });
