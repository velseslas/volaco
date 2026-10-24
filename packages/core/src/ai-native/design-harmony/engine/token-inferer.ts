/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Design System Inference Engine
 *
 * CDC V8 §7 — tokens explicites : couleurs (rôles + états), typographie
 * (échelle de rôles, graisses, interlettrage), spacing, shapes (échelle
 * XS→XL), élévation (niveaux nommés), MOTION (§7.6) et LAYOUT (§7.7).
 *
 * Règle NO EVIDENCE → NO CLAIM : toute liste vide signifie « rien observé ».
 * Aucune durée, easing, breakpoint ou couleur de rôle n'est inventé.
 */

import { canonicalizeColor, canonicalizeLength } from '../../visual-intelligence/canonical.js';
import { parseCss } from '../../visual-intelligence/engine/css-parser.js';
import type {
  NormalizedDomNode,
  VisualSnapshot
} from '../../visual-intelligence/types.js';
import { computeContrastRatio } from '../canonical.js';
import type {
  ColorRoleTokens,
  ElevationLevelToken,
  ElevationTokens,
  InferredDesignSystem,
  LayoutTokens,
  MotionTokens,
  RadiusScale,
  ShapeTokens,
  SpacingTokens,
  TypographyStyleScale,
  TypographyTokens
} from '../types.js';

