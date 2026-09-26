/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Cross-Page Harmony & Multi-Route Consistency Engine
 */

import { randomUUID } from 'node:crypto';
import type { NormalizedDomNode, VisualSnapshot } from '../../visual-intelligence/types.js';
import type { DesignHarmonyFinding } from '../types.js';

export class CrossPageHarmonyEngine {
  public analyzeCrossPageConsistency(snapshots: readonly VisualSnapshot[]): readonly DesignHarmonyFinding[] {
    const findings: DesignHarmonyFinding[] = [];
    if (snapshots.length < 2) {
      return findings; // Cross-page analysis requires at least 2 distinct routes
    }

    // 1. Navigation / Header Parity across pages
    this.checkNavigationParity(snapshots, findings);

    // 2. Palette Drift across pages
    this.checkCrossPagePalettes(snapshots, findings);

    return findings;
  }

  private checkNavigationParity(
    snapshots: readonly VisualSnapshot[],
    findings: DesignHarmonyFinding[]
  ): void {
    interface HeaderProfile {
      pageRoute: string;
      selector: string;
      nodeId: string;
      height: number;
      backgroundColor: string;
    }

    const headerProfiles: HeaderProfile[] = [];

    for (const snap of snapshots) {
      const findHeader = (node: NormalizedDomNode): NormalizedDomNode | undefined => {
        if (node.tagName === 'header' || node.role === 'NAVIGATION') return node;
        for (const child of node.children) {
          const found = findHeader(child);
          if (found) return found;
        }
        return undefined;
      };

      const headerNode = findHeader(snap.rootNode);
      if (headerNode) {
        let height = headerNode.layout.height;
        const styleAttr = headerNode.attributes['style'] || '';
        const m = styleAttr.match(/height:\s*(\d+)px/);
        if (m && m[1]) {
          height = parseInt(m[1], 10);
        }

        headerProfiles.push({
          pageRoute: snap.pageRoute,
          selector: headerNode.selector,
          nodeId: headerNode.id,
          height,
          backgroundColor: headerNode.styles.backgroundColor
        });
      }
    }

    if (headerProfiles.length < 2) return;

    // Check background consistency
    const baseHeader = headerProfiles[0]!;
    for (let i = 1; i < headerProfiles.length; i++) {
      const h = headerProfiles[i]!;

      if (h.backgroundColor && baseHeader.backgroundColor && h.backgroundColor !== baseHeader.backgroundColor) {
        findings.push({
          id: `dhf-crosspage-header-bg-${randomUUID().slice(0, 8)}`,
          category: 'CROSS_PAGE',
          severity: 'HIGH',
          confidence: 0.95,
          pageRoute: h.pageRoute,
          selector: h.selector,
          property: 'header.backgroundColor',
          observedValue: h.backgroundColor,
          expectedValue: baseHeader.backgroundColor,
          deviation: `Couleur divergente de ${baseHeader.pageRoute}`,
          evidence: [
            {
              source: 'COMPUTED_STYLE',
              detail: `En-tête de la page ${h.pageRoute} (${h.backgroundColor}) diverge de la page ${baseHeader.pageRoute} (${baseHeader.backgroundColor})`,
              pageRoute: h.pageRoute,
              selector: h.selector,
              nodeId: h.nodeId,
              occurrences: 1
            }
          ],
          recommendation: `Aligner la couleur de fond de l'en-tête de ${h.pageRoute} sur celle de ${baseHeader.pageRoute} (${baseHeader.backgroundColor}).`,
          designDrift: true
        });
      }

      if (h.height > 0 && baseHeader.height > 0 && Math.abs(h.height - baseHeader.height) >= 12) {
        const diff = h.height - baseHeader.height;
        findings.push({
          id: `dhf-crosspage-header-h-${randomUUID().slice(0, 8)}`,
          category: 'CROSS_PAGE',
          severity: 'MEDIUM',
          confidence: 0.9,
          pageRoute: h.pageRoute,
          selector: h.selector,
          property: 'header.height',
          observedValue: `${h.height}px`,
          expectedValue: `${baseHeader.height}px`,
          deviation: `${diff > 0 ? '+' : ''}${diff}px`,
          evidence: [
            {
              source: 'LAYOUT_BOX',
              detail: `Hauteur de l'en-tête de ${h.pageRoute} (${h.height}px) diverge significativement de ${baseHeader.pageRoute} (${baseHeader.height}px)`,
              pageRoute: h.pageRoute,
              selector: h.selector,
              nodeId: h.nodeId,
              occurrences: 1
            }
          ],
          recommendation: `Uniformiser la hauteur de l'en-tête de ${h.pageRoute} sur ${baseHeader.height}px.`,
          designDrift: true
        });
      }
    }
  }

  private checkCrossPagePalettes(
    snapshots: readonly VisualSnapshot[],
    findings: DesignHarmonyFinding[]
  ): void {
    const mainColors = new Set(snapshots[0]?.extractedColors || []);
    if (mainColors.size === 0) return;

    for (let i = 1; i < snapshots.length; i++) {
      const snap = snapshots[i]!;
      for (const col of snap.extractedColors) {
        if (!mainColors.has(col) && !['#ffffff', '#000000', '#111827', '#0f172a', '#f9fafb'].includes(col)) {
          findings.push({
            id: `dhf-crosspage-palette-${randomUUID().slice(0, 8)}`,
            category: 'CROSS_PAGE',
            severity: 'LOW',
            confidence: 0.85,
            pageRoute: snap.pageRoute,
            property: 'colorPalette',
            observedValue: col,
            expectedValue: Array.from(mainColors).slice(0, 3).join(', '),
            deviation: `Nouvelle couleur absente de la route principale`,
            evidence: [
              {
                source: 'COMPUTED_STYLE',
                detail: `La page ${snap.pageRoute} introduit la couleur ${col} inexistante sur la page d'accueil`,
                pageRoute: snap.pageRoute,
                occurrences: 1
              }
            ],
            recommendation: `Vérifier si l'introduction de la couleur ${col} sur ${snap.pageRoute} est intentionnelle ou s'il s'agit d'une dérive de charte.`,
            designDrift: true
          });
        }
      }
    }
  }
}
