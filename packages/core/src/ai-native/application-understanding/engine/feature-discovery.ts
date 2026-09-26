/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Feature Discovery Engine
 */

import type { SemanticCodeGraph, SemanticNode } from '../../semantic-graph/types.js';
import type { ApplicationDNA } from '../../dna/types.js';
import type { SemanticFeature, UnderstandingEvidence } from '../types.js';
import { calculateConfidence, determineCertainty } from './confidence.js';
import { createEvidence } from './evidence.js';
import { compareFeatures } from './canonical.js';

interface FeatureTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly domainId: string;
  readonly patterns: readonly RegExp[];
}

const FEATURE_TEMPLATES: readonly FeatureTemplate[] = [
  {
    id: 'feat_authentication',
    name: 'Authentication & Session Management',
    description: 'User authentication, login, registration, token verification and session lifecycle.',
    domainId: 'dom_authentication',
    patterns: [/auth/i, /login/i, /logout/i, /register/i, /token/i, /session/i, /credential/i, /oauth/i]
  },
  {
    id: 'feat_user_management',
    name: 'User & Profile Management',
    description: 'User profile management, account settings, roles and member directory.',
    domainId: 'dom_user_management',
    patterns: [/user/i, /profile/i, /account/i, /member/i, /identity/i, /avatar/i]
  },
  {
    id: 'feat_payments_billing',
    name: 'Payments & Billing',
    description: 'Checkout, payments processing, subscriptions, pricing plans and invoices.',
    domainId: 'dom_billing',
    patterns: [/pay/i, /billing/i, /checkout/i, /invoice/i, /subscription/i, /stripe/i, /cart/i, /pricing/i]
  },
  {
    id: 'feat_dashboard_analytics',
    name: 'Dashboard & Reporting',
    description: 'Interactive analytical dashboards, KPI metrics, visualization charts and activity feeds.',
    domainId: 'dom_analytics',
    patterns: [/dashboard/i, /analytics/i, /metric/i, /report/i, /kpi/i, /chart/i, /stat/i, /feed/i]
  },
  {
    id: 'feat_settings_config',
    name: 'Settings & System Configuration',
    description: 'Workspace preferences, project settings, environment variables and configuration.',
    domainId: 'dom_settings',
    patterns: [/setting/i, /config/i, /preference/i, /option/i, /env/i]
  },
  {
    id: 'feat_file_management',
    name: 'File & Asset Management',
    description: 'File tree exploration, file editing, uploads and asset storage operations.',
    domainId: 'dom_content',
    patterns: [/file/i, /explorer/i, /upload/i, /storage/i, /media/i, /asset/i, /document/i]
  },
  {
    id: 'feat_terminal_execution',
    name: 'Terminal & Command Execution',
    description: 'Embedded terminal interface, command whitelisting and interactive process execution.',
    domainId: 'dom_core',
    patterns: [/terminal/i, /command/i, /exec/i, /shell/i, /cli/i, /whitelist/i]
  },
  {
    id: 'feat_search_navigation',
    name: 'Search & Navigation',
    description: 'Global search, item filtering, tab navigation and routing systems.',
    domainId: 'dom_core',
    patterns: [/search/i, /filter/i, /navigate/i, /menu/i, /tab/i, /sidebar/i]
  },
  {
    id: 'feat_notification_alerting',
    name: 'Notifications & Alerts',
    description: 'In-app toasts, banner notifications, alerts and system messaging.',
    domainId: 'dom_core',
    patterns: [/notif/i, /toast/i, /alert/i, /message/i, /banner/i, /badge/i]
  }
];

