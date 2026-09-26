import { randomUUID } from 'node:crypto';
import { sanitizePayload } from '../security/secrets.js';

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

export class AuditStore {
  private events: AuditEvent[] = [];

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
  }
}

export const auditStore = new AuditStore();
