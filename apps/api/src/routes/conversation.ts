/**
 * VibeCode Core - API Tier
 * Conversation Routes — expose enfin le moteur conversationnel
 * (ConversationIntelligenceService / agent-runtime) via l'API HTTP.
 *
 * Jusqu'ici, ce moteur existait, était testé, mais n'était relié à aucune
 * route : impossible pour un utilisateur de "discuter" avec Volaco pour de
 * vrai. Ces routes le rendent accessible.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ConversationIntelligenceService } from '../../../../packages/core/src/ai-native/conversation-intelligence/service.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import type { Role } from '../../../../packages/core/src/identity/permissions.js';
import type { ImpactAnalysisRequest, ImpactRiskLevel } from '../../../../packages/core/src/ai-native/impact-intelligence/types.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { analyzeProjectVisual, computeCriticScore, truncationFinding } from './visual.js';
import { runValidationChain } from './validation.js';
// É50 — garde-fou d'exfiltration (P0 S8) : contrôle déterministe à la
// frontière de persistance du HTML généré (stream + /turns).
import { runExfiltrationGuard, describeExfiltrationBlocker } from './exfiltration-guard.js';
import {
  runEngineeringPreflight,
  type EngineeringPreflightReport
} from '../../../../packages/core/src/ai-native/validation/engineering-preflight.js';
import {
  applyStreamFileMutation,
  STREAM_MUTATION_PATH,
  type StreamMutationEngine,
  type StreamMutationInput,
  type StreamMutationOutcome
} from './stream-mutation.js';
// É53 LOT B — contrat de remplacement pour les CRÉATIONS explicites (E48) :
// `buildMutationContract` est importé de contract.ts (Lot A gelé — import
// seul, aucune modification) pour construire un contrat scope « creation »
// quand le client demande explicitement un site frais sur un projet existant.
import { buildMutationContract } from '../../../../packages/core/src/ai-native/mutation-orchestrator/contract.js';
import { aiProviderRegistry } from '../../../../packages/core/src/ai/providers/registry.js';
import {
  preferredAiProvider,
  providerStoredKey
} from '../../../../packages/core/src/ai/providers/provider-catalog.js';
import type { TenantProviderCredentials } from '../../../../packages/core/src/ai/providers/types.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { EngineeringPlan, IntentResult, PreparedTurn, ProjectMemory } from '../../../../packages/core/src/ai-native/conversation-intelligence/types.js';
import { PlanGenerator } from '../../../../packages/core/src/ai-native/conversation-intelligence/engine/plan-generator.js';
import { buildEngineeringBrief, withEngineeringBrief } from '../../../../packages/core/src/ai-native/conversation-intelligence/engine/generation-brief.js';
import type { MemorySignals } from '../../../../packages/core/src/ai-native/decision-engine/memory-signals.js';
import { executionStore, activeCancelFlags } from '../../../../packages/core/src/ai-native/execution/store.js';
import { ExecutionRecorder, type RecordableEvent } from '../../../../packages/core/src/ai-native/execution/recorder.js';
import { withProjectDesignContext } from '../../../../packages/core/src/ai-native/design-harmony/design-context.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
import {
  runAgentGenerationPipeline,
  type AgentChainStepReport
} from './agent-generation-pipeline.js';
import { setProjectFormat } from '../../../../packages/core/src/app-pipeline.js';
import {
  allVerifiedUnsplashIds,
  buildImageBrief,
  buildSectorContract,
  detectImageTheme,
  extractSectionImages,
  pageTitleHint,
  poolRotationSeed,
  reconcilePageTitle,
  rotatePool,
  THEME_IMAGE_RESOURCES,
  thematicImageRewrite,
  type ImageTheme,
  type SectionImage,
} from '../../../../packages/core/src/image/theme.js';
import {
  searchThemedUnsplashPhotos,
  THEME_PHOTO_QUERY,
  UNSPLASH_SEARCH_TIMEOUT_MS,
} from '../../../../packages/core/src/image/unsplash-dynamic.js';
import { recordAdoptedImageIds } from '../../../../packages/core/src/image/image-adoptions.js';
import { deriveSectorPhotoQuery, resolveImageSubject } from '../../../../packages/core/src/image/sector-queries.js';
import { classifyIntent } from '../../../../packages/core/src/ai-native/conversation-intelligence/engine/intent-engine.js';
// CDC §16 — LOT ASSOMPTIONS FLUX (2026-11-03) : moteur réel, déterministe,
// zero-LLM ; mêmes hypothèses que ConversationEngine (/turns), désormais
// visibles dans le flux /stream (frame + panneau Studio).
import { deriveAssumptions } from '../../../../packages/core/src/ai-native/conversation-intelligence/engine/assumption-engine.js';
/**
 * Instance unique du service de conversation pour tout le serveur.
 * Le moteur IA réel (Gemini/Mistral) ou le simulateur (Mock, avec avertissement)
 * lui est injecté au démarrage du serveur — voir server.ts.
 */
export let conversationIntelligenceService = new ConversationIntelligenceService();

/**
 * Permet à server.ts de remplacer l'instance par défaut par une instance
 * correctement câblée avec le vrai moteur d'exécution (agent-runtime + IA réelle).
 */
export function configureConversationIntelligenceService(service: ConversationIntelligenceService): void {
  conversationIntelligenceService = service;
}

/**
 * Résolution des credentials provider pour le flux conversationnel.
 * Priorité : credentials du tenant, puis clé enregistrée dans la carte Studio,
 * puis l'adaptateur retombe sur sa variable d'environnement. La clé n'est
 * jamais journalisée ni renvoyée au client.
 */
function resolveProviderCredentials(
  tenantId: string,
  providerId: string
): TenantProviderCredentials | undefined {
  const tenantCredentials = aiProviderRegistry.getTenantCredentials(tenantId, providerId);
  if (tenantCredentials) return tenantCredentials;
  const storedKey = providerStoredKey(providerId);
  return storedKey ? { tenantId, providerId, apiKey: storedKey } : undefined;
}

/**
 * FIX CARTE MISTRAL — la clé saisie dans la carte Réglages du Studio (header
 * X-Mistral-Api-Key) doit piloter le flux de génération : avant ce correctif,
 * elle n'était lue que sur /turns/execute et le proxy ; le stream principal
 * retombait sur la clé .env (potentiellement révoquée) voire un autre
 * fournisseur (ex. Gemini actif via la grille) — d'où le ressenti « clé
 * Mistral reliée à Gemini » et les 401/404 inexplicables.
 */
function resolveStreamCredentials(
  req: IncomingMessage,
  tenantId: string,
  providerId: string
): TenantProviderCredentials | undefined {
  const header = req.headers['x-mistral-api-key'];
  if (providerId === 'mistral' && typeof header === 'string' && header.trim().length > 0) {
    return { tenantId, providerId: 'mistral', apiKey: header.trim() };
  }
  return resolveProviderCredentials(tenantId, providerId);
}

/**
 * Sélection du provider de streaming : Mistral reste prioritaire quand sa clé
 * d'environnement est présente ; sinon Gemini (clé d'environnement ou carte
 * active) ; sinon le premier adaptateur disponible du registre.
 */
function resolveStreamingAdapter() {
  const preferredProviderId = process.env.MISTRAL_API_KEY
    ? 'mistral'
    : process.env.GEMINI_API_KEY
      ? 'gemini'
      : preferredAiProvider();
  const resolved = aiProviderRegistry.resolve(
    preferredProviderId ? { preferredProviderId } : {}
  );
  if (resolved && 'generateStream' in resolved) return resolved;
  for (const fallbackId of ['mistral', 'gemini']) {
    const fb = aiProviderRegistry.resolve({ preferredProviderId: fallbackId });
    if (fb && 'generateStream' in fb) return fb;
  }
  // FIX P1-C/P3-E — aucun adaptateur streaming disponible : retourne undefined
  // pour que le caller puisse gérer l'absence proprement (évite TypeError runtime).
  return undefined;
}

/**
 * V7 — IMPACT INTELLIGENCE sur le flux principal : le service réel
 * (ImpactIntelligenceService, alimenté par le graphe sémantique) est injecté
 * au démarrage. Contrat structurel minimal : un test peut fournir un double
 * sans construire tout le graphe.
 *
 * Absent = aucune analyse (jamais un résultat fabriqué). Une analyse en échec
 * est journalisée puis ignorée : elle ne casse jamais une génération.
 */
export interface StreamImpactAnalyzer {
  analyzeImpact(
    request: ImpactAnalysisRequest,
    userRole: Role,
    requestId?: string | undefined
  ): {
    readonly overallRisk: ImpactRiskLevel;
    readonly impactedNodes: readonly unknown[];
    readonly durationMs: number;
    readonly metrics: {
      readonly totalImpactedNodes: number;
      readonly breakingCount: number;
      readonly routesAffectedCount: number;
      readonly layersCrossedCount: number;
    };
  };
}

let streamImpactAnalyzer: StreamImpactAnalyzer | undefined;

export function configureStreamImpactService(analyzer: StreamImpactAnalyzer): void {
  streamImpactAnalyzer = analyzer;
}

export interface StreamImpactSummary {
  readonly riskLevel: ImpactRiskLevel;
  readonly requiresConfirmation: boolean;
  readonly totalImpactedNodes: number;
  readonly breakingCount: number;
  readonly routesAffectedCount: number;
  readonly layersCrossed: number;
  readonly durationMs: number;
  readonly targetFiles: readonly string[];
}

export type StreamImpactOutcome =
  | { readonly available: true; readonly summary: StreamImpactSummary }
  | { readonly available: false; readonly reason: string };

/**
 * Analyse d'impact du fichier cible d'une modification, sans effet de bord.
 * La politique de confirmation est celle de l'ImpactBridge V7 : HIGH/CRITICAL
 * exige une validation humaine (le stream, lui, reste consultatif pour ce lot).
 */
