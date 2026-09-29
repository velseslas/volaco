/**
 * MOCK DE DÉMONSTRATION — ISOLÉ DU MOTEUR (à remplacer par la vraie
 * génération plus tard : AI GENERATOR → GENERATION PLAN → BUILD EVENTS).
 *
 * Ce module ne connaît que le format PreviewBuildEvent : il produit une
 * séquence d'événements de build temporellement espacés, aucun rendu.
 */

import type { PreviewBuildEvent } from './engine.js';

export interface MockComponentSpec {
  id: string;
  type: string;
  label: string;
  parentId?: string;
}

export interface MockBuildScript {
  /** Étapes franchies et composants créés, dans l'ordre du scénario. */
  steps: Array<
    | { at: number; kind: 'stage'; stage: 'structure' | 'sections' | 'components' | 'content' | 'styling' | 'responsive' | 'finalizing' }
    | { at: number; kind: 'component'; component: MockComponentSpec }
    | { at: number; kind: 'ready'; componentId: string }
    | { at: number; kind: 'sectionCompleted'; sectionId: string }
    | { at: number; kind: 'style'; componentId?: string }
    | { at: number; kind: 'completed' }
  >;
}

/**
 * Scénario de démonstration : START → structure → sections → composants
 * (1, 2, 3) → styling → responsive → completed.
 */
export function demoBuildScript(): MockBuildScript {
  return {
    steps: [
      { at: 0, kind: 'stage', stage: 'structure' },
      { at: 400, kind: 'stage', stage: 'sections' },
      { at: 800, kind: 'stage', stage: 'components' },
      { at: 900, kind: 'component', component: { id: 'comp-header', type: 'header', label: 'Header' } },
      { at: 1300, kind: 'ready', componentId: 'comp-header' },
      { at: 1500, kind: 'component', component: { id: 'comp-sidebar', type: 'sidebar', label: 'Side Bar' } },
      { at: 1900, kind: 'ready', componentId: 'comp-sidebar' },
      { at: 2100, kind: 'component', component: { id: 'comp-content', type: 'content', label: 'Content', parentId: 'comp-sidebar' } },
      { at: 2500, kind: 'ready', componentId: 'comp-content' },
      { at: 2700, kind: 'component', component: { id: 'comp-card-1', type: 'card', label: 'Card 1', parentId: 'comp-content' } },
      { at: 3100, kind: 'ready', componentId: 'comp-card-1' },
      { at: 3300, kind: 'component', component: { id: 'comp-card-2', type: 'card', label: 'Card 2', parentId: 'comp-content' } },
      { at: 3700, kind: 'ready', componentId: 'comp-card-2' },
      { at: 3900, kind: 'component', component: { id: 'comp-chart', type: 'chart', label: 'Chart', parentId: 'comp-content' } },
      { at: 4300, kind: 'ready', componentId: 'comp-chart' },
      { at: 4500, kind: 'stage', stage: 'content' },
      { at: 4900, kind: 'sectionCompleted', sectionId: 'comp-content' },
      { at: 5100, kind: 'stage', stage: 'styling' },
      { at: 5300, kind: 'style', componentId: 'comp-card-1' },
      { at: 5500, kind: 'style', componentId: 'comp-card-2' },
      { at: 5700, kind: 'stage', stage: 'responsive' },
      { at: 6100, kind: 'stage', stage: 'finalizing' },
      { at: 6500, kind: 'completed' }
    ]
  };
}

/** Convertit le scénario mocké en événements de build horodatés. */
export function scriptToEvents(script: MockBuildScript, baseTimestamp = Date.now()): PreviewBuildEvent[] {
  const events: PreviewBuildEvent[] = [{ kind: 'BUILD_STARTED', stage: 'structure', timestamp: baseTimestamp }];
  for (const step of script.steps) {
    const ts = baseTimestamp + step.at;
    switch (step.kind) {
      case 'stage':
        events.push({ kind: 'STAGE_ENTERED', stage: step.stage, timestamp: ts });
        break;
      case 'component':
        events.push({
          kind: 'COMPONENT_CREATED',
          component: {
            id: step.component.id,
            type: step.component.type,
            ...(step.component.label !== undefined ? { label: step.component.label } : {}),
            ...(step.component.parentId !== undefined ? { parentId: step.component.parentId } : {})
          },
          timestamp: ts
        });
        events.push({ kind: 'COMPONENT_BUILDING', componentId: step.component.id, timestamp: ts });
        break;
      case 'ready':
        events.push({ kind: 'COMPONENT_READY', componentId: step.componentId, timestamp: ts });
        break;
      case 'sectionCompleted':
        events.push({ kind: 'SECTION_COMPLETED', sectionId: step.sectionId, timestamp: ts });
        break;
      case 'style':
        events.push(
          step.componentId !== undefined
            ? { kind: 'STYLE_APPLIED', componentId: step.componentId, timestamp: ts }
            : { kind: 'STYLE_APPLIED', timestamp: ts }
        );
        break;
      case 'completed':
        events.push({ kind: 'BUILD_COMPLETED', timestamp: ts });
        break;
    }
  }
  return events;
}
