/**
 * VibeCode Core — API Tier
 * C3.2-B1 — Routes des connecteurs MCP DISTANTS (HTTPS, transport URL).
 *
 * PÉRIMÈTRE STRICT DU LOT B1 :
 *   - gestion des connecteurs : créer / lire / renommer / changer d'URL /
 *     activer-désactiver / supprimer ;
 *   - gestion du secret : poser / retirer (la valeur plaintext n'est JAMAIS
 *     relue par l'UI, jamais renvoyée, jamais journalisée) ;
 *   - test de connexion réel (handshake initialize uniquement) ;
 *   - journal tenant-filtré (auditStore, metadata whitelist stricte).
 *
 * B2 (découverte & approbation) : tools/list paginé borné, approbation et
 *   révocation EXPLICITES d'un outil. Le hash canonique du schéma est
 *   recalculé CÔTÉ SERVEUR depuis une ré-interrogation exclusive du serveur
 *   distant — le schéma reçu du navigateur n'est JAMAIS une preuve (corps
 *   ignoré, source de vérité unique = serveur distant). Découverte,
 *   approbation, révocation autorisées sur connecteur désactivé (actes de
 *   gestion, cf. D5) ; l'exécution (B3) exigera `enabled`.
 *
 * PAS D'EXPÉCUTION D'OUTILS dans ce fichier (B3) : aucun tools/call n'est
 * émis, ni pendant la découverte, ni pendant l'approbation. Aucun fallback
 * vers le MCP stdio ni vers un autre connecteur : tout échec est un refus
 * explicite normalisé.
 *
 * INVARIANTS DE SÉCURITÉ :
 *   - tenant : UNIQUEMENT `context.tenantId` (jamais un champ du corps ; le
 *     champ client `userId`, s'il existait, serait ignoré — D7) ;
 *   - permissions : gestion = TENANT_MANAGE (OWNER seul), lecture = PROJECT_READ ;
 *     la permission `MCP_REMOTE_INVOKE` (OWNER/ADMIN) sera utilisée par B3 ;
 *   - refus 404 indiscernable pour un connecteur d'un autre tenant (aucun
 *     oracle d'existence) ;
 *   - le plaintext du secret ne vit que dans le store chiffré (AES-256-GCM,
 *     AAD tenant+connecteur) et, transitoirement, en option du client HTTPS
 *     lors d'un test ; `revealConnectorSecret` n'est appelé QUE dans le
 *     handler du test, côté serveur ;
 *   - changement d'URL = révocation ATOMIQUE de toutes les politiques du
 *     connecteur (décision D3 confirmée, transaction du store unique) ;
 *   - erreurs normalisées (voir toApiError) : messages tronqués/caviardés par
 *     les couches C3.1/C3.2-A, aucun secret, aucun argument, aucun corps
 *     distant dans la réponse ou le journal.
 *
 * Fail-closed sur la configuration : sans keyring
 * (VOLACO_MCP_REMOTE_KEY_ID / VOLACO_MCP_REMOTE_KEY, cf. crypto.ts C3.1) ou
 * sans backend SQLite, TOUTES les opérations échouent en 503 explicite.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../../../packages/core/src/errors.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { logger } from '../../../../packages/core/src/logger.js';
import { RemoteMcpConnectorStore, RemoteMcpStoreError } from '../../../../packages/core/src/mcp/remote/store.js';
import type {
  RemoteMcpConnectorRecord,
  RemoteMcpLastTest,
  RemoteMcpSha256Hex,
  RemoteMcpToolPolicy
} from '../../../../packages/core/src/mcp/remote/types.js';
import {
  RemoteMcpSecretCipher,
  RemoteMcpCryptoError,
  loadRemoteMcpKeyringFromEnv
} from '../../../../packages/core/src/mcp/remote/crypto.js';
import { validateRemoteMcpUrl } from '../../../../packages/core/src/mcp/remote/url-policy.js';
import {
  RemoteMcpHttpClient,
  RemoteMcpClientError,
  REMOTE_MCP_DEFAULT_TIMEOUT_MS,
  REMOTE_MCP_MAX_TIMEOUT_MS,
  REMOTE_MCP_MIN_TIMEOUT_MS
} from '../../../../packages/core/src/mcp/remote/client.js';
import type { RemoteMcpClientOptions, RemoteMcpToolDescriptor } from '../../../../packages/core/src/mcp/remote/client.js';
import {
  remoteMcpCanonicalSha256,
  RemoteMcpCanonicalError,
  stableStringifyCanonical
} from '../../../../packages/core/src/mcp/remote/canonical-json.js';
import {
  RemoteMcpConfirmationStore,
  REMOTE_MCP_CONFIRMATION_MAX_TTL_MS
} from '../../../../packages/core/src/mcp/remote/confirmation.js';
import type {
  RemoteMcpConfirmationFailure,
  RemoteMcpConfirmationResult
} from '../../../../packages/core/src/mcp/remote/confirmation.js';
import { readBody } from '../middleware/body.js';
import type { RequestContext } from '../middleware/auth.js';
import { remoteMcpRateLimiter, type RemoteMcpOperation } from '../../../../packages/core/src/mcp/remote/rate-limit.js';

const PREFIX = '/api/v1/mcp-remote';
/** resourceType unique du journal (record/query auditStore). */
const AUDIT_RESOURCE_TYPE = 'MCP_REMOTE_CONNECTOR';

const AUDIT_ACTION_CREATED = 'MCP_REMOTE_CONNECTOR_CREATED';
const AUDIT_ACTION_UPDATED = 'MCP_REMOTE_CONNECTOR_UPDATED';
const AUDIT_ACTION_DELETED = 'MCP_REMOTE_CONNECTOR_DELETED';
const AUDIT_ACTION_SECRET_SET = 'MCP_REMOTE_CONNECTOR_SECRET_SET';
const AUDIT_ACTION_SECRET_REMOVED = 'MCP_REMOTE_CONNECTOR_SECRET_REMOVED';
const AUDIT_ACTION_TESTED = 'MCP_REMOTE_CONNECTION_TESTED';

/** Identifiant de connecteur (identique au motif des couches store/client). */
const CONNECTOR_ID_SOURCE = '[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}';
const CONNECTOR_ID_PATTERN = new RegExp(`^${CONNECTOR_ID_SOURCE}$`);

/** Cap du secret borne le client (CONFIG_INVALID au-delà de 4096) : ré-affirmé ici avec contrôles tôt. */
const SECRET_MAX_CHARS = 4096;

/** Journal : limite par page. */
const JOURNAL_DEFAULT_LIMIT = 50;
const JOURNAL_MAX_LIMIT = 200;

/* ---------------------------------------------------------------------------
 * B2 — Découverte & approbation (AUCUNE invocation d'outil ici)
 * ------------------------------------------------------------------------- */

const AUDIT_ACTION_TOOLS_DISCOVERED = 'MCP_REMOTE_TOOLS_DISCOVERED';
const AUDIT_ACTION_TOOL_APPROVED = 'MCP_REMOTE_TOOL_APPROVED';
const AUDIT_ACTION_TOOL_REVOKED = 'MCP_REMOTE_TOOL_REVOKED';

/* ---------------------------------------------------------------------------
 * B3 — Préparation / confirmation / exécution (seul lot autorisé à émettre
 * un `tools/call` — UNIQUEMENT APRÈS consommation atomique de la confirmation)
 * ------------------------------------------------------------------------- */

const AUDIT_ACTION_TOOL_PREPARED = 'MCP_REMOTE_TOOL_PREPARED';
const AUDIT_ACTION_TOOL_CALLED = 'MCP_REMOTE_TOOL_CALLED';
const AUDIT_ACTION_TOOL_CALL_FAILED = 'MCP_REMOTE_TOOL_CALL_FAILED';

/**
 * C3.4 (§5) — Refus de journalisation : tout échec de la chaîne de
 * autorisation/confirmation est journalisé avec `status: 'FAILURE'` et une
 * RAISON structurée (liste fermée, non secrète). Une action dédiée par
 * opération : approve / revoke / prepare / call / découverte.
 */
const AUDIT_ACTION_APPROVE_REFUSED = 'MCP_REMOTE_TOOL_APPROVE_REFUSED';
const AUDIT_ACTION_REVOKE_REFUSED = 'MCP_REMOTE_TOOL_REVOKE_REFUSED';
const AUDIT_ACTION_PREPARE_REFUSED = 'MCP_REMOTE_TOOL_PREPARE_REFUSED';
const AUDIT_ACTION_CALL_REFUSED = 'MCP_REMOTE_TOOL_CALL_REFUSED';
const AUDIT_ACTION_DISCOVERY_REFUSED = 'MCP_REMOTE_TOOLS_DISCOVERY_REFUSED';

/** Raisons de refus : liste fermée de codes NON secrets (nommage = contrat). */
type RemoteMcpRefusalReason =
  | 'PERMISSION_DENIED'
  | 'IDENTITY_UNTRUSTED'
  | 'INPUT_INVALID'
  | 'CONNECTOR_NOT_FOUND'
  | 'CONNECTOR_DISABLED'
  | 'URL_DRIFT'
  | 'APPROVAL_URL_DRIFT'
  | 'TOOL_NOT_FOUND'
  | 'SCHEMA_INVALID'
  | 'TOOL_NOT_APPROVED'
  | 'TOOL_APPROVAL_REVOKED'
  | 'APPROVAL_SCHEMA_DRIFT'
  | 'APPROVAL_ABSENT'
  | 'DISCOVERY_REFUSED'
  | 'CONFIRMATION_NOT_FOUND'
  | 'CONFIRMATION_EXPIRED'
  | 'CONFIRMATION_REPLAY'
  | 'CONFIRMATION_BINDING_MISMATCH';

/**
 * TTL serveur FIXE de la confirmation : le cap maximal C3.1 (aucune
 * négociation par le client — la demi-vie d'une opération préparée est une
 * décision de sécurité serveur).
 */
const CONFIRMATION_FIXED_TTL_MS = REMOTE_MCP_CONFIRMATION_MAX_TTL_MS;
/**
 * Borne d'arguments (charge canonique UTF-8) : au-delà → refus 400 FAIL-CLOSED
 * AVANT toute interrogation. Le client HTTPS borne par ailleurs la charge
 * tools/call (REQUEST_TOO_LARGE) — la présente borne évite le gaspillage
 * réseau et reste identiquement fail-closed.
 */
const ARGS_MAX_CANONICAL_BYTES = 16_384;

/** Nom d'outil distant (motif STRICTEMENT identique aux couches store/client/confirmation C3.1). */
const TOOL_NAME_SOURCE = '[A-Za-z0-9_][A-Za-z0-9._-]{0,127}';
const TOOL_NAME_PATTERN = new RegExp(`^${TOOL_NAME_SOURCE}$`);

/**
 * Bornes anti-DoS de la découverte (contenus distants NON fiables) : au-delà,
 * refus explicite 502 fail-closed — jamais de troncature silencieuse de
 * l'inventaire (l'UI doit savoir qu'elle voit tout ou rien).
 */
const DISCOVERY_MAX_TOOLS = 200;
const DISCOVERY_MAX_PAGES = 5;
/**
 * Borne d'AFFICHAGE d'un schéma (UTF-8 canonique). Au-delà : `inputSchema`
 * omis de la réponse + compteur dédié ; le hash reste celui du schéma
 * COMPLET — l'approbation ne dépend JAMAIS de cette borne d'affichage.
 */
const DISCOVERY_MAX_SCHEMA_BYTES = 8192;

/* ---------------------------------------------------------------------------
 * Runtime (Singletons paresseux) + seam d'injection UNIQUEMENT TEST
 * ------------------------------------------------------------------------- */

