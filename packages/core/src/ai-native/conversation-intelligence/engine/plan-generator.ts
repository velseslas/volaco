/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Engineering Plan Generator & Assessor
 *
 * É40 — production de plans STRUCTURÉS, directement exploitables par le
 * moteur d'exécution (routage mono-agent É33/É34 + DAG multi-agents É39) :
 *
 *   - LES TÂCHES : une étape de mutation PAR FICHIER réellement demandé
 *     (l'adaptateur É39 refuse une étape de mutation multi-fichiers —
 *     PLAN_STEP_AMBIGUOUS — et chaque tâche porte exactement une cible) ;
 *   - LES FICHIERS CIBLES : UNIQUEMENT des fichiers explicitement nommés —
 *     chemins extraits du message utilisateur (extractSourceFiles, MÊME
 *     pattern que le routage É33/É34), entités file-like de l'intention,
 *     ou cibles fournies par l'appelant (defaultTargetFiles, flux Studio).
 *     AUCUN fichier inventé : les fichiers déduits du modèle sémantique
 *     restent des indices de LECTURE portés par l'étape ANALYZE, jamais
 *     des cibles de mutation (exécuter une écriture sur un fichier deviné
 *     inventerait la cible) ;
 *   - LES CAPACITÉS NÉCESSAIRES : ['FILE_MUTATION'] déclarée sur chaque
 *     étape de mutation (représentation honnête — l'exécution reste
 *     gouvernée par le Registry É34 et l'adaptateur É39) ;
 *   - LES DÉPENDANCES : AUCUNE dépendance implicite n'est fabriquée. Un
 *     générateur rule-based ne peut pas déduire une relation technique
 *     réelle entre deux fichiers demandés indépendamment — déclarer
 *     « l'étape 2 dépend de l'étape 1 » parce que 2 vient après 1 serait
 *     un ordre artificiel. Les dépendances RÉELLES proviennent des plans
 *     LLM (déclarées quand la demande les établit) et sont validées
 *     structurellement (plan-validation.ts) avant acceptation ;
 *   - L'ORDRE LOGIQUE : stepIndex séquentiel suivant l'ordre d'énumération
 *     de l'utilisateur (ANALYZE d'abord, mutations per-file, VERIFY en
 *     dernier) — sans fabriquer de dépendance entre elles.
 */

