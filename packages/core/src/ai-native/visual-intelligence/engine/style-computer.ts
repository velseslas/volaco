/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-011)
 * Style Computer & Design Value Extractor
 *
 * CDC V8 §7 — le pipeline lit désormais les styles de document (<style>),
 * les variables CSS (var()), les media queries (filtrées par viewport) et
 * les propriétés motion/layout, EN PLUS des classes Tailwind et des styles
 * inline. Rien d'inventé : une propriété absente reste absente.
 */

import { canonicalizeColor } from '../canonical.js';
import type { ComputedStyleSnapshot, NormalizedDomNode } from '../types.js';
import { DEFAULT_COMPUTED_STYLE } from './dom-normalizer.js';
import {
  matchesCssSelector,
  parseCss,
  resolveCssVariables,
  ruleMatchesViewport,
  type CssNodeContext,
  type ParsedCss
} from './css-parser.js';

// Common Tailwind utility mapping dictionary
const TAILWIND_COLORS: Record<string, string> = {
  'bg-white': '#ffffff',
  'bg-black': '#000000',
  'bg-slate-900': '#0f172a',
  'bg-slate-800': '#1e293b',
  'bg-slate-100': '#f1f5f9',
  'bg-gray-100': '#f3f4f6',
  'bg-gray-200': '#e5e7eb',
  'bg-gray-800': '#1f2937',
  'bg-gray-900': '#111827',
  'bg-blue-600': '#2563eb',
  'bg-blue-500': '#3b82f6',
  'bg-purple-600': '#9333ea',
  'bg-indigo-600': '#4f46e5',
  'bg-emerald-500': '#10b981',
  'bg-red-500': '#ef4444',
  'bg-red-600': '#dc2626',
  'text-white': '#ffffff',
  'text-black': '#000000',
  'text-slate-900': '#0f172a',
  'text-slate-100': '#f1f5f9',
  'text-slate-400': '#94a3b8',
  'text-slate-500': '#64748b',
  'text-gray-900': '#111827',
  'text-gray-700': '#374151',
  'text-gray-600': '#4b5563',
  'text-gray-500': '#6b7280',
  'text-blue-600': '#2563eb',
  'text-blue-500': '#3b82f6',
  'text-indigo-600': '#4f46e5',
  'border-slate-700': '#334155',
  'border-slate-200': '#e2e8f0',
  'border-gray-200': '#e5e7eb',
  'border-gray-300': '#d1d5db',
  'border-blue-500': '#3b82f6'
};

const TAILWIND_SPACING: Record<string, string> = {
  'p-0': '0px',
  'p-1': '4px',
  'p-2': '8px',
  'p-3': '12px',
  'p-4': '16px',
  'p-6': '24px',
  'p-8': '32px',
  'm-0': '0px',
  'm-1': '4px',
  'm-2': '8px',
  'm-4': '16px',
  'm-auto': 'auto',
  'gap-1': '4px',
  'gap-2': '8px',
  'gap-3': '12px',
  'gap-4': '16px',
  'gap-6': '24px',
  'gap-8': '32px'
};

const TAILWIND_RADIUS: Record<string, string> = {
  'rounded-none': '0px',
  'rounded-sm': '2px',
  'rounded': '4px',
  'rounded-md': '6px',
  'rounded-lg': '8px',
  'rounded-xl': '12px',
  'rounded-2xl': '16px',
  'rounded-full': '9999px'
};

// CDC V8 §7.7 — largeurs de conteneur standard (valeurs Tailwind réelles).
const TAILWIND_MAX_WIDTH: Record<string, string> = {
  'max-w-xs': '320px',
  'max-w-sm': '384px',
  'max-w-md': '448px',
  'max-w-lg': '512px',
  'max-w-xl': '576px',
  'max-w-2xl': '672px',
  'max-w-3xl': '768px',
  'max-w-4xl': '896px',
  'max-w-5xl': '1024px',
  'max-w-6xl': '1152px',
  'max-w-7xl': '1280px',
  'max-w-full': '100%'
};

