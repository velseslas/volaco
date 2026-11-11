/**
 * VibeCode Core - API Tier
 * Design Surfaces Route (CDC V8 §6/§8/§24/§29-§31 — Lot C)
 *
 * Routes ADDITIVES (aucune modification de GET .../design, e42/e53 intacts) :
 *  - GET    .../design/directions          catalogue §6 + profil appliqué
 *  - PUT    .../design/direction           override persistant (§6) — PROJECT_UPDATE
 *  - DELETE .../design/direction           retour à la dérivation déterministe
 *  - GET    .../design/rules/audit         audit des 10 règles CDC §8 (page réelle)
 *  - GET    .../design/rules/config        config effective (défauts CDC ou projet)
 *  - PUT    .../design/rules/config        seuils + règles projet (§8)
 *  - GET    .../design/memory              décisions design §24 (traçables)
 *  - POST   .../design/memory              mémorise une décision Decision+Reason
 *  - DELETE .../design/memory/:id          supersede (non destructif)
 *  - GET    .../design/opportunities       opportunités réelles (AQS §17) + ignores
 *  - POST   .../design/opportunities/ignore  ignore persistante (§30) — décision §24
 *  - DELETE .../design/opportunities/:id/ignore  restaure l'opportunité
 *  - GET    .../design/improvements        historique réel des améliorations appliquées
 *  - GET    .../design/governance          ledger unifié §26 (Who/What/Why/When/Previous/New/impact/Approval)
 *  - POST   .../design/audit               FULL DESIGN AUDIT §31 (multi-pages + breakpoints)
 *  - GET    .../design/components          catalogue §9/§10 + overrides projet
 *  - PUT    .../design/components/:id      dépréciation/désactivation persistée (§9/§10)
 *  - DELETE .../design/components/:id      retour au catalogue
 *  - GET    .../design/components/audit    audit réel des composants observés (§10)
 *  - POST   .../design/components/validate validation d'une proposition (garde-fou UI Agent)
 *
 * HONNÊTETÉ : chaque réponse ne contient que des mesures réelles (AQS, règles,
 * cross-page) ; une preuve absente donne null/UNKNOWN + raison. Aucune écriture
 * workspace hors des routes explicitement autorisées (direction/règles/mémoire).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { auditStore } from '../../../../packages/core/src/observability/audit.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { AQS_DIMENSION_ORDER } from '../../../../packages/core/src/ai-native/design-harmony/engine/aqs-engine.js';
import { ImprovementPlanner } from '../../../../packages/core/src/ai-native/design-harmony/engine/improvement-plan.js';
import { CrossPageHarmonyEngine } from '../../../../packages/core/src/ai-native/design-harmony/engine/cross-page-harmony.js';
import {
  buildDesignDirectionProfile,
  DESIGN_DIRECTION_CATALOG_VERSION,
  DESIGN_DIRECTION_PRESETS,
  normalizeDesignDirectionOverride
} from '../../../../packages/core/src/ai-native/design-harmony/design-direction-catalog.js';
import { designDirectionStore } from '../../../../packages/core/src/ai-native/design-harmony/design-direction-store.js';
import { designSystemStore } from '../../../../packages/core/src/ai-native/design-harmony/design-system-store.js';
import {
  auditDesignRules,
  DESIGN_RULE_AUDIT_CATALOG_VERSION,
  normalizeDesignRulesConfig
} from '../../../../packages/core/src/ai-native/design-harmony/design-rules-audit.js';
import { designRulesConfigStore } from '../../../../packages/core/src/ai-native/design-harmony/design-rules-config-store.js';
import {
  COMPONENT_CONTRACTS_VERSION,
  normalizeComponentOverride,
  resolveComponentContracts,
  summarizeComponentContract,
  validateComponentProposal
} from '../../../../packages/core/src/ai-native/design-harmony/component-contracts.js';
import { componentContractStore } from '../../../../packages/core/src/ai-native/design-harmony/component-contract-store.js';
import { auditComponentContracts } from '../../../../packages/core/src/ai-native/design-harmony/component-contracts-audit.js';
import {
  buildDesignMemoryDecision,
  type DesignMemoryDecision
} from '../../../../packages/core/src/ai-native/design-harmony/design-memory.js';
import { designMemoryStore } from '../../../../packages/core/src/ai-native/design-harmony/design-memory-store.js';
import { buildDesignGovernanceLedger } from '../../../../packages/core/src/ai-native/design-harmony/design-governance.js';
import type {
  Decision,
  DecisionAlternative
} from '../../../../packages/core/src/ai-native/decision-engine/types.js';
import type { DecisionLedger } from '../../../../packages/core/src/ai-native/decision-engine/decision-ledger.js';
import {
  computeFullDesignAuditSummary,
  type FullDesignAuditPageInput
} from '../../../../packages/core/src/ai-native/design-harmony/full-design-audit.js';
import type { AqsDimensionId } from '../../../../packages/core/src/ai-native/design-harmony/types.js';
import type { VisualSnapshot } from '../../../../packages/core/src/ai-native/visual-intelligence/types.js';
import { extractDocumentCss } from '../../../../packages/core/src/ai-native/visual-intelligence/engine/css-parser.js';
import { measureProjectAesthetics } from './design-measure.js';
import { readBody } from '../middleware/body.js';
import type { RequestContext } from '../middleware/auth.js';

const PREFIX = '/api/v1/projects/';
const DESIGN_PREFIX = '/design/';
const IMPROVEMENT_MESSAGE_PREFIX = 'Design Improve — AQS ';
const MAX_AUDIT_PAGES = 10;
const MAX_PAGE_BYTES = 400_000;
const OPPORTUNITY_TARGET = 90;

// P0 (audit 2026-10) — §23 : la Design Memory n'est pas un silo indépendant.
// Chaque décision design est référencée dans le Decision Ledger PARTAGÉ
// (celui de GET .../decisions) et dans l'Application Model. L'id du ledger est
// l'id mémoire lui-même ('dmem:…') : le lien est direct et non inventé.
let decisionLedger: DecisionLedger | undefined;

export function configureDesignSurfacesLedger(ledger: DecisionLedger): void {
  decisionLedger = ledger;
}

/** Idempotent : une mémoire déjà référencée n'est jamais dupliquée. */
function syncDesignMemoryDecisionToLedger(decision: DesignMemoryDecision): void {
  if (!decisionLedger) return;
  if (decisionLedger.getById(decision.id)) return;
  const alternative: DecisionAlternative = {
    id: decision.id + ':design',
    label: decision.decision,
    description: decision.reason,
    constraintsHonored: [],
    constraintsViolated: [],
    riskScore: 0,
    reversible: true,
    estimatedEffort: 'LOW',
    source: 'USER',
    targetFiles: [],
    proposedActions: []
  };
  const ledgerDecision: Decision = {
    decisionId: decision.id,
    sessionId: 'design-memory',
    projectId: decision.projectId,
    tenantId: decision.tenantId,
    intentGoal: decision.decision,
    intentCategory: 'DESIGN',
    verdict: 'READY',
    chosenAlternative: alternative,
    alternatives: [alternative],
    constraints: [],
    contradictingDecisions: [],
    rationale: decision.reason,
    requiredClarifications: [],
    intelligenceSources: ['design-memory'],
    createdAt: decision.recordedAt,
    status: 'ACCEPTED'
  };
  decisionLedger.recordDecision(ledgerDecision);
}

