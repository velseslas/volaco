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
  RESIZE_BOUNDS,
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

/* =====================================================================
 * ÉTAPE 21 — resizeComponent : dimensions éditées (présentation seule).
 *
 * Commande pure, immuable, mêmes garanties que les autres : le composant
 * modifié ne voit QUE size changer — id, type, label É16, variant É17,
 * parentId, order, statut, stage et metadata.html intacts ; les autres
 * composants gardent leurs références. Dimensions non finies → refus ;
 * dimensions bornées par RESIZE_BOUNDS (clamp explicite).
 * ===================================================================== */

export interface ResizeComponentResult {
  /** Nouvel état (ou la MÊME référence si rien n'a changé). */
  state: PreviewBuildState;
  /** Vrai uniquement quand un nouveau state a été produit. */
  applied: boolean;
  reason?: 'unknown-component' | 'invalid-dimensions' | 'unchanged' | undefined;
}

export function resizeComponent(
  state: PreviewBuildState,
  componentId: string,
  width: number,
  height: number
): ResizeComponentResult {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { state, applied: false, reason: 'invalid-dimensions' };
  }
  const component = state.components.get(componentId);
  if (!component) {
    return { state, applied: false, reason: 'unknown-component' };
  }
  const w = Math.min(RESIZE_BOUNDS.maxWidth, Math.max(RESIZE_BOUNDS.minWidth, Math.round(width)));
  const h = Math.min(RESIZE_BOUNDS.maxHeight, Math.max(RESIZE_BOUNDS.minHeight, Math.round(height)));
  if (component.size && component.size.width === w && component.size.height === h) {
    return { state, applied: false, reason: 'unchanged' };
  }
  const updated: ComponentState = { ...component, size: { width: w, height: h } };
  const components = new Map(state.components);
  components.set(componentId, updated);
  return { state: { ...state, components }, applied: true };
}

/* =====================================================================
 * ÉTAPE 22 — updateTextContent : éditer le TEXTE du contenu réel IA.
 *
 * targetPath = chemin d'ÉLÉMENTS dans metadata.html (ex. [0,1] = 2e enfant
 * du 1er élément racine) — dérivé du contenu réel, jamais d'une position
 * DOM globale. La cible valide est un élément NE contenant QUE du texte
 * (aucun élément enfant) : son texte est remplacé, la structure et les
 * attributs sont intacts. Le texte est TOUJOURS échappé (&, <, >) — jamais
 * injecté comme HTML. Parseur HTML minimal sans dépendance (tokens ouvrant/
 * fermant/commentaire/doctype, éléments vides) — suffisant pour le HTML
 * bien formé produit par le générateur.
 * ===================================================================== */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Échappement texte : &, < et > uniquement (jamais d'injection HTML). */
function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface TextEditResult {
  /** Nouvel état (ou la MÊME référence si rien n'a changé). */
  state: PreviewBuildState;
  /** Vrai uniquement quand un nouveau state a été produit. */
  applied: boolean;
  reason?: 'unknown-component' | 'missing-content' | 'invalid-path' | 'not-textual' | 'empty-text' | 'unchanged' | undefined;
}

/** Élément localisé dans metadata.html par le parseur commun. */
interface LocatedElement {
  openStart: number;
  openEnd: number;
  innerStart: number;
  innerEnd: number; // -1 pour un élément void/self-closing
  tagName: string;
}

/**
 * É22/É23 — parseur commun : localise l'élément situé à `path` (chemin
 * d'éléments depuis la racine du HTML). Frames : isOnPath = tous les
 * ancêtres correspondent à path ; isTarget = l'élément au sommet est
 * exactement l'élément visé (profondeur path.length).
 */
function locateElement(html: string, path: number[]): { el: LocatedElement } | { reason: 'invalid-path' } {
  const stack: { childCount: number; isOnPath: boolean; isTarget: boolean }[] = [{ childCount: 0, isOnPath: true, isTarget: false }];
  let el: LocatedElement | null = null;
  const targetDepth = path.length;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break; // texte final
    if (html.startsWith('<!--', lt) || html.startsWith('<!', lt)) {
      const closeSeq = html.startsWith('<!--', lt) ? '-->' : '>';
      const end = html.indexOf(closeSeq, lt);
      i = end < 0 ? html.length : end + closeSeq.length;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt < 0) break;
    const body = html.slice(lt + 1, gt);
    if (body.startsWith('/')) {
      // Fermeture : si c'est la fin de la cible, on capture l'intérieur.
      const frame = stack.pop();
      if (frame && frame.isTarget && el) {
        el.innerEnd = lt;
        return { el };
      }
      i = gt + 1;
      continue;
    }
    const tagName = (body.match(/^[a-zA-Z0-9-]+/) || ['div'])[0].toLowerCase();
    const selfClosing = body.endsWith('/');
    const voidEl = VOID_TAGS.has(tagName);
    const parent = stack[stack.length - 1];
    if (!parent) return { reason: 'invalid-path' };
    const depth = stack.length; // profondeur du nouvel élément
    const isOnPath = parent.isOnPath && depth <= targetDepth && parent.childCount === path[depth - 1];
    const isTarget = el === null && isOnPath && depth === targetDepth;
    parent.childCount += 1;
    // É23 — un élément VOID (img, br…) peut être la cible : localisé avec un
    // intérieur vide (innerEnd = -1). Seuls les non-void sont empilés.
    if (isTarget) el = { openStart: lt, openEnd: gt + 1, innerStart: gt + 1, innerEnd: -1, tagName: tagName };
    if (!voidEl && !selfClosing) {
      stack.push({ childCount: 0, isOnPath: isOnPath, isTarget: isTarget });
    }
    i = gt + 1;
  }
  return el ? { el: el } : { reason: 'invalid-path' };
}

