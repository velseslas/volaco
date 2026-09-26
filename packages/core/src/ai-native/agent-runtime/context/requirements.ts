/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Context Requirements Engine
 */

import type { AgentIntent, ContextRequirement } from '../types.js';
import type { ContextAssemblyService } from '../../context/service.js';
import type { ContextPack, ContextRequest } from '../../context/types.js';
import type { Role } from '../../../identity/permissions.js';

export class ContextRequirementEngine {
  constructor(private readonly contextService?: ContextAssemblyService | undefined) {}

  public determineRequirements(intent: AgentIntent): readonly ContextRequirement[] {
    const reqs: ContextRequirement[] = [];

    // Always include high-level summary/DNA if project understanding or feature work
    if (intent.type === 'UNDERSTAND_PROJECT' || intent.type === 'ADD_FEATURE' || intent.type === 'REFACTOR') {
      reqs.push({
        type: 'PROJECT_DNA',
        target: 'project:dna',
        reason: 'Comprendre l architecture globale et la stack technique',
        priority: 'CRITICAL',
        maxTokens: 2000,
        required: true
      });
    }

    // If explicit entities (files/symbols) are identified, focus on them
    for (const entity of intent.entities) {
      if (entity.includes('.')) {
        reqs.push({
          type: 'FILE_CONTENT',
          target: entity,
          reason: `Fichier cible identifie dans la demande: ${entity}`,
          priority: 'CRITICAL',
          maxTokens: 3000,
          required: true
        });
      } else {
        reqs.push({
          type: 'SYMBOL_CONTEXT',
          target: entity,
          reason: `Symbole cible identifie dans la demande: ${entity}`,
          priority: 'HIGH',
          maxTokens: 1500,
          required: false
        });
      }
    }

    // Default fallback requirement if no specific entities
    if (reqs.length === 0) {
      reqs.push({
        type: 'WORKSPACE_OVERVIEW',
        target: 'workspace:summary',
        reason: 'Vue d ensemble du workspace pour requete generale',
        priority: 'MEDIUM',
        maxTokens: 2000,
        required: true
      });
    }

    return reqs;
  }

  public assembleRequiredContext(
    intent: AgentIntent,
    tenantId: string,
    projectId: string,
    userRole: Role = 'VIEWER',
    maxTokens = 8000
  ): ContextPack | undefined {
    if (!this.contextService) {
      return undefined;
    }

    const reqs = this.determineRequirements(intent);
    const focusFiles = reqs
      .filter((r) => r.type === 'FILE_CONTENT')
      .map((r) => r.target);

    const focusSymbols = reqs
      .filter((r) => r.type === 'SYMBOL_CONTEXT')
      .map((r) => r.target);

    const request: ContextRequest = {
      tenantId,
      projectId,
      taskDescription: intent.goal,
      targetFiles: focusFiles.length > 0 ? focusFiles : undefined,
      targetSymbols: focusSymbols.length > 0 ? focusSymbols : undefined,
      budget: {
        maxTokens
      }
    };

    return this.contextService.assembleContext(request, userRole);
  }
}
