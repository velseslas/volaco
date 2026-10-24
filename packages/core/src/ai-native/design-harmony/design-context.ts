/**
 * VibeCode Core - Design Harmony
 * CDC V8 §11 — Contexte Design réel pour les générations design-aware.
 *
 * L'UI Agent (et tout agent dont la tâche pose includeDna) lit AVANT de
 * générer :
 *   - le rapport Design Harmony RÉELLEMENT persisté du projet
 *     (DesignReportStore : tokens inférés du DOM, harmonie, dérives) ;
 *   - l'artefact Design System persisté (DesignSystemStore) quand il est
 *     FRAIS (même rapport source + même schéma) — la Design Direction
 *     RÉELLEMENT APPLIQUÉE par la route fait alors référence ;
 *     sinon la direction est re-dérivée des mêmes tokens (déterminisme).
 *
 * Le contexte transmis contient :
 *   - les tokens de référence (palette, typographie, espacement, rayons,
 *     élévation, confiance) ;
 *   - la Design Direction (design-direction.ts — source unique, aucun
 *     Math.random) + sa provenance (`persisted` | `derived`) ;
 *   - les règles applicables instanciées depuis le CATALOGUE VERSIONNÉ
 *     (design-rules.ts) + la version appliquée ;
 *   - les corrections attendues = findings réels (MEDIUM+) du rapport ;
 *   - un bloc de prompt borné, prêt à être transmis au LLM.
 *
 * HONNÊTETÉ : sans rapport persisté pour le couple tenant/projet, AUCUN
 * contexte n'est fabriqué (undefined) — le prompt reste identique à l'ancien
 * comportement (non-régression stricte). L'isolation multi-tenant est
 * revérifiée à la lecture (défense en profondeur).
 */

import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { logger } from '../../logger.js';
import { deriveDesignDirection, type DesignDirection, type DesignDirectionOverride } from './design-direction.js';
import { applyDesignDirectionOverride } from './design-direction-catalog.js';
import { designDirectionStore } from './design-direction-store.js';
import { designMemoryStore } from './design-memory-store.js';
import type { DesignMemoryDecision } from './design-memory.js';
import {
  buildAppliedDesignRules,
  designRulesInputFromTokens,
  DESIGN_RULES_CATALOG_VERSION,
  type AppliedDesignRule,
  type DesignRulesInput
} from './design-rules.js';
import { designReportStore } from './report-store.js';
import {
  designSystemStore,
  DESIGN_SYSTEM_SCHEMA_VERSION,
  type DesignSystemArtifact,
  type DesignSystemStoreLike
} from './design-system-store.js';
import {
  buildComponentContextBlock,
  COMPONENT_CONTRACTS_VERSION,
  resolveComponentContracts,
  summarizeComponentContract,
  type ComponentContractSummary
} from './component-contracts.js';
import { componentContractStore, type StoredComponentOverride } from './component-contract-store.js';
import type { DesignHarmonyReport, HarmonySeverity } from './types.js';

/** Source minimale requise (DesignReportStore réel ou store de test). */
export interface DesignContextStoreLike {
  get(tenantId: string, projectId: string): DesignHarmonyReport | undefined;
}

/** Source minimale de décisions design (DesignMemoryStore réel ou store de test). */
export interface DesignMemoryStoreLike {
  listActive(tenantId: string, projectId: string): readonly DesignMemoryDecision[];
}

/** Source minimale d'override de direction (DesignDirectionStore réel ou test). */
export interface DesignDirectionStoreLike {
  get(tenantId: string, projectId: string): { readonly override: DesignDirectionOverride } | undefined;
}

/** Source minimale d'overrides composants (§9/§10 — store réel ou test). */
export interface ComponentContractStoreLike {
  list(tenantId: string, projectId: string): readonly StoredComponentOverride[];
}

export interface DesignTokenSummary extends DesignRulesInput {
  readonly systemConfidence: number;
}

export interface DesignExpectedCorrection {
  readonly category: string;
  readonly severity: HarmonySeverity;
  readonly recommendation: string;
}