export function assessStreamImpact(
  analyzer: StreamImpactAnalyzer | undefined,
  request: ImpactAnalysisRequest,
  userRole: Role,
  requestId?: string | undefined
): StreamImpactOutcome {
  if (!analyzer) {
    return { available: false, reason: 'service-non-configure' };
  }
  try {
    const analysis = analyzer.analyzeImpact(request, userRole, requestId);
    const riskLevel = analysis.overallRisk;
    return {
      available: true,
      summary: {
        riskLevel,
        requiresConfirmation: riskLevel === 'HIGH' || riskLevel === 'CRITICAL',
        totalImpactedNodes: analysis.metrics.totalImpactedNodes,
        breakingCount: analysis.metrics.breakingCount,
        routesAffectedCount: analysis.metrics.routesAffectedCount,
        layersCrossed: analysis.metrics.layersCrossedCount,
        durationMs: analysis.durationMs,
        targetFiles: request.targetFiles ?? []
      }
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * V7 — APPLICATION MODEL : rafraîchi après chaque mutation persistée pour que
 * la racine ApplicationModel reste la vérité courante (et non un instantané
 * uniquement recalculé à la demande). Le rappel est fourni par server.ts ;
 * toute erreur est avalée ici : la mutation déjà persistée reste valide.
 */
export interface ApplicationModelRefreshInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly role: Role;
  readonly requestId: string;
}

export type ApplicationModelRefresher = (input: ApplicationModelRefreshInput) => void;

let applicationModelRefresher: ApplicationModelRefresher | undefined;

export function configureApplicationModelRefresher(refresher: ApplicationModelRefresher): void {
  applicationModelRefresher = refresher;
}

export function refreshApplicationModelAfterMutation(
  input: ApplicationModelRefreshInput
): { readonly refreshed: boolean; readonly reason?: string } {
  if (!applicationModelRefresher) {
    return { refreshed: false, reason: 'service-non-configure' };
  }
  try {
    applicationModelRefresher(input);
    return { refreshed: true };
  } catch (error) {
    return {
      refreshed: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * V7-WIRE-2 — MUTATION ORCHESTRATOR (AINT-006) sur le flux principal.
 *
 * Le moteur réel est injecté par server.ts (même instance que les routes
 * d'ingénierie). Il n'est jamais construit ici : sans injection, le pont
 * retourne `stage: 'engine'` et le flux applique un repli direct TRACÉ.
 */
let streamMutationEngine: StreamMutationEngine | undefined;

export function configureStreamMutationEngine(engine: StreamMutationEngine | undefined): void {
  streamMutationEngine = engine;
}

export function applyStreamFileMutationWithStreamEngine(
  input: StreamMutationInput
): StreamMutationOutcome {
  return applyStreamFileMutation(streamMutationEngine, input);
}

/**
 * V7-WIRE-3 — DECISION ENGINE consultatif sur le flux principal.
 *
 * Le DecisionEngine réel est injecté par server.ts (même instance que la route
 * `/decide`). Décision réelle (contraintes + alternatives + contradictions),
 * consultative par défaut (aucune écriture au ledger).
 *
 * CDC §15 — LOT ADR AUTO (2026-11-03) : `record: true` = la décision est
 * écrite au ledger après déduplication (voir decide.ts). Le flux active le
 * flag seulement hors node:test, pour les intentions qui changent réellement
 * l'application (CREATE/MODIFY/DELETE/REFACTOR), et sauf interrupteur
 * `VOLACO_DECISION_AUTORECORD=0`.
 */
export interface StreamDecisionSummary {
  readonly decisionId: string;
  readonly verdict: 'READY' | 'NEEDS_CONFIRMATION' | 'BLOCKED' | 'DEFERRED';
  readonly intentCategory: string;
  readonly alternatives: number;
  readonly viableAlternatives: number;
  readonly chosenAlternative: {
    readonly label: string;
    readonly riskScore: number;
    readonly reversible: boolean;
    readonly estimatedEffort: 'LOW' | 'MEDIUM' | 'HIGH';
  } | null;
  readonly requiredClarifications: readonly string[];
  readonly contradictingDecisions: number;
  readonly rationale: string;
  /** Optionnel pour compatibilité avec les conseillers de test/anciens. */
  readonly memory?: MemorySignals | undefined;
  /** CDC §15 ADR auto : `true` = décision écrite au ledger, `false` = consultatif ou doublon. */
  readonly recorded: boolean;
  /** Raison d'un non-enregistrement en mode ADR auto (doublon, ledger indisponible). */
  readonly recordNote?: string | undefined;
}

export interface StreamDecisionInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly intent: IntentResult;
  /** Mémoire projet préparée par le moteur ; absente = mémoire vide. */
  readonly memory?: ProjectMemory | undefined;
  /** CDC §15 ADR auto : `true` = demander l'enregistrement dédupliqué de la décision. */
  readonly record?: boolean | undefined;
}

export type StreamDecisionAdvisor = (
  input: StreamDecisionInput
) => Promise<StreamDecisionSummary | null>;

let streamDecisionAdvisor: StreamDecisionAdvisor | undefined;

export function configureStreamDecisionAdvisor(advisor: StreamDecisionAdvisor | undefined): void {
  streamDecisionAdvisor = advisor;
}

/**
 * CDC §31 — DNA EVOLUTION (LOT 2026-11-03, audit moteurs) : le captureur est
 * injecté par server.ts (DNAVersionStore + ApplicationDNAService réels). Le
 * flux capture la version APRÈS chaque mutation persistée,avec provenance
 * (revisionId + décision) ; NAND dédoublonnage par hash réel côté store.
 */
export interface DnaVersionCaptureResult {
  readonly created: boolean;
  readonly version: number;
  readonly versions: number;
}

export type DnaVersionCapture = (input: {
  tenantId: string;
  projectId: string;
  requestId: string;
  sessionId: string;
  decisionId?: string | undefined;
  revisionId?: string | undefined;
  trigger: 'stream-mutation' | 'manual' | 'rollback';
}) => DnaVersionCaptureResult | null;

let dnaVersionCaptureFn: DnaVersionCapture | undefined;

export function configureDnaVersionCapture(capture: DnaVersionCapture | undefined): void {
  dnaVersionCaptureFn = capture;
}

export type StreamDecisionOutcome =
  | { readonly available: true; readonly summary: StreamDecisionSummary }
  | { readonly available: false; readonly reason: string };

/**
 * Appelle l'avis décisionnel sans jamais casser la génération : absence de
 * moteur ou erreur = `available: false` explicite, jamais de verdict inventé.
 */
export async function assessStreamDecision(
  advisor: StreamDecisionAdvisor | undefined,
  input: StreamDecisionInput
): Promise<StreamDecisionOutcome> {
  if (!advisor) {
    return { available: false, reason: 'service-non-configure' };
  }
  try {
    const summary = await advisor(input);
    if (!summary) {
      return { available: false, reason: 'decision-indisponible' };
    }
    return { available: true, summary };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

/** Variante branchée sur l'instance injectée par le bootstrap. */
export function assessConfiguredStreamDecision(
  input: StreamDecisionInput
): Promise<StreamDecisionOutcome> {
  return assessStreamDecision(streamDecisionAdvisor, input);
}

// LOT 4 — Plan First (§17 CDC) : génération déterministe d'un plan d'ingénierie
// affiché dans le chat, sans appel LLM supplémentaire.
const planGenerator = new PlanGenerator();

/**
 * EXECUTION TRANSPARENCY (CDC Transparency Engine) : chaque génération produit
 * des événements typés persistés (executionId = requestId). Feature flag :
 * `VOLACO_EXECUTION_TIMELINE=off` restaure le comportement d'avant (frames nues,
 * aucune persistance) en cas de besoin de rollback instantané.
 */
const executionTimelineEnabled = process.env.VOLACO_EXECUTION_TIMELINE !== 'off';

/**
 * V7 — préparation moteur dans le flux stream.
 *
 * Désactivé par défaut : le flux actuel reste la référence. Quand le flag est
 * actif, `/stream` récupère du moteur conversationnel l'intention enrichie, le
 * plan, l'impact et le contexte borné, puis conserve sa génération, sa mutation
 * et sa persistance. Toute erreur de préparation retombe sur le chemin actuel.
 */
let streamPreparationEnabled = process.env.VOLACO_UNIFIED_PIPELINE === '1';

export function configureStreamPreparation(enabled: boolean): void {
  streamPreparationEnabled = enabled;
}

export function isStreamPreparationEnabled(): boolean {
  return streamPreparationEnabled;
}

/**
 * Fichiers cibles réels du plan pour l'analyse d'impact du stream.
 * Repli explicite sur index.html si le plan n'en déclare aucun : on ne
 * fabrique jamais une liste vide qui masquerait l'absence de cible.
 */
export function resolveStreamImpactTargets(plan?: EngineeringPlan | undefined): string[] {
  const targets = new Set<string>();
  for (const step of plan?.steps ?? []) {
    for (const file of step.targetFiles ?? []) {
      targets.add(file);
    }
  }
  return targets.size > 0 ? [...targets] : [STREAM_MUTATION_PATH];
}

/**
 * LOT A-C2 — ASSAINISSEMENT D'UNE SECTION AU POINT DE PARSE (source unique).
 *
 * Le LLM émet parfois le HTML d'une section enveloppé dans un bloc Markdown
 * (« ```html … ``` ») : les balises de code survivaient alors DANS le HTML
 * persisté (constat T2 : une balise en fin de contenu de chaque section,
 * recopiées puis IMITÉES à chaque tour) et des fermetures orphelines
 * s'accumulaient en jonction (« \n```</div> »). Le nettoyage est fait UNE
 * FOIS, à la finalisation de `currentSectionHtml`, pour que TOUS les
 * chemins (modify/add/create et leurs replis) reçoivent un HTML propre via
 * `serverSections` — jamais en supprimant après coup dans le fichier.
 *
 * Déterministe, borné, sans réécriture du contenu utile :
 *   1. lignes de balises Markdown isolées (« ``` », « ```html ») supprimées ;
 *   2. marqueurs de balise résiduels en jonction (« ```</div> ») : le
 *      marqueur part, le HTML de la ligne reste ;
 *   3. UN `</div>` final en excès retiré SEULEMENT si
 *      fermetures − ouvertures === 1 (artefact de jonction) ;
 *   4. enveloppe `<div data-section="…">` retirée SEULEMENT si elle couvre
 *      tout le contenu (la fermeture appariée à son ouverture est la
 *      DERNIÈRE balise div) et que le contenu est équilibré.
 *
 * Idempotent : passer deux fois ne change rien. Le HTML sain transite
 * inchangé (aucune balise Markdown légitime n'existe dans du HTML).
 */
export function sanitizeSectionHtml(name: string, raw: string): string {
  let html = (raw ?? '')
    // 1. Lignes de balises isolées : « ``` », « ```html », « ```js »…
    .replace(/^[ \t]*`{3,}[A-Za-z0-9_-]*[ \t]*\r?$/gm, '')
    // 2. Marqueurs résiduels en jonction (« ```</div> ») : seul le marqueur
    //    part, le HTML de la ligne reste.
    .replace(/`{3,}/g, '')
    .trim();
  if (!html) return html;

  const divBalance = (value: string): number =>
    (value.match(/<\/div\b/gi)?.length ?? 0) - (value.match(/<div\b/gi)?.length ?? 0);

  // 3. Une seule fermeture en excès (artefact de jonction) : on retire UN
  //    `</div>` final, jamais plus, jamais un contenu utile.
  if (divBalance(html) === 1) {
    const closes = [...html.matchAll(/<\/div\b[^>]*>/gi)];
    const last = closes[closes.length - 1];
    if (last && last.index !== undefined) {
      html = (html.slice(0, last.index) + html.slice(last.index + last[0].length)).trim();
    }
  }

  // 4. Unwrap de l'enveloppe data-section : regex d'abord (nom de la section
  //    en priorité, comme les anciens unwraps), puis contrôle EN PILE que
  //    la fermeture appariée à l'ouverture d'enveloppe est bien la dernière
  //    balise div (l'ancien unwrap aveugle coupait un `</div>` utile quand
  //    le contenu se terminait par une balise).
  const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns: RegExp[] = [];
  if (name) patterns.push(new RegExp(`^<div[^>]*data-section="${escapeRe(name)}"[^>]*>([\\s\\S]*)<\\/div>$`, 'i'));
  patterns.push(/^<div[^>]*data-section="[^"]*"[^>]*>([\s\S]*)<\/div>$/i);
  const spansEverything = (value: string): boolean => {
    const tokens = [...value.matchAll(/<\/?div\b/gi)];
    if (tokens.length === 0) return false;
    let depth = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]![0].toLowerCase();
      if (token.startsWith('</')) {
        if (depth > 0) depth -= 1;
        if (depth === 0) return i === tokens.length - 1;
      } else {
        depth += 1;
      }
    }
    return false;
  };
  for (const pattern of patterns) {
    const wrapMatch = pattern.exec(html);
    if (wrapMatch && spansEverything(html)) {
      html = (wrapMatch[1] ?? '').trim();
      break;
    }
  }
  return html;
}

/**
 * AUDIT PREVIEW — déduplication des blocs data-section : les générations
 * antérieures à la garde d'unicité ont pu accumuler des doublons
 * (footer ×3, header ×2 constatés en production). À chaque sauvegarde, la
 * dernière occurrence de chaque nom gagne — le fichier s'assainit tout seul.
 */
export function dedupeSectionBlocks(html: string): string {
  const re = /<div[^>]*data-section="([^"]+)"[^>]*>[\s\S]*?(?=<div[^>]*data-section|<\/body>|$)/g;
  const blocks: Array<{ name: string; block: string; start: number; end: number }> = [];
  for (const m of html.matchAll(re)) {
    blocks.push({ name: (m[1] || '').toLowerCase(), block: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  if (blocks.length === 0) return html;
  const lastByName = new Map<string, { start: number; end: number }>();
  for (const b of blocks) lastByName.set(b.name, { start: b.start, end: b.end });
  let out = '';
  let cursor = 0;
  for (const b of blocks) {
    const keep = lastByName.get(b.name);
    if (keep && keep.start === b.start && keep.end === b.end) {
      out += html.slice(cursor, b.end);
      cursor = b.end;
    } else {
      // doublon évincé : il est sauté (le texte qui le précède reste)
      out += html.slice(cursor, b.start);
      cursor = b.end;
    }
  }
  out += html.slice(cursor);
  return out;
}

/**
 * T7 (CDC §24-§25) — synthèse finale de l'exécution, construite UNIQUEMENT
 * à partir de mesures réelles : comptes de sections, delta de lignes,
 * score du gate s'il a tourné, durée mesurée. Aucun chiffre inventé.
 */
/**
 * T7 (É53 LOT B) — synthèse finale STRUCTURÉE : autorité de vérité de la
 * clôture. Le verdict ne repose plus sur l'annonce mais sur les faits :
 *   success — les changements attendus ont été réellement persistés ;
 *   partial — une écriture réelle a eu lieu mais incomplète (motifs exacts) ;
 *   failure — RIEN n'a été persisté (aucun succès fictif).
 * Les compteurs n'annoncent que les sections RÉELLEMENT changées
 * (bytes modifiés via sectionDiffs[].applied) — jamais l'annonce du LLM.
 */
export interface StreamSynthesisResult {
  readonly text: string;
  readonly verdict: 'success' | 'partial' | 'failure';
}

export function buildFinalSynthesis(input: {
  verdict: 'success' | 'partial' | 'failure';
  partialReasons?: ReadonlyArray<string> | undefined;
  failureReason?: string | null | undefined;
  sections: ReadonlyArray<{ readonly name: string; readonly mode: string; readonly changed: boolean }>;
  sectionDiffs: ReadonlyArray<{ readonly applied: boolean; readonly added: number; readonly removed: number }>;
  gateScore: number | null;
  gateAvailable: boolean;
  durationSec: number;
}): StreamSynthesisResult {
  const appliedDiffs = input.sectionDiffs.filter((d) => d.applied);
  const added = appliedDiffs.reduce((acc, d) => acc + d.added, 0);
  const removed = appliedDiffs.reduce((acc, d) => acc + d.removed, 0);
  const changedSections = input.sections.filter((s) => s.changed);
  const created = changedSections.filter((s) => s.mode === 'create' || s.mode === 'add').length;
  const modified = changedSections.filter((s) => s.mode === 'modify').length;
  const deleted = changedSections.filter((s) => s.mode === 'delete').length;
  if (input.verdict === 'failure') {
    const reason = input.failureReason ? ` : ${input.failureReason}` : '';
    return {
      text: `Aucune écriture persistée${reason} · ${Math.max(1, input.durationSec)}s`,
      verdict: 'failure'
    };
  }
  const bits: string[] = [];
  const actions: string[] = [];
  if (created) actions.push(`${created} section${created > 1 ? 's' : ''} construite${created > 1 ? 's' : ''}`);
  if (modified) actions.push(`${modified} modifiée${modified > 1 ? 's' : ''}`);
  if (deleted) actions.push(`${deleted} supprimée${deleted > 1 ? 's' : ''}`);
  bits.push(actions.length ? actions.join(' · ') : 'page assemblée');
  if (input.verdict === 'partial') {
    const reasons = (input.partialReasons ?? []).filter(Boolean);
    bits.push(`PARTIEL${reasons.length ? ` : ${reasons.join(' ; ')}` : ''}`);
  }
  if (added || removed) bits.push(`+${added} −${removed} lignes`);
  if (input.gateScore !== null) bits.push(`Quality Gate ${input.gateScore}/100`);
  else if (!input.gateAvailable) bits.push('Quality Gate non évalué');
  bits.push(`${Math.max(1, input.durationSec)}s`);
  return { text: bits.join(' · '), verdict: input.verdict };
}

/**
 * É53 LOT B — AUTORITÉ DE VÉRITÉ du flux /stream (audit §3-§4).
 *
 * Calcul DÉTERMINISTE du résultat final à partir des faits réellement
 * disponibles — jamais de l'annonce, jamais de la longueur du HTML :
 *
 *   `updated` = true  ⟺ une écriture a réellement été persistée ET confirmée
 *   par la vérification post-écriture (lecture à rebours du fichier, ou
 *   confirmation du moteur + invariants CONTENT_PRESERVED). Ni le dépassement
 *   de 100 caractères du HTML, ni `viaFallback`, ni la seule présence de
 *   sections annoncées ne constituent une preuve de persistance.
 *
 *   `partial` : écriture réelle mais incomplète — sections demandées non
 *   appliquées (cible introuvable) et/ou génération tronquée (dernière
 *   section jamais fermée, non persistée). Le Quality Gate reste un signal
 *   DISTINCT (qualité ≠ persistance) : un gate < seuil ou indisponible
 *   n'ajoute ni ne retire de succès de persistance.
 *
 *   failure : rien persisté — zéro section exploitable, modification sans
 *   aucun changement réellement appliqué, refus (contrat/plan/validation),
 *   rollback, erreur ou annulation. Aucun succès fictif.
 */
export interface StreamTruthInput {
  readonly isModificationMode: boolean;
  /** Le bloc de persistance a réellement été tenté (changements exploitables). */
  readonly attemptedPersistence: boolean;
  /** Écriture orchestrée confirmée par le moteur (invariants post-écriture passés). */
  readonly mutationApplied: boolean;
  /** Repli direct tracé : écriture + lecture à rebours confirmée. */
  readonly fallbackWritten: boolean;
  /** Lecture à rebours : le fichier persisté correspond au contenu généré. */
  readonly persistedVerified: boolean;
  readonly persistenceError?: string | undefined;
  /** Identifiant de la révision RÉELLEMENT créée (fait reporté, pas preuve). */
  readonly revisionCreated: boolean;
  readonly truncatedGeneration: boolean;
  readonly gateEligible: boolean;
  readonly gateResult: { readonly score: number; readonly passed: boolean } | null;
  /** Sections fermées avec leur vérité par section. */
  readonly sections: ReadonlyArray<{
    readonly name: string;
    readonly mode: string;
    /** Bytes réellement changés dans le fichier. */
    readonly changed: boolean;
    /** Cible trouvée/section réellement livrée (écho identique = livrée sans changement). */
    readonly delivered: boolean;
  }>;
  /** Au moins un changement attendu a pu être tenté (sinon rien à persister). */
  readonly hasExploitableChange: boolean;
}

export interface StreamTruth {
  readonly updated: boolean;
  readonly verdict: 'success' | 'partial' | 'failure';
  readonly partial: boolean;
  readonly partialReasons: readonly string[];
  readonly reason: string | null;
  /** Persistance réelle mais qualité NON évaluée (gate indisponible). */
  readonly gateUnavailable: boolean;
  /** Fichiers réellement commis — établis depuis le parcours /stream réel. */
  readonly committedFiles: ReadonlyArray<{ readonly taskId: string; readonly files: readonly string[] }>;
  /** Cibles attendues sans aucune écriture réelle. */
  readonly unmetFiles: ReadonlyArray<{ readonly taskId: string; readonly files: readonly string[] }>;
}

export function computeStreamTruth(input: StreamTruthInput): StreamTruth {
  const persisted = !input.persistenceError
    && input.attemptedPersistence
    && input.persistedVerified
    && (input.mutationApplied || input.fallbackWritten);
  if (!persisted) {
    let reason: string;
    if (input.persistenceError) {
      reason = `persistance refusée ou en échec (${input.persistenceError})`;
    } else if (!input.attemptedPersistence) {
      reason = !input.hasExploitableChange
        ? (input.isModificationMode
          ? 'aucune modification réellement appliquée à la cible demandée'
          : 'aucune section exploitable générée')
        : 'contenu généré sous le seuil d\'un document viable : aucune écriture tentée';
    } else {
      reason = 'écriture non confirmée par la vérification post-persistance';
    }
    return {
      updated: false,
      verdict: 'failure',
      partial: false,
      partialReasons: [],
      reason,
      gateUnavailable: false,
      committedFiles: [],
      unmetFiles: [{ taskId: 'stream', files: ['index.html'] }]
    };
  }
  const partialReasons: string[] = [];
  for (const section of input.sections) {
    if (!section.delivered) {
      partialReasons.push(`section « ${section.name} » (mode ${section.mode}) demandée mais non appliquée`);
    }
  }
  if (input.truncatedGeneration) {
    partialReasons.push('génération tronquée : la dernière section n\'a jamais été fermée et n\'a pas été persistée');
  }
  const partial = partialReasons.length > 0;
  const gateUnavailable = input.gateEligible && input.gateResult === null;
  return {
    updated: true,
    verdict: partial ? 'partial' : 'success',
    partial,
    partialReasons,
    reason: null,
    gateUnavailable,
    committedFiles: [{ taskId: 'stream', files: ['index.html'] }],
    unmetFiles: []
  };
}

/**
 * Classification d'intention déterministe (mêmes heuristiques que la route
 * /decide) — utilisée quand aucun intent classifié n'est fourni au flux.
 */
function buildStreamFallbackIntent(message: string): IntentResult {
  const lower = (message || '').toLowerCase();
  let category: IntentResult['category'] = 'UNKNOWN';
  if (/\b(crée|ajoute|génère|créer|générer|add|create)\b/.test(lower)) category = 'CREATE';
  else if (/\b(modifie|change|édite|update|modify)\b/.test(lower)) category = 'MODIFY';
  else if (/\b(supprime|efface|delete|remove)\b/.test(lower)) category = 'DELETE';
  else if (/\b(refactor|nettoy|clean)\b/.test(lower)) category = 'REFACTOR';
  else if (/\b(debug|corrig|fix)\b/.test(lower)) category = 'DEBUG';
  else if (/\b(analy|audit)\b/.test(lower)) category = 'ANALYZE';
  return {
    category,
    goal: (message || '').slice(0, 200),
    requestedAction: message || '',
    entities: [],
    constraints: [],
    urgency: 'NORMAL',
    confidence: 0.5,
    ambiguities: []
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * T4 (CDC §11) — delta réel de lignes entre deux textes : diff multiset par
 * ligne (ajouts = lignes de `after` absentes de `before`, et inversement).
 * Déterministe, sans dépendance — jamais de faux chiffres affichés.
 */
export function countLineDelta(beforeText: string, afterText: string): { added: number; removed: number } {
  const count = (text: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (const line of text.split('\n')) {
      const key = line.trim();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  };
  const before = count(beforeText || '');
  const after = count(afterText || '');
  let added = 0;
  let removed = 0;
  const keys = new Set<string>([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const b = before.get(key) || 0;
    const a = after.get(key) || 0;
    if (a > b) added += a - b;
    else if (b > a) removed += b - a;
  }
  return { added, removed };
}

async function parseJsonBody<T>(req: IncomingMessage, requestId: string): Promise<T> {
  const bodyText = await readBody(req);
  if (!bodyText || bodyText.trim().length === 0) {
    return {} as T;
  }
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
  }
}

function extractHtmlBlock(text: string): string | null {
  const match = text.match(/```(?:html)?([\s\S]*?)```/i);
  const candidate = (match && match[1] ? match[1] : text).trim();
  return candidate.length > 100 ? candidate : null;
}

/**
 * Enveloppe des sections générées dans un document HTML complet, aligné avec
 * le buildHtmlDoc du Studio (Tailwind CDN, polices, fond sombre). Un document
 * complet dans fileStore garantit : éditeur lisible, /render/preview fidèle
 * et contexte correct pour les tours de modification suivants.
 */
/**
 * ÉTAPE narration ancrée (effet waw — §14 CDC) : un résumé COMPACT du contenu
 * RÉEL de la page (titre, sections, titres visibles, boutons, couleurs) injecté
 * dans le prompt. L'IA ne parle plus de « la page » en général : elle commente
 * les VRAIS titres et les VRAIES couleurs de l'utilisateur. Déterministe.
 */
export function buildPageContext(currentHtml: string): string {
  if (!currentHtml || currentHtml.length < 100) return '';
  const parts: string[] = [];
  const title = (currentHtml.match(/<title>([^<]{1,80})<\/title>/i) || [])[1];
  if (title) parts.push('- Titre de la page : ' + title.trim());
  const sections = [...currentHtml.matchAll(/data-section="([^"]{1,40})"/g)].map((m) => m[1]);
  if (sections.length) parts.push('- Sections existantes : ' + [...new Set(sections)].slice(0, 12).join(', '));
  const headings = [...currentHtml.matchAll(/<h[12][^>]*>([^<]{2,60})<\/h[12]>/gi)].map((m) => (m[1] as string).trim()).slice(0, 6);
  if (headings.length) parts.push('- Titres visibles : ' + headings.join(' | '));
  const buttons = [...currentHtml.matchAll(/<button[^>]*>\s*([^<]{1,40})\s*<\/button>/gi)].map((m) => (m[1] as string).trim()).slice(0, 8);
  if (buttons.length) parts.push('- Boutons : ' + buttons.join(' | '));
  const colors = [...new Set((currentHtml.match(/#[0-9a-fA-F]{6}\b/g) || []).map((c) => c.toLowerCase()))].slice(0, 8);
  if (colors.length) parts.push('- Couleurs utilisées : ' + colors.join(', '));
  if (parts.length === 0) return '';
  return '\n\nCONTEXTE RÉEL DE LA PAGE ACTUELLE (parle de ces éléments avec tes mots, tutoiement) :\n' + parts.join('\n');
}

/**
 * É52 — empreinte design optionnelle d'un projet : quand le LLM fournit un
 * bloc <DESIGN_DNA> en tête de sa réponse, le shell s'adapte (police Google
 * Fonts, fond, couleur du texte, mode clair/sombre). SANS dna, le shell est
 * identique octet pour octet à l'ancien (non-régression stricte).
 */
export interface StudioDesignDna {
  palette: { bg: string; fg: string; accent: string };
  font: string;
  mode?: 'light' | 'dark';
}

/**
 * Extrait (et retire du texte) le bloc <DESIGN_DNA:{json}> émis par le LLM.
 * - Le commentaire est TOUJOURS retiré (même tronqué/mal formé : jamais de
 *   junk dans le HTML sauvegardé) ;
 * - Bloc avec un JSON exploitable → dna parsée (le premier bloc gagne) ;
 * - Bloc sans JSON exploitable → dna null (shell legacy).
 */
export function extractDesignDna(source: string): { dna: StudioDesignDna | null; cleaned: string } {
  let dna: StudioDesignDna | null = null;
  const cleaned = source.replace(/<!--\s*DESIGN_DNA:\s*([\s\S]*?)-->/g, (_match, body: string) => {
    if (!dna) {
      const jsonMatch = body.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as StudioDesignDna;
          const p = parsed?.palette;
          if (p && typeof p.bg === 'string' && typeof p.fg === 'string' && typeof p.accent === 'string' && typeof parsed.font === 'string' && parsed.font.trim().length > 0) {
            dna = parsed;
          }
        } catch {
          // JSON invalide : ignoré, le shell legacy s'applique
        }
      }
    }
    return '';
  });
  return { dna, cleaned };
}

/**
 * Titre de page fourni par le LLM (`<!-- PAGE_TITLE: … -->`, même motif que
 * DESIGN_DNA) : le premier bloc gagne, assaini (sans balises, 70 car. max),
 * repli « VibeCode Studio ». Le shell posait un titre générique fixe (SEO nul).
 */
export function extractPageTitle(source: string): { title: string | null; cleaned: string } {
  let title: string | null = null;
  const cleaned = source.replace(/<!--\s*PAGE_TITLE:\s*([\s\S]*?)-->/g, (_match, body: string) => {
    if (title === null) {
      const text = String(body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
      if (text.length > 0) title = text;
    }
    return '';
  });
  return { title, cleaned };
}

/**
 * LOT LEAK-FIX — les commentaires HTML (`<!-- PAGE_TITLE: … -->`, DESIGN_DNA,
 * notes internes du protocole de génération) ne doivent JAMAIS s'afficher
 * comme texte parlé dans le chat. On retire aussi tout commentaire entamé et
 * jamais refermé (fin de stream coupée) : mieux vaut le perdre que le montrer.
 */
export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/g, '');
}

export function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * LOT POLISH (21/10) — applique la réconciliation de titre à un document
 * COMPLET (mode modification) : le shell n'est pas reconstruit, on remplace
 * uniquement `<title>` (ou on l'insère dans `<head>` s'il manque). Un titre
 * fourni par le LLM (`PAGE_TITLE`) prime, sinon le titre existant est
 * confronté au contenu réel. Aucun autre octet du document n'est déplacé.
 */
export function applyReconciledPageTitle(html: string, candidateTitle?: string | null): string {
  if (!/<html[\s>]/i.test(html)) return html;
  const existing = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const source = candidateTitle !== undefined && candidateTitle !== null && candidateTitle.trim().length > 0
    ? candidateTitle
    : existing;
  let reconciled = reconcilePageTitle(source, html);
  if (reconciled.length === 0) {
    const fallback = deriveFallbackTitle(html);
    reconciled = fallback === null ? '' : reconcilePageTitle(fallback, html);
  }
  if (reconciled.length === 0) return html;
  const titleTag = `<title>${escapeHtmlText(reconciled)}</title>`;
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, titleTag);
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${titleTag}</head>`);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${titleTag}`);
  }
  return html;
}

/**
 * ORDRE CANONIQUE des sections : le LLM émet parfois dans le désordre
 * (footer 2e constaté en production, rév. #54) et le serveur sauvegardait
 * tel quel. Tri stable : header/nav d'abord, hero ensuite, contenu, puis
 * contact/réservation, footer TOUJOURS dernier. Noms inconnus : rang 50
 * (ordre relatif conservé). Une ancre explicite valide (after=) prime
 * toujours sur ce rang (intention explicite > convention).
 */
const RANK_FIRST = ['header', 'nav', 'navbar'];
const RANK_HERO = ['hero'];
const RANK_LAST = ['footer'];
const RANK_CLOSING = ['contact', 'reservation', 'booking', 'rendez-vous', 'testimonial', 'temoignage', 'avis', 'pricing', 'tarif', 'formule'];

export function sectionRank(name: string): number {
  const n = (name || '').toLowerCase();
  if (RANK_FIRST.some((k) => n.includes(k))) return 0;
  if (RANK_HERO.some((k) => n.includes(k))) return 10;
  if (RANK_LAST.some((k) => n.includes(k))) return 100;
  if (RANK_CLOSING.some((k) => n.includes(k))) return 30;
  return 20;
}

export function canonicalSectionOrder<T extends { name: string }>(sections: readonly T[]): T[] {
  return sections
    .map((sec, index) => ({ sec, index }))
    .sort((a, b) => {
      const rank = sectionRank(a.sec.name) - sectionRank(b.sec.name);
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((entry) => entry.sec);
}

/**
 * B2 — ORDRE CANONIQUE EN MODIFICATION : le document fusionné contient des
 * blocs `<div class="vibe-stitched" data-section="nom">` dans l'ordre
 * d'arrivée (le LLM + le repli "avant </body>" placent les ajouts APRÈS
 * le footer). On permute les blocs entre eux (contenu hors-blocs intact,
 * doublons conservés dans l'ordre) : header → hero → contenu → closing →
 * footer TOUJOURS dernier.
 */
export function canonicalSectionOrderBlocks(html: string): string {
  const re = /<div[^>]*data-section="([^"]+)"[^>]*>[\s\S]*?(?=<div[^>]*data-section=|<\/body>|$)/gi;
  const blocks: Array<{ name: string; html: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) blocks.push({ name: m[1] ?? '', html: m[0] });
  if (blocks.length < 2) return html;
  const sorted = canonicalSectionOrder(blocks);
  let i = 0;
  return html.replace(re, () => sorted[i++]!.html);
}

/**
 * Titre de REPLI quand le LLM omet PAGE_TITLE (constaté en prod : instruction
 * parfois ignorée). Déterministe : premier H1 textuel, sinon premier H2,
 * balises internes retirées, 70 car. max. Null si rien d'exploitable.
 */
export function deriveFallbackTitle(html: string): string | null {
  for (const tag of ['h1', 'h2']) {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html);
    if (!m) continue;
    const text = m[1]!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70).trim();
    if (text.length >= 3) return text;
  }
  return null;
}

/**
 * IDs du réservoir du thème déjà présents dans le HTML (toute source) :
 * la rotation du repli ne les choisit pas en premier — une image réparée ne
 * duplique pas une photo déjà affichée tant qu'un autre ID est disponible.
 */
function poolIdsAlreadyInUse(html: string): ReadonlySet<string> {
  const used = new Set<string>();
  for (const m of html.matchAll(/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/gi)) {
    if (m[1]) used.add(m[1]);
  }
  return used;
}

/**
 * Filet de repli par thème (F1/F2 — stratégie unique, pur et déterministe) :
 * d'abord les IDs du réservoir NON déjà présents dans le HTML, puis tout le
 * réservoir (répétition assumée une fois le réservoir épuisé — jamais d'URL
 * inventée). Depuis T0.5, même 'autre' possède un réservoir (ambiance
 * neutre vérifiée) ; un réservoir vide n'existe plus qu'en théorie : dans ce
 * cas l'appelant utilise son repli neutre historique.
 */
function themeFallbackQueue(html: string, theme: ImageTheme, rotationSeed = 0): readonly string[] {
  // PATCH PERTINENCE — même rotation seedée que le brief et le sanitize :
  // l'ordre de repli est stable au sein d'une génération, varié entre
  // générations (rotationSeed = poolRotationSeed(requestId) ; 0 = historique).
  const pool = rotatePool(THEME_IMAGE_RESOURCES[theme]?.unsplash ?? [], rotationSeed);
  if (pool.length === 0) return [];
  const used = poolIdsAlreadyInUse(html);
  return [...pool.filter((id) => !used.has(id)), ...pool];
}

/** Seed picsum du repli NEUTRE : placeholder générique, déterministe. */
function neutralPicsumSeed(tag: string, index: number): string {
  const altMatch = /\balt\s*=\s*"([^"]*)"/i.exec(tag) || /\balt\s*=\s*'([^']*)'/i.exec(tag);
  const base = (altMatch?.[1] ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || `sanitized-${index}`;
  return `${base}-${index}`;
}

/**
 * Repli anti-images-cassées (E46 côté Builder, ici pour le HTML servi) :
 * chaque <img> http(s) sans gestionnaire d'erreur en reçoit un — en cas
 * d'échec de chargement chez le visiteur, bascule vers un repli du THÈME
 * (F2 : ID vérifié du réservoir, rotation) au lieu d'une photo générique ;
 * 'autre' possède depuis T0.5 un réservoir d'ambiance neutre vérifiée,
 * tout comme les secteurs. À défaut (réservoir vide, théorique),
 * placeholder picsum déterministe historique.
 * `this.onerror=null` AVANT l'échange : si le repli échoue à son tour,
 * aucune boucle onerror. Compteur = seed stable du repli neutre.
 */
export function addImageFallbacks(html: string, theme: ImageTheme = 'autre', rotationSeed = 0): string {
  let index = 0;
  const queue = themeFallbackQueue(html, theme, rotationSeed);
  let cursor = 0;
  // Tag complet même avec `>` dans un attribut quoté (alt="a > b").
  const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  return html.replace(IMG_TAG, (tag: string) => {
    if (/\bonerror\s*=/i.test(tag)) return tag;
    const srcMatch = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag) || /\bsrc\s*=\s*'([^']*)'/i.exec(tag);
    const src = srcMatch ? srcMatch[1] : '';
    if (!src || !/^https?:\/\//i.test(src)) return tag;
    index += 1;
    const fallback = queue.length > 0
      ? `https://images.unsplash.com/${queue[cursor % queue.length]}?auto=format&fit=crop&w=1200&q=80`
      : `https://picsum.photos/seed/vibe-${index}/800/520`;
    cursor += 1;
    return tag.replace(/\/?>$/, (end: string) => ` onerror="this.onerror=null;this.src='${fallback}'"${end}`);
  });
}

/**
 * IDs Unsplash vérifiés vivants — dérivés de la table thématique
 * (packages/core/src/image/theme.ts) + IDs historiques conservés pour
 * compatibilité (pages existantes). Source unique : allVerifiedUnsplashIds.
 */
export const VERIFIED_UNSPLASH_IDS: ReadonlySet<string> = new Set(allVerifiedUnsplashIds());

/**
 * B3 + F1 — SANITIZER IMAGES À LA SAUVEGARDE : le prompt seul ne suffit pas,
 * le LLM récite parfois des URLs de mémoire (loremflickr 500 — prouvé rév 97).
 * Toute <img> dont l'hôte n'est pas autorisé (Unsplash vérifié, picsum,
 * data:) est réécrite VERS LE THÈME : ID vérifié du réservoir (rotation F1,
 * sans dupliquer les IDs déjà affichés tant qu'il en reste). Depuis T0.5 le
 * thème 'autre' a lui aussi un réservoir (ambiance neutre vérifiée) — le
 * repli picsum seed stable n'intervient plus qu'à défaut de réservoir
 * (théorique). Placeholder générique, JAMAIS présenté comme le produit. src vide : untouched (le gate
 * le signale déjà). Retourne le HTML nettoyé + le nombre de réécritures
 * (tracé en log, jamais d'exception) ; PATCH PERTINENCE : `thematicRewrites`
 * compte les remplacements hors-secteur d'IDs pourtant vérifiés. Pur et
 * déterministe.
 */
/**
 * LOT UNSPLASH-DYN (18/10) — adoption des photos RÉELLES (recherche
 * Unsplash avec clé usager) : IDs + URLs canoniques calculés UNE fois par
 * exécution par l'API route (seule dépositaire de la clé). Les URLs
 * dynamiques sont réelles et thématiques par construction de la requête :
 * elles échappent à la vérification de table et sont la PREMIÈRE source de
 * remplacement — la réserve déterministe prend le relais à l'épuisement.
 * Absent : comportement strictement historique.
 */
export interface DynamicImageAdoption {
  readonly dynamicIds: ReadonlySet<string>;
  readonly dynamicUrls: readonly string[];
}

export function sanitizeImageSources(
  html: string,
  theme: ImageTheme = 'autre',
  rotationSeed = 0,
  dynamic?: DynamicImageAdoption
): { html: string; replaced: number; thematicRewrites: number } {
  let replaced = 0;
  let index = 0;
  const queue = themeFallbackQueue(html, theme, rotationSeed);
  let cursor = 0;
  // LOT UNSPLASH-DYN : filet dynamique roté comme le reste (seed unique de
  // génération) ; null sans clé/usine → aucune branche historique modifiée.
  const dynamicQueue = dynamic !== undefined && dynamic.dynamicUrls.length > 0
    ? rotatePool(dynamic.dynamicUrls, rotationSeed)
    : null;
  let dynamicCursor = 0;
  const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const clean = html.replace(IMG_TAG, (tag: string) => {
    const srcMatch = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag) || /\bsrc\s*=\s*'([^']*)'/i.exec(tag);
    const src = srcMatch ? srcMatch[1] : '';
    if (!src) return tag;
    if (/^data:image\//i.test(src)) return tag;
    let allowed = false;
    try {
      const url = new URL(src);
      if (/^https?:$/.test(url.protocol)) {
        const host = url.hostname.toLowerCase();
        if (host === 'picsum.photos') allowed = true;
        else if (host === 'images.unsplash.com') {
          const id = ((url.pathname.split('/').pop() || '').split('?')[0] ?? '');
          allowed = VERIFIED_UNSPLASH_IDS.has(id)
            || (dynamic !== undefined && dynamic.dynamicIds.has(id));
        }
      }
    } catch {
      allowed = false;
    }
    if (allowed) return tag;
    index += 1;
    replaced += 1;
    // LOT UNSPLASH-DYN : photos réelles d'abord (épuisées → réserve thème).
    const dynamicBase = dynamicQueue !== null && dynamicCursor < dynamicQueue.length
      ? dynamicQueue[dynamicCursor % dynamicQueue.length]
      : undefined;
    let replacement: string;
    if (dynamicBase !== undefined) {
      replacement = dynamicBase;
      dynamicCursor += 1;
    } else {
      replacement = queue.length > 0
        ? `https://images.unsplash.com/${queue[cursor % queue.length]}?auto=format&fit=crop&w=1200&q=80`
        : `https://picsum.photos/seed/${neutralPicsumSeed(tag, index)}/800/520`;
      cursor += 1;
    }
    return tag.replace(/\bsrc\s*=\s*("[^"]*"|'[^']*')/i, `src="${replacement}"`);
  });
  // PATCH PERTINENCE — SÉCURITÉ D'ABORD (ci-dessus), PERTINENCE ensuite :
  // une image LÉGALE mais d'un AUTRE secteur (ID vérifié d'un autre réservoir,
  // ou LEGACY sans sujet garanti) est remplacée par une image du réservoir du
  // thème courant — fonction commune theme.ts, idempotente, UN passage, seed
  // de génération. La conformité d'un ID ne prouve pas sa pertinence.
  // LOT UNSPLASH-DYN : les IDs dynamiques sont CONFORMES par construction
  // (requête thématique) et servent de priorité de réécriture hors-secteur.
  const thematic = thematicImageRewrite(
    clean,
    theme,
    rotationSeed,
    dynamic !== undefined
      ? { trustedIds: dynamic.dynamicIds, poolOverride: [...dynamic.dynamicIds] }
      : undefined
  );
  return { html: thematic.content, replaced, thematicRewrites: thematic.rewrites };
}

/**
 * F4 — échantillon traçable « reçu → conservé », par section (paires par
 * index : aucune étape entre les deux extractions ne change la structure du
 * document). Borné à 20, srcs tronquées à 120 : URLs publiques uniquement,
 * jamais de secret ni de contenu utilisateur. Différence only : quand la
 * source a été réécrite, l'entrée porte `received`.
 */
export interface FinalImageTrace {
  readonly section: string;
  /** URL finale conservée dans le HTML sauvegardé. */
  readonly final: string;
  /** URL reçue du LLM quand elle a été remplacée par `final`. */
  readonly received?: string;
}

export function buildFinalImageTrace(received: readonly SectionImage[], final: readonly SectionImage[], limit = 20): FinalImageTrace[] {
  const out: FinalImageTrace[] = [];
  const count = Math.min(final.length, limit);
  for (let i = 0; i < count; i += 1) {
    const f = final[i]!;
    const r = received[i];
    if (r !== undefined && (r.section !== f.section || r.src !== f.src)) {
      out.push({ section: f.section, final: f.src.slice(0, 120), received: r.src.slice(0, 120) });
    } else {
      out.push({ section: f.section, final: f.src.slice(0, 120) });
    }
  }
  return out;
}

export function buildStudioShell(sectionsHtml: string, dna?: StudioDesignDna, title?: string): string {
  const fontSlug = (dna?.font || 'Plus Jakarta Sans').trim().replace(/\s+/g, '+');
  const fontCss = dna?.font || 'Plus Jakarta Sans';
  const bg = dna?.palette.bg || '#070913';
  const fg = dna?.palette.fg || '#f1f5f9';
  const htmlClass = (dna?.mode === 'light' ? '' : 'dark ') + 'scroll-smooth';
  const pageTitleRaw = title && title.trim().length > 0 ? title.trim().slice(0, 70) : 'VibeCode Studio';
  const pageTitle = escapeHtmlText(reconcilePageTitle(pageTitleRaw, sectionsHtml));
  return `<!DOCTYPE html>
<html lang="fr" class="${htmlClass}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=${fontSlug}:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: '${fontCss}', sans-serif; background-color: ${bg}; color: ${fg}; margin: 0; }
    @keyframes shimmer { 0% { background-position: -1000px 0; } 100% { background-position: 1000px 0; } }
    .vibe-skeleton { background: linear-gradient(90deg, rgba(30,41,59,.5) 0%, rgba(51,65,85,.8) 50%, rgba(30,41,59,.5) 100%); background-size: 1000px 100%; animation: shimmer 1.5s infinite linear; border-radius: 8px; }
    @keyframes stitchReveal { 0% { opacity: 0; transform: translateY(8px); filter: blur(4px); } 50% { opacity: 0.8; filter: blur(2px); } 100% { opacity: 1; transform: translateY(0); filter: blur(0); } }
    .vibe-stitched { animation: stitchReveal 0.6s ease-out forwards; }
  </style>
</head>
<body>
${sectionsHtml}
</body>
</html>`;
}

/**
 * Prompts purs de la régénération post-plan (contrat de thème global +
 * brief images — testables sans IA). Texte identique à l'ancien inline,
 * plus l'annexe secteur (même brief que le stream).
 */
export interface RegeneratePrompts {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly isModification: boolean;
  readonly imageTheme: ImageTheme;
}

export function buildRegeneratePrompts(
  userMessage: string,
  currentHtml: string,
  planSummary: string
): RegeneratePrompts {
  const isModification = currentHtml.trim().length > 200;
  const imageTheme = detectImageTheme(userMessage || '', pageTitleHint(currentHtml));
  // LOT MÉTIERS (30/10) — sujet résolu côté serveur pour le long tail
  // ('autre' + métier du lexique) : même brief sujet-imposé que le chemin
  // conversationnel. `pageTitleHint` est pur : rappel sans effet.
  const imageSubject = resolveImageSubject(imageTheme, userMessage || '', pageTitleHint(currentHtml));
  const mode = isModification ? 'modify' : 'create';
  const systemPrompt = isModification
    ? "Tu es le Lead Ingénieur IA de VibeCode Studio. Tu dois MODIFIER l'application web existante selon le plan d'ingénierie approuvé et la demande de l'utilisateur.\n\n" +
      "CONSIGNES ABSOLUES :\n" +
      "1. Base-toi fidèlement sur le code HTML complet actuel fourni.\n" +
      "2. Si la demande porte sur l'apparence (couleurs, thème, palette, style), applique VRAIMENT ce changement.\n" +
      "3. Réponds UNIQUEMENT avec le code HTML complet mis à jour dans un bloc ```html ... ```, sans aucune explication."
    : "Tu es le Lead Designer UI/UX et Ingénieur IA principal de VibeCode Studio. Conçois une application web complète, moderne et interactive avec Tailwind CSS.\n" +
      "Réponds UNIQUEMENT avec le code HTML complet dans un bloc ```html ... ```, sans explication.";
  const sectorAppendix = '\n\n' + buildSectorContract(imageTheme, mode)
    + '\n\n' + buildImageBrief(imageTheme, mode, 0, imageSubject ? { subjectHint: imageSubject.hint } : undefined)
    + '\n\nTITRE : émets <!-- PAGE_TITLE: Vrai titre du site --> correspondant à la demande actuelle. Ne recopie jamais un titre hérité d’un autre secteur (ex. « Authentic Italian Cuisine » sur un site barbier).';
  const userPrompt = isModification
    ? `Voici le code HTML actuel de l'application :\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nPlan d'ingénierie approuvé : ${planSummary}\n\nDemande initiale de l'utilisateur : ${userMessage}`
    : `Génère l'application complète suivante : ${userMessage}`;
  return { systemPrompt: systemPrompt + sectorAppendix, userPrompt, isModification, imageTheme };
}

/**
 * SECTEUR-LIBRE — requête de recherche photo d'une exécution.
 * Thème mappé → requête dédiée du thème (comportement historique intact).
 * Thème 'autre' → requête DÉRIVÉE du texte (lexique métiers déterministe),
 * et repli générique quand aucun métier n'est reconnu. Pure : ni réseau,
 * ni clé — testable hors ligne.
 */
export function resolveDynamicSearchQuery(
  imageTheme: ImageTheme,
  userMessage: string,
  titleHint: string
): { readonly query: string; readonly derived: boolean } {
  const themedQuery = THEME_PHOTO_QUERY[imageTheme];
  if (imageTheme !== 'autre') return { query: themedQuery, derived: false };
  const derivedQuery = deriveSectorPhotoQuery(`${userMessage} ${titleHint}`);
  return derivedQuery === null
    ? { query: themedQuery, derived: false }
    : { query: derivedQuery, derived: true };
}

/**
 * Étape qui manquait jusqu'ici : une fois le plan approuvé et "exécuté" par le
 * moteur conversationnel (agent-runtime), rien n'écrivait vraiment le nouveau
 * contenu dans le fichier du projet. Cette fonction fait ce travail concret :
 * elle redemande à l'IA le code HTML complet mis à jour, en tenant compte du
 * plan approuvé et du fichier actuel, puis l'enregistre réellement via
 * fileStore (la même persistance sur disque que le reste du projet).
 */
async function regenerateFileForPlan(
  tenantId: string,
  projectId: string,
  plan: EngineeringPlan,
  userMessage: string,
  entryFile = 'index.html',
  clientApiKey?: string | undefined,
  /**
   * É53 LOT E4.1 — CORRECTION A : signal de la REQUÊTE /execute (armé
   * uniquement sur déconnexion client — aucun tour E1/E2 ici). Transmis
   * jusqu'au transport HTTP ; un abandon n'est jamais un échec LLM
   * ordinaire et n'aboutit jamais à une écriture tardive.
   */
  signal?: AbortSignal | undefined
): Promise<{ updated: boolean; content?: string; error?: string }> {
  // Corrige un bug réel trouvé en testant : sans préférence explicite, le
  // registre pouvait choisir un fournisseur qui n'a pas de clé configurée
  // (ex: Gemini) plutôt que celui que l'utilisateur a réellement configuré
  // (ex: Mistral). On préfère explicitement celui dont la clé d'environnement
  // est présente.
  const preferredProviderId = process.env.MISTRAL_API_KEY
    ? 'mistral'
    : process.env.GEMINI_API_KEY
      ? 'gemini'
      : preferredAiProvider();
  const adapter = aiProviderRegistry.resolve(preferredProviderId ? { preferredProviderId } : {});
  if (!adapter) {
    return { updated: false, error: "Aucun fournisseur IA réel (Gemini/Mistral) n'est disponible côté serveur." };
  }

  const existing = fileStore.getFile(tenantId, projectId, entryFile);
  const currentHtml = existing?.content || '';

  // Prompts purs et testables (contrat de thème global + brief images) :
  // voir buildRegeneratePrompts — même texte qu'avant, plus l'annexe secteur.
  const regen = buildRegeneratePrompts(userMessage, currentHtml, plan.summary);
  const isModification = regen.isModification;
  // P0 (audit 2026-10) — contexte Design réel ajouté au prompt de
  // régénération ; sans rapport persisté, texte strictement identique.
  const systemPrompt = withProjectDesignContext(regen.systemPrompt, { tenantId, projectId });
  const userPrompt = regen.userPrompt;
  logger.info('Contrat de thème (régénération plan)', {
    component: 'conversation-route',
    tenantId,
    projectId,
    imageTheme: regen.imageTheme
  });

  const credentials = clientApiKey
    ? { tenantId, providerId: adapter.descriptor.providerId, apiKey: clientApiKey }
    : resolveProviderCredentials(tenantId, adapter.descriptor.providerId);

  try {
    const response = await adapter.generate(
      { tenantId, projectId, prompt: userPrompt, systemPrompt, temperature: 0.2, maxTokens: 8192, ...(signal !== undefined ? { signal } : {}) },
      credentials
    );
    const html = extractHtmlBlock(response.text);
    if (!html) {
      return { updated: false, error: "La réponse de l'IA ne contenait pas de code HTML exploitable." };
    }
    if (isModification && html.trim() === currentHtml.trim()) {
      return { updated: false, error: 'Aucun changement détecté : le code généré est identique au code actuel.' };
    }
    // Cohérence avec le flux streaming : si l'IA renvoie des fragments, on les
    // enveloppe dans le shell complet avant sauvegarde et renvoi au client.
    // É52 — un éventuel bloc DNA résiduel est retiré du HTML sauvegardé.
    const finalHtml = /<!DOCTYPE|<html[\s>]/i.test(html)
      ? extractDesignDna(html).cleaned
      : buildStudioShell(extractDesignDna(html).cleaned);
    // É50 — garde-fou d'exfiltration : même contrôle déterministe que le flux
    // streaming, exécuté à la frontière de persistance de ce second chemin
    // d'écriture (/turns via regenerateFileForPlan). Refus par défaut :
    // aucune écriture si un canal de transmission réseau non autorisé est
    // détecté dans le HTML final candidat.
    const exfiltrationReport = runExfiltrationGuard(finalHtml, entryFile);
    logger.info('Garde-fou exfiltration exécuté sur le HTML candidat (/turns)', {
      component: 'conversation-route',
      tenantId,
      projectId,
      path: entryFile,
      verdict: exfiltrationReport.verdict,
      blockers: exfiltrationReport.blockers.length,
      warnings: exfiltrationReport.warnings.length,
      contentHash: exfiltrationReport.contentHash
    });
    if (!exfiltrationReport.passed) {
      const reason = describeExfiltrationBlocker(exfiltrationReport);
      logger.warn('Garde-fou exfiltration refusé : aucune écriture tentée (/turns)', {
        component: 'conversation-route',
        tenantId,
        projectId,
        path: entryFile,
        blockers: exfiltrationReport.blockers
      });
      return { updated: false, error: reason };
    }
    // É53 LOT E4.1 — CORRECTION A : résultat TARDIF — si l'abandon a gagné
    // pendant l'appel, AUCUNE écriture n'est tentée (jamais de mutation
    // post-annulation, jamais de contenu que le client ne verra jamais).
    if (signal?.aborted === true) {
      return { updated: false, error: 'client_gone' };
    }
    fileStore.saveFile(tenantId, projectId, entryFile, finalHtml);
    return { updated: true, content: finalHtml };
  } catch (error) {
    // É53 LOT E4.1 — CORRECTION A : un abandon demandé par l'appelant
    // (déconnexion client) n'est JAMAIS un échec LLM ordinaire : issue
    // honnête, jamais un faux message d'erreur présenté à l'utilisateur.
    if (signal?.aborted === true) {
      return { updated: false, error: 'client_gone' };
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Échec de la régénération réelle du fichier après exécution du plan", {
      component: 'conversation-route',
      tenantId,
      projectId,
      error: message
    });
    return { updated: false, error: message };
  }
}

/**
 * CLOTURE-LLM — synthèse de fin rédigée (2 à 3 phrases) + suggestions
 * contextuelles. Un seul appel court, émis APRÈS la frame « done » (le preview
 * n'attend pas). Toute erreur (timeout, JSON invalide, fournisseur absent)
 * retourne null : le texte déterministe reste alors affiché.
 */
export interface ClosingFacts {
  request: string;
  mode: 'create' | 'modify';
  sections: Array<{ name: string; mode: string }>;
  gateScore: number | null;
  findings: string[];
  siteContent?: { title: string; description: string; headings: string[] };
}

/** LOT CONVERS-CHIPS — ce que le site contient VRAIMENT (le voile levé de
 *  l'appel de clôture) : titre, meta description et premières rubriques
 *  h1-h3. Sans cela, le LLM de clôture ne connaît pas la demande et propose
 *  des puces méta génériques (palette / responsive) inutiles à l'utilisateur. */
export function extractSiteContent(html: string): { title: string; description: string; headings: string[] } {
  if (!html) return { title: '', description: '', headings: [] };
  const titleMatch = /<title[^>]*>([^<]{1,140})<\/title>/i.exec(html);
  const title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  let description = '';
  const descMatch = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']{1,220})["']/i.exec(html);
  if (descMatch && descMatch[1]) description = descMatch[1].replace(/\s+/g, ' ').trim();
  const headings: string[] = [];
  const re = /<h[1-3][^>]*>([\s\S]{1,160}?)<\/h[1-3]>/gi;
  let match: RegExpExecArray | null;
  let guard = 0;
  while ((match = re.exec(html)) !== null && headings.length < 12 && guard < 60) {
    guard++;
    const rawHeading = match[1];
    if (!rawHeading) continue;
    const text = rawHeading.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && !headings.includes(text)) headings.push(text);
  }
  return { title, description, headings };
}

export function describeSiteContent(site: { title: string; description: string; headings: string[] }): string {
  const lines: string[] = [];
  if (site.title) lines.push('Titre du site : ' + site.title);
  if (site.description) lines.push('Description annoncée : ' + site.description);
  if (site.headings.length) lines.push('Rubriques réellement présentes : ' + site.headings.join(' | '));
  return lines.join('\n');
}

const CLOSING_SYSTEM_PROMPT =
  "Tu es le Lead Engineer IA de VibeCode Studio. Tu viens de terminer un travail sur le site de l'utilisateur et tu lui parles en français, avec un ton chaleureux et concret.\n" +
  'Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte autour : {"summary": "...", "suggestions": ["...", "...", "..."], "tip": "..."}\n' +
  "- summary : 2 à 3 phrases. Dis ce que tu as fait et ce que ça change pour le site. Si les constats de qualité révèlent un vrai point faible, signale-le honnêtement en une phrase. N'écris AUCUN chiffre (sections, lignes, score) : ils sont déjà affichés ailleurs.\n" +
  "- suggestions : exactement 3 actions courtes (3 à 7 mots), à l'impératif, que tu peux exécuter immédiatement. Chacune doit nommer un élément RÉEL du site fourni. Aucun doublon avec ce qui vient d'être fait.\n" +
  "- tip : UNE seule astuce d'usage (moins de 110 caractères, à l'impératif) pour aider l'utilisateur à exploiter immédiatement ce que tu viens de faire, liée à un élément RÉEL du site fourni. Laisse une chaîne vide si rien de pertinent.\n" +
  "- LOT CONVERS-CHIPS — les suggestions DOIVENT nommer un élément RÉEL de CE site (une rubrique, un plat du menu, un service, un pont de réservation, un témoignage…) à partir du contenu du site fourni. INTERDIT de proposer des méta-actions génériques (palette de couleurs, responsive, SEO, mode sombre…) sauf si l'utilisateur les a demandées.";

export function buildClosingUserPrompt(facts: ClosingFacts): string {
  const lines: string[] = [];
  lines.push("Demande de l'utilisateur : « " + facts.request.replace(/\s+/g, ' ').trim().slice(0, 400) + ' »');
  lines.push('Travail effectué : ' + (facts.mode === 'modify' ? "modification d'un site existant" : "création d'un nouveau site"));
  if (facts.siteContent) {
    const described = describeSiteContent(facts.siteContent);
    if (described) lines.push('Contenu RÉEL du site préparé :\n' + described);
  }
  if (facts.sections.length) {
    lines.push('Sections touchées : ' + facts.sections.map((s) => s.name + ' (' + s.mode + ')').join(', '));
  }
  if (facts.gateScore !== null) lines.push('Contrôle qualité du rendu : ' + facts.gateScore + '/100');
  if (facts.findings.length) lines.push('Constats : ' + facts.findings.join(' ; '));
  return lines.join('\n');
}

export function parseClosingJson(raw: string): { summary: string; suggestions: string[]; tip?: string } | null {
  if (typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  const summary = typeof rec['summary'] === 'string' ? (rec['summary'] as string).replace(/\s+/g, ' ').trim() : '';
  if (summary.length < 20 || summary.length > 700) return null;
  const seen = new Set<string>();
  const suggestions: string[] = [];
  const rawList = rec['suggestions'];
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (typeof item !== 'string') continue;
      const s = item.replace(/\s+/g, ' ').trim();
      if (s.length < 3 || s.length > 70 || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      suggestions.push(s);
      if (suggestions.length === 3) break;
    }
  }
  // LOT CONVERS-TIP — champ optionnel et tolérant : absent, trop court ou
  // trop long ⇒ La clé disparaît du résultat (rétrocompatibilité : les
  // anciens payloads sans tip gardent leur forme exacte).
  const tipRaw = typeof rec['tip'] === 'string' ? (rec['tip'] as string).replace(/\s+/g, ' ').trim() : '';
  const tip = tipRaw.length >= 10 && tipRaw.length <= 200 ? tipRaw : '';
  return tip ? { summary, suggestions, tip } : { summary, suggestions };
}

export async function generateClosing(
  ask: (systemPrompt: string, userPrompt: string) => Promise<string>,
  facts: ClosingFacts,
  timeoutMs = 20000
): Promise<{ summary: string; suggestions: string[]; tip?: string } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      ask(CLOSING_SYSTEM_PROMPT, buildClosingUserPrompt(facts)),
      new Promise<string>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('closing timeout')), timeoutMs);
      })
    ]);
    return parseClosingJson(raw);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function handleConversationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix) || !pathname.includes('/conversation')) {
    return false;
  }

  const afterPrefix = pathname.substring(prefix.length);
  const parts = afterPrefix.split('/');
  const projectId = parts[0];
  const subRoute = parts[1]; // 'conversation'
  const subResource = parts[2]; // 'sessions' | 'memory'
  const sessionId = parts[3];
  const action = parts[4]; // 'turns' | 'confirm' | 'execute'

  // ÉTAPE 5 — la mémoire projet vit à /conversation/memory (PAS sous
  // /sessions) : sans cette branche, le parseur rejetait la route et le
  // Studio recevait un 404 générique alors que la mémoire existait.
  const isMemoryRoute = subResource === 'memory' && !sessionId;

  if (!projectId || subRoute !== 'conversation' || (subResource !== 'sessions' && !isMemoryRoute)) {
    return false;
  }

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    throw new NotFoundError(`Projet ${projectId}`, requestId);
  }

  // POST /api/v1/projects/:projectId/conversation/sessions -> créer une session
  if (!sessionId && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const session = conversationIntelligenceService.createSession(
      { tenantId: context.tenantId, projectId },
      context.role,
      requestId
    );
    sendJson(res, 201, { session, requestId });
    return true;
  }

  // GET /api/v1/projects/:projectId/conversation/memory -> mémoire projet réelle (ÉTAPE 5)
  if (isMemoryRoute && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const memory = conversationIntelligenceService.getLatestProjectMemory(context.tenantId, projectId, context.role, requestId);
    if (!memory) {
      sendJson(res, 404, { message: 'Aucune mémoire de conversation pour ce projet (aucune session enregistrée).', requestId });
      return true;
    }
    sendJson(res, 200, { memory, requestId });
    return true;
  }

  // GET /api/v1/projects/:projectId/conversation/sessions/:sessionId -> lire une session
  if (sessionId && !action && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const session = conversationIntelligenceService.getSession(context.tenantId, projectId, sessionId, context.role, requestId);
    if (!session) {
      throw new NotFoundError(`Session de conversation ${sessionId}`, requestId);
    }
    sendJson(res, 200, { session, requestId });
    return true;
  }

  // POST /api/v1/projects/:projectId/conversation/sessions/:sessionId/turns -> envoyer un message
  if (sessionId && action === 'turns' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await parseJsonBody<{ message?: string; autoConfirmLowRisk?: boolean }>(req, requestId);
    if (!body.message) {
      throw new ValidationError('Le champ "message" est obligatoire', undefined, requestId);
    }
    const result = await conversationIntelligenceService.processTurn(
      {
        tenantId: context.tenantId,
        projectId,
        sessionId,
        message: body.message,
        autoConfirmLowRisk: body.autoConfirmLowRisk
      },
      context.role,
      requestId
    );
    sendJson(res, 200, { ...result, requestId });
    return true;
  }

  // POST /api/v1/projects/:projectId/conversation/sessions/:sessionId/confirm -> approuver/rejeter un plan
  if (sessionId && action === 'confirm' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await parseJsonBody<{ planId?: string; approved?: boolean }>(req, requestId);
    if (!body.planId || typeof body.approved !== 'boolean') {
      throw new ValidationError('Les champs "planId" et "approved" sont obligatoires', undefined, requestId);
    }
    const session = await conversationIntelligenceService.confirmPlan(
      { tenantId: context.tenantId, projectId, sessionId, planId: body.planId, approved: body.approved },
      context.role,
      requestId
    );
    sendJson(res, 200, { session, requestId });
    return true;
  }

  // CDC §16 — CONFIRMATION INTERACTIVE DES HYPOTHÈSES (audit moteurs, 04/11).
  // POST /api/v1/projects/:projectId/conversation/sessions/:sessionId/assumptions
  // → verdicts opérateur (CONFIRMED | REJECTED). Le verdict vit sur la session
  // (activeAssumptions) et, pour les CONFIRMED, le libellé rejoint la mémoire
  // projet (knownConventions) — consommée par deriveAssumptions et le contexte
  // des agents. Batch supporté (un POST pour toute la liste d'un tour).
  if (sessionId && action === 'assumptions' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await parseJsonBody<{
      verdicts?: Array<{
        id?: unknown;
        statement?: unknown;
        verdict?: unknown;
        confidence?: unknown;
        evidence?: unknown;
        risk?: unknown;
        reversible?: unknown;
      }>;
    }>(req, requestId);
    const raw = Array.isArray(body.verdicts) ? body.verdicts : [];
    const invalid = raw.filter(
      (v) =>
        !v ||
        typeof v.id !== 'string' ||
        v.id.trim().length === 0 ||
        typeof v.statement !== 'string' ||
        v.statement.trim().length === 0 ||
        (v.verdict !== 'CONFIRMED' && v.verdict !== 'REJECTED')
    );
    if (raw.length === 0 || invalid.length > 0) {
      throw new ValidationError(
        'Chaque verdict requiert {id, statement, verdict: "CONFIRMED" | "REJECTED"}',
        undefined,
        requestId
      );
    }
    const session = conversationIntelligenceService.recordAssumptionVerdicts({
      tenantId: context.tenantId,
      projectId,
      sessionId,
      verdicts: raw.map((v) => ({
        id: v.id as string,
        statement: v.statement as string,
        verdict: v.verdict as 'CONFIRMED' | 'REJECTED',
        confidence: typeof v.confidence === 'number' ? v.confidence : undefined,
        evidence: typeof v.evidence === 'string' ? v.evidence : undefined,
        risk: v.risk === 'LOW' || v.risk === 'MEDIUM' || v.risk === 'HIGH' ? v.risk : undefined,
        reversible: typeof v.reversible === 'boolean' ? v.reversible : undefined
      })),
      userRole: context.role,
      requestId
    });
    if (!session) {
      throw new NotFoundError(`Session de conversation ${sessionId}`, requestId);
    }
    sendJson(res, 200, {
      activeAssumptions: session.activeAssumptions,
      knownConventions: session.projectMemory.knownConventions,
      requestId
    });
    return true;
  }

  // GET /api/v1/projects/:projectId/conversation/sessions/:sessionId/assumptions
  // → lecture des hypothèses actives de la session (statuts opérateur inclus).
  if (sessionId && action === 'assumptions' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const session = conversationIntelligenceService.getSession(
      context.tenantId,
      projectId,
      sessionId,
      context.role,
      requestId
    );
    if (!session) {
      throw new NotFoundError(`Session de conversation ${sessionId}`, requestId);
    }
    sendJson(res, 200, { activeAssumptions: session.activeAssumptions, requestId });
    return true;
  }

  // POST /api/v1/projects/:projectId/conversation/sessions/:sessionId/back
  // → RETOUR ARRIÈRE (CDC §11) : annule le dernier tour par le VRAI moteur
  // (ConversationCompass : l'état conversationnel est restauré, la trace du
  // tour annulé est conservée). Avant, rollbackLastTurn existait et était
  // testé mais n'était exposé par AUCUNE route.
  if (sessionId && action === 'back' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const session = conversationIntelligenceService.rollbackLastTurn(
      { tenantId: context.tenantId, projectId, sessionId },
      context.role,
      requestId
    );
    sendJson(res, 200, { session, requestId });
    return true;
  }

  // POST /api/v1/projects/:projectId/conversation/sessions/:sessionId/execute -> exécuter le plan approuvé
  if (sessionId && action === 'execute' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await parseJsonBody<{ entryFile?: string }>(req, requestId);

    // É53 LOT E4.1 — CORRECTION A : contrôleur de REQUÊTE (PAS un tour
    // E1/E2 : /execute n'a ni executionId ni route cancel). Seule source
    // d'annulation honnête : la DÉCONNEXION CLIENT — armé tant que la
    // réponse n'est pas terminée ; jamais par un refus ; jamais partagé
    // avec un autre tour (créé ici, portée de la requête) ; distinct des
    // timeouts techniques des adapters (source 'timeout' vs 'external').
    // Le listener est retiré avant la réponse (chemin normal) ET sur toute
    // sortie exception (finally E4.2 F3 — retrait garanti, plus de no-op
    // résiduel après exception).
    const executeAbortController = new AbortController();
    const onExecuteGone = (): void => {
      if (!res.writableEnded) executeAbortController.abort();
    };
    res.once('close', onExecuteGone);

    // É53 LOT E4.2 — CORRECTION F3 (audit G4) : retrait GARANTI du listener
    // sur TOUTE sortie de ce bloc (finally ci-dessous) — y compris une
    // exception levée par executeApprovedPlan (avant : retrait uniquement
    // sur le chemin normal). Le signal reste armé tant que la réponse n'est
    // pas terminée (déconnexion pendant la régénération signalée → abort,
    // inchangé) ; le retrait d'un listener déjà détaché est un no-op Node
    // (aucun double nettoyage dangereux) ; aucun contrat E4.1 modifié.
    try {
      const result = await conversationIntelligenceService.executeApprovedPlan(
        { tenantId: context.tenantId, projectId, sessionId },
        context.role,
        requestId,
        undefined,
        executeAbortController.signal
      );

      // Étape concrète qui manquait : régénérer et enregistrer réellement le
      // fichier du projet, pas seulement marquer le plan comme "exécuté".
      // Renforcé après un signalement utilisateur : fileUpdate doit TOUJOURS
      // contenir un message précis, jamais rester vide ni tomber sur un texte
      // générique côté client qui masquerait la vraie cause.
      let fileUpdate: { updated: boolean; content?: string; error?: string };
      try {
        if (!result.executionResult.success) {
          fileUpdate = {
            updated: false,
            error: `L'exécution du plan par le moteur conversationnel a échoué : ${result.executionResult.message || 'raison inconnue'}`
          };
        } else if (!result.session.activePlan) {
          fileUpdate = {
            updated: false,
            error: "Aucun plan actif trouvé sur la session au moment de la régénération (le plan a peut-être déjà été traité ou la session a expiré)."
          };
        } else {
          const lastTurn = result.session.turns[result.session.turns.length - 1];
          const userMessage = lastTurn?.userMessage.content || result.session.activePlan.summary;
          const clientApiKeyHeader = req.headers['x-mistral-api-key'];
          const clientApiKey = typeof clientApiKeyHeader === 'string' && clientApiKeyHeader.trim().length > 0
            ? clientApiKeyHeader.trim()
            : undefined;
          fileUpdate = await regenerateFileForPlan(
            context.tenantId,
            projectId,
            result.session.activePlan,
            userMessage,
            body.entryFile || 'index.html',
            clientApiKey,
            executeAbortController.signal
          );
        }
      } catch (error) {
        // Filet de sécurité absolu : même une erreur totalement inattendue ici
        // (jamais anticipée) doit produire un message exploitable plutôt que de
        // faire planter la requête ou de laisser fileUpdate vide.
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("Erreur inattendue lors de la régénération après exécution du plan", {
          component: 'conversation-route',
          tenantId: context.tenantId,
          projectId,
          error: message
        });
        fileUpdate = { updated: false, error: `Erreur inattendue côté serveur : ${message}` };
      }

      // É50 — si la régénération n'a pas réécrit le fichier (échec LLM, HTML
      // identique, etc.), le HTML PERSISTÉ par l'agent routé reste la version
      // livrée au Studio. Le même garde-fou s'applique à ce contenu effectif
      // avant de le présenter : détection + trace d'audit, message honnête.
      // (Quand updated === true, le candidat écrit a déjà été contrôlé par le
      // garde-fou à l'intérieur de regenerateFileForPlan.)
      if (fileUpdate.updated === false) {
        try {
          const execEntryFile = body.entryFile || 'index.html';
          const persistedFile = fileStore.getFile(context.tenantId, projectId, execEntryFile);
          const persistedHtml = persistedFile && typeof persistedFile.content === 'string' ? persistedFile.content : '';
          if (persistedHtml.trim().length > 100) {
            const postExecScan = runExfiltrationGuard(persistedHtml, execEntryFile);
            if (!postExecScan.passed) {
              logger.warn('Garde-fou exfiltration : contenu persisté par agent refusé (/execute)', {
                component: 'conversation-route',
                tenantId: context.tenantId,
                projectId,
                path: execEntryFile,
                blockers: postExecScan.blockers
              });
              const priorCause = fileUpdate.error ? ` (régénération interrompue : ${fileUpdate.error})` : '';
              fileUpdate = { updated: false, error: `${describeExfiltrationBlocker(postExecScan)}${priorCause}` };
            }
          }
        } catch (postScanErr) {
          logger.warn('Scan post-exécution du contenu persisté impossible (non bloquant)', {
            component: 'conversation-route',
            projectId,
            error: postScanErr instanceof Error ? postScanErr.message : String(postScanErr)
          });
        }
      }

      sendJson(res, 200, { ...result, fileUpdate, requestId });
      return true;
    } finally {
      res.off('close', onExecuteGone);
    }
  }

  // =====================================================================
  // STREAMING — POST /api/v1/projects/:id/conversation/sessions/:sid/stream
  // ---------------------------------------------------------------------
  // Variante streaming de /turns. Au lieu de retourner un JSON synchrone
  // après 5-13s d'attente, on ouvre une connexion SSE (Server-Sent Events)
  // et on stream les tokens du LLM Mistral en temps réel vers le Studio.
  //
  // Le Studio boucle sur les events SSE et affiche les tokens au fur et à
  // mesure dans le chat (effet machine à écrire, comme Cursor / v0).
  //
  // À la fin, le serveur extrait le bloc ```html``` du texte complet, le
  // sauvegarde via fileStore, et envoie un event final avec le HTML.
  // =====================================================================
  if (sessionId && action === 'stream' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await parseJsonBody<{ message?: string; isModification?: boolean; planFirst?: boolean; confirmedPlan?: boolean }>(req, requestId);
    if (!body.message) {
      throw new ValidationError('Le champ "message" est obligatoire', undefined, requestId);
    }

    // Headers SSE
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Désactive buffering nginx

    // Déconnexion client : si l'utilisateur ferme l'onglet ou annule, on coupe
    // la consommation du stream LLM (sinon on continue de facturer des tokens
    // jusqu'à 120 s pour un socket mort) et on cesse d'écrire sur la réponse.
    let clientGone = false;
    // É53 LOT E3 — CORRECTION A : AbortController PAR EXÉCUTION /stream.
    // Un signal unique est associé au cycle de vie du tour ; il est transmis
    // jusqu'au transport HTTP réellement utilisé par l'adapter streaming
    // (`generateStream({ ..., signal })`). Déclenchements autorisés :
    //   - annulation UTILISATEUR ACCEPTÉE (la route POST cancel pose le
    //     drapeau `cancelled` — après son refus CAS B : jamais l'inverse) ;
    //   - déconnexion CLIENT tant que la réponse n'est pas terminée.
    // Jamais déclenché par un refus (CAS B) ; jamais partagé avec un autre
    // tour (créé ici, dans la portée de la requête) ; distinct des timeouts
    // techniques internes des adapters (source 'timeout' vs 'external').
    const turnAbortController = new AbortController();
    let turnAbortReason: 'user_cancel' | 'client_disconnect' | null = null;
    const abortTurn = (reason: 'user_cancel' | 'client_disconnect'): void => {
      if (turnAbortController.signal.aborted) return;
      turnAbortReason = reason;
      turnAbortController.abort();
    };
    const turnAbortedAs = (reason: 'user_cancel' | 'client_disconnect'): boolean =>
      turnAbortController.signal.aborted && turnAbortReason === reason;
    req.on('close', () => {
      clientGone = true;
    });
    // É53 LOT E3 — CORRECTION A : la DÉCONNEXION CLIENT est détectée sur la
    // ServerResponse (`res.on('close')`). Le corps de la requête POST est
    // consommé (`parseJsonBody`) AVANT l'attachement du listener sur `req` :
    // l'événement 'close' du message est déjà passé et ne détecte jamais la
    // déconnexion. Sur la réponse : en fin NORMALE, `writableEnded` est
    // déjà true (aucun abandon) ; en cas de socket détruit par le client,
    // l'abandon du transport LLM est armé immédiatement.
    res.on('close', () => {
      // É53 LOT E3 — déconnexion client : interruption RÉELLE du transport
      // LLM (coupe le socket vers le fournisseur), pas seulement la
      // consommation. Si la réponse s'est terminée normalement, l'abandon
      // n'a plus d'objet (aucun travail LLM en cours) : on n'abandonne pas.
      if (!res.writableEnded) abortTurn('client_disconnect');
    });

    // Fonction helper pour envoyer un event SSE formaté
    const sendSSE = (data: Record<string, unknown>): void => {
      if (clientGone) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Récupère le projet + fichier existant pour déterminer si modif ou création
    const existing = fileStore.getFile(context.tenantId, projectId, 'index.html');
    const currentHtml = existing?.content || '';
    // LOT CLARIF-RESUME — lit et CONSOMME une clarification en attente (TTL
    // 10 min) : CE message devient la RÉPONSE à la question posée. Consommé
    // dès la lecture ; une re-clarification repose sa propre marque, un
    // flux qui échoue ensuite ne ré-arme pas la question. Toute erreur de
    // lecture conserve le comportement à froid (jamais bloquant).
    let clarifResume: { question: string; mode: 'create' | 'modify' } | undefined;
    try {
      const pendSession = conversationIntelligenceService.getSession(context.tenantId, projectId, sessionId, context.role, requestId);
      const pend = pendSession?.pendingClarification;
      if (pend && (Date.now() - pend.questionAskedAt) < 10 * 60 * 1000) {
        clarifResume = { question: pend.question, mode: pend.mode };
        conversationIntelligenceService.clearPendingClarification({
          tenantId: context.tenantId,
          projectId,
          sessionId,
          userRole: context.role,
          requestId
        });
        logger.info('CLARIF-RESUME : réponse consumée', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          mode: pend.mode
        });
      }
    } catch (resumeError) {
      logger.warn('CLARIF-RESUME : marque illisible (comportement à froid conservé)', {
        component: 'conversation-route-stream',
        tenantId: context.tenantId,
        error: resumeError instanceof Error ? resumeError.message : String(resumeError)
      });
    }
    // Le mode suit la QUESTION posée : une réponse à « modifier ou créer ? »
    // sur un projet avec site est une MODIFICATION, jamais une création.
    const isModification = (body.isModification ?? (currentHtml.trim().length > 200)) || clarifResume?.mode === 'modify';

    // P0 IMAGES — thème visuel détecté côté serveur (demande + titre de page
    // en contexte) : le LLM n'est plus l'unique source du thème. Servi aux
    // deux prompts (brief par section) et au log de traçabilité final.
    const titleHint = pageTitleHint(currentHtml);
    const imageTheme: ImageTheme = detectImageTheme(body.message || '', titleHint);
    // LOT MÉTIERS (30/10) — sujet métier résolu pour le long tail :
    // 'autre' + métier reconnu par le lexique sectoriel → directive SUJET
    // IMPOSÉ dans le brief (pool neutre remplacé). Thèmes mappés et
    // chemin dynamic (clé usager) : aucune incidence.
    const imageSubject = resolveImageSubject(imageTheme, body.message || '', titleHint);
    // PATCH PERTINENCE — seed de rotation déterministe : UNE valeur pour
    // toute la génération (briefs, sanitize, replis onerror) — cohérence
    // intra-génération garantie, variation seulement entre générations.
    const imageSeed = poolRotationSeed(requestId);

    // LOT UNSPLASH-DYN — clé usager fournie (carte Réglages → API) : UNE
    // recherche réelle par exécution (thème → requête métier). Les photos
    // adoptées servent au BRIEF (le LLM propose les vraies photos) puis au
    // sanitizer (conformité). Sans clé ou en échec : zéro changement, la
    // réserve déterministe reste la vérité. Jamais la clé dans les logs.
    const unsplashKeyRaw = req.headers['x-unsplash-api-key'];
    const unsplashApiKey = typeof unsplashKeyRaw === 'string' ? unsplashKeyRaw.trim() : '';
    let dynamicImages: DynamicImageAdoption | undefined;
    if (unsplashApiKey.length > 0) {
      // SECTEUR-LIBRE : sujet non mappé ('autre') → requête DÉRIVÉE de la
      // demande (« caserne de pompier » → firefighter fire station…) au lieu
      // de la requête générique ; thème mappé = requête du thème, inchangé.
      const searchSpec = resolveDynamicSearchQuery(imageTheme, body.message || '', titleHint);
      const searchStartedAt = Date.now();
      try {
        const photos = await searchThemedUnsplashPhotos({
          query: searchSpec.query,
          count: 10,
          apiKey: unsplashApiKey,
          timeoutMs: UNSPLASH_SEARCH_TIMEOUT_MS,
        });
        if (photos.length > 0) {
          dynamicImages = {
            dynamicIds: new Set(photos.map((photo) => photo.id)),
            dynamicUrls: photos.map((photo) => photo.url),
          };
          // LOT UNSPLASH-DYN (suite) — journal d'adoptions : ces photo-IDs
          // réellement fetchés deviennent CONFORMES pour les portes d'écriture
          // (édition, rollback, insertion) au même titre que le réservoir.
          // Best-effort : une écriture en échec ne bloque JAMAIS la génération
          // (mais les flux Studio refuseront alors ce HTML — cas journalisé).
          try {
            const adopted = recordAdoptedImageIds(photos.map((photo) => photo.id));
            logger.info('Journal d adoptions images : inscription', {
              component: 'conversation-route-stream',
              imageTheme,
              adopted,
            });
          } catch (error) {
            logger.warn('Journal d adoptions images : ecriture impossible — les flux Studio refuseront ce HTML', {
              component: 'conversation-route-stream',
              imageTheme,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        logger.info('Unsplash dynamique : recherche réelle', {
          component: 'conversation-route-stream',
          imageTheme,
          query: searchSpec.query,
          derived: searchSpec.derived,
          found: photos.length,
          ms: Date.now() - searchStartedAt,
        });
      } catch (error) {
        logger.warn('Unsplash dynamique indisponible : réserve déterministe', {
          component: 'conversation-route-stream',
          imageTheme,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // EXECUTION TRANSPARENCY : une exécution = un requestId. Toutes les frames
    // « milestone » passent par `emit` (enrichies executionId/seq/phase/status)
    // et les événements correspondants sont persistés dans executionStore.
    const executionId = requestId;
    let recorder: ExecutionRecorder | null = null;
    // Durée réelle de l'exécution (CDC §26 : jamais de durée inventée)
    const streamStartedAt = Date.now();
    // T5 (CDC §20) — annulation utilisateur réelle : la route cancel retourne
    // ce drapeau ; la boucle LLM le vérifie à chaque chunk et s'arrête net.
    // É53 LOT E2 — le drapeau porte AUSSI la preuve locale du CAS B
    // (`persistenceVerified`, posée quand la lecture à rebours confirme
    // l'écriture) : en télémétrie OFF il n'existe aucun record, la route
    // POST cancel consulte donc CETTE preuve pour refuser honnêtement une
    // annulation arrivée après une mutation déjà validée — la sémantique de
    // l'arbitrage est identique dans les deux modes.
    //
    // É53 LOT E3 — CORRECTION A : `cancelled` est un ACCESSEUR. Le seul
    // écrivain est la route POST /executions/:id/cancel (executions.ts,
    // GELÉ E2), qui pose le drapeau APRÈS avoir refusé le CAS B
    // (`hasPersistenceWon` / `persistenceVerified`) : une annulation refusée
    // ne pose jamais le drapeau, donc n'abandonne jamais le transport.
    // Une annulation ACCEPTÉE arme immédiatement l'abandon du transport LLM
    // (`abortTurn('user_cancel')`) — la génération distante est coupée en
    // plein appel, même si la boucle LLM est suspendue sur `reader.read()`.
    // L'issue du tour reste ensuite l'arbitrage E1 (`cancelInterrupted`,
    // GELÉ E2) : claim atomique + frame ⏹ unique, inchangés.
    let cancelFlagCancelled = false;
    const cancelFlag: { cancelled: boolean; persistenceVerified?: boolean } = {
      get cancelled(): boolean {
        return cancelFlagCancelled;
      },
      set cancelled(value: boolean) {
        cancelFlagCancelled = value;
        // CAS B ne passe JAMAIS ici (la route refuse avant de poser le
        // drapeau). Si le client s'est déjà déconnecté, l'abandon a déjà été
        // armé avec la raison 'client_disconnect' : le guard d'abortTurn
        // préserve la raison honnête la plus ancienne.
        if (value) abortTurn('user_cancel');
      }
    };
    // É53 LOT E1 — la frame ⏹ n'est jamais émise deux fois pour un tour.
    let cancelFrameEmitted = false;
    // É53 LOT E2 — faits locaux de persistance, déclarés TÔT pour que le
    // contrôle centralisé ci-dessous puisse y lire la preuve d'écriture
    // (utile en télémétrie OFF, où le store ne porte pas l'arbitrage E1).
    let attemptedPersistence = false;
    let mutationApplied = false;
    let fallbackWritten = false;
    let persistedVerified = false;
    // É53 LOT E2 — CORRECTION A : point de contrôle CENTRALISÉ de l'annulation.
    // UNE seule logique de décision pour toute la route /stream — elle consomme
    // l'arbitrage E1 (`cancelExecution` = point de linéarisation atomique du
    // ExecutionEventStore, jamais réimplémenté ni doublonné), garantit que la
    // frame ⏹ n'est jamais dupliquée, et refuse d'interrompre une mutation
    // déjà validée :
    //   - annulation gagnante (CAS A) → true : la progression s'arrête NET,
    //     aucun done/closing/error « résultat normal » ne suivra ;
    //   - persistance déjà gagnée (CAS B — arbitrage E1, ou preuve locale
    //     d'écriture vérifiée en télémétrie OFF) → false : le tour suit sa
    //     vérité réelle, sans interruption artificielle.
    const cancelInterrupted = (): boolean => {
      if (clientGone || !cancelFlag.cancelled) return false;
      if (executionStore.hasPersistenceWon(executionId)) return false;
      if (!recorder && persistedVerified) return false;
      const claimWon = recorder
        ? executionStore.cancelExecution(executionId, 'user_cancel')
        : true;
      if (!claimWon) return false;
      if (!cancelFrameEmitted) {
        cancelFrameEmitted = true;
        sendSSE({ type: 'cancelled' });
      }
      return true;
    };
    if (executionTimelineEnabled) {
      executionStore.startExecution({
        executionId,
        tenantId: context.tenantId,
        projectId,
        mode: isModification ? 'modify' : 'create',
        prompt: body.message || ''
      });
      recorder = new ExecutionRecorder(executionStore, executionId, sendSSE);
    }
    // É53 LOT E2 — CORRECTION B : l'annulation est un CONTRÔLE d'exécution,
    // pas de la télémétrie. Le drapeau est enregistré SANS condition : même
    // quand VOLACO_EXECUTION_TIMELINE=off (aucun record, aucune timeline),
    // le POST /executions/:id/cancel trouve le drapeau et la route honore
    // l'arrêt. Désactiver la collecte ne désactive jamais un contrôle.
    activeCancelFlags.set(executionId, cancelFlag);
    // É53 LOT E2 — CORRECTION B (suite) : hors télémétrie, les frames nues ne
    // portent pas d'executionId (l'enrichissement vient du recorder) — le
    // client ne pourrait JAMAIS savoir quoi annuler. L'id est donc porté
    // explicitement par la frame `start` plus bas (redondant avec
    // l'enrichissement recorder quand il est actif, strictement nécessaire
    // sinon).
    // BLOC 1 — flag pour éviter boucle infinie de retry gate
    let gateRetryAttempted = false;
    /** Frame SSE enrichie ; enregistre l'événement quand il est fourni. */
    const emit = (data: Record<string, unknown>, event?: RecordableEvent): void => {
      if (recorder) recorder.frame(data, event);
      else sendSSE(data);
    };
    /** Événement persisté sans frame SSE dédiée (l'UI le découvrira au replay). */
    const recordOnly = (event: RecordableEvent): void => {
      if (recorder) executionStore.appendEvent(executionId, event);
    };
    // P2-SIGNAUX — frame SSE nommée : ligne `event:` (standard SSE, ignorée
    // par les parseurs qui ne lisent que `data:`) + JSON `data:` portant le
    // même nom en `type` (compatible parseur Studio actuel, qui ignore les
    // types inconnus). Le handshake reste lisible même sans `data:`.
    const emitNamed = (name: string, payload: Record<string, unknown>, event?: RecordableEvent): void => {
      if (clientGone) return;
      try {
        res.write(`event: ${name}\n`);
      } catch { /* socket déjà fermé */ }
      emit({ type: name, ...payload }, event);
    };

    // É53 LOT E2 — CORRECTION B : `executionId` explicite sur la frame start
    // (voir commentaire au-dessus de BLOC 1).
    emit({ type: 'start', isModification, executionId }, {
      type: 'EXECUTION_STARTED',
      phase: 'UNDERSTAND',
      status: 'RUNNING',
      title: isModification ? 'Modification de ta page lancée' : 'Génération lancée',
      detail: { mode: isModification ? 'modify' : 'create' }
    });
    // INSPECT : la lecture réelle du fichier existant est traçable (CDC §9-§10)
    // — ET visible en live dans le flux (frame + activity, LOT E).
    if (currentHtml.trim().length > 0) {
      emit({ type: 'file_read' }, {
        type: 'FILE_READ',
        phase: 'INSPECT',
        status: 'COMPLETED',
        title: 'Lecture de index.html',
        detail: { path: 'index.html', chars: currentHtml.length }
      });
    }
    // LOT 3 — Compass complet (§11 CDC) : les 9 états sont émis au fil du flux
    emit({ type: 'compass', state: 'UNDERSTANDING' });

    // LOT 4 — Plan First (§17 CDC) : un plan déterministe est TOUJOURS émis
    // (traçabilité Understand Before Acting), AVANT la sélection du fournisseur
    // — le plan et la confirmation humaine ne dépendent d'aucune clé LLM.
    // En mode planFirst, le flux s'arrête ici et attend la confirmation (§3.9).
    // P2 — INTENTION RÉELLE : le moteur conversationnel (LLM, temp 0,
    // repli regex intégré) remplace la regex 6 catégories. L'intention
    // détermine le plan affiché et les phrases du LLM.
    // É53 LOT E4.1 — CORRECTION B : le signal du tour atteint la
    // classification LLM ; un abandon (annulation acceptée / déconnexion) y
    // est REJETÉ (jamais le repli mots-clés) et l'issue reste l'arbitrage
    // E1/E2 via les catches E3 de la route.
    // É53 LOT E4.1 — CORRECTION B (suite) : cet await est AVANT le try/catch
    // E3 de fin de handler — un AbortError de classification doit sortir par
    // le MÊME arbitrage (sinon il remonte au gestionnaire d'erreurs serveur
    // qui tente un JSON sur une SSE déjà ouverte : ERR_HTTP_HEADERS_SENT,
    // réponse jamais terminée, aucun terminal honnête). Miroir strict des
    // branches du catch E3 : annulation acceptée → cancelInterrupted (claim
    // atomique + ⏹ unique) ; déconnexion → CANCELLED client_gone ; toute
    // autre erreur → rethrow (comportement historique, jamais masqué).
    let realIntent: Awaited<ReturnType<typeof classifyIntent>>;
    try {
      realIntent = await classifyIntent(body.message || '', undefined, context.tenantId, projectId, turnAbortController.signal);
    } catch (classifyErr) {
      const message = classifyErr instanceof Error ? classifyErr.message : String(classifyErr);
      if (turnAbortedAs('user_cancel')) {
        if (cancelInterrupted()) {
          logger.warn('Classification interrompue par une annulation acceptée — terminal ⏹ posé par l arbitrage E1', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId,
            error: message
          });
          activeCancelFlags.delete(executionId);
          res.end();
          return true;
        }
        // Refus du claim (CAS B : la persistance a gagné entre-temps) —
        // l'issue honnête appartient à la persistance : aucune fausse erreur.
        if (executionStore.hasPersistenceWon(executionId) || persistedVerified) {
          logger.warn('Abandon d une classification supplanté par la persistance (CAS B) — terminal de la persistance préservé', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId,
            error: message
          });
          activeCancelFlags.delete(executionId);
          res.end();
          return true;
        }
      } else if (turnAbortedAs('client_disconnect')) {
        // Miroir du catch E3 (client parti pendant la classification) :
        // annulation honnête CANCELLED client_gone, jamais une erreur brute.
        logger.warn('Classification interrompue par une déconnexion client', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          error: message
        });
        if (recorder) executionStore.cancelExecution(executionId, 'client_gone');
        activeCancelFlags.delete(executionId);
        res.end();
        return true;
      }
      throw classifyErr;
    }
    // LOT CLARIF-RESUME — la catégorie suit la QUESTION posée : « une page
    // galerie photo » en réponse à « modifier ou créer ? » est MODIFY (et
    // non CREATE inventé par le repli regex — le piège d'origine du bruit,
    // mais avec des mots porteurs).
    if (clarifResume) {
      const forcedCategory = clarifResume.mode === 'modify' ? 'MODIFY' : 'CREATE';
      if (realIntent.category !== forcedCategory) {
        realIntent = {
          ...realIntent,
          category: forcedCategory,
          confidence: Math.max(realIntent.confidence, 0.5)
        };
        emitNamed('on_intent_classified', {
          category: realIntent.category,
          confidence: realIntent.confidence,
          label: 'Réponse à la question reçue — je reprends...'
        });
      }
    }
    // P2-SIGNAUX — tue le blanc aveugle : l'intention classifiée est annoncée
    // aussitôt (avant plan, fournisseur et génération).
    emitNamed('on_intent_classified', {
      category: realIntent.category,
      confidence: realIntent.confidence,
      label: 'Analyse de la demande terminée...'
    });
    // FIX-QUESTION — une question appelle une réponse, pas une construction.
    // Avant : /stream générait TOUJOURS une page, même pour "explique-moi...".
    // Barrière anti-régression : les demandes de construction polies
    // ("peux-tu ajouter...") contiennent des verbes de build et restent sur
    // le chemin génération ; un isModification explicite du client prime aussi.
    // La réponse part en frames `chat` (affichées dans la conversation), pas
    // en `token` (qui alimente le preview) ; aucun fichier n'est touché.
    const BUILD_VERBS = /créer|crée|ajoute|ajouter|modifie|modifier|change|changer|supprime|supprimer|génère|générer|construis|construire|enlève|enlever|create|add|update|delete|generate|build|fix|corrige|corriges/i;
    // É49-C2 — participe passé = RÉFÉRENCE à l'historique, pas une directive :
    // « Pourquoi as-tu supprimé... ? » contient « supprimé » mais ne demande
    // aucune construction. Formes accentuées uniquement — l'impératif
    // (« supprime », « modifie ») reste un verbe de build.
    // É49-C2 (correctif d'amende, preuve T2 UI) : `\b` JS est basé sur
    // [A-Za-z0-9_] — « é » final n'est PAS un \w, donc `\bé\b` ne matche
    // JAMAIS un participe singulier (« créé », « supprimé », même suivi d'un
    // point), et matche à tort « modifié » À L'INTÉRIEUR de « modifiée ».
    // Frontières lettre-aware (lookaround) : match si le participe est un
    // mot complet au sens unicode. Validé node : singuliers PASS,
    // pluriels PASS (non-régression), impératifs (« supprime », « modifie »)
    // toujours hors référence.
    const BUILD_REFERENCE = /(?<![\p{L}\p{N}])(?:supprimé|supprimée|supprimés|supprimées|modifié|modifiée|modifiés|modifiées|créé|créée|créés|créées|ajouté|ajoutée|ajoutés|ajoutées|généré|générés|changé|changés|enlevé|enlevés|retiré|retirés)(?![\p{L}\p{N}])/iu;
    const wantsAnswerOnly = (realIntent.category === 'QUESTION' || realIntent.category === 'EXPLAIN')
      // É49-C2 — le verrou `body.isModification !== true` est LEVÉ : les DEUX
      // chemins de l'UI (accueil + espace de travail) envoient TOUJOURS
      // isModification:true (preuve réseau É49 : chaque POST /stream porte
      // {"isModification":true}), le flag ne portait donc AUCUNE information
      // et masquait toute demande d'explication. Preuve production É49 (S10) :
      // EXPLAIN@0.9 exécuté en modification destructive (−215 lignes, −35 %
      // du fichier). Le moteur d'intention (LLM temp 0 + repli regex, P2)
      // est l'autorité pour QUESTION/EXPLAIN ; BUILD_VERBS reste la barrière
      // anti-régression pour les directives à l'impératif, sauf participe
      // passé (référence à l'historique).
      && (!BUILD_VERBS.test(body.message || '') || BUILD_REFERENCE.test(body.message || ''))
      // LOT CLARIF-RESUME — pendant une clarification, le message suivant est
      // la RÉPONSE : il agit, il ne re-déclenche pas une réponse-pure.
      && clarifResume === undefined;
    // LOT CONVERS-CLARIFY — la demande qui ne porte AUCUN mot lisible
    // (ex: « crée un site fdfdfdfdf ») obtient une question de clarification
    // au lieu d'un site inventé. Sœur du chemin question (wantsAnswerOnly :
    // frames chat, tour enregistré en mémoire de session, compass
    // COMPLETED, done sans code) — le build ne démarre pas. Le verrou est
    // borné au bruit : une demande vague mais PORTANTE (« crée un site de
    // restaurant ») traverse normalement.
    // LOT CONVERS-CLARIFY-2 — le gate couvre aussi la MODIFICATION :
    // « dfdfdf » sur une page existante a déclenché une modification
    // inventée (titre + bouton) au lieu d'une question. isModification ne
    // prime plus ici : c'est le détecteur de bruit (moteur, borné absence
    // d'entité) qui décide, et le texte de la question suit le mode.
    const incoherentClarif = realIntent.ambiguities.find(a => a.id === 'clarif_incoherent_input');
    if (incoherentClarif) {
      // LOT CLARIF-CTX — la question de clarification suit la VÉRITÉ du
      // pipeline (isModification calculé l.1489 : flag du client OU site
      // réel existant via index.html > 200 car). Avant : elle ne regardait
      // que body.isModification — « DSDSD » sur un projet AVEC un site réel
      // tombait sur la question création (« quel site construire ») et
      // présumait une intention de construction, jamais vérifiée.
      const clarifyText = isModification
        ? `Ta demande n'est pas claire : « ${(body.message || '').trim().slice(0, 60)} » ne me dit rien de précis. Tu veux modifier ton site actuel, ou créer autre chose ? (ex. « change le titre du menu », ou « crée une page galerie photo ») — je m'y mets aussitôt.`
        : `Ta demande n'est pas claire : « ${(body.message || '').trim().slice(0, 60)} » ne me dit pas quel site construire. Précise-moi le type de site (restaurant, portfolio, boutique…), pour qui, et ce qu'il doit faire en premier — je m'y mets aussitôt.`;
      emit({ type: 'chat', text: clarifyText, scripted: true });
      try {
        await conversationIntelligenceService.recordStreamTurn({
          tenantId: context.tenantId,
          projectId,
          sessionId,
          userMessage: body.message || '',
          assistantMessage: clarifyText,
          intent: realIntent,
          durationMs: 0,
          requestId
        });
      } catch (clarifyRecordError) {
        logger.warn('Tour clarification non enregistré (mémoire inchangée)', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          error: clarifyRecordError instanceof Error ? clarifyRecordError.message : String(clarifyRecordError)
        });
      }
      // LOT CLARIF-RESUME — la question est marquée EN ATTENTE : le prochain
      // message de CETTE session sera traité comme la RÉPONSE (mode forcé
      // modify/create, catégorie forcée, réponse-pure by-passée). Écrasé par
      // toute nouvelle clarification ; consommé au premier message suivant.
      try {
        conversationIntelligenceService.setPendingClarification({
          tenantId: context.tenantId,
          projectId,
          sessionId,
          question: clarifyText,
          mode: isModification ? 'modify' : 'create',
          userRole: context.role,
          requestId
        });
      } catch (clarifyMarkError) {
        logger.warn('Marque CLARIF-RESUME non posée (clarify inchangé)', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          error: clarifyMarkError instanceof Error ? clarifyMarkError.message : String(clarifyMarkError)
        });
      }
      emitNamed('on_question_answered', { text: clarifyText });
      emit({ type: 'compass', state: 'COMPLETED' });
      emit({ type: 'done', updated: false });
      // LOT CLARIF-CLOSE — une clarification finalise son exécution. Avant :
      // AUCUN appel de finalisation sur ce chemin — chaque question posée
      // laissait une ligne RUNNING zombie au store (23 recelées, découvertes
      // lors de l'hygiène du 29/10 : de 89 min à 10,5 jours d'ancienneté).
      // Une question posée = un flux COMPLETED (tour enregistré, marque
      // CLARIF-RESUME posée) — pas une exécution sans fin.
      try {
        if (recorder) {
          executionStore.completeExecution(executionId, {});
        }
      } catch (clarifCloseError) {
        logger.warn('Clôture CLARIF-CLOSE non persistée (fin de flux inchangée)', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          error: clarifCloseError instanceof Error ? clarifCloseError.message : String(clarifCloseError)
        });
      }
      activeCancelFlags.delete(executionId);
      res.end();
      return true;
    }

    if (wantsAnswerOnly) {
      const questionStart = Date.now();
      const qAdapter = resolveStreamingAdapter();
      if (!qAdapter || !('generateStream' in qAdapter)) {
        const providerError = "Aucun fournisseur IA streaming disponible (Mistral ou Gemini requis).";
        emit({ type: 'error', error: providerError });
        if (recorder) executionStore.failExecution(executionId, providerError);
        activeCancelFlags.delete(executionId);
        res.end();
        return true;
      }
      const pageExcerpt = currentHtml && currentHtml.trim().length > 0
        ? currentHtml.slice(0, 4000)
        : '(projet vide, aucun fichier)';
      let answer = '';
      // P2-SIGNAUX — même garde anti-freeze que le chemin build.
      const qWaitStart = Date.now();
      let qFirstTokenSeen = false;
      const qWaitTicker = setInterval(() => {
        if (!qFirstTokenSeen && !clientGone) {
          emitNamed('on_provider_waiting', { elapsedMs: Date.now() - qWaitStart });
        }
      }, 2000);
      try {
        // É53 LOT E3 — CORRECTION A : le signal du tour atteint le transport
        // HTTP de l'adapter streaming (annulation acceptée → coupure réelle
        // en plein appel ; déconnexion client → idem).
        // @ts-expect-error — generateStream existe sur les adaptateurs Mistral et Gemini
        const answerStream = qAdapter.generateStream(
          {
            tenantId: context.tenantId,
            projectId,
            prompt: `Question de l'utilisateur : ${body.message}\n\nContexte du projet (extrait index.html) :\n${pageExcerpt}\n\nRéponds directement et de façon concise. Ne génère AUCUN code HTML sauf si l'utilisateur le demande explicitement.`,
            systemPrompt: `Tu es l'assistant conversationnel de VibeCode Studio. Tu réponds en français, de façon concise et utile.`,
            temperature: 0.4,
            maxTokens: 2048,
            timeoutMs: 60000,
            requestId,
            signal: turnAbortController.signal
          },
          resolveStreamCredentials(req, context.tenantId, qAdapter.descriptor.providerId)
        );
        for await (const chunk of answerStream) {
          if (clientGone || cancelFlag.cancelled) break;
          qFirstTokenSeen = true;
          answer += chunk;
          emit({ type: 'chat', text: chunk });
        }
      } catch (answerError) {
        clearInterval(qWaitTicker);
        // É53 LOT E3 — CORRECTION B : un abandon causé par CE tour (annulation
        // utilisateur acceptée / déconnexion client) n'est JAMAIS transformé
        // en erreur LLM ordinaire. L'arbitrage E1 (cancelInterrupted) reste
        // l'autorité de l'issue : claim atomique + frame ⏹ unique.
        if (turnAbortedAs('user_cancel')) {
          cancelInterrupted();
          activeCancelFlags.delete(executionId);
          res.end();
          return true;
        }
        if (turnAbortedAs('client_disconnect')) {
          logger.warn('Appel LLM (réponse-pure) interrompu par une déconnexion client', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId
          });
          if (recorder) executionStore.cancelExecution(executionId, 'client_gone');
          activeCancelFlags.delete(executionId);
          res.end();
          return true;
        }
        const message = answerError instanceof Error ? answerError.message : String(answerError);
        emit({ type: 'error', error: message.slice(0, 300) });
        if (recorder) executionStore.failExecution(executionId, message.slice(0, 300));
        activeCancelFlags.delete(executionId);
        res.end();
        return true;
      }
      if (!clientGone) {
        if (cancelFlag.cancelled) {
          emit({ type: 'cancelled' });
        } else {
          try {
            await conversationIntelligenceService.recordStreamTurn({
              tenantId: context.tenantId,
              projectId,
              sessionId,
              userMessage: body.message || '',
              assistantMessage: answer,
              intent: realIntent,
              durationMs: Date.now() - questionStart,
              requestId
            });
          } catch (recordError) {
            logger.warn('Tour question non enregistré (mémoire inchangée)', {
              component: 'conversation-route-stream',
              tenantId: context.tenantId,
              projectId,
              error: recordError instanceof Error ? recordError.message : String(recordError)
            });
          }
          emit({ type: 'compass', state: 'COMPLETED' });
          // P3-QUESTION — événement dédié de réponse pure : le Studio peut
          // l'intercepter pour afficher un badge "réponse seule" au lieu des
          // cartes de build. Le texte complet transite déjà par les frames
          // `chat` ; aucun fichier n'est touché sur ce chemin (pas de
          // saveFile, pas de diff, pas de gate Chromium).
          emitNamed('on_question_answered', { text: answer });
          emit({ type: 'done', updated: false });
        }
      }
      // LOT ANSWER-CLOSE — la voie réponse-pure finalise son exécution.
      // Même trou que CLARIF-CLOSE : aucun appel de finalisation dans ce
      // chemin — deux « explique-moi » trouvés zombie RUNNING (hygiène du
      // 29/10) après les E2E de la clé .env. Une réponse envoyée = un flux
      // COMPLETED ; une réelle annulation = CANCELLED avec raison lexicale.
      // La finalisation tourne même si le client a déjà coupé (comme
      // CLARIF-CLOSE) — jamais un flux sans statut terminal.
      try {
        if (recorder) {
          if (cancelFlag.cancelled) {
            executionStore.cancelExecution(executionId, "Réponse-pure annulée par l'utilisateur");
          } else {
            executionStore.completeExecution(executionId, {});
          }
        }
      } catch (answerCloseError) {
        logger.warn('Clôture ANSWER-CLOSE non persistée (fin de flux inchangée)', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          error: answerCloseError instanceof Error ? answerCloseError.message : String(answerCloseError)
        });
      }
      clearInterval(qWaitTicker);
      activeCancelFlags.delete(executionId);
      res.end();
      return true;
    }

    // V7 — PRÉPARATION MOTEUR : une seule phase pure (aucun appel provider,
    // aucune écriture) fournit l'intention enrichie, les hypothèses, le plan,
    // l'impact et le contexte borné. Le flux conserve ensuite sa génération,
    // sa mutation atomique et sa persistance habituelles.
    let preparedTurn: PreparedTurn | undefined;
    let preparationSummary: Record<string, unknown> | undefined;
    if (streamPreparationEnabled) {
      try {
        preparedTurn = await conversationIntelligenceService.prepareTurn(
          {
            tenantId: context.tenantId,
            projectId,
            sessionId,
            message: body.message || '',
            intent: realIntent,
            // Le flux Studio matérialise l'application dans index.html ;
            // cette cible explicite évite un plan sans fichier réel.
            targetFiles: [STREAM_MUTATION_PATH],
            autoConfirmLowRisk: false
          },
          context.role,
          requestId
        );
        const engineeringBrief = buildEngineeringBrief(preparedTurn);
        preparationSummary = {
          source: 'engine',
          assumptions: preparedTurn.assumptions.length,
          planRisk: preparedTurn.planAssessment?.riskLevel ?? null,
          contextChars: preparedTurn.context.stats.totalChars,
          briefChars: engineeringBrief.length,
          impactTargets: preparedTurn.impact?.affectedFiles ?? []
        };
        emitNamed('on_preparation_completed', {
          assumptions: preparedTurn.assumptions.length,
          planRisk: preparedTurn.planAssessment?.riskLevel ?? null,
          contextChars: preparedTurn.context.stats.totalChars,
          briefChars: engineeringBrief.length,
          impactTargets: preparedTurn.impact?.affectedFiles ?? []
        });
      } catch (preparationError) {
        const reason = preparationError instanceof Error ? preparationError.message : String(preparationError);
        preparationSummary = { source: 'fallback', reason: reason.slice(0, 200) };
        logger.warn('Préparation moteur indisponible — repli sur le chemin stream actuel', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          error: reason.slice(0, 200)
        });
        emitNamed('on_preparation_fallback', { reason: reason.slice(0, 200) });
      }
    }

    // V7-WIRE-3 — DECISION ENGINE (Phase 9.5) : avant de construire, le moteur
    // réel compare l'intention aux contraintes, génère des alternatives et
    // détecte les contradictions avec les décisions passées. Mode CONSULTATIF
    // (`record: false`) : rien n'est écrit dans le Decision Ledger. Le verdict
    // est affiché et persisté ; il ne bloque jamais la génération dans ce lot.
    // CDC §14→§15 — CORRECTIF (2026-11-03, audit moteurs) : la Décision
    // consultative reçoit la MÉMOIRE PROJET RÉELLE au lieu d'une mémoire
    // vide. Avant : la mémoire n'arrivait ici QUE si
    // VOLACO_UNIFIED_PIPELINE=1 (preparedTurn), sinon `emptyMemory()` nous
    // condamnait à ignorer les contraintes/décisions actives/risques du
    // ProjectMemory à chaque tour. Source = MÊME moteur que la route
    // GET /conversation/memory (L1325) ; consultatif : ne jamais casser la
    // génération (échec de lecture = repli honnête sur mémoire vide + warn).
    let realProjectMemory: ProjectMemory | null = null;
    try {
      realProjectMemory = conversationIntelligenceService.getLatestProjectMemory(
        context.tenantId,
        projectId,
        context.role,
        requestId
      );
    } catch (memoryError) {
      logger.warn('Mémoire projet indisponible pour la Décision consultative (mémoire vide)', {
        component: 'conversation-route-stream',
        tenantId: context.tenantId,
        projectId,
        error: memoryError instanceof Error ? memoryError.message : String(memoryError)
      });
    }
    // Mémoire résolue — utilisée à la fois par la Décision (CDC §15) et par
    // les hypothèses (CDC §16) : une seule source, jamais deux lectures.
    const decisionMemory = preparedTurn?.projectMemory ?? realProjectMemory ?? undefined;
    // É49-C1 — contraintes/interdictions actives : intent du tour (extraite
    // par le moteur, extraction É49 dans intent-engine) + mémoire projet
    // persistée (MÊME source que la Décision ci-dessus). Une seule liste
    // dédupliquée, transmise aux DEUX voies de génération : chemin direct
    // (userPrompt, repli quand la chaîne est indisponible) et chaîne
    // d'agents (input.constraints → bloc INTERDICTIONS dans les 3
    // descriptions). Aucune transformation sémantique : textes bruts.
    // Preuve É49 (UI S5 + sonde E5) : « N'ajoute surtout pas de système de
    // paiement » n'était respectée que par la bonne volonté du LLM, jamais
    // transmise aux agents.
    const streamConstraints: string[] = [
      ...new Set([
        ...(realIntent.constraints ?? []),
        ...((decisionMemory?.knownConstraints ?? []) as readonly string[])
      ])
    ];
    const streamConstraintBlock = streamConstraints.length > 0
      ? `\n\nINTERDICTIONS STRICTES DE L'UTILISATEUR (à respecter à la lettre, aucune exception) :\n` +
        streamConstraints.map((c) => `- ${c}`).join('\n') + `\n`
      : '';
    // CDC §15 — LOT ADR AUTO (2026-11-03, audit moteurs) : la décision
    // consultative est ENREGISTRÉE au Decision Ledger quand elle porte sur
    // une vraie modification de l'application (CREATE/MODIFY/DELETE/
    // REFACTOR). Portes : jamais sous node:test (anti-pollution des suites),
    // interrupteur `VOLACO_DECISION_AUTORECORD=0` pour désactiver. La
    // déduplication (même catégorie + même but actif) vit dans decide.ts.
    const adrAutoEligible =
      realIntent.category === 'CREATE' ||
      realIntent.category === 'MODIFY' ||
      realIntent.category === 'DELETE' ||
      realIntent.category === 'REFACTOR';
    const decisionAutoRecord =
      adrAutoEligible &&
      process.env.NODE_TEST_CONTEXT === undefined &&
      process.env.VOLACO_DECISION_AUTORECORD !== '0';
    const decisionOutcome = await assessConfiguredStreamDecision({
      tenantId: context.tenantId,
      projectId,
      sessionId,
      intent: realIntent,
      memory: decisionMemory,
      record: decisionAutoRecord
    });
    let decisionSummary: StreamDecisionSummary | null = null;
    if (decisionOutcome.available) {
      decisionSummary = decisionOutcome.summary;
      emitNamed('on_decision_assessed', {
        verdict: decisionSummary.verdict,
        decisionId: decisionSummary.decisionId,
        intentCategory: decisionSummary.intentCategory,
        alternatives: decisionSummary.alternatives,
        viableAlternatives: decisionSummary.viableAlternatives,
        chosen: decisionSummary.chosenAlternative?.label ?? null,
        clarifications: [...decisionSummary.requiredClarifications],
        contradictingDecisions: decisionSummary.contradictingDecisions,
        memory: decisionSummary.memory ?? null
      }, {
        type: 'DECISION_ASSESSED',
        phase: 'PLAN',
        status: 'COMPLETED',
        title: `Décision ${decisionSummary.verdict} — ${decisionSummary.alternatives} alternative(s)`,
        detail: {
          decisionId: decisionSummary.decisionId,
          verdict: decisionSummary.verdict,
          intentCategory: decisionSummary.intentCategory,
          alternatives: decisionSummary.alternatives,
          viableAlternatives: decisionSummary.viableAlternatives,
          chosen: decisionSummary.chosenAlternative?.label ?? null,
          riskScore: decisionSummary.chosenAlternative?.riskScore ?? null,
          reversible: decisionSummary.chosenAlternative?.reversible ?? null,
          requiredClarifications: decisionSummary.requiredClarifications.length,
          contradictingDecisions: decisionSummary.contradictingDecisions,
          memoryRisks: decisionSummary.memory?.matchedRisks.length ?? 0,
          memoryConstraints: decisionSummary.memory?.matchedConstraints.length ?? 0,
          memoryDecisions: decisionSummary.memory?.activeDecisions ?? 0,
          recorded: decisionSummary.recorded,
          recordNote: decisionSummary.recordNote ?? null
        }
      });
      if (decisionSummary.verdict !== 'READY') {
        logger.warn('Décision consultative non READY (génération poursuivie)', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          verdict: decisionSummary.verdict,
          clarifications: decisionSummary.requiredClarifications.length
        });
      }
    } else if (decisionOutcome.reason !== 'service-non-configure') {
      logger.warn('Decision Engine consultatif indisponible (génération poursuivie)', {
        component: 'conversation-route-stream',
        tenantId: context.tenantId,
        projectId,
        error: decisionOutcome.reason
      });
    }

    // CDC §16 — LOT ASSOMPTIONS FLUX (2026-11-03, audit moteurs) : le moteur
    // d'hypothèses RÉEL (deriveAssumptions, déterministe, zéro LLM — le même
    // que ConversationEngine) tourne sur l'intention réelle et les conventions
    // mémoire du projet. Frame additive `on_assumptions_proposed` (phase PLAN)
    // persistée via recordOnly : affichée dans le panneau Studio, jamais
    // bloquante. La confirmation interactive reste un lot ultérieur (§16).
    const realAssumptions = deriveAssumptions(
      realIntent,
      decisionMemory?.knownConventions ?? []
    );
    if (realAssumptions.length > 0) {
      emitNamed('on_assumptions_proposed', {
        assumptions: realAssumptions.map((a) => ({
          id: a.id,
          statement: a.statement,
          confidence: a.confidence,
          evidence: a.evidence,
          risk: a.risk,
          reversible: a.reversible,
          requiresConfirmation: a.requiresConfirmation,
          status: a.status
        }))
      }, {
        type: 'ASSUMPTIONS_PROPOSED',
        phase: 'PLAN',
        status: 'COMPLETED',
        title: `${realAssumptions.length} hypothèse(s) explicite(s) dérivée(s)`,
        detail: {
          count: realAssumptions.length,
          ids: realAssumptions.map((a) => a.id),
          risks: realAssumptions.map((a) => a.risk)
        }
      });
      logger.info('Hypothèses explicites dérivées (CDC §16)', {
        component: 'conversation-route-stream',
        tenantId: context.tenantId,
        projectId,
        count: realAssumptions.length,
        ids: realAssumptions.map((a) => a.id)
      });
    }

    // Le plan préparé par le moteur est la source quand elle est disponible ;
    // le générateur local reste le repli exact du chemin historique.
    const plan = preparedTurn?.plan ?? planGenerator.generatePlan({
      intent: realIntent,
      // Hors flag, le plan local garde exactement son comportement historique.
      defaultTargetFiles: streamPreparationEnabled ? [STREAM_MUTATION_PATH] : undefined
    });
    emit({ type: 'plan', plan }, {
      type: 'PLAN_CREATED',
      phase: 'PLAN',
      status: 'COMPLETED',
      title: `Plan créé — ${plan.steps.length} étape(s)`,
      detail: { planId: plan.planId, steps: plan.steps.length }
    });

    // VISIBILITÉ (2026-11-02) — le Studio rend les pas de la chaîne UNIQUEMENT
    // via la vue `activity` normalisée (LOT C+D : l'ActivityStream est le
    // moteur de rendu ACTIF, le vieux traceur DOM est inert sur ce flux) :
    // chaque frame d'agent porte donc SA vue. Id STABLE par pas : le frame
    // RUNNING puis le frame terminal (même id) remplacent la ligne EN PLACE
    // (◉ violet vivant → ✓ vert / ✗ rouge) dans le fil d'activité du chat.
    const chainStepActivity = (report: AgentChainStepReport): Record<string, unknown> => {
      const labels: Record<AgentChainStepReport['step'], string> = {
        decision: 'Agent Décision',
        architecture: 'Agent Architecture',
        ui: 'Agent UI',
        backend: 'Agent Backend',
        securite: 'Agent Sécurité'
      };
      const statuses: Record<AgentChainStepReport['status'], string> = {
        running: 'RUNNING',
        ok: 'COMPLETED',
        degraded: 'COMPLETED',
        failed: 'FAILED',
        skipped: 'SKIPPED'
      };
      const dur = report.durationMs > 0 ? ` · ${(report.durationMs / 1000).toFixed(1).replace('.', ',')} s` : '';
      const cred = report.credentialProviderId
        ? ` — ${report.credentialProviderId}${report.credentialSlot ? '@' + report.credentialSlot : ''}`
        : '';
      let title: string;
      switch (report.status) {
        case 'running':
          title = 'travail en cours…';
          break;
        case 'ok':
          title = `validé${cred}${dur}`;
          break;
        case 'degraded':
          title = `partiel — ${report.note ?? 'LLM indisponible'}${dur}`;
          break;
        case 'failed':
          title = `en échec — ${report.note ?? 'impossible de continuer'}`;
          break;
        default:
          title = 'ignoré';
      }
      return {
        id: `agent-chain-${report.step}`,
        type: 'agent',
        action: labels[report.step],
        status: statuses[report.status],
        title,
        detail: {
          step: report.step,
          agentId: report.agentId,
          provider: report.credentialProviderId ?? null,
          slot: report.credentialSlot ?? null
        }
      };
    };
    // CHAÎNE D'AGENTS (demande opérateur 2026-11-02) — étapes 1 et 2 déjà
    // exécutées ci-dessus par les moteurs existants : intention (classifyIntent)
    // puis plan (PlanGenerator/Decision Engine). Les frames ci-dessous font
    // la traçabilité honnête de ces deux pas (AUCUNE ressource relancée) ; les
    // pas 3-5 (Agent UI → Backend → Sécurité via l'orchestrateur) arrivent au
    // moment de la génération (voir le branchement du stream plus bas).
    emitNamed('on_agent_step', { step: 'decision', agentId: 'decision-engine', status: 'running', note: 'analyse de l intention (moteur existant)', activity: chainStepActivity({ step: 'decision', agentId: 'decision-engine', status: 'running', durationMs: 0, note: 'analyse de l intention (moteur existant)' }) });
    emitNamed('on_agent_step', {
      step: 'decision',
      agentId: 'decision-engine',
      status: 'ok',
      note: `Intention ${realIntent.category} (confiance ${Math.round(Math.min(1, Math.max(0, realIntent.confidence)) * 100)}%) — moteur d'intention existant`,
      activity: chainStepActivity({ step: 'decision', agentId: 'decision-engine', status: 'ok', durationMs: 0, note: `Intention ${realIntent.category} — moteur d'intention existant` })
    });
    emitNamed('on_agent_step', { step: 'architecture', agentId: 'plan-generator', status: 'running', note: 'planification (moteur existant)', activity: chainStepActivity({ step: 'architecture', agentId: 'plan-generator', status: 'running', durationMs: 0, note: 'planification (moteur existant)' }) });
    emitNamed('on_agent_step', {
      step: 'architecture',
      agentId: 'plan-generator',
      status: 'ok',
      note: `Plan ${plan.steps.length} étape(s) — générateur de plan existant`,
      activity: chainStepActivity({ step: 'architecture', agentId: 'plan-generator', status: 'ok', durationMs: 0, note: `Plan ${plan.steps.length} étape(s) — générateur de plan existant` })
    });

    // V7 — IMPACT INTELLIGENCE branchée sur le flux principal : avant toute
    // modification, le moteur réel évalue le rayon d'impact de index.html
    // (graphe sémantique + dépendances). Le résultat est TRACÉ (événement
    // persistant + frame nommée + done) ; il est consultatif dans ce lot et
    // ne bloque donc jamais la génération. HIGH/CRITICAL est signalé pour la
    // politique de confirmation (planFirst) sans changer le comportement.
    let impactSummary: StreamImpactSummary | null = null;
    if (isModification) {
      const impactOutcome = assessStreamImpact(
        streamImpactAnalyzer,
        { tenantId: context.tenantId, projectId, targetFiles: resolveStreamImpactTargets(plan) },
        context.role,
        requestId
      );
      if (impactOutcome.available) {
        impactSummary = impactOutcome.summary;
        // V7-WIRE-3 — l'impact entre dans le panneau Exécution LIVE : la frame
        // nommée porte la vue `activity` normalisée (le Studio l'affiche sans
        // code spécifique) ET l'événement persistant reste consultable au replay.
        emitNamed('on_impact_assessed', {
          riskLevel: impactSummary.riskLevel,
          requiresConfirmation: impactSummary.requiresConfirmation,
          totalImpactedNodes: impactSummary.totalImpactedNodes,
          breakingCount: impactSummary.breakingCount,
          targetFiles: [...impactSummary.targetFiles]
        }, {
          type: 'IMPACT_ASSESSED',
          phase: 'PLAN',
          status: 'COMPLETED',
          title: `Impact évalué — risque ${impactSummary.riskLevel}`,
          detail: {
            riskLevel: impactSummary.riskLevel,
            totalImpactedNodes: impactSummary.totalImpactedNodes,
            breakingCount: impactSummary.breakingCount,
            requiresConfirmation: impactSummary.requiresConfirmation,
            targetFiles: [...impactSummary.targetFiles],
            durationMs: impactSummary.durationMs
          }
        });
        logger.info('Impact Intelligence : analyse réelle de la modification', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          riskLevel: impactSummary.riskLevel,
          totalImpactedNodes: impactSummary.totalImpactedNodes,
          breakingCount: impactSummary.breakingCount,
          requiresConfirmation: impactSummary.requiresConfirmation,
          durationMs: impactSummary.durationMs
        });
      } else if (impactOutcome.reason !== 'service-non-configure') {
        logger.warn('Impact Intelligence : analyse indisponible (génération poursuivie)', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          error: impactOutcome.reason
        });
      }
    }
    // P2-SIGNAUX — plan progressif : une frame par étape (index/total/titre)
    // au lieu d'un seul bloc statique. La frame `plan` complète est
    // conservée (carte de plan du Studio en dépend — non-régression).
    plan.steps.forEach((step, i) => {
      emitNamed('on_plan_step', { index: i + 1, total: plan.steps.length, step: step.title });
    });
    // Conversation vivante — narration aux transitions réelles (§14 CDC) :
    // l'IA raconte ce qu'elle fait au moment où elle le fait.
    if (isModification) {
      emit({ type: 'chat', text: `Je modifie ta page en gardant le reste intact : ${plan.steps.length} étape(s). Je m'y mets tout de suite !`, scripted: true });
    } else {
      emit({ type: 'chat', text: `Voici mon plan : ${plan.steps.length} étapes. Je construis ça sous tes yeux, section par section !`, scripted: true });
    }
    if (body.planFirst && !body.confirmedPlan) {
      emit({ type: 'compass', state: 'WAITING_CONFIRMATION' }, {
        type: 'PHASE_CHANGED',
        phase: 'PLAN',
        status: 'WAITING_USER',
        title: 'En attente de ta validation du plan',
        detail: { state: 'WAITING_CONFIRMATION' }
      });
      if (recorder) executionStore.setStatus(executionId, 'WAITING_USER');
      // FIX-PLANFIRST — persiste le plan en session AVANT de rendre la main :
      // sans cela, POST /confirm rejette le planId ("introuvable ou non
      // actif") et le bouton Approuver ne peut jamais aboutir. En cas
      // d'échec, on dégrade vers le comportement historique (plan affiché
      // mais non confirmable) plutôt que de casser le stream.
      try {
        conversationIntelligenceService.stagePlanForConfirmation({
          tenantId: context.tenantId,
          projectId,
          sessionId,
          userMessage: body.message || '',
          intent: realIntent,
          plan,
          userRole: context.role,
          requestId
        });
      } catch (stageError) {
        logger.warn('Plan planFirst non persisté en session (confirm impossible)', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          error: stageError instanceof Error ? stageError.message : String(stageError)
        });
      }
      emit({
        type: 'done',
        // É53 LOT B — contrat de vérité : PlanFirst n'écrit rien → `updated`
        // explicite à false (le client lit d'abord awaitingConfirmation ;
        // ce champ garantit qu'aucun done n'est ambigu).
        updated: false,
        awaitingConfirmation: true,
        ...(preparationSummary ? { preparation: preparationSummary } : {})
      });
      // Sortie anticipée : le finally du stream LLM ne passe pas ici —
      // le drapeau d'annulation doit partir avec l'exécution inactive.
      activeCancelFlags.delete(executionId);
      res.end();
      return true;
    }
    if (body.confirmedPlan) {
      recordOnly({
        type: 'PLAN_APPROVED',
        phase: 'PLAN',
        status: 'COMPLETED',
        title: 'Plan approuvé — je lance la génération'
      });
    }

    // Sélectionne l'adaptateur de streaming : Mistral si sa clé env est
    // présente, sinon Gemini (clé env ou carte Studio active).
    const adapter = resolveStreamingAdapter();
    if (!adapter || !('generateStream' in adapter)) {
      const providerError = "Aucun fournisseur IA streaming disponible (Mistral ou Gemini requis).";
      emit({ type: 'error', error: providerError });
      if (recorder) executionStore.failExecution(executionId, providerError);
      activeCancelFlags.delete(executionId);
      res.end();
      return true;
    }

    // Détection du mode : CRÉATION vs MODIFICATION
    // E48 — un isModification EXPLICITE du client est RESPECTÉ : « crée un
    // site » alors qu'un fichier existe doit REMPLACER le fichier (site
    // frais), pas fusionner dedans (c'est l'accumulation de sections
    // obsolètes constatée en production). L'heuristique de repli (fichier
    // > 200 caractères → modification) ne s'applique que si le client n'a
    // rien explicité.
    const isModificationMode = body.isModification !== undefined
      ? Boolean(body.isModification)
      : (currentHtml.trim().length > 200);

    // É53 LOT B — PLACEHOLDER PRISTIN d'un projet neuf. `FileStore`
    // (file-explorer/store.ts, getOrCreateProjectMap) sème ce document par
    // défaut au premier accès : ce n'est PAS un contenu utilisateur à
    // préserver. Une CRÉATION explicite (isModificationMode:false) qui le
    // remplace ne doit pas être jugée comme une perte de contenu protégé —
    // sinon AUCUNE création n'était possible sur un projet neuf (le titre
    // « Hello VibeCode » n'existe pas dans le HTML généré → refus du contrat
    // de préservation). Le contrat est alors construit sur un document vide
    // (scope « creation » : rien à préserver). Tout contenu NON seedé —
    // c'est-à-dire tout travail réel — reste intégralement protégé.
    const DEFAULT_PROJECT_SEED_HTML =
      '<!DOCTYPE html>\n<html>\n<head><title>App</title></head>\n<body><h1>Hello VibeCode</h1></body>\n</html>';

    // === SYSTÈME PROMPT MODE CRÉATION ===
    // (comportement actuel : génère un site complet section par section)
    const creationSystemPrompt =
      "Tu es le Lead Engineer IA de VibeCode Studio. L'utilisateur te parle en français, tu réponds en français.\n\n" +
      "RÔLE : Tu construis le site EN LIVE devant l'utilisateur, section par section, dans le preview. L'utilisateur doit VOIR le site se construire sous ses yeux — chaque section apparaît l'une après l'autre avec un effet de pulse.\n\n" +
      "NARRATION VIVANTE (très important) : Avant CHAQUE section, raconte en 1-2 phrases chaleureuses et concrètes ce que tu construis et POURQUOI, comme un designer qui parle à son client (ex: « Je pose un header translucide avec le logo à gauche, ça donne tout de suite une impression de pro. » / « Maintenant le hero : une grande image chaleureuse et un gros titre qui claque. »). Utilise le tutoiement, sois naturel, jamais technique.\n\n" +
      "QUALITÉ DESIGN (obligatoire) : une palette limitée et cohérente, des dégradés subtils, des ombres douces, des hover states sur chaque bouton, une vraie hiérarchie typographique (grands titres, textes lisibles) et un espacement généreux. Le résultat doit avoir l'air conçu par un designer senior.\n\n" +
      buildSectorContract(imageTheme, 'create') + "\n\n" +
      buildImageBrief(imageTheme, 'create', imageSeed, dynamicImages !== undefined
        ? { poolOverride: [...dynamicImages.dynamicIds] }
        : (imageSubject ? { subjectHint: imageSubject.hint } : undefined)) + "\n\n" +
      "FORMAT OBLIGATOIRE de ta réponse :\n\n" +
      "0. EMPREINTE DESIGN (OBLIGATOIRE, PREMIÈRE LIGNE de ta réponse) : un commentaire HTML avec ton brief design en JSON — palette hex RÉELLE (fond, texte, accent) cohérente avec la demande, UNE police Google Fonts (ex: \"Fraunces\", \"Space Grotesk\", \"Playfair Display\", \"Inter\", \"Poppins\"), et le mode d'ambiance :\n" +
      "   <!-- DESIGN_DNA: {\"palette\":{\"bg\":\"#f8fafc\",\"fg\":\"#0f172a\",\"accent\":\"#0284c7\"},\"font\":\"Inter\",\"mode\":\"light\"} -->\n" +
      "   Cette empreinte est l'IDENTITÉ du site : le fond de page et la police principale sont posés à partir d'elle, et tu DOIS réutiliser bg/fg/accent dans TOUTES tes sections (fonds, textes, boutons, bordures, accents). Adapte-la à la demande : « site fun pour enfants » ≠ « dashboard corporate » ≠ « vitrine élégante et neutre ».\n\n" +
      "0b. TITRE (OBLIGATOIRE, avec l'empreinte) : le vrai nom du commerce/site, jamais \"VibeCode Studio\" et jamais un titre hérité d'un autre secteur/projet :\n" +
      "   <!-- PAGE_TITLE: Nom Réel du Site — sous-titre du projet -->\n\n" +
      "0c. CONCEPTION PRODUIT AVANT LE CODE (obligatoire) : avant la première section, consacre ta narration d'ouverture (3-5 phrases) à CONCEVOIR le produit demandé — pas à réciter une structure passe-partout : QUI sont les utilisateurs, QUEL problème le produit résout, QUELS parcours essentiels (découvrir → comparer → agir ? administrer ? acheter ?), QUELLES pages/sections tu construis et POURQUOI elles sont justifiées pour CE produit, QUELLES interactions réelles tu vas câbler (filtres, onglets, formulaires, états). Choisis ensuite UN archétype de départ et annonce-le d'un mot — « vitrine » (identité + preuve + contact), « application » (navigation multi-vues : tableau de bord, listes, fiches, formulaires), « catalogue » (grille produits + fiches + panier/parcours d'achat), « éditorial » (narration immersive, typographie dominante), « immersion » (plein écran, visuels forts, scroll narratif). Les archétypes sont des POINTS DE DÉPART à adapter, jamais des moules : compose la structure que le produit mérite — une seule section si une seule suffit, dix si le parcours l'exige, navigation à onglets ou vues multiples si c'est une application.\n\n" +
      "1. Commence par ta narration de CONCEPTION (3-5 phrases, tutoiement, chaleureuse mais concrète) : le produit, ses utilisateurs, le parcours essentiel, les sections que tu construis et pourquoi, l'archétype choisi.\n" +
      "   Ex: \"Salut ! Pour ta boutique de céramiques, je pars sur un catalogue : les visiteurs viennent CHOISIR une pièce. Grille des collections d'abord, puis matière-atelier, chaque produit avec sa fiche, et un panier simple. Direction artistique terre cuite, sobre.\"\n\n" +
      "2. Pour CHAQUE section que TA CONCEPTION justifie, écris un bloc au format EXACT suivant :\n\n" +
      "   <SECTION name=\"nom-court-metier\">\n" +
      "   Phrase courte décrivant ce que tu fais (ex: \"Maintenant la grille des collections avec filtres matière.\")\n" +
      "   ... code HTML complet de la section ...\n" +
      "   </SECTION>\n\n" +
      "3. Structure LIBRE et JUSTIFIÉE : le nombre de sections, leurs noms et leur ordre viennent de ta conception du produit — pas d'une recette. Un tableau de bord aura des vues données (indicateurs, tableaux, filtres) ; une boutique une grille + fiches + panier ; un site de rencontres des profils + découverte + critères ; un laboratoire ses essais et équipements. Interdits : sections fourre-tout « features génériques », cartes répétées pour remplir, boutons décoratifs sans comportement.\n\n" +
      "4. Termine par une phrase de conclusion après la dernière section\n" +
      "   Ex: \"Voilà, ta boutique est prête ! Les fiches produits et le panier sont cliquables.\"\n\n" +
      "RÈGLES CRITIQUES :\n" +
      "- Utilise TOUJOURS le marqueur <SECTION name=\"nom-court\"> pour délimiter chaque section\n" +
      "- Le name doit être en minuscules avec tirets : \"header\", \"hero\", \"menu\", \"testimonials\", \"pricing\", \"reservation\", \"contact\", \"footer\"\n" +
      "- Le HTML de chaque section doit être COMPLET et AUTONOME (peut être rendu seul dans une page)\n" +
      "- Chaque section doit avoir une RAISON d'être métier (si tu ne peux pas dire pourquoi elle existe pour CE produit, ne la génère pas) ; pas de header/footer obligatoires — mets-les seulement si le produit en a besoin\n" +
      "- Le texte décrivant chaque section doit être COURT (1 phrase max) et conversationnel (\"Maintenant...\", \"Ensuite...\", \"Je passe à...\", etc.)\n" +
      "- Utilise Tailwind CSS via CDN (https://cdn.tailwindcss.com) dans chaque section qui a besoin de styles\n" +
      "- RESPECTE TON EMPREINTE : fond de page bg, textes fg, boutons et accents accent — la police principale est déjà posée par le shell à partir de ton empreinte ; les couleurs arbitraires hors palette sont interdites\n" +
      "- Adapte l'ambiance au thème (clair pour une vitrine élégante, sombre pour un dashboard financier…) — ne force PAS un mode sombre si la demande appelle du clair\n" +
      "- Pour les titres en dégradé : <span class=\"bg-gradient-to-r from-X via-Y to-Z bg-clip-text text-transparent\" style=\"-webkit-background-clip: text; -webkit-text-fill-color: transparent;\">\n" +
      "- Inclura du JS interactif quand pertinent (boutons cliquables, alertes, etc.)\n\n" +
      "EXEMPLE DE FORMAT (seul le FORMAT compte — la structure, le style et le contenu viennent de TA conception du produit demandé, jamais de cet exemple) :\n" +
      "<!-- DESIGN_DNA: {\"palette\":{...},\"font\":\"...\",\"mode\":\"...\"} -->\n" +
      "Narration de conception (3-5 phrases : produit, utilisateurs, parcours, sections choisies, archétype).\n\n" +
      "<SECTION name=\"section-justifiée-par-le-produit\">\n" +
      "Phrase courte.\n" +
      "... HTML complet de la section, styles Tailwind, images du RÉSERVOIR du thème ...\n" +
      "</SECTION>\n\n" +
      "[... autant de sections que ta conception justifie, avec leurs interactions réelles ...]\n\n" +
      "Phrase de conclusion.";

    // === SYSTÈME PROMPT MODE MODIFICATION ===
    // (nouveau : l'IA reçoit le HTML existant et modifie SEULEMENT les sections concernées)
    const modificationSystemPrompt =
      "Tu es le Lead Engineer IA de VibeCode Studio. L'utilisateur te parle en français, tu réponds en français.\n\n" +
      "CONTEXTE CRITIQUE : L'utilisateur a DÉJÀ une application web existante (le code HTML complet t'est fourni dans le message utilisateur). Il veut la MODIFIER, pas la recréer.\n\n" +
      "RÔLE : Tu modifies UNIQUEMENT les sections concernées par la demande de l'utilisateur. Tu ne renvoies pas les sections non modifiées. L'utilisateur doit voir les changements apparaître en temps réel dans le preview, section par section, avec un effet de remplacement fluide.\n\n" +
      "NARRATION VIVANTE : avant chaque section modifiée, raconte en 1-2 phrases chaleureuses ce que tu changes et pourquoi, comme un designer qui parle à son client. Utilise le tutoiement.\n\n" +
      "QUALITÉ DESIGN : garde la cohérence de l'existant et améliore-le (images cohérentes, hover states, hiérarchie typographique, espacements généreux).\n\n" +
      "FORMAT OBLIGATOIRE de ta réponse en mode modification :\n\n" +
      "1. Phrase courte pour annoncer ce que tu vas modifier (1 phrase max, conversationnelle)\n" +
      "   Ex: \"OK, je passe le bouton du Hero en bleu et j'ajoute une ombre.\"\n" +
      "   Ex: \"Compris, j'ajoute une nouvelle section témoignages entre le Hero et le Footer.\"\n\n" +
      "2. Pour CHAQUE section à modifier ou ajouter, écris un bloc au format EXACT :\n\n" +
      "   <SECTION name=\"nom-de-la-section\" mode=\"modify\">\n" +
      "   Phrase courte décrivant ce que tu modifies (ex: \"Je passe le bouton 'Réserver' du Hero en bleu.\")\n" +
      "   [HTML COMPLET de la section modifiée, avec les changements appliqués]\n" +
      "   </SECTION>\n\n" +
      "3. Pour AJOUTER une nouvelle section à un endroit précis, utilise :\n" +
      "   <SECTION name=\"nom-nouvelle-section\" mode=\"add\" after=\"nom-section-précédente\">\n" +
      "   Phrase courte\n" +
      "   [HTML COMPLET de la nouvelle section]\n" +
      "   </SECTION>\n\n" +
      "4. Pour SUPPRIMER une section, utilise :\n" +
      "   <SECTION name=\"nom-section\" mode=\"delete\">\n" +
      "   Phrase courte expliquant la suppression\n" +
      "   </SECTION>\n\n" +
      "5. Termine par une phrase de confirmation\n" +
      "   Ex: \"Voilà, le bouton est maintenant bleu ! Tu peux voir le changement dans le Hero.\"\n\n" +
      "RÈGLES CRITIQUES :\n" +
      "- Le name doit correspondre EXACTEMENT (même orthographe) à une section EXISTANTE listée dans le CONTEXTE RÉEL de la page (header, hero, menu, reservation, footer, etc.) quand mode=\"modify\" ou mode=\"delete\" — n'invente JAMAIS un nom (ex: \"navbar\" alors que la section existante s'appelle \"header\")\n" +
      "- Pour une section NOUVELLE (qui n'existe pas encore dans le contexte), utilise mode=\"add\" avec after=<nom de la dernière section>\n" +
      "- Le HTML modifié doit être COMPLET (toute la section, pas juste la partie changée)\n" +
      "- Ne renvoie QUE les sections modifiées/ajoutées — JAMAIS les sections non modifiées\n" +
      "- Garde le style et la structure globale de l'application (ne change pas la palette ou le thème si non demandé)\n" +
      "- Si la demande concerne plusieurs sections, renvoie-les toutes avec leur propre bloc <SECTION>\n" +
      "- Le texte décrivant chaque modification doit être COURT (1 phrase max) et conversationnel\n" +
      "- TITRE : si le <title> actuel ne décrit pas le projet ou la demande (titre hérité d'un autre secteur, ex. « Authentic Italian Cuisine » sur un site barbier), corrige-le en émettant le marqueur <!-- PAGE_TITLE: Vrai titre du site -->. Sinon, répète le titre actuel.\n\n" +
      buildImageBrief(imageTheme, 'modify', imageSeed, dynamicImages !== undefined
        ? { poolOverride: [...dynamicImages.dynamicIds] }
        : (imageSubject ? { subjectHint: imageSubject.hint } : undefined)) + "\n\n" +
      buildSectorContract(imageTheme, 'modify') + "\n\n" +
      "EXEMPLE pour demande \"change le bouton du Hero en bleu\" :\n\n" +
      "OK, je passe le bouton du Hero en bleu avec une ombre.\n\n" +
      "<SECTION name=\"hero\" mode=\"modify\">\n" +
      "Je modifie le Hero — le bouton passe de rose à bleu.\n" +
      "<section class=\"relative min-h-screen flex items-center justify-center overflow-hidden\">\n" +
      "  <div class=\"absolute inset-0 bg-slate-900\"></div>\n" +
      "  <div class=\"relative z-10 max-w-4xl mx-auto px-6 text-center\">\n" +
      "    <h1>Bienvenue</h1>\n" +
      "    <a href=\"#services\" class=\"bg-blue-500 hover:bg-blue-400 text-white font-bold px-8 py-3 rounded-lg shadow-lg shadow-blue-500/50\">Découvrir</a>\n" +
      "  </div>\n" +
      "</section>\n" +
      "</SECTION>\n\n" +
      "Voilà, le bouton est maintenant bleu !";

    // P0 (audit 2026-10) — le contexte Design RÉEL du projet (rapport
    // persisté + artefact frais) est transmis aux voies de génération.
    // Sans rapport : prompt strictement inchangé (non-régression).
    const systemPrompt = withEngineeringBrief(
      withProjectDesignContext(
        isModificationMode ? modificationSystemPrompt : creationSystemPrompt,
        { tenantId: context.tenantId, projectId }
      ),
      preparedTurn
    );

    // Pour le mode modification, on inclut TOUJOURS le HTML actuel comme contexte
    // É49-C1 — le bloc d'interdictions suit le prompt dans les TROIS formes :
    // sans la chaîne d'agents (repli direct), le LLM reste lié aux interdits.
    const userPrompt = isModificationMode
      ? `Voici le code HTML ACTUEL de l'application :\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nDemande de modification de l'utilisateur : ${body.message}\n\nApplique les modifications nécessaires en respectant le format <SECTION name="..." mode="modify">.${buildPageContext(currentHtml)}${streamConstraintBlock}`
      : (isModification
        ? `Voici le code HTML actuel de l'application :\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nDemande de l'utilisateur : ${body.message}${buildPageContext(currentHtml)}${streamConstraintBlock}`
        : `Demande de l'utilisateur : ${body.message}${streamConstraintBlock}`);

    let fullText = '';
    let inSection = false;
    let currentSectionName = '';
    let currentSectionMode = 'create'; // 'create' | 'modify' | 'add' | 'delete'
    let currentSectionAfter = ''; // pour mode="add" : nom de la section précédente
    let currentSectionHtml = '';
    let currentSectionText = '';
    let sectionIndex = 0;
    // É52 — empreinte design capturée dans le préambule de la réponse LLM
    let streamDesignDna: StudioDesignDna | null = null;
    // === ACCUMULATEUR DE SECTIONS CÔTÉ SERVEUR ===
    // Pour pouvoir sauvegarder le HTML final dans fileStore à la fin du stream,
    // le serveur doit accumuler les sections au fur et à mesure qu'elles arrivent.
    // Sinon, la prochaine demande de modification ne trouvera pas de HTML existant
    // et l'IA repassera en mode création (recréera tout le site).
    const serverSections: Array<{ name: string; mode: string; after: string; html: string }> = [];
    // Heartbeat SSE (fiabilité CDC §17) : un commentaire périodique garde la
    // connexion ouverte à travers les proxys pendant les silences du flux
    // (attente du premier token LLM, gate Chromium). Une ligne de commentaire
    // SSE est ignorée par tout consommateur qui ne lit que les `data:`.
    const heartbeatMs = Number(process.env.VOLACO_SSE_HEARTBEAT_MS ?? 15000);
    const heartbeat = heartbeatMs > 0 ? setInterval(() => {
      if (clientGone) return;
      try { res.write(': ping\n\n'); } catch { /* socket déjà fermé */ }
    }, heartbeatMs) : null;

    // P2-SIGNAUX — signal d'activité si le provider met plus de 2 s à
    // répondre (résolution + premier token) : l'UI reste vivante au lieu
    // de figer le spinner. Stopé au premier chunk (voir boucle) et en finally.
    // (Déclarés hors try : finally ne voit pas l'intérieur du bloc try.)
    const llmWaitStart = Date.now();
    let firstTokenSeen = false;
    let providerWaitTicker: ReturnType<typeof setInterval> | null = null;
    // =====================================================================
    // CHAÎNE D'AGENTS SPÉCIALISÉS — demande opérateur (2026-11-02)
    // ---------------------------------------------------------------------
    // Décision + Architecture ont déjà tourné ci-dessus (moteurs existants).
    // Ici : Agent UI (génère le HTML) → Agent Backend (logique métier) →
    // Agent Sécurité (vérifie), via l'orchestrateur É32 et les CLÉS D'AGENTS
    // stockées côté serveur (créneau primary → fallback → chaîne legacy).
    // Le texte final remplace l'appel direct au provider : il est réinjecté
    // en source « stream » (générateur async) dans le parser de sections
    // ci-dessous — aucun changement du contrat SSE. En échec, repli strict
    // sur l'appel direct historique.
    // =====================================================================
    let upstreamSource: AsyncIterable<string> | null = null;
    let agentChainFailures: string[] = [];
    // É53 LOT E4.1 — CORRECTION B : pré-checks — une annulation déjà armée
    // pendant la classification/décision ne lance AUCUN travail d'agent ni
    // d'appel direct. L'issue reste l'arbitrage E1/E2 (⏹ unique).
    // É53 LOT E4.2 — CORRECTION F3 (audit G3) : ces returns anticipés sont
    // AVANT le try/finally qui nettoie le heartbeat SSE (créé ci-dessus) —
    // l'intervalle est donc explicitement arrêté sur chaque sortie.
    if (turnAbortedAs('user_cancel')) {
      if (heartbeat) clearInterval(heartbeat);
      cancelInterrupted();
      return true;
    }
    if (turnAbortedAs('client_disconnect')) {
      if (heartbeat) clearInterval(heartbeat);
      logger.warn('Déconnexion client avant la chaîne d agents — aucun appel lancé', {
        component: 'conversation-route-stream',
        tenantId: context.tenantId,
        projectId
      });
      if (recorder) executionStore.cancelExecution(executionId, 'client_gone');
      return true;
    }
    try {
      const agentChain = await runAgentGenerationPipeline({
        tenantId: context.tenantId,
        projectId,
        userRole: context.role,
        requestId,
        userMessage: body.message || '',
        intentCategory: realIntent.category,
        planSteps: plan.steps.map((step) => step.title),
        userPrompt,
        isModificationMode,
        currentHtml,
        constraints: streamConstraints,
        // É53 LOT E4.1 — CORRECTION B : le MÊME signal du tour est transmis à
        // la chaîne (chaque agent, chaque étape, transport inclus).
        signal: turnAbortController.signal,
        onStep: (stepReport: AgentChainStepReport): void => {
          emitNamed('on_agent_step', {
            step: stepReport.step,
            agentId: stepReport.agentId,
            status: stepReport.status,
            credentialSlot: stepReport.credentialSlot ?? null,
            credentialProviderId: stepReport.credentialProviderId ?? null,
            failoverReason: stepReport.failoverReason ?? null,
            durationMs: stepReport.durationMs,
            note: stepReport.note ?? null,
            activity: chainStepActivity(stepReport)
          });
        }
      });
      agentChainFailures = agentChain.steps.filter((s) => s.status !== 'ok').map((s) => `${s.step}:${s.status}`);
      if (agentChain.ok && agentChain.text.trim().length > 200 && /<SECTION\s+name=/.test(agentChain.text)) {        upstreamSource = (async function* (): AsyncGenerator<string, void, undefined> {
          // Réinjection progressive : le parser de sections du flux consomme
          // le texte de la chaîne d'agents EXACTEMENT comme un stream LLM.
          // PACING (2026-11-02 soir — « l'effet construction du preview
          // n'existe plus ») : en rafale (aucune attente), TOUT le HTML
          // arrivait en < 100 ms → LivePaint/stitch/SSE fires consommaient
          // tout d'un coup : plus de construction visible du tout. ~45 ms
          // par tranche ≈ 3 Ko/s : les sections arrivent l'une après l'autre
          // (skeleton → pose → ✓) comme sur un stream LLM réel.
          const chunkSize = 140;
          for (let i = 0; i < agentChain.text.length; i += chunkSize) {
            if (clientGone || cancelFlag.cancelled) return;
            yield agentChain.text.slice(i, i + chunkSize);
            if (i + chunkSize < agentChain.text.length) {
              await new Promise<void>((resolve) => setTimeout(resolve, 45));
            }
          }
        })();
        emitNamed('on_agent_chain_complete', {
          steps: agentChain.steps,
          chars: agentChain.text.length
        });
        emit({ type: 'chat', text: `La chaîne d agents a fini son travail (Décision → Architecture → Agent UI → Agent Backend → Agent Sécurité) — j assemble la page ${isModification ? 'et j applique les modifications' : 'section par section'} !`, scripted: true });
        logger.info('Génération : le flux provient de la CHAÎNE D AGENTS (la chaîne a produit le HTML)', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          chars: agentChain.text.length,
          steps: agentChain.steps.map((s) => `${s.step}=${s.status}(${s.credentialProviderId ?? '-'})`).join(' ')
        });
      } else {
        logger.warn('Chaîne d agents non exploitable — repli sur l appel direct au provider', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          reason: agentChain.ok ? 'sortie sans <SECTION>' : (agentChain.reason ?? 'chaîne en échec'),
          failures: agentChainFailures.join(',')
        });
        emitNamed('on_agent_chain_fallback', {
          reason: agentChain.ok ? 'sortie sans SECTION' : (agentChain.reason ?? 'chain-failed'),
          activity: {
            id: 'agent-chain-fallback',
            type: 'agent',
            action: 'Chaîne d agents',
            status: 'FAILED',
            title: `indisponible — appel direct utilisé (${agentChain.ok ? 'sortie sans SECTION' : (agentChain.reason ?? 'chain-failed')})`,
            detail: { failures: agentChainFailures.join(',') }
          }
        });
      }
    } catch (chainError) {
      logger.warn('Chaîne d agents en erreur — repli sur l appel direct au provider', {
        component: 'conversation-route-stream',
        tenantId: context.tenantId,
        projectId,
        error: chainError instanceof Error ? chainError.message : String(chainError)
      });
      emitNamed('on_agent_chain_fallback', {
        reason: 'agent-chain-exception',
        activity: {
          id: 'agent-chain-fallback',
          type: 'agent',
          action: 'Chaîne d agents',
          status: 'FAILED',
          title: `indisponible — appel direct utilisé (${chainError instanceof Error ? chainError.message.slice(0, 80) : 'agent-chain-exception'})`
        }
      });
    }
    try {
      providerWaitTicker = setInterval(() => {
        if (!firstTokenSeen && !clientGone) {
          emitNamed('on_provider_waiting', { elapsedMs: Date.now() - llmWaitStart });
        }
      }, 2000);
      // CHAÎNE D'AGENTS — la source finale du stream : le texte produit par
      // la chaîne (UI → Backend → Sécurité) s'il existe, sinon l'appel direct
      // historique tel quel (plamen repli, non-régression stricte).
      // É53 LOT E3 — CORRECTION A : le signal du tour atteint le transport
      // HTTP de l'adapter streaming réellement utilisé par /stream (repli
      // appel direct : Mistral/Gemini/openai-compatible selon le registre).
      // @ts-expect-error — generateStream existe sur les adaptateurs concrets (Mistral/Gemini)
      const legacyStream: unknown = upstreamSource ? null : adapter.generateStream(
        {
          tenantId: context.tenantId,
          projectId,
          prompt: userPrompt,
          systemPrompt,
          temperature: 0.4,
          maxTokens: 8192,
          timeoutMs: 120000,
          requestId,
          signal: turnAbortController.signal
        },
        resolveStreamCredentials(req, context.tenantId, adapter.descriptor.providerId)
      );
      const stream = (upstreamSource ?? legacyStream) as AsyncIterable<string>;
      if (upstreamSource) firstTokenSeen = true;

      for await (const chunk of stream) {
        if (clientGone || cancelFlag.cancelled) break;
        firstTokenSeen = true;
        fullText += chunk;

        // Détecte l'ouverture d'une nouvelle section <SECTION name="...">
        // Regex enrichie pour capter aussi le mode (modify/add/delete) et after
        const openMatch = fullText.match(/<SECTION\s+name=["']([^"']+)["']\s*(?:\s+mode=["']([^"']+)["'])?\s*(?:\s+after=["']([^"']+)["'])?\s*>/);
        if (!inSection && openMatch && openMatch.index !== undefined) {
          // Le texte avant la section est du thinking/chat conversationnel
          const textBeforeSection = fullText.slice(0, openMatch.index);
          // É52 — capture de l'empreinte design émise en préambule
          // (commentaire HTML invisible dans le chat rendu)
          const preambleDna = extractDesignDna(textBeforeSection);
          if (preambleDna.dna && !streamDesignDna) streamDesignDna = preambleDna.dna;
          if (textBeforeSection.trim()) {
            // Nettoie les marqueurs de section déjà émis + le bloc DNA
            // + tout commentaire HTML (LOT LEAK-FIX : <!-- PAGE_TITLE: … -->
            // ne doit pas fuir dans la bulle de chat).
            const cleanText = stripHtmlComments(preambleDna.cleaned).replace(/<SECTION[^>]*>/g, '').trim();
            if (cleanText) {
              sendSSE({ type: 'chat', text: cleanText });
            }
          }
          inSection = true;
          currentSectionName = openMatch[1] || '';
          currentSectionMode = openMatch[2] || 'create';
          currentSectionAfter = openMatch[3] || '';
          currentSectionHtml = '';
          currentSectionText = '';
          sectionIndex++;
          if (recorder) executionStore.transitionPhase(executionId, 'IMPLEMENT');
          emit({ type: 'compass', state: 'EXECUTING' });
          emit({
            type: 'section_start',
            name: currentSectionName,
            mode: currentSectionMode,
            after: currentSectionAfter,
            index: sectionIndex
          }, {
            type: currentSectionMode === 'delete' ? 'FILE_DELETED' : currentSectionMode === 'modify' ? 'FILE_MODIFIED' : 'FILE_CREATED',
            phase: 'IMPLEMENT',
            status: 'RUNNING',
            title: (currentSectionMode === 'delete'
              ? 'Suppression de la section '
              : currentSectionMode === 'modify'
                ? 'Modification de la section '
                : 'Construction de la section ') + currentSectionName,
            detail: { section: currentSectionName, mode: currentSectionMode, index: sectionIndex }
          });

          // Continue à accumuler le contenu de la section après le marqueur
          const afterMarker = fullText.slice(openMatch.index + openMatch[0].length);
          fullText = afterMarker;
          continue;
        }

        // Si on est dans une section, accumule le HTML
        if (inSection) {
          // Détecte la fermeture de section </SECTION>
          if (fullText.includes('</SECTION>')) {
            const closeIdx = fullText.indexOf('</SECTION>');
            const sectionContent = fullText.slice(0, closeIdx);

            // Sépare le texte court (avant le 1er tag HTML) du HTML réel
            const firstTagMatch = sectionContent.match(/<[a-zA-Z]/);
            if (firstTagMatch && firstTagMatch.index !== undefined) {
              currentSectionText = sectionContent.slice(0, firstTagMatch.index).trim();
              // LOT A-C2 — point de parse UNIQUE : balises Markdown et
              // enveloppes/fermetures orphelines partent ICI, avant que le
              // HTML n'atteigne serverSections (tous les chemins passent là).
              currentSectionHtml = sanitizeSectionHtml(currentSectionName, sectionContent.slice(firstTagMatch.index));
            } else {
              currentSectionText = sectionContent.trim();
              currentSectionHtml = '';
            }
            emit({
              type: 'section_end',
              name: currentSectionName,
              mode: currentSectionMode,
              after: currentSectionAfter,
              index: sectionIndex,
              text: currentSectionText,
              html: currentSectionHtml
            }, {
              type: currentSectionMode === 'delete' ? 'FILE_DELETED' : currentSectionMode === 'modify' ? 'FILE_MODIFIED' : 'FILE_CREATED',
              phase: 'IMPLEMENT',
              status: 'COMPLETED',
              title: 'Section ' + currentSectionName + ' générée',
              detail: { section: currentSectionName, mode: currentSectionMode, chars: currentSectionHtml.length }
            });

            // === ACCUMULE LA SECTION CÔTÉ SERVEUR pour sauvegarde finale ===
            serverSections.push({
              name: currentSectionName,
              mode: currentSectionMode,
              after: currentSectionAfter,
              html: currentSectionHtml
            });

            // Reset pour la prochaine section
            inSection = false;
            currentSectionName = '';
            currentSectionMode = 'create';
            currentSectionAfter = '';
            currentSectionHtml = '';
            currentSectionText = '';
            fullText = fullText.slice(closeIdx + '</SECTION>'.length);
            continue;
          }

          // Pendant la section : envoie juste le chat text qui précède les tags HTML
          sendSSE({ type: 'token', token: chunk });
        } else {
          // Hors section : texte conversationnel normal
          sendSSE({ type: 'token', token: chunk });
        }
      }

      // T5 — annulation explicite de l'utilisateur : on n'assemble ni ne
      // sauvegarde rien, on enregistre CANCELLED (⏹ pas ❌, CDC §20) et on
      // prévient le client qui a demandé l'arrêt.
      // É53 LOT E2 — POINT DE CONTRÔLE n°0 : immédiatement après la boucle de
      // génération — ni drain, ni assemblage, ni mutation, ni persistance.
      // Le contrôle est centralisé (`cancelInterrupted`) : il consomme
      // l'arbitrage E1 et émet ⏹ une seule fois.
      if (cancelInterrupted()) {
        logger.warn('Génération annulée par l\'utilisateur — HTML non sauvegardé', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          charsReceived: fullText.length
        });
        return true;
      }

      // Client parti en cours de génération : on n'assemble ni ne sauvegarde un
      // HTML partiel (on éviterait d'écraser le fichier existant avec du contenu
      // tronqué) ; le finally ci-dessous ferme proprement la réponse.
      if (clientGone) {
        logger.warn('Client déconnecté pendant le stream — génération interrompue, HTML non sauvegardé', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          charsReceived: fullText.length
        });
        // Annulation honnête (⏹ pas ❌) : l'exécution reste consultable au replay.
        if (recorder) executionStore.cancelExecution(executionId, 'client_gone');
        return true;
      }

      // É53 LOT B — DRAIN FINAL DES FRONTIÈRES COMPLÈTES. La machine à états
      // ci-dessus ne traite QU'UNE frontière par itération : après une
      // ouverture (l.3203) ou une fermeture (l.3257), le `continue` reporte la
      // suite au chunk SUIVANT. Si le flux se termine juste après, la suite
      // n'était JAMAIS parsée : section_start sans section_end (section
      // perdue), troncature non détectée, contenu resté hors assemblage.
      // Ce drain rejoue la MÊME machine à états, à l'identique (mêmes frames
      // section_start/section_end, mêmes compteurs, même assainissement, même
      // capture DNA de préambule) sur ce qui reste, jusqu'à épuisement des
      // frontières complètes. Un reste SANS frontière complète est laissé au
      // traitement final (chat final / détection de troncature ci-dessous).
      let drainIterations = 0;
      while (!cancelFlag.cancelled && !clientGone && drainIterations < 200) {
        drainIterations++;
        if (inSection) {
          // Miroir du traitement de fermeture (l.3209-3256).
          const drainCloseIdx = fullText.indexOf('</SECTION>');
          if (drainCloseIdx === -1) break; // frontière incomplète → troncature
          const drainContent = fullText.slice(0, drainCloseIdx);
          const drainTag = drainContent.match(/<[a-zA-Z]/);
          if (drainTag && drainTag.index !== undefined) {
            currentSectionText = drainContent.slice(0, drainTag.index).trim();
            currentSectionHtml = sanitizeSectionHtml(currentSectionName, drainContent.slice(drainTag.index));
          } else {
            currentSectionText = drainContent.trim();
            currentSectionHtml = '';
          }
          emit({
            type: 'section_end',
            name: currentSectionName,
            mode: currentSectionMode,
            after: currentSectionAfter,
            index: sectionIndex,
            text: currentSectionText,
            html: currentSectionHtml
          }, {
            type: currentSectionMode === 'delete' ? 'FILE_DELETED' : currentSectionMode === 'modify' ? 'FILE_MODIFIED' : 'FILE_CREATED',
            phase: 'IMPLEMENT',
            status: 'COMPLETED',
            title: 'Section ' + currentSectionName + ' générée',
            detail: { section: currentSectionName, mode: currentSectionMode, chars: currentSectionHtml.length }
          });
          serverSections.push({
            name: currentSectionName,
            mode: currentSectionMode,
            after: currentSectionAfter,
            html: currentSectionHtml
          });
          inSection = false;
          currentSectionName = '';
          currentSectionMode = 'create';
          currentSectionAfter = '';
          currentSectionHtml = '';
          currentSectionText = '';
          fullText = fullText.slice(drainCloseIdx + '</SECTION>'.length);
          continue;
        }
        // Miroir du traitement d'ouverture (l.3156-3202).
        const drainOpen = fullText.match(/<SECTION\s+name=["']([^"']+)["']\s*(?:\s+mode=["']([^"']+)["'])?\s*(?:\s+after=["']([^"']+)["'])?\s*>/);
        if (!drainOpen || drainOpen.index === undefined) break; // reste = chat final
        const drainBefore = fullText.slice(0, drainOpen.index);
        const drainDna = extractDesignDna(drainBefore);
        if (drainDna.dna && !streamDesignDna) streamDesignDna = drainDna.dna;
        if (drainBefore.trim()) {
          const drainClean = stripHtmlComments(drainDna.cleaned).replace(/<SECTION[^>]*>/g, '').trim();
          if (drainClean) {
            sendSSE({ type: 'chat', text: drainClean });
          }
        }
        inSection = true;
        currentSectionName = drainOpen[1] || '';
        currentSectionMode = drainOpen[2] || 'create';
        currentSectionAfter = drainOpen[3] || '';
        currentSectionHtml = '';
        currentSectionText = '';
        sectionIndex++;
        if (recorder) executionStore.transitionPhase(executionId, 'IMPLEMENT');
        emit({ type: 'compass', state: 'EXECUTING' });
        emit({
          type: 'section_start',
          name: currentSectionName,
          mode: currentSectionMode,
          after: currentSectionAfter,
          index: sectionIndex
        }, {
          type: currentSectionMode === 'delete' ? 'FILE_DELETED' : currentSectionMode === 'modify' ? 'FILE_MODIFIED' : 'FILE_CREATED',
          phase: 'IMPLEMENT',
          status: 'RUNNING',
          title: (currentSectionMode === 'delete'
            ? 'Suppression de la section '
            : currentSectionMode === 'modify'
              ? 'Modification de la section '
              : 'Construction de la section ') + currentSectionName,
          detail: { section: currentSectionName, mode: currentSectionMode, index: sectionIndex }
        });
        fullText = fullText.slice(drainOpen.index + drainOpen[0].length);
      }

      // É53 LOT E2 — POINT DE CONTRÔLE n°1 : après le drainage de la
      // génération — aucune étape ultérieure (chat final, assemblage,
      // persistance) ne continue inutilement.
      if (cancelInterrupted()) {
        logger.warn('Génération annulée après le drainage — assemblage et persistance annulés', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId
        });
        return true;
      }

      // À la fin, envoie tout texte restant comme chat final. Si une section
      // reste OUVERTE (drain épuisé : frontière incomplète), ce reste est le
      // CONTENU de cette section — jamais du chat : ne pas le réémettre.
      if (fullText.trim() && !inSection) {
        // LOT LEAK-FIX — même assainissement que le préambule : les
        // commentaires internes (PAGE_TITLE…) ne fuient pas en clôture.
        const cleanText = stripHtmlComments(fullText.replace(/<SECTION[^>]*>[\s\S]*?<\/SECTION>/g, '')).trim();
        if (cleanText) {
          sendSSE({ type: 'chat', text: cleanText });
        }
      }

      // É53 LOT E2 — POINT DE CONTRÔLE n°2 : avant l'assemblage HTML final.
      if (cancelInterrupted()) {
        logger.warn('Génération annulée avant l\'assemblage HTML', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId
        });
        return true;
      }

      // === ASSEMBLE LE HTML FINAL ET SAUVEGARDE DANS FILESTORE ===
      // Pour que la prochaine demande de modification trouve un HTML existant.
      // B1 — TRONCATURE : une section ouverte jamais refermée = sortie LLM
      // coupée (maxTokens) ou marqueur oublié. Avant, la page incomplète
      // était assemblée et notée sans prévenir.
      const truncatedGeneration = inSection;
      if (truncatedGeneration) {
        logger.warn('Génération incomplète : section ouverte jamais refermée', {
          component: 'conversation-route-stream',
          sectionsClosed: serverSections.length
        });
      }
      let assembledHtml = '';
      // T4 — diffs réels par section, émis au client et persistés.
      // É53 LOT B — `targetFound` distingue « cible trouvée, contenu identique »
      // (écho fidèle du LLM : livré sans changement de bytes) d'une vraie cible
      // introuvable (non livrée). Pur ajout d'information : aucune logique de
      // merge modifiée (zones Lot A intactes).
      const sectionDiffs: Array<{ name: string; mode: string; applied: boolean; targetFound: boolean; added: number; removed: number }> = [];

      if (isModificationMode && currentHtml) {
        // Mode modification : on part du HTML existant et on applique les modifications
        // Détecte les sections existantes dans le HTML actuel via les data-section
        // ou par les IDs des balises <section>, <header>, <footer>, etc.
        // Pour simplifier, on parse les balises principales.

        // Pour chaque section modifiée par l'IA, on remplace dans le HTML existant.
        // T4 — diff réel capturé par section (bloc remplacé vs nouveau bloc) ;
        // `applied` dit la VÉRITÉ du merge : un regex qui ne matche pas n'est
        // pas une modification appliquée.
        let modifiedHtml = currentHtml;
        for (const sec of serverSections) {
          const htmlBeforeSection = modifiedHtml;
          let oldBlock = '';
          if (sec.mode === 'delete') {
            // Supprime la section existante avec cet attribut data-section
            const deleteRegex = new RegExp(`<div[^>]*data-section="${sec.name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'g');
            const deleteMatch = deleteRegex.exec(modifiedHtml);
            if (deleteMatch) oldBlock = deleteMatch[0];
            modifiedHtml = modifiedHtml.replace(new RegExp(deleteRegex.source, 'g'), '');
            // Ou supprime par ID de section
            const idRegex = new RegExp(`<section[^>]*id="${sec.name}"[^>]*>[\\s\\S]*?<\\/section>`, 'g');
            const idMatch = idRegex.exec(modifiedHtml);
            if (idMatch && !oldBlock) oldBlock = idMatch[0];
            modifiedHtml = modifiedHtml.replace(new RegExp(idRegex.source, 'g'), '');
            // Ou supprime par balise (header, footer, etc.)
            if (sec.name === 'header' || sec.name === 'footer' || sec.name === 'nav') {
              const tagRegex = new RegExp(`<${sec.name}[\\s\\S]*?<\\/${sec.name}>`, 'g');
              const tagMatch = tagRegex.exec(modifiedHtml);
              if (tagMatch && !oldBlock) oldBlock = tagMatch[0];
              modifiedHtml = modifiedHtml.replace(new RegExp(tagRegex.source, 'g'), '');
            }
          } else if (sec.mode === 'modify' && sec.html) {
            // Remplace la section existante par la nouvelle version
            // IMPORTANT : sec.html peut déjà contenir un wrapper <div data-section="...">
            // si le LLM l'a inclus (cf system prompt example). On ne re-wrappe PAS.
            // LOT A-C2 — sanitizeSectionHtml remplace l'unwrap fragile : il ne
            // coupe un `</div>` final QUE si l'équilibre div le confirme, et
            // retire les balises Markdown avant (idempotent sur HTML propre).
            const cleanHtml = sanitizeSectionHtml(sec.name, sec.html);
            // Tente par data-section d'abord (notre format stitchReveal)
            const dataAttrRegex = new RegExp(`<div[^>]*data-section="${sec.name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'g');
            const dataMatch = dataAttrRegex.exec(modifiedHtml);
            const foundByData = dataMatch !== null;
            if (dataMatch) oldBlock = dataMatch[0];
            const before = modifiedHtml;
            modifiedHtml = modifiedHtml.replace(new RegExp(dataAttrRegex.source, 'g'), `<div class="vibe-stitched" data-section="${sec.name}">${cleanHtml}</div>`);
            // Si pas de remplacement, tente par ID de section
            // LOT A-C2 — le gardien teste l'existence de la cible, pas l'identité du
            // fichier : un replace byte-identique (écho fidèle du LLM d'une section
            // inchangée) n'est PAS un échec de recherche. Sur `=== before`, les replis
            // s'enclenchaient à tort sur chaque écho fidèle : l'id-path double-emboîtait
            // la section (wrapper externe évincé ensuite par dedupe → un `</div>` en
            // excès par bloc, +4 constatés en campagne) et le repli P3 insérait un
            // doublon avant </body> (résidu `\n` dans le squelette après éviction).
            if (!foundByData) {
              const idRegex = new RegExp(`<section[^>]*id="${sec.name}"[^>]*>[\\s\\S]*?<\\/section>`, 'g');
              const idMatch = idRegex.exec(modifiedHtml);
              if (idMatch && !oldBlock) oldBlock = idMatch[0];
              const before2 = modifiedHtml;
              // STITCH : même contrat que le chemin data-section — la section
              // insérée porte TOUJOURS son wrapper data-section (halo,
              // diff-guard et ancrages des générations suivantes en dépendent).
              modifiedHtml = modifiedHtml.replace(new RegExp(idRegex.source, 'g'), `<div class="vibe-stitched" data-section="${sec.name}">${sanitizeSectionHtml(sec.name, sec.html)}</div>`);
              // Si toujours pas, tente par balise (header, footer, nav)
              if (modifiedHtml === before2 && (sec.name === 'header' || sec.name === 'footer' || sec.name === 'nav')) {
                const tagRegex = new RegExp(`<${sec.name}[\\s\\S]*?<\\/${sec.name}>`, 'g');
                const tagMatch = tagRegex.exec(modifiedHtml);
                if (tagMatch && !oldBlock) oldBlock = tagMatch[0];
                modifiedHtml = modifiedHtml.replace(new RegExp(tagRegex.source, 'g'), `<div class="vibe-stitched" data-section="${sec.name}">${sanitizeSectionHtml(sec.name, sec.html)}</div>`);
              }
              // P3-fix — mode="modify" sur un nom INEXISTANT (l'IA a inventé
              // un nom, ex: « navbar » au lieu de « header ») : la section
              // n'est PAS perdue — elle est ajoutée en fin de page (même
              // fallback que le mode add). Sinon « Diff … non appliqué » à
              // chaque génération et le travail de l'IA est jeté.
              if (modifiedHtml === before) {
                const bodyClose = modifiedHtml.lastIndexOf('</body>');
                if (bodyClose !== -1) {
                  modifiedHtml = modifiedHtml.slice(0, bodyClose)
                    + `\n<div class="vibe-stitched" data-section="${sec.name}">${cleanHtml}</div>\n`
                    + modifiedHtml.slice(bodyClose);
                }
              }
            }
          } else if (sec.mode === 'add' && sec.html) {
            // UNICITÉ (audit preview) : une section « ajoutée » dont le nom
            // existe DÉJÀ est un REMPLACEMENT, pas un doublon — sinon chaque
            // génération ré-émettant header/footer empilait des copies
            // (footer ×3, header ×2 constatés en production).
            const cleanAddHtml = sanitizeSectionHtml(sec.name, sec.html);
            const existsRe = new RegExp(`<div[^>]*data-section="${sec.name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'i');
            const existing = existsRe.exec(modifiedHtml);
            if (existing) {
              oldBlock = existing[0];
              modifiedHtml = modifiedHtml.replace(new RegExp(existsRe.source, 'i'), `<div class="vibe-stitched" data-section="${sec.name}">${cleanAddHtml}</div>`);
            } else {
              // SANS flag /g : si le document contient plusieurs sections du même
              // nom d'ANCRE, la section ajoutée ne doit apparaître qu'après la
              // PREMIÈRE ancre (sinon duplications en cascade).
              const afterRegex = new RegExp(`(<div[^>]*data-section="${sec.after}"[^>]*>[\\s\\S]*?</div>)(\\s*<div[^>]*data-section)`);
              const before = modifiedHtml;
              modifiedHtml = modifiedHtml.replace(afterRegex, `$1\n<div class="vibe-stitched" data-section="${sec.name}">${cleanAddHtml}</div>$2`);
              if (modifiedHtml === before) {
                // Tente par ID — avec wrapper (même contrat que le chemin principal)
                const idAfterRegex = new RegExp(`(<section[^>]*id="${sec.after}"[^>]*>[\\s\\S]*?<\\/section>)`, 'g');
                modifiedHtml = modifiedHtml.replace(idAfterRegex, `$1\n<div class="vibe-stitched" data-section="${sec.name}">${sanitizeSectionHtml(sec.name, sec.html)}</div>`);
              }
              if (modifiedHtml === before) {
                // T4/T7 — l'ancre est la DERNIÈRE section : insertion avant
                // </body> (même convention que le client), sinon la section
                // générée serait perdue (applied:false pour rien).
                const bodyClose = modifiedHtml.lastIndexOf('</body>');
                if (bodyClose !== -1) {
                  modifiedHtml = modifiedHtml.slice(0, bodyClose)
                    + `\n<div class="vibe-stitched" data-section="${sec.name}">${cleanAddHtml}</div>\n`
                    + modifiedHtml.slice(bodyClose);
                }
              }
            }
          } else if (sec.mode === 'create' && sec.html) {
            // UNICITÉ : « create » sur un nom déjà présent = remplacement
            // (le LLM ré-émet souvent header/footer en mode create — sans
            // cette garde, chaque génération ajoutait un doublon en fin de page).
            const cleanCreateHtml = sanitizeSectionHtml(sec.name, sec.html);
            const existsRe = new RegExp(`<div[^>]*data-section="${sec.name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'i');
            const existing = existsRe.exec(modifiedHtml);
            if (existing) {
              oldBlock = existing[0];
              modifiedHtml = modifiedHtml.replace(new RegExp(existsRe.source, 'i'), `<div class="vibe-stitched" data-section="${sec.name}">${cleanCreateHtml}</div>`);
            } else {
              modifiedHtml += `<div class="vibe-stitched" data-section="${sec.name}">${cleanCreateHtml}</div>`;
            }
          }
          // T4 — delta réel de la section (bloc remplacé vs contenu généré)
          const applied = modifiedHtml !== htmlBeforeSection;
          const delta = countLineDelta(oldBlock, sec.mode === 'delete' ? '' : (sec.html || ''));
          sectionDiffs.push({ name: sec.name, mode: sec.mode, applied, targetFound: Boolean(oldBlock), added: delta.added, removed: delta.removed });
        }
        // B2 — le merge préserve l'ordre d'arrivée : on réordonne les blocs
        // (footer TOUJOURS dernier), sans toucher au reste du document.
        modifiedHtml = canonicalSectionOrderBlocks(modifiedHtml);
        assembledHtml = modifiedHtml;
      } else {
        // Mode création : assemble dans l'ORDRE CANONIQUE (le LLM émet
        // parfois footer en 2e — le fichier suivait aveuglément).
        // T4 — en création, tout est ajout : delta réel par section.
        for (const sec of canonicalSectionOrder(serverSections)) {
          if (sec.html) {
            const cleanCreateHtml = sanitizeSectionHtml(sec.name, sec.html);
            assembledHtml += `<div class="vibe-stitched" data-section="${sec.name}">${cleanCreateHtml}</div>\n`;
            sectionDiffs.push({ name: sec.name, mode: sec.mode || 'create', applied: true, targetFound: true, added: countLineDelta('', cleanCreateHtml).added, removed: 0 });
          }
        }
      }

      // === ENVELOPPE DANS UN DOCUMENT COMPLET SI FRAGMENTS ===
      // En création, assembledHtml est une suite de <div data-section>. Le
      // sauvegarder brut laissait le fichier sans <head> (Tailwind, polices)
      // et cassait le contexte des tours suivants. Un document complet est
      // envoyé au client ET sauvegardé — le client détecte le DOCTYPE et ne
      // ré-emballe pas (même convention que buildHtmlDoc côté Studio).
      // UNICITÉ — déduplication douce avant sauvegarde : la dernière
      // occurrence de chaque data-section gagne (assainit les fichiers
      // pollués par les générations antérieures).
      assembledHtml = dedupeSectionBlocks(assembledHtml);
      // Images : repli anti-casse (même politique que le canvas Builder E46) —
      // toute <img> http(s) sans onerror bascule vers un repli fiable
      // si elle meurt DANS le navigateur du visiteur (zéro latence serveur,
      // zéro faux positif réseau : seul l'échec réel déclenche).
      // B3/F1 — sanitize D'ABORD, avec le THÈME déjà calculé (les URLs hors
      // réservoir repartent dans le réservoir du thème, pas vers du
      // générique), fallback ensuite.
      const sanitized = sanitizeImageSources(assembledHtml, imageTheme, imageSeed, dynamicImages);
      if (sanitized.replaced > 0) {
        logger.warn('Sanitizer images : URLs non autorisées réécrites vers le thème', {
          component: 'conversation-route-stream',
          replaced: sanitized.replaced
        });
      }
      if (sanitized.thematicRewrites > 0) {
        logger.warn('Sanitizer thématique : images légales hors secteur remplacées', {
          component: 'conversation-route-stream',
          thematicRewrites: sanitized.thematicRewrites
        });
      }
      // F4 — sources REÇUES (pré-sanitisation) : les URLs du LLM, avant toute
      // réécriture. Pas de secret (URLs publiques), borné à 20 images.
      let receivedSectionImages: ReturnType<typeof extractSectionImages> = [];
      try {
        receivedSectionImages = extractSectionImages(assembledHtml);
        logger.info('Images reçues par section (pré-sanitisation P0)', {
          component: 'conversation-route-stream',
          projectId,
          executionId,
          imageTheme,
          imageCount: receivedSectionImages.length,
          images: receivedSectionImages.slice(0, 20)
        });
      } catch {
        // traçabilité best-effort : jamais bloquante pour la sauvegarde
      }
      assembledHtml = addImageFallbacks(sanitized.html, imageTheme, imageSeed);
      // F4 — trace concise : sources conservées dans le HTML qui va être
      // sauvegardé, avec correspondance reçu → conservé (paires par index :
      // ni le sanitizer ni les fallbacks ne changent la structure du doc).
      try {
        const finalSectionImages = extractSectionImages(assembledHtml);
        logger.info('Images conservées dans le HTML final (F4)', {
          component: 'conversation-route-stream',
          projectId,
          executionId,
          imageTheme,
          replacedBySanitizer: sanitized.replaced,
          thematicRewrites: sanitized.thematicRewrites,
          finalCount: finalSectionImages.length,
          images: buildFinalImageTrace(receivedSectionImages, finalSectionImages)
        });
      } catch {
        // traçabilité best-effort : jamais bloquante pour la sauvegarde
      }
      if (assembledHtml.trim().length > 100) {
        // Titre réel du commerce (marqueur PAGE_TITLE, sinon titre/h1 existant),
        // jamais générique. Le marqueur est retiré dans les deux modes.
        const assembledTitle = extractPageTitle(assembledHtml);
        assembledHtml = assembledTitle.cleaned;
        if (!/<!DOCTYPE|<html[\s>]/i.test(assembledHtml)) {
          // É52 — DNA captée du préambule OU d'un bloc résiduel dans les sections
          const assembledDna = extractDesignDna(assembledHtml);
          assembledHtml = assembledDna.cleaned;
          const finalTitle = assembledTitle.title ?? deriveFallbackTitle(assembledHtml) ?? undefined;
          assembledHtml = buildStudioShell(assembledHtml, streamDesignDna ?? assembledDna.dna ?? undefined, finalTitle);
        } else {
          // LOT POLISH — document existant : réconcilier le <title> avec le h1
          // réel sans reconstruire le shell ni déplacer le contenu.
          assembledHtml = applyReconciledPageTitle(assembledHtml, assembledTitle.title);
        }
      }

      // LOT 3 — Compass : phase de validation avant la sauvegarde finale
      if (recorder) executionStore.transitionPhase(executionId, 'VALIDATE');
      emit({ type: 'compass', state: 'VALIDATING' });
      emit({ type: 'chat', text: 'Je vérifie le rendu réel…', scripted: true });

      // Sauvegarde dans fileStore pour que la prochaine demande trouve le HTML
      let savedRevisionId: string | undefined;
      let gateEligible = false;
      // V7-WIRE-2 — la persistance du HTML passe par le Mutation Orchestrator
      // (AINT-006) : plan CREATE/UPDATE, validation, snapshot, diff,
      // vérification post-écriture et rollback automatique. Si le moteur
      // n'est pas injecté, le repli direct reste possible mais il est TRACÉ
      // (MUTATION_FALLBACK) — jamais silencieux.
      let persistenceError: string | undefined;
      // É53 LOT B — FAITS DE VÉRITÉ (audit §3). La décision de persistance et
      // le verdict final reposent sur ces faits, JAMAIS sur la longueur du
      // HTML ni sur l'annonce du LLM :
      //   - en modification, il faut au moins une section dont les bytes ont
      //     réellement changé (un écho identique n'est pas un changement) ;
      //   - en création, il faut au moins une section avec du contenu réel.
      const truthSectionFacts = new Map<string, { applied: boolean; delivered: boolean }>();
      for (const diff of sectionDiffs) {
        truthSectionFacts.set(diff.name, { applied: diff.applied, delivered: diff.applied || diff.targetFound });
      }
      const changedSectionCount = sectionDiffs.filter((d) => d.applied).length;
      const hasExploitableChange = isModificationMode
        ? changedSectionCount > 0
        : serverSections.some((s) => (s.html || '').trim().length > 0);
      // É53 LOT E2 — attemptedPersistence/mutationApplied/fallbackWritten/
      // persistedVerified sont déclarés avec le contrôle centralisé (tôt dans
      // le handler) ; les affectations ci-dessous gardent leur place.
      // V7-LOT5 — préflight d'ingénierie sur le contenu candidat, AVANT la
      // mutation. Il bloque uniquement les défauts durs (enveloppe absente,
      // contenu vide/nul, taille hors plafond) ; les alertes restent
      // consultatives et le Quality Gate visuel garde l'autorité de score.
      let engineeringValidation: EngineeringPreflightReport | null = null;
      // É53 LOT E2 — POINT DE CONTRÔLE n°3 : avant le préflight d'ingénierie.
      if (cancelInterrupted()) {
        logger.warn('Génération annulée avant le préflight — aucune persistance tentée', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId
        });
        return true;
      }
      if (hasExploitableChange && assembledHtml.trim().length > 100) {
        attemptedPersistence = true;
        engineeringValidation = runEngineeringPreflight(assembledHtml, STREAM_MUTATION_PATH);
        emitNamed('on_engineering_validated', {
          verdict: engineeringValidation.verdict,
          passed: engineeringValidation.passed,
          path: engineeringValidation.path,
          contentHash: engineeringValidation.contentHash,
          byteLength: engineeringValidation.byteLength,
          lineCount: engineeringValidation.lineCount,
          blockers: [...engineeringValidation.blockers],
          warnings: [...engineeringValidation.warnings],
          checks: engineeringValidation.checks.map((item) => ({
            id: item.id,
            label: item.label,
            status: item.status,
            detail: item.detail
          }))
        }, {
          type: engineeringValidation.passed ? 'VALIDATION_COMPLETED' : 'VALIDATION_FAILED',
          phase: 'VALIDATE',
          status: engineeringValidation.passed ? 'COMPLETED' : 'FAILED',
          title: `Préflight d'ingénierie : ${engineeringValidation.verdict} (${engineeringValidation.checks.length} contrôles)`,
          detail: {
            stage: 'ENGINEERING_PREFLIGHT',
            verdict: engineeringValidation.verdict,
            contentHash: engineeringValidation.contentHash,
            byteLength: engineeringValidation.byteLength,
            checks: engineeringValidation.checks.length,
            blockers: engineeringValidation.blockers.length,
            warnings: engineeringValidation.warnings.length
          }
        });
        if (!engineeringValidation.passed) {
          persistenceError = `Préflight d'ingénierie refusé : ${engineeringValidation.blockers.join(' | ')}`;
          logger.warn('Préflight d ingénierie refusé : aucune écriture tentée', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId,
            blockers: engineeringValidation.blockers
          });
        } else {
        // É50 — GARDE-FOU D'EXFILTRATION (P0 S8) : contrôle déterministe du
        // contenu candidat à la frontière de persistance, AVANT la mutation.
        // Situé à ce point de bifurcation, il couvre à la fois le Mutation
        // Orchestrator et le repli direct fileStore.saveFile ci-dessous.
        // Refus par défaut : toute destination réseau absolu non whitelistée
        // (ou non parseable) bloque l'écriture — indépendant des prompts LLM.
        const exfiltrationReport = runExfiltrationGuard(assembledHtml, STREAM_MUTATION_PATH);
        emitNamed('on_security_scan_completed', {
          verdict: exfiltrationReport.verdict,
          passed: exfiltrationReport.passed,
          path: exfiltrationReport.path,
          contentHash: exfiltrationReport.contentHash,
          byteLength: exfiltrationReport.byteLength,
          findings: exfiltrationReport.findings.map((f) => ({ id: f.id, channel: f.channel, destination: f.destination, severity: f.severity })),
          blockers: [...exfiltrationReport.blockers],
          warnings: [...exfiltrationReport.warnings]
        }, {
          type: exfiltrationReport.passed ? 'VALIDATION_COMPLETED' : 'VALIDATION_FAILED',
          phase: 'VALIDATE',
          status: exfiltrationReport.passed ? 'COMPLETED' : 'FAILED',
          title: `Garde-fou exfiltration : ${exfiltrationReport.verdict} (${exfiltrationReport.findings.length} constats)`,
          detail: {
            stage: 'EXFILTRATION_GUARD',
            verdict: exfiltrationReport.verdict,
            contentHash: exfiltrationReport.contentHash,
            byteLength: exfiltrationReport.byteLength,
            blockers: exfiltrationReport.blockers.length,
            warnings: exfiltrationReport.warnings.length
          }
        });
        if (!exfiltrationReport.passed) {
          persistenceError = describeExfiltrationBlocker(exfiltrationReport);
          logger.warn('Garde-fou exfiltration refusé : aucune écriture tentée', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId,
            blockers: exfiltrationReport.blockers
          });
        } else {
        // É53 LOT E2 — POINT DE CONTRÔLE n°4 : avant l'appel au Mutation
        // Orchestrator et avant TOUTE persistance. L'écriture orchestrée et
        // le repli direct sont dans le bloc ci-dessous SANS await entre eux :
        // ce contrôle unique arme le CAS B au plus près de l'écriture.
        if (cancelInterrupted()) {
          logger.warn('Génération annulée avant la mutation — fichier intact', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId
          });
          return true;
        }
        try {
          const existingFile = fileStore.getFile(context.tenantId, projectId, STREAM_MUTATION_PATH);
          const fileExists = Boolean(existingFile);
          // É53 LOT B — source du contrat : le placeholder pristine d'un
          // projet neuf n'est pas un contenu à préserver (voir
          // DEFAULT_PROJECT_SEED_HTML) ; tout autre contenu reste la source
          // de préservation intégrale.
          const contractSourceHtml = !isModificationMode && existingFile?.content === DEFAULT_PROJECT_SEED_HTML
            ? ''
            : (existingFile?.content ?? '');
          // É53 LOT B — CRÉATION EXPLICITE = REMPLACEMENT (comportement
          // documenté E48 : « crée un site » alors qu'un fichier existe doit
          // REMPLACER le fichier, pas fusionner dedans). Le client a demandé
          // un site frais : le site précédent n'est PAS un contenu à
          // préserver, sinon toute relance de création échouait au contrat
          // (PROTECTED_CONTENT_LOST). Un contrat scope « creation » est
          // construit ICI (contract.ts importé, Lot A gelé — aucune
          // modification de ce fichier) et fourni au pont, qui le vérifie
          // comme n'importe quel contrat. En modification, le contrat reste
          // construit par le pont (préservation intégrale du site existant).
          const replaceContract = !isModificationMode
            ? buildMutationContract({
                beforeHtml: contractSourceHtml,
                userMessage: body.message || '',
                intentCategory: 'CREATE',
                targetFiles: [STREAM_MUTATION_PATH],
                mode: 'create'
              })
            : undefined;
          const mutationOutcome = applyStreamFileMutationWithStreamEngine({
            tenantId: context.tenantId,
            projectId,
            requestId,
            role: context.role,
            content: assembledHtml,
            mode: fileExists ? 'update' : 'create',
            riskLevel: impactSummary?.riskLevel,
            // LOT A (É53) — MUTATION CONTRACT : le HTML existant (source de
            // préservation) + la demande réelle + l'intention calculée. Le
            // pont construit le contrat, vérifie la préservation AVANT toute
            // écriture, et refuse fail-closed toute perte non autorisée.
            existingContent: contractSourceHtml,
            userMessage: body.message || '',
            intentCategory: realIntent?.category,
            ...(replaceContract ? { contract: replaceContract } : {})
          });

          if (mutationOutcome.applied) {
            // É53 LOT B — écriture orchestrée confirmée : le moteur a exécuté
            // le plan ET les invariants post-écriture (CONTENT_PRESERVED).
            mutationApplied = true;
            // É53 LOT E1 — POINT DE LINÉARISATION DE LA PERSISTANCE : les
            // octets sont sur disque (écriture synchrone, rollback du moteur
            // déjà conclu à l'intérieur de l'appel). La claim est posée dans
            // le MÊME tick que l'écriture (aucun await entre les deux) :
            // toute annulation déjà demandée mais non encore consommée par la
            // route est désormais refusée honnêtement (CAS B) — l'écriture ne
            // peut plus être niée par un ⏹ tardif.
            executionStore.claimPersistenceWin(executionId);
            emit({
              type: mutationOutcome.mode === 'create' ? 'file_created' : 'file_modified',
              path: STREAM_MUTATION_PATH,
              planId: mutationOutcome.planId,
              transactionId: mutationOutcome.transactionId,
              added: mutationOutcome.addedLines,
              removed: mutationOutcome.removedLines
            }, {
              type: mutationOutcome.mode === 'create' ? 'FILE_CREATED' : 'FILE_MODIFIED',
              phase: 'IMPLEMENT',
              status: 'COMPLETED',
              title: mutationOutcome.mode === 'create'
                ? 'index.html créé (mutation atomique)'
                : 'index.html mis à jour (mutation atomique)',
              detail: {
                path: STREAM_MUTATION_PATH,
                engine: 'AINT-006',
                planId: mutationOutcome.planId,
                transactionId: mutationOutcome.transactionId,
                transactionHash: mutationOutcome.transactionHash,
                addedLines: mutationOutcome.addedLines,
                removedLines: mutationOutcome.removedLines,
                riskLevel: mutationOutcome.riskLevel,
                warnings: mutationOutcome.warnings.length
              }
            });
          } else if (mutationOutcome.stage === 'contract') {
            // LOT A (É53) — REFUS DU CONTRAT DE PRÉSERVATION : la mutation
            // proposée perdait du contenu protégé non autorisé (ou visait un
            // fichier hors périmètre). AUCUNE écriture : le repli direct est
            // INTERDIT ici — il persisterait le contenu rejeté (c'est le
            // contournement que le Lot A ferme). Le fichier existant reste
            // intact ; le flux s'arrête honnêtement (persistenceError).
            emit({
              type: 'mutation_contract_refused',
              path: STREAM_MUTATION_PATH,
              reason: mutationOutcome.reason
            }, {
              type: 'MUTATION_CONTRACT_REFUSED',
              phase: 'IMPLEMENT',
              status: 'FAILED',
              title: 'Modification refusée — contenu existant protégé',
              detail: {
                path: STREAM_MUTATION_PATH,
                engine: 'AINT-006',
                reason: mutationOutcome.reason,
                violations: mutationOutcome.contractViolations ?? []
              }
            });
            logger.warn('Contrat de mutation : écriture refusée avant persistance (aucun repli)', {
              component: 'conversation-route-stream',
              tenantId: context.tenantId,
              projectId,
              reason: mutationOutcome.reason,
              violations: mutationOutcome.contractViolations ?? []
            });
            persistenceError = `Modification refusée par le contrat de préservation : ${mutationOutcome.reason}`;
          } else if (mutationOutcome.stage === 'execution') {
            // L'écriture a été TENTÉE puis annulée par le rollback : interdiction
            // de rejouer un repli direct (on persisterait un contenu rejeté).
            emit({
              type: 'mutation_rolled_back',
              path: STREAM_MUTATION_PATH,
              reason: mutationOutcome.reason
            }, {
              type: 'MUTATION_ROLLED_BACK',
              phase: 'IMPLEMENT',
              status: 'FAILED',
              title: 'Mutation annulée — fichier restauré',
              detail: {
                path: STREAM_MUTATION_PATH,
                engine: 'AINT-006',
                reason: mutationOutcome.reason
              }
            });
            persistenceError = `La mutation de ${STREAM_MUTATION_PATH} a été annulée : ${mutationOutcome.reason}`;
          } else if (mutationOutcome.fallbackAllowed) {
            // É53 LOT B — INDISPONIBILITÉ TECHNIQUE du moteur (stage 'engine',
            // service non configuré) : seul cas où le repli direct reste
            // possible. Les validations obligatoires (preflight ingénierie +
            // garde exfiltration) ont DÉJÀ couru sur CE contenu exact avant la
            // mutation — le repli ne les contourne pas. Il est TRACÉ et sa
            // persistance est ensuite VÉRIFIÉE par lecture à rebours :
            // `viaFallback` n'est jamais une justification de succès à lui
            // seul (la preuve est l'écriture relue, pas le drapeau).
            fileStore.saveFile(context.tenantId, projectId, STREAM_MUTATION_PATH, assembledHtml);
            fallbackWritten = true;
            // É53 LOT E1 — POINT DE LINÉARISATION DE LA PERSISTANCE (repli
            // direct) : mêmes garanties que le chemin orchestré — la claim est
            // synchrone et collée à l'écriture effective (CAS B armé).
            executionStore.claimPersistenceWin(executionId);
            emit({
              type: 'mutation_fallback',
              path: STREAM_MUTATION_PATH,
              stage: mutationOutcome.stage,
              reason: mutationOutcome.reason
            }, {
              type: 'MUTATION_FALLBACK',
              phase: 'IMPLEMENT',
              status: 'COMPLETED',
              title: 'Écriture directe — orchestrateur de mutation indisponible',
              detail: {
                path: STREAM_MUTATION_PATH,
                stage: mutationOutcome.stage,
                reason: mutationOutcome.reason
              }
            });
            logger.warn('Mutation Orchestrator non appliqué : repli direct tracé', {
              component: 'conversation-route-stream',
              projectId,
              stage: mutationOutcome.stage,
              reason: mutationOutcome.reason
            });
          } else {
            // É53 LOT B — REFUS MÉTIER/SÉCURITÉ de l'orchestrateur (stages
            // 'contract', 'plan', 'validation') : JAMAIS de contournement par
            // fileStore.saveFile(). Le contenu rejeté ne persiste pas ; le
            // flux s'arrête honnêtement (persistenceError → frame error).
            emit({
              type: 'mutation_refused',
              path: STREAM_MUTATION_PATH,
              stage: mutationOutcome.stage,
              reason: mutationOutcome.reason
            }, {
              type: 'MUTATION_ORCHESTRATOR_REFUSED',
              phase: 'IMPLEMENT',
              status: 'FAILED',
              title: `Mutation refusée par l'orchestrateur (${mutationOutcome.stage})`,
              detail: {
                path: STREAM_MUTATION_PATH,
                stage: mutationOutcome.stage,
                reason: mutationOutcome.reason
              }
            });
            logger.warn('Orchestrateur : refus métier/sécurité — aucune écriture, repli interdit', {
              component: 'conversation-route-stream',
              tenantId: context.tenantId,
              projectId,
              stage: mutationOutcome.stage,
              reason: mutationOutcome.reason
            });
            persistenceError = `Mutation refusée par l'orchestrateur (${mutationOutcome.stage}) : ${mutationOutcome.reason}`;
          }
          if (!persistenceError) {
            // É53 LOT B — VÉRIFICATION POST-ÉCRITURE RÉELLE (les deux canaux) :
            // le fichier est RELU et comparé au contenu généré. Pour le repli
            // direct c'est la SEULE vérification (le moteur n'a rien contrôlé) ;
            // pour le chemin orchestré, c'est la confirmation indépendante du
            // moteur + invariants. Sans cette preuve : pas de succès déclaré.
            const persistedReadBack = fileStore.getFile(context.tenantId, projectId, STREAM_MUTATION_PATH);
            persistedVerified = Boolean(persistedReadBack && persistedReadBack.content === assembledHtml);
            // É53 LOT E2 — la preuve du CAS B est publiée sur le drapeau :
            // même en télémétrie OFF (aucun record, hasPersistenceWon inerte),
            // la route POST cancel voit qu'une écriture validée existe déjà.
            if (persistedVerified) {
              cancelFlag.persistenceVerified = true;
            }
            if (!persistedVerified) {
              persistenceError = 'vérification post-écriture en échec : le fichier relu ne correspond pas au contenu généré';
              logger.warn('Persistance non confirmée par lecture à rebours', {
                component: 'conversation-route-stream',
                tenantId: context.tenantId,
                projectId
              });
            }
          }
        } catch (saveErr) {
          persistenceError = saveErr instanceof Error ? saveErr.message : String(saveErr);
          logger.warn('Échec sauvegarde HTML final dans fileStore', {
            component: 'conversation-route-stream',
            error: persistenceError
          });
        }
        }
        }

        // É53 LOT E2 — POINT DE CONTRÔLE n°5 : avant la création de la
        // révision automatique (CAS B : le contrôle refuse — une mutation
        // déjà validée n'est jamais interrompue artificiellement).
        if (cancelInterrupted()) {
          logger.warn('Génération annulée avant la révision automatique', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId
          });
          return true;
        }
        if (!persistenceError) {
          // P3-fix — le dernier format généré pour ce projet est HTML :
          // la reprise du preview ne doit pas réafficher un bundle React obsolète.
          setProjectFormat(projectId, 'html');
          gateEligible = true;
          // ÉTAPE 6 — révision automatique (§32 CDC Evolution Engine) : chaque
          // génération produit une révision réversible (rollback déjà branché).
          try {
            const autoRevision = revisionStore.createRevision(context.tenantId, projectId, {
              message: `Génération IA — ${(body.message || '').slice(0, 80)}`,
              author: 'Agent IA',
              files: { 'index.html': assembledHtml },
              provenance: { source: 'AI_AGENT', triggerRequestId: requestId }
            });
            savedRevisionId = autoRevision.id;
          } catch (revErr) {
            logger.warn('Création de révision automatique impossible', {
              component: 'conversation-route-stream',
              projectId,
              error: revErr instanceof Error ? revErr.message : String(revErr)
            });
          }
          // É53 LOT E2 — POINT DE CONTRÔLE n°6 : avant le rafraîchissement de
          // l'Application Model.
          if (cancelInterrupted()) {
            logger.warn('Génération annulée avant le rafraîchissement de l\'Application Model', {
              component: 'conversation-route-stream',
              tenantId: context.tenantId,
              projectId
            });
            return true;
          }
          // V7 — APPLICATION MODEL : après une mutation réellement persistée
          // (fichier + révision), la racine applicative est recalculée depuis
          // les sources réelles et upsertée. Best-effort : un échec du modèle
          // n'annule jamais la mutation déjà écrite.
          const modelRefresh = refreshApplicationModelAfterMutation({
            tenantId: context.tenantId,
            projectId,
            role: context.role,
            requestId
          });
          if (modelRefresh.refreshed) {
            recordOnly({
              type: 'APPLICATION_MODEL_REFRESHED',
              phase: 'VALIDATE',
              status: 'COMPLETED',
              title: 'Application Model rafraîchi depuis les sources réelles',
              detail: { revisionId: savedRevisionId ?? null }
            });
            logger.info('Application Model rafraîchi après mutation', {
              component: 'conversation-route-stream',
              tenantId: context.tenantId,
              projectId,
              revisionId: savedRevisionId
            });
          } else if (modelRefresh.reason !== 'service-non-configure') {
            logger.warn('Application Model non rafraîchi (mutation conservée)', {
              component: 'conversation-route-stream',
              tenantId: context.tenantId,
              projectId,
              error: modelRefresh.reason
            });
          }
          // CDC §31 — LOT DNA EVOLUTION (2026-11-03, audit moteurs) : la
          // version DNA réelle est archivée quand l'architecture a réellement
          // changé (dédoublonnage par hash côté store), avec provenance
          // complète (revisionId + décision). Le rollback réel passera par
          // LA RÉVISION archivée (film revisionStore, jamais de falsification
          // du DNA). PORTE anti-pollution des suites (NODE_TEST_CONTEXT)
          // identique à celle de la chaîne d'agents ; jamais bloquant.
          if (dnaVersionCaptureFn && process.env.NODE_TEST_CONTEXT === undefined) {
            try {
              const dnaCapture = dnaVersionCaptureFn({
                tenantId: context.tenantId,
                projectId,
                requestId,
                sessionId,
                decisionId: decisionSummary?.decisionId,
                revisionId: savedRevisionId ?? undefined,
                trigger: 'stream-mutation'
              });
              if (dnaCapture && dnaCapture.created) {
                emitNamed('on_dna_version', {
                  version: dnaCapture.version,
                  versions: dnaCapture.versions
                }, {
                  type: 'DNA_VERSION_CAPTURED',
                  phase: 'VALIDATE',
                  status: 'COMPLETED',
                  title: `DNA v${dnaCapture.version} archivée (architecture réellement changée)`,
                  detail: {
                    revisionId: savedRevisionId ?? null,
                    decisionId: decisionSummary?.decisionId ?? null
                  }
                });
                logger.info('DNA Evolution : version archivée (CDC §31)', {
                  component: 'conversation-route-stream',
                  tenantId: context.tenantId,
                  projectId,
                  version: dnaCapture.version,
                  revisionId: savedRevisionId
                });
              }
            } catch (dnaError) {
              logger.warn('DNA Evolution : capture impossible (génération poursuivie)', {
                component: 'conversation-route-stream',
                tenantId: context.tenantId,
                projectId,
                error: dnaError instanceof Error ? dnaError.message : String(dnaError)
              });
            }
          }
          // LOT 3 — Compass : l'état COMPLETED sera émis APRÈS le Quality Gate
          // (le client ne doit pas voir « Terminé » pendant la vérification).
          logger.info('HTML final sauvegardé dans fileStore après stream', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId,
            htmlLength: assembledHtml.length,
            sectionsCount: serverSections.length
          });
        }
      }

      // Une écriture tentée puis annulée n'est PAS un succès : le flux s'arrête
      // honnêtement (le fichier existant reste intact grâce au snapshot).
      if (persistenceError) {
        throw new Error(`Persistance de ${STREAM_MUTATION_PATH} impossible : ${persistenceError}`);
      }

      // É53 LOT E2 — POINT DE CONTRÔLE n°7 : avant le Quality Gate serveur
      // (fenêtre await : une annulation arrivée ici et post-écriture est
      // refusée par l'arbitrage CAS B — jamais d'interruption artificielle).
      if (cancelInterrupted()) {
        logger.warn('Génération annulée avant le Quality Gate', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId
        });
        return true;
      }

      // T6 (CDC §24/§31) — QUALITY GATE SERVEUR : source de vérité unique.
      // Le gate tourne sur le HTML EXACTEMENT sauvegardé (fin de la bifurcation
      // client/serveur) et son résultat part dans la frame done + le store.
      let gateResult: { score: number; passed: boolean; truncated: boolean; findings: Array<{ severity: string; title: string }>; stats: { colors: number; fonts: number; interactiveElements: number }; renderAvailable: boolean } | null = null;
      if (recorder && gateEligible) {
        recordOnly({
          type: 'VALIDATION_STARTED',
          phase: 'VALIDATE',
          status: 'RUNNING',
          title: 'Vérification du rendu réel (Chromium + DOM)'
        });
        try {
          const analysis = await analyzeProjectVisual(context.tenantId, context.role, projectId, requestId);
          // B1 — la troncature est un finding CRITICAL (-25) : une page
          // incomplète ne doit jamais passer le seuil de 90.
          const allFindings = [...analysis.findings];
          if (truncatedGeneration) allFindings.push(truncationFinding());
          const finalScore = computeCriticScore(allFindings);
          const finalPassed = finalScore >= 90;
          gateResult = {
            score: finalScore,
            passed: finalPassed,
            truncated: truncatedGeneration,
            findings: allFindings,
            stats: analysis.stats,
            renderAvailable: analysis.renderAvailable
          };
          const criticals = allFindings.filter((f) => f.severity === 'CRITICAL').length;
          recordOnly({
            type: 'VALIDATION_COMPLETED',
            phase: 'VALIDATE',
            status: 'COMPLETED',
            title: `Quality Gate : ${finalScore}/100${finalPassed ? ' ✅' : ' ❌'}${truncatedGeneration ? ' (tronquée)' : ''}`,
            detail: {
              score: finalScore,
              passed: finalPassed,
              truncated: truncatedGeneration,
              criticals,
              findings: allFindings.length,
              renderAvailable: analysis.renderAvailable
            }
          });
          // BLOC 1 — auto-retry si score < 90 (création seulement, max 1 relance)
          if (!finalPassed && !isModificationMode && !gateRetryAttempted) {
            gateRetryAttempted = true;
            recordOnly({
              type: 'RETRY_STARTED',
              phase: 'VALIDATE',
              status: 'RUNNING',
              title: `Score ${finalScore}/100 < 90 — relance génération (tentative 2/2)`
            });
            // La relance effective est pilotée par le client (frame done :
            // gate.passed=false) — le serveur ne régénère jamais seul.
          }
        } catch (gateErr) {
          logger.warn('Quality Gate serveur indisponible', {
            component: 'conversation-route-stream',
            error: gateErr instanceof Error ? gateErr.message : String(gateErr)
          });
          recordOnly({
            type: 'VALIDATION_FAILED',
            phase: 'VALIDATE',
            status: 'FAILED',
            title: 'Vérification impossible — gate indisponible',
            detail: { error: gateErr instanceof Error ? gateErr.message : String(gateErr) }
          });
        }
      }

      // V7-WIRE-3 — VALIDATION CHAIN (CDC §25) branchée sur l'action
      // d'ingénierie réelle : après la persistance, la chaîne unique exécute
      // structure → syntaxe → a11y WCAG → harmonie design → tests. Elle est
      // CONSULTATIVE (le Quality Gate visuel reste le score de référence),
      // mais son verdict réel est persisté et renvoyé dans `done.validation`.
      let validationChainSummary: {
        readonly verdict: string;
        readonly reportHash: string;
        readonly stages: ReadonlyArray<{ readonly id: string; readonly status: string; readonly durationMs: number }>;
      } | null = null;
      // É53 LOT E2 — POINT DE CONTRÔLE n°8 : avant les validations
      // complémentaires (chaîne structure → syntaxe → a11y → design → tests) ;
      // il attrape aussi les annulations arrivées pendant l'await du gate.
      if (cancelInterrupted()) {
        logger.warn('Génération annulée avant la validation en chaîne', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId
        });
        return true;
      }
      if (gateEligible) {
        recordOnly({
          type: 'VALIDATION_STARTED',
          phase: 'VALIDATE',
          status: 'RUNNING',
          title: 'Validation en chaîne (structure → syntaxe → a11y → design → tests)'
        });
        try {
          const report = await runValidationChain(
            {
              tenantId: context.tenantId,
              projectId,
              entryFile: STREAM_MUTATION_PATH
            },
            context.role,
            requestId
          );
          const passedCount = report.stages.filter((s) => s.status === 'PASS').length;
          validationChainSummary = {
            verdict: report.verdict,
            reportHash: report.reportHash,
            stages: report.stages.map((s) => ({
              id: s.id,
              status: s.status,
              durationMs: s.durationMs
            }))
          };
          recordOnly({
            type: report.verdict === 'FAIL' ? 'VALIDATION_FAILED' : 'VALIDATION_COMPLETED',
            phase: 'VALIDATE',
            status: report.verdict === 'FAIL' ? 'FAILED' : 'COMPLETED',
            title: `Validation en chaîne : ${report.verdict} (${passedCount}/${report.stages.length} étapes PASS)`,
            detail: {
              verdict: report.verdict,
              reportHash: report.reportHash,
              entryFile: report.entryFile,
              stages: validationChainSummary.stages
            }
          });
        } catch (chainErr) {
          const chainMessage = chainErr instanceof Error ? chainErr.message : String(chainErr);
          logger.warn('Validation en chaîne indisponible', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId,
            error: chainMessage
          });
          recordOnly({
            type: 'VALIDATION_FAILED',
            phase: 'VALIDATE',
            status: 'FAILED',
            title: 'Validation en chaîne indisponible',
            detail: { error: chainMessage }
          });
        }
      }

      // Compass : le cycle n'est vraiment terminé qu'après le gate
      emit({ type: 'compass', state: 'COMPLETED' });

      // EXECUTION TRANSPARENCY : bilan réel (ce qui a été fait, pas ce qu'on
      // espérait) enregistré avant le done — la synthèse du CDC §24-§25 en T7
      // s'appuiera sur ces compteurs.
      // T4 — les diffs réels partent sur le fil ET dans le store.
      const totalAdded = sectionDiffs.reduce((acc, d) => acc + d.added, 0);
      const totalRemoved = sectionDiffs.reduce((acc, d) => acc + d.removed, 0);
      for (const diff of sectionDiffs) {
        // LOT E — frame + activité en UN seul passage (la frame porte la vue
        // normalisée : le flux live montre le diff sans second canal).
        emit({
          type: 'diff',
          section: diff.name,
          mode: diff.mode,
          applied: diff.applied,
          added: diff.added,
          removed: diff.removed
        }, {
          type: 'DIFF_GENERATED',
          phase: 'IMPLEMENT',
          status: diff.applied ? 'COMPLETED' : 'FAILED',
          title: diff.applied
            ? `Diff calculé — section ${diff.name}`
            : `Section ${diff.name} non appliquée : cible introuvable dans le HTML`,
          detail: { section: diff.name, mode: diff.mode, applied: diff.applied, addedLines: diff.added, removedLines: diff.removed }
        });
      }
      // É53 LOT E1 — ARBITRAGE FINAL ANNULATION / PERSISTANCE (point de
      // linéarisation explicite de la terminaison), consommé via le contrôle
      // centralisé E2 (`cancelInterrupted`). CAS A (annulation gagnante,
      // aucune écriture) : arrêt net — aucun verdict, aucune révision, aucune
      // clôture COMPLETED/FAILED. CAS B (persistance gagnée) : le contrôle
      // refuse l'interruption et le flux continue vers le `done` de vérité —
      // le serveur ne prétendra jamais « rien n'a été enregistré ».
      if (cancelInterrupted()) {
        logger.warn('Génération annulée par l\'utilisateur avant clôture — aucune écriture validée', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId
        });
        return true;
      }

      // É53 LOT B — AUTORITÉ DE VÉRITÉ : verdict déterministe fondé sur les
      // faits réellement disponibles (écriture confirmée + lecture à rebours,
      // révision créée, sections réellement appliquées, troncature, gate).
      const streamTruth = computeStreamTruth({
        isModificationMode,
        attemptedPersistence,
        mutationApplied,
        fallbackWritten,
        persistedVerified,
        persistenceError,
        revisionCreated: Boolean(savedRevisionId),
        truncatedGeneration,
        gateEligible,
        gateResult: gateResult ? { score: gateResult.score, passed: gateResult.passed } : null,
        sections: serverSections.map((s) => ({
          name: s.name,
          mode: s.mode,
          changed: truthSectionFacts.get(s.name)?.applied === true,
          delivered: truthSectionFacts.get(s.name)?.delivered === true
        })),
        hasExploitableChange
      });
      if (recorder) {
        if (streamTruth.updated) {
          // Bilan réel : seules les sections RÉELLEMENT changées comptent.
          executionStore.completeExecution(executionId, {
            sectionsCreated: serverSections.filter((s) => truthSectionFacts.get(s.name)?.applied === true && (s.mode === 'create' || s.mode === 'add')).length,
            sectionsModified: serverSections.filter((s) => truthSectionFacts.get(s.name)?.applied === true && s.mode === 'modify').length,
            sectionsDeleted: serverSections.filter((s) => truthSectionFacts.get(s.name)?.applied === true && s.mode === 'delete').length,
            filesTouched: ['index.html'],
            htmlChars: assembledHtml.length,
            addedLines: totalAdded,
            removedLines: totalRemoved,
            ...(gateResult ? { score: gateResult.score } : {}),
            ...(savedRevisionId ? { revisionId: savedRevisionId } : {})
          });
        } else {
          // Aucune écriture persistée : l'exécution est marquée en échec honnête
          // (pas de bilan de « fichiers touchés » fictif).
          executionStore.failExecution(executionId, (`Aucune écriture persistée — ${streamTruth.reason ?? 'raison inconnue'}`).slice(0, 300));
        }
      }

      // T7 — synthèse finale : une phrase honnête, des chiffres réels
      const synthesisResult = buildFinalSynthesis({
        verdict: streamTruth.verdict,
        partialReasons: streamTruth.partialReasons,
        failureReason: streamTruth.reason,
        sections: serverSections.map((s) => ({
          name: s.name,
          mode: s.mode,
          changed: truthSectionFacts.get(s.name)?.applied === true
        })),
        sectionDiffs,
        gateScore: gateResult ? gateResult.score : null,
        gateAvailable: Boolean(gateResult),
        durationSec: Math.round((Date.now() - streamStartedAt) / 1000)
      });
      const synthesisText = synthesisResult.text;
      recordOnly({
        type: 'SUMMARY_GENERATED',
        phase: 'COMPLETE',
        status: 'COMPLETED',
        title: 'Synthèse de l\u2019exécution',
        detail: { text: synthesisText }
      });

      // P6 — CONVERSATION VIVANTE : le tour est enregistré dans la session
      // (message utilisateur, réponse de l'agent = synthèse, intention
      // réelle P2-d, plan, mémoire projet) et persisté.
      try {
        conversationIntelligenceService.recordStreamTurn({
          tenantId: context.tenantId,
          projectId,
          sessionId,
          userRole: context.role,
          userMessage: body.message || '',
          assistantMessage: 'Synthèse : ' + synthesisText,
          intent: realIntent,
          plan,
          durationMs: Date.now() - streamStartedAt,
          requestId
        });
      } catch (turnErr) {
        logger.warn('Tour de stream non enregistré', {
          component: 'conversation-route-stream', projectId,
          error: turnErr instanceof Error ? turnErr.message : String(turnErr)
        });
      }

      // P4-FINITION — prise de parole de clôture (déterministe : faits réels,
      // 1-2 phrases) + suggestions d'actions rapides (chips du Studio).
      // É53 LOT B — le compteur est le nombre de sections RÉELLEMENT
      // appliquées (bytes changés), plus l'annonce UI (sectionIndex) ; un
      // résultat partiel est nommé tel quel dans la clôture.
      const appliedSectionCount = sectionDiffs.filter((d) => d.applied).length;
      const closingMessage = `C'est en place : ${appliedSectionCount} section${appliedSectionCount > 1 ? 's' : ''} ${isModificationMode ? 'mise(s) à jour' : 'créée(s)'}${streamTruth.partial ? ` — partiel : ${streamTruth.partialReasons.join(' ; ')}` : ''}${gateResult ? ` — qualité ${gateResult.score}/100` : ''}. Dis-moi ce que tu veux ajuster !`;
      const quickSuggestions = [
        'Changer la palette de couleurs',
        'Ajouter une section avis clients',
        'Améliorer le responsive mobile'
      ];

      // CDC §23 — LOT RUN_TESTS FLUX (audit moteurs, 2026-11-03) : balayage de
      // tests RÉEL sur les fichiers HTML du projet — UNIQUEMENT multi-pages
      // (≥ 2 fichiers HTML). En mono-page, le gate d'ingénierie §25 ci-dessus
      // exécute exactement le même moteur (runEngineeringPreflight) sur le
      // même contenu : dupliquer une fois de plus ne serait que du bruit.
      // Même exécuteur que le tool RUN_TESTS (Lot 1). Additif, jamais
      // bloquant : frame `on_tests_completed` + event TESTS_COMPLETED.
      try {
        const allProjectFiles = fileStore.getAllProjectFiles(context.tenantId, projectId);
        const htmlEntries = Object.entries(allProjectFiles).filter(([p]) => /\.html?$/i.test(p) && p.startsWith('app/') === false);
        if (htmlEntries.length >= 2) {
          const testFailures: string[] = [];
          let testsRun = 0;
          for (const [pathHtml, contentHtml] of htmlEntries) {
            if (typeof contentHtml !== 'string' || contentHtml.trim().length === 0) continue;
            const tcReport = runEngineeringPreflight(contentHtml, pathHtml);
            testsRun += tcReport.checks.length;
            if (!tcReport.passed) {
              testFailures.push(`${pathHtml} → ${tcReport.verdict} (${tcReport.blockers.length} bloqueur${tcReport.blockers.length > 1 ? 's' : ''})`);
            }
          }
          const testsSummary = { filesChecked: htmlEntries.length, testsRun, failed: testFailures };
          emitNamed('on_tests_completed', {
            filesChecked: testsSummary.filesChecked,
            testsRun: testsSummary.testsRun,
            failed: testsSummary.failed
          }, {
            type: 'TESTS_COMPLETED',
            phase: 'VALIDATE',
            status: testFailures.length > 0 ? 'FAILED' : 'COMPLETED',
            title: testFailures.length > 0
              ? `Tests projet : ${testFailures.length} fichier(s) en échec sur ${htmlEntries.length}`
              : `Tests projet : ${testsRun} vérifications passées sur ${htmlEntries.length} page(s)`,
            detail: {
              filesChecked: testsSummary.filesChecked,
              testsRun: testsSummary.testsRun,
              failed: testsSummary.failed
            }
          });
          logger.info('Balayage de tests du projet (CDC §23, multi-pages)', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId,
            filesChecked: testsSummary.filesChecked,
            testsRun: testsSummary.testsRun,
            failures: testFailures.length
          });
        }
      } catch (sweepErr) {
        logger.warn('Balayage de tests multi-pages indisponible (génération poursuivie)', {
          component: 'conversation-route-stream',
          projectId,
          error: sweepErr instanceof Error ? sweepErr.message : String(sweepErr)
        });
      }

      // É53 LOT B — LA FRAME DE VÉRITÉ. `updated` ne vaut true que si une
      // écriture réellement persistée a été confirmée par la vérification
      // post-écriture ; `partial` distingue l'incomplet (motifs exacts) ;
      // `reason` explique tout échec ; `committedFiles`/`unmetFiles` sont
      // établis depuis les faits réels du parcours (jamais le pipeline E47).
      // Aucun succès fictif : un échec ne porte ni html ni clôture de succès.
      // É53 LOT E2 — POINT DE CONTRÔLE n°9 : immédiatement avant l'émission
      // de `done` — après une annulation gagnante, aucune frame de résultat
      // normal n'est émise (le CAS B passe : la mutation validée est honorée).
      if (cancelInterrupted()) {
        logger.warn('Génération annulée avant l\'émission du done', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId
        });
        return true;
      }
      if (!streamTruth.updated) {
        emit({
          type: 'done',
          updated: false,
          reason: streamTruth.reason ?? 'aucune écriture persistée',
          committedFiles: [],
          unmetFiles: streamTruth.unmetFiles,
          thinking: fullText.replace(/<SECTION[^>]*>[\s\S]*?<\/SECTION>/g, '').trim(),
          synthesis: { text: synthesisText, verdict: synthesisResult.verdict }
        });
        // Pas de balayage de tests ni de clôture LLM : rien n'a été persisté.
        return true;
      }
      emit({
        type: 'done',
        updated: true,
        ...(streamTruth.partial ? { partial: true, partialReasons: [...streamTruth.partialReasons] } : {}),
        persistedVia: fallbackWritten ? 'fallback' : 'engine',
        ...(savedRevisionId ? { revisionId: savedRevisionId } : {}),
        committedFiles: streamTruth.committedFiles,
        unmetFiles: streamTruth.unmetFiles,
        ...(streamTruth.gateUnavailable ? { gateUnavailable: true } : {}),
        html: assembledHtml,
        thinking: fullText.replace(/<SECTION[^>]*>[\s\S]*?<\/SECTION>/g, '').trim(),
        synthesis: { text: synthesisText, verdict: synthesisResult.verdict },
        closingPending: true,
        closingMessage,
        suggestions: quickSuggestions,
        ...(gateResult ? { gate: gateResult } : {}),
        ...(impactSummary ? { impact: impactSummary } : {}),
        ...(decisionSummary ? { decision: decisionSummary } : {}),
        ...(validationChainSummary ? { validation: validationChainSummary } : {}),
        ...(engineeringValidation ? { engineeringValidation } : {}),
        ...(preparationSummary ? { preparation: preparationSummary } : {})
      });

      // CLOTURE-LLM — synthèse rédigée + suggestions contextuelles, en frame
      // séparée après « done » (repli : textes déterministes ci-dessus).
      // É53 LOT E1 — la garde lit l'ÉTAT ARBITRÉ (statut du store), pas le
      // drapeau brut : si la persistance a gagné la course (CAS B) et que le
      // tour s'est achevé honnêtement en COMPLETED, la clôture suit le done
      // normalement — l'annulation tardive a été refusée, elle n'est pas un
      // motif de clôture muette.
      if (!clientGone && executionStore.getExecution(executionId)?.status !== 'CANCELLED') {
        let closingText = closingMessage;
        // LOT CONVERS-CHIPS — le repli reflète le VRAI site : les rubriques
        // h1-h3 réellement générées deviennent des actions concrètes. Le trio
        // générique historique ne subsiste qu'en ultime recours (site sans
        // aucun heading lisible).
        const siteExtract = extractSiteContent(assembledHtml || '');
        const derivedChips = siteExtract.headings
          .filter((h) => h.length >= 3)
          .slice(0, 3)
          .map((h) => 'Retoucher la section « ' + h + ' »');
        const fallbackChips = derivedChips.length >= 2 ? derivedChips : quickSuggestions;
        let closingChips = fallbackChips;
        const llmClosing = await generateClosing(
          (closingSystem, closingUser) => adapter.generate(
            {
              tenantId: context.tenantId,
              projectId,
              prompt: closingUser,
              systemPrompt: closingSystem,
              temperature: 0.4,
              maxTokens: 400,
              timeoutMs: 20000,
              requestId,
              // É53 LOT E4.1 — CORRECTION A : le signal du tour atteint
              // l'appel non-streaming de clôture (annulation acceptée /
              // déconnexion → transport coupé en plein appel ; CAS B refusé
              // → signal jamais armé → clôture normale inchangée).
              signal: turnAbortController.signal
            },
            resolveStreamCredentials(req, context.tenantId, adapter.descriptor.providerId)
          ).then((r) => r.text),
          {
            request: body.message || '',
            mode: isModificationMode ? 'modify' : 'create',
            sections: serverSections.map((s) => ({ name: s.name, mode: s.mode })),
            gateScore: gateResult ? gateResult.score : null,
            findings: gateResult ? gateResult.findings.slice(0, 3).map((f) => f.title) : [],
            siteContent: siteExtract
          },
          20000
        );
        if (llmClosing) {
          closingText = llmClosing.summary;
          if (llmClosing.suggestions.length >= 2) closingChips = llmClosing.suggestions;
        }
        // É53 LOT E4.1 — CORRECTION A : résultat TARDIF de la clôture. Si le
        // client est parti (ou le tour abandonné) pendant l'appel de 20 s,
        // AUCUNE frame n'est émise sur un socket mort / après un ⏹.
        if (clientGone || turnAbortController.signal.aborted) {
          return true;
        }
        emit({
          type: 'closing',
          closingMessage: closingText,
          suggestions: closingChips,
          ...(llmClosing?.tip ? { tip: llmClosing.tip } : {}),
          source: llmClosing ? 'llm' : 'fallback'
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // CDC §39 — séparation log technique / message utilisateur : une erreur
      // d'auth fournisseur (401/403) doit être ACTIONNABLE, pas brute.
      const friendly = /HTTP\s*40[13]/.test(message)
        ? "Ta clé Mistral est refusée par l'API (HTTP 401) — elle est invalide ou révoquée. Génère une nouvelle clé sur console.mistral.ai, place-la dans .env (MISTRAL_API_KEY=...) puis redémarre le serveur."
        : message;
      // É53 LOT E3 — CORRECTION B : classification de l'abandon AVANT tout
      // traitement générique. Une interruption du transport LLM causée par
      // CE tour (annulation utilisateur acceptée / déconnexion client) n'est
      // jamais une erreur LLM ordinaire ; l'issue reste l'arbitrage E1/E2
      // (cancelInterrupted : claim atomique + frame ⏹ unique, points de
      // contrôle E2 gelés).
      if (turnAbortedAs('user_cancel')) {
        if (cancelInterrupted()) {
          logger.warn('Transport LLM interrompu par une annulation acceptée — terminal ⏹ posé par l\u2019arbitrage E1', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId,
            error: message
          });
          return true;
        }
        // Refus du claim (CAS B : la persistance a gagné entre-temps) —
        // l'issue honnête appartient à la persistance : aucune fausse erreur
        // n'est émise, aucun statut alternatif fabriqué.
        if (executionStore.hasPersistenceWon(executionId) || persistedVerified) {
          logger.warn('Abandon d\u2019une annulation supplantée par la persistance (CAS B) — terminal de la persistance préservé', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId,
            error: message
          });
          return true;
        }
      } else if (turnAbortedAs('client_disconnect')) {
        // Miroir du cas post-boucle (client parti en cours de génération) :
        // annulation honnête ⏹ (client_gone), jamais une erreur technique.
        logger.warn('Transport LLM interrompu par une déconnexion client', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          charsReceived: fullText.length,
          error: message
        });
        if (recorder) executionStore.cancelExecution(executionId, 'client_gone');
        return true;
      }
      // É53 LOT E1 — ARBITRAGE : une annulation gagnante n'est jamais une
      // erreur technique. Si le terminal ⏹ a déjà gagné la course, on ne
      // failExécute pas (le guard du store le refuserait) et on n'émet pas de
      // frame `error` — l'issue du tour reste CANCELLED, unique et cohérente.
      if (executionStore.getExecution(executionId)?.status === 'CANCELLED') {
        logger.warn('Erreur survenue après une annulation gagnante — terminal ⏹ préservé', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          error: message
        });
        if (!clientGone && !cancelFrameEmitted) {
          cancelFrameEmitted = true;
          sendSSE({ type: 'cancelled' });
        }
        return true;
      }
      logger.warn("Erreur pendant le streaming conversationnel", {
        component: 'conversation-route-stream',
        tenantId: context.tenantId,
        projectId,
        error: message
      });
      if (recorder) executionStore.failExecution(executionId, message);
      emit({ type: 'error', error: friendly });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (providerWaitTicker) clearInterval(providerWaitTicker);
      activeCancelFlags.delete(executionId);
      res.end();
    }

    return true;
  }

  return false;
}
