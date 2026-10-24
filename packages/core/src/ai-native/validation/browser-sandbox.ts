/**
 * V7-LOT7 — Sandbox d'exécution navigateur du contenu candidat.
 *
 * Le préflight HTML (V7-LOT5) vérifie la structure du document ; il n'exécute
 * pas le code. Ce module exécute réellement le document dans un Chromium
 * headless isolé, avec :
 * - réseau coupé (contexte `offline` + toutes les requêtes avortées) ;
 * - service workers et téléchargements bloqués ;
 * - timeout court et fermeture garantie (`finally`) du navigateur ;
 * - collecte des erreurs page, console, requêtes échouées, métriques DOM et
 *   capture d'écran.
 *
 * Politique :
 * - FAIL dur uniquement pour les défauts intrinsèques du document (erreur JS
 *   auto-portée, syntaxe, timeout, document non rendu) ;
 * - les erreurs potentiellement causées par des dépendances externes bloquées
 *   (CDN absent, police, image) sont des WARN consultatifs — le sandbox ne
 *   peut pas prouver qu'elles existeraient en production ;
 * - UNAVAILABLE quand Chromium n'est pas installé/désactivé : ce n'est pas un
 *   échec du document et cela ne bloque pas l'écriture, mais le rapport le dit
 *   explicitement ;
 * - aucun score visuel : le Quality Gate visuel reste l'autorité du rendu.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  generateFunctionalTestPlan,
  runGeneratedFunctionalTests,
  unavailableFunctionalTestsReport,
  type BrowserFunctionalTestsReport
} from './functional-tests.js';

export type BrowserSandboxVerdict = 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL' | 'UNAVAILABLE';

export interface BrowserSandboxViewport {
  readonly width: number;
  readonly height: number;
}

export interface BrowserSandboxMetrics {
  readonly domNodes: number;
  readonly interactiveElements: number;
  readonly visibleTextLength: number;
  readonly bodyElementCount: number;
  readonly documentWidth: number;
  readonly horizontalOverflow: boolean;
  readonly externalRequestsBlocked: number;
  readonly externalScriptsBlocked: number;
  readonly screenshotBytes: number;
  readonly screenshotSha256: string;
}

export interface BrowserSandboxConsoleEntry {
  readonly type: string;
  readonly text: string;
}

export interface BrowserSandboxFailedRequest {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
  readonly failure: string;
}

export interface BrowserSandboxIsolation {
  /** Isolation de processus uniquement : pas de conteneur dans ce lot. */
  readonly mode: 'PROCESS';
  readonly containerized: false;
  readonly network: 'OFFLINE_AND_ABORT';
  readonly serviceWorkers: 'BLOCKED';
  readonly downloads: 'BLOCKED';
  readonly popups: 'BLOCKED';
  readonly dialogs: 'DISMISSED';
  readonly permissions: 'DENIED';
  readonly websockets: 'BLOCKED';
  readonly profile: 'PLAYWRIGHT_EPHEMERAL';
  readonly jsHeapLimitMb: number;
}

export interface BrowserSandboxReport {
  readonly schemaVersion: '1.0.0';
  readonly path: string;
  readonly verdict: BrowserSandboxVerdict;
  /** Vrai uniquement quand aucune erreur dure n'a été détectée (PASS*). */
  readonly passed: boolean;
  /** Vrai uniquement pour un FAIL dur : l'apply doit être refusé. */
  readonly blocking: boolean;
  readonly contentHash: string;
  readonly durationMs: number;
  readonly viewport: BrowserSandboxViewport;
  readonly title: string;
  readonly metrics: BrowserSandboxMetrics;
  readonly consoleErrors: readonly BrowserSandboxConsoleEntry[];
  readonly consoleWarnings: readonly BrowserSandboxConsoleEntry[];
  readonly pageErrors: readonly string[];
  readonly failedRequests: readonly BrowserSandboxFailedRequest[];
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  /** Profil d'isolation réellement appliqué par cette exécution. */
  readonly isolation?: BrowserSandboxIsolation | undefined;
  readonly screenshotDataUrl?: string | undefined;
  /** Présent quand les tests fonctionnels générés ont été demandés. */
  readonly functionalTests?: BrowserFunctionalTestsReport | undefined;
  readonly checkedAt: string;
}

