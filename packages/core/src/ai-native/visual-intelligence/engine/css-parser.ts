/**
 * VibeCode Core - Visual Intelligence
 * CDC V8 §7 — Parseur CSS déterministe du pipeline visuel.
 *
 * Avant ce module, l'analyse statique ne lisait que : (1) un dictionnaire
 * Tailwind volontairement restreint, (2) les styles inline. Les blocs
 * <style> du document, les variables CSS, les media queries et les
 * transitions/animations étaient donc invisibles — ce qui rendait les
 * tokens motion/layout impossibles à inférer honnêtement.
 *
 * Ce parseur couvre exactement ce dont les moteurs ont besoin :
 *  - extraction des blocs <style> (repli quand Chromium n'est pas disponible) ;
 *  - déclarations + variables `--x` (résolution var()) ;
 *  - @media min/max-width (filtrage selon le viewport analysé) ;
 *  - @keyframes (noms réels, pour entrance/exit) ;
 *  - sélecteurs simples/compound/descendants (tag, .class, #id) ;
 *  - états :hover/:focus séparés des styles de base.
 *
 * Aucune dépendance, aucun réseau, aucune heuristique aléatoire.
 */

export interface CssDeclaration {
  readonly property: string;
  readonly value: string;
}

export interface ParsedCssRule {
  readonly selector: string;
  readonly declarations: readonly CssDeclaration[];
  readonly mediaPrelude?: string | undefined;
  readonly mediaMinWidth?: number | undefined;
  readonly mediaMaxWidth?: number | undefined;
  readonly hover: boolean;
  readonly focus: boolean;
}

export interface ParsedCss {
  readonly variables: Readonly<Record<string, string>>;
  readonly rules: readonly ParsedCssRule[];
  readonly keyframes: readonly string[];
  readonly breakpoints: readonly string[];
}

/** Contexte minimal d'un nœud DOM pour évaluer un sélecteur CSS. */
export interface CssNodeContext {
  readonly tagName: string;
  readonly id: string;
  readonly classes: readonly string[];
  /** Du plus proche au plus lointain. */
  readonly ancestors: readonly CssNodeContext[];
}

const PSEUDO_STATE_RE = /:(hover|focus|focus-visible|active|visited|disabled|checked|target|focus-within)\b/i;
const PSEUDO_ANY_RE = /::?[a-zA-Z-]+(?:\([^)]*\))?/g;

/** Concatène tous les blocs <style> inline du document. */
export function extractDocumentCss(html: string): string {
  const blocks: string[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const match of html.matchAll(re)) {
    if (match[1] && match[1].trim().length > 0) blocks.push(match[1]);
  }
  return blocks.join('\n');
}

/** Retire les commentaires CSS (sans toucher aux chaînes de caractères). */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Trouve les blocs @name { ... } de premier niveau, accolades équilibrées. */
function findAtBlocks(css: string, atName: string): { prelude: string; body: string; start: number; end: number }[] {
  const out: { prelude: string; body: string; start: number; end: number }[] = [];
  const needle = '@' + atName;
  let from = 0;
  while (from < css.length) {
    const at = css.toLowerCase().indexOf(needle, from);
    if (at < 0) break;
    const open = css.indexOf('{', at);
    if (open < 0) break;
    let depth = 0;
    let close = -1;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) break;
    out.push({
      prelude: css.slice(at + needle.length, open).trim(),
      body: css.slice(open + 1, close),
      start: at,
      end: close + 1
    });
    from = close + 1;
  }
  return out;
}

/** Remplace les blocs par des espaces (conserve les index, évite les faux rules). */
function blankRanges(css: string, ranges: readonly { start: number; end: number }[]): string {
  const chars = css.split('');
  for (const r of ranges) {
    for (let i = r.start; i < r.end; i++) chars[i] = ' ';
  }
  return chars.join('');
}

function parseDeclarations(body: string): CssDeclaration[] {
  const out: CssDeclaration[] = [];
  for (const raw of body.split(';')) {
    const part = raw.trim();
    if (!part) continue;
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    if (!property || !value) continue;
    // `!important` ne change rien à la valeur observée ; on le retire pour
    // que les comparaisons restent stables.
    value = value.replace(/\s*!important\s*$/i, '').trim();
    if (value.length === 0) continue;
    out.push({ property, value });
  }
  return out;
}

function pxFromLength(value: string): number | undefined {
  const m = /^(-?\d+(?:\.\d+)?)(px|rem|em)$/i.exec(value.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  const unit = m[2]!.toLowerCase();
  if (!Number.isFinite(n)) return undefined;
  return unit === 'px' ? n : n * 16;
}

function parseMediaConstraints(prelude: string): { min?: number; max?: number } {
  const out: { min?: number; max?: number } = {};
  for (const m of prelude.matchAll(/\((min|max)-width\s*:\s*([^)]+)\)/gi)) {
    const kind = m[1]!.toLowerCase();
    const px = pxFromLength(m[2]!.trim());
    if (px === undefined) continue;
    if (kind === 'min') out.min = px;
    else out.max = px;
  }
  return out;
}

/** Tokenise un sélecteur listé par virgules (sans descendre dans :is()). */
function splitSelectors(selectorList: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of selectorList) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Parse un CSS complet en règles exploitables. Une règle par sélecteur (les
 * listes `a, b` sont éclatées) pour que l'état :hover de `b` ne contamine
 * jamais les styles de base de `a`.
 */
