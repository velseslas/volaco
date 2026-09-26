/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Central Agent Registry with Duplicate Prevention
 */

import { ValidationError } from '../../../errors.js';
import type { AgentDefinition, AgentRole, AgentType } from '../types.js';
import { createAgentDefinition } from './agent.js';

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    const roles: (AgentType | AgentRole)[] = [
      'ARCHITECT_AGENT',
      'CODE_AGENT',
      'UI_AGENT',
      'BACKEND_AGENT',
      'DATABASE_AGENT',
      'SECURITY_AGENT',
      'TEST_AGENT',
      'DEBUG_AGENT',
      'REVIEW_AGENT',
      // backward-compatible
      'LOGIC_AGENT',
      'DATA_AGENT',
      'ARCHITECTURE_AGENT',
      'TESTING_AGENT',
      'DOCUMENTATION_AGENT',
      'GENERALIST'
    ];

    for (const role of roles) {
      const def = createAgentDefinition(role, `default-${role.toLowerCase().replace(/_/g, '-')}`);
      this.agents.set(def.agentId, def);
      this.agents.set(role, def);
    }
  }

  /**
   * Registers a new agent definition with strict duplicate prevention.
   */
  public register(agent: AgentDefinition): void {
    if (this.agents.has(agent.agentId)) {
      throw new ValidationError(`Agent déjà enregistré avec l'identifiant : '${agent.agentId}'`);
    }
    this.agents.set(agent.agentId, agent);
  }

  public getByRole(role: AgentRole | AgentType): AgentDefinition | undefined {
    return this.get(role);
  }

  public get(idOrRole: string): AgentDefinition | undefined {
    return this.agents.get(idOrRole);
  }

  public has(idOrRole: string): boolean {
    return this.agents.has(idOrRole);
  }

  public list(): readonly AgentDefinition[] {
    const unique = new Map<string, AgentDefinition>();
    for (const agent of this.agents.values()) {
      unique.set(agent.agentId, agent);
    }
    return Array.from(unique.values());
  }
}