/** Non destructif : la décision ledger passe SUPERSEDED (jamais supprimée). */
function supersedeDesignMemoryInLedger(decisionId: string, supersededBy: string, reason: string): void {
  if (!decisionLedger) return;
  if (!decisionLedger.getById(decisionId)) return;
  decisionLedger.supersede(decisionId, supersededBy, reason);
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const parsed = await readBody(req);
    const value = typeof parsed === 'string' ? JSON.parse(parsed || '{}') : (parsed || {});
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function requireApprover(body: Record<string, unknown>, requestId: string): string {
  const approvedBy = typeof body.approvedBy === 'string' ? body.approvedBy.trim() : '';
  if (approvedBy.length < 2) {
    throw new ValidationError(
      'Le contrôle humain exige "approvedBy" (identité de l\'approbateur, 2 caractères minimum).',
      undefined,
      requestId
    );
  }
  return approvedBy;
}

function requireNonEmptyString(value: unknown, field: string, requestId: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) {
    throw new ValidationError(`"${field}" est obligatoire.`, { field }, requestId);
  }
  return text;
}

function knownDimension(id: string): AqsDimensionId | undefined {
  const suffix = id.startsWith('opp-') ? id.slice(4) : id;
  return (AQS_DIMENSION_ORDER as readonly string[]).includes(suffix) ? (suffix as AqsDimensionId) : undefined;
}

function auditEvent(params: {
  tenantId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string;
  metadata: Record<string, unknown>;
}): void {
  try {
    auditStore.record({
      tenantId: params.tenantId,
      userId: 'system',
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      status: 'SUCCESS',
      metadata: params.metadata,
      requestId: params.requestId
    });
  } catch {
    // L'audit ne doit jamais bloquer une opération déjà persistée.
  }
}

