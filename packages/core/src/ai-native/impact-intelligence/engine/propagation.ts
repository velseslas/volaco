/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Target Resolution Engine
 */

import { ValidationError } from '../../../errors.js';
import type { SemanticCodeGraph, SemanticNode } from '../../semantic-graph/types.js';
import { compareResolvedTargets } from './canonical.js';
import type { ImpactAnalysisRequest, ResolvedTarget } from '../types.js';

/**
 * Resolves targets from request parameters against the SemanticCodeGraph.
 * Supports resolution by:
 * - targetNodeIds
 * - targetFiles
 * - targetSymbols
 */
export function resolveTargets(
  request: ImpactAnalysisRequest,
  graph: SemanticCodeGraph
): readonly ResolvedTarget[] {
  const nodeMap = new Map<string, SemanticNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  const resolved = new Map<string, ResolvedTarget>();

  const hasNodeIds = Boolean(request.targetNodeIds && request.targetNodeIds.length > 0);
  const hasFiles = Boolean(request.targetFiles && request.targetFiles.length > 0);
  const hasSymbols = Boolean(request.targetSymbols && request.targetSymbols.length > 0);

  if (!hasNodeIds && !hasFiles && !hasSymbols) {
    throw new ValidationError(
      'Au moins une cible (targetNodeIds, targetFiles ou targetSymbols) est requise pour l\'analyse d\'impact'
    );
  }

  // 1. Resolve by Node IDs
  if (request.targetNodeIds) {
    for (const nodeId of request.targetNodeIds) {
      const trimmed = nodeId.trim();
      if (!trimmed) continue;
      const node = nodeMap.get(trimmed);
      if (node) {
        resolved.set(node.id, {
          targetNode: node,
          matchedBy: 'NODE_ID',
          query: trimmed
        });
      }
    }
  }

  // 2. Resolve by File Paths
  if (request.targetFiles) {
    for (const filePath of request.targetFiles) {
      const trimmed = filePath.trim();
      if (!trimmed) continue;

      // Find file node and any symbols within file
      for (const node of graph.nodes) {
        if (node.filePath === trimmed) {
          if (!resolved.has(node.id)) {
            resolved.set(node.id, {
              targetNode: node,
              matchedBy: 'FILE_PATH',
              query: trimmed
            });
          }
        }
      }
    }
  }

  // 3. Resolve by Symbol Names
  if (request.targetSymbols) {
    for (const symbolName of request.targetSymbols) {
      const trimmed = symbolName.trim();
      if (!trimmed) continue;

      for (const node of graph.nodes) {
        if (
          node.name === trimmed &&
          node.kind !== 'FILE' &&
          node.kind !== 'LAYER' &&
          node.kind !== 'MODULE'
        ) {
          if (!resolved.has(node.id)) {
            resolved.set(node.id, {
              targetNode: node,
              matchedBy: 'SYMBOL_NAME',
              query: trimmed
            });
          }
        }
      }
    }
  }

  const result = Array.from(resolved.values()).sort(compareResolvedTargets);

  if (result.length === 0) {
    throw new ValidationError(
      'Aucun nœud cible correspondant trouvé dans le graphe sémantique pour la requête spécifiée'
    );
  }

  return result;
}
