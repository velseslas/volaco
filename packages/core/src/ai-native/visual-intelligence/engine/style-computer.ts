/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-011)
 * Style Computer & Design Value Extractor
 */

import { canonicalizeColor } from '../canonical.js';
import type { ComputedStyleSnapshot, NormalizedDomNode } from '../types.js';
import { DEFAULT_COMPUTED_STYLE } from './dom-normalizer.js';

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
  'm-auto': 'auto'
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

export class StyleComputer {
  public computeNodeStyles(
    node: NormalizedDomNode,
    customCss = ''
  ): {
    updatedNode: NormalizedDomNode;
    colors: readonly string[];
    fonts: readonly string[];
  } {
    const extractedColors = new Set<string>();
    const extractedFonts = new Set<string>();

    const resolveRecursive = (
      n: NormalizedDomNode,
      parentStyles?: ComputedStyleSnapshot,
      inheritedExplicit?: { color: boolean; fontFamily: boolean }
    ): NormalizedDomNode => {
      // É45 P5 (F1) — distinguer les valeurs explicitement fournies (inline,
      // classes, CSS) — et leurs héritages — des valeurs synthétiques par
      // défaut : sans cela, la couleur/police par défaut du nœud racine était
      // comptée comme une observation réelle dans les palettes extraites.
      const explicit = new Set<string>();
      const styles = this.resolveStylesForClasses(
        n.classes,
        n.attributes['style'],
        customCss,
        n.id,
        n.tagName,
        parentStyles,
        explicit
      );
      const colorExplicit = inheritedExplicit?.color === true || explicit.has('color');
      const fontExplicit = inheritedExplicit?.fontFamily === true || explicit.has('fontFamily');

      if (colorExplicit && styles.color && styles.color !== 'transparent' && styles.color !== 'inherit') {
        extractedColors.add(canonicalizeColor(styles.color));
      }
      if (styles.backgroundColor && styles.backgroundColor !== 'transparent' && styles.backgroundColor !== 'inherit') {
        extractedColors.add(canonicalizeColor(styles.backgroundColor));
      }
      if (styles.borderColor && styles.borderColor !== 'transparent') {
        extractedColors.add(canonicalizeColor(styles.borderColor));
      }
      if (fontExplicit && styles.fontFamily) {
        extractedFonts.add(styles.fontFamily);
      }

      const children = n.children.map((child) =>
        resolveRecursive(child, styles, { color: colorExplicit, fontFamily: fontExplicit })
      );
      return {
        ...n,
        styles,
        children
      };
    };

    const updatedNode = resolveRecursive(node);
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
    explicit?: Set<string>
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

      // Spacing
      if (TAILWIND_SPACING[cls]) {
        if (cls.startsWith('p-')) {
          base = { ...base, padding: TAILWIND_SPACING[cls]! };
        } else if (cls.startsWith('m-')) {
          base = { ...base, margin: TAILWIND_SPACING[cls]! };
        }
      }

      // Radius
      if (TAILWIND_RADIUS[cls]) {
        base = { ...base, borderRadius: TAILWIND_RADIUS[cls]! };
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
      } else if (cls === 'text-lg') {
        base = { ...base, fontSize: '18px', lineHeight: '28px' };
      } else if (cls === 'text-xl') {
        base = { ...base, fontSize: '20px', lineHeight: '28px' };
      } else if (cls === 'text-2xl') {
        base = { ...base, fontSize: '24px', lineHeight: '32px' };
      }

      // Shadows
      if (cls === 'shadow-sm') {
        base = { ...base, boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' };
      } else if (cls === 'shadow-md') {
        base = { ...base, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' };
      } else if (cls === 'shadow-lg' || cls === 'shadow-2xl') {
        base = { ...base, boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' };
      }
    }

    // 2. Process Custom CSS rules if present
    if (customCss) {
      const rules = customCss.match(/([^{]+)\{([^}]+)\}/g);
      if (rules) {
        for (const rule of rules) {
          const match = rule.match(/([^{]+)\{([^}]+)\}/);
          if (!match) continue;
          const selector = match[1]?.trim().toLowerCase();
          const body = match[2]?.trim();
          if (!selector || !body) continue;

          const isIdMatch = Boolean(nodeId && selector === `#${nodeId.toLowerCase()}`);
          const isTagMatch = Boolean(nodeTagName && selector === nodeTagName.toLowerCase());
          const isClassMatch = classes.some((c) => selector === `.${c.toLowerCase()}`);

          if (isIdMatch || isTagMatch || isClassMatch) {
            base = this.applyDeclarations(base, body, explicit);
          }
        }
      }
    }

    // 3. Process inline styles if present (highest precedence)
    if (inlineStyle) {
      base = this.applyDeclarations(base, inlineStyle, explicit);
    }

    return base;
  }

  private applyDeclarations(
    base: ComputedStyleSnapshot,
    declarationsStr: string,
    explicit?: Set<string>
  ): ComputedStyleSnapshot {
    let updated = { ...base };
    const parts = declarationsStr.split(';').map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const [prop, val] = p.split(':').map((s) => s.trim());
      if (prop && val) {
        if (prop === 'color') {
          updated = { ...updated, color: canonicalizeColor(val) };
          explicit?.add('color');
        }
        if (prop === 'background-color' || prop === 'background') updated = { ...updated, backgroundColor: canonicalizeColor(val) };
        if (prop === 'border-color') updated = { ...updated, borderColor: canonicalizeColor(val) };
        if (prop === 'padding') updated = { ...updated, padding: val };
        if (prop === 'margin') updated = { ...updated, margin: val };
        if (prop === 'border-radius') updated = { ...updated, borderRadius: val };
        if (prop === 'font-size') updated = { ...updated, fontSize: val };
        if (prop === 'font-weight') updated = { ...updated, fontWeight: val };
        if (prop === 'font-family') {
          updated = { ...updated, fontFamily: val };
          explicit?.add('fontFamily');
        }
        if (prop === 'display') updated = { ...updated, display: val };
        if (prop === 'opacity') {
          const parsed = parseFloat(val);
          if (Number.isFinite(parsed)) {
            updated = { ...updated, opacity: Math.max(0, Math.min(1, parsed)) };
          }
        }
      }
    }
    return updated;
  }
}