export type RemoteMcpClientFactory = (options: RemoteMcpClientOptions) => RemoteMcpHttpClient;

/**
 * Seam de TEST UNIQUEMENT (jamais branché en production) : fournit le store
 * sous test (base SQLite temporaire), une usine de client stub et le store
 * de confirmations (horloge injectable pour l'expiration). Aucune production
 * de code ne doit dépendre de ce setter.
 */
export interface RemoteMcpRuntimeForTests {
  readonly connectorStore?: (() => RemoteMcpConnectorStore) | undefined;
  readonly clientFactory?: RemoteMcpClientFactory | undefined;
  readonly confirmationStore?: (() => RemoteMcpConfirmationStore) | undefined;
}

let runtimeForTests: RemoteMcpRuntimeForTests | null = null;

export function setMcpRemoteRuntimeForTests(runtime: RemoteMcpRuntimeForTests | null): void {
  runtimeForTests = runtime;
}

let cachedConnectorStore: RemoteMcpConnectorStore | undefined;

/**
 * Store paresseux. Si le keyring est absent/invalide, l'erreur remonte à
 * chaque requête (503 explicite) SANS être mise en cache : la configuration
 * peut être corrigée sans redémarrage fantôme.
 *
 * LOT UI-MCP — exporté pour le routeur catalogue (activation : matérialisation
 * d'une instance scope 'catalog' sur le MÊME store, seam de test comprise).
 */
export function getConnectorStore(): RemoteMcpConnectorStore {
  if (runtimeForTests?.connectorStore) {
    return runtimeForTests.connectorStore();
  }
  if (cachedConnectorStore === undefined) {
    const cipher = new RemoteMcpSecretCipher(loadRemoteMcpKeyringFromEnv());
    cachedConnectorStore = new RemoteMcpConnectorStore(cipher);
  }
  return cachedConnectorStore;
}

let cachedConfirmationStore: RemoteMcpConfirmationStore | undefined;

/**
 * Store de confirmations anti-rejeu (C3.1). Même backend SQLite que les
 * connecteurs ; les horloges de test se branchent via le seam uniquement.
 */
function getConfirmationStore(): RemoteMcpConfirmationStore {
  if (runtimeForTests?.confirmationStore) {
    return runtimeForTests.confirmationStore();
  }
  if (cachedConfirmationStore === undefined) {
    cachedConfirmationStore = new RemoteMcpConfirmationStore();
  }
  return cachedConfirmationStore;
}

const defaultClientFactory: RemoteMcpClientFactory = (options) => new RemoteMcpHttpClient(options);

/**
 * Construit le client HTTPS du connecteur. `bearer` provient du decrypt du
 * store (plaintext, NON secret pour la mécanique interne : jamais journalisé,
 * jamais renvoyé). Aucune injection deTEST en production (pas de resolver,
 * pas de policy outillée) : taille/timeout bornés par les défauts du client.
 */
function buildClient(
  record: RemoteMcpConnectorRecord,
  bearer: string | null,
  timeoutMs: number,
  factory: RemoteMcpClientFactory
): RemoteMcpHttpClient {
  const options: RemoteMcpClientOptions = {
    url: record.url,
    connectorId: record.connectorId,
    timeoutMs,
    ...(bearer !== null ? { bearerToken: bearer } : {})
  };
  return factory(options);
}

/* ---------------------------------------------------------------------------
 * Helpers de réponse / audit / parsing
 * ------------------------------------------------------------------------- */

export function reply(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/**
 * Journalisation tenant liée. `userId` du contexte = identité fiable (JWT),
 * sinon label technique (jamais une identité fabriquée depuis le corps).
 * `metadata` est une whitelist : JAMAIS de valeur du corps, jamais de secret,
 * jamais d'URL cible complète.
 */
function recordAudit(
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

/**
 * C3.4 (§5) — audit de REFUS. Le resourceId est celui VISE par la requête
 * (peut être inconnu : un refus 404 est journalisé SANS créer d'oracle
 * d'existence — l'évènement décrit la REQUÊTE du tenant, pas l'existence de
 * l'objet). Métadonnées : raisons fermées + identifiants non secrets
 * (hashs, noms d'outils) — JAMAIS d'argument, un secret, une URL distante.
 */
function recordRefusal(
  action: string,
  connectorId: string,
  context: RequestContext,
  requestId: string,
  reason: RemoteMcpRefusalReason,
  extra?: Record<string, unknown>
): void {
  auditStore.record({
    tenantId: context.tenantId,
    userId: context.userId || context.role,
    action,
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: connectorId,
    status: 'FAILURE',
    metadata: { reason, ...(extra !== undefined ? extra : {}) },
    requestId
  });
}

/**
 * C3.4 (§5) — durée d'exécution : écrite dans le journal STRUCTURÉ (logger),
 * PAS dans auditStore. Arbitrage documenté : la whitelist de métadonnées du
 * journal applicatif (PREPARED/CALLED/CALL_FAILED) est un CONTRAT figé en
 * C3.2 (B3-19 exact-whitelist) ; y ajouter un champ invaliderait une suite
 * de non-régression sans gain de sécurité. toolName est non secret.
 */
function recordToolDuration(
  phase: 'prepare' | 'call',
  outcome: 'ok' | 'fail',
  durationMs: number,
  toolName: string
): void {
  logger.info(
    `Opération MCP distante ${phase} ${outcome} en ${durationMs} ms`,
    { component: 'mcp-remote-tool', durationMs, toolName }
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Corps JSON ≤1 Mo (readBody) : objet requis ({} accepté). */
export async function parseJsonObjectBody(req: IncomingMessage, requestId: string): Promise<Record<string, unknown>> {
  const text = await readBody(req);
  if (text.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
  }
  if (!isPlainObject(parsed)) {
    throw new ValidationError('Le corps de la requête doit être un objet JSON', undefined, requestId);
  }
  return parsed;
}

/** Nom de connecteur : mêmes bornes que le store (1..64, sans caractères de contrôle). */
function requireName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('Le champ "name" est obligatoire (chaîne)');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64 || /[\u0000-\u001f]/.test(trimmed)) {
    throw new ValidationError('name invalide (1 à 64 caractères, sans caractères de contrôle)');
  }
  return trimmed;
}

/** URL cible https pré-validée (le store re-valide : double garde). */
function requireUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('Le champ "url" est obligatoire (chaîne https)');
  }
  const policy = validateRemoteMcpUrl(value);
  if (!policy.allowed) {
    throw new ValidationError(`URL cible refusée (${policy.reason})`);
  }
  return value;
}

/**
 * Secret optionnel de création : chaîne 1..4096, SANS caractères de contrôle
 * (un token porteur ne contient jamais de saut de ligne/tabulation — toute
 * présence est une saisie hostile ou corrompue → refus, pas de "nettoyage").
 */
function requireOptionalSecret(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('secret invalide (chaîne de 1 à 4096 caractères, ou omise)');
  }
  if (value.length > SECRET_MAX_CHARS) {
    throw new ValidationError(`secret trop long (max ${SECRET_MAX_CHARS} caractères)`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ValidationError('secret invalide (caractères de contrôle interdits)');
  }
  return value;
}

/** timeoutMs borné exactement comme le client (1000..120000 ; défaut = client : 10 s, C3.3). */
export function clampTimeoutMs(value: unknown): number {
  if (value === undefined || value === null) return REMOTE_MCP_DEFAULT_TIMEOUT_MS;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError('timeoutMs invalide (nombre de millisecondes)');
  }
  return Math.min(Math.max(Math.trunc(value), REMOTE_MCP_MIN_TIMEOUT_MS), REMOTE_MCP_MAX_TIMEOUT_MS);
}

