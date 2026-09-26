/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-002)
 * Module Extractor (Module Boundaries, Public Exports, External Dependencies)
 */

import type { ProjectAnalysisSummary } from '../../understanding/types.js';
import type { ModuleBoundary } from '../types.js';
import { canonicalSort } from './base.js';

export class ModuleExtractor {
  public extract(summary: ProjectAnalysisSummary): ModuleBoundary[] {
    const fileAnalyses = summary.fileAnalyses;
    const allPaths = Object.keys(fileAnalyses).sort();

    // 1. Identify distinct module roots
    const moduleDirCandidates = new Set<string>();

    for (const filePath of allPaths) {
      const parts = filePath.split('/');
      if (parts.length >= 2) {
        // e.g. "packages/core", "src/components", "src/features/auth", "src/services"
        if (parts[0] === 'packages' && parts.length >= 3) {
          moduleDirCandidates.add(`${parts[0]}/${parts[1]}`);
        } else if (parts[0] === 'src' && parts.length >= 3) {
          // If sub-features exist like src/features/auth or src/modules/billing
          if (['features', 'modules'].includes(parts[1]!) && parts.length >= 4) {
            moduleDirCandidates.add(`${parts[0]}/${parts[1]}/${parts[2]}`);
          } else {
            moduleDirCandidates.add(`${parts[0]}/${parts[1]}`);
          }
        } else if (parts.length >= 2) {
          moduleDirCandidates.add(parts[0]!);
        }
      }
    }

    const modules: ModuleBoundary[] = [];

    for (const rootPath of Array.from(moduleDirCandidates).sort()) {
      const moduleFiles = allPaths.filter(p => p.startsWith(rootPath + '/'));
      if (moduleFiles.length === 0) {
        continue;
      }

      const fileSet = new Set(moduleFiles);
      const publicExportsSet = new Set<string>();
      const externalDependenciesSet = new Set<string>();

      // Gather exports and dependencies
      for (const filePath of moduleFiles) {
        const fa = fileAnalyses[filePath];
        if (!fa) continue;

        // Check exports (all exports in index.ts or exported symbols)
        const isIndex = filePath.endsWith('/index.ts') || filePath.endsWith('/index.js') || filePath === `${rootPath}/index.ts`;
        for (const exp of fa.exports) {
          if (isIndex) {
            publicExportsSet.add(exp.name);
          }
        }
        for (const sym of fa.symbols) {
          if (sym.isExported && isIndex) {
            publicExportsSet.add(sym.name);
          }
        }

        // Check external imports
        for (const imp of fa.imports) {
          if (!imp.isRelative) {
            externalDependenciesSet.add(imp.moduleSpecifier);
          }
        }

        // Check project-internal dependencies imported by this file
        const internalDeps = summary.dependencyGraph[filePath] ?? [];
        for (const dep of internalDeps) {
          if (!fileSet.has(dep)) {
            externalDependenciesSet.add(dep);
          }
        }
      }

      // Check external files importing symbols from this module
      for (const otherPath of allPaths) {
        if (fileSet.has(otherPath)) continue;
        const otherFa = fileAnalyses[otherPath];
        if (!otherFa) continue;

        for (const imp of otherFa.imports) {
          for (const modFile of moduleFiles) {
            const baseName = modFile.replace(/\.[^/.]+$/, '');
            if (imp.moduleSpecifier.endsWith(baseName) || imp.moduleSpecifier.endsWith(rootPath)) {
              for (const named of imp.namedImports) {
                publicExportsSet.add(named);
              }
              if (imp.defaultImport) {
                publicExportsSet.add(imp.defaultImport);
              }
            }
          }
        }
      }

      const parts = rootPath.split('/');
      const name = parts[parts.length - 1]!;

      modules.push({
        name,
        rootPath,
        files: [...moduleFiles].sort(),
        publicExports: Array.from(publicExportsSet).sort(),
        externalDependencies: Array.from(externalDependenciesSet).sort()
      });
    }

    return canonicalSort(modules, m => m.rootPath);
  }
}
