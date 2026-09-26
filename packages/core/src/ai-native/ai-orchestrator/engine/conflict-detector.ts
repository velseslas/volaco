/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Inter-Agent Conflict Detection & Semantic Collision Engine
 */

import { compareConflicts, deepFreeze } from '../canonical.js';
import type { AgentArtifact, AgentConflict, ProposedFileChangePayload } from '../types.js';

export class ConflictDetector {
  public detectConflicts(artifacts: readonly AgentArtifact[]): readonly AgentConflict[] {
    const conflicts: AgentConflict[] = [];

    // 1. Detect file collision conflicts: multiple agents targeting the same file
    const fileToAgents = new Map<string, Array<{ agentId: string; artifact: AgentArtifact }>>();

    for (const artifact of artifacts) {
      for (const file of artifact.targetFiles) {
        if (!fileToAgents.has(file)) {
          fileToAgents.set(file, []);
        }
        fileToAgents.get(file)!.push({ agentId: artifact.agentId, artifact });
      }
    }

    for (const [filePath, entries] of fileToAgents.entries()) {
      const distinctAgents = Array.from(new Set(entries.map((e) => e.agentId)));
      if (distinctAgents.length > 1) {
        // Multiple agents competing on the same target file
        const operations = entries
          .map((e) => (e.artifact.payload as ProposedFileChangePayload)?.operation)
          .filter(Boolean);

        const hasDelete = operations.includes('DELETE');
        const severity: AgentConflict['severity'] = hasDelete ? 'BLOCKING' : 'HIGH';

        conflicts.push({
          conflictId: `conflict-file-${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
          involvedAgents: distinctAgents,
          affectedFiles: [filePath],
          description: `Collision détectée sur '${filePath}' entre les agents : ${distinctAgents.join(', ')}.`,
          severity,
          proposedResolution: hasDelete
            ? 'Suspension de la suppression. Arbitrage requis par le Control Plane humain.'
            : 'Fusion séquentielle ordonnée selon la hiérarchie Data -> Backend -> UI.',
          requiresHumanIntervention: severity === 'BLOCKING' || severity === 'HIGH'
        });
      }
    }

    // 2. Detect Security vetoes against other proposed changes
    const securityFindings = artifacts.filter((a) => a.kind === 'SECURITY_FINDING');
    for (const sec of securityFindings) {
      const payload = sec.payload as { vulnerabilitiesFound?: number; findingsSummary?: string };
      if (payload && typeof payload.vulnerabilitiesFound === 'number' && payload.vulnerabilitiesFound > 0) {
        conflicts.push({
          conflictId: `conflict-sec-${sec.id}`,
          involvedAgents: [sec.agentId],
          affectedFiles: sec.targetFiles,
          description: `Veto de sécurité : ${payload.findingsSummary || 'Vulnérabilité critique détectée.'}`,
          severity: 'BLOCKING',
          proposedResolution: 'Corriger impérativement les failles avant toute tentative de mutation.',
          requiresHumanIntervention: true
        });
      }
    }

    conflicts.sort(compareConflicts);
    return deepFreeze(conflicts);
  }
}