/** Vue exposée à l'UI : JAMAIS de plaintext, uniquement les métadonnées du secret. */
function connectorView(record: RemoteMcpConnectorRecord): Record<string, unknown> {
  return {
    connectorId: record.connectorId,
    name: record.name,
    url: record.url,
    transport: record.transport,
    enabled: record.enabled,
    // LOT UI-MCP — portée + propriété (aucun secret) : 'tenant' = config du
    // tenant ; 'personal'/'catalog' = lignes strictement propriétaires (les
    // routes excluent déjà celles des autres utilisateurs de la réponse).
    scope: record.scope,
    ownerUserId: record.ownerUserId,
    catalogId: record.catalogId,
    secretPresent: record.secretMeta !== null,
    // keyId NON secret (désigné pour la résolution du keyring, cf. types.ts C3.1).
    secretKeyId: record.secretMeta !== null ? record.secretMeta.keyId : null,
    secretEncryptedAt: record.secretMeta !== null ? record.secretMeta.encryptedAt : null,
    toolPolicies: record.toolPolicies.map((policy) => ({
      toolName: policy.toolName,
      schemaSha256: policy.schemaSha256,
      status: policy.status,
      approvedBy: policy.approvedBy,
      approvedAt: policy.approvedAt,
      updatedAt: policy.updatedAt
    })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

/* ---------------------------------------------------------------------------
 * B2 — Collecte distante bornée + vue d'entrée (aucune invocation d'outil)
 * ------------------------------------------------------------------------- */

/**
 * Inventaire COMPLET des outils déclarés par le serveur distant (`tools/list`
 * paginé, session `initialize` ouverte par le client C3.2-A). AUCUN
 * `tools/call` n'est émis — ni ici, ni par les handlers qui utilisent ce
 * helper. Bornes fail-closed (≥ limite → 502 explicite, sans contenu distant
 * dans le message) : nombre d'outils, nombre de pages.
 */
async function collectRemoteTools(
  client: RemoteMcpHttpClient,
  requestId: string
): Promise<RemoteMcpToolDescriptor[]> {
  const tools: RemoteMcpToolDescriptor[] = [];
  let cursor: string | undefined = undefined;
  for (let page = 0; page < DISCOVERY_MAX_PAGES; page++) {
    const result = await client.listTools(cursor);
    if (!Array.isArray(result.tools)) {
      // Réponse non conforme au contrat client C3.2-A : 502 fail-closed,
      // jamais un crash interne ni un traitement partiel de l'inventaire.
      throw new AppError(
        'Découverte refusée : réponse distante non conforme au contrat MCP',
        'MCP_REMOTE_UNREACHABLE',
        502,
        undefined,
        requestId
      );
    }
    for (const descriptor of result.tools) {
      if (tools.length >= DISCOVERY_MAX_TOOLS) {
        throw new AppError(
          'Découverte refusée : borne du nombre d outils distants dépassée',
          'MCP_REMOTE_UNREACHABLE',
          502,
          undefined,
          requestId
        );
      }
      tools.push(descriptor);
    }
    if (result.nextCursor === null) {
      return tools;
    }
    cursor = result.nextCursor;
  }
  throw new AppError(
    'Découverte refusée : pagination distante au-delà de la borne interne',
    'MCP_REMOTE_UNREACHABLE',
    502,
    undefined,
    requestId
  );
}

type DiscoverySchemaStatus = 'OK' | 'INVALID' | 'DISPLAY_TRUNCATED';

type DiscoveryApprovalView = {
  readonly status: 'APPROVED' | 'REVOKED' | 'NONE';
  readonly approvedSchemaSha256: RemoteMcpSha256Hex | null;
  readonly drift: boolean;
};

/** Approbation absente (aucune politique pour cet outil). */
const NO_APPROVAL: DiscoveryApprovalView = {
  status: 'NONE',
  approvedSchemaSha256: null,
  drift: false
};

/** Vue d'une entrée d'inventaire. `inputSchema` = contenu distant NON fiable (brut, borné côté route) — l'UI d'affichage (B4) devra l'échapper intégralement, jamais l'exécuter. */
function discoveryEntry(
  descriptor: RemoteMcpToolDescriptor,
  inputSchemaView: unknown,
  schemaStatus: DiscoverySchemaStatus,
  schemaSha256: RemoteMcpSha256Hex | null,
  approval: DiscoveryApprovalView
): Record<string, unknown> {
  return {
    toolName: descriptor.name,
    title: descriptor.title,
    description: descriptor.description,
    inputSchema: inputSchemaView,
    schemaSha256,
    schemaStatus,
    approval
  };
}

/* ---------------------------------------------------------------------------
 * Normalisation des erreurs (AppError rendu par le dispatcher central)
 * ------------------------------------------------------------------------- */

/**
 * Conversion en erreur API avec statusCode déterministe. Les messages
 * distants (client HTTPS C3.2-A) sont DÉJÀ caviardés (corpus bearer), sans
 * caractères de contrôle et tronqués à 300 caractères ; on borne encore par
 * prudence avant ré-émission.
 */
function toApiError(error: unknown, requestId: string): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof RemoteMcpStoreError) {
    if (error.code === 'NOT_FOUND') {
      return new NotFoundError('Connecteur MCP distant', requestId);
    }
    if (error.code === 'INVALID_INPUT') {
      return new ValidationError(error.message, undefined, requestId);
    }
    // STORAGE_UNAVAILABLE et tout code futur
    return new AppError(
      'Persistance des connecteurs MCP distants indisponible (aucun repli silencieux)',
      'MCP_REMOTE_CONFIG',
      503,
      undefined,
      requestId
    );
  }

  if (error instanceof RemoteMcpCryptoError) {
    // Codes INVALID_KEY / KEY_ID_REUSE / AUTH_SECRET_REUSE / UNKNOWN_KEY_ID
    // / DECRYPT_FAILED : message explicite sur la configuration (NOMS de
    // variables d'environnement, jamais leurs valeurs).
    return new AppError(
      'Connecteurs MCP distants indisponibles : configuration de chiffrement absente ou invalide ' +
        '(VOLACO_MCP_REMOTE_KEY_ID / VOLACO_MCP_REMOTE_KEY ; rotation : VOLACO_MCP_REMOTE_PREVIOUS_KEY_ID / VOLACO_MCP_REMOTE_PREVIOUS_KEY)',
      'MCP_REMOTE_CONFIG',
      503,
      undefined,
      requestId
    );
  }

  if (error instanceof RemoteMcpClientError) {
    const message = error.message.length > 400 ? `${error.message.slice(0, 400)}…` : error.message;
    if (error.code === 'TIMEOUT') {
      return new AppError(message, 'MCP_REMOTE_TIMEOUT', 504, { code: error.code }, requestId);
    }
    if (error.code === 'REQUEST_TOO_LARGE') {
      return new AppError(message, 'PAYLOAD_TOO_LARGE', 413, { code: error.code }, requestId);
    }
    if (error.code === 'CONFIG_INVALID' || error.code === 'STATE_INVALID' || error.code === 'ENCODING_INVALID') {
      return new AppError(message, 'VALIDATION_ERROR', 400, { code: error.code }, requestId);
    }
    // URL_POLICY / DNS_POLICY / CONNECT_ERROR / TLS_FAILURE / SOCKET_MISMATCH
    // / HTTP_STATUS / REDIRECT_* / RESPONSE_TOO_LARGE / PROTOCOL_UNSUPPORTED
    // / JSONRPC_* → 502 (cible injoignable ou réponse invalide) : refus
    // explicite, JAMAIS d'alternative automatique.
    return new AppError(message, 'MCP_REMOTE_UNREACHABLE', 502, { code: error.code }, requestId);
  }

  // Erreur inattendue : 500 générique SANS contenu de l'exception (les
  // couches inférieures ne garantissent pas la non-sensibilité du message).
  return new AppError('Erreur interne des connecteurs MCP distants', 'INTERNAL_ERROR', 500, undefined, requestId);
}

/* ---------------------------------------------------------------------------
 * Handlers
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * LOT UI-MCP — propriété des lignes non-'tenant' (imports personnels et
 * instances de catalogue). Règle unique, vérifiée SERVEUR à chaque accès :
 *   - scope 'tenant'  : comportement historique inchangé (permission de
 *     gestion du handler) ;
 *   - scope 'personal'/'catalog' : SEUL le propriétaire (JWT sub) y accède,
 *     avec la permission MCP_REMOTE_INVOKE ; sinon 404 indiscernable (aucun
 *     oracle d'existence sur les imports des autres).
 * ------------------------------------------------------------------------- */

/** Refus 404 sans oracle pour une ligne non-tenant non possédée. */
function assertConnectorOwnership(
  record: RemoteMcpConnectorRecord,
  context: RequestContext,
  requestId: string
): void {
  if (record.scope === 'tenant') return;
  if (context.userId === undefined || context.userId === '' || context.userId !== record.ownerUserId) {
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
}

/**
 * Accès « gestion » : tenant → la permission demandée par le handler ;
 * non-tenant → propriétaire + MCP_REMOTE_INVOKE.
 */
function assertConnectorManagementAccess(
  record: RemoteMcpConnectorRecord,
  context: RequestContext,
  requestId: string,
  tenantPermission: 'TENANT_MANAGE' | 'PROJECT_READ'
): void {
  if (record.scope === 'tenant') {
    assertPermission(context.role, tenantPermission, requestId);
    return;
  }
  assertConnectorOwnership(record, context, requestId);
  assertPermission(context.role, 'MCP_REMOTE_INVOKE', requestId);
}

/**
 * GET /connectors — liste du tenant (scope 'tenant' par défaut, historique
 * inchangé) ou `?scope=mine` : MES imports personnels + MES instances de
 * catalogue (identité JWT obligatoire ; jamais celles des autres).
 */
async function handleListConnectors(
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'PROJECT_READ', requestId);
  const store = getConnectorStore();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const scope = url.searchParams.get('scope');
  if (scope === 'mine') {
    if (context.userId === undefined || context.userId === '') {
      throw new UnauthorizedError(
        'Identité utilisateur requise (JWT) pour consulter vos connecteurs personnels',
        requestId
      );
    }
    const records = store.listConnectorsForUser(context.tenantId, context.userId);
    reply(res, 200, { connectors: records.map(connectorView), requestId });
    return;
  }
  if (scope !== null && scope !== '' && scope !== 'tenant') {
    throw new ValidationError('scope invalide (tenant | mine)');
  }
  const records = store.listConnectors(context.tenantId);
  reply(res, 200, { connectors: records.map(connectorView), requestId });
}

async function handleCreateConnector(
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
  requestId: string
): Promise<void> {
  const body = await parseJsonObjectBody(req, requestId);
  // LOT UI-MCP — portée de création : 'tenant' (gérée, historique) ou
  // 'personal' (import privé). 'catalog' est RÉSERVÉ à l'activation d'une
  // entrée du catalogue (route dédiée) : jamais créable ici.
  const scopeRaw = body.scope === undefined ? 'tenant' : body.scope;
  if (scopeRaw !== 'tenant' && scopeRaw !== 'personal') {
    throw new ValidationError(
      "scope invalide ('tenant' ou 'personal' — 'catalog' est réservé aux activations du catalogue)"
    );
  }
  let personalOwner: string | null = null;
  if (scopeRaw === 'tenant') {
    assertPermission(context.role, 'TENANT_MANAGE', requestId);
  } else {
    // Import personnel : identité JWT fiable (jamais un champ du corps) +
    // droit MCP distant (DENY par défaut conservé : sans MCP_REMOTE_INVOKE,
    // aucun connecteur n'est configurable).
    if (context.userId === undefined || context.userId === '') {
      throw new UnauthorizedError(
        'Identité utilisateur requise (JWT) pour un import personnel',
        requestId
      );
    }
    assertPermission(context.role, 'MCP_REMOTE_INVOKE', requestId);
    personalOwner = context.userId;
  }
  const name = requireName(body.name);
  const url = requireUrl(body.url);
  const secret = requireOptionalSecret(body.secret);

  const store = getConnectorStore();
  // La création DOIT précéder l'écriture du secret (API distincte PUT
  // /secret) : seule l'écriture du secret peut échouer après création, et
  // uniquement pour une cause crypto/BD — l'utilisateur peut la rejouer.
  const created =
    personalOwner !== null
      ? store.createConnector({
          tenantId: context.tenantId,
          name,
          url,
          scope: 'personal',
          ownerUserId: personalOwner
        })
      : store.createConnector({ tenantId: context.tenantId, name, url });
  if (secret !== undefined) {
    store.setConnectorSecret(context.tenantId, created.connectorId, secret);
  }
  const final = store.getConnector(context.tenantId, created.connectorId);
  if (final === null) {
    throw new AppError('Connecteur introuvable après création', 'INTERNAL_ERROR', 500, undefined, requestId);
  }
  recordAudit(AUDIT_ACTION_CREATED, final.connectorId, context, requestId, { transport: 'url' });
  reply(res, 201, { connector: connectorView(final), requestId });
}

async function handleGetConnector(
  res: ServerResponse,
  connectorId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'PROJECT_READ', requestId);
  const store = getConnectorStore();
  const record = store.getConnector(context.tenantId, connectorId);
  if (record === null) {
    // Indiscernable pour un connecteur d'un autre tenant (aucun oracle).
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  // LOT UI-MCP — ligne non-tenant : propriétaire seul (404 sans oracle).
  assertConnectorManagementAccess(record, context, requestId, 'PROJECT_READ');
  reply(res, 200, { connector: connectorView(record), requestId });
}

/**
 * PATCH : au moins un champ parmi name / url / enabled.
 * Ordre d'écriture : url d'abord (révocation atomique D3), puis name, puis
 * enabled — toute validation a lieu AVANT la première écriture, de sorte
 * qu'aucune requête invalide ne produise de modification partielle.
 */
async function handlePatchConnector(
  req: IncomingMessage,
  res: ServerResponse,
  connectorId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  // LOT UI-MCP — accès AVANT parsing : tenant → TENANT_MANAGE (historique
  // 403 avant 400/404) ; ligne non-tenant → propriétaire + MCP_REMOTE_INVOKE.
  const store = getConnectorStore();
  const existing = store.getConnector(context.tenantId, connectorId);
  if (existing === null) {
    assertPermission(context.role, 'TENANT_MANAGE', requestId);
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  assertConnectorManagementAccess(existing, context, requestId, 'TENANT_MANAGE');
  const body = await parseJsonObjectBody(req, requestId);
  const hasName = body.name !== undefined;
  const hasUrl = body.url !== undefined;
  const hasEnabled = body.enabled !== undefined;
  if (!hasName && !hasUrl && !hasEnabled) {
    throw new ValidationError('aucun champ à modifier (name / url / enabled requis)');
  }
  // Validations COMPLÈTES avant toute écriture.
  const name = hasName ? requireName(body.name) : undefined;
  const url = hasUrl ? requireUrl(body.url) : undefined;
  const enabled = hasEnabled ? requireEnabled(body.enabled) : undefined;

  let revokedToolNames: readonly string[] | undefined;
  let invalidatedConfirmations: number | undefined;
  if (url !== undefined) {
    const outcome = store.setConnectorUrlRevokingPolicies(context.tenantId, connectorId, url);
    if (outcome.revokedToolNames.length > 0) {
      revokedToolNames = outcome.revokedToolNames;
    }
    invalidatedConfirmations = outcome.invalidatedConfirmations;
  }
  if (name !== undefined) {
    store.setConnectorName(context.tenantId, connectorId, name);
  }
  if (enabled !== undefined) {
    store.setConnectorEnabled(context.tenantId, connectorId, enabled);
  }

  const record = store.getConnector(context.tenantId, connectorId);
  if (record === null) {
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  const fields: string[] = [];
  if (name !== undefined) fields.push('name');
  if (url !== undefined) fields.push('url');
  if (enabled !== undefined) fields.push('enabled');
  recordAudit(
    AUDIT_ACTION_UPDATED,
    connectorId,
    context,
    requestId,
    { fields, revokedPoliciesCount: revokedToolNames !== undefined ? revokedToolNames.length : 0 }
  );
  const payload: Record<string, unknown> = { connector: connectorView(record), requestId };
  if (revokedToolNames !== undefined) {
    payload.revokedToolNames = [...revokedToolNames];
  }
  if (invalidatedConfirmations !== undefined) {
    // B3 — compteur non secret : preuve d'audit du refus ultérieur des confirmations.
    payload.invalidatedConfirmations = invalidatedConfirmations;
  }
  reply(res, 200, payload);
}

function requireEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError('enabled invalide (booléen requis)');
  }
  return value;
}

async function handleDeleteConnector(
  res: ServerResponse,
  connectorId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  // LOT UI-MCP — tenant → TENANT_MANAGE (historique) ; ligne non-tenant →
  // propriétaire + MCP_REMOTE_INVOKE (404 sans oracle pour les autres).
  const store = getConnectorStore();
  const existing = store.getConnector(context.tenantId, connectorId);
  if (existing === null) {
    assertPermission(context.role, 'TENANT_MANAGE', requestId);
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  assertConnectorManagementAccess(existing, context, requestId, 'TENANT_MANAGE');
  // CASCADE vérifiée au store : politiques + confirmations du couple supprimées.
  const removed = store.deleteConnector(context.tenantId, connectorId);
  if (!removed) {
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  recordAudit(AUDIT_ACTION_DELETED, connectorId, context, requestId, { scope: existing.scope });
  reply(res, 200, { removed: true, requestId });
}

async function handleSetSecret(
  req: IncomingMessage,
  res: ServerResponse,
  connectorId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  // LOT UI-MCP — accès avant écriture du secret (propriétaire des lignes
  // non-tenant uniquement ; le secret reste chiffré et jamais renvoyé).
  const bootstrap = getConnectorStore();
  const existingSecretTarget = bootstrap.getConnector(context.tenantId, connectorId);
  if (existingSecretTarget === null) {
    assertPermission(context.role, 'TENANT_MANAGE', requestId);
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  assertConnectorManagementAccess(existingSecretTarget, context, requestId, 'TENANT_MANAGE');
  const body = await parseJsonObjectBody(req, requestId);
  const secret = requireOptionalSecret(body.secret);
  if (secret === undefined) {
    throw new ValidationError('Le champ "secret" est obligatoire ici (utiliser DELETE /secret pour retirer)');
  }
  const store = getConnectorStore();
  const meta = store.setConnectorSecret(context.tenantId, connectorId, secret);
  const final = store.getConnector(context.tenantId, connectorId);
  if (final === null) {
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  // keyId uniquement (NON secret, cf. crypto.ts) : jamais la valeur, jamais une empreinte.
  recordAudit(AUDIT_ACTION_SECRET_SET, connectorId, context, requestId, { keyId: meta.keyId });
  reply(res, 200, {
    secretMeta: { keyId: meta.keyId, encryptedAt: meta.encryptedAt },
    connector: connectorView(final),
    requestId
  });
}

async function handleRemoveSecret(
  res: ServerResponse,
  connectorId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  // LOT UI-MCP — accès : tenant → TENANT_MANAGE ; non-tenant → propriétaire.
  const store = getConnectorStore();
  const existing = store.getConnector(context.tenantId, connectorId);
  if (existing === null) {
    assertPermission(context.role, 'TENANT_MANAGE', requestId);
    // Connecteur absent OU secret absent : 404 unique, indiscernable.
    throw new NotFoundError('Secret du connecteur MCP distant', requestId);
  }
  assertConnectorManagementAccess(existing, context, requestId, 'TENANT_MANAGE');
  const removed = store.removeConnectorSecret(context.tenantId, connectorId);
  if (!removed) {
    // Connecteur absent OU secret absent : 404 unique, indiscernable.
    throw new NotFoundError('Secret du connecteur MCP distant', requestId);
  }
  recordAudit(AUDIT_ACTION_SECRET_REMOVED, connectorId, context, requestId);
  reply(res, 200, { removed: true, requestId });
}

/**
 * POST /connectors/:id/test — handshake réel (initialize uniquement).
 * Décision D5 : AUTORISÉ sur connecteur désactivé (acte de gestion explicite,
 * TENANT_MANAGE) ; n'active JAMAIS le connecteur et n'exécute JAMAIS d'outil.
 * Les mêmes protections réseau du client s'appliquent (SSRF/TLS/limites).
 * Réponse 200 {ok:true,...} ou 200 {ok:false,error:{code,message}} :
 * l'échec du TEST n'est pas un échec HTTP (401/403/404 restent des refus).
 */
async function handleTestConnection(
  req: IncomingMessage,
  res: ServerResponse,
  connectorId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  // LOT UI-MCP — accès avant test réseau : tenant → TENANT_MANAGE (D5) ;
  // ligne non-tenant → propriétaire + MCP_REMOTE_INVOKE. Le test reste borné
  // par les protections SSRF du client (aucune voie de contournement).
  const bootstrap = getConnectorStore();
  const existingTestTarget = bootstrap.getConnector(context.tenantId, connectorId);
  if (existingTestTarget === null) {
    assertPermission(context.role, 'TENANT_MANAGE', requestId);
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  assertConnectorManagementAccess(existingTestTarget, context, requestId, 'TENANT_MANAGE');
  const body = await parseJsonObjectBody(req, requestId);
  const timeoutMs = clampTimeoutMs(body.timeoutMs);

  const store = getConnectorStore();
  const record = store.getConnector(context.tenantId, connectorId);
  if (record === null) {
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  // Déchiffrement serveur unique — valeur NON renvoyée, NON journalisée.
  const bearer = store.revealConnectorSecret(context.tenantId, connectorId);
  const client = buildClient(record, bearer, timeoutMs, runtimeForTests?.clientFactory ?? defaultClientFactory);
  try {
    const init = await client.initialize();
    // C3.2 — suivi persisté du dernier état de test (non secret) : OK,
    // détail null (aucune donnée du corps distant dans la persistance).
    store.recordLastTest(context.tenantId, connectorId, { status: 'OK', detail: null });
    recordAudit(AUDIT_ACTION_TESTED, connectorId, context, requestId, {
      ok: true,
      protocolVersion: init.protocolVersion
    });
    reply(res, 200, {
      ok: true,
      protocolVersion: init.protocolVersion,
      serverName: init.serverName,
      serverVersion: init.serverVersion,
      sessionCaptured: init.sessionId !== null,
      requestId
    });
  } catch (error) {
    if (error instanceof RemoteMcpClientError) {
      const message = error.message.length > 300 ? `${error.message.slice(0, 300)}…` : error.message;
      const code = error.code === 'TIMEOUT' ? 'MCP_REMOTE_TIMEOUT' : 'MCP_REMOTE_UNREACHABLE';
      // C3.2 — suivi persisté du dernier état de test : FAILED, détail =
      // CODE TRANSPORT SEUL (jamais le message, qui peut citer la cible).
      store.recordLastTest(context.tenantId, connectorId, { status: 'FAILED', detail: error.code });
      recordAudit(AUDIT_ACTION_TESTED, connectorId, context, requestId, {
        ok: false,
        errorCode: error.code
      });
      reply(res, 200, { ok: false, error: { code, message }, requestId });
      return;
    }
    throw error; // erreurs store/crypto etc. → normalisation standard
  }
}

/**
 * B4 (LOT B, décision 5) — Limitation d'abus MCP DISTANT, par tenant ET par
 * utilisateur, par type d'opération. Refus 429 JOURNALISÉ (logger) et AUDITÉ
 * (auditStore, action dédiée MCP_REMOTE_RATE_LIMITED). Fail-closed : le refus
 * est émis AVANT tout accès réseau.
 */
export function enforceMcpQuota(
  op: RemoteMcpOperation,
  connectorId: string,
  context: RequestContext,
  requestId: string
): void {
  const decision = remoteMcpRateLimiter.check(op, context.tenantId, context.userId);
  if (decision.allowed) return;
  auditStore.record({
    tenantId: context.tenantId,
    userId: context.userId || 'anonymous',
    action: 'MCP_REMOTE_RATE_LIMITED',
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: connectorId,
    status: 'FAILURE',
    metadata: { operation: op, scope: decision.scope, limit: decision.limit },
    requestId
  });
  logger.warn('MCP distant : quota dépassé (429)', {
    component: 'mcp-remote',
    tenantId: context.tenantId,
    connectorId,
    operation: op,
    scope: decision.scope,
    limit: decision.limit,
    requestId
  });
  throw new AppError(
    `Quota MCP distant dépassé pour l'opération ${op} (limite ${decision.scope} : ${decision.limit}/min) — réessayez dans ${decision.retryAfterSeconds}s.`,
    'RATE_LIMITED',
    429,
    { operation: op, scope: decision.scope, retryAfterSeconds: decision.retryAfterSeconds },
    requestId
  );
}

/* ---------------------------------------------------------------------------
 * B2 — Handlers : découverte / approbation / révocation d'outils
 * (AUCUN tools/call — l'exécution appartient strictement à B3)
 * ------------------------------------------------------------------------- */

/**
 * GET /connectors/:id/tools — découverte (TENANT_MANAGE, OWNER seul).
 * Interrogation exclusive du serveur distant courant ; n'APPROUVE RIEN
 * automatiquement (aucune écriture magasin), n'exécute RIEN. Autorisé sur
 * connecteur désactivé (acte de gestion, D5). Réponse : vue par outil avec
 * hash canonique calculé SERVEUR, état d'approbation et indicateur de
 * dérive (hash APPROVED ≠ hash courant).
 */
async function handleListRemoteTools(
  res: ServerResponse,
  connectorId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  const store = getConnectorStore();
  const record = store.getConnector(context.tenantId, connectorId);
  try {
    if (record === null) {
      // Historique : permission d'abord (403 avant 404).
      assertPermission(context.role, 'TENANT_MANAGE', requestId);
    } else {
      // LOT UI-MCP — tenant → TENANT_MANAGE ; non-tenant → propriétaire JWT.
      assertConnectorManagementAccess(record, context, requestId, 'TENANT_MANAGE');
    }
  } catch (error) {
    recordRefusal(
      AUDIT_ACTION_DISCOVERY_REFUSED,
      connectorId,
      context,
      requestId,
      error instanceof NotFoundError ? 'CONNECTOR_NOT_FOUND' : 'PERMISSION_DENIED'
    );
    throw error;
  }
  if (record === null) {
    recordRefusal(AUDIT_ACTION_DISCOVERY_REFUSED, connectorId, context, requestId, 'CONNECTOR_NOT_FOUND');
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  enforceMcpQuota('discovery', connectorId, context, requestId);
  const bearer = store.revealConnectorSecret(context.tenantId, connectorId);
  const client = buildClient(
    record,
    bearer,
    REMOTE_MCP_DEFAULT_TIMEOUT_MS,
    runtimeForTests?.clientFactory ?? defaultClientFactory
  );
  let tools: RemoteMcpToolDescriptor[];
  try {
    tools = await collectRemoteTools(client, requestId);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_DISCOVERY_REFUSED, connectorId, context, requestId, 'DISCOVERY_REFUSED');
    throw error;
  }
  const policies = new Map<string, RemoteMcpToolPolicy>(
    store.listToolPolicies(context.tenantId, connectorId).map((policy) => [policy.toolName, policy] as const)
  );
  let schemaInvalidCount = 0;
  let displayTruncatedCount = 0;
  const entries = tools.map((descriptor) => {
    if (!isPlainObject(descriptor.inputSchema)) {
      schemaInvalidCount += 1;
      return discoveryEntry(descriptor, null, 'INVALID', null, NO_APPROVAL);
    }
    try {
      const canonical = stableStringifyCanonical(descriptor.inputSchema);
      const hash = remoteMcpCanonicalSha256(descriptor.inputSchema);
      const truncated = Buffer.byteLength(canonical, 'utf8') > DISCOVERY_MAX_SCHEMA_BYTES;
      if (truncated) {
        displayTruncatedCount += 1;
      }
      const policy = policies.get(descriptor.name) ?? null;
      const approval: DiscoveryApprovalView =
        policy === null
          ? NO_APPROVAL
          : {
              status: policy.status,
              approvedSchemaSha256: policy.schemaSha256,
              // Dérive : l'outil APPROVED ne matche plus le schéma actuellement
              // déclaré par le serveur distant (l'exécution B3 re-vérifiera
              // ce hash AVANT tout appel — refus en cas de dérive).
              drift: policy.status === 'APPROVED' && policy.schemaSha256 !== hash
            };
      return discoveryEntry(
        descriptor,
        truncated ? null : descriptor.inputSchema,
        truncated ? 'DISPLAY_TRUNCATED' : 'OK',
        hash,
        approval
      );
    } catch (error) {
      if (!(error instanceof RemoteMcpCanonicalError)) throw error;
      schemaInvalidCount += 1;
      return discoveryEntry(descriptor, null, 'INVALID', null, NO_APPROVAL);
    }
  });

  // Journal : COMPTEURS seuls — aucun nom d'outil, aucune description,
  // aucun schéma (contenus distants non fiables).

  recordAudit(AUDIT_ACTION_TOOLS_DISCOVERED, connectorId, context, requestId, {
    toolCount: entries.length,
    schemaInvalidCount,
    displayTruncatedCount
  });
  reply(res, 200, {
    connector: { connectorId: record.connectorId, name: record.name, enabled: record.enabled },
    tools: entries,
    schemaInvalidCount,
    displayTruncatedCount,
    requestId
  });
}

/**
 * POST /connectors/:id/tools/:toolName/approve — approbation explicite
 * (TENANT_MANAGE, OWNER seul).
 * Provenance obligatoire : le schéma hashé vient EXCLUSIVEMENT d'un
 * `tools/list` frais ré-émis ICI-MÊME au serveur distant courant ; le corps
 * de la requête n'est lu que pour `timeoutMs` (facultatif) — TOUT autre
 * champ, notamment `inputSchema`, est IGNORÉ (un schéma reçu du navigateur
 * n'est jamais une preuve). Le hash canonique est recalculé côté serveur
 * (canonical-json C3.2-B1) et lié au nom EXACT de l'outil.
 * TOCTOU gardé : ré-lecture synchrone du connecteur immédiatement avant
 * l'écriture (aucune attente entre lecture et commit — mono-thread) ; si
 * l'URL a changé pendant l'interrogation → 409 `MCP_REMOTE_DRIFT` SANS
 * écriture ; la révocation atomique D3 du PATCH complète ce verrou.
 * Autorisé sur connecteur désactivé (acte de gestion, D5).
 */
async function handleApproveTool(
  req: IncomingMessage,
  res: ServerResponse,
  connectorId: string,
  toolName: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  const store = getConnectorStore();
  const record = store.getConnector(context.tenantId, connectorId);
  try {
    if (record === null) {
      assertPermission(context.role, 'TENANT_MANAGE', requestId);
    } else {
      // LOT UI-MCP — tenant → TENANT_MANAGE ; non-tenant → propriétaire JWT.
      assertConnectorManagementAccess(record, context, requestId, 'TENANT_MANAGE');
    }
  } catch (error) {
    recordRefusal(
      AUDIT_ACTION_APPROVE_REFUSED,
      connectorId,
      context,
      requestId,
      error instanceof NotFoundError ? 'CONNECTOR_NOT_FOUND' : 'PERMISSION_DENIED'
    );
    throw error;
  }
  if (record === null) {
    recordRefusal(AUDIT_ACTION_APPROVE_REFUSED, connectorId, context, requestId, 'CONNECTOR_NOT_FOUND');
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  if (!TOOL_NAME_PATTERN.test(toolName)) {
    recordRefusal(AUDIT_ACTION_APPROVE_REFUSED, connectorId, context, requestId, 'INPUT_INVALID', {
      toolName: toolName.slice(0, 48)
    });
    throw new ValidationError("Nom d'outil invalide");
  }
  const body = await parseJsonObjectBody(req, requestId);
  const timeoutMs = clampTimeoutMs(body.timeoutMs);

  const bearer = store.revealConnectorSecret(context.tenantId, connectorId);
  const client = buildClient(
    record,
    bearer,
    timeoutMs,
    runtimeForTests?.clientFactory ?? defaultClientFactory
  );
  let tools: RemoteMcpToolDescriptor[];
  try {
    tools = await collectRemoteTools(client, requestId);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_APPROVE_REFUSED, connectorId, context, requestId, 'DISCOVERY_REFUSED');
    throw error;
  }
  const descriptor = tools.find((tool) => tool.name === toolName);
  if (descriptor === undefined) {
    recordRefusal(AUDIT_ACTION_APPROVE_REFUSED, connectorId, context, requestId, 'TOOL_NOT_FOUND', {
      toolName
    });
    throw new NotFoundError('Outil MCP distant', requestId);
  }
  if (!isPlainObject(descriptor.inputSchema)) {
    // Fail-closed : approbation impossible sans modèle d'entrée JSON objet ;
    // AUCUNE ligne de politique écrite ("schéma invalide" exigé par le GO).
    recordRefusal(AUDIT_ACTION_APPROVE_REFUSED, connectorId, context, requestId, 'SCHEMA_INVALID', {
      toolName
    });
    throw new ValidationError("Schéma d'entrée de l'outil refusé (objet JSON requis)");
  }
  let schemaSha256: RemoteMcpSha256Hex;
  try {
    schemaSha256 = remoteMcpCanonicalSha256(descriptor.inputSchema);
  } catch (error) {
    if (!(error instanceof RemoteMcpCanonicalError)) throw error;
    recordRefusal(AUDIT_ACTION_APPROVE_REFUSED, connectorId, context, requestId, 'SCHEMA_INVALID', {
      toolName
    });
    throw new ValidationError("Schéma d'entrée hors modèle JSON canonique (refus fail-closed)");
  }

  // TOCTOU : l'URL utilisée pour l'interrogation doit être CELLE du connecteur
  // au moment du commit (mutation concurrente committed → refus, sans
  // écriture). Limite résiduelle documentée : déploiement à UNE instance
  // (mono-processus) ; le verrou SQLite sérialise ce que le process voit.
  const fresh = store.getConnector(context.tenantId, connectorId);
  if (fresh === null) {
    recordRefusal(AUDIT_ACTION_APPROVE_REFUSED, connectorId, context, requestId, 'CONNECTOR_NOT_FOUND');
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  if (fresh.url !== record.url) {
    recordRefusal(AUDIT_ACTION_APPROVE_REFUSED, connectorId, context, requestId, 'APPROVAL_URL_DRIFT');
    throw new AppError(
      "URL du connecteur modifiée pendant la demande d'approbation : refus, réitérez",
      'MCP_REMOTE_DRIFT',
      409,
      undefined,
      requestId
    );
  }

  const policy = store.approveTool({
    tenantId: context.tenantId,
    connectorId,
    toolName,
    schemaSha256,
    approvedBy: (context.userId || context.role).slice(0, 128)
  });

  // Journal : nom d'outil + EMPREINTE (hex 64) seuls — ni schéma, ni description.
  recordAudit(AUDIT_ACTION_TOOL_APPROVED, connectorId, context, requestId, {
    toolName: policy.toolName,
    schemaSha256: policy.schemaSha256
  });
  reply(res, 200, {
    approval: {
      toolName: policy.toolName,
      schemaSha256: policy.schemaSha256,
      status: policy.status,
      approvedBy: policy.approvedBy,
      approvedAt: policy.approvedAt,
      updatedAt: policy.updatedAt
    },
    requestId
  });
}

/**
 * POST /connectors/:id/tools/:toolName/revoke — révocation explicite
 * (TENANT_MANAGE, OWNER seul). AUCUN contact réseau. Idempotente si une
 * politique existe déjà (APPROVED ou REVOKED) ; 404 si aucune (jamais
 * d'auto-création d'une politique par une révocation).
 */
async function handleRevokeTool(
  res: ServerResponse,
  connectorId: string,
  toolName: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  const store = getConnectorStore();
  // Indiscernabilité inter-tenant : 404 unique si connecteur absent.
  const record = store.getConnector(context.tenantId, connectorId);
  if (record === null) {
    // Historique : permission d'abord (403 avant 404) sur connecteur absent.
    assertPermission(context.role, 'TENANT_MANAGE', requestId);
    recordRefusal(AUDIT_ACTION_REVOKE_REFUSED, connectorId, context, requestId, 'CONNECTOR_NOT_FOUND');
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  try {
    // LOT UI-MCP — tenant → TENANT_MANAGE ; non-tenant → propriétaire JWT.
    assertConnectorManagementAccess(record, context, requestId, 'TENANT_MANAGE');
  } catch (error) {
    recordRefusal(
      AUDIT_ACTION_REVOKE_REFUSED,
      connectorId,
      context,
      requestId,
      error instanceof NotFoundError ? 'CONNECTOR_NOT_FOUND' : 'PERMISSION_DENIED'
    );
    throw error;
  }
  if (!TOOL_NAME_PATTERN.test(toolName)) {
    recordRefusal(AUDIT_ACTION_REVOKE_REFUSED, connectorId, context, requestId, 'INPUT_INVALID', {
      toolName: toolName.slice(0, 48)
    });
    throw new ValidationError("Nom d'outil invalide");
  }
  const revoked = store.revokeTool(context.tenantId, connectorId, toolName);
  if (!revoked) {
    recordRefusal(AUDIT_ACTION_REVOKE_REFUSED, connectorId, context, requestId, 'APPROVAL_ABSENT', {
      toolName
    });
    throw new NotFoundError('Approbation pour cet outil MCP distant', requestId);
  }
  recordAudit(AUDIT_ACTION_TOOL_REVOKED, connectorId, context, requestId, { toolName });
  reply(res, 200, { revocation: { toolName, status: 'REVOKED' }, requestId });
}

/* ---------------------------------------------------------------------------
 * B3 — Helpers identité / arguments
 * ------------------------------------------------------------------------- */

/**
 * Identité individ低 fiable OBLIGATOIRE pour préparer et exécuter (GO §2.B1) :
 * `userId` provient EXCLUSIVEMENT du JWT signé (D7) — la clé API (identité
 * partagée) et le repli dev (en-têtes spoofables) n'en portent PAS et sont
 * donc REFUSÉS ici, sans substitution silencieuse.
 */
function requireTrustedUserId(context: RequestContext): string {
  if (typeof context.userId !== 'string' || context.userId.length === 0) {
    throw new ForbiddenError(
      'Identité utilisateur individuelle requise (JWT signé) : les opérations MCP distantes ne se lient jamais à une identité fabriquée'
    );
  }
  return context.userId;
}

/** Arguments = objet JSON (contrat client tools/call) ; {} admis. */
function requireArgumentsObject(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ValidationError('arguments requis (objet JSON)');
  }
  return value;
}

/**
 * Hachage canonique des arguments SOUMIS (GO exécution no°5) avec bornes
 * fail-closed : profondeur/types hors modèle JSON → 400 ; charge canonique
 * au-delà de `ARGS_MAX_CANONICAL_BYTES` → 400. AUCUN réseau, aucun contenu
 * distant ni d'argument reflété dans le message.
 */
function hashArguments(args: Record<string, unknown>): RemoteMcpSha256Hex {
  let canonical: string;
  try {
    canonical = stableStringifyCanonical(args);
  } catch (error) {
    if (error instanceof RemoteMcpCanonicalError) {
      throw new ValidationError("arguments hors modèle JSON canonique (profondeur ou type refusé)");
    }
    throw error;
  }
  if (Buffer.byteLength(canonical, 'utf8') > ARGS_MAX_CANONICAL_BYTES) {
    throw new ValidationError(`arguments trop volumineux (charge canonique > ${ARGS_MAX_CANONICAL_BYTES} octets)`);
  }
  return remoteMcpCanonicalSha256(args);
}

/**
 * Mapping fail-closed du résultat de `consume()` :
 *   NOT_FOUND → 404 (indiscernable tenant/utilisateur/outil) ;
 *   EXPIRED / REPLAY / BINDING_MISMATCH → 409 `MCP_REMOTE_DRIFT` (état divergé :
 *   l'opération consentie n'est plus celle-ci). Dans TOUS les cas, AUCUN
 *   tools/call n'a été émis (la consommation PRÉCÈDE l'appel distant d'outil).
 */
function refusalFromConsume(
  consume: Exclude<RemoteMcpConfirmationResult, { consumed: true }>,
  requestId: string
): AppError {
  if (consume.reason === 'NOT_FOUND') {
    return new NotFoundError('Confirmation de préparation MCP distante', requestId);
  }
  const messages: Record<Exclude<RemoteMcpConfirmationFailure, 'NOT_FOUND'>, string> = {
    EXPIRED: 'Confirmation expirée : opération refusée, préparez à nouveau',
    REPLAY: 'Confirmation déjà consommée : rejeu refusé',
    BINDING_MISMATCH: 'Confirmation non liée à cette opération exacte (identité, outil, schéma ou arguments modifiés)'
  };
  return new AppError(messages[consume.reason], 'MCP_REMOTE_DRIFT', 409, undefined, requestId);
}

/* ---------------------------------------------------------------------------
 * B3 — Handlers : préparation / exécution (SEUL lot émettant tools/call,
 * strictement après consommation atomique de la confirmation)
 * ------------------------------------------------------------------------- */

/**
 * POST /connectors/:id/tools/:toolName/prepare — préparation (GO §2.A) :
 *   identité JWT fiable → tenant → connecteur EXISTANT ET ACTIVÉ (prepare/
 *   execute exigent `enabled`, cf. D5) → ré-interrogation du distant →
 *   hash canonique du schéma recalculé → approbation APPROVED EXACTE dudit
 *   couple → validation/borne des arguments → confirmation anti-rejeu
 *   à durée limitée, liée à (tenant, JETON sub, connecteur, outil, schéma,
 *   arguments). AUCUN tools/call ici (même en cas de réussite).
 * Réponse 201 : confirmationId, expiresAt (epoch ms), empreintes (non
 * secrètes). Les arguments ne sont PAS renvoyés (l'appelant les connaît).
 */
async function handlePrepareTool(
  req: IncomingMessage,
  res: ServerResponse,
  connectorId: string,
  toolName: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  const prepareStartedAt = Date.now();
  try {
    assertPermission(context.role, 'MCP_REMOTE_INVOKE', requestId);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'PERMISSION_DENIED');
    throw error;
  }
  let userId: string;
  try {
    userId = requireTrustedUserId(context);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'IDENTITY_UNTRUSTED');
    throw error;
  }
  if (!TOOL_NAME_PATTERN.test(toolName)) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'INPUT_INVALID', {
      toolName: toolName.slice(0, 48)
    });
    throw new ValidationError("Nom d'outil invalide");
  }
  const body = await parseJsonObjectBody(req, requestId);
  const timeoutMs = clampTimeoutMs(body.timeoutMs);
  let argsSha256: RemoteMcpSha256Hex;
  try {
    argsSha256 = hashArguments(requireArgumentsObject(body.arguments));
  } catch (error) {
    if (error instanceof ValidationError) {
      recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'INPUT_INVALID');
      throw error;
    }
    throw error;
  }

  const store = getConnectorStore();
  const record = store.getConnector(context.tenantId, connectorId);
  if (record === null) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'CONNECTOR_NOT_FOUND');
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  try {
    // LOT UI-MCP — préparation : propriétaire des lignes non-tenant UNIQUEMENT
    // (lignes tenant : tout détenteur de MCP_REMOTE_INVOKE, historique).
    assertConnectorOwnership(record, context, requestId);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'CONNECTOR_NOT_FOUND');
    throw error;
  }
  if (!record.enabled) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'CONNECTOR_DISABLED');
    throw new AppError(
      'Connecteur MCP distant désactivé : préparation refusée (aucune interrogation réseau)',
      'MCP_REMOTE_DRIFT',
      409,
      undefined,
      requestId
    );
  }

  enforceMcpQuota('prepare', connectorId, context, requestId);
  const bearer = store.revealConnectorSecret(context.tenantId, connectorId);
  const client = buildClient(record, bearer, timeoutMs, runtimeForTests?.clientFactory ?? defaultClientFactory);
  let tools: RemoteMcpToolDescriptor[];
  try {
    tools = await collectRemoteTools(client, requestId);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'DISCOVERY_REFUSED');
    throw error;
  }
  const descriptor = tools.find((tool) => tool.name === toolName);
  if (descriptor === undefined) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'TOOL_NOT_FOUND', {
      toolName
    });
    throw new NotFoundError('Outil MCP distant', requestId);
  }
  if (!isPlainObject(descriptor.inputSchema)) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'SCHEMA_INVALID', {
      toolName
    });
    throw new ValidationError("Schéma d'entrée de l'outil refusé (objet JSON requis)");
  }
  let schemaSha256: RemoteMcpSha256Hex;
  try {
    schemaSha256 = remoteMcpCanonicalSha256(descriptor.inputSchema);
  } catch (error) {
    if (!(error instanceof RemoteMcpCanonicalError)) throw error;
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'SCHEMA_INVALID', {
      toolName
    });
    throw new ValidationError("Schéma d'entrée hors modèle JSON canonique (refus fail-closed)");
  }

  const policy = store
    .listToolPolicies(context.tenantId, connectorId)
    .find((candidate) => candidate.toolName === toolName);
  if (policy === undefined) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'TOOL_NOT_APPROVED', {
      toolName, schemaSha256
    });
    throw new ForbiddenError("Outil non approuvé pour ce connecteur (aucune approbation)");
  }
  if (policy.status !== 'APPROVED') {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'TOOL_APPROVAL_REVOKED', {
      toolName, schemaSha256
    });
    throw new ForbiddenError("Approbation révoquée pour cet outil : préparation refusée");
  }
  if (policy.schemaSha256 !== schemaSha256) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, connectorId, context, requestId, 'APPROVAL_SCHEMA_DRIFT', {
      toolName, schemaSha256
    });
    throw new AppError(
      "Schéma de l'outil dérivé depuis l'approbation : préparation refusée, ré-approbation requise",
      'MCP_REMOTE_DRIFT',
      409,
      undefined,
      requestId
    );
  }

  const confirmation = getConfirmationStore().issue({
    tenantId: context.tenantId,
    userId,
    connectorId,
    toolName,
    schemaSha256,
    argsSha256,
    ttlMs: CONFIRMATION_FIXED_TTL_MS
  });

  recordToolDuration('prepare', 'ok', Date.now() - prepareStartedAt, policy.toolName);
  recordAudit(AUDIT_ACTION_TOOL_PREPARED, connectorId, context, requestId, {
    toolName: policy.toolName,
    schemaSha256: policy.schemaSha256,
    argsSha256,
    confirmationId: confirmation.confirmationId
  });
  reply(res, 201, {
    confirmation: {
      confirmationId: confirmation.confirmationId,
      toolName: confirmation.toolName,
      schemaSha256: confirmation.schemaSha256,
      argsSha256: confirmation.argsSha256,
      expiresAt: confirmation.expiresAt
    },
    requestId
  });
}

