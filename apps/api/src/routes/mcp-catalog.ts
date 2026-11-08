/**
 * LOT UI-MCP — Routes du CATALOGUE MCP GLOBAL (page Admin) et de la
 * DÉCOUVERTE/ACTIVATION côté utilisateur (page User).
 *
 * Surfaces (AUCUNE n'exécute un outil MCP — l'exécution reste strictement
 * préparée → confirmée → appelée via /api/v1/mcp-remote/connectors/:id/tools/
 * :name/prepare|call, inchangé) :
 *
 *   UTILISATEUR (PROJECT_READ / MCP_REMOTE_INVOKE + JWT) :
 *     GET    /api/v1/mcp/catalog                  — entrées PUBLIE+public
 *     GET    /api/v1/mcp/catalog/:id              — une entrée publiée
 *     POST   /api/v1/mcp/catalog/:id/activation   — activer pour mon compte
 *     DELETE /api/v1/mcp/catalog/:id/activation   — désactiver mon instance
 *
 *   ADMINISTRATEUR (MCP_CATALOG_MANAGE — OWNER/ADMIN, vérifiée SERVEUR) :
 *     GET    /api/v1/mcp/admin/catalog            — tous statuts + filtres
 *     POST   /api/v1/mcp/admin/catalog            — création (toujours BROUILLON)
 *     GET    /api/v1/mcp/admin/catalog/:id        — entrée + nb d'activations
 *     PATCH  /api/v1/mcp/admin/catalog/:id        — champs whitelistés
 *     POST   /api/v1/mcp/admin/catalog/:id/status — transition (matrice serveur)
 *     DELETE /api/v1/mcp/admin/catalog/:id        — 409 si activations existantes
 *     POST   /api/v1/mcp/admin/catalog/:id/test   — test santé SSRF du serveur
 *     GET    /api/v1/mcp/admin/catalog/:id/history— historique administratif
 *     GET    /api/v1/mcp/admin/stats              — chiffres réels du backend
 *
 * Invariants :
 *   - permission admin = MCP_CATALOG_MANAGE (OWNER/ADMIN) sur TOUTE surface
 *     admin, testée sur accès direct aux endpoints (masquer un bouton ne
 *     compte pas) ;
 *   - transitions EXCLUSIVES côté serveur (matrice du store) ;
 *   - activation = matérialisation RÉELLE d'une instance scope 'catalog'
 *     (store connecteurs, SSRF/chiffrement/quotas réutilisés) — jamais un
 *     simple état visuel ;
 *   - imports personnels et instances : tenant + propriétaire (JWT sub) ;
 *   - audit : resourceType MCP_CATALOG, actions administratives en flush
 *     synchrone ; métadonnées blanchies (jamais de secret, jamais d'URL
 *     cible dans l'audit) ;
 *   - quotas : les écritures d'activation passent par enforceMcpQuota
 *     (même limiteur que les connecteurs) ; les écritures admin sont couvertes
 *     par le rate-limit API global de server.ts.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { AppError, NotFoundError, UnauthorizedError, ValidationError } from '../../../../packages/core/src/errors.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { McpCatalogStore, McpCatalogStoreError } from '../../../../packages/core/src/mcp/catalog/store.js';
import type { McpCatalogRecord } from '../../../../packages/core/src/mcp/catalog/store.js';
import { RemoteMcpStoreError } from '../../../../packages/core/src/mcp/remote/store.js';
import type { RemoteMcpConnectorRecord } from '../../../../packages/core/src/mcp/remote/types.js';
import {
  RemoteMcpHttpClient,
  RemoteMcpClientError,
  REMOTE_MCP_DEFAULT_TIMEOUT_MS
} from '../../../../packages/core/src/mcp/remote/client.js';
import type { RemoteMcpClientOptions } from '../../../../packages/core/src/mcp/remote/client.js';
import type { RequestContext } from '../middleware/auth.js';
import {
  clampTimeoutMs,
  enforceMcpQuota,
  getConnectorStore,
  parseJsonObjectBody,
  reply
} from './mcp-remote.js';

const USER_PREFIX = '/api/v1/mcp/catalog';
const ADMIN_PREFIX = '/api/v1/mcp/admin/catalog';
const STATS_PATH = '/api/v1/mcp/admin/stats';
const AUDIT_RESOURCE_TYPE = 'MCP_CATALOG';

const ID_SOURCE = '[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}';
const USER_ENTRY_PATTERN = new RegExp(`^${USER_PREFIX}/(${ID_SOURCE})$`);
const USER_ACTIVATION_PATTERN = new RegExp(`^${USER_PREFIX}/(${ID_SOURCE})/activation$`);
const ADMIN_ENTRY_PATTERN = new RegExp(`^${ADMIN_PREFIX}/(${ID_SOURCE})$`);
const ADMIN_TRANSITION_PATTERN = new RegExp(`^${ADMIN_PREFIX}/(${ID_SOURCE})/status$`);
const ADMIN_TEST_PATTERN = new RegExp(`^${ADMIN_PREFIX}/(${ID_SOURCE})/test$`);
const ADMIN_HISTORY_PATTERN = new RegExp(`^${ADMIN_PREFIX}/(${ID_SOURCE})/history$`);

/** Actions ADMINISTRATIVES visibles dans l'historique et les dernières ops. */
const ADMIN_AUDIT_ACTIONS: ReadonlySet<string> = new Set([
  'MCP_CATALOG_CREATED',
  'MCP_CATALOG_UPDATED',
  'MCP_CATALOG_DELETED',
  'MCP_CATALOG_TRANSITIONED',
  'MCP_CATALOG_TESTED'
]);

