/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Intent Engine
 */

import type { AgentIntent, IntentType } from '../types.js';
import { DeterministicIntentClassifier } from './classifier.js';

const MUTATION_INTENTS: ReadonlySet<IntentType> = new Set<IntentType>([
  'CREATE_FILE',
  'DELETE_FILE',
  'RENAME',
  'FIX_BUG',
  'REFACTOR',
  'ADD_FEATURE',
  'MODIFY_FEATURE'
]);

const HIGH_CONFIRMATION_INTENTS: ReadonlySet<IntentType> = new Set<IntentType>([
  'DELETE_FILE'
]);

export class IntentEngine {
  public parseIntent(userInput: string): AgentIntent {
    const classified = DeterministicIntentClassifier.classify(userInput);
    const requiresMutation = MUTATION_INTENTS.has(classified.type);
    const requiresConfirmation = HIGH_CONFIRMATION_INTENTS.has(classified.type) || (classified.type === 'REFACTOR' && classified.entities.length > 2);

    return {
      type: classified.type,
      goal: userInput.trim(),
      entities: classified.entities,
      constraints: classified.constraints,
      requestedChanges: classified.requestedChanges,
      confidence: classified.confidence,
      requiresMutation,
      requiresConfirmation
    };
  }
}