/**
 * POST /connectors/:id/tools/:toolName/call — exécution (GO §2.B) :
 *   identité JWT re-vérifiée → tenant → connecteur ACTIF + URL inchangée
 *   pendant la demande → ré-interrogation du distant (tools/list, métadonnées)
 *   → hash du schéma recalculé → approbation vivante APPROVED exacte →
 *   hachage des arguments soumis → **CONSOMMATION ATOMIQUE de la confirmation
 *   (binding identité/outil/schéma/args)** → et SEULEMENT alors un unique
 *   `tools/call`.
 *
 *   Ordre conforme au GO : 1 identity → 2 state → 3 ré-interrogation →
 *   4 approbation vivante → 5/6 comparaison args + consume() (le binding
 *   C3.1 vérifie identité/outil/schéma/args ATOMIQUEMENT à la consommation)
 *   → 7 aucun contrôle défaillant n'atteint tools/call → 8 confirmation
 *   unique (rejeu/expiration/binding impossible au second passage).
 */
async function handleCallTool(
  req: IncomingMessage,
  res: ServerResponse,
  connectorId: string,
  toolName: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  const callStartedAt = Date.now();
  try {
    assertPermission(context.role, 'MCP_REMOTE_INVOKE', requestId);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'PERMISSION_DENIED');
    throw error;
  }
  let userId: string;
  try {
    userId = requireTrustedUserId(context);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'IDENTITY_UNTRUSTED');
    throw error;
  }
  if (!TOOL_NAME_PATTERN.test(toolName)) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'INPUT_INVALID', {
      toolName: toolName.slice(0, 48)
    });
    throw new ValidationError("Nom d'outil invalide");
  }
  const body = await parseJsonObjectBody(req, requestId);
  if (typeof body.confirmationId !== 'string' || body.confirmationId.length === 0 || body.confirmationId.length > 64) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'INPUT_INVALID');
    throw new ValidationError('confirmationId obligatoire (1 à 64 caractères)');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(body.confirmationId)) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'INPUT_INVALID', {
      confirmationIdShape: 'invalid'
    });
    throw new ValidationError('confirmationId invalide');
  }
  const timeoutMs = clampTimeoutMs(body.timeoutMs);
  let args: Record<string, unknown>;
  let argsSha256: RemoteMcpSha256Hex;
  try {
    args = requireArgumentsObject(body.arguments);
    argsSha256 = hashArguments(args);
  } catch (error) {
    if (error instanceof ValidationError) {
      recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'INPUT_INVALID');
      throw error;
    }
    throw error;
  }

  const store = getConnectorStore();
  const record = store.getConnector(context.tenantId, connectorId);
  if (record === null) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'CONNECTOR_NOT_FOUND');
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  try {
    // LOT UI-MCP — exécution : propriétaire des lignes non-tenant UNIQUEMENT
    // (lignes tenant : tout détenteur de MCP_REMOTE_INVOKE, historique).
    assertConnectorOwnership(record, context, requestId);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'CONNECTOR_NOT_FOUND');
    throw error;
  }
  if (!record.enabled) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'CONNECTOR_DISABLED');
    throw new AppError(
      'Connecteur MCP distant désactivé : exécution refusée (aucune interrogation réseau)',
      'MCP_REMOTE_DRIFT',
      409,
      undefined,
      requestId
    );
  }
  enforceMcpQuota('call', connectorId, context, requestId);
  const bearer = store.revealConnectorSecret(context.tenantId, connectorId);
  const client = buildClient(record, bearer, timeoutMs, runtimeForTests?.clientFactory ?? defaultClientFactory);
  let tools: RemoteMcpToolDescriptor[];
  try {
    tools = await collectRemoteTools(client, requestId);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'DISCOVERY_REFUSED');
    throw error;
  }
  const descriptor = tools.find((tool) => tool.name === toolName);
  if (descriptor === undefined) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'TOOL_NOT_FOUND', {
      toolName
    });
    throw new NotFoundError('Outil MCP distant (disparu du serveur distant)', requestId);
  }
  if (!isPlainObject(descriptor.inputSchema)) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'SCHEMA_INVALID', {
      toolName
    });
    throw new ValidationError("Schéma d'entrée de l'outil refusé (objet JSON requis)");
  }
  let schemaSha256: RemoteMcpSha256Hex;
  try {
    schemaSha256 = remoteMcpCanonicalSha256(descriptor.inputSchema);
  } catch (error) {
    if (!(error instanceof RemoteMcpCanonicalError)) throw error;
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'SCHEMA_INVALID', {
      toolName
    });
    throw new ValidationError("Schéma d'entrée hors modèle JSON canonique (refus fail-closed)");
  }
  const policy = store
    .listToolPolicies(context.tenantId, connectorId)
    .find((candidate) => candidate.toolName === toolName);
  if (policy === undefined) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'TOOL_NOT_APPROVED', {
      toolName, schemaSha256
    });
    throw new ForbiddenError('Outil non approuvé pour ce connecteur');
  }
  if (policy.status !== 'APPROVED') {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'TOOL_APPROVAL_REVOKED', {
      toolName, schemaSha256
    });
    throw new ForbiddenError('Approbation révoquée : exécution refusée');
  }
  if (policy.schemaSha256 !== schemaSha256) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'APPROVAL_SCHEMA_DRIFT', {
      toolName, schemaSha256
    });
    throw new AppError(
      "Schéma de l'outil dérivé : exécution refusée, re-préparation et ré-approbation requises",
      'MCP_REMOTE_DRIFT',
      409,
      undefined,
      requestId
    );
  }

  // TOCTOU (identique à l'approbation B2) : ré-lecture synchrone immédiate —
  // l'URL interrogée et l'état du connecteur au moment du commit.
  const fresh = store.getConnector(context.tenantId, connectorId);
  if (fresh === null) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'CONNECTOR_NOT_FOUND');
    throw new NotFoundError('Connecteur MCP distant', requestId);
  }
  if (!fresh.enabled) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'CONNECTOR_DISABLED');
    throw new AppError(
      'Connecteur désactivé pendant la demande : exécution refusée',
      'MCP_REMOTE_DRIFT',
      409,
      undefined,
      requestId
    );
  }
  if (fresh.url !== record.url) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, 'URL_DRIFT');
    throw new AppError(
      "URL du connecteur modifiée pendant l'exécution : refus (les confirmations sont par ailleurs invalidées au PATCH)",
      'MCP_REMOTE_DRIFT',
      409,
      undefined,
      requestId
    );
  }

  // GO no°5+6 — comparaison des arguments soumis ET consommation atomique en
  // UN SEUL point de contrôle transactionnel (binding C3.1 : identité +
  // connecteur + outil + schéma + args). Échec ⇒ AUCUN tools/call.
  const outcome = getConfirmationStore().consume({
    tenantId: context.tenantId,
    userId,
    confirmationId: body.confirmationId,
    connectorId,
    toolName,
    schemaSha256,
    argsSha256
  });
  if (!outcome.consumed) {
    // C3.4 (§5) — le refus de consommation est journalisé avec une raison
    // structurée (expiration / rejeu / binding), PUIS l'erreur fail-closed
    // est levée. AUCUN tools/call n'a été émis.
    const refusalReason: RemoteMcpRefusalReason =
      outcome.reason === 'EXPIRED' ? 'CONFIRMATION_EXPIRED'
      : outcome.reason === 'REPLAY' ? 'CONFIRMATION_REPLAY'
      : outcome.reason === 'BINDING_MISMATCH' ? 'CONFIRMATION_BINDING_MISMATCH'
      : 'CONFIRMATION_NOT_FOUND';
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, connectorId, context, requestId, refusalReason, {
      toolName,
      schemaSha256,
      argsSha256,
      confirmationId: body.confirmationId
    });
    throw refusalFromConsume(outcome, requestId);
  }

  // Seul point du lot où tools/call peut être émis — AT-LEAST-ONCE devient
  // AT-MOST-ONCE par confirmation (consommation pré-réseau atomique).
  try {
    const result = await client.callTool(toolName, args);
    recordToolDuration('call', 'ok', Date.now() - callStartedAt, toolName);
    recordAudit(AUDIT_ACTION_TOOL_CALLED, connectorId, context, requestId, {
      toolName,
      schemaSha256,
      argsSha256,
      confirmationId: body.confirmationId,
      isError: result.isError
    });
    reply(res, 200, {
      result: {
        isError: result.isError,
        content: result.content,
        structuredContent: result.structuredContent
      },
      requestId
    });
  } catch (error) {
    if (error instanceof RemoteMcpClientError) {
      recordToolDuration('call', 'fail', Date.now() - callStartedAt, toolName);
      // Journal : code de transport SEUL — jamais le message ni le corps.
      recordAudit(AUDIT_ACTION_TOOL_CALL_FAILED, connectorId, context, requestId, {
        toolName,
        argsSha256,
        confirmationId: body.confirmationId,
        errorCode: error.code
      });
    }
    throw error; // normalisation standard (502/504/413/400), réponse unifiée
  }
}