/** Champs modifiables par PATCH (rejet mass-assignment FAIL-CLOSED). */
const PATCH_ALLOWED_FIELDS: readonly string[] = [
  'name',
  'description',
  'icon',
  'category',
  'url',
  'visibility'
];

/* ---------------------------------------------------------------------------
 * Runtime (singletons paresseux) + seam d'injection TEST
 * ------------------------------------------------------------------------- */

type CatalogClientFactory = (options: RemoteMcpClientOptions) => RemoteMcpHttpClient;

interface McpCatalogRuntime {
  readonly catalogStore?: (() => McpCatalogStore) | undefined;
  readonly clientFactory?: (CatalogClientFactory | undefined);
}

let runtimeForTests: McpCatalogRuntime | null = null;
let cachedCatalogStore: McpCatalogStore | undefined;

/** Seam de TEST UNIQUEMENT (jamais branché en production). */
export function setMcpCatalogRuntimeForTests(runtime: McpCatalogRuntime | null): void {
  runtimeForTests = runtime;
}

export function getCatalogStore(): McpCatalogStore {
  if (runtimeForTests?.catalogStore !== undefined) {
    return runtimeForTests.catalogStore();
  }
  if (cachedCatalogStore === undefined) {
    cachedCatalogStore = new McpCatalogStore();
  }
  return cachedCatalogStore;
}

function catalogClientFactory(): CatalogClientFactory {
  if (runtimeForTests?.clientFactory !== undefined) {
    return runtimeForTests.clientFactory;
  }
  return (options) => new RemoteMcpHttpClient(options);
}

/* ---------------------------------------------------------------------------
 * Audit (whitelist stricte : jamais de secret, jamais d'URL cible)
 * ------------------------------------------------------------------------- */

function recordCatalogAudit(
  action: string,
  resourceId: string,
  context: RequestContext,
  requestId: string,
  metadata?: Record<string, unknown>
): void {
  auditStore.record({
    tenantId: context.tenantId,
    userId: context.userId || context.role,
    action,
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId,
    status: 'SUCCESS',
    metadata,
    requestId
  });
}

