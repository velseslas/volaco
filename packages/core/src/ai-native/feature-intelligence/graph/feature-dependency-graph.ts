/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Dependency Graph - Builds Edges, Sorts Topologically & Detects Cycles
 */

import type { FeatureCandidate, FeatureGraphEdge, FeatureGraphNode } from '../types.js';

export class FeatureDependencyGraph {
  /**
   * Construit les arêtes de dépendances et d'enrichissement entre fonctionnalités
   */
  public buildEdges(candidates: readonly FeatureCandidate[]): readonly FeatureGraphEdge[] {
    const edges: FeatureGraphEdge[] = [];
    const candidateIds = new Set(candidates.map((c) => c.id));

    for (const c of candidates) {
      // Si une feature est un dashboard/analytics, elle dépend des composants d'activité ou de données
      if (c.id.includes('analytics') && candidateIds.has('gap-activity-audit')) {
        edges.push({
          fromFeatureId: 'gap-activity-audit',
          toFeatureId: c.id,
          kind: 'DEPENDS_ON',
          reason: 'Le tableau de bord analytique requiert le journal d activité comme source d événements'
        });
      }

      // Si une feature est une recherche globale, elle enrichit la navigation
      if (c.id.includes('search') && candidateIds.has('audit-opp-responsive-nav')) {
        edges.push({
          fromFeatureId: c.id,
          toFeatureId: 'audit-opp-responsive-nav',
          kind: 'ENHANCES',
          reason: 'La recherche globale améliore directement la fluidité de la navigation'
        });
      }

      // Si auth est présent, les notifications en dépendent pour les alertes de session
      if (c.id.includes('notifications') && candidateIds.has('conv-opp-auth-management')) {
        edges.push({
          fromFeatureId: 'conv-opp-auth-management',
          toFeatureId: c.id,
          kind: 'DEPENDS_ON',
          reason: 'Les notifications de profil requièrent le gestionnaire de session'
        });
      }
    }

    return edges;
  }

  /**
   * Effectue un tri topologique déterministe (Kahn's algorithm)
   */
  public topologicalSort(nodes: readonly FeatureGraphNode[], edges: readonly FeatureGraphEdge[]): {
    readonly order: readonly string[];
    readonly hasCycles: boolean;
  } {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const n of nodes) {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    }

    for (const e of edges) {
      if (e.kind === 'DEPENDS_ON') {
        const currentIn = inDegree.get(e.toFeatureId) ?? 0;
        inDegree.set(e.toFeatureId, currentIn + 1);

        const outList = adj.get(e.fromFeatureId) ?? [];
        outList.push(e.toFeatureId);
        adj.set(e.fromFeatureId, outList);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    // Tri stable de la queue initiale
    queue.sort();

    const order: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      order.push(u);

      const neighbors = adj.get(u) ?? [];
      neighbors.sort();
      for (const v of neighbors) {
        const deg = (inDegree.get(v) ?? 1) - 1;
        inDegree.set(v, deg);
        if (deg === 0) {
          queue.push(v);
        }
      }
    }

    const hasCycles = order.length < nodes.length;
    // Si cycle, compléter avec les nœuds restants dans l'ordre d'origine
    if (hasCycles) {
      for (const n of nodes) {
        if (!order.includes(n.id)) {
          order.push(n.id);
        }
      }
    }

    return {
      order,
      hasCycles
    };
  }
}