/** GET /journal — événements du tenant (resourceType filtré), latest-first. */
async function handleJournal(
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'PROJECT_READ', requestId);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const limitRaw = url.searchParams.get('limit');
  if (limitRaw !== null && !/^\d{1,3}$/.test(limitRaw)) {
    throw new ValidationError('limit invalide (nombre ≤ 3 chiffres)');
  }
  const limit = limitRaw === null ? JOURNAL_DEFAULT_LIMIT : Math.min(Math.max(Number(limitRaw), 1), JOURNAL_MAX_LIMIT);
  const connectorId = url.searchParams.get('connectorId');
  if (connectorId !== null && connectorId !== '' && !CONNECTOR_ID_PATTERN.test(connectorId)) {
    throw new ValidationError('connectorId invalide');
  }
  const events = auditStore.query(context.tenantId, { resourceType: AUDIT_RESOURCE_TYPE });
  // LOT UI-MCP — propriété : les événements portant sur une ligne PERSONNELLE
  // ou une instance de CATALOGUE ne sont visibles que par leur propriétaire.
  // Appelant sans identité JWT (clé API / repli dev) : fail-closed, il ne voit
  // jamais ces événements. Les événements des lignes tenant restent inchangés.
  const ownerIndex = getConnectorStore().listNonTenantOwnerIndex(context.tenantId);
  const owned = events.filter((event) => {
    const owner = ownerIndex.get(event.resourceId);
    if (owner === undefined) return true;
    return context.userId !== undefined && context.userId !== '' && owner === context.userId;
  });
  const filtered = connectorId !== null && connectorId !== ''
    ? owned.filter((event) => event.resourceId === connectorId)
    : owned;
  const windowed = filtered.slice(-limit).reverse();
  reply(res, 200, {
    events: windowed.map((event) => ({
      id: event.id,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      status: event.status,
      userId: event.userId,
      requestId: event.requestId,
      timestamp: event.timestamp.toISOString(),
      metadata: event.metadata ?? null
    })),
    total: filtered.length,
    requestId
  });
}

