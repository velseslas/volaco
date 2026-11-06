/**
 * MCP-C3.6 Lot A — Autorité de gouvernance des exécutions MCP INTÉGRÉES
 * (transport stdio de la plateforme : serveurs « project » et « browser »).
 *
 * Règle fondamentale (constat P1-01, rapport C3.6 §14) : TOUTE exécution d'un
 * outil MCP passe par une autorité de sécurité unique. La route historique
 * `/api/v1/mcp/call` n'est plus un one-shot non lié : elle exige désormais la
 * chaîne préparation → confirmation → consommation atomique, identique à la
 * voie distante. Le REGISTRE EXÉCUTABLE (politique fail-closed) vit ICI :
 * les routes ne décident plus rien seules.
 *
 * Ce module ne fait AUCUN réseau et AUCUN spawn : politique pure + primitive
 * de confirmation C3.1 réutilisée telle quelle (transaction BEGIN IMMEDIATE
 * + TTL capé 15 min, décision C3.4 : TTL FIXE, aucune négociation client).
 *
 * SÉPARATION DES DOMAINES (intégrés ↔ distants) :
 * - les confirmations des outils intégrés utilisent un pseudo-connecteur
 *   `builtin.<id>`, jamais une ligne de `mcp_remote_connectors` ;
 * - un connecteur distants reçoit TOUJOURS un ID UUID généré par le store
 *   (store.ts `createConnector`) : aucun identifiant choisi/utilisateur ne
 *   peut porter le préfixe `builtin.` — les identités de confirmation sont
 *   structurellement disjointes, la confusion croisée est exclue ;
 * - le drapeau `allowForeignConnectorIds` lève SEULEMENT le contrôle
 *   d'existence désactivant le contrôle pour ce domaine (voir
 *   confirmation.ts — défaut C3.1 inchangé pour les distants).
 */

import {
  RemoteMcpConfirmationStore,
  REMOTE_MCP_CONFIRMATION_MAX_TTL_MS,
  type RemoteMcpConfirmationFailure
} from '../remote/confirmation.js';
import { remoteMcpCanonicalSha256 } from '../remote/canonical-json.js';

export type BuiltinToolSensitivity = 'read' | 'write';

export interface BuiltinToolPolicy {
  readonly name: string;
  readonly description: string;
  readonly sensitivity: BuiltinToolSensitivity;
  /**
   * Contraintes d'entrée DÉCLARÉES (objet statique = source du hash de
   * liaison `schemaSha256`). La validation fine du contenu (sandbox fs,
   * politique des images, grille anti-SSRF SEC-02) vit dans le serveur
   * spawné : la présente politique fixe qui PEUT demander et à quel prix
   * (confirmation), pas la sémantique interne de l'outil.
   */
  readonly inputConstraints: Readonly<Record<string, unknown>>;
}

export interface BuiltinServerPolicy {
  readonly id: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly tools: readonly BuiltinToolPolicy[];
}

/** Borne d'arguments (charge canonique UTF-8) — alignée sur la voie distante. */
export const MCP_BUILTIN_ARGS_MAX_BYTES = 16_384;

/**
 * TTL SERVEUR FIXE de la confirmation (décision C3.4 : cap maximal C3.1,
 * 15 minutes — aucune négociation par le client ; réaffirmé ici pour que
 * les deux transports partagent LA MÊME demi-vie d'opération préparée).
 */
export const MCP_BUILTIN_TTL_MS: number = REMOTE_MCP_CONFIRMATION_MAX_TTL_MS;

const PROJECT_SANDBOX = 'workspace du projet (app-pipeline), jamais hors sandbox';
const NAV_URI_SANDBOX =
  'réseau réencadré par la grille anti-SSRF SEC-02 (allowlist + revalidation socket)';

