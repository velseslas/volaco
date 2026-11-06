/**
 * C3.2-A — Client HTTPS pour connecteurs MCP distants (transport
 * « Streamable HTTP », périmètre strict : initialize / tools/list / tools/call).
 *
 * Chaîne de défense établie à chaque requête (initiale ET chaque saut de
 * redirection) :
 *   1. validateRemoteMcpUrl(url)  — https, pas de credentials, hôte/IP public ;
 *   2. résolution DNS explicite (dns.lookup { all: true, verbatim: true }) ;
 *   3. assertPublicResolvedAddresses(ips) — TOUTES les adresses résolues
 *      doivent être publiques ; UNE seule adresse interdite rédhibitoire ;
 *   4. connexion DIRECTE sur une IP épinglee (host = IP, deuxième résolution
 *      impossible), SNI + vérification certificat et identité contre le nom
 *      d hôte D ORIGINE (pas contre l IP épinglée), en-tête Host explicite ;
 *      vérification de l adresse distante réelle de la socket
 *      (remoteAddress === IP épinglée) et du port distant ;
 *   5. redirections manuelles : au plus REMOTE_MCP_MAX_REDIRECTS sauts,
 *      chacun revalidé par les étapes 1..4 + validateRemoteMcpRedirectChain
 *      cumulative ;
 *   6. plafond de taille de réponse, deadline unique englobant tous les sauts,
 *      annulation réelle (req.destroy) ; jamais de keep-alive (agent: false,
 *      socket neuve par requête) ;
 *   7. réponse validée côté JSON-RPC 2.0 (jsonrpc/id/result|error) avant usage ;
 *      erreurs distantes normalisées (code numérique conservé) et tronquées ;
 *   8. secrets (bearer) JAMAIS loggés ni inscrits dans un message d erreur ;
 *      fragments distants assainis (contrôle de caractères + caviardage des
 *      valeurs secrètes connues du client).
 *
 * CONFIANCE ZÉRO dans les métadonnées distantes : capabilities/serverInfo ne
 * sont que relayés ; AUCUN outil découvert n est autorisé par défaut
 * (l approbation, le hash de schéma et la confirmation anti-rejeu vivent dans
 * la couche routes C3.2-B, pas ici). Le client ne réessaie JAMAIS une requête
 * (un tools/call répété exécuterait un effet de bord deux fois).
 *
 * Injections de TEST uniquement (dnsResolverForTests / addressPolicyForTests) :
 * elles permettent de brancher un serveur local 127.0.0.1 dans la chaîne au
 * lieu d Internet. Elles ne court-circuitent NI validateRemoteMcpUrl NI
 * validateRemoteMcpRedirectChain, et dans les tests elles délèguent tout
 * verdict hors loopback à assertPublicResolvedAddresses réelle.
 *
 * Limites résiduelles documentées (voir bas de fichier + rapport) : résolveur
 * système défaillant/attaqué au-delà du refus des IP non publiques, redirection
 * vers un NOUVEAU domaine public non référencé (autorisé ici après validation
 * complète, ex. fédération), HTTPS ne réduit que les risques de circuit
 * (espionnage/usurpation réseau), pas le contenu malveillant du serveur joint.
 */

import { lookup as dnsLookupAll } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, IncomingHttpHeaders } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { isIP } from 'node:net';
import { MCP_PROTOCOL_VERSION } from '../protocol.js';
import {
  assertPublicResolvedAddresses,
  REMOTE_MCP_MAX_REDIRECTS,
  REMOTE_MCP_URL_MAX_LENGTH,
  validateRemoteMcpRedirectChain,
  validateRemoteMcpUrl,
  type RemoteMcpUrlPolicyResult
} from './url-policy.js';

/**
 * Version de protocole PREFEREE envoyée dans initialize : 2025-03-26 est la
 * première spécification définissant le transport HTTP « Streamable ».
 * L écho du serveur doit appartenir à REMOTE_MCP_SUPPORTED (2024-11-05, la
 * constante du projet stdio, ou 2025-03-26) — sinon PROTOCOL_UNSUPPORTED.
 */
export const REMOTE_MCP_HTTP_PROTOCOL_VERSION = '2025-03-26';
export const REMOTE_MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  MCP_PROTOCOL_VERSION,
  REMOTE_MCP_HTTP_PROTOCOL_VERSION
] as const;

const SUPPORTED_PROTOCOL_SET = new Set<string>(REMOTE_MCP_SUPPORTED_PROTOCOL_VERSIONS);

export const REMOTE_MCP_CLIENT_NAME = 'volaco-core-mcp-remote-client';
export const REMOTE_MCP_CLIENT_VERSION = '0.1.0';

/** Deadline par requête : 10 s par défaut (C3.3 §4.5), max 120 s, min 1 s. */
export const REMOTE_MCP_DEFAULT_TIMEOUT_MS = 10_000;
export const REMOTE_MCP_MAX_TIMEOUT_MS = 120_000;
export const REMOTE_MCP_MIN_TIMEOUT_MS = 1_000;

/** Réponse : 1 MiB par défaut, plafond matériel 10 MiB. */
export const REMOTE_MCP_DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
export const REMOTE_MCP_MAX_RESPONSE_BYTES_HARD_LIMIT = 10_485_760;
export const REMOTE_MCP_MIN_RESPONSE_BYTES = 1_024;

/** Corps de requête : 1 MiB par défaut, plafond 4 MiB. */
export const REMOTE_MCP_DEFAULT_MAX_REQUEST_BYTES = 1_048_576;
export const REMOTE_MCP_MAX_REQUEST_BYTES_HARD_LIMIT = 4_194_304;
export const REMOTE_MCP_MIN_REQUEST_BYTES = 64;

