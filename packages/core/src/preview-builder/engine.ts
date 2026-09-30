/**
 * PREVIEW BUILDER — modèle d'état et d'événements (nouveau système indépendant).
 *
 * Ce module est la FONDATION du nouveau preview : une machine à états de
 * construction alimentée par des événements de build. Il ne connaît NI le
 * LLM, NI le SSE, NI l'ancien preview — il consomme des événements et
 * détermine ce qui doit être affiché :
 *
 *   composant pending   → pas encore affiché
 *   composant building  → affiché avec état de construction
 *   composant completed → affiché
 *
 * Contraintes : TypeScript strict, zéro dépendance, zéro import Node —
 * le fichier compilé est consommable tel quel dans le navigateur.
 * L'ancien preview (apps/studio) n'est pas concerné par ce module.
 */

/** Étapes de construction, dans l'ordre du pipeline. */
export const BUILD_STAGES = [
  'idle',
  'structure',
  'sections',
  'components',
  'content',
  'styling',
  'responsive',
  'finalizing',
  'completed'
] as const;

export type BuildStage = (typeof BUILD_STAGES)[number];

/** Étape d'erreur — hors pipeline (n'importe quel état peut y arriver). */
export const ERROR_STAGE = 'error' as const;

export type AnyStage = BuildStage | typeof ERROR_STAGE;

export type ComponentStatus = 'pending' | 'building' | 'completed' | 'error';

/** Composant générique : identifiant + type libre (rien n'est hardcodé). */
/**
 * ÉTAPE 17 — variants de présentation (strictement additif) : la PRÉSENTATION
 * d'un composant, jamais son contenu. Le registry/CSS dérive le rendu ; le
 * HTML réel IA (metadata.html) n'est pas concerné.
 */
export const PRESENTATION_VARIANTS = ['default', 'compact', 'featured', 'wide'] as const;
export type PresentationVariant = (typeof PRESENTATION_VARIANTS)[number];

export interface ComponentState {
  id: string;
  type: string;
  label?: string;
  parentId?: string;
  status: ComponentStatus;
  /** Étape de construction à laquelle le composant appartient. */
  stage: AnyStage;
  order: number;
  /** Raison de l'échec quand status = 'error' — le reste du build continue. */
  error?: string | undefined;
  metadata?: Record<string, unknown>;
  /**
   * ÉTAPE 17 — variant de présentation choisi par l'utilisateur (commande
   * d'édition). Absent = 'default'. Préservé par les handlers (spread) ;
   * une nouvelle construction repart sans variant (aucune fuite).
   */
  variant?: PresentationVariant | undefined;
}

/** Événements de construction consommés par le moteur. */
export type PreviewBuildEvent =
  | { kind: 'BUILD_STARTED'; stage?: BuildStage; timestamp: number }
  | { kind: 'STAGE_ENTERED'; stage: BuildStage; timestamp: number }
  | {
      kind: 'COMPONENT_CREATED';
      component: { id: string; type: string; label?: string; parentId?: string; stage?: BuildStage; metadata?: Record<string, unknown> };
      timestamp: number;
    }
  | { kind: 'COMPONENT_BUILDING'; componentId: string; timestamp: number }
  /** ÉTAPE 10 — COMPONENT_READY transporte les données réelles (ex. metadata.html généré par l'IA). */
  | { kind: 'COMPONENT_READY'; componentId: string; timestamp: number; metadata?: Record<string, unknown> }
  | { kind: 'COMPONENT_FAILED'; componentId: string; error: string; timestamp: number }
  | { kind: 'COMPONENT_REMOVED'; componentId: string; timestamp: number }
  | { kind: 'STYLE_APPLIED'; componentId?: string; stage?: BuildStage; timestamp: number }
  | { kind: 'SECTION_COMPLETED'; sectionId: string; timestamp: number }
  | { kind: 'BUILD_COMPLETED'; timestamp: number }
  | { kind: 'BUILD_FAILED'; error: string; timestamp: number }
  /** ÉTAPE 08 — extension additive : annulation du générateur réel (⏹ ≠ ❌). */
  | { kind: 'BUILD_CANCELLED'; reason?: string; timestamp: number }
  | { kind: 'BUILD_RESET'; timestamp: number };

export type PreviewBuildStatus = 'idle' | 'building' | 'completed' | 'error' | 'cancelled';

/** État complet d'une construction — immuable : chaque événement produit un nouvel état. */
export interface PreviewBuildState {
  status: PreviewBuildStatus;
  stage: AnyStage;
  components: ReadonlyMap<string, ComponentState>;
  completedSections: ReadonlySet<string>;
  error?: string | undefined;
  startedAt?: number | undefined;
  completedAt?: number | undefined;
  /** Journal brut des événements consommés (traçabilité / replay / debug). */
  events: readonly PreviewBuildEvent[];
  /** Compteur d'événements ignorés (événements hors cycle, ids inconnus…). */
  ignoredCount: number;
}

export function createPreviewBuildState(): PreviewBuildState {
  return {
    status: 'idle',
    stage: 'idle',
    components: new Map(),
    completedSections: new Set(),
    events: [],
    ignoredCount: 0
  };
}

