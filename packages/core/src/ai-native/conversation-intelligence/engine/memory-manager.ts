/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * 3-Tier Memory Manager: Turn Memory, Project Memory, Decision Memory
 */

import { deepFreeze } from './canonical.js';
import type {
  ConversationMessage,
  ConversationTurn,
  DecisionRecord,
  EngineeringPlan,
  ProjectMemory,
  TurnMemory
} from '../types.js';

export class MemoryManager {
  /**
   * Creates initial turn memory.
   */
  public createInitialTurnMemory(): TurnMemory {
    return deepFreeze({
      recentMessages: [],
      currentAssumptions: []
    });
  }

  /**
   * Creates initial project memory.
   */
  public createInitialProjectMemory(): ProjectMemory {
    return deepFreeze({
      architecturalDecisions: [],
      userPreferences: {},
      acceptedPlans: [],
      rejectedPlans: [],
      knownConstraints: [],
      knownConventions: [],
      knownRisks: []
    });
  }

  /**
   * Updates turn memory with the latest turn, capping history to maxHistory.
   */
  public updateTurnMemory(
    current: TurnMemory,
    turn: ConversationTurn,
    maxHistory: number = 10
  ): TurnMemory {
    const updatedMessages: ConversationMessage[] = [
      ...current.recentMessages,
      turn.userMessage,
      turn.agentResponse
    ];

    const trimmedMessages = updatedMessages.slice(-maxHistory);

    return deepFreeze({
      lastMessage: turn.agentResponse,
      recentMessages: trimmedMessages,
      activeIntent: turn.intent,
      currentPlan: turn.plan ?? current.currentPlan,
      currentAssumptions: turn.assumptions
    });
  }

  /**
   * Records an architectural decision in Decision Memory / Project Memory.
   */
  public recordDecision(projectMemory: ProjectMemory, decision: DecisionRecord): ProjectMemory {
    // If decision supersedes an older one, mark old one as SUPERSEDED
    const updatedDecisions = projectMemory.architecturalDecisions.map((d) => {
      if (d.statement.toLowerCase() === decision.statement.toLowerCase() && d.decisionId !== decision.decisionId) {
        return { ...d, status: 'SUPERSEDED' as const };
      }
      return d;
    });

    const isAlreadyPresent = updatedDecisions.some((d) => d.decisionId === decision.decisionId);
    const finalDecisions = isAlreadyPresent ? updatedDecisions : [...updatedDecisions, decision];

    return deepFreeze({
      ...projectMemory,
      architecturalDecisions: finalDecisions
    });
  }

  /**
   * Records acceptance or rejection of an engineering plan.
   */
  public recordPlanDecision(
    projectMemory: ProjectMemory,
    planId: string,
    accepted: boolean
  ): ProjectMemory {
    if (accepted) {
      const acceptedPlans = Array.from(new Set([...projectMemory.acceptedPlans, planId]));
      const rejectedPlans = projectMemory.rejectedPlans.filter((id) => id !== planId);
      return deepFreeze({
        ...projectMemory,
        acceptedPlans,
        rejectedPlans
      });
    } else {
      const rejectedPlans = Array.from(new Set([...projectMemory.rejectedPlans, planId]));
      const acceptedPlans = projectMemory.acceptedPlans.filter((id) => id !== planId);
      return deepFreeze({
        ...projectMemory,
        acceptedPlans,
        rejectedPlans
      });
    }
  }

  /**
   * Adds a known constraint to Project Memory.
   */
  public addConstraint(projectMemory: ProjectMemory, constraint: string): ProjectMemory {
    if (!constraint || projectMemory.knownConstraints.includes(constraint)) {
      return projectMemory;
    }
    return deepFreeze({
      ...projectMemory,
      knownConstraints: [...projectMemory.knownConstraints, constraint]
    });
  }

  /**
   * Sets a user preference in Project Memory.
   */
  public setUserPreference(
    projectMemory: ProjectMemory,
    key: string,
    value: string
  ): ProjectMemory {
    return deepFreeze({
      ...projectMemory,
      userPreferences: {
        ...projectMemory.userPreferences,
        [key]: value
      }
    });
  }
}
