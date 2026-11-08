/**
 * LOT UI-MCP â€” Catalogue MCP GLOBAL (source de vÃ©ritÃ© unique cÃ´tÃ© serveur).
 *
 * PÃ©rimÃ¨tre :
 *   - table dÃ©diÃ©e `mcp_catalog` (jamais dans `documents`, jamais dans
 *     `mcp_remote_connectors`) : une ENTRÃ‰E de catalogue n'est pas un
 *     connecteur ; l'activation utilisateur matÃ©rialise une instance
 *     scope 'catalog' dans mcp_remote_connectors (store connecteurs) et
 *     reste strictement tenant-isolÃ©e ;
 *   - le catalogue est GLOBAL (pas de colonne tenant_id) : il dÃ©crit des
 *     serveurs publiÃ©s destinÃ©s Ã  tous les tenants ; seules les instances
 *     d'activation et les imports personnels portent le tenant.
 *
 * Gouvernance (transitions CONTRÃ”LÃ‰ES PAR LE SERVEUR, aucune voie client) :
 *   BROUILLON â†’ VALIDATION â†’ PUBLIE â‡„ DESACTIVE
 *   VALIDATION â†’ BROUILLON (retour), DESACTIVE â†’ BROUILLON (retour)
 *   Toute autre paire â†’ INVALID_TRANSITION (409). La crÃ©ation force
 *   BROUILLON : aucune entrÃ©e ne naÃ®t publiÃ©e.
 *
 * URLs : validateRemoteMcpUrl (politique SSRF C3.3) appliquÃ©e Ã  la crÃ©ation
 * ET Ã  toute mise Ã  jour â€” la couche client rÃ©-applique les 3 Ã©tapes Ã  chaque
 * test/appel (le store ne finance jamais de bypass).
 *
 * SantÃ© : last_test_* Ã©crits UNIQUEMENT par le routeur admin (test SSRF du
 * serveur), jamais par le client. DÃ©tail = code transport seul (aucun corps
 * distant, aucun secret).
 *
 * DÃ©pendances : DELETE refusÃ© (DEPENDENCY_EXISTS â†’ 409) tant qu'une instance
 * d'activation (mcp_remote_connectors.catalog_id) rÃ©fÃ©rence l'entrÃ©e.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getSqliteDatabase } from '../../persistence/sqlite-backend.js';
import { hardenSqlitePermissions } from '../remote/store.js';
import { validateRemoteMcpUrl, REMOTE_MCP_URL_MAX_LENGTH } from '../remote/url-policy.js';

export type McpCatalogStatus = 'BROUILLON' | 'VALIDATION' | 'PUBLIE' | 'DESACTIVE';
export type McpCatalogVisibility = 'prive' | 'public';
export type McpCatalogLastTestStatus = 'OK' | 'FAILED';

export interface McpCatalogLastTest {
  readonly at: string;
  readonly status: McpCatalogLastTestStatus;
  readonly detail: string | null;
}

export interface McpCatalogRecord {
  readonly catalogId: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly category: string;
  readonly transport: 'url';
  readonly url: string;
  readonly status: McpCatalogStatus;
  readonly visibility: McpCatalogVisibility;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastTest: McpCatalogLastTest | null;
}

export type McpCatalogStoreErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'DEPENDENCY_EXISTS';

export class McpCatalogStoreError extends Error {
  readonly code: McpCatalogStoreErrorCode;

  constructor(message: string, code: McpCatalogStoreErrorCode) {
    super(message);
    this.name = 'McpCatalogStoreError';
    this.code = code;
  }
}

/** Transitions lÃ©gales (matrice EXCLUSIVE cÃ´tÃ© serveur â€” source de vÃ©ritÃ©). */
const ALLOWED_TRANSITIONS: Readonly<Record<McpCatalogStatus, readonly McpCatalogStatus[]>> = {
  BROUILLON: ['VALIDATION'],
  VALIDATION: ['PUBLIE', 'BROUILLON'],
  PUBLIE: ['DESACTIVE'],
  DESACTIVE: ['PUBLIE', 'BROUILLON']
};

const STATUS_VALUES: readonly McpCatalogStatus[] = ['BROUILLON', 'VALIDATION', 'PUBLIE', 'DESACTIVE'];
const VISIBILITY_VALUES: readonly McpCatalogVisibility[] = ['prive', 'public'];

const NAME_MAX = 64;
const DESCRIPTION_MAX = 500;
const ICON_MAX = 8;
const CATEGORY_MAX = 32;
const ID_SOURCE = '[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}';
const ID_PATTERN = new RegExp(`^${ID_SOURCE}$`);

