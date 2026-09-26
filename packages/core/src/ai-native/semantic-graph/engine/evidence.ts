/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-004)
 * Semantic Evidence Factory & Deduplication
 */

import type { SemanticEvidence, SemanticEvidenceKind } from '../types.js';

export function createEvidence(
  kind: SemanticEvidenceKind,
  source: string,
  detail: string,
  filePath?: string | undefined,
  lineStart?: number | undefined,
  lineEnd?: number | undefined
): SemanticEvidence {
  return {
    kind,
    source,
    detail,
    ...(filePath ? { filePath } : {}),
    ...(lineStart !== undefined ? { lineStart } : {}),
    ...(lineEnd !== undefined ? { lineEnd } : {})
  };
}

export function createAstImportEvidence(
  filePath: string,
  line: number,
  moduleSpecifier: string,
  isTypeOnly: boolean
): SemanticEvidence {
  return createEvidence(
    'AST_IMPORT',
    `AST import in ${filePath}:${line}`,
    `Import ${isTypeOnly ? '(type-only) ' : ''}from "${moduleSpecifier}"`,
    filePath,
    line,
    line
  );
}

export function createAstExportEvidence(
  filePath: string,
  line: number,
  exportName: string,
  isTypeOnly: boolean
): SemanticEvidence {
  return createEvidence(
    'AST_EXPORT',
    `AST export in ${filePath}:${line}`,
    `Export ${isTypeOnly ? '(type-only) ' : ''}"${exportName}"`,
    filePath,
    line,
    line
  );
}

export function createAstSymbolEvidence(
  filePath: string,
  lineStart: number,
  lineEnd: number,
  symbolName: string,
  kind: string
): SemanticEvidence {
  return createEvidence(
    'AST_SYMBOL',
    `AST declaration in ${filePath}:${lineStart}`,
    `${kind} ${symbolName}`,
    filePath,
    lineStart,
    lineEnd
  );
}

export function createSymbolReferenceEvidence(
  filePath: string,
  line: number,
  symbolName: string,
  targetFile: string
): SemanticEvidence {
  return createEvidence(
    'SYMBOL_REFERENCE',
    `Symbol reference in ${filePath}:${line}`,
    `References symbol "${symbolName}" from "${targetFile}"`,
    filePath,
    line,
    line
  );
}

export function createComponentPropsEvidence(
  filePath: string,
  lineStart: number,
  propsCount: number
): SemanticEvidence {
  return createEvidence(
    'COMPONENT_PROPS',
    `Component definition in ${filePath}:${lineStart}`,
    `Component declared with ${propsCount} prop(s)`,
    filePath,
    lineStart,
    lineStart
  );
}

export function createComponentHookEvidence(
  filePath: string,
  lineStart: number,
  hooks: readonly string[]
): SemanticEvidence {
  return createEvidence(
    'COMPONENT_HOOK',
    `Component body in ${filePath}:${lineStart}`,
    `Component consumes hooks: ${hooks.join(', ')}`,
    filePath,
    lineStart,
    lineStart
  );
}

export function createRouteDeclarationEvidence(
  filePath: string,
  line: number,
  method: string,
  routePath: string
): SemanticEvidence {
  return createEvidence(
    'ROUTE_DECLARATION',
    `Route handler in ${filePath}:${line}`,
    `HTTP ${method} ${routePath}`,
    filePath,
    line,
    line
  );
}

export function createModuleMembershipEvidence(
  moduleName: string,
  filePath: string
): SemanticEvidence {
  return createEvidence(
    'MODULE_MEMBERSHIP',
    `Application DNA module: ${moduleName}`,
    `File "${filePath}" belongs to module "${moduleName}"`,
    filePath
  );
}

export function createLayerMembershipEvidence(
  layerKind: string,
  filePath: string
): SemanticEvidence {
  return createEvidence(
    'LAYER_MEMBERSHIP',
    `Application DNA layer: ${layerKind}`,
    `File "${filePath}" classified in architectural layer "${layerKind}"`,
    filePath
  );
}

export function createEntryPointEvidence(
  role: string,
  filePath: string
): SemanticEvidence {
  return createEvidence(
    'ENTRY_POINT',
    `Application DNA entry point: ${role}`,
    `File "${filePath}" serves as ${role}`,
    filePath
  );
}

export function createDnaDependencyEvidence(
  sourceFile: string,
  targetFile: string
): SemanticEvidence {
  return createEvidence(
    'DNA_DEPENDENCY',
    `Application DNA graph metric`,
    `"${sourceFile}" depends on "${targetFile}"`,
    sourceFile
  );
}

export function createContextProvenanceEvidence(
  reason: string,
  detail: string
): SemanticEvidence {
  return createEvidence(
    'CONTEXT_PROVENANCE',
    `Context Assembly provenance: ${reason}`,
    detail
  );
}

/**
 * Merges multiple evidence items and eliminates identical duplicates.
 */
export function mergeEvidence(
  existing: readonly SemanticEvidence[],
  incoming: readonly SemanticEvidence[]
): SemanticEvidence[] {
  const seen = new Set<string>();
  const results: SemanticEvidence[] = [];

  for (const ev of [...existing, ...incoming]) {
    const key = `${ev.kind}|${ev.source}|${ev.detail}|${ev.filePath ?? ''}|${ev.lineStart ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(ev);
    }
  }

  return results;
}
