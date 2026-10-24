/**
 * VibeCode Core - API Tier
 * Design Auto-Improvement Route (CDC V8 §17-§21 — Lot B)
 *
 * POST /api/v1/projects/:projectId/design/improve
 *
 * Boucle RÉELLE, bornée et mesurée sur l'AQS :
 *   mesure AQS réelle (rendu Chromium) → faiblesses → plan §21 (WHY/WHAT/
 *   IMPACT/RISKS) → modification (LLM) → re-mesure → comparaison §20 →
 *   garde-fous §19 (fonctionnel/a11y/sécurité/responsive/régression) →
 *   acceptation ou rollback → arrêt sur cible / delta / borne (§18).
 *
 * CONTRÔLE HUMAIN (§21) — aucune modification silencieuse :
 *  - mode PLAN (défaut) : la boucle mesure et propose, mais n'écrit JAMAIS
 *    dans le workspace ; la réponse contient le plan + la comparaison A/B +
 *    les garde-fous ;
 *  - mode APPLY (`apply: true` + `approvedBy`) : si au moins une itération a
 *    été acceptée, un checkpoint de l'état AVANT est créé, puis le HTML
 *    amélioré est écrit et une révision est enregistrée. `rollbackRevisionId`
 *    permet le Rollback via POST .../revisions/:id/rollback.
 *
 * Le patch LLM passe par les MÊMES filets images que la réparation
 * (sanitizeImageSources + addImageFallbacks) et par le contrat de thème : le
 * secteur du projet n'est jamais changé par une amélioration.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ImprovementPlan } from '../../../../packages/core/src/ai-native/design-harmony/types.js';
import { VisualImprovementLoop } from '../../../../packages/core/src/ai-native/design-harmony/engine/improvement-loop.js';
import {
  budgetToLoopOptions,
  evaluateQualityBudgetUsage,
  normalizeQualityBudget,
  QualityBudgetTracker,
  type QualityBudgetUsage
} from '../../../../packages/core/src/ai-native/design-harmony/quality-budget.js';
import { qualityBudgetStore } from '../../../../packages/core/src/ai-native/design-harmony/quality-budget-store.js';
import { measureProjectAesthetics } from './design-measure.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { aiProviderRegistry } from '../../../../packages/core/src/ai/providers/registry.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { logger } from '../../../../packages/core/src/logger.js';
import {
  buildImageBrief,
  buildSectorContract,
  detectImageTheme,
  pageTitleHint,
  type ImageTheme
} from '../../../../packages/core/src/image/theme.js';
import { addImageFallbacks, sanitizeImageSources } from './conversation.js';
import type { RequestContext } from '../middleware/auth.js';
import { readBody } from '../middleware/body.js';

export interface ImprovementPrompts {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly imageTheme: ImageTheme;
}

/**
 * Prompts PURS de l'amélioration (§21 : WHY/WHAT/IMPACT/RISKS transmis au
 * modifier). La réécriture complète du HTML impose le même rappel de thème
 * que la réparation : sans lui, une amélioration pouvait changer de secteur.
 */
export function buildImprovementPrompts(
  html: string,
  plan: ImprovementPlan,
  imageTheme: ImageTheme
): ImprovementPrompts {
  const systemPrompt = "Tu es l'ingénieur d'amélioration esthétique de VibeCode Studio. On te donne le code HTML complet d'une application et la LISTE DES FAIBLESSES ESTHÉTIQUES MESURÉES (Design Critic + Aesthetic Quality Score, preuves DOM réelles). Traite UNIQUEMENT ces faiblesses visuelles : ne change ni le contenu, ni le secteur, ni la logique métier, ni la navigation. Préserve les images et leurs sources. Réponds UNIQUEMENT avec le code HTML complet corrigé dans un bloc ```html ... ```."
    + '\n\n' + buildSectorContract(imageTheme, 'modify')
    + '\n\n' + buildImageBrief(imageTheme, 'modify');

  const weaknesses = plan.proposals.map((proposal, index) => [
    `${index + 1}. ${proposal.why}`,
    `   Quoi faire : ${proposal.what}`,
    `   Impact attendu : ${proposal.impact}`,
    `   Risques : ${proposal.risks.join(' ; ')}`
  ].join('\n')).join('\n');

  const userPrompt = `Faiblesses mesurées (AQS actuel ${plan.currentOverall}/100, cible ${plan.targetOverall}/100) :\n${weaknesses}\n\nCode HTML actuel :\n\`\`\`html\n${html}\n\`\`\``;
  return { systemPrompt, userPrompt, imageTheme };
}