/* ---------------------------------------------------------------------------
 * Erreurs → API (normalisation AppError)
 * ------------------------------------------------------------------------- */

function toCatalogApiError(error: unknown, requestId: string): AppError | null {
  if (error instanceof McpCatalogStoreError) {
    switch (error.code) {
      case 'NOT_FOUND':
        return new NotFoundError('Entrée de catalogue MCP', requestId);
      case 'INVALID_INPUT':
        return new ValidationError(error.message, undefined, requestId);
      case 'INVALID_TRANSITION':
        return new AppError(error.message, 'MCP_CATALOG_INVALID_TRANSITION', 409, undefined, requestId);
      case 'DEPENDENCY_EXISTS':
        return new AppError(error.message, 'MCP_CATALOG_DEPENDENCY', 409, undefined, requestId);
      case 'STORAGE_UNAVAILABLE':
        return new AppError(error.message, 'STORAGE_UNAVAILABLE', 503, undefined, requestId);
    }
  }
  if (error instanceof RemoteMcpStoreError) {
    switch (error.code) {
      case 'NOT_FOUND':
        return new NotFoundError('Connecteur MCP distant', requestId);
      case 'INVALID_INPUT':
        return new ValidationError(error.message, undefined, requestId);
      case 'STORAGE_UNAVAILABLE':
        return new AppError(error.message, 'STORAGE_UNAVAILABLE', 503, undefined, requestId);
    }
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Vues (JAMAIS de secret, JAMAIS de champ interne)
 * ------------------------------------------------------------------------- */

/** Vue admin : entrée complète + compteur réel d'instances d'activation. */
function adminEntryView(entry: McpCatalogRecord, activationCount: number): Record<string, unknown> {
  return {
    catalogId: entry.catalogId,
    name: entry.name,
    description: entry.description,
    icon: entry.icon,
    category: entry.category,
    transport: entry.transport,
    url: entry.url,
    status: entry.status,
    visibility: entry.visibility,
    version: entry.version,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastTest: entry.lastTest,
    activationCount
  };
}

/**
 * Vue utilisateur : bibliothèque de connecteurs (pas de panneau technique).
 * `activated` reflète l'INSTANCE RÉELLE du compte (store), jamais un état
 * visuel : false si aucune instance ou instance désactivée.
 */
function userEntryView(
  entry: McpCatalogRecord,
  instance: RemoteMcpConnectorRecord | null
): Record<string, unknown> {
  const activated = instance !== null && instance.enabled;
  return {
    catalogId: entry.catalogId,
    name: entry.name,
    description: entry.description,
    icon: entry.icon,
    category: entry.category,
    transport: entry.transport,
    url: entry.url,
    version: entry.version,
    updatedAt: entry.updatedAt,
    lastTestStatus: entry.lastTest !== null ? entry.lastTest.status : null,
    activated,
    instanceConnectorId: instance !== null ? instance.connectorId : null
  };
}

/** Vue légère d'une instance d'activation (propriétaire uniquement). */
function instanceView(record: RemoteMcpConnectorRecord): Record<string, unknown> {
  return {
    connectorId: record.connectorId,
    name: record.name,
    url: record.url,
    transport: record.transport,
    enabled: record.enabled,
    scope: record.scope,
    catalogId: record.catalogId,
    secretPresent: record.secretMeta !== null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

/* ---------------------------------------------------------------------------
 * Helpers d'accès
 * ------------------------------------------------------------------------- */

/** Identité JWT obligatoire (propriété des lignes personnel/instance). */
function requireUserId(context: RequestContext, requestId: string, what: string): string {
  if (context.userId === undefined || context.userId === '') {
    throw new UnauthorizedError(`Identité utilisateur requise (JWT) : ${what}`, requestId);
  }
  return context.userId;
}

/** Entrée publiée EVIDENTE pour un utilisateur (brouillon/prive → 404). */
function requirePublishedEntry(catalogId: string, requestId: string): McpCatalogRecord {
  const entry = getCatalogStore().getEntry(catalogId);
  if (entry === null || entry.status !== 'PUBLIE' || entry.visibility !== 'public') {
    // 404 indiscernable : un brouillon n'existe pas pour l'utilisateur.
    throw new NotFoundError('Entrée de catalogue MCP', requestId);
  }
  return entry;
}

/** Instance d'activation du compte pour une entrée (null si absente). */
function findOwnInstance(
  tenantId: string,
  userId: string,
  catalogId: string
): RemoteMcpConnectorRecord | null {
  const connectors = getConnectorStore();
  const mine = connectors.listConnectorsForUser(tenantId, userId);
  return mine.find((one) => one.catalogId === catalogId) ?? null;
}

/* ---------------------------------------------------------------------------
 * Handlers UTILISATEUR
 * ------------------------------------------------------------------------- */

/** GET /api/v1/mcp/catalog — bibliothèque publiée + état d'activation moi. */
async function handleListPublished(res: ServerResponse, context: RequestContext, requestId: string): Promise<void> {
  assertPermission(context.role, 'PROJECT_READ', requestId);
  const catalog = getCatalogStore();
  const entries = catalog.listPublishedEntries();
  const userId = context.userId;
  const instances = new Map<string, RemoteMcpConnectorRecord>();
  if (userId !== undefined && userId !== '') {
    for (const one of getConnectorStore().listConnectorsForUser(context.tenantId, userId)) {
      if (one.catalogId !== null) instances.set(one.catalogId, one);
    }
  }
  // Catégories avec compteurs : dérivées des ENTRÉES publiées réelles.
  const categories = new Map<string, number>();
  for (const entry of entries) {
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1);
  }
  reply(res, 200, {
    entries: entries.map((entry) =>
      userEntryView(entry, instances.get(entry.catalogId) ?? null)
    ),
    categories: [...categories.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    requestId
  });
}

/** GET /api/v1/mcp/catalog/:id — une entrée publiée + mon état d'activation. */
async function handleGetPublished(
  res: ServerResponse,
  catalogId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'PROJECT_READ', requestId);
  const entry = requirePublishedEntry(catalogId, requestId);
  const userId = context.userId;
  const instance =
    userId !== undefined && userId !== ''
      ? findOwnInstance(context.tenantId, userId, catalogId)
      : null;
  reply(res, 200, { entry: userEntryView(entry, instance), requestId });
}

/**
 * POST /api/v1/mcp/catalog/:id/activation — ACTIVATION RÉELLE pour mon
 * compte : instance scope 'catalog' enabled=1 (jamais un toggle visuel).
 * Idempotente : une instance déjà active est renvoyée telle quelle.
 */
async function handleActivate(
  req: IncomingMessage,
  res: ServerResponse,
  catalogId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'MCP_REMOTE_INVOKE', requestId);
  const userId = requireUserId(context, requestId, 'activation d\'une entrée du catalogue');
  const entry = requirePublishedEntry(catalogId, requestId);
  await parseJsonObjectBody(req, requestId); // corps facultatif, jamais de champs de confiance
  enforceMcpQuota('connectors', catalogId, context, requestId);

  const connectors = getConnectorStore();
  const existing = findOwnInstance(context.tenantId, userId, catalogId);
  if (existing !== null) {
    if (!existing.enabled) {
      connectors.setConnectorEnabled(context.tenantId, existing.connectorId, true);
    }
    const current = connectors.getConnector(context.tenantId, existing.connectorId);
    if (current === null) throw new NotFoundError('Activation', requestId);
    reply(res, 200, { activated: true, connector: instanceView(current), requestId });
    return;
  }
  const created = connectors.createConnector({
    tenantId: context.tenantId,
    name: entry.name,
    url: entry.url,
    scope: 'catalog',
    ownerUserId: userId,
    catalogId
  });
  // Activation = enabled=1 réel (l'instance est utilisable par l'exécution
  // gouvernée uniquement, via MCP_REMOTE_INVOKE + confirmation).
  connectors.setConnectorEnabled(context.tenantId, created.connectorId, true);
  const record = connectors.getConnector(context.tenantId, created.connectorId);
  if (record === null) throw new NotFoundError('Activation', requestId);
  recordCatalogAudit('MCP_CATALOG_ACTIVATED', catalogId, context, requestId, {
    connectorId: created.connectorId
  });
  reply(res, 200, { activated: true, connector: instanceView(record), requestId });
}

/**
 * DELETE /api/v1/mcp/catalog/:id/activation — désactivation de MON instance
 * (enabled=0 ; configuration et secret conservés pour une réactivation).
 */
async function handleDeactivate(
  req: IncomingMessage,
  res: ServerResponse,
  catalogId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'MCP_REMOTE_INVOKE', requestId);
  const userId = requireUserId(context, requestId, 'désactivation d\'une entrée du catalogue');
  await parseJsonObjectBody(req, requestId);
  enforceMcpQuota('connectors', catalogId, context, requestId);

  const connectors = getConnectorStore();
  const existing = findOwnInstance(context.tenantId, userId, catalogId);
  if (existing === null || existing.catalogId !== catalogId) {
    // 404 : aucune activation de CETTE entrée pour ce compte.
    throw new NotFoundError('Activation', requestId);
  }
  if (existing.enabled) {
    connectors.setConnectorEnabled(context.tenantId, existing.connectorId, false);
    recordCatalogAudit('MCP_CATALOG_DEACTIVATED', catalogId, context, requestId, {
      connectorId: existing.connectorId
    });
  }
  const current = connectors.getConnector(context.tenantId, existing.connectorId);
  if (current === null) throw new NotFoundError('Activation', requestId);
  reply(res, 200, { deactivated: true, connector: instanceView(current), requestId });
}

/* ---------------------------------------------------------------------------
 * Handlers ADMINISTRATEUR (MCP_CATALOG_MANAGE sur CHAQUE route)
 * ------------------------------------------------------------------------- */

/** GET /admin/catalog — tous statuts + filtres serveur (search/category/status). */
async function handleAdminList(req: IncomingMessage, res: ServerResponse, context: RequestContext, requestId: string): Promise<void> {
  assertPermission(context.role, 'MCP_CATALOG_MANAGE', requestId);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const status = url.searchParams.get('status');
  const category = url.searchParams.get('category');
  const search = url.searchParams.get('q');
  const entries = getCatalogStore().listEntries({
    ...(status !== null && status !== '' ? { status } : {}),
    ...(category !== null && category !== '' ? { category } : {}),
    ...(search !== null && search !== '' ? { search } : {})
  });
  reply(res, 200, {
    entries: entries.map((entry) =>
      adminEntryView(entry, getCatalogStore().countActivations(entry.catalogId))
    ),
    byStatus: getCatalogStore().countByStatus(),
    requestId
  });
}

/** POST /admin/catalog — création FORCÉE en BROUILLON (aucune naissance publiée). */
async function handleAdminCreate(
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'MCP_CATALOG_MANAGE', requestId);
  const body = await parseJsonObjectBody(req, requestId);
  const unknown = Object.keys(body).filter(
    (key) => !['name', 'description', 'icon', 'category', 'url', 'visibility'].includes(key)
  );
  if (unknown.length > 0) {
    throw new ValidationError(`propriétés non autorisées dans le corps : ${unknown.slice(0, 8).join(', ')}`);
  }
  const entry = getCatalogStore().createEntry({
    name: body.name as string,
    ...(body.description !== undefined ? { description: body.description as string } : {}),
    ...(body.icon !== undefined ? { icon: body.icon as string } : {}),
    ...(body.category !== undefined ? { category: body.category as string } : {}),
    url: body.url as string,
    ...(body.visibility !== undefined ? { visibility: body.visibility as string } : {}),
    createdBy: context.userId || context.role
  });
  recordCatalogAudit('MCP_CATALOG_CREATED', entry.catalogId, context, requestId, {
    status: entry.status,
    category: entry.category
  });
  reply(res, 201, { entry: adminEntryView(entry, 0), requestId });
}