export interface TokenInferenceOptions {
  /**
   * CSS du document (<style> extraits) : uniquement utilisé pour les preuves
   * impossibles à lire sur les nœuds — breakpoints des @media, transitions
   * déclarées dans :hover, noms de @keyframes. Jamais pour fabriquer.
   */
  readonly cssContent?: string | undefined;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(color: string): Rgb | undefined {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return undefined;
  const value = m[1]!;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

/** Teinte/saturation/luminosité 0-360 / 0-1 / 0-1 — pour les rôles d'état. */
function hexToHsl(color: string): { h: number; s: number; l: number } | undefined {
  const rgb = parseHex(color);
  if (!rgb) return undefined;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return { h, s, l };
}

function isSaturated(color: string): boolean {
  const hsl = hexToHsl(color);
  return hsl !== undefined && hsl.s >= 0.35 && hsl.l > 0.2 && hsl.l < 0.8;
}

function inHueBand(color: string, min: number, max: number): boolean {
  const hsl = hexToHsl(color);
  // Garde-fou de LUMINOSITÉ : un quasi-blanc (#f8fafc) a une « saturation »
  // mathématique élevée mais n'est pas une couleur d'état.
  if (!hsl || hsl.s < 0.3 || hsl.l <= 0.15 || hsl.l >= 0.85) return false;
  if (min <= max) return hsl.h >= min && hsl.h <= max;
  return hsl.h >= min || hsl.h <= max; // bande qui traverse 0°
}

function shadowBlur(shadow: string): number | undefined {
  // La couleur est retirée AVANT d'extraire les longueurs : dans
  // « 0 12px 32px rgba(0,0,0,0.2) », le premier offset x = 0 est unitless.
  const withoutColor = shadow
    .replace(/rgba?\([^)]*\)/gi, ' ')
    .replace(/#[0-9a-fA-F]{3,8}/g, ' ')
    .replace(/\binset\b/gi, ' ')
    .trim();
  const lengths = withoutColor.match(/-?\d*\.?\d+(?:px|rem|em)?/g);
  if (!lengths || lengths.length < 3) return undefined;
  const blur = parseFloat(lengths[2]!);
  if (!Number.isFinite(blur)) return undefined;
  return Math.abs(blur);
}

const ENTRANCE_RE = /(in|enter|entrance|appear|show|reveal)$/i;
const EXIT_RE = /(out|exit|leave|disappear|hide|dismiss)$/i;
const FEEDBACK_HINTS = ['transform', 'scale', 'background', 'box-shadow', 'opacity', 'color', 'border', 'width', 'height'];

export class TokenInferer {
  public inferDesignSystem(
    snapshots: readonly VisualSnapshot[],
    options?: TokenInferenceOptions | undefined
  ): InferredDesignSystem {
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
    const motionTokens = this.inferMotionTokens(allNodes, options?.cssContent ?? '');
    const layoutTokens = this.inferLayoutTokens(allNodes, options?.cssContent ?? '');

    const evidenceCount = allNodes.length;
    let systemConfidence = Math.min(
      1,
      Math.max(0.5, 0.5 + (evidenceCount > 20 ? 0.3 : 0.1) + spacingTokens.regularityRatio * 0.2)
    );
    if (motionTokens.evidenceCount > 0) systemConfidence = Math.min(1, systemConfidence + 0.05);
    if (layoutTokens.evidenceCount > 0) systemConfidence = Math.min(1, systemConfidence + 0.05);

    return {
      colorTokens,
      typographyTokens,
      spacingTokens,
      shapeTokens,
      elevationTokens,
      motionTokens,
      layoutTokens,
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
      // Les styles runtime arrivent en rgb(...) : canonicalisation AVANT
      // comptage, sinon « rgb(37, 99, 235) » et « #2563eb » sont deux couleurs.
      const bg = canonicalizeColor(n.styles.backgroundColor);
      if (bg && bg !== 'transparent' && bg !== 'inherit') {
        bgFreq.set(bg, (bgFreq.get(bg) ?? 0) + 1);
        if (n.role === 'BUTTON') {
          buttonBgFreq.set(bg, (buttonBgFreq.get(bg) ?? 0) + 1);
        } else {
          containerBgFreq.set(bg, (containerBgFreq.get(bg) ?? 0) + 1);
        }
      }

      const col = canonicalizeColor(n.styles.color);
      if (col && col !== 'transparent' && col !== 'inherit') {
        textFreq.set(col, (textFreq.get(col) ?? 0) + 1);
      }

      const bCol = canonicalizeColor(n.styles.borderColor);
      if (bCol && bCol !== 'transparent' && canonicalizeLength(n.styles.borderWidth) > 0) {
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

    const sortedByCount = (map: Map<string, number>): string[] =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([color]) => color);

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

    // CDC V8 §7.1 — rôles secondaires et couleurs d'état : uniquement des
    // couleurs RÉELLEMENT présentes (boutons, palette extraite), classées par
    // teinte. Aucun rôle fabriqué : absent si aucune couleur ne correspond.
    const brandCandidates = [
      ...sortedByCount(buttonBgFreq),
      ...sortedByCount(bgFreq),
      ...sortedByCount(textFreq),
      ...sortedByCount(borderFreq)
    ].filter((color, index, arr) => arr.indexOf(color) === index);

    // États d'abord : une couleur d'état (vert de succès, rouge d'erreur…)
    // ne doit jamais être promue « couleur secondaire de marque ».
    const stateCandidates = [...new Set([...sortedByCount(bgFreq), ...sortedByCount(textFreq), ...sortedByCount(borderFreq)])];
    const findState = (min: number, max: number): string | undefined => stateCandidates.find((c) => inHueBand(c, min, max));
    const success = findState(80, 170);
    const warning = findState(25, 65);
    const error = findState(345, 15);
    const info = findState(180, 260);
    const stateColors = new Set([success, warning, error, info].filter((c): c is string => typeof c === 'string'));

    const secondary = brandCandidates.find((c) => c !== primary && c !== background && !stateColors.has(c) && isSaturated(c) && (primary === undefined || computeContrastRatio(c, primary) >= 1.2));
    const accent = brandCandidates.find((c) => c !== primary && c !== secondary && c !== background && !stateColors.has(c) && isSaturated(c));

    return {
      primary,
      secondary,
      accent,
      background,
      surface: surface ?? background,
      foreground,
      muted: muted ?? '#64748b',
      border,
      success,
      warning,
      error,
      info
    };
  }

  private inferTypographyTokens(nodes: readonly NormalizedDomNode[]): TypographyTokens {
    const fontFreq = new Map<string, number>();
    const sizeFreq = new Map<string, number>();
    const headingSizes: number[] = [];
    const bodySizes: number[] = [];
    const weights = new Set<string>();
    const spacings = new Set<string>();
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

      if (n.styles.fontWeight) weights.add(n.styles.fontWeight);
      const ls = n.styles.letterSpacing;
      if (ls && ls !== 'normal' && ls !== '0px' && ls !== '0') spacings.add(ls);

      if (n.role === 'HEADING' && sizePx > 0) headingSizes.push(sizePx);
      if (n.role === 'PARAGRAPH' && sizePx > 0) bodySizes.push(sizePx);
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

    // CDC V8 §7.2 — échelle de rôles depuis les tailles RÉELLEMENT observées.
    const styleScale = this.deriveStyleScale(detectedScale, headingSizes, bodySizes);

    return {
      primaryFontFamily,
      fontFamilies: Array.from(fontFreq.keys()),
      detectedScale,
      dominantLineHeightRatio,
      styleScale,
      fontWeights: Array.from(weights).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0)),
      letterSpacings: Array.from(spacings).sort()
    };
  }

  private deriveStyleScale(
    detectedScale: readonly string[],
    headingSizes: readonly number[],
    bodySizes: readonly number[]
  ): TypographyStyleScale {
    const sorted = [...detectedScale].sort((a, b) => canonicalizeLength(a) - canonicalizeLength(b));
    const n = sorted.length;
    const headings = [...new Set(headingSizes)].sort((a, b) => b - a);

    const at = (index: number): string | undefined => sorted[index];

    // Corps = taille la plus fréquente des paragraphes ; repli : médiane.
    let body: string | undefined;
    if (bodySizes.length > 0) {
      const counts = new Map<number, number>();
      for (const s of bodySizes) counts.set(s, (counts.get(s) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
      body = `${best[0]}px`;
    } else if (n > 0) {
      body = at(Math.floor((n - 1) / 2));
    }

    const headingToStr = (index: number): string | undefined =>
      headings[index] !== undefined ? `${headings[index]}px` : undefined;

    return {
      display: n >= 5 ? at(n - 1) : undefined,
      h1: headingToStr(0),
      h2: headingToStr(1),
      h3: headingToStr(2),
      body,
      small: n >= 2 ? at(1) : undefined,
      caption: n >= 1 ? at(0) : undefined
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

    // CDC V8 §7.4 — échelle XS→XL depuis les rayons réellement observés.
    const sortedRadii = Array.from(allRadii).sort((a, b) => canonicalizeLength(a) - canonicalizeLength(b));
    const radiusScale: RadiusScale = {};
    const pick = (index: number): string | undefined => sortedRadii[index];
    const scale = sortedRadii.length;

    return {
      primaryButtonRadius: getMode(btnRadii, '6px'),
      primaryCardRadius: getMode(cardRadii, '8px'),
      primaryInputRadius: getMode(inputRadii, '6px'),
      detectedRadii: Array.from(allRadii).sort(),
      radiusScale: {
        xs: pick(0),
        sm: scale >= 4 ? pick(1) : undefined,
        md: scale >= 3 ? pick(Math.floor((scale - 1) / 2)) : undefined,
        lg: scale >= 4 ? pick(scale - 2) : undefined,
        xl: scale >= 2 ? pick(scale - 1) : undefined
      }
    };
  }

  private inferElevationTokens(nodes: readonly NormalizedDomNode[]): ElevationTokens {
    const shadows = new Set<string>();
    let sawNone = false;
    for (const n of nodes) {
      const s = n.styles.boxShadow;
      if (s && s !== 'none') {
        shadows.add(s);
      } else {
        sawNone = true;
      }
    }

    // CDC V8 §7.5 — niveaux nommés depuis le rayon de flou réel.
    const levels: ElevationLevelToken[] = [];
    if (sawNone) levels.push({ level: 'NONE', value: 'none' });
    const classified = Array.from(shadows)
      .map((shadow) => ({ shadow, blur: shadowBlur(shadow) }))
      .sort((a, b) => (a.blur ?? 0) - (b.blur ?? 0));
    for (const { shadow, blur } of classified) {
      const level = blur === undefined || blur <= 4 ? 'SUBTLE' : blur <= 16 ? 'MEDIUM' : 'STRONG';
      if (!levels.some((l) => l.level === level)) {
        levels.push({ level, value: shadow });
      }
    }

    return {
      detectedLevelsCount: shadows.size,
      shadowLevels: Array.from(shadows),
      levels
    };
  }

  /**
   * CDC V8 §7.6 — Motion tokens : durées/easings/transitions des styles
   * calculés réels + compléments documentaires (règles :hover, @keyframes).
   * Les valeurs par défaut du navigateur (0s/ease sur transitionProperty
   * 'all' sans durée) ne sont PAS comptées comme preuves.
   */
  private inferMotionTokens(nodes: readonly NormalizedDomNode[], cssContent: string): MotionTokens {
    const durations = new Set<string>();
    const easings = new Set<string>();
    const transitions = new Set<string>();
    const hover = new Set<string>();
    const feedback = new Set<string>();
    const entrance = new Set<string>();
    const exit = new Set<string>();

    const activeDuration = (d: string | undefined): boolean =>
      d !== undefined && d.trim() !== '' && !/^0(?:ms|s)?$/i.test(d.trim());
    // Le CSS déclaré exprime « 240ms », le style calculé « 0.24s » : une même
    // durée doit produire UN token (sinon doublon sémantique).
    const canonicalDuration = (d: string): string => {
      const match = /^(-?\d*\.?\d+)(ms|s)$/i.exec(d.trim());
      if (!match) return d.trim();
      const value = parseFloat(match[1]!);
      const ms = match[2]!.toLowerCase() === 's' ? value * 1000 : value;
      return Number.isFinite(ms) ? `${Math.round(ms)}ms` : d.trim();
    };

    for (const n of nodes) {
      const dur = n.styles.transitionDuration;
      const animDur = n.styles.animationDuration;
      const animName = n.styles.animationName;
      if (activeDuration(dur)) {
        durations.add(canonicalDuration(dur!));
        const timing = n.styles.transitionTimingFunction;
        if (timing) easings.add(timing);
        const prop = n.styles.transitionProperty;
        if (prop) {
          transitions.add(prop);
          const list = prop.toLowerCase();
          if (FEEDBACK_HINTS.some((hint) => list.includes(hint))) feedback.add(prop);
        }
      }
      if (animName && animName !== 'none') {
        if (activeDuration(animDur)) durations.add(canonicalDuration(animDur!));
        const timing = n.styles.animationTimingFunction;
        if (timing) easings.add(timing);
        if (ENTRANCE_RE.test(animName)) entrance.add(animName);
        else if (EXIT_RE.test(animName)) exit.add(animName);
        else feedback.add(animName);
      }
    }

    if (cssContent.trim().length > 0) {
      const parsed = parseCss(cssContent);
      for (const name of parsed.keyframes) {
        if (ENTRANCE_RE.test(name)) entrance.add(name);
        else if (EXIT_RE.test(name)) exit.add(name);
      }
      for (const rule of parsed.rules) {
        for (const decl of rule.declarations) {
          const value = decl.value;
          if (decl.property === 'transition-duration' || decl.property === 'animation-duration') {
            for (const part of value.split(',')) {
              if (activeDuration(part)) durations.add(part.trim());
            }
          } else if (decl.property === 'transition-timing-function' || decl.property === 'animation-timing-function') {
            easings.add(value.trim());
          } else if (decl.property === 'transition-property') {
            transitions.add(value.trim());
            if (rule.hover) hover.add(value.trim());
            if (FEEDBACK_HINTS.some((hint) => value.toLowerCase().includes(hint))) feedback.add(value.trim());
          } else if (decl.property === 'transition' || decl.property === 'animation') {
            const first = value.split(',')[0]?.trim() ?? '';
            for (const token of first.split(/\s+/)) {
              if (/^-?\d*\.?\d+m?s$/i.test(token)) durations.add(token);
              else if (/^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i.test(token) || /^(cubic-bezier|steps)\(/.test(token)) easings.add(token);
            }
            const propFirst = first.split(/\s+/)[0];
            if (decl.property === 'transition' && propFirst && !/^\d/.test(propFirst) && !/^(ease|linear|cubic-bezier|steps)/.test(propFirst)) {
              transitions.add(propFirst);
              if (rule.hover) hover.add(propFirst);
              if (FEEDBACK_HINTS.some((hint) => propFirst.toLowerCase().includes(hint))) feedback.add(propFirst);
            }
            if (decl.property === 'animation' && propFirst && !/^\d/.test(propFirst) && !/^(ease|linear|cubic-bezier|steps)/.test(propFirst)) {
              const name = propFirst.replace(/["']/g, '');
              if (ENTRANCE_RE.test(name)) entrance.add(name);
              else if (EXIT_RE.test(name)) exit.add(name);
            }
          }
        }
      }
    }

    return {
      durations: Array.from(durations).sort(),
      easings: Array.from(easings).sort(),
      transitions: Array.from(transitions).sort(),
      hover: Array.from(hover).sort(),
      feedback: Array.from(feedback).sort(),
      entrance: Array.from(entrance).sort(),
      exit: Array.from(exit).sort(),
      evidenceCount: durations.size + easings.size + transitions.size + entrance.size + exit.size
    };
  }

  /**
   * CDC V8 §7.7 — Layout tokens : largeur de conteneur, colonnes de grille,
   * gouttières, breakpoints déclarés, densité DÉRIVÉE des espacements.
   */
  private inferLayoutTokens(nodes: readonly NormalizedDomNode[], cssContent: string): LayoutTokens {
    const maxWidths = new Map<string, number>();
    const gridColumns = new Set<string>();
    const gutters = new Set<string>();
    const spacingSamples: number[] = [];

    for (const n of nodes) {
      const mw = n.styles.maxWidth;
      if (mw && mw !== 'none' && mw !== 'auto' && mw !== '0px') {
        maxWidths.set(mw, (maxWidths.get(mw) ?? 0) + 1);
      }
      const gtc = n.styles.gridTemplateColumns;
      if (gtc && gtc !== 'none') gridColumns.add(gtc);
      for (const gutter of [n.styles.columnGap, n.styles.rowGap, n.styles.gap]) {
        if (gutter && gutter !== '0px' && gutter !== 'normal') gutters.add(gutter);
      }
      const p = canonicalizeLength(n.styles.padding);
      const g = canonicalizeLength(n.styles.gap);
      if (p > 0) spacingSamples.push(p);
      if (g > 0) spacingSamples.push(g);
    }

    let containerWidth: string | undefined;
    let bestCount = 0;
    for (const [value, count] of maxWidths.entries()) {
      if (count > bestCount || (count === bestCount && containerWidth !== undefined && value < containerWidth)) {
        bestCount = count;
        containerWidth = value;
      }
    }

    let density: 'COMPACT' | 'BALANCED' | 'SPACIOUS' | undefined;
    if (spacingSamples.length > 0) {
      const sorted = [...spacingSamples].sort((a, b) => a - b);
      const median = sorted[Math.floor((sorted.length - 1) / 2)]!;
      density = median <= 8 ? 'COMPACT' : median <= 20 ? 'BALANCED' : 'SPACIOUS';
    }

    const breakpoints = cssContent.trim().length > 0 ? parseCss(cssContent).breakpoints : [];

    return {
      containerWidth,
      gridTemplateColumns: Array.from(gridColumns).sort(),
      gutters: Array.from(gutters).sort(),
      breakpoints,
      density,
      evidenceCount: maxWidths.size + gridColumns.size + gutters.size + breakpoints.length
    };
  }
}
