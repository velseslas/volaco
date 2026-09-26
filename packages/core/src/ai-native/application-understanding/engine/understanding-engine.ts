/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Understanding Engine Orchestrator
 */

import type { SemanticCodeGraph } from '../../semantic-graph/types.js';
import type { ApplicationDNA } from '../../dna/types.js';
import type { ApplicationSemanticModel, UnderstandingConfig, UnderstandingRequest } from '../types.js';
import { discoverFeatures } from './feature-discovery.js';
import { discoverDomains } from './domain-discovery.js';
import { discoverWorkflows } from './workflow-discovery.js';
import { discoverUserJourneys } from './journey-discovery.js';
import { discoverDataFlows } from './data-flow-discovery.js';
import { discoverBusinessRules } from './business-rule-discovery.js';
import { assembleSemanticModel } from './semantic-model.js';
import { computeUnderstandingHash, deepFreeze } from './canonical.js';

export function runUnderstandingAnalysis(
  request: UnderstandingRequest,
  graph: SemanticCodeGraph,
  dna?: ApplicationDNA | undefined,
  config?: UnderstandingConfig | undefined
): ApplicationSemanticModel {
  const startTime = Date.now();
  const understandingVersion = config?.understandingVersion ?? '1.0.0';

  // 1. Run all discovery engines deterministically
  const features = discoverFeatures(graph, dna);
  const domains = discoverDomains(features);
  const workflows = discoverWorkflows(graph, features);
  const userJourneys = discoverUserJourneys(graph, features);
  const dataFlows = discoverDataFlows(graph);
  const businessRules = discoverBusinessRules(graph);

  const durationMs = Date.now() - startTime;

  // 2. Assemble candidate model without hash
  const candidateModel = assembleSemanticModel({
    tenantId: request.tenantId,
    projectId: request.projectId,
    treeHash: graph.treeHash,
    graphHash: graph.graphHash,
    understandingVersion,
    durationMs,
    graph,
    dna,
    domains,
    features,
    workflows,
    userJourneys,
    dataFlows,
    businessRules
  });

  // 3. Compute deterministic canonical hash
  const understandingHash = computeUnderstandingHash(candidateModel as unknown as Record<string, unknown>);

  const completeModel: ApplicationSemanticModel = {
    ...candidateModel,
    understandingHash
  };

  // 4. Guarantee complete immutability
  return deepFreeze(completeModel);
}