/** GET /admin/catalog/:id — entrée quelconque + compteur réel d'activations. */
async function handleAdminGet(
  res: ServerResponse,
  catalogId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'MCP_CATALOG_MANAGE', requestId);
  const entry = getCatalogStore().getEntry(catalogId);
  if (entry === null) throw new NotFoundError('Entrée de catalogue MCP', requestId);
  reply(res, 200, { entry: adminEntryView(entry, getCatalogStore().countActivations(catalogId)), requestId });
}

/** PATCH /admin/catalog/:id — champs whitelistés, version++, audit. */
async function handleAdminPatch(
  req: IncomingMessage,
  res: ServerResponse,
  catalogId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'MCP_CATALOG_MANAGE', requestId);
  const body = await parseJsonObjectBody(req, requestId);
  const unknown = Object.keys(body).filter((key) => !PATCH_ALLOWED_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(`propriétés non autorisées dans le corps : ${unknown.slice(0, 8).join(', ')}`);
  }
  if (Object.keys(body).length === 0) {
    throw new ValidationError('aucun champ à modifier');
  }
  const entry = getCatalogStore().updateEntry(catalogId, {
    ...(body.name !== undefined ? { name: body.name as string } : {}),
    ...(body.description !== undefined ? { description: body.description as string } : {}),
    ...(body.icon !== undefined ? { icon: body.icon as string } : {}),
    ...(body.category !== undefined ? { category: body.category as string } : {}),
    ...(body.url !== undefined ? { url: body.url as string } : {}),
    ...(body.visibility !== undefined ? { visibility: body.visibility as string } : {})
  });
  recordCatalogAudit('MCP_CATALOG_UPDATED', catalogId, context, requestId, {
    fields: Object.keys(body).sort(),
    version: entry.version
  });
  reply(res, 200, { entry: adminEntryView(entry, getCatalogStore().countActivations(catalogId)), requestId });
}

