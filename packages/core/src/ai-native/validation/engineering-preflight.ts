/**
 * V7 — Préflight d'ingénierie du contenu candidat.
 *
 * La ValidationChain historique tourne APRÈS la persistance et son étape
 * « syntaxe » ne couvre que JS/TS/JSON : un HTML structurellement invalide
 * pouvait donc être écrit avant d'être analysé. Ce module fournit un contrôle
 * déterministe, exécuté AVANT la mutation, sur le contenu exact qui serait
 * écrit.
 *
 * Politique volontairement conservatrice :
 * - FAIL uniquement pour les défauts durs (contenu absent/trop court, enveloppe
 *   de document manquante, octet nul, taille excessive) ;
 * - WARN pour les défauts récupérables par le navigateur (balises majeures non
 *   fermées, script non équilibré, marqueurs internes résiduels) ;
 * - aucun score visuel, aucune autorité sur le Quality Gate : ce préflight ne
 *   remplace ni la ValidationChain consultative ni le gate visuel.
 */

import { createHash } from 'node:crypto';

export type EngineeringCheckStatus = 'PASS' | 'WARN' | 'FAIL';

export interface EngineeringCheck {
  readonly id: string;
  readonly label: string;
  readonly status: EngineeringCheckStatus;
  readonly detail: string;
}

export interface EngineeringPreflightReport {
  readonly schemaVersion: '1.0.0';
  readonly path: string;
  readonly verdict: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL';
  readonly passed: boolean;
  readonly checks: readonly EngineeringCheck[];
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly contentHash: string;
  readonly byteLength: number;
  readonly lineCount: number;
  readonly checkedAt: string;
}

const MIN_CONTENT_CHARS = 100;
const WARN_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;

/** Balises sans fermeture en HTML. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr'
]);

/**
 * Conteneurs dont la fermeture est réellement attendue. Les balises à
 * fermeture optionnelle (p, li, td, th, tr, option…) sont exclues pour éviter
 * les faux positifs.
 */
const BALANCED_TAGS = new Set([
  'html', 'head', 'body', 'main', 'div', 'section', 'header', 'footer',
  'nav', 'article', 'aside', 'form', 'table', 'select'
]);

function check(
  id: string,
  label: string,
  status: EngineeringCheckStatus,
  detail: string
): EngineeringCheck {
  return { id, label, status, detail };
}

function stripRawText(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
}

function scanBalancedTags(content: string): {
  readonly unclosed: readonly string[];
  readonly strayClosing: readonly string[];
} {
  const cleaned = stripRawText(content);
  const stack: string[] = [];
  const unclosed = new Set<string>();
  const strayClosing = new Set<string>();
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)(?:\s[^>]*)?\/?>/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(cleaned)) !== null) {
    const raw = match[0];
    const name = (match[1] ?? '').toLowerCase();
    if (!name || !BALANCED_TAGS.has(name) || VOID_TAGS.has(name)) continue;
    if (raw.endsWith('/>')) continue;

    if (raw.startsWith('</')) {
      const index = stack.lastIndexOf(name);
      if (index === -1) {
        strayClosing.add(name);
        continue;
      }
      if (index !== stack.length - 1) {
        for (const orphan of stack.splice(index + 1)) unclosed.add(orphan);
      }
      stack.pop();
      continue;
    }

    stack.push(name);
  }

  for (const orphan of stack) unclosed.add(orphan);
  return { unclosed: [...unclosed].sort(), strayClosing: [...strayClosing].sort() };
}

function countTag(content: string, tag: string): number {
  const regex = new RegExp(`<${tag}\\b`, 'gi');
  return (content.match(regex) ?? []).length;
}

function countClosingTag(content: string, tag: string): number {
  const regex = new RegExp(`</${tag}\\s*>`, 'gi');
  return (content.match(regex) ?? []).length;
}

function visibleTextLength(content: string): number {
  const withoutRaw = stripRawText(content);
  const withoutTags = withoutRaw.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim().length;
}

