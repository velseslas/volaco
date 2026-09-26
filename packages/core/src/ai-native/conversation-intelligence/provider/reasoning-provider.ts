/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Pluggable Reasoning Provider Abstraction & Deterministic Default Provider
 */

import type {
  NextActionKind,
  ReasoningProvider,
  ReasoningRequest,
  ReasoningResponse
} from '../types.js';

/**
 * Deterministic default reasoning provider based on rule-based intent analysis.
 * Serves as reliable offline fallback and verification provider.
 */
export class DefaultReasoningProvider implements ReasoningProvider {
  public async reason(request: ReasoningRequest): Promise<ReasoningResponse> {
    const { intent, userMessage } = request;

    let nextAction: NextActionKind = 'RESPOND_DIRECTLY';
    let reply = '';

    switch (intent.category) {
      case 'QUESTION':
      case 'EXPLAIN':
      case 'EXPLORATION':
        nextAction = 'RESPOND_DIRECTLY';
        reply = `Explication détaillée concernant '${intent.goal}' : structure analysée avec succès.`;
        break;

      case 'ANALYZE':
        nextAction = 'REQUEST_UNDERSTANDING';
        reply = `Analyse sémantique engagée pour identifier les flux et architectures liés à '${intent.goal}'.`;
        break;

      case 'CREATE':
      case 'MODIFY':
      case 'REFACTOR':
      case 'OPTIMIZE':
      case 'DEBUG':
        nextAction = 'PRESENT_PLAN';
        reply = `Plan d'ingénierie structuré élaboré pour satisfaire l'objectif : ${intent.goal}.`;
        break;

      case 'DELETE':
        nextAction = 'REQUEST_CONFIRMATION';
        reply = `Action potentiellement destructive détectée (${intent.requestedAction}). Confirmation explicite requise.`;
        break;

      default:
        nextAction = 'RESPOND_DIRECTLY';
        reply = `Instruction reçue pour : ${userMessage.slice(0, 80)}.`;
        break;
    }

    return {
      interpretation: `Intention identifiée : ${intent.category} avec confiance de ${Math.round(intent.confidence * 100)}%.`,
      intent,
      assumptions: [],
      clarifications: intent.ambiguities,
      reply,
      confidence: intent.confidence,
      nextAction
    };
  }
}

/**
 * Mock Reasoning Provider for controlled unit and integration testing.
 */
export class MockReasoningProvider implements ReasoningProvider {
  constructor(
    private readonly customResponse?: Partial<ReasoningResponse> | undefined
  ) {}

  public async reason(request: ReasoningRequest): Promise<ReasoningResponse> {
    return {
      interpretation: 'Mock interpretation',
      intent: request.intent,
      assumptions: [],
      clarifications: [],
      reply: 'Mock reasoning response',
      confidence: 1.0,
      nextAction: 'RESPOND_DIRECTLY',
      ...this.customResponse
    };
  }
}