/** POST /admin/catalog/:id/status — transition selon la MATRICE serveur. */
async function handleAdminTransition(
  req: IncomingMessage,
  res: ServerResponse,
  catalogId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'MCP_CATALOG_MANAGE', requestId);
  const body = await parseJsonObjectBody(req, requestId);
  const before = getCatalogStore().getEntry(catalogId);
  if (before === null) throw new NotFoundError('Entrée de catalogue MCP', requestId);
  const entry = getCatalogStore().transition(catalogId, body.status);
  recordCatalogAudit('MCP_CATALOG_TRANSITIONED', catalogId, context, requestId, {
    from: before.status,
    to: entry.status
  });
  reply(res, 200, { entry: adminEntryView(entry, getCatalogStore().countActivations(catalogId)), requestId });
}

/** DELETE /admin/catalog/:id — 409 si des instances d'activation existent. */
async function handleAdminDelete(
  res: ServerResponse,
  catalogId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'MCP_CATALOG_MANAGE', requestId);
  const removed = getCatalogStore().deleteEntry(catalogId);
  if (!removed) throw new NotFoundError('Entrée de catalogue MCP', requestId);
  recordCatalogAudit('MCP_CATALOG_DELETED', catalogId, context, requestId);
  reply(res, 200, { removed: true, requestId });
}

