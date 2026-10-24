/**
 * V7-WIRE-2 — PONT FLUX DE GÉNÉRATION → MUTATION ORCHESTRATOR (AINT-006).
 *
 * Le flux conversationnel écrivait `index.html` en appel direct
 * `fileStore.saveFile(...)`, sans snapshot, sans précondition et sans
 * vérification post-écriture. Ce module branche le vrai moteur AINT-006 :
 *
 *   plan (CREATE_FILE / UPDATE_FILE)
 *     → validation (stale plan, risque déjà arbitré par le flux)
 *     → exécution atomique (snapshot + diff + vérification)
 *     → rollback automatique si l'exécution échoue.
 *
 * DÉCISIONS EXPLICITES :
 * - `skipImpactCheck: true` : l'Impact Intelligence a déjà été consultée par
 *   le flux (V7-WIRE-1) et reste CONSULTATIVE pour ce lot. Le pont ne re-juge
 *   pas le risque, mais il conserve toutes les garanties d'atomicité.
 * - `allowHighRisk` / `allowBreaking` : cohérents avec ce caractère
 *   consultatif ; un refus du plan reste possible pour toute autre raison et
 *   est alors remonté honnêtement (`stage: 'validation'`).
 * - Aucun succès fabriqué : sans moteur, le pont retourne `stage: 'engine'`
 *   et c'est l'appelant qui décide du repli, en le traçant.
 */

import type { Role } from '../../../../packages/core/src/identity/permissions.js';
import type { ImpactRiskLevel } from '../../../../packages/core/src/ai-native/impact-intelligence/types.js';
import type {
  MutationExecutionResult,
  MutationPlan,
  PlanValidationResult,
  SingleMutation
} from '../../../../packages/core/src/ai-native/mutation-orchestrator/types.js';

export const STREAM_MUTATION_PATH = 'index.html';

/**
 * Contrat structurel minimal du moteur AINT-006.
 * `MutationOrchestratorService` le satisfait tel quel ; un test peut fournir
 * un double sans construire tout le graphe sémantique.
 */
export interface StreamMutationEngine {
  createPlan(
    request: {
      readonly tenantId: string;
      readonly projectId: string;
      readonly baseGraphHash: string;
      readonly riskLevel?: ImpactRiskLevel | undefined;
      readonly mutations: readonly SingleMutation[];
      readonly requestId?: string | undefined;
    },
    userRole?: Role,
    requestId?: string | undefined
  ): MutationPlan;

  validatePlan(
    plan: MutationPlan,
    userRole?: Role,
    requestId?: string | undefined
  ): PlanValidationResult;

  executePlan(
    plan: MutationPlan,
    options?: {
      readonly dryRun?: boolean | undefined;
      readonly allowHighRisk?: boolean | undefined;
      readonly allowBreaking?: boolean | undefined;
      readonly skipImpactCheck?: boolean | undefined;
    },
    userRole?: Role,
    requestId?: string | undefined
  ): MutationExecutionResult;
}

export interface StreamMutationInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly role: Role;
  readonly content: string;
  /** `create` = le fichier n'existe pas encore, `update` = il existe. */
  readonly mode: 'create' | 'update';
  /** Risque déjà évalué par le flux (consultatif), jamais recalculé ici. */
  readonly riskLevel?: ImpactRiskLevel | undefined;
  readonly path?: string | undefined;
}

export type StreamMutationStage = 'engine' | 'plan' | 'validation' | 'execution';

export type StreamMutationOutcome =
  | {
      readonly applied: true;
      readonly mode: 'create' | 'update';
      readonly planId: string;
      readonly transactionId: string;
      readonly transactionHash: string;
      readonly addedLines: number;
      readonly removedLines: number;
      readonly warnings: readonly string[];
      readonly riskLevel: ImpactRiskLevel;
      readonly durationMs: number;
      readonly syntaxValid?: boolean | undefined;
    }
  | {
      readonly applied: false;
      readonly stage: StreamMutationStage;
      readonly reason: string;
      /** `true` uniquement si une écriture a été tentée puis annulée. */
      readonly rolledBack: boolean;
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Applique une écriture de fichier via le Mutation Orchestrator.
 * Ne lève jamais : toute défaillance est convertie en résultat explicite.
 */
export function applyStreamFileMutation(
  engine: StreamMutationEngine | undefined,
  input: StreamMutationInput
): StreamMutationOutcome {
  if (!engine) {
    return {
      applied: false,
      stage: 'engine',
      reason: 'service-non-configure',
      rolledBack: false
    };
  }

  const path = input.path ?? STREAM_MUTATION_PATH;
  const isCreate = input.mode === 'create';

  const mutation: SingleMutation = {
    mutationId: `stream-${input.requestId}`,
    kind: isCreate ? 'CREATE_FILE' : 'UPDATE_FILE',
    target: path,
    preconditions: [
      {
        kind: isCreate ? 'FILE_NOT_EXISTS' : 'FILE_EXISTS',
        target: path,
        description: isCreate
          ? `Le fichier '${path}' ne doit pas exister avant la création`
          : `Le fichier '${path}' doit exister avant la mise à jour`
      }
    ],
    operation: { path, content: input.content },
    expectedOutcome: isCreate
      ? `Créer '${path}' avec le HTML généré`
      : `Mettre à jour '${path}' avec le HTML généré`,
    evidence: []
  };

  let plan: MutationPlan;
  let validation: PlanValidationResult;
  try {
    plan = engine.createPlan(
      {
        tenantId: input.tenantId,
        projectId: input.projectId,
        // Vide : le service résout le hash réel depuis le graphe sémantique.
        baseGraphHash: '',
        riskLevel: input.riskLevel,
        mutations: [mutation],
        requestId: input.requestId
      },
      input.role,
      input.requestId
    );
    validation = engine.validatePlan(plan, input.role, input.requestId);
  } catch (error) {
    return {
      applied: false,
      stage: 'plan',
      reason: errorMessage(error),
      rolledBack: false
    };
  }

  if (!validation.valid) {
    return {
      applied: false,
      stage: 'validation',
      reason: validation.blockers.join(' | ') || 'plan de mutation invalide',
      rolledBack: false
    };
  }

  try {
    const result = engine.executePlan(
      plan,
      {
        allowHighRisk: true,
        allowBreaking: true,
        skipImpactCheck: true
      },
      input.role,
      input.requestId
    );

    if (!result.success) {
      return {
        applied: false,
        stage: 'execution',
        reason: 'exécution de la mutation non confirmée',
        rolledBack: true
      };
    }

    return {
      applied: true,
      mode: input.mode,
      planId: plan.planId,
      transactionId: result.transaction.transactionId,
      transactionHash: result.transaction.transactionHash,
      addedLines: result.diffs.reduce((total, diff) => total + diff.addedLines, 0),
      removedLines: result.diffs.reduce((total, diff) => total + diff.removedLines, 0),
      warnings: validation.warnings,
      riskLevel: validation.riskLevel,
      durationMs: result.transaction.durationMs,
      ...(result.revalidation ? { syntaxValid: result.revalidation.syntaxValid } : {})
    };
  } catch (error) {
    // `executePlan` a déjà restauré le snapshot avant de lever : l'écriture
    // tentée est annulée, il ne faut surtout pas la rejouer en repli direct.
    return {
      applied: false,
      stage: 'execution',
      reason: errorMessage(error),
      rolledBack: true
    };
  }
}
