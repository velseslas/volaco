/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Pre-Mutation Validation Gate & Impact Verification Engine
 */

import { logger } from '../../../logger.js';
import { deepFreeze } from '../canonical.js';
import type { Role } from '../../../identity/permissions.js';
import type { ImpactIntelligenceService } from '../../impact-intelligence/service.js';
import type { ImpactAnalysis } from '../../impact-intelligence/types.js';
import type { AgentArtifact, ProposedFileChangePayload } from '../types.js';

export interface ValidationGateResult {
  readonly isValid: boolean;
  readonly requiresHumanApproval: boolean;
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly impactReport?: ImpactAnalysis | undefined;
  readonly validationErrors: readonly string[];
}

export class ValidationGate {
  constructor(
    private readonly impactService?: ImpactIntelligenceService | undefined
  ) {}

  public async validateArtifacts(params: {
    artifacts: readonly AgentArtifact[];
    tenantId: string;
    projectId: string;
    userRole?: Role | undefined;
    requestId?: string | undefined;
  }): Promise<ValidationGateResult> {
    const { artifacts, tenantId, projectId, userRole = 'OWNER', requestId } = params;
    const validationErrors: string[] = [];

    // Collect all targeted files
    const allTargetFilesSet = new Set<string>();
    let hasDelete = false;

    for (const art of artifacts) {
      for (const file of art.targetFiles) {
        allTargetFilesSet.add(file);
      }
      if (art.kind === 'PROPOSED_FILE_CHANGE') {
        const payload = art.payload as ProposedFileChangePayload;
        if (payload?.operation === 'DELETE') {
          hasDelete = true;
        }
        if (!payload?.filePath) {
          validationErrors.push(`Artefact '${art.id}' invalide : filePath manquant.`);
        }
      }
    }

    const targetFiles = Array.from(allTargetFilesSet);

    // If impact service available, perform deep blast radius analysis
    let impactReport: ImpactAnalysis | undefined;
    let riskLevel: ValidationGateResult['riskLevel'] = 'LOW';

    if (this.impactService && targetFiles.length > 0) {
      try {
        impactReport = this.impactService.analyzeImpact(
          {
            tenantId,
            projectId,
            targetFiles
          },
          userRole,
          requestId
        );
        riskLevel = impactReport.overallRisk;
      } catch (err) {
        logger.warn('Échec du calcul d\'impact pour riskLevel — fallback heuristique', {
          component: 'validation-gate',
          hasDelete,
          targetFilesCount: targetFiles.length,
          err: err instanceof Error ? err.message : String(err)
        });
        riskLevel = hasDelete ? 'HIGH' : targetFiles.length > 3 ? 'MEDIUM' : 'LOW';
      }
    } else {
      riskLevel = hasDelete ? 'HIGH' : targetFiles.length > 3 ? 'MEDIUM' : 'LOW';
    }

    const requiresHumanApproval = hasDelete || riskLevel === 'HIGH' || riskLevel === 'CRITICAL';
    const isValid = validationErrors.length === 0;

    return deepFreeze({
      isValid,
      requiresHumanApproval,
      riskLevel,
      impactReport,
      validationErrors
    });
  }
}
