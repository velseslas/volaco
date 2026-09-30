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
  /**
   * ÉTAPE 14 — SÉLECTION UTILISATEUR (état d'interaction UI, JAMAIS injecté
   * dans PreviewBuildState) : dérivé du selectedId passé au renderer.
   * Indépendant du Build Focus : les deux peuvent coexister.
   */
  isUserSelected: boolean;
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
  /**
   * ÉTAPE 14 — sélection utilisateur : id du composant choisi (via
   * resolvePreviewTarget sur le clic) et libellé dérivé DU MODÈLE
   * (component.label, repli component.type). null = aucune sélection.
   */
  selectedId?: string | null | undefined;
  selectedLabel?: string | undefined;
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
 * - contenu du modèle changé        → oui (É16 — ex. label édité : la seule
 *   réécriture légitime hors cycle de construction) ;
 * - focus seul sur un `building`    → oui (bannière ◉ ajoutée/retirée) ;
 * - focus seul sur `completed`/`error` → NON : un composant terminé n'est
 *   JAMAIS re-rendu — son contenu ne scintille pas, ses animations CSS ne
 *   repartent pas (stabilisation, brief ÉTAPE 11).
 * `contentChanged` est ADDITIF et optionnel : sans lui, le comportement
 * É11 est strictement identique.
 */
export function shouldRefreshNode(input: {
  statusChanged: boolean;
  focusChanged: boolean;
  nextStatus: ComponentState['status'];
  contentChanged?: boolean;
}): boolean {
  if (input.statusChanged || input.contentChanged === true) return true;
  if (input.focusChanged) return input.nextStatus === 'building';
  return false;
}

/* =====================================================================
 * ÉTAPE 13 — FONDATION DE L'ÉDITION : IDENTITÉ STABLE + RÉSOLUTION DE CIBLE
 *
 * Direction imposée (brief) : PreviewBuildState → Renderer → DOM →
 * data-pv-id → resolvePreviewTarget(). JAMAIS l'inverse.
 *
 * - L'identité d'un nœud VIENT DU MODÈLE (component.id) — jamais d'un index
 *   DOM, d'une position, d'un texte ou d'un ordre d'affichage ;
 * - resolvePreviewTarget répond à « DOM element → component id » : PUR,
 *   déterministe, sans événement, sans sélection persistante, sans
 *   modification du state NI du DOM (lecture seule de l'ascendance) ;
 * - aucune sélection, aucun inspector : uniquement la fondation.
 * ===================================================================== */

/** Attribut DOM unique portant l'identité Preview (contrat d'édition). */
export const PV_ID_ATTRIBUTE = 'data-pv-id';

/**
 * ÉTAPE 13 — DÉFINITION UNIQUE de l'identité d'un nœud : l'id du composant,
 * tel que le moteur l'a annoncé. Toute la page assigne l'identité via cette
 * fonction — il n'existe AUCUNE autre source d'identité.
 */
export function previewNodeId(component: { id: string }): string {
  return component.id;
}

/**
 * Élément minimal requis pour résoudre une cible (structurel : le DOM réel
 * le satisfait ; les tests Node passent des doublures sans dépendance DOM).
 */
export interface PreviewTargetElement {
  closest(selectors: string): PreviewTargetElement | null;
  getAttribute(name: string): string | null;
}

/**
 * ÉTAPE 13 — résout « élément DOM → composant Preview » :
 * - l'élément PORTE l'attribut       → son id ;
 * - il est DANS un composant (enfant, contenu réel IA) → l'id du composant
 *   porteur le plus proche (remontée d'ascendance, sémantique closest) ;
 * - il est HORS du Preview           → null.
 * Pur : même entrée → même sortie ; ne lit que l'ascendance, n'écrit rien
 * (ni state, ni DOM), ne s'abonne à rien, ne sélectionne rien.
 */
export function resolvePreviewTarget(element: PreviewTargetElement | null): string | null {
  const host = element ? element.closest(`[${PV_ID_ATTRIBUTE}]`) : null;
  if (!host) return null;
  return host.getAttribute(PV_ID_ATTRIBUTE);
}

/* =====================================================================
 * ÉTAPE 15 — INSPECTOR DESCRIPTIF (pur, en lecture seule)
 *
 * buildInspector(state, selectedId) ne fait QUE lire le composant déjà
 * présent dans PreviewBuildState : aucune lecture du DOM, aucune mutation,
 * aucun nouvel état métier. Le HTML réel IA (metadata.html) est transporté
 * tel quel — jamais transformé ni édité. Composant inexistant ou absence
 * de sélection → null (panneau vide côté page).
 * ===================================================================== */

