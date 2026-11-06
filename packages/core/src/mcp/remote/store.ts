/**
 * C3.1 — Stockage persistant SQLite des connecteurs MCP distants.
 *
 * Backend : le SEUL backend persistant autorisé est node:sqlite via
 * `getSqliteDatabase()` (même instance que la persistence produit). Si le
 * backend est indisponible → erreur explicite (STORAGE_UNAVAILABLE) ; il n'y
 * a AUCUN repli JSON silencieux, et le state JSON générique (documents) n'est
 * pas réutilisé, sa clé n'étant pas tenant-isolée.
 *
 * Tables dédiées (jamais dans `documents`), chacune contraintes côté SQL :
 *   - mcp_remote_connectors   : connecteur + enveloppe de secret chiffrée ;
 *   - mcp_remote_tool_policies: approbation oui/non par (tool, schemaHash) ;
 *   - mcp_remote_confirmations: tokens anti-rejeu à usage unique (store lazy).
 *
 * Isolation tenant stricte : TOUTE requête porte tenant_id = ? et les clés
 * primaires incluent tenant_id. Les écritures passent par des transactions
 * BEGIN IMMEDIATE / COMMIT / ROLLBACK. Les secrets sont chiffrés par
 * RemoteMcpSecretCipher (AES-256-GCM, AAD lié tenant+connecteur) : jamais de
 * plaintext en base, ni dans les enregistrements renvoyés.
 *
 * Permissions : fichier SQLite chmod 0o600 + dossier 0o700 (best-effort sous
 * Windows), exécuté une fois par processus à l'initialisation du store.
 *
 * MCP-C3.1-CONFIG-STORE (delta conforme) — persistance du résultat du dernier
 * test de connexion : colonnes last_test_at / last_test_status /
 * last_test_detail ajoutées NON destructivement (ALTER TABLE ADD COLUMN
 * idempotent pour les bases préexistantes, DDL étendu pour les bases neuves).
 * Aucune ligne préexistante n'est lue ni réécrite par la migration ; aucune
 * route ni API d'appel modifiée.
 */

import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { getSqliteDatabase, sqliteDatabasePath } from '../../persistence/sqlite-backend.js';
import { logger } from '../../logger.js';
import { RemoteMcpSecretCipher } from './crypto.js';
import { REMOTE_MCP_URL_MAX_LENGTH, validateRemoteMcpUrl } from './url-policy.js';
import type {
  RemoteMcpConnectorRecord,
  RemoteMcpLastTest,
  RemoteMcpLastTestStatus,
  RemoteMcpSecretMeta,
  RemoteMcpSha256Hex,
  RemoteMcpToolPolicy
} from './types.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type RemoteMcpStoreErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'NOT_FOUND';

export class RemoteMcpStoreError extends Error {
  readonly code: RemoteMcpStoreErrorCode;

  constructor(message: string, code: RemoteMcpStoreErrorCode) {
    super(message);
    this.name = 'RemoteMcpStoreError';
    this.code = code;
  }
}

export interface RemoteMcpCreateConnectorInput {
  readonly tenantId: string;
  readonly name: string;
  readonly url: string;
}

export interface RemoteMcpApproveToolInput {
  readonly tenantId: string;
  readonly connectorId: string;
  readonly toolName: string;
  readonly schemaSha256: RemoteMcpSha256Hex;
  readonly approvedBy: string;
}

interface ConnectorRow {
  tenant_id: string;
  connector_id: string;
  name: string;
  url: string;
  enabled: number;
  secret_key_id: string | null;
  secret_iv: string | null;
  secret_ciphertext: string | null;
  secret_tag: string | null;
  secret_created_at: string | null;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_detail: string | null;
  created_at: string;
  updated_at: string;
}

interface ToolPolicyRow {
  tenant_id: string;
  connector_id: string;
  tool_name: string;
  schema_sha256: string;
  status: string;
  approved_by: string;
  approved_at: string;
  updated_at: string;
}