export function discoverFeatures(
  graph: SemanticCodeGraph,
  dna?: ApplicationDNA | undefined
): readonly SemanticFeature[] {
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return [];
  }

  const featuresMap = new Map<string, {
    template: FeatureTemplate;
    relatedNodes: Set<string>;
    relatedFiles: Set<string>;
    entryPoints: Set<string>;
    routes: Set<string>;
    dataSources: Set<string>;
    dependencies: Set<string>;
    components: Set<string>;
    services: Set<string>;
    evidence: UnderstandingEvidence[];
  }>();

  // Helper to get or init feature bucket
  const getOrCreateFeature = (tpl: FeatureTemplate) => {
    let entry = featuresMap.get(tpl.id);
    if (!entry) {
      entry = {
        template: tpl,
        relatedNodes: new Set(),
        relatedFiles: new Set(),
        entryPoints: new Set(),
        routes: new Set(),
        dataSources: new Set(),
        dependencies: new Set(),
        components: new Set(),
        services: new Set(),
        evidence: []
      };
      featuresMap.set(tpl.id, entry);
    }
    return entry;
  };

  // 1. Analyze Semantic Code Graph Nodes
  for (const node of graph.nodes) {
    const textToMatch = `${node.name} ${node.filePath ?? ''}`;

    for (const tpl of FEATURE_TEMPLATES) {
      const isMatch = tpl.patterns.some(p => p.test(textToMatch));
      if (!isMatch) continue;

      const fEntry = getOrCreateFeature(tpl);
      fEntry.relatedNodes.add(node.id);
      if (node.filePath) fEntry.relatedFiles.add(node.filePath);

      if (node.kind === 'ROUTE') {
        fEntry.routes.add(node.name);
        fEntry.entryPoints.add(node.name);
        fEntry.evidence.push(createEvidence(
          'ROUTE_DECLARATION',
          `Route: ${node.name}`,
          `Route ${node.name} déclarée pour la fonctionnalité ${tpl.name}`,
          { filePath: node.filePath, lineStart: node.lineStart, confidence: 0.90 }
        ));
      } else if (node.kind === 'COMPONENT') {
        fEntry.components.add(node.name);
        fEntry.evidence.push(createEvidence(
          'COMPONENT_PROFILE',
          `Component: ${node.name}`,
          `Composant UI ${node.name} participant à ${tpl.name}`,
          { filePath: node.filePath, lineStart: node.lineStart, confidence: 0.85 }
        ));
      } else if (node.kind === 'SYMBOL' || node.kind === 'FUNCTION' || node.kind === 'CLASS') {
        if (/service/i.test(node.name)) {
          fEntry.services.add(node.name);
        }
        fEntry.evidence.push(createEvidence(
          'AST_SYMBOL',
          `Symbol: ${node.name}`,
          `Symbole ${node.name} associé à ${tpl.name}`,
          { filePath: node.filePath, lineStart: node.lineStart, confidence: 0.80 }
        ));
      } else if (node.kind === 'ENTRY_POINT') {
        fEntry.entryPoints.add(node.name);
      }
    }
  }

  // 2. Correlate with DNA Components & Modules
  if (dna) {
    if (dna.components) {
      for (const comp of dna.components) {
        for (const tpl of FEATURE_TEMPLATES) {
          if (tpl.patterns.some(p => p.test(comp.name) || p.test(comp.filePath))) {
            const fEntry = getOrCreateFeature(tpl);
            fEntry.components.add(comp.name);
            fEntry.relatedFiles.add(comp.filePath);
            fEntry.evidence.push(createEvidence(
              'COMPONENT_PROFILE',
              `DNA Component: ${comp.name}`,
              `Composant validé par DNA avec ${comp.propsCount} props et hooks [${comp.hooksUsed.join(', ')}]`,
              { filePath: comp.filePath, lineStart: comp.lineStart, confidence: 0.85 }
            ));
          }
        }
      }
    }

    if (dna.architecture?.entryPoints) {
      for (const ep of dna.architecture.entryPoints) {
        for (const tpl of FEATURE_TEMPLATES) {
          if (tpl.patterns.some(p => p.test(ep.path))) {
            const fEntry = getOrCreateFeature(tpl);
            fEntry.entryPoints.add(ep.path);
            fEntry.relatedFiles.add(ep.path);
            fEntry.evidence.push(createEvidence(
              'ROUTE_DECLARATION',
              `DNA EntryPoint: ${ep.path}`,
              `Point d'entrée d'architecture rôle: ${ep.role}`,
              { filePath: ep.path, confidence: 0.88 }
            ));
          }
        }
      }
    }
  }

  // 3. Scan Graph Edges for Inter-Feature Dependencies
  for (const edge of graph.edges) {
    if (edge.kind === 'IMPORTS' || edge.kind === 'DEPENDS_ON' || edge.kind === 'REFERENCES') {
      const sourceNode = graph.nodes.find((n: SemanticNode) => n.id === edge.sourceId);
      const targetNode = graph.nodes.find((n: SemanticNode) => n.id === edge.targetId);
      if (sourceNode && targetNode) {
        for (const [fId, fEntry] of featuresMap.entries()) {
          if (fEntry.relatedNodes.has(sourceNode.id) && !fEntry.relatedNodes.has(targetNode.id)) {
            fEntry.dependencies.add(targetNode.name);
            fEntry.evidence.push(createEvidence(
              'GRAPH_EDGE',
              `Edge: ${sourceNode.name} -> ${targetNode.name}`,
              `Dépendance de graphe prouvée (${edge.kind}) vers ${targetNode.name}`,
              { filePath: sourceNode.filePath, confidence: 0.82 }
            ));
          }
        }
      }
    }
  }

  // 4. Transform into Immutable SemanticFeature List (only those with proven evidence!)
  const result: SemanticFeature[] = [];

  for (const [id, f] of featuresMap.entries()) {
    // Strict No Evidence -> No Claim principle:
    if (f.evidence.length === 0 || f.relatedNodes.size === 0) {
      continue;
    }

    const confidence = calculateConfidence(f.evidence);
    const certainty = determineCertainty(confidence);

    result.push({
      featureId: id,
      name: f.template.name,
      description: f.template.description,
      domainId: f.template.domainId,
      certainty,
      confidence,
      relatedNodes: Array.from(f.relatedNodes).sort(),
      relatedFiles: Array.from(f.relatedFiles).sort(),
      entryPoints: Array.from(f.entryPoints).sort(),
      routes: Array.from(f.routes).sort(),
      dataSources: Array.from(f.dataSources).sort(),
      dependencies: Array.from(f.dependencies).sort(),
      components: Array.from(f.components).sort(),
      services: Array.from(f.services).sort(),
      evidence: [...f.evidence].sort((a, b) => a.source.localeCompare(b.source))
    });
  }

  // Canonical ordering
  return result.sort(compareFeatures);
}