// CDC V8 §7.6 — motion Tailwind : durées/easings/transitions réels.
const TAILWIND_DURATION: Record<string, string> = {
  'duration-75': '75ms',
  'duration-100': '100ms',
  'duration-150': '150ms',
  'duration-200': '200ms',
  'duration-300': '300ms',
  'duration-500': '500ms',
  'duration-700': '700ms',
  'duration-1000': '1000ms'
};

const TAILWIND_EASING: Record<string, string> = {
  'ease-linear': 'linear',
  'ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
  'ease-out': 'cubic-bezier(0, 0, 0.2, 1)',
  'ease-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)'
};

const TAILWIND_TRANSITION_PROPERTIES: Record<string, string> = {
  'transition': 'color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter',
  'transition-all': 'all',
  'transition-colors': 'color, background-color, border-color, text-decoration-color, fill, stroke',
  'transition-opacity': 'opacity',
  'transition-transform': 'transform'
};

const TAILWIND_ANIMATION: Record<string, { name: string; duration: string; timing: string }> = {
  'animate-spin': { name: 'spin', duration: '1s', timing: 'linear' },
  'animate-ping': { name: 'ping', duration: '1s', timing: 'cubic-bezier(0, 0, 0.2, 1)' },
  'animate-pulse': { name: 'pulse', duration: '2s', timing: 'cubic-bezier(0.4, 0, 0.6, 1)' },
  'animate-bounce': { name: 'bounce', duration: '1s', timing: 'cubic-bezier(0, 0, 0.2, 1)' }
};

const TAILWIND_TRACKING: Record<string, string> = {
  'tracking-tight': '-0.025em',
  'tracking-normal': '0em',
  'tracking-wide': '0.025em',
  'tracking-wider': '0.05em'
};

interface StyleComputerOptions {
  readonly parsed?: ParsedCss | undefined;
  readonly context?: CssNodeContext | undefined;
  readonly viewportWidth?: number | undefined;
}

