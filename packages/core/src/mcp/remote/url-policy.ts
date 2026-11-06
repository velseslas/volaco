/**
 * C3.1 — Règle d'éligibilité des connecteurs MCP distants (URL-only).
 *
 * FONCTION PURE : aucun DNS, aucune connexion, aucune redirection n'est
 * exécutée ici. Le client HTTP (C3.2) est responsable de la chaîne complète :
 *   1. validateRemoteMcpUrl(url)                      → pré-validation locale ;
 *   2. résolution DNS côté client avec verbatim=true ;
 *   3. assertPublicResolvedAddresses(ips)             → TOUTES les adresses
 *      résolues doivent être publiques (tentative « DNS mixte public/privé »
 *      refusée, pas simplement ignorée) ;
 *   4. redirections : chaque saut est revalidé (1→4), au plus
 *      REMOTE_MCP_MAX_REDIRECTS sauts, sans downgrade de schéma.
 *
 * Blocage d'adresses : loopback, RFC 1918, CGNAT (100.64/10), link-local
 * (dont 169.254.169.254 — métadonnées cloud), unspecified, multicast, ULA
 * (fc00::/7), documentation (2001:db8::/32), NAT64, IPv4-mappée IPv6
 * (l'ENVELOPPE ::ffff:… est refusée même si la cible embarquée est publique),
 * 0/8, TEST-NET, classe E.
 *
 * NB : grille distincte de `browser-server.ts urlBlockReason()` (allowlist
 * loopback pour les previews) — aucune dépendance, aucune modification.
 */

import { isIP } from 'node:net';

export const REMOTE_MCP_URL_MAX_LENGTH = 2048;
export const REMOTE_MCP_MAX_REDIRECTS = 3;

export type RemoteMcpUrlBlockReason =
  | 'INVALID_URL'
  | 'NON_HTTPS'
  | 'CREDENTIALS_IN_URL'
  | 'EMPTY_HOST'
  | 'NOT_RESOLVED'
  | 'NON_PUBLIC_ADDRESS'
  | 'IPV4_MAPPED_IPV6'
  | 'REDIRECT_LIMIT';

export type RemoteMcpUrlPolicyResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: RemoteMcpUrlBlockReason };

export type RemoteMcpAddressClass =
  | 'PUBLIC'
  | 'LOOPBACK'
  | 'PRIVATE'
  | 'LINK_LOCAL'
  | 'IPV4_MAPPED_IPV6'
  | 'NAT64'
  | 'UNSPECIFIED'
  | 'MULTICAST'
  | 'RESERVED'
  | 'INVALID';

const ALLOWED_URL_RESULT: RemoteMcpUrlPolicyResult = { allowed: true as const };

/** Préfixe de 96 bits des IPv4-mappées (::ffff:a.b.c.d ou ::ffff:xxxx:xxxx). */
const MAPPED_TOP_96 = 0x00000000000000000000ffffn;
/** Préfixe de 96 bits de NAT64 (64:ff9b::/96). */
const NAT64_TOP_96 = 0x0064ff9b0000000000000000n;

function classifyIpv4Number(n: number): RemoteMcpAddressClass {
  const a = (n >>> 24) & 0xff;
  const b = (n >>> 16) & 0xff;
  const c = (n >>> 8) & 0xff;
  if (a === 127) return 'LOOPBACK';
  if (a === 10) return 'PRIVATE';
  if (a === 172 && b >= 16 && b <= 31) return 'PRIVATE';
  if (a === 192 && b === 168) return 'PRIVATE';
  if (a === 100 && b >= 64 && b <= 127) return 'PRIVATE'; // CGNAT
  if (a === 169 && b === 254) return 'LINK_LOCAL'; // métadonnées cloud incluses
  if (a === 0) return 'UNSPECIFIED';
  if (a === 192 && b === 0 && c === 2) return 'RESERVED'; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return 'RESERVED';
  if (a >= 224 && a <= 239) return 'MULTICAST';
  if (a >= 240) return 'RESERVED'; // classe E
  return 'PUBLIC';
}

