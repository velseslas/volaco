/**
 * VibeCode Core - API Tier
 * Self-Repair Route (ÉTAPE 7 — §26 CDC)
 *
 * Boucle bornée ERROR → DIAGNOSIS → PATCH → TEST → VALIDATE :
 *   1. DIAGNOSIS : critique visuelle du projet (rendu réel Chromium + analyse
 *      DOM déterministe — mêmes règles que /visual/analyze).
 *   2. Si des erreurs runtime existent : PATCH par LLM (HTML corrigé, prompt
 *      contenant les erreurs réelles observées).
 *   3. TEST/VALIDATE : re-critique ; le patch n'est conservé QUE si le score
 *      s'améliore (Pareto-Safe, §22 V8), sinon rollback au HTML précédent.
 * Le nombre d'itérations est LIMITÉ (§26 : « le nombre de tentatives est
 * limité ») et chaque itération est enregistrée dans la réponse.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderProjectPreview } from '../../../../packages/core/src/ai-native/visual-intelligence/real-renderer.js';
import { computeCriticScore } from './visual.js';
import { measureProjectAesthetics } from './design-measure.js';
import { evaluateAqsNonRegression } from '../../../../packages/core/src/ai-native/design-harmony/engine/regression-guard.js';
import type { AestheticQualityScore } from '../../../../packages/core/src/ai-native/design-harmony/types.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { aiProviderRegistry } from '../../../../packages/core/src/ai/providers/registry.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { executionStore } from '../../../../packages/core/src/ai-native/execution/store.js';
import { logger } from '../../../../packages/core/src/logger.js';
import {
  buildImageBrief,
  buildSectorContract,
  detectImageTheme,
  pageTitleHint,
  type ImageTheme,
} from '../../../../packages/core/src/image/theme.js';
// P1-A — filet images de la réparation : mêmes fonctions que le pipeline
// principal (conversation.ts), aucune logique dupliquée.
import { addImageFallbacks, sanitizeImageSources } from './conversation.js';
import type { RequestContext } from '../middleware/auth.js';
import { readBody } from '../middleware/body.js';

/**
 * Prompts purs de la réparation (contrat de thème global + brief images en
 * rappel — testables sans IA). La réparation réécrit le HTML complet : sans
 * ce rappel, le patch pouvait changer de secteur ou réintroduire des images
 * hors sujet. Thème déduit du titre existant (aucune demande sectorielle
 * dans cette route), préservation exigée dans les deux cas.
 */
export interface RepairPrompts {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly imageTheme: ImageTheme;
}

export function buildRepairPrompts(html: string, runtimeErrors: string[]): RepairPrompts {
  const imageTheme = detectImageTheme('', pageTitleHint(html));
  const systemPrompt = "Tu es l'ingénieur de réparation de VibeCode Studio. On te donne le code HTML complet d'une application et la LISTE DES ERREURS RUNTIME réelles observées au chargement. Corrige UNIQUEMENT ces erreurs, sans changer le reste de l'application (Pareto-Safe). Réponds UNIQUEMENT avec le code HTML complet corrigé dans un bloc ```html ... ```."
    + '\n\n' + buildSectorContract(imageTheme, 'modify')
    + '\n\n' + buildImageBrief(imageTheme, 'modify');
  const userPrompt = `Erreurs runtime observées :\n${runtimeErrors.map((e) => '- ' + e).join('\n')}\n\nCode HTML actuel :\n\`\`\`html\n${html}\n\`\`\``;
  return { systemPrompt, userPrompt, imageTheme };
}

const MAX_REPAIR_ITERATIONS = 3;
const REPAIR_TARGET_SCORE = 90;
/**
 * LOT B (§19) — tolérance de régression AQS d'un patch de réparation : un
 * patch qui corrige les erreurs runtime mais fait chuter le design de plus de
 * 5 points est refusé (la fonctionnalité ne se répare pas en cassant le
 * design). Le gate s'abstient si l'AQS n'est pas mesurable des deux côtés.
 */
