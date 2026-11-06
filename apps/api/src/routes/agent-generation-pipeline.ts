/**
 * CHAÎNE DE GÉNÉRATION PAR AGENTS SPÉCIALISÉS — demande opérateur (2026-11-02).
 *
 * Demande : danc la génération conversationnelle (/stream), AVANT l'appel
 * direct au provider streaming (Mistral/Gemini), passer par la chaîne :
 *
 *   1) Agent Décision     — analyse l'intention (moteur d'intention existant)
 *   2) Agent Architecture — planifie la structure (générateur de plan existant)
 *   3) Agent UI           — génère l'interface (agent-ui-specialist, É32)
 *   4) Agent Backend      — ajoute la logique métier (agent-backend-specialist)
 *   5) Agent Sécurité     — vérifie le résultat (agent-security-specialist)
 *
 * Le résultat de chaque étape est passé à la suivante ; le flux HTML final
 * (format <SECTION> du Studio) est réinjecté dans le parser de sections du
 * flux /stream via un générateur ASYNC IDENTIQUE à un stream LLM — le contrat
 * SSE ne change pas d'un octet.
 *
 * Honnêteté :
 *  - chaque étape porte la CLÉ RÉELLE utilisée (créneau primary/fallback des
 *    clés d'agents,stockées côté serveur) via les champs credentialSlot /
 *    credentialProviderId / failoverReason du rapport d'exécution ;
 *  - en échec de chaîne (orchestrateur absent, agent dégradé, sortie sans
 *    <SECTION>), le flux REPLIT sur l'appel direct historique (non-régression
 *    stricte) et la raison est journalisée + portée dans une frame dédiée.
 */

import type { AIOrchestratorService } from '../../../../packages/core/src/ai-native/ai-orchestrator/service.js';
import type { AgentArtifact, AgentTask } from '../../../../packages/core/src/ai-native/ai-orchestrator/types.js';
import type { Role } from '../../../../packages/core/src/identity/permissions.js';
import { logger } from '../../../../packages/core/src/logger.js';

let orchestratorBridge: AIOrchestratorService | undefined;

/** Branchement depuis server.ts (une fois, à côté de configureAgentExecutionRoute). */
export function configureConversationAgentBridge(service: AIOrchestratorService): void {
  orchestratorBridge = service;
  logger.info('Chaîne de génération : pont orchestrateur configuré (Décision → Architecture → UI → Backend → Sécurité)', {
    component: 'agent-generation-pipeline'
  });
}

export function isConversationAgentBridgeConfigured(): boolean {
  return orchestratorBridge !== undefined;
}

export interface AgentChainStepReport {
  step: 'decision' | 'architecture' | 'ui' | 'backend' | 'securite';
  /** Identifiant RÉEL du moteur ou de l'agent exécuté. */
  agentId: string;
  /** 'running' = frame de DÉBUT (l agent travaille, pas encore de résultat). */
  status: 'running' | 'ok' | 'degraded' | 'failed' | 'skipped';
  credentialSlot?: string;
  credentialProviderId?: string;
  failoverReason?: string;
  durationMs: number;
  note?: string;
}

export interface AgentChainResult {
  ok: boolean;
  text: string;
  steps: AgentChainStepReport[];
  reason?: string;
}

/** En dessous de cette longueur, une sortie d'agent n'est pas un flux exploitable. */
const MIN_FLOW_LENGTH = 200;

/** Le parser du Studio exige un marqueur <SECTION name="...">. */
const hasSectionMarker = (text: string): boolean => /<SECTION\s+name=/.test(text);

/**
 * FIX PRÉFLIGHT (E2E du 2026-11-02) — un agent peut envelopper le flux dans un
 * document complet SANS <!DOCTYPE html> ; l'assemblage côté /stream détectait
 * alors « <html » et sautait le buildStudioShell → le préflight d'ingénierie
 * refusait l'enregistrement (DOCTYPE manquant). La normalisation retire
 * TOUTE enveloppe de document de la sortie d'un agent, sans toucher au flux.
 */
