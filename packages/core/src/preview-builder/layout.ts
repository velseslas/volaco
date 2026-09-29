/**
 * ÉTAPE 07 — LAYOUT COMPOSITION ENGINE : couche du RENDERER (jamais du moteur).
 *
 * Le moteur reste agnostique (aucun CSS/grid/flex/pixel ne le traverse).
 * Cette couche dérive du PreviewBuildState une COMPOSITION SPATIALE :
 *
 *   PreviewBuildState → Component Tree → Layout Composition → Visuals → Canvas
 *
 * Socle extensible : LayoutSpec peut accueillir plus tard direction/columns/
 * gap/alignment/placement — pour l'instant kind + columns suffisent.
 * FALLBACK : toute composition inconnue → column (aucun composant perdu).
 */

import type { PreviewBuildState, ComponentState } from './engine.js';

export type LayoutKind = 'row' | 'column' | 'grid' | 'stack';

export interface LayoutSpec {
  kind: LayoutKind;
  columns: number;
}

/** Nœud de composition : un composant + la disposition de SES enfants. */
export interface LayoutNode {
  component: ComponentState;
  /** Disposition des enfants de ce nœud. */
  layout: LayoutSpec;
  children: LayoutNode[];
}

/** Groupe de racines (le « row » Sidebar|Main de l'exemple du brief). */
export interface RootGroup {
  kind: LayoutKind;
  components: ComponentState[];
}

/** Groupe de composition construit par layoutTree (nœuds composés). */
export interface RootGroupNode {
  kind: LayoutKind;
  nodes: LayoutNode[];
}

const SIDE_TYPES = new Set(['sidebar', 'nav', 'aside']);
const MAIN_TYPES = new Set(['content', 'main', 'page', 'section', 'body']);
const BLOCK_TYPES = new Set(['card', 'chart', 'table', 'stat', 'panel', 'widget', 'block']);

/**
 * Disposition des enfants d'un parent, dérivée du type du parent et des
 * types/enfants présents (aucune structure métier hardcodée) :
 * - sidebar/nav/aside     → column (navigation verticale) ;
 * - overlay/modal/stack   → stack ;
 * - content/main/page     → grid 2 colonnes dès 2 blocs enfants ;
 * - défaut                → column (fallback générique).
 */
export function compositionFor(
  parent: ComponentState | null,
  children: ComponentState[]
): LayoutSpec {
  if (children.length === 0) return { kind: 'column', columns: 1 };
  const parentType = (parent?.type || 'page').toLowerCase();
  if (SIDE_TYPES.has(parentType)) return { kind: 'column', columns: 1 };
  if (parentType === 'overlay' || parentType === 'modal' || parentType === 'stack') return { kind: 'stack', columns: 1 };
  if (MAIN_TYPES.has(parentType)) {
    return children.length >= 2 ? { kind: 'grid', columns: 2 } : { kind: 'column', columns: 1 };
  }
  // Fallback générique : jamais de composant perdu faute de layout reconnu
  return { kind: 'column', columns: 1 };
}

/**
 * Composition des RACINES (règle standard dashboards) : la première zone
 * latérale (sidebar/nav/aside) ouvre une RANGÉE contenant elle-même et tout
 * ce qui suit — sauf un footer final qui reste pleine largeur. Sans zone
 * latérale → colonne simple.
 */
export function composeRoots(roots: ComponentState[]): RootGroup[] {
  const isSide = (r: ComponentState) => SIDE_TYPES.has((r.type || '').toLowerCase());
  const isFooter = (r: ComponentState) => (r.type || '').toLowerCase() === 'footer';
  const sideIdx = roots.findIndex(isSide);
  if (sideIdx === -1) return [{ kind: 'column', components: roots }];
  const groups: RootGroup[] = [];
  if (sideIdx > 0) groups.push({ kind: 'column', components: roots.slice(0, sideIdx) });
  let rowEnd = roots.length;
  if (roots.length > sideIdx + 1 && isFooter(roots[roots.length - 1]!)) rowEnd = roots.length - 1;
  groups.push({ kind: 'row', components: roots.slice(sideIdx, rowEnd) });
  if (rowEnd < roots.length) groups.push({ kind: 'column', components: roots.slice(rowEnd) });
  return groups;
}

/** Arbre de composition complet dérivé du state (les pending n'apparaissent pas dans le canvas). */
export function layoutTree(state: PreviewBuildState): { groups: RootGroupNode[] } {
  const visible = [...state.components.values()]
    .filter((c) => c.status !== 'pending')
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const byParent = new Map<string, ComponentState[]>();
  const roots: ComponentState[] = [];
  for (const c of visible) {
    if (c.parentId && visible.some((p) => p.id === c.parentId)) {
      const list = byParent.get(c.parentId) || [];
      list.push(c);
      byParent.set(c.parentId, list);
    } else {
      roots.push(c);
    }
  }

  const buildNode = (component: ComponentState, depth: number): LayoutNode => {
    const childComponents = (byParent.get(component.id) || []).map((c) => c);
    const children = childComponents.map((c) => buildNode(c, depth + 1));
    return { component, layout: compositionFor(component, childComponents), children };
  };

  const rootNodes = roots.map((r) => buildNode(r, 0));
  const groups = composeRoots(rootNodes.map((n) => n.component)).map((group) => ({
    kind: group.kind,
    nodes: group.components.map((c) => rootNodes.find((n) => n.component.id === c.id)!)
  }));
  return { groups };
}
