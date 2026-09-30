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

import type { ComponentState, PreviewBuildState } from './engine.js';

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