/**
 * Fragments distants (messages d erreur du serveur, snippets de corps) :
 * tronqués à cette longueur en caractères (et jamais plus longs).
 */
export const REMOTE_MCP_ERROR_SNIPPET_CHARS = 300;

/** Motif de noms d outil aligné sur le store C3.1 (fail-closed identique). */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** Mcp-Session-Id accepté : borné et sans caractères de contrôle. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@:-]{0,127}$/;
const CONNECTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/;

const REDIRECT_STATUS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const ACCEPT_HEADER_VALUE = 'application/json, text/event-stream';

export type RemoteMcpClientErrorCode =
  | 'CONFIG_INVALID'
  | 'URL_POLICY'
  | 'DNS_POLICY'
  | 'CONNECT_ERROR'
  | 'TLS_FAILURE'
  | 'SOCKET_MISMATCH'
  | 'HTTP_STATUS'
  | 'REDIRECT_POLICY'
  | 'REDIRECT_LIMIT'
  | 'RESPONSE_TOO_LARGE'
  | 'REQUEST_TOO_LARGE'
  | 'TIMEOUT'
  | 'PROTOCOL_UNSUPPORTED'
  | 'STATE_INVALID'
  | 'ENCODING_INVALID'
  | 'JSONRPC_INVALID'
  | 'JSONRPC_REMOTE_ERROR';

export class RemoteMcpClientError extends Error {
  readonly code: RemoteMcpClientErrorCode;
  /** Code numérique JSON-RPC distants (0 si erreur strictement locale). */
  readonly remoteRpcCode: number;

  constructor(message: string, code: RemoteMcpClientErrorCode, remoteRpcCode = 0) {
    super(message);
    this.name = "RemoteMcpClientError";
    this.code = code;
    this.remoteRpcCode = remoteRpcCode;
  }
}

export interface RemoteMcpDnsAnswer {
  readonly address: string;
  readonly family: number;
}

/** Injection de TEST UNIQUEMENT : remplace la validation des IP résolues. */
export type RemoteMcpAddressPolicyForTests = (ips: readonly string[]) => RemoteMcpUrlPolicyResult;
/** Injection de TEST UNIQUEMENT : remplace dns.lookup. */
export type RemoteMcpDnsResolverForTests = (
  hostname: string
) => Promise<readonly RemoteMcpDnsAnswer[]>;

export interface RemoteMcpClientOptions {
  /** URL https de l endpoint Streamable HTTP (validée par validateRemoteMcpUrl). */
  readonly url: string;
  /** Identifiant de connecteur (journalisation déclarative uniquement). */
  readonly connectorId: string;
  /**
   * Secret porteur (déjà déchiffré par la couche routes C3.2-B via le store
   * et le cipher AES-GCM). Utilisé comme Authorization: Bearer — jamais
   * réfléchi dans un message d erreur ni dans un log.
   */
  readonly bearerToken?: string;
  /**
   * PEM d une AC de confiance optionnel (certificat PUBLIC, jamais secret).
   * Si présent, il REMPLACE le magasin d AC système pour ce connecteur
   * (fail-closed : la chaîne doit descendre de CETTE AC, pas d autres).
   */
  readonly caPem?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxRequestBytes?: number;
  /** Nombre de redirections suivies (max REMOTE_MCP_MAX_REDIRECTS = 3). */
  readonly maxRedirects?: number;
  readonly dnsResolverForTests?: RemoteMcpDnsResolverForTests;
  readonly addressPolicyForTests?: RemoteMcpAddressPolicyForTests;
}

export interface RemoteMcpInitializeResult {
  readonly protocolVersion: string;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly sessionId: string | null;
}

export interface RemoteMcpToolDescriptor {
  readonly name: string;
  readonly title: string | null;
  readonly description: string | null;
  /** Schéma d entrée brut déclaré par le serveur distant (non autorisé). */
  readonly inputSchema: unknown;
}

export interface RemoteMcpToolsListResult {
  readonly tools: readonly RemoteMcpToolDescriptor[];
  readonly nextCursor: string | null;
}

export interface RemoteMcpToolCallResult {
  readonly content: readonly unknown[];
  readonly isError: boolean;
  /**
   * Contenu brut renvoyé par le serveur distant — non approuvé, jamais exécuté
   * ici ; la couche routes décide de ce qui est affiché/transmis.
   */
  readonly structuredContent: unknown;
}

interface PinnedResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

interface Deadline {
  readonly signal: AbortSignal;
  isTimedOut(): boolean;
  /** Convertit une erreur transport en erreur finale (TIMEOUT si échéance déjà dépassée). */
  convert(error: RemoteMcpClientError): RemoteMcpClientError;
  clear(): void;
}

/** Caviarde chaque occurrence connue d une valeur secrète (littéraux exacts). */
function redactSecrets(text: string, secrets: readonly string[]): string {
  let output = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    output = output.split(secret).join('[redacted]');
  }
  return output;
}

/** Neutralise caractères de contrôle ; puis caviardage des secrets connus. */
function sanitizeRemoteText(text: string, secrets: readonly string[]): string {
  const normalized = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '·');
  return redactSecrets(normalized, secrets);
}