function decl(
  toolName: string,
  description: string,
  sensitivity: BuiltinToolSensitivity,
  sandbox: string
): BuiltinToolPolicy {
  return Object.freeze({
    name: toolName,
    description,
    sensitivity,
    inputConstraints: Object.freeze({
      json: true,
      maxCanonicalBytes: MCP_BUILTIN_ARGS_MAX_BYTES,
      sandbox
    })
  });
}

/** Politique STATIC des serveurs stdio intégrés : source unique du registre. */
export const MCP_BUILTIN_POLICY: readonly BuiltinServerPolicy[] = Object.freeze([
  Object.freeze({
    id: 'project',
    description:
      'Fichiers du projet React généré (fs_list / fs_read / fs_write / app_build) — confiné au workspace du projet.',
    enabled: true,
    tools: Object.freeze([
      decl('fs_list', 'Liste les fichiers du projet', 'read', PROJECT_SANDBOX),
      decl('fs_read', 'Lit un fichier du workspace du projet', 'read', PROJECT_SANDBOX),
      decl(
        'fs_write',
        "Écrit un fichier (inspecté par la politique des images, PATCH-R3-A)",
        'write',
        PROJECT_SANDBOX + ' ; persiste aussi via la FileStore'
      ),
      decl(
        'app_build',
        'Reconstruit le bundle (vite) après garde du workspace réel (fail-closed)',
        'write',
        PROJECT_SANDBOX + ' ; lance un process enfant borné'
      )
    ])
  }),
  Object.freeze({
    id: 'browser',
    description: 'Navigateur Chromium headless (browser_navigate / browser_screenshot) via Playwright.',
    enabled: true,
    tools: Object.freeze([
      decl('browser_navigate', "Navigue vers une URL AUTORISÉE (grille SEC-02)", 'write', NAV_URI_SANDBOX),
      decl('browser_screenshot', 'Capture PNG de la page courante', 'read', 'contenu du tenant uniquement')
    ])
  })
]);

export function listBuiltinServerPolicies(): readonly BuiltinServerPolicy[] {
  return MCP_BUILTIN_POLICY;
}

export function getBuiltinServerPolicy(serverId: string): BuiltinServerPolicy | null {
  if (typeof serverId !== 'string') return null;
  return MCP_BUILTIN_POLICY.find((server) => server.id === serverId) ?? null;
}

export function getBuiltinToolPolicy(serverId: string, toolName: string): BuiltinToolPolicy | null {
  const server = getBuiltinServerPolicy(serverId);
  if (server === null) return null;
  return server.tools.find((tool) => tool.name === toolName) ?? null;
}

/**
 * Hash de liaison de l'outil INTÉGRÉ : sha256 canonique de la politique
 * DÉCLARÉE ci-dessus. La route re-calcule à partir de LA MÊME source statique
 * (pas une entrée client) : toute modification de politique change le hash →
 * les confirmations préparées avant sont refusées (fail-closed, TOCTOU du
 * registre impossible : constante de module).
 */
export function builtinToolSchemaSha256(serverId: string, tool: BuiltinToolPolicy): string {
  return remoteMcpCanonicalSha256({
    kind: 'mcp-builtin-tool',
    serverId,
    toolName: tool.name,
    sensitivity: tool.sensitivity,
    inputConstraints: tool.inputConstraints
  });
}

/* ---------------------------------------------------------------------------
 * Raisons de refus : liste fermée NON secrète (nommage = contrat). Même
 * discipline que la voie distante (C3.4 §5) — toute ligne « _REFUSED » du
 * journal porte une raison de CETTE liste.
 * ------------------------------------------------------------------------- */

export type BuiltinMcpRefusalReason =
  | 'PERMISSION_DENIED'
  | 'IDENTITY_UNTRUSTED'
  | 'INPUT_INVALID'
  | 'SERVER_NOT_ALLOWED'
  | 'SERVER_DISABLED'
  | 'TOOL_NOT_DECLARED'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_INVALID'
  | 'CONFIRMATION_NOT_FOUND'
  | 'CONFIRMATION_EXPIRED'
  | 'CONFIRMATION_REPLAY'
  | 'CONFIRMATION_BINDING_MISMATCH';

