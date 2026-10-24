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
  /** P5 — URL directe à rendre (ex: le bundle React servi) ; remplace files. */
  startUrl?: string | undefined;
  /** Fichier d'entrée à charger (par défaut : index.html) */
  entryFile?: string | undefined;
  viewport?: { width: number; height: number } | undefined;
  /**
   * CDC V8.1 §13 — la matrice rend déjà chaque largeur explicitement.
   * `skipMobileProbe: true` évite une seconde page 390 px par largeur.
   * Défaut : false (comportement historique inchangé).
   */
  skipMobileProbe?: boolean | undefined;
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
  /**
   * CDC V8.1 §13 — débordement horizontal mesuré à la largeur demandée.
   * Additif : absent si la mesure a échoué.
   */
  readonly viewportOverflow?: MobileOverflowResult | undefined;
  readonly entryFile: string;
  readonly renderedAt: Date;
  readonly durationMs: number;
  /**
   * B4-gate — débordement horizontal mesuré à 390 px (best-effort, null si
   * la page mobile n'a pas pu être évaluée). Additif : les lecteurs
   * existants l'ignorent.
   */
  readonly mobileOverflow?: MobileOverflowResult | undefined;
  /**
   * CDC V8 Lot A — DOM réel du rendu : styles calculés + boîtes
   * getBoundingClientRect + attributs a11y. Additif : quand il est fourni,
   * l'analyse visuelle travaille sur des preuves réelles au lieu d'heuristiques.
   */
  readonly runtimeDom?: unknown | undefined;
  /** Idem pour la page mobile (390 px) quand elle a pu être évaluée. */
  readonly mobileRuntimeDom?: unknown | undefined;
}

