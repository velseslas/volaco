/**
 * VibeCode Core - Design Harmony
 * CDC V8 §14 — AESTHETIC QUALITY SCORE (AQS).
 *
 * Objet COMPLET à 12 sous-scores, exactement ceux du CDC :
 * Visual Hierarchy · Composition · Typography · Color Harmony · Spacing
 * Rhythm · Component Quality · Visual Balance · Information Density ·
 * Interaction Design · Responsive Quality · Brand Alignment · Perceived
 * Quality.
 *
 * Chaque sous-score est :
 *  - MESURÉ : une valeur 0-100 avec ses preuves et sa confiance ;
 *  - ou UNKNOWN : null + raison (aucune donnée de remplissage).
 * Le score global est la moyenne pondérée des seuls sous-scores mesurés,
 * avec la couverture réelle (poids couvert) publiée à côté.
 */

import { canonicalizeLength } from '../../visual-intelligence/canonical.js';
import type { NormalizedDomNode } from '../../visual-intelligence/types.js';
import { computeColorDistance } from '../canonical.js';
import type {
  AestheticQualityInput,
  AestheticQualityScore,
  AqsDimensionId,
  AqsSubScore,
  CriticAxisScore,
  DesignHarmonyFinding
} from '../types.js';

export const AQS_DIMENSION_ORDER: readonly AqsDimensionId[] = [
  'visual_hierarchy',
  'composition',
  'typography',
  'color_harmony',
  'spacing_rhythm',
  'component_quality',
  'visual_balance',
  'information_density',
  'interaction_design',
  'responsive_quality',
  'brand_alignment',
  'perceived_quality'
];

export const AQS_LABELS: Record<AqsDimensionId, string> = {
  visual_hierarchy: 'Visual Hierarchy',
  composition: 'Composition',
  typography: 'Typography',
  color_harmony: 'Color Harmony',
  spacing_rhythm: 'Spacing Rhythm',
  component_quality: 'Component Quality',
  visual_balance: 'Visual Balance',
  information_density: 'Information Density',
  interaction_design: 'Interaction Design',
  responsive_quality: 'Responsive Quality',
  brand_alignment: 'Brand Alignment',
  perceived_quality: 'Perceived Quality'
};

/** Somme = 1.00 : le poids de chaque dimension, fixé et documenté. */
export const AQS_WEIGHTS: Record<AqsDimensionId, number> = {
  visual_hierarchy: 0.12,
  composition: 0.1,
  typography: 0.1,
  color_harmony: 0.08,
  spacing_rhythm: 0.08,
  component_quality: 0.1,
  visual_balance: 0.07,
  information_density: 0.07,
  interaction_design: 0.08,
  responsive_quality: 0.06,
  brand_alignment: 0.06,
  perceived_quality: 0.08
};

const RESPONSIVE_DEDUCTIONS: Record<string, number> = {
  CRITICAL: 15,
  HIGH: 8,
  MEDIUM: 4,
  LOW: 1.5,
  INFO: 0.5
};

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

interface MeasuredSubScore {
  readonly kind: 'measured';
  readonly value: number;
  readonly confidence: number;
  readonly evidence: readonly string[];
}

interface UnknownSubScore {
  readonly kind: 'unknown';
  readonly reason: string;
  readonly evidence: readonly string[];
}

type SubScoreDraft = MeasuredSubScore | UnknownSubScore;