export interface ProjectDesignContext {
  readonly source: 'design-report';
  readonly reportId: string;
  readonly generatedAt: string;
  readonly overallScore: number;
  readonly analyzedRoutes: readonly string[];
  readonly tokens: DesignTokenSummary;
  readonly direction: DesignDirection;
  /** Provenance de la direction : artefact persisté frais, re-dérivée des tokens, ou override projet. */
  readonly directionSource: 'persisted' | 'derived' | 'override';
  readonly rules: readonly AppliedDesignRule[];
  /** Version du catalogue de règles appliqué (traçabilité). */
  readonly rulesCatalogVersion: string;
  /** §24 — décisions design ACTIVES à respecter (les IGNORE_OPPORTUNITY sont exclues). */
  readonly designDecisions: readonly DesignMemoryDecision[];
  /** §9/§10 — composants disponibles (catalogue ± overrides projet). */
  readonly components: {
    readonly catalogVersion: string;
    readonly items: readonly ComponentContractSummary[];
  };
  /** Bloc borné « SYSTÈME DE COMPOSANTS » (≤ MAX_COMPONENT_PROMPT_BLOCK_CHARS). */
  readonly componentsPromptBlock: string;
  readonly expectedCorrections: readonly DesignExpectedCorrection[];
  /** Bloc borné prêt pour le prompt LLM (≤ MAX_PROMPT_BLOCK_CHARS). */
  readonly promptBlock: string;
}

const SEVERITY_RANK: Record<HarmonySeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0
};

export const MAX_PROMPT_BLOCK_CHARS = 1800;
const MAX_PALETTE_INLINE = 8;
const MAX_CORRECTIONS = 5;
const MAX_DECISIONS_IN_PROMPT = 5;
const RECOMMENDATION_MAX_CHARS = 160;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function buildExpectedCorrections(findings: DesignHarmonyReport['findings']): readonly DesignExpectedCorrection[] {
  return [...findings]
    .filter((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK.MEDIUM)
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        a.category.localeCompare(b.category) ||
        a.id.localeCompare(b.id)
    )
    .slice(0, MAX_CORRECTIONS)
    .map((finding) => ({
      category: finding.category,
      severity: finding.severity,
      recommendation: truncate(finding.recommendation, RECOMMENDATION_MAX_CHARS)
    }));
}

function composePromptBlock(params: {
  reportId: string;
  generatedAt: string;
  tokens: DesignTokenSummary;
  direction: DesignDirection;
  rules: readonly AppliedDesignRule[];
  decisions: readonly DesignMemoryDecision[];
  expectedCorrections: readonly DesignExpectedCorrection[];
}): string {
  const { reportId, generatedAt, tokens, direction, rules, decisions, expectedCorrections } = params;

  const directionParts = [
    `style « ${direction.style} »`,
    `personnalité « ${direction.personality} »`,
    `énergie visuelle « ${direction.visualEnergy} »`
  ];
  if (direction.density) directionParts.push(`densité « ${direction.density} »`);
  if (direction.informationDensity) directionParts.push(`densité d'information « ${direction.informationDensity} »`);

  const tokenParts: string[] = [];
  if (tokens.palette.length > 0) {
    const inline = tokens.palette.slice(0, MAX_PALETTE_INLINE).map((p) => `${p.role} ${p.value}`).join(', ');
    tokenParts.push(`palette [${inline}${tokens.palette.length > MAX_PALETTE_INLINE ? ', …' : ''}]`);
  }
  if (tokens.primaryFontFamily.length > 0) tokenParts.push(`typographie « ${tokens.primaryFontFamily} »`);
  tokenParts.push(`espacement base ${tokens.baseGridStep}px`);
  if (tokens.radii.length > 0) tokenParts.push(`rayons [${tokens.radii.join(', ')}]`);
  tokenParts.push(`élévation ${tokens.shadowLevelsCount} niveau(x)`);
  tokenParts.push(`confiance ${Math.round(tokens.systemConfidence * 100)}%`);

  const lines = [
    `CONTEXTE DESIGN OBLIGATOIRE — Design DNA réel du projet (rapport ${reportId}, analyse du ${generatedAt.slice(0, 10)}) :`,
    `- Direction : ${directionParts.join(' ; ')}.`,
    `- Tokens inférés : ${tokenParts.join(' ; ')}.`,
    `- Règles de cohérence : ${rules.map((rule, index) => `(${index + 1}) ${rule.text}`).join(' ')}`
  ];
  if (decisions.length > 0) {
    const remembered = decisions
      .slice(-MAX_DECISIONS_IN_PROMPT)
      .map((decision, index) => `(${index + 1}) ${decision.decision} — raison : ${decision.reason}`)
      .join(' ; ');
    lines.push(`- Décisions design mémorisées (à respecter impérativement, ne pas revenir à un autre style) : ${remembered}`);
  }
  if (expectedCorrections.length > 0) {
    const corrections = expectedCorrections
      .map((c) => `[${c.severity}] ${c.category} — ${c.recommendation}`)
      .join(' ; ');
    lines.push(`- Corrections attendues (incohérences réellement détectées — ne pas les reproduire) : ${corrections}`);
  }
  lines.push(
    "Avant de générer : respecte ces contraintes pour rester cohérent avec l'existant et explique tes choix de design (hiérarchie, espacement, couleurs) en 3 à 5 puces."
  );

  return truncate(lines.join('\n'), MAX_PROMPT_BLOCK_CHARS);
}

