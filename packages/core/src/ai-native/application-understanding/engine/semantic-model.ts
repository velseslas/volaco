/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Semantic Model Assembly & Capabilities Engine
 */

import type { SemanticCodeGraph } from '../../semantic-graph/types.js';
import type { ApplicationDNA, DetectedTechnology } from '../../dna/types.js';
import type {
  ApplicationCapabilities,
  ApplicationSemanticModel,
  ApplicationSemanticSummary,
  ArchitecturalBoundary,
  CriticalComponentInfo,
  SemanticApi,
  SemanticBusinessRule,
  SemanticComponent,
  SemanticDataFlow,
  SemanticDomain,
  SemanticEntryPoint,
  SemanticFeature,
  SemanticService,
  SemanticUserJourney,
  SemanticWorkflow,
  UnderstandingMetrics
} from '../types.js';
import {
  compareApis,
  compareBoundaries,
  compareComponents,
  compareEntryPoints,
  compareServices
} from './canonical.js';

export function assembleSemanticModel(params: {
  tenantId: string;
  projectId: string;
  treeHash: string;
  graphHash: string;
  understandingVersion: string;
  durationMs: number;
  graph: SemanticCodeGraph;
  dna?: ApplicationDNA | undefined;
  domains: readonly SemanticDomain[];
  features: readonly SemanticFeature[];
  workflows: readonly SemanticWorkflow[];
  userJourneys: readonly SemanticUserJourney[];
  dataFlows: readonly SemanticDataFlow[];
  businessRules: readonly SemanticBusinessRule[];
}): Omit<ApplicationSemanticModel, 'understandingHash'> {
  const {
    tenantId,
    projectId,
    treeHash,
    graphHash,
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
  } = params;

  // 1. Extract Semantic Components
  const componentMap = new Map<string, SemanticComponent>();

  for (const node of graph.nodes) {
    if (node.kind === 'COMPONENT') {
      const inDegree = graph.indexes?.incomingEdgesByNode?.[node.id]?.length ?? 0;
      const matchingFeature = features.find(f => f.components.includes(node.name));

      componentMap.set(node.id, {
        id: node.id,
        name: node.name,
        filePath: node.filePath ?? '',
        domainId: matchingFeature?.domainId,
        featureId: matchingFeature?.featureId,
        isCritical: inDegree >= 2,
        dependentsCount: inDegree,
        confidence: 0.90
      });
    }
  }

  if (dna && dna.components) {
    for (const c of dna.components) {
      const id = `comp_${c.name.toLowerCase()}`;
      if (!componentMap.has(id)) {
        const matchingFeature = features.find(f => f.components.includes(c.name));
        componentMap.set(id, {
          id,
          name: c.name,
          filePath: c.filePath,
          domainId: matchingFeature?.domainId,
          featureId: matchingFeature?.featureId,
          isCritical: c.propsCount > 5,
          dependentsCount: c.propsCount,
          confidence: 0.88
        });
      }
    }
  }

  const components = Array.from(componentMap.values()).sort(compareComponents);

  // 2. Extract Semantic Services
  const serviceMap = new Map<string, SemanticService>();
  for (const node of graph.nodes) {
    if ((node.kind === 'CLASS' || node.kind === 'FUNCTION' || node.kind === 'SYMBOL') && /service/i.test(node.name)) {
      const matchingFeature = features.find(f => f.services.includes(node.name));
      serviceMap.set(node.id, {
        id: node.id,
        name: node.name,
        filePath: node.filePath ?? '',
        domainId: matchingFeature?.domainId,
        featureId: matchingFeature?.featureId,
        methods: [],
        confidence: 0.85
      });
    }
  }
  const services = Array.from(serviceMap.values()).sort(compareServices);

  // 3. Extract APIs
  const apiMap = new Map<string, SemanticApi>();
  for (const node of graph.nodes) {
    if (node.kind === 'ROUTE') {
      const matchingFeature = features.find(f => f.routes.includes(node.name));
      apiMap.set(node.id, {
        id: node.id,
        path: node.name,
        method: 'GET/POST',
        filePath: node.filePath ?? '',
        domainId: matchingFeature?.domainId,
        featureId: matchingFeature?.featureId,
        confidence: 0.90
      });
    }
  }
  const apis = Array.from(apiMap.values()).sort(compareApis);

  // 4. Extract Entry Points
  const entryPointList: SemanticEntryPoint[] = [];
  for (const node of graph.nodes) {
    if (node.kind === 'ENTRY_POINT') {
      entryPointList.push({
        path: node.name,
        role: 'APPLICATION_ENTRY',
        confidence: 0.95
      });
    }
  }
  if (dna?.architecture?.entryPoints) {
    for (const ep of dna.architecture.entryPoints) {
      if (!entryPointList.some(e => e.path === ep.path)) {
        entryPointList.push({
          path: ep.path,
          role: ep.role,
          confidence: 0.92
        });
      }
    }
  }
  const entryPoints = entryPointList.sort(compareEntryPoints);

  // 5. Extract Architectural Boundaries
  const boundariesList: ArchitecturalBoundary[] = [];
  if (dna?.modules) {
    for (const mod of dna.modules) {
      boundariesList.push({
        name: mod.name,
        rootPath: mod.rootPath,
        layer: 'APPLICATION_MODULE',
        files: [...mod.files].sort(),
        publicExports: [...mod.publicExports].sort(),
        allowedDependencies: [...mod.externalDependencies].sort()
      });
    }
  }
  if (dna?.architecture?.layers) {
    for (const lay of dna.architecture.layers) {
      boundariesList.push({
        name: lay.name,
        rootPath: lay.filePaths[0] ?? lay.name,
        layer: lay.kind,
        files: [...lay.filePaths].sort(),
        publicExports: [],
        allowedDependencies: [...lay.dependenciesOnLayers].sort()
      });
    }
  }
  const boundaries = boundariesList.sort(compareBoundaries);

  // 6. Build Application Capabilities
  const criticalComponents: CriticalComponentInfo[] = components
    .filter(c => c.isCritical || c.dependentsCount >= 2)
    .map(c => ({
      name: c.name,
      filePath: c.filePath,
      reason: `High dependency centrality (${c.dependentsCount} direct dependents)`,
      dependentsCount: c.dependentsCount
    }))
    .sort((a, b) => b.dependentsCount - a.dependentsCount);

  const dataStores = dna?.stack?.databaseOrOrm?.name ? [dna.stack.databaseOrOrm.name] : ['Application Local/FileStore'];
  const capabilitiesList = [
    ...features.map(f => `Feature: ${f.name} (${f.certainty})`),
    ...workflows.map(w => `Workflow: ${w.name}`)
  ];

  const capabilities: ApplicationCapabilities = {
    summary: `Application multi-modulaire composée de ${features.length} fonctionnalités majeures réparties sur ${domains.length} domaines métier.`,
    primaryStack: {
      language: dna?.stack?.language?.name ?? 'TypeScript',
      framework: dna?.stack?.framework?.name ?? 'Node.js',
      runtime: dna?.stack?.runtime?.name ?? 'Node'
    },
    architecturalPattern: dna?.architecture?.primaryPattern?.pattern ?? 'MODULAR_MONOLITH',
    criticalComponents,
    dataStores,
    externalIntegrations: dna?.stack?.additionalTechnologies?.map((t: DetectedTechnology) => t.name) ?? [],
    entryPointsCount: entryPoints.length,
    capabilitiesList: capabilitiesList.sort()
  };

  // 7. Calculate Metrics & Certainty breakdown
  let observedCount = 0;
  let inferredCount = 0;
  let hypothesizedCount = 0;
  let totalConfidenceSum = 0;
  let totalConfidenceItems = 0;

  const countCertainty = (certainty: 'OBSERVED' | 'INFERRED' | 'HYPOTHESIZED', conf: number) => {
    if (certainty === 'OBSERVED') observedCount++;
    else if (certainty === 'INFERRED') inferredCount++;
    else hypothesizedCount++;
    totalConfidenceSum += conf;
    totalConfidenceItems++;
  };

  for (const d of domains) countCertainty(d.certainty, d.confidence);
  for (const f of features) countCertainty(f.certainty, f.confidence);
  for (const w of workflows) countCertainty(w.certainty, w.confidence);
  for (const j of userJourneys) countCertainty(j.certainty, j.confidence);
  for (const df of dataFlows) countCertainty(df.certainty, df.confidence);
  for (const br of businessRules) countCertainty(br.certainty, br.confidence);

  const overallConfidence = totalConfidenceItems > 0
    ? Math.round((totalConfidenceSum / totalConfidenceItems) * 10000) / 10000
    : 0.85;

  const highestRiskAreas: string[] = [];
  for (const df of dataFlows) {
    for (const r of df.potentialRisks) {
      highestRiskAreas.push(`DataFlow ${df.name}: ${r}`);
    }
  }
  for (const crit of criticalComponents.slice(0, 3)) {
    highestRiskAreas.push(`Critical Component: ${crit.name} (${crit.dependentsCount} dependents)`);
  }

  const summary: ApplicationSemanticSummary = {
    totalDomains: domains.length,
    totalFeatures: features.length,
    totalWorkflows: workflows.length,
    totalJourneys: userJourneys.length,
    totalBusinessRules: businessRules.length,
    totalDataFlows: dataFlows.length,
    overallConfidence,
    highestRiskAreas: Array.from(new Set(highestRiskAreas)).sort()
  };

  const metrics: UnderstandingMetrics = {
    observedCount,
    inferredCount,
    hypothesizedCount,
    domainCount: domains.length,
    featureCount: features.length,
    workflowCount: workflows.length,
    dataFlowCount: dataFlows.length,
    businessRuleCount: businessRules.length,
    userJourneyCount: userJourneys.length,
    durationMs
  };

  return {
    schemaVersion: '1.0.0',
    understandingVersion,
    tenantId,
    projectId,
    treeHash,
    graphHash,
    createdAt: new Date().toISOString(),
    durationMs,
    summary,
    capabilities,
    domains,
    features,
    workflows,
    userJourneys,
    dataFlows,
    businessRules,
    components,
    services,
    apis,
    entryPoints,
    boundaries,
    metrics
  };
}
