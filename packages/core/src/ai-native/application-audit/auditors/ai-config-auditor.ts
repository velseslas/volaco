/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * AI Config Auditor - Prompt Injection & Passive Data Safeguard Validation
 */

import { randomUUID } from 'node:crypto';
import type { ApplicationAuditFinding, AuditFileEntry } from '../types.js';

export class AIConfigAuditor {
  public audit(files: readonly AuditFileEntry[]): readonly ApplicationAuditFinding[] {
    const findings: ApplicationAuditFinding[] = [];

    for (const file of files) {
      if (!file.path.includes('prompt') && !file.path.includes('agent') && !file.path.includes('ai') && !file.path.includes('chat')) {
        continue;
      }

      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;

        const hasDirectInterpolation =
          /\$\{[^}]*(?:input|user|query)[^}]*\}/i.test(line) ||
          /\+\s*(?:userInput|input|query|userMessage)\b/i.test(line);

        if (hasDirectInterpolation) {
          if (!line.includes('<USER_INPUT>') && !line.includes('PASSIVE_DATA') && !line.includes('sanitize')) {
            findings.push({
              id: `aaf-ai-inject-${randomUUID().slice(0, 8)}`,
              dimension: 'AI_CONFIG',
              severity: 'HIGH',
              title: `Risque d'injection de prompt (absence de balises d'encapsulation)`,
              description: `Conception de prompt intégrant directement une saisie utilisateur non encapsulée par des balises hermétiques.`,
              location: { filePath: file.path, line: i + 1 },
              cause: `Interpolation directe de texte utilisateur dans le prompt système ou utilisateur.`,
              impact: `Possibilité pour un attaquant d'outrepasser les consignes système et de détourner l'exécution de l'agent.`,
              recommendation: `Encapsuler systématiquement la saisie utilisateur avec des balises délimitées (ex: <USER_INPUT>) et l'étiqueter comme passive-data.`,
              autoRemediable: true,
              suggestedAction: {
                agentDomain: 'SECURITY',
                actionType: 'WRAP_PROMPT_BOUNDARIES',
                targetPath: file.path,
                description: `Encapsuler la variable d'entrée avec des balises de délimitation strictes.`
              },
              evidence: [
                {
                  source: 'SECURITY_SCANNER',
                  detail: `Interpolation directe détectée à la ligne ${i + 1}.`,
                  filePath: file.path
                }
              ]
            });
          }
        }
      }
    }

    return findings;
  }
}
