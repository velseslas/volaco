/**
 * VibeCode Core - Design Harmony
 * CDC V8 §13 — DESIGN CRITIC ENGINE.
 *
 * Après le rendu : « cette interface est-elle réellement bonne ? » — analyse
 * déterministe de la HIÉRARCHIE visuelle, de la COMPOSITION, de l'ESTHÉTIQUE,
 * de l'UX visuelle et de la QUALITÉ PERÇUE.
 *
 * Principes (mêmes garde-fous que le reste du pipeline) :
 *  - toute mesure est adossée à une preuve réelle (styles calculés, boîtes de
 *    layout, attributs) citée dans `evidence` ;
 *  - la provenance du layout est connue (RUNTIME vs ESTIMATED) et baisse la
 *    confiance quand les positions sont estimées ;
 *  - un axe sans preuves suffisantes vaut null (UNKNOWN) + raison — jamais
 *    de score de remplissage, jamais d'aléatoire.
 */

import { canonicalizeLength } from '../../visual-intelligence/canonical.js';
import type { NormalizedDomNode, VisualSnapshot } from '../../visual-intelligence/types.js';
import { computeContrastRatio } from '../canonical.js';
import type {
  CriticAxisId,
  CriticAxisScore,
  CriticFinding,
  CriticSeverity,
  DesignCritique
} from '../types.js';

interface VisibleEntry {
  readonly node: NormalizedDomNode;
  readonly effectiveBg: string;
}

interface AxisResult {
  readonly score: number | null;
  readonly confidence: number;
  readonly evidence: string[];
  readonly findings: Array<Omit<CriticFinding, 'id'>>;
  readonly unknownReason?: string;
}

const clampScore = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
};

const SEVERITY_BY_DEDUCTION = (deduction: number): CriticSeverity =>
  deduction >= 15 ? 'HIGH' : deduction >= 8 ? 'MEDIUM' : 'LOW';

export class DesignCriticEngine {
  public critique(snapshot: VisualSnapshot): DesignCritique {
    const entries = this.collectVisible(snapshot.rootNode);
    const findings: CriticFinding[] = [];
    let findingCounter = 0;

    const finalize = (axis: CriticAxisId, result: AxisResult): CriticAxisScore => {
      for (const f of result.findings) {
        findings.push({
          ...f,
          id: `crit:${axis}:${f.code}:${findingCounter}`
        });
        findingCounter += 1;
      }
      return {
        axis,
        score: result.score === null ? null : clampScore(result.score),
        confidence: Math.round(result.confidence * 100) / 100,
        evidence: result.evidence,
        ...(result.unknownReason ? { unknownReason: result.unknownReason } : {})
      };
    };

    const axes: CriticAxisScore[] = [
      finalize('VISUAL_HIERARCHY', this.analyzeHierarchy(entries)),
      finalize('COMPOSITION', this.analyzeComposition(entries, snapshot)),
      finalize('AESTHETICS', this.analyzeAesthetics(entries)),
      finalize('VISUAL_UX', this.analyzeVisualUx(entries, snapshot)),
      finalize('PERCEIVED_QUALITY', this.analyzePerceivedQuality(entries))
    ];

    const known = axes.filter((a) => a.score !== null).length;
    return {
      axes,
      findings,
      coverage: Math.round((known / axes.length) * 100) / 100,
      layoutSource: snapshot.layoutSource ?? 'ESTIMATED',
      evaluatedAt: new Date().toISOString()
    };
  }

  /** Nœuds visibles avec le fond réellement hérité (pour les contrastes). */
  private collectVisible(root: NormalizedDomNode): VisibleEntry[] {
    const out: VisibleEntry[] = [];
    const walk = (node: NormalizedDomNode, inheritedBg: string): void => {
      const bg = node.styles.backgroundColor;
      const effectiveBg =
        bg && bg !== 'transparent' && bg !== 'inherit' && bg !== 'rgba(0, 0, 0, 0)'
          ? bg
          : inheritedBg;
      if (node.layout.isVisible && node.styles.display !== 'none') {
        out.push({ node, effectiveBg });
      }
      for (const child of node.children) {
        walk(child, effectiveBg);
      }
    };
    walk(root, '#ffffff');
    return out;
  }