function hexToHsl(color: string): { h: number; s: number; l: number } | undefined {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return undefined;
  const value = m[1]!;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
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

export class AestheticQualityEngine {
  public compute(input: AestheticQualityInput): AestheticQualityScore {
    const { snapshot, critique, tokens } = input;
    const nodes: NormalizedDomNode[] = [];
    const walk = (n: NormalizedDomNode): void => {
      nodes.push(n);
      for (const child of n.children) walk(child);
    };
    walk(snapshot.rootNode);
    const visible = nodes.filter((n) => n.layout.isVisible && n.styles.display !== 'none');

    const drafts: Record<AqsDimensionId, SubScoreDraft> = {
      visual_hierarchy: this.fromCriticAxis(critique, 'VISUAL_HIERARCHY'),
      composition: this.fromCriticAxis(critique, 'COMPOSITION'),
      typography: this.scoreTypography(snapshot, tokens),
      color_harmony: this.scoreColorHarmony(snapshot),
      spacing_rhythm: this.scoreSpacingRhythm(tokens),
      component_quality: this.scoreComponentQuality(nodes),
      visual_balance: this.scoreVisualBalance(visible, snapshot),
      information_density: this.scoreInformationDensity(visible, snapshot),
      interaction_design: this.scoreInteractionDesign(nodes, input),
      responsive_quality: this.scoreResponsiveQuality(input),
      brand_alignment: this.scoreBrandAlignment(snapshot, tokens),
      perceived_quality: this.fromCriticAxis(critique, 'PERCEIVED_QUALITY')
    };

    const subScores: AqsSubScore[] = AQS_DIMENSION_ORDER.map((id) => {
      const draft = drafts[id];
      if (draft.kind === 'measured') {
        return {
          id,
          label: AQS_LABELS[id],
          value: clamp(draft.value),
          confidence: Math.round(draft.confidence * 100) / 100,
          evidence: draft.evidence
        };
      }
      return {
        id,
        label: AQS_LABELS[id],
        value: null,
        confidence: 0,
        evidence: draft.evidence,
        unknownReason: draft.reason
      };
    });

    let weighted = 0;
    let coveredWeight = 0;
    for (const sub of subScores) {
      if (sub.value === null) continue;
      const weight = AQS_WEIGHTS[sub.id];
      weighted += sub.value * weight;
      coveredWeight += weight;
    }

    const computedCount = subScores.filter((s) => s.value !== null).length;
    return {
      version: '8.0',
      determinism: 'DETERMINISTIC',
      overall: coveredWeight > 0 ? clamp(weighted / coveredWeight) : null,
      subScores,
      computedCount,
      unknownCount: subScores.length - computedCount,
      coverage: Math.round(coveredWeight * 100) / 100
    };
  }

  private fromCriticAxis(critique: AestheticQualityInput['critique'], axis: CriticAxisScore['axis']): SubScoreDraft {
    const found = critique.axes.find((a) => a.axis === axis);
    if (!found || found.score === null) {
      return {
        kind: 'unknown',
        reason: found?.unknownReason ?? `Axe ${axis} absent de la critique.`,
        evidence: found?.evidence ?? []
      };
    }
    return { kind: 'measured', value: found.score, confidence: found.confidence, evidence: found.evidence };
  }

  private scoreTypography(snapshot: AestheticQualityInput['snapshot'], tokens: AestheticQualityInput['tokens']): SubScoreDraft {
    const textCount = this.countTextNodes(snapshot.rootNode);
    if (textCount < 3) {
      return { kind: 'unknown', reason: 'Moins de 3 nœuds textuels : typographie non jugeable.', evidence: [`textes=${textCount}`] };
    }
    const fonts = snapshot.extractedFonts.length;
    const scaleSteps = tokens.typographyTokens.detectedScale.length;
    const lh = tokens.typographyTokens.dominantLineHeightRatio;
    const evidence = [`polices=${fonts}`, `tailles distinctes=${scaleSteps}`, `interligne≈${lh}`];
    let score = 100;
    if (fonts > 2) score -= Math.min(20, (fonts - 2) * 10);
    if (scaleSteps <= 1) score -= 16;
    else if (scaleSteps <= 3) score -= 6;
    if (lh < 1.25 || lh > 1.8) score -= 8;
    return { kind: 'measured', value: score, confidence: 0.7, evidence };
  }

  private scoreColorHarmony(snapshot: AestheticQualityInput['snapshot']): SubScoreDraft {
    const colors = snapshot.extractedColors;
    if (colors.length < 2) {
      return { kind: 'unknown', reason: 'Moins de 2 couleurs extraites : harmonie non mesurable.', evidence: [`couleurs=${colors.length}`] };
    }
    let nearDuplicates = 0;
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        try {
          if (computeColorDistance(colors[i]!, colors[j]!) < 12) nearDuplicates++;
        } catch {
          // couleur non parsable : ignorée, jamais devinée
        }
      }
    }
    const evidence = [`couleurs=${colors.length}`, `quasi-doublons=${nearDuplicates}`];
    let score = 100;
    score -= Math.min(18, nearDuplicates * 6);
    if (colors.length > 8) score -= Math.min(12, (colors.length - 8) * 3);
    return { kind: 'measured', value: score, confidence: 0.6, evidence };
  }

  private scoreSpacingRhythm(tokens: AestheticQualityInput['tokens']): SubScoreDraft {
    const spacing = tokens.spacingTokens;
    if (spacing.detectedScale.length === 0) {
      return { kind: 'unknown', reason: 'Aucun espacement observable.', evidence: [] };
    }
    const evidence = [
      `pas de grille=${spacing.baseGridStep}px`,
      `régularité=${spacing.regularityRatio}`,
      `échelle=${spacing.detectedScale.length} valeurs`
    ];
    return { kind: 'measured', value: Math.round(spacing.regularityRatio * 100), confidence: 0.7, evidence };
  }

  private scoreComponentQuality(nodes: readonly NormalizedDomNode[]): SubScoreDraft {
    const roles: Array<{ role: NormalizedDomNode['role']; shapes: string[] }> = [];
    for (const role of ['BUTTON', 'INPUT', 'CARD'] as const) {
      const roleNodes = nodes.filter((n) => n.role === role);
      if (roleNodes.length > 0) {
        roles.push({ role, shapes: roleNodes.map((n) => `${n.styles.borderRadius}|${canonicalizeLength(n.styles.padding)}`) });
      }
    }
    if (roles.length === 0) {
      return { kind: 'unknown', reason: 'Aucun composant (bouton/champ/carte) détecté.', evidence: [] };
    }
    const shares: number[] = [];
    const evidence: string[] = [];
    for (const { role, shapes } of roles) {
      const counts = new Map<string, number>();
      for (const s of shapes) counts.set(s, (counts.get(s) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
      const share = best[1] / shapes.length;
      shares.push(share);
      evidence.push(`${role}: ${Math.round(share * 100)} % homogènes (${shapes.length} éléments)`);
    }
    const avg = shares.reduce((a, b) => a + b, 0) / shares.length;
    return { kind: 'measured', value: Math.round(avg * 100), confidence: 0.6, evidence };
  }

  private scoreVisualBalance(visible: readonly NormalizedDomNode[], snapshot: AestheticQualityInput['snapshot']): SubScoreDraft {
    const boxed = visible.filter((n) => n.layout.width > 0 && n.layout.height > 0);
    if (boxed.length < 3) {
      return { kind: 'unknown', reason: 'Pas assez de boîtes pour un équilibre visuel.', evidence: [`boîtes=${boxed.length}`] };
    }
    // Les wrappers structurels (html/body) couvrent tout le viewport : les
    // inclure forcerait artificiellement le centroïde au centre. On mesure la
    // répartition du CONTENU, en continu (pas de découpe binaire gauche/droite
    // qui classait toute boîte pleine largeur d'un seul côté).
    const content = boxed.filter((n) => n.tagName !== 'body' && n.tagName !== 'html');
    const measured = content.length >= 3 ? content : boxed;
    const total = measured.reduce((sum, n) => sum + n.layout.width * n.layout.height, 0);
    if (total <= 0) {
      return { kind: 'unknown', reason: 'Aires de layout nulles.', evidence: [] };
    }
    const centroidX = measured.reduce(
      (sum, n) => sum + (n.layout.x + n.layout.width / 2) * (n.layout.width * n.layout.height),
      0
    ) / total;
    const center = snapshot.viewport.width / 2;
    const deviation = Math.abs(centroidX - center) / Math.max(1, center);
    const balance = 1 - Math.min(1, deviation);
    const estimated = (snapshot.layoutSource ?? 'ESTIMATED') === 'ESTIMATED';
    return {
      kind: 'measured',
      value: Math.round(balance * 100),
      confidence: estimated ? 0.45 : 0.8,
      evidence: [
        `centroideX≈${Math.round(centroidX)}px / centre≈${Math.round(center)}px`,
        `ecart≈${Math.round(deviation * 100)}% de la demi-largeur`,
        ...(estimated ? ['positions estimées (DOM statique)'] : ['positions réelles (rendu)'])
      ]
    };
  }

  private scoreInformationDensity(visible: readonly NormalizedDomNode[], snapshot: AestheticQualityInput['snapshot']): SubScoreDraft {
    const boxed = visible.filter((n) => n.layout.width > 0 && n.layout.height > 0);
    if (boxed.length < 5) {
      return { kind: 'unknown', reason: 'Page trop petite pour mesurer une densité.', evidence: [`éléments visibles=${boxed.length}`] };
    }
    const bottom = Math.max(...boxed.map((n) => n.layout.y + n.layout.height));
    const area = snapshot.viewport.width * Math.max(1, bottom);
    const density = boxed.length / (area / 100000);
    const score = 100 - Math.min(45, Math.round(Math.abs(density - 8) * 3.5));
    return {
      kind: 'measured',
      value: score,
      confidence: 0.6,
      evidence: [`densité≈${density.toFixed(1)} éléments/100k px²`, `bande cible 3–14`]
    };
  }

  private scoreInteractionDesign(nodes: readonly NormalizedDomNode[], input: AestheticQualityInput): SubScoreDraft {
    const interactive = input.snapshot.interactiveElements;
    if (interactive.length === 0) {
      return { kind: 'unknown', reason: 'Aucun élément interactif détecté.', evidence: [] };
    }
    const named = interactive.filter((i) => i.hasAccessibleName).length;
    const share = named / interactive.length;
    const deadLinks = nodes.filter((n) => n.role === 'LINK').filter((n) => {
      const href = (n.attributes['href'] ?? '').trim().toLowerCase();
      return href.length === 0 || href === '#';
    }).length;
    let score = Math.round(share * 100);
    score -= Math.min(15, deadLinks * 5);
    return {
      kind: 'measured',
      value: score,
      confidence: 0.65,
      evidence: [`noms accessibles=${named}/${interactive.length}`, `liens morts=${deadLinks}`]
    };
  }

  private scoreResponsiveQuality(input: AestheticQualityInput): SubScoreDraft {
    const findings: readonly DesignHarmonyFinding[] = input.responsiveFindings ?? [];
    const hasMobileSnapshot = input.mobileSnapshot !== undefined;
    const hasOverflow = input.mobileOverflow !== undefined;
    if (!hasMobileSnapshot && !hasOverflow && findings.length === 0) {
      return {
        kind: 'unknown',
        reason: 'Aucune analyse mobile : impossible de juger la qualité responsive sans preuve.',
        evidence: []
      };
    }
    let deductions = 0;
    for (const f of findings) {
      deductions += RESPONSIVE_DEDUCTIONS[f.severity] ?? 0;
    }
    const evidence: string[] = [];
    if (hasMobileSnapshot) evidence.push('snapshot MOBILE analysé (375 px)');
    if (hasOverflow) {
      evidence.push(`overflow mobile mesuré : ${input.mobileOverflow!.overflowX ? 'DÉTECTÉ' : 'aucun'}`);
      if (input.mobileOverflow!.overflowX) deductions += 20;
    }
    evidence.push(`findings responsive/a11y=${findings.length}`);
    return {
      kind: 'measured',
      value: Math.max(0, 100 - deductions),
      confidence: findings.length > 0 ? 0.7 : 0.55,
      evidence
    };
  }

  private scoreBrandAlignment(snapshot: AestheticQualityInput['snapshot'], tokens: AestheticQualityInput['tokens']): SubScoreDraft {
    const roles = tokens.colorTokens;
    if (!roles.primary) {
      return { kind: 'unknown', reason: 'Aucune couleur primaire inférée : alignement de marque non mesurable.', evidence: [] };
    }
    const roleCount = [roles.primary, roles.secondary, roles.accent].filter((c) => typeof c === 'string' && c.length > 0).length;
    const saturated = snapshot.extractedColors.filter((color) => {
      const hsl = hexToHsl(color);
      return hsl !== undefined && hsl.s >= 0.35 && hsl.l > 0.15 && hsl.l < 0.85;
    });
    const offRole = Math.max(0, saturated.length - roleCount);
    const score = 100 - Math.min(24, offRole * 6);
    return {
      kind: 'measured',
      value: score,
      confidence: 0.5,
      evidence: [
        `rôles de marque définis=${roleCount} (primary${roles.secondary ? ' + secondary' : ''}${roles.accent ? ' + accent' : ''})`,
        `couleurs saturées hors rôles=${offRole}`
      ]
    };
  }

  private countTextNodes(root: NormalizedDomNode): number {
    let count = 0;
    const walk = (n: NormalizedDomNode): void => {
      if (n.textContent.trim().length >= 2) count++;
      for (const child of n.children) walk(child);
    };
    walk(root);
    return count;
  }
}