import { computeEngineeringPlanHash } from './canonical.js';
import { extractSourceFiles, FILE_MUTATION_CAPABILITY } from './intent-router.js';
import { validatePlanStructure } from './plan-validation.js';
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

    // -------------------------------------------------------------------
    // É40 — fichiers EXPLICITEMENT demandés (jamais inventés), dans
    // l'ordre d'énoncé : message utilisateur d'abord, entités file-like
    // ensuite, cibles de l'appelant UNIQUEMENT si rien d'explicite.
    // -------------------------------------------------------------------
    const explicitFiles: string[] = [];
    const addExplicitFile = (file: string): void => {
      const trimmed = file.trim();
      if (trimmed.length > 0 && !explicitFiles.includes(trimmed)) {
        explicitFiles.push(trimmed);
      }
    };
    for (const file of extractSourceFiles(intent.goal)) {
      addExplicitFile(file);
    }
    for (const entity of intent.entities) {
      if (entity.includes('.') || entity.includes('/')) {
        addExplicitFile(entity);
      }
    }
    if (explicitFiles.length === 0) {
      for (const file of params.defaultTargetFiles ?? []) {
        addExplicitFile(file);
      }
    }

    // É40 — indices de LECTURE issus du modèle sémantique : servent à cadrer
    // l'étape ANALYZE (lecture seule), JAMAIS une mutation.
    const semanticHints: string[] = [];
    if (explicitFiles.length === 0 && semanticModel?.domains) {
      const matchingDomain = semanticModel.domains.find(
        (d: { name: string; relatedFiles: readonly string[] }) =>
          d.name.toLowerCase().includes(targetDomain.toLowerCase())
      );
      if (matchingDomain && matchingDomain.relatedFiles.length > 0) {
        semanticHints.push(...matchingDomain.relatedFiles.slice(0, 3));
      }
    }

    const steps: PlanStep[] = [];

    steps.push({
      stepIndex: 1,
      title: `Inspect ${targetDomain} architecture and prerequisites`,
      description: `Analyze existing structure and dependencies for ${intent.requestedAction}.`,
      targetDomain,
      targetFiles:
        explicitFiles.length > 0
          ? [...explicitFiles]
          : semanticHints.length > 0
          ? [...semanticHints]
          : undefined,
      operation: 'ANALYZE',
      requiresApproval: false
    });

    const isDestructive = intent.category === 'DELETE';
    const opType: PlanStep['operation'] = isDestructive
      ? 'DELETE'
      : intent.category === 'CREATE'
      ? 'CREATE'
      : 'MODIFY';

    if (explicitFiles.length > 0) {
      // É40 — UNE étape de mutation PAR fichier explicitement demandé, dans
      // l'ordre d'énoncé (chaque étape = exactement une cible = une tâche
      // É39 honnête ; pas de dépendance fabriquée entre fichiers).
      explicitFiles.forEach((file, idx) => {
        steps.push({
          stepIndex: 2 + idx,
          title: `Execute ${intent.requestedAction} on ${file}`,
          description: `Apply required code changes to satisfy goal: ${intent.goal} (cible : ${file}).`,
          targetDomain,
          targetFiles: [file],
          operation: opType,
          requiresApproval: isDestructive || intent.urgency === 'HIGH',
          requiredCapabilities: [FILE_MUTATION_CAPABILITY]
        });
      });
    } else {
      // Aucun fichier explicitement demandé : l'étape de mutation reste
      // HONNÊTEMENT incomplète (aucune cible inventée). L'évaluation signale
      // le plan inacceptable (PLAN_STEP_INCOMPLETE) et l'exécution É39 le
      // refuse explicitement — la conversation doit demander le fichier à
      // l'utilisateur, pas le deviner.
      steps.push({
        stepIndex: 2,
        title: `Execute ${intent.requestedAction} in ${targetDomain}`,
        description: `Apply required code changes to satisfy goal: ${intent.goal}.`,
        targetDomain,
        targetFiles: undefined,
        operation: opType,
        requiresApproval: isDestructive || intent.urgency === 'HIGH',
        requiredCapabilities: [FILE_MUTATION_CAPABILITY]
      });
    }

    steps.push({
      stepIndex: steps.length + 1,
      title: `Verify changes and ensure zero regressions`,
      description: `Run automated checks, type checks and integration verifications.`,
      targetDomain,
      // É40 — la vérification porte sur les fichiers réellement mutés
      // (jamais sur des indices sémantiques).
      targetFiles: explicitFiles.length > 0 ? [...explicitFiles] : undefined,
      operation: 'VERIFY',
      requiresApproval: false
    });

    const summary = `Plan for ${intent.goal} covering ${steps.length} steps in domain '${targetDomain}'.`;
    const estimatedImpact = explicitFiles.length > 0
      ? `Affects ${explicitFiles.length} file(s): ${explicitFiles.join(', ')}`
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

    // É40 — validation structurelle PARTAGÉE (mêmes codes que l'adaptateur
    // multi-agents É39) : un plan dont la mutation n'est pas constructible
    // honnêtement (étape sans cible ou multi-fichiers) est signalé ET rendu
    // inacceptable AVANT confirmation ; une dépendance invalide ou un
    // stepIndex dupliqué dégradent la cohérence. Les plans d'analyse
    // (ANALYZE/VERIFY sans cible) restent pleinement valides.
    const structure = validatePlanStructure(plan.steps);
    for (const issue of structure.issues) {
      issues.push(`${issue.code}: ${issue.message}`);
      if (issue.code === 'PLAN_STEP_INCOMPLETE' || issue.code === 'PLAN_STEP_AMBIGUOUS') {
        completeness = Math.min(completeness, 0.5);
      }
      if (
        issue.code === 'PLAN_EMPTY' ||
        issue.code === 'PLAN_STEP_INDEX_DUPLICATE' ||
        issue.code.startsWith('PLAN_DEPENDENCY_')
      ) {
        consistency = Math.min(consistency, 0.4);
      }
    }

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