/** Résultat de la mesure d'overflow à viewport mobile (390 px). */
export interface MobileOverflowResult {
  readonly overflowX: boolean;
  readonly wideElements: number;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * CDC V8 Lot A — capture du DOM RÉEL : styles calculés par le moteur du
 * navigateur, boîtes getBoundingClientRect, attributs a11y. Bornes strictes
 * (1200 nœuds, profondeur 32, texte 200 caractères) pour garder un payload
 * raisonnable. Attentes réelles avant capture : polices chargées + deux
 * frames — les valeurs sont ainsi stables entre deux appels identiques.
 */
const RUNTIME_DOM_SCRIPT = String.raw`(async () => {
  try { if (document.fonts && document.fonts.ready) { await document.fonts.ready; } } catch (e) {}
  await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  var MAX_NODES = 1200;
  var MAX_DEPTH = 32;
  var count = 0;
  var STYLE_PROPS = [
    ['color', 'color'], ['backgroundColor', 'backgroundColor'], ['fontFamily', 'fontFamily'],
    ['fontSize', 'fontSize'], ['fontWeight', 'fontWeight'], ['lineHeight', 'lineHeight'],
    ['padding', 'padding'], ['margin', 'margin'], ['borderRadius', 'borderRadius'],
    ['borderWidth', 'borderWidth'], ['borderColor', 'borderColor'], ['boxShadow', 'boxShadow'],
    ['display', 'display'], ['flexDirection', 'flexDirection'], ['justifyContent', 'justifyContent'],
    ['alignItems', 'alignItems'], ['gap', 'gap'], ['letterSpacing', 'letterSpacing'],
    ['transitionProperty', 'transitionProperty'], ['transitionDuration', 'transitionDuration'],
    ['transitionTimingFunction', 'transitionTimingFunction'], ['animationName', 'animationName'],
    ['animationDuration', 'animationDuration'], ['animationTimingFunction', 'animationTimingFunction'],
    ['maxWidth', 'maxWidth'], ['gridTemplateColumns', 'gridTemplateColumns'],
    ['columnGap', 'columnGap'], ['rowGap', 'rowGap']
  ];
  var ATTRS = ['id', 'class', 'role', 'href', 'alt', 'aria-label', 'placeholder', 'title', 'disabled', 'type', 'data-section'];
  function classesOf(el) {
    var raw = el.getAttribute('class');
    return raw ? raw.split(/\s+/).filter(Boolean) : [];
  }
  function selectorOf(el, parentSelector) {
    var sel = el.tagName.toLowerCase();
    if (el.id) { sel += '#' + el.id; }
    else { var cs = classesOf(el); if (cs.length > 0) { sel += '.' + cs[0]; } }
    return parentSelector ? parentSelector + ' > ' + sel : sel;
  }
  function capture(el, parentSelector, depth) {
    if (count >= MAX_NODES || depth > MAX_DEPTH) { return null; }
    count += 1;
    var cs = getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var styles = {};
    for (var i = 0; i < STYLE_PROPS.length; i += 1) {
      styles[STYLE_PROPS[i][1]] = cs[STYLE_PROPS[i][0]];
    }
    var opacity = parseFloat(cs.opacity);
    styles['opacity'] = isFinite(opacity) ? opacity : 1;
    var z = parseInt(cs.zIndex, 10);
    styles['zIndex'] = isFinite(z) ? z : 0;
    var attributes = {};
    for (var j = 0; j < ATTRS.length; j += 1) {
      var v = el.getAttribute(ATTRS[j]);
      if (v !== null) { attributes[ATTRS[j]] = v; }
    }
    var selector = selectorOf(el, parentSelector);
    var visible = cs.display !== 'none' && cs.visibility !== 'hidden' && opacity > 0;
    var children = [];
    for (var k = 0; k < el.children.length && count < MAX_NODES; k += 1) {
      var child = capture(el.children[k], selector, depth + 1);
      if (child) { children.push(child); }
    }
    return {
      id: el.id || ('rt-node-' + count),
      tagName: el.tagName.toLowerCase(),
      attributes: attributes,
      classes: classesOf(el),
      textContent: el.children.length === 0 ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : '',
      styles: styles,
      layout: {
        x: Math.round(rect.left + (window.scrollX || 0)),
        y: Math.round(rect.top + (window.scrollY || 0)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        isVisible: visible,
        hasOverflow: rect.right > (window.innerWidth + 1) || rect.bottom > (window.innerHeight + 1)
      },
      children: children,
      depth: depth,
      selector: selector
    };
  }
  var root = document.body || document.documentElement;
  if (!root) { return null; }
  return capture(root, '', 0);
})()`;

/** Best-effort : un échec de capture ne casse jamais le rendu. */
async function captureRuntimeDom(page: import('playwright-core').Page): Promise<unknown | undefined> {
  try {
    const result = await page.evaluate(RUNTIME_DOM_SCRIPT);
    return result ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Mesure d'overflow horizontal à la largeur RÉELLE de la page courante.
 * Le script s'exécute dans Chromium (pas de DOM côté Node). Il est partagé
 * entre la mesure viewport et la sonde mobile 390 px pour éviter deux
 * définitions divergentes.
 */
const VIEWPORT_OVERFLOW_SCRIPT =
  '(() => { var vw = window.innerWidth; var overflowX = document.documentElement.scrollWidth > vw + 1; ' +
  'var wide = 0; var els = document.querySelectorAll("body *"); ' +
  'for (var i = 0; i < els.length && wide < 20; i++) { try { var r = els[i].getBoundingClientRect(); ' +
  'if (r.width > vw + 1 && r.left >= -1) wide += 1; } catch (e) {} } ' +
  'return { overflowX: overflowX, wideElements: wide }; })()';

async function measureViewportOverflow(
  page: import('playwright-core').Page
): Promise<MobileOverflowResult | undefined> {
  try {
    const measured = (await page.evaluate(VIEWPORT_OVERFLOW_SCRIPT)) as {
      overflowX?: unknown;
      wideElements?: unknown;
    };
    return {
      overflowX: measured.overflowX === true,
      wideElements: Number.isFinite(Number(measured.wideElements)) ? Math.max(0, Number(measured.wideElements) | 0) : 0
    };
  } catch {
    return undefined;
  }
}

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
  // P5 — rendu par URL directe (ex: le bundle React servi par le serveur) :
  // pas de tempDir, la page est chargée depuis le serveur lui-même.
  if (options.startUrl) {
    return renderChromiumPage(options.startUrl, options, () => undefined);
  }
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

  return renderChromiumPage(`http://127.0.0.1:${port}/${entryFile}`, options, () => {
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }, entryFile, startedAt);
}

/** P5 — corps Chromium partagé : lance la page sur startUrl, collecte
 * console/erreurs, capture, appelle cleanup à la fin (toujours). */
async function renderChromiumPage(
  startUrl: string,
  options: RealRenderOptions,
  cleanup: () => void,
  entryFile = 'index.html',
  startedAt = Date.now()
): Promise<RealRenderResult> {
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const executablePath = options.executablePath ?? process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const consoleMessages: RealRenderConsoleMessage[] = [];
  const pageErrors: string[] = [];

  let browser: import('playwright-core').Browser | undefined;
  try {
    // Import dynamique : playwright-core est une dépendance optionnelle.
    const chromiumModule = await import('playwright-core');
    // Sandbox par défaut (même motif que le serveur MCP navigateur) :
    // le contenu rendu est du généré/non fiable. Repli explicite
    // VOLACO_CHROMIUM_NO_SANDBOX=1 là où le sandbox ne s'initialise pas.
    const noSandbox = process.env.VOLACO_CHROMIUM_NO_SANDBOX === '1';
    browser = await chromiumModule.chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      ...(noSandbox ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] } : {})
    });

    const page = await browser.newPage({ viewport });

    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(startUrl, {
      waitUntil: 'networkidle',
      timeout: timeoutMs
    });

    // CDC V8.1 §13 — overflow mesuré à la largeur demandée, avant la capture
    // pleine page (le scroll éventuel ne fausse pas la mesure viewport).
    const viewportOverflow = await measureViewportOverflow(page);
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    // CDC V8 Lot A — DOM réel (best-effort) : preuve des styles calculés et
    // des positions, jamais bloquant pour la capture d'écran.
    const runtimeDom = await captureRuntimeDom(page);

    // B4-gate — mesure d'overflow à viewport mobile (390 px) dans le MÊME
    // navigateur (2e page, best-effort) : un débordement horizontal y est
    // mesuré, jamais deviné depuis le DOM statique. La matrice V8.1 peut
    // l'éviter (`skipMobileProbe`) car elle rend chaque largeur elle-même.
    let mobileOverflow: MobileOverflowResult | undefined;
    let mobileRuntimeDom: unknown | undefined;
    if (options.skipMobileProbe !== true) {
      try {
        const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
        try {
          await mob.goto(startUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
          mobileOverflow = await measureViewportOverflow(mob);
          mobileRuntimeDom = await captureRuntimeDom(mob);
        } finally {
          await mob.close().catch(() => undefined);
        }
      } catch {
        mobileOverflow = undefined; // la critique desktop reste valide sans elle
      }
    }

    return {
      screenshotBase64: screenshotBuffer.toString('base64'),
      consoleMessages,
      pageErrors,
      viewport,
      ...(viewportOverflow ? { viewportOverflow } : {}),
      entryFile,
      renderedAt: new Date(),
      durationMs: Date.now() - startedAt,
      ...(mobileOverflow ? { mobileOverflow } : {}),
      ...(runtimeDom ? { runtimeDom } : {}),
      ...(mobileRuntimeDom ? { mobileRuntimeDom } : {})
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    cleanup();
  }
}

