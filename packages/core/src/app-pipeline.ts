/**
 * VibeCode Core — Pipeline d'applications React réelles (P1/P2).
 *
 * Le standard des grandes plateformes : la génération produit un VRAI
 * projet Vite + React + TypeScript + Tailwind (arborescence multi-fichiers),
 * construit côté serveur et exécuté dans le preview — plus du HTML injecté.
 *
 * Décisions d'architecture :
 * - ZÉRO npm install côté projet : le serveur possède react/react-dom et le
 *   toolchain ; le build résout ces imports par ALIAS vers les copies du
 *   serveur → build < 1 s, aucun réseau, aucune latence d'install. Le
 *   package.json du template reste épinglé pour un déploiement autonome futur.
 * - Les SOURCES du projet sont persistées dans le FileStore (révisions
 *   multi-fichiers) ; node_modules et dist restent sur disque (workspace),
 *   hors versionnement.
 * - Sécurité : seuls des chemins sous src/ (+ index.html) sont écrivables,
 *   jamais au-delà du workspace.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, ValidationError } from './errors.js';
// PATCH L1 — barrière terminale d'images de buildApp : le checker est celui
// partagé par toutes les barrières existantes (routes B1/B2/B3, rollback
// PATCH-2, pipeline P1-B, garde MCP) — aucune politique dupliquée ici.
import { formatImageViolations, inspectAppImageSources, isInspectableAppFile, type AppImageInspection } from './image/app-policy.js';

// ----------------------------------------------------------------------------
// PERF : Vite + plugins React/Tailwind chargés PARESSEUSEMENT. Leur import
// statique coûtait ~6,5 s au démarrage de CHAQUE process (tests, serveur)
// alors que buildApp() n'est appelé qu'à la génération réelle d'une app.
// Import dynamique mis en cache : un seul chargement par process.
// ----------------------------------------------------------------------------
type ViteBundle = [typeof import('vite'), typeof import('@vitejs/plugin-react'), typeof import('@tailwindcss/vite')];
let viteBundlePromise: Promise<ViteBundle> | undefined;
function loadViteBundle(): Promise<ViteBundle> {
  viteBundlePromise ??= Promise.all([
    import('vite'),
    import('@vitejs/plugin-react'),
    import('@tailwindcss/vite')
  ]) as Promise<ViteBundle>;
  return viteBundlePromise;
}

const here = dirname(fileURLToPath(import.meta.url));
// dist/packages/core/src → racine du dépôt (4 niveaux)
const repoRoot = resolve(here, '..', '..', '..', '..');
const templateDir = join(repoRoot, 'server', 'templates', 'react-app');
const workspaceRoot = join(repoRoot, 'workspace');
const rootNodeModules = join(repoRoot, 'node_modules');

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Forme sûre d'identifiant de projet (réutilisé par les routes). */
export function isSafeProjectId(id: unknown): id is string {
  return typeof id === 'string' && PROJECT_ID_PATTERN.test(id);
}

export function workspaceDir(projectId: string): string {
  // SEC-01 — un identifiant client ne doit jamais choisir un dossier hors
  // workspace : `projectId = ".."` déplaçait la racine vers un ancêtre et
  // ouvrait lecture/écriture arbitraire (via MCP notamment). Double verrou :
  // forme stricte PUIS confinement résolu (ceinture + bretelles, protège tous
  // les appelants même si la validation route est contournée un jour).
  if (!isSafeProjectId(projectId)) {
    throw new ValidationError('Identifiant de projet invalide');
  }
  const dir = resolve(workspaceRoot, projectId);
  if (dir !== workspaceRoot && !dir.startsWith(workspaceRoot + sep)) {
    throw new ValidationError('Identifiant de projet hors workspace');
  }
  return dir;
}

// ----------------------------------------------------------------------------
// P1-masse — VERROU PAR PROJET : deux générations/éditions concurrentes sur
// le MÊME projet s'écrasaient (reset + écritures + `emptyOutDir` entremêlés).
// File FIFO par projet : même projet = sérialisé, projets distincts =
// parallèles. Timeout 503 PROJECT_BUSY (5 min) : pas d'attente infinie si le
// détenteur se bloque. NON réentrant (ne jamais acquérir 2× imbriqué).
// ----------------------------------------------------------------------------
const DEFAULT_PROJECT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const projectLockTails = new Map<string, Promise<void>>();

