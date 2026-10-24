/**
 * VibeCode Core - AI-Native Engineering Tier
 * CDC §12 — Builder du conteneur racine Application Model.
 *
 * Fonction PURE : assemble le modèle racine à partir des sources RÉELLES
 * fournies (modèle sémantique, DNA, révisions, mémoire). Le hash du modèle
 * ne dépend QUE des références de contenu (hashes / dernier id / compteurs
 * mémoire) — jamais de builtAt — donc : mêmes sources → même modelId.
 *
 * Refus honnête : sans compréhension NI DNA, aucune racine n'est fabriquée
 * (retourne undefined).
 */

import { createHash } from 'node:crypto';
import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { ValidationError } from '../../errors.js';
import type { ApplicationSemanticModel } from '../application-understanding/types.js';
import type { ApplicationDNA } from '../dna/types.js';
import type { ApplicationRevision } from '../../model/revision.js';
import type { ProjectMemory } from '../conversation-intelligence/types.js';
import type { DesignMemoryDecision } from '../design-harmony/design-memory.js';
import {
  APPLICATION_MODEL_SCHEMA_VERSION,
  type ApplicationModelDesignMemorySource,
  type ApplicationModelRoot,
  type ApplicationModelSources
} from './types.js';

export interface BuildApplicationModelInput {
  readonly tenantId: string;
  readonly projectId: string;
  /** Horodatage d'assemblage (exclu du hash — identité par contenu). */
  readonly builtAt: string;
  readonly understanding?: ApplicationSemanticModel | undefined;
  readonly dna?: ApplicationDNA | undefined;
  readonly revisions?: readonly ApplicationRevision[] | undefined;
  readonly memory?: ProjectMemory | undefined;
  /**
   * P0 (audit 2026-10) — décisions Design Memory RÉELLES (§23/§24). Les
   * entrées d'un autre couple tenant/projet sont ignorées, jamais fusionnées.
   */
  readonly designDecisions?: readonly DesignMemoryDecision[] | undefined;
}

function assertSourceBelongsToProject(params: {
  tenantId: string;
  projectId: string;
  sourceTenantId: string;
  sourceProjectId: string;
  label: string;
}): void {
  if (params.sourceTenantId !== params.tenantId || params.sourceProjectId !== params.projectId) {
    throw new ValidationError(
      `Source '${params.label}' incohérente : ${params.sourceTenantId}/${params.sourceProjectId} ≠ ${params.tenantId}/${params.projectId}`,
      { field: 'tenantId' }
    );
  }
}

/**
 * Hash déterministe du contenu de référence du modèle. Exclut builtAt.
 */