/**
 * POST /admin/catalog/:id/test — test de santé par le SERVEUR : client MCP
 * standard (validateRemoteMcpUrl + résolution publique + bornes), aucun
 * contournement SSRF, aucun secret en jeu, résultat persisté (last_test_*).
 * Échec réseau = 200 {ok:false} (comme le test de connecteur, D5).
 */
async function handleAdminTest(
  req: IncomingMessage,
  res: ServerResponse,
  catalogId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'MCP_CATALOG_MANAGE', requestId);
  const store = getCatalogStore();
  const entry = store.getEntry(catalogId);
  if (entry === null) throw new NotFoundError('Entrée de catalogue MCP', requestId);
  const body = await parseJsonObjectBody(req, requestId);
  const timeoutMs = clampTimeoutMs(body.timeoutMs);
  const client = catalogClientFactory()({
    url: entry.url,
    connectorId: catalogId,
    timeoutMs
  });
  try {
    const init = await client.initialize();
    store.recordLastTest(catalogId, { status: 'OK', detail: null });
    recordCatalogAudit('MCP_CATALOG_TESTED', catalogId, context, requestId, { ok: true });
    reply(res, 200, {
      ok: true,
      protocolVersion: init.protocolVersion,
      serverName: init.serverName,
      serverVersion: init.serverVersion,
      requestId
    });
  } catch (error) {
    if (error instanceof RemoteMcpClientError) {
      const message = error.message.length > 300 ? `${error.message.slice(0, 300)}…` : error.message;
      // Même mapping que le test de connecteur (mcp-remote D5) : code API
      // normalisé côté réponse, détail persisté = code transport seul.
      const code = error.code === 'TIMEOUT' ? 'MCP_REMOTE_TIMEOUT' : 'MCP_REMOTE_UNREACHABLE';
      store.recordLastTest(catalogId, { status: 'FAILED', detail: error.code });
      recordCatalogAudit('MCP_CATALOG_TESTED', catalogId, context, requestId, {
        ok: false,
        errorCode: error.code
      });
      reply(res, 200, { ok: false, error: { code, message }, requestId });
      return;
    }
    throw error;
  }
}

