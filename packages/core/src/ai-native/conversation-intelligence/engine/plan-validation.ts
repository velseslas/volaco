/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * É40 — Validation STRUCTURELLE des plans d'ingénierie conversationnels.
 *
 * Une seule définition des règles de structure, utilisée par :
 *   - le générateur rule-based (PlanGenerator.assessPlan — signalement) ;
 *   - l'acceptation des plans LLM (provider + moteur conversationnel) ;
 *   - les tests ciblés des générateurs et des cas limites.
 *
 * Les codes sont ALIGNÉS sur ceux de l'adaptateur multi-agents (É39,
 * execution-bridge.ts) : un plan validé ici est exactement un plan que
 * l'adaptateur acceptera de transformer en DAG (et réciproquement, tout
 * refus de l'adaptateur correspond à une violation détectable ici).
 *
 * Périmètre STRICTEMENT structurel — aucune résolution d'agent, aucune
 * capability, aucune mutation : ces vérifications restent du ressort du
 * Registry (É34) et du pipeline sécurisé (É32–É39), non modifiés.
 *   - Une étape ANALYZE/VERIFY n'a PAS besoin de targetFiles (les plans
 *     d'analyse restent exécutables sans aucune cible).
 *   - Une étape de mutation (CREATE/MODIFY/DELETE) exige EXACTEMENT UN
 *     fichier cible : zéro → PLAN_STEP_INCOMPLETE, plusieurs →
 *     PLAN_STEP_AMBIGUOUS (pas d'éclatement artificiel en tâches).
 *   - dependsOn (déclarations explicites uniquement — aucune dépendance
 *     implicite n'est fabriquée ici) : inconnue, auto-référencée ou visant
 *     une étape jamais exécutée par un agent → invalide.
 */

import type { PlanStep } from '../types.js';

export interface PlanStructureIssue {
  readonly code: string;
  readonly message: string;
}

export interface PlanStructureValidation {
  readonly valid: boolean;
  readonly issues: readonly PlanStructureIssue[];
}

/** Opérations de plan qui MUTENT réellement des fichiers (exécutables par un agent). */
const MUTATION_OPERATIONS: ReadonlySet<string> = new Set(['CREATE', 'MODIFY', 'DELETE']);

function isMutationStep(step: PlanStep): boolean {
  return MUTATION_OPERATIONS.has(step.operation);
}

export function validatePlanStructure(steps: readonly PlanStep[]): PlanStructureValidation {
  const issues: PlanStructureIssue[] = [];

  if (steps.length === 0) {
    return {
      valid: false,
      issues: [{ code: 'PLAN_EMPTY', message: 'le plan ne contient aucune étape' }]
    };
  }

  // 1. stepIndex unique (le taskId dérivé `step-N` doit être stable et unique).
  const seenIndexes = new Set<number>();
  const stepsByIndex = new Map<number, PlanStep>();
  for (const step of steps) {
    if (seenIndexes.has(step.stepIndex)) {
      issues.push({
        code: 'PLAN_STEP_INDEX_DUPLICATE',
        message: `deux étapes du plan portent le stepIndex ${step.stepIndex}`
      });
    }
    seenIndexes.add(step.stepIndex);
    stepsByIndex.set(step.stepIndex, step);
  }

  // 2. Étapes de mutation : exactement un fichier cible ; dépendances
  //    déclarées valides (existantes, non auto-référencées, exécutables).
  for (const step of steps) {
    if (!isMutationStep(step)) continue;

    const files = step.targetFiles ?? [];
    if (files.length === 0) {
      issues.push({
        code: 'PLAN_STEP_INCOMPLETE',
        message: `l'étape ${step.stepIndex} (${step.operation}) ne déclare aucun fichier cible — aucune tâche honnête constructible`
      });
    } else if (files.length > 1) {
      issues.push({
        code: 'PLAN_STEP_AMBIGUOUS',
        message: `l'étape ${step.stepIndex} (${step.operation}) cible ${files.length} fichiers [${files.join(', ')}] — pas d'éclatement artificiel en tâches`
      });
    }

    for (const dep of step.dependsOn ?? []) {
      if (dep === step.stepIndex) {
        issues.push({
          code: 'PLAN_DEPENDENCY_SELF',
          message: `l'étape ${step.stepIndex} dépend d'elle-même`
        });
        continue;
      }
      const depStep = stepsByIndex.get(dep);
      if (!depStep) {
        issues.push({
          code: 'PLAN_DEPENDENCY_UNKNOWN',
          message: `l'étape ${step.stepIndex} dépend de l'étape ${dep} qui n'existe pas`
        });
      } else if (!isMutationStep(depStep)) {
        issues.push({
          code: 'PLAN_DEPENDENCY_NON_EXECUTABLE',
          message: `l'étape ${step.stepIndex} dépend de l'étape ${dep} (${depStep.operation}) qui n'est jamais exécutée par un agent`
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