/** Le DDL complet est partagé avec le store de confirmations anti-rejeu. */
export function ensureRemoteMcpSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_remote_connectors (
      tenant_id TEXT NOT NULL CHECK(length(tenant_id) <= 64),
      connector_id TEXT NOT NULL CHECK(length(connector_id) <= 64),
      name TEXT NOT NULL CHECK(length(name) <= 64),
      url TEXT NOT NULL CHECK(length(url) <= ${REMOTE_MCP_URL_MAX_LENGTH}),
      transport TEXT NOT NULL CHECK(transport = 'url'),
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
      secret_key_id TEXT,
      secret_iv TEXT,
      secret_ciphertext TEXT,
      secret_tag TEXT,
      secret_created_at TEXT,
      last_test_at TEXT,
      last_test_status TEXT CHECK(last_test_status IN ('OK','FAILED')),
      last_test_detail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, connector_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_remote_connectors_tenant
      ON mcp_remote_connectors (tenant_id);
    CREATE TABLE IF NOT EXISTS mcp_remote_tool_policies (
      tenant_id TEXT NOT NULL CHECK(length(tenant_id) <= 64),
      connector_id TEXT NOT NULL CHECK(length(connector_id) <= 64),
      tool_name TEXT NOT NULL CHECK(length(tool_name) <= 128),
      schema_sha256 TEXT NOT NULL CHECK(length(schema_sha256) = 64),
      status TEXT NOT NULL CHECK(status IN ('APPROVED', 'REVOKED')),
      approved_by TEXT NOT NULL CHECK(length(approved_by) <= 128),
      approved_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, connector_id, tool_name)
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_remote_tool_policies_lookup
      ON mcp_remote_tool_policies (tenant_id, connector_id, tool_name, status, schema_sha256);
    CREATE TABLE IF NOT EXISTS mcp_remote_confirmations (
      tenant_id TEXT NOT NULL CHECK(length(tenant_id) <= 64),
      user_id TEXT NOT NULL CHECK(length(user_id) <= 128),
      confirmation_id TEXT NOT NULL CHECK(length(confirmation_id) <= 64),
      connector_id TEXT NOT NULL CHECK(length(connector_id) <= 64),
      tool_name TEXT NOT NULL CHECK(length(tool_name) <= 128),
      schema_sha256 TEXT NOT NULL CHECK(length(schema_sha256) = 64),
      args_sha256 TEXT NOT NULL CHECK(length(args_sha256) = 64),
      expires_at INTEGER NOT NULL CHECK(expires_at > 0),
      consumed_at INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, confirmation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_remote_confirmations_expiry
      ON mcp_remote_confirmations (tenant_id, expires_at);
  `);
}

function assertIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new RemoteMcpStoreError(
      `${label} invalide (format attendu : alphanumérique, <= 64 caractères)`,
      'INVALID_INPUT'
    );
  }
  return value;
}

function assertConnectorName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new RemoteMcpStoreError('name du connecteur invalide', 'INVALID_INPUT');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64 || /[\u0000-\u001f]/.test(trimmed)) {
    throw new RemoteMcpStoreError(
      'name du connecteur invalide (1 à 64 caractères, sans caractères de contrôle)',
      'INVALID_INPUT'
    );
  }
  return trimmed;
}

/** BEGIN IMMEDIATE / COMMIT / ROLLBACK ; rollback en échec est journalisé. */
export function withRemoteMcpTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      logger.warn(
        `rollback échoué après erreur de transaction : ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { component: 'mcp-remote-store' }
      );
    }
    throw error;
  }
}

/**
 * C3.4 (§4) — Invalidations internes des confirmations PENDING lors d'un
 * changement du CONTEXTE DE SÉCURITÉ : désactivation du connecteur,
 * révocation d'un outil, rotation ou retrait du secret.
 *
 * Sémantique strictement identique au changement d'URL (D3/B3) : les lignes
 * sont MARQUÉES consommées (conservées pour l'inspection, refus REPLAY
 * garanti par consume()), JAMAIS supprimées. L'appelant détient déjà le
 * lock d'écriture (une transaction BEGIN IMMEDIATE est en cours) : l'UPDATE
 * ici ne DOIT jamais s'exécuter hors transaction de l'appelant.
 * Retourne le nombre de lignes marquées (non secret, usage tests/audit).
 */
function invalidatePendingConfirmations(
  db: DatabaseSync,
  tenantId: string,
  connectorId: string,
  toolName?: string
): number {
  const result = toolName === undefined
    ? db
        .prepare(
          `UPDATE mcp_remote_confirmations
           SET consumed_at = ?
           WHERE tenant_id = ? AND connector_id = ? AND consumed_at IS NULL`
        )
        .run(Date.now(), tenantId, connectorId)
    : db
        .prepare(
          `UPDATE mcp_remote_confirmations
           SET consumed_at = ?
           WHERE tenant_id = ? AND connector_id = ? AND tool_name = ? AND consumed_at IS NULL`
        )
        .run(Date.now(), tenantId, connectorId, toolName);
  return Number(result.changes);
}

let permissionsApplied = false;

