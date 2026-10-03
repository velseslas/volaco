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

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vite from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = dirname(fileURLToPath(import.meta.url));
// dist/packages/core/src → racine du dépôt (4 niveaux)
const repoRoot = resolve(here, '..', '..', '..', '..');
const templateDir = join(repoRoot, 'server', 'templates', 'react-app');
const workspaceRoot = join(repoRoot, 'workspace');
const rootNodeModules = join(repoRoot, 'node_modules');

export function workspaceDir(projectId: string): string {
  return join(workspaceRoot, projectId);
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
}

/**
 * P2 — assemble le build Vite en UN SEUL index.html autonome :
 * <script src> → <script type="module"> inliné, <link rel=stylesheet> →
 * <style>. L'iframe sandboxée (origine opaque, aucun fetch réseau ni CORS
 * possible) charge alors l'app complète en un document — c'est ce qui
 * garantit l'exécution dans le preview quelle que soit l'isolation.
 */
function inlineBundleIntoSingleFile(ws: string): void {
  const dist = join(ws, 'dist');
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
export async function buildApp(projectId: string): Promise<AppBuildResult> {
  const ws = ensureWorkspace(projectId);
  const startedAt = Date.now();
  const buildId = 'b' + startedAt.toString(36) + Math.random().toString(36).slice(2, 6);
  const errors: string[] = [];
  try {
    await vite.build({
      root: ws,
      configFile: false,
      logLevel: 'silent',
      base: './',
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: [
          { find: /^react\/jsx-runtime$/, replacement: join(rootNodeModules, 'react', 'jsx-runtime.js') },
          { find: /^react-dom$/, replacement: join(rootNodeModules, 'react-dom', 'index.js') },
          { find: /^react-dom\/client$/, replacement: join(rootNodeModules, 'react-dom', 'client.js') },
          { find: /^react$/, replacement: join(rootNodeModules, 'react', 'index.js') }
        ]
      },
      build: {
        outDir: 'dist',
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
      inlineBundleIntoSingleFile(ws);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push('assemblage single-file: ' + message.slice(0, 1000));
    }
  }
  return { ok: errors.length === 0, durationMs: Date.now() - startedAt, errors, buildId };
}

export { repoRoot as appRepoRoot, templateDir as appTemplateDir };