/* ---------------------------------------------------------------------------
 * C3.2 — CRUD des configurations des serveurs MCP distants (contrat
 * « remote-servers »). Même RemoteMcpConnectorStore (source de vérité
 * unique, aucune donnée dupliquée), surface PUBlique distincte et strictement
 * bornée :
 *   GET    /api/v1/mcp/remote-servers          — liste du tenant (vue légère)
 *   GET    /api/v1/mcp/remote-servers/:id      — consultation (404 indiscernable)
 *   POST   /api/v1/mcp/remote-servers          — création (champs stricts)
 *   PATCH  /api/v1/mcp/remote-servers/:id      — liste blanche name/url/enabled/secret
 *   DELETE /api/v1/mcp/remote-servers/:id      — suppression (cascade du store)
 *
 * Contraintes contractuelles :
 *   - tenant : UNIQUEMENT context.tenantId (aucun champ du corps, jamais) ;
 *   - propriétés inconnues REFUSÉES (protection mass-assignment ; les routes
 *     /connectors historiques restent tolérantes — comportement inchangé) ;
 *   - transport : absent (défaut 'url') ou 'url' strictement (schema CHECK) ;
 *   - secret : optionnel à la création ; PATCH ne le remplace QUE s'il est
 *     explicitement porte dans la requête (chiffrement via le store) ;
 *   - vue JAMAIS de plaintext, jamais d'exercice cryptographique (pas de
 *     keyId, pas d'enveloppe) : uniquement secretPresent ;
 *   - dernier état de test du connecteur inclus lorqu'il existe
 *     (store.getLastTest — le suivi est écrit par POST /connectors/:id/test).
 *
 * HORS PÉRIMÈTRE (reportés) : SSRF réseau réel (C3.3 — validateRemoteMcpUrl
 * ici ne finance que la pré-validation locale déjà existante), permissions
 * d'outils (C3.4), interface Studio (C3.5).
 * ------------------------------------------------------------------------- */

