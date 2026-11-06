/**
 * VibeCode Core - API Tier
 * MCP Routes (P3 + Lot A) — gouvernance unifiée des exécutions MCP.
 *
 * Règle fondamentale (constat P1-01, rapport C3.6) : TOUTE exécution d'un
 * outil MCP passe par une autorité de sécurité unique. Plus aucune voie
 * one-shot non liée :
 *
 * GET  /api/v1/mcp/servers : découverte des serveurs intégrés (PROJECT_READ,
 *                            handshake stdio réel ; JAMAIS d'exécution d'outil ;
 *                            serveurs désactivés = entrée offline, sans spawn).
 * POST /api/v1/mcp/prepare : préparation d'une exécution → confirmation
 *                            ponctuelle anti-rejeu (TTL serveur fixe 15 min).
 * POST /api/v1/mcp/call    : exécution — exige la CONSOMMATION ATOMIQUE
 *                            valide d'une confirmation préparée ci-dessus ;
 *                            le contrat externe conserve server/tool/args/
 *                            projectId/timeoutMs (champ confirmationId ajouté
 *                            et OBLIGATOIRE, réponse result|error inchangée).
 *
 * Politique fail-closed (registre exécutable) :
 * packages/core/src/mcp/governance/builtin-policy.ts — les routes ne
 * décident plus rien seules. Chaque refus est journalisé (raison fermée) ;
 * chaque exécution est journalisée exactement une fois.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError
} from '../../../../packages/core/src/errors.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { isSafeProjectId } from '../../../../packages/core/src/app-pipeline.js';
import { McpStdioClient } from '../../../../packages/core/src/mcp/client.js';
import {
  MCP_BUILTIN_ARGS_MAX_BYTES,
  MCP_BUILTIN_TTL_MS,
  builtinConnectorId,
  builtinToolSchemaSha256,
  getBuiltinConfirmationStore,
  getBuiltinServerPolicy,
  getBuiltinToolPolicy,
  isBuiltinServerEnabled,
  listBuiltinServerPolicies,
  mapConfirmationFailure,
  type BuiltinMcpRefusalReason
} from '../../../../packages/core/src/mcp/governance/builtin-policy.js';
import {
  remoteMcpCanonicalSha256,
  stableStringifyCanonical
} from '../../../../packages/core/src/mcp/remote/canonical-json.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { logger } from '../../../../packages/core/src/logger.js';
import { readBody } from '../middleware/body.js';
import type { RequestContext } from '../middleware/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
// dist/apps/api/src/routes → racine du dépôt (5 niveaux)
const repoRoot = join(here, '..', '..', '..', '..', '..');
// PATCH-R3-A — la mise en page d'exécution varie : déploiement dist/
// (dist/packages/core/src/mcp, racine+5) ou build isolé (out/packages/core/src/
// mcp, racine exécutée+4). On résout le dossier qui contient RÉELLEMENT
// project-server.js ; repli historique dist/ sinon (production inchangée).
const mcpDistDist = join(repoRoot, 'dist', 'packages', 'core', 'src', 'mcp');
const mcpDistLocal = join(here, '..', '..', '..', '..', 'packages', 'core', 'src', 'mcp');
const mcpDist = existsSync(join(mcpDistLocal, 'project-server.js')) ? mcpDistLocal : mcpDistDist;

/**
 * Registre MÉCANIQUE (chemins de script à spawner) — la politique
 * exécutable (outils, sensibilité, activation) reste dans le module de
 * gouvernance ; toute entrée du registre SANS politique correspondante est
 * inertée (fail-closed) par le contrôle de requête.
 */
export const KNOWN_MCP_SERVERS: ReadonlyArray<{ id: string; description: string; script: string; args: string[] }> = [
  {
    id: 'project',
    description: 'Fichiers du projet React généré (fs_list / fs_read / fs_write / app_build) — confiné au workspace du projet.',
    script: join(mcpDist, 'project-server.js'),
    args: []
  },
  {
    id: 'browser',
    description: 'Navigateur Chromium headless (browser_navigate / browser_screenshot) via Playwright.',
    script: join(mcpDist, 'browser-server.js'),
    args: []
  }
];

/* ---------------------------------------------------------------------------
 * Journal (audit) — type de ressource + actions builtin, motif identique à
 * la voie distante (C3.4) : enregistrement ÉGALEMENT UNIQUE (pas de double
 * comptage), métadonnées whitelistées (jamais d'argument, jamais de secret).
 * ------------------------------------------------------------------------- */

