/**
 * ÉTAPE 09 — FEATURE FLAG centralisé : PREVIEW_BUILDER_V2.
 *
 * Un seul endroit décide si le nouveau Preview Builder peut consommer le
 * flux réel de génération. Priorité : query `?v2=1|0` > localStorage
 * `PREVIEW_BUILDER_V2` > défaut OFF.
 *
 * Aucun autre fichier ne lit ces sources — tout le reste interroge ce module.
 */

export type PreviewBuilderFlag = 'on' | 'off';

export interface FlagSources {
  /** Query string de la page (ex : location.search → « ?v2=1 »). */
  search: string;
  /** Persistance locale (ex : localStorage.getItem). */
  storageGet?: (key: string) => string | null;
}

export const FLAG_STORAGE_KEY = 'PREVIEW_BUILDER_V2';

export function resolvePreviewBuilderV2(sources: FlagSources): PreviewBuilderFlag {
  // 1. Query prioritaire (démo/validation sans toucher la persistance)
  const query = new URLSearchParams(sources.search || '').get('v2');
  if (query === '1') return 'on';
  if (query === '0') return 'off';
  // 2. Persistance locale
  const stored = sources.storageGet ? sources.storageGet(FLAG_STORAGE_KEY) : null;
  if (stored === '1') return 'on';
  return 'off';
}
