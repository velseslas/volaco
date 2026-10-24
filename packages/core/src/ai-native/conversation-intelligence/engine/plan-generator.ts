/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Engineering Plan Generator & Assessor
 */

import { computeEngineeringPlanHash } from './canonical.js';
import type { ApplicationSemanticModel } from '../../application-understanding/types.js';
import type {
  ConversationAssumption,
  EngineeringPlan,
  IntentResult,
  PlanAssessment,
  PlanStep
} from '../types.js';

export class PlanGenerator {
  public generatePlan(params: {
    intent: IntentResult;
    assumptions?: readonly ConversationAssumption[] | undefined;
    semanticModel?: ApplicationSemanticModel | undefined;
    contextConstraints?: readonly string[] | undefined;
    /**
     * Cibles explicites fournies par l'appelant quand l'intent ou le modèle
     * ne permettent pas de déduire un fichier. Le flux Studio fournit
     * `index.html` ; le moteur conversationnel générique peut l'omettre.
     */
    defaultTargetFiles?: readonly string[] | undefined;
  }): EngineeringPlan {
    const { intent, semanticModel } = params;

    const planId = `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const targetDomain = intent.domain || semanticModel?.summary.highestRiskAreas[0] || 'core';
    const targetFiles: string[] = [];

    for (const entity of intent.entities) {
      if (entity.includes('.') || entity.includes('/')) {
        targetFiles.push(entity);
      }
    }

    if (targetFiles.length === 0 && semanticModel?.domains) {
      const matchingDomain = semanticModel.domains.find(
        (d: { name: string; relatedFiles: readonly string[] }) =>
          d.name.toLowerCase().includes(targetDomain.toLowerCase())
      );
      if (matchingDomain && matchingDomain.relatedFiles.length > 0) {
        targetFiles.push(...matchingDomain.relatedFiles.slice(0, 3));
      }
    }

    if (targetFiles.length === 0) {
      for (const file of params.defaultTargetFiles ?? []) {
        if (!targetFiles.includes(file)) {
          targetFiles.push(file);
        }
      }
    }

    const steps: PlanStep[] = [];

    steps.push({
      stepIndex: 1,
      title: `Inspect ${targetDomain} architecture and prerequisites`,
      description: `Analyze existing structure and dependencies for ${intent.requestedAction}.`,
      targetDomain,
      targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
      operation: 'ANALYZE',
      requiresApproval: false
    });

    const isDestructive = intent.category === 'DELETE';
    const opType: PlanStep['operation'] = isDestructive
      ? 'DELETE'
      : intent.category === 'CREATE'
      ? 'CREATE'
      : 'MODIFY';

    steps.push({
      stepIndex: 2,
      title: `Execute ${intent.requestedAction} in ${targetDomain}`,
      description: `Apply required code changes to satisfy goal: ${intent.goal}.`,
      targetDomain,
      targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
      operation: opType,
      requiresApproval: isDestructive || intent.urgency === 'HIGH'
    });

    steps.push({
      stepIndex: 3,
      title: `Verify changes and ensure zero regressions`,
      description: `Run automated checks, type checks and integration verifications.`,
      targetDomain,
      targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
      operation: 'VERIFY',
      requiresApproval: false
    });

    const summary = `Plan for ${intent.goal} covering ${steps.length} steps in domain '${targetDomain}'.`;
    const estimatedImpact = targetFiles.length > 0
      ? `Affects ${targetFiles.length} file(s): ${targetFiles.join(', ')}`
      : `Standard blast radius within ${targetDomain}`;

    const partialPlan = {
      planId,
      title: `Engineering Plan: ${intent.requestedAction}`,
      summary,
      steps,
      estimatedImpact,
      status: 'DRAFT' as const
    };

    const planHash = computeEngineeringPlanHash(partialPlan);

    return {
      ...partialPlan,
      planHash
    };
  }

  public assessPlan(plan: EngineeringPlan, semanticModel?: ApplicationSemanticModel | undefined): PlanAssessment {
    const issues: string[] = [];
    let completeness = 1.0;
    let consistency = 1.0;

    if (plan.steps.length === 0) {
      completeness = 0.0;
      issues.push('Plan does not contain any execution steps.');
    } else if (plan.steps.length < 2) {
      completeness = 0.5;
      issues.push('Plan has fewer than 2 steps (missing analysis or verification).');
    }

    const hasVerifyStep = plan.steps.some((s) => s.operation === 'VERIFY');
    if (!hasVerifyStep) {
      completeness = Math.max(0.4, completeness - 0.3);
      issues.push('Plan lacks a dedicated verification step.');
    }

    const hasAnalyzeFirst = plan.steps[0]?.operation === 'ANALYZE';
    if (!hasAnalyzeFirst && plan.steps.length > 1) {
      consistency -= 0.2;
    }

    const hasDelete = plan.steps.some((s) => s.operation === 'DELETE');
    const hasModify = plan.steps.some((s) => s.operation === 'MODIFY');
    let riskLevel: PlanAssessment['riskLevel'] = 'LOW';
    let reversibility = true;

    if (hasDelete) {
      riskLevel = 'HIGH';
      reversibility = false;
      issues.push('Destructive deletion step detected; operation may be irreversible without VCS rollback.');
    } else if (hasModify && plan.steps.length > 4) {
      riskLevel = 'MEDIUM';
    }

    const confidence = Math.round(completeness * consistency * 100) / 100;
    const isAcceptable = completeness >= 0.6 && consistency >= 0.7 && issues.length <= 1;

    return {
      completeness,
      consistency,
      riskLevel,
      confidence,
      reversibility,
      isAcceptable,
      issues
    };
  }
}