function parseIpv4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) | octet;
    value = value >>> 0;
  }
  return value >>> 0;
}

/**
 * Décode une IPv6 textuelle (compression '::', suffixe IPv4 embarqué éventuel)
 * en BigInt 128 bits. Retourne null si non parseable.
 */
function parseIpv6ToBigInt(text: string): bigint | null {
  const cleaned = text.replace(/^\[|\]$/g, '').trim();
  if (cleaned.length === 0 || cleaned.includes('%')) return null;

  let compressed = false;
  let leftStr = '';
  let rightStr = '';
  const firstDouble = cleaned.indexOf('::');
  if (firstDouble !== -1) {
    if (cleaned.indexOf('::', firstDouble + 1) !== -1) return null;
    compressed = true;
    leftStr = cleaned.slice(0, firstDouble);
    rightStr = cleaned.slice(firstDouble + 2);
  } else {
    leftStr = cleaned;
  }

  // Suffixe IPv4 embarqué : uniquement en fin de partie comprimée, ou en fin
  // de la forme complète (ex. '::ffff:127.0.0.1', '64:ff9b::127.0.0.1',
  // '0064:ff9b:0:0:0:0:7f00:1' avec chaque groupe explicite).
  let embeddedIpv4: string | null = null;
  const tailIsRight = rightStr.length > 0 || compressed;
  let hostPart = tailIsRight ? rightStr : leftStr;
  if (hostPart.includes('.')) {
    const lastColon = hostPart.lastIndexOf(':');
    if (lastColon === -1) {
      // la fin est intégralement une IPv4 embarquée (ex. '64:ff9b::127.0.0.1')
      embeddedIpv4 = hostPart;
      hostPart = '';
    } else {
      embeddedIpv4 = hostPart.slice(lastColon + 1);
      hostPart = hostPart.slice(0, lastColon);
    }
  }

  const leftHex = leftStr.length > 0 ? leftStr.split(':') : [];
  const rightHex = tailIsRight && hostPart.length > 0 ? hostPart.split(':') : [];
  const embeddedGroups = embeddedIpv4 !== null ? 2 : 0;
  const declared = leftHex.length + rightHex.length + embeddedGroups;
  let missing = 0;
  if (compressed) {
    missing = 8 - declared;
    if (missing < 0) return null;
  } else if (declared !== 8) {
    return null;
  }

  const groups: number[] = [];
  for (const g of leftHex) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  for (let i = 0; i < missing; i++) groups.push(0);
  for (const g of rightHex) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  if (embeddedIpv4 !== null) {
    const value = parseIpv4(embeddedIpv4);
    if (value === null) return null;
    groups.push((value >>> 16) & 0xffff);
    groups.push(value & 0xffff);
  }
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    const g = groups[i];
    if (g === undefined || !Number.isInteger(g) || g < 0 || g > 0xffff) return null;
    value = (value << 16n) | BigInt(g);
  }
  return value;
}

/** Classe une adresse IP littérale. Retourne 'INVALID' si non parseable. */
export function classifyRemoteMcpAddress(ip: string): RemoteMcpAddressClass {
  const family = isIP(ip);
  if (family === 4) {
    const value = parseIpv4(ip);
    if (value === null) return 'INVALID';
    return classifyIpv4Number(value);
  }
  if (family === 6) {
    const value = parseIpv6ToBigInt(ip);
    if (value === null) return 'INVALID';
    const top96 = value >> 32n;
    if (top96 === MAPPED_TOP_96) return 'IPV4_MAPPED_IPV6'; // enveloppe ::ffff:… refusée (stricte)
    if (top96 === NAT64_TOP_96) return 'NAT64';
    if (value === 0n) return 'UNSPECIFIED';
    if (value === 1n) return 'LOOPBACK';
    if (top96 === 0n) {
      // forme dépréciée IPv4-compatible (::x.x.x.x) : on juge la cible embarquée
      return classifyIpv4Number(Number(value & 0xffffffffn));
    }
    const g0 = (value >> 112n) & 0xffffn;
    if ((g0 & 0xffc0n) === 0xfe80n) return 'LINK_LOCAL'; // fe80::/10
    if (g0 >= 0xfc00n && g0 <= 0xfdffn) return 'PRIVATE'; // ULA fc00::/7
    if (g0 >= 0xff00n && g0 <= 0xffffn) return 'MULTICAST';
    if (g0 === 0x2001n && ((value >> 96n) & 0xffffn) === 0xdb8n) return 'RESERVED'; // documentation
    return 'PUBLIC';
  }
  return 'INVALID';
}

