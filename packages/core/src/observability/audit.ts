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

// n°2 — ÉCRITURES BATCHÉES : `record()` écrivait tout le document (jusqu'à
// 5 000 événements, ~700 Ko mesurés) dans SQLite à CHAQUE appel — stringify +
// UPSERT synchrones sur le chemin critique de chaque POST. Désormais la
// persistance est coalescée : au plus 1 écriture physique par fenêtre
// (défaut 1 000 ms) ou tous les N enregistrements (défaut 100).
// Arbitrage documenté : sur crash brutal, la queue non flushée (≤ 1 fenêtre)
// est perdue — `query()` reste exact car la mémoire fait foi, et `clear()` /
// `flush()` écrivent immédiatement. Seuils surchargeables par environnement
// (opérateur) ou par options (tests).
function resolveAuditFlushMs(): number {
  const raw = Number.parseInt(process.env.VOLACO_AUDIT_FLUSH_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1_000;
}

function resolveAuditFlushEvery(): number {
  const raw = Number.parseInt(process.env.VOLACO_AUDIT_FLUSH_EVERY || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

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
  private readonly flushMs: number;
  private readonly flushEvery: number;
  private lastFlushAt = 0;
  private pendingSinceFlush = 0;

  constructor(options?: { persist?: boolean; flushMs?: number; flushEvery?: number }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath('audit-events');
    this.flushMs = options?.flushMs !== undefined && options.flushMs > 0 ? options.flushMs : resolveAuditFlushMs();
    this.flushEvery = options?.flushEvery !== undefined && options.flushEvery > 0 ? options.flushEvery : resolveAuditFlushEvery();
    // Volontairement 0 : `Date.now() - 0 >= flushMs` force le flush du 1er
    // record — ancre de durabilité (faible trafic : 1 record = durable
    // aussitôt, contrat couvert par persistence-sqlite.test.ts #4). Sous
    // rafale, les records suivants sont coalescés normalement.
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
      this.lastFlushAt = Date.now();
      this.pendingSinceFlush = 0;
    } catch {
      // L'audit ne doit jamais faire échouer la requête qui le déclenche
    }
  }

  /** Écrit immédiatement la queue (no-op si rien en attente ou non persistant). */
  public flush(): void {
    if (!this.persistent || this.pendingSinceFlush === 0) return;
    this.persist();
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
    this.pendingSinceFlush += 1;
    // Batch : 1 écriture physique par fenêtre ou tous les N — jamais plus.
    if (this.pendingSinceFlush >= this.flushEvery || Date.now() - this.lastFlushAt >= this.flushMs) {
      this.persist();
    }
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
    // Sémantique inchangée : un clear() est immédiatement durable (les suites
    // de tests s'appuient sur l'isolation entre scénarios).
    this.pendingSinceFlush = 1;
    this.persist();
  }
}

export const auditStore = new AuditStore({ persist: true });