  private analyzeHierarchy(entries: readonly VisibleEntry[]): AxisResult {
    const evidence: string[] = [];
    const findings: AxisResult['findings'] = [];
    const textNodes = entries.filter((e) => e.node.textContent.trim().length >= 2);
    const headings = entries
      .filter((e) => e.node.role === 'HEADING')
      .map((e) => ({ selector: e.node.selector, px: canonicalizeLength(e.node.styles.fontSize) }))
      .filter((h) => h.px > 0)
      .sort((a, b) => b.px - a.px);
    const paragraphs = entries
      .filter((e) => e.node.role === 'PARAGRAPH' && e.node.textContent.trim().length >= 2)
      .map((e) => canonicalizeLength(e.node.styles.fontSize))
      .filter((px) => px > 0);
    const distinctSizes = new Set(entries.map((e) => canonicalizeLength(e.node.styles.fontSize)).filter((px) => px > 0));

    if (textNodes.length < 3 || (headings.length === 0 && distinctSizes.size < 2)) {
      return {
        score: null,
        confidence: 0,
        evidence: [`textes analysables=${textNodes.length}`, `titres=${headings.length}`],
        findings,
        unknownReason: 'Pas assez de contenu textuel pour mesurer une hiérarchie.'
      };
    }

    let score = 100;
    const bodyPx = median(paragraphs.length > 0 ? paragraphs : [...distinctSizes]);
    evidence.push(`titres=${headings.length}`, `tailles distinctes=${distinctSizes.size}`, `corps≈${bodyPx}px`);

    if (headings.length === 0) {
      score -= 20;
      findings.push({ axis: 'VISUAL_HIERARCHY', code: 'NO_HEADINGS', severity: 'HIGH', message: 'Aucun titre détecté : le point focal ne peut pas exister.', evidence: `tailles distinctes=${distinctSizes.size}` });
    } else {
      const ratio = bodyPx > 0 ? headings[0]!.px / bodyPx : 0;
      evidence.push(`ratio titre/corps≈${ratio.toFixed(2)}`);
      if (ratio < 1.25) {
        score -= 20;
        findings.push({ axis: 'VISUAL_HIERARCHY', code: 'WEAK_SCALE', severity: 'HIGH', message: `Le plus grand titre ne se distingue pas du corps (×${ratio.toFixed(2)}).`, evidence: `titre=${headings[0]!.px}px corps≈${bodyPx}px` });
      } else if (ratio > 3.5) {
        score -= 8;
        findings.push({ axis: 'VISUAL_HIERARCHY', code: 'OVERSIZED_TITLE', severity: 'MEDIUM', message: `Titre disproportionné par rapport au corps (×${ratio.toFixed(2)}).`, evidence: `titre=${headings[0]!.px}px corps≈${bodyPx}px` });
      }
      const competing = headings.filter((h) => h.px >= headings[0]!.px * 0.9).length;
      if (competing >= 4) {
        score -= 10;
        findings.push({ axis: 'VISUAL_HIERARCHY', code: 'TOO_MANY_FOCALS', severity: 'MEDIUM', message: `${competing} titres de taille quasi identique se disputent le point focal.`, evidence: `taille max≈${headings[0]!.px}px` });
      }
    }

    if (distinctSizes.size < 3) {
      score -= 12;
      findings.push({ axis: 'VISUAL_HIERARCHY', code: 'FEW_STEPS', severity: 'MEDIUM', message: `Échelle typographique pauvre (${distinctSizes.size} taille(s)).`, evidence: `tailles=${[...distinctSizes].sort((a, b) => a - b).join(', ')}` });
    }

    const buttons = entries.filter((e) => e.node.role === 'BUTTON');
    if (buttons.length > 0) {
      const hasStrongCta = buttons.some((b) => {
        const weight = parseInt(b.node.styles.fontWeight, 10) || 400;
        const bg = b.node.styles.backgroundColor;
        return weight >= 600 || (bg !== 'transparent' && bg !== 'inherit' && bg !== '#ffffff' && bg !== '#000000');
      });
      if (!hasStrongCta) {
        score -= 8;
        findings.push({ axis: 'VISUAL_HIERARCHY', code: 'WEAK_CTA', severity: 'MEDIUM', message: 'Aucun bouton ne se détache visuellement (graisse ou fond).', evidence: `boutons=${buttons.length}` });
      }
    }

    return { score, confidence: 0.75, evidence, findings };
  }

