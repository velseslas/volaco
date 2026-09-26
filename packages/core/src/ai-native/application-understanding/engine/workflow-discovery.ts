/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Workflow Discovery & Trace Engine
 */

import type { SemanticCodeGraph, SemanticNode, SemanticEdge } from '../../semantic-graph/types.js';
import type { SemanticFeature, SemanticWorkflow, WorkflowStep, UnderstandingEvidence } from '../types.js';
import { calculateConfidence, determineCertainty } from './confidence.js';
import { createEvidence } from './evidence.js';
import { compareWorkflows } from './canonical.js';

export function discoverWorkflows(
  graph: SemanticCodeGraph,
  features: readonly SemanticFeature[]
): readonly SemanticWorkflow[] {
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return [];
  }

  const workflows: SemanticWorkflow[] = [];
  const nodeMap = new Map<string, SemanticNode>(graph.nodes.map((n: SemanticNode) => [n.id, n]));

  // 1. Identify Entry Points and Routes as workflow initiators
  const routeNodes = graph.nodes.filter((n: SemanticNode) => n.kind === 'ROUTE' || n.kind === 'ENTRY_POINT');

  for (const initiator of routeNodes) {
    const isRoute = initiator.kind === 'ROUTE';
    const cleanName = initiator.name.replace(/^\//, '').replace(/[^a-zA-Z0-9_]+/g, '_') || 'root';
    const wfId = `wf_${cleanName.toLowerCase()}`;

    const steps: WorkflowStep[] = [];
    const evidence: UnderstandingEvidence[] = [];
    const visitedNodes = new Set<string>([initiator.id]);
    const dependencies = new Set<string>();
    const failurePoints = new Set<string>();

    // Step 0: Initial Trigger
    steps.push({
      stepIndex: 0,
      name: `Trigger: ${initiator.name}`,
      actor: 'USER',
      nodeId: initiator.id,
      filePath: initiator.filePath,
      operation: isRoute ? 'HTTP_REQUEST' : 'INITIAL_LOAD',
      dependencies: []
    });

    evidence.push(createEvidence(
      'ROUTE_DECLARATION',
      `Trigger: ${initiator.name}`,
      `Déclencheur d'exécution initial du workflow via ${initiator.kind} ${initiator.name}`,
      { filePath: initiator.filePath, lineStart: initiator.lineStart, confidence: 0.90 }
    ));

    // Follow outgoing edges from initiator (IMPORTS, REFERENCES, ROUTES_TO, COMPOSES)
    const outgoingEdgeIds = graph.indexes?.outgoingEdgesByNode?.[initiator.id] ?? [];
    let stepIndex = 1;

    for (const edgeId of outgoingEdgeIds) {
      const edge = graph.edges.find((e: SemanticEdge) => e.id === edgeId);
      if (!edge) continue;

      const target = nodeMap.get(edge.targetId);
      if (!target || visitedNodes.has(target.id)) continue;
      visitedNodes.add(target.id);

      let op = 'PROCESS_INVOCATION';
      if (target.kind === 'COMPONENT') op = 'RENDER_COMPONENT';
      else if (target.kind === 'FUNCTION' || target.kind === 'SYMBOL') op = 'EXECUTE_HANDLER';

      steps.push({
        stepIndex,
        name: `Handle: ${target.name}`,
        actor: 'SYSTEM',
        nodeId: target.id,
        filePath: target.filePath,
        operation: op,
        dependencies: [initiator.name]
      });

      dependencies.add(target.name);

      evidence.push(createEvidence(
        'GRAPH_EDGE',
        `Edge: ${initiator.name} -> ${target.name}`,
        `Étape opérationnelle liée par edge ${edge.kind}`,
        { filePath: target.filePath, confidence: 0.85 }
      ));

      // Check if target or its children could fail
      if (/auth|validate|check|verify|guard|assert|pay|bill/i.test(target.name)) {
        failurePoints.add(`Validation/Verification error in ${target.name}`);
      }

      stepIndex++;
      if (stepIndex > 6) break; // keep workflows concise and bounded
    }

    // Default failure point
    if (failurePoints.size === 0) {
      failurePoints.add(`Unexpected runtime exception in ${initiator.name}`);
    }

    const confidence = calculateConfidence(evidence);
    const certainty = determineCertainty(confidence);

    workflows.push({
      workflowId: wfId,
      name: `Workflow ${initiator.name}`,
      description: `Operational flow executing when ${initiator.name} is invoked.`,
      trigger: isRoute ? `HTTP Request on ${initiator.name}` : `Application startup at ${initiator.name}`,
      actors: ['USER', 'SYSTEM'],
      entryPoints: [initiator.name],
      steps,
      outputs: ['HTTP 200 Response', 'UI Render State'],
      dependencies: Array.from(dependencies).sort(),
      failurePoints: Array.from(failurePoints).sort(),
      certainty,
      confidence,
      evidence: evidence.sort((a, b) => a.source.localeCompare(b.source))
    });
  }

  // If no routes, generate from top feature components
  if (workflows.length === 0 && features.length > 0) {
    for (const feat of features.slice(0, 3)) {
      if (feat.components.length === 0) continue;
      const compName = feat.components[0];
      if (!compName) continue;
      const wfId = `wf_${feat.featureId.replace('feat_', '')}`;

      workflows.push({
        workflowId: wfId,
        name: `Workflow ${feat.name}`,
        description: `Standard user interaction workflow for ${feat.name}.`,
        trigger: `User interaction with ${compName}`,
        actors: ['USER', 'SYSTEM'],
        entryPoints: [compName],
        steps: [
          {
            stepIndex: 0,
            name: `Mount ${compName}`,
            actor: 'USER',
            operation: 'MOUNT_COMPONENT',
            dependencies: []
          },
          {
            stepIndex: 1,
            name: `Process ${feat.name} Action`,
            actor: 'SYSTEM',
            operation: 'STATE_UPDATE',
            dependencies: [compName]
          }
        ],
        outputs: ['Rendered View', 'State Transition'],
        dependencies: feat.dependencies,
        failurePoints: [`Component render error in ${compName}`],
        certainty: 'INFERRED',
        confidence: 0.70,
        evidence: [createEvidence('COMPONENT_PROFILE', `Component: ${compName}`, `Workflow basé sur composant ${compName}`)]
      });
    }
  }

  return workflows.sort(compareWorkflows);
}
