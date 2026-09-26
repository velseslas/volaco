/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Node Criticality, Risk Level, and Risk Factor Evaluation Engine
 */

import type { SemanticNode } from '../../semantic-graph/types.js';
import type {
  ChangeType,
  ImpactClassification,
  ImpactRiskFactor,
  ImpactRiskLevel,
  ImpactedNode
} from '../types.js';

export interface CriticalityContext {
  readonly changeType: ChangeType;
  readonly directDependentCount: number;
  readonly totalDependentCount: number;
  readonly layersInvolved: ReadonlySet<string>;
  readonly hasCircularDependency: boolean;
  readonly routesAffected: readonly SemanticNode[];
  readonly entryPointsAffected: readonly SemanticNode[];
}

/**
 * Evaluates individual node risk level based on node kind, depth, classification, and change type.
 */
export function evaluateNodeRisk(
  node: SemanticNode,
  depth: number,
  classification: ImpactClassification,
  changeType: ChangeType
): ImpactRiskLevel {
  // Direct route or entry point impacts are always CRITICAL
  if (node.kind === 'ROUTE' || node.kind === 'ENTRY_POINT') {
    return 'CRITICAL';
  }

  // Deletions of direct dependents are CRITICAL or HIGH
  if (changeType === 'DELETE' && depth === 1) {
    if (node.kind === 'COMPONENT' || node.kind === 'INTERFACE' || node.kind === 'TYPE') {
      return 'CRITICAL';
    }
    return 'HIGH';
  }

  // Breaking classification
  if (classification === 'BREAKING') {
    if (depth === 1) {
      return 'HIGH';
    }
    return 'MEDIUM';
  }

  // Regression risk
  if (classification === 'REGRESSION_RISK') {
    if (node.kind === 'COMPONENT') {
      return 'HIGH';
    }
    return 'MEDIUM';
  }

  // Behavioral changes
  if (classification === 'BEHAVIORAL') {
    if (depth === 1) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  // Informational
  return 'LOW';
}

/**
 * Classifies an impact on a node given its depth, target kind, and change type.
 */
export function classifyImpact(
  node: SemanticNode,
  depth: number,
  edgeKind: string,
  changeType: ChangeType
): ImpactClassification {
  if (edgeKind === 'MEMBER_OF_LAYER' || edgeKind === 'MEMBER_OF_MODULE') {
    return 'INFORMATIONAL';
  }

  if (changeType === 'DELETE') {
    return depth === 1 ? 'BREAKING' : 'REGRESSION_RISK';
  }

  if (node.kind === 'ROUTE') {
    return 'BREAKING';
  }

  if (depth === 1) {
    if (edgeKind === 'IMPLEMENTS' || edgeKind === 'EXTENDS') {
      return 'BREAKING';
    }
    return 'BEHAVIORAL';
  }

  return 'REGRESSION_RISK';
}

/**
 * Generates a descriptive reason string for why a node is impacted.
 */
export function buildImpactReason(
  node: SemanticNode,
  depth: number,
  classification: ImpactClassification,
  edgeKind: string,
  sourceName: string
): string {
  if (depth === 1) {
    switch (classification) {
      case 'BREAKING':
        return `Direct breaking impact: ${node.kind} '${node.name}' depends on '${sourceName}' via ${edgeKind}`;
      case 'BEHAVIORAL':
        return `Direct behavioral impact: ${node.kind} '${node.name}' consumes '${sourceName}' via ${edgeKind}`;
      case 'REGRESSION_RISK':
        return `Direct regression risk: ${node.kind} '${node.name}' linked to '${sourceName}' via ${edgeKind}`;
      case 'INFORMATIONAL':
        return `Architectural association: ${node.kind} '${node.name}' linked via ${edgeKind}`;
    }
  }

  return `Transitive impact at depth ${depth}: ${node.kind} '${node.name}' affected through propagation chain`;
}

/**
 * Identifies architectural risk factors across the entire impact analysis.
 */
export function identifyRiskFactors(
  context: CriticalityContext,
  impactedNodes: readonly ImpactedNode[]
): readonly ImpactRiskFactor[] {
  const factors: ImpactRiskFactor[] = [];

  // 1. Route Impact
  if (context.routesAffected.length > 0) {
    const routeNames = context.routesAffected.map((r) => r.name).join(', ');
    factors.push({
      code: 'ROUTE_IMPACT',
      message: `Impact reaches ${context.routesAffected.length} application route(s): ${routeNames}. Public routing or page behavior at risk.`,
      severity: 'CRITICAL'
    });
  }

  // 2. Entry Point Impact
  if (context.entryPointsAffected.length > 0) {
    const epNames = context.entryPointsAffected.map((e) => e.name).join(', ');
    factors.push({
      code: 'ENTRY_POINT_IMPACT',
      message: `Impact reaches ${context.entryPointsAffected.length} entry point(s): ${epNames}. Application initialization affected.`,
      severity: 'CRITICAL'
    });
  }

  // 3. Multi-layer crossing
  if (context.layersInvolved.size >= 2) {
    const layersList = Array.from(context.layersInvolved).sort().join(', ');
    const severity: ImpactRiskLevel = context.layersInvolved.size >= 3 ? 'CRITICAL' : 'HIGH';
    factors.push({
      code: 'MULTI_LAYER_CROSSING',
      message: `Impact propagates across ${context.layersInvolved.size} architectural layers: ${layersList}.`,
      severity
    });
  }

  // 4. High fan-out
  if (context.totalDependentCount > 10) {
    factors.push({
      code: 'HIGH_FAN_OUT',
      message: `High dependent fan-out: ${context.totalDependentCount} nodes impacted. Wide blast radius.`,
      severity: 'CRITICAL'
    });
  } else if (context.totalDependentCount >= 5) {
    factors.push({
      code: 'MODERATE_FAN_OUT',
      message: `Moderate dependent fan-out: ${context.totalDependentCount} nodes impacted.`,
      severity: 'HIGH'
    });
  }

  // 5. Circular dependencies
  if (context.hasCircularDependency) {
    factors.push({
      code: 'CIRCULAR_DEPENDENCY',
      message: 'Circular dependency cycle detected along impact propagation paths.',
      severity: 'HIGH'
    });
  }

  // 6. Breaking changes
  const breakingCount = impactedNodes.filter((n) => n.classification === 'BREAKING').length;
  if (breakingCount > 0) {
    factors.push({
      code: 'BREAKING_CHANGES_DETECTED',
      message: `${breakingCount} node(s) face breaking contract or direct interface changes.`,
      severity: breakingCount > 3 ? 'CRITICAL' : 'HIGH'
    });
  }

  // Deterministic sorting of risk factors: by severity priority, then by code
  const SEVERITY_ORDER: Record<ImpactRiskLevel, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3
  };

  return factors.sort((a, b) => {
    const sDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sDiff !== 0) {
      return sDiff;
    }
    return a.code.localeCompare(b.code);
  });
}