  private analyzeComposition(entries: readonly VisibleEntry[], snapshot: VisualSnapshot): AxisResult {
    const evidence: string[] = [];
    const findings: AxisResult['findings'] = [];
    const boxed = entries.filter((e) => e.node.layout.width > 0 && e.node.layout.height > 0);
    if (boxed.length < 5) {
      return {
        score: null,
        confidence: 0,
        evidence: [`boîtes exploitables=${boxed.length}`],
        findings,
        unknownReason: 'Pas assez de boîtes de layout pour mesurer une composition.'
      };
    }
    const estimated = (snapshot.layoutSource ?? 'ESTIMATED') === 'ESTIMATED';
    const confidence = estimated ? 0.45 : 0.8;
    let score = 100;

    // Alignement : part des blocs alignés sur le bord gauche modal.
    const blockEdges = boxed
      .filter((e) => e.node.styles.display !== 'inline' && e.node.layout.width >= 24)
      .map((e) => e.node.layout.x);
    if (blockEdges.length >= 4) {
      const counts = new Map<number, number>();
      for (const x of blockEdges) counts.set(x, (counts.get(x) ?? 0) + 1);
      const modal = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
      const aligned = blockEdges.filter((x) => Math.abs(x - modal[0]) <= 2).length;
      const share = aligned / blockEdges.length;
      evidence.push(`alignement gauche=${Math.round(share * 100)}%`);
      if (share < 0.5) {
        score -= 15;
        findings.push({ axis: 'COMPOSITION', code: 'WEAK_ALIGNMENT', severity: 'MEDIUM', message: `Seulement ${Math.round(share * 100)} % des blocs partagent une ligne directrice verticale.`, evidence: `bord modal=${modal[0]}px blocs=${blockEdges.length}` });
      }
    }

    // Équilibre horizontal : centroïde d'aire CONTINU, hors wrappers
    // structurels (html/body). Une découpe binaire gauche/droite classait
    // toute boîte pleine largeur d'un seul côté et produisait de faux
    // LOPSIDED sur des pages parfaitement centrées.
    const center = snapshot.viewport.width / 2;
    const contentBoxes = boxed.filter((e) => e.node.tagName !== 'body' && e.node.tagName !== 'html');
    const balanced = contentBoxes.length >= 3 ? contentBoxes : boxed;
    const totalArea = balanced.reduce((sum, e) => sum + e.node.layout.width * e.node.layout.height, 0);
    if (totalArea > 0) {
      const centroidX = balanced.reduce(
        (sum, e) => sum + (e.node.layout.x + e.node.layout.width / 2) * (e.node.layout.width * e.node.layout.height),
        0
      ) / totalArea;
      const deviation = Math.abs(centroidX - center) / Math.max(1, center);
      evidence.push(`centroïde G/D=${Math.round(centroidX)}px (écart ${Math.round(deviation * 100)}%)`);
      if (deviation > 0.35) {
        score -= 12;
        findings.push({ axis: 'COMPOSITION', code: 'LOPSIDED', severity: 'MEDIUM', message: `Composition déséquilibrée : le centre de masse est décalé de ${Math.round(deviation * 100)} % par rapport au centre.`, evidence: `centroideX=${Math.round(centroidX)}px centre=${Math.round(center)}px` });
      }
    }

    // Rythme vertical : régularité des espacements observés.
    const spacings = boxed
      .map((e) => canonicalizeLength(e.node.styles.padding))
      .filter((px) => px > 0);
    if (spacings.length >= 6) {
      const mean = spacings.reduce((a, b) => a + b, 0) / spacings.length;
      const variance = spacings.reduce((acc, v) => acc + (v - mean) ** 2, 0) / spacings.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
      evidence.push(`variation espacements=${cv.toFixed(2)}`);
      if (cv > 0.75) {
        score -= 10;
        findings.push({ axis: 'COMPOSITION', code: 'UNEVEN_RHYTHM', severity: 'MEDIUM', message: 'Rythme vertical irrégulier : les espacements varient fortement.', evidence: `CV=${cv.toFixed(2)} échantillons=${spacings.length}` });
      }
    }

    // Espace négatif : part du document couverte par les FEUILLES visibles.
    // Sommer toutes les boîtes comptait plusieurs fois les aires imbriquées
    // (parent + enfants) et déclenchait un faux TOO_PACKED sur des pages
    // simplement structurées.
    const parentIds = new Set<string>();
    for (const e of boxed) {
      for (const child of e.node.children) {
        if (child.layout.width > 0 && child.layout.height > 0) parentIds.add(e.node.id);
      }
    }
    const leaves = boxed.filter((e) => !parentIds.has(e.node.id));
    const drawnBy = leaves.length >= 3 ? leaves : boxed;
    const contentBottom = Math.max(...boxed.map((e) => e.node.layout.y + e.node.layout.height));
    const contentArea = snapshot.viewport.width * Math.max(1, contentBottom);
    const drawn = drawnBy.reduce((acc, e) => acc + e.node.layout.width * e.node.layout.height, 0);
    const fillRatio = drawn / contentArea;
    evidence.push(`occupation des feuilles=${Math.round(fillRatio * 100)}%`);
    if (fillRatio < 0.08) {
      score -= 8;
      findings.push({ axis: 'COMPOSITION', code: 'TOO_SPARSE', severity: 'LOW', message: 'Énormément d’espace négatif : la page paraît vide.', evidence: `occupation=${Math.round(fillRatio * 100)}%` });
    } else if (fillRatio > 0.85) {
      score -= 12;
      findings.push({ axis: 'COMPOSITION', code: 'TOO_PACKED', severity: 'MEDIUM', message: 'Page saturée : presque aucune respiration entre les blocs.', evidence: `occupation=${Math.round(fillRatio * 100)}%` });
    }

    if (estimated) evidence.push('positions estimées (DOM statique, pas de rendu réel)');
    return { score, confidence, evidence, findings };
  }

