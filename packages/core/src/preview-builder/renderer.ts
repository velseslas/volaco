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

import { BUILD_STAGES } from './engine.js';
import type { AnyStage, BuildStage, PreviewBuildState } from './engine.js';
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
  /** LOT 03 — vrai pour l'unique composant `building` actif (dérivé du state). */
  isBuildFocus: boolean;
  /** ÉTAPE 05 — données de démonstration transportées telles quelles. */
  metadata?: Record<string, unknown>;
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
  /**
   * LOT 03 — BUILD FOCUS : id du composant `building` ACTIF, déterministe
   * (le premier annoncé en construction). DÉRIVÉ du state par un sélecteur
   * pur — le moteur n'est pas modifié, l'animation ne modifie jamais l'état.
   */
  focusId?: string | undefined;
  /**
   * ÉTAPE 11 — dernier composant STABILISÉ (order max parmi les completed) :
   * permet à la barre d'état d'afficher « ✓ X ready » entre deux composants,
   * dérivé du state comme tout le reste (aucun état parallèle).
   */
  lastCompletedId?: string | undefined;
  lastCompletedLabel?: string | undefined;
  buildError?: string | undefined;
}

/**
 * LOT 03 — Build Focus : parmi les composants `building`, le focus principal
 * est le premier annoncé (order minimal, id pour départager). Sélecteur PUR :
 * aucun effet de bord, l'état reste la seule vérité. Plusieurs composants
 * peuvent être `building` simultanément — un seul porte le focus.
 */
export function buildFocus(state: PreviewBuildState): ComponentState | null {
  const building = [...state.components.values()]
    .filter((c) => c.status === 'building')
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return building[0] || null;
}

/* =====================================================================
 * LOT 04 — BUILD TIMELINE : les étapes du pipeline dérivées du state.
 * Aucun état parallèle : active/completed/pending sont calculés depuis
 * status + stage, à chaque rendu.
 * ===================================================================== */

export type TimelineStepStatus = 'pending' | 'active' | 'completed';

export interface TimelineStep {
  stage: BuildStage;
  status: TimelineStepStatus;
}

/**
 * Dérive l'échelle des étapes depuis l'état du moteur :
 * - idle      : « idle » actif, tout le pipeline en attente ;
 * - building  : idle + étapes franchies = completed, l'étape courante =
 *               active, les suivantes = pending ;
 * - completed : tout le pipeline = completed ;
 * - error     : le pipeline repasse en attente — l'échec est porté par
 *               l'étape « error » que la page affiche à part.
 */
export function buildTimeline(state: PreviewBuildState): TimelineStep[] {
  return BUILD_STAGES.map((stage) => {
    let status: TimelineStepStatus;
    if (state.status === 'error') {
      status = 'pending';
    } else if (state.status === 'idle') {
      status = stage === 'idle' ? 'active' : 'pending';
    } else if (state.status === 'completed') {
      status = 'completed';
    } else {
      const current = BUILD_STAGES.indexOf(state.stage as BuildStage);
      const index = BUILD_STAGES.indexOf(stage);
      status = index < current ? 'completed' : index === current ? 'active' : 'pending';
    }
    return { stage, status };
  });
}

/**
 * ÉTAPE 11 — politique de rafraîchissement DOM (pure, testable en Node).
 * Décide si le CONTENU d'un nœud doit être re-rendu ; la classe focus reste
 * un simple toggle dans tous les cas :
 * - changement de statut            → oui (construction → révélation) ;
 * - focus seul sur un `building`    → oui (bannière ◉ ajoutée/retirée) ;
 * - focus seul sur `completed`/`error` → NON : un composant terminé n'est
 *   JAMAIS re-rendu — son contenu ne scintille pas, ses animations CSS ne
 *   repartent pas (stabilisation, brief ÉTAPE 11).
 */
export function shouldRefreshNode(input: {
  statusChanged: boolean;
  focusChanged: boolean;
  nextStatus: ComponentState['status'];
}): boolean {
  if (input.statusChanged) return true;
  if (input.focusChanged) return input.nextStatus === 'building';
  return false;
}

function buildNode(
  component: ComponentState,
  childrenByParent: Map<string, ComponentState[]>,
  depth: number,
  focusId?: string
): RenderNode {
  const children = (childrenByParent.get(component.id) || []).map((child) =>
    buildNode(child, childrenByParent, depth + 1, focusId)
  );
  return {
    id: component.id,
    type: component.type,
    label: component.label || component.id,
    status: component.status,
    depth,
    ...(component.error !== undefined ? { error: component.error } : {}),
    children,
    canvasVisible: component.status !== 'pending',
    isBuildFocus: focusId !== undefined && component.id === focusId,
    ...(component.metadata !== undefined ? { metadata: component.metadata } : {})
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
  const tree = roots.map((root) => buildNode(root, byParent, 0, buildFocus(state)?.id));
  const flat = collectFlat(tree, []);

  const counts = {
    total: flat.length,
    completed: flat.filter((n) => n.status === 'completed').length,
    building: flat.filter((n) => n.status === 'building').length,
    pending: flat.filter((n) => n.status === 'pending').length,
    error: flat.filter((n) => n.status === 'error').length
  };
  const focusId = buildFocus(state)?.id;
  const lastCompleted = all
    .filter((c) => c.status === 'completed')
    .sort((a, b) => b.order - a.order || b.id.localeCompare(a.id))[0];

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
    ...(focusId !== undefined ? { focusId } : {}),
    ...(lastCompleted ? { lastCompletedId: lastCompleted.id, lastCompletedLabel: lastCompleted.label || lastCompleted.id } : {}),
    ...(state.error !== undefined ? { buildError: state.error } : {})
  };
}