export async function acquireProjectLock(
  projectId: string,
  options?: { timeoutMs?: number | undefined; requestId?: string | undefined }
): Promise<() => void> {
  const timeoutMs = options?.timeoutMs !== undefined && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_PROJECT_LOCK_TIMEOUT_MS;
  const previous = projectLockTails.get(projectId) ?? Promise.resolve();
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  // Notre tour vient après le précédent (les gates ne rejettent jamais :
  // pas de rejet non géré dans la chaîne).
  const ours = previous.then(() => gate);
  projectLockTails.set(projectId, ours);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      previous,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AppError(
            'Projet occupé par une autre génération — réessayez dans un instant.',
            'PROJECT_BUSY',
            503,
            { projectId },
            options?.requestId
          ));
        }, timeoutMs);
      })
    ]);
  } catch (err) {
    // Timeout : on se retire SANS bloquer les suivants (la gate est résolue,
    // la file coule) puis on propage le 503.
    releaseGate();
    if (projectLockTails.get(projectId) === ours) projectLockTails.delete(projectId);
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseGate();
    if (projectLockTails.get(projectId) === ours) projectLockTails.delete(projectId);
  };
}

/**
 * MÉNAGE — purge les workspaces orphelins (aucun projet du registre) et
 * leurs marqueurs `<id>.format.json`. Ne touche qu'aux noms sûrs
 * (`[A-Za-z0-9_-]+`), jamais aux fichiers projet, borné à 200 suppressions
 * par appel. `root` injectable pour les tests (jamais le workspace réel).
 */
export function purgeOrphanWorkspaces(
  knownProjectIds: ReadonlySet<string>,
  root: string = workspaceRoot,
  maxDeletions = 200
): { removedDirs: string[]; removedMarkers: string[] } {
  const removedDirs: string[] = [];
  const removedMarkers: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return { removedDirs, removedMarkers };
  }
  let deletions = 0;
  for (const name of entries) {
    if (deletions >= maxDeletions) break;
    // Marqueur de format orphelin : `<id>.format.json`.
    const markerMatch = /^([A-Za-z0-9_-]{1,64})\.format\.json$/.exec(name);
    if (markerMatch) {
      if (!knownProjectIds.has(markerMatch[1]!)) {
        try {
          unlinkSync(join(root, name));
          removedMarkers.push(name);
          deletions += 1;
        } catch { /* best effort */ }
      }
      continue;
    }
    // Dossier workspace orphelin (nom sûr uniquement).
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) continue;
    if (knownProjectIds.has(name)) continue;
    let isDir = false;
    try {
      isDir = statSync(join(root, name)).isDirectory();
    } catch { continue; }
    if (!isDir) continue;
    try {
      rmSync(join(root, name), { recursive: true, force: true });
      removedDirs.push(name);
      deletions += 1;
    } catch { /* best effort */ }
  }
  return { removedDirs, removedMarkers };
}

/** Supprime le workspace d'un projet (hook DELETE, best effort). */
export function removeWorkspace(projectId: string): boolean {
  let dir: string;
  try {
    dir = workspaceDir(projectId);
  } catch {
    return false;
  }
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const marker = join(workspaceRoot, `${projectId}.format.json`);
    if (existsSync(marker)) unlinkSync(marker);
    return true;
  } catch {
    return false;
  }
}

/** Copie le template dans le workspace (reset = site frais). */
export function ensureWorkspace(projectId: string, reset = false): string {
  const ws = workspaceDir(projectId);
  if (reset && existsSync(ws)) rmSync(ws, { recursive: true, force: true });
  if (!existsSync(ws)) {
    mkdirSync(workspaceRoot, { recursive: true });
    cpSync(templateDir, ws, { recursive: true });
  }
  return ws;
}

/** Chemin autorisé : relatif, sans '..', confiné au workspace. */
function safeProjectPath(ws: string, relPath: string): string | null {
  const full = resolve(ws, relPath);
  if (!full.startsWith(ws + sep)) return null;
  return full;
}