export function parseCss(css: string): ParsedCss {
  const clean = stripComments(css || '');
  const variables: Record<string, string> = {};

  // 1. @keyframes — noms réels uniquement.
  const keyblocks = findAtBlocks(clean, 'keyframes');
  const keyframes = keyblocks.map((b) => b.prelude.split(/\s+/)[0] ?? '').filter((n) => n.length > 0);

  // 2. @media — règles internes avec contraintes de largeur. Elles sont
  //    appliquées APRÈS les règles de base (une media query surcharge la
  //    règle générale à la largeur correspondante).
  const mediaBlocks = findAtBlocks(clean, 'media');
  const breakpoints = new Set<string>();
  const mediaRules: ParsedCssRule[] = [];
  for (const block of mediaBlocks) {
    const constraints = parseMediaConstraints(block.prelude);
    if (constraints.min !== undefined) breakpoints.add(`${constraints.min}px`);
    if (constraints.max !== undefined) breakpoints.add(`${constraints.max}px`);
    for (const m of block.body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = splitSelectors(m[1]!.trim());
      const declarations = parseDeclarations(m[2]!);
      for (const selector of selectors) {
        mediaRules.push({
          selector,
          declarations,
          mediaPrelude: block.prelude,
          ...(constraints.min !== undefined ? { mediaMinWidth: constraints.min } : {}),
          ...(constraints.max !== undefined ? { mediaMaxWidth: constraints.max } : {}),
          hover: PSEUDO_STATE_RE.test(selector) && /:hover\b/i.test(selector),
          focus: /:focus(?:-visible|-within)?\b/i.test(selector)
        });
      }
    }
  }

  // 3. Règles de base (hors @media/@keyframes).
  const rules: ParsedCssRule[] = [];
  const base = blankRanges(clean, [...mediaBlocks, ...keyblocks]);
  for (const m of base.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = splitSelectors(m[1]!.trim());
    const declarations = parseDeclarations(m[2]!);
    for (const selector of selectors) {
      // Variables CSS : collectées quel que soit le sélecteur (comportement
      // réel de la cascade simplifiée du pipeline).
      for (const decl of declarations) {
        if (decl.property.startsWith('--')) variables[decl.property] = decl.value;
      }
      rules.push({
        selector,
        declarations,
        hover: PSEUDO_STATE_RE.test(selector) && /:hover\b/i.test(selector),
        focus: /:focus(?:-visible|-within)?\b/i.test(selector)
      });
    }
  }

  return {
    variables,
    rules: [...rules, ...mediaRules],
    keyframes,
    breakpoints: Array.from(breakpoints).sort((a, b) => parseFloat(a) - parseFloat(b))
  };
}

/** Résout récursivement var(--x, fallback) avec une profondeur bornée. */
export function resolveCssVariables(value: string, variables: Readonly<Record<string, string>>, depth = 0): string {
  if (depth > 8 || !value.includes('var(')) return value;
  const resolved = value.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)/g, (_full, name: string, fallback?: string) => {
    const found = variables[name];
    if (found !== undefined) return resolveCssVariables(found, variables, depth + 1);
    return fallback !== undefined ? resolveCssVariables(fallback, variables, depth + 1) : '';
  });
  return resolved.trim();
}

/** Vrai si le sélecteur (hors états) cible ce nœud. */
export function matchesCssSelector(selector: string, ctx: CssNodeContext): boolean {
  if (!selector) return false;
  // Les sélecteurs d'attribut fonctionnels ne sont pas évalués : mieux vaut
  // ne rien appliquer que d'appliquer à tort.
  if (selector.includes(':not(') || selector.includes('[')) return false;
  const cleaned = selector.replace(PSEUDO_ANY_RE, '').trim();
  if (!cleaned) return false;
  if (cleaned.includes('+') || cleaned.includes('~')) return false;

  const parts = cleaned.replace(/>/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;

  const matchesCompound = (compound: string, node: CssNodeContext): boolean => {
    if (compound === '*') return true;
    let rest = compound;
    // tag en tête
    const tagMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
    if (tagMatch) {
      if (tagMatch[1]!.toLowerCase() !== node.tagName.toLowerCase()) return false;
      rest = rest.slice(tagMatch[1]!.length);
    }
    while (rest.length > 0) {
      if (rest.startsWith('#')) {
        const m = /^#([A-Za-z0-9_-]+)/.exec(rest);
        if (!m) return false;
        if (node.id !== m[1]) return false;
        rest = rest.slice(m[0].length);
      } else if (rest.startsWith('.')) {
        const m = /^\.([A-Za-z0-9_-]+)/.exec(rest);
        if (!m) return false;
        if (!node.classes.includes(m[1]!)) return false;
        rest = rest.slice(m[0].length);
      } else if (rest.startsWith('*')) {
        rest = rest.slice(1);
      } else {
        return false;
      }
    }
    return true;
  };

  let index = parts.length - 1;
  if (!matchesCompound(parts[index]!, ctx)) return false;
  index--;
  let ancestorIndex = 0;
  while (index >= 0) {
    let found = false;
    while (ancestorIndex < ctx.ancestors.length) {
      const ancestor = ctx.ancestors[ancestorIndex++]!;
      if (matchesCompound(parts[index]!, ancestor)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
    index--;
  }
  return true;
}

/** Vrai si la règle s'applique à la largeur de viewport analysée. */
export function ruleMatchesViewport(rule: ParsedCssRule, viewportWidth: number | undefined): boolean {
  if (viewportWidth === undefined) return true;
  if (rule.mediaMinWidth !== undefined && viewportWidth < rule.mediaMinWidth) return false;
  if (rule.mediaMaxWidth !== undefined && viewportWidth > rule.mediaMaxWidth) return false;
  return true;
}