/** Modèle descriptif du composant sélectionné — aucune donnée visuelle. */
export interface InspectorModel {
  id: string;
  type: string;
  label: string;
  parentId?: string | undefined;
  status: ComponentState['status'];
  /** Étape de construction à laquelle le composant appartient. */
  stage: ComponentState['stage'];
  /** Ordre d'annonce (identité et traçabilité — jamais une position DOM). */
  order: number;
  /** Ids des composants enfants déclarés via parentId (données du state). */
  children: string[];
  /** Vrai quand le composant porte un HTML réel IA (metadata.html). */
  hasRealHtml: boolean;
  error?: string | undefined;
  metadata?: Record<string, unknown>;
}

export function buildInspector(
  state: PreviewBuildState,
  selectedId?: string | null
): InspectorModel | null {
  if (selectedId == null) return null;
  const component = state.components.get(selectedId);
  if (!component) return null;
  const children = [...state.components.values()]
    .filter((c) => c.parentId === component.id)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((c) => c.id);
  const hasRealHtml = typeof component.metadata?.html === 'string' && component.metadata.html.length > 0;
  return {
    id: component.id,
    type: component.type,
    label: component.label || component.id,
    ...(component.parentId !== undefined ? { parentId: component.parentId } : {}),
    status: component.status,
    stage: component.stage,
    order: component.order,
    children,
    hasRealHtml,
    ...(component.error !== undefined ? { error: component.error } : {}),
    ...(component.metadata !== undefined ? { metadata: component.metadata } : {})
  };
}

function buildNode(
  component: ComponentState,
  childrenByParent: Map<string, ComponentState[]>,
  depth: number,
  focusId?: string,
  selectedId?: string | null
): RenderNode {
  const children = (childrenByParent.get(component.id) || []).map((child) =>
    buildNode(child, childrenByParent, depth + 1, focusId, selectedId)
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
    isUserSelected: selectedId != null && component.id === selectedId,
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

/**
 * Transforme l'état du moteur en modèle d'affichage. Pur, sans effet de bord.
 *
 * ÉTAPE 14 — `selection.selectedId` : id du composant sélectionné par
 * l'UTILISATEUR (obtenu via resolvePreviewTarget — unique mécanisme
 * d'identification). État d'interaction UI, porté par le MODÈLE DE RENDU
 * uniquement : PreviewBuildState reste inchangé, le Build Focus reste
 * indépendant. Paramètre optionnel : tous les appels existants sont
 * inchangés (aucune sélection).
 */
export function renderPreview(
  state: PreviewBuildState,
  selection?: { selectedId?: string | null }
): PreviewRenderModel {
  const selectedId = selection?.selectedId ?? null;
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
  const tree = roots.map((root) => buildNode(root, byParent, 0, buildFocus(state)?.id, selectedId));
  const flat = collectFlat(tree, []);

  const counts = {
    total: flat.length,
    completed: flat.filter((n) => n.status === 'completed').length,
    building: flat.filter((n) => n.status === 'building').length,
    pending: flat.filter((n) => n.status === 'pending').length,
    error: flat.filter((n) => n.status === 'error').length
  };
  const focusId = buildFocus(state)?.id;
  // Libellé de sélection DÉRIVÉ DU MODÈLE : component.label, repli
  // component.type (le label du nœud retombe sur l'id — jamais utilisé).
  const selectedNode = selectedId != null ? flat.find((n) => n.id === selectedId) : undefined;
  const selectedLabel = selectedNode ? (selectedNode.label !== selectedNode.id ? selectedNode.label : selectedNode.type) : undefined;

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
    ...(lastCompletedDerivation(all)),
    ...(selectedId !== null ? { selectedId } : {}),
    ...(selectedLabel !== undefined ? { selectedLabel } : {}),
    ...(state.error !== undefined ? { buildError: state.error } : {})
  };
}

/** Dernier composant stabilisé (ÉTAPE 11) — dérivé, sans état parallèle. */
function lastCompletedDerivation(all: ComponentState[]): { lastCompletedId: string; lastCompletedLabel: string } | Record<string, never> {
  const lastCompleted = all
    .filter((c) => c.status === 'completed')
    .sort((a, b) => b.order - a.order || b.id.localeCompare(a.id))[0];
  return lastCompleted
    ? { lastCompletedId: lastCompleted.id, lastCompletedLabel: lastCompleted.label || lastCompleted.id }
    : {};
}