export interface BrowserSandboxOptions {
  readonly path?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly viewport?: BrowserSandboxViewport | undefined;
  readonly executablePath?: string | undefined;
  /** La capture est activée par défaut ; le Base64 reste borné. */
  readonly includeScreenshot?: boolean | undefined;
  /** Exécute aussi les scénarios fonctionnels générés à partir du DOM. */
  readonly functionalTests?: boolean | undefined;
}

export interface BrowserSandboxRunner {
  run(html: string, options?: BrowserSandboxOptions): Promise<BrowserSandboxReport>;
}

export const DEFAULT_BROWSER_SANDBOX_TIMEOUT_MS = 5000;
export const DEFAULT_BROWSER_SANDBOX_VIEWPORT: BrowserSandboxViewport = {
  width: 1280,
  height: 720
};
export const DEFAULT_SANDBOX_JS_HEAP_MB = 256;
export const MIN_SANDBOX_JS_HEAP_MB = 128;
export const MAX_SANDBOX_JS_HEAP_MB = 1024;

const MAX_CONCURRENT_SANDBOXES = 2;
const MAX_CONSOLE_ENTRIES = 25;
const MAX_PAGE_ERRORS = 15;
const MAX_FAILED_REQUESTS = 25;
const MAX_CONSOLE_TEXT = 1200;
const MAX_SCREENSHOT_BYTES = 512 * 1024;

let activeSandboxes = 0;

export interface SandboxLaunchArgsOptions {
  readonly noSandbox?: boolean | undefined;
  readonly jsHeapLimitMb?: number | undefined;
}

function clampSandboxJsHeapLimitMb(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SANDBOX_JS_HEAP_MB;
  return Math.min(MAX_SANDBOX_JS_HEAP_MB, Math.max(MIN_SANDBOX_JS_HEAP_MB, Math.trunc(value)));
}

/**
 * Limite V8 du renderer, réglable mais bornée. Elle ne remplace pas une
 * isolation conteneurisée : elle borne seulement le tas JavaScript.
 */
export function resolveSandboxJsHeapLimitMb(
  rawValue: string | undefined = process.env.VOLACO_SANDBOX_JS_HEAP_MB
): number {
  if (rawValue === undefined || rawValue.trim() === '') return DEFAULT_SANDBOX_JS_HEAP_MB;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? clampSandboxJsHeapLimitMb(parsed) : DEFAULT_SANDBOX_JS_HEAP_MB;
}

/**
 * Arguments Chromium durcis. Exporté pour que les tests vérifient le profil
 * sans lancer de navigateur et sans dépendre de l'environnement de la machine.
 */
export function buildSandboxLaunchArgs(options: SandboxLaunchArgsOptions = {}): string[] {
  const jsHeapLimitMb = options.jsHeapLimitMb === undefined
    ? resolveSandboxJsHeapLimitMb()
    : clampSandboxJsHeapLimitMb(options.jsHeapLimitMb);
  return [
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-plugins',
    '--disable-default-apps',
    '--disable-component-extensions-with-background-pages',
    '--disable-breakpad',
    '--no-pings',
    '--disable-domain-reliability',
    '--disable-client-side-phishing-detection',
    '--disable-crash-reporter',
    '--metrics-recording-only',
    '--safebrowsing-disable-auto-update',
    '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion,InterestCohort',
    '--renderer-process-limit=1',
    `--js-flags=--max-old-space-size=${jsHeapLimitMb}`,
    ...(options.noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [])
  ];
}