const AUDIT_RESOURCE_TYPE = 'MCP_BUILTIN_SERVER';
const AUDIT_ACTION_PREPARED = 'MCP_BUILTIN_TOOL_PREPARED';
const AUDIT_ACTION_CALLED = 'MCP_BUILTIN_TOOL_CALLED';
const AUDIT_ACTION_CALL_FAILED = 'MCP_BUILTIN_TOOL_CALL_FAILED';
const AUDIT_ACTION_PREPARE_REFUSED = 'MCP_BUILTIN_TOOL_PREPARE_REFUSED';
const AUDIT_ACTION_CALL_REFUSED = 'MCP_BUILTIN_TOOL_CALL_REFUSED';

/** Confirmation : UUID C3.1 (hex + traits, 8..64). */
const CONFIRMATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

function reply(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

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

/** Refus = journalisé (raison fermée) PUIS rejet HTTP ; JAMAIS de contenu. */
function recordRefusal(
  action: string,
  resourceId: string,
  context: RequestContext,
  requestId: string,
  reason: BuiltinMcpRefusalReason,
  extra?: Record<string, unknown>
): void {
  auditStore.record({
    tenantId: context.tenantId,
    userId: context.userId || context.role,
    action,
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId,
    status: 'FAILURE',
    metadata: { reason, ...(extra !== undefined ? extra : {}) },
    requestId
  });
}

/** Durée : journal STRUCTURÉ (pas auditStore), toolName non secret. */
function recordToolDuration(
  phase: 'prepare' | 'call',
  outcome: 'ok' | 'fail',
  durationMs: number,
  toolName: string
): void {
  logger.info(
    `Opération MCP intégrée ${phase} ${outcome} en ${durationMs} ms`,
    { component: 'mcp-builtin-tool', durationMs, toolName }
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Identité individuelle fiable OBLIGATOIRE (JWT signé, D7) — motif distant. */
function requireTrustedUserId(context: RequestContext): string {
  if (typeof context.userId !== 'string' || context.userId.length === 0) {
    throw new ForbiddenError(
      'Identité utilisateur individuelle requise (JWT signé) : les exécutions MCP se lient toujours à une identité fiable'
    );
  }
  return context.userId;
}

/** Corps JSON ≤1 Mo (readBody) : objet requis ({} accepté). */
async function parseJsonObjectBody(req: IncomingMessage, requestId: string): Promise<Record<string, unknown>> {
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

/**
 * Arguments = objet JSON (contrat tools/call) ; OMISSION admise (= {}).
 * Compat contrat historique : `args` (voie historique) ET `arguments`
 * (motif distant) acceptés — si les deux sont présents ils doivent être
 * canoniquement ÉGAUX (sinon INPUT_INVALID : trop ambigu pour binder).
 */
function pickArguments(body: Record<string, unknown>): Record<string, unknown> {
  const legacy = body.args === undefined ? undefined : body.args;
  const modern = body.arguments === undefined ? undefined : body.arguments;
  const source = legacy !== undefined ? legacy : modern;
  if (source !== undefined && !isPlainObject(source)) {
    throw new ValidationError('arguments requis (objet JSON)');
  }
  if (legacy !== undefined && modern !== undefined) {
    let same = false;
    try {
      same = stableStringifyCanonical(legacy) === stableStringifyCanonical(modern);
    } catch {
      same = false;
    }
    if (!same) {
      throw new ValidationError('args et arguments divergent : un seul jeu d\'arguments lié par confirmation');
    }
  }
  return source === undefined ? {} : source;
}

/** Hash canonique des arguments SOUMIS (bornes fail-closed alignées distant). */
function hashArguments(args: Record<string, unknown>): string {
  let canonical: string;
  try {
    canonical = stableStringifyCanonical(args);
  } catch {
    throw new ValidationError('arguments hors modèle JSON canonique (refus fail-closed)');
  }
  if (Buffer.byteLength(canonical, 'utf8') > MCP_BUILTIN_ARGS_MAX_BYTES) {
    throw new ValidationError(`arguments trop volumineux (max ${MCP_BUILTIN_ARGS_MAX_BYTES} bytes canoniques)`);
  }
  return remoteMcpCanonicalSha256(args);
}

/** Timeout : bornes du client stdio fixées pour connect ET call (inheritance). */
function clampTimeoutMs(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
  return Math.min(Math.max(n ?? 30000, 5000), 120000);
}

/**
 * Résolution tenant-sure du projet (SEC-01 inchangée) :
 * forme stricte (400) → registre tenant (404 indiscernable). Identique sur
 * /prepare et /call — même validation, même refus.
 */
function resolveBuiltinProject(
  context: RequestContext,
  rawId: string,
  requestId: string
): string {
  if (!isSafeProjectId(rawId)) {
    throw new ValidationError('Identifiant de projet invalide', undefined, requestId);
  }
  const known = projectStore.getProject(context.tenantId, rawId);
  if (!known) {
    throw new NotFoundError(`Projet ${rawId}`, requestId);
  }
  return rawId;
}

/* ---------------------------------------------------------------------------
 * POST /api/v1/mcp/prepare — préparation (aucun spawn, aucun réseau).
 * Ordre : RBAC → identité fiable → politique serveur → politique outil →
 * registre projet → arguments → confirmation (issue atomique C3.1).
 * ------------------------------------------------------------------------- */
async function handleBuiltinPrepare(
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
  requestId: string
): Promise<void> {
  const startedAt = Date.now();
  const body = await parseJsonObjectBody(req, requestId);
  const serverRaw = typeof body.server === 'string' ? body.server.slice(0, 64) : '';
  const label = serverRaw.length > 0 ? serverRaw : '-';

  try {
    assertPermission(context.role, 'MCP_BUILTIN_INVOKE', requestId);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, label, context, requestId, 'PERMISSION_DENIED');
    throw error;
  }

  let userId: string;
  try {
    userId = requireTrustedUserId(context);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, label, context, requestId, 'IDENTITY_UNTRUSTED');
    throw error;
  }

  const toolRaw = typeof body.tool === 'string' ? body.tool : '';
  const policy = getBuiltinServerPolicy(serverRaw);
  if (policy === null) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, label, context, requestId, 'SERVER_NOT_ALLOWED');
    throw new ValidationError('Serveur MCP inconnu : ' + serverRaw, undefined, requestId);
  }
  if (!isBuiltinServerEnabled(policy.id)) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, label, context, requestId, 'SERVER_DISABLED');
    throw new AppError(
      'Serveur MCP intégré désactivé : préparation refusée (aucun spawn)',
      'MCP_BUILTIN_DRIFT',
      409,
      undefined,
      requestId
    );
  }

  let projectId: string | undefined;
  if (policy.id === 'project') {
    const rawId = String(body.projectId ?? 'default-project');
    try {
      projectId = resolveBuiltinProject(context, rawId, requestId);
    } catch (error) {
      if (error instanceof ValidationError) {
        recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, label, context, requestId, 'PROJECT_INVALID');
      } else if (error instanceof NotFoundError) {
        recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, label, context, requestId, 'PROJECT_NOT_FOUND');
      }
      throw error;
    }
  }

  const toolPolicy = getBuiltinToolPolicy(policy.id, toolRaw);
  if (toolPolicy === null) {
    recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, label, context, requestId, 'TOOL_NOT_DECLARED');
    throw toolNotDeclaredError(toolRaw, requestId);
  }
  let args: Record<string, unknown>;
  let argsSha256: string;
  try {
    args = pickArguments(body);
    argsSha256 = hashArguments(args);
  } catch (error) {
    if (error instanceof ValidationError) {
      recordRefusal(AUDIT_ACTION_PREPARE_REFUSED, label, context, requestId, 'INPUT_INVALID');
    }
    throw error;
  }

  const confirmation = getBuiltinConfirmationStore().issue({
    tenantId: context.tenantId,
    userId,
    connectorId: builtinConnectorId(policy.id),
    toolName: toolPolicy.name,
    schemaSha256: builtinToolSchemaSha256(policy.id, toolPolicy),
    argsSha256,
    ttlMs: MCP_BUILTIN_TTL_MS
  });

  recordToolDuration('prepare', 'ok', Date.now() - startedAt, toolPolicy.name);
  recordAudit(AUDIT_ACTION_PREPARED, label, context, requestId, {
    toolName: toolPolicy.name,
    schemaSha256: confirmation.schemaSha256,
    argsSha256,
    confirmationId: confirmation.confirmationId,
    projectId: projectId ?? null
  });
  reply(res, 201, {
    confirmation: {
      confirmationId: confirmation.confirmationId,
      toolName: confirmation.toolName,
      schemaSha256: confirmation.schemaSha256,
      argsSha256: confirmation.argsSha256,
      expiresAt: confirmation.expiresAt
    },
    serverId: policy.id,
    requestId
  });
}