/** 0o600 sur le fichier SQLite, 0o700 sur le dossier (best-effort Windows). */
function hardenSqlitePermissions(): void {
  if (permissionsApplied) return;
  permissionsApplied = true;
  try {
    const dbFile = sqliteDatabasePath();
    if (existsSync(dbFile)) chmodSync(dbFile, 0o600);
    const parent = dirname(dbFile);
    if (existsSync(parent)) chmodSync(parent, 0o700);
  } catch (error) {
    logger.warn(
      `chmod best-effort impossible sur la base SQLite: ${error instanceof Error ? error.message : String(error)}`,
      { component: 'mcp-remote-store' }
    );
  }
}

function secretMetaFromRow(row: ConnectorRow): RemoteMcpSecretMeta | null {
  if (row.secret_key_id === null || row.secret_created_at === null) return null;
  return { keyId: row.secret_key_id, encryptedAt: row.secret_created_at };
}

/** Détail du dernier test de connexion : chaîne bornée (512 unités de code), pour empêcher l'inflation de la base. */
const LAST_TEST_DETAIL_MAX = 512;

/**
 * MCP-C3.1-CONFIG-STORE — Normalisation du détail du dernier test (FORMAT
 * uniquement). La rédaction applicative des secrets reste la responsabilité
 * de la couche supérieure ; ici : neutralisation des caractères de contrôle,
 * compactage des espaces et borne stricte. Aucune donnée n'est journalisée
 * entière par le store.
 */
function sanitizeLastTestDetail(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  const units = Array.from(cleaned);
  if (units.length > LAST_TEST_DETAIL_MAX) return units.slice(0, LAST_TEST_DETAIL_MAX).join('');
  return cleaned;
}

/**
 * MCP-C3.1-CONFIG-STORE — Migration NON destructive des bases préexistantes :
 * ALTER TABLE ADD COLUMN idempotent, aucune lecture ni réécriture de ligne
 * (les colonnes ajoutées visent NULL pour les enregistrements existants).
 * Aucun renommage, aucun DROP, aucune transformation de table — les bases
 * neuves reçoivent déjà les colonnes via le DDL étendu de
 * ensureRemoteMcpSchema.
 */
function ensureLegacyLastTestColumns(db: DatabaseSync): void {
  const columns = db
    .prepare("SELECT name FROM pragma_table_info('mcp_remote_connectors')")
    .all() as unknown as Array<{ name: string }>;
  if (columns.length === 0) return;
  const present = new Set(columns.map((one) => one.name));
  if (!present.has('last_test_at')) {
    db.exec('ALTER TABLE mcp_remote_connectors ADD COLUMN last_test_at TEXT');
  }
  if (!present.has('last_test_status')) {
    db.exec(
      "ALTER TABLE mcp_remote_connectors ADD COLUMN last_test_status TEXT CHECK(last_test_status IN ('OK','FAILED'))"
    );
  }
  if (!present.has('last_test_detail')) {
    db.exec('ALTER TABLE mcp_remote_connectors ADD COLUMN last_test_detail TEXT');
  }
}

export class RemoteMcpConnectorStore {
  private cipher: RemoteMcpSecretCipher;
  private schemaReady = false;

  constructor(cipher: RemoteMcpSecretCipher) {
    this.cipher = cipher;
    const db = this.db();
    this.ensureSchemaOnce(db);
    hardenSqlitePermissions();
  }

  private db(): DatabaseSync {
    const db = getSqliteDatabase();
    if (db === null) {
      throw new RemoteMcpStoreError(
        "Backend SQLite indisponible, persistance des connecteurs MCP distants refusée (aucun repli silencieux)",
        'STORAGE_UNAVAILABLE'
      );
    }
    return db;
  }

  private ensureSchemaOnce(db: DatabaseSync): void {
    if (this.schemaReady) return;
    ensureRemoteMcpSchema(db);
    ensureLegacyLastTestColumns(db);
    this.schemaReady = true;
  }

  private connectorRow(tenantId: string, connectorId: string): ConnectorRow | null {
    const db = this.db();
    const row = db
      .prepare('SELECT * FROM mcp_remote_connectors WHERE tenant_id = ? AND connector_id = ?')
      .get(tenantId, connectorId) as ConnectorRow | undefined;
    return row ?? null;
  }

