/**
 * VibeCode Core - AI-Native Engineering Tier
 * CDC V7.0 §25 — Validation Engine : chaîne unique ordonnée (types).
 *
 * Avant ce module, les briques de validation (parse réel, accessibilité
 * WCAG, harmonie design, structure) existaient mais ÉPARSES, sans chaîne
 * unique ni verdict global. Ce contrat fixe la forme du rapport de chaîne :
 * des étapes ORDONNÉES, chacune PASS / FAIL / WARN / SKIP avec preuves,
 * et UN verdict unique.
 *
 * Honnêteté : une étape indisponible est SKIP (jamais PASS par défaut),
 * une étape qui plante est FAIL (on ne valide pas sans avoir vérifié).
 */

export const VALIDATION_CHAIN_VERSION = '1.0.0';

/** Seuil d'alerte de l'étape design (score d'harmonie minimal, 0-100). */
export const DESIGN_SCORE_MIN = 70;

export type ValidationStageId = 'files' | 'syntax' | 'a11y' | 'design' | 'tests';

export type ValidationStageStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

export type ValidationVerdict = 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL';

export interface ValidationStageResult {
  readonly id: ValidationStageId;
  readonly label: string;
  readonly status: ValidationStageStatus;
  readonly detail: string;
  readonly evidence: readonly string[];
  readonly durationMs: number;
}

export interface ValidationChainReport {
  readonly schemaVersion: '1.0.0';
  readonly chainVersion: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly entryFile: string;
  readonly fileCount: number;
  /** Hash des contenus réellement validés (identité de l'état vérifié). */
  readonly treeHash: string;
  readonly verdict: ValidationVerdict;
  readonly stages: readonly ValidationStageResult[];
  readonly reportHash: string;
  readonly checkedAt: string;
}

export interface ValidationChainRequest {
  readonly tenantId: string;
  readonly projectId: string;
  /** Fichier d'entrée imposé (optionnel). S'il est fourni mais absent du projet, erreur — pas de repli silencieux. */
  readonly entryFile?: string | undefined;
}