/**
 * Première ligne de défense (locale, sans réseau) : https uniquement, pas de
 * credentials, hôte non vide ; si l'hôte est une IP littérale, elle doit être
 * publique. Les hôtes DNS restent acceptables ici : leur vérité est établie
 * à l'étape de résolution (2/3), jamais à partir de la simple chaîne d'URL.
 */
export function validateRemoteMcpUrl(rawUrl: string): RemoteMcpUrlPolicyResult {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > REMOTE_MCP_URL_MAX_LENGTH) {
    return { allowed: false, reason: 'INVALID_URL' };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'INVALID_URL' };
  }
  if (parsed.protocol !== 'https:') return { allowed: false, reason: 'NON_HTTPS' };
  if (parsed.username !== '' || parsed.password !== '') {
    return { allowed: false, reason: 'CREDENTIALS_IN_URL' };
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host.length === 0) return { allowed: false, reason: 'EMPTY_HOST' };
  if (isIP(host) !== 0) {
    const klass = classifyRemoteMcpAddress(host);
    if (klass === 'IPV4_MAPPED_IPV6') return { allowed: false, reason: 'IPV4_MAPPED_IPV6' };
    if (klass !== 'PUBLIC') return { allowed: false, reason: 'NON_PUBLIC_ADDRESS' };
  }
  return ALLOWED_URL_RESULT;
}

/**
 * Deuxième ligne de défense (à jouer par le client C3.2 après `dns.lookup`,
 * { all: true, verbatim: true }) : TOUTES les adresses résolues d'un même
 * hôte doivent être publiques — une seule adresse non publique suffit au refus.
 */
export function assertPublicResolvedAddresses(
  resolvedIps: readonly string[]
): RemoteMcpUrlPolicyResult {
  if (resolvedIps.length === 0) return { allowed: false, reason: 'NOT_RESOLVED' };
  for (const ip of resolvedIps) {
    if (typeof ip !== 'string') return { allowed: false, reason: 'NON_PUBLIC_ADDRESS' };
    const klass = classifyRemoteMcpAddress(ip);
    if (klass === 'IPV4_MAPPED_IPV6') return { allowed: false, reason: 'IPV4_MAPPED_IPV6' };
    if (klass !== 'PUBLIC') return { allowed: false, reason: 'NON_PUBLIC_ADDRESS' };
  }
  return ALLOWED_URL_RESULT;
}

/**
 * Politique de redirections : au plus REMOTE_MCP_MAX_REDIRECTS sauts, chaque
 * saut revalidé par validateRemoteMcpUrl (aucun downgrade http://). Chaque
 * destination devra ensuite être re-résolue puis re-validée par le client
 * C3.2 avant d'être contactée — cette fonction est pure et sans réseau.
 */
export function validateRemoteMcpRedirectChain(
  startUrl: string,
  nextUrls: readonly string[]
): RemoteMcpUrlPolicyResult {
  if (nextUrls.length > REMOTE_MCP_MAX_REDIRECTS) {
    return { allowed: false, reason: 'REDIRECT_LIMIT' };
  }
  for (const url of nextUrls) {
    const hop = validateRemoteMcpUrl(url);
    if (!hop.allowed) return hop;
  }
  return ALLOWED_URL_RESULT;
}
