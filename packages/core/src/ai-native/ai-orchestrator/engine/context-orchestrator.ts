/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Minimal Sufficient Context Orchestrator & Secret Sanitizer
 */

import { logger } from '../../../logger.js';
import type { Role } from '../../../identity/permissions.js';
import type { ApplicationUnderstandingService } from '../../application-understanding/service.js';
import type { ApplicationDNAService } from '../../dna/service.js';
import type { SemanticCodeGraphService } from '../../semantic-graph/service.js';
import type { AgentTask, TaskContextPayload } from '../types.js';
import { isSensitivePath, maskSensitiveDetail } from '../../application-understanding/engine/evidence.js';
import {
  loadProjectDesignContext,
  type DesignContextStoreLike,
  type ProjectDesignContext
} from '../../design-harmony/design-context.js';
import type { DesignSystemStoreLike } from '../../design-harmony/design-system-store.js';

export class ContextOrchestrator {
  constructor(
    private readonly understandingService?: ApplicationUnderstandingService | undefined,
    private readonly dnaService?: ApplicationDNAService | undefined,
    private readonly graphService?: SemanticCodeGraphService | undefined,
    /**
     * CDC V8 §11 — source du Design DNA (DesignReportStore réel par défaut ;
     * injectable pour les tests).
     */
    private readonly designReports?: DesignContextStoreLike | undefined,
    /**
     * CDC V8 §11 — source de l'artefact Design System persisté
     * (DesignSystemStore réel par défaut ; injectable pour les tests).
     */
    private readonly designSystems?: DesignSystemStoreLike | undefined
  ) {}

  public assembleTaskContext(params: {
    tenantId: string;
    projectId: string;
    task: AgentTask;
    rawFiles?: Record<string, string> | undefined;
    decisions?: readonly string[] | undefined;
    constraints?: readonly string[] | undefined;
    userRole?: Role | undefined;
    requestId?: string | undefined;
  }): TaskContextPayload {
    const { tenantId, projectId, task, rawFiles = {}, decisions = [], constraints = [], userRole = 'OWNER', requestId } = params;

    const sanitizedRelevantFiles: Record<string, string> = {};
    const relevantSymbols: string[] = [];

    // 1. Filter and sanitize targeted files
    const targets = task.requiredContext.targetFiles || [];
    for (const [filePath, content] of Object.entries(rawFiles)) {
      if (isSensitivePath(filePath)) {
        continue; // Exclude sensitive files from LLM context
      }

      const isTargeted = targets.length === 0 || targets.some((t) => filePath.includes(t) || t.includes(filePath));
      if (isTargeted) {
        sanitizedRelevantFiles[filePath] = maskSensitiveDetail(content);
      }
    }

    // 2. Extract semantic understanding slice if requested
    let understandingSlice: TaskContextPayload['understandingSnapshot'] = undefined;
    if (task.requiredContext.includeSemanticModel && this.understandingService) {
      try {
        const fullUnderstanding = this.understandingService.buildUnderstanding(
          { tenantId, projectId },
          userRole,
          requestId
        );

        if (fullUnderstanding) {
          understandingSlice = {
            domains: fullUnderstanding.domains.filter((d) =>
              task.domain === 'BACKEND' || task.domain === 'DATA' ? true : d.name.toLowerCase().includes(task.domain.toLowerCase())
            ),
            features: fullUnderstanding.features.slice(0, 10),
            businessRules: fullUnderstanding.businessRules.filter((r) =>
              task.domain === 'SECURITY' ? r.type === 'AUTHORIZATION' || r.type === 'VALIDATION' : true
            )
          };
        }
      } catch (err) {
        logger.warn('Échec de la récupération du slice sémantique — fallback sans slice', {
          component: 'context-orchestrator',
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // 3. Extract symbols if graph service available
    if (task.requiredContext.includeSemanticGraph && this.graphService) {
      try {
        const graph = this.graphService.buildGraph({ tenantId, projectId }, userRole, requestId);
        for (const node of graph.nodes) {
          if (node.filePath && targets.some((t) => node.filePath!.includes(t))) {
            relevantSymbols.push(node.name);
          }
        }
      } catch (err) {
        logger.warn('Échec de l\'extraction de symboles — ignoré, poursuite sans symboles', {
          component: 'context-orchestrator',
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // 4. CDC V8 §11 — Design DNA : consommé UNIQUEMENT quand la tâche le
    //    demande (includeDna, posé par le décomposeur sur les tâches UI).
    //    Sans rapport Design Harmony persisté : aucun bloc ajouté — le
    //    prompt des agents reste strictement identique à l'ancien.
    let designContext: ProjectDesignContext | undefined;
    if (task.requiredContext.includeDna === true) {
      designContext = loadProjectDesignContext({
        tenantId,
        projectId,
        ...(this.designReports ? { store: this.designReports } : {}),
        ...(this.designSystems ? { systemStore: this.designSystems } : {})
      });
    }

    return {
      understandingSnapshot: understandingSlice,
      relevantFiles: sanitizedRelevantFiles,
      relevantSymbols: relevantSymbols.slice(0, 20),
      decisions,
      constraints,
      recentHistory: [],
      ...(designContext ? { designContext } : {})
    };
  }
}