const MAX_IMPROVEMENT_ITERATIONS = 4;

interface ImproveBody {
  maxIterations?: number;
  target?: number;
  deltaThreshold?: number;
  apply?: boolean;
  approvedBy?: string;
  /** CDC V8.1 §18 — budget complet (camelCase ou snake_case). */
  budget?: unknown;
}

export async function handleImproveRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  if (!pathname.startsWith('/api/v1/projects/') || !pathname.endsWith('/design/improve') || req.method !== 'POST') {
    return false;
  }
  const projectId = pathname.slice('/api/v1/projects/'.length, -'/design/improve'.length);
  if (!projectId || projectId.includes('/')) return false;

  assertPermission(context.role, 'PROJECT_UPDATE', requestId);

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    sendJson(res, 404, { message: `Projet ${projectId} introuvable`, requestId });
    return true;
  }

  let body: ImproveBody = {};
  try {
    const parsed = await readBody(req);
    body = (typeof parsed === 'string' ? JSON.parse(parsed || '{}') : (parsed || {})) as ImproveBody;
  } catch {
    body = {};
  }

  const apply = body.apply === true;
  const approvedBy = typeof body.approvedBy === 'string' ? body.approvedBy.trim() : '';
  // §21 — l'IA ne modifie JAMAIS sans approbation humaine explicite.
  if (apply && approvedBy.length === 0) {
    throw new ValidationError(
      'Le contrôle humain (§21) exige "approvedBy" (identité de l\'approbateur) pour appliquer une amélioration.',
      undefined,
      requestId
    );
  }

  const files = fileStore.getAllProjectFiles(context.tenantId, projectId);
  const html = files['index.html'] || '';
  if (!html.trim()) {
    throw new ValidationError('Aucun index.html à améliorer.', undefined, requestId);
  }

  const preferredProviderId = process.env.MISTRAL_API_KEY ? 'mistral' : process.env.GEMINI_API_KEY ? 'gemini' : undefined;
  const adapter = aiProviderRegistry.resolve(preferredProviderId ? { preferredProviderId } : {});
  if (!adapter) {
    sendJson(res, 503, { message: "Aucun fournisseur IA disponible pour l'amélioration design.", requestId });
    return true;
  }

  const imageTheme = detectImageTheme('', pageTitleHint(html));
  logger.info('Contrat de thème (amélioration design)', {
    component: 'improve-route',
    tenantId: context.tenantId,
    projectId,
    imageTheme,
    requestId
  });

  // CDC V8.1 §18 — budget effectif = budget projet persisté + overrides de la
  // requête. Les champs historiques (maxIterations/target/deltaThreshold)
  // restent acceptés et sont mappés sur le budget, sans changer leur sens.
  const storedBudgetConfig = qualityBudgetStore.getConfig(context.tenantId, projectId);
  const budgetOverrides: Record<string, unknown> = {};
  if (body.budget !== null && typeof body.budget === 'object' && !Array.isArray(body.budget)) {
    Object.assign(budgetOverrides, body.budget as Record<string, unknown>);
  }
  if (Number.isFinite(Number(body.maxIterations))) {
    budgetOverrides.maxIterations = Math.max(1, Math.min(MAX_IMPROVEMENT_ITERATIONS, Number(body.maxIterations)));
  }
  if (Number.isFinite(Number(body.target))) {
    budgetOverrides.qualityTarget = Math.max(0, Math.min(100, Number(body.target)));
  }
  if (Number.isFinite(Number(body.deltaThreshold))) {
    budgetOverrides.minimumImprovementDelta = Math.max(0, Math.min(25, Number(body.deltaThreshold)));
  }
  const budget = normalizeQualityBudget(budgetOverrides, {
    base: qualityBudgetStore.getEffective(context.tenantId, projectId)
  });
  const budgetSource = storedBudgetConfig
    ? 'PROJECT'
    : Object.keys(budgetOverrides).length > 0
      ? 'REQUEST'
      : 'DEFAULT';
  const options = budgetToLoopOptions(budget);
  const budgetTracker = new QualityBudgetTracker(budget);

  const executionStartedAt = new Date().toISOString();
  const loop = new VisualImprovementLoop();
  const outcome = await loop.run(
    html,
    {
      // RENDER → ANALYZE → CRITIQUE → SCORE : mesure réelle du candidat,
      // SANS jamais écrire dans le workspace.
      measure: async (candidateHtml) => {
        const measurement = await measureProjectAesthetics({
          tenantId: context.tenantId,
          projectId,
          requestId,
          role: context.role,
          files: { ...files, 'index.html': candidateHtml }
        });
        return {
          aqs: measurement.aqs,
          critique: measurement.critique,
          responsiveFindings: measurement.responsiveFindings,
          runtimeErrors: measurement.runtimeErrors,
          ...(measurement.mobileOverflow !== undefined ? { mobileOverflow: measurement.mobileOverflow } : {})
        };
      },
      // MODIFY : LLM + filets images identiques à la réparation.
      // §18 — chaque appel est précédé du gate budget (tokens/calcul/borne) et
      // son usage réel est enregistré, y compris quand la réponse est inexploitable.
      modify: async (candidateHtml, plan) => {
        const gate = budgetTracker.canStartIteration();
        if (!gate.allowed) {
          logger.info('Design Improve : budget qualité épuisé avant appel', {
            component: 'improve-route',
            projectId,
            reasons: gate.reasons,
            requestId
          });
          return null;
        }
        const callTimeoutMs = budgetTracker.nextCallTimeoutMs();
        const callMaxTokens = budgetTracker.nextCallMaxTokens();
        if (callTimeoutMs < 1_000 || callMaxTokens < 64) {
          return null;
        }
        budgetTracker.recordIterationStarted();
        const callStartedAt = Date.now();
        const prompts = buildImprovementPrompts(candidateHtml, plan, imageTheme);
        try {
          const response = await adapter.generate(
            {
              tenantId: context.tenantId,
              projectId,
              prompt: prompts.userPrompt,
              systemPrompt: prompts.systemPrompt,
              temperature: 0.2,
              maxTokens: callMaxTokens,
              timeoutMs: callTimeoutMs,
              requestId
            },
            aiProviderRegistry.getTenantCredentials(context.tenantId, adapter.descriptor.providerId)
          );
          const reportedTokens =
            response.usage !== undefined && Number.isFinite(response.usage.totalTokens)
              ? response.usage.totalTokens
              : Math.ceil((prompts.userPrompt.length + prompts.systemPrompt.length + response.text.length) / 4);
          budgetTracker.recordLlmCall(
            reportedTokens,
            Number.isFinite(response.latencyMs) ? response.latencyMs : Date.now() - callStartedAt
          );
          const match = response.text.match(/```(?:html)?([\s\S]*?)```/i);
          const candidate = (match && match[1] ? match[1] : response.text).trim();
          if (candidate.length <= 100 || !/<html|<!DOCTYPE/i.test(candidate)) {
            budgetTracker.recordIterationCompleted();
            return null;
          }
          const sanitized = sanitizeImageSources(candidate, imageTheme);
          budgetTracker.recordVisualChange(1);
          budgetTracker.recordIterationCompleted();
          return addImageFallbacks(sanitized.html, imageTheme);
        } catch (error) {
          budgetTracker.recordLlmCall(0, Date.now() - callStartedAt);
          budgetTracker.recordIterationCompleted();
          logger.warn("Design Improve : échec de l'appel LLM", {
            component: 'improve-route',
            projectId,
            error: error instanceof Error ? error.message : String(error),
            requestId
          });
          return null;
        }
      }
    },
    options
  );

  const last = outcome.iterations[outcome.iterations.length - 1];
  let revisionId: string | undefined;
  let rollbackRevisionId: string | undefined;
  let modified = false;

  if (apply && outcome.applied) {
    // Checkpoint AVANT : garantit un Rollback réel (§21) même quand aucune
    // révision antérieure n'existe pour ce projet.
    const checkpoint = revisionStore.createRevision(context.tenantId, projectId, {
      message: `Design Improve — checkpoint avant amélioration (AQS ${outcome.initialOverall ?? '?'})`,
      author: `Agent IA (approuvé par ${approvedBy})`,
      files: { 'index.html': html },
      provenance: {
        source: 'AI_AGENT',
        prompt: 'Checkpoint avant amélioration esthétique approuvée',
        triggerRequestId: requestId
      }
    });
    rollbackRevisionId = checkpoint.id;
    fileStore.saveFile(context.tenantId, projectId, 'index.html', outcome.finalHtml);
    const revision = revisionStore.createRevision(context.tenantId, projectId, {
      message: `Design Improve — AQS ${outcome.initialOverall ?? '?'} → ${outcome.finalOverall ?? '?'} (${outcome.stopReason})`,
      author: `Agent IA (approuvé par ${approvedBy})`,
      files: { 'index.html': outcome.finalHtml },
      provenance: {
        source: 'AI_AGENT',
        prompt: `Amélioration esthétique AQS (plan ${last?.plan.planId ?? 'sans-plan'})`,
        triggerRequestId: requestId
      }
    });
    revisionId = revision.id;
    modified = true;
    auditStore.record({
      tenantId: context.tenantId,
      userId: 'system',
      action: 'DESIGN_IMPROVEMENT_APPLIED',
      resourceType: 'design_improvement',
      resourceId: revision.id,
      status: 'SUCCESS',
      metadata: {
        projectId,
        initialAqs: outcome.initialOverall,
        finalAqs: outcome.finalOverall,
        totalDelta: outcome.totalDelta,
        stopReason: outcome.stopReason,
        iterations: outcome.iterations.length,
        budgetVersion: budget.version,
        budgetExhausted: budgetTracker.status().exhausted,
        approvedBy
      },
      requestId
    });
  }

  const acceptedIterations = outcome.iterations.filter(
    (iteration) => iteration.modified && iteration.guardVerdict === 'APPROVE'
  ).length;
  const trackerUsage = budgetTracker.usage();
  const budgetUsage: QualityBudgetUsage = {
    ...trackerUsage,
    visualChanges: Math.max(trackerUsage.visualChanges, acceptedIterations),
    filesChanged: modified ? 1 : 0
  };
  const budgetStatus = evaluateQualityBudgetUsage(budget, budgetUsage);
  const effectiveStopReason =
    budgetStatus.exhausted && outcome.stopReason === 'MODIFICATION_FAILED'
      ? 'BUDGET_EXHAUSTED'
      : outcome.stopReason;
  const budgetExecution = qualityBudgetStore.recordExecution({
    executionId: 'qbx-' + randomUUID().replace(/-/g, '').slice(0, 16),
    tenantId: context.tenantId,
    projectId,
    startedAt: executionStartedAt,
    finishedAt: new Date().toISOString(),
    budget,
    usage: budgetUsage,
    status: budgetStatus,
    stopReason: effectiveStopReason,
    applyRequested: apply,
    modified,
    ...(apply && approvedBy.length > 0 ? { approvedBy } : {})
  }).execution;

  const approveUrl = `POST /api/v1/projects/${projectId}/design/improve { "apply": true, "approvedBy": "<utilisateur>" }`;
  sendJson(res, 200, {
    modified,
    applyRequested: apply,
    approvedBy: apply ? approvedBy : null,
    improved: outcome.applied,
    initialAqs: outcome.initialOverall,
    finalAqs: outcome.finalOverall,
    totalDelta: outcome.totalDelta,
    target: outcome.target,
    targetReached: outcome.targetReached,
    stopReason: effectiveStopReason,
    loopStopReason: outcome.stopReason,
    budget,
    budgetSource,
    budgetUsage,
    budgetStatus,
    budgetExecutionId: budgetExecution.executionId,
    iterations: outcome.iterations,
    comparison: last?.comparison ?? null,
    guards: last?.guards ?? [],
    actions: {
      accept: !apply && outcome.applied ? approveUrl : null,
      reject: modified
        ? `Rollback : POST /api/v1/projects/${projectId}/revisions/${rollbackRevisionId ?? ''}/rollback`
        : 'Ne rien faire : le workspace est intact (mode PLAN, §21 : aucune modification silencieuse).',
      compare: `GET /api/v1/projects/${projectId}/design/aesthetic (comparaison A/B incluse dans chaque itération)`,
      rollback: rollbackRevisionId
        ? `POST /api/v1/projects/${projectId}/revisions/${rollbackRevisionId}/rollback`
        : 'Sans objet : aucune modification persistée.'
    },
    ...(revisionId !== undefined ? { revisionId } : {}),
    ...(rollbackRevisionId !== undefined ? { rollbackRevisionId } : {}),
    requestId
  });
  return true;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
