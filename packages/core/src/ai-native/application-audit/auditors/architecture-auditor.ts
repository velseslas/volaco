/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Architecture Auditor - DNA Compliance & Layer Boundary Validation
 */

import { randomUUID } from 'node:crypto';
import type { ApplicationDNA } from '../../dna/types.js';
import type { ApplicationAuditFinding, AuditFileEntry } from '../types.js';

export class ArchitectureAuditor {
  public audit(
    files: readonly AuditFileEntry[],
    dna?: ApplicationDNA
  ): readonly ApplicationAuditFinding[] {
    const findings: ApplicationAuditFinding[] = [];

    // 1. DNA Compliance Checks (if DNA provided)
    if (dna) {
      this.checkDnaModuleCompliance(dna, files, findings);
    }

    // 2. Circular Dependency & Layer Inversion Checks
    this.checkLayerInversionAndCycles(files, findings);

    return findings;
  }

  private checkDnaModuleCompliance(
    dna: ApplicationDNA,
    files: readonly AuditFileEntry[],
    findings: ApplicationAuditFinding[]
  ): void {
    // Check if declared modules in DNA have corresponding files/directories
    for (const mod of dna.modules) {
      const modPrefix = mod.rootPath.toLowerCase();
      const hasImplementation = files.some(
        (f) => f.path.toLowerCase().includes(modPrefix) || f.path.toLowerCase().includes(mod.name.toLowerCase())
      );

      if (files.length > 5 && !hasImplementation) {
        findings.push({
          id: `aaf-arch-dna-mod-${randomUUID().slice(0, 8)}`,
          dimension: 'ARCHITECTURE',
          severity: 'MEDIUM',
          title: `Module DNA non implémenté : ${mod.name}`,
          description: `Le module '${mod.name}' (${mod.rootPath}) défini dans l'Application DNA n'a aucun fichier source correspondant.`,
          location: { filePath: `dna://${dna.projectId}/${dna.dnaHash.slice(0, 8)}` },
          cause: `Divergence entre le plan d'architecture Application DNA et l'arborescence réelle des fichiers.`,
          impact: `Incohérence du modèle mental de l'application et désalignement de l'orchestration IA.`,
          recommendation: `Créer les fichiers fondateurs du module '${mod.name}' (${mod.rootPath}) ou mettre à jour la spécification DNA.`,
          autoRemediable: true,
          suggestedAction: {
            agentDomain: 'BACKEND',
            actionType: 'CREATE_MODULE_STUB',
            targetPath: `${mod.rootPath}/index.ts`,
            description: `Initialiser le point d'entrée du module ${mod.name}.`
          },
          evidence: [
            {
              source: 'DNA_RULE',
              detail: `Module '${mod.name}' présent dans DNA (v${dna.schemaVersion}) mais absent des ${files.length} fichiers scannés.`,
              metricName: 'missingDnaModule',
              observedValue: mod.name
            }
          ]
        });
      }
    }
  }

  private checkLayerInversionAndCycles(
    files: readonly AuditFileEntry[],
    findings: ApplicationAuditFinding[]
  ): void {
    const importMap = new Map<string, string[]>();

    // Basic regex parser for imports to detect direct file references
    for (const f of files) {
      const imports: string[] = [];
      const lines = f.content.split('\n');
      for (const line of lines) {
        const match = line.match(/from\s+['"]([^'"]+)['"]/);
        if (match && match[1]) {
          imports.push(match[1]);
        }
      }
      importMap.set(f.path, imports);
    }

    // Detect direct 2-file circular imports: A imports B and B imports A
    const checkedPairs = new Set<string>();
    for (const [filePath, imports] of importMap.entries()) {
      for (const imp of imports) {
        for (const targetPath of importMap.keys()) {
          if (targetPath !== filePath && targetPath.includes(imp.replace(/^\.\.?\//, ''))) {
            const pairKey = [filePath, targetPath].sort().join('<->');
            if (checkedPairs.has(pairKey)) continue;
            checkedPairs.add(pairKey);

            const reverseImports = importMap.get(targetPath) ?? [];
            const isCircular = reverseImports.some((rev) =>
              filePath.includes(rev.replace(/^\.\.?\//, ''))
            );

            if (isCircular) {
              findings.push({
                id: `aaf-arch-cycle-${randomUUID().slice(0, 8)}`,
                dimension: 'ARCHITECTURE',
                severity: 'HIGH',
                title: `Dépendance circulaire détectée`,
                description: `Cycle d'importation direct entre '${filePath}' et '${targetPath}'.`,
                location: { filePath },
                cause: `Couplage bidirectionnel entre deux modules.`,
                impact: `Risque d'erreurs d'initialisation à l'exécution (TDZ/undefined imports) et rupture de l'ordre topologique.`,
                recommendation: `Extraire les types ou symboles partagés dans un module tiers indépendant.`,
                autoRemediable: false,
                evidence: [
                  {
                    source: 'SEMANTIC_GRAPH',
                    detail: `'${filePath}' importe '${targetPath}' et réciproquement.`,
                    filePath
                  }
                ]
              });
            }
          }
        }
      }

      // Check Layer Inversion: UI components importing raw db/repository directly
      const isUiFile = filePath.includes('/components/') || filePath.includes('/ui/') || filePath.includes('/views/');
      if (isUiFile) {
        const hasDbImport = (importMap.get(filePath) ?? []).some(
          (imp) => imp.includes('/db') || imp.includes('/database') || imp.includes('/repository') || imp.includes('/dao')
        );

        if (hasDbImport) {
          findings.push({
            id: `aaf-arch-layer-${randomUUID().slice(0, 8)}`,
            dimension: 'ARCHITECTURE',
            severity: 'HIGH',
            title: `Inversion de couche architecturale (UI -> DB)`,
            description: `Le composant UI '${filePath}' importe directement la couche de persistance ou base de données.`,
            location: { filePath },
            cause: `Violation de la séparation des couches (l'UI doit consommer un service applicatif ou une route API).`,
            impact: `Fuite de logique de persistance côté présentation et impossibilité de découpler le frontend.`,
            recommendation: `Remplacer l'accès direct par un appel à un service de domaine ou une API dédiée.`,
            autoRemediable: true,
            suggestedAction: {
              agentDomain: 'BACKEND',
              actionType: 'EXTRACT_SERVICE_LAYER',
              targetPath: filePath,
              description: `Extraire l'accès persistance vers un service dédié.`
            },
            evidence: [
              {
                source: 'AST_NODE',
                detail: `Import direct de la couche données détecté dans un composant UI.`,
                filePath
              }
            ]
          });
        }
      }
    }
  }
}
