/**
 * VibeCode Core - AI-Native Engineering Tier
 * CDC §12 — Application Model unifié : conteneur racine unique (types).
 *
 * Le modèle sémantique (AINT-004), la DNA (AINT-002), les révisions et la
 * mémoire conversationnelle existaient SÉPARÉMENT. Ce contrat définit le
 * conteneur racine qui les référence par leurs hashes/identités — sans
 * dupliquer leur contenu — et qui est PERSISTÉ par couple tenant+projet.
 *
 * Honnêteté : pas de modèle sans source réelle. Si ni compréhension ni DNA
 * ne sont extractibles, le builder retourne undefined (jamais de racine
 * fabriquée).
 */

import type { DNASummary } from '../dna/types.js';

export const APPLICATION_MODEL_SCHEMA_VERSION = '1.0.0';

export interface ApplicationModelUnderstandingSource {
  readonly understandingHash: string;
  readonly treeHash: string;
  readonly graphHash: string;
  readonly features: number;
  readonly domains: number;
  readonly workflows: number;
  readonly apis: number;
}

export interface ApplicationModelDnaSource {
  readonly dnaHash: string;
  readonly treeHash: string;
  readonly summary: DNASummary;
  readonly primaryLanguage: string;
  readonly primaryFramework: string;
}

export interface ApplicationModelRevisionsSource {
  readonly count: number;
  readonly latestRevisionId?: string | undefined;
  readonly latestRevisionNumber?: number | undefined;
  readonly latestCreatedAt?: string | undefined;
}

export interface ApplicationModelMemorySource {
  readonly architecturalDecisions: number;
  readonly acceptedPlans: number;
  readonly rejectedPlans: number;
  readonly knownConstraints: number;
  readonly knownConventions: number;
  readonly knownRisks: number;
}

/**
 * P0 (audit 2026-10) — §23 : la Design Memory n'est pas un silo. Le modèle
 * racine référence les décisions design réelles (id/statuts/compteurs),
 * sans dupliquer leur contenu.
 */
export interface ApplicationModelDesignMemorySource {
  readonly totalCount: number;
  readonly activeCount: number;
  readonly ignoredOpportunities: number;
  readonly latestDecisionId?: string | undefined;
  readonly latestRecordedAt?: string | undefined;
}

export interface ApplicationModelSources {
  readonly understanding?: ApplicationModelUnderstandingSource | undefined;
  readonly dna?: ApplicationModelDnaSource | undefined;
  readonly revisions?: ApplicationModelRevisionsSource | undefined;
  readonly memory?: ApplicationModelMemorySource | undefined;
  readonly designMemory?: ApplicationModelDesignMemorySource | undefined;
}

export interface ApplicationModelRoot {
  readonly schemaVersion: '1.0.0';
  /** Identifiant déterministe : 'am:' + 16 premiers caractères du modelHash. */
  readonly modelId: string;
  readonly modelHash: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly builtAt: string;
  readonly sourceCount: number;
  readonly sources: ApplicationModelSources;
}
