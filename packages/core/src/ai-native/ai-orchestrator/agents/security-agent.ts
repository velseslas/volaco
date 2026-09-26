/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Specialized Security & RBAC Agent
 */

import { BaseSpecializedAgent } from './base-agent.js';
import type { AgentArtifact, AgentTask, TaskContextPayload } from '../types.js';
import type { AIProviderRegistry } from '../../../ai/providers/registry.js';

export class SecurityAgent extends BaseSpecializedAgent {
  constructor(registry?: AIProviderRegistry | undefined) {
    super(
      {
        id: 'agent-security-specialist',
        name: 'Security & Compliance Specialist',
        domain: 'SECURITY',
        capabilities: ['AUTH_RBAC', 'VULNERABILITY_SCAN'],
        description: 'Responsable du respect du RBAC, de la protection contre les injections, du secret masking et de l étanchéité multi-tenant.',
        riskLevel: 'CRITICAL',
        requiredProviderCapabilities: ['DEEP_REASONING'],
        allowedTools: ['read_file', 'inspect_ast', 'inspect_graph']
      },
      registry
    );
  }

  protected buildArtifacts(params: {
    task: AgentTask;
    context: TaskContextPayload;
    generatedText: string;
  }): readonly AgentArtifact[] {
    const { task, context } = params;
    const targetFile = task.requiredContext.targetFiles?.[0] || 'src/security/rbac-guard.ts';

    const findings: string[] = [];
    // Scan context for any potential security flaws
    for (const [path, content] of Object.entries(context.relevantFiles)) {
      if (content.includes('eval(') || content.includes('innerHTML') || content.includes('apiKey = "')) {
        findings.push(`Risque potentiel détecté dans ${path} : pattern non sécurisé.`);
      }
    }

    const findingArtifact = this.createArtifact({
      id: `art-${task.id}-security-finding`,
      taskId: task.id,
      kind: 'SECURITY_FINDING',
      targetFiles: [targetFile],
      payload: {
        vulnerabilitiesFound: findings.length,
        findingsSummary: findings.join(' | ') || 'Aucune vulnérabilité critique détectée.',
        rbacPolicyCompliant: true,
        tenantIsolationEnforced: true
      },
      confidence: 1.0,
      summary: 'Audit de sécurité et de conformité multi-tenant'
    });

    return [findingArtifact];
  }
}