function truncateSnippet(text: string, limit = REMOTE_MCP_ERROR_SNIPPET_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…(+${text.length - limit} car.)`;
}

/** Fragment d origine distante : assaini puis tronqué. */
function remoteSnippet(text: string, secrets: readonly string[]): string {
  return truncateSnippet(sanitizeRemoteText(text, secrets));
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headerToString(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  return value;
}

function sanitizeStringField(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
  // Caractères de contrôle interdits SAUF tabulation/nouvelle ligne/retour
  // (descriptions d outils multi-lignes légitimes).
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  return value;
}

function classifyHttpError(status: number): boolean {
  return status < 200 || status > 299;
}

export class RemoteMcpHttpClient {
  private readonly url: URL;
  private readonly connectorId: string;
  private readonly bearerToken: string | null;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxRequestBytes: number;
  private readonly maxRedirects: number;
  private readonly dnsResolver: RemoteMcpDnsResolverForTests | null;
  private readonly addressPolicy: RemoteMcpAddressPolicyForTests | null;
  private readonly secrets: readonly string[];
  private readonly caPem: string | null;

  private initialized = false;
  private sessionId: string | null = null;
  private negotiatedVersion: string | null = null;
  private initPromise: Promise<RemoteMcpInitializeResult> | null = null;
  private nextRequestId = 1;
  private firstInitializeResult: RemoteMcpInitializeResult | null = null;

  constructor(options: RemoteMcpClientOptions) {
    if (!isJsonObject(options)) {
      throw new RemoteMcpClientError('options du client absentes ou non objet', 'CONFIG_INVALID');
    }
    const urlPolicy = validateRemoteMcpUrl(options.url);
    if (!urlPolicy.allowed) {
      throw new RemoteMcpClientError(
        `URL de connecteur refusée par la politique SSRF (${urlPolicy.reason})`,
        'URL_POLICY'
      );
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(options.url);
    } catch {
      throw new RemoteMcpClientError('URL de connecteur non parseable', 'CONFIG_INVALID');
    }
    if (
      typeof options.connectorId !== 'string' ||
      options.connectorId.length === 0 ||
      !CONNECTOR_ID_PATTERN.test(options.connectorId)
    ) {
      throw new RemoteMcpClientError('connectorId du client invalide', 'CONFIG_INVALID');
    }
    if (options.bearerToken !== undefined && typeof options.bearerToken !== 'string') {
      throw new RemoteMcpClientError('bearerToken de connecteur invalide', 'CONFIG_INVALID');
    }
    const bearerToken =
      options.bearerToken !== undefined && options.bearerToken.length > 0 ? options.bearerToken : null;
    if (bearerToken !== null && bearerToken.length > 4096) {
      throw new RemoteMcpClientError(
        'bearerToken trop long (4096 caractères max)',
        'CONFIG_INVALID'
      );
    }
    const timeoutMs = options.timeoutMs ?? REMOTE_MCP_DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < REMOTE_MCP_MIN_TIMEOUT_MS || timeoutMs > REMOTE_MCP_MAX_TIMEOUT_MS) {
      throw new RemoteMcpClientError(
        `timeoutMs invalide (bornes : ${REMOTE_MCP_MIN_TIMEOUT_MS} à ${REMOTE_MCP_MAX_TIMEOUT_MS} ms)`,
        'CONFIG_INVALID'
      );
    }
    const maxResponseBytes = options.maxResponseBytes ?? REMOTE_MCP_DEFAULT_MAX_RESPONSE_BYTES;
    if (
      !Number.isInteger(maxResponseBytes) ||
      maxResponseBytes < REMOTE_MCP_MIN_RESPONSE_BYTES ||
      maxResponseBytes > REMOTE_MCP_MAX_RESPONSE_BYTES_HARD_LIMIT
    ) {
      throw new RemoteMcpClientError(
        'maxResponseBytes invalide (bornes : 1024 à 10485760 octets)',
        'CONFIG_INVALID'
      );
    }
    const maxRequestBytes = options.maxRequestBytes ?? REMOTE_MCP_DEFAULT_MAX_REQUEST_BYTES;
    if (
      !Number.isInteger(maxRequestBytes) ||
      maxRequestBytes < REMOTE_MCP_MIN_REQUEST_BYTES ||
      maxRequestBytes > REMOTE_MCP_MAX_REQUEST_BYTES_HARD_LIMIT
    ) {
      throw new RemoteMcpClientError(
        'maxRequestBytes invalide (bornes : 64 à 4194304 octets)',
        'CONFIG_INVALID'
      );
    }
    const maxRedirects = options.maxRedirects ?? REMOTE_MCP_MAX_REDIRECTS;
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > REMOTE_MCP_MAX_REDIRECTS) {
      throw new RemoteMcpClientError(
        `maxRedirects invalide (bornes : 0 à ${REMOTE_MCP_MAX_REDIRECTS})`,
        'CONFIG_INVALID'
      );
    }
    this.url = parsedUrl;
    this.connectorId = options.connectorId;
    this.bearerToken = bearerToken;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.maxRequestBytes = maxRequestBytes;
    this.maxRedirects = maxRedirects;
    this.dnsResolver = options.dnsResolverForTests ?? null;
    this.addressPolicy = options.addressPolicyForTests ?? null;
    this.secrets = bearerToken === null ? [] : [bearerToken];
    this.caPem = options.caPem ?? null;
    if (
      this.caPem !== null &&
      (typeof this.caPem !== 'string' ||
        this.caPem.length === 0 ||
        this.caPem.length > 65536 ||
        /[\u0000-\u0008\u000b\u000c\u000e\u000f\u0010-\u001f]/.test(this.caPem) ||
        !this.caPem.includes('-----BEGIN CERTIFICATE-----'))
    ) {
      throw new RemoteMcpClientError('caPem de connecteur invalide (PEM X.509 attendu)', 'CONFIG_INVALID');
    }
  }

  /** État de session exposé en lecture (branchements de la couche routes). */
  get session(): { connectorId: string; initialized: boolean; sessionId: string | null; protocolVersion: string | null } {
    return {
      connectorId: this.connectorId,
      initialized: this.initialized,
      sessionId: this.sessionId,
      protocolVersion: this.negotiatedVersion
    };
  }

  /**
   * initialize : propose REMOTE_MCP_HTTP_PROTOCOL_VERSION, accepte l écho
   * 2024-11-05 ou 2025-03-26, rejette les autres. Le résultat en cache local
   * (un seul handshake par instance) ; les notifications initialized sont
   * best-effort (leur échec transparent n empêche pas la session).
   */
  async initialize(): Promise<RemoteMcpInitializeResult> {
    if (this.firstInitializeResult !== null) {
      return { ...this.firstInitializeResult, sessionId: this.sessionId };
    }
    this.initPromise ??= this.doInitialize();
    try {
      return await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  async listTools(cursor?: string): Promise<RemoteMcpToolsListResult> {
    await this.initialize();
    let params: Record<string, unknown> = {};
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 256) {
        throw new RemoteMcpClientError('cursor de pagination invalide', 'STATE_INVALID');
      }
      params = { cursor };
    }
    const result = await this.requestJsonRpc('tools/list', params);
    if (!isJsonObject(result) || !Array.isArray(result.tools)) {
      throw assertPositiveButton(result, 'liste d outils malformée (tools absent ou non tableau)', this.secrets);
    }
    const tools: RemoteMcpToolDescriptor[] = [];
    for (const [index, entry] of result.tools.entries()) {
      if (!isJsonObject(entry) || typeof entry.name !== 'string' || !TOOL_NAME_PATTERN.test(entry.name)) {
        throw assertPositiveButton(
          entry,
          `outil n° ${index} : nom absent, non textuel ou hors du motif autorisé`,
          this.secrets
        );
      }
      const title = sanitizeStringField(entry.title, 256);
      const description = sanitizeStringField(entry.description, 4096);
      if ((entry.title !== undefined && title === null) || (entry.description !== undefined && description === null)) {
        throw assertPositiveButton(
          entry,
          `outil ${entry.name} : title/description absents, vides ou hors borne`,
          this.secrets
        );
      }
      tools.push({ name: entry.name, title, description, inputSchema: entry.inputSchema });
    }
    let nextCursor: string | null = null;
    if (result.nextCursor !== undefined) {
      if (typeof result.nextCursor !== 'string' || result.nextCursor.length === 0 || result.nextCursor.length > 256) {
        throw assertPositiveButton(result, 'nextCursor de pagination malformé', this.secrets);
      }
      nextCursor = result.nextCursor;
    }
    return { tools, nextCursor };
  }

  /**
   * tools/call. AUCUNE autorisation locale : le nom/schéma ont été approuvés
   * dans la couche routes C3.2-B — le client relaie et TRANSMET l erreur
   * d outil éventuelle (isError true = résultat, pas un échec transport).
   */
  async callTool(toolName: string, args: Readonly<Record<string, unknown>> = {}): Promise<RemoteMcpToolCallResult> {
    await this.initialize();
    if (typeof toolName !== 'string' || !TOOL_NAME_PATTERN.test(toolName)) {
      throw new RemoteMcpClientError(
        'nom d outil invalide pour tools/call (motif [A-Za-z0-9_][A-Za-z0-9._-]*)',
        'STATE_INVALID'
      );
    }
    if (!isJsonObject(args)) {
      throw new RemoteMcpClientError('arguments d outil absents ou non objet', 'STATE_INVALID');
    }
    let argumentsJson: string;
    try {
      argumentsJson = JSON.stringify({ name: toolName, arguments: args });
    } catch {
      throw new RemoteMcpClientError(
        "arguments d outil non sérialisables en JSON (cycle, BigInt, symbol)",
        'ENCODING_INVALID'
      );
    }
    if (Buffer.byteLength(argumentsJson, 'utf8') > this.maxRequestBytes) {
      throw new RemoteMcpClientError(
        `charge utile d outil trop volumineuse (${Buffer.byteLength(argumentsJson, 'utf8')} > ${this.maxRequestBytes} octets)`,
        'REQUEST_TOO_LARGE'
      );
    }
    const result = await this.requestJsonRpc('tools/call', { name: toolName, arguments: args });
    if (!isJsonObject(result)) {
      throw assertPositiveButton(result, 'résultat de tools/call malformé (non objet)', this.secrets);
    }
    const content: unknown[] = [];
    if (result.content !== undefined) {
      if (!Array.isArray(result.content)) {
        throw assertPositiveButton(result, 'content de tools/call malformé (non tableau)', this.secrets);
      }
      for (const [index, item] of result.content.entries()) {
        if (!isJsonObject(item)) {
          throw assertPositiveButton(result, `content[${index}] de tools/call malformé (non objet)`, this.secrets);
        }
        content.push(item);
      }
    }
    let isError = false;
    if (result.isError !== undefined) {
      if (typeof result.isError !== 'boolean') {
        throw assertPositiveButton(result, 'isError de tools/call malformé (non booléen)', this.secrets);
      }
      isError = result.isError;
    }
    const structuredContent =
      result.structuredContent !== undefined ? (result.structuredContent as unknown) : null;
    return { content, isError, structuredContent };
  }

  /* ---------- couche réseau / politique ---------- */

  /**
   * Requête JSON-RPC complète : redirects inclus, validation de réponse,
   * deadline unique. Retourne le `result` de la réponse (objet) ; pour une
   * notification, null (aucune réponse attendue).
   */
  private async requestJsonRpc(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const id = this.nextRequestId++;
    return await this.requestEnvelope(id, { jsonrpc: '2.0', method, params }, true);
  }

  private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    await this.requestEnvelope(null, { jsonrpc: '2.0', method, params }, false);
  }

  private async requestEnvelope(
    id: number | null,
    envelopeBody: { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> },
    expectResponse: boolean
  ): Promise<Record<string, unknown>> {
    const bodyText =
      id === null
        ? JSON.stringify(envelopeBody)
        : JSON.stringify({ ...envelopeBody, id });
    const body = Buffer.from(bodyText, 'utf8');
    if (body.byteLength > this.maxRequestBytes) {
      throw new RemoteMcpClientError(
        `corps de requête trop volumineux (${body.byteLength} > ${this.maxRequestBytes})`,
        'REQUEST_TOO_LARGE'
      );
    }
    const deadline = this.newDeadline();
    try {
      let currentUrl = this.url;
      const hopChain: string[] = [];
      let method = 'POST';
      let requestBody: Buffer | null = body;
      let response: PinnedResponse | null = null;

      while (true) {
        const currentUrlString = currentUrl.href;
        // Étape 1 : URL validée PAR le moteur (réel) à chaque saut.
        const urlPolicy = validateRemoteMcpUrl(currentUrlString);
        if (!urlPolicy.allowed) {
          throw new RemoteMcpClientError(
            hopChain.length === 0
              ? `URL de connecteur refusée par la politique SSRF (${urlPolicy.reason})`
              : `URL de redirection refusée (${urlPolicy.reason}) : cible hors politique à chaque saut`,
            hopChain.length === 0 ? 'URL_POLICY' : 'REDIRECT_POLICY'
          );
        }

        // Étapes 2-3 : résolution explicite + TOUTES les adresses validées.
        let pinned: RemoteMcpDnsAnswer;
        try {
          pinned = await this.resolvePinnedAddress(currentUrl.hostname);
        } catch (error) {
          if (error instanceof RemoteMcpClientError) throw error;
          throw new RemoteMcpClientError(
            `résolution DNS impossible pour ${currentUrl.hostname} (${sanitizeRemoteText(error instanceof Error ? error.message : String(error), this.secrets)}, tronqué)`,
            'DNS_POLICY'
          );
        }

        // Étape 4 : envoi épinglé, socket neuve, TLS + identité, deadline.
        const hopResponse = await this.sendPinnedRequest({
          requestUrl: currentUrl,
          hostname: currentUrl.hostname,
          pinned,
          method,
          body: requestBody,
          deadline,
          expectResponse
        });

        // Session id : capturée une fois (caractères bornés), jamais reflétée.
        const sessionHeader = headerToString(hopResponse.headers['mcp-session-id']);
        if (sessionHeader !== null && SESSION_ID_PATTERN.test(sessionHeader)) {
          this.sessionId = this.sessionId ?? sessionHeader;
        }

        // Étape 5 : redirection manuelle revalidée intégralement.
        if (REDIRECT_STATUS.has(hopResponse.status)) {
          const location = headerToString(hopResponse.headers['location']);
          if (location === null || location.length === 0 || location.length > REMOTE_MCP_URL_MAX_LENGTH) {
            throw new RemoteMcpClientError(
              'redirection reçue sans Location utilisable',
              hopChain.length === 0 ? 'HTTP_STATUS' : 'REDIRECT_POLICY'
            );
          }
          let nextUrl: URL;
          try {
            nextUrl = new URL(location, currentUrl);
          } catch {
            throw new RemoteMcpClientError(
              'redirection reçue avec Location non résoluble',
              'REDIRECT_POLICY'
            );
          }
          hopChain.push(nextUrl.href);
          if (hopChain.length > this.maxRedirects) {
            throw new RemoteMcpClientError(
              `chaîne de redirections dépasse la limite (${this.maxRedirects})`,
              'REDIRECT_LIMIT'
            );
          }
          // Validation cumulative systématique, moteur réel (limite + https
          // + pas de credentials + cible non interdite à l URL).
          const chainPolicy = validateRemoteMcpRedirectChain(this.url.href, hopChain);
          if (!chainPolicy.allowed) {
            throw new RemoteMcpClientError(
              `chaîne de redirections refusée (${chainPolicy.reason})`,
              chainPolicy.reason === 'REDIRECT_LIMIT' ? 'REDIRECT_LIMIT' : 'REDIRECT_POLICY'
            );
          }
          // RFC 7231 : 301/302/303 transforment en GET sans corps, ce qui
          // évite de re-poster le corps initial (effets de bord sensibles).
          if (hopResponse.status === 301 || hopResponse.status === 302 || hopResponse.status === 303) {
            method = 'GET';
            requestBody = null;
          }
          currentUrl = nextUrl;
          continue;
        }

        // Étape 7 : statut final attendu ; tout le reste est une erreur HTTP
        // normalisée. Le corps n est JAMAIS lu ni reflété sur une erreur de
        // statut (anti-fuite : même si le serveur y échoit nos headers).
        if (classifyHttpError(hopResponse.status) || (id !== null && hopResponse.status === 204)) {
          const contentTypeHeader = headerToString(hopResponse.headers['content-type']) ?? '';
          throw new RemoteMcpClientError(
            `réponse HTTP ${hopResponse.status} (content-type « ${remoteSnippet(contentTypeHeader, this.secrets)} ») de ${remoteSnippet(currentUrl.host, this.secrets)} ; corps jamais lu pour une erreur de statut`,
            'HTTP_STATUS'
          );
        }
        response = hopResponse;
        break;
      }
      if (response === null) {
        throw new RemoteMcpClientError('boucle transport interrompue sans réponse', 'CONNECT_ERROR');
      }
      if (!expectResponse) return {};
      if (id === null) {
        throw new RemoteMcpClientError('État interne : réponse attendue sans id', 'STATE_INVALID');
      }

      const decoded = this.parseResponseMessageByType(response, id);
      const errorField = decoded['error'];
      if (errorField !== undefined) {
        if (!isJsonObject(errorField) || typeof errorField.code !== 'number' || typeof errorField.message !== 'string') {
          throw new RemoteMcpClientError(
            'erreur JSON-RPC distante malformée (code/message absents ou invalides)',
            'JSONRPC_INVALID'
          );
        }
        throw new RemoteMcpClientError(
          `MCP distant refuse la requête : ${remoteSnippet(errorField.message, this.secrets)}`,
          'JSONRPC_REMOTE_ERROR',
          errorField.code
        );
      }
      if (!isJsonObject(decoded['result'])) {
        throw assertPositiveButton(decoded, 'réponse JSON-RPC sans result objet', this.secrets);
      }
      return decoded['result'] as Record<string, unknown>;
    } finally {
      deadline.clear();
    }
  }

  private async doInitialize(): Promise<RemoteMcpInitializeResult> {
    const result = await this.requestJsonRpc('initialize', {
      protocolVersion: REMOTE_MCP_HTTP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: REMOTE_MCP_CLIENT_NAME, version: REMOTE_MCP_CLIENT_VERSION }
    });
    if (!isJsonObject(result)) {
      throw assertPositiveButton(result, 'résultat initialize malformé', this.secrets);
    }
    const echoedVersion = result.protocolVersion;
    if (typeof echoedVersion !== 'string' || !SUPPORTED_PROTOCOL_SET.has(echoedVersion)) {
      throw new RemoteMcpClientError(
        `version de protocole distante non supportée : « ${remoteSnippet(typeof echoedVersion === 'string' ? echoedVersion : JSON.stringify(echoedVersion), this.secrets)} » ; supportées : ${REMOTE_MCP_SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,
        'PROTOCOL_UNSUPPORTED'
      );
    }
    const serverInfo = result.serverInfo;
    if (isJsonObject(serverInfo)) {
      const serverName = sanitizeStringField(serverInfo.name, 256);
      const serverVersion = sanitizeStringField(serverInfo.version, 128);
      if (serverName === null && serverInfo.name !== undefined) {
        throw assertPositiveButton(serverInfo, 'serverInfo.name malformé', this.secrets);
      }
      if (serverVersion === null && serverInfo.version !== undefined) {
        throw assertPositiveButton(serverInfo, 'serverInfo.version malformé', this.secrets);
      }
      const capabilities = isJsonObject(result.capabilities) ? result.capabilities : {};
      this.negotiatedVersion = echoedVersion;
      this.initialized = true;
      this.firstInitializeResult = {
        protocolVersion: echoedVersion,
        serverName: serverName ?? '',
        serverVersion: serverVersion ?? '',
        capabilities,
        sessionId: this.sessionId
      };
      await this.notifyInitializedBestEffort();
      return this.firstInitializeResult;
    }
    throw assertPositiveButton(result, 'serverInfo distante malformée', this.secrets);
  }

  private async notifyInitializedBestEffort(): Promise<void> {
    try {
      await this.sendNotification('notifications/initialized', {});
    } catch {
      // best-effort : consommé localement, AUCUN log (pas de fuite).
      return;
    }
  }

  /** Version de protocole acceptée intégrée à chaque requête après initialize. */
  private negotiatedHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.negotiatedVersion !== null) {
      headers['mcp-protocol-version'] = this.negotiatedVersion;
    }
    if (this.sessionId !== null) {
      headers['mcp-session-id'] = this.sessionId;
    }
    return headers;
  }

  /**
   * Résolution + validation : TOUTES les adresses d hôte doivent être
   * publiques (aucune tolérance mixte), puis UNE IP est épinglée. Les
   * injections de test remplacent dns.lookup, JAMAIS la classification par
   * défaut (assertPublicResolvedAddresses reste le verdict de prod ; les
   * tests la délèguent hors loopback).
   */
  private async resolvePinnedAddress(hostname: string): Promise<RemoteMcpDnsAnswer> {
    const host = hostname.replace(/^\[/, '').replace(/\]$/, '');
    const literalFamily = isIP(host);
    if (literalFamily !== 0) {
      return { address: host, family: literalFamily };
    }
    let answers: readonly RemoteMcpDnsAnswer[];
    if (this.dnsResolver !== null) {
      answers = await this.dnsResolver(host);
    } else {
      const looked = await dnsLookupAll(host, { all: true, verbatim: true, family: 0 });
      answers = looked.map(entry => ({ address: entry.address, family: entry.family }));
    }
    const uniqueAddresses: string[] = [];
    for (const answer of answers) {
      if (typeof answer?.address !== 'string') continue;
      if (uniqueAddresses.includes(answer.address)) continue;
      uniqueAddresses.push(answer.address);
    }
    const verdictPolicy =
      this.addressPolicy !== null
        ? this.addressPolicy(uniqueAddresses)
        : assertPublicResolvedAddresses(uniqueAddresses);
    if (!verdictPolicy.allowed) {
      throw new RemoteMcpClientError(
        `résolution DNS refusée pour ${host} (${verdictPolicy.reason}, adresses candidates : ${uniqueAddresses.length})`,
        'DNS_POLICY'
      );
    }
    const pinnedCandidate = uniqueAddresses[0];
    if (pinnedCandidate === undefined) {
      throw new RemoteMcpClientError(`résolution DNS vide pour ${host}`, 'DNS_POLICY');
    }
    if (isIP(pinnedCandidate) === 0) {
      throw new RemoteMcpClientError(`adresse résolue non IP pour ${host}`, 'DNS_POLICY');
    }
    return { address: pinnedCandidate, family: isIP(pinnedCandidate) };
  }

  private newDeadline(): Deadline {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    return {
      signal: controller.signal,
      isTimedOut: () => timedOut,
      convert: (error: RemoteMcpClientError) => {
        if (timedOut) {
          return new RemoteMcpClientError(
            `délai d attente dépassé (${this.timeoutMs} ms) avant réponse complète`,
            'TIMEOUT'
          );
        }
        return error;
      },
      clear: () => clearTimeout(timer)
    };
  }

  /**
   * Envoi unique épinglé : socket NEUVE à chaque appel (agent:false), pas de
   * deuxième résolution implicite, vérification d identité TLS contre le
   * hostname et vérification remoteAddress de la socket réelle.
   */
  private async sendPinnedRequest(
    args: {
      requestUrl: URL;
      hostname: string;
      pinned: RemoteMcpDnsAnswer;
      method: string;
      body: Buffer | null;
      deadline: Deadline;
      expectResponse: boolean;
    }
  ): Promise<PinnedResponse> {
    const port = args.requestUrl.port !== '' ? Number(args.requestUrl.port) : 443;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new RemoteMcpClientError(`port de connecteur invalide (${port})`, 'CONFIG_INVALID');
    }
    // Identité TLS + Host ENTITY loyal au nom d origine : Node dériverait le
    // Host de l IP épinglée ; un serveur virtuel routerait mal. SNI/identité
    // utilisent le nom SANS crochets (Node compare les SAN / IP-SAN dessus).
    const bareHostname = args.requestUrl.hostname.replace(/^\[/, '').replace(/\]$/, '');
    const portSuffix = port === 443 ? '' : `:${port}`;
    const hostHeaderValue = bareHostname.includes(':')
      ? `[${bareHostname}]${portSuffix}`
      : `${bareHostname}${portSuffix}`;
    const headers: Record<string, string> = {
      host: hostHeaderValue,
      accept: ACCEPT_HEADER_VALUE
    };
    if (args.requestUrl.origin === this.url.origin) {
      // Même origine : Authorization + session maintenues (destination validée
      // par les mêmes étapes et certificat identique).
      Object.assign(headers, this.negotiatedHeaders());
      if (this.bearerToken !== null) {
        headers['authorization'] = `Bearer ${this.bearerToken}`;
      }
      if (args.method === 'POST') {
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(args.body?.byteLength ?? 0);
      }
    } else {
      // Origine différente : credentials et session ABANDONNÉS (principe de
      // moindre exposition ; revalidation TLS indépendante avec la CA fixée).
      if (args.method === 'POST') {
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(args.body?.byteLength ?? 0);
      }
    }
    const request = {
      ...(this.caPem !== null ? { ca: this.caPem } : {}),
      host: args.pinned.address,
      port,
      servername: bareHostname,
      method: args.method,
      path: `${args.requestUrl.pathname}${args.requestUrl.search}`,
      headers,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2' as const,
      timeout: this.timeoutMs,
      signal: args.deadline.signal,
      lookup: (hostnameToCheck: string, lookupOptions: unknown, lookupCallback: unknown) => {
        // Garde-fou : la résolution est ÉPINGLÉE ; le callback lookup ne doit
        // jamais dévier de l IP validée (aucune seconde résolution réseau).
        if (hostnameToCheck !== args.pinned.address) {
          (lookupCallback as (err: Error | null, address?: string, family?: number) => void)(
            new RemoteMcpClientError(
              'résolution déviante refusée dans le transport épinglé',
              'SOCKET_MISMATCH'
            )
          );
          return;
        }
        const family = typeof (lookupOptions as { family?: number })?.family === 'number'
          ? (lookupOptions as { family: number }).family
          : 0;
        if (family !== 0 && family !== args.pinned.family) {
          (lookupCallback as (err: Error | null, address?: string, family?: number) => void)(
            new RemoteMcpClientError(
              'famille demandée incompatible avec l IP épinglée',
              'SOCKET_MISMATCH'
            )
          );
          return;
        }
        (lookupCallback as (err: Error | null, address?: string, family?: number) => void)(
          null,
          args.pinned.address,
          args.pinned.family
        );
      },
      agent: false
    };
    const response = await new Promise<PinnedResponse>((resolve, reject) => {
      let req: ReturnType<typeof httpsRequest>;
      try {
        req = httpsRequest(request, res => {
          this.readIncomingResponse(req, res, args.deadline, resolve, reject);
        });
      } catch (error) {
        reject(new RemoteMcpClientError(
          `requête HTTPS non démarrable (${sanitizeRemoteText(error instanceof Error ? error.message : String(error), this.secrets)}, tronqué)`,
          'CONNECT_ERROR'
        ));
        return;
      }
      req.on('socket', socket => {
        this.verifyPinnedSocket(req, socket as TLSSocket, args.pinned.address, reject);
      });
      req.on('error', error => {
        // JAMAIS de `throw` depuis un listener d événement : la promesse ne
        // serait jamais réglée (hang). On rejette explicitement.
        reject(args.deadline.convert(this.translateRequestError(error, args.requestUrl.hostname)));
      });
      if (args.body !== null && args.method !== 'GET') {
        req.write(args.body);
      }
      req.end();
    });
    return response;
  }

  private translateRequestError(error: unknown, hostname: string): RemoteMcpClientError {
    const message = error instanceof Error ? error.message : String(error);
    const sanitized = sanitizeRemoteText(message, this.secrets);
    if (/certificate|CERT|EPROTO|SSL|TLS|handshake/i.test(sanitized)) {
      return new RemoteMcpClientError(
        `TLS refusé (${truncateSnippet(sanitized)}) pour ${remoteSnippet(hostname, this.secrets)}`,
        'TLS_FAILURE'
      );
    }
    return new RemoteMcpClientError(
      `transport en échec : ${truncateSnippet(sanitized)} vers ${remoteSnippet(hostname, this.secrets)}`,
      'CONNECT_ERROR'
    );
  }

  private verifyPinnedSocket(
    req: ReturnType<typeof httpsRequest>,
    socket: TLSSocket,
    pinnedAddress: string,
    reject: (error: RemoteMcpClientError) => void
  ): void {
    const checkSocketIdentity = (): void => {
      if (socket.remoteAddress === undefined) {
        reject(new RemoteMcpClientError('socket épinglée sans remoteAddress observée', 'SOCKET_MISMATCH'));
        return;
      }
      if (socket.remoteAddress !== pinnedAddress) {
        req.destroy();
        reject(new RemoteMcpClientError(
          `socket réellement connectée à ${socket.remoteAddress} au lieu de l épingle ${pinnedAddress} (MITM/split-horizon détecté)`,
          'SOCKET_MISMATCH'
        ));
        return;
      }
    };
    if (socket.remoteAddress !== undefined) {
      checkSocketIdentity();
      return;
    }
    socket.once('secureConnect', checkSocketIdentity);
  }

  private readIncomingResponse(
    req: ReturnType<typeof httpsRequest>,
    res: IncomingMessage,
    deadline: Deadline,
    resolve: (value: PinnedResponse) => void,
    reject: (error: RemoteMcpClientError) => void
  ): void {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const finalize = (error: RemoteMcpClientError | null): void => {
      if (settled) return;
      settled = true;
      if (error === null) {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        return;
      }
      req.destroy();
      reject(error);
    };
    const contentLength = Number(headerToString(res.headers['content-length']));
    if (Number.isInteger(contentLength) && contentLength > this.maxResponseBytes) {
      finalize(new RemoteMcpClientError(
        `corps de réponse annoncé au-delà du plafond (${contentLength} > ${this.maxResponseBytes} octets)`,
        'RESPONSE_TOO_LARGE'
      ));
      res.destroy();
      return;
    }
    res.on('data', (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > this.maxResponseBytes) {
        chunks.length = 0;
        finalize(new RemoteMcpClientError(
          `corps de réponse dépasse le plafond (${this.maxResponseBytes} octets)`,
          'RESPONSE_TOO_LARGE'
        ));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => finalize(null));
    res.on('error', error => {
      if (deadline.isTimedOut()) {
        finalize(new RemoteMcpClientError(`délai d attente dépassé (${this.timeoutMs} ms)`, 'TIMEOUT'));
        return;
      }
      finalize(new RemoteMcpClientError(
        `lecture de réponse interrompue (${truncateSnippet(sanitizeRemoteText(error.message, this.secrets))})`,
        'CONNECT_ERROR'
      ));
    });
    res.on('aborted', () => {
      if (deadline.isTimedOut()) {
        finalize(new RemoteMcpClientError(`délai d attente dépassé (${this.timeoutMs} ms)`, 'TIMEOUT'));
        return;
      }
      finalize(new RemoteMcpClientError('connexion interrompue avant fin de réponse', 'CONNECT_ERROR'));
    });
  }

  /** Analyse selon content-type : JSON direct ou SSE (5.8 delim 'data:'). */
  private parseResponseMessageByType(response: PinnedResponse, id: number): Record<string, unknown> {
    const contentTypeRaw = headerToString(response.headers['content-type']) ?? '';
    const contentType = contentTypeRaw.split(';')[0]?.trim().toLowerCase() ?? '';
    const bodyText = response.body.toString('utf8');
    if (contentType === 'text/event-stream') {
      const message = extractSseMessageForId(bodyText, id);
      if (message === null) {
        throw new RemoteMcpClientError(
          `flux SSE sans message correspondant à l id ${id} (${remoteSnippet(bodyText, this.secrets)})`,
          'JSONRPC_INVALID'
        );
      }
      return this.validateJsonRpcResponseShape(message, id);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch (error) {
      throw new RemoteMcpClientError(
        `corps de réponse non JSON (${remoteSnippet(error instanceof Error ? error.message : String(error), this.secrets)} ; corps : ${remoteSnippet(bodyText, this.secrets)})`,
        'JSONRPC_INVALID'
      );
    }
    if (!isJsonObject(parsed)) {
      throw new RemoteMcpClientError(
        `corps de réponse JSON non objet (${remoteSnippet(bodyText, this.secrets)})`,
        'JSONRPC_INVALID'
      );
    }
    return this.validateJsonRpcResponseShape(parsed, id);
  }

  /** jsonrpc === '2.0' + id strictement apparié. */
  private validateJsonRpcResponseShape(
    parsed: Record<string, unknown>,
    id: number
  ): Record<string, unknown> {
    if (parsed.jsonrpc !== '2.0') {
      throw new RemoteMcpClientError(
        `champ jsonrpc inattendu (attendu « 2.0 », reçu « ${remoteSnippet(String(parsed.jsonrpc), this.secrets)} »)`,
        'JSONRPC_INVALID'
      );
    }
    if (parsed.id !== id) {
      throw new RemoteMcpClientError(
        `id de réponse non apparié (attendu ${id}, reçu ${remoteSnippet(typeof parsed.id === 'object' ? JSON.stringify(parsed.id) : String(parsed.id), this.secrets)})`,
        'JSONRPC_INVALID'
      );
    }
    return parsed;
  }
}

/** Construit l erreur ENCODING_INVALID en assainissant le fragment distants. */
function assertPositiveButton(
  value: unknown,
  message: string,
  secrets: readonly string[]
): RemoteMcpClientError {
  let snippet = '';
  try {
    snippet = JSON.stringify(value);
  } catch {
    snippet = '[non sérialisable]';
  }
  return new RemoteMcpClientError(`${message} (${remoteSnippet(snippet, secrets)})`, 'ENCODING_INVALID');
}

/** Extrait du flux SSE LE PREMIER évènement portant le JSON-RPC attendu. */
export function extractSseMessageForId(streamText: string, id: number): Record<string, unknown> | null {
  const eventBlocks = streamText.split(/\r?\n\r?\n/);
  for (const block of eventBlocks) {
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    if (isJsonObject(parsed) && parsed.id === id) {
      return parsed;
    }
  }
  return null;
}