const SERVERS_PREFIX = '/api/v1/mcp/remote-servers';

/**
 * C3.2 — Vue « remote-servers » : configuration du tenant, dernier état de
 * test lorsqu'il existe. AUCUN contenu cryptographique (pas keyId), aucune
 * politique d'outils (surface /connectors), aucun champ interne du store.
 */
function remoteServerView(
  record: RemoteMcpConnectorRecord,
  lastTest: RemoteMcpLastTest | null
): Record<string, unknown> {
  return {
    connectorId: record.connectorId,
    name: record.name,
    url: record.url,
    transport: record.transport,
    enabled: record.enabled,
    secretPresent: record.secretMeta !== null,
    lastTest: lastTest === null ? null : { at: lastTest.at, status: lastTest.status, detail: lastTest.detail },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

/**
 * C3.2 — Rejet DES propriétés inconnues (mass-assignment FAIL-CLOSED) : la
 * liste autorisée est exhaustive ; le message cite les clés refusées (noms
 * SEULS — jamais les valeurs, qui pourraient porter un secret).
 */
function requireOnlyAllowedFields(
  body: Record<string, unknown>,
  allowed: readonly string[]
): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(
      `propriétés non autorisées dans le corps : ${unknown.slice(0, 8).join(', ')}`
    );
  }
}

/** GET /mcp/remote-servers — liste du tenant authentifié (vue légère + état de test). */
async function handleListRemoteServers(
  res: ServerResponse,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'PROJECT_READ', requestId);
  const store = getConnectorStore();
  const records = store.listConnectors(context.tenantId);
  const servers = records.map((record) =>
    remoteServerView(record, store.getLastTest(context.tenantId, record.connectorId))
  );
  // Resource bornée par tenant (création TENANT_MANAGE) : pas de pagination
  // (conventions : seuls les journaux (limit/offset) paginent). `total` affiché.
  reply(res, 200, { servers, total: servers.length, requestId });
}

async function handleGetRemoteServer(
  res: ServerResponse,
  connectorId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'PROJECT_READ', requestId);
  const store = getConnectorStore();
  const record = store.getConnector(context.tenantId, connectorId);
  if (record === null) {
    // Indiscernable pour un connecteur d'un autre tenant (aucun oracle).
    throw new NotFoundError('Serveur MCP distant', requestId);
  }
  reply(res, 200, {
    server: remoteServerView(record, store.getLastTest(context.tenantId, record.connectorId)),
    requestId
  });
}