/**
 * Options ADDITIVES du contexte design (Lot C) : override §6 + décisions §24.
 * Lot D (§9/§10) : overrides composants (dépréciation/désactivation).
 * Sans options, la sortie reste strictement identique à l'historique.
 */
export interface BuildProjectDesignContextOptions {
  readonly directionOverride?: DesignDirectionOverride | undefined;
  readonly decisions?: readonly DesignMemoryDecision[] | undefined;
  readonly componentOverrides?: readonly StoredComponentOverride[] | undefined;
}

/**
 * Construit le contexte Design à partir du rapport RÉEL du projet (pure —
 * convient aux tests et à la relecture du rapport persisté). L'artefact
 * Design System est consommé UNIQUEMENT s'il est frais (même rapport source,
 * même schéma) : la direction persistée prime alors sur la re-dérivation.
 * Un override projet (§6) prime sur les deux ; les décisions ACTIVES (§24)
 * sont citées dans le prompt (jamais les IGNORE_OPPORTUNITY).
 */
export function buildProjectDesignContext(
  report: DesignHarmonyReport,
  artifact?: DesignSystemArtifact | undefined,
  options?: BuildProjectDesignContextOptions | undefined
): ProjectDesignContext {
  const tokens = report.inferredDesignSystem;
  const ruleInput = designRulesInputFromTokens(tokens);

  const freshArtifact =
    artifact &&
    artifact.schemaVersion === DESIGN_SYSTEM_SCHEMA_VERSION &&
    artifact.tenantId === report.tenantId &&
    artifact.projectId === report.projectId &&
    artifact.source.reportId === report.reportId
      ? artifact
      : undefined;

  const tokensSummary: DesignTokenSummary = {
    ...ruleInput,
    systemConfidence: tokens.systemConfidence
  };

  const baseDirection = freshArtifact ? freshArtifact.direction : deriveDesignDirection(tokens);
  const directionOverride = options?.directionOverride;
  const direction = directionOverride
    ? applyDesignDirectionOverride(baseDirection, directionOverride)
    : baseDirection;
  const directionSource: 'persisted' | 'derived' | 'override' = directionOverride
    ? 'override'
    : freshArtifact
      ? 'persisted'
      : 'derived';
  const decisions = (options?.decisions ?? []).filter(
    (decision) => decision.kind === 'DECISION' && decision.status === 'ACTIVE'
  );
  const rules = buildAppliedDesignRules(ruleInput);
  const expectedCorrections = buildExpectedCorrections(report.findings);
  // §9/§10 — le catalogue effectif suit les overrides projet du store (aucun
  // override → catalogue complet). Le bloc composants est SÉPARÉ du bloc
  // design principal : le plafond historique de promptBlock reste inchangé.
  const componentOverrides = options?.componentOverrides ?? [];
  const effectiveContracts = resolveComponentContracts(
    componentOverrides.map((entry) => ({
      componentId: entry.componentId,
      override: entry.override,
      ...(entry.updatedAt !== undefined ? { updatedAt: entry.updatedAt } : {})
    }))
  );
  const componentsPromptBlock = buildComponentContextBlock(effectiveContracts);

  const promptBlock = composePromptBlock({
    reportId: report.reportId,
    generatedAt: report.generatedAt,
    tokens: tokensSummary,
    direction,
    rules,
    decisions,
    expectedCorrections
  });

  return deepFreeze({
    source: 'design-report' as const,
    reportId: report.reportId,
    generatedAt: report.generatedAt,
    overallScore: report.overallScore,
    analyzedRoutes: report.analyzedRoutes.slice(0, 10),
    tokens: tokensSummary,
    direction,
    directionSource,
    rules,
    rulesCatalogVersion: DESIGN_RULES_CATALOG_VERSION,
    designDecisions: decisions,
    components: {
      catalogVersion: COMPONENT_CONTRACTS_VERSION,
      items: effectiveContracts.map(summarizeComponentContract)
    },
    componentsPromptBlock,
    expectedCorrections,
    promptBlock
  });
}

