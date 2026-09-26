/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Data Flow Discovery & Lineage Engine
 */

import type { SemanticCodeGraph, SemanticNode, SemanticEdge } from '../../semantic-graph/types.js';
import type { DataFlowStep, SemanticDataFlow, UnderstandingEvidence } from '../types.js';
import { calculateConfidence, determineCertainty } from './confidence.js';
import { createEvidence } from './evidence.js';
import { compareDataFlows } from './canonical.js';

export function discoverDataFlows(
  graph: SemanticCodeGraph
): readonly SemanticDataFlow[] {
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return [];
  }

  const flows: SemanticDataFlow[] = [];
  const nodeMap = new Map<string, SemanticNode>(graph.nodes.map((n: SemanticNode) => [n.id, n]));

  // Detect Data Ingestion Flows (Forms / Route Handlers / Services)
  const inputNodes = graph.nodes.filter((n: SemanticNode) =>
    n.kind === 'ROUTE' ||
    (n.kind === 'COMPONENT' && /form|input|modal|editor/i.test(n.name))
  );

  for (const sourceNode of inputNodes) {
    const cleanId = sourceNode.name.replace(/^\//, '').replace(/[^a-zA-Z0-9_]+/g, '_') || 'input';
    const flowId = `flow_${cleanId.toLowerCase()}`;

    const sources = [sourceNode.name];
    const destinations = new Set<string>();
    const apis = new Set<string>();
    const services = new Set<string>();
    const repositories = new Set<string>();
    const components = new Set<string>();
    const risks = new Set<string>();
    const steps: DataFlowStep[] = [];
    const evidence: UnderstandingEvidence[] = [];

    if (sourceNode.kind === 'ROUTE') apis.add(sourceNode.name);
    if (sourceNode.kind === 'COMPONENT') components.add(sourceNode.name);

    evidence.push(createEvidence(
      sourceNode.kind === 'ROUTE' ? 'ROUTE_DECLARATION' : 'COMPONENT_PROFILE',
      `Source: ${sourceNode.name}`,
      `Source d'ingestion de données identifiée (${sourceNode.kind})`,
      { filePath: sourceNode.filePath, lineStart: sourceNode.lineStart, confidence: 0.85 }
    ));

    // Follow data path via graph edges
    const outgoingEdgeIds = graph.indexes?.outgoingEdgesByNode?.[sourceNode.id] ?? [];
    for (const edgeId of outgoingEdgeIds) {
      const edge = graph.edges.find((e: SemanticEdge) => e.id === edgeId);
      if (!edge) continue;

      const target = nodeMap.get(edge.targetId);
      if (!target) continue;

      const stepEvidence = [
        createEvidence('GRAPH_EDGE', `Edge: ${sourceNode.name} -> ${target.name}`, `Lien de données (${edge.kind})`)
      ];

      steps.push({
        fromNodeId: sourceNode.id,
        toNodeId: target.id,
        transformation: `Process payload via ${target.name}`,
        edgeKind: edge.kind,
        evidence: stepEvidence
      });

      evidence.push(...stepEvidence);

      if (/service/i.test(target.name)) services.add(target.name);
      if (/repo|store|db|persist|storage/i.test(target.name)) {
        repositories.add(target.name);
        destinations.add(`Persistent Storage (${target.name})`);
      }
      if (target.kind === 'COMPONENT') components.add(target.name);
    }

    if (destinations.size === 0) {
      destinations.add('Application State / View Memory');
    }

    // Risk analysis
    if (sourceNode.kind === 'ROUTE' && services.size === 0) {
      risks.add('Direct route handling without dedicated service abstraction');
    }
    if (/pay|bill|pass|token|secret/i.test(sourceNode.name)) {
      risks.add('Sensitive data flow requires encrypted transmission and audit trails');
    }

    const confidence = calculateConfidence(evidence);
    const certainty = determineCertainty(confidence);

    flows.push({
      flowId,
      name: `Data Flow: ${sourceNode.name}`,
      sources,
      destinations: Array.from(destinations).sort(),
      apis: Array.from(apis).sort(),
      services: Array.from(services).sort(),
      repositories: Array.from(repositories).sort(),
      components: Array.from(components).sort(),
      steps,
      potentialRisks: Array.from(risks).sort(),
      certainty,
      confidence,
      evidence: evidence.sort((a, b) => a.source.localeCompare(b.source))
    });
  }

  return flows.sort(compareDataFlows);
}
