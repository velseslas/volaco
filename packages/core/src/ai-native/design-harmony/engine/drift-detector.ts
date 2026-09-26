/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Design Drift & Anomaly Detector
 */

import { randomUUID } from 'node:crypto';
import { canonicalizeLength } from '../../visual-intelligence/canonical.js';
import type { NormalizedDomNode, VisualSnapshot } from '../../visual-intelligence/types.js';
import { computeColorDistance } from '../canonical.js';
import type {
  DesignHarmonyFinding,
  InferredDesignSystem
} from '../types.js';

export class DriftDetector {
  public detectDrifts(
    snapshots: readonly VisualSnapshot[],
    designSystem: InferredDesignSystem
  ): readonly DesignHarmonyFinding[] {
    const findings: DesignHarmonyFinding[] = [];

    for (const snap of snapshots) {
      const traverse = (node: NormalizedDomNode) => {
        // 1. Spacing Drift
        this.checkSpacingDrift(node, snap.pageRoute, designSystem, findings);

        // 2. Shape / Radius Drift
        this.checkRadiusDrift(node, snap.pageRoute, designSystem, findings);

        // 3. Color Near-Duplicate Drift
        this.checkColorDrift(node, snap.pageRoute, designSystem, findings);

        for (const child of node.children) {
          traverse(child);
        }
      };

      traverse(snap.rootNode);
    }

    return findings;
  }

  private checkSpacingDrift(
    node: NormalizedDomNode,
    pageRoute: string,
    designSystem: InferredDesignSystem,
    findings: DesignHarmonyFinding[]
  ): void {
    const pVal = canonicalizeLength(node.styles.padding);
    const gridStep = designSystem.spacingTokens.baseGridStep;

    if (pVal > 0 && pVal % gridStep !== 0) {
      const nearestMultiple = Math.round(pVal / gridStep) * gridStep;
      const deviation = pVal - nearestMultiple;

      findings.push({
        id: `dhf-drift-space-${randomUUID().slice(0, 8)}`,
        category: 'SPACING',
        severity: Math.abs(deviation) > 4 ? 'MEDIUM' : 'LOW',
        confidence: 0.9,
        pageRoute,
        selector: node.selector,
        property: 'padding',
        observedValue: `${pVal}px`,
        expectedValue: `${nearestMultiple}px`,
        deviation: `${deviation > 0 ? '+' : ''}${deviation}px`,
        evidence: [
          {
            source: 'COMPUTED_STYLE',
            detail: `Élément avec padding de ${pVal}px non aligné sur le pas de grille de ${gridStep}px`,
            pageRoute,
            selector: node.selector,
            nodeId: node.id,
            occurrences: 1
          }
        ],
        recommendation: `Remplacer le padding ${pVal}px par ${nearestMultiple}px pour respecter la grille ${gridStep}px.`,
        designDrift: true
      });
    }
  }

  private checkRadiusDrift(
    node: NormalizedDomNode,
    pageRoute: string,
    designSystem: InferredDesignSystem,
    findings: DesignHarmonyFinding[]
  ): void {
    if (node.role === 'BUTTON' && node.styles.borderRadius) {
      const observed = node.styles.borderRadius;
      const expected = designSystem.shapeTokens.primaryButtonRadius;

      if (observed !== expected && observed !== '0px' && observed !== '9999px') {
        const obsPx = canonicalizeLength(observed);
        const expPx = canonicalizeLength(expected);
        const diffPx = obsPx - expPx;

        findings.push({
          id: `dhf-drift-radius-${randomUUID().slice(0, 8)}`,
          category: 'SHAPE',
          severity: Math.abs(diffPx) >= 4 ? 'HIGH' : 'MEDIUM',
          confidence: 0.95,
          pageRoute,
          selector: node.selector,
          property: 'borderRadius',
          observedValue: observed,
          expectedValue: expected,
          deviation: `${diffPx > 0 ? '+' : ''}${diffPx}px`,
          evidence: [
            {
              source: 'COMPUTED_STYLE',
              detail: `Bouton avec borderRadius ${observed} divergent du token standard (${expected})`,
              pageRoute,
              selector: node.selector,
              nodeId: node.id,
              occurrences: 1
            }
          ],
          recommendation: `Harmoniser le borderRadius de ce bouton vers ${expected}.`,
          designDrift: true
        });
      }
    }
  }

  private checkColorDrift(
    node: NormalizedDomNode,
    pageRoute: string,
    designSystem: InferredDesignSystem,
    findings: DesignHarmonyFinding[]
  ): void {
    const primary = designSystem.colorTokens.primary;
    if (!primary) return;

    const bg = node.styles.backgroundColor;
    if (bg && bg !== 'transparent' && bg !== primary) {
      // Check if near-duplicate of primary color
      const distance = computeColorDistance(bg, primary);
      // Small distance > 0 indicates an accidental tint/shade drift rather than intentional palette color
      if (distance > 0 && distance < 35) {
        findings.push({
          id: `dhf-drift-color-${randomUUID().slice(0, 8)}`,
          category: 'COLOR',
          severity: 'HIGH',
          confidence: 0.88,
          pageRoute,
          selector: node.selector,
          property: 'backgroundColor',
          observedValue: bg,
          expectedValue: primary,
          deviation: `Distance chromatique Δ=${Math.round(distance)}`,
          evidence: [
            {
              source: 'COMPUTED_STYLE',
              detail: `Couleur ${bg} quasi-identique à la couleur primaire ${primary} (divergence accidentelle)`,
              pageRoute,
              selector: node.selector,
              nodeId: node.id,
              occurrences: 1
            }
          ],
          recommendation: `Remplacer la couleur non standard ${bg} par le token primaire officiel ${primary}.`,
          designDrift: true
        });
      }
    }
  }
}