const BUILTIN_REFUSAL_REASONS: readonly BuiltinMcpRefusalReason[] = [
  'PERMISSION_DENIED',
  'IDENTITY_UNTRUSTED',
  'INPUT_INVALID',
  'SERVER_NOT_ALLOWED',
  'SERVER_DISABLED',
  'TOOL_NOT_DECLARED',
  'PROJECT_NOT_FOUND',
  'PROJECT_INVALID',
  'CONFIRMATION_NOT_FOUND',
  'CONFIRMATION_EXPIRED',
  'CONFIRMATION_REPLAY',
  'CONFIRMATION_BINDING_MISMATCH'
];

export function isBuiltinMcpRefusalReason(value: unknown): value is BuiltinMcpRefusalReason {
  return typeof value === 'string' && BUILTIN_REFUSAL_REASONS.includes(value as BuiltinMcpRefusalReason);
}

/** Échec de consommation C3.1 → raison fermée builtin (1:1, sans détail secret). */
export function mapConfirmationFailure(reason: RemoteMcpConfirmationFailure): BuiltinMcpRefusalReason {
  switch (reason) {
    case 'NOT_FOUND':
      return 'CONFIRMATION_NOT_FOUND';
    case 'EXPIRED':
      return 'CONFIRMATION_EXPIRED';
    case 'REPLAY':
      return 'CONFIRMATION_REPLAY';
    case 'BINDING_MISMATCH':
      return 'CONFIRMATION_BINDING_MISMATCH';
  }
}

/* ---------------------------------------------------------------------------
 * Pseudo-connecteur du domaine intégré (namespace disjoint des distants).
 * ------------------------------------------------------------------------- */

export const MCP_BUILTIN_CONNECTOR_PREFIX = 'builtin.';

export function builtinConnectorId(serverId: string): string {
  return MCP_BUILTIN_CONNECTOR_PREFIX + serverId;
}

/* ---------------------------------------------------------------------------
 * Runtime : store de confirmations (primitives C3.1 partagées, état builtin
 * dédié) + interrupteur « serveur désactivé » TEST-SEULEMENT.
 * ------------------------------------------------------------------------- */

export interface BuiltinMcpRuntimeForTests {
  /** Factory du store de confirmations (base isolée + horloge injectable). */
  readonly confirmationStore?: (() => RemoteMcpConfirmationStore) | undefined;
  /** IDs COUPÉS volontairement (sans état persisté, sans redémarrage). */
  readonly disabledServers?: readonly string[] | undefined;
}

let runtimeForTests: BuiltinMcpRuntimeForTests | null = null;

export function setBuiltinMcpRuntimeForTests(runtime: BuiltinMcpRuntimeForTests | null): void {
  runtimeForTests = runtime;
}

let cachedConfirmationStore: RemoteMcpConfirmationStore | undefined;

/**
 * Store de confirmations du domaine intégré : MÊME primitive atomique que la
 * voie distante (BEGIN IMMEDIATE + UPDATE conditionnel), état dédié au
 * pseudo-connecteurs `builtin.*`. En test, l'horloge/la base s'injectent via
 * le seam (jamais branché en production).
 */
export function getBuiltinConfirmationStore(): RemoteMcpConfirmationStore {
  if (runtimeForTests?.confirmationStore) {
    return runtimeForTests.confirmationStore();
  }
  if (cachedConfirmationStore === undefined) {
    cachedConfirmationStore = new RemoteMcpConfirmationStore(Date.now, { allowForeignConnectorIds: true });
  }
  return cachedConfirmationStore;
}

/** Interrupteur d'activation (politique statique + override test). */
export function isBuiltinServerEnabled(serverId: string): boolean {
  const disabled = runtimeForTests?.disabledServers;
  if (disabled !== undefined && disabled.includes(serverId)) return false;
  const policy = getBuiltinServerPolicy(serverId);
  return policy !== null && policy.enabled;
}