async function handleCreateRemoteServer(
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'TENANT_MANAGE', requestId);
  const body = await parseJsonObjectBody(req, requestId);
  // Mass-assignment : refus FAIL-CLOSED des champs hors contrat. Le tenant
  // (tenant_id, et tout alias) est REFUSÉ — l'autorité est contextuelle.
  requireOnlyAllowedFields(body, ['name', 'url', 'secret', 'transport']);
  const name = requireName(body.name);
  const url = requireUrl(body.url);
  const secret = requireOptionalSecret(body.secret);
  if (body.transport !== undefined && body.transport !== 'url') {
    throw new ValidationError('transport ne peut être que "url" (seul transport pris en charge)');
  }

  const store = getConnectorStore();
  const created = store.createConnector({ tenantId: context.tenantId, name, url });
  if (secret !== undefined) {
    store.setConnectorSecret(context.tenantId, created.connectorId, secret);
  }
  const final = store.getConnector(context.tenantId, created.connectorId);
  if (final === null) {
    throw new AppError('Serveur MCP distant introuvable après création', 'INTERNAL_ERROR', 500, undefined, requestId);
  }
  recordAudit(AUDIT_ACTION_CREATED, final.connectorId, context, requestId, {
    transport: 'url',
    surface: 'remote-servers'
  });
  reply(res, 201, {
    server: remoteServerView(final, store.getLastTest(context.tenantId, final.connectorId)),
    requestId
  });
}

/**
 * PATCH /mcp/remote-servers/:id — liste blanche EXPLICITE name/url/enabled/
 * secret. tenant_id et identifiants internes : HORS liste (refus par le
 * contrôle des champs inconnus → jamais modifiables via cette route).
 * Ordre(existant B1) : validations COMPLÈTES avant toute écriture, puis
 * url d'abord (révocation atomique D3), name, enabled, secret (explicit SEUL).
 * Comportement d'échec partiel : chaque écriture store est autonome (comme
 * PATCH /connectors) — une erreur d'infrastructure en milieu de séquence
 * peut laisser un état partiel ; l'audit journalise les champs DEMANDÉS.
 */
async function handlePatchRemoteServer(
  req: IncomingMessage,
  res: ServerResponse,
  connectorId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'TENANT_MANAGE', requestId);
  const body = await parseJsonObjectBody(req, requestId);
  requireOnlyAllowedFields(body, ['name', 'url', 'enabled', 'secret']);
  const hasName = body.name !== undefined;
  const hasUrl = body.url !== undefined;
  const hasEnabled = body.enabled !== undefined;
  const hasSecret = body.secret !== undefined;
  if (!hasName && !hasUrl && !hasEnabled && !hasSecret) {
    throw new ValidationError('aucun champ à modifier (name / url / enabled / secret requis)');
  }
  const name = hasName ? requireName(body.name) : undefined;
  const url = hasUrl ? requireUrl(body.url) : undefined;
  const enabled = hasEnabled ? requireEnabled(body.enabled) : undefined;
  const secret = hasSecret ? requireOptionalSecret(body.secret) : undefined;

  const store = getConnectorStore();
  let revokedToolNames: readonly string[] | undefined;
  let invalidatedConfirmations: number | undefined;
  if (url !== undefined) {
    const outcome = store.setConnectorUrlRevokingPolicies(context.tenantId, connectorId, url);
    if (outcome.revokedToolNames.length > 0) {
      revokedToolNames = outcome.revokedToolNames;
    }
    invalidatedConfirmations = outcome.invalidatedConfirmations;
  }
  if (name !== undefined) {
    store.setConnectorName(context.tenantId, connectorId, name);
  }
  if (enabled !== undefined) {
    store.setConnectorEnabled(context.tenantId, connectorId, enabled);
  }
  if (secret !== undefined) {
    // Remplacement EXPLICITE : la clé jamais renvoyée, le secret jamais relu.
    store.setConnectorSecret(context.tenantId, connectorId, secret);
  }

  const record = store.getConnector(context.tenantId, connectorId);
  if (record === null) {
    throw new NotFoundError('Serveur MCP distant', requestId);
  }
  const fields: string[] = [];
  if (name !== undefined) fields.push('name');
  if (url !== undefined) fields.push('url');
  if (enabled !== undefined) fields.push('enabled');
  if (secret !== undefined) fields.push('secret');
  recordAudit(
    AUDIT_ACTION_UPDATED,
    connectorId,
    context,
    requestId,
    {
      fields,
      revokedPoliciesCount: revokedToolNames !== undefined ? revokedToolNames.length : 0,
      surface: 'remote-servers'
    }
  );
  const payload: Record<string, unknown> = {
    server: remoteServerView(record, store.getLastTest(context.tenantId, record.connectorId)),
    requestId
  };
  if (revokedToolNames !== undefined) {
    payload.revokedToolNames = [...revokedToolNames];
  }
  if (invalidatedConfirmations !== undefined) {
    payload.invalidatedConfirmations = invalidatedConfirmations;
  }
  reply(res, 200, payload);
}

async function handleDeleteRemoteServer(
  res: ServerResponse,
  connectorId: string,
  context: RequestContext,
  requestId: string
): Promise<void> {
  assertPermission(context.role, 'TENANT_MANAGE', requestId);
  const store = getConnectorStore();
  // Cascade du store (politiques + confirmations du couple tenant/connecteur).
  // AUCUNE suppression GLOBAL ni plateforme : portée strictement (tenant, id).
  const removed = store.deleteConnector(context.tenantId, connectorId);
  if (!removed) {
    throw new NotFoundError('Serveur MCP distant', requestId);
  }
  recordAudit(AUDIT_ACTION_DELETED, connectorId, context, requestId, { surface: 'remote-servers' });
  reply(res, 200, { removed: true, requestId });
}

/* ---------------------------------------------------------------------------
 * Dispatcher
 * ------------------------------------------------------------------------- */

const CONNECTORS_PATTERN = new RegExp(
  `^${PREFIX}/connectors(?:/(${CONNECTOR_ID_SOURCE}))?(?:/(test|secret))?$`
);

/** C3.2 — Router sockets remote-servers : GET/POST list, :id consultation/édition/suppression. */
const SERVERS_PATTERN = new RegExp(
  `^${SERVERS_PREFIX}(?:/(${CONNECTOR_ID_SOURCE}))?$`
);

/**
 * B2 — découverte et approbation/révocation d'outils ; B3 — préparation et
 * exécution (SEUL lot émettant tools/call, après confirmation consommée) :
 *   GET  /connectors/:id/tools
 *   POST /connectors/:id/tools/:toolName/approve
 *   POST /connectors/:id/tools/:toolName/revoke
 *   POST /connectors/:id/tools/:toolName/prepare   (B3 — aucun tools/call)
 *   POST /connectors/:id/tools/:toolName/call      (B3 — exécution unique)
 */
const CONNECTORS_TOOLS_PATTERN = new RegExp(
  `^${PREFIX}/connectors/(${CONNECTOR_ID_SOURCE})/tools(?:/(${TOOL_NAME_SOURCE})/(approve|revoke|prepare|call))?$`
);

/**
 * Point d'entrée du mini-routeur (table API_ROUTES de server.ts).
 * Retourne false pour toute requête hors périmètre → 404 central, inchangé.
 */
export async function handleMcpRemoteRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  if (!pathname.startsWith(`${PREFIX}/`) && !pathname.startsWith(SERVERS_PREFIX)) return false;
  try {
    // B4 (décision 5) — quota « connecteurs » : toute ÉCRITURE de gestion
    // (création/modification/secret/test) est limitée par tenant et par
    // utilisateur. Les lectures (GET) ne consomment pas ce quota.
    const isConnectorWrite =
      (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT' || req.method === 'DELETE')
      && (pathname.includes('/connectors') || pathname.includes('/mcp/remote-servers'));
    if (isConnectorWrite) {
      const idMatch = pathname.match(/\/(?:connectors|remote-servers)\/([A-Za-z0-9][A-Za-z0-9._:@-]{0,63})/);
      enforceMcpQuota('connectors', idMatch?.[1] ?? 'new', context, requestId);
    }
    if (pathname === `${PREFIX}/connectors` && req.method === 'GET') {
      await handleListConnectors(req, res, context, requestId);
      return true;
    }
    if (pathname === `${PREFIX}/connectors` && req.method === 'POST') {
      await handleCreateConnector(req, res, context, requestId);
      return true;
    }
    if (pathname === `${PREFIX}/journal` && req.method === 'GET') {
      await handleJournal(req, res, context, requestId);
      return true;
    }
    // C3.2 — contrat remote-servers : routes dédiées sur le même store :
    //   GET/POST /api/v1/mcp/remote-servers ; GET/PATCH/DELETE /:id.
    // Méthodes non couvertes d'une route reconnue → 404 central (return false).
    const serversMatch = SERVERS_PATTERN.exec(pathname);
    if (serversMatch !== null) {
      const serverId = serversMatch[1];
      if (serverId === undefined) {
        if (req.method === 'GET') {
          await handleListRemoteServers(res, context, requestId);
          return true;
        }
        if (req.method === 'POST') {
          await handleCreateRemoteServer(req, res, context, requestId);
          return true;
        }
      } else if (req.method === 'GET') {
        await handleGetRemoteServer(res, serverId, context, requestId);
        return true;
      } else if (req.method === 'PATCH') {
        await handlePatchRemoteServer(req, res, serverId, context, requestId);
        return true;
      } else if (req.method === 'DELETE') {
        await handleDeleteRemoteServer(res, serverId, context, requestId);
        return true;
      }
      return false;
    }
    const match = CONNECTORS_PATTERN.exec(pathname);
    if (match !== null && match[1] !== undefined) {
      const connectorId = match[1];
      const action = match[2];
      if (action === undefined) {
        if (req.method === 'GET') {
          await handleGetConnector(res, connectorId, context, requestId);
          return true;
        }
        if (req.method === 'PATCH') {
          await handlePatchConnector(req, res, connectorId, context, requestId);
          return true;
        }
        if (req.method === 'DELETE') {
          await handleDeleteConnector(res, connectorId, context, requestId);
          return true;
        }
      } else if (action === 'test' && req.method === 'POST') {
        await handleTestConnection(req, res, connectorId, context, requestId);
        return true;
      } else if (action === 'secret') {
        if (req.method === 'PUT') {
          await handleSetSecret(req, res, connectorId, context, requestId);
          return true;
        }
        if (req.method === 'DELETE') {
          await handleRemoveSecret(res, connectorId, context, requestId);
          return true;
        }
      }
    }
    const toolsMatch = CONNECTORS_TOOLS_PATTERN.exec(pathname);
    if (toolsMatch !== null) {
      const connectorId = toolsMatch[1];
      const toolNameSegment = toolsMatch[2];
      const toolAction = toolsMatch[3];
      if (connectorId !== undefined && toolNameSegment === undefined && req.method === 'GET') {
        await handleListRemoteTools(res, connectorId, context, requestId);
        return true;
      }
      if (connectorId !== undefined && toolNameSegment !== undefined && req.method === 'POST') {
        if (toolAction === 'approve') {
          await handleApproveTool(req, res, connectorId, toolNameSegment, context, requestId);
          return true;
        }
        if (toolAction === 'revoke') {
          await handleRevokeTool(res, connectorId, toolNameSegment, context, requestId);
          return true;
        }
        if (toolAction === 'prepare') {
          await handlePrepareTool(req, res, connectorId, toolNameSegment, context, requestId);
          return true;
        }
        if (toolAction === 'call') {
          await handleCallTool(req, res, connectorId, toolNameSegment, context, requestId);
          return true;
        }
      }
      return false; // méthode/chemin de ce sous-arbre non couverts (404 central)
    }
    return false; // méthode/chemin inconnu de ce sous-arbre
  } catch (error) {
    throw toApiError(error, requestId);
  }
}
