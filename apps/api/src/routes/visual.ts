/**
 * VibeCode Core - API Tier
 * Visual Critic Route (LOT 5) — Design Critic v1 du CDC V8.
 *
 * Combine deux sources de preuve (§ Evidence First) :
 *  1. le rendu RÉEL (Playwright/Chromium : capture + erreurs runtime + console)
 *  2. l'analyse visuelle déterministe de l'AINT-012 (snapshot DOM, palette,
 *     typographie, éléments interactifs)
 * et produit un rapport de findings + un score déterministe (aucun
 * Math.random — exigence CDC §16 V8).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderProjectPreview } from '../../../../packages/core/src/ai-native/visual-intelligence/real-renderer.js';
import { VisualIntelligenceService } from '../../../../packages/core/src/ai-native/visual-intelligence/service.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';

const visualService = new VisualIntelligenceService();

interface CriticFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  source: 'RUNTIME' | 'CONSOLE' | 'DESIGN';
  title: string;
  detail: string;
}

/**
 * Score déterministe 0-100 : chaque finding pénalise selon sa sévérité.
 * Déterministe par construction — reproductible à preuves identiques.
 * Exporté pour le Self-Repair (ÉTAPE 7) : mêmes règles côté réparation.
 */
export function computeCriticScore(findings: readonly CriticFinding[]): number {
  const penalty = { CRITICAL: 25, HIGH: 12, MEDIUM: 6, LOW: 2 } as const;
  const total = findings.reduce((acc, f) => acc + penalty[f.severity], 0);
  return Math.max(0, Math.min(100, 100 - total));
}

export interface VisualAnalysisResult {
  score: number;
  findings: CriticFinding[];
  stats: { colors: number; fonts: number; interactiveElements: number };
  renderAvailable: boolean;
  screenshotBase64?: string;
  consoleMessages: { type: string; text: string }[];
}

/**
 * T6 — pipeline de critique visuelle réutilisable : rendu réel (Chromium) +
 * analyse DOM déterministe + règles design + score. Utilisé par la route
 * /visual/analyze ET par le stream conversationnel (gate serveur — source de
 * vérité unique : le HTML analysé est exactement celui qui est sauvegardé).
 */
