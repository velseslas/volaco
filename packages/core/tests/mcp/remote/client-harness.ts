/**
 * C3.3 — Harnais de test partagé pour le client HTTPS MCP distant (TESTS ONLY,
 * jamais consommé par les sources de production).
 *
 * EXTRAIT mot pour mot de l'infra de client.test.ts (« C3.2-A », blocs
 * DER/X.509 + serveur TLS mock local + résolveurs + helpers) CAR la batterie
 * C3.3 (client-c33.test.ts) et la suite API (mcp-remote-real-handshake.test.ts)
 * réutilisent la MÊME griffe : une seule source de vérité des preuves, aucune
 * divergence possible entre suites.
 *
 * Propriétés conservées (à préserver lors de toute évolution) :
 *   - certificats générés en DER natif node:crypto (aucune dépendance, aucun
 *     binaire externe, aucune attente réseau) ;
 *   - serveur TLS local sur 127.0.0.1, TLD .invalid JAMAIS résolu hors tests
 *     (aucun trafic Internet) ;
 *   - l'addressPolicyForTests de test autorise UNIQUEMENT loopback et délègue
 *     tout verdict non-loopback à assertPublicResolvedAddresses RÉELLE ;
 *   - validateRemoteMcpUrl / validateRemoteMcpRedirectChain restent toujours
 *     réels (moteurs de production, fonctions pures sans réseau).
 */

import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import https from 'node:https';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { REMOTE_MCP_HTTP_PROTOCOL_VERSION, RemoteMcpClientError, type RemoteMcpAddressPolicyForTests, type RemoteMcpClientOptions, type RemoteMcpDnsResolverForTests } from '../../../src/mcp/remote/client.js';
import { assertPublicResolvedAddresses, classifyRemoteMcpAddress } from '../../../src/mcp/remote/url-policy.js';

/* ============================ infra : DER/X.509 ============================ */

const DER_NULL = Buffer.from([0x05, 0x00]);

