/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Agent Role Capabilities & Boundaries
 */

import type { AgentRole, AgentType, AgentCapabilities, ToolRisk } from '../types.js';

export function getCapabilitiesForRole(role: AgentType | AgentRole): AgentCapabilities {
  switch (role) {
    case 'ARCHITECT_AGENT':
    case 'ARCHITECTURE_AGENT':
      return {
        canReadFiles: true,
        canInspectAst: true,
        canInspectGraph: true,
        canAnalyzeImpact: true,
        canPlanMutations: true,
        canExecuteMutations: false,
        canRunTests: false,
        canRunBuild: false
      };

    case 'CODE_AGENT':
    case 'LOGIC_AGENT':
      return {
        canReadFiles: true,
        canInspectAst: true,
        canInspectGraph: true,
        canAnalyzeImpact: true,
        canPlanMutations: true,
        canExecuteMutations: true,
        canRunTests: true,
        canRunBuild: true
      };

    case 'UI_AGENT':
      return {
        canReadFiles: true,
        canInspectAst: true,
        canInspectGraph: true,
        canAnalyzeImpact: true,
        canPlanMutations: true,
        canExecuteMutations: true,
        canRunTests: true,
        canRunBuild: true
      };

    case 'BACKEND_AGENT':
      return {
        canReadFiles: true,
        canInspectAst: true,
        canInspectGraph: true,
        canAnalyzeImpact: true,
        canPlanMutations: true,
        canExecuteMutations: true,
        canRunTests: true,
        canRunBuild: true
      };

    case 'DATABASE_AGENT':
    case 'DATA_AGENT':
      return {
        canReadFiles: true,
        canInspectAst: true,
        canInspectGraph: true,
        canAnalyzeImpact: true,
        canPlanMutations: true,
        canExecuteMutations: true,
        canRunTests: true,
        canRunBuild: false
      };

    case 'SECURITY_AGENT':
      return {
        canReadFiles: true,
        canInspectAst: true,
        canInspectGraph: true,
        canAnalyzeImpact: true,
        canPlanMutations: false,
        canExecuteMutations: false,
        canRunTests: true,
        canRunBuild: false
      };

    case 'TEST_AGENT':
    case 'TESTING_AGENT':
      return {
        canReadFiles: true,
        canInspectAst: true,
        canInspectGraph: false,
        canAnalyzeImpact: false,
        canPlanMutations: true,
        canExecuteMutations: true,
        canRunTests: true,
        canRunBuild: true
      };

    case 'DEBUG_AGENT':
      return {
        canReadFiles: true,
        canInspectAst: true,
        canInspectGraph: true,
        canAnalyzeImpact: true,
        canPlanMutations: true,
        canExecuteMutations: false,
        canRunTests: true,
        canRunBuild: true
      };

    case 'REVIEW_AGENT':
    case 'DOCUMENTATION_AGENT':
      return {
        canReadFiles: true,
        canInspectAst: true,
        canInspectGraph: true,
        canAnalyzeImpact: true,
        canPlanMutations: false,
        canExecuteMutations: false,
        canRunTests: false,
        canRunBuild: false
      };

    case 'GENERALIST':
    default:
      return {
        canReadFiles: true,
        canInspectAst: true,
        canInspectGraph: true,
        canAnalyzeImpact: true,
        canPlanMutations: true,
        canExecuteMutations: true,
        canRunTests: true,
        canRunBuild: true
      };
  }
}