export async function analyzeProjectVisual(
  tenantId: string,
  role: RequestContext['role'],
  projectId: string,
  requestId: string
): Promise<VisualAnalysisResult> {
  const files = fileStore.getAllProjectFiles(tenantId, projectId);
  const htmlContent = files['index.html'];
  if (!htmlContent || htmlContent.trim().length === 0) {
    throw new ValidationError('Ce projet ne contient aucun index.html à analyser', undefined, requestId);
  }

  const findings: CriticFinding[] = [];
  let screenshotBase64: string | undefined;
  let renderAvailable = true;
  let consoleMessages: { type: string; text: string }[] = [];

  // 1. Rendu réel (peut échouer si Chromium absent — non bloquant)
  try {
    const render = await renderProjectPreview(files);
    screenshotBase64 = render.screenshotBase64;
    consoleMessages = render.consoleMessages.map((m) => ({ type: m.type, text: m.text }));
    for (const err of render.pageErrors) {
      findings.push({
        severity: 'CRITICAL',
        source: 'RUNTIME',
        title: 'Erreur runtime au chargement réel',
        detail: err
      });
    }
    const consoleErrors = render.consoleMessages.filter((m) => m.type === 'error');
    for (const ce of consoleErrors.slice(0, 10)) {
      findings.push({
        severity: 'HIGH',
        source: 'CONSOLE',
        title: 'Erreur console au rendu réel',
        detail: ce.text
      });
    }
  } catch (error) {
    renderAvailable = false;
    logger.warn('Rendu réel indisponible pour la critique visuelle', {
      component: 'visual-route',
      projectId,
      error: error instanceof Error ? error.message : String(error),
      requestId
    });
  }

  // 2. Analyse visuelle déterministe du DOM (AINT-012)
  let colors: string[] = [];
  let fonts: string[] = [];
  let interactiveCount = 0;
  try {
    const analysis = await visualService.analyzeVisuals(
      { tenantId, projectId, htmlContent, screenshotBase64, requestId },
      role
    );
    colors = [...analysis.snapshot.extractedColors];
    fonts = [...analysis.snapshot.extractedFonts];
    interactiveCount = analysis.snapshot.interactiveElements.length;
  } catch (error) {
    logger.warn('Analyse visuelle impossible', {
      component: 'visual-route',
      projectId,
      error: error instanceof Error ? error.message : String(error),
      requestId
    });
    // É45 P5 (F9) — miroir du marquage « Rendu réel indisponible » : un
    // échec de l'analyse statique doit être visible dans la réponse, sinon
    // la critique partielle est indistinguable d'une analyse complète.
    findings.push({
      severity: 'LOW',
      source: 'DESIGN',
      title: 'Analyse statique indisponible',
      detail: `L'analyse DOM déterministe n'a pas pu s'exécuter (${error instanceof Error ? error.message : String(error)}) : la critique repose uniquement sur le rendu réel et la structure du HTML.`
    });
  }

  // 3. Findings de cohérence design (règles simples du CDC V8 §8)
  const uniqueFonts = [...new Set(fonts.map((f) => f.toLowerCase()))];
  if (uniqueFonts.length > 3) {
    findings.push({
      severity: 'MEDIUM',
      source: 'DESIGN',
      title: `Trop de polices distinctes (${uniqueFonts.length})`,
      detail: `Polices détectées : ${uniqueFonts.join(', ')}. Le CDC V8 recommande une hiérarchie typographique restreinte (RULE-004).`
    });
  }
  const uniqueColors = [...new Set(colors.map((c) => c.toLowerCase()))];
  if (uniqueColors.length > 10) {
    findings.push({
      severity: 'MEDIUM',
      source: 'DESIGN',
      title: `Palette très étendue (${uniqueColors.length} couleurs)`,
      detail: 'RULE-009 : pas de couleurs arbitraires hors palette sémantique — envisager une harmonisation.'
    });
  }
  if (interactiveCount === 0 && htmlContent.includes('<button')) {
    findings.push({
      severity: 'LOW',
      source: 'DESIGN',
      title: 'Éléments interactifs non détectés par l\'analyse',
      detail: 'Des boutons existent dans le HTML mais aucun élément interactif n\'a été profilé (RULE-005 : états visibles requis).'
    });
  }
  if (!renderAvailable) {
    findings.push({
      severity: 'LOW',
      source: 'RUNTIME',
      title: 'Rendu réel indisponible',
      detail: 'Chromium n\'est pas disponible sur le serveur : la critique repose uniquement sur l\'analyse du DOM. Installez Chromium (npx playwright install chromium) pour les erreurs runtime.'
    });
  }

  // 4. INTÉGRITÉ STRUCTURELLE (audit preview) — la duplication de sections
  // (footer ×3, header ×2 constatés en production) ne produit AUCUNE erreur
  // runtime ni dérive de palette : sans ce contrôle, la page la plus
  // désorganisée pouvait afficher 98/100.
  const sectionNames = [...htmlContent.matchAll(/data-section="([^"]+)"/g)].map((m) => (m[1] || '').toLowerCase());
  const nameCounts = new Map<string, number>();
  for (const n of sectionNames) nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
  const duplicates = [...nameCounts.entries()].filter(([, c]) => c > 1);
  if (duplicates.length) {
    findings.push({
      severity: 'HIGH',
      source: 'DESIGN',
      title: `Sections dupliquées : ${duplicates.map(([n, c]) => `${n} ×${c}`).join(', ')}`,
      detail: 'Le même bloc data-section apparaît plusieurs fois dans la page (accumulation entre générations). La prochaine génération déduplique automatiquement — la dernière version gagne.'
    });
  }
  const headerTagCount = (htmlContent.match(/<header[\s>]/gi) || []).length;
  const footerTagCount = (htmlContent.match(/<footer[\s>]/gi) || []).length;
  if (headerTagCount > 1 || footerTagCount > 1) {
    findings.push({
      severity: 'HIGH',
      source: 'DESIGN',
      title: `Structure dupliquée : ${headerTagCount} <header>, ${footerTagCount} <footer>`,
      detail: 'Une page cohérente ne contient qu un seul header et un seul footer — des doublons signifient que des blocs ont été empilés par des fusions successives.'
    });
  }

  return {
    score: computeCriticScore(findings),
    findings,
    stats: { colors: uniqueColors.length, fonts: uniqueFonts.length, interactiveElements: interactiveCount },
    renderAvailable,
    ...(screenshotBase64 ? { screenshotBase64 } : {}),
    consoleMessages
  };
}

export async function handleVisualRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // POST /api/v1/projects/:projectId/visual/analyze
  if (!pathname.startsWith('/api/v1/projects/') || !pathname.endsWith('/visual/analyze') || req.method !== 'POST') {
    return false;
  }
  const projectId = pathname.slice('/api/v1/projects/'.length, -'/visual/analyze'.length);
  if (!projectId) return false;

  assertPermission(context.role, 'PROJECT_READ', requestId);

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    throw new NotFoundError(`Projet ${projectId}`, requestId);
  }

  const result = await analyzeProjectVisual(context.tenantId, context.role, projectId, requestId);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    score: result.score,
    findings: result.findings,
    stats: result.stats,
    renderAvailable: result.renderAvailable,
    screenshotBase64: result.screenshotBase64,
    consoleMessages: result.consoleMessages,
    analyzedAt: new Date().toISOString(),
    requestId
  }));
  return true;
}
