/**
 * VibeCode Core — Serveur MCP « navigateur » (P3)
 *
 * Serveur MCP stdio exposant Playwright (déjà installé) :
 * - browser_navigate   : charge une URL http(s) AUTORISÉE (voir grille SEC-02)
 * - browser_screenshot : capture PNG base64 de la page courante
 *
 * Utilisé pour inspecter/photographier les apps générées depuis un agent
 * (previews locales). Le navigateur est lancé paresseusement au premier
 * outil appelé.
 *
 * SEC-02 — grille anti-SSRF (seul point de passage : `isUrlAllowed`) :
 * - schéma http/https uniquement (`data:`, `file:` et cie refusés) ;
 * - pas d'identifiants dans l'URL, longueur bornée (2 048) ;
 * - ALLOWLIST : loopback (127/8, ::1 — les previews) + hôtes opérateur
 *   (`VOLACO_BROWSER_ALLOW_HOSTS`, séparés par des virgules). TOUT le reste
 *   est refusé : RFC 1918, link-local (dont 169.254.169.254, métadonnées
 *   cloud), multicast, réservé — et l'internet public par défaut ;
 * - la résolution DNS est revérifiée (toutes les adresses doivent passer) ;
 * - chaque requête réseau de la page (navigation, redirections,
 *   sous-ressources) est re-contrôlée par interception Playwright ;
 * - Chromium tourne EN sandbox (repli `VOLACO_CHROMIUM_NO_SANDBOX=1`
 *   uniquement pour les environnements sans sandbox possible : root/docker).
 */

import {
  MCP_ERROR,
  MCP_PROTOCOL_VERSION,
  decodeMessage,
  encodeError,
  encodeSuccess,
  type McpToolDefinition
} from './protocol.js';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'browser_navigate',
    description: 'Charge une URL http(s) autorisée (loopback/previews ou hôtes opérateur) dans Chromium headless sandboxé.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL http(s) à charger' } },
      required: ['url']
    }
  },
  {
    name: 'browser_screenshot',
    description: 'Capture la page courante en PNG base64 (fullPage).',
    inputSchema: { type: 'object', properties: {} }
  }
];

const MAX_URL_LENGTH = 2048;

let currentUrl = '';

function allowHosts(): Set<string> {
  return new Set(
    (process.env.VOLACO_BROWSER_ALLOW_HOSTS || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0)
  );
}

type IpKind = 'loopback' | 'blocked' | 'other';

function ipv4Kind(ip: string): IpKind {
  const p = ip.split('.').map((x) => Number(x));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return 'other';
  const [a, b] = [p[0] as number, p[1] as number];
  if (a === 127) return 'loopback';
  if (a === 10) return 'blocked';
  if (a === 172 && b >= 16 && b <= 31) return 'blocked';
  if (a === 192 && b === 168) return 'blocked';
  if (a === 169 && b === 254) return 'blocked'; // link-local (métadonnées cloud)
  if (a === 0 || a >= 224) return 'blocked'; // non-routable : 0/8, multicast, réservé
  return 'other';
}

function ipKind(ip: string): IpKind {
  const lower = ip.toLowerCase();
  // IPv4 mappée (::ffff:1.2.3.4) : juger l'embarquée, pas l'enveloppe.
  const mapped = lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : null;
  if (mapped && isIP(mapped) === 4) return ipv4Kind(mapped);
  if (isIP(lower) === 4) return ipv4Kind(lower);
  if (isIP(lower) === 6) {
    if (lower === '::1') return 'loopback';
    if (lower === '::') return 'blocked';
    if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return 'blocked'; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return 'blocked'; // unique-local
    if (lower.startsWith('ff')) return 'blocked'; // multicast
    return 'other';
  }
  return 'other';
}

async function resolveHostIps(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  try {
    const records = await lookup(host, { all: true });
    return records.map((r) => r.address);
  } catch {
    return [];
  }
}

/**
 * Grille d'autorisation (sync sauf DNS). Retourne null si autorisé, sinon le
 * motif du refus (jamais d'URL ni d'IP renvoyée telle quelle vers l'appelant
 * réseau : le motif reste générique côté outil).
 */
