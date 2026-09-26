/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Design System Inference Engine
 */

import { canonicalizeLength } from '../../visual-intelligence/canonical.js';
import type {
  NormalizedDomNode,
  VisualSnapshot
} from '../../visual-intelligence/types.js';
import { computeContrastRatio } from '../canonical.js';
import type {
  ColorRoleTokens,
  ElevationTokens,
  InferredDesignSystem,
  ShapeTokens,
  SpacingTokens,
  TypographyTokens
} from '../types.js';

export class TokenInferer {
  public inferDesignSystem(snapshots: readonly VisualSnapshot[]): InferredDesignSystem {
    const allNodes: NormalizedDomNode[] = [];
    const traverse = (n: NormalizedDomNode) => {
      allNodes.push(n);
      for (const child of n.children) {
        traverse(child);
      }
    };

    for (const snap of snapshots) {
      traverse(snap.rootNode);
    }

    const colorTokens = this.inferColorTokens(allNodes);
    const typographyTokens = this.inferTypographyTokens(allNodes);
    const spacingTokens = this.inferSpacingTokens(allNodes);
    const shapeTokens = this.inferShapeTokens(allNodes);
    const elevationTokens = this.inferElevationTokens(allNodes);

    const evidenceCount = allNodes.length;
    const systemConfidence = Math.min(
      1,
      Math.max(0.5, 0.5 + (evidenceCount > 20 ? 0.3 : 0.1) + spacingTokens.regularityRatio * 0.2)
    );

    return {
      colorTokens,
      typographyTokens,
      spacingTokens,
      shapeTokens,
      elevationTokens,
      systemConfidence: Math.round(systemConfidence * 100) / 100,
      evidenceCount
    };
  }

  private inferColorTokens(nodes: readonly NormalizedDomNode[]): ColorRoleTokens {
    const bgFreq = new Map<string, number>();
    const containerBgFreq = new Map<string, number>();
    const textFreq = new Map<string, number>();
    const borderFreq = new Map<string, number>();
    const buttonBgFreq = new Map<string, number>();

    for (const n of nodes) {
      const bg = n.styles.backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'inherit') {
        bgFreq.set(bg, (bgFreq.get(bg) ?? 0) + 1);
        if (n.role === 'BUTTON') {
          buttonBgFreq.set(bg, (buttonBgFreq.get(bg) ?? 0) + 1);
        } else {
          containerBgFreq.set(bg, (containerBgFreq.get(bg) ?? 0) + 1);
        }
      }

      const col = n.styles.color;
      if (col && col !== 'transparent' && col !== 'inherit') {
        textFreq.set(col, (textFreq.get(col) ?? 0) + 1);
      }

      const bCol = n.styles.borderColor;
      if (bCol && bCol !== 'transparent') {
        borderFreq.set(bCol, (borderFreq.get(bCol) ?? 0) + 1);
      }
    }

    const getMode = (map: Map<string, number>): string | undefined => {
      let best: string | undefined = undefined;
      let max = 0;
      for (const [key, count] of map.entries()) {
        if (count > max) {
          max = count;
          best = key;
        }
      }
      return best;
    };

    // Primary brand: most frequent button background, or most frequent non-gray/black/white text/bg
    let primary = getMode(buttonBgFreq);
    if (!primary) {
      for (const [col] of textFreq.entries()) {
        if (!['#ffffff', '#000000', '#111827', '#0f172a', '#f9fafb'].includes(col)) {
          primary = col;
          break;
        }
      }
    }

    // Background: most frequent container/page bg (excluding buttons)
    const background = getMode(containerBgFreq) ?? getMode(bgFreq) ?? '#ffffff';

    // Surface: second most frequent bg, or card bg
    let surface: string | undefined = undefined;
    for (const [col] of containerBgFreq.entries()) {
      if (col !== background) {
        surface = col;
        break;
      }
    }

    // Foreground text: most frequent color with contrast >= 4.5 on background (or fallback)
    let foreground: string | undefined = undefined;
    let maxFgCount = 0;
    for (const [col, count] of textFreq.entries()) {
      if (computeContrastRatio(col, background) >= 4.5 && count > maxFgCount) {
        maxFgCount = count;
        foreground = col;
      }
    }
    foreground = foreground ?? getMode(textFreq) ?? '#111827';

    // Muted text
    let muted: string | undefined = undefined;
    for (const [col] of textFreq.entries()) {
      if (col !== foreground) {
        muted = col;
        break;
      }
    }

    const border = getMode(borderFreq);