/** GET /admin/catalog/:id/history — historique ADMINISTRATIF de l'entrée. */
async function handleAdminHistory(
  res: ServerResponse,
  catalogId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'MCP_CATALOG_MANAGE', requestId);
  const entry = getCatalogStore().getEntry(catalogId);
  if (entry === null) throw new NotFoundError('Entrée de catalogue MCP', requestId);
  const events = auditStore
    .queryByResourceType(AUDIT_RESOURCE_TYPE, { resourceId: catalogId })
    .filter((event) => ADMIN_AUDIT_ACTIONS.has(event.action))
    .slice(-50)
    .reverse();
  reply(res, 200, {
    history: events.map((event) => ({
      id: event.id,
      action: event.action,
      status: event.status,
      userId: event.userId,
      metadata: event.metadata ?? null,
      requestId: event.requestId,
      timestamp: event.timestamp.toISOString()
    })),
    requestId
  });
}

/**
 * GET /admin/stats — chiffres RÉELS du backend (aucune statistique inventée) :
 * catalogue par statut/catégorie/santé, connexions globales (compteurs),
 * imports personnels en AGRÉGATS uniquement, dernières opérations admin.
 */
async function handleAdminStats(res: ServerResponse, context: RequestContext, requestId: string): Promise<void> {
  assertPermission(context.role, 'MCP_CATALOG_MANAGE', requestId);
  const catalog = getCatalogStore();
  const byStatus = catalog.countByStatus();
  const total = Object.values(byStatus).reduce((sum, one) => sum + one, 0);
  const connections = getConnectorStore().globalAggregateStats();
  const personal = connections.byScope.find((one) => one.scope === 'personal');
  const recent = auditStore
    .queryByResourceType(AUDIT_RESOURCE_TYPE)
    .filter((event) => ADMIN_AUDIT_ACTIONS.has(event.action))
    .slice(-10)
    .reverse();
  reply(res, 200, {
    catalog: {
      total,
      byStatus,
      byCategory: catalog.countByCategory(),
      health: catalog.healthCounts()
    },
    connections,
    personalImports: {
      total: personal?.total ?? 0,
      enabled: personal?.enabled ?? 0
    },
    recentOperations: recent.map((event) => ({
      action: event.action,
      resourceId: event.resourceId,
      status: event.status,
      userId: event.userId,
      timestamp: event.timestamp.toISOString()
    })),
    requestId
  });
}