function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derWrap(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(...parts: readonly Buffer[]): Buffer {
  return derWrap(0x30, Buffer.concat(parts));
}

function derSet(...parts: readonly Buffer[]): Buffer {
  return derWrap(0x31, Buffer.concat(parts));
}

function derPositiveInteger(bytes: Buffer): Buffer {
  if (bytes.length === 0 || (bytes[0] ?? 0) > 0x7f) {
    return derWrap(0x02, Buffer.concat([Buffer.from([0]), bytes]));
  }
  return derWrap(0x02, bytes);
}

/**
 * C3.4 — correctif de HARNAIS (test only) : numéro de série ENTIER positif
 * minimal-garanti. `randomBytes(15)` brut peut commencer par 0x00 puis un
 * octet < 0x80 : INTEGER strictement non minimal → OpenSSL 3.x rejette le
 * contexte TLS mock (« illegal padding ») de façon INTERMITTENTE. Premier
 * byte forcé dans [0x40, 0x7f] : toujours minimal, toujours positif.
 */
function positiveSerial(): Buffer {
  const bytes = randomBytes(15);
  bytes[0] = (bytes[0] ?? 0x40) & 0x7f;
  if ((bytes[0] ?? 0) < 0x40) bytes[0] = 0x40 | (bytes[0] ?? 0); // bit 6 posé : [0x40,0x7f]
  return bytes;
}

function derBitStringFromIndexes(indexes: readonly number[]): Buffer {
  const lastSet = Math.max(...indexes);
  const byteLength = Math.floor(lastSet / 8) + 1;
  const bytes = Buffer.alloc(byteLength, 0);
  for (const index of indexes) {
    const byte = Math.floor(index / 8);
    const bit = index % 8;
    bytes[byte] = (bytes[byte] ?? 0) | (0x80 >> bit);
  }
  return derWrap(0x03, Buffer.concat([Buffer.from([byteLength * 8 - (lastSet + 1)]), bytes]));
}

function derOid(dotted: string): Buffer {
  const arcs = dotted.split('.').map(part => Number.parseInt(part, 10));
  const first = arcs[0] ?? 0;
  const second = arcs[1] ?? 0;
  const bytes: number[] = [first * 40 + second];
  for (const arc of arcs.slice(2)) {
    const chunks: number[] = [];
    let value = arc;
    do {
      chunks.unshift(value & 0x7f);
      value = Math.floor(value / 128);
    } while (value > 0);
    for (let i = 0; i < chunks.length - 1; i += 1) chunks[i] = (chunks[i] ?? 0) | 0x80;
    bytes.push(...chunks);
  }
  return derWrap(0x06, Buffer.from(bytes));
}

function derUtcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, '0');
  const twoDigitYear = String(date.getUTCFullYear()).slice(-2);
  const text =
    `${twoDigitYear}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return derWrap(0x17, Buffer.from(text, 'ascii'));
}

function derUtf8(text: string): Buffer {
  return derWrap(0x0c, Buffer.from(text, 'utf8'));
}

export function derName(cn: string): Buffer {
  return derSequence(derSet(derSequence(derOid('2.5.4.3'), derUtf8(cn))));
}

function derDnsName(name: string): Buffer {
  return derWrap(0x82, Buffer.from(name, 'utf8'));
}

export function pemFromDer(der: Buffer, label: string): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function derExtension(oid: string, critical: boolean, value: Buffer): Buffer {
  const parts: Buffer[] = [derOid(oid)];
  if (critical) parts.push(Buffer.from([0x01, 0x01, 0xff]));
  parts.push(derWrap(0x04, value));
  return derSequence(...parts);
}

const SIGNATURE_ALGORITHM_OID = '1.2.840.113549.1.1.11'; // sha256WithRSAEncryption

export interface CertificateSpec {
  readonly serialSource: Buffer;
  readonly subjectCn: string;
  readonly dnsNames: readonly string[];
  readonly pubSpki: Buffer;
  readonly issuerName: Buffer;
  readonly isCa: boolean;
  readonly signingKey: KeyObject;
  /**
   * Signatature de la fenêtre de validité : nombre de jours entre l'émission
   * (maintenant - 24h) et l'expiration. Une valeur NÉGATIVE produit un
   * certificat DÉJÀ EXPIRÉ (C3.3 : test de refus d'un certificat périmé).
   */
  readonly validityDays: number;
}

export function buildCertPem(spec: CertificateSpec): string {
  const now = Date.now();
  const notBefore = derUtcTime(new Date(now - 24 * 3600 * 1000));
  const notAfter = derUtcTime(new Date(now + spec.validityDays * 24 * 3600 * 1000));
  const serial = Buffer.from(spec.serialSource);
  if (serial.length > 0) serial[0] = (serial[0] ?? 0) & 0x3f; // série positive canonique
  const signatureAlgorithm = derSequence(derOid(SIGNATURE_ALGORITHM_OID), DER_NULL);
  const extensions: Buffer[] = spec.isCa
    ? [
        // BasicConstraints avec cA=TRUE explicite : une SEQUENCE vide signifierait
        // cA=FALSE (défaut RFC 5280) et casserait la construction de chaîne TLS.
        derExtension('2.5.29.19', true, derSequence(Buffer.from([0x01, 0x01, 0xff]))), // CA:TRUE
        derExtension('2.5.29.15', true, derBitStringFromIndexes([5])) // keyCertSign
      ]
    : [
        derExtension('2.5.29.15', true, derBitStringFromIndexes([0, 2])), // digitalSignature+keyEncipherment
        derExtension('2.5.29.17', false, derSequence(...spec.dnsNames.map(name => derDnsName(name)))),
        derExtension('2.5.29.37', false, derSequence(derOid('1.3.6.1.5.5.7.3.1'))) // id-kp-serverAuth
      ];
  const tbs = derSequence(
    derWrap(0xa0, derPositiveInteger(Buffer.from([2]))), // version v3
    derPositiveInteger(serial),
    signatureAlgorithm,
    spec.issuerName,
    derSequence(notBefore, notAfter),
    derName(spec.subjectCn),
    spec.pubSpki,
    derWrap(0xa3, derSequence(...extensions))
  );
  const signature = sign('sha256', tbs, spec.signingKey);
  const certificate = derSequence(
    tbs,
    signatureAlgorithm,
    derWrap(0x03, Buffer.concat([Buffer.from([0]), signature]))
  );
  return pemFromDer(certificate, 'CERTIFICATE');
}

export function generateRsaKeyPair(): { key: KeyObject; spki: Buffer; pem: string } {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    key: pair.privateKey,
    spki: pair.publicKey.export({ format: 'der', type: 'spki' }),
    pem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' })
  };
}

export const CA_SUBJECT = 'Volaco MCP Test Root Authority';

const CA_KEY = generateRsaKeyPair();
export const CA_CERT_PEM = buildCertPem({
  serialSource: positiveSerial(),
  subjectCn: CA_SUBJECT,
  dnsNames: [],
  pubSpki: CA_KEY.spki,
  issuerName: derName(CA_SUBJECT),
  isCa: true,
  signingKey: CA_KEY.key,
  validityDays: 3650
});

export function generateLeaf(cn: string, dns: string[]): { pem: string; cert: string } {
  const pair = generateRsaKeyPair();
  const cert = buildCertPem({
    serialSource: positiveSerial(),
    subjectCn: cn,
    dnsNames: dns,
    pubSpki: pair.spki,
    issuerName: derName(CA_SUBJECT),
    isCa: false,
    signingKey: CA_KEY.key,
    validityDays: 90
  });
  return { pem: pair.pem, cert };
}

export const TEST_HOSTNAME = 'mcp-remote-tests.invalid';
export const HOST_B = 'mcp-remote-tests-b.invalid';
export const BEARER_TOKEN_VALUE = 'Bearer-Test-Token-4x9KPQZ';
export const LEAF_MAIN = generateLeaf(TEST_HOSTNAME, [TEST_HOSTNAME]);
export const LEAF_MISMATCH = generateLeaf('mcp-remote-tests-autre.invalid', ['mcp-remote-tests-autre.invalid']);
export const LEAF_B = generateLeaf(HOST_B, [HOST_B]);
/** C3.3 — feuille DÉJÀ EXPIRÉE (validité -1 j) : refus TLS de la validation temporelle. */
export const LEAF_EXPIRED = (() => {
  const pair = generateRsaKeyPair();
  const cert = buildCertPem({
    serialSource: positiveSerial(),
    subjectCn: TEST_HOSTNAME,
    dnsNames: [TEST_HOSTNAME],
    pubSpki: pair.spki,
    issuerName: derName(CA_SUBJECT),
    isCa: false,
    signingKey: CA_KEY.key,
    validityDays: -1
  });
  return { pem: pair.pem, cert };
})();

/* ============================ infra : serveur mock ============================ */

export interface MockRequestRecord {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly bodyText: string;
}

export interface MockHandle {
  readonly port: number;
  readonly requests: MockRequestRecord[];
  readonly sniNames: ReadonlyArray<string | null>;
  /** Accesseur : le compteur de handshakes évolue APRES la construction du handle. */
  getTlsHandshakeCount(): number;
  close(): Promise<void>;
}

export type MockHandler = (ctx: { req: IncomingMessage; res: ServerResponse; bodyText: string }) => void | Promise<void>;

export async function startMockServer(
  leaf: { pem: string; cert: string },
  handler: MockHandler
): Promise<MockHandle> {
  const requests: MockRequestRecord[] = [];
  const sniNames: Array<string | null> = [];
  let handshakeCount = 0;
  const server = https.createServer(
    { key: leaf.pem, cert: leaf.cert },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        requests.push({
          method: req.method ?? '',
          path: req.url ?? '',
          headers: req.headers,
          bodyText
        });
        void (async () => {
          try {
            await handler({ req, res, bodyText });
          } catch {
            if (!res.writableEnded) {
              res.statusCode = 500;
              res.end('mock handler failure');
            }
          }
        })();
      });
    }
  );
  server.on('secureConnection', (socket: TLSSocket) => {
    handshakeCount += 1;
    // TLSSocket.servername : string | false | null selon @types/node (false
    // quand SNI absent, ex. connexion directe sur IP littérale).
    sniNames.push(typeof socket.servername === 'string' ? socket.servername : null);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('adresse serveur inattendue');
  return {
    port: address.port,
    requests,
    sniNames,
    getTlsHandshakeCount: () => handshakeCount,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    }
  };
}

export function respondJsonRpcResult(
  res: ServerResponse,
  id: number,
  result: Record<string, unknown>,
  headers: Record<string, string> = {},
  status = 200
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

export function respondJsonRpcError(
  res: ServerResponse,
  id: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
  status = 200
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

export function respondRaw(
  res: ServerResponse,
  status: number,
  body: Buffer,
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, headers);
  res.end(body);
}

export interface MockBody {
  readonly jsonrpc: '2.0';
  readonly id?: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export function parseRpcBody(bodyText: string): MockBody {
  return JSON.parse(bodyText) as MockBody;
}

export const HAPPY_TOOLS = [
  {
    name: 'echo',
    title: 'Renvoi',
    description: 'Renvoie le texte passe en argument.',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } } }
  },
  { name: 'server_status', description: 'Statut du serveur factice.', inputSchema: { type: 'object' } }
];

/** Handler MCP standard du mock : initialize / notification / list / call. */
export function standardMcpHandler(ctx: { res: ServerResponse; bodyText: string }): void {
  let body: MockBody;
  try {
    body = parseRpcBody(ctx.bodyText);
  } catch {
    respondRaw(ctx.res, 400, Buffer.from('corps non parsé par le mock'), { 'content-type': 'text/plain' });
    return;
  }
  switch (body.method) {
    case 'initialize':
      respondJsonRpcResult(
        ctx.res,
        body.id ?? 0,
        {
          protocolVersion: REMOTE_MCP_HTTP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp-server', version: '1.2.3' }
        },
        { 'mcp-session-id': 'sess-alpha-1' }
      );
      return;
    case 'notifications/initialized':
      ctx.res.writeHead(202);
      ctx.res.end();
      return;
    case 'tools/list':
      respondJsonRpcResult(ctx.res, body.id ?? 0, { tools: HAPPY_TOOLS });
      return;
    case 'tools/call':
      respondJsonRpcResult(ctx.res, body.id ?? 0, {
        content: [{ type: 'text', text: `salut ${String((body.params?.['arguments'] as Record<string, unknown> | undefined)?.['question'] ?? '')}` }]
      });
      return;
    default:
      respondJsonRpcError(ctx.res, body.id ?? 0, -32601, 'méthode inconnue du mock MCP');
      return;
  }
}

/* ============================ infra : client de test ============================ */

export const allowLoopbackOrRealPolicy: RemoteMcpAddressPolicyForTests = ips => {
  if (ips.length > 0 && ips.every(ip => classifyRemoteMcpAddress(ip) === 'LOOPBACK')) {
    return { allowed: true };
  }
  return assertPublicResolvedAddresses(ips);
};

export const DEFAULT_LOOPBACK_RESOLVER: RemoteMcpDnsResolverForTests = async () => [
  { address: '127.0.0.1', family: 4 }
];

export function spyResolver(mapping: Record<string, readonly string[]>): {
  resolver: RemoteMcpDnsResolverForTests;
  hostsSeen: string[];
} {
  const hostsSeen: string[] = [];
  const resolver: RemoteMcpDnsResolverForTests = async host => {
    hostsSeen.push(host);
    const ips = mapping[host] ?? [];
    return ips.map(ip => ({ address: ip, family: ip.includes(':') ? 6 : 4 }));
  };
  return { resolver, hostsSeen };
}

export function testClientOptions(
  url: string,
  overrides: Partial<RemoteMcpClientOptions> = {}
): RemoteMcpClientOptions {
  const base: RemoteMcpClientOptions = {
    url,
    connectorId: 'conn-test-1',
    bearerToken: BEARER_TOKEN_VALUE,
    caPem: CA_CERT_PEM,
    dnsResolverForTests: DEFAULT_LOOPBACK_RESOLVER,
    addressPolicyForTests: allowLoopbackOrRealPolicy
  };
  return { ...base, ...overrides };
}

export function asClientError(error: unknown): RemoteMcpClientError {
  if (error instanceof RemoteMcpClientError) return error;
  throw new Error(`erreur inattendue (type ${String(error)}) : ${error instanceof Error ? error.message : ''}`);
}