/** Parse un raccourci `transition` (première transition listée). */
function parseTransitionShorthand(value: string): { property?: string; duration?: string; timing?: string } {
  const first = value.split(',')[0]?.trim() ?? '';
  let property: string | undefined;
  let duration: string | undefined;
  let timing: string | undefined;
  let delaySeen = false;
  for (const token of first.split(/\s+/).filter(Boolean)) {
    if (/^-?\d*\.?\d+m?s$/i.test(token)) {
      if (!duration) duration = token;
      else delaySeen = true;
    } else if (/^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i.test(token) || /^(cubic-bezier|steps)\(/.test(token)) {
      if (!timing) timing = token;
    } else if (!property) {
      property = token;
    }
  }
  void delaySeen;
  return {
    ...(property ? { property } : {}),
    ...(duration ? { duration } : {}),
    ...(timing ? { timing } : {})
  };
}

/** Parse un raccourci `animation` (première animation listée). */
function parseAnimationShorthand(value: string): { name?: string; duration?: string; timing?: string } {
  const first = value.split(',')[0]?.trim() ?? '';
  let name: string | undefined;
  let duration: string | undefined;
  let timing: string | undefined;
  const keywords = new Set([
    'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards', 'backwards',
    'both', 'none', 'running', 'paused', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear'
  ]);
  for (const token of first.split(/\s+/).filter(Boolean)) {
    if (/^-?\d*\.?\d+m?s$/i.test(token)) {
      if (!duration) duration = token;
    } else if (/^(cubic-bezier|steps)\(/.test(token) || /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i.test(token)) {
      if (!timing) timing = token;
    } else if (/^\d/.test(token)) {
      // durée itération / nombre — ignoré
    } else if (!keywords.has(token.toLowerCase()) && !name) {
      name = token;
    }
  }
  return {
    ...(name ? { name } : {}),
    ...(duration ? { duration } : {}),
    ...(timing ? { timing } : {})
  };
}

export class StyleComputer {
  public computeNodeStyles(
    node: NormalizedDomNode,
    customCss = '',
    viewportWidth?: number | undefined,
    options?: { useProvidedStyles?: boolean } | undefined
  ): {
    updatedNode: NormalizedDomNode;
    colors: readonly string[];
    fonts: readonly string[];
  } {
    const extractedColors = new Set<string>();
    const extractedFonts = new Set<string>();
    // CDC V8 Lot A — un DOM runtime porte déjà les styles CALCULÉS par le
    // navigateur : les recalculer depuis le CSS/les classes jetait les styles
    // inline et les valeurs réelles (mesuré : h1 40px → 16px). Ils font foi.
    const useProvidedStyles = options?.useProvidedStyles === true;
    const isTransparent = (value: string): boolean =>
      value === '' || value === 'transparent' || value === 'inherit' || /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(value);
    const parsed = parseCss(customCss);

    const resolveRecursive = (
      n: NormalizedDomNode,
      ancestors: readonly CssNodeContext[],
      parentStyles?: ComputedStyleSnapshot,
      inheritedExplicit?: { color: boolean; fontFamily: boolean }
    ): NormalizedDomNode => {
      // É45 P5 (F1) — distinguer les valeurs explicitement fournies (inline,
      // classes, CSS) — et leurs héritages — des valeurs synthétiques par
      // défaut : sans cela, la couleur/police par défaut du nœud racine était
      // comptée comme une observation réelle dans les palettes extraites.
      const explicit = new Set<string>();
      const context: CssNodeContext = {
        tagName: n.tagName,
        id: n.id,
        classes: n.classes,
        ancestors
      };
      let styles: ComputedStyleSnapshot;
      if (useProvidedStyles) {
        styles = { ...DEFAULT_COMPUTED_STYLE, ...n.styles };
        // Explicite = valeur qui DIVERGE de l'héritage (ou racine) : évite de
        // compter dix fois la même couleur/police héritée dans la palette.
        if (!parentStyles || styles.color !== parentStyles.color) explicit.add('color');
        if (!parentStyles || styles.fontFamily !== parentStyles.fontFamily) explicit.add('fontFamily');
      } else {
        styles = this.resolveStylesForClasses(
          n.classes,
          n.attributes['style'],
          customCss,
          n.id,
          n.tagName,
          parentStyles,
          explicit,
          { parsed, context, viewportWidth }
        );
      }
      const colorExplicit = inheritedExplicit?.color === true || explicit.has('color');
      const fontExplicit = inheritedExplicit?.fontFamily === true || explicit.has('fontFamily');

      if (colorExplicit && styles.color && !isTransparent(styles.color)) {
        extractedColors.add(canonicalizeColor(styles.color));
      }
      if (styles.backgroundColor && (useProvidedStyles ? !isTransparent(styles.backgroundColor) : styles.backgroundColor !== 'transparent' && styles.backgroundColor !== 'inherit')) {
        extractedColors.add(canonicalizeColor(styles.backgroundColor));
      }
      if (
        styles.borderColor &&
        !isTransparent(styles.borderColor) &&
        (useProvidedStyles ? (parseFloat(styles.borderWidth) || 0) > 0 : true)
      ) {
        extractedColors.add(canonicalizeColor(styles.borderColor));
      }
      if (fontExplicit && styles.fontFamily) {
        extractedFonts.add(styles.fontFamily);
      }

      const childContext: CssNodeContext = { tagName: n.tagName, id: n.id, classes: n.classes, ancestors: [] };
      const nextAncestors: readonly CssNodeContext[] = [childContext, ...ancestors];
      const children = n.children.map((child) =>
        resolveRecursive(child, nextAncestors, styles, { color: colorExplicit, fontFamily: fontExplicit })
      );
      return {
        ...n,
        styles,
        children
      };
    };

    const updatedNode = resolveRecursive(node, []);
    return {
      updatedNode,
      colors: Array.from(extractedColors).sort(),
      fonts: Array.from(extractedFonts).sort()
    };
  }

  public resolveStylesForClasses(
    classes: readonly string[],
    inlineStyle = '',
    customCss = '',
    nodeId = '',
    nodeTagName = '',
    parentStyles?: ComputedStyleSnapshot,
    explicit?: Set<string>,
    options?: StyleComputerOptions | undefined
  ): ComputedStyleSnapshot {
    let base = { ...DEFAULT_COMPUTED_STYLE };
    if (parentStyles) {
      base.color = parentStyles.color;
      base.fontFamily = parentStyles.fontFamily;
    }

    // 1. Process Tailwind classes
    for (const cls of classes) {
      if (TAILWIND_COLORS[cls]) {
        if (cls.startsWith('bg-')) {
          base = { ...base, backgroundColor: TAILWIND_COLORS[cls]! };
        } else if (cls.startsWith('text-')) {
          base = { ...base, color: TAILWIND_COLORS[cls]! };
          explicit?.add('color');
        } else if (cls.startsWith('border-')) {
          base = { ...base, borderColor: TAILWIND_COLORS[cls]!, borderWidth: '1px' };
        }
      }

      // Arbitrary Tailwind color: bg-[#123456] or text-[#abc]
      const arbitraryBg = cls.match(/^bg-\[#([0-9a-fA-F]{3,8})\]$/);
      if (arbitraryBg && arbitraryBg[1]) {
        base = { ...base, backgroundColor: canonicalizeColor(`#${arbitraryBg[1]}`) };
      }

      const arbitraryText = cls.match(/^text-\[#([0-9a-fA-F]{3,8})\]$/);
      if (arbitraryText && arbitraryText[1]) {
        base = { ...base, color: canonicalizeColor(`#${arbitraryText[1]}`) };
        explicit?.add('color');
      }

      // Arbitrary Tailwind length for text size: text-[18px]
      const arbitraryTextSize = cls.match(/^text-\[(-?\d*\.?\d+(?:px|rem|em))\]$/);
      if (arbitraryTextSize && arbitraryTextSize[1]) {
        base = { ...base, fontSize: arbitraryTextSize[1] };
      }

      // Spacing
      if (TAILWIND_SPACING[cls]) {
        if (cls.startsWith('p-')) {
          base = { ...base, padding: TAILWIND_SPACING[cls]! };
        } else if (cls.startsWith('m-')) {
          base = { ...base, margin: TAILWIND_SPACING[cls]! };
        } else if (cls.startsWith('gap-')) {
          base = { ...base, gap: TAILWIND_SPACING[cls]! };
        }
      }

      // Arbitrary Tailwind spacing: p-[16px], gap-[24px], m-[8px]
      const arbitrarySpacing = cls.match(/^(p[trblxy]?|m[trblxy]?|gap)-\[(-?\d*\.?\d+(?:px|rem|em))\]$/);
      if (arbitrarySpacing && arbitrarySpacing[1] && arbitrarySpacing[2]) {
        if (arbitrarySpacing[1].startsWith('p')) base = { ...base, padding: arbitrarySpacing[2] };
        else if (arbitrarySpacing[1].startsWith('m')) base = { ...base, margin: arbitrarySpacing[2] };
        else base = { ...base, gap: arbitrarySpacing[2] };
      }

      // Radius
      if (TAILWIND_RADIUS[cls]) {
        base = { ...base, borderRadius: TAILWIND_RADIUS[cls]! };
      }
      const arbitraryRadius = cls.match(/^rounded(?:-[trbl]{1,2})?-\[(-?\d*\.?\d+(?:px|rem|em))\]$/);
      if (arbitraryRadius && arbitraryRadius[1]) {
        base = { ...base, borderRadius: arbitraryRadius[1] };
      }

      // Display & Flex
      if (cls === 'flex') {
        base = { ...base, display: 'flex' };
      } else if (cls === 'grid') {
        base = { ...base, display: 'grid' };
      } else if (cls === 'hidden') {
        base = { ...base, display: 'none', opacity: 0 };
      } else if (cls === 'inline-block') {
        base = { ...base, display: 'inline-block' };
      }

      if (cls === 'flex-col') {
        base = { ...base, flexDirection: 'column' };
      }
      if (cls === 'items-center') {
        base = { ...base, alignItems: 'center' };
      }
      if (cls === 'justify-between') {
        base = { ...base, justifyContent: 'space-between' };
      } else if (cls === 'justify-center') {
        base = { ...base, justifyContent: 'center' };
      }

      // Typography
      if (cls === 'font-bold') {
        base = { ...base, fontWeight: '700' };
      } else if (cls === 'font-semibold') {
        base = { ...base, fontWeight: '600' };
      } else if (cls === 'font-medium') {
        base = { ...base, fontWeight: '500' };
      } else if (cls === 'font-mono') {
        base = { ...base, fontFamily: 'monospace' };
        explicit?.add('fontFamily');
      }

      if (cls === 'text-xs') {
        base = { ...base, fontSize: '12px', lineHeight: '16px' };
      } else if (cls === 'text-sm') {
        base = { ...base, fontSize: '14px', lineHeight: '20px' };
      } else if (cls === 'text-base') {
        base = { ...base, fontSize: '16px', lineHeight: '24px' };
      } else if (cls === 'text-lg') {
        base = { ...base, fontSize: '18px', lineHeight: '28px' };
      } else if (cls === 'text-xl') {
        base = { ...base, fontSize: '20px', lineHeight: '28px' };
      } else if (cls === 'text-2xl') {
        base = { ...base, fontSize: '24px', lineHeight: '32px' };
      } else if (cls === 'text-3xl') {
        base = { ...base, fontSize: '30px', lineHeight: '36px' };
      } else if (cls === 'text-4xl') {
        base = { ...base, fontSize: '36px', lineHeight: '40px' };
      }

      if (TAILWIND_TRACKING[cls]) {
        base = { ...base, letterSpacing: TAILWIND_TRACKING[cls]! };
      }

      // Shadows
      if (cls === 'shadow-sm') {
        base = { ...base, boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' };
      } else if (cls === 'shadow-md') {
        base = { ...base, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' };
      } else if (cls === 'shadow-lg' || cls === 'shadow-2xl') {
        base = { ...base, boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' };
      }

      // CDC V8 §7.7 — layout
      if (TAILWIND_MAX_WIDTH[cls]) {
        base = { ...base, maxWidth: TAILWIND_MAX_WIDTH[cls]! };
      }
      const arbitraryMaxWidth = cls.match(/^max-w-\[(-?\d*\.?\d+(?:px|rem|em|%))\]$/);
      if (arbitraryMaxWidth && arbitraryMaxWidth[1]) {
        base = { ...base, maxWidth: arbitraryMaxWidth[1] };
      }
      const gridCols = /^grid-cols-(\d{1,2})$/.exec(cls);
      if (gridCols && gridCols[1]) {
        const n = parseInt(gridCols[1], 10);
        if (n >= 1 && n <= 12) base = { ...base, gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
      }
      const arbitraryGridCols = cls.match(/^grid-cols-\[([^\]]+)\]$/);
      if (arbitraryGridCols && arbitraryGridCols[1]) {
        base = { ...base, gridTemplateColumns: arbitraryGridCols[1].replace(/_/g, ' ') };
      }

      // CDC V8 §7.6 — motion
      if (TAILWIND_DURATION[cls]) {
        base = { ...base, transitionDuration: TAILWIND_DURATION[cls]! };
      }
      const arbitraryDuration = cls.match(/^duration-\[(-?\d*\.?\d+(?:ms|s))\]$/);
      if (arbitraryDuration && arbitraryDuration[1]) {
        base = { ...base, transitionDuration: arbitraryDuration[1] };
      }
      if (TAILWIND_EASING[cls]) {
        base = { ...base, transitionTimingFunction: TAILWIND_EASING[cls]! };
      }
      if (TAILWIND_TRANSITION_PROPERTIES[cls]) {
        base = {
          ...base,
          transitionProperty: TAILWIND_TRANSITION_PROPERTIES[cls]!,
          transitionDuration: base.transitionDuration ?? '150ms',
          transitionTimingFunction: base.transitionTimingFunction ?? 'cubic-bezier(0.4, 0, 0.2, 1)'
        };
      }
      if (TAILWIND_ANIMATION[cls]) {
        const anim = TAILWIND_ANIMATION[cls]!;
        base = {
          ...base,
          animationName: anim.name,
          animationDuration: anim.duration,
          animationTimingFunction: anim.timing
        };
      }
    }

    // 2. Process Custom CSS rules if present (base ET media filtrées par
    //    viewport ; les états :hover/:focus restent hors styles de base).
    const parsed = options?.parsed ?? (customCss ? parseCss(customCss) : undefined);
    if (parsed && options?.context) {
      for (const rule of parsed.rules) {
        if (rule.hover || rule.focus) continue;
        if (!ruleMatchesViewport(rule, options.viewportWidth)) continue;
        if (!matchesCssSelector(rule.selector, options.context)) continue;
        for (const decl of rule.declarations) {
          base = this.applyDeclaration(base, decl.property, decl.value, explicit, parsed.variables);
        }
      }
    } else if (parsed && (nodeId || nodeTagName || classes.length > 0)) {
      // Repli historique (sans contexte) : id/tag/classes simples uniquement.
      const legacyContext: CssNodeContext = {
        tagName: nodeTagName,
        id: nodeId,
        classes,
        ancestors: []
      };
      for (const rule of parsed.rules) {
        if (rule.hover || rule.focus) continue;
        if (!ruleMatchesViewport(rule, options?.viewportWidth)) continue;
        if (!matchesCssSelector(rule.selector, legacyContext)) continue;
        for (const decl of rule.declarations) {
          base = this.applyDeclaration(base, decl.property, decl.value, explicit, parsed.variables);
        }
      }
    }

    // 3. Process inline styles if present (highest precedence)
    if (inlineStyle) {
      const variables = parsed?.variables ?? {};
      for (const part of inlineStyle.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const colon = trimmed.indexOf(':');
        if (colon <= 0) continue;
        const property = trimmed.slice(0, colon).trim().toLowerCase();
        const value = trimmed.slice(colon + 1).trim();
        if (property && value) {
          base = this.applyDeclaration(base, property, value, explicit, variables);
        }
      }
    }

    return base;
  }

  /**
   * Applique UNE déclaration sur le snapshot de style. Retourne le style
   * inchangé si la propriété n'est pas gérée (jamais de valeur inventée).
   */
  private applyDeclaration(
    base: ComputedStyleSnapshot,
    rawProperty: string,
    rawValue: string,
    explicit?: Set<string>,
    variables?: Readonly<Record<string, string>>
  ): ComputedStyleSnapshot {
    let updated = { ...base };
    const property = rawProperty.trim().toLowerCase();
    if (!property) return updated;
    let value = variables ? resolveCssVariables(rawValue, variables) : rawValue;
    value = value.trim();
    if (!value || value.includes('var(')) return updated;

    switch (property) {
      case 'color':
        updated = { ...updated, color: canonicalizeColor(value) };
        explicit?.add('color');
        break;
      case 'background-color':
      case 'background':
        updated = { ...updated, backgroundColor: canonicalizeColor(value) };
        break;
      case 'border-color':
        updated = { ...updated, borderColor: canonicalizeColor(value) };
        break;
      case 'border-width':
        updated = { ...updated, borderWidth: value };
        break;
      case 'border':
        // `border: 1px solid #ddd` — on garde l'épaisseur et la couleur.
        {
          const parts = value.split(/\s+/);
          const width = parts.find((p) => /^-?\d*\.?\d+/.test(p));
          const color = parts.find((p) => /^#|^rgb|^hsl|^var\(/i.test(p));
          if (width) updated = { ...updated, borderWidth: width };
          if (color) updated = { ...updated, borderColor: canonicalizeColor(color) };
        }
        break;
      case 'padding':
        updated = { ...updated, padding: value };
        break;
      case 'margin':
        updated = { ...updated, margin: value };
        break;
      case 'gap':
        updated = { ...updated, gap: value.split(/\s+/)[0] ?? value };
        break;
      case 'column-gap':
        updated = { ...updated, columnGap: value };
        break;
      case 'row-gap':
        updated = { ...updated, rowGap: value };
        break;
      case 'border-radius':
        updated = { ...updated, borderRadius: value };
        break;
      case 'box-shadow':
        updated = { ...updated, boxShadow: value };
        break;
      case 'font-size':
        updated = { ...updated, fontSize: value };
        break;
      case 'font-weight':
        updated = { ...updated, fontWeight: value };
        break;
      case 'font-family':
        updated = { ...updated, fontFamily: value };
        explicit?.add('fontFamily');
        break;
      case 'line-height':
        updated = { ...updated, lineHeight: value };
        break;
      case 'letter-spacing':
        updated = { ...updated, letterSpacing: value };
        break;
      case 'display':
        updated = { ...updated, display: value };
        break;
      case 'flex-direction':
        updated = { ...updated, flexDirection: value };
        break;
      case 'justify-content':
        updated = { ...updated, justifyContent: value };
        break;
      case 'align-items':
        updated = { ...updated, alignItems: value };
        break;
      case 'opacity': {
        const parsed = parseFloat(value);
        if (Number.isFinite(parsed)) {
          updated = { ...updated, opacity: Math.max(0, Math.min(1, parsed)) };
        }
        break;
      }
      case 'z-index': {
        const parsed = parseInt(value, 10);
        if (Number.isFinite(parsed)) updated = { ...updated, zIndex: parsed };
        break;
      }
      // CDC V8 §7.6 — motion
      case 'transition': {
        const t = parseTransitionShorthand(value);
        updated = {
          ...updated,
          ...(t.property ? { transitionProperty: t.property } : {}),
          ...(t.duration ? { transitionDuration: t.duration } : {}),
          ...(t.timing ? { transitionTimingFunction: t.timing } : {})
        };
        break;
      }
      case 'transition-property':
        updated = { ...updated, transitionProperty: value };
        break;
      case 'transition-duration':
        updated = { ...updated, transitionDuration: value };
        break;
      case 'transition-timing-function':
        updated = { ...updated, transitionTimingFunction: value };
        break;
      case 'animation': {
        const a = parseAnimationShorthand(value);
        updated = {
          ...updated,
          ...(a.name ? { animationName: a.name } : {}),
          ...(a.duration ? { animationDuration: a.duration } : {}),
          ...(a.timing ? { animationTimingFunction: a.timing } : {})
        };
        break;
      }
      case 'animation-name':
        updated = { ...updated, animationName: value };
        break;
      case 'animation-duration':
        updated = { ...updated, animationDuration: value };
        break;
      case 'animation-timing-function':
        updated = { ...updated, animationTimingFunction: value };
        break;
      // CDC V8 §7.7 — layout
      case 'max-width':
        updated = { ...updated, maxWidth: value };
        break;
      case 'grid-template-columns':
        updated = { ...updated, gridTemplateColumns: value };
        break;
      default:
        break;
    }
    return updated;
  }
}