export function computeApplicationModelHash(params: {
  tenantId: string;
  projectId: string;
  sources: ApplicationModelSources;
}): string {
  const { sources } = params;
  const raw = [
    params.tenantId,
    params.projectId,
    APPLICATION_MODEL_SCHEMA_VERSION,
    `u=${sources.understanding?.understandingHash ?? '-'}`,
    `d=${sources.dna?.dnaHash ?? '-'}`,
    `r=${sources.revisions?.latestRevisionId ?? '-'}`,
    `m=${sources.memory ? JSON.stringify(sources.memory) : '-'}`,
    `dm=${sources.designMemory
      ? `${sources.designMemory.totalCount}/${sources.designMemory.activeCount}/${sources.designMemory.latestDecisionId ?? '-'}`
      : '-'}`
  ].join('|');
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function buildApplicationModel(input: BuildApplicationModelInput): ApplicationModelRoot | undefined {
  const tenantId = input.tenantId.trim();
  const projectId = input.projectId.trim();
  if (tenantId.length === 0) {
    throw new ValidationError('Le tenantId est obligatoire pour l Application Model', { field: 'tenantId' });
  }
  if (projectId.length === 0) {
    throw new ValidationError('Le projectId est obligatoire pour l Application Model', { field: 'projectId' });
  }

  if (input.understanding) {
    assertSourceBelongsToProject({
      tenantId,
      projectId,
      sourceTenantId: input.understanding.tenantId,
      sourceProjectId: input.understanding.projectId,
      label: 'understanding'
    });
  }
  if (input.dna) {
    assertSourceBelongsToProject({
      tenantId,
      projectId,
      sourceTenantId: input.dna.tenantId,
      sourceProjectId: input.dna.projectId,
      label: 'dna'
    });
  }

  const understanding = input.understanding
    ? {
        understandingHash: input.understanding.understandingHash,
        treeHash: input.understanding.treeHash,
        graphHash: input.understanding.graphHash,
        features: input.understanding.features.length,
        domains: input.understanding.domains.length,
        workflows: input.understanding.workflows.length,
        apis: input.understanding.apis.length
      }
    : undefined;

  const dna = input.dna
    ? {
        dnaHash: input.dna.dnaHash,
        treeHash: input.dna.treeHash,
        summary: input.dna.summary,
        primaryLanguage: input.dna.stack.language.name,
        primaryFramework: input.dna.stack.framework.name
      }
    : undefined;

  const revisionList = input.revisions ?? [];
  const latestRevision = revisionList.length > 0
    ? revisionList.reduce((latest, current) =>
        current.revisionNumber > latest.revisionNumber ? current : latest
      )
    : undefined;
  const revisions = latestRevision
    ? {
        count: revisionList.length,
        latestRevisionId: latestRevision.id,
        latestRevisionNumber: latestRevision.revisionNumber,
        latestCreatedAt: latestRevision.createdAt instanceof Date
          ? latestRevision.createdAt.toISOString()
          : String(latestRevision.createdAt)
      }
    : undefined;

  const memory = input.memory
    ? {
        architecturalDecisions: input.memory.architecturalDecisions.length,
        acceptedPlans: input.memory.acceptedPlans.length,
        rejectedPlans: input.memory.rejectedPlans.length,
        knownConstraints: input.memory.knownConstraints.length,
        knownConventions: input.memory.knownConventions.length,
        knownRisks: input.memory.knownRisks.length
      }
    : undefined;

  // P0 (audit 2026-10) — §23 : références RÉELLES des décisions Design Memory
  // du couple tenant/projet (les entrées étrangères sont ignorées).
  const designList = (input.designDecisions ?? []).filter(
    (decision) => decision.tenantId === tenantId && decision.projectId === projectId
  );
  const activeDesign = designList.filter((decision) => decision.status === 'ACTIVE');
  const latestDesign = designList.length > 0
    ? designList.reduce((latest, current) => (current.recordedAt > latest.recordedAt ? current : latest))
    : undefined;
  const designMemory: ApplicationModelDesignMemorySource | undefined = designList.length > 0
    ? {
        totalCount: designList.length,
        activeCount: activeDesign.length,
        ignoredOpportunities: activeDesign.filter((decision) => decision.kind === 'IGNORE_OPPORTUNITY').length,
        ...(latestDesign
          ? { latestDecisionId: latestDesign.id, latestRecordedAt: latestDesign.recordedAt }
          : {})
      }
    : undefined;

  // Refus honnête : ni compréhension ni DNA → pas de racine.
  if (!understanding && !dna) return undefined;

  const sources: ApplicationModelSources = { understanding, dna, revisions, memory, designMemory };
  const modelHash = computeApplicationModelHash({ tenantId, projectId, sources });
  const sourceCount = [understanding, dna, revisions, memory, designMemory].filter((s) => s !== undefined).length;

  return deepFreeze({
    schemaVersion: APPLICATION_MODEL_SCHEMA_VERSION,
    modelId: `am:${modelHash.substring(0, 16)}`,
    modelHash,
    tenantId,
    projectId,
    builtAt: input.builtAt,
    sourceCount,
    sources
  });
}
