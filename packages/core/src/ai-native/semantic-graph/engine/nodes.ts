/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-004)
 * Deterministic Semantic Node Construction
 */

import type { ProjectAnalysisSummary } from '../../understanding/types.js';
import type { ApplicationDNA } from '../../dna/types.js';
import { isDefaultExcludedPath, isSecretPath } from '../../context/index.js';
import type {
  SemanticEvidence,
  SemanticGraphRequest,
  SemanticNode,
  SemanticNodeKind
} from '../types.js';
import { compareNodes } from './canonical.js';
import {
  createAstExportEvidence,
  createComponentHookEvidence,
  createComponentPropsEvidence,
  createEntryPointEvidence,
  createLayerMembershipEvidence,
  createModuleMembershipEvidence,
  createRouteDeclarationEvidence,
  createAstSymbolEvidence
} from './evidence.js';

export function isGraphSecretPath(filePath: string): boolean {
  if (isSecretPath(filePath)) return true;
  const lower = filePath.toLowerCase();
  const name = lower.split('/').pop() || lower;
  if (name.startsWith('id_rsa')) return true;
  if (name.includes('password')) return true;
  if (name.endsWith('.cert') || name.endsWith('.crt')) return true;
  return false;
}

export function isTestFilePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('__tests__/') ||
    lower.startsWith('tests/') ||
    lower.startsWith('test/')
  );
}