/** Rank§7 étape 6 : outil vide → message contrat ; outil inconnu → préparation impossible. */
function toolNotDeclaredError(tool: string, requestId: string): Error {
  if (tool.length === 0) {
    return new ValidationError('Le champ "tool" est obligatoire', undefined, requestId);
  }
  return new ValidationError(`Outil non déclaré pour ce serveur MCP intégré : ${tool.slice(0, 64)}`, undefined, requestId);
}

/* ---------------------------------------------------------------------------
 * POST /api/v1/mcp/call — exécution gouvernée (P1-01 fermé) :
 *   RBAC → identité fiable → confirmationId présent → politique serveur →
 *   politique outil → registre projet → arguments → CONSOMMATION ATOMIQUE
 *   (identité/outil/schéma/args liés) → et SEULEMENT alors un unique
 *   `tools/call` stdio. Contrat réponse préservé : 200 + result|error.
 * ------------------------------------------------------------------------- */
async function handleBuiltinCall(
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
  requestId: string
): Promise<void> {
  const startedAt = Date.now();
  // SEC-12 — corps borné à 1 Mo (contrat inchangé) : la borne frappe AVANT
  // toute décision d'autorisation (les refus 413 demeurent déterministes).
  const body = await parseJsonObjectBody(req, requestId);
  const serverRaw = typeof body.server === 'string' ? body.server.slice(0, 64) : '';
  const label = serverRaw.length > 0 ? serverRaw : '-';

  try {
    assertPermission(context.role, 'MCP_BUILTIN_INVOKE', requestId);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, 'PERMISSION_DENIED');
    throw error;
  }

  let userId: string;
  try {
    userId = requireTrustedUserId(context);
  } catch (error) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, 'IDENTITY_UNTRUSTED');
    throw error;
  }

  const toolRaw = typeof body.tool === 'string' ? body.tool : '';
  const confirmationIdRaw = typeof body.confirmationId === 'string' ? body.confirmationId : '';
  if (!CONFIRMATION_ID_PATTERN.test(confirmationIdRaw)) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, 'INPUT_INVALID');
    throw new ValidationError(
      'confirmationId requis (identifiant issu de /api/v1/mcp/prepare)',
      undefined,
      requestId
    );
  }

  const policy = getBuiltinServerPolicy(serverRaw);
  if (policy === null) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, 'SERVER_NOT_ALLOWED');
    throw new ValidationError('Serveur MCP inconnu : ' + serverRaw, undefined, requestId);
  }
  if (!isBuiltinServerEnabled(policy.id)) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, 'SERVER_DISABLED');
    throw new AppError(
      'Serveur MCP intégré désactivé : exécution refusée',
      'MCP_BUILTIN_DRIFT',
      409,
      undefined,
      requestId
    );
  }

  let projectId: string | undefined;
  if (policy.id === 'project') {
    const rawId = String(body.projectId ?? 'default-project');
    try {
      projectId = resolveBuiltinProject(context, rawId, requestId);
    } catch (error) {
      if (error instanceof ValidationError) {
        recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, 'PROJECT_INVALID');
      } else if (error instanceof NotFoundError) {
        recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, 'PROJECT_NOT_FOUND');
      }
      throw error;
    }
  }

  const registryDef = KNOWN_MCP_SERVERS.find((s2) => s2.id === policy.id);
  if (registryDef === undefined) {
    // Registre mécanique sans politique : fail-closed (jamais spawn).
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, 'SERVER_NOT_ALLOWED');
    throw new ValidationError('Serveur MCP inconnu : ' + serverRaw, undefined, requestId);
  }

  const toolPolicy = getBuiltinToolPolicy(policy.id, toolRaw);
  if (toolPolicy === null) {
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, 'TOOL_NOT_DECLARED');
    throw toolNotDeclaredError(toolRaw, requestId);
  }
  let args: Record<string, unknown>;
  let argsSha256: string;
  try {
    args = pickArguments(body);
    argsSha256 = hashArguments(args);
  } catch (error) {
    if (error instanceof ValidationError) {
      recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, 'INPUT_INVALID');
    }
    throw error;
  }

  const schemaSha256 = builtinToolSchemaSha256(policy.id, toolPolicy);
  const outcome = getBuiltinConfirmationStore().consume({
    tenantId: context.tenantId,
    userId,
    confirmationId: confirmationIdRaw,
    connectorId: builtinConnectorId(policy.id),
    toolName: toolPolicy.name,
    schemaSha256,
    argsSha256
  });
  if (!outcome.consumed) {
    const reason = mapConfirmationFailure(outcome.reason);
    recordRefusal(AUDIT_ACTION_CALL_REFUSED, label, context, requestId, reason);
    throw new AppError(
      'Confirmation MCP invalide (consommation refusée) : préparation à nouveau nécessaire',
      'MCP_BUILTIN_DRIFT',
      409,
      undefined,
      requestId
    );
  }

  // Arguments réels du process : tenant + projet résolu (moteur inchangé).
  const processArgs = [...registryDef.args];
  if (policy.id === 'project' && projectId !== undefined) {
    processArgs.unshift(context.tenantId, projectId);
  }

  const timeoutMs = clampTimeoutMs(body.timeoutMs);
  const client = new McpStdioClient({
    command: process.execPath,
    args: [registryDef.script, ...processArgs],
    timeoutMs
  });

  try {
    await client.connect();
    const result = await client.callTool(toolPolicy.name, args, timeoutMs);
    recordToolDuration('call', 'ok', Date.now() - startedAt, toolPolicy.name);
    recordAudit(AUDIT_ACTION_CALLED, label, context, requestId, {
      toolName: toolPolicy.name,
      confirmationId: confirmationIdRaw,
      projectId: projectId ?? null
    });
    reply(res, 200, { server: policy.id, tool: toolPolicy.name, result, requestId });
  } catch (err) {
    // Contrat historique préservé : l'erreur D'EXÉCUTION reste 200 + error
    // (message borné 400 chars — couverture PATCH-R3-A). Une seule trace :
    // CALL_FAILED (et pas CALLED).
    recordToolDuration('call', 'fail', Date.now() - startedAt, toolPolicy.name);
    recordAudit(AUDIT_ACTION_CALL_FAILED, label, context, requestId, {
      toolName: toolPolicy.name,
      confirmationId: confirmationIdRaw,
      projectId: projectId ?? null
    });
    reply(res, 200, {
      server: policy.id,
      tool: toolPolicy.name,
      error: err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400),
      requestId
    });
  } finally {
    client.close();
  }
}