export function runEngineeringPreflight(
  content: string,
  path = 'index.html'
): EngineeringPreflightReport {
  const checks: EngineeringCheck[] = [];
  const trimmed = content.trim();
  const byteLength = Buffer.byteLength(content, 'utf8');
  const lineCount = content.length === 0 ? 0 : content.split('\n').length;

  if (trimmed.length < MIN_CONTENT_CHARS) {
    checks.push(check(
      'content-length',
      'Contenu suffisant',
      'FAIL',
      `Contenu trop court : ${trimmed.length} caractère(s), minimum ${MIN_CONTENT_CHARS}.`
    ));
  } else {
    checks.push(check(
      'content-length',
      'Contenu suffisant',
      'PASS',
      `${trimmed.length} caractère(s), ${lineCount} ligne(s).`
    ));
  }

  if (content.includes('\0')) {
    checks.push(check(
      'null-bytes',
      'Absence d’octet nul',
      'FAIL',
      'Le contenu candidat contient au moins un octet nul.'
    ));
  } else {
    checks.push(check('null-bytes', 'Absence d’octet nul', 'PASS', 'Aucun octet nul.'));
  }

  const hasDoctype = /<!doctype\s+html/i.test(content);
  const hasHtmlOpen = /<html[\s>]/i.test(content);
  const hasBodyOpen = /<body[\s>]/i.test(content);
  const envelopeMissing = [
    hasDoctype ? '' : '<!DOCTYPE html>',
    hasHtmlOpen ? '' : '<html>',
    hasBodyOpen ? '' : '<body>'
  ].filter(Boolean);

  if (envelopeMissing.length > 0) {
    checks.push(check(
      'document-envelope',
      'Enveloppe de document',
      'FAIL',
      `Élément(s) obligatoire(s) absent(s) : ${envelopeMissing.join(', ')}.`
    ));
  } else {
    checks.push(check(
      'document-envelope',
      'Enveloppe de document',
      'PASS',
      'DOCTYPE, <html> et <body> présents.'
    ));
  }

  const hasHtmlClose = /<\/html\s*>/i.test(content);
  const hasBodyClose = /<\/body\s*>/i.test(content);
  if (!hasHtmlClose || !hasBodyClose) {
    checks.push(check(
      'document-close',
      'Fermeture du document',
      'WARN',
      `Fermeture(s) absente(s) : ${[hasBodyClose ? '' : '</body>', hasHtmlClose ? '' : '</html>'].filter(Boolean).join(', ')}.`
    ));
  } else {
    checks.push(check('document-close', 'Fermeture du document', 'PASS', '</body> et </html> présents.'));
  }

  const balance = scanBalancedTags(content);
  if (balance.unclosed.length > 0 || balance.strayClosing.length > 0) {
    const parts: string[] = [];
    if (balance.unclosed.length > 0) parts.push(`non fermée(s) : ${balance.unclosed.slice(0, 8).join(', ')}`);
    if (balance.strayClosing.length > 0) parts.push(`fermeture(s) orpheline(s) : ${balance.strayClosing.slice(0, 8).join(', ')}`);
    checks.push(check(
      'major-tags-balanced',
      'Équilibre des conteneurs majeurs',
      'WARN',
      parts.join(' ; ') + '.'
    ));
  } else {
    checks.push(check(
      'major-tags-balanced',
      'Équilibre des conteneurs majeurs',
      'PASS',
      'Tous les conteneurs suivis sont équilibrés.'
    ));
  }

  const scriptOpens = countTag(content, 'script');
  const scriptCloses = countClosingTag(content, 'script');
  if (scriptOpens !== scriptCloses) {
    checks.push(check(
      'script-balance',
      'Équilibre des scripts',
      'WARN',
      `${scriptOpens} ouverture(s) <script> pour ${scriptCloses} fermeture(s).`
    ));
  } else {
    checks.push(check(
      'script-balance',
      'Équilibre des scripts',
      'PASS',
      `${scriptOpens} bloc(s) script équilibré(s).`
    ));
  }

  if (byteLength > MAX_BYTES) {
    checks.push(check(
      'content-size',
      'Taille du document',
      'FAIL',
      `${byteLength} octets, plafond dur ${MAX_BYTES}.`
    ));
  } else if (byteLength > WARN_BYTES) {
    checks.push(check(
      'content-size',
      'Taille du document',
      'WARN',
      `${byteLength} octets, au-delà du seuil d’alerte ${WARN_BYTES}.`
    ));
  } else {
    checks.push(check('content-size', 'Taille du document', 'PASS', `${byteLength} octets.`));
  }

  const hasMedia = /<(img|svg|canvas|video|picture)\b/i.test(content);
  const textLength = visibleTextLength(content);
  if (textLength < 10 && !hasMedia) {
    checks.push(check(
      'visible-content',
      'Contenu visible',
      'WARN',
      `Texte visible très court (${textLength} caractère(s)) et aucun média détecté.`
    ));
  } else {
    checks.push(check(
      'visible-content',
      'Contenu visible',
      'PASS',
      `${textLength} caractère(s) de texte visible${hasMedia ? ', média présent' : ''}.`
    ));
  }

  if (/PAGE_TITLE|DESIGN_DNA|__VIBE_/i.test(content)) {
    checks.push(check(
      'internal-markers',
      'Marqueurs internes',
      'WARN',
      'Un marqueur interne (PAGE_TITLE / DESIGN_DNA / __VIBE_) subsiste dans le document final.'
    ));
  } else {
    checks.push(check('internal-markers', 'Marqueurs internes', 'PASS', 'Aucun marqueur interne résiduel.'));
  }

  const blockers = checks
    .filter((item) => item.status === 'FAIL')
    .map((item) => `${item.label} : ${item.detail}`);
  const warnings = checks
    .filter((item) => item.status === 'WARN')
    .map((item) => `${item.label} : ${item.detail}`);
  const verdict: EngineeringPreflightReport['verdict'] =
    blockers.length > 0 ? 'FAIL' : warnings.length > 0 ? 'PASS_WITH_WARNINGS' : 'PASS';

  return {
    schemaVersion: '1.0.0',
    path,
    verdict,
    passed: verdict !== 'FAIL',
    checks,
    blockers,
    warnings,
    contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
    byteLength,
    lineCount,
    checkedAt: new Date().toISOString()
  };
}