const REPAIR_AQS_TOLERANCE = 5;

interface RepairIteration {
  iteration: number;
  scoreBefore: number;
  scoreAfter: number | null;
  action: string;
  errorsDiagnosed: string[];
  /** LOT B — AQS global avant/après le patch (null = non mesurable). */
  aqsBefore?: number | null;
  aqsAfter?: number | null;
  /** LOT B — garde déclenché ('AQS_REGRESSION') le cas échéant. */
  guard?: string;
}

interface CriticFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  source: 'RUNTIME' | 'CONSOLE' | 'DESIGN';
  title: string;
  detail: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/** DIAGNOSIS : score + erreurs runtime réelles du rendu headless. */
async function diagnose(
  tenantId: string,
  projectId: string,
  role: RequestContext['role'],
  requestId: string
): Promise<{ score: number; runtimeErrors: string[]; aqs: AestheticQualityScore | null }> {
  const findings: CriticFinding[] = [];
  const files = fileStore.getAllProjectFiles(tenantId, projectId);
  let runtimeErrors: string[] = [];
  let aqs: AestheticQualityScore | null = null;
  try {
    const render = await renderProjectPreview(files);
    runtimeErrors = [...render.pageErrors];
    for (const err of render.pageErrors) {
      findings.push({ severity: 'CRITICAL', source: 'RUNTIME', title: 'Erreur runtime', detail: err });
    }
    for (const ce of render.consoleMessages.filter((m) => m.type === 'error').slice(0, 10)) {
      findings.push({ severity: 'HIGH', source: 'CONSOLE', title: 'Erreur console', detail: ce.text });
    }
    // LOT B (§19) — l'état design courant est mesuré sur le DOM runtime DÉJÀ
    // capturé (aucun rendu supplémentaire) : substance du gate design du patch.
    try {
      const measurement = await measureProjectAesthetics({
        tenantId,
        projectId,
        requestId,
        role,
        files,
        ...(render.runtimeDom !== undefined ? { runtimeDom: render.runtimeDom } : {}),
        ...(render.mobileRuntimeDom !== undefined ? { mobileRuntimeDom: render.mobileRuntimeDom } : {}),
        ...(render.mobileOverflow !== undefined ? { mobileOverflow: render.mobileOverflow } : {})
      });
      aqs = measurement.aqs;
    } catch {
      aqs = null; // mesure design impossible : le gate s'abstiendra
    }
  } catch {
    // Chromium indisponible : aucune erreur runtime observable -> pas de réparation possible
    return { score: 100, runtimeErrors: [], aqs: null };
  }
  return { score: computeCriticScore(findings), runtimeErrors, aqs };
}