/** Validation SANS écriture : chemin relatif confiné et autorisé. */
export function validateAppPath(relPath: string): { ok: boolean; reason?: string } {
  const full = resolve(workspaceDir('_validation_'), relPath);
  if (!full.startsWith(resolve(workspaceDir('_validation_')) + sep)) return { ok: false, reason: 'path-hors-workspace' };
  if (!/^(src\/|index\.html$|package\.json$|tsconfig\.json$)/.test(relPath.replace(/\\/g, '/'))) {
    return { ok: false, reason: 'path-non-autorise (src/ ou racine du projet uniquement)' };
  }
  return { ok: true };
}

/** Écrit un fichier source du projet (sources versionnées côté FileStore). */
export function writeAppFile(projectId: string, relPath: string, content: string): { ok: boolean; reason?: string } {
  const ws = ensureWorkspace(projectId);
  const full = safeProjectPath(ws, relPath);
  if (!full) return { ok: false, reason: 'path-hors-workspace' };
  if (!/^(src\/|index\.html|package\.json$|tsconfig\.json$)/.test(relPath.replace(/\\/g, '/'))) {
    return { ok: false, reason: 'path-non-autorise (src/ ou racine du projet uniquement)' };
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return { ok: true };
}

export function readAppFile(projectId: string, relPath: string): string | null {
  const full = safeProjectPath(workspaceDir(projectId), relPath);
  if (!full || !existsSync(full) || !statSync(full).isFile()) return null;
  return readFileSync(full, 'utf8');
}

/**
 * P3-fix — marqueur de FORMAT par projet. Deux formats coexistent
 * (HTML par sections et projet React) : la reprise du preview doit suivre
 * le DERNIER format généré, sinon elle réaffiche un bundle obsolète après
 * une génération HTML (régression constatée en production).
 */
export function setProjectFormat(projectId: string, format: 'react-vite' | 'html'): void {
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, projectId + '.format.json'), JSON.stringify({ format, at: Date.now() }), 'utf8');
}

export function getProjectFormat(projectId: string): 'react-vite' | 'html' {
  const marker = join(workspaceRoot, projectId + '.format.json');
  if (existsSync(marker)) {
    try {
      const parsed = JSON.parse(readFileSync(marker, 'utf8')) as { format?: string };
      if (parsed.format === 'react-vite' || parsed.format === 'html') return parsed.format;
    } catch { /* marqueur illisible : heuristique */ }
  }
  // heuristique de repli (avant tout marquage)
  const ws = workspaceDir(projectId);
  return existsSync(join(ws, 'src', 'App.tsx')) ? 'react-vite' : 'html';
}

/**
 * P4 — écriture BINAIRE dans le workspace (assets d'images générées).
 * Confiné à public/assets/ (servi par le bundle vite : base './').
 */
export function writeAppAsset(projectId: string, relPath: string, data: Buffer): { ok: boolean; reason?: string } {
  const ws = ensureWorkspace(projectId);
  const full = resolve(ws, relPath);
  if (!full.startsWith(resolve(ws) + sep)) return { ok: false, reason: 'path-hors-workspace' };
  const normalized = relPath.replace(/\\/g, '/');
  if (!normalized.startsWith('public/assets/')) return { ok: false, reason: 'assets-non-autorises (public/assets/ uniquement)' };
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  return { ok: true };
}

/** Liste les fichiers sources du projet (sans node_modules/dist). */
export function listAppFiles(projectId: string): Array<{ path: string; size: number }> {
  const ws = workspaceDir(projectId);
  if (!existsSync(ws)) return [];
  const out: Array<{ path: string; size: number }> = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      const full = join(dir, entry);
      const relPath = rel ? rel + '/' + entry : entry;
      if (statSync(full).isDirectory()) walk(full, relPath);
      else out.push({ path: relPath, size: statSync(full).size });
    }
  };
  walk(ws, '');
  return out;
}

