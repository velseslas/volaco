/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Component Harmony & Role Parity Engine
 */

import { randomUUID } from 'node:crypto';
import { canonicalizeLength } from '../../visual-intelligence/canonical.js';
import type { NormalizedDomNode, VisualSnapshot } from '../../visual-intelligence/types.js';
import type { DesignHarmonyFinding } from '../types.js';

export class ComponentHarmonyEngine {
  public analyzeComponentClusters(snapshots: readonly VisualSnapshot[]): readonly DesignHarmonyFinding[] {
    const findings: DesignHarmonyFinding[] = [];

    for (const snap of snapshots) {
      const buttons: NormalizedDomNode[] = [];
      const inputs: NormalizedDomNode[] = [];
      const cards: NormalizedDomNode[] = [];

      const resolveExplicitHeight = (node: NormalizedDomNode): NormalizedDomNode => {
        const styleAttr = node.attributes['style'] || '';
        const m = styleAttr.match(/height:\s*(\d+)px/);
        if (m && m[1]) {
          return {
            ...node,
            layout: { ...node.layout, height: parseInt(m[1], 10) }
          };
        }
        return node;
      };

      const collect = (node: NormalizedDomNode) => {
        const resolved = resolveExplicitHeight(node);
        if (resolved.role === 'BUTTON') buttons.push(resolved);
        if (resolved.role === 'INPUT') inputs.push(resolved);
        if (resolved.role === 'CARD') cards.push(resolved);
        for (const child of resolved.children) {
          collect(child);
        }
      };
      collect(snap.rootNode);

      // 1. Analyze Button Cluster
      this.analyzeRoleCluster(buttons, 'BUTTON', snap.pageRoute, findings);

      // 2. Analyze Input Cluster
      this.analyzeRoleCluster(inputs, 'INPUT', snap.pageRoute, findings);

      // 3. Analyze Card Cluster
      this.analyzeRoleCluster(cards, 'CARD', snap.pageRoute, findings);
    }

    return findings;
  }

  private analyzeRoleCluster(
    nodes: readonly NormalizedDomNode[],
    roleName: string,
    pageRoute: string,
    findings: DesignHarmonyFinding[]
  ): void {
    if (nodes.length < 3) return; // Need at least 3 components to establish a statistical pattern

    // Height analysis
    const heightMap = new Map<number, number>();
    for (const n of nodes) {
      const h = n.layout.height;
      if (h > 0) {
        heightMap.set(h, (heightMap.get(h) ?? 0) + 1);
      }
    }

    let dominantHeight = 0;
    let maxCount = 0;
    for (const [h, count] of heightMap.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantHeight = h;
      }
    }

    // If dominant height covers >= 60% of elements, check outliers
    if (maxCount >= Math.ceil(nodes.length * 0.6)) {
      for (const n of nodes) {
        if (n.layout.height > 0 && n.layout.height !== dominantHeight) {
          const diff = n.layout.height - dominantHeight;
          findings.push({
            id: `dhf-comp-${roleName.toLowerCase()}-height-${randomUUID().slice(0, 8)}`,
            category: 'COMPONENT',
            severity: Math.abs(diff) > 8 ? 'MEDIUM' : 'LOW',
            confidence: 0.92,
            pageRoute,
            selector: n.selector,
            property: 'height',
            observedValue: `${n.layout.height}px`,
            expectedValue: `${dominantHeight}px`,
            deviation: `${diff > 0 ? '+' : ''}${diff}px`,
            evidence: [
              {
                source: 'LAYOUT_BOX',
                detail: `Composant ${roleName} avec hauteur de ${n.layout.height}px alors que ${maxCount}/${nodes.length} éléments utilisent ${dominantHeight}px`,
                pageRoute,
                selector: n.selector,
                nodeId: n.id,
                occurrences: 1
              }
            ],
            recommendation: `Uniformiser la hauteur de ce ${roleName} sur la hauteur modale (${dominantHeight}px).`,
            designDrift: false,
            relatedComponents: [roleName]
          });
        }
      }
    }

    // Padding analysis
    const paddingMap = new Map<string, number>();
    for (const n of nodes) {
      const p = n.styles.padding;
      if (p) {
        paddingMap.set(p, (paddingMap.get(p) ?? 0) + 1);
      }
    }

    let dominantPadding = '';
    let maxPadCount = 0;
    for (const [pad, count] of paddingMap.entries()) {
      if (count > maxPadCount) {
        maxPadCount = count;
        dominantPadding = pad;
      }
    }

    if (maxPadCount >= Math.ceil(nodes.length * 0.65)) {
      for (const n of nodes) {
        if (n.styles.padding && n.styles.padding !== dominantPadding) {
          findings.push({
            id: `dhf-comp-${roleName.toLowerCase()}-pad-${randomUUID().slice(0, 8)}`,
            category: 'COMPONENT',
            severity: 'LOW',
            confidence: 0.89,
            pageRoute,
            selector: n.selector,
            property: 'padding',
            observedValue: n.styles.padding,
            expectedValue: dominantPadding,
            deviation: `${canonicalizeLength(n.styles.padding) - canonicalizeLength(dominantPadding)}px`,
            evidence: [
              {
                source: 'COMPUTED_STYLE',
                detail: `Composant ${roleName} avec padding '${n.styles.padding}' divergent de la majorité (${dominantPadding})`,
                pageRoute,
                selector: n.selector,
                nodeId: n.id,
                occurrences: 1
              }
            ],
            recommendation: `Appliquer le padding standard '${dominantPadding}' à ce ${roleName}.`,
            designDrift: false,
            relatedComponents: [roleName]
          });
        }
      }
    }
  }
}