  private analyzeAesthetics(entries: readonly VisibleEntry[]): AxisResult {
    const evidence: string[] = [];
    const findings: AxisResult['findings'] = [];
    if (entries.length < 5) {
      return {
        score: null,
        confidence: 0,
        evidence: [`nœuds visibles=${entries.length}`],
        findings,
        unknownReason: 'Pas assez d’éléments visibles pour juger l’esthétique.'
      };
    }
    let score = 100;

    const palette = new Set<string>();
    for (const e of entries) {
      const { backgroundColor, color, borderColor } = e.node.styles;
      for (const c of [backgroundColor, color, borderColor]) {
        if (c && c !== 'transparent' && c !== 'inherit' && c !== '#000000' && !c.startsWith('rgba(') ) palette.add(c);
      }
    }
    evidence.push(`palette observée=${palette.size}`);
    if (palette.size > 7) {
      const deduction = Math.min(24, (palette.size - 7) * 4);
      score -= deduction;
      findings.push({ axis: 'AESTHETICS', code: 'PALETTE_BLOAT', severity: SEVERITY_BY_DEDUCTION(deduction), message: `Palette trop étendue (${palette.size} couleurs observées).`, evidence: [...palette].slice(0, 8).join(', ') });
    }

    const fonts = new Set(entries.map((e) => e.node.styles.fontFamily.toLowerCase()).filter(Boolean));
    evidence.push(`polices=${fonts.size}`);
    if (fonts.size > 2) {
      const deduction = Math.min(20, (fonts.size - 2) * 10);
      score -= deduction;
      findings.push({ axis: 'AESTHETICS', code: 'FONT_BLOAT', severity: SEVERITY_BY_DEDUCTION(deduction), message: `${fonts.size} familles de police distinctes se partagent la page.`, evidence: [...fonts].join(', ') });
    }

    const sizes = new Set(entries.map((e) => canonicalizeLength(e.node.styles.fontSize)).filter((px) => px > 0));
    const shadows = new Set(entries.map((e) => e.node.styles.boxShadow).filter((s) => s && s !== 'none'));
    const radii = new Set(entries.map((e) => e.node.styles.borderRadius).filter((r) => r && r !== '0px'));
    evidence.push(`tailles=${sizes.size}`, `ombres=${shadows.size}`, `rayons=${radii.size}`);
    if (sizes.size <= 2 && shadows.size === 0 && radii.size === 0) {
      score -= 12;
      findings.push({ axis: 'AESTHETICS', code: 'MONOTONE', severity: 'MEDIUM', message: 'Interface monotone : aucune variation de taille, d’ombre ou de rayon.', evidence: `tailles=${sizes.size} ombres=${shadows.size} rayons=${radii.size}` });
    }
    if (shadows.size > 4) {
      score -= 8;
      findings.push({ axis: 'AESTHETICS', code: 'ELEVATION_BLOAT', severity: 'MEDIUM', message: `${shadows.size} ombres distinctes : élévation incohérente.`, evidence: [...shadows].slice(0, 4).join(' | ') });
    }
    if (radii.size > 5) {
      score -= 8;
      findings.push({ axis: 'AESTHETICS', code: 'RADIUS_BLOAT', severity: 'MEDIUM', message: `${radii.size} rayons distincts : formes incohérentes.`, evidence: [...radii].slice(0, 6).join(', ') });
    }

    return { score, confidence: 0.65, evidence, findings };
  }

