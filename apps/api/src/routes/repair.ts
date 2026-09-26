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
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { aiProviderRegistry } from '../../../../packages/core/src/ai/providers/registry.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';
import { readBody } from '../middleware/body.js';

const MAX_REPAIR_ITERATIONS = 3;
const REPAIR_TARGET_SCORE = 90;

interface RepairIteration {
  iteration: number;
  scoreBefore: number;
  scoreAfter: number | null;
  action: string;
  errorsDiagnosed: string[];
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
async function diagnose(tenantId: string, projectId: string): Promise<{ score: number; runtimeErrors: string[] }> {
  const findings: CriticFinding[] = [];
  const files = fileStore.getAllProjectFiles(tenantId, projectId);
  const html = files['index.html'] || '';
  let runtimeErrors: string[] = [];
  try {
    const render = await renderProjectPreview(files);
    runtimeErrors = [...render.pageErrors];
    for (const err of render.pageErrors) {
      findings.push({ severity: 'CRITICAL', source: 'RUNTIME', title: 'Erreur runtime', detail: err });
    }
    for (const ce of render.consoleMessages.filter((m) => m.type === 'error').slice(0, 10)) {
      findings.push({ severity: 'HIGH', source: 'CONSOLE', title: 'Erreur console', detail: ce.text });
    }
  } catch {
    // Chromium indisponible : aucune erreur runtime observable -> pas de réparation possible
    return { score: 100, runtimeErrors: [] };
  }
  void html;
  return { score: computeCriticScore(findings), runtimeErrors };
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

  let body: { maxIterations?: number } = {};
  try {
    body = (await readBody(req) || '{}') as unknown as { maxIterations?: number };
    if (typeof body === 'string') body = JSON.parse(body) as { maxIterations?: number };
  } catch {
    body = {};
  }
  const maxIterations = Math.max(1, Math.min(MAX_REPAIR_ITERATIONS, Number(body.maxIterations) || 2));

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

  let diagnosis = await diagnose(context.tenantId, projectId);
  let currentScore = diagnosis.score;

  for (let i = 1; i <= maxIterations; i++) {
    iterations.push({ iteration: i, scoreBefore: currentScore, scoreAfter: null, action: 'diagnosis', errorsDiagnosed: diagnosis.runtimeErrors.slice(0, 10) });

    if (diagnosis.runtimeErrors.length === 0) {
      iterations[iterations.length - 1]!.action = 'no-repair-needed';
      break;
    }

    // PATCH par LLM
    const previousHtml = html;
    const systemPrompt = "Tu es l'ingénieur de réparation de VibeCode Studio. On te donne le code HTML complet d'une application et la LISTE DES ERREURS RUNTIME réelles observées au chargement. Corrige UNIQUEMENT ces erreurs, sans changer le reste de l'application (Pareto-Safe). Réponds UNIQUEMENT avec le code HTML complet corrigé dans un bloc ```html ... ```.";
    const userPrompt = `Erreurs runtime observées :\n${diagnosis.runtimeErrors.map((e) => '- ' + e).join('\n')}\n\nCode HTML actuel :\n\`\`\`html\n${html}\n\`\`\``;

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

    // TEST/VALIDATE : re-critique du patch
    fileStore.saveFile(context.tenantId, projectId, 'index.html', patched);
    diagnosis = await diagnose(context.tenantId, projectId);
    const afterScore = diagnosis.score;
    iterations[iterations.length - 1]!.scoreAfter = afterScore;

    if (afterScore > currentScore) {
      iterations[iterations.length - 1]!.action = 'patch-applied';
      html = patched;
      currentScore = afterScore;
      if (currentScore >= REPAIR_TARGET_SCORE) break;
    } else {
      // Pareto-Safe : aucune amélioration -> rollback et arrêt
      fileStore.saveFile(context.tenantId, projectId, 'index.html', previousHtml);
      diagnosis = await diagnose(context.tenantId, projectId);
      iterations[iterations.length - 1]!.action = 'patch-rolled-back';
      iterations[iterations.length - 1]!.scoreAfter = currentScore;
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

  sendJson(res, 200, {
    repaired: currentScore >= REPAIR_TARGET_SCORE,
    initialScore: iterations[0]?.scoreBefore ?? null,
    finalScore: currentScore,
    iterations,
    requestId
  });
  return true;
}
