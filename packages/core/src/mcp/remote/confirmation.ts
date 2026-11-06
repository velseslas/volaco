/**
 * C3.1 — Confirmations ponctuelles anti-rejeu pour les appels d'outils MCP
 * distants (usage unique, liée au tenant, à l'utilisateur, au connecteur, au
 * nom d'outil, au hash du schéma d'outil et au hash des arguments).
 *
 * Garanties :
 * - chaque confirmation est inscrite en base (table mcp_remote_confirmations
 *   créée par ensureRemoteMcpSchema — aucune donnée volatile) ;
 * - la consommation est ATOMIQUE (BEGIN IMMEDIATE + UPDATE conditionnel) :
 *   une seule exécution au monde peut marquer `consumed_at`, les rejeux sont
 *   rejetés, ce qui vaut aussi en cas de concurrence (exécutions en série ou
 *   entre deux connexions SQLite grâce au lock d'écriture) ;
 * - TTL borné (cap défaut 15 minutes) et échéance absolue en epoch ms ;
 * - mots interdits : aucune confiance accordée à un `confirmed: true`,
 *   c'est la ligne de la table qui fait foi ;
 * - les empreintes (schemaSha256, argsSha256) sont produites par l'appelant
 *   de haut niveau (C3.2) sur la charge canonique, côté serveur uniquement.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getSqliteDatabase } from '../../persistence/sqlite-backend.js';
import type { RemoteMcpConfirmationRecord } from './types.js';
import {
  RemoteMcpStoreError,
  ensureRemoteMcpSchema,
  withRemoteMcpTransaction
} from './store.js';

export const REMOTE_MCP_CONFIRMATION_MAX_TTL_MS = 15 * 60 * 1000;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type RemoteMcpConfirmationFailure =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REPLAY'
  | 'BINDING_MISMATCH';

export type RemoteMcpConfirmationResult =
  | { readonly consumed: true; readonly record: RemoteMcpConfirmationRecord }
  | { readonly consumed: false; readonly reason: RemoteMcpConfirmationFailure };

export interface RemoteMcpConfirmationIssueInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly connectorId: string;
  readonly toolName: string;
  readonly schemaSha256: string;
  readonly argsSha256: string;
  readonly ttlMs: number;
}

export interface RemoteMcpConfirmationConsumeInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly confirmationId: string;
  readonly connectorId: string;
  readonly toolName: string;
  readonly schemaSha256: string;
  readonly argsSha256: string;
}

interface ConfirmationRow {
  tenant_id: string;
  user_id: string;
  confirmation_id: string;
  connector_id: string;
  tool_name: string;
  schema_sha256: string;
  args_sha256: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: string;
}

function assertIdField(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new RemoteMcpStoreError(
      `${label} invalide (format attendu : alphanumérique, <= 64 caractères)`,
      'INVALID_INPUT'
    );
  }
  return value;
}

function assertToolField(value: unknown): string {
  if (typeof value !== 'string' || !TOOL_NAME_PATTERN.test(value)) {
    throw new RemoteMcpStoreError(
      'toolName invalide (1 à 128 caractères alphanumériques/._-)',
      'INVALID_INPUT'
    );
  }
  return value;
}

function assertShaField(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new RemoteMcpStoreError(
      `${label} invalide (SHA-256 hexadécimal minuscule de 64 caractères attendu)`,
      'INVALID_INPUT'
    );
  }
  return value;
}

function rowToRecord(row: ConfirmationRow): RemoteMcpConfirmationRecord {
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    confirmationId: row.confirmation_id,
    connectorId: row.connector_id,
    toolName: row.tool_name,
    schemaSha256: row.schema_sha256,
    argsSha256: row.args_sha256,
    expiresAt: Number(row.expires_at),
    consumedAt: row.consumed_at === null ? null : Number(row.consumed_at)
  };
}

export class RemoteMcpConfirmationStore {
  private readonly now: () => number;
  private schemaReady = false;
  private readonly allowForeignConnectorIds: boolean;

  /**
   * Lot A (gouvernance MCP intégrée) — `options.allowForeignConnectorIds`
   * accepte les pseudo-connecteurs `builtin.*` qui ne sont JAMAIS des lignes
   * de `mcp_remote_connectors`. Séparation des domaines par construction :
   * un connecteur DISTANT reçoit toujours un ID UUID généré par le store
   * (`createConnector`), donc aucun identifiant utilisateur ne peut porter
   * le préfixe `builtin.` et croiser les domaines. DÉFAUT (absent/false) :
   * comportement C3.1 strictement inchangé (contrôle d'existence obligatoire).
   */
  constructor(
    now: () => number = Date.now,
    options?: { allowForeignConnectorIds?: boolean } | undefined
  ) {
    this.now = now;
    this.allowForeignConnectorIds = options?.allowForeignConnectorIds === true;
  }

  private db(): DatabaseSync {
    const db = getSqliteDatabase();
    if (db === null) {
      throw new RemoteMcpStoreError(
        'Backend SQLite indisponible, confirmations anti-rejeu refusées (aucun repli silencieux)',
        'STORAGE_UNAVAILABLE'
      );
    }
    if (!this.schemaReady) {
      ensureRemoteMcpSchema(db);
      this.schemaReady = true;
    }
    return db;
  }

  /** Enregistre une confirmation à usage unique, bornée par le TTL max. */
  issue(input: RemoteMcpConfirmationIssueInput): RemoteMcpConfirmationRecord {
    const tenantId = assertIdField(input.tenantId, 'tenantId');
    const userId = assertIdField(input.userId, 'userId');
    const connectorId = assertIdField(input.connectorId, 'connectorId');
    const toolName = assertToolField(input.toolName);
    const schemaSha256 = assertShaField(input.schemaSha256, 'schemaSha256');
    const argsSha256 = assertShaField(input.argsSha256, 'argsSha256');
    if (
      !Number.isInteger(input.ttlMs) ||
      input.ttlMs <= 0 ||
      input.ttlMs > REMOTE_MCP_CONFIRMATION_MAX_TTL_MS
    ) {
      throw new RemoteMcpStoreError(
        `ttlMs invalide (1 à ${REMOTE_MCP_CONFIRMATION_MAX_TTL_MS} ms)`,
        'INVALID_INPUT'
      );
    }
    const db = this.db();
    const confirmationId = randomUUID();
    const nowMs = this.now();
    const expiresAt = nowMs + input.ttlMs;
    return withRemoteMcpTransaction(db, () => {
      // Lot A : contrôle d'existence levé UNIQUEMENT pour la gouvernance des
      // outils intégrés (pseudo-connecteurs `builtin.*`, drapeau du ctor) —
      // la voie distante garde le contrôle C3.1 strictement inchangé.
      if (!this.allowForeignConnectorIds) {
        const connector = db
          .prepare(
            'SELECT connector_id FROM mcp_remote_connectors WHERE tenant_id = ? AND connector_id = ?'
          )
          .get(tenantId, connectorId);
        if (connector === undefined) {
          throw new RemoteMcpStoreError('Connecteur introuvable dans ce tenant', 'NOT_FOUND');
        }
      }
      db.prepare(
        `INSERT INTO mcp_remote_confirmations
           (tenant_id, user_id, confirmation_id, connector_id, tool_name,
            schema_sha256, args_sha256, expires_at, consumed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      ).run(
        tenantId,
        userId,
        confirmationId,
        connectorId,
        toolName,
        schemaSha256,
        argsSha256,
        expiresAt,
        new Date(nowMs).toISOString()
      );
      const row = db
        .prepare(
          'SELECT * FROM mcp_remote_confirmations WHERE tenant_id = ? AND confirmation_id = ?'
        )
        .get(tenantId, confirmationId) as unknown as ConfirmationRow;
      return rowToRecord(row);
    });
  }

  /**
   * Consommation atomique UNIQUE : marque `consumed_at` en un seul UPDATE
   * conditionnel (consommé ? expiré ? login/outil/schéma/arguments liés ?).
   * Deux consommateurs concurrents ne peuvent pas tous deux aboutir.
   */
  consume(input: RemoteMcpConfirmationConsumeInput): RemoteMcpConfirmationResult {
    const tenantId = assertIdField(input.tenantId, 'tenantId');
    const userId = assertIdField(input.userId, 'userId');
    const confirmationId = assertIdField(input.confirmationId, 'confirmationId');
    const connectorId = assertIdField(input.connectorId, 'connectorId');
    const toolName = assertToolField(input.toolName);
    const schemaSha256 = assertShaField(input.schemaSha256, 'schemaSha256');
    const argsSha256 = assertShaField(input.argsSha256, 'argsSha256');
    const db = this.db();
    const nowMs = this.now();
    return withRemoteMcpTransaction(db, () => {
      const row = db
        .prepare(
          'SELECT * FROM mcp_remote_confirmations WHERE tenant_id = ? AND confirmation_id = ?'
        )
        .get(tenantId, confirmationId) as unknown as ConfirmationRow | undefined;
      if (row === undefined) {
        return { consumed: false, reason: 'NOT_FOUND' as const };
      }
      const mismatch =
        row.user_id !== userId ||
        row.connector_id !== connectorId ||
        row.tool_name !== toolName ||
        row.schema_sha256 !== schemaSha256 ||
        row.args_sha256 !== argsSha256;
      if (mismatch) {
        return { consumed: false, reason: 'BINDING_MISMATCH' as const };
      }
      if (Number(row.expires_at) <= nowMs) {
        return { consumed: false, reason: 'EXPIRED' as const };
      }
      if (row.consumed_at !== null) {
        return { consumed: false, reason: 'REPLAY' as const };
      }
      const result = db
        .prepare(
          `UPDATE mcp_remote_confirmations SET consumed_at = ?
           WHERE tenant_id = ? AND confirmation_id = ?
             AND consumed_at IS NULL AND expires_at > ?`
        )
        .run(nowMs, tenantId, confirmationId, nowMs);
      if (Number(result.changes) !== 1) {
        return { consumed: false, reason: 'REPLAY' as const };
      }
      return {
        consumed: true,
        record: { ...rowToRecord(row), consumedAt: nowMs }
      };
    });
  }
}