export function getAllowedOperationsForRole(role: AgentType | AgentRole): readonly string[] {
  switch (role) {
    case 'ARCHITECT_AGENT':
    case 'ARCHITECTURE_AGENT':
      return [
        'READ_PROJECT',
        'GET_APPLICATION_DNA',
        'GET_SEMANTIC_GRAPH',
        'ANALYZE_IMPACT',
        'ANALYZE_CODE',
        'read_file',
        'search_code',
        'inspect_graph',
        'analyze_impact',
        'build_context'
      ];

    case 'CODE_AGENT':
    case 'LOGIC_AGENT':
      return [
        'READ_FILE',
        'SEARCH_CODE',
        'ANALYZE_CODE',
        'BUILD_MUTATION_PLAN',
        'PREVIEW_MUTATION',
        'EXECUTE_MUTATION',
        'VALIDATE_RESULT',
        'read_file',
        'search_code',
        'inspect_symbol',
        'preview_mutation',
        'execute_mutation',
        'build_context'
      ];

    case 'UI_AGENT':
      return [
        'READ_FILE',
        'SEARCH_CODE',
        'ANALYZE_CODE',
        'BUILD_MUTATION_PLAN',
        'PREVIEW_MUTATION',
        'EXECUTE_MUTATION',
        'VALIDATE_RESULT',
        'read_file',
        'search_code',
        'preview_mutation',
        'execute_mutation',
        'build_context'
      ];

    case 'BACKEND_AGENT':
      return [
        'READ_FILE',
        'SEARCH_CODE',
        'ANALYZE_CODE',
        'BUILD_MUTATION_PLAN',
        'PREVIEW_MUTATION',
        'EXECUTE_MUTATION',
        'VALIDATE_RESULT',
        'read_file',
        'search_code',
        'inspect_route',
        'inspect_symbol',
        'preview_mutation',
        'execute_mutation',
        'build_context'
      ];

    case 'DATABASE_AGENT':
    case 'DATA_AGENT':
      return [
        'READ_FILE',
        'SEARCH_CODE',
        'ANALYZE_CODE',
        'BUILD_MUTATION_PLAN',
        'PREVIEW_MUTATION',
        'EXECUTE_MUTATION',
        'VALIDATE_RESULT',
        'read_file',
        'search_code',
        'preview_mutation',
        'execute_mutation',
        'build_context'
      ];

    case 'SECURITY_AGENT':
      return [
        'READ_PROJECT',
        'READ_FILE',
        'SEARCH_CODE',
        'ANALYZE_CODE',
        'GET_SEMANTIC_GRAPH',
        'ANALYZE_IMPACT',
        'read_file',
        'search_code',
        'inspect_graph',
        'analyze_impact',
        'build_context'
      ];

    case 'TEST_AGENT':
    case 'TESTING_AGENT':
      return [
        'READ_FILE',
        'SEARCH_CODE',
        'ANALYZE_CODE',
        'RUN_TESTS',
        'VALIDATE_RESULT',
        'read_file',
        'search_code',
        'run_tests',
        'run_typecheck',
        'build_context'
      ];

    case 'DEBUG_AGENT':
      return [
        'READ_FILE',
        'SEARCH_CODE',
        'ANALYZE_CODE',
        'ANALYZE_IMPACT',
        'VALIDATE_RESULT',
        'read_file',
        'search_code',
        'inspect_symbol',
        'analyze_impact',
        'build_context'
      ];

    case 'REVIEW_AGENT':
    case 'DOCUMENTATION_AGENT':
      return [
        'READ_FILE',
        'SEARCH_CODE',
        'ANALYZE_CODE',
        'ANALYZE_IMPACT',
        'VALIDATE_RESULT',
        'read_file',
        'search_code',
        'analyze_impact',
        'build_context'
      ];

    case 'GENERALIST':
    default:
      return [
        'READ_PROJECT',
        'READ_FILE',
        'SEARCH_CODE',
        'ANALYZE_CODE',
        'GET_APPLICATION_DNA',
        'GET_SEMANTIC_GRAPH',
        'ANALYZE_IMPACT',
        'BUILD_MUTATION_PLAN',
        'PREVIEW_MUTATION',
        'EXECUTE_MUTATION',
        'VALIDATE_RESULT',
        'RUN_TESTS',
        'read_file',
        'search_code',
        'inspect_symbol',
        'inspect_route',
        'inspect_graph',
        'analyze_impact',
        'build_context',
        'preview_mutation',
        'execute_mutation',
        'run_tests',
        'run_typecheck',
        'run_build'
      ];
  }
}

export function getRiskLevelForRole(role: AgentType | AgentRole): ToolRisk {
  switch (role) {
    case 'DATABASE_AGENT':
      return 'HIGH';
    case 'CODE_AGENT':
    case 'BACKEND_AGENT':
    case 'LOGIC_AGENT':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
}
