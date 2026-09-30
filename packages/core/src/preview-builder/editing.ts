/**
 * ÉTAPE 16 — PREMIÈRE COMMANDE D'ÉDITION : updateComponentLabel.
 *
 * Couche d'édition SÉPARÉE du moteur de génération : une commande PURE qui
 * produit un NOUVEAU PreviewBuildState. Elle ne connaît NI le DOM, NI le
 * SSE, NI le générateur IA — et ne modifie jamais l'état existant.
 *
 * Garanties :
 * - trim du label ; label vide (après trim) → refus explicite ;
 * - composant inexistant → état inchangé + raison explicite ;
 * - même label → état inchangé (MÊME référence) ;
 * - le composant modifié conserve id, type, parentId, status, stage, order
 *   et metadata — metadata.html n'est JAMAIS touché ;
 * - tous les AUTRES composants restent strictement identiques (mêmes
 *   références) — le journal d'événements et le reste de l'état aussi.
 */

import {
  PRESENTATION_VARIANTS,
  type ComponentState,
  type PresentationVariant,
  type PreviewBuildState
} from './engine.js';

/** Raison du non-application d'une édition de label. */
export type EditLabelRejection = 'empty-label' | 'unknown-component' | 'unchanged';

/** Résultat explicite de la commande : le nouvel état + ce qui s'est passé. */
export interface EditLabelResult {
  /** Nouvel état (ou la MÊME référence si rien n'a changé). */
  state: PreviewBuildState;
  /** Vrai uniquement quand un nouveau state a été produit. */
  applied: boolean;
  reason?: EditLabelRejection | undefined;
}

export function updateComponentLabel(
  state: PreviewBuildState,
  componentId: string,
  newLabel: string
): EditLabelResult {
  const label = newLabel.trim();
  if (label.length === 0) {
    return { state, applied: false, reason: 'empty-label' };
  }
  const component = state.components.get(componentId);
  if (!component) {
    return { state, applied: false, reason: 'unknown-component' };
  }
  if (component.label === label) {
    return { state, applied: false, reason: 'unchanged' };
  }
  const updated: ComponentState = { ...component, label };
  const components = new Map(state.components);
  components.set(componentId, updated);
  return {
    state: { ...state, components },
    applied: true
  };
}

/* =====================================================================
 * ÉTAPE 17 — updateComponentVariant : changer la PRÉSENTATION d'un
 * composant (jamais son contenu). Même contrat que updateComponentLabel :
 * commande pure, immuable, résultats explicites. Le HTML réel IA
 * (metadata.html), l'id, le type métier, le label et le statut sont
 * intouchés ; les autres composants gardent leurs références.
 * ===================================================================== */

export interface EditVariantResult {
  /** Nouvel état (ou la MÊME référence si rien n'a changé). */
  state: PreviewBuildState;
  /** Vrai uniquement quand un nouveau state a été produit. */
  applied: boolean;
  reason?: 'invalid-variant' | 'unknown-component' | 'unchanged' | undefined;
}

/** Variant actuel d'un composant ('default' en l'absence de champ). */
export function componentVariant(component: ComponentState): PresentationVariant {
  return component.variant ?? 'default';
}

export function updateComponentVariant(
  state: PreviewBuildState,
  componentId: string,
  variant: string
): EditVariantResult {
  if (!(PRESENTATION_VARIANTS as readonly string[]).includes(variant)) {
    return { state, applied: false, reason: 'invalid-variant' };
  }
  const component = state.components.get(componentId);
  if (!component) {
    return { state, applied: false, reason: 'unknown-component' };
  }
  if (componentVariant(component) === variant) {
    return { state, applied: false, reason: 'unchanged' };
  }
  const updated: ComponentState = { ...component, variant: variant as PresentationVariant };
  const components = new Map(state.components);
  components.set(componentId, updated);
  return {
    state: { ...state, components },
    applied: true
  };
}

/* =====================================================================
 * ÉTAPE 18 — moveComponent : déplacement STRUCTUREL (parentId + ordre).
 *
 * Même contrat que les autres commandes : pure, immuable, résultats
 * explicites. Le composant déplacé est recréé avec SEULS parentId et
 * order modifiés (id, type, label É16, variant É17, metadata.html,
 * statut et stage intacts) ; les autres composants gardent leurs
 * références. Le nouvel order utilise l'insertion par index fractionnaire
 * entre les ordres existants : aucun frère n'est renuméroté.
 * targetParentId = null → racine. Cycles refusés (un composant ne peut
 * pas devenir son propre descendant).
 * ===================================================================== */

export interface MoveComponentResult {
  /** Nouvel état (ou la MÊME référence si rien n'a changé). */
  state: PreviewBuildState;
  applied: boolean;
  reason?: 'unknown-component' | 'unknown-parent' | 'cycle' | 'invalid-index' | 'invalid-target' | 'unchanged' | undefined;
}

