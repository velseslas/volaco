/**
 * VibeCode Core — P1-B : politique d'images des APPLICATIONS REACT.
 *
 * Inspection PURE et déterministe des références d'images dans les fichiers
 * sources d'un projet React (TSX/TS/JSX/JS/CSS/HTML), AVANT sauvegarde et
 * build. Aucune transformation de contenu : le vérificateur retourne des
 * violations — la correction reste au LLM (rond de réparation assistée,
 * génération) ou au refus d'application (édition). Jamais de sanitizer HTML
 * sur du TSX (P1-B, décision A.3).
 *
 * Règles réutilisées sans duplication : allVerifiedUnsplashIds (theme.ts =
 * source unique du réservoir vérifié), picsum.photos + data:image/ (contrat
 * identique au sanitizer du pipeline HTML, conversation.ts L444-464).
 *
 * Limits statiques assumées : une expression JSX dynamique (src={…} non
 * littérale), une inter-chaîne interpolée ou une URL d'état runtime est
 * retournée comme INDETERMINÉE (jamais comme validée) — documenté dans le
 * rapport, non bloquant. Les références locales (relatives, /api/…/images/…)
 * sont admises sans vérification d'existence (le bundle est reconstruit par
 * buildApp, qui échouera de lui-même sur un asset manquant).
 */

import { allVerifiedUnsplashIds } from './theme.js';

const VERIFIED_IDS: ReadonlySet<string> = new Set(allVerifiedUnsplashIds());

const URL_MAX = 200;

export type AppImageKind = 'img-src' | 'srcset' | 'css-url' | 'tailwind-url' | 'svg-image' | 'dynamic';

export interface AppImageReference {
  /** Chemin relatif du fichier (workspace) où la référence a été trouvée. */
  readonly path: string;
  readonly kind: AppImageKind;
  /** Référence brute tronquée à 200 caractères (extrait journalisable). */
  readonly url: string;
  /** Hôte pour une URL absolue, '' pour une référence locale, '(expression)' pour du dynamique. */
  readonly host: string;
  /** Ligne 1-based du début de la référence, si localisable. */
  readonly line: number | null;
  readonly status: 'violation' | 'undetermined';
  /** Motif précis : pourquoi cette référence n'est pas conforme / pas analysable. */
  readonly reason: string;
}

export interface AppImageInspection {
  /** Références interdites : la publication doit être empêchée tant qu'elles existent. */
  readonly violations: readonly AppImageReference[];
  /** Références dynamiques explicites : non validées, non bloquantes, documentées. */
  readonly undetermined: readonly AppImageReference[];
}

/** Extension de fichier éligible à l'inspection. */
export function isInspectableAppFile(path: string): boolean {
  return /\.(tsx|ts|jsx|js|css|html)$/i.test(path);
}

function makeReference(
  path: string,
  kind: AppImageKind,
  url: string,
  host: string,
  line: number | null,
  status: 'violation' | 'undetermined',
  reason: string
): AppImageReference {
  return { path, kind, url, host, line, status, reason };
}

function clamp(url: string): string {
  return url.length > URL_MAX ? url.slice(0, URL_MAX) + '…' : url;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  const stop = Math.min(index, text.length);
  for (let i = 0; i < stop; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** Numéros de lignes « commentaires » : candidats à ignorer (faux positifs). */
function commentLineNumbers(text: string): ReadonlySet<number> {
  const out = new Set<number>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i]!.trimStart();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) out.add(i + 1);
  }
  return out;
}

/**
 * Classification d'une référence d'image LITTÉRALE (string).
 * Retourne null pour une référence AUTORISÉE (règles du contrat existant),
 * sinon une référence violation/indéterminée.
 */