export interface AppBuildResult {
  ok: boolean;
  durationMs: number;
  /** Erreurs de compilation (à nourrir à l'IA pour auto-réparation). */
  errors: string[];
  /** Identifiant de build (cache-buster du preview). */
  buildId: string;
  /** PATCH L1 — présent uniquement quand le build est REFUSÉ par la barrière d'images terminale. */
  refused?: 'images' | 'inspection-error';
  /**
   * PATCH L1 — nombre de références d'images dynamiques (`undetermined`) dans
   * les sources construites : NON bloquant (politique inchangée — décision
   * distincte à part), comptabilisé à titre de diagnostic.
   */
  undeterminedCount?: number;
}

/**
 * PATCH L1 — seams d'inspection de la barrière terminale. `undefined` dans
 * tout usage de production : le défaut est le scanner RÉEL `inspectAppImageSources`
 * sur le DISQUE réellement construit. Les fonctions injectables ne servent
 * qu'aux tests du fail-closed (même motif que ImageGateInspector de
 * middleware/image-gate.ts) : la barrière reste obligatoire, seule l'implémentation
 * du point de contrôle est remplacable en test.
 */
export interface BuildImageGateOptions {
  imageInspector?: (files: ReadonlyArray<{ path: string; content: string }>) => AppImageInspection;
  buildSourcesCollector?: (projectId: string) => ReadonlyArray<{ path: string; content: string }>;
}

/**
 * PATCH L1 — collection EXACTE des sources que le build va consommer :
 * `listAppFiles` (workspace DISQUE, node_modules/dist/.git exclus — c'est ce
 * répertoire que vite.build lit) ∩ `isInspectableAppFile`, chaque fichier
 * RELU au moment de l'inspection. Fail-closed : un fichier listé mais
 * devenu illisible/effacé entre liste et lecture => exception => refus du
 * build (aucune source non vérifiée n'entre dans le bundle).
 */
function collectWorkspaceImageSources(projectId: string): Array<{ path: string; content: string }> {
  const sources: Array<{ path: string; content: string }> = [];
  for (const file of listAppFiles(projectId)) {
    if (!isInspectableAppFile(file.path)) continue;
    const content = readAppFile(projectId, file.path);
    if (content === null) {
      throw new Error(`source du workspace introuvable ou illisible : ${file.path}`);
    }
    sources.push({ path: file.path, content });
  }
  return sources;
}

/**
 * P2 — assemble le build Vite en UN SEUL index.html autonome :
 * <script src> → <script type="module"> inliné, <link rel=stylesheet> →
 * <style>. L'iframe sandboxée (origine opaque, aucun fetch réseau ni CORS
 * possible) charge alors l'app complète en un document — c'est ce qui
 * garantit l'exécution dans le preview quelle que soit l'isolation.
 */
function inlineBundleIntoSingleFile(distDir: string): void {
  const dist = distDir;
  let html = readFileSync(join(dist, 'index.html'), 'utf8');
  // <script type="module" crossorigin src="./assets/x.js"></script> → inline
  html = html.replace(/<script[^>]*src="\.?\/?([^"]+\.js)"[^>]*><\/script>/g, (_m, src: string) => {
    const js = readFileSync(join(dist, src), 'utf8');
    return '<script type="module">\n' + js + '\n</script>';
  });
  // <link rel="stylesheet" crossorigin href="./assets/x.css"> → <style>
  html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="\.?\/?([^"]+\.css)"[^>]*>/g, (_m, href: string) => {
    const css = readFileSync(join(dist, href), 'utf8');
    return '<style>\n' + css + '\n</style>';
  });
  writeFileSync(join(dist, 'index.html'), html, 'utf8');
}

