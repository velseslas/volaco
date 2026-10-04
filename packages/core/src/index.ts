export * from './types/index.js';
export * from './config.js';
export * from './errors.js';
export * from './logger.js';
export * from './identity/permissions.js';
export * from './identity/tenant.js';
export * from './identity/project.js';
export * from './model/revision.js';
export * from './model/revision-store.js';
export * from './security/secrets.js';
export * from './observability/metrics.js';
export * from './observability/audit.js';
export * from './observability/agent-trace-store.js';
export * from './ai/index.js';
export * from './workspace/index.js';
export * from './dashboard/index.js';
export * from './file-explorer/index.js';
export * from './editor/index.js';
export * from './terminal/index.js';
export * from './settings/index.js';
export * from './versioning/index.js';
export * from './project-state/index.js';
export * from './studio/index.js';
export * from './activity/index.js';


export function createBootstrapReport(projectName: string, foundation: string = 'FND-001') {
  return {
    project: projectName,
    version: '0.1.0',
    architecture: 'MODULAR_MONOLITH',
    foundation,
    status: 'ACTIVE',
    timestamp: new Date().toISOString()
  };
}
export * from './ai-native/understanding/index.js';
export * from './ai-native/dna/index.js';
export * from './ai-native/context/index.js';
export * from './ai-native/semantic-graph/index.js';
export * from './ai-native/impact-intelligence/index.js';
export * from './ai-native/mutation-orchestrator/index.js';
export * from './ai-native/agent-runtime/index.js';
export * from './ai-native/application-understanding/index.js';
export * from './ai-native/conversation-intelligence/index.js';
export * from './ai-native/ai-orchestrator/index.js';
export * from './ai-native/visual-intelligence/index.js';
export * from './ai-native/design-harmony/index.js';
export * from './ai-native/application-audit/index.js';
export * from './ai-native/feature-intelligence/index.js';
export * from './ai-native/user-feedback/index.js';
export * from './ai-native/strategy/index.js';