export function buildSemanticNodes(
  summary: ProjectAnalysisSummary,
  dna: ApplicationDNA,
  request: SemanticGraphRequest
): { readonly nodes: readonly SemanticNode[]; readonly nodeMap: ReadonlyMap<string, SemanticNode> } {
  const nodeMap = new Map<string, SemanticNode>();

  const targetFileSet = request.targetFiles && request.targetFiles.length > 0
    ? new Set(request.targetFiles)
    : undefined;

  const targetLayerSet = request.targetLayers && request.targetLayers.length > 0
    ? new Set(request.targetLayers.map(l => l.toLowerCase()))
    : undefined;

  // 1. Construct FILE nodes
  const sortedFilePaths = Object.keys(summary.fileAnalyses).sort();

  for (const filePath of sortedFilePaths) {
    if (isGraphSecretPath(filePath)) {
      continue;
    }
    if (isDefaultExcludedPath(filePath)) {
      continue;
    }
    if (!request.includeTests && isTestFilePath(filePath)) {
      continue;
    }
    if (targetFileSet && !targetFileSet.has(filePath)) {
      continue;
    }

    const fa = summary.fileAnalyses[filePath];
    if (!fa) continue;

    const fileNodeId = `node:file:${filePath}`;
    const fileName = filePath.split('/').pop() ?? filePath;

    const fileEvidence: SemanticEvidence[] = [
      createAstSymbolEvidence(filePath, 1, fa.lineCount, fileName, 'file')
    ];

    const fileNode: SemanticNode = {
      id: fileNodeId,
      kind: 'FILE',
      name: fileName,
      filePath,
      lineStart: 1,
      lineEnd: fa.lineCount,
      metadata: {
        language: fa.language,
        parser: fa.parser,
        analysisStatus: fa.analysisStatus,
        fileHash: fa.fileHash,
        semanticHash: fa.semanticHash,
        lineCount: fa.lineCount,
        sizeBytes: fa.sizeBytes
      },
      evidence: fileEvidence
    };

    nodeMap.set(fileNodeId, fileNode);

    // 2. Construct SYMBOL / FUNCTION / CLASS / INTERFACE / TYPE / COMPONENT nodes
    for (const sym of fa.symbols) {
      let nodeKind: SemanticNodeKind = 'SYMBOL';
      if (sym.kind === 'function' || sym.kind === 'arrow_function' || sym.kind === 'method') {
        nodeKind = 'FUNCTION';
      } else if (sym.kind === 'class') {
        nodeKind = 'CLASS';
      } else if (sym.kind === 'interface') {
        nodeKind = 'INTERFACE';
      } else if (sym.kind === 'type_alias') {
        nodeKind = 'TYPE';
      } else if (
        sym.kind === 'component' ||
        sym.componentClassification === 'COMPONENT_CONFIRMED' ||
        sym.componentClassification === 'COMPONENT_INFERRED'
      ) {
        nodeKind = 'COMPONENT';
      } else if (sym.kind === 'route' || sym.route) {
        nodeKind = 'ROUTE';
      }

      let symNodeId = `node:sym:${filePath}:${sym.name}:${sym.lineStart}`;
      if (nodeKind === 'COMPONENT') {
        symNodeId = `node:comp:${filePath}:${sym.name}`;
      } else if (nodeKind === 'ROUTE' && sym.route) {
        symNodeId = `node:route:${sym.route.method}:${sym.route.path}`;
      }

      if (nodeMap.has(symNodeId)) {
        continue;
      }

      const symEvidences: SemanticEvidence[] = [
        createAstSymbolEvidence(filePath, sym.lineStart, sym.lineEnd, sym.name, sym.kind)
      ];

      if (sym.isExported) {
        symEvidences.push(createAstExportEvidence(filePath, sym.lineStart, sym.name, false));
      }

      if (nodeKind === 'COMPONENT') {
        if (sym.props && sym.props.length > 0) {
          symEvidences.push(createComponentPropsEvidence(filePath, sym.lineStart, sym.props.length));
        }
        if (sym.hooksUsed && sym.hooksUsed.length > 0) {
          symEvidences.push(createComponentHookEvidence(filePath, sym.lineStart, sym.hooksUsed));
        }
      }

      if (nodeKind === 'ROUTE' && sym.route) {
        symEvidences.push(createRouteDeclarationEvidence(filePath, sym.route.line, sym.route.method, sym.route.path));
      }

      const symNode: SemanticNode = {
        id: symNodeId,
        kind: nodeKind,
        name: sym.name,
        filePath,
        lineStart: sym.lineStart,
        lineEnd: sym.lineEnd,
        metadata: {
          originalKind: sym.kind,
          isExported: sym.isExported,
          isDefaultExport: sym.isDefaultExport,
          signature: sym.signature ?? null,
          docstring: sym.docstring ?? null,
          propsCount: sym.props?.length ?? 0,
          hooksUsed: sym.hooksUsed ?? [],
          route: sym.route ?? null
        },
        evidence: symEvidences
      };

      nodeMap.set(symNodeId, symNode);
    }
  }

  // 3. Construct MODULE nodes from DNA
  for (const mod of dna.modules) {
    const modNodeId = `node:mod:${mod.name}`;
    if (nodeMap.has(modNodeId)) continue;

    const modEvidences: SemanticEvidence[] = mod.files.map(f =>
      createModuleMembershipEvidence(mod.name, f)
    );

    const modNode: SemanticNode = {
      id: modNodeId,
      kind: 'MODULE',
      name: mod.name,
      metadata: {
        rootPath: mod.rootPath,
        filesCount: mod.files.length,
        publicExports: mod.publicExports,
        externalDependencies: mod.externalDependencies
      },
      evidence: modEvidences.length > 0 ? modEvidences : [createModuleMembershipEvidence(mod.name, mod.rootPath)]
    };

    nodeMap.set(modNodeId, modNode);
  }

  // 4. Construct LAYER nodes from DNA
  for (const layer of dna.architecture.layers) {
    if (targetLayerSet && !targetLayerSet.has(layer.kind.toLowerCase())) {
      continue;
    }

    const layerNodeId = `node:layer:${layer.kind}`;
    if (nodeMap.has(layerNodeId)) continue;

    const layerEvidences: SemanticEvidence[] = layer.filePaths.map(f =>
      createLayerMembershipEvidence(layer.kind, f)
    );

    const layerNode: SemanticNode = {
      id: layerNodeId,
      kind: 'LAYER',
      name: layer.name,
      metadata: {
        layerKind: layer.kind,
        confidence: layer.confidence,
        filesCount: layer.filePaths.length,
        dependenciesOnLayers: layer.dependenciesOnLayers
      },
      evidence: layerEvidences.length > 0 ? layerEvidences : [createLayerMembershipEvidence(layer.kind, layer.name)]
    };

    nodeMap.set(layerNodeId, layerNode);
  }

  // 5. Construct ENTRY_POINT nodes from DNA
  for (const ep of dna.architecture.entryPoints) {
    if (isSecretPath(ep.path)) continue;

    const entryNodeId = `node:entry:${ep.role}:${ep.path}`;
    if (nodeMap.has(entryNodeId)) continue;

    const entryNode: SemanticNode = {
      id: entryNodeId,
      kind: 'ENTRY_POINT',
      name: `${ep.role}:${ep.path}`,
      filePath: ep.path,
      metadata: {
        role: ep.role,
        path: ep.path,
        confidence: ep.confidence
      },
      evidence: [createEntryPointEvidence(ep.role, ep.path)]
    };

    nodeMap.set(entryNodeId, entryNode);
  }

  // Deterministically sort all nodes
  const sortedNodes = Array.from(nodeMap.values()).sort(compareNodes);

  return {
    nodes: sortedNodes,
    nodeMap
  };
}
