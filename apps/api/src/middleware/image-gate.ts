/**
 * PATCH-R3-B — porte d'images partagée des routes d'écriture (B1/B2/B3).
 *
 * Cité unique : inspectAppImageSources / formatImageViolations
 * (packages/core/src/image/app-policy.ts) — EXACTEMENT le même checker que le
 * pipeline (génération / édition / rollback / MCP). Aucune politique
 * dupliquée ici, aucun scanner parallèle : la route se contente de remettre
 * au checker les contenus qu'elle va écrire.
 *
 * Garanties :
 *  1. le contenu inspecté est EXACTEMENT celui qui sera persisté ;
 *  2. au moindre doute (exception du vérificateur) → refus fail-closed, la
 *     route n'écrit rien ;
 *  3. `undetermined` reste un état distinct et NON bloquant — jamais
 *     interprété comme une validation de sécurité (convention du pipeline,
 *     documentée dans app-policy.ts) ;
 *  4. le refus n'écrit RIEN — convention PATCH-2 : HTTP 200 +
 *     { success:false, refused, imageIssues, requestId }.
 */

import {
  formatImageViolations,
  inspectAppImageSources,
  type AppImageInspection
} from '../../../../packages/core/src/image/app-policy.js';
import { adoptedImageIds } from '../../../../packages/core/src/image/image-adoptions.js';

/**
 * Entrée d'inspection : le chemin (tel que la politique doit le voir) et le
 * contenu EXACT qui sera persisté.
 */
export interface ImageGateInput {
  readonly path: string;
  readonly content: string;
}

/**
 * Signature du vérificateur — compatible avec inspectAppImageSources.
 * L'injection ne sert qu'aux tests du fail-closed (seam unitaire) : le
 * checker réel ne lève pas d'exception sur des chaînes habituelles, donc une
 * erreur d'inspection n'est pas injectable via le schéma HTTP public.
 */
export type ImageGateInspector = (
  files: ReadonlyArray<{ path: string; content: string }>
) => AppImageInspection;

/** 'violations' et 'inspection-error' entraînent un refus ; 'clean' poursuit. */
export type ImageGateKind = 'clean' | 'violations' | 'inspection-error';

export interface ImageGateOutcome {
  readonly kind: ImageGateKind;
  /** Issues formatées (lisible côté client). Vide pour 'clean'. */
  readonly imageIssues: string[];
  /**
   * Références `undetermined` : comptées et exposées, NON bloquantes. Un
   * compteur non nul ne valide jamais le contenu — c'est le contrat explicite
   * de la politique (référence dynamique, non vérifiable statiquement).
   */
  readonly undeterminedCount: number;
}

/**
 * Inspecte les contenus via le checker du pipeline, enrichi du journal
 * d'adoptions (photo-IDs Unsplash réellement fetchés — clé usager). Toute
 * exception est convertie en refus fail-closed ('inspection-error') : au
 * moindre doute, la route n'écrit rien.
 */
export function imageGateInspect(
  inputs: ReadonlyArray<ImageGateInput>,
  inspect: ImageGateInspector = (files) =>
    inspectAppImageSources(files, { adoptedIds: adoptedImageIds() })
): ImageGateOutcome {
  try {
    const inspection = inspect(inputs);
    const undeterminedCount = inspection.undetermined.length;
    if (inspection.violations.length > 0) {
      return {
        kind: 'violations',
        imageIssues: formatImageViolations(inspection),
        undeterminedCount
      };
    }
    return { kind: 'clean', imageIssues: [], undeterminedCount };
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 180);
    return {
      kind: 'inspection-error',
      imageIssues: [
        `inspection des références d images en échec : contenu refusé par précaution (fail-closed) — ${detail}`
      ],
      undeterminedCount: 0
    };
  }
}

/**
 * B3 — construit les entrées d'inspection depuis la carte `files` telle
 * qu'elle sera transmise à createRevision : SEULES les valeurs string non
 * vides sont des contenus persistables (une valeur non string lèverait de
 * toute façon dans createFileArtifact — comportement préexistant : échec
 * AVANT toute persistance, donc aucune brèche de couverture).
 *
 * Le préfixe `app/` est dépouillé UNIQUEMENT dans le chemin transmis au
 * checker (convention PATCH-2 exacte : la politique raisonne sur des chemins
 * relatifs à l'application). Les chemins persistés ne sont PAS modifiés.
 */
export function imageGateInputsFromFilesMap(files: unknown): ImageGateInput[] {
  const inputs: ImageGateInput[] = [];
  if (!files || typeof files !== 'object') {
    return inputs;
  }
  for (const [path, value] of Object.entries(files as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.length === 0) {
      continue;
    }
    inputs.push({
      path: path.startsWith('app/') ? path.slice(4) : path,
      content: value
    });
  }
  return inputs;
}