/* ---------------------------------------------------------------------------
 * Mini-routeur (table API_ROUTES de server.ts)
 * ------------------------------------------------------------------------- */

/**
 * Point d'entrée. Retourne false pour toute requête hors périmètre → 404
 * central, inchangé. Toute erreur store est normalisée en AppError.
 */
export async function handleMcpCatalogRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const inScope =
    pathname === USER_PREFIX ||
    pathname.startsWith(`${USER_PREFIX}/`) ||
    pathname === ADMIN_PREFIX ||
    pathname.startsWith(`${ADMIN_PREFIX}/`) ||
    pathname === STATS_PATH;
  if (!inScope) return false;
  try {
    // --- Utilisateur ---
    if (pathname === USER_PREFIX && req.method === 'GET') {
      await handleListPublished(res, context, requestId);
      return true;
    }
    const activationMatch = USER_ACTIVATION_PATTERN.exec(pathname);
    if (activationMatch !== null && activationMatch[1] !== undefined) {
      const catalogId = activationMatch[1];
      if (req.method === 'POST') {
        await handleActivate(req, res, catalogId, context, requestId);
        return true;
      }
      if (req.method === 'DELETE') {
        await handleDeactivate(req, res, catalogId, context, requestId);
        return true;
      }
      return false;
    }
    const userEntryMatch = USER_ENTRY_PATTERN.exec(pathname);
    if (userEntryMatch !== null && userEntryMatch[1] !== undefined && req.method === 'GET') {
      await handleGetPublished(res, userEntryMatch[1], context, requestId);
      return true;
    }

    // --- Admin ---
    if (pathname === ADMIN_PREFIX && req.method === 'GET') {
      await handleAdminList(req, res, context, requestId);
      return true;
    }
    if (pathname === ADMIN_PREFIX && req.method === 'POST') {
      await handleAdminCreate(req, res, context, requestId);
      return true;
    }
    if (pathname === STATS_PATH && req.method === 'GET') {
      await handleAdminStats(res, context, requestId);
      return true;
    }
    const transitionMatch = ADMIN_TRANSITION_PATTERN.exec(pathname);
    if (transitionMatch !== null && transitionMatch[1] !== undefined && req.method === 'POST') {
      await handleAdminTransition(req, res, transitionMatch[1], context, requestId);
      return true;
    }
    const testMatch = ADMIN_TEST_PATTERN.exec(pathname);
    if (testMatch !== null && testMatch[1] !== undefined && req.method === 'POST') {
      await handleAdminTest(req, res, testMatch[1], context, requestId);
      return true;
    }
    const historyMatch = ADMIN_HISTORY_PATTERN.exec(pathname);
    if (historyMatch !== null && historyMatch[1] !== undefined && req.method === 'GET') {
      await handleAdminHistory(res, historyMatch[1], context, requestId);
      return true;
    }
    const adminEntryMatch = ADMIN_ENTRY_PATTERN.exec(pathname);
    if (adminEntryMatch !== null && adminEntryMatch[1] !== undefined) {
      const catalogId = adminEntryMatch[1];
      if (req.method === 'GET') {
        await handleAdminGet(res, catalogId, context, requestId);
        return true;
      }
      if (req.method === 'PATCH') {
        await handleAdminPatch(req, res, catalogId, context, requestId);
        return true;
      }
      if (req.method === 'DELETE') {
        await handleAdminDelete(res, catalogId, context, requestId);
        return true;
      }
      return false;
    }
    return false;
  } catch (error) {
    const mapped = toCatalogApiError(error, requestId);
    if (mapped !== null) throw mapped;
    throw error;
  }
}
