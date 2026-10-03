/**
 * VibeCode Core — Serveur MCP « navigateur » (P3)
 *
 * Serveur MCP stdio exposant Playwright (déjà installé) :
 * - browser_navigate   : charge une URL (http(s), data:)
 * - browser_screenshot : capture PNG base64 de la page courante
 *
 * Utilisé pour inspecter/photographier les apps générées depuis un agent.
 * Le navigateur est lancé paresseusement au premier outil appelé.
 */

import {
  MCP_ERROR,
  MCP_PROTOCOL_VERSION,
  decodeMessage,
  encodeError,
  encodeSuccess,
  type McpToolDefinition
} from './protocol.js';

const TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'browser_navigate',
    description: 'Charge une URL dans Chromium headless (http(s):// ou data:).',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL à charger' } },
      required: ['url']
    }
  },
  {
    name: 'browser_screenshot',
    description: 'Capture la page courante en PNG base64 (fullPage).',
    inputSchema: { type: 'object', properties: {} }
  }
];

let currentUrl = '';

async function launchPage(): Promise<{ browser: import('playwright-core').Browser; page: import('playwright-core').Page }> {
  const chromiumModule = await import('playwright-core');
  const browser = await chromiumModule.chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  return { browser, page };
}

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  if (name === 'browser_navigate') {
    const url = String(args.url ?? '');
    if (!/^(https?:\/\/|data:text\/html)/.test(url)) {
      return { ok: false, text: 'ERREUR: seule une URL http(s):// ou data:text/html est autorisée' };
    }
    const { browser, page } = await launchPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      currentUrl = page.url();
      const title = await page.title();
      return { ok: true, text: 'Page chargée : ' + currentUrl + ' (titre: ' + title + ')' };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
  if (name === 'browser_screenshot') {
    if (!currentUrl) return { ok: false, text: 'ERREUR: aucune page chargée — appelez browser_navigate d abord' };
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
