/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-002)
 * Architecture & Layer Detector
 */

import type { ProjectAnalysisSummary, FileAnalysis } from '../../understanding/types.js';
import type {
  ApplicationArchitecture,
  ArchitecturalLayer,
  ArchitecturalLayerKind,
  DetectedPattern,
  DNAEvidence,
  EntryPoint,
  PatternKind
} from '../types.js';
import { canonicalSort } from './base.js';
import { resolveImportTarget } from './graph-metrics.js';

export class ArchitectureDetector {
  public detect(summary: ProjectAnalysisSummary): ApplicationArchitecture {
    const fileAnalyses = summary.fileAnalyses;
    const allPaths = Object.keys(fileAnalyses).sort();

    // 1. Classify each file into an architectural layer
    const layerAssignments = new Map<string, ArchitecturalLayerKind>();
    let totalRoutes = 0;
    let totalComponents = 0;

    for (const [p, fa] of Object.entries(fileAnalyses)) {
      const lowerPath = p.toLowerCase();

      // Count routes & components
      const hasRoute = fa.symbols.some(s => s.route !== undefined);
      if (hasRoute) {
        totalRoutes += fa.symbols.filter(s => s.route !== undefined).length;
      }

      const componentSymbols = fa.symbols.filter(
        s => s.componentClassification === 'COMPONENT_CONFIRMED' || s.componentClassification === 'COMPONENT_INFERRED'
      );
      if (componentSymbols.length > 0) {
        totalComponents += componentSymbols.length;
      }

      // Classification hierarchy
      if (
        lowerPath.includes('.test.') ||
        lowerPath.includes('.spec.') ||
        lowerPath.includes('__tests__/') ||
        lowerPath.startsWith('test/') ||
        lowerPath.startsWith('tests/')
      ) {
        layerAssignments.set(p, 'tests');
      } else if (
        lowerPath.endsWith('package.json') ||
        lowerPath.endsWith('tsconfig.json') ||
        lowerPath.endsWith('.config.js') ||
        lowerPath.endsWith('.config.ts') ||
        lowerPath.endsWith('.config.mjs') ||
        lowerPath.endsWith('.config.cjs') ||
        lowerPath.includes('.env')
      ) {
        layerAssignments.set(p, 'config');
      } else if (
        lowerPath.startsWith('public/') ||
        lowerPath.startsWith('assets/') ||
        lowerPath.endsWith('.svg') ||
        lowerPath.endsWith('.png') ||
        lowerPath.endsWith('.jpg') ||
        lowerPath.endsWith('.ico')
      ) {
        layerAssignments.set(p, 'assets');
      } else if (
        componentSymbols.length > 0 ||
        lowerPath.endsWith('.tsx') ||
        lowerPath.endsWith('.jsx') ||
        lowerPath.endsWith('.vue') ||
        lowerPath.endsWith('.svelte') ||
        lowerPath.includes('/components/') ||
        lowerPath.startsWith('components/') ||
        lowerPath.includes('/pages/') ||
        lowerPath.startsWith('pages/') ||
        lowerPath.endsWith('.css') ||
        lowerPath.endsWith('.scss')
      ) {
        layerAssignments.set(p, 'frontend');
      } else if (
        lowerPath.endsWith('/server.ts') ||
        lowerPath.endsWith('/server.js') ||
        lowerPath === 'server.ts' ||
        lowerPath === 'server.js' ||
        lowerPath.startsWith('server/') ||
        lowerPath.startsWith('src/server')
      ) {
        layerAssignments.set(p, 'backend');
      } else if (
        hasRoute ||
        lowerPath.includes('/routes/') ||
        lowerPath.startsWith('routes/') ||
        lowerPath.includes('/api/') ||
        lowerPath.startsWith('api/') ||
        lowerPath.includes('/controllers/') ||
        lowerPath.startsWith('controllers/')
      ) {
        layerAssignments.set(p, 'api_routes');
      } else if (
        lowerPath.includes('/db/') ||
        lowerPath.startsWith('db/') ||
        lowerPath.includes('/models/') ||
        lowerPath.startsWith('models/') ||
        lowerPath.includes('/repositories/') ||
        lowerPath.startsWith('repositories/') ||
        lowerPath.includes('schema.prisma') ||
        lowerPath.includes('/entities/') ||
        fa.imports.some(i => ['@prisma/client', 'drizzle-orm', 'typeorm', 'mongoose'].includes(i.moduleSpecifier))
      ) {
        layerAssignments.set(p, 'data_access');
      } else if (
        fa.imports.some(i => ['fastify', 'express', '@nestjs/core', 'hono', 'koa'].includes(i.moduleSpecifier))
      ) {
        layerAssignments.set(p, 'backend');
      } else if (
        lowerPath.includes('/types/') ||
        lowerPath.startsWith('types/') ||
        lowerPath.includes('/domain/') ||
        lowerPath.startsWith('domain/') ||
        lowerPath.endsWith('.d.ts') ||
        (fa.symbols.length > 0 && fa.symbols.every(s => s.kind === 'interface' || s.kind === 'type_alias' || s.kind === 'enum'))
      ) {
        layerAssignments.set(p, 'domain_models');
      } else if (
        lowerPath.includes('/utils/') ||
        lowerPath.startsWith('utils/') ||
        lowerPath.includes('/helpers/') ||
        lowerPath.startsWith('helpers/') ||
        lowerPath.includes('/shared/') ||
        lowerPath.startsWith('shared/') ||
        lowerPath.includes('/lib/') ||
        lowerPath.startsWith('lib/')
      ) {
        layerAssignments.set(p, 'shared_utils');
      } else {
        layerAssignments.set(p, 'unknown');
      }
    }

    // 2. Build architectural layers and inter-layer dependencies
    const layerFiles = new Map<ArchitecturalLayerKind, string[]>();
    for (const [p, kind] of layerAssignments.entries()) {
      const list = layerFiles.get(kind) ?? [];
      list.push(p);
      layerFiles.set(kind, list);
    }

    const layers: ArchitecturalLayer[] = [];
    const definedKinds: ArchitecturalLayerKind[] = [
      'frontend',
      'backend',
      'api_routes',
      'data_access',
      'domain_models',
      'shared_utils',
      'config',
      'tests',
      'assets',
      'unknown'
    ];

    for (const kind of definedKinds) {
      const files = layerFiles.get(kind);
      if (files && files.length > 0) {
        const sortedFiles = [...files].sort();

        // Check inter-layer dependencies
        const layerDeps = new Set<string>();
        for (const file of sortedFiles) {
          const directDeps = summary.dependencyGraph[file] ?? [];
          for (const rawDep of directDeps) {
            const resolved = resolveImportTarget(file, rawDep, new Set(allPaths));
            if (resolved) {
              const depLayer = layerAssignments.get(resolved);
              if (depLayer && depLayer !== kind) {
                layerDeps.add(depLayer);
              }
            }
          }
        }

        layers.push({
          name: kind,
          kind,
          filePaths: sortedFiles,
          dependenciesOnLayers: Array.from(layerDeps).sort(),
          confidence: kind === 'unknown' ? 'UNKNOWN' : 'CONFIRMED'
        });
      }
    }

    // 3. Entry Points detection
    const entryPoints: EntryPoint[] = [];

    // Client entry points
    const clientCandidates = [
      'src/main.tsx',
      'src/index.tsx',
      'src/main.jsx',
      'src/index.jsx',
      'src/main.ts',
      'src/index.ts',
      'src/App.tsx',
      'src/App.jsx',
      'app/layout.tsx',
      'app/page.tsx',
      'index.html'
    ];

    for (const cand of clientCandidates) {
      const match = allPaths.find(p => p.toLowerCase() === cand.toLowerCase() || p.toLowerCase().endsWith('/' + cand.toLowerCase()));
      if (match) {
        const layer = layerAssignments.get(match);
        if (layer === 'frontend' || match.endsWith('.html')) {
          entryPoints.push({
            path: match,
            role: 'client_entry',
            confidence: 'CONFIRMED'
          });
        }
      }
    }

    // Server entry points
    const serverCandidates = [
      'src/server.ts',
      'src/server.js',
      'server.ts',
      'server.js',
      'src/main.ts',
      'src/index.ts',
      'apps/api/src/server.ts',
      'apps/api/src/server.js'
    ];

    for (const cand of serverCandidates) {
      const match = allPaths.find(p => p.toLowerCase() === cand.toLowerCase() || p.toLowerCase().endsWith('/' + cand.toLowerCase()));
      if (match) {
        const layer = layerAssignments.get(match);
        if (layer === 'backend' || layer === 'api_routes') {
          if (!entryPoints.some(ep => ep.path === match)) {
            entryPoints.push({
              path: match,
              role: 'server_entry',
              confidence: 'CONFIRMED'
            });
          }
        }
      }
    }

    // Config entry points
    for (const p of ['package.json', 'tsconfig.json']) {
      if (allPaths.includes(p)) {
        entryPoints.push({
          path: p,
          role: 'config_entry',
          confidence: 'CONFIRMED'
        });
      }
    }

    // 4. Primary Pattern Detection
    let primaryPattern: DetectedPattern;
    const hasFrontend = layerFiles.has('frontend') && (layerFiles.get('frontend')?.length ?? 0) > 0;
    const hasBackend = (layerFiles.has('backend') && (layerFiles.get('backend')?.length ?? 0) > 0) ||
                        (layerFiles.has('api_routes') && (layerFiles.get('api_routes')?.length ?? 0) > 0);
    const hasDataAccess = layerFiles.has('data_access') && (layerFiles.get('data_access')?.length ?? 0) > 0;
    const hasDomain = layerFiles.has('domain_models') && (layerFiles.get('domain_models')?.length ?? 0) > 0;

    const patternEvidence: DNAEvidence[] = [];

    if (allPaths.length === 0) {
      primaryPattern = {
        pattern: 'UNKNOWN',
        confidence: 'UNKNOWN',
        evidence: []
      };
    } else if (hasFrontend && hasBackend) {
      patternEvidence.push({
        kind: 'DIRECTORY_STRUCTURE',
        path: layerFiles.get('frontend')![0]!,
        detail: `Coexistence of frontend layer (${layerFiles.get('frontend')!.length} files) and backend layer`,
        confidence: 'CONFIRMED'
      });
      primaryPattern = {
        pattern: 'MONOLITH',
        confidence: 'CONFIRMED',
        evidence: patternEvidence
      };
    } else if (hasFrontend && !hasBackend) {
      patternEvidence.push({
        kind: 'DIRECTORY_STRUCTURE',
        path: layerFiles.get('frontend')![0]!,
        detail: `Frontend layer present (${layerFiles.get('frontend')!.length} files) without dedicated backend server`,
        confidence: 'CONFIRMED'
      });
      primaryPattern = {
        pattern: 'SPA',
        confidence: 'CONFIRMED',
        evidence: patternEvidence
      };
    } else if (hasBackend && !hasFrontend) {
      if (hasDataAccess && hasDomain) {
        patternEvidence.push({
          kind: 'DIRECTORY_STRUCTURE',
          path: layerFiles.get('backend')?.[0] ?? layerFiles.get('api_routes')![0]!,
          detail: 'Distinct separation between routes/backend, domain models, and data access layers',
          confidence: 'CONFIRMED'
        });
        primaryPattern = {
          pattern: 'LAYERED_ARCHITECTURE',
          confidence: 'CONFIRMED',
          evidence: patternEvidence
        };
      } else {
        patternEvidence.push({
          kind: 'AST_ROUTE',
          path: layerFiles.get('api_routes')?.[0] ?? layerFiles.get('backend')![0]!,
          detail: `Backend API server with ${totalRoutes} route endpoint(s) detected`,
          confidence: 'CONFIRMED'
        });
        primaryPattern = {
          pattern: 'REST_API',
          confidence: 'CONFIRMED',
          evidence: patternEvidence
        };
      }
    } else {
      primaryPattern = {
        pattern: 'UNKNOWN',
        confidence: 'UNKNOWN',
        evidence: []
      };
    }

    return {
      primaryPattern,
      entryPoints: canonicalSort(entryPoints, ep => `${ep.role}:${ep.path}`),
      layers: canonicalSort(layers, l => l.name),
      routesCount: totalRoutes,
      componentsCount: totalComponents
    };
  }
}