  createConnector(input: RemoteMcpCreateConnectorInput): RemoteMcpConnectorRecord {
    const tenantId = assertIdentifier(input.tenantId, 'tenantId');
    const name = assertConnectorName(input.name);
    const urlPolicy = validateRemoteMcpUrl(input.url);
    if (!urlPolicy.allowed) {
      throw new RemoteMcpStoreError(`URL cible refusée (${urlPolicy.reason})`, 'INVALID_INPUT');
    }
    const url = input.url;
    if (url.length > REMOTE_MCP_URL_MAX_LENGTH) {
      throw new RemoteMcpStoreError('URL trop longue', 'INVALID_INPUT');
    }
    const db = this.db();
    const connectorId = randomUUID();
    const nowIso = new Date().toISOString();
    withRemoteMcpTransaction(db, () => {
      db.prepare(`
        INSERT INTO mcp_remote_connectors
          (tenant_id, connector_id, name, url, transport, enabled,
           secret_key_id, secret_iv, secret_ciphertext, secret_tag, secret_created_at,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, 'url', 0, NULL, NULL, NULL, NULL, NULL, ?, ?)
      `).run(tenantId, connectorId, name, url, nowIso, nowIso);
    });
    const record = this.getConnector(tenantId, connectorId);
    if (record === null) {
      throw new RemoteMcpStoreError('Connecteur introuvable après insertion', 'NOT_FOUND');
    }
    return record;
  }

  getConnector(tenantId: string, connectorId: string): RemoteMcpConnectorRecord | null {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const row = this.connectorRow(tenant, id);
    if (row === null) return null;
    return { ...this.rowToRecord(row), toolPolicies: this.readToolPolicies(tenant, id) };
  }

  listConnectors(tenantId: string): RemoteMcpConnectorRecord[] {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const db = this.db();
    const rows = db
      .prepare(
        'SELECT * FROM mcp_remote_connectors WHERE tenant_id = ? ORDER BY created_at ASC, connector_id ASC'
      )
      .all(tenant) as unknown as ConnectorRow[];
    return rows.map((row) => ({
      ...this.rowToRecord(row),
      toolPolicies: this.readToolPolicies(tenant, row.connector_id)
    }));
  }