function classifyLiteral(
  path: string,
  kind: AppImageKind,
  rawUrl: string,
  line: number | null
): AppImageReference | null {
  const url = rawUrl.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (url.length === 0) return null; // src vide : le gate/signaleur existant s'en charge

  // data:image/… autorisé (même contrat que le sanitizer HTML) ; data: non-image interdit.
  if (/^data:image\//i.test(url)) return null;
  if (/^data:[^,)]*\//i.test(url)) {
    return makeReference(path, kind, clamp(url), 'data:', line, 'violation', 'data: hors image (seul data:image/ est autorisé)');
  }

  // //cdn… = souverainété protocole-relatif : réellement externe.
  const normalized = url.startsWith('//') ? 'https:' + url : url;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    // Pas d'URL absolue : référence locale (relative, ./, ../, /, assets/, /api/…/images/…).
    // L'existence de l'asset n'est pas vérifiable statiquement (limite documentée).
    return null;
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const host = parsed.hostname.toLowerCase();
    if (host === 'picsum.photos') return null;
    if (host === 'images.unsplash.com') {
      const segment = (parsed.pathname.split('/').pop() ?? '').split('?')[0] ?? '';
      if (VERIFIED_IDS.has(segment)) return null;
      return makeReference(
        path,
        kind,
        clamp(url),
        host,
        line,
        'violation',
        'ID Unsplash hors du réservoir vérifié du serveur'
      );
    }
    return makeReference(path, kind, clamp(url), host, line, 'violation', 'hôte non autorisé : ' + host);
  }

  if (parsed.protocol === 'blob:') {
    return makeReference(path, kind, clamp(url), 'blob:', line, 'undetermined', 'référence runtime (blob:) non vérifiable statiquement');
  }
  return makeReference(
    path,
    kind,
    clamp(url),
    parsed.protocol,
    line,
    'violation',
    'protocole interdit pour une image : ' + parsed.protocol
  );
}

/**
 * Référence src={expression JSX} : littérale analysable une fois, ou état
 * INDETERMINÉ explicitement documenté (jamais déclaré conforme).
 * Retourne null si la référence littérale est autorisée.
 */
