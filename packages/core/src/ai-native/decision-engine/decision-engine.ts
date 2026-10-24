/**
 * VibeCode Core - Decision Engine
 *
 * Classe centrale du système. Prend un Intent, consulte les contraintes,
 * génère des alternatives, vérifie les contradictions avec le passé, et
 * produit un Decision avec un verdict clair.
 *
 * Le DecisionEngine est la SEULE autorité décisionnelle du système.
 * Les modules IntelligencePool sont consultatifs : ils fournissent des
 * recommendations qui entrent comme alternatives possibles, mais ne
 * peuvent pas décider seuls.
 *
 * Verdicts :
 *  - READY              → l'orchestrateur peut exécuter
 *  - NEEDS_CONFIRMATION → l'utilisateur doit valider
 *  - BLOCKED            → contrainte HARD violée, refusé
 *  - DEFERRED           → contradiction avec décision passée, à revoir
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../logger.js';
import type { IntentResult, ProjectMemory } from '../conversation-intelligence/types.js';
import type { IntelligenceRecommendation } from '../intelligence-pool/types.js';
import type {
  Decision,
  DecisionAlternative,
  DecisionContext,
  DecisionConstraint,
  DecisionVerdict
} from './types.js';
import { ConstraintRegistry } from './constraint-registry.js';
import { DecisionLedger } from './decision-ledger.js';
import { AlternativeGenerator } from './alternative-generator.js';
import { matchMemorySignals, type MemorySignals } from './memory-signals.js';

export interface DecisionEngineDeps {
  readonly constraintRegistry: ConstraintRegistry;
  readonly decisionLedger: DecisionLedger;
  readonly alternativeGenerator: AlternativeGenerator;
}

export class DecisionEngine {
  constructor(private readonly deps: DecisionEngineDeps) {}

  public async decide(
    context: DecisionContext,
    options: { readonly record?: boolean } = {}
  ): Promise<Decision> {
    const trace: string[] = [];
    trace.push(`DecisionEngine.start goal="${context.intent.goal}" category=${context.intent.category}`);

    // 1. Charger les contraintes du projet
    const constraints = this.deps.constraintRegistry.loadConstraints(context.projectId);
    trace.push(`constraints loaded=${constraints.length}`);

    // V7 — les contraintes/risques mémorisés sont reliés à l'intent courant.
    // Matching lexical explicite (heuristique), jamais une décision inventée.
    const memorySignals = matchMemorySignals(context.intent, context.memory);
    trace.push(
      `memory signals risks=${memorySignals.matchedRisks.length} ` +
      `constraints=${memorySignals.matchedConstraints.length} ` +
      `decisions=${memorySignals.activeDecisions}`
    );

    // 2. Générer les alternatives
    const alternatives = await this.deps.alternativeGenerator.generate({
      intent: context.intent,
      constraints,
      memory: context.memory,
      intelligenceRecommendations: context.intelligenceRecommendations
    });
    trace.push(`alternatives generated=${alternatives.length}`);

    // 3. Filtrer les alternatives viables (aucune contrainte HARD violée)
    const viable = alternatives.filter((a) => a.constraintsViolated.length === 0);
    const blocked = alternatives.filter((a) => a.constraintsViolated.length > 0);
    trace.push(`viable=${viable.length} blocked=${blocked.length}`);

    // 4. Vérifier les contradictions avec décisions passées
    const probeDecision = this.buildProbeDecision(context, viable[0] || alternatives[0], constraints);
    const contradicting = this.deps.decisionLedger.findContradicting(probeDecision);
    trace.push(`contradictions=${contradicting.length}`);

    // 5. Choisir l'alternative optimale (riskScore le plus bas, réversible préféré)
    const chosen = this.chooseBest(viable);
    if (chosen) {
      trace.push(`chosen="${chosen.label}" risk=${chosen.riskScore}`);
    }

    // 6. Déterminer le verdict
    const verdict = this.computeVerdict({
      viable,
      blocked,
      contradicting,
      chosen,
      intent: context.intent,
      memorySignals
    });
    trace.push(`verdict=${verdict}`);

    // 7. Construire la rationale
    const rationale = this.buildRationale({
      verdict,
      chosen,
      constraints,
      contradicting,
      intent: context.intent,
      memorySignals,
      intelligenceRecommendations: context.intelligenceRecommendations
    });
    const requiredClarifications = this.deriveClarifications({
      verdict,
      constraints,
      contradicting,
      intent: context.intent
    });

    // 8. Assembler la décision finale
    const decision: Decision = {
      decisionId: 'dec-' + randomUUID().slice(0, 12),
      sessionId: context.sessionId,
      projectId: context.projectId,
      tenantId: context.tenantId,
      intentGoal: context.intent.goal,
      intentCategory: context.intent.category,
      verdict,
      chosenAlternative: chosen,
      alternatives: viable.length > 0 ? viable : alternatives,
      constraints,
      memorySignals,
      contradictingDecisions: contradicting.map((d) => d.decisionId),
      rationale,
      requiredClarifications,
      intelligenceSources: (context.intelligenceRecommendations || []).map((r) => r.source),
      createdAt: new Date().toISOString(),
      status: 'PROPOSED'
    };

    // 9. Persister la décision — sauf en mode CONSULTATIF (`record: false`).
    // Utilisé par le flux de génération : la décision éclaire l'action sans
    // polluer le Decision Ledger (qui reste l'autorité de la route /decide et
    // des décisions humainement confirmées).
    if (options.record === false) {
      trace.push(`decision advisory (not recorded) id=${decision.decisionId}`);
    } else {
      this.deps.decisionLedger.recordDecision(decision);
      trace.push(`decision recorded id=${decision.decisionId}`);
    }

    logger.info('DecisionEngine.decide', {
      component: 'decision-engine',
      verdict,
      decisionId: decision.decisionId,
      alternativesCount: alternatives.length,
      viableCount: viable.length,
      contradictions: contradicting.length
    });

    return decision;
  }

  /**
   * Construit une "probe decision" pour détecter les contradictions
   * avant de finaliser la décision réelle.
   */
  private buildProbeDecision(
    context: DecisionContext,
    chosen: DecisionAlternative | undefined,
    constraints: readonly DecisionConstraint[]
  ): Decision {
    return {
      decisionId: 'probe-' + randomUUID().slice(0, 8),
      sessionId: context.sessionId,
      projectId: context.projectId,
      tenantId: context.tenantId,
      intentGoal: context.intent.goal,
      intentCategory: context.intent.category,
      verdict: 'READY',
      chosenAlternative: chosen,
      alternatives: chosen ? [chosen] : [],
      constraints,
      contradictingDecisions: [],
      rationale: 'probe',
      requiredClarifications: [],
      intelligenceSources: [],
      createdAt: new Date().toISOString(),
      status: 'PROPOSED'
    };
  }

  private chooseBest(viable: readonly DecisionAlternative[]): DecisionAlternative | undefined {
    if (viable.length === 0) return undefined;
    return viable.slice().sort((a, b) => {
      // 1. Risk score le plus bas d'abord
      if (a.riskScore !== b.riskScore) return a.riskScore - b.riskScore;
      // 2. Réversible préféré
      if (a.reversible !== b.reversible) return a.reversible ? -1 : 1;
      // 3. Effort le plus bas
      const effortWeight = { LOW: 1, MEDIUM: 2, HIGH: 3 };
      return effortWeight[a.estimatedEffort] - effortWeight[b.estimatedEffort];
    })[0];
  }

  private computeVerdict(params: {
    viable: readonly DecisionAlternative[];
    blocked: readonly DecisionAlternative[];
    contradicting: readonly Decision[];
    chosen: DecisionAlternative | undefined;
    intent: IntentResult;
    memorySignals: MemorySignals;
  }): DecisionVerdict {
    const { viable, blocked, contradicting, chosen, intent, memorySignals } = params;

    // Si toutes les alternatives violent une HARD constraint → BLOCKED
    if (viable.length === 0 && blocked.length > 0) {
      return 'BLOCKED';
    }

    // Si contradictions avec décisions passées → DEFERRED
    if (contradicting.length > 0) {
      return 'DEFERRED';
    }

    // Intents informationnels → READY immédiat (pas de mutation)
    if (
      intent.category === 'QUESTION' ||
      intent.category === 'EXPLAIN' ||
      intent.category === 'EXPLORATION' ||
      intent.category === 'NAVIGATION' ||
      intent.category === 'REVIEW'
    ) {
      return 'READY';
    }

    // DELETE → toujours NEEDS_CONFIRMATION (l'utilisateur a demandé une action
    // destructive ; même si on propose ARCHIVE à la place, il doit valider le
    // changement d'intent).
    if (intent.category === 'DELETE') {
      return 'NEEDS_CONFIRMATION';
    }

    // DEPLOYMENT → toujours NEEDS_CONFIRMATION
    if (intent.category === 'DEPLOYMENT') {
      return 'NEEDS_CONFIRMATION';
    }

    // V7 — une contrainte ou un risque mémorisé qui touche une action mutante
    // exige une confirmation humaine. La décision reste consultative : elle
    // n'écrit rien et ne bloque pas la génération dans ce lot.
    const memorySensitiveCategory =
      intent.category === 'CREATE' ||
      intent.category === 'MODIFY' ||
      intent.category === 'REFACTOR' ||
      intent.category === 'DEBUG' ||
      intent.category === 'OPTIMIZE';
    if (
      memorySensitiveCategory &&
      (memorySignals.matchedRisks.length > 0 || memorySignals.matchedConstraints.length > 0)
    ) {
      return 'NEEDS_CONFIRMATION';
    }

    // Risk score > 50 → NEEDS_CONFIRMATION
    if (chosen && chosen.riskScore > 50) {
      return 'NEEDS_CONFIRMATION';
    }

    // Sinon READY
    return 'READY';
  }

  private buildRationale(params: {
    verdict: DecisionVerdict;
    chosen: DecisionAlternative | undefined;
    constraints: readonly DecisionConstraint[];
    contradicting: readonly Decision[];
    intent: IntentResult;
    memorySignals: MemorySignals;
    intelligenceRecommendations?: readonly IntelligenceRecommendation[] | undefined;
  }): string {
    const { verdict, chosen, constraints, contradicting, intent, memorySignals } = params;

    const parts: string[] = [];

    parts.push(`Intent "${intent.goal}" classifié comme ${intent.category}.`);

    if (verdict === 'BLOCKED') {
      const hardViolated = constraints.filter((c) =>
        c.severity === 'HARD' && chosen?.constraintsViolated.includes(c.id)
      );
      parts.push(
        `Refusé : ${hardViolated.length} contrainte(s) HARD violée(s) — ` +
          hardViolated.map((c) => c.statement).join('; ')
      );
    } else if (verdict === 'DEFERRED') {
      parts.push(
        `Conflit avec ${contradicting.length} décision(s) passée(s) — ` +
          contradicting.map((d) => `${d.decisionId} (${d.intentGoal})`).join('; ')
      );
    } else if (verdict === 'NEEDS_CONFIRMATION') {
      parts.push(
        `Alternative choisie : "${chosen?.label}" avec riskScore=${chosen?.riskScore}. ` +
          `Risque modéré — validation utilisateur requise.`
      );
    } else {
      parts.push(
        `Alternative choisie : "${chosen?.label}" avec riskScore=${chosen?.riskScore}. ` +
          `Aucune contrainte HARD violée, aucune contradiction. Prêt à exécuter.`
      );
    }

    if (memorySignals.matchedRisks.length > 0) {
      parts.push(
        `Mémoire projet : ${memorySignals.matchedRisks.length} risque(s) connu(s) lié(s) à cette demande — ` +
        memorySignals.matchedRisks.join('; ')
      );
    }
    if (memorySignals.matchedConstraints.length > 0) {
      parts.push(
        `Mémoire projet : ${memorySignals.matchedConstraints.length} contrainte(s) connue(s) liée(s) — ` +
        memorySignals.matchedConstraints.join('; ')
      );
    }

    if ((params.intelligenceRecommendations || []).length > 0) {
      parts.push(
        `${(params.intelligenceRecommendations || []).length} recommendation(s) consultative(s) de l'IntelligencePool intégrée(s) comme alternatives.`
      );
    }

    return parts.join(' ');
  }

  private deriveClarifications(params: {
    verdict: DecisionVerdict;
    constraints: readonly DecisionConstraint[];
    contradicting: readonly Decision[];
    intent: IntentResult;
  }): string[] {
    const { verdict, constraints, contradicting, intent } = params;
    if (verdict !== 'BLOCKED' && verdict !== 'DEFERRED') return [];

    const clarifications: string[] = [];

    if (verdict === 'BLOCKED') {
      const hardViolated = constraints.filter(
        (c) => c.severity === 'HARD'
      );
      for (const c of hardViolated) {
        clarifications.push(`Confirmer que la demande respecte : ${c.statement}`);
      }
    }

    if (verdict === 'DEFERRED') {
      for (const d of contradicting) {
        clarifications.push(
          `La décision passée ${d.decisionId} (${d.intentGoal}) semble en conflit. ` +
            `Souhaitez-vous la supplanter ?`
        );
      }
    }

    // Clarifications pour intents ambigus
    if (intent.category === 'UNKNOWN' || intent.confidence < 0.4) {
      clarifications.push(
        `L'intent est ambigu (confidence=${intent.confidence.toFixed(2)}). ` +
          `Pouvez-vous reformuler votre demande ?`
      );
    }

    return clarifications;
  }

  /**
   * Permet à l'utilisateur d'accepter explicitement une décision NEEDS_CONFIRMATION.
   */
  public acceptDecision(decisionId: string): void {
    this.deps.decisionLedger.accept(decisionId);
    logger.info('DecisionEngine.acceptDecision', { decisionId });
  }

  public rejectDecision(decisionId: string): void {
    this.deps.decisionLedger.reject(decisionId);
    logger.info('DecisionEngine.rejectDecision', { decisionId });
  }

  public getDecision(decisionId: string): Decision | undefined {
    return this.deps.decisionLedger.getById(decisionId);
  }

  public getHistory(projectId?: string): readonly Decision[] {
    return this.deps.decisionLedger.getActiveDecisions(projectId);
  }
}