function stripDocumentEnvelope(text: string): string {
  if (!text || !/<SECTION\s+name=/.test(text) || !/<!DOCTYPE|<html[\s>]/i.test(text)) return text;
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch && bodyMatch[1] && /<SECTION\s+name=/.test(bodyMatch[1])) return bodyMatch[1].trim();
  let cleaned = text
    .replace(/^\s*<!doctype[^>]*>\s*/i, '')
    .replace(/^\s*<html[^>]*>\s*/i, '')
    .replace(/^\s*<head[\s\S]*?<\/head>\s*/i, '')
    .replace(/^\s*<body[^>]*>\s*/i, '')
    .replace(/\s*<\/body>\s*$/i, '')
    .replace(/\s*<\/html>\s*$/i, '');
  if (/<SECTION\s+name=/.test(cleaned)) return cleaned.trim();
  // Contour final : le flux est interne à <body> jamais fermé proprement.
  const innerBody = text.match(/<body[^>]*>([\s\S]*)/i)?.[1];
  if (innerBody && /<SECTION\s+name=/.test(innerBody)) return innerBody.trim();
  return '';
}

/** Extrait le plus long `proposedContent` des artefacts (= texte LLM verbatim). */
function extractLongestProposedContent(artifacts: readonly AgentArtifact[] | undefined): string {
  let best = '';
  if (!artifacts) return best;
  for (const artifact of artifacts) {
    const payload = artifact.payload as { proposedContent?: unknown } | null | undefined;
    if (
      payload !== undefined && payload !== null && typeof payload === 'object' &&
      typeof payload.proposedContent === 'string' && payload.proposedContent.length > best.length
    ) {
      best = payload.proposedContent;
    }
  }
  return best;
}

/** Copie du rapport sans le long texte (pour les frames SSE). */
function reportOf(step: AgentChainStepReport & { text?: string }): AgentChainStepReport {
  const text = step.text ?? '';
  return {
    step: step.step,
    agentId: step.agentId,
    status: step.status,
    ...(step.credentialSlot !== undefined ? { credentialSlot: step.credentialSlot } : {}),
    ...(step.credentialProviderId !== undefined ? { credentialProviderId: step.credentialProviderId } : {}),
    ...(step.failoverReason !== undefined ? { failoverReason: step.failoverReason } : {}),
    durationMs: step.durationMs,
    ...(step.note !== undefined ? { note: step.note } : {}),
    ...(text.length > 0 ? { note: `${step.note ?? ''} (flux ${text.length} car.)`.trim() } : {})
  };
}

interface ChainStepParams {
  agentId: string;
  step: AgentChainStepReport['step'];
  title: string;
  description: string;
  operation: 'CREATE' | 'MODIFY' | 'ANALYZE' | 'VERIFY';
  tenantId: string;
  projectId: string;
  userRole: Role;
  requestId: string;
}

type ChainStepOutcome = AgentChainStepReport & { text: string };

/**
 * Exécute UN pas de la chaîne via l'orchestrateur réel (É32) — dryRun : le
 * résultat est un ARTEFACT proposé (aucune mutation de fichier).
 */