export async function handleDesignSurfacesRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  if (!pathname.startsWith(PREFIX) || !pathname.includes(DESIGN_PREFIX)) {
    return false;
  }
  const rest = pathname.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return false;
  const projectId = rest.slice(0, slash);
  const tail = rest.slice(slash);
  if (!tail.startsWith(DESIGN_PREFIX)) return false;
  const sub = tail.slice(DESIGN_PREFIX.length);
  if (!sub || sub === 'improve') return false;

  const match =
    sub === 'directions' ||
    sub === 'direction' ||
    sub === 'rules/audit' ||
    sub === 'rules/config' ||
    sub === 'memory' ||
    sub.startsWith('memory/') ||
    sub === 'opportunities' ||
    sub === 'opportunities/ignore' ||
    /^opportunities\/[^/]+\/ignore$/.test(sub) ||
    sub === 'improvements' ||
    sub === 'governance' ||
    sub === 'audit' ||
    sub === 'components' ||
    sub === 'components/audit' ||
    sub === 'components/validate' ||
    /^components\/[a-z0-9-]+$/.test(sub);
  if (!match) return false;

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    sendJson(res, 404, { message: `Projet ${projectId} introuvable`, requestId });
    return true;
  }

  // -------------------------------------------------------------------------
  // §6 — CATALOGUE + OVERRIDE DE DIRECTION
  // -------------------------------------------------------------------------
  if (sub === 'directions' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const artifact = designSystemStore.get(context.tenantId, projectId);
    const stored = designDirectionStore.get(context.tenantId, projectId);
    const applied = artifact ? buildDesignDirectionProfile(artifact.direction, stored?.override) : null;
    sendJson(res, 200, {
      catalogVersion: DESIGN_DIRECTION_CATALOG_VERSION,
      presets: DESIGN_DIRECTION_PRESETS,
      applied,
      override: stored ?? null,
      artifactAvailable: artifact !== undefined,
      requestId
    });
    return true;
  }

  if (sub === 'direction' && req.method === 'PUT') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const body = await readJsonBody(req);
    const approvedBy = requireApprover(body, requestId);
    const rawOverride =
      body.override !== undefined
        ? body.override
        : Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'approvedBy'));
    const override = normalizeDesignDirectionOverride(rawOverride);
    const stored = designDirectionStore.set({
      tenantId: context.tenantId,
      projectId,
      override,
      updatedBy: approvedBy,
      updatedAt: new Date().toISOString()
    });
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_DIRECTION_UPDATED',
      resourceType: 'design_direction',
      resourceId: projectId,
      requestId,
      metadata: { approvedBy, dimensions: Object.keys(override) }
    });
    const artifact = designSystemStore.get(context.tenantId, projectId);
    sendJson(res, 200, {
      updated: true,
      override: stored,
      applied: artifact ? buildDesignDirectionProfile(artifact.direction, override) : null,
      requestId
    });
    return true;
  }

  if (sub === 'direction' && req.method === 'DELETE') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const url = new URL(req.url || '/', 'http://localhost');
    // M-2 (AUD-M2-02) : l'état AVANT effacement devient la preuve Previous
    // du ledger §26. Métadonnée ADDITIVE : seules les écritures futures
    // l'emportent — les événements d'audit antérieurs restent inchangés.
    const previous = designDirectionStore.get(context.tenantId, projectId);
    const removed = designDirectionStore.clearFor(context.tenantId, projectId);
    if (removed) {
      auditEvent({
        tenantId: context.tenantId,
        action: 'DESIGN_DIRECTION_RESET',
        resourceType: 'design_direction',
        resourceId: projectId,
        requestId,
        metadata: {
          resetBy: url.searchParams.get('by') || 'studio-user',
          ...(previous ? { previousOverride: previous.override } : {})
        }
      });
    }
    const artifact = designSystemStore.get(context.tenantId, projectId);
    sendJson(res, 200, {
      reset: true,
      removed,
      applied: artifact ? buildDesignDirectionProfile(artifact.direction) : null,
      requestId
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // §9/§10 — COMPOSANTS : CATALOGUE, OVERRIDES, AUDIT, VALIDATION
  // -------------------------------------------------------------------------
  if (sub === 'components' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const overrides = componentContractStore.list(context.tenantId, projectId);
    const effective = resolveComponentContracts(overrides);
    const artifact = designSystemStore.get(context.tenantId, projectId);
    sendJson(res, 200, {
      catalogVersion: COMPONENT_CONTRACTS_VERSION,
      components: effective,
      overrides,
      artifactAvailable: artifact !== undefined,
      requestId
    });
    return true;
  }

  if (sub === 'components/audit' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const files = fileStore.getAllProjectFiles(context.tenantId, projectId);
    const url = new URL(req.url || '/', 'http://localhost');
    const requested = (url.searchParams.get('page') || 'index.html').trim();
    if (!files[requested] || files[requested]!.trim().length === 0) {
      throw new ValidationError(
        `Page à auditer introuvable ou vide : "${requested}" (disponibles : ${Object.keys(files).filter((path) => path.toLowerCase().endsWith('.html')).join(', ') || 'aucune'}).`,
        { field: 'page' },
        requestId
      );
    }
    const measurement = await measureProjectAesthetics({
      tenantId: context.tenantId,
      projectId,
      requestId,
      role: context.role,
      files,
      entryFile: requested,
      pageRoute: requested === 'index.html' ? '/' : `/${requested}`
    });
    const effective = resolveComponentContracts(componentContractStore.list(context.tenantId, projectId));
    const report = auditComponentContracts({
      snapshots: [measurement.snapshot],
      mobileSnapshots: [measurement.mobileSnapshot],
      tokens: measurement.tokens,
      cssContent: extractDocumentCss(measurement.htmlContent),
      contracts: effective
    });
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_COMPONENTS_AUDITED',
      resourceType: 'design_components_audit',
      resourceId: report.auditId,
      requestId,
      metadata: { projectId, page: requested, summary: report.summary }
    });
    sendJson(res, 200, {
      audit: report,
      page: requested,
      aqsOverall: measurement.aqs.overall,
      requestId
    });
    return true;
  }

  if (sub === 'components/validate' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await readJsonBody(req);
    const componentId = requireNonEmptyString(body.componentId, 'componentId', requestId);
    const rawVariants = body.variants;
    const variants: Record<string, string> = {};
    if (rawVariants !== undefined && rawVariants !== null) {
      if (typeof rawVariants !== 'object' || Array.isArray(rawVariants)) {
        throw new ValidationError('"variants" doit être un objet axe → valeur.', { field: 'variants' }, requestId);
      }
      for (const [axis, value] of Object.entries(rawVariants as Record<string, unknown>)) {
        variants[axis] = String(value);
      }
    }
    if (body.states !== undefined && !Array.isArray(body.states)) {
      throw new ValidationError('"states" doit être un tableau.', { field: 'states' }, requestId);
    }
    const states = Array.isArray(body.states) ? body.states.map((state) => String(state)) : [];
    const effective = resolveComponentContracts(componentContractStore.list(context.tenantId, projectId));
    const verdict = validateComponentProposal({ componentId, variants, states }, effective);
    sendJson(res, 200, { verdict, catalogVersion: COMPONENT_CONTRACTS_VERSION, requestId });
    return true;
  }

  const componentMatch = sub.match(/^components\/([a-z0-9-]+)$/);
  if (componentMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
    const componentId = componentMatch[1]!;
    const effectiveBefore = resolveComponentContracts(componentContractStore.list(context.tenantId, projectId));
    if (!effectiveBefore.some((contract) => contract.id === componentId)) {
      throw new ValidationError(`Composant inconnu : "${componentId}".`, { field: 'componentId' }, requestId);
    }

    if (req.method === 'PUT') {
      assertPermission(context.role, 'PROJECT_UPDATE', requestId);
      const body = await readJsonBody(req);
      const approvedBy = requireApprover(body, requestId);
      const override = normalizeComponentOverride(body, componentId);
      const stored = componentContractStore.set({
        tenantId: context.tenantId,
        projectId,
        componentId,
        override,
        updatedBy: approvedBy,
        updatedAt: new Date().toISOString()
      });
      auditEvent({
        tenantId: context.tenantId,
        action: 'DESIGN_COMPONENT_OVERRIDE_UPDATED',
        resourceType: 'design_component',
        resourceId: componentId,
        requestId,
        metadata: { projectId, approvedBy, status: override.status, replacementId: override.replacementId ?? null }
      });
      const applied = resolveComponentContracts(componentContractStore.list(context.tenantId, projectId)).find(
        (contract) => contract.id === componentId
      );
      sendJson(res, 200, {
        updated: true,
        override: stored,
        applied: applied ? summarizeComponentContract(applied) : null,
        catalogVersion: COMPONENT_CONTRACTS_VERSION,
        requestId
      });
      return true;
    }

    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const url = new URL(req.url || '/', 'http://localhost');
    const by = url.searchParams.get('by') || 'studio-user';
    // M-2 (AUD-M2-02) : statut/raison RÉELLEMENT effacés → Previous du
    // ledger §26. Métadonnée ADDITIVE (écritures futures uniquement).
    const previous = componentContractStore.get(context.tenantId, projectId, componentId);
    const removed = componentContractStore.clearFor(context.tenantId, projectId, componentId);
    if (removed) {
      auditEvent({
        tenantId: context.tenantId,
        action: 'DESIGN_COMPONENT_OVERRIDE_RESET',
        resourceType: 'design_component',
        resourceId: componentId,
        requestId,
        metadata: {
          projectId,
          by,
          ...(previous
            ? {
                previousStatus: previous.override.status,
                previousReason: previous.override.reason ?? null
              }
            : {})
        }
      });
    }
    const applied = resolveComponentContracts(componentContractStore.list(context.tenantId, projectId)).find(
      (contract) => contract.id === componentId
    );
    sendJson(res, 200, {
      reset: true,
      removed,
      applied: applied ? summarizeComponentContract(applied) : null,
      catalogVersion: COMPONENT_CONTRACTS_VERSION,
      requestId
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // §8 — RÈGLES : CONFIG PROJET + AUDIT DES 10 RÈGLES CDC
  // -------------------------------------------------------------------------
  if (sub === 'rules/config' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const stored = designRulesConfigStore.get(context.tenantId, projectId);
    sendJson(res, 200, {
      catalogVersion: DESIGN_RULE_AUDIT_CATALOG_VERSION,
      config: stored?.config ?? designRulesConfigStore.getEffective(context.tenantId, projectId),
      customized: stored !== undefined,
      updatedAt: stored?.updatedAt ?? null,
      updatedBy: stored?.updatedBy ?? null,
      requestId
    });
    return true;
  }

  if (sub === 'rules/config' && req.method === 'PUT') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const body = await readJsonBody(req);
    const approvedBy = requireApprover(body, requestId);
    const config = normalizeDesignRulesConfig(body.config !== undefined ? body.config : body);
    const stored = designRulesConfigStore.set({
      tenantId: context.tenantId,
      projectId,
      config,
      updatedBy: approvedBy,
      updatedAt: new Date().toISOString()
    });
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_RULES_CONFIG_UPDATED',
      resourceType: 'design_rules_config',
      resourceId: projectId,
      requestId,
      metadata: {
        approvedBy,
        disabledRuleIds: config.disabledRuleIds,
        customRules: config.customRules.length
      }
    });
    sendJson(res, 200, { updated: true, config: stored.config, requestId });
    return true;
  }

  if (sub === 'rules/audit' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const files = fileStore.getAllProjectFiles(context.tenantId, projectId);
    if (!files['index.html'] || files['index.html']!.trim().length === 0) {
      throw new ValidationError('Ce projet ne contient aucun index.html à auditer.', undefined, requestId);
    }
    const measurement = await measureProjectAesthetics({
      tenantId: context.tenantId,
      projectId,
      requestId,
      role: context.role,
      files,
      pageRoute: '/'
    });
    const report = auditDesignRules({
      snapshot: measurement.snapshot,
      tokens: measurement.tokens,
      cssContent: extractDocumentCss(measurement.htmlContent),
      config: designRulesConfigStore.getEffective(context.tenantId, projectId)
    });
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_RULES_AUDITED',
      resourceType: 'design_rules_audit',
      resourceId: projectId,
      requestId,
      metadata: report.summary
    });
    sendJson(res, 200, {
      audit: report,
      aqsOverall: measurement.aqs.overall,
      requestId
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // §24 — DESIGN MEMORY
  // -------------------------------------------------------------------------
  if (sub === 'memory' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const decisions = designMemoryStore.list(context.tenantId, projectId);
    sendJson(res, 200, {
      decisions,
      activeCount: decisions.filter((decision) => decision.status === 'ACTIVE').length,
      maxDecisions: 200,
      requestId
    });
    return true;
  }

  if (sub === 'memory' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const body = await readJsonBody(req);
    const now = new Date().toISOString();
    const decision = buildDesignMemoryDecision(
      {
        tenantId: context.tenantId,
        projectId,
        decision: body.decision as string,
        reason: body.reason as string,
        ...(body.kind !== undefined ? { kind: body.kind as 'DECISION' | 'IGNORE_OPPORTUNITY' } : {}),
        ...(body.source !== undefined ? { source: body.source as 'HUMAN' | 'AGENT' | 'IMPROVEMENT' } : {}),
        ...(body.dimension !== undefined ? { dimension: body.dimension as string } : {}),
        ...(body.opportunityId !== undefined ? { opportunityId: body.opportunityId as string } : {}),
        ...(body.approvedBy !== undefined ? { approvedBy: body.approvedBy as string } : {})
      },
      { createdAt: now, recordedAt: now }
    );
    const result = designMemoryStore.record(decision);
    if (result.created) {
      auditEvent({
        tenantId: context.tenantId,
        action: 'DESIGN_MEMORY_RECORDED',
        resourceType: 'design_memory',
        resourceId: result.decision.id,
        requestId,
        metadata: {
          projectId,
          kind: result.decision.kind,
          source: result.decision.source,
          dimension: result.decision.dimension ?? null
        }
      });
      syncDesignMemoryDecisionToLedger(result.decision);
    }
    sendJson(res, 200, { decision: result.decision, created: result.created, requestId });
    return true;
  }

  if (sub.startsWith('memory/') && req.method === 'DELETE') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const decisionId = decodeURIComponent(sub.slice('memory/'.length));
    const url = new URL(req.url || '/', 'http://localhost');
    const supersededBy = url.searchParams.get('by') || 'studio-user';
    const updated = designMemoryStore.supersede(
      context.tenantId,
      projectId,
      decisionId,
      supersededBy,
      new Date().toISOString()
    );
    if (!updated) {
      sendJson(res, 404, {
        message: `Décision design active ${decisionId} introuvable`,
        requestId
      });
      return true;
    }
    // P0 §23 — la décision reste dans le ledger, marquée SUPERSEDED (jamais
    // supprimée) : l'historique des choix reste auditable côté decisions.
    supersedeDesignMemoryInLedger(decisionId, supersededBy, 'Design memory superseded (Studio/API)');
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_MEMORY_SUPERSEDED',
      resourceType: 'design_memory',
      resourceId: decisionId,
      requestId,
      metadata: { projectId, supersededBy }
    });
    sendJson(res, 200, { superseded: true, decision: updated, requestId });
    return true;
  }

  // -------------------------------------------------------------------------
  // §30 — OPPORTUNITÉS (dashboard) + IGNORE PERSISTANT
  // -------------------------------------------------------------------------
  if (sub === 'opportunities' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const files = fileStore.getAllProjectFiles(context.tenantId, projectId);
    if (!files['index.html'] || files['index.html']!.trim().length === 0) {
      throw new ValidationError('Ce projet ne contient aucun index.html à analyser.', undefined, requestId);
    }
    const measurement = await measureProjectAesthetics({
      tenantId: context.tenantId,
      projectId,
      requestId,
      role: context.role,
      files,
      pageRoute: '/'
    });
    const plan = new ImprovementPlanner().plan(measurement, 1, { target: OPPORTUNITY_TARGET });
    const ignoredIds = new Set(
      designMemoryStore
        .listActive(context.tenantId, projectId)
        .filter((decision) => decision.kind === 'IGNORE_OPPORTUNITY' && decision.opportunityId)
        .map((decision) => decision.opportunityId as string)
    );
    const opportunities = plan.proposals.map((proposal, index) => {
      const weakness = plan.weaknesses.find((entry) => entry.dimension === proposal.dimension);
      const id = `opp-${proposal.dimension}`;
      return {
        id,
        dimension: proposal.dimension,
        label: proposal.label,
        currentValue: weakness?.currentValue ?? null,
        weight: weakness?.weight ?? null,
        potentialGain: weakness?.potentialGain ?? null,
        priority: index + 1,
        why: proposal.why,
        what: proposal.what,
        impact: proposal.impact,
        risks: proposal.risks,
        evidence: weakness?.evidence ?? [],
        ignored: ignoredIds.has(id)
      };
    });
    sendJson(res, 200, {
      target: OPPORTUNITY_TARGET,
      aqsOverall: measurement.aqs.overall,
      aqsCoverage: measurement.aqs.coverage,
      computedCount: measurement.aqs.computedCount,
      unknownCount: measurement.aqs.unknownCount,
      opportunities,
      ignoredCount: ignoredIds.size,
      requestId
    });
    return true;
  }

  if (sub === 'opportunities/ignore' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const body = await readJsonBody(req);
    const opportunityId = requireNonEmptyString(body.opportunityId, 'opportunityId', requestId);
    if (!/^opp-[a-z_]{2,40}$/.test(opportunityId)) {
      throw new ValidationError(`Id d'opportunité invalide : "${opportunityId}".`, { field: 'opportunityId' }, requestId);
    }
    const approvedBy =
      typeof body.approvedBy === 'string' && body.approvedBy.trim().length > 0
        ? body.approvedBy.trim()
        : 'studio-user';
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length >= 10
        ? body.reason.trim()
        : `Opportunité ${opportunityId} masquée manuellement depuis le Studio (décision humaine).`;
    const dimension = knownDimension(opportunityId);
    const now = new Date().toISOString();
    const decision = buildDesignMemoryDecision(
      {
        tenantId: context.tenantId,
        projectId,
        kind: 'IGNORE_OPPORTUNITY',
        decision: `Ignorer l'opportunité ${opportunityId}`,
        reason,
        source: 'HUMAN',
        opportunityId,
        ...(dimension !== undefined ? { dimension } : {}),
        approvedBy
      },
      { createdAt: now, recordedAt: now }
    );
    const result = designMemoryStore.record(decision);
    if (result.created) {
      syncDesignMemoryDecisionToLedger(result.decision);
    }
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_OPPORTUNITY_IGNORED',
      resourceType: 'design_opportunity',
      resourceId: opportunityId,
      requestId,
      metadata: { projectId, approvedBy, decisionId: result.decision.id }
    });
    sendJson(res, 200, { ignored: true, decision: result.decision, created: result.created, requestId });
    return true;
  }

  const restoreMatch = sub.match(/^opportunities\/([^/]+)\/ignore$/);
  if (restoreMatch && req.method === 'DELETE') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const opportunityId = decodeURIComponent(restoreMatch[1]!);
    const url = new URL(req.url || '/', 'http://localhost');
    const by = url.searchParams.get('by') || 'studio-user';
    const active = designMemoryStore
      .listActive(context.tenantId, projectId)
      .filter((decision) => decision.kind === 'IGNORE_OPPORTUNITY' && decision.opportunityId === opportunityId);
    if (active.length === 0) {
      sendJson(res, 404, {
        message: `Aucune ignore active pour l'opportunité ${opportunityId}`,
        requestId
      });
      return true;
    }
    const restored: DesignMemoryDecision[] = [];
    for (const decision of active) {
      const updated = designMemoryStore.supersede(
        context.tenantId,
        projectId,
        decision.id,
        by,
        new Date().toISOString()
      );
      if (updated) {
        restored.push(updated);
        // P0 §23 — la décision d'ignore n'est plus active : le ledger suit.
        supersedeDesignMemoryInLedger(decision.id, by, 'Opportunité design restaurée');
      }
    }
    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_OPPORTUNITY_RESTORED',
      resourceType: 'design_opportunity',
      resourceId: opportunityId,
      requestId,
      metadata: { projectId, restored: restored.length, by }
    });
    sendJson(res, 200, { restored: true, count: restored.length, decisions: restored, requestId });
    return true;
  }

  // -------------------------------------------------------------------------
  // §29 — HISTORIQUE RÉEL DES AMÉLIORATIONS APPLIQUÉES
  // -------------------------------------------------------------------------
  if (sub === 'improvements' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const improvements = revisionStore
      .listRevisions(context.tenantId, projectId)
      .filter((revision) => revision.message.startsWith(IMPROVEMENT_MESSAGE_PREFIX))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((revision) => ({
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        message: revision.message,
        author: revision.author,
        createdAt: revision.createdAt.toISOString(),
        provenance: revision.provenance.source
      }));
    sendJson(res, 200, { improvements, count: improvements.length, requestId });
    return true;
  }

  // -------------------------------------------------------------------------
  // §26 — DESIGN GOVERNANCE : ledger unifié (agrégateur PUR, sources réelles)
  // -------------------------------------------------------------------------
  if (sub === 'governance' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const ledger = buildDesignGovernanceLedger({
      tenantId: context.tenantId,
      projectId,
      generatedAt: new Date().toISOString()
    });
    sendJson(res, 200, { ledger, requestId });
    return true;
  }

  // -------------------------------------------------------------------------
  // §31 — FULL DESIGN AUDIT (multi-pages + breakpoints)
  // -------------------------------------------------------------------------
  if (sub === 'audit' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await readJsonBody(req);
    const files = fileStore.getAllProjectFiles(context.tenantId, projectId);
    const requestedPages = Array.isArray(body.pages) && body.pages.length > 0
      ? body.pages.filter((page): page is string => typeof page === 'string')
      : undefined;
    const maxPagesRaw = Number(body.maxPages);
    const maxPages = Number.isFinite(maxPagesRaw)
      ? Math.max(1, Math.min(MAX_AUDIT_PAGES, Math.floor(maxPagesRaw)))
      : 6;

    const allHtmlPages = Object.keys(files)
      .filter((path) => path.toLowerCase().endsWith('.html') && !path.includes('..'))
      .sort((a, b) => {
        if (a === 'index.html') return -1;
        if (b === 'index.html') return 1;
        return a.localeCompare(b);
      });
    const selected = requestedPages
      ? allHtmlPages.filter((path) => requestedPages.includes(path))
      : allHtmlPages;
    if (requestedPages && selected.length === 0) {
      throw new ValidationError(
        `Aucune des pages demandées n'existe dans le projet (disponibles : ${allHtmlPages.join(', ') || 'aucune'}).`,
        { field: 'pages' },
        requestId
      );
    }
    const pagesToAudit = selected.slice(0, maxPages);

    const skipped: Array<{ path: string; reason: string }> = [];
    for (const path of selected.slice(maxPages)) {
      skipped.push({ path, reason: `borne de ${maxPages} pages atteinte` });
    }

    const pageInputs: FullDesignAuditPageInput[] = [];
    const desktopSnapshots: VisualSnapshot[] = [];
    for (const path of pagesToAudit) {
      const content = files[path] ?? '';
      if (content.trim().length === 0) {
        skipped.push({ path, reason: 'page vide' });
        continue;
      }
      if (Buffer.byteLength(content, 'utf8') > MAX_PAGE_BYTES) {
        skipped.push({ path, reason: `page trop volumineuse (> ${MAX_PAGE_BYTES} octets)` });
        continue;
      }
      try {
        const measurement = await measureProjectAesthetics({
          tenantId: context.tenantId,
          projectId,
          requestId,
          role: context.role,
          files,
          entryFile: path,
          pageRoute: path === 'index.html' ? '/' : `/${path}`
        });
        const ruleReport = auditDesignRules({
          snapshot: measurement.snapshot,
          tokens: measurement.tokens,
          cssContent: extractDocumentCss(measurement.htmlContent),
          config: designRulesConfigStore.getEffective(context.tenantId, projectId)
        });
        pageInputs.push({
          path,
          aqs: measurement.aqs,
          responsiveFindings: measurement.responsiveFindings,
          runtimeErrors: measurement.runtimeErrors,
          overflowX: measurement.mobileOverflow?.overflowX ?? null,
          ruleSummary: ruleReport.summary,
          viewports: {
            desktop: { width: 1440, height: 900 },
            mobile: { width: 390, height: 844 }
          }
        });
        desktopSnapshots.push(measurement.snapshot);
      } catch (err) {
        skipped.push({
          path,
          reason: `mesure impossible : ${err instanceof Error ? err.message : String(err)}`
        });
      }
    }

    const crossPageFindings =
      desktopSnapshots.length >= 2
        ? new CrossPageHarmonyEngine().analyzeCrossPageConsistency(desktopSnapshots)
        : [];
    const summary = computeFullDesignAuditSummary(pageInputs, crossPageFindings);
    const auditId =
      'fda-' +
      createHash('sha256')
        .update(
          JSON.stringify({
            pages: pageInputs.map((page) => ({
              path: page.path,
              overall: page.aqs.overall,
              coverage: page.aqs.coverage,
              rules: page.ruleSummary
            })),
            crossPage: crossPageFindings.length
          }),
          'utf8'
        )
        .digest('hex')
        .slice(0, 16);

    auditEvent({
      tenantId: context.tenantId,
      action: 'DESIGN_FULL_AUDIT',
      resourceType: 'design_audit',
      resourceId: auditId,
      requestId,
      metadata: {
        projectId,
        pages: pageInputs.length,
        measured: summary.pagesMeasured,
        drift: summary.designDrift.status,
        failedRules: summary.rules.fail
      }
    });

    sendJson(res, 200, {
      audit: {
        auditId,
        analyzedAt: new Date().toISOString(),
        pages: pageInputs.map((page) => ({
          path: page.path,
          overall: page.aqs.overall,
          coverage: page.aqs.coverage,
          computedCount: page.aqs.computedCount,
          unknownCount: page.aqs.unknownCount,
          subScores: page.aqs.subScores,
          responsiveFindingsCount: page.responsiveFindings.length,
          runtimeErrors: page.runtimeErrors,
          overflowX: page.overflowX ?? null,
          rules: page.ruleSummary,
          viewports: page.viewports
        })),
        skipped,
        crossPageFindings,
        summary
      },
      requestId
    });
    return true;
  }

  return false;
}