/** Enfants d'un parent (null = racine), ordonnés comme le renderer. */
function siblingsOf(state: PreviewBuildState, parentId: string | null | undefined): ComponentState[] {
  const key = parentId ?? null;
  return [...state.components.values()]
    .filter((c) => (c.parentId ?? null) === key)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function moveComponent(
  state: PreviewBuildState,
  componentId: string,
  targetParentId: string | null,
  targetIndex: number
): MoveComponentResult {
  const component = state.components.get(componentId);
  if (!component) return { state, applied: false, reason: 'unknown-component' };
  if (!Number.isFinite(targetIndex)) return { state, applied: false, reason: 'invalid-index' };

  const newParentId = targetParentId === null ? undefined : targetParentId;
  if (newParentId !== undefined && !state.components.has(newParentId)) {
    return { state, applied: false, reason: 'unknown-parent' };
  }
  // Cycle : la cible ne peut pas être le composant lui-même ni un descendant.
  if (newParentId !== undefined) {
    let cursor: string | undefined = newParentId;
    while (cursor !== undefined) {
      if (cursor === componentId) return { state, applied: false, reason: 'cycle' };
      cursor = state.components.get(cursor)?.parentId;
    }
  }

  const currentParentKey = component.parentId ?? null;
  const sameParent = (newParentId ?? null) === currentParentKey;
  const before = siblingsOf(state, currentParentKey);
  const targetSiblings = sameParent
    ? before.filter((c) => c.id !== componentId)
    : siblingsOf(state, newParentId ?? null);
  // Bornage propre : 0..len (len = fin de liste)
  const index = Math.max(0, Math.min(targetSiblings.length, Math.trunc(targetIndex)));

  if (sameParent) {
    const beforeIds = before.map((c) => c.id).join('|');
    const afterIds = [...targetSiblings.slice(0, index).map((c) => c.id), componentId, ...targetSiblings.slice(index).map((c) => c.id)].join('|');
    if (beforeIds === afterIds) return { state, applied: false, reason: 'unchanged' };
  }

  // Nouvel order par insertion fractionnaire : AUCUN frère renuméroté.
  let newOrder: number;
  if (targetSiblings.length === 0) {
    newOrder = component.order; // seul enfant : son ordre suffit
  } else if (index === 0) {
    newOrder = targetSiblings[0]!.order - 1;
  } else if (index >= targetSiblings.length) {
    newOrder = targetSiblings[targetSiblings.length - 1]!.order + 1;
  } else {
    const prev = targetSiblings[index - 1]!.order;
    const next = targetSiblings[index]!.order;
    newOrder = prev < next ? (prev + next) / 2 : prev + 1;
  }

  const updated: ComponentState = {
    ...component,
    ...(newParentId !== undefined ? { parentId: newParentId } : { parentId: undefined }),
    order: newOrder
  };
  const components = new Map(state.components);
  components.set(componentId, updated);
  return { state: { ...state, components }, applied: true };
}

/* =====================================================================
 * ÉTAPE 19 — FONDATION DRAG & DROP (modèle pur, drag NON activé).
 *
 * moveComponent() reste l'UNIQUE source de vérité du déplacement : cette
 * fondation se borne à produire une { targetParentId, targetIndex } à
 * partir d'une intention (composant saisi + élément survolé + bord), puis
 * à DÉLÉGUER exclusivement à moveComponent(). Aucun état métier
 * supplémentaire dans PreviewBuildState, aucun DOM, aucun SSE.
 * ===================================================================== */

/** Sondage résolu depuis le DOM : élément survolé + bord de dépose. */
export interface DropProbe {
  hoveredId: string;
  edge: 'before' | 'after' | 'inside';
}

/** Intention de déplacement : composant saisi + sondage de dépose. */
export interface DragIntent extends DropProbe {
  componentId: string;
}

/** Cible structurelle calculée — les arguments exacts de moveComponent. */
export interface DropTarget {
  /** null = racine. */
  parentId: string | null;
  /** Position d'insertion parmi les enfants de la cible (ajustée). */
  index: number;
}

/**
 * É19 — convertit une intention en cible structurelle. PUR : même entrée →
 * même cible ; ne mute rien ; retourne null pour toute cible invalide
 * (inconnue, sur soi-même, dans son propre sous-arbre — cycles impossibles).
 * L'index est AJUSTÉ quand le composant déplacé est un frère situé avant le
 * point d'insertion (sa suppression décale la position d'une unité).
 */
export function computeDropTarget(state: PreviewBuildState, intent: DragIntent): DropTarget | null {
  if (!state.components.has(intent.componentId)) return null;
  const hovered = state.components.get(intent.hoveredId);
  if (!hovered) return null;
  // Cycle : l'élément survolé ne peut pas être soi-même ni un descendant
  // (la remontée de sa chaîne de parents croiserait le composant saisi).
  let cursor: string | undefined = intent.hoveredId;
  while (cursor !== undefined) {
    if (cursor === intent.componentId) return null;
    cursor = state.components.get(cursor)?.parentId;
  }
  if (intent.edge === 'inside') {
    // Déposer DANS l'élément survolé : il devient le parent, en fin de liste.
    const children = [...state.components.values()].filter((c) => c.parentId === intent.hoveredId);
    return { parentId: intent.hoveredId, index: children.length };
  }
  // before/after : même parent que l'élément survolé, à sa position (±1).
  const parentId = hovered.parentId ?? null;
  const siblings = [...state.components.values()]
    .filter((c) => (c.parentId ?? null) === parentId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  let index = siblings.findIndex((c) => c.id === intent.hoveredId);
  if (index < 0) return null;
  if (intent.edge === 'after') index += 1;
  const draggedIdx = siblings.findIndex((c) => c.id === intent.componentId);
  if (draggedIdx >= 0 && draggedIdx < index) index -= 1;
  return { parentId, index };
}

/**
 * É19 — applique une intention : computeDropTarget puis DÉLÉGATION
 * EXCLUSIVE à moveComponent (unique source de vérité du déplacement).
 * Cible invalide → état inchangé + raison explicite.
 */
export function applyDragIntent(state: PreviewBuildState, intent: DragIntent): MoveComponentResult {
  const target = computeDropTarget(state, intent);
  if (!target) {
    return { state, applied: false, reason: 'invalid-target' };
  }
  return moveComponent(state, intent.componentId, target.parentId, target.index);
}
