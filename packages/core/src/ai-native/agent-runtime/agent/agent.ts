/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Agent Identity & Definition
 */

import { randomUUID } from 'node:crypto';
import type { AgentRole, AgentType, AgentDefinition } from '../types.js';
import type { Permission } from '../../../identity/permissions.js';
import {
  getCapabilitiesForRole,
  getAllowedOperationsForRole,
  getRiskLevelForRole
} from './capabilities.js';

export class Agent {
  constructor(public readonly definition: AgentDefinition) {}

  public get agentId(): string {
    return this.definition.agentId;
  }

  public get role(): AgentRole {
    return this.definition.agentType as AgentRole;
  }

  public get allowedOperations(): readonly string[] {
    return this.definition.allowedOperations;
  }

  public canPerform(operation: string): boolean {
    const allowed = new Set(
      this.definition.allowedOperations.flatMap((op) => [op, op.toUpperCase(), op.toLowerCase()])
    );
    return allowed.has(operation) || allowed.has(operation.toUpperCase()) || allowed.has(operation.toLowerCase());
  }
}

export function createAgentDefinition(role: AgentType | AgentRole, id?: string): AgentDefinition {
  const agentId = id ?? `agent-${role.toLowerCase().replace(/_/g, '-')}-${randomUUID().substring(0, 6)}`;
  const capabilities = getCapabilitiesForRole(role);
  const allowedOperations = getAllowedOperationsForRole(role);
  const riskLevel = getRiskLevelForRole(role);

  const permissions: Permission[] = ['PROJECT_READ'];
  if (capabilities.canExecuteMutations) {
    permissions.push('PROJECT_MUTATE');
  }

  const roleNames: Record<string, string> = {
    ARCHITECT_AGENT: 'Architecture & System Design Agent',
    CODE_AGENT: 'Code Implementation Agent',
    UI_AGENT: 'UI & Frontend Specialist Agent',
    BACKEND_AGENT: 'Backend & API Specialist Agent',
    DATABASE_AGENT: 'Database & Schema Agent',
    SECURITY_AGENT: 'Security & Audit Agent',
    TEST_AGENT: 'Testing & Quality Agent',
    DEBUG_AGENT: 'Debugging & Diagnosis Agent',
    REVIEW_AGENT: 'Code Review Agent',
    LOGIC_AGENT: 'Business Logic Agent',
    DATA_AGENT: 'Data & Schema Agent',
    ARCHITECTURE_AGENT: 'Architecture & System Design Agent',
    TESTING_AGENT: 'Testing Agent',
    DOCUMENTATION_AGENT: 'Documentation Agent',
    GENERALIST: 'General Engineering Agent'
  };

  const name = roleNames[role] ?? `Specialized Agent (${role})`;
  const defaultTools = allowedOperations.filter((op) => !op.includes('_') || op.toLowerCase() === op);

  return {
    agentId,
    agentType: role,
    name,
    identity: {
      id: agentId,
      name,
      role: role as AgentRole
    },
    capabilities,
    allowedOperations,
    requiredContext: ['FILE_CONTENT', 'PROJECT_DNA'],
    riskLevel,
    maxExecutionDepth: role === 'ARCHITECT_AGENT' || role === 'SECURITY_AGENT' ? 5 : 4,
    permissions,
    systemPrompt: `You are an AI-Native specialized ${name}. Follow strict capability boundaries. Never exceed your allowedOperations.`,
    defaultTools
  };
}