    return {
      primary,
      background,
      surface: surface ?? background,
      foreground,
      muted: muted ?? '#64748b',
      border
    };
  }

  private inferTypographyTokens(nodes: readonly NormalizedDomNode[]): TypographyTokens {
    const fontFreq = new Map<string, number>();
    const sizeFreq = new Map<string, number>();
    let totalLineHeightRatio = 0;
    let ratioCount = 0;

    for (const n of nodes) {
      const font = n.styles.fontFamily;
      if (font) fontFreq.set(font, (fontFreq.get(font) ?? 0) + 1);

      const size = n.styles.fontSize;
      if (size) sizeFreq.set(size, (sizeFreq.get(size) ?? 0) + 1);

      const sizePx = canonicalizeLength(n.styles.fontSize);
      const lhPx = canonicalizeLength(n.styles.lineHeight);
      if (sizePx > 0 && lhPx > 0) {
        totalLineHeightRatio += lhPx / sizePx;
        ratioCount++;
      }
    }

    let primaryFontFamily = 'sans-serif';
    let maxFontCount = 0;
    for (const [font, count] of fontFreq.entries()) {
      if (count > maxFontCount) {
        maxFontCount = count;
        primaryFontFamily = font;
      }
    }

    const detectedScale = Array.from(sizeFreq.keys()).sort((a, b) => {
      return canonicalizeLength(a) - canonicalizeLength(b);
    });

    const dominantLineHeightRatio = ratioCount > 0 ? Math.round((totalLineHeightRatio / ratioCount) * 100) / 100 : 1.5;

    return {
      primaryFontFamily,
      fontFamilies: Array.from(fontFreq.keys()),
      detectedScale,
      dominantLineHeightRatio
    };
  }

  private inferSpacingTokens(nodes: readonly NormalizedDomNode[]): SpacingTokens {
    const valuesInPx = new Set<number>();
    const rawValues: number[] = [];

    for (const n of nodes) {
      const p = canonicalizeLength(n.styles.padding);
      const m = canonicalizeLength(n.styles.margin);
      const g = canonicalizeLength(n.styles.gap);

      if (p > 0) {
        valuesInPx.add(p);
        rawValues.push(p);
      }
      if (m > 0) {
        valuesInPx.add(m);
        rawValues.push(m);
      }
      if (g > 0) {
        valuesInPx.add(g);
        rawValues.push(g);
      }
    }

    const detectedScale = Array.from(valuesInPx).sort((a, b) => a - b);

    // Test standard bases: 8px vs 4px
    let m8Count = 0;
    let m4Count = 0;
    for (const val of rawValues) {
      if (val % 8 === 0) m8Count++;
      if (val % 4 === 0) m4Count++;
    }

    const total = rawValues.length || 1;
    let baseGridStep = 4;
    let regularityRatio = m4Count / total;

    if (m8Count / total >= 0.7) {
      baseGridStep = 8;
      regularityRatio = m8Count / total;
    }

    return {
      baseGridStep,
      detectedScale,
      regularityRatio: Math.round(regularityRatio * 100) / 100
    };
  }

  private inferShapeTokens(nodes: readonly NormalizedDomNode[]): ShapeTokens {
    const btnRadii = new Map<string, number>();
    const cardRadii = new Map<string, number>();
    const inputRadii = new Map<string, number>();
    const allRadii = new Set<string>();

    for (const n of nodes) {
      const r = n.styles.borderRadius;
      if (r && r !== '0px' && r !== '0') {
        allRadii.add(r);
        if (n.role === 'BUTTON') btnRadii.set(r, (btnRadii.get(r) ?? 0) + 1);
        if (n.role === 'CARD') cardRadii.set(r, (cardRadii.get(r) ?? 0) + 1);
        if (n.role === 'INPUT') inputRadii.set(r, (inputRadii.get(r) ?? 0) + 1);
      }
    }

    const getMode = (map: Map<string, number>, fallback = '4px'): string => {
      let best = fallback;
      let max = 0;
      for (const [k, count] of map.entries()) {
        if (count > max) {
          max = count;
          best = k;
        }
      }
      return best;
    };

    return {
      primaryButtonRadius: getMode(btnRadii, '6px'),
      primaryCardRadius: getMode(cardRadii, '8px'),
      primaryInputRadius: getMode(inputRadii, '6px'),
      detectedRadii: Array.from(allRadii).sort()
    };
  }

  private inferElevationTokens(nodes: readonly NormalizedDomNode[]): ElevationTokens {
    const shadows = new Set<string>();
    for (const n of nodes) {
      const s = n.styles.boxShadow;
      if (s && s !== 'none') {
        shadows.add(s);
      }
    }

    return {
      detectedLevelsCount: shadows.size,
      shadowLevels: Array.from(shadows)
    };
  }
}