function classifyExpression(path: string, exprRaw: string, line: number | null): AppImageReference | null {
  const expr = exprRaw.trim();

  // ”string littérale”
  const single = /^(['"])([\s\S]*)\1$/.exec(expr);
  if (single) {
    const inner = single[2]!;
    if (/\$\{/.test(inner)) {
      return makeReference(
        path,
        'dynamic',
        clamp('(' + expr.slice(0, 118) + (expr.length > 118 ? '…' : '') + ')'),
        '(expression)',
        line,
        'undetermined',
        'chaîne interpolée dans src={} — non vérifiable statiquement'
      );
    }
    return classifyLiteral(path, 'img-src', inner, line);
  }

  // Template literal `(sans interpolation) = état littéral.
  const tpl = /^`([\s\S]*)`$/.exec(expr);
  if (tpl && !/\$\{/.test(tpl[1]!)) {
    return classifyLiteral(path, 'img-src', tpl[1]!, line);
  }

  return makeReference(
    path,
    'dynamic',
    clamp('(' + expr.slice(0, 118) + (expr.length > 118 ? '…' : '') + ')'),
    '(expression)',
    line,
    'undetermined',
    'expression JSX dynamique — la politique du serveur ne peut pas la valider statiquement'
  );
}

/**
 * Scan l'attribut src/srcset d'un tag <img …> multi-ligne.
 *
 * PATCH-1 (évasions fermées) :
 * - attributs HTML NON quotés : `src=https://…` est valide en HTML pur et
 *   passait silencieusement (4e branche de la regex) ;
 * - spread de propriétés : `{...imgProps}` sans src littéral n'était ni
 *   référence ni `undetermined` — la source finale n'est PAS connue de
 *   l'inspecteur : objet littéral inline => analysé ; spread seul ou spread
 *   ultérieur => violation (toute image doit être une référence littérale).
 */
function scanImgTag(path: string, tagStart: number, tag: string, text: string, commentLines: ReadonlySet<number>, out: AppImageReference[]): void {
  const srcEntry = (/(?:^|[\s(])src\s*=\s*("([^"]*)"|'([^']*)'|\{[^}]*\}|([^>\s"'{}][^>\s]*))/i.exec(tag));
  if (srcEntry) {
    const abs = tagStart + (srcEntry.index ?? 0);
    const line = lineOf(text, abs);
    const token = srcEntry[1] ?? '';
    if (token.startsWith('{')) {
      const ref = classifyExpression(path, token.slice(1, -1), line);
      if (ref) out.push(ref);
    } else {
      const inner = token.charAt(0) === '"' ? (srcEntry[2] ?? '')
        : token.charAt(0) === "'" ? (srcEntry[3] ?? '')
        : (srcEntry[4] ?? '');
      const literal = classifyLiteral(path, 'img-src', inner.trim(), line);
      if (literal) out.push(literal);
    }
  }
  const srcsetEntry = (/(?:^|[\s(])srcset\s*=\s*("([^"]*)"|'([^']*)'|\{[^}]*\}|([^>\s"'{}][^>\s]*))/i.exec(tag));
  if (srcsetEntry) {
    const abs = tagStart + (srcsetEntry.index ?? 0);
    const line = lineOf(text, abs);
    const token = srcsetEntry[1] ?? '';
    if (token.startsWith('{')) {
      const ref = classifyExpression(path, token.slice(1, -1), line);
      if (ref) out.push(ref);
    } else {
      const inner = token.charAt(0) === '"' ? (srcsetEntry[2] ?? '')
        : token.charAt(0) === "'" ? (srcsetEntry[3] ?? '')
        : (srcsetEntry[4] ?? '');
      for (const entry of inner.split(',').map((seg) => seg.trim())) {
        const first = entry.split(/\s+/)[0] ?? '';
        if (first.length === 0) continue;
        const literal = classifyLiteral(path, 'srcset', first, line);
        if (literal) out.push(literal);
      }
    }
  }
  // PATCH-1 — spread : ne JAMAIS prétendre connaître la source de l image.
  const spreadMatch = /\{\s*\.\.\./.exec(tag);
  if (spreadMatch) {
    // 1. Objet littéral inline `{...{ src: '…' }}` : la source est statique.
    const inlineSrc = /\bsrc\s*:\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/.exec(tag);
    if (inlineSrc) {
      const line = lineOf(text, tagStart + (spreadMatch.index ?? 0));
      // NB : le groupe interne d'une alternance répétée ne garde que la
      // DERNIÈRE itération — extraire la valeur par épluchage des guillemets.
      const raw = inlineSrc[1] ?? '';
      const inner = raw.slice(1, -1);
      if (/\$\{/.test(inner)) {
        out.push(makeReference(path, 'dynamic', clamp('(' + inner.slice(0, 118) + ')'), '(expression)', line, 'undetermined', 'chaîne interpolée dans un spread — non vérifiable statiquement'));
      } else {
        const literal = classifyLiteral(path, 'img-src', inner.trim(), line);
        if (literal) out.push(literal);
      }
    } else if (!srcEntry && !srcsetEntry) {
      // 2. spread seul, aucune autre source : violation (source inconnue).
      const line = lineOf(text, tagStart + (spreadMatch.index ?? 0));
      out.push(makeReference(path, 'img-src', clamp('(expression spread)'), '(spread)', line, 'violation', 'référence d image positionnée par spread ({...}) — la politique du serveur exige une référence littérale et vérifiable (réservoir Unsplash, picsum.photos, data:image/ ou chemin local)'));
    } else {
      // 3. spread APRÈS une source littérale : en JSX l attribut le plus à
      //    droite gagne, la source_RUNTIME peut écraser le littéral — violation.
      const lastStaticIdx = Math.max(srcEntry ? (srcEntry.index ?? -1) : -1, srcsetEntry ? (srcsetEntry.index ?? -1) : -1);
      if ((spreadMatch.index ?? 0) > lastStaticIdx) {
        const line = lineOf(text, tagStart + (spreadMatch.index ?? 0));
        out.push(makeReference(path, 'img-src', clamp('(expression spread)'), '(spread)', line, 'violation', 'spread ({...}) positionné APRÈS une source littérale — en JSX l attribut final gagne et la source effective est inconnue'));
      }
    }
  }
}

/**
 * PATCH-1 — tags <image …> SVG : les attributs href / xlink:href échappaient
 * entièrement à l'inspecteur (le scan ne regardait que <img>). Même
 * classification que src/srcset : quoté/brace/non-quoté.
 */
function scanSvgImageTag(path: string, tagStart: number, tag: string, text: string, out: AppImageReference[]): void {
  const hrefEntry = (/(?:^|[\s(])(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)'|\{[^}]*\}|([^>\s"'{}][^>\s]*))/i.exec(tag));
  if (!hrefEntry) return;
  const abs = tagStart + (hrefEntry.index ?? 0);
  const line = lineOf(text, abs);
  const token = hrefEntry[1] ?? '';
  if (token.startsWith('{')) {
    const ref = classifyExpression(path, token.slice(1, -1), line);
    if (ref) out.push(ref);
    return;
  }
  const inner = token.charAt(0) === '"' ? (hrefEntry[2] ?? '')
    : token.charAt(0) === "'" ? (hrefEntry[3] ?? '')
    : (hrefEntry[4] ?? '');
  if (/\$\{/.test(inner)) {
    out.push(makeReference(path, 'svg-image', clamp('(' + inner.slice(0, 118) + ')'), '(expression)', line, 'undetermined', 'chaîne interpolée dans href SVG — non vérifiable statiquement'));
    return;
  }
  const literal = classifyLiteral(path, 'svg-image', inner.trim(), line);
  if (literal) out.push(literal);
}

/** Scan un contenu de fichier (texte) pour toutes les références d'images. */
function scanContent(path: string, content: string, out: AppImageReference[]): void {
  const commentLines = commentLineNumbers(content);
  const keepCandidate = (index: number): boolean => !commentLines.has(lineOf(content, index));

  // 1. Tags <img …> (HTML autonome + img JSX, multi-ligne) : src et srcset.
  const imgTag = /<img\b[^>]*?>/gis;
  for (let m = imgTag.exec(content); m !== null; m = imgTag.exec(content)) {
    if (!keepCandidate(m.index)) continue;
    scanImgTag(path, m.index, m[0], content, commentLines, out);
  }

  // 1b. PATCH-1 — Tags <image …> SVG : href / xlink:href échappaient au
  //     scanner (seul <img> était regardé). Un <image> HTML autonome est
  //     une vraie référence d'image du bundle.
  const svgImageTag = /<image\b[^>]*?>/gis;
  for (let m = svgImageTag.exec(content); m !== null; m = svgImageTag.exec(content)) {
    if (!keepCandidate(m.index)) continue;
    scanSvgImageTag(path, m.index, m[0], content, out);
  }

  // 2. Classes Tailwind arbitraires bg-[url(...)] etc. — scannées EN PREMIER :
  // leur span sert à exclure le doublon du pattern url() générique (sinon le
  // même candidat serait compté css-url ET tailwind-url).
  const tailwindSpans: Array<{ start: number; end: number }> = [];
  const tailwind = /[a-zA-Z][a-zA-Z0-9-]*-\[url\(([^)]*)\)\]/g;
  for (let m = tailwind.exec(content); m !== null; m = tailwind.exec(content)) {
    if (!keepCandidate(m.index)) continue;
    const line = lineOf(content, m.index);
    const literal = classifyLiteral(path, 'tailwind-url', (m[1] ?? '').trim(), line);
    if (literal) out.push(literal);
    tailwindSpans.push({ start: m.index, end: m.index + m[0].length });
  }

  // 3. url(...) en CSS (fichiers .css, classes bg, inline style backgroundImage) —
  // candidats hors des spans Tailwind déjà résolus ci-dessus.
  const cssUrl = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;
  for (let m = cssUrl.exec(content); m !== null; m = cssUrl.exec(content)) {
    if (!keepCandidate(m.index)) continue;
    if (tailwindSpans.some((s) => m.index >= s.start && m.index < s.end)) continue;
    const line = lineOf(content, m.index);
    let inner = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    // PATCH-1 — une interpolation (${…}) ou un backtick signifie une
    // expression JS dynamique : avant le patch, `${bg}` retombait dans la
    // branche « pas d'URL absolue = local » et passait SILENCIEUSEMENT.
    //  - interpolation -> violation : toute image doit être une référence
    //    littérale vérifiable (jamais une URL runtime arbitraire).
    //  - template littéral SANS interpolation (`url(https://picsum.photos/…)`)
    //    -> URL statique réelle, analysée après dépouillement des backticks.
    if (/\$\{/.test(inner) || inner.includes('`')) {
      const stripped = inner.replace(/^`+/, '').replace(/`+$/, '').trim();
      if (/\$\{/.test(stripped)) {
        out.push(makeReference(path, 'css-url', clamp('(' + inner.slice(0, 118) + (inner.length > 118 ? '…' : '') + ')'), '(expression)', line, 'violation', 'référence d image dynamique (interpolation) non validable statiquement — la politique exige une référence littérale : réservoir Unsplash, picsum.photos, data:image/ ou chemin local'));
        continue;
      }
      inner = stripped;
    }
    if (inner.length === 0) continue;
    const literal = classifyLiteral(path, 'css-url', inner, line);
    if (literal) out.push(literal);
  }
}

/**
 * Vrai si la violation porte sur un photo-ID Unsplash RÉELLEMENT adopté
 * (hôte images.unsplash.com + slug présent dans le journal d'adoptions).
 * Seule cette classe précise est reclassée — toute autre violation reste
 * bloquante, et un ID inventé de mémoire n'entre jamais dans le journal.
 */
function isAdoptedUnsplashPhoto(reference: AppImageReference, adopted: ReadonlySet<string>): boolean {
  if (reference.host !== 'images.unsplash.com') return false;
  const match = /images\.unsplash\.com\/(photo-[A-Za-z0-9_-]{6,80})(?:[?/]|$)/.exec(reference.url);
  return match !== null && adopted.has(match[1] ?? '');
}

/**
 * P1-B — inspection des sources d'une app React.
 * Entrée : { path, content } des fichiers (ceux réellement écrits sur disque,
 * c'est-à-dire ceux qui construisent le bundle). Pur ; aucune écriture.
 *
 * Option `adoptedIds` (journal d'adoptions,
 * packages/core/src/image/image-adoptions.ts) : les photo-IDs Unsplash
 * réellement fetchés avec la clé usager sont CONFORMES au même titre que le
 * réservoir vérifié. Sans option : comportement historique strictement
 * identique.
 */
export function inspectAppImageSources(
  files: ReadonlyArray<{ path: string; content: string }>,
  options?: { readonly adoptedIds?: ReadonlySet<string> }
): AppImageInspection {
  const all: AppImageReference[] = [];
  for (const file of files) {
    if (!isInspectableAppFile(file.path)) continue;
    scanContent(file.path, file.content, all);
  }
  const adopted = options?.adoptedIds;
  const violations = all
    .filter((r) => r.status === 'violation')
    .filter((r) => !(adopted !== undefined && isAdoptedUnsplashPhoto(r, adopted)))
    .sort((a, b) => (a.path.localeCompare(b.path)) || ((a.line ?? 0) - (b.line ?? 0)));
  const undetermined = all
    .filter((r) => r.status === 'undetermined')
    .sort((a, b) => (a.path.localeCompare(b.path)) || ((a.line ?? 0) - (b.line ?? 0)));
  return { violations, undetermined };
}

/** Renvoi lisible des violations (prompt de correction, logs, erreurs). */
export function formatImageViolations(inspection: AppImageInspection, limit = 10): string[] {
  return inspection.violations.slice(0, limit).map((v) =>
    '- ' + v.path + (v.line !== null ? ' ligne ' + v.line : '') + ' : ' + v.url + ' — ' + v.reason
  );
}