/**
 * Charge le contexte Design depuis les stores (DesignReportStore +
 * DesignSystemStore réels par défaut). FAILURE-SAFE : toute anomalie →
 * undefined (le prompt repart sur le comportement historique, jamais
 * d'exception). La lecture de l'artefact est isolée : une panne du
 * DesignSystemStore retombe sur la direction re-dérivée, sans perdre le
 * rapport.
 */
export function loadProjectDesignContext(params: {
  tenantId: string;
  projectId: string;
  store?: DesignContextStoreLike | undefined;
  systemStore?: DesignSystemStoreLike | undefined;
  memoryStore?: DesignMemoryStoreLike | undefined;
  directionStore?: DesignDirectionStoreLike | undefined;
  componentStore?: ComponentContractStoreLike | undefined;
}): ProjectDesignContext | undefined {
  const store = params.store ?? designReportStore;
  try {
    const report = store.get(params.tenantId, params.projectId);
    if (!report) return undefined;
    // Défense en profondeur : un rapport d'un autre couple tenant/projet ne
    // peut jamais alimenter un prompt.
    if (report.tenantId !== params.tenantId || report.projectId !== params.projectId) {
      return undefined;
    }

    let artifact: DesignSystemArtifact | undefined;
    try {
      const systemStore = params.systemStore ?? designSystemStore;
      artifact = systemStore.get(params.tenantId, params.projectId);
    } catch {
      // Store d'artefacts indisponible → direction re-dérivée (jamais bloquant).
      artifact = undefined;
    }

    let decisions: readonly DesignMemoryDecision[] = [];
    try {
      const memoryStore = params.memoryStore ?? designMemoryStore;
      decisions = memoryStore.listActive(params.tenantId, params.projectId);
    } catch {
      decisions = [];
    }

    let directionOverride: DesignDirectionOverride | undefined;
    try {
      const directionStore = params.directionStore ?? designDirectionStore;
      directionOverride = directionStore.get(params.tenantId, params.projectId)?.override;
    } catch {
      directionOverride = undefined;
    }

    let componentOverrides: readonly StoredComponentOverride[] = [];
    try {
      const componentStore = params.componentStore ?? componentContractStore;
      componentOverrides = componentStore.list(params.tenantId, params.projectId);
    } catch {
      componentOverrides = [];
    }

    return buildProjectDesignContext(report, artifact, {
      ...(directionOverride !== undefined ? { directionOverride } : {}),
      decisions,
      componentOverrides
    });
  } catch (err) {
    logger.warn('Design DNA indisponible — génération sans contexte design', {
      component: 'design-context',
      err: err instanceof Error ? err.message : String(err)
    });
    return undefined;
  }
}

/**
 * P0 (audit 2026-10) — Injection du contexte Design dans les voies de
 * génération principales (conversation, générateur d'app, édition d'app).
 *
 * Sans rapport Design Harmony persisté pour le couple tenant/projet — ou si
 * un store échoue — le system prompt est retourné STRICTEMENT inchangé :
 * aucune régression des voies historiques, aucune invention de contexte.
 */
export function withProjectDesignContext(
  systemPrompt: string,
  params: { tenantId: string; projectId: string }
): string {
  try {
    const context = loadProjectDesignContext(params);
    if (!context) return systemPrompt;
    const blocks: string[] = [context.promptBlock];
    if (context.componentsPromptBlock.trim().length > 0) {
      blocks.push(context.componentsPromptBlock);
    }
    return `${systemPrompt}\n\n${blocks.join('\n\n')}`;
  } catch {
    return systemPrompt;
  }
}
