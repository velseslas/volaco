/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Domain Discovery Engine
 */

import type { SemanticDomain, SemanticFeature, UnderstandingEvidence } from '../types.js';
import { calculateConfidence, determineCertainty } from './confidence.js';
import { createEvidence } from './evidence.js';
import { compareDomains } from './canonical.js';

interface DomainDefinition {
  readonly domainId: string;
  readonly name: string;
  readonly description: string;
}

const DOMAIN_DEFINITIONS: Record<string, DomainDefinition> = {
  dom_authentication: {
    domainId: 'dom_authentication',
    name: 'Authentication & Access Control',
    description: 'Securing application resources, authentication flows, session handling and RBAC permissions.'
  },
  dom_user_management: {
    domainId: 'dom_user_management',
    name: 'User & Identity Management',
    description: 'User profile lifecycle, account personalization, directory records and identity relations.'
  },
  dom_billing: {
    domainId: 'dom_billing',
    name: 'Billing & Commercial Operations',
    description: 'E-commerce operations, payment processing, transactional checkout and subscriptions.'
  },
  dom_analytics: {
    domainId: 'dom_analytics',
    name: 'Analytics, Reporting & Insights',
    description: 'Business observability, performance metrics, live dashboard KPI visualizations and reports.'
  },
  dom_settings: {
    domainId: 'dom_settings',
    name: 'Settings, Administration & Workspace',
    description: 'System configurations, project preferences, administrative tooling and environment controls.'
  },
  dom_content: {
    domainId: 'dom_content',
    name: 'Content, Files & Asset Management',
    description: 'Content catalog, file persistence, media uploads and document management.'
  },
  dom_core: {
    domainId: 'dom_core',
    name: 'Core Platform & Infrastructure',
    description: 'Essential runtime primitives, terminal execution, error handlers and shared utilities.'
  }
};

export function discoverDomains(
  features: readonly SemanticFeature[]
): readonly SemanticDomain[] {
  if (!features || features.length === 0) {
    return [];
  }

  const domainGroups = new Map<string, {
    definition: DomainDefinition;
    features: Set<string>;
    relatedFiles: Set<string>;
    evidence: UnderstandingEvidence[];
  }>();

  for (const feat of features) {
    const dId = feat.domainId;
    const def = DOMAIN_DEFINITIONS[dId] || {
      domainId: dId,
      name: feat.name,
      description: feat.description
    };

    let group = domainGroups.get(dId);
    if (!group) {
      group = {
        definition: def,
        features: new Set(),
        relatedFiles: new Set(),
        evidence: []
      };
      domainGroups.set(dId, group);
    }

    group.features.add(feat.featureId);
    for (const f of feat.relatedFiles) group.relatedFiles.add(f);

    group.evidence.push(createEvidence(
      'MODULE_MEMBERSHIP',
      `Feature: ${feat.featureId}`,
      `Fonctionnalité ${feat.name} (${feat.certainty}, confidence: ${feat.confidence}) incluse dans le domaine`,
      { confidence: feat.confidence }
    ));
  }

  const domains: SemanticDomain[] = [];

  for (const [dId, g] of domainGroups.entries()) {
    if (g.evidence.length === 0 || g.features.size === 0) continue;

    const confidence = calculateConfidence(g.evidence);
    const certainty = determineCertainty(confidence);

    domains.push({
      domainId: dId,
      name: g.definition.name,
      description: g.definition.description,
      features: Array.from(g.features).sort(),
      relatedFiles: Array.from(g.relatedFiles).sort(),
      certainty,
      confidence,
      evidence: [...g.evidence].sort((a, b) => a.source.localeCompare(b.source))
    });
  }

  return domains.sort(compareDomains);
}
