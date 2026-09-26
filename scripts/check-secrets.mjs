#!/usr/bin/env node
/**
 * Anti-fuite de secrets (ÉTAPE 1 — blindage, remplace gitleaks en l'absence de CI).
 *
 * Deux modes :
 *   node scripts/check-secrets.mjs --staged   → scanne les lignes AJOUTÉES au
 *      commit en cours (utilisé par le hook pre-commit) — rapide, sans faux
 *      positifs historiques.
 *   node scripts/check-secrets.mjs --all      → scanne tout l'arbre tracké
 *      (audit ponctuel / `npm run security:check`).
 *
 * Exemptions (fichiers historiques qui CITENT d'anciennes clés révoquées à
 * titre de documentation) : security-audit/, RAPPORT-AUDIT-*.md,
 * AUDIT-COMPLET-*.md, .env.example (placeholders uniquement).
 */

import { execSync } from 'node:child_process';

const SECRET_PATTERNS = [
  { name: 'Mistral API key', regex: /mstrl_[A-Za-z0-9_-]{16,}/ },
  { name: 'OpenAI-like key', regex: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'Google API key', regex: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'GitHub token', regex: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'Slack token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key block', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Generic high-entropy assignment', regex: /(SECRET|PASSWORD|TOKEN|API_KEY)["']?\s*[:=]\s*["'][A-Za-z0-9+/_-]{32,}["']/ }
];

const ALLOWLIST_PREFIXES = [
  'security-audit/',
  'RAPPORT-AUDIT-',
  'AUDIT-COMPLET-',
  'scripts/check-secrets.mjs',
  '.env.example',
  // Les répertoires de tests contiennent VOLONTAIREMENT de fausses clés
  // (fixtures pour tester la détection de secrets côté auditeurs) :
  'apps/api/tests/',
  'packages/core/tests/',
  'dist/'
];

const isAllowlisted = (path) => ALLOWLIST_PREFIXES.some((p) => path.startsWith(p));

function scanLine(path, line, findings) {
  if (isAllowlisted(path)) return;
  for (const { name, regex } of SECRET_PATTERNS) {
    if (regex.test(line)) {
      findings.push({ path, name, excerpt: line.trim().slice(0, 120) });
      return; // un seul finding par ligne
    }
  }
}

const mode = process.argv.includes('--staged') ? 'staged' : 'all';
const findings = [];

if (mode === 'staged') {
  // Lignes ajoutées (préfixe '+') dans l'index — ignore les suppressions
  const patch = execSync('git diff --cached -U0 --no-color', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let currentPath = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ b/')) currentPath = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++')) scanLine(currentPath, line.slice(1), findings);
  }
} else {
  const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const { readFileSync } = await import('node:fs');
  for (const file of files) {
    if (isAllowlisted(file)) continue;
    let content = '';
    try { content = readFileSync(file, 'utf8'); } catch { continue; }
    content.split('\n').forEach((line) => scanLine(file, line, findings));
  }
}

if (findings.length > 0) {
  console.error('\n🚨 SECRETS DÉTECTÉS — commit refusé :\n');
  for (const f of findings) {
    console.error(`  [${f.name}] ${f.path}`);
    console.error(`    ${f.excerpt}\n`);
  }
  console.error('Révoquez la clé exposée, retirez-la du fichier, puis réessayez.');
  console.error('Si c\'est un faux positif, ajoutez une exemption dans scripts/check-secrets.mjs.\n');
  process.exit(1);
}

console.log(`✓ Aucun secret détecté (${mode === 'staged' ? 'lignes ajoutées au commit' : 'arbre complet'}).`);
