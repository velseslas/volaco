/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * LLM Output Validator & Hallucination Prevention
 */

import { HallucinationError } from '../types.js';
import type { LLMResponse, LLMToolCall } from './response.js';

export interface LLMValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly parsed?: unknown | undefined;
}

export class LLMOutputValidator {
  /**
   * Validates raw JSON output if structured output is expected.
   */
  public static validateJsonOutput(text: string): LLMValidationResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return { valid: false, errors: ['La reponse du LLM est vide'] };
    }

    // Handle markdown json codeblocks if any
    let jsonStr = trimmed;
    if (trimmed.startsWith('```json')) {
      jsonStr = trimmed.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (trimmed.startsWith('```')) {
      jsonStr = trimmed.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    try {
      const parsed = JSON.parse(jsonStr) as unknown;
      return { valid: true, errors: [], parsed };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, errors: [`JSON invalide renvoye par le LLM: ${msg}`] };
    }
  }

  /**
   * Validates that requested tool calls reference valid registered tools and proper arguments.
   */
  public static validateToolCalls(
    toolCalls: readonly LLMToolCall[],
    registeredToolNames: ReadonlySet<string>
  ): LLMValidationResult {
    const errors: string[] = [];

    for (const call of toolCalls) {
      if (!call.name || typeof call.name !== 'string') {
        errors.push(`Appel d'outil sans nom d'outil valide (id: ${call.id})`);
        continue;
      }
      if (!registeredToolNames.has(call.name)) {
        errors.push(`Outil non enregistre demande par le LLM : '${call.name}'`);
      }
      if (typeof call.arguments !== 'object' || call.arguments === null || Array.isArray(call.arguments)) {
        errors.push(`Parametres d'outil invalides pour '${call.name}' : objet attendu`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Hallucination Guard: Validates that claimed project entities exist in evidence.
   * NO EVIDENCE -> NO CLAIM
   */
  public static validateEvidenceGrounding(
    claims: readonly string[],
    knownEvidenceSet: ReadonlySet<string>
  ): { grounded: boolean; ungroundedClaims: readonly string[] } {
    const ungroundedClaims: string[] = [];

    for (const claim of claims) {
      const normalized = claim.trim().replace(/^\.?\//, '');
      if (!knownEvidenceSet.has(normalized) && !knownEvidenceSet.has(claim.trim())) {
        ungroundedClaims.push(claim);
      }
    }

    return {
      grounded: ungroundedClaims.length === 0,
      ungroundedClaims
    };
  }

  /**
   * Asserts grounding and throws HallucinationError if ungrounded claims exist.
   */
  public static assertGrounding(
    claim: string,
    knownEvidenceSet: ReadonlySet<string>,
    contextDescription = 'Projet'
  ): void {
    const check = this.validateEvidenceGrounding([claim], knownEvidenceSet);
    if (!check.grounded) {
      throw new HallucinationError(claim, `Entite absente de ${contextDescription}`);
    }
  }
}