/** CatÃ©gorie normalisÃ©e : minuscules, espaces â†’ '-', borne stricte. */
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Dernier test : borne stricte en unitÃ©s de code (anti-inflation). */
const TEST_DETAIL_MAX = 512;

/** true si la chaÃ®ne contient un caractÃ¨re de contrÃ´le (U+0000-U+001F, U+007F). */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Remplace tout caractÃ¨re de contrÃ´le par une espace, compacte, borne Ã  512. */
function sanitizeTestDetail(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    out += code <= 0x1f || code === 0x7f ? ' ' : value.charAt(i);
  }
  const cleaned = out.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  const units = Array.from(cleaned);
  return units.length > TEST_DETAIL_MAX ? units.slice(0, TEST_DETAIL_MAX).join('') : cleaned;
}

interface CatalogRow {
  catalog_id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  transport: string;
  url: string;
  status: string;
  visibility: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_detail: string | null;
}

export function ensureMcpCatalogSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_catalog (
      catalog_id TEXT NOT NULL CHECK(length(catalog_id) <= 64),
      name TEXT NOT NULL CHECK(length(name) <= ${NAME_MAX}),
      description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= ${DESCRIPTION_MAX}),
      icon TEXT NOT NULL DEFAULT '' CHECK(length(icon) <= ${ICON_MAX}),
      category TEXT NOT NULL DEFAULT 'divers' CHECK(length(category) <= ${CATEGORY_MAX}),
      transport TEXT NOT NULL DEFAULT 'url' CHECK(transport = 'url'),
      url TEXT NOT NULL CHECK(length(url) <= ${REMOTE_MCP_URL_MAX_LENGTH}),
      status TEXT NOT NULL DEFAULT 'BROUILLON' CHECK(status IN ('BROUILLON','VALIDATION','PUBLIE','DESACTIVE')),
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('prive','public')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      created_by TEXT NOT NULL CHECK(length(created_by) <= 128),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_test_at TEXT,
      last_test_status TEXT CHECK(last_test_status IN ('OK','FAILED')),
      last_test_detail TEXT,
      PRIMARY KEY (catalog_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_catalog_status ON mcp_catalog (status, visibility);
    CREATE INDEX IF NOT EXISTS idx_mcp_catalog_category ON mcp_catalog (category);
  `);
}

function assertIdentifier(value: string, field: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new McpCatalogStoreError(`${field} invalide`, 'INVALID_INPUT');
  }
  return value;
}

function assertBoundedText(value: unknown, field: string, max: number, allowEmpty: boolean): string {
  if (typeof value !== 'string') {
    throw new McpCatalogStoreError(`${field} invalide (texte requis)`, 'INVALID_INPUT');
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new McpCatalogStoreError(`${field} vide`, 'INVALID_INPUT');
  }
  if (trimmed.length > max) {
    throw new McpCatalogStoreError(`${field} trop long (max ${max})`, 'INVALID_INPUT');
  }
  // Aucun caractÃ¨re de contrÃ´le (anti-injection d'affichage/journal).
  if (hasControlChars(trimmed)) {
    throw new McpCatalogStoreError(`${field} contient des caractÃ¨res de contrÃ´le`, 'INVALID_INPUT');
  }
  return trimmed;
}

function assertCategory(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  // Normalisation des accents (NFD + suppression des combinantes) : les
  // catÃ©gories saisies en franÃ§ais (Â« productivitÃ© Â») sont acceptÃ©es et
  // stockÃ©es en ASCII (Â« productivite Â») â€” filtres et recherche identiques
  // des deux cÃ´tÃ©s.
  const unaccented = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const normalized = unaccented.replace(/\s+/g, '-');
  if (!CATEGORY_PATTERN.test(normalized)) {
    throw new McpCatalogStoreError(
      'category invalide (a-z, 0-9, tirets, 2-32 caractÃ¨res)',
      'INVALID_INPUT'
    );
  }
  return normalized;
}

function assertStatus(value: unknown): McpCatalogStatus {
  if (typeof value !== 'string' || !STATUS_VALUES.includes(value as McpCatalogStatus)) {
    throw new McpCatalogStoreError('statut invalide', 'INVALID_INPUT');
  }
  return value as McpCatalogStatus;
}

function assertVisibility(value: unknown): McpCatalogVisibility {
  if (typeof value !== 'string' || !VISIBILITY_VALUES.includes(value as McpCatalogVisibility)) {
    throw new McpCatalogStoreError('visibilitÃ© invalide (prive | public)', 'INVALID_INPUT');
  }
  return value as McpCatalogVisibility;
}

function assertUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new McpCatalogStoreError('url invalide', 'INVALID_INPUT');
  }
  if (value.length > REMOTE_MCP_URL_MAX_LENGTH) {
    throw new McpCatalogStoreError('url trop longue', 'INVALID_INPUT');
  }
  const policy = validateRemoteMcpUrl(value);
  if (!policy.allowed) {
    throw new McpCatalogStoreError(`URL cible refusÃ©e (${policy.reason})`, 'INVALID_INPUT');
  }
  return value;
}

function rowToRecord(row: CatalogRow): McpCatalogRecord {
  const lastTest: McpCatalogLastTest | null =
    row.last_test_at !== null && row.last_test_status !== null
      ? {
          at: row.last_test_at,
          status: row.last_test_status === 'OK' ? 'OK' : 'FAILED',
          detail: row.last_test_detail
        }
      : null;
  return {
    catalogId: row.catalog_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    category: row.category,
    transport: 'url',
    url: row.url,
    status: row.status as McpCatalogStatus,
    visibility: row.visibility as McpCatalogVisibility,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTest
  };
}

export interface McpCatalogCreateInput {
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly category?: string;
  readonly url: string;
  readonly visibility?: string;
  readonly createdBy: string;
}

export interface McpCatalogUpdateInput {
  readonly name?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly category?: string;
  readonly url?: string;
  readonly visibility?: string;
}

export interface McpCatalogListFilter {
  readonly status?: string;
  readonly category?: string;
  readonly search?: string;
}

function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* la transaction est dÃ©jÃ  rompue â€” l'erreur d'origine prime */
    }
    throw error;
  }
}

export class McpCatalogStore {
  private schemaReady = false;

  constructor() {
    const db = this.db();
    if (!this.schemaReady) {
      ensureMcpCatalogSchema(db);
      this.schemaReady = true;
    }
    hardenSqlitePermissions();
  }

  private db(): DatabaseSync {
    const db = getSqliteDatabase();
    if (db === null) {
      throw new McpCatalogStoreError(
        'Backend SQLite indisponible, persistance du catalogue MCP refusÃ©e (aucun repli silencieux)',
        'STORAGE_UNAVAILABLE'
      );
    }
    return db;
  }

  createEntry(input: McpCatalogCreateInput): McpCatalogRecord {
    const name = assertBoundedText(input.name, 'name', NAME_MAX, false);
    const description =
      input.description !== undefined
        ? assertBoundedText(input.description, 'description', DESCRIPTION_MAX, true)
        : '';
    const icon = input.icon !== undefined ? assertBoundedText(input.icon, 'icon', ICON_MAX, true) : '';
    const category = input.category !== undefined ? assertCategory(input.category) : 'divers';
    const url = assertUrl(input.url);
    const visibility = input.visibility !== undefined ? assertVisibility(input.visibility) : 'public';
    if (typeof input.createdBy !== 'string' || input.createdBy.length === 0 || input.createdBy.length > 128) {
      throw new McpCatalogStoreError('createdBy invalide', 'INVALID_INPUT');
    }
    const createdBy = input.createdBy;

    const db = this.db();
    const catalogId = randomUUID();
    const nowIso = new Date().toISOString();
    withTransaction(db, () => {
      db.prepare(`
        INSERT INTO mcp_catalog
          (catalog_id, name, description, icon, category, transport, url,
           status, visibility, version, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'url', ?, 'BROUILLON', ?, 1, ?, ?, ?)
      `).run(catalogId, name, description, icon, category, url, visibility, createdBy, nowIso, nowIso);
    });
    const record = this.getEntry(catalogId);
    if (record === null) {
      throw new McpCatalogStoreError('EntrÃ©e introuvable aprÃ¨s insertion', 'NOT_FOUND');
    }
    return record;
  }

  getEntry(catalogId: string): McpCatalogRecord | null {
    const id = assertIdentifier(catalogId, 'catalogId');
    const db = this.db();
    const row = db
      .prepare('SELECT * FROM mcp_catalog WHERE catalog_id = ?')
      .get(id) as CatalogRow | undefined;
    return row === undefined ? null : rowToRecord(row);
  }

  /** Liste ADMIN : tous statuts, filtres serveur (statut/catÃ©gorie/recherche). */
  listEntries(filter?: McpCatalogListFilter): McpCatalogRecord[] {
    const db = this.db();
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter?.status !== undefined && filter.status !== '') {
      clauses.push('status = ?');
      params.push(assertStatus(filter.status));
    }
    if (filter?.category !== undefined && filter.category !== '') {
      clauses.push('category = ?');
      params.push(assertCategory(filter.category));
    }
    if (filter?.search !== undefined && filter.search.trim() !== '') {
      const needle = `%${filter.search.trim().toLowerCase()}%`;
      clauses.push('(lower(name) LIKE ? OR lower(description) LIKE ?)');
      params.push(needle, needle);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM mcp_catalog ${where} ORDER BY updated_at DESC, catalog_id ASC`)
      .all(...params) as unknown as CatalogRow[];
    return rows.map(rowToRecord);
  }

  /** Liste UTILISATEUR : uniquement PUBLIE + public (aucun brouillon visible). */
  listPublishedEntries(): McpCatalogRecord[] {
    const db = this.db();
    const rows = db
      .prepare(
        `SELECT * FROM mcp_catalog
         WHERE status = 'PUBLIE' AND visibility = 'public'
         ORDER BY name COLLATE NOCASE ASC, catalog_id ASC`
      )
      .all() as unknown as CatalogRow[];
    return rows.map(rowToRecord);
  }

  updateEntry(catalogId: string, fields: McpCatalogUpdateInput): McpCatalogRecord {
    const id = assertIdentifier(catalogId, 'catalogId');
    const existing = this.getEntry(id);
    if (existing === null) {
      throw new McpCatalogStoreError('EntrÃ©e de catalogue introuvable', 'NOT_FOUND');
    }

    const nextName = fields.name !== undefined ? assertBoundedText(fields.name, 'name', NAME_MAX, false) : existing.name;
    const nextDescription =
      fields.description !== undefined
        ? assertBoundedText(fields.description, 'description', DESCRIPTION_MAX, true)
        : existing.description;
    const nextIcon =
      fields.icon !== undefined ? assertBoundedText(fields.icon, 'icon', ICON_MAX, true) : existing.icon;
    const nextCategory = fields.category !== undefined ? assertCategory(fields.category) : existing.category;
    const nextUrl = fields.url !== undefined ? assertUrl(fields.url) : existing.url;
    const nextVisibility =
      fields.visibility !== undefined ? assertVisibility(fields.visibility) : existing.visibility;

    const db = this.db();
    const nowIso = new Date().toISOString();
    withTransaction(db, () => {
      const result = db
        .prepare(
          `UPDATE mcp_catalog
           SET name = ?, description = ?, icon = ?, category = ?, url = ?,
               visibility = ?, version = version + 1, updated_at = ?
           WHERE catalog_id = ?`
        )
        .run(nextName, nextDescription, nextIcon, nextCategory, nextUrl, nextVisibility, nowIso, id);
      if (Number(result.changes) === 0) {
        throw new McpCatalogStoreError('EntrÃ©e de catalogue introuvable', 'NOT_FOUND');
      }
    });
    const record = this.getEntry(id);
    if (record === null) {
      throw new McpCatalogStoreError('EntrÃ©e introuvable aprÃ¨s mise Ã  jour', 'NOT_FOUND');
    }
    return record;
  }

  /**
   * Transition de statut â€” la matrice est exclusive cÃ´tÃ© serveur : le client
   * propose une cible, jamais un Ã©tat. Toute paire hors matrice â†’ 409.
   */
  transition(catalogId: string, target: unknown): McpCatalogRecord {
    const id = assertIdentifier(catalogId, 'catalogId');
    const targetStatus = assertStatus(target);
    const existing = this.getEntry(id);
    if (existing === null) {
      throw new McpCatalogStoreError('EntrÃ©e de catalogue introuvable', 'NOT_FOUND');
    }
    const allowed = ALLOWED_TRANSITIONS[existing.status];
    if (!allowed.includes(targetStatus)) {
      throw new McpCatalogStoreError(
        `Transition interdite : ${existing.status} â†’ ${targetStatus}`,
        'INVALID_TRANSITION'
      );
    }
    const db = this.db();
    const nowIso = new Date().toISOString();
    withTransaction(db, () => {
      // Garde-fou SQL : si le statut a changÃ© entre lecture et Ã©criture, la
      // condition WHERE Ã©choue â†’ INVALID_TRANSITION (aucune transition sautÃ©e).
      const result = db
        .prepare(
          'UPDATE mcp_catalog SET status = ?, updated_at = ? WHERE catalog_id = ? AND status = ?'
        )
        .run(targetStatus, nowIso, id, existing.status);
      if (Number(result.changes) === 0) {
        throw new McpCatalogStoreError(
          `Transition interdite : ${existing.status} â†’ ${targetStatus}`,
          'INVALID_TRANSITION'
        );
      }
    });
    const record = this.getEntry(id);
    if (record === null) {
      throw new McpCatalogStoreError('EntrÃ©e introuvable aprÃ¨s transition', 'NOT_FOUND');
    }
    return record;
  }

  /**
   * Suppression â€” refus DEPENDENCY_EXISTS (409) tant qu'une instance
   * d'activation rÃ©fÃ©rence l'entrÃ©e (contrÃ´le de dÃ©pendance serveur).
   */
  deleteEntry(catalogId: string): boolean {
    const id = assertIdentifier(catalogId, 'catalogId');
    const db = this.db();
    const activations = db
      .prepare('SELECT COUNT(*) AS n FROM mcp_remote_connectors WHERE catalog_id = ?')
      .get(id) as { n: number } | undefined;
    if ((activations?.n ?? 0) > 0) {
      throw new McpCatalogStoreError(
        "Suppression refusÃ©e : des instances d'activation existent (les utilisateurs doivent retirer leurs instances d'abord)",
        'DEPENDENCY_EXISTS'
      );
    }
    const result = db
      .prepare('DELETE FROM mcp_catalog WHERE catalog_id = ?')
      .run(id);
    return Number(result.changes) > 0;
  }

  /** Ã‰criture du dernier test de santÃ© (routeur admin UNIQUEMENT). */
  recordLastTest(
    catalogId: string,
    result: { status: McpCatalogLastTestStatus; detail: string | null }
  ): void {
    const id = assertIdentifier(catalogId, 'catalogId');
    if (result.status !== 'OK' && result.status !== 'FAILED') {
      throw new McpCatalogStoreError('statut de test invalide', 'INVALID_INPUT');
    }
    const detail = sanitizeTestDetail(result.detail);
    const db = this.db();
    const nowIso = new Date().toISOString();
    const outcome = db
      .prepare(
        'UPDATE mcp_catalog SET last_test_at = ?, last_test_status = ?, last_test_detail = ? WHERE catalog_id = ?'
      )
      .run(nowIso, result.status, detail, id);
    if (Number(outcome.changes) === 0) {
      throw new McpCatalogStoreError('EntrÃ©e de catalogue introuvable', 'NOT_FOUND');
    }
  }

  /** Compteurs par statut (donnÃ©es rÃ©elles, jamais inventÃ©es). */
  countByStatus(): Record<McpCatalogStatus, number> {
    const db = this.db();
    const rows = db
      .prepare('SELECT status, COUNT(*) AS n FROM mcp_catalog GROUP BY status')
      .all() as unknown as Array<{ status: string; n: number }>;
    const counts: Record<McpCatalogStatus, number> = {
      BROUILLON: 0,
      VALIDATION: 0,
      PUBLIE: 0,
      DESACTIVE: 0
    };
    for (const row of rows) {
      if (row.status in counts) {
        counts[row.status as McpCatalogStatus] = row.n;
      }
    }
    return counts;
  }

  /** Compteurs par catÃ©gorie (toutes les entrÃ©es, admin). */
  countByCategory(): Array<{ category: string; count: number }> {
    const db = this.db();
    const rows = db
      .prepare(
        'SELECT category, COUNT(*) AS n FROM mcp_catalog GROUP BY category ORDER BY n DESC, category ASC'
      )
      .all() as unknown as Array<{ category: string; n: number }>;
    return rows.map((row) => ({ category: row.category, count: row.n }));
  }

  /** SantÃ© globale du catalogue (OK / FAILED / jamais testÃ©). */
  healthCounts(): { ok: number; failed: number; neverTested: number } {
    const db = this.db();
    const rows = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN last_test_status = 'OK' THEN 1 ELSE 0 END), 0) AS ok,
           COALESCE(SUM(CASE WHEN last_test_status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed,
           COALESCE(SUM(CASE WHEN last_test_at IS NULL THEN 1 ELSE 0 END), 0) AS never
         FROM mcp_catalog`
      )
      .get() as { ok: number; failed: number; never: number } | undefined;
    return {
      ok: rows?.ok ?? 0,
      failed: rows?.failed ?? 0,
      neverTested: rows?.never ?? 0
    };
  }

  /** Nombre d'instances d'activation d'une entrÃ©e (contrÃ´le de dÃ©pendance). */
  countActivations(catalogId: string): number {
    const id = assertIdentifier(catalogId, 'catalogId');
    const db = this.db();
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM mcp_remote_connectors WHERE catalog_id = ?')
      .get(id) as { n: number } | undefined;
    return row?.n ?? 0;
  }
}