/**
 * CDC V8.1 §13 (P0 audit 2026-10) — sonde d'AXES réellement rendus.
 *
 * Une SEULE session Chromium : la page est chargée une fois, la capture de
 * référence est prise sur le rendu par défaut, puis chaque variante (thème
 * sombre par média/attribut/classe, états hover/focus/disabled) est appliquée
 * pour de vrai et capturée. La comparaison de hashes faite par l'appelant n'a
 * de sens que dans cette même session — d'où la référence incluse ici.
 *
 * HONNÊTETÉ : une variante impossible à appliquer revient `applied=false`
 * avec sa raison ; aucune déclaration n'est jamais comptée comme une mesure.
 */
export interface AxisVariantRequest {
  /** Identifiant de la variante (ex. 'theme-dark', 'state-hover'). */
  readonly id: string;
  /** Émulation prefers-color-scheme (thème par média). */
  readonly colorScheme?: 'light' | 'dark' | undefined;
  /** Variante de thème par attribut racine (ex. data-theme="dark"). */
  readonly setRootAttribute?: { readonly name: string; readonly value: string } | undefined;
  /** Variante de thème par classe racine (ex. .dark sur <html>). */
  readonly addRootClass?: string | undefined;
  /** Interaction réelle avant capture (premier élément interactif visible). */
  readonly interaction?: 'hover-first-interactive' | 'focus-first-interactive' | 'disable-first-interactive' | undefined;
  /** Attente de stabilisation des transitions avant capture (défaut : 250 ms). */
  readonly waitMs?: number | undefined;
}

export interface AxisVariantCapture {
  readonly id: string;
  readonly screenshotBase64: string;
  readonly applied: boolean;
  readonly detail: string;
  readonly pageErrors: readonly string[];
}

export interface AxisVariantProbeOutcome {
  /** Capture de référence (rendu par défaut), prise dans la MÊME session. */
  readonly baseScreenshotBase64: string;
  readonly variants: readonly AxisVariantCapture[];
  readonly durationMs: number;
}

const INTERACTIVE_SELECTOR =
  'button:visible, [role="button"]:visible, a[href]:visible, input:visible, select:visible, textarea:visible';

