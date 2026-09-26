/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-001)
 * CSS Structural Scanner
 */

import type { LanguageAnalyzer } from './base.js';
import { computeSemanticHash } from './base.js';
import type {
  AnalysisStatus,
  CodeDiagnostic,
  CodeExport,
  CodeImport,
  CodeSymbol,
  FileAnalysis,
  SupportedLanguage
} from '../types.js';

export class CssAnalyzer implements LanguageAnalyzer {
  public readonly language: SupportedLanguage = 'css';
  public readonly supportedExtensions: readonly string[] = ['.css'];

  public canHandle(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.css');
  }

  public analyze(
    content: string,
    filePath: string,
    context: {
      tenantId: string;
      projectId: string;
      fileHash: string;
      analyzerVersion: string;
    }
  ): FileAnalysis {
    const startMs = Date.now();
    const lines = content.split('\n');
    const lineCount = lines.length;
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    if (content.trim().length === 0) {
      const semanticHash = computeSemanticHash({
        filePath,
        fileHash: context.fileHash,
        language: 'css',
        analysisStatus: 'EMPTY',
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        diagnostics: []
      });

      return {
        tenantId: context.tenantId,
        projectId: context.projectId,
        filePath,
        fileHash: context.fileHash,
        language: 'css',
        parser: 'DeterministicCssScanner',
        analysisStatus: 'EMPTY',
        semanticHash,
        diagnostics: [],
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        lineCount,
        sizeBytes,
        executionMeta: {
          analyzedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          analyzerVersion: context.analyzerVersion
        }
      };
    }

    const symbols: CodeSymbol[] = [];
    const imports: CodeImport[] = [];
    const dependenciesSet = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const lineStr = lines[i] ?? '';
      const lineNum = i + 1;

      // @import statements: @import url("..."); or @import "...";
      const importMatches = lineStr.matchAll(/@import\s+(?:url\(['"]?([^'")]+)['"]?\)|['"]([^'"]+)['"])/gi);
      for (const m of importMatches) {
        const specifier = m[1] || m[2];
        if (specifier) {
          dependenciesSet.add(specifier);
          imports.push({
            moduleSpecifier: specifier,
            isRelative: specifier.startsWith('.') || specifier.startsWith('/'),
            namedImports: [],
            isTypeOnly: false,
            line: lineNum
          });
        }
      }

      // CSS custom properties: --color-primary: ...;
      const varMatches = lineStr.matchAll(/(--[a-zA-Z0-9-_]+)\s*:/g);
      for (const m of varMatches) {
        if (m[1]) {
          symbols.push({
            name: m[1],
            kind: 'constant',
            lineStart: lineNum,
            lineEnd: lineNum,
            isExported: true,
            isDefaultExport: false,
            signature: `var(${m[1]})`
          });
        }
      }

      // Class selectors: .btn-primary { ...
      const classMatches = lineStr.matchAll(/\.([a-zA-Z0-9-_]+)[^\{,]*\{/g);
      for (const m of classMatches) {
        if (m[1]) {
          symbols.push({
            name: `.${m[1]}`,
            kind: 'variable',
            lineStart: lineNum,
            lineEnd: lineNum,
            isExported: false,
            isDefaultExport: false,
            signature: `class: .${m[1]}`
          });
        }
      }
    }

    // Deduplicate and sort symbols
    const uniqueSymbolsMap = new Map<string, CodeSymbol>();
    for (const s of symbols) {
      if (!uniqueSymbolsMap.has(s.name)) {
        uniqueSymbolsMap.set(s.name, s);
      }
    }
    const sortedSymbols = Array.from(uniqueSymbolsMap.values()).sort(
      (a, b) => a.lineStart - b.lineStart || a.name.localeCompare(b.name)
    );

    imports.sort((a, b) => a.line - b.line || a.moduleSpecifier.localeCompare(b.moduleSpecifier));
    const sortedDependencies = Array.from(dependenciesSet).sort();

    const semanticHash = computeSemanticHash({
      filePath,
      fileHash: context.fileHash,
      language: 'css',
      analysisStatus: 'PARSED',
      symbols: sortedSymbols,
      imports,
      exports: [],
      dependencies: sortedDependencies,
      diagnostics: []
    });

    return {
      tenantId: context.tenantId,
      projectId: context.projectId,
      filePath,
      fileHash: context.fileHash,
      language: 'css',
      parser: 'DeterministicCssScanner',
      analysisStatus: 'PARSED',
      semanticHash,
      diagnostics: [],
      symbols: sortedSymbols,
      imports,
      exports: [],
      dependencies: sortedDependencies,
      lineCount,
      sizeBytes,
      executionMeta: {
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        analyzerVersion: context.analyzerVersion
      }
    };
  }
}