/** Composants à AFFICHER : completed (solides) + building (en construction). */
export function visibleComponents(state: PreviewBuildState): ComponentState[] {
  return [...state.components.values()]
    .filter((c) => c.status === 'completed' || c.status === 'building')
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Composants annoncés mais pas encore construits. */
export function pendingComponents(state: PreviewBuildState): ComponentState[] {
  return [...state.components.values()]
    .filter((c) => c.status === 'pending')
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * Applique un événement et retourne le NOUVEL état (le précédent reste
 * intact — compatible avec un rendu déclaratif futur).
 */
export function applyBuildEvent(state: PreviewBuildState, event: PreviewBuildEvent): PreviewBuildState {
  const withLog = { ...state, events: [...state.events, event] };
  const ignore = (): PreviewBuildState => ({ ...withLog, ignoredCount: withLog.ignoredCount + 1 });

  switch (event.kind) {
    case 'BUILD_STARTED':
      return {
        ...withLog,
        status: 'building',
        stage: event.stage ?? withLog.stage,
        components: new Map(),
        completedSections: new Set(),
        error: undefined,
        startedAt: event.timestamp,
        completedAt: undefined
      };

    case 'BUILD_RESET':
      return createPreviewBuildState();

    case 'STAGE_ENTERED': {
      if (withLog.status !== 'building') return ignore();
      return { ...withLog, stage: event.stage };
    }

    case 'COMPONENT_CREATED': {
      if (withLog.status !== 'building') return ignore();
      const { id, type, label, parentId, stage, metadata } = event.component;
      if (!id || !type) return ignore();
      const previous = withLog.components.get(id);
      const component: ComponentState = {
        id,
        type,
        ...(label !== undefined ? { label } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
        status: 'pending',
        stage: stage ?? withLog.stage,
        order: previous ? previous.order : withLog.components.size,
        ...(metadata !== undefined ? { metadata } : previous && previous.metadata ? { metadata: previous.metadata } : {})
      };
      return { ...withLog, components: new Map(withLog.components).set(id, component) };
    }

    case 'COMPONENT_BUILDING':
    case 'COMPONENT_READY': {
      if (withLog.status !== 'building') return ignore();
      const component = withLog.components.get(event.componentId);
      if (!component) return ignore();
      // Les données réelles (metadata.html…) arrivent à READY : fusionnées
      // avec celles éventuellement posées à CREATED, jamais écrasées.
      const readyMetadata =
        event.kind === 'COMPONENT_READY' && event.metadata !== undefined
          ? { ...component.metadata, ...event.metadata }
          : component.metadata;
      const next: ComponentState = {
        ...component,
        status: event.kind === 'COMPONENT_BUILDING' ? 'building' : 'completed',
        error: undefined,
        ...(readyMetadata !== undefined ? { metadata: readyMetadata } : {})
      };
      return { ...withLog, components: new Map(withLog.components).set(event.componentId, next) };
    }

    case 'COMPONENT_FAILED': {
      // Un composant en échec N'INTERROMPT PAS le build : le reste continue
      // (exigence LOT 02 — l'état d'erreur est local au composant).
      if (withLog.status !== 'building') return ignore();
      const component = withLog.components.get(event.componentId);
      if (!component) return ignore();
      const next: ComponentState = { ...component, status: 'error', error: event.error };
      return { ...withLog, components: new Map(withLog.components).set(event.componentId, next) };
    }

    case 'COMPONENT_REMOVED': {
      if (withLog.status !== 'building') return ignore();
      if (!withLog.components.has(event.componentId)) return ignore();
      const components = new Map(withLog.components);
      components.delete(event.componentId);
      return { ...withLog, components };
    }

    case 'STYLE_APPLIED': {
      if (withLog.status !== 'building') return ignore();
      let components = withLog.components;
      if (event.componentId) {
        const component = components.get(event.componentId);
        if (!component) return ignore();
        components = new Map(components).set(event.componentId, {
          ...component,
          metadata: { ...component.metadata, styleApplied: true }
        });
      }
      return {
        ...withLog,
        components,
        stage: event.stage ?? withLog.stage
      };
    }

    case 'SECTION_COMPLETED': {
      if (withLog.status !== 'building') return ignore();
      const completedSections = new Set(withLog.completedSections);
      completedSections.add(event.sectionId);
      return { ...withLog, completedSections };
    }

    case 'BUILD_COMPLETED': {
      if (withLog.status !== 'building') return ignore();
      return { ...withLog, status: 'completed', stage: 'completed', completedAt: event.timestamp };
    }

    case 'BUILD_FAILED':
      return { ...withLog, status: 'error', stage: ERROR_STAGE, error: event.error, completedAt: event.timestamp };

    case 'BUILD_CANCELLED':
      // ⏹ ≠ ❌ (spec LOT 31/32) : l'annulation n'est pas un échec — l'état
      // final conserve les composants déjà construits, sans label d'erreur.
      return { ...withLog, status: 'cancelled', completedAt: event.timestamp };

    default:
      return ignore();
  }
}

/**
 * Réduit une séquence d'événements (replay, mock, futur flux de génération).
 */
export function applyBuildEvents(state: PreviewBuildState, events: readonly PreviewBuildEvent[]): PreviewBuildState {
  return events.reduce(applyBuildEvent, state);
}