  private analyzeVisualUx(entries: readonly VisibleEntry[], snapshot: VisualSnapshot): AxisResult {
    const evidence: string[] = [];
    const findings: AxisResult['findings'] = [];
    const interactive = snapshot.interactiveElements;
    const textNodes = entries.filter((e) => e.node.textContent.trim().length >= 2);
    if (interactive.length === 0 && textNodes.length < 3) {
      return {
        score: null,
        confidence: 0,
        evidence: [`interactifs=0`, `textes=${textNodes.length}`],
        findings,
        unknownReason: 'Ni interaction ni contenu textuel : rien à juger en UX visuelle.'
      };
    }
    let score = 100;

    if (interactive.length > 0) {
      const unnamed = interactive.filter((i) => !i.hasAccessibleName);
      const namedShare = (interactive.length - unnamed.length) / interactive.length;
      evidence.push(`noms accessibles=${Math.round(namedShare * 100)}%`);
      if (namedShare < 0.8) {
        score -= 15;
        findings.push({
          axis: 'VISUAL_UX',
          code: 'UNNAMED_INTERACTIONS',
          severity: 'HIGH',
          message: `${unnamed.length}/${interactive.length} éléments interactifs n’ont pas de nom accessible.`,
          evidence: unnamed.slice(0, 3).map((i) => i.selector).join(', ')
        });
      }
    } else {
      evidence.push('aucun élément interactif détecté');
    }

    const deadLinks = entries.filter((e) => e.node.role === 'LINK').filter((e) => {
      const href = (e.node.attributes['href'] ?? '').trim().toLowerCase();
      return href.length === 0 || href === '#';
    });
    if (deadLinks.length > 0) {
      score -= Math.min(15, deadLinks.length * 5);
      findings.push({ axis: 'VISUAL_UX', code: 'DEAD_LINKS', severity: 'MEDIUM', message: `${deadLinks.length} lien(s) sans destination : affordance morte.`, evidence: deadLinks.slice(0, 3).map((e) => e.node.selector).join(', ') });
    }

    const imagesWithoutAlt = entries.filter((e) => e.node.role === 'IMAGE').filter((e) => {
      const alt = e.node.attributes['alt'];
      return alt === undefined || alt.trim().length === 0;
    });
    if (imagesWithoutAlt.length > 0) {
      score -= Math.min(12, imagesWithoutAlt.length * 4);
      findings.push({ axis: 'VISUAL_UX', code: 'IMAGES_WITHOUT_ALT', severity: 'LOW', message: `${imagesWithoutAlt.length} image(s) sans alternative textuelle.`, evidence: imagesWithoutAlt.slice(0, 3).map((e) => e.node.selector).join(', ') });
    }

    const wallOfText = textNodes.filter((e) => e.node.role === 'PARAGRAPH' && e.node.textContent.length > 320);
    if (wallOfText.length > 0) {
      score -= 6;
      findings.push({ axis: 'VISUAL_UX', code: 'WALL_OF_TEXT', severity: 'LOW', message: `${wallOfText.length} paragraphe(s) très longs : lecture immédiate difficile.`, evidence: wallOfText.slice(0, 2).map((e) => e.node.selector).join(', ') });
    }

    return { score, confidence: 0.7, evidence, findings };
  }

