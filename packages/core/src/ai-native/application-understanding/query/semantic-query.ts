/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Semantic Query Engine
 */

import type {
  ApplicationSemanticModel,
  BusinessRuleQueryFilter,
  DataFlowQueryFilter,
  DomainQueryFilter,
  FeatureQueryFilter,
  JourneyQueryFilter,
  SemanticQueryRequest,
  SemanticQueryResult,
  WorkflowQueryFilter
} from '../types.js';
import {
  selectBusinessRules,
  selectCapabilities,
  selectDataFlows,
  selectDomains,
  selectFeatures,
  selectJourneys,
  selectWorkflows
} from './selectors.js';

export function executeSemanticQuery(
  model: ApplicationSemanticModel,
  request: SemanticQueryRequest
): SemanticQueryResult {
  const { kind, filter, limit = 50, offset = 0 } = request.query;

  let allItems: readonly unknown[] = [];

  switch (kind) {
    case 'FEATURES':
      allItems = selectFeatures(model, filter as FeatureQueryFilter | undefined);
      break;
    case 'DOMAINS':
      allItems = selectDomains(model, filter as DomainQueryFilter | undefined);
      break;
    case 'WORKFLOWS':
      allItems = selectWorkflows(model, filter as WorkflowQueryFilter | undefined);
      break;
    case 'JOURNEYS':
      allItems = selectJourneys(model, filter as JourneyQueryFilter | undefined);
      break;
    case 'RULES':
      allItems = selectBusinessRules(model, filter as BusinessRuleQueryFilter | undefined);
      break;
    case 'DATA_FLOWS':
      allItems = selectDataFlows(model, filter as DataFlowQueryFilter | undefined);
      break;
    case 'CAPABILITIES':
      allItems = [selectCapabilities(model)];
      break;
    default:
      allItems = [];
  }

  const total = allItems.length;
  const paginated = allItems.slice(offset, offset + limit);

  return {
    total,
    offset,
    limit,
    items: paginated
  };
}
