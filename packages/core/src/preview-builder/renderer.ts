/**
 * LOT 02 — PROGRESSIVE PREVIEW RENDERER : state → modèle de rendu.
 *
 * Règle fondamentale (brief LOT 02) : ce module ne connaît PAS les événements
 * individuels (aucun `if event.kind === …`). Il reçoit un PreviewBuildState
 * produit par le moteur et le transforme en modèle d'affichage :
 *
 *   PreviewBuildState → renderPreview() → PreviewRenderModel → DOM
 *
 * Règles de visibilité appliquées ici :
 *   pending   → canvasVisible = false (pas encore affiché)
 *   building  → canvasVisible = true  (affiché avec état de construction)
 *   completed → canvasVisible = true  (élément stable)
 *   error     → canvasVisible = true  (état d'erreur local, le reste tient)
 *
 * Le modèle est pur et testable en Node — la page mappe ensuite
 * PreviewRenderModel → DOM (mapping trivial, sans logique métier).
 */

import type { AnyStage, PreviewBuildState } from './engine.js';
import type { ComponentState } from './engine.js';

/** Nœud d'affichage : un composant et ses enfants (arbre via parentId). */
export interface RenderNode {
  id: string;
  type: string;
  label: string;
  status: ComponentState['status'];
  depth: number;
  error?: string | undefined;
  children: RenderNode[];
  /** false = pending : le canvas ne doit PAS l'afficher. */
  canvasVisible: boolean;
}

/** Modèle d'affichage complet — la seule chose que la page consomme. */
export interface PreviewRenderModel {
  status: PreviewBuildState['status'];
  stage: AnyStage;
  /** Tous les composants, en pré-ordre (parents avant enfants). */
  flat: RenderNode[];
  /** Racines de l'arbre (composants sans parent connu). */
  roots: RenderNode[];
  /** Sous-ensemble affichable dans le canvas (building/completed/error). */
  canvas: RenderNode[];
  counts: {
    total: number;
    completed: number;
    building: number;
    pending: number;
    error: number;
  };
  /** « Components: 3/6 » — completed sur total. */
  progressLabel: string;
  /** Libellé de la barre d'état basse. */
  statusLabel: string;
  buildError?: string | undefined;
}

function buildNode(
  component: ComponentState,
  childrenByParent: Map<string, ComponentState[]>,
  depth: number
): RenderNode {
  const children = (childrenByParent.get(component.id) || []).map((child) =>
    buildNode(child, childrenByParent, depth + 1)
  );
  return {
    id: component.id,
    type: component.type,
    label: component.label || component.id,
    status: component.status,
    depth,
    ...(component.error !== undefined ? { error: component.error } : {}),
    children,
    canvasVisible: component.status !== 'pending'
  };
}

function collectFlat(nodes: RenderNode[], into: RenderNode[]): RenderNode[] {
  for (const node of nodes) {
    into.push(node);
    collectFlat(node.children, into);
  }
  return into;
}

/** Transforme l'état du moteur en modèle d'affichage. Pur, sans effet de bord. */
export function renderPreview(state: PreviewBuildState): PreviewRenderModel {
  const all = [...state.components.values()].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id)
  );
  const byParent = new Map<string, ComponentState[]>();
  const roots: ComponentState[] = [];
  for (const component of all) {
    // Racine = sans parent, ou parent introuvable dans l'état (composant
    // orphelin : affiché comme racine plutôt que perdu).
    if (!component.parentId || !state.components.has(component.parentId)) {
      roots.push(component);
    } else {
      const list = byParent.get(component.parentId) || [];
      list.push(component);
      byParent.set(component.parentId, list);
    }
  }
  const tree = roots.map((root) => buildNode(root, byParent, 0));
  const flat = collectFlat(tree, []);

  const counts = {
    total: flat.length,
    completed: flat.filter((n) => n.status === 'completed').length,
    building: flat.filter((n) => n.status === 'building').length,
    pending: flat.filter((n) => n.status === 'pending').length,
    error: flat.filter((n) => n.status === 'error').length
  };

  return {
    status: state.status,
    stage: state.stage,
    roots: tree,
    flat,
    canvas: flat.filter((n) => n.canvasVisible),
    counts,
    progressLabel: `Components: ${counts.completed}/${counts.total}`,
    statusLabel: state.status === 'error'
      ? `error — ${state.error || 'inconnue'}`
      : state.status === 'completed'
        ? 'PREVIEW READY'
        : state.status === 'building'
          ? 'Building…'
          : 'idle',
    ...(state.error !== undefined ? { buildError: state.error } : {})
  };
}