  private analyzePerceivedQuality(entries: readonly VisibleEntry[]): AxisResult {
    const evidence: string[] = [];
    const findings: AxisResult['findings'] = [];
    const textNodes = entries.filter((e) => e.node.textContent.trim().length >= 2);
    if (textNodes.length < 2) {
      return {
        score: null,
        confidence: 0,
        evidence: [`textes=${textNodes.length}`],
        findings,
        unknownReason: 'Pas assez de texte pour mesurer un contraste perçu.'
      };
    }
    let score = 100;

    const violations: string[] = [];
    for (const e of textNodes) {
      const fg = e.node.styles.color;
      if (!fg || fg === 'transparent' || fg === 'inherit') continue;
      const px = canonicalizeLength(e.node.styles.fontSize);
      const weight = parseInt(e.node.styles.fontWeight, 10) || 400;
      const large = px >= 24 || (px >= 18.66 && weight >= 700);
      const threshold = large ? 3 : 4.5;
      let ratio = 1;
      try {
        ratio = computeContrastRatio(fg, e.effectiveBg);
      } catch {
        continue;
      }
      if (ratio < threshold) {
        violations.push(`${e.node.selector} (${ratio.toFixed(2)}:1 < ${threshold}:1)`);
      }
    }
    evidence.push(`contrastes insuffisants=${violations.length}`);
    if (violations.length > 0) {
      const deduction = Math.min(30, violations.length * 10);
      score -= deduction;
      findings.push({ axis: 'PERCEIVED_QUALITY', code: 'CONTRAST_VIOLATIONS', severity: SEVERITY_BY_DEDUCTION(deduction), message: `${violations.length} texte(s) sous le seuil WCAG AA : la confiance perçue baisse.`, evidence: violations.slice(0, 3).join(' · ') });
    }

    const palette = new Set<string>();
    for (const e of entries) {
      const c = e.node.styles.color;
      if (c && c !== 'transparent' && c !== 'inherit') palette.add(c);
    }
    evidence.push(`couleurs de texte=${palette.size}`);
    if (palette.size > 6) {
      score -= 8;
      findings.push({ axis: 'PERCEIVED_QUALITY', code: 'TEXT_PALETTE_BLOAT', severity: 'MEDIUM', message: `${palette.size} couleurs de texte : finition perçue inégale.`, evidence: [...palette].slice(0, 6).join(', ') });
    }

    return { score, confidence: 0.7, evidence, findings };
  }
}