export async function renderAxisVariantProbe(
  files: Record<string, string>,
  options: RealRenderOptions,
  requests: readonly AxisVariantRequest[]
): Promise<AxisVariantProbeOutcome> {
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

  const pageErrors: string[] = [];
  let browser: import('playwright-core').Browser | undefined;
  try {
    const chromiumModule = await import('playwright-core');
    const noSandbox = process.env.VOLACO_CHROMIUM_NO_SANDBOX === '1';
    browser = await chromiumModule.chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      ...(noSandbox ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] } : {})
    });
    const page = await browser.newPage({ viewport });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    await page.goto(`http://127.0.0.1:${port}/${entryFile}`, {
      waitUntil: 'networkidle',
      timeout: timeoutMs
    });

    const baseScreenshotBase64 = (await page.screenshot({ fullPage: true })).toString('base64');
    const variants: AxisVariantCapture[] = [];

    for (const request of requests) {
      const errorsBefore = pageErrors.length;
      let applied = false;
      let detail = '';
      try {
        if (request.colorScheme) {
          await page.emulateMedia({ colorScheme: request.colorScheme });
          applied = true;
          detail = `émulation prefers-color-scheme: ${request.colorScheme}`;
        } else if (request.setRootAttribute) {
          const attribute = request.setRootAttribute;
          await page.evaluate(
            `document.documentElement.setAttribute(${JSON.stringify(attribute.name)}, ${JSON.stringify(attribute.value)});`
          );
          applied = true;
          detail = `attribut ${attribute.name}="${attribute.value}" posé sur <html>`;
        } else if (request.addRootClass) {
          const className = request.addRootClass;
          await page.evaluate(
            `document.documentElement.classList.add(${JSON.stringify(className)});`
          );
          applied = true;
          detail = `classe .${className} posée sur <html>`;
        } else if (request.interaction) {
          const interactive = page.locator(INTERACTIVE_SELECTOR);
          const count = await interactive.count();
          if (count === 0) {
            detail = 'aucun élément interactif visible : état non mesurable sur cette page';
          } else if (request.interaction === 'hover-first-interactive') {
            await interactive.first().hover({ timeout: 5_000 });
            applied = true;
            detail = 'survol réel du premier élément interactif visible';
          } else if (request.interaction === 'focus-first-interactive') {
            await interactive.first().focus({ timeout: 5_000 });
            applied = true;
            detail = 'focus réel du premier élément interactif visible';
          } else {
            await interactive.first().evaluate((element) => {
              element.setAttribute('disabled', '');
            });
            applied = true;
            detail = 'attribut disabled posé sur le premier élément interactif visible';
          }
        } else {
          detail = 'variante vide : rien à appliquer';
        }

        if (applied) {
          const waitMs = request.waitMs ?? 250;
          if (waitMs > 0) await page.waitForTimeout(waitMs);
        }
        const screenshotBase64 = (await page.screenshot({ fullPage: true })).toString('base64');
        variants.push({
          id: request.id,
          screenshotBase64,
          applied,
          detail,
          pageErrors: pageErrors.slice(errorsBefore)
        });

        // Restauration AVANT la variante suivante : chaque variante repart du
        // rendu par défaut, jamais d'un état composé.
        if (request.colorScheme) {
          await page.emulateMedia({ colorScheme: null });
        } else if (request.setRootAttribute) {
          const attributeName = request.setRootAttribute.name;
          await page.evaluate(
            `document.documentElement.removeAttribute(${JSON.stringify(attributeName)});`
          );
        } else if (request.addRootClass) {
          const className = request.addRootClass;
          await page.evaluate(
            `document.documentElement.classList.remove(${JSON.stringify(className)});`
          );
        } else if (request.interaction) {
          await page.mouse.move(0, 0).catch(() => undefined);
          await page.evaluate(
            'var active = document.activeElement; if (active && typeof active.blur === "function") active.blur();'
          );
          if (request.interaction === 'disable-first-interactive') {
            await page.evaluate(
              'var el = document.querySelector("button[disabled], input[disabled], select[disabled], textarea[disabled]"); if (el) el.removeAttribute("disabled");'
            );
          }
          await page.waitForTimeout(60);
        }
      } catch (error) {
        variants.push({
          id: request.id,
          screenshotBase64: '',
          applied: false,
          detail: error instanceof Error ? error.message : String(error),
          pageErrors: pageErrors.slice(errorsBefore)
        });
      }
    }

    return { baseScreenshotBase64, variants, durationMs: Date.now() - startedAt };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}
