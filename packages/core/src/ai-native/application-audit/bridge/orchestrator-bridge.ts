/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Orchestrator Bridge - Translation of Audit Findings into AINT-010 Engineering Tasks
 */

import { randomUUID } from 'node:crypto';
import type { AgentCapability, AgentDomain } from '../../ai-orchestrator/types.js';
import type { ApplicationAuditFinding, ApplicationAuditReport, ProposedRemediationTask } from '../types.js';

const DOMAIN_TO_AGENT: Record<AgentDomain, string> = {
  UI: 'agent-ui-specialist',
  BACKEND: 'agent-backend-specialist',
  DATA: 'agent-data-specialist',
  SECURITY: 'agent-security-specialist',
  TEST: 'agent-test-specialist',
  ARCHITECTURE: 'agent-architecture-specialist'
};

const DOMAIN_TO_CAPABILITY: Record<AgentDomain, AgentCapability> = {
  UI: 'COMPONENT_STYLING',
  BACKEND: 'SERVICE_LOGIC',
  DATA: 'SCHEMA_MODELING',
  SECURITY: 'VULNERABILITY_SCAN',
  TEST: 'UNIT_TEST_GEN',
  ARCHITECTURE: 'SERVICE_LOGIC'
};

export class ApplicationAuditOrchestratorBridge {
  public proposeRemediationTasks(report: ApplicationAuditReport): readonly ProposedRemediationTask[] {
    const tasks: ProposedRemediationTask[] = [];

    // Filter only auto-remediable findings that have suggestedAction
    const candidates = report.findings.filter(
      (f: ApplicationAuditFinding) => f.autoRemediable && f.suggestedAction
    );

    for (const f of candidates) {
      const action = f.suggestedAction!;
      const assignedAgentId = DOMAIN_TO_AGENT[action.agentDomain] || 'agent-generalist';
      const capability = DOMAIN_TO_CAPABILITY[action.agentDomain] || 'SERVICE_LOGIC';
      const targetFile = action.targetPath ?? f.location.filePath;

      tasks.push({
        id: `task-audit-rem-${randomUUID().slice(0, 8)}`,
        title: `Remédiation Audit [${f.dimension}] : ${f.title}`,
        description: action.description || f.recommendation,
        domain: action.agentDomain,
        priority: f.severity === 'CRITICAL' ? 1 : f.severity === 'HIGH' ? 2 : f.severity === 'MEDIUM' ? 3 : 4,
        dependencies: [],
        requiredContext: targetFile ? { targetFiles: [targetFile] } : {},
        requiredCapabilities: [capability],
        status: 'READY',
        assignedAgentId,
        operation: 'MODIFY',
        retryCount: 0,
        maxRetries: 3,
        findingId: f.id,
        targetDimension: f.dimension
      });
    }

    return tasks;
  }
}
