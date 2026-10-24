#!/usr/bin/env node
/**
 * Prépare le dossier d'upload pour un Hugging Face Space (hébergement gratuit).
 *
 *   node deploy/huggingface/preparer-upload.mjs
 *
 * Crée deploy/huggingface/upload/ contenant EXACTEMENT ce qu'il faut glisser-
 * déposer dans le Space : le code + dist/ + le README HF (front matter docker),
 * SANS node_modules, .git, données locales (.volaco-data), workspaces ni
 * documents privés.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'deploy', 'huggingface', 'upload');

/** Liste blanche racine : strictement ce que l'image de runtime exige. */
const ROOT_WHITELIST = ['apps', 'dist', 'package.json', 'package-lock.json'];

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    const st = statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else cpSync(s, d);
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const entry of ROOT_WHITELIST) {
  const s = join(ROOT, entry);
  if (!existsSync(s)) {
    console.error('MANQUANT (compile d\'abord ?) : ' + entry);
    process.exit(1);
  }
  const st = statSync(s);
  if (st.isDirectory()) copyDir(s, join(OUT, entry));
  else cpSync(s, join(OUT, entry));
}

// Le README HF (front matter sdk: docker) remplace le README du dépôt
cpSync(join(ROOT, 'deploy', 'huggingface', 'README.md'), join(OUT, 'README.md'));

// Le Dockerfile HF remplace celui de deploy/ (HF le lit à la racine)
cpSync(join(ROOT, 'deploy', 'huggingface', 'Dockerfile'), join(OUT, 'Dockerfile'));

const manifest = {
  généréLe: new Date().toISOString(),
  contenu: 'code + dist/ uniquement — aucune donnée locale, aucun secret',
  secretsÀConfigurerDansLeSpace: ['MISTRAL_API_KEY', 'AUTH_SECRET']
};
writeFileSync(join(OUT, 'UPLOAD-INFO.json'), JSON.stringify(manifest, null, 2));

console.log('Dossier prêt : ' + relative(ROOT, OUT));
console.log('→ glisse-dépose son CONTENU dans ton Space Hugging Face (SDK Docker).');
console.log('→ configure ensuite les secrets MISTRAL_API_KEY et AUTH_SECRET.');
