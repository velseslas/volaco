/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Responsive Harmony & WCAG 2.1 AA Accessibility Engine
 */

import { randomUUID } from 'node:crypto';
import { canonicalizeLength } from '../../visual-intelligence/canonical.js';
import type { NormalizedDomNode, VisualSnapshot } from '../../visual-intelligence/types.js';
import { computeContrastRatio } from '../canonical.js';
import type { DesignHarmonyFinding } from '../types.js';

export class ResponsiveA11yHarmonyEngine {
  public analyzeResponsiveAndA11y(snapshots: readonly VisualSnapshot[]): readonly DesignHarmonyFinding[] {
    const findings: DesignHarmonyFinding[] = [];

    for (const snap of snapshots) {
      // 1. Accessibility Checks (Contrast & Accessible Names)
      this.checkWcagContrast(snap, findings);
      this.checkAccessibleNames(snap, findings);

      // 2. Responsive Checks (Mobile Touch Targets & Overflow)
      if (snap.viewport.kind === 'MOBILE') {
        this.checkMobileTouchTargetsAndOverflow(snap, findings);
      }
    }

    return findings;
  }

  private checkWcagContrast(snap: VisualSnapshot, findings: DesignHarmonyFinding[]): void {
    const traverse = (node: NormalizedDomNode, parentBg = '#ffffff') => {
      let currentBg = node.styles.backgroundColor;
      if (!currentBg || currentBg === 'transparent' || currentBg === 'inherit') {
        currentBg = parentBg;
      }

      const fg = node.styles.color;
      if (node.textContent.trim().length > 0 && fg && fg !== 'transparent' && currentBg && currentBg !== 'transparent') {
        const ratio = computeContrastRatio(fg, currentBg);
        const fontSizePx = canonicalizeLength(node.styles.fontSize);
        const isBold = parseInt(node.styles.fontWeight, 10) >= 600 || node.styles.fontWeight === 'bold';
        const isLargeText = fontSizePx >= 18 || (fontSizePx >= 14 && isBold);
        const requiredRatio = isLargeText ? 3.0 : 4.5;

        if (ratio < requiredRatio && ratio > 1) { // ignore default invisible ratio 1
          const severity = ratio < 2.5 ? 'CRITICAL' : 'HIGH';
          findings.push({
            id: `dhf-a11y-contrast-${randomUUID().slice(0, 8)}`,
            category: 'ACCESSIBILITY',
            severity,
            confidence: 0.98,
            pageRoute: snap.pageRoute,
            selector: node.selector,
            property: 'contrastRatio',
            observedValue: `${ratio}:1`,
            expectedValue: `>= ${requiredRatio}:1 (WCAG AA)`,
            deviation: `Déficit de ${(requiredRatio - ratio).toFixed(1)}:1`,
            evidence: [
              {
                source: 'WCAG_CALCULATION',
                detail: `Texte '${node.textContent.slice(0, 30)}...' (${fg}) sur fond (${currentBg}) : ratio de ${ratio}:1 sous le seuil WCAG AA (${requiredRatio}:1)`,
                pageRoute: snap.pageRoute,
                selector: node.selector,
                nodeId: node.id,
                occurrences: 1
              }
            ],
            recommendation: `Augmenter le contraste entre la couleur du texte (${fg}) et son arrière-plan (${currentBg}) pour atteindre au moins ${requiredRatio}:1.`,
            designDrift: false
          });
        }
      }

      for (const child of node.children) {
        traverse(child, currentBg);
      }
    };

    traverse(snap.rootNode);
  }

  private checkAccessibleNames(snap: VisualSnapshot, findings: DesignHarmonyFinding[]): void {
    for (const el of snap.interactiveElements) {
      if (!el.hasAccessibleName) {
        findings.push({
          id: `dhf-a11y-label-${randomUUID().slice(0, 8)}`,
          category: 'ACCESSIBILITY',
          severity: 'HIGH',
          confidence: 0.99,
          pageRoute: snap.pageRoute,
          selector: el.selector,
          property: 'accessibleName',
          observedValue: 'VIDE',
          expectedValue: 'Label accessible défini (aria-label ou texte visible)',
          deviation: 'Nom accessible absent',
          evidence: [
            {
              source: 'DOM_SNAPSHOT',
              detail: `Élément interactif (${el.role}) sans libellé accessible pour lecteurs d'écran`,
              pageRoute: snap.pageRoute,
              selector: el.selector,
              nodeId: el.nodeId,
              occurrences: 1
            }
          ],
          recommendation: `Ajouter un attribut aria-label ou un texte visible pour expliciter la fonction de cet élément.`,
          designDrift: false
        });
      }
    }
  }

  private checkMobileTouchTargetsAndOverflow(snap: VisualSnapshot, findings: DesignHarmonyFinding[]): void {
    for (const el of snap.interactiveElements) {
      // Touch target size
      if (el.bounds.isVisible && (el.bounds.width < 40 || el.bounds.height < 40)) {
        findings.push({
          id: `dhf-resp-touch-${randomUUID().slice(0, 8)}`,
          category: 'RESPONSIVE',
          severity: 'MEDIUM',
          confidence: 0.95,
          pageRoute: snap.pageRoute,
          selector: el.selector,
          property: 'touchTargetSize',
          observedValue: `${el.bounds.width}x${el.bounds.height}px`,
          expectedValue: '>= 40x40px',
          deviation: `Zone tactile inférieure aux recommandations mobiles`,
          evidence: [
            {
              source: 'LAYOUT_BOX',
              detail: `Cible tactile mobile (${el.role}) mesurée à ${el.bounds.width}x${el.bounds.height}px (recommandation minimale: 40x40px)`,
              pageRoute: snap.pageRoute,
              selector: el.selector,
              nodeId: el.nodeId,
              occurrences: 1
            }
          ],
          recommendation: `Augmenter la taille ou le padding de cet élément interactif pour garantir une cible tactile mobile d'au moins 40x40px.`,
          designDrift: false
        });
      }

      // Overflow
      if (el.bounds.hasOverflow) {
        findings.push({
          id: `dhf-resp-overflow-${randomUUID().slice(0, 8)}`,
          category: 'RESPONSIVE',
          severity: 'HIGH',
          confidence: 0.97,
          pageRoute: snap.pageRoute,
          selector: el.selector,
          property: 'layoutOverflow',
          observedValue: 'Débordement actif',
          expectedValue: 'Aucun débordement du viewport mobile',
          deviation: `Dépassement des limites d'écran 375px`,
          evidence: [
            {
              source: 'LAYOUT_BOX',
              detail: `L'élément déborde de la largeur ou de la hauteur du viewport mobile`,
              pageRoute: snap.pageRoute,
              selector: el.selector,
              nodeId: el.nodeId,
              occurrences: 1
            }
          ],
          recommendation: `Adapter les largeurs (w-full / max-w-full) ou flex-wrap pour éviter le débordement horizontal.`,
          designDrift: false
        });
      }
    }
  }
}
