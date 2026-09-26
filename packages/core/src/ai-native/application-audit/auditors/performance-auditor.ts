/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Performance Auditor - DOM Bloat & Execution Latency Validation
 */

import { randomUUID } from 'node:crypto';
import type { VisualSnapshot } from '../../visual-intelligence/types.js';
import type { ApplicationAuditFinding, AuditFileEntry } from '../types.js';

export class PerformanceAuditor {
  public audit(
    files: readonly AuditFileEntry[],
    snapshots?: readonly VisualSnapshot[],
    maxDomElements = 800
  ): readonly ApplicationAuditFinding[] {
    const findings: ApplicationAuditFinding[] = [];

    // 1. Inspect Visual Snapshots for DOM Complexity & Element Bloat
    if (snapshots && snapshots.length > 0) {
      for (const snap of snapshots) {
        if (snap.totalElementsCount > maxDomElements) {
          findings.push({
            id: `aaf-perf-dom-${randomUUID().slice(0, 8)}`,
            dimension: 'PERFORMANCE',
            severity: snap.totalElementsCount > maxDomElements * 1.5 ? 'HIGH' : 'MEDIUM',
            title: `Arborescence DOM excessive (${snap.totalElementsCount} éléments)`,
            description: `La page '${snap.pageRoute}' comporte ${snap.totalElementsCount} éléments DOM (recommandation maximale: ${maxDomElements}).`,
            location: { pageRoute: snap.pageRoute },
            cause: `Nombre excessif de conteneurs imbriqués ou de listes non virtualisées.`,
            impact: `Ralentissement du reflow/repaint, chute des FPS et consommation mémoire élevée sur mobile.`,
            recommendation: `Virtualiser les longues listes et aplatir la hiérarchie des nœuds HTML.`,
            autoRemediable: false,
            evidence: [
              {
                source: 'VISUAL_LAYOUT',
                detail: `Capture visuelle de la route ${snap.pageRoute} (${snap.viewport.kind}) mesurée à ${snap.totalElementsCount} éléments.`,
                metricName: 'totalDomElements',
                observedValue: snap.totalElementsCount,
                thresholdValue: maxDomElements
              }
            ]
          });
        }
      }
    }

    // 2. Inspect Code Files for Monolithic Scripts & Bloated Imports
    for (const file of files) {
      const lines = file.content.split('\n');

      // Check excessive imports (> 25 imports in a single file)
      const importCount = lines.filter((l: string) => /^\s*import\s+/.test(l)).length;
      if (importCount > 25) {
        findings.push({
          id: `aaf-perf-imports-${randomUUID().slice(0, 8)}`,
          dimension: 'PERFORMANCE',
          severity: 'MEDIUM',
          title: `Volume d'importations excessif (${importCount} modules)`,
          description: `Le fichier '${file.path}' déclare ${importCount} instructions d'importation distinctes.`,
          location: { filePath: file.path },
          cause: `Sur-couplage et manque d'agrégation modulaire (Barrel imports absents ou fichier fourre-tout).`,
          impact: `Augmentation du temps de build et risque d'alourdissement du bundle final (tree-shaking sous-optimal).`,
          recommendation: `Restructurer le module en le décomposant en services plus compacts.`,
          autoRemediable: false,
          evidence: [
            {
              source: 'AST_NODE',
              detail: `${importCount} importations déclarées dans ${file.path}.`,
              metricName: 'importCount',
              observedValue: importCount,
              thresholdValue: 25,
              filePath: file.path
            }
          ]
        });
      }

      // Check for giant inline scripts in HTML files (> 300 lines)
      if (file.path.endsWith('.html')) {
        const scriptMatch = file.content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
        if (scriptMatch) {
          for (const s of scriptMatch) {
            const scriptLines = s.split('\n').length;
            if (scriptLines > 300) {
              findings.push({
                id: `aaf-perf-inline-script-${randomUUID().slice(0, 8)}`,
                dimension: 'PERFORMANCE',
                severity: 'HIGH',
                title: `Script inline monolithique dans fichier HTML (${scriptLines} lignes)`,
                description: `Un bloc <script> inline de ${scriptLines} lignes est directement incorporé dans '${file.path}'.`,
                location: { filePath: file.path },
                cause: `Absence de compilation modulaire et mélange de présentation et logique applicative.`,
                impact: `Impossible de mettre en cache le code JS indépendamment du HTML, perte de performances au chargement.`,
                recommendation: `Extraire la logique JavaScript dans un fichier .js ou .ts dédié et le compiler.`,
                autoRemediable: true,
                suggestedAction: {
                  agentDomain: 'UI',
                  actionType: 'EXTRACT_EXTERNAL_SCRIPT',
                  targetPath: file.path,
                  description: `Extraire le script inline vers un fichier script.js externe.`
                },
                evidence: [
                  {
                    source: 'AST_NODE',
                    detail: `Bloc script inline de ${scriptLines} lignes détecté dans ${file.path}.`,
                    metricName: 'inlineScriptLength',
                    observedValue: scriptLines,
                    thresholdValue: 300,
                    filePath: file.path
                  }
                ]
              });
            }
          }
        }
      }
    }

    return findings;
  }
}
