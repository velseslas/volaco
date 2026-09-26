/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Semantic Model Query Selectors
 */

import type {
  ApplicationCapabilities,
  ApplicationSemanticModel,
  BusinessRuleQueryFilter,
  DataFlowQueryFilter,
  DomainQueryFilter,
  FeatureQueryFilter,
  JourneyQueryFilter,
  SemanticBusinessRule,
  SemanticComponent,
  SemanticDataFlow,
  SemanticDomain,
  SemanticEntryPoint,
  SemanticFeature,
  SemanticUserJourney,
  SemanticWorkflow,
  WorkflowQueryFilter
} from '../types.js';

export function selectFeatures(
  model: ApplicationSemanticModel,
  filter?: FeatureQueryFilter
): readonly SemanticFeature[] {
  return model.features.filter(f => {
    if (filter?.domainId && f.domainId !== filter.domainId) return false;
    if (filter?.certainty && f.certainty !== filter.certainty) return false;
    if (filter?.minConfidence !== undefined && f.confidence < filter.minConfidence) return false;
    if (filter?.nameContains && !f.name.toLowerCase().includes(filter.nameContains.toLowerCase())) return false;
    if (filter?.includesFile && !f.relatedFiles.includes(filter.includesFile)) return false;
    return true;
  });
}

export function selectDomains(
  model: ApplicationSemanticModel,
  filter?: DomainQueryFilter
): readonly SemanticDomain[] {
  return model.domains.filter(d => {
    if (filter?.certainty && d.certainty !== filter.certainty) return false;
    if (filter?.minConfidence !== undefined && d.confidence < filter.minConfidence) return false;
    if (filter?.nameContains && !d.name.toLowerCase().includes(filter.nameContains.toLowerCase())) return false;
    return true;
  });
}

export function selectWorkflows(
  model: ApplicationSemanticModel,
  filter?: WorkflowQueryFilter
): readonly SemanticWorkflow[] {
  return model.workflows.filter(w => {
    if (filter?.actor && !w.actors.includes(filter.actor)) return false;
    if (filter?.triggerContains && !w.trigger.toLowerCase().includes(filter.triggerContains.toLowerCase())) return false;
    if (filter?.minConfidence !== undefined && w.confidence < filter.minConfidence) return false;
    return true;
  });
}

export function selectJourneys(
  model: ApplicationSemanticModel,
  filter?: JourneyQueryFilter
): readonly SemanticUserJourney[] {
  return model.userJourneys.filter(j => {
    if (filter?.actor && j.actor !== filter.actor) return false;
    if (filter?.minConfidence !== undefined && j.confidence < filter.minConfidence) return false;
    return true;
  });
}

export function selectBusinessRules(
  model: ApplicationSemanticModel,
  filter?: BusinessRuleQueryFilter
): readonly SemanticBusinessRule[] {
  return model.businessRules.filter(r => {
    if (filter?.type && r.type !== filter.type) return false;
    if (filter?.filePath && r.location.filePath !== filter.filePath) return false;
    if (filter?.certainty && r.certainty !== filter.certainty) return false;
    return true;
  });
}

export function selectDataFlows(
  model: ApplicationSemanticModel,
  filter?: DataFlowQueryFilter
): readonly SemanticDataFlow[] {
  return model.dataFlows.filter(df => {
    if (filter?.hasRisk !== undefined) {
      const hasRisks = df.potentialRisks.length > 0;
      if (filter.hasRisk !== hasRisks) return false;
    }
    if (filter?.touchesFile) {
      const matches = df.steps.some(s => s.evidence.some(e => e.filePath === filter.touchesFile));
      if (!matches) return false;
    }
    return true;
  });
}

export function selectComponentsForFeature(
  model: ApplicationSemanticModel,
  featureId: string
): readonly SemanticComponent[] {
  return model.components.filter(c => c.featureId === featureId);
}

export function selectFilesForFeature(
  model: ApplicationSemanticModel,
  featureId: string
): readonly string[] {
  const feat = model.features.find(f => f.featureId === featureId);
  return feat ? feat.relatedFiles : [];
}

export function selectDependenciesForFeature(
  model: ApplicationSemanticModel,
  featureId: string
): readonly string[] {
  const feat = model.features.find(f => f.featureId === featureId);
  return feat ? feat.dependencies : [];
}

export function selectEntryPointsForFeature(
  model: ApplicationSemanticModel,
  featureId: string
): readonly SemanticEntryPoint[] {
  const feat = model.features.find(f => f.featureId === featureId);
  if (!feat) return [];
  return model.entryPoints.filter(ep => feat.entryPoints.includes(ep.path));
}

export function selectCapabilities(
  model: ApplicationSemanticModel
): ApplicationCapabilities {
  return model.capabilities;
}