export async function handleRepairRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // POST /api/v1/projects/:projectId/repair
  if (!pathname.startsWith('/api/v1/projects/') || !pathname.endsWith('/repair') || req.method !== 'POST') {
    return false;
  }
  const projectId = pathname.slice('/api/v1/projects/'.length, -'/repair'.length);
  if (!projectId) return false;

  assertPermission(context.role, 'PROJECT_UPDATE', requestId);

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    sendJson(res, 404, { message: `Projet ${projectId} introuvable`, requestId });
    return true;
  }

  let body: { maxIterations?: number; executionId?: string } = {};
  try {
    body = (await readBody(req) || '{}') as unknown as { maxIterations?: number; executionId?: string };
    if (typeof body === 'string') body = JSON.parse(body) as { maxIterations?: number; executionId?: string };
  } catch {
    body = {};
  }
  const maxIterations = Math.max(1, Math.min(MAX_REPAIR_ITERATIONS, Number(body.maxIterations) || 2));

  // T6 (CDC §22-§23) — le cycle de réparation devient VISIBLE : si un
  // executionId est fourni (et appartient au tenant), les événements
  // REPAIR_* rejoignent la timeline de la génération concernée.
  const linkedExecution = body.executionId ? executionStore.getExecution(body.executionId) : null;
  const repairEvents = linkedExecution && linkedExecution.tenantId === context.tenantId ? body.executionId! : null;

  const preferredProviderId = process.env.MISTRAL_API_KEY ? 'mistral' : process.env.GEMINI_API_KEY ? 'gemini' : undefined;
  const adapter = aiProviderRegistry.resolve(preferredProviderId ? { preferredProviderId } : {});
  if (!adapter) {
    sendJson(res, 503, { message: "Aucun fournisseur IA disponible pour la réparation.", requestId });
    return true;
  }

  const iterations: RepairIteration[] = [];
  let html = fileStore.getAllProjectFiles(context.tenantId, projectId)['index.html'] || '';
  if (!html.trim()) {
    sendJson(res, 400, { message: 'Aucun index.html à réparer.', requestId });
    return true;
  }

  let diagnosis = await diagnose(context.tenantId, projectId, context.role, requestId);
  let currentScore = diagnosis.score;
  let currentAqs = diagnosis.aqs;

  if (repairEvents) {
    executionStore.appendEvent(repairEvents, {
      type: 'REPAIR_STARTED',
      phase: 'REPAIR',
      status: 'RUNNING',
      title: 'Réparation automatique lancée',
      detail: { initialScore: currentScore, maxIterations, runtimeErrors: diagnosis.runtimeErrors.slice(0, 5) }
    });
  }

  for (let i = 1; i <= maxIterations; i++) {
    iterations.push({
      iteration: i,
      scoreBefore: currentScore,
      scoreAfter: null,
      action: 'diagnosis',
      errorsDiagnosed: diagnosis.runtimeErrors.slice(0, 10),
      aqsBefore: currentAqs?.overall ?? null
    });

    if (diagnosis.runtimeErrors.length === 0) {
      iterations[iterations.length - 1]!.action = 'no-repair-needed';
      break;
    }

    // PATCH par LLM — prompts purs testables (contrat de thème + brief
    // images) : voir buildRepairPrompts. La réparation réécrit le HTML
    // complet ; sans ce rappel, le patch pouvait changer de secteur.
    const previousHtml = html;
    const repairPrompts = buildRepairPrompts(html, diagnosis.runtimeErrors.slice(0, 10));
    logger.info('Contrat de thème (réparation)', {
      component: 'repair-route',
      tenantId: context.tenantId,
      projectId,
      imageTheme: repairPrompts.imageTheme,
      requestId
    });
    const systemPrompt = repairPrompts.systemPrompt;
    const userPrompt = repairPrompts.userPrompt;

    let patched: string | null = null;
    try {
      const response = await adapter.generate(
        {
          tenantId: context.tenantId,
          projectId,
          prompt: userPrompt,
          systemPrompt,
          temperature: 0.1,
          maxTokens: 8192,
          requestId
        },
        aiProviderRegistry.getTenantCredentials(context.tenantId, adapter.descriptor.providerId)
      );
      const match = response.text.match(/```(?:html)?([\s\S]*?)```/i);
      const candidate = (match && match[1] ? match[1] : response.text).trim();
      if (candidate.length > 100 && /<html|<!DOCTYPE/i.test(candidate)) patched = candidate;
    } catch (error) {
      logger.warn('Self-Repair : échec de l\'appel LLM', { component: 'repair-route', projectId, error: error instanceof Error ? error.message : String(error), requestId });
    }

    if (!patched) {
      iterations[iterations.length - 1]!.action = 'patch-failed';
      break;
    }

    // P1-A — FILET IMAGES AVANT SAUVEGARDE : le HTML réinventé par le patch
    // passe par les MÊMES fonctions que le pipeline principal —
    // sanitizeImageSources (URLs hors réservoir réécrites vers le THÈME)
    // puis addImageFallbacks (onerror de repli) — avec le thème calculé
    // pour cette itération (celui du projet réparé). En cas d'échec du
    // traitement : le patch est refusé (action 'patch-failed' existante),
    // le HTML brut n'est JAMAIS sauvegardé.
    let treated: string;
    try {
      const sanitizedRepair = sanitizeImageSources(patched, repairPrompts.imageTheme);
      treated = addImageFallbacks(sanitizedRepair.html, repairPrompts.imageTheme);
    } catch {
      logger.warn('Self-Repair : traitement images échoué — patch refusé (HTML brut non sauvegardé)', {
        component: 'repair-route',
        projectId,
        requestId
      });
      iterations[iterations.length - 1]!.action = 'patch-failed';
      break;
    }

    // TEST/VALIDATE : re-critique du patch TRAITÉ
    fileStore.saveFile(context.tenantId, projectId, 'index.html', treated);
    diagnosis = await diagnose(context.tenantId, projectId, context.role, requestId);
    const afterScore = diagnosis.score;
    const afterAqs = diagnosis.aqs;
    const currentIteration = iterations[iterations.length - 1]!;
    currentIteration.scoreAfter = afterScore;
    currentIteration.aqsAfter = afterAqs?.overall ?? null;

    if (afterScore > currentScore) {
      // LOT B (§19) — GATE AQS : le patch ne doit pas casser le design
      // au-delà de la tolérance, même s'il améliore le score fonctionnel.
      // Le gate s'abstient si l'AQS n'est pas mesurable des deux côtés.
      const gate = currentAqs && afterAqs
        ? evaluateAqsNonRegression(currentAqs, afterAqs, REPAIR_AQS_TOLERANCE)
        : null;
      if (gate && gate.regressed) {
        fileStore.saveFile(context.tenantId, projectId, 'index.html', previousHtml);
        currentIteration.action = 'patch-rolled-back';
        currentIteration.guard = 'AQS_REGRESSION';
        currentIteration.scoreAfter = currentScore;
        logger.warn('Self-Repair : patch refusé par le gate AQS (§19)', {
          component: 'repair-route',
          projectId,
          reasons: gate.reasons,
          requestId
        });
        break;
      }
      currentIteration.action = 'patch-applied';
      html = treated;
      currentScore = afterScore;
      currentAqs = afterAqs;
      if (currentScore >= REPAIR_TARGET_SCORE) break;
    } else {
      // Pareto-Safe : aucune amélioration -> rollback et arrêt
      fileStore.saveFile(context.tenantId, projectId, 'index.html', previousHtml);
      diagnosis = await diagnose(context.tenantId, projectId, context.role, requestId);
      currentIteration.action = 'patch-rolled-back';
      currentIteration.scoreAfter = currentScore;
      break;
    }
  }

  // Révision de la réparation (réversible)
  try {
    revisionStore.createRevision(context.tenantId, projectId, {
      message: `Self-Repair — score final ${currentScore}/100 (${iterations.map((i) => i.action).join(', ')})`,
      author: 'Agent IA',
      files: { 'index.html': html },
      provenance: { source: 'SYSTEM_REPAIR', triggerRequestId: requestId }
    });
  } catch {
    // best effort
  }

  // T6 — conclusion du cycle, visible dans la timeline (réussie ou non)
  if (repairEvents) {
    const lastAction = iterations[iterations.length - 1]?.action || 'unknown';
    const improved = iterations.some((i) => i.action === 'patch-applied');
    executionStore.appendEvent(repairEvents, {
      type: 'REPAIR_COMPLETED',
      phase: 'REPAIR',
      status: improved ? 'COMPLETED' : 'FAILED',
      title: improved
        ? `Réparation appliquée — score ${currentScore}/100`
        : lastAction === 'no-repair-needed'
          ? 'Aucune réparation nécessaire'
          : 'Réparation sans amélioration — version précédente conservée',
      detail: {
        iterations: iterations.length,
        finalScore: currentScore,
        actions: iterations.map((i) => i.action)
      }
    });
  }

  sendJson(res, 200, {
    repaired: currentScore >= REPAIR_TARGET_SCORE,
    initialScore: iterations[0]?.scoreBefore ?? null,
    finalScore: currentScore,
    iterations,
    requestId
  });
  return true;
}