function buildSandboxIsolation(jsHeapLimitMb: number): BrowserSandboxIsolation {
  return {
    mode: 'PROCESS',
    containerized: false,
    network: 'OFFLINE_AND_ABORT',
    serviceWorkers: 'BLOCKED',
    downloads: 'BLOCKED',
    popups: 'BLOCKED',
    dialogs: 'DISMISSED',
    permissions: 'DENIED',
    websockets: 'BLOCKED',
    profile: 'PLAYWRIGHT_EPHEMERAL',
    jsHeapLimitMb
  };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function emptyMetrics(): BrowserSandboxMetrics {
  return {
    domNodes: 0,
    interactiveElements: 0,
    visibleTextLength: 0,
    bodyElementCount: 0,
    documentWidth: 0,
    horizontalOverflow: false,
    externalRequestsBlocked: 0,
    externalScriptsBlocked: 0,
    screenshotBytes: 0,
    screenshotSha256: ''
  };
}

function reportBase(
  path: string,
  content: string,
  startedAt: number,
  viewport: BrowserSandboxViewport,
  verdict: BrowserSandboxVerdict,
  extras: {
    metrics?: BrowserSandboxMetrics | undefined;
    title?: string | undefined;
    consoleErrors?: readonly BrowserSandboxConsoleEntry[] | undefined;
    consoleWarnings?: readonly BrowserSandboxConsoleEntry[] | undefined;
    pageErrors?: readonly string[] | undefined;
    failedRequests?: readonly BrowserSandboxFailedRequest[] | undefined;
    blockers?: readonly string[] | undefined;
    warnings?: readonly string[] | undefined;
    isolation?: BrowserSandboxIsolation | undefined;
    screenshotDataUrl?: string | undefined;
    functionalTests?: BrowserFunctionalTestsReport | undefined;
  } = {}
): BrowserSandboxReport {
  const blockers = extras.blockers ?? [];
  const warnings = extras.warnings ?? [];
  const passed = verdict === 'PASS' || verdict === 'PASS_WITH_WARNINGS';
  return {
    schemaVersion: '1.0.0',
    path,
    verdict,
    passed,
    blocking: verdict === 'FAIL',
    contentHash: hashContent(content),
    durationMs: Date.now() - startedAt,
    viewport,
    title: extras.title ?? '',
    metrics: extras.metrics ?? emptyMetrics(),
    consoleErrors: extras.consoleErrors ?? [],
    consoleWarnings: extras.consoleWarnings ?? [],
    pageErrors: extras.pageErrors ?? [],
    failedRequests: extras.failedRequests ?? [],
    blockers,
    warnings,
    ...(extras.isolation ? { isolation: extras.isolation } : {}),
    ...(extras.screenshotDataUrl ? { screenshotDataUrl: extras.screenshotDataUrl } : {}),
    ...(extras.functionalTests ? { functionalTests: extras.functionalTests } : {}),
    checkedAt: new Date().toISOString()
  };
}

/** Sandbox explicitement désactivé par l'environnement ? */
export function isBrowserSandboxEnabled(): boolean {
  const raw = (process.env.VOLACO_BROWSER_SANDBOX ?? '').trim().toLowerCase();
  return !(raw === '0' || raw === 'off' || raw === 'false' || raw === 'disabled');
}

/** Chemin Chromium configuré (env/override) ou fourni par playwright-core. */
export async function resolveChromiumExecutablePath(
  override?: string | undefined
): Promise<string | undefined> {
  const configured = [
    process.env.VOLACO_SANDBOX_CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_PATH
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  // Un chemin explicitement fourni est STRICT : s'il est invalide, on ne
  // masque pas l'erreur en retombant silencieusement sur un autre Chromium.
  if (typeof override === 'string' && override.trim().length > 0) {
    return existsSync(override) ? override : undefined;
  }
  if (configured.length > 0) {
    for (const candidate of configured) {
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  try {
    const chromiumModule = await import('playwright-core');
    const installed = chromiumModule.chromium.executablePath();
    return installed && existsSync(installed) ? installed : undefined;
  } catch {
    return undefined;
  }
}

export async function isBrowserSandboxAvailable(): Promise<boolean> {
  if (!isBrowserSandboxEnabled()) return false;
  return (await resolveChromiumExecutablePath()) !== undefined;
}

/** Erreurs purement liées au réseau coupé (bruit attendu du sandbox). */
function isNetworkNoise(text: string): boolean {
  return /Failed to load resource|net::ERR_|ERR_BLOCKED_BY_CLIENT|ERR_FAILED|ERR_ABORTED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_/i.test(text);
}

function isSyntaxError(text: string): boolean {
  return /SyntaxError/i.test(text);
}

/**
 * Erreur typique d'un global fourni par un CDN bloqué. Seules ces erreurs
 * sont dégradées en WARN quand un script externe manque : un TypeError ou un
 * RangeError intrinsèque reste bloquant même en présence d'un CDN coupé.
 */
function isExternalDependencyError(text: string): boolean {
  return /ReferenceError|is not defined/i.test(text);
}

interface PageMetrics {
  readonly title: string;
  readonly domNodes: number;
  readonly interactiveElements: number;
  readonly visibleTextLength: number;
  readonly bodyElementCount: number;
  readonly documentWidth: number;
  readonly horizontalOverflow: boolean;
}

/**
 * Script exécuté DANS Chromium (pas dans Node : le tsconfig n'inclut pas le
 * lib DOM). Il ne fait aucune confiance au document candidat : chaque accès
 * est borné et retourne des valeurs sérialisables.
 */
const METRICS_SCRIPT = `(() => {
  const body = document.body;
  const text = body && typeof body.innerText === 'string' ? body.innerText.trim() : '';
  const root = document.documentElement;
  const scrollWidth = root ? root.scrollWidth : 0;
  return {
    title: typeof document.title === 'string' ? document.title : '',
    domNodes: document.querySelectorAll('*').length,
    interactiveElements: document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [onclick]').length,
    visibleTextLength: text.length,
    bodyElementCount: body ? body.children.length : 0,
    documentWidth: scrollWidth,
    horizontalOverflow: scrollWidth > window.innerWidth + 1
  };
})()`;

/**
 * Chromium réel. Chaque exécution lance un navigateur neuf puis le ferme :
 * aucun état, cookie ou cache ne survit entre deux documents.
 */
export class ChromiumBrowserSandbox implements BrowserSandboxRunner {
  public async run(
    html: string,
    options: BrowserSandboxOptions = {}
  ): Promise<BrowserSandboxReport> {
    const startedAt = Date.now();
    const path = options.path ?? 'index.html';
    const timeoutMs = Math.max(500, options.timeoutMs ?? DEFAULT_BROWSER_SANDBOX_TIMEOUT_MS);
    const viewport = options.viewport ?? DEFAULT_BROWSER_SANDBOX_VIEWPORT;
    const includeScreenshot = options.includeScreenshot !== false;

    if (!isBrowserSandboxEnabled()) {
      return reportBase(path, html, startedAt, viewport, 'UNAVAILABLE', {
        warnings: ['Sandbox navigateur désactivé (VOLACO_BROWSER_SANDBOX). Aucune exécution réelle.']
      });
    }

    if (activeSandboxes >= MAX_CONCURRENT_SANDBOXES) {
      return reportBase(path, html, startedAt, viewport, 'UNAVAILABLE', {
        warnings: [`Sandbox navigateur saturé (${MAX_CONCURRENT_SANDBOXES} exécutions simultanées). Réessayez.`]
      });
    }

    const executablePath = await resolveChromiumExecutablePath(options.executablePath);
    if (!executablePath) {
      return reportBase(path, html, startedAt, viewport, 'UNAVAILABLE', {
        warnings: [
          'Chromium introuvable : sandbox navigateur non exécuté. ' +
          'Installez playwright-core + Chromium ou définissez VOLACO_SANDBOX_CHROMIUM_PATH.'
        ]
      });
    }

    const jsHeapLimitMb = resolveSandboxJsHeapLimitMb();
    const isolation = buildSandboxIsolation(jsHeapLimitMb);
    activeSandboxes += 1;
    let browser: import('playwright-core').Browser | undefined;

    try {
      // Import dynamique : le cœur ne charge pas Chromium pour les requêtes
      // qui ne demandent pas de sandbox.
      const chromiumModule = await import('playwright-core');
      // Même politique que le renderer réel : sandbox activé par défaut,
      // repli explicite pour les environnements où il ne s'initialise pas.
      const noSandbox = process.env.VOLACO_CHROMIUM_NO_SANDBOX === '1';
      browser = await chromiumModule.chromium.launch({
        headless: true,
        executablePath,
        args: buildSandboxLaunchArgs({ noSandbox, jsHeapLimitMb }),
        timeout: timeoutMs
      });

      const context = await browser.newContext({
        viewport,
        offline: true,
        serviceWorkers: 'block',
        acceptDownloads: false,
        permissions: [],
        bypassCSP: false,
        ignoreHTTPSErrors: false
      });
      context.setDefaultTimeout(timeoutMs);
      context.setDefaultNavigationTimeout(timeoutMs);

      // Verrouillage réseau : même si `offline` est contourné, aucune requête
      // HTTP(S) ne sort. Les WebSockets sont fermés immédiatement.
      await context.route('**/*', (route) => route.abort('blockedbyclient'));
      await context.route('file://**', (route) => route.abort('blockedbyclient'));
      await context.routeWebSocket('**/*', (socket) => {
        void socket.close();
      });

      const page = await context.newPage();
      // Aucune fenêtre secondaire ne doit survivre : un document candidat ne
      // peut pas ouvrir un popup pour sortir du périmètre observé.
      context.on('page', (popup) => {
        if (popup !== page) {
          void popup.close().catch(() => undefined);
        }
      });
      page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => undefined);
      });
      page.on('download', (download) => {
        void download.cancel().catch(() => undefined);
      });
      const consoleErrors: BrowserSandboxConsoleEntry[] = [];
      const consoleWarnings: BrowserSandboxConsoleEntry[] = [];
      const pageErrors: string[] = [];
      const failedRequests: BrowserSandboxFailedRequest[] = [];
      let externalRequestsBlocked = 0;
      let externalScriptsBlocked = 0;

      page.on('console', (message) => {
        const type = message.type();
        if (type !== 'error' && type !== 'warning') return;
        const entry: BrowserSandboxConsoleEntry = {
          type,
          text: message.text().slice(0, MAX_CONSOLE_TEXT)
        };
        if (type === 'error') {
          if (consoleErrors.length < MAX_CONSOLE_ENTRIES) consoleErrors.push(entry);
        } else if (consoleWarnings.length < MAX_CONSOLE_ENTRIES) {
          consoleWarnings.push(entry);
        }
      });
      page.on('pageerror', (error) => {
        if (pageErrors.length >= MAX_PAGE_ERRORS) return;
        const name = error.name || 'Error';
        pageErrors.push(`${name}: ${error.message}`.slice(0, MAX_CONSOLE_TEXT));
      });
      page.on('requestfailed', (request) => {
        externalRequestsBlocked += 1;
        if (request.resourceType() === 'script') externalScriptsBlocked += 1;
        if (failedRequests.length >= MAX_FAILED_REQUESTS) return;
        failedRequests.push({
          url: request.url().slice(0, 500),
          method: request.method(),
          resourceType: request.resourceType(),
          failure: request.failure()?.errorText ?? 'unknown'
        });
      });

      try {
        await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reportBase(path, html, startedAt, viewport, 'FAIL', {
          blockers: [`Exécution du document impossible : ${message}`],
          pageErrors,
          consoleErrors,
          consoleWarnings,
          failedRequests,
          isolation
        });
      }

      // Laisse les microtâches, erreurs asynchrones immédiates et le premier
      // rendu se produire avant de figer le rapport.
      await page.waitForTimeout(200);

      let metrics: PageMetrics;
      try {
        metrics = await page.evaluate(METRICS_SCRIPT) as PageMetrics;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reportBase(path, html, startedAt, viewport, 'FAIL', {
          blockers: [`Évaluation du DOM impossible (timeout ou script bloquant) : ${message}`],
          pageErrors,
          consoleErrors,
          consoleWarnings,
          failedRequests,
          isolation,
          warnings: [
            `${externalRequestsBlocked} requête(s) externe(s) bloquée(s) par le sandbox.`
          ]
        });
      }

      // Une erreur de syntaxe est intrinsèque au document, même si des
      // dépendances externes sont absentes. Seules les erreurs de type
      // « global manquant » (ReferenceError) sont dégradées en WARN quand un
      // script externe a été bloqué : le sandbox ne peut pas prouver qu'elles
      // existeraient avec le CDN réel. TypeError/RangeError restent durs.
      const canBlameExternalScript = externalScriptsBlocked > 0;
      const hardPageErrors = pageErrors.filter((text) =>
        !canBlameExternalScript || isSyntaxError(text) || !isExternalDependencyError(text)
      );
      const hardConsoleErrors = consoleErrors.filter((entry) =>
        !isNetworkNoise(entry.text) &&
        (!canBlameExternalScript || isSyntaxError(entry.text) || !isExternalDependencyError(entry.text))
      );

      const blockers: string[] = [];
      const warnings: string[] = [];
      for (const error of hardPageErrors) blockers.push(`Erreur JavaScript : ${error}`);
      for (const entry of hardConsoleErrors) blockers.push(`Erreur console : ${entry.text}`);
      for (const entry of consoleErrors) {
        if (!hardConsoleErrors.includes(entry)) {
          warnings.push(`Console (dépendance externe bloquée) : ${entry.text}`);
        }
      }
      for (const error of pageErrors) {
        if (!hardPageErrors.includes(error)) {
          warnings.push(`Erreur JS possiblement induite par une dépendance externe bloquée : ${error}`);
        }
      }

      if (externalRequestsBlocked > 0) {
        warnings.push(
          `${externalRequestsBlocked} requête(s) externe(s) bloquée(s) ` +
          `(dont ${externalScriptsBlocked} script(s)) : le rendu hors-ligne ne charge aucune dépendance distante.`
        );
      }
      if (consoleWarnings.length > 0) {
        warnings.push(`${consoleWarnings.length} avertissement(s) console collecté(s).`);
      }
      if (metrics.bodyElementCount === 0) {
        warnings.push('Le corps du document ne contient aucun élément enfant.');
      }
      if (metrics.visibleTextLength < 10) {
        warnings.push(`Texte visible très court (${metrics.visibleTextLength} caractère(s)).`);
      }
      if (metrics.horizontalOverflow) {
        warnings.push(
          `Débordement horizontal probable : document ${metrics.documentWidth}px > viewport ${viewport.width}px.`
        );
      }
      if (!metrics.title.trim()) {
        warnings.push('Aucun titre de document (<title> vide ou absent).');
      }

      let screenshotDataUrl: string | undefined;
      let screenshotBytes = 0;
      let screenshotSha256 = '';
      if (includeScreenshot) {
        try {
          const screenshot = await page.screenshot({
            type: 'jpeg',
            quality: 60,
            fullPage: false,
            timeout: timeoutMs
          });
          screenshotBytes = screenshot.length;
          screenshotSha256 = createHash('sha256').update(screenshot).digest('hex');
          if (screenshotBytes <= MAX_SCREENSHOT_BYTES) {
            screenshotDataUrl = `data:image/jpeg;base64,${screenshot.toString('base64')}`;
          } else {
            warnings.push(`Capture trop volumineuse pour être restituée (${screenshotBytes} octets).`);
          }
        } catch (err) {
          warnings.push(`Capture d'écran impossible : ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const reportMetrics: BrowserSandboxMetrics = {
        domNodes: metrics.domNodes,
        interactiveElements: metrics.interactiveElements,
        visibleTextLength: metrics.visibleTextLength,
        bodyElementCount: metrics.bodyElementCount,
        documentWidth: metrics.documentWidth,
        horizontalOverflow: metrics.horizontalOverflow,
        externalRequestsBlocked,
        externalScriptsBlocked,
        screenshotBytes,
        screenshotSha256
      };

      // V7-LOT8 — tests fonctionnels générés. Ils ne s'exécutent que si le
      // chargement n'a produit aucun blocker : autrement le runtime a déjà
      // tranché et cliquer sur un document cassé n'apporterait rien.
      let functionalTests: BrowserFunctionalTestsReport | undefined;
      if (options.functionalTests === true && blockers.length === 0) {
        try {
          const plan = await generateFunctionalTestPlan(page);
          functionalTests = await runGeneratedFunctionalTests(page, html, plan, {
            timeoutMs,
            downgradeExternalDependencyErrors: canBlameExternalScript
          });
        } catch (err) {
          functionalTests = unavailableFunctionalTestsReport(
            `Tests fonctionnels non exécutés : ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      if (blockers.length > 0) {
        return reportBase(path, html, startedAt, viewport, 'FAIL', {
          metrics: reportMetrics,
          title: metrics.title,
          consoleErrors,
          consoleWarnings,
          pageErrors,
          failedRequests,
          blockers,
          warnings,
          isolation,
          ...(screenshotDataUrl ? { screenshotDataUrl } : {})
        });
      }

      return reportBase(
        path,
        html,
        startedAt,
        viewport,
        warnings.length > 0 ? 'PASS_WITH_WARNINGS' : 'PASS',
        {
          metrics: reportMetrics,
          title: metrics.title,
          consoleErrors,
          consoleWarnings,
          pageErrors,
          failedRequests,
          warnings,
          isolation,
          ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
          ...(functionalTests ? { functionalTests } : {})
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reportBase(path, html, startedAt, viewport, 'UNAVAILABLE', {
        warnings: [`Sandbox navigateur indisponible : ${message}`],
        isolation
      });
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
      activeSandboxes = Math.max(0, activeSandboxes - 1);
    }
  }
}