export async function urlBlockReason(rawUrl: string): Promise<string | null> {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    return 'URL absente ou trop longue (2 048 max)';
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'URL invalide';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'seule une URL http(s) est autorisée';
  }
  if (parsed.username || parsed.password) {
    return 'identifiants interdits dans l’URL';
  }
  const host = parsed.hostname.toLowerCase();
  if (allowHosts().has(host)) return null;
  const ips = await resolveHostIps(parsed.hostname);
  if (ips.length === 0) return 'hôte introuvable';
  if (ips.every((ip) => ipKind(ip) === 'loopback')) return null;
  return 'hôte non autorisé (loopback ou VOLACO_BROWSER_ALLOW_HOSTS uniquement)';
}

async function launchPage(): Promise<{ browser: import('playwright-core').Browser; page: import('playwright-core').Page }> {
  const chromiumModule = await import('playwright-core');
  // Sandbox par défaut ; désactivable explicitement là où il ne peut pas
  // s'initialiser (conteneur/root) — jamais en silence.
  const noSandbox = process.env.VOLACO_CHROMIUM_NO_SANDBOX === '1';
  const browser = await chromiumModule.chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    ...(noSandbox ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] } : {})
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // Chaque requête de la page repasse la grille (redirections et
  // sous-ressources comprises) : un rebond vers un hôte interdit avorte.
  await page.route('**/*', async (route) => {
    try {
      const target = route.request().url();
      if (!/^https?:\/\//i.test(target)) {
        await route.continue();
        return;
      }
      const blocked = await urlBlockReason(target);
      if (blocked) await route.abort();
      else await route.continue();
    } catch {
      try { await route.abort(); } catch { /* ignore */ }
    }
  });
  return { browser, page };
}

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  if (name === 'browser_navigate') {
    const url = String(args.url ?? '');
    // Grille AVANT tout lancement de Chromium : un refus ne coûte rien.
    const blocked = await urlBlockReason(url);
    if (blocked) {
      return { ok: false, text: 'ERREUR: navigation refusée — ' + blocked };
    }
    const { browser, page } = await launchPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // L'URL finale (après redirections) repasse la grille avant d'être
      // mémorisée pour le screenshot.
      const finalUrl = page.url();
      if (await urlBlockReason(finalUrl)) {
        return { ok: false, text: 'ERREUR: navigation refusée — redirection vers un hôte non autorisé' };
      }
      currentUrl = finalUrl;
      const title = await page.title();
      return { ok: true, text: 'Page chargée : ' + currentUrl + ' (titre: ' + title + ')' };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
  if (name === 'browser_screenshot') {
    if (!currentUrl) return { ok: false, text: 'ERREUR: aucune page chargée — appelez browser_navigate d abord' };
    if (await urlBlockReason(currentUrl)) {
      currentUrl = '';
      return { ok: false, text: 'ERREUR: page mémorisée non autorisée — rechargez une URL autorisée' };
    }
    const { browser, page } = await launchPage();
    try {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const buffer = await page.screenshot({ fullPage: true });
      return { ok: true, text: 'PNG:' + buffer.toString('base64') };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
  return { ok: false, text: 'ERREUR: outil inconnu : ' + name };
}

function main(): void {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.length === 0) continue;

      const msg = decodeMessage(line);
      if (!msg || !('method' in msg)) continue;
      const params = (msg.params as Record<string, unknown>) ?? {};

      if (msg.method === 'tools/call' && typeof msg.id === 'number') {
        const callId: number = msg.id;
        const name = String(params.name ?? '');
        const args = (params.arguments as Record<string, unknown>) ?? {};
        dispatchTool(name, args)
          .then((r) => {
            process.stdout.write(encodeSuccess(callId, { content: [{ type: 'text', text: r.text }], isError: !r.ok } as unknown as Record<string, unknown>) + '\n');
          })
          .catch((err) => {
            process.stdout.write(encodeError(callId, MCP_ERROR.INTERNAL, err instanceof Error ? err.message : String(err)) + '\n');
          });
        continue;
      }

      if (typeof msg.id !== 'number') continue;
      if (msg.method === 'initialize') {
        process.stdout.write(encodeSuccess(msg.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'volaco-browser', version: '1.0.0' }
        }) + '\n');
      } else if (msg.method === 'tools/list') {
        process.stdout.write(encodeSuccess(msg.id, { tools: TOOLS }) + '\n');
      } else {
        process.stdout.write(encodeError(msg.id, MCP_ERROR.METHOD_NOT_FOUND, 'Méthode inconnue : ' + msg.method) + '\n');
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

// Exécution directe : node browser-server.js
if (process.argv[1] && /browser-server\.(js|mjs)$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
