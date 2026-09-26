/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-004)
 * Deterministic Semantic Edge Construction & Import Resolution
 */

import type { ProjectAnalysisSummary } from '../../understanding/types.js';
import type { ApplicationDNA } from '../../dna/types.js';
import type {
  SemanticEdge,
  SemanticEdgeKind,
  SemanticEvidence,
  SemanticNode
} from '../types.js';
import { compareEdges } from './canonical.js';
import {
  createAstExportEvidence,
  createAstImportEvidence,
  createAstSymbolEvidence,
  createDnaDependencyEvidence,
  createEntryPointEvidence,
  createEvidence,
  createLayerMembershipEvidence,
  createModuleMembershipEvidence,
  createRouteDeclarationEvidence,
  createSymbolReferenceEvidence,
  mergeEvidence
} from './evidence.js';

/**
 * Resolves a relative import specifier to an existing project file path deterministically.
 */
export function resolveImportSpecifier(
  sourceFilePath: string,
  specifier: string,
  allFiles: ReadonlySet<string>
): string | undefined {
  if (!specifier.startsWith('.')) {
    // Non-relative import (e.g. 'react', 'fastify') -> not a project file
    return undefined;
  }

  const parts = sourceFilePath.split('/');
  parts.pop(); // Remove filename to get containing directory

  const specParts = specifier.split('/');
  for (const part of specParts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  const baseResolved = parts.join('/');

  // Generate deterministic resolution candidates in order
  const candidates: string[] = [];

  // 1. Exact match
  candidates.push(baseResolved);

  // 2. If ends in .js / .jsx / .mjs / .cjs, try corresponding TS extensions
  if (baseResolved.endsWith('.js')) {
    const withoutExt = baseResolved.slice(0, -3);
    candidates.push(`${withoutExt}.ts`);
    candidates.push(`${withoutExt}.tsx`);
  } else if (baseResolved.endsWith('.jsx')) {
    const withoutExt = baseResolved.slice(0, -4);
    candidates.push(`${withoutExt}.tsx`);
    candidates.push(`${withoutExt}.ts`);
  }

  // 3. If no recognized extension, test extensions
  if (!baseResolved.includes('.', baseResolved.lastIndexOf('/'))) {
    candidates.push(`${baseResolved}.ts`);
    candidates.push(`${baseResolved}.tsx`);
    candidates.push(`${baseResolved}.js`);
    candidates.push(`${baseResolved}.jsx`);
    candidates.push(`${baseResolved}/index.ts`);
    candidates.push(`${baseResolved}/index.tsx`);
    candidates.push(`${baseResolved}/index.js`);
  }

  for (const cand of candidates) {
    if (allFiles.has(cand)) {
      return cand;
    }
  }

  return undefined;
}

export function buildSemanticEdges(
  summary: ProjectAnalysisSummary,
  dna: ApplicationDNA,
  nodeMap: ReadonlyMap<string, SemanticNode>
): readonly SemanticEdge[] {
  const edgeMap = new Map<string, SemanticEdge>();
  const allProjectFiles = new Set(Object.keys(summary.fileAnalyses));

  function addEdge(
    kind: SemanticEdgeKind,
    sourceId: string,
    targetId: string,
    evidenceItem: SemanticEvidence,
    metadata?: Record<string, unknown>
  ): void {
    // Invariant: Both source and target MUST exist in the graph
    if (!nodeMap.has(sourceId) || !nodeMap.has(targetId)) {
      return;
    }

    const edgeId = `edge:${sourceId}->${kind}->${targetId}`;
    const existing = edgeMap.get(edgeId);

    if (existing) {
      edgeMap.set(edgeId, {
        id: edgeId,
        kind,
        sourceId,
        targetId,
        evidence: mergeEvidence(existing.evidence, [evidenceItem]),
        metadata: { ...existing.metadata, ...metadata }
      });
    } else {
      edgeMap.set(edgeId, {
        id: edgeId,
        kind,
        sourceId,
        targetId,
        evidence: [evidenceItem],
        metadata: metadata ?? {}
      });
    }
  }

  // Pre-index symbol nodes by filePath and name for fast resolution
  // Key: `${filePath}:${symbolName}` -> SemanticNode
  const symbolsByFileAndName = new Map<string, SemanticNode>();
  for (const node of nodeMap.values()) {
    if (node.filePath && (node.kind === 'SYMBOL' || node.kind === 'FUNCTION' || node.kind === 'CLASS' || node.kind === 'INTERFACE' || node.kind === 'TYPE' || node.kind === 'COMPONENT')) {
      symbolsByFileAndName.set(`${node.filePath}:${node.name}`, node);
    }
  }

  // 1. FILE CONTAINS and EXPORTS edges
  for (const [filePath, fa] of Object.entries(summary.fileAnalyses)) {
    const fileNodeId = `node:file:${filePath}`;
    if (!nodeMap.has(fileNodeId)) continue;

    for (const sym of fa.symbols) {
      let symNodeId = `node:sym:${filePath}:${sym.name}:${sym.lineStart}`;
      if (sym.kind === 'component' || sym.componentClassification === 'COMPONENT_CONFIRMED' || sym.componentClassification === 'COMPONENT_INFERRED') {
        symNodeId = `node:comp:${filePath}:${sym.name}`;
      } else if (sym.kind === 'route' && sym.route) {
        symNodeId = `node:route:${sym.route.method}:${sym.route.path}`;
      }

      if (!nodeMap.has(symNodeId)) continue;

      // FILE --CONTAINS--> SYMBOL
      addEdge(
        'CONTAINS',
        fileNodeId,
        symNodeId,
        createAstSymbolEvidence(filePath, sym.lineStart, sym.lineEnd, sym.name, sym.kind),
        { lineStart: sym.lineStart, lineEnd: sym.lineEnd }
      );

      // FILE --EXPORTS--> SYMBOL & SYMBOL --EXPORTED_BY--> FILE
      if (sym.isExported) {
        const exportEv = createAstExportEvidence(filePath, sym.lineStart, sym.name, false);
        addEdge('EXPORTS', fileNodeId, symNodeId, exportEv);
        addEdge('EXPORTED_BY', symNodeId, fileNodeId, exportEv);
      }
    }

    // 2. IMPORTS and IMPORTED_BY edges (File-to-File)
    for (const imp of fa.imports) {
      const resolvedTarget = resolveImportSpecifier(filePath, imp.moduleSpecifier, allProjectFiles);
      if (resolvedTarget) {
        const targetNodeId = `node:file:${resolvedTarget}`;
        if (nodeMap.has(targetNodeId)) {
          const importEv = createAstImportEvidence(filePath, imp.line, imp.moduleSpecifier, imp.isTypeOnly);
          addEdge('IMPORTS', fileNodeId, targetNodeId, importEv, { isTypeOnly: imp.isTypeOnly });
          addEdge('IMPORTED_BY', targetNodeId, fileNodeId, importEv, { isTypeOnly: imp.isTypeOnly });

          // 3. REFERENCES edges (File or Symbol to Target Symbol)
          for (const named of imp.namedImports) {
            const targetSymNode = symbolsByFileAndName.get(`${resolvedTarget}:${named}`);
            if (targetSymNode) {
              const refEv = createSymbolReferenceEvidence(filePath, imp.line, named, resolvedTarget);
              addEdge('REFERENCES', fileNodeId, targetSymNode.id, refEv, { symbolName: named });

              // If a component in this file imports a component from target, create COMPOSES edge
              for (const sym of fa.symbols) {
                if (sym.kind === 'component' || sym.componentClassification === 'COMPONENT_CONFIRMED' || sym.componentClassification === 'COMPONENT_INFERRED') {
                  const compNodeId = `node:comp:${filePath}:${sym.name}`;
                  if (nodeMap.has(compNodeId) && targetSymNode.kind === 'COMPONENT') {
                    addEdge(
                      'COMPOSES',
                      compNodeId,
                      targetSymNode.id,
                      createEvidence('COMPONENT_PROPS', `AST composition in ${filePath}:${imp.line}`, `${sym.name} composes ${targetSymNode.name}`, filePath, imp.line, imp.line),
                      { composedComponent: targetSymNode.name }
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // 4. MODULE MEMBERSHIP & CONTAINS
  for (const mod of dna.modules) {
    const modNodeId = `node:mod:${mod.name}`;
    if (!nodeMap.has(modNodeId)) continue;

    for (const filePath of mod.files) {
      const fileNodeId = `node:file:${filePath}`;
      if (nodeMap.has(fileNodeId)) {
        const memEv = createModuleMembershipEvidence(mod.name, filePath);
        addEdge('MEMBER_OF_MODULE', fileNodeId, modNodeId, memEv);
        addEdge('CONTAINS', modNodeId, fileNodeId, memEv);
      }
    }
  }

  // 5. LAYER MEMBERSHIP
  for (const layer of dna.architecture.layers) {
    const layerNodeId = `node:layer:${layer.kind}`;
    if (!nodeMap.has(layerNodeId)) continue;

    for (const filePath of layer.filePaths) {
      const fileNodeId = `node:file:${filePath}`;
      if (nodeMap.has(fileNodeId)) {
        const layerEv = createLayerMembershipEvidence(layer.kind, filePath);
        addEdge('MEMBER_OF_LAYER', fileNodeId, layerNodeId, layerEv);
      }
    }
  }

  // 6. ENTRY_POINT_FOR
  for (const ep of dna.architecture.entryPoints) {
    const entryNodeId = `node:entry:${ep.role}:${ep.path}`;
    const targetFileId = `node:file:${ep.path}`;

    if (nodeMap.has(entryNodeId) && nodeMap.has(targetFileId)) {
      addEdge(
        'ENTRY_POINT_FOR',
        entryNodeId,
        targetFileId,
        createEntryPointEvidence(ep.role, ep.path),
        { role: ep.role }
      );
    }
  }

  // 7. DEPENDS_ON and USED_BY (from DNA graph metrics)
  for (const [srcFile, deps] of Object.entries(dna.graphMetrics.directDependencies)) {
    const srcNodeId = `node:file:${srcFile}`;
    if (!nodeMap.has(srcNodeId)) continue;

    for (const depFile of deps) {
      const depNodeId = `node:file:${depFile}`;
      if (!nodeMap.has(depNodeId)) continue;

      const dnaDepEv = createDnaDependencyEvidence(srcFile, depFile);
      addEdge('DEPENDS_ON', srcNodeId, depNodeId, dnaDepEv);
      addEdge('USED_BY', depNodeId, srcNodeId, dnaDepEv);
    }
  }

  // 8. ROUTES_TO
  for (const [filePath, fa] of Object.entries(summary.fileAnalyses)) {
    const fileNodeId = `node:file:${filePath}`;
    for (const sym of fa.symbols) {
      if (sym.route) {
        const routeNodeId = `node:route:${sym.route.method}:${sym.route.path}`;
        if (!nodeMap.has(routeNodeId)) continue;

        // Try to find a handler function in this file close to route declaration
        const handlerSym = fa.symbols.find(
          s => s !== sym && (s.kind === 'function' || s.kind === 'arrow_function') && Math.abs(s.lineStart - (sym.route?.line ?? 0)) <= 2
        );

        let targetId = fileNodeId;
        if (handlerSym) {
          const handlerNodeId = `node:sym:${filePath}:${handlerSym.name}:${handlerSym.lineStart}`;
          if (nodeMap.has(handlerNodeId)) {
            targetId = handlerNodeId;
          }
        }

        if (nodeMap.has(targetId)) {
          addEdge(
            'ROUTES_TO',
            routeNodeId,
            targetId,
            createRouteDeclarationEvidence(filePath, sym.route.line, sym.route.method, sym.route.path),
            { method: sym.route.method, path: sym.route.path }
          );
        }
      }
    }
  }

  // Canonical deterministic sort of all edges
  return Array.from(edgeMap.values()).sort(compareEdges);
}