  private rowToRecord(row: ConnectorRow): RemoteMcpConnectorRecord {
    return {
      tenantId: row.tenant_id,
      connectorId: row.connector_id,
      name: row.name,
      url: row.url,
      transport: 'url',
      enabled: row.enabled === 1,
      secretMeta: secretMetaFromRow(row),
      toolPolicies: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private readToolPolicies(tenantId: string, connectorId: string): RemoteMcpToolPolicy[] {
    const db = this.db();
    const rows = db
      .prepare(
        `SELECT * FROM mcp_remote_tool_policies
         WHERE tenant_id = ? AND connector_id = ?
         ORDER BY tool_name ASC`
      )
      .all(tenantId, connectorId) as unknown as ToolPolicyRow[];
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      connectorId: row.connector_id,
      toolName: row.tool_name,
      schemaSha256: row.schema_sha256,
      status: row.status === 'APPROVED' ? ('APPROVED' as const) : ('REVOKED' as const),
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      updatedAt: row.updated_at
    }));
  }

  setConnectorUrl(tenantId: string, connectorId: string, url: string): RemoteMcpConnectorRecord {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const policy = validateRemoteMcpUrl(url);
    if (!policy.allowed) {
      throw new RemoteMcpStoreError(`URL cible refusée (${policy.reason})`, 'INVALID_INPUT');
    }
    const db = this.db();
    const nowIso = new Date().toISOString();
    withRemoteMcpTransaction(db, () => {
      const result = db
        .prepare(
          'UPDATE mcp_remote_connectors SET url = ?, updated_at = ? WHERE tenant_id = ? AND connector_id = ?'
        )
        .run(url, nowIso, tenant, id);
      if (Number(result.changes) === 0) {
        throw new RemoteMcpStoreError('Connecteur introuvable dans ce tenant', 'NOT_FOUND');
      }
    });
    const record = this.getConnector(tenant, id);
    if (record === null) {
      throw new RemoteMcpStoreError('Connecteur introuvable après mise à jour', 'NOT_FOUND');
    }
    return record;
  }

  setConnectorEnabled(
    tenantId: string,
    connectorId: string,
    enabled: boolean
  ): RemoteMcpConnectorRecord {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const db = this.db();
    const nowIso = new Date().toISOString();
    withRemoteMcpTransaction(db, () => {
      const result = db
        .prepare(
          'UPDATE mcp_remote_connectors SET enabled = ?, updated_at = ? WHERE tenant_id = ? AND connector_id = ?'
        )
        .run(enabled ? 1 : 0, nowIso, tenant, id);
      if (Number(result.changes) === 0) {
        throw new RemoteMcpStoreError('Connecteur introuvable dans ce tenant', 'NOT_FOUND');
      }
      // C3.4 (§4) — la DÉSACTIVATION est un changement du contexte de
      // sécurité : une opération préparée AVANT la suspension ne doit jamais
      // survivre à une réactivation. Invalidation DANS LA MÊME transaction.
      if (!enabled) invalidatePendingConfirmations(db, tenant, id);
    });
    const record = this.getConnector(tenant, id);
    if (record === null) {
      throw new RemoteMcpStoreError('Connecteur introuvable après mise à jour', 'NOT_FOUND');
    }
    return record;
  }

  /**
   * C3.2-B1 — Renommage atomique (UPDATE unitaire). Sémantique identique à
   * setConnectorUrl, SANS politique SSRF (le nom n'est pas une cible réseau).
   * Le nom est validé par les mêmes règles que createConnector.
   */
  setConnectorName(tenantId: string, connectorId: string, name: string): RemoteMcpConnectorRecord {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const validated = assertConnectorName(name);
    const db = this.db();
    const nowIso = new Date().toISOString();
    withRemoteMcpTransaction(db, () => {
      const result = db
        .prepare('UPDATE mcp_remote_connectors SET name = ?, updated_at = ? WHERE tenant_id = ? AND connector_id = ?')
        .run(validated, nowIso, tenant, id);
      if (Number(result.changes) === 0) {
        throw new RemoteMcpStoreError('Connecteur introuvable dans ce tenant', 'NOT_FOUND');
      }
    });
    const record = this.getConnector(tenant, id);
    if (record === null) {
      throw new RemoteMcpStoreError('Connecteur introuvable après mise à jour', 'NOT_FOUND');
    }
    return record;
  }

  /**
   * C3.2-B1 (décision D3 confirmée) — Changement d'URL avec révocation
   * ATOMIQUE de toutes les politiques du connecteur, dans UNE transaction
   * BEGIN IMMEDIATE / COMMIT / ROLLBACK unique.
   *
   * Justification : une nouvelle URL peut être servie par un serveur offrant
   * d'autres outils sous des noms identiques — les approbations liées au couple
   * (outil, schemaSha256) ne doivent JAMAIS survivre à une ré-attribution de
   * cible. L'échec de toute étape déclenche ROLLBACK : l'URL et les politiques
   * restent exactement dans leur état d'origine.
   *
   * C3.2-B3 (GO §3, audit A-01) — les confirmations anti-rejeu du connecteur
   * sont INVALIDÉES DANS CETTE MÊME TRANSACTION (aucune seconde transaction) :
   * marquées consommées (ligne conservée pour l'inspection, refus REPLAY
   * garanti par consume()), compteur retourné à la couche routes/audit.
   * Rollback intégral si une étape échoue.
   *
   * Retourne l'enregistrement final, la liste triée des noms d'outils révoqués
   * (non secret, destinée à la réponse/journal de la couche routes) et le
   * nombre de confirmations invalidées (non secret, idem).
   */
  setConnectorUrlRevokingPolicies(
    tenantId: string,
    connectorId: string,
    url: string
  ): { record: RemoteMcpConnectorRecord; revokedToolNames: readonly string[]; invalidatedConfirmations: number } {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const policy = validateRemoteMcpUrl(url);
    if (!policy.allowed) {
      throw new RemoteMcpStoreError(`URL cible refusée (${policy.reason})`, 'INVALID_INPUT');
    }
    if (url.length > REMOTE_MCP_URL_MAX_LENGTH) {
      throw new RemoteMcpStoreError('URL trop longue', 'INVALID_INPUT');
    }
    const db = this.db();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    return withRemoteMcpTransaction(db, () => {
      const update = db
        .prepare('UPDATE mcp_remote_connectors SET url = ?, updated_at = ? WHERE tenant_id = ? AND connector_id = ?')
        .run(url, nowIso, tenant, id);
      if (Number(update.changes) === 0) {
        throw new RemoteMcpStoreError('Connecteur introuvable dans ce tenant', 'NOT_FOUND');
      }
      const approvedRows = db
        .prepare(
          `SELECT tool_name FROM mcp_remote_tool_policies
           WHERE tenant_id = ? AND connector_id = ? AND status = 'APPROVED'
           ORDER BY tool_name ASC`
        )
        .all(tenant, id) as unknown as Array<{ tool_name: string }>;
      db
        .prepare(
          `UPDATE mcp_remote_tool_policies SET status = 'REVOKED', updated_at = ?
           WHERE tenant_id = ? AND connector_id = ? AND status = 'APPROVED'`
        )
        .run(nowIso, tenant, id);
      // B3 — invalidation des confirmations (MÊME transaction, pas de second
      // BEGIN) : marquées consommées → consume() refusera systématiquement.
      const invalidateResult = db
        .prepare(
          `UPDATE mcp_remote_confirmations
           SET consumed_at = ?
           WHERE tenant_id = ? AND connector_id = ? AND consumed_at IS NULL`
        )
        .run(nowMs, tenant, id);
      const invalidatedConfirmations = Number(invalidateResult.changes);
      const row = db
        .prepare('SELECT * FROM mcp_remote_connectors WHERE tenant_id = ? AND connector_id = ?')
        .get(tenant, id) as unknown as ConnectorRow;
      return {
        record: { ...this.rowToRecord(row), toolPolicies: this.readToolPolicies(tenant, id) },
        revokedToolNames: approvedRows.map((one) => one.tool_name),
        invalidatedConfirmations
      };
    });
  }

  deleteConnector(tenantId: string, connectorId: string): boolean {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const db = this.db();
    return withRemoteMcpTransaction(db, () => {
      const result = db
        .prepare('DELETE FROM mcp_remote_connectors WHERE tenant_id = ? AND connector_id = ?')
        .run(tenant, id);
      const removed = Number(result.changes) > 0;
      if (removed) {
        db.prepare('DELETE FROM mcp_remote_tool_policies WHERE tenant_id = ? AND connector_id = ?')
          .run(tenant, id);
        db.prepare('DELETE FROM mcp_remote_confirmations WHERE tenant_id = ? AND connector_id = ?')
          .run(tenant, id);
      }
      return removed;
    });
  }

  /**
   * MCP-C3.1-CONFIG-STORE — Persistance NON SECRÈTE du résultat du dernier test
   * de connexion. Le store se borne à enregistrer/relire : aucun test réseau
   * n'est implémenté ici (C3.3 produira ces informations). Détail borné et
   * sans caractères de contrôle. Couplage tenant strict : une écriture par un
   * autre tenant lève NOT_FOUND (indétectable, même convention que le CRUD).
   */
  recordLastTest(
    tenantId: string,
    connectorId: string,
    input: { status: RemoteMcpLastTestStatus; detail?: string | null }
  ): RemoteMcpLastTest {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    if (input.status !== 'OK' && input.status !== 'FAILED') {
      throw new RemoteMcpStoreError(
        "statut du dernier test invalide ('OK' ou 'FAILED' attendu)",
        'INVALID_INPUT'
      );
    }
    const status: RemoteMcpLastTestStatus = input.status;
    const detail = sanitizeLastTestDetail(input.detail ?? null);
    const db = this.db();
    const at = new Date().toISOString();
    withRemoteMcpTransaction(db, () => {
      const result = db
        .prepare(
          `UPDATE mcp_remote_connectors
           SET last_test_at = ?, last_test_status = ?, last_test_detail = ?, updated_at = ?
           WHERE tenant_id = ? AND connector_id = ?`
        )
        .run(at, status, detail, at, tenant, id);
      if (Number(result.changes) === 0) {
        throw new RemoteMcpStoreError('Connecteur introuvable dans ce tenant', 'NOT_FOUND');
      }
    });
    return { at, status, detail };
  }

  /**
   * MCP-C3.1-CONFIG-STORE — Relecture du dernier test enregistré. null si
   * aucune information (jamais testé) ou si le connecteur n'existe pas dans ce
   * tenant (indétectable, même convention que getConnector).
   */
  getLastTest(tenantId: string, connectorId: string): RemoteMcpLastTest | null {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const row = this.connectorRow(tenant, id);
    if (row === null || row.last_test_at === null) return null;
    const status = row.last_test_status;
    if (status !== 'OK' && status !== 'FAILED') return null;
    return { at: row.last_test_at, status, detail: row.last_test_detail };
  }

  setConnectorSecret(tenantId: string, connectorId: string, plaintext: string): RemoteMcpSecretMeta {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new RemoteMcpStoreError('Secret vide ou non textuel', 'INVALID_INPUT');
    }
    const db = this.db();
    const nowIso = new Date().toISOString();
    withRemoteMcpTransaction(db, () => {
      const row = this.connectorRow(tenant, id);
      if (row === null) {
        throw new RemoteMcpStoreError('Connecteur introuvable dans ce tenant', 'NOT_FOUND');
      }
      const envelope = this.cipher.encrypt({ tenantId: tenant, connectorId: id }, plaintext);
      db.prepare(
        `UPDATE mcp_remote_connectors
         SET secret_key_id = ?, secret_iv = ?, secret_ciphertext = ?, secret_tag = ?,
             secret_created_at = ?, updated_at = ?
         WHERE tenant_id = ? AND connector_id = ?`
      ).run(
        envelope.keyId,
        envelope.iv,
        envelope.ciphertext,
        envelope.authTag,
        nowIso,
        nowIso,
        tenant,
        id
      );
      // C3.4 (§4) — le REMPLACEMENT du secret peut changer le compte
      // service cible (comme un changement d'URL) : les opérations préparées
      // AVANT sont invalidées (insertion dans la transaction).
      invalidatePendingConfirmations(db, tenant, id);
    });
    const row = this.connectorRow(tenant, id);
    if (row === null) {
      throw new RemoteMcpStoreError('Connecteur introuvable après écriture du secret', 'NOT_FOUND');
    }
    const meta = secretMetaFromRow(row);
    if (meta === null) {
      throw new RemoteMcpStoreError('Secret absent après écriture', 'NOT_FOUND');
    }
    return meta;
  }

  /** Retourne le plaintext UNIQUEMENT pour l'appel réseau C3.2 côté serveur. */
  revealConnectorSecret(tenantId: string, connectorId: string): string | null {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const row = this.connectorRow(tenant, id);
    if (
      row === null ||
      row.secret_key_id === null ||
      row.secret_iv === null ||
      row.secret_ciphertext === null ||
      row.secret_tag === null
    ) {
      return null;
    }
    return this.cipher.decrypt(
      {
        keyId: row.secret_key_id,
        iv: row.secret_iv,
        ciphertext: row.secret_ciphertext,
        authTag: row.secret_tag
      },
      { tenantId: tenant, connectorId: id }
    );
  }

  removeConnectorSecret(tenantId: string, connectorId: string): boolean {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const db = this.db();
    return withRemoteMcpTransaction(db, () => {
      const result = db
        .prepare(
          `UPDATE mcp_remote_connectors
           SET secret_key_id = NULL, secret_iv = NULL, secret_ciphertext = NULL,
               secret_tag = NULL, secret_created_at = NULL, updated_at = ?
           WHERE tenant_id = ? AND connector_id = ? AND secret_key_id IS NOT NULL`
        )
        .run(new Date().toISOString(), tenant, id);
      const removed = Number(result.changes) > 0;
      // C3.4 (§4) — le retrait du secret est un changement de contexte :
      // invalidation des confirmations PENDING du connecteur.
      if (removed) invalidatePendingConfirmations(db, tenant, id);
      return removed;
    });
  }

  /**
   * Rotation : re-chiffre chaque secret vers la clé active du cipher fourni
   * (qui doit connaître la clé précédente pour déchiffrer l'existant). Le
   * cipher du store n'est remplacé qu'après un COMMIT complet. Plaintext
   * jamais en base ni journalisé.
   */
  rotateSecretKeys(nextCipher: RemoteMcpSecretCipher): void {
    const db = this.db();
    withRemoteMcpTransaction(db, () => {
      const rows = db
        .prepare(
          `SELECT tenant_id, connector_id, secret_key_id, secret_iv, secret_ciphertext, secret_tag
           FROM mcp_remote_connectors WHERE secret_key_id IS NOT NULL`
        )
        .all() as unknown as Array<{
        tenant_id: string;
        connector_id: string;
        secret_key_id: string;
        secret_iv: string;
        secret_ciphertext: string;
        secret_tag: string;
      }>;
      for (const row of rows) {
        const plaintext = this.cipher.decrypt(
          {
            keyId: row.secret_key_id,
            iv: row.secret_iv,
            ciphertext: row.secret_ciphertext,
            authTag: row.secret_tag
          },
          { tenantId: row.tenant_id, connectorId: row.connector_id }
        );
        const next = nextCipher.encrypt(
          { tenantId: row.tenant_id, connectorId: row.connector_id },
          plaintext
        );
        db.prepare(
          `UPDATE mcp_remote_connectors
           SET secret_key_id = ?, secret_iv = ?, secret_ciphertext = ?, secret_tag = ?,
               secret_created_at = ?, updated_at = ?
           WHERE tenant_id = ? AND connector_id = ?`
        ).run(
          next.keyId,
          next.iv,
          next.ciphertext,
          next.authTag,
          new Date().toISOString(),
          new Date().toISOString(),
          row.tenant_id,
          row.connector_id
        );
      }
    });
    this.cipher = nextCipher;
  }

  /**
   * Approbation explicite d'un outil pour un hash de schéma précis. Tout
   * changement de schéma NÉCESSITE un nouvel appel (pas de réemploi auto) :
   * getToolApproval() ne matche que le hash stocké.
   */
  approveTool(input: RemoteMcpApproveToolInput): RemoteMcpToolPolicy {
    const tenant = assertIdentifier(input.tenantId, 'tenantId');
    const connectorId = assertIdentifier(input.connectorId, 'connectorId');
    const toolName = assertToolName(input.toolName);
    if (!SHA256_PATTERN.test(input.schemaSha256)) {
      throw new RemoteMcpStoreError(
        "schemaSha256 invalide (SHA-256 hexadécimal minuscule de 64 caractères attendu)",
        'INVALID_INPUT'
      );
    }
    if (typeof input.approvedBy !== 'string' || input.approvedBy.length === 0 || input.approvedBy.length > 128) {
      throw new RemoteMcpStoreError('approvedBy invalide', 'INVALID_INPUT');
    }
    const db = this.db();
    const nowIso = new Date().toISOString();
    return withRemoteMcpTransaction(db, () => {
      const existing = this.connectorRow(tenant, connectorId);
      if (existing === null) {
        throw new RemoteMcpStoreError('Connecteur introuvable dans ce tenant', 'NOT_FOUND');
      }
      db.prepare(
        `INSERT INTO mcp_remote_tool_policies
           (tenant_id, connector_id, tool_name, schema_sha256, status, approved_by, approved_at, updated_at)
         VALUES (?, ?, ?, ?, 'APPROVED', ?, ?, ?)
         ON CONFLICT(tenant_id, connector_id, tool_name) DO UPDATE SET
           schema_sha256 = excluded.schema_sha256,
           status = 'APPROVED',
           approved_by = excluded.approved_by,
           approved_at = excluded.approved_at,
           updated_at = excluded.updated_at`
      ).run(
        tenant,
        connectorId,
        toolName,
        input.schemaSha256,
        input.approvedBy,
        nowIso,
        nowIso
      );
      const row = db
        .prepare(
          `SELECT * FROM mcp_remote_tool_policies
           WHERE tenant_id = ? AND connector_id = ? AND tool_name = ?`
        )
        .get(tenant, connectorId, toolName) as unknown as ToolPolicyRow;
      return {
        tenantId: row.tenant_id,
        connectorId: row.connector_id,
        toolName: row.tool_name,
        schemaSha256: row.schema_sha256,
        status: row.status === 'APPROVED' ? ('APPROVED' as const) : ('REVOKED' as const),
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        updatedAt: row.updated_at
      };
    });
  }

  getToolApproval(
    tenantId: string,
    connectorId: string,
    toolName: string,
    schemaSha256: RemoteMcpSha256Hex
  ): RemoteMcpToolPolicy | null {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const tool = assertToolName(toolName);
    if (!SHA256_PATTERN.test(schemaSha256)) {
      throw new RemoteMcpStoreError('schemaSha256 invalide', 'INVALID_INPUT');
    }
    const db = this.db();
    const row = db
      .prepare(
        `SELECT * FROM mcp_remote_tool_policies
         WHERE tenant_id = ? AND connector_id = ? AND tool_name = ?
           AND status = 'APPROVED' AND schema_sha256 = ?`
      )
      .get(tenant, id, tool, schemaSha256) as unknown as ToolPolicyRow | undefined;
    if (row === undefined) return null;
    return {
      tenantId: row.tenant_id,
      connectorId: row.connector_id,
      toolName: row.tool_name,
      schemaSha256: row.schema_sha256,
      status: 'APPROVED',
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      updatedAt: row.updated_at
    };
  }

  listToolPolicies(tenantId: string, connectorId: string): RemoteMcpToolPolicy[] {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    return this.readToolPolicies(tenant, id);
  }

  revokeTool(tenantId: string, connectorId: string, toolName: string): boolean {
    const tenant = assertIdentifier(tenantId, 'tenantId');
    const id = assertIdentifier(connectorId, 'connectorId');
    const tool = assertToolName(toolName);
    const db = this.db();
    return withRemoteMcpTransaction(db, () => {
      const result = db
        .prepare(
          `UPDATE mcp_remote_tool_policies SET status = 'REVOKED', updated_at = ?
           WHERE tenant_id = ? AND connector_id = ? AND tool_name = ?`
        )
        .run(new Date().toISOString(), tenant, id, tool);
      const changed = Number(result.changes) > 0;
      // C3.4 (§4) — la révocation est un changement du contexte de sécurité :
      // les confirmations PENDING liées à ce couple (connecteur, outil) sont
      // invalidées dans la MÊME transaction (une ré-approbation ultérieure ne
      // ressuscite pas une opération préparée avant la révocation).
      if (changed) invalidatePendingConfirmations(db, tenant, id, tool);
      return changed;
    });
  }

  /** Cipher actif porté par ce store (utile aux tests et à la rotation d'appels). */
  activeCipher(): RemoteMcpSecretCipher {
    return this.cipher;
  }
}

function assertToolName(value: unknown): string {
  if (typeof value !== 'string' || !TOOL_NAME_PATTERN.test(value)) {
    throw new RemoteMcpStoreError(
      'toolName invalide (1 à 128 caractères alphanumériques/._-)',
      'INVALID_INPUT'
    );
  }
  return value;
}