/* ---------------------------------------------------------------------------
 * GET /api/v1/mcp/servers (découverte, JAMAIS d'exécution d'outil) :
 * itération de la POLITIQUE (source de vérité), mécanique de spawn inchangée.
 * Serveur désactivé : entrée offline SANS spawn. Serveur du registre
 * mécanique absent de la politique : entrée offline fail-closed.
 * ------------------------------------------------------------------------- */
export async function handleMcpRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // 1. GET /api/v1/mcp/servers : handshake réel + outils découverts
  if (pathname === '/api/v1/mcp/servers' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const servers = [];
    for (const pol of listBuiltinServerPolicies()) {
      const def = KNOWN_MCP_SERVERS.find((d2) => d2.id === pol.id);
      if (def === undefined) {
        servers.push({
          id: pol.id,
          description: pol.description,
          online: false,
          error: 'Serveur MCP non déclaré côté plateforme (politique)'
        });
        continue;
      }
      if (!isBuiltinServerEnabled(pol.id)) {
        servers.push({
          id: pol.id,
          description: def.description,
          online: false,
          error: 'Serveur désactivé (politique MCP intégrée)'
        });
        continue;
      }
      const client = new McpStdioClient({
        command: process.execPath,
        args: [def.script, ...(def.id === 'project' ? [context.tenantId, (pathname.split('/')[4] ?? 'default-project')] : [])],
        timeoutMs: 15000
      });
      try {
        await client.connect();
        const tools = await client.listTools();
        servers.push({ id: def.id, description: def.description, online: true, tools: tools.map((t) => t.name) });
      } catch (err) {
        servers.push({ id: def.id, description: def.description, online: false, error: err instanceof Error ? err.message.slice(0, 120) : String(err) });
      } finally {
        client.close();
      }
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ servers, requestId }));
    return true;
  }

  // 2. POST /api/v1/mcp/prepare : préparation confirmée (aucun spawn)
  if (pathname === '/api/v1/mcp/prepare' && req.method === 'POST') {
    await handleBuiltinPrepare(req, res, context, requestId);
    return true;
  }

  // 3. POST /api/v1/mcp/call : exécution gouvernée (confirmation obligatoire)
  if (pathname === '/api/v1/mcp/call' && req.method === 'POST') {
    await handleBuiltinCall(req, res, context, requestId);
    return true;
  }

  return false;
}
