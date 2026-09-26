/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * AI Orchestrator Bridge (AINT-010 Integration)
 */

import { randomUUID } from 'node:crypto';
import type { AgentTask } from '../../ai-orchestrator/types.js';
import type { DesignHarmonyReport } from '../types.js';

export class DesignHarmonyOrchestratorBridge {
  public proposeEngineeringTasks(report: DesignHarmonyReport): readonly AgentTask[] {
    const tasks: AgentTask[] = [];

    // Filter findings of HIGH or CRITICAL severity
    const significantFindings = report.findings.filter(
      (f) => f.severity === 'HIGH' || f.severity === 'CRITICAL' || f.designDrift
    );

    if (significantFindings.length === 0) {
      return tasks;
    }

    // Group findings by page route
    const byRoute = new Map<string, typeof significantFindings>();
    for (const f of significantFindings) {
      const arr = byRoute.get(f.pageRoute) ?? [];
      arr.push(f);
      byRoute.set(f.pageRoute, arr);
    }

    let index = 1;
    for (const [route, findings] of byRoute.entries()) {
      const targetFile = route === '/' ? 'src/pages/index.tsx' : `src/pages${route}.tsx`;
      const taskId = `task-dh-remediate-${randomUUID().slice(0, 8)}`;

      const descriptions = findings.map((f) => `- [${f.category}] ${f.recommendation}`).join('\n');

      tasks.push({
        id: taskId,
        title: `Harmonisation Design : ${route} (${findings.length} correctif(s))`,
        description: `Appliquer les alignements de Design Harmony pour ${route} :\n${descriptions}`,
        domain: 'UI',
        priority: index++,
        dependencies: [],
        requiredContext: {
          targetFiles: [targetFile]
        },
        requiredCapabilities: ['COMPONENT_STYLING', 'RESPONSIVE_LAYOUT'],
        status: 'READY',
        assignedAgentId: 'agent-ui-specialist',
        operation: 'MODIFY',
        retryCount: 0,
        maxRetries: 3
      });
    }

    return tasks;
  }
}