/** Build Vite programmatique du projet (alias react → copies du serveur). */
export async function buildApp(
  projectId: string,
  gate: BuildImageGateOptions = {}
): Promise<AppBuildResult> {
  const ws = ensureWorkspace(projectId);
  const startedAt = Date.now();
  const buildId = 'b' + startedAt.toString(36) + Math.random().toString(36).slice(2, 6);
  // ---------------------------------------------------------------------------
  // PATCH L1 — BARRIÈRE TERMINALE D'IMAGES.
  // Le bundle est assemblé depuis le DISQUE du workspace : l'inspection porte
  // donc sur EXACTEMENT les sources qu'il va consommer (listées + relues sur
  // disque au moment du contrôle), et s'exécute ICI — pour TOUS les appelants
  // (génération, édition, /images/generate, rollback, MCP app_build), même
  // quand un appelant a déjà fait son propre contrôle (défense terminale, pas
  // une politique dupliquée).
  // Fail-closed :
  //  - violation(s) => refus AVANT tout assemblage : ni vite.build, ni
  //    dist-next-<id>, ni swap — le dernier bundle valide reste servi tel quel ;
  //  - exception d'inspection OU de collection (fichier illisible) => refus ;
  //  - `undetermined` reste NON bloquant (politique inchangée pour ce lot) et
  //    est comptabilisé dans le résultat à titre de diagnostic.
  // ---------------------------------------------------------------------------
  let imageUndetermined = 0;
  try {
    const sources = (gate.buildSourcesCollector ?? collectWorkspaceImageSources)(projectId);
    const inspection = (gate.imageInspector ?? inspectAppImageSources)(sources);
    if (inspection.violations.length > 0) {
      return {
        ok: false,
        durationMs: Date.now() - startedAt,
        errors: ['Images interdites dans les sources — build refusé (ancien bundle préservé) :']
          .concat(formatImageViolations(inspection, 25)),
        buildId,
        refused: 'images',
        undeterminedCount: inspection.undetermined.length
      };
    }
    imageUndetermined = inspection.undetermined.length;
  } catch (inspectionErr) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      errors: ['Inspection des images impossible (fail-closed) — build refusé : '
        + (inspectionErr instanceof Error ? inspectionErr.message : String(inspectionErr)).slice(0, 500)],
      buildId,
      refused: 'inspection-error'
    };
  }
  const errors: string[] = [];
  // P1-masse — BASCULE ATOMIQUE : le build écrit dans `dist-next-<id>/`, et
  // `dist/` n'est remplacé qu'en cas de succès (rename). Un build raté ne
  // vide PLUS le preview (fini le 404 après `emptyOutDir`), et deux builds
  // ne partagent plus le même dossier (avec le verrou par projet : étanche).
  const distDir = join(ws, 'dist');
  const nextDir = join(ws, `dist-next-${buildId}`);
  const prevDir = join(ws, 'dist-prev');
  const rmBestEffort = (dir: string): void => {
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch { /* nettoyage : jamais bloquant */ }
  };
  try {
    const [vite, reactPlugin, tailwindPlugin] = await loadViteBundle();
    await vite.build({
      root: ws,
      configFile: false,
      logLevel: 'silent',
      base: './',
      plugins: [reactPlugin.default(), tailwindPlugin.default()],
      resolve: {
        alias: [
          { find: /^react\/jsx-runtime$/, replacement: join(rootNodeModules, 'react', 'jsx-runtime.js') },
          { find: /^react-dom$/, replacement: join(rootNodeModules, 'react-dom', 'index.js') },
          { find: /^react-dom\/client$/, replacement: join(rootNodeModules, 'react-dom', 'client.js') },
          { find: /^react$/, replacement: join(rootNodeModules, 'react', 'index.js') }
        ]
      },
      build: {
        outDir: `dist-next-${buildId}`,
        emptyOutDir: true,
        // un seul chunk : garanti par inlineDynamicImports → le bundle peut
        // être assemblé en un fichier HTML autonome (scripts inlinés).
        rollupOptions: { output: { inlineDynamicImports: true } }
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message.slice(0, 4000));
  }
  if (errors.length === 0) {
    try {
      inlineBundleIntoSingleFile(nextDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push('assemblage single-file: ' + message.slice(0, 1000));
    }
  }
  if (errors.length > 0) {
    rmBestEffort(nextDir); // échec : l'ancien dist/ reste servi tel quel
    return { ok: false, durationMs: Date.now() - startedAt, errors, buildId };
  }
  rmBestEffort(prevDir);
  if (existsSync(distDir)) renameSync(distDir, prevDir);
  renameSync(nextDir, distDir);
  rmBestEffort(prevDir); // pas de consommateur de rollback : pas de rétention disque
  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    errors,
    buildId,
    undeterminedCount: imageUndetermined
  };
}

export { repoRoot as appRepoRoot, templateDir as appTemplateDir };