/** Remplace le texte de l'élément situé à `path` (cible textuelle uniquement). */
function editHtmlText(html: string, path: number[], text: string): { ok: true; html: string } | { ok: false; reason: 'invalid-path' | 'not-textual' } {
  const loc = locateElement(html, path);
  if ('reason' in loc) return { ok: false, reason: loc.reason };
  if (loc.el.innerEnd < 0) return { ok: false, reason: 'not-textual' }; // void : pas d'intérieur textuel
  const inner = html.slice(loc.el.innerStart, loc.el.innerEnd);
  // Cible NON textuelle : tout '<' interne = élément ou commentaire enfant.
  if (inner.includes('<')) return { ok: false, reason: 'not-textual' };
  const escaped = escapeHtmlText(text);
  if (inner === escaped) return { ok: true, html: html };
  return { ok: true, html: html.slice(0, loc.el.innerStart) + escaped + html.slice(loc.el.innerEnd) };
}

export function updateTextContent(
  state: PreviewBuildState,
  componentId: string,
  targetPath: number[],
  newText: string
): TextEditResult {
  const component = state.components.get(componentId);
  if (!component) return { state, applied: false, reason: 'unknown-component' };
  const html = component.metadata?.html;
  if (typeof html !== 'string' || html.length === 0) {
    return { state, applied: false, reason: 'missing-content' };
  }
  if (!Array.isArray(targetPath) || targetPath.length === 0 || !targetPath.every((k) => Number.isInteger(k) && k >= 0)) {
    return { state, applied: false, reason: 'invalid-path' };
  }
  if (newText.trim().length === 0) {
    return { state, applied: false, reason: 'empty-text' };
  }
  const outcome = editHtmlText(html, targetPath, newText);
  if (!outcome.ok) return { state, applied: false, reason: outcome.reason };
  if (outcome.html === html) return { state, applied: false, reason: 'unchanged' };
  // metadata.html reconstruit UNIQUEMENT par la transformation contrôlée du
  // texte ciblé : les autres clés de metadata et le reste du HTML intacts.
  const updated: ComponentState = {
    ...component,
    metadata: { ...component.metadata, html: outcome.html }
  };
  const components = new Map(state.components);
  components.set(componentId, updated);
  return { state: { ...state, components }, applied: true };
}

/* =====================================================================
 * ÉTAPE 23 — updateImageSource : éditer le src d'une IMAGE réelle IA.
 *
 * Même contrat que les autres commandes : pure, immuable, refus explicites.
 * targetPath localise l'élément dans metadata.html (parseur commun) ; la
 * cible doit être une balise <img> ('not-image' sinon). SEUL l'attribut src
 * est modifié (valeur d'attribut échappée : &, <, >, ") — tous les autres
 * attributs, le reste du HTML et toutes les autres propriétés du composant
 * sont intacts. Aucune injection possible : la valeur ne quitte jamais
 * l'attribut, jamais interprétée comme HTML.
 * ===================================================================== */

/** Échappement valeur d'attribut : &, <, > et " (jamais interprétés). */
function escapeHtmlAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ImageEditResult {
  /** Nouvel état (ou la MÊME référence si rien n'a changé). */
  state: PreviewBuildState;
  /** Vrai uniquement quand un nouveau state a été produit. */
  applied: boolean;
  reason?: 'unknown-component' | 'missing-content' | 'invalid-path' | 'not-image' | 'empty-src' | 'unchanged' | undefined;
}

export function updateImageSource(
  state: PreviewBuildState,
  componentId: string,
  targetPath: number[],
  newSrc: string
): ImageEditResult {
  const component = state.components.get(componentId);
  if (!component) return { state, applied: false, reason: 'unknown-component' };
  const html = component.metadata?.html;
  if (typeof html !== 'string' || html.length === 0) {
    return { state, applied: false, reason: 'missing-content' };
  }
  if (!Array.isArray(targetPath) || targetPath.length === 0 || !targetPath.every((k) => Number.isInteger(k) && k >= 0)) {
    return { state, applied: false, reason: 'invalid-path' };
  }
  const trimmed = newSrc.trim();
  if (trimmed.length === 0) return { state, applied: false, reason: 'empty-src' };
  const loc = locateElement(html, targetPath);
  if ('reason' in loc) return { state, applied: false, reason: loc.reason };
  const el = loc.el;
  if (el.tagName !== 'img') return { state, applied: false, reason: 'not-image' };
  const openTag = html.slice(el.openStart, el.openEnd);
  const match = openTag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const currentSrc = match ? (match[2] ?? match[3] ?? match[4] ?? '') : null;
  if (currentSrc !== null && currentSrc === trimmed) {
    return { state, applied: false, reason: 'unchanged' };
  }
  const escaped = escapeHtmlAttr(trimmed);
  let newTag: string;
  if (match && match.index !== undefined) {
    // Remplacement de la VALEUR uniquement — les autres attributs intacts.
    newTag = openTag.slice(0, match.index) + 'src="' + escaped + '"' + openTag.slice(match.index + match[0].length);
  } else {
    // Aucun src : ajouté comme attribut (jamais comme HTML libre).
    const inner = openTag.slice(1, -1);
    const at = inner.endsWith('/') ? inner.length - 1 : inner.length;
    newTag = '<' + inner.slice(0, at) + ' src="' + escaped + '"' + (at === inner.length - 1 ? ' /' : '') + '>';
  }
  const updated: ComponentState = {
    ...component,
    metadata: { ...component.metadata, html: html.slice(0, el.openStart) + newTag + html.slice(el.openEnd) }
  };
  const components = new Map(state.components);
  components.set(componentId, updated);
  return { state: { ...state, components }, applied: true };
}