async function runChainStep(orchestrator: AIOrchestratorService, params: ChainStepParams): Promise<ChainStepOutcome> {
  const startedAt = Date.now();
  const base: ChainStepOutcome = {
    step: params.step,
    agentId: params.agentId,
    status: 'failed',
    durationMs: 0,
    text: ''
  };
  try {
    const executionId = `agc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const task: AgentTask = {
      id: `task-${executionId}`,
      title: params.title,
      description: params.description,
      domain: 'ARCHITECTURE',
      priority: 1,
      dependencies: [],
      requiredContext: {
        targetFiles: ['index.html'],
        // CDC V8 §11 — l'UI Agent reste design-aware (Design DNA réel quand
        // un rapport existe ; sinon prompt identique à l'historique).
        ...(params.agentId === 'agent-ui-specialist' ? { includeDna: true } : {})
      },
      requiredCapabilities: [],
      status: 'READY',
      operation: params.operation,
      retryCount: 0,
      maxRetries: 0
    };
    const context = orchestrator.assembleTaskContext({
      tenantId: params.tenantId,
      projectId: params.projectId,
      task,
      userRole: params.userRole,
      requestId: params.requestId
    });
    const outcome = await orchestrator.executeAgent({
      executionId,
      agentId: params.agentId,
      task,
      context,
      tenantId: params.tenantId,
      projectId: params.projectId,
      userRole: params.userRole,
      requestId: params.requestId,
      dryRun: true
    });
    const result = outcome.result;
    const durationMs = result ? (result.durationMs || (Date.now() - startedAt)) : (Date.now() - startedAt);
    if (!result) {
      return { ...base, durationMs, note: 'exécution sans résultat' };
    }
    const report: ChainStepOutcome = {
      step: base.step,
      agentId: base.agentId,
      status: result.degraded ? 'degraded' : 'ok',
      ...(result.credentialSlot !== undefined ? { credentialSlot: result.credentialSlot } : {}),
      ...(result.credentialProviderId !== undefined ? { credentialProviderId: result.credentialProviderId } : {}),
      ...(result.failoverReason !== undefined ? { failoverReason: result.failoverReason } : {}),
      durationMs,
      ...(result.degraded ? { note: (result as { degradeReason?: string }).degradeReason ?? 'LLM indisponible' } : {}),
      text: extractLongestProposedContent(result.artifacts)
    };
    return { ...report, text: stripDocumentEnvelope(report.text) };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
    return { ...base, durationMs: Date.now() - startedAt, note: message };
  }
}

/**
 * Frame « en cours » (visibilité opérateur) — émis au DÉBUT de chaque pas LLM :
 * la ligne s affiche « travail en cours » dans le Studio PENDANT la latence
 * (5-60 s aux bornes réelles), puis le frame terminal la fige avec le résultat
 * honnête (clé utilisée, durée, note). Le meta frame ne contient JAMAIS de
 * sortie (aucun flux, aucune note de résultat).
 */
function stepWorking(step: AgentChainStepReport['step'], agentId: string): AgentChainStepReport {
  return { step, agentId, status: 'running', durationMs: 0, note: 'appel LLM en cours' };
}

export interface AgentGenerationPipelineInput {
  tenantId: string;
  projectId: string;
  userRole: Role;
  requestId: string;
  userMessage: string;
  intentCategory: string;
  planSteps: readonly string[];
  /** Le prompt utilisateur complet (briefs images/design inclus) du flux direct. */
  userPrompt: string;
  isModificationMode: boolean;
  currentHtml: string;
  /** Callback par étape terminée (frames SSE 'on_agent_step'). */
  onStep?: (report: AgentChainStepReport) => void;
}

/**
 * La chaîne OPERATEUR complète : UI → Backend → Sécurité. Les étapes
 * Décision/Architecture SONT les moteurs existants (classifyIntent /
 * PlanGenerator) déjà exécutés en amont par la route /stream — elles ne sont
 * PAS relancées ici (ni double coût, ni dérive) ; seule leur trace est émise.
 */
export async function runAgentGenerationPipeline(input: AgentGenerationPipelineInput): Promise<AgentChainResult> {
  // PORTE DE DÉSACTIVATION (E2E du 2026-11-02) — sous node:test
  // (NODE_TEST_CONTEXT='child-v8'), les suites legacy du flux conversationnel
  // (retry-b1-creation, app-generation-sse, conversation-question-planfirst…)
  // comptent des appels streaming DÉTERMINISTES sur un stub et ne doivent ni
  // consommer de tokens RÉELS (clés d'agents du serveur) ni dépendre du
  // réseau. VOLACO_AGENT_CHAIN=0 force aussi l'arrêt explicite en production :
  // la chaîne est la valeur ajoutée de l'opérateur, jamais un verrou ; sans
  // elle le comportement historique (appel direct) est strictement conservé.
  if (process.env.NODE_TEST_CONTEXT !== undefined || process.env.VOLACO_AGENT_CHAIN === '0') {
    return { ok: false, text: '', steps: [], reason: 'chaine-desactivee' };
  }
  const orchestrator = orchestratorBridge;
  if (!orchestrator) {
    return { ok: false, text: '', steps: [], reason: 'orchestrateur-non-configure' };
  }

  const planRecap = input.planSteps.length > 0
    ? input.planSteps.map((step: string, index: number) => `${index + 1}. ${step}`).join('\n')
    : '(plan vide)';

  // ============ ÉTAPE 3 — AGENT UI (génère l'interface) ============
  const uiDescription = (input.isModificationMode
    ? `Agent UI — MODIFICATION d'une page existante.\nDemande de l'utilisateur : ${input.userMessage}\nIntention classifiée : ${input.intentCategory}.\nPlan d'architecture prévu :\n${planRecap}\n\nCONTEXTE HTML ACTUEL :\n\`\`\`html\n${input.currentHtml}\n\`\`\`\n\n`
    : `Agent UI — CRÉATION d'une page.\nDemande de l'utilisateur : ${input.userMessage}\nIntention classifiée : ${input.intentCategory}.\nPlan d'architecture prévu :\n${planRecap}\n\n`) +
    `Ta sortie DOIT être le flux complet du Studio, au format EXACT suivant (aucune note d'analyse) :\n` +
    `<!-- DESIGN_DNA: {"palette":{"bg":"#hex","fg":"#hex","accent":"#hex"},"font":"Polie Google Fonts","mode":"light"} -->\n` +
    `<!-- PAGE_TITLE: nom réel du site -->\n` +
    `Narration chaleureuse de conception (3-5 phrases, tutoiement).\n` +
    `<SECTION name="nom-court-metier">\n` +
    `Une phrase courte de narration.\n` +
    `HTML COMPLET de la section (Tailwind CSS via CDN si besoin).\n` +
    `</SECTION>\n` +
    `(autant de sections que le produit exige, HTML autonome et complet) + phrase de conclusion.\n` +
    `INTERDICTION ABSOLUE : aucune enveloppe de document — PAS de <!DOCTYPE html>, PAS de <html>, <head> ou <body>. Uniquement la narration + les blocs <SECTION>.\n\n` +
    `CONTEXTE PRODUIT COMPLET (demande détaillée) :\n${input.userPrompt}`;

  input.onStep?.(stepWorking('ui', 'agent-ui-specialist'));
  const uiStep = await runChainStep(orchestrator, {
    agentId: 'agent-ui-specialist',
    step: 'ui',
    title: input.isModificationMode ? 'Agent UI — modifier la page' : 'Agent UI — générer l interface',
    description: uiDescription,
    operation: input.isModificationMode ? 'MODIFY' : 'CREATE',
    tenantId: input.tenantId,
    projectId: input.projectId,
    userRole: input.userRole,
    requestId: input.requestId
  });
  input.onStep?.(reportOf(uiStep));
  if (uiStep.status !== 'ok' || !hasSectionMarker(uiStep.text)) {
    const reason = uiStep.status !== 'ok'
      ? `agent-UI-${uiStep.status}${uiStep.note ? ' : ' + uiStep.note : ''}`
      : 'agent-UI-sans-section (sortie non exploitable pour le parser du Studio)';
    logger.warn('Chaîne de génération : étape Agent UI non exploitable', {
      component: 'agent-generation-pipeline',
      tenantId: input.tenantId,
      projectId: input.projectId,
      reason
    });
    return { ok: false, text: uiStep.text, steps: [reportOf(uiStep)], reason };
  }
  let bestFlow = uiStep.text;

  // ============ ÉTAPE 4 — AGENT BACKEND (logique métier) ============
  const backendDescription = `Agent Backend — intégrer la LOGIQUE MÉTIER dans le flux HTML produit par l'Agent UI.\n` +
    `Demande initiale de l'utilisateur : ${input.userMessage}\n\n` +
    `Flux HTML reçu (contractuel : DESIGN_DNA + narration + blocs <SECTION name="...">...</SECTION>) :\n\`\`\`\n${bestFlow}\n\`\`\`\n\n` +
    `Ton rôle : câbler les interactions RÉELLES demandées — formulaires validés, états (loading/erreur), filtres/onglets, appels fetch locaux simulés, données de démonstration cohérentes — SANS changer le design, la narration, les marqueurs ni l'ordre des sections.\n` +
    `Renvoie le flux COMPLET (toutes les sections), au MÊME format, sans aucune note d'analyse.\n` +
    `INTERDICTION ABSOLUE : aucune enveloppe — PAS de <!DOCTYPE html>, PAS de <html>, <head> ou <body>.`;

  input.onStep?.(stepWorking('backend', 'agent-backend-specialist'));
  const backendStep = await runChainStep(orchestrator, {
    agentId: 'agent-backend-specialist',
    step: 'backend',
    title: 'Agent Backend — logique métier',
    description: backendDescription,
    operation: 'MODIFY',
    tenantId: input.tenantId,
    projectId: input.projectId,
    userRole: input.userRole,
    requestId: input.requestId
  });
  input.onStep?.(reportOf(backendStep));
  if (backendStep.text.length >= MIN_FLOW_LENGTH && hasSectionMarker(backendStep.text)) {
    bestFlow = backendStep.text;
  }
  // Un Backend dégradé/degre ou sans marqueur n'annule PAS la chaîne : le flux
  // UI reste la base, et le rapport affiche le ne état réel (honnêteté).

  // ============ ÉTAPE 5 — AGENT SÉCURITÉ (vérifie) ============
  const securityDescription = `Agent Sécurité — VÉRIFICATION du flux HTML final avant livraison.\n` +
    `Demande initiale de l'utilisateur : ${input.userMessage}\n\n` +
    `Flux HTML à vérifier :\n\`\`\`\n${bestFlow}\n\`\`\`\n\n` +
    `Vérifie : XSS (innerHTML sur données externes sans escape), secrets ou jetons exposés dans le code, appels réseau vers des tiers non justifiés, évaluations dynamiques (eval/new Function), formulaires sans validation minimale, pièges d'accessibilité critiques.\n` +
    `CORRIGE ce qui doit l'être ET RENVOIE LE FLUX COMPLET CORRIGÉ au MÊME format (aucune note d'analyse). Si tout est sain, renvoie le flux À L'IDENTIQUE.\n` +
    `INTERDICTION ABSOLUE : aucune enveloppe — PAS de <!DOCTYPE html>, PAS de <html>, <head> ou <body>.`;

  input.onStep?.(stepWorking('securite', 'agent-security-specialist'));
  const securityStep = await runChainStep(orchestrator, {
    agentId: 'agent-security-specialist',
    step: 'securite',
    title: 'Agent Sécurité — vérification du résultat',
    description: securityDescription,
    operation: 'ANALYZE',
    tenantId: input.tenantId,
    projectId: input.projectId,
    userRole: input.userRole,
    requestId: input.requestId
  });
  input.onStep?.(reportOf(securityStep));
  if (securityStep.text.length >= MIN_FLOW_LENGTH && hasSectionMarker(securityStep.text)) {
    bestFlow = securityStep.text;
  } else if (securityStep.text.trim().length > 0) {
    // L'agent Sécurité a répondu sans flux exploitable (analyse pure ou
    // enveloppe) : le flux Backend est conservé et l'état réel est tracé.
    securityStep.status = 'ok';
    securityStep.note = `${securityStep.note ?? ''} (analyse retournée, flux Backend conservé)`.trim();
  }

  const steps: AgentChainStepReport[] = [reportOf(uiStep), reportOf(backendStep), reportOf(securityStep)];
  const finalText = stripDocumentEnvelope(bestFlow);
  if (!finalText) {
    logger.warn('Chaîne de génération : flux final vide après normalisation d enveloppe', {
      component: 'agent-generation-pipeline',
      tenantId: input.tenantId,
      projectId: input.projectId
    });
    return { ok: false, text: '', steps, reason: 'flux-final-vide' };
  }
  logger.info('Chaîne de génération terminée', {
    component: 'agent-generation-pipeline',
    tenantId: input.tenantId,
    projectId: input.projectId,
    chars: finalText.length,
    steps: steps.map((s) => `${s.step}=${s.status}(${s.credentialProviderId ?? '-'}${s.credentialSlot ? '@' + s.credentialSlot : ''})`).join(' ')
  });
  return { ok: true, text: finalText, steps };
}
