/**
 * VibeCode Core - Vrai Rendu Visuel (Real Render)
 *
 * ATTENTION — lire avant d'utiliser ou de modifier ce fichier :
 * Ce module a été écrit sans pouvoir être exécuté ni testé, faute de
 * navigateur disponible dans l'environnement où il a été rédigé (pas
 * d'accès internet pour en télécharger un). Le code suit fidèlement la
 * documentation officielle de Playwright, mais DOIT être vérifié sur une
 * machine réelle avant d'être considéré comme fiable. Voir le fichier
 * CORRECTIONS.md pour la procédure de test pas à pas.
 *
 * But : remplacer l'analyse purement statique d'un DOM fourni en entrée
 * (ce que faisait Visual Intelligence jusqu'ici) par un vrai rendu dans un
 * vrai navigateur headless (Chromium via Playwright), pour obtenir une
 * capture d'écran authentique de ce que l'utilisateur verrait vraiment.
 */

import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import type { AddressInfo } from 'node:net';

export interface RealRenderOptions {
  /** Fichier d'entrée à charger (par défaut : index.html) */
  entryFile?: string | undefined;
  viewport?: { width: number; height: number } | undefined;
  /** Délai maximum d'attente du rendu, en millisecondes */
  timeoutMs?: number | undefined;
  /**
   * Chemin vers l'exécutable Chromium, si Playwright ne le trouve pas tout
   * seul. Voir la variable d'environnement PLAYWRIGHT_CHROMIUM_PATH.
   */
  executablePath?: string | undefined;
}

export interface RealRenderConsoleMessage {
  readonly type: string;
  readonly text: string;
}

export interface RealRenderResult {
  /** Capture d'écran de la page réellement rendue, encodée en base64 (PNG) */
  readonly screenshotBase64: string;
  readonly consoleMessages: readonly RealRenderConsoleMessage[];
  readonly pageErrors: readonly string[];
  readonly viewport: { width: number; height: number };
  readonly entryFile: string;
  readonly renderedAt: Date;
  readonly durationMs: number;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_TIMEOUT_MS = 15_000;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

export function writeFilesToTempDir(files: Record<string, string>): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'volaco-render-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(tempDir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }
  return tempDir;
}

/**
 * Démarre un petit serveur HTTP local qui sert les fichiers du projet.
 * On sert via http:// (et pas file://) pour que les scripts, modules et
 * requêtes relatives du projet fonctionnent normalement, sans les
 * restrictions CORS que Chromium applique aux pages file://.
 */
export function startStaticServer(rootDir: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0] || '/');
        const safePath = urlPath === '/' ? '/index.html' : urlPath;
        // Empêche de sortir du dossier temporaire (traversal de chemin).
        const resolved = join(rootDir, safePath);
        if (!resolved.startsWith(rootDir)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        if (!existsSync(resolved)) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }
        const mime = MIME_TYPES[extname(resolved)] || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.end(readFileSync(resolved));
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err));
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

/**
 * Rend réellement les fichiers d'un projet dans un navigateur headless et
 * retourne une capture d'écran authentique, plus les erreurs de la vraie
 * console du navigateur.
 *
 * NON TESTÉ DANS L'ENVIRONNEMENT DE RÉDACTION — voir l'avertissement en
 * haut de ce fichier. Nécessite : `npm install playwright-core` et un
 * Chromium installé (`npx playwright install chromium`), ou la variable
 * d'environnement PLAYWRIGHT_CHROMIUM_PATH pointant vers un Chromium
 * existant sur la machine.
 */
export async function renderProjectPreview(
  files: Record<string, string>,
  options: RealRenderOptions = {}
): Promise<RealRenderResult> {
  if (!files || Object.keys(files).length === 0) {
    throw new Error('Aucun fichier à rendre : le projet ne contient aucun contenu.');
  }

  const entryFile = options.entryFile ?? 'index.html';
  if (!(entryFile in files)) {
    throw new Error(
      `Fichier d'entrée "${entryFile}" introuvable parmi les fichiers du projet. ` +
      `Fichiers disponibles : ${Object.keys(files).join(', ')}`
    );
  }

  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const executablePath = options.executablePath ?? process.env.PLAYWRIGHT_CHROMIUM_PATH;

  const startedAt = Date.now();
  const tempDir = writeFilesToTempDir(files);
  const { server, port } = await startStaticServer(tempDir);

  // Import dynamique : playwright-core est une dépendance optionnelle (le
  // reste du serveur doit continuer à fonctionner même si elle n'est pas
  // installée sur une machine donnée).
  let chromiumModule: typeof import('playwright-core');
  try {
    chromiumModule = await import('playwright-core');
  } catch {
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(
      "Le module 'playwright-core' n'est pas installé. Exécutez : npm install playwright-core, " +
      'puis : npx playwright install chromium'
    );
  }

  const consoleMessages: RealRenderConsoleMessage[] = [];
  const pageErrors: string[] = [];

  let browser: import('playwright-core').Browser | undefined;
  try {
    browser = await chromiumModule.chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage({ viewport });

    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(`http://127.0.0.1:${port}/${entryFile}`, {
      waitUntil: 'networkidle',
      timeout: timeoutMs
    });

    const screenshotBuffer = await page.screenshot({ fullPage: true });

    return {
      screenshotBase64: screenshotBuffer.toString('base64'),
      consoleMessages,
      pageErrors,
      viewport,
      entryFile,
      renderedAt: new Date(),
      durationMs: Date.now() - startedAt
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}